import type { Env, Fetcher } from "./types";

/** Paging can hide a listed row for days, so "not seen" alone never means removed. */
const UNSEEN_MS = 3 * 86_400_000;
const RECHECK_MS = 86_400_000;
const CHECKS_PER_RUN = 3;

/** Mark notices NMC has deleted: not seen for 3 days and the PDF link returns
 * "not found". The notice stays in history and is un-marked if it reappears. */
export async function checkRemovals(env: Env, fetcher: Fetcher, now: Date) {
  const unseenBefore = new Date(now.getTime() - UNSEEN_MS).toISOString();
  const checkedBefore = new Date(now.getTime() - RECHECK_MS).toISOString();
  const candidates = (
    await env.DB.prepare(
      `SELECT id, document_url FROM notices
      WHERE removed_at IS NULL AND document_url IS NOT NULL AND last_seen_at < ?
        AND (removal_checked_at IS NULL OR removal_checked_at < ?)
      ORDER BY last_seen_at, id LIMIT ?`,
    )
      .bind(unseenBefore, checkedBefore, CHECKS_PER_RUN)
      .all<{ id: string; document_url: string }>()
  ).results;
  if (!candidates.length) return { checked: 0, removed: 0 };
  const removed: string[] = [];
  for (const notice of candidates) {
    try {
      const response = await fetcher(notice.document_url, {
        method: "HEAD",
        headers: { "User-Agent": "NMCNoticeMonitor/0.1" },
        signal: AbortSignal.timeout(15_000),
        redirect: "manual",
      });
      await response.body?.cancel();
      if (response.status === 404 || response.status === 410) removed.push(notice.id);
    } catch {
      // Unreachable is not removed. Check again tomorrow.
    }
  }
  const stamp = now.toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE notices SET removal_checked_at = ? WHERE id IN (SELECT value FROM json_each(?))",
    ).bind(stamp, JSON.stringify(candidates.map((c) => c.id))),
    env.DB.prepare(
      "UPDATE notices SET removed_at = ? WHERE id IN (SELECT value FROM json_each(?))",
    ).bind(stamp, JSON.stringify(removed)),
  ]);
  if (removed.length) console.log(JSON.stringify({ event: "notices_removed_by_nmc", ids: removed }));
  return { checked: candidates.length, removed: removed.length };
}
