import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { asD1, openDatabase } from "../../server/d1";
import { sendResponse, staticAssets, toRequest } from "../../server/http";
import { applyMigrations, importExport } from "../../server/migrate";
import { runCycle } from "../../src/monitor";
import { status } from "../../src/store";
import { listing, now, settings, site } from "../helpers";

const MIGRATIONS = join(import.meta.dirname, "../../migrations");
const migrated = () => {
  const sqlite = openDatabase(":memory:");
  applyMigrations(sqlite, MIGRATIONS);
  return sqlite;
};

describe("SQLite in place of D1", () => {
  it("returns rows, single values and change counts as D1 does", async () => {
    const db = asD1(migrated());
    await db.prepare("INSERT INTO notices (id, title, fingerprint, first_seen_at, last_seen_at) VALUES (?, ?, 'f', ?, ?)")
      .bind("1", "First", "2026-10-24", "2026-10-24").run();
    expect(await db.prepare("SELECT id, title FROM notices").first()).toEqual({ id: "1", title: "First" });
    expect(await db.prepare("SELECT title FROM notices WHERE id = ?").bind("1").first("title")).toBe("First");
    expect(await db.prepare("SELECT id FROM notices WHERE id = 'none'").first()).toBeNull();
    const update = await db.prepare("UPDATE notices SET title = ? WHERE id = ?").bind("Renamed", "1").run();
    expect(update.meta.changes).toBe(1);
    const missed = await db.prepare("UPDATE notices SET title = 'x' WHERE id = 'none'").run();
    expect(missed.meta.changes).toBe(0);
  });

  it("rolls back the whole batch when one statement fails", async () => {
    const db = asD1(migrated());
    const insert = (id: string) =>
      db.prepare("INSERT INTO notices (id, title, fingerprint, first_seen_at, last_seen_at) VALUES (?, 't', 'f', 'd', 'd')").bind(id);
    await expect(db.batch([insert("1"), insert("1")])).rejects.toThrow(/UNIQUE/);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM notices").first("n")).toBe(0);
  });

  it("enforces foreign keys, as D1 does", async () => {
    const db = asD1(migrated());
    await expect(
      db.prepare("INSERT INTO notice_versions (id, notice_id, kind, title, detected_at) VALUES ('v', 'missing', 'new', 't', 'd')").run(),
    ).rejects.toThrow(/FOREIGN KEY/);
  });

  it("rejects values D1 cannot store", async () => {
    const db = asD1(migrated());
    expect(() => db.prepare("SELECT ?").bind(undefined)).toThrow(/D1_TYPE_ERROR/);
    expect(await db.prepare("SELECT ? AS on_").bind(true).first("on_")).toBe(1);
  });
});

describe("migrations and import", () => {
  it("applies each migration once", () => {
    const sqlite = openDatabase(":memory:");
    expect(applyMigrations(sqlite, MIGRATIONS)).toHaveLength(11);
    expect(applyMigrations(sqlite, MIGRATIONS)).toEqual([]);
  });

  it("loads a Cloudflare D1 export with its history and runs on it", async () => {
    const sqlite = openDatabase(":memory:");
    importExport(sqlite, readFileSync(join(import.meta.dirname, "../fixtures/d1-export.sql"), "utf8"));
    expect(applyMigrations(sqlite, MIGRATIONS)).toEqual([]);
    const env = settings({ DB: asD1(sqlite) });
    expect((await status(env)).counts).toEqual({ notices: 1, removed: 0 });
    // The imported notice is known, so only the genuinely new one is emailed.
    const result = await runCycle(env, site(listing(["48", "49"])), now);
    expect(result).toMatchObject({ scan: { notifications: 1 } });
  });

  it("refuses to import over an existing database", () => {
    expect(() => importExport(migrated(), "SELECT 1")).toThrow(/not empty/);
  });
});

describe("HTTP behind Coolify's proxy", () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  async function serve(handler: (request: Request) => Promise<Response>) {
    server = createServer(async (incoming, outgoing) => sendResponse(await handler(toRequest(incoming)), outgoing));
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it("sees the public HTTPS address and the real client address", async () => {
    let seen: Request | undefined;
    const base = await serve(async (request) => ((seen = request), new Response("ok")));
    await fetch(`${base}/admin/status`, {
      headers: { "X-Forwarded-Proto": "https", "X-Real-Ip": "203.0.113.9", "CF-Connecting-IP": "198.51.100.1" },
    });
    expect(new URL(seen!.url).protocol).toBe("https:");
    expect(seen!.headers.get("cf-connecting-ip")).toBe("203.0.113.9");
  });

  it("passes request bodies through and keeps every cookie", async () => {
    const base = await serve(async (request) => {
      const headers = new Headers({ "Content-Type": "text/plain" });
      headers.append("Set-Cookie", "a=1; Path=/admin");
      headers.append("Set-Cookie", "b=2; Path=/admin");
      return new Response(await request.text(), { status: 201, headers });
    });
    const response = await fetch(`${base}/admin/settings`, { method: "PUT", body: "hello" });
    expect(response.status).toBe(201);
    expect(await response.text()).toBe("hello");
    expect(response.headers.getSetCookie()).toEqual(["a=1; Path=/admin", "b=2; Path=/admin"]);
  });

  it("serves the portal files and nothing outside them", async () => {
    const root = mkdtempSync(join(tmpdir(), "notivo-assets-"));
    mkdirSync(join(root, "dist/assets"), { recursive: true });
    writeFileSync(join(root, "dist/index.html"), "<h1>Notivo</h1>");
    writeFileSync(join(root, "dist/assets/app-1.js"), "console.log(1)");
    writeFileSync(join(root, "secret.txt"), "no");
    const assets = staticAssets(join(root, "dist"));
    const get = (path: string) => assets.fetch(new Request(`http://x${path}`));
    expect(await (await get("/")).text()).toBe("<h1>Notivo</h1>");
    expect((await get("/")).headers.get("Content-Type")).toContain("text/html");
    const script = await get("/assets/app-1.js");
    expect(script.headers.get("Cache-Control")).toContain("immutable");
    expect((await get("/missing")).status).toBe(404);
    expect((await get("/%2e%2e/secret.txt")).status).toBe(404);
  });
});
