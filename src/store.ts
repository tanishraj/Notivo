import { ageInDays, decideNewNotices, indiaToday } from "./classify";
import {
  intSetting,
  recipients,
  sha256,
  type Env,
  type Notice,
  type State,
  type Version,
} from "./types";

export async function getState(db: D1Database): Promise<State> {
  const state = await db
    .prepare("SELECT * FROM monitor_state WHERE id = 1")
    .first<State>();
  if (!state)
    throw new Error("Database is not initialized; apply the D1 migrations");
  return state;
}

export async function acquireLease(
  db: D1Database,
  owner: string,
  now: Date,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE monitor_state SET lease_owner = ?, lease_until = ?
    WHERE id = 1 AND (lease_until IS NULL OR lease_until < ?)`,
    )
    .bind(
      owner,
      new Date(now.getTime() + 600_000).toISOString(),
      now.toISOString(),
    )
    .run();
  return result.meta.changes === 1;
}

export async function releaseLease(
  db: D1Database,
  owner: string,
): Promise<void> {
  await db
    .prepare(
      "UPDATE monitor_state SET lease_owner = NULL, lease_until = NULL WHERE id = 1 AND lease_owner = ?",
    )
    .bind(owner)
    .run();
}

/** Commit all fetched pages, notification records, and scan cursor together. */
export async function ingest(
  env: Env,
  notices: Notice[],
  baseline: boolean,
  now: Date,
  stateUpdate: D1PreparedStatement,
): Promise<number> {
  const timestamp = now.toISOString();
  const unique = [...new Map(notices.map((n) => [n.id, n])).values()];
  const incoming = await Promise.all(
    unique.map(async (n) => ({
      id: n.id,
      title: n.title,
      published_on: n.publishedOn,
      document_url: n.documentUrl,
      fallback_id: `text:${await sha256(JSON.stringify([n.title, n.publishedOn]))}`,
      fingerprint: await sha256(
        JSON.stringify([n.title, n.publishedOn, n.documentUrl]),
      ),
    })),
  );
  type Stored = {
    id: string;
    title: string;
    published_on: string | null;
    document_url: string | null;
    fingerprint: string;
    first_seen_at: string;
  };
  const old = await env.DB.prepare(
    `SELECT id, title, published_on, document_url, fingerprint, first_seen_at FROM notices n
    WHERE id IN (SELECT value FROM json_each(?)) OR EXISTS (
      SELECT 1 FROM json_each(?) r WHERE n.title = json_extract(r.value, '$.title')
      AND n.published_on IS json_extract(r.value, '$.published_on'))`,
  )
    .bind(
      JSON.stringify(incoming.flatMap((r) => [r.id, r.fallback_id])),
      JSON.stringify(incoming),
    )
    .all<Stored>();
  const byId = new Map(old.results.map((r) => [r.id, r]));
  const linkedGroups = new Map<string, Set<string>>();
  for (const record of [...old.results, ...incoming]) {
    if (!record.document_url) continue;
    const key = JSON.stringify([record.title, record.published_on]);
    const ids = linkedGroups.get(key) ?? new Set<string>();
    ids.add(record.id);
    linkedGroups.set(key, ids);
  }
  const merges: { from: string; to: string }[] = [];
  const previous = new Map<string, Stored>();
  const records = incoming.map((record) => {
    const exact = byId.get(record.id);
    const matches = old.results.filter(
      (r) => r.title === record.title && r.published_on === record.published_on,
    );
    const linked = matches.filter((r) => r.document_url !== null);
    const unambiguous =
      linkedGroups.get(JSON.stringify([record.title, record.published_on]))
        ?.size === 1;
    const fallback = unambiguous ? byId.get(record.fallback_id) : undefined;
    // A document appearing/disappearing does not create a new announcement.
    // Promote the original text identity to its real download ID, preserving history.
    const known = record.document_url
      ? (exact ??
        fallback ??
        (unambiguous &&
        matches.length === 1 &&
        matches[0]!.document_url === null
          ? matches[0]
          : undefined))
      : unambiguous && linked.length === 1
        ? linked[0]
        : (exact ?? (matches.length === 1 ? matches[0] : undefined));
    const id = record.document_url ? record.id : (known?.id ?? record.id);
    const obsolete = [known, fallback].filter((r): r is Stored =>
      Boolean(r && r.id !== id && r.document_url === null),
    );
    for (const item of obsolete)
      if (!merges.some((m) => m.from === item.id))
        merges.push({ from: item.id, to: id });
    if (known) previous.set(id, known);
    const firstSeen = [
      timestamp,
      known?.first_seen_at,
      ...obsolete.map((r) => r.first_seen_at),
    ]
      .filter((v): v is string => Boolean(v))
      .sort()[0]!;
    return { ...record, id, first_seen_at: firstSeen };
  });
  const maxAge = intSetting(env.NOTIFY_MAX_AGE_DAYS, 30, 3650);
  const today = indiaToday(now);
  const versions: Version[] = [];
  let archived = 0;
  if (!baseline) {
    for (const record of records) {
      // NMC's listing can hide a row at a page boundary and show it later. A new
      // document ID with an old published date is archive, not an announcement:
      // record it like the first import, with no history entry or email.
      if (
        !previous.has(record.id) &&
        record.published_on !== null &&
        ageInDays(record.published_on, today) > maxAge
      ) {
        archived++;
        continue;
      }
      if (previous.get(record.id)?.fingerprint !== record.fingerprint) {
        versions.push({
          id: await sha256(`${record.id}:${record.fingerprint}`),
          notice_id: record.id,
          kind: previous.has(record.id) ? "updated" : "new",
          title: record.title,
          published_on: record.published_on,
          document_url: record.document_url,
          detected_at: timestamp,
        });
      }
    }
  }
  if (archived)
    console.log(JSON.stringify({ event: "archive_entries_recorded", count: archived }));
  const outbox = [];
  const to = baseline ? [] : recipients(env);
  const newVersions = versions.filter((version) => version.kind === "new");
  const newIds = newVersions.map((v) => v.notice_id);
  const sameDay = newVersions.length
    ? (
        await env.DB.prepare(
          `SELECT id, title, published_on FROM notices
          WHERE published_on IN (SELECT value FROM json_each(?))
            AND id NOT IN (SELECT value FROM json_each(?))`,
        )
          .bind(
            JSON.stringify([...new Set(newVersions.map((v) => v.published_on).filter(Boolean))]),
            JSON.stringify(newIds),
          )
          .all<{ id: string; title: string; published_on: string | null }>()
      ).results
    : [];
  const decisions = decideNewNotices(newVersions, sameDay, {
    today,
    autoSendDays: Math.min(maxAge, intSetting(env.AUTO_SEND_DAYS, 7, 30)),
    newEntriesPerCheckLimit: intSetting(env.NEW_ENTRIES_PER_CHECK_LIMIT, 5, 100),
  });
  const newAnnouncements = newVersions.filter((v) => decisions.get(v.id)?.send);
  const reviews = newVersions.flatMap((v) => {
    const decision = decisions.get(v.id);
    return decision && !decision.send
      ? [{ notice_id: v.notice_id, version_id: v.id, reason: decision.reason }]
      : [];
  });
  if (reviews.length)
    console.log(JSON.stringify({ event: "notices_held_for_review", count: reviews.length }));
  for (const version of newAnnouncements) {
    for (const recipient of to) {
      outbox.push({
        id: await sha256(`${version.id}:${recipient}`),
        version_id: version.id,
        recipient,
      });
    }
  }
  // json_each keeps the number of D1 queries bounded, including a 20-row page.
  const statements = [
    env.DB.prepare(
      `INSERT INTO notices
    (id, title, published_on, document_url, fingerprint, first_seen_at, last_seen_at)
    SELECT json_extract(value, '$.id'), json_extract(value, '$.title'),
      json_extract(value, '$.published_on'), json_extract(value, '$.document_url'),
      json_extract(value, '$.fingerprint'), json_extract(value, '$.first_seen_at'), ? FROM json_each(?) WHERE 1
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, published_on = excluded.published_on,
      document_url = excluded.document_url, fingerprint = excluded.fingerprint,
      first_seen_at = MIN(notices.first_seen_at, excluded.first_seen_at), last_seen_at = excluded.last_seen_at`,
    ).bind(timestamp, JSON.stringify(records)),
  ];
  if (merges.length) {
    statements.push(
      env.DB.prepare(
        `UPDATE OR IGNORE notice_reviews SET notice_id =
      (SELECT json_extract(value, '$.to') FROM json_each(?) WHERE json_extract(value, '$.from') = notice_reviews.notice_id)
      WHERE notice_id IN (SELECT json_extract(value, '$.from') FROM json_each(?))`,
      ).bind(JSON.stringify(merges), JSON.stringify(merges)),
    );
    statements.push(
      env.DB.prepare(
        `DELETE FROM notice_reviews WHERE notice_id IN (SELECT json_extract(value, '$.from') FROM json_each(?))`,
      ).bind(JSON.stringify(merges)),
    );
    statements.push(
      env.DB.prepare(
        `UPDATE notice_versions SET notice_id =
      (SELECT json_extract(value, '$.to') FROM json_each(?) WHERE json_extract(value, '$.from') = notice_versions.notice_id)
      WHERE notice_id IN (SELECT json_extract(value, '$.from') FROM json_each(?))`,
      ).bind(JSON.stringify(merges), JSON.stringify(merges)),
    );
    statements.push(
      env.DB.prepare(
        `DELETE FROM notices WHERE id IN (SELECT json_extract(value, '$.from') FROM json_each(?))`,
      ).bind(JSON.stringify(merges)),
    );
  }
  if (versions.length) {
    statements.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO notice_versions
      (id, notice_id, kind, title, published_on, document_url, detected_at)
      SELECT json_extract(value, '$.id'), json_extract(value, '$.notice_id'), json_extract(value, '$.kind'),
        json_extract(value, '$.title'), json_extract(value, '$.published_on'),
        json_extract(value, '$.document_url'), json_extract(value, '$.detected_at') FROM json_each(?)`,
      ).bind(JSON.stringify(versions)),
    );
  }
  if (outbox.length) {
    statements.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO outbox
      (id, version_id, recipient, created_at, next_attempt_at)
      SELECT json_extract(value, '$.id'), json_extract(value, '$.version_id'),
        json_extract(value, '$.recipient'), ?, ? FROM json_each(?)`,
      ).bind(timestamp, timestamp, JSON.stringify(outbox)),
    );
  }
  if (reviews.length) {
    statements.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO notice_reviews (notice_id, version_id, reason, created_at)
        SELECT json_extract(value, '$.notice_id'), json_extract(value, '$.version_id'),
          json_extract(value, '$.reason'), ? FROM json_each(?)`,
      ).bind(timestamp, JSON.stringify(reviews)),
    );
  }
  statements.push(stateUpdate);
  await env.DB.batch(statements);
  return newAnnouncements.length;
}

/** Held notices still waiting for a decision. A notice already sent by hand counts as decided. */
export const WAITING_REVIEWS = `SELECT r.notice_id AS id, n.title, n.published_on, n.document_url, r.reason, r.created_at
  FROM notice_reviews r JOIN notices n ON n.id = r.notice_id
  WHERE r.status = 'waiting' AND NOT EXISTS (SELECT 1 FROM email_deliveries d
    WHERE d.notice_id = r.notice_id AND d.status IN ('pending', 'accepted'))`;

export async function status(env: Env) {
  const [state, counts, outbox, runs, problems, attention, reviews] = await Promise.all([
    getState(env.DB),
    env.DB.prepare("SELECT COUNT(*) AS notices FROM notices").first(),
    env.DB.prepare(
      "SELECT status, COUNT(*) AS count FROM email_deliveries GROUP BY status",
    ).all(),
    env.DB.prepare("SELECT * FROM runs ORDER BY id DESC LIMIT 10").all(),
    env.DB.prepare(
      `SELECT delivery_id AS id, recipient, status, attempts, next_attempt_at, last_error
      FROM email_activity_current WHERE status IN ('failed', 'uncertain') AND dismissed_at IS NULL AND resolved = 0 AND retried = 0 ORDER BY created_at DESC LIMIT 20`,
    ).all(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM email_activity_current WHERE status IN ('failed', 'uncertain') AND dismissed_at IS NULL AND resolved = 0 AND retried = 0").first<{ count: number }>(),
    env.DB.prepare(`${WAITING_REVIEWS} ORDER BY r.created_at DESC, r.notice_id DESC LIMIT 50`).all(),
  ]);
  return {
    state,
    counts,
    emails: outbox.results,
    recentRuns: runs.results,
    emailProblems: problems.results,
    emailAttentionCount: attention?.count ?? 0,
    reviews: reviews.results,
    emailEnabled: env.EMAIL_ENABLED === "true",
    monitorEnabled: env.MONITOR_ENABLED !== "false",
    checkIntervalMinutes: Number(env.CHECK_INTERVAL_MINUTES ?? 15),
    configured: {
      adminToken: Boolean(env.ADMIN_TOKEN),
      recipients: Boolean(env.EMAIL_TO?.trim()),
      sender: Boolean(env.EMAIL_FROM?.trim()),
      resend: Boolean(env.RESEND_API_KEY),
    },
  };
}
