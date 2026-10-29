import { InputError } from "./auth";
import { effectiveEnv } from "./config";
import { recipients, sha256, type Env } from "./types";

/** Send a held notice to the configured recipients, or dismiss it. */
export async function decideReview(
  env: Env,
  noticeId: string,
  action: "send" | "dismiss",
  now = new Date(),
) {
  const review = await env.DB.prepare(
    "SELECT notice_id, version_id, status FROM notice_reviews WHERE notice_id = ?",
  )
    .bind(noticeId)
    .first<{ notice_id: string; version_id: string; status: string }>();
  if (!review) throw new InputError("This notice is not waiting for review", 404);
  if (review.status !== "waiting")
    throw new InputError(
      `This notice was already ${review.status === "sent" ? "sent" : "dismissed"}. Refresh to see the latest list.`,
      409,
    );
  const stamp = now.toISOString();
  if (action === "dismiss") {
    await env.DB.prepare(
      "UPDATE notice_reviews SET status = 'dismissed', decided_at = ? WHERE notice_id = ? AND status = 'waiting'",
    )
      .bind(stamp, noticeId)
      .run();
    return { id: noticeId, status: "dismissed" as const, queued: 0 };
  }
  let to: string[];
  try {
    to = recipients(await effectiveEnv(env));
  } catch {
    throw new InputError("Add at least one recipient in Settings before sending this notice");
  }
  const rows = await Promise.all(
    to.map(async (recipient) => ({
      id: await sha256(`${review.version_id}:${recipient}`),
      version_id: review.version_id,
      recipient,
    })),
  );
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO outbox (id, version_id, recipient, created_at, next_attempt_at)
      SELECT json_extract(value, '$.id'), json_extract(value, '$.version_id'),
        json_extract(value, '$.recipient'), ?, ? FROM json_each(?)`,
    ).bind(stamp, stamp, JSON.stringify(rows)),
    env.DB.prepare(
      "UPDATE notice_reviews SET status = 'sent', decided_at = ? WHERE notice_id = ? AND status = 'waiting'",
    ).bind(stamp, noticeId),
  ]);
  return { id: noticeId, status: "sent" as const, queued: rows.length };
}
