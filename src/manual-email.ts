import { InputError } from "./auth";
import { effectiveEnv, settingsView } from "./config";
import { renderEmail, sendPending } from "./email";
import { acquireLease, releaseLease } from "./store";
import { recipients, sha256, type Env, type Fetcher, type Version } from "./types";

interface StoredNotice {
  id: string;
  title: string;
  published_on: string | null;
  document_url: string | null;
  fingerprint: string;
}

export async function manualEmailReview(env: Env, noticeId: string) {
  const [notice, config] = await Promise.all([
    env.DB.prepare("SELECT id, title, published_on, document_url, fingerprint FROM notices WHERE id = ?")
      .bind(noticeId).first<StoredNotice>(),
    settingsView(env),
  ]);
  if (!notice) throw new InputError("Notice not found", 404);
  const to = recipients({ ...env, ...config.values });
  const history = await env.DB.prepare(
    `SELECT recipient, status, COUNT(*) AS count FROM email_deliveries
     WHERE notice_id = ? AND recipient IN (SELECT value FROM json_each(?))
     AND status IN ('pending', 'accepted', 'uncertain') GROUP BY recipient, status`,
  ).bind(noticeId, JSON.stringify(to)).all<{ recipient: string; status: string; count: number }>();
  return {
    notice,
    sender: config.values.EMAIL_FROM,
    recipients: to,
    settingsRevision: config.revision,
    enabled: config.values.EMAIL_ENABLED === "true" && config.resendConfigured,
    limit: Number(config.values.EMAILS_PER_RUN),
    history: history.results,
  };
}

export async function sendNoticeManually(
  env: Env,
  noticeId: string,
  requestId: string,
  body: Record<string, unknown>,
  fetcher: Fetcher = fetch,
  now = new Date(),
) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestId))
    throw new InputError("Provide a UUID Idempotency-Key for this manual send");
  const owner = crypto.randomUUID();
  if (!(await acquireLease(env.DB, owner, now)))
    throw new InputError("Another cycle is running. Refresh before trying again.", 409);
  try {
    const configured = await effectiveEnv(env);
    if (configured.EMAIL_ENABLED !== "true" || !configured.RESEND_API_KEY)
      throw new InputError("Enable email sending and configure Resend before sending a notice");
    const previous = await env.DB.prepare("SELECT notice_id FROM manual_email_requests WHERE id = ?")
      .bind(requestId).first<{ notice_id: string }>();
    if (previous && previous.notice_id !== noticeId)
      throw new InputError("This request key belongs to a different notice", 409);
    let queued = 0;
    let existingPending = 0;
    if (!previous) {
      const review = await manualEmailReview(env, noticeId);
      if (body.settingsRevision !== review.settingsRevision || body.fingerprint !== review.notice.fingerprint)
        throw new InputError("The notice or settings changed. Close and reopen the review before sending.", 409);
      const pending = new Set(review.history.filter((row) => row.status === "pending").map((row) => row.recipient));
      const targets = review.recipients.filter((recipient) => !pending.has(recipient));
      const risky = review.history.some((row) => targets.includes(row.recipient) && ["accepted", "uncertain"].includes(row.status));
      if (risky && body.allowDuplicate !== true)
        throw new InputError("This notice was already accepted or has an uncertain delivery. Review Resend and acknowledge the duplicate risk.", 409);
      existingPending = pending.size;
      const stamp = now.toISOString();
      const version: Version = {
        ...review.notice, notice_id: noticeId, kind: "new", detected_at: stamp,
      };
      const deliveries = await Promise.all(targets.map(async (recipient) => ({
        id: await sha256(`manual/${requestId}/${recipient}`),
        recipient,
        payload: JSON.stringify(renderEmail(version, recipient, review.sender, { manual: true })),
      })));
      await env.DB.batch([
        env.DB.prepare("INSERT INTO manual_email_requests (id, notice_id, settings_revision, fingerprint, created_at) VALUES (?, ?, ?, ?, ?)")
          .bind(requestId, noticeId, review.settingsRevision, review.notice.fingerprint, stamp),
        ...deliveries.map((delivery) => env.DB.prepare(
          `INSERT INTO manual_deliveries
           (id, request_id, notice_id, title, published_on, document_url, recipient, payload_json, created_at, next_attempt_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(delivery.id, requestId, noticeId, review.notice.title, review.notice.published_on,
          review.notice.document_url, delivery.recipient, delivery.payload, stamp, stamp)),
      ]);
      queued = deliveries.length;
    }
    const emails = await sendPending(configured, fetcher, now, requestId);
    const remaining = await env.DB.prepare("SELECT COUNT(*) AS count FROM manual_deliveries WHERE request_id = ? AND status = 'pending'")
      .bind(requestId).first<{ count: number }>();
    await env.DB.prepare("INSERT INTO runs (started_at, completed_at, mode, pages, notices, notifications, error) VALUES (?, ?, 'manual_send', 0, 1, ?, NULL)")
      .bind(now.toISOString(), new Date().toISOString(), queued).run();
    return { requestId, queued, existingPending, remaining: remaining?.count ?? 0, emails };
  } finally {
    await releaseLease(env.DB, owner);
  }
}

/** Explicit retries create a fresh audited attempt with the current sender and
 * original recipient. They never overwrite a failed attempt's frozen payload. */
export async function retryFailedEmail(
  env: Env, source: string, deliveryId: string, requestId: string,
  fetcher: Fetcher = fetch, now = new Date(),
) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestId))
    throw new InputError("Provide a UUID Idempotency-Key for this retry");
  const owner = crypto.randomUUID();
  if (!(await acquireLease(env.DB, owner, now)))
    throw new InputError("Another cycle is running. Refresh before retrying.", 409);
  try {
    const configured = await effectiveEnv(env);
    if (configured.EMAIL_ENABLED !== "true" || !configured.RESEND_API_KEY)
      throw new InputError("Enable email sending and configure Resend before retrying");
    if (!configured.EMAIL_FROM?.trim() || /[\r\n]/.test(configured.EMAIL_FROM))
      throw new InputError("Configure a verified sender before retrying");
    const previous = await env.DB.prepare("SELECT delivery_source, delivery_id FROM email_retries WHERE request_id = ?")
      .bind(requestId).first<{ delivery_source: string; delivery_id: string }>();
    if (previous && (previous.delivery_source !== source || previous.delivery_id !== deliveryId))
      throw new InputError("This retry key belongs to another attempt", 409);
    let queued = 0;
    if (!previous) {
      const original = await env.DB.prepare("SELECT * FROM email_activity_current WHERE delivery_source = ? AND delivery_id = ?")
        .bind(source, deliveryId).first<Version & { recipient: string; status: string; resolved: number; retried: number; retry_pending: number; last_error: string | null }>();
      if (!original) throw new InputError("Email attempt not found", 404);
      if (original.status !== "failed") throw new InputError("Only confirmed failed attempts can be retried. Review uncertain outcomes in Resend first.");
      if (original.last_error?.includes("HTTP 409")) throw new InputError("Review this idempotency conflict in Resend before sending another copy.");
      if (original.resolved) throw new InputError("A later email was already accepted for this notice and recipient", 409);
      if (original.retried) throw new InputError("This attempt already has a retry. Review the latest attempt in Email activity.", 409);
      if (original.retry_pending) throw new InputError("An email for this notice and recipient is already pending", 409);
      if (await env.DB.prepare("SELECT 1 FROM manual_email_requests WHERE id = ?").bind(requestId).first())
        throw new InputError("This request key was already used for another manual action", 409);
      const review = await settingsView(env);
      const stamp = now.toISOString();
      const id = await sha256(`manual/${requestId}/${original.recipient}`);
      const fingerprint = await sha256(JSON.stringify([original.title, original.published_on, original.document_url]));
      const payload = renderEmail(original, original.recipient, configured.EMAIL_FROM!, { manual: true });
      await env.DB.batch([
        env.DB.prepare("INSERT INTO manual_email_requests (id, notice_id, settings_revision, fingerprint, created_at) VALUES (?, ?, ?, ?, ?)")
          .bind(requestId, original.notice_id, review.revision, fingerprint, stamp),
        env.DB.prepare("INSERT INTO email_retries (request_id, delivery_source, delivery_id) VALUES (?, ?, ?)")
          .bind(requestId, source, deliveryId),
        env.DB.prepare(`INSERT INTO manual_deliveries (id, request_id, notice_id, title, published_on, document_url, recipient, payload_json, created_at, next_attempt_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(id, requestId, original.notice_id, original.title, original.published_on, original.document_url,
            original.recipient, JSON.stringify(payload), stamp, stamp),
      ]);
      queued = 1;
    }
    const emails = await sendPending(configured, fetcher, now, requestId);
    const attempt = await env.DB.prepare("SELECT status FROM manual_deliveries WHERE request_id = ?")
      .bind(requestId).first<{ status: string }>();
    return { requestId, queued, emails, deliveryStatus: attempt?.status };
  } finally {
    await releaseLease(env.DB, owner);
  }
}
