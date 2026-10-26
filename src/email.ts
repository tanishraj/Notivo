import {
  RESEND_URL,
  SOURCE_URL,
  intSetting,
  recipients,
  type Env,
  type Fetcher,
  type MailPayload,
  type Version,
} from "./types";
import { renderNoticeHtml } from "./email-template";

export function renderEmail(
  version: Version,
  recipient: string,
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
    to: [recipient],
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
  const rows = await env.DB.prepare(
    `SELECT * FROM email_deliveries
    WHERE status = 'pending' AND kind = 'new' AND next_attempt_at <= ?
      ${manualRequestId ? "AND manual_request_id = ?" : ""}
    ORDER BY created_at, delivery_id LIMIT ?`,
  )
    .bind(now.toISOString(), ...(manualRequestId ? [manualRequestId] : []), limit)
    .all<Delivery>();
  const result = {
    enabled: true,
    accepted: 0,
    failed: 0,
    retried: 0,
    uncertain: 0,
  };
  let attempted = false;
  for (const row of rows.results) {
    // Resend retains idempotency keys for 24h. Stop automatic retries before expiry.
    if (
      row.first_attempt_at &&
      now.getTime() - Date.parse(row.first_attempt_at) >= 23 * 3_600_000
    ) {
      await env.DB.prepare(
        `UPDATE ${deliveryTable(row)} SET status = 'uncertain', last_error = ? WHERE id = ?`,
      )
        .bind(
          "Retry window ended; reconcile with Resend before attempting another send",
          row.delivery_id,
        )
        .run();
      result.uncertain++;
      continue;
    }
    const payload: MailPayload = row.payload_json
      ? JSON.parse(row.payload_json)
      : renderEmail(row, row.recipient, env.EMAIL_FROM);
    if (attempted) await new Promise((resolve) => setTimeout(resolve, 550));
    attempted = true;
    // Persist the exact payload before sending so retries cannot change its content.
    await env.DB.prepare(
      `UPDATE ${deliveryTable(row)} SET payload_json = ?, first_attempt_at = COALESCE(first_attempt_at, ?), attempts = attempts + 1 WHERE id = ?`,
    )
      .bind(JSON.stringify(payload), now.toISOString(), row.delivery_id)
      .run();
    let response: Response;
    let body: { id?: string; name?: string };
    try {
      response = await fetcher(RESEND_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `nmc/${row.delivery_id}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
        redirect: "manual",
      });
      body = (await response.json()) as typeof body;
    } catch {
      // Never log API keys, payloads, or opaque provider response bodies.
      await retry(
        env,
        row,
        now,
        "Resend response unavailable; outcome may be unknown",
      );
      result.retried++;
      continue;
    }
    if (response.ok && typeof body.id === "string" && body.id) {
      // Keep database failures outside the API catch. If this write fails, the
      // next invocation retries the same persisted payload and idempotency key.
      await env.DB.prepare(
        `UPDATE ${deliveryTable(row)} SET status = 'accepted', resend_id = ?, accepted_at = ?, last_error = NULL WHERE id = ?`,
      )
        .bind(body.id, now.toISOString(), row.delivery_id)
        .run();
      result.accepted++;
    } else if (
      response.status === 429 ||
      response.status >= 500 ||
      response.status === 408 ||
      (response.status === 409 &&
        body.name === "concurrent_idempotent_requests") ||
      response.ok
    ) {
      await retry(
        env,
        row,
        now,
        `Resend HTTP ${response.status}; retry with original idempotency key`,
      );
      result.retried++;
      // Stop this cycle on rate limits rather than immediately submitting more.
      if (response.status === 429) break;
    } else {
      await env.DB.prepare(
        `UPDATE ${deliveryTable(row)} SET status = 'failed', last_error = ? WHERE id = ?`,
      )
        .bind(
          `Resend HTTP ${response.status}; check sender, recipient, and API configuration`,
          row.delivery_id,
        )
        .run();
      result.failed++;
    }
  }
  return result;
}

async function retry(env: Env, row: Delivery, now: Date, message: string) {
  const delay = Math.min(3_600, 60 * 2 ** Math.min(row.attempts, 6));
  await env.DB.prepare(
    `UPDATE ${deliveryTable(row)} SET next_attempt_at = ?, last_error = ? WHERE id = ?`,
  )
    .bind(
      new Date(now.getTime() + delay * 1_000).toISOString(),
      message,
      row.delivery_id,
    )
    .run();
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
