// Stands in for "cloudflare:test" when the suite runs in Node, so every test
// also exercises the self-hosted database and HTML parser.
import { asD1, openDatabase } from "../../server/d1";
import type { Env } from "../../src/types";

const sqlite = openDatabase(":memory:");

/** The vars from wrangler.jsonc, as the Workers test pool provides them. */
export const env = {
  EMAIL_ENABLED: "false",
  RECENT_PAGES: "3",
  BASELINE_PAGES_PER_RUN: "3",
  AUDIT_PAGES_PER_RUN: "2",
  EMAILS_PER_RUN: "5",
  DB: asD1(sqlite),
} satisfies Env;

export async function applyD1Migrations(db: D1Database, migrations: { name: string; queries: string[] }[]) {
  await db.exec("CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)");
  const done = new Set((await db.prepare("SELECT name FROM d1_migrations").all<{ name: string }>()).results.map((r) => r.name));
  for (const migration of migrations.filter((m) => !done.has(m.name)))
    await db.batch([
      ...migration.queries.map((query) => db.prepare(query)),
      db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").bind(migration.name),
    ]);
}
