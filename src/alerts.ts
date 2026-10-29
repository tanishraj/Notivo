import { WAITING_REVIEWS } from "./store";
import { RESEND_URL, sha256, type Env, type Fetcher } from "./types";

const OUTAGE_MS = 2 * 3_600_000;
const REMINDER_MS = 24 * 3_600_000;
const RETRY_MS = 15 * 60_000;

interface AlertState {
  baseline_completed_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
  admin_alerted_at: string | null;
  admin_alert_attempted_at: string | null;
  outage_alerted_at: string | null;
}
interface Listed {
  id: string;
  title: string;
  published_on: string | null;
  document_url?: string | null;
  reason?: string;
  created_at?: string;
}

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const line = (n: Listed) => `${n.title} (NMC ${n.id}, published ${n.published_on ?? "date not given"})`;

/** Email the admin when a notice is held for review, an older entry is recorded
 * without email, or NMC checks keep failing. Recipients never get these. */
export async function sendAdminAlerts(env: Env, fetcher: Fetcher, now: Date) {
  if (
    env.EMAIL_ENABLED !== "true" ||
    !env.RESEND_API_KEY ||
    !env.EMAIL_FROM?.trim() ||
    /[\r\n]/.test(env.EMAIL_FROM)
  )
    return { sent: false, reason: "Email sending is off" };
  const state = (await env.DB.prepare("SELECT * FROM monitor_state WHERE id = 1").first<AlertState>())!;
  if (!state.baseline_completed_at) return { sent: false, reason: "The archive import is still running" };
  const failedRecently =
    state.admin_alert_attempted_at &&
    state.admin_alert_attempted_at > (state.admin_alerted_at ?? "") &&
    now.getTime() - Date.parse(state.admin_alert_attempted_at) < RETRY_MS;
  if (failedRecently) return { sent: false, reason: "Waiting to retry the last admin alert" };
  const admin = await env.DB.prepare("SELECT email FROM auth_user LIMIT 1").first<{ email: string }>();
  if (!admin?.email) return { sent: false, reason: "No admin account to notify" };

  const since = state.admin_alerted_at ?? state.baseline_completed_at;
  const waiting = (
    await env.DB.prepare(`${WAITING_REVIEWS} ORDER BY r.created_at, r.notice_id LIMIT 50`).all<Listed>()
  ).results;
  const fresh = waiting.filter((r) => r.created_at! > since);
  const archived = (
    await env.DB.prepare(
      `SELECT id, title, published_on, document_url FROM notices n
      WHERE first_seen_at > ? AND first_seen_at > ?
        AND NOT EXISTS (SELECT 1 FROM notice_versions v WHERE v.notice_id = n.id)
      ORDER BY first_seen_at, id LIMIT 50`,
    )
      .bind(since, state.baseline_completed_at)
      .all<Listed>()
  ).results;
  const outage = Boolean(
    state.consecutive_failures > 0 &&
      state.last_success_at &&
      now.getTime() - Date.parse(state.last_success_at) >= OUTAGE_MS &&
      !state.outage_alerted_at,
  );
  const reminder =
    waiting.length > 0 &&
    !fresh.length &&
    (!state.admin_alerted_at || now.getTime() - Date.parse(state.admin_alerted_at) >= REMINDER_MS);
  if (!fresh.length && !archived.length && !outage && !reminder) return { sent: false, reason: "Nothing to report" };

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const subject = outage
    ? "Notivo: NMC checks have failed for over 2 hours"
    : fresh.length
      ? `Notivo: ${plural(waiting.length, "NMC entry needs", "NMC entries need")} your review`
      : reminder
        ? `Notivo reminder: ${plural(waiting.length, "NMC entry is", "NMC entries are")} waiting for your review`
        : `Notivo: ${plural(archived.length, "older NMC entry", "older NMC entries")} recorded without email`;
  const portal = env.PORTAL_URL?.trim();
  const sections: { heading: string; intro: string; items: Listed[]; reasons?: boolean }[] = [];
  if (outage)
    sections.push({
      heading: "NMC checks are failing",
      intro: `Notivo has not completed a check of the NMC website since ${state.last_success_at}. New notices are not being found until this is fixed. Last error: ${state.last_error ?? "not recorded"}.`,
      items: [],
    });
  if (waiting.length)
    sections.push({
      heading: "Waiting for your review",
      intro: "Notivo could not be sure these are new, so it has not emailed your recipients. Open Notivo and choose Send or Dismiss for each one.",
      items: waiting,
      reasons: true,
    });
  if (archived.length)
    sections.push({
      heading: "Recorded as archive, not emailed",
      intro: "These appeared on NMC with published dates more than 30 days old, so they were saved to notice history without an email. If one is actually new, send it from Notices in Notivo.",
      items: archived,
    });
  const text = [
    ...sections.flatMap((s) => [
      s.heading,
      s.intro,
      ...s.items.map((n) => `- ${line(n)}${s.reasons && n.reason ? `\n  ${n.reason}` : ""}${n.document_url ? `\n  ${n.document_url}` : ""}`),
      "",
    ]),
    portal ? `Open Notivo: ${portal}` : "",
  ].join("\n");
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0b1d38;font-size:14px;line-height:1.55;max-width:620px">
${sections
  .map(
    (s) => `<h2 style="font-size:16px;margin:20px 0 6px">${escape(s.heading)}</h2><p style="margin:0 0 10px;color:#3c4d63">${escape(s.intro)}</p>${
      s.items.length
        ? `<ul style="padding-left:18px;margin:0">${s.items
            .map(
              (n) =>
                `<li style="margin-bottom:8px">${n.document_url ? `<a href="${escape(n.document_url)}" style="color:#06285d">${escape(n.title)}</a>` : escape(n.title)}<br><span style="color:#657388;font-size:12px">NMC ${escape(n.id)} · published ${escape(n.published_on ?? "date not given")}${s.reasons && n.reason ? ` · ${escape(n.reason)}` : ""}</span></li>`,
            )
            .join("")}</ul>`
        : ""
    }`,
  )
  .join("")}${portal ? `<p style="margin-top:20px"><a href="${escape(portal)}" style="color:#06285d;font-weight:600">Open Notivo</a></p>` : ""}
<p style="color:#8592a4;font-size:12px;margin-top:24px">Only the Notivo admin receives this email.</p></div>`;

  const key = await sha256(
    JSON.stringify([fresh.map((r) => r.id), archived.map((r) => r.id), outage ? state.last_success_at : null, reminder ? now.toISOString().slice(0, 10) : null]),
  );
  await env.DB.prepare("UPDATE monitor_state SET admin_alert_attempted_at = ? WHERE id = 1")
    .bind(now.toISOString())
    .run();
  let response: Response;
  let body: { id?: string };
  try {
    response = await fetcher(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `nmc/admin/${key}`,
      },
      body: JSON.stringify({ from: env.EMAIL_FROM.trim(), to: [admin.email], subject, text, html }),
      signal: AbortSignal.timeout(15_000),
      redirect: "manual",
    });
    body = (await response.json()) as typeof body;
  } catch {
    return { sent: false, reason: "Resend did not respond; the admin alert will be retried" };
  }
  if (!response.ok || !body.id)
    return { sent: false, reason: `Resend HTTP ${response.status}; the admin alert will be retried` };
  await env.DB.prepare(
    `UPDATE monitor_state SET admin_alerted_at = ?,
      outage_alerted_at = CASE WHEN ? THEN ? ELSE outage_alerted_at END WHERE id = 1`,
  )
    .bind(now.toISOString(), outage ? 1 : 0, now.toISOString())
    .run();
  return { sent: true, subject };
}
