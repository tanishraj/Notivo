import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

/** Apply migrations/*.sql that are not yet recorded. The `d1_migrations` table
 * name dates from Cloudflare D1; existing databases record their history there. */
export function applyMigrations(db: DatabaseSync, dir: string) {
  db.exec(`CREATE TABLE IF NOT EXISTS d1_migrations(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`);
  const done = new Set(db.prepare("SELECT name FROM d1_migrations").all().map((row) => String(row.name)));
  const applied: string[] = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(name)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(readFileSync(join(dir, name), "utf8"));
      db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").run(name);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`Migration ${name} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    applied.push(name);
  }
  return applied;
}
