import type { Env } from "./types";

export class QueryError extends Error {}

function pageOptions(url: URL) {
  const page = Number(url.searchParams.get("page") ?? 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100_000)
    throw new QueryError("Page must be an integer between 1 and 100000");
  const query = (url.searchParams.get("q") ?? "").trim();
  if (query.length > 200)
    throw new QueryError("Search must contain at most 200 characters");
  return { page, pageSize: 20, query, offset: (page - 1) * 20 };
}

function searchValue(query: string) {
  return `%${query.replace(/[\\%_]/g, "\\$&")}%`;
}

export async function noticeHistory(env: Env, url: URL) {
  const { page, pageSize, query, offset } = pageOptions(url);
  const kind = url.searchParams.get("kind") ?? "all";
  if (!["all", "new", "updated", "baseline"].includes(kind))
    throw new QueryError("Unknown notice filter");
  const latestKind = `(SELECT kind FROM notice_versions WHERE notice_id = n.id ORDER BY detected_at DESC, rowid DESC LIMIT 1)`;
  const where = `WHERE (n.title LIKE ? ESCAPE '\\' OR n.id LIKE ? ESCAPE '\\')${kind === "all" ? "" : kind === "baseline" ? ` AND ${latestKind} IS NULL` : ` AND ${latestKind} = ?`}`;
  const args = [
    searchValue(query),
    searchValue(query),
    ...(kind === "all" || kind === "baseline" ? [] : [kind]),
  ];
  const [total, rows] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS count FROM notices n ${where}`)
      .bind(...args)
      .first<{ count: number }>(),
    env.DB.prepare(
      `SELECT n.id, n.title, n.published_on, n.document_url, n.first_seen_at, n.last_seen_at,
      COALESCE(${latestKind}, 'baseline') AS kind,
      (SELECT COUNT(*) FROM notice_versions WHERE notice_id = n.id) AS version_count
      FROM notices n ${where} ORDER BY n.published_on DESC, n.first_seen_at DESC, n.id DESC LIMIT ? OFFSET ?`,
    )
      .bind(...args, pageSize, offset)
      .all(),
  ]);
  return { items: rows.results, total: total?.count ?? 0, page, pageSize };
}

export async function emailHistory(env: Env, url: URL) {
  const { page, pageSize, query, offset } = pageOptions(url);
  const status = url.searchParams.get("status") ?? "non_cancelled";
  if (
    ![
      "all",
      "non_cancelled",
      "pending",
      "accepted",
      "failed",
      "uncertain",
      "cancelled",
    ].includes(status)
  )
    throw new QueryError("Unknown email status");
  const where = `WHERE (title LIKE ? ESCAPE '\\' OR recipient LIKE ? ESCAPE '\\')${status === "all" ? "" : status === "non_cancelled" ? " AND status <> 'cancelled'" : " AND status = ?"}`;
  const args = [
    searchValue(query),
    searchValue(query),
    ...(status === "all" || status === "non_cancelled" ? [] : [status]),
  ];
  const [total, rows] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) AS count FROM email_deliveries ${where}`,
    )
      .bind(...args)
      .first<{ count: number }>(),
    env.DB.prepare(
      `SELECT delivery_id AS id, recipient, status, created_at, attempts, next_attempt_at,
      accepted_at, last_error, resend_id, notice_id, title, kind, document_url, delivery_source
      FROM email_deliveries ${where}
      ORDER BY created_at DESC, delivery_id DESC LIMIT ? OFFSET ?`,
    )
      .bind(...args, pageSize, offset)
      .all(),
  ]);
  return { items: rows.results, total: total?.count ?? 0, page, pageSize };
}

export async function runHistory(env: Env, url: URL) {
  const { page, pageSize, offset } = pageOptions(url);
  const [total, rows] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS count FROM runs").first<{
      count: number;
    }>(),
    env.DB.prepare("SELECT * FROM runs ORDER BY id DESC LIMIT ? OFFSET ?")
      .bind(pageSize, offset)
      .all(),
  ]);
  return { items: rows.results, total: total?.count ?? 0, page, pageSize };
}
