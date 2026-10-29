import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { runCycle } from "../src/monitor";
import { listing, migrate, now, reset, settings, site } from "./helpers";

beforeAll(migrate);
beforeEach(reset);

const origin = "https://monitor.example";
function request(path: string, init: RequestInit = {}) {
  return new Request(`${origin}/admin/${path}`, init);
}
function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe("portal history", () => {
  it("protects every history endpoint", async () => {
    for (const path of ["notices", "emails", "runs"])
      expect((await worker.fetch(request(path), settings())).status).toBe(401);
  });

  it("paginates and searches real notices, distinguishing archive imports and updates", async () => {
    const config = settings();
    const headers = bearer(config.ADMIN_TOKEN!);
    await runCycle(
      config,
      async (input, init) => {
        const url = new URL(
          typeof input === "string"
            ? input
            : input instanceof Request
              ? input.url
              : input.toString(),
        );
        const page = Number(url.searchParams.get("page") ?? 1);
        const ids =
          page === 1
            ? Array.from({ length: 20 }, (_, i) => String(i + 1))
            : ["21", "22", "23", "24", "25"];
        return site(listing(ids, { page, total: 25 }))(input, init);
      },
      now,
    );
    const first = await worker.fetch(request("notices", { headers }), config);
    const data = (await first.json()) as {
      total: number;
      items: { kind: string }[];
    };
    expect(data.total).toBe(25);
    expect(data.items).toHaveLength(20);
    expect(data.items[0]?.kind).toBe("baseline");
    expect(first.headers.get("Cache-Control")).toBe("no-store");
    const second = await worker.fetch(
      request("notices?page=2", { headers }),
      config,
    );
    const secondPage = (await second.json()) as {
      page: number;
      total: number;
      items: { id: string }[];
    };
    expect(secondPage).toMatchObject({ page: 2, total: 25 });
    expect(secondPage.items).toHaveLength(5);
    const matches = await worker.fetch(
      request("notices?q=Notice%2025", { headers }),
      config,
    );
    expect(await matches.json()).toMatchObject({
      total: 1,
      items: [{ id: "25", kind: "baseline" }],
    });
    await runCycle(
      config,
      site(listing(["25"], { title: "Revised notice title" })),
      now,
    );
    const updated = await worker.fetch(
      request("notices?kind=updated", { headers }),
      config,
    );
    expect(await updated.json()).toMatchObject({
      total: 1,
      items: [{ id: "25", kind: "updated", version_count: 1 }],
    });
    const literalWildcard = await worker.fetch(
      request("notices?q=%25", { headers }),
      config,
    );
    expect(await literalWildcard.json()).toMatchObject({ total: 0 });
  });

  it("returns email status and run history without exposing payloads or secrets", async () => {
    const config = settings();
    const headers = bearer(config.ADMIN_TOKEN!);
    await runCycle(config, site(listing(["1"])), now);
    await runCycle(config, site(listing(["2"])), now);
    const emails = await worker.fetch(
      request("emails?status=pending", { headers }),
      config,
    );
    const data = (await emails.json()) as {
      total: number;
      items: Record<string, unknown>[];
    };
    expect(data.total).toBe(1);
    expect(data.items[0]).toMatchObject({
      status: "pending",
      recipient: "reader@example.com",
      notice_id: "2",
    });
    expect(data.items[0]).not.toHaveProperty("payload_json");
    const runs = await worker.fetch(request("runs", { headers }), config);
    expect(await runs.json()).toMatchObject({
      total: 2,
      page: 1,
      items: expect.any(Array),
    });
    for (const path of [
      "notices?page=0",
      "notices?page=1.5",
      "notices?kind=bad",
      "emails?status=bad",
      "notices?q=" + "x".repeat(201),
    ]) {
      expect(
        (await worker.fetch(request(path, { headers }), config)).status,
      ).toBe(400);
    }
  });

  it("hides cancelled alerts by default before pagination and keeps their history available", async () => {
    const config = settings({ NEW_ENTRIES_PER_CHECK_LIMIT: "50" });
    const headers = bearer(config.ADMIN_TOKEN!);
    await runCycle(config, site(listing(["1"])), now, false, true);
    await runCycle(
      config,
      site(listing(Array.from({ length: 20 }, (_, i) => String(i + 2)))),
      new Date(now.getTime() + 1000),
      false,
      true,
    );
    await runCycle(
      config,
      site(listing(["22", "23", "24", "25"])),
      new Date(now.getTime() + 2000),
      false,
      true,
    );
    await config.DB.prepare(`UPDATE outbox SET status = CASE
      (SELECT notice_id FROM notice_versions WHERE id = outbox.version_id)
      WHEN '3' THEN 'accepted' WHEN '4' THEN 'failed' WHEN '5' THEN 'uncertain'
      WHEN '24' THEN 'cancelled' WHEN '25' THEN 'cancelled' ELSE 'pending' END`).run();

    const get = async (path: string) => {
      const response = await worker.fetch(request(path, { headers }), config);
      expect(response.status).toBe(200);
      return response.json() as Promise<{
        total: number;
        items: { status: string; notice_id: string }[];
      }>;
    };
    for (const path of ["emails", "emails?status=non_cancelled"]) {
      const first = await get(path);
      expect(first.total).toBe(22);
      expect(first.items).toHaveLength(20);
      expect(first.items.every((item) => item.status !== "cancelled")).toBe(true);
    }
    const second = await get("emails?page=2");
    expect(second.total).toBe(22);
    expect(second.items).toHaveLength(2);
    expect(second.items.every((item) => item.status !== "cancelled")).toBe(true);
    expect((await get("emails?status=all")).total).toBe(24);
    const cancelled = await get("emails?status=cancelled");
    expect(cancelled.total).toBe(2);
    expect(cancelled.items.map((item) => item.notice_id).sort()).toEqual(["24", "25"]);
    expect((await get("emails?q=Notice%2024")).total).toBe(0);
    expect((await get("emails?status=cancelled&q=Notice%2024")).total).toBe(1);
    for (const status of ["pending", "accepted", "failed", "uncertain"]) {
      const filtered = await get(`emails?status=${status}`);
      expect(filtered.total).toBeGreaterThan(0);
      expect(filtered.items.every((item) => item.status === status)).toBe(true);
    }
  });

  it("a scan-only cycle queues changes but never calls Resend even when sending is enabled", async () => {
    const config = settings({
      EMAIL_ENABLED: "true",
      RESEND_API_KEY: "re_fake",
    });
    await runCycle(config, site(listing(["1"])), now, false, true);
    const fetcher = vi.fn(site(listing(["2"])));
    vi.stubGlobal("fetch", fetcher);
    try {
      const response = await worker.fetch(
        request("check", {
          method: "POST",
          headers: bearer(config.ADMIN_TOKEN!),
        }),
        config,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        scan: { notifications: 1 },
        emails: { skipped: true },
      });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("nmc.org.in");
    const pending = await config.DB.prepare(
      "SELECT status, attempts FROM outbox",
    ).first();
    expect(pending).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("serves the portal shell with security headers while keeping API routes protected", async () => {
    const assets = vi.fn(
      async () =>
        new Response("<html>Notivo</html>", {
          headers: { "Content-Type": "text/html" },
        }),
    );
    const config = settings({ ASSETS: { fetch: assets } });
    const shell = await worker.fetch(new Request(origin), config);
    expect(shell.status).toBe(200);
    expect(shell.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(shell.headers.get("Cache-Control")).toBe("no-store");
    expect((await worker.fetch(request("notices"), config)).status).toBe(401);
    expect(assets).toHaveBeenCalledTimes(1);
  });
});
