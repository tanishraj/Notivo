import {
  RESEND_URL,
  SOURCE_URL,
  intSetting,
  recipients,
  sha256,
  type Env,
  type Fetcher,
  type MailPayload,
  type Version,
} from "./types";
import { renderNoticeHtml } from "./email-template";

export function renderEmail(
  version: Version,
  to: string | string[],
  sender: string,
  options: { test?: boolean; manual?: boolean } = {},
): MailPayload {
  const label =
    options.manual ? "NMC notice shared with you" : version.kind === "updated" ? "Updated NMC notice" : "New NMC notice";
  const date = version.published_on ?? "Not provided";
  const documentUrl = version.document_url ?? SOURCE_URL;
  const linkLabel = version.document_url
    ? "Read original NMC notice"
    : "View NMC notice listing";
  return {
    from: sender,
    to: Array.isArray(to) ? to : [to],
    subject: `${label}: ${version.title}`.slice(0, 240),
    text: [
      label,
      "",
      version.title,
      `Published: ${date}`,
      `Notice ID: ${version.notice_id}`,
      `${linkLabel}: ${documentUrl}`,
      `NMC notice listing: ${SOURCE_URL}`,
      "",
      version.document_url
        ? "The document is hosted by the National Medical Commission."
        : "NMC has not provided a document link for this entry.",
    ].join("\n"),
    html: renderNoticeHtml(version, options),
  };
}

interface Delivery extends Version {
  delivery_id: string;
  recipient: string;
  payload_json: string | null;
  first_attempt_at: string | null;
  attempts: number;
  delivery_source: "automatic" | "manual";
}

function deliveryTable(row: Delivery) {
  return row.delivery_source === "manual" ? "manual_deliveries" : "outbox";
}

export async function sendPending(
  env: Env,
  fetcher: Fetcher = fetch,
  now = new Date(),
  manualRequestId?: string,
) {
  if (env.EMAIL_ENABLED !== "true")
    return { enabled: false, accepted: 0, failed: 0, retried: 0, uncertain: 0 };
  if (
    !env.RESEND_API_KEY ||
    !env.EMAIL_FROM?.trim() ||
    /[\r\n]/.test(env.EMAIL_FROM)
  ) {
    throw new Error(
      "Set RESEND_API_KEY and a verified EMAIL_FROM before enabling email",
    );
  }
  const limit = intSetting(env.EMAILS_PER_RUN, 5, 5);
  // One email per notice, addressed to all its recipients. Queued rows that share
  // a stored payload (or, before the first attempt, a notice version) form one email;
  // the limit counts emails, and a group is always fetched whole.
  const due = `status = 'pending' AND kind = 'new' AND next_attempt_at <= ?
      ${manualRequestId ? "AND manual_request_id = ?" : ""}`;
  const groupKey = "COALESCE(payload_json, delivery_source || ':' || id)";
  const params = [now.toISOString(), ...(manualRequestId ? [manualRequestId] : [])];
  const rows = await env.DB.prepare(
    `SELECT *, ${groupKey} AS group_key FROM email_deliveries
    WHERE ${due} AND ${groupKey} IN (
      SELECT ${groupKey} FROM email_deliveries WHERE ${due}
      GROUP BY ${groupKey} ORDER BY MIN(created_at), MIN(delivery_id) LIMIT ?)
    ORDER BY created_at, delivery_id`,
  )
    .bind(...params, ...params, limit)
    .all<Delivery & { group_key: string }>();
  const groups = new Map<string, Delivery[]>();
  for (const row of rows.results)
    groups.set(row.group_key, [...(groups.get(row.group_key) ?? []), row]);
  const result = {
    enabled: true,
    accepted: 0,
    failed: 0,
    retried: 0,
    uncertain: 0,
  };
  let attempted = false;
  for (const group of groups.values()) {
    const first = group[0]!;
    const table = deliveryTable(first);
    const ids = JSON.stringify(group.map((row) => row.delivery_id));
    const update = (sql: string, ...values: unknown[]) =>
      env.DB.prepare(`UPDATE ${table} SET ${sql} WHERE id IN (SELECT value FROM json_each(?))`)
        .bind(...values, ids)
        .run();
    // Resend retains idempotency keys for 24h. Stop automatic retries before expiry.
    if (
      group.some(
        (row) => row.first_attempt_at && now.getTime() - Date.parse(row.first_attempt_at) >= 23 * 3_600_000,
      )
    ) {
      await update(
        "status = 'uncertain', last_error = ?",
        "Retry window ended; reconcile with Resend before attempting another send",
      );
      result.uncertain += group.length;
      continue;
    }
    const payload: MailPayload = first.payload_json
      ? JSON.parse(first.payload_json)
      : renderEmail(first, inConfiguredOrder(group.map((row) => row.recipient), env), env.EMAIL_FROM);
    // A single-recipient email keeps the per-delivery key used before grouping, so a
    // retry of an email queued by the previous version is still deduplicated.
    const key =
      payload.to.length === 1 ? first.delivery_id : await sha256(`group/${group.map((row) => row.delivery_id).sort().join(",")}`);
    if (attempted) await new Promise((resolve) => setTimeout(resolve, 550));
    attempted = true;
    // Persist the exact payload before sending so retries cannot change its content.
    await update(
      "payload_json = ?, first_attempt_at = COALESCE(first_attempt_at, ?), attempts = attempts + 1",
      JSON.stringify(payload),
      now.toISOString(),
    );
    const attempts = Math.max(...group.map((row) => row.attempts));
    let response: Response;
    let body: { id?: string; name?: string };
    try {
      response = await fetcher(RESEND_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `nmc/${key}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
        redirect: "manual",
      });
      body = (await response.json()) as typeof body;
    } catch {
      // Never log API keys, payloads, or opaque provider response bodies.
      await retry(update, attempts, now, "Resend response unavailable; outcome may be unknown");
      result.retried += group.length;
      continue;
    }
    if (response.ok && typeof body.id === "string" && body.id) {
      // Keep database failures outside the API catch. If this write fails, the
      // next invocation retries the same persisted payload and idempotency key.
      await update("status = 'accepted', resend_id = ?, accepted_at = ?, last_error = NULL", body.id, now.toISOString());
      result.accepted += group.length;
    } else if (
      response.status === 429 ||
      response.status >= 500 ||
      response.status === 408 ||
      (response.status === 409 &&
        body.name === "concurrent_idempotent_requests") ||
      response.ok
    ) {
      await retry(update, attempts, now, `Resend HTTP ${response.status}; retry with original idempotency key`);
      result.retried += group.length;
      // Stop this cycle on rate limits rather than immediately submitting more.
      if (response.status === 429) break;
    } else {
      await update(
        "status = 'failed', last_error = ?",
        `Resend HTTP ${response.status}; check sender, recipient, and API configuration`,
      );
      result.failed += group.length;
    }
  }
  return result;
}

/** Recipients in the order they are saved in settings; unknown ones go last. */
function inConfiguredOrder(list: string[], env: Env) {
  let saved: string[] = [];
  try {
    saved = recipients(env);
  } catch {
    // No valid saved list; keep the queued order.
  }
  const rank = (address: string) => {
    const index = saved.indexOf(address);
    return index === -1 ? saved.length : index;
  };
  return [...list].sort((a, b) => rank(a) - rank(b));
}

async function retry(
  update: (sql: string, ...values: unknown[]) => Promise<unknown>,
  attempts: number,
  now: Date,
  message: string,
) {
  const delay = Math.min(3_600, 60 * 2 ** Math.min(attempts, 6));
  await update("next_attempt_at = ?, last_error = ?", new Date(now.getTime() + delay * 1_000).toISOString(), message);
}

export async function preview(
  env: Env,
  options: { test?: boolean } = {},
): Promise<MailPayload> {
  const version = await env.DB.prepare(
    `SELECT v.* FROM notice_versions v ORDER BY detected_at DESC LIMIT 1`,
  ).first<Version>();
  const latest =
    version ??
    (await env.DB.prepare(
      `SELECT id AS notice_id, title, published_on, document_url, first_seen_at AS detected_at
    FROM notices ORDER BY published_on DESC, id DESC LIMIT 1`,
    ).first<Omit<Version, "kind" | "id">>());
  if (!latest) throw new Error("Run a scan first to preview a real notice");
  return renderEmail(
    { ...latest, id: "preview", kind: version?.kind ?? "new" },
    "preview@example.com",
    env.EMAIL_FROM ?? "NMC Notices <preview@example.com>",
    options,
  );
}

export class TestEmailError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export async function testEmailPayload(env: Env): Promise<MailPayload> {
  let to: string[];
  try {
    to = recipients(env);
  } catch {
    throw new TestEmailError(
      "Set EMAIL_TO to one valid email address for the test",
    );
  }
  if (to.length !== 1)
    throw new TestEmailError(
      "The test sends exactly one email; configure a single EMAIL_TO address",
    );
  if (!env.EMAIL_FROM?.trim() || /[\r\n]/.test(env.EMAIL_FROM))
    throw new TestEmailError("Set EMAIL_FROM before testing");
  const mail = await preview(env, { test: true });
  return {
    ...mail,
    from: env.EMAIL_FROM.trim(),
    to,
    subject: `[TEST] ${mail.subject}`.slice(0, 240),
    text: `This is a test email from your NMC notice monitor.\n\n${mail.text}`,
  };
}

/** Explicit test sends bypass the notice outbox and never drain pending alerts. */
export async function sendTestEmail(
  env: Env,
  requestId: string,
  fetcher: Fetcher = fetch,
) {
  if (env.EMAIL_ENABLED !== "true")
    throw new TestEmailError("Set EMAIL_ENABLED=true to send the test email");
  if (!env.RESEND_API_KEY)
    throw new TestEmailError(
      "Configure RESEND_API_KEY before sending the test email",
    );
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      requestId,
    )
  ) {
    throw new TestEmailError("Provide a UUID in the Idempotency-Key header");
  }
  const payload = await testEmailPayload(env);
  let response: Response;
  let result: { id?: string };
  try {
    response = await fetcher(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `nmc/test/${requestId}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
      redirect: "manual",
    });
    result = (await response.json()) as typeof result;
  } catch {
    throw new TestEmailError(
      "No confirmation received from Resend. Check the Resend dashboard before sending another test.",
      502,
    );
  }
  if (!response.ok) {
    const hint =
      response.status === 403
        ? "Check API key permissions and sender verification. With onboarding@resend.dev, EMAIL_TO must match your Resend account email."
        : response.status === 401
          ? "Check RESEND_API_KEY."
          : "Check the Resend dashboard and your sender/recipient settings.";
    throw new TestEmailError(
      `Resend rejected the test (HTTP ${response.status}). ${hint}`,
      502,
    );
  }
  if (typeof result.id !== "string" || !result.id) {
    throw new TestEmailError(
      "Resend returned no email ID. Check the dashboard before sending another test.",
      502,
    );
  }
  return {
    accepted: true,
    resendId: result.id,
    from: payload.from,
    to: payload.to,
    subject: payload.subject,
  };
}
