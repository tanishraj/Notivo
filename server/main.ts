import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { Database, openDatabase } from "../src/db";
import app from "../src/index";
import type { Env } from "../src/types";
import { sendResponse, staticAssets, toRequest } from "./http";
import { applyMigrations } from "./migrate";

/** Used when the environment does not set them. */
const DEFAULTS = {
  EMAIL_ENABLED: "false",
  RECENT_PAGES: "3",
  BASELINE_PAGES_PER_RUN: "3",
  AUDIT_PAGES_PER_RUN: "2",
  EMAILS_PER_RUN: "5",
};
const KEYS = [
  "ADMIN_TOKEN", "BETTER_AUTH_SECRET", "SETTINGS_ENCRYPTION_KEY", "MONITOR_ENABLED",
  "CHECK_INTERVAL_MINUTES", "EMAIL_ENABLED", "EMAIL_TO", "EMAIL_FROM", "RESEND_API_KEY",
  "RECENT_PAGES", "BASELINE_PAGES_PER_RUN", "AUDIT_PAGES_PER_RUN", "EMAILS_PER_RUN",
  "NOTIFY_MAX_AGE_DAYS", "NEW_ENTRIES_PER_CHECK_LIMIT", "PORTAL_URL",
] as const;

const root = resolve(process.env.APP_DIR ?? process.cwd());
const dbPath = resolve(process.env.DB_PATH ?? "data/notivo.db");
const log = (event: string, fields: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ event, ...fields }));

mkdirSync(dirname(dbPath), { recursive: true });
const sqlite = openDatabase(dbPath);
const applied = applyMigrations(sqlite, join(root, "migrations"));
if (applied.length) log("migrations_applied", { applied });

const env: Env = {
  ...DEFAULTS,
  ...Object.fromEntries(KEYS.flatMap((key) => (process.env[key] ? [[key, process.env[key]]] : []))),
  DB: new Database(sqlite),
  ASSETS: staticAssets(join(root, "portal/dist")),
};

const server = createServer(async (incoming, outgoing) => {
  try {
    await sendResponse(await app.fetch(toRequest(incoming), env), outgoing);
  } catch (error) {
    log("http_error", { message: error instanceof Error ? error.message : String(error) });
    if (!outgoing.headersSent) outgoing.writeHead(500, { "Content-Type": "application/json" });
    outgoing.end(JSON.stringify({ error: "Operation failed; inspect the server logs" }));
  }
});
const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => log("server_started", { port, database: dbPath }));

// Wake every minute; the monitor itself decides when a check or send is due.
let running: Promise<void> | null = null;
const tick = () => {
  if (running) return;
  running = app
    .scheduled(env)
    .catch((error: unknown) => log("scheduled_error", { message: error instanceof Error ? error.message : String(error) }))
    .finally(() => (running = null));
};
const timer = setInterval(tick, 60_000);
setTimeout(tick, 5_000);

const stop = async () => {
  clearInterval(timer);
  server.close();
  await running;
  sqlite.close();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
