import { recipients, sha256, type Env, type Notice, type State, type Version } from './types';

export async function getState(db: D1Database): Promise<State> {
  const state = await db.prepare('SELECT * FROM monitor_state WHERE id = 1').first<State>();
  if (!state) throw new Error('Database is not initialized; apply the D1 migrations');
  return state;
}

export async function acquireLease(db: D1Database, owner: string, now: Date): Promise<boolean> {
  const result = await db.prepare(`UPDATE monitor_state SET lease_owner = ?, lease_until = ?
    WHERE id = 1 AND (lease_until IS NULL OR lease_until < ?)`)
    .bind(owner, new Date(now.getTime() + 600_000).toISOString(), now.toISOString()).run();
  return result.meta.changes === 1;
}

export async function releaseLease(db: D1Database, owner: string): Promise<void> {
  await db.prepare('UPDATE monitor_state SET lease_owner = NULL, lease_until = NULL WHERE id = 1 AND lease_owner = ?').bind(owner).run();
}

/** Commit all fetched pages, notification records, and scan cursor together. */
export async function ingest(
  env: Env, notices: Notice[], baseline: boolean, now: Date, stateUpdate: D1PreparedStatement,
): Promise<number> {
  const timestamp = now.toISOString();
  const unique = [...new Map(notices.map((n) => [n.id, n])).values()];
  const records = await Promise.all(unique.map(async (n) => ({
    id: n.id, title: n.title, published_on: n.publishedOn, document_url: n.documentUrl,
    fingerprint: await sha256(JSON.stringify([n.title, n.publishedOn, n.documentUrl])),
  })));
  const old = await env.DB.prepare('SELECT id, fingerprint FROM notices WHERE id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(records.map((r) => r.id))).all<{ id: string; fingerprint: string }>();
  const previous = new Map(old.results.map((r) => [r.id, r.fingerprint]));
  const versions: Version[] = [];
  if (!baseline) {
    for (const record of records) {
      if (previous.get(record.id) !== record.fingerprint) {
        versions.push({
          id: await sha256(`${record.id}:${record.fingerprint}`), notice_id: record.id,
          kind: previous.has(record.id) ? 'updated' : 'new', title: record.title,
          published_on: record.published_on, document_url: record.document_url, detected_at: timestamp,
        });
      }
    }
  }
  const outbox = [];
  const to = baseline ? [] : recipients(env);
  for (const version of versions) {
    for (const recipient of to) {
      outbox.push({ id: await sha256(`${version.id}:${recipient}`), version_id: version.id, recipient });
    }
  }
  // json_each keeps the number of D1 queries bounded, including a 20-row page.
  const statements = [env.DB.prepare(`INSERT INTO notices
    (id, title, published_on, document_url, fingerprint, first_seen_at, last_seen_at)
    SELECT json_extract(value, '$.id'), json_extract(value, '$.title'),
      json_extract(value, '$.published_on'), json_extract(value, '$.document_url'),
      json_extract(value, '$.fingerprint'), ?, ? FROM json_each(?) WHERE 1
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, published_on = excluded.published_on,
      document_url = excluded.document_url, fingerprint = excluded.fingerprint, last_seen_at = excluded.last_seen_at`)
    .bind(timestamp, timestamp, JSON.stringify(records))];
  if (versions.length) {
    statements.push(env.DB.prepare(`INSERT OR IGNORE INTO notice_versions
      (id, notice_id, kind, title, published_on, document_url, detected_at)
      SELECT json_extract(value, '$.id'), json_extract(value, '$.notice_id'), json_extract(value, '$.kind'),
        json_extract(value, '$.title'), json_extract(value, '$.published_on'),
        json_extract(value, '$.document_url'), json_extract(value, '$.detected_at') FROM json_each(?)`)
      .bind(JSON.stringify(versions)));
    statements.push(env.DB.prepare(`INSERT OR IGNORE INTO outbox
      (id, version_id, recipient, created_at, next_attempt_at)
      SELECT json_extract(value, '$.id'), json_extract(value, '$.version_id'),
        json_extract(value, '$.recipient'), ?, ? FROM json_each(?)`)
      .bind(timestamp, timestamp, JSON.stringify(outbox)));
  }
  statements.push(stateUpdate);
  await env.DB.batch(statements);
  return versions.length;
}

export async function status(env: Env) {
  const [state, counts, outbox, runs, problems] = await Promise.all([
    getState(env.DB),
    env.DB.prepare('SELECT COUNT(*) AS notices FROM notices').first(),
    env.DB.prepare('SELECT status, COUNT(*) AS count FROM outbox GROUP BY status').all(),
    env.DB.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT 10').all(),
    env.DB.prepare(`SELECT id, recipient, status, attempts, next_attempt_at, last_error
      FROM outbox WHERE status IN ('failed', 'uncertain') ORDER BY created_at DESC LIMIT 20`).all(),
  ]);
  return {
    state, counts, emails: outbox.results, recentRuns: runs.results, emailProblems: problems.results,
    emailEnabled: env.EMAIL_ENABLED === 'true',
    configured: { adminToken: Boolean(env.ADMIN_TOKEN), recipients: Boolean(env.EMAIL_TO?.trim()),
      sender: Boolean(env.EMAIL_FROM?.trim()), resend: Boolean(env.RESEND_API_KEY) },
  };
}
