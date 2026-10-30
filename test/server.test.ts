import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sendResponse, staticAssets, toRequest } from "../server/http";
import { applyMigrations } from "../server/migrate";
import { Database, openDatabase } from "../src/db";
import { MIGRATIONS } from "./env";

const migrated = () => {
  const sqlite = openDatabase(":memory:");
  applyMigrations(sqlite, MIGRATIONS);
  return sqlite;
};

describe("database", () => {
  it("returns rows, single values and change counts", async () => {
    const db = new Database(migrated());
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
    const db = new Database(migrated());
    const insert = (id: string) =>
      db.prepare("INSERT INTO notices (id, title, fingerprint, first_seen_at, last_seen_at) VALUES (?, 't', 'f', 'd', 'd')").bind(id);
    await expect(db.batch([insert("1"), insert("1")])).rejects.toThrow(/UNIQUE/);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM notices").first("n")).toBe(0);
  });

  it("enforces foreign keys", async () => {
    const db = new Database(migrated());
    await expect(
      db.prepare("INSERT INTO notice_versions (id, notice_id, kind, title, detected_at) VALUES ('v', 'missing', 'new', 't', 'd')").run(),
    ).rejects.toThrow(/FOREIGN KEY/);
  });

  it("rejects values SQLite cannot store", async () => {
    const db = new Database(migrated());
    expect(() => db.prepare("SELECT ?").bind(undefined)).toThrow(/cannot be stored/);
    expect(await db.prepare("SELECT ? AS on_").bind(true).first("on_")).toBe(1);
  });
});

describe("migrations", () => {
  it("applies each migration once", () => {
    const sqlite = openDatabase(":memory:");
    expect(applyMigrations(sqlite, MIGRATIONS)).toHaveLength(11);
    expect(applyMigrations(sqlite, MIGRATIONS)).toEqual([]);
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
      headers: { "X-Forwarded-Proto": "https", "X-Real-Ip": "203.0.113.9", "X-Client-Ip": "198.51.100.1" },
    });
    expect(new URL(seen!.url).protocol).toBe("https:");
    expect(seen!.headers.get("x-client-ip")).toBe("203.0.113.9");
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
