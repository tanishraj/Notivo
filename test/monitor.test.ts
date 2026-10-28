import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runCycle } from "../src/monitor";
import { acquireLease, getState, ingest } from "../src/store";
import { count, listing, migrate, now, reset, settings, site } from "./helpers";
import type { Fetcher } from "../src/types";

beforeAll(migrate);
beforeEach(reset);

describe("monitor state and outbox", () => {
  const withoutDocument = (html: string) =>
    html.replace(
      /<a class="wn-title-link" href="[^"]*">([^<]*)<\/a>/g,
      '<span class="wn-no-doc">$1</span>',
    );
  it("baselines historical notices without creating emails", async () => {
    const result = await runCycle(
      settings(),
      site(listing(["1880", "48"])),
      now,
    );
    expect(result).toMatchObject({
      scan: { mode: "baseline", baselineComplete: true, notifications: 0 },
    });
    expect(await count("notices")).toBe(2);
    expect(await count("outbox")).toBe(0);
    expect((await getState(env.DB)).baseline_completed_at).toBe(
      now.toISOString(),
    );
  });

  it("resumes a multi-page baseline without notifying the archive", async () => {
    const ids = Array.from({ length: 20 }, (_, i) => String(i + 1));
    const config = settings({ BASELINE_PAGES_PER_RUN: "1" });
    await runCycle(config, site(listing(ids, { total: 21 })), now);
    expect((await getState(env.DB)).baseline_next_page).toBe(2);
    expect((await getState(env.DB)).baseline_completed_at).toBeNull();
    await runCycle(config, site(listing(["21"], { page: 2, total: 21 })), now);
    expect(await count("notices")).toBe(21);
    expect(await count("outbox")).toBe(0);
    expect((await getState(env.DB)).baseline_completed_at).not.toBeNull();
  });

  it("queues same-date notices even when the new numeric ID is lower", async () => {
    const config = settings({
      EMAIL_TO: "first@example.com,second@example.com, FIRST@example.com",
    });
    await runCycle(config, site(listing(["1880"])), now);
    await runCycle(config, site(listing(["1880", "48"])), now);
    expect(await count("notice_versions")).toBe(1);
    expect(await count("outbox")).toBe(2);
    const version = await env.DB.prepare(
      "SELECT kind, notice_id FROM notice_versions",
    ).first();
    expect(version).toEqual({ kind: "new", notice_id: "48" });
  });

  it("does not queue duplicates on repeated scans or a New badge change", async () => {
    const config = settings();
    await runCycle(config, site(listing(["1"])), now);
    await runCycle(config, site(listing(["1", "2"])), now);
    await runCycle(
      config,
      site(listing(["1", "2"]).replaceAll(">New<", ">Old<")),
      now,
    );
    expect(await count("notice_versions")).toBe(1);
    expect(await count("outbox")).toBe(1);
  });

  it("records updated listing titles without emailing them as new announcements", async () => {
    const config = settings();
    await runCycle(config, site(listing(["1"])), now);
    const changed = site(
      listing(["1"], { title: "Revised notice &amp; deadline" }),
    );
    await runCycle(config, changed, now);
    await runCycle(config, changed, now);
    expect(await count("outbox")).toBe(0);
    expect(
      await env.DB.prepare("SELECT kind, title FROM notice_versions").first(),
    ).toEqual({ kind: "updated", title: "Revised notice & deadline" });
  });

  it("does not suppress distinct new IDs when multiple linked rows match one fallback", async () => {
    const config = settings();
    await runCycle(
      config,
      site(withoutDocument(listing(["1"], { title: "Shared title" }))),
      now,
      false,
      true,
    );
    await runCycle(
      config,
      site(listing(["1", "2"], { title: "Shared title" })),
      new Date(now.getTime() + 1000),
      false,
      true,
    );
    expect(await count("notices")).toBe(3);
    expect(await count("outbox")).toBe(2);
    const kinds = await env.DB.prepare("SELECT kind FROM notice_versions").all<{
      kind: string;
    }>();
    expect(kinds.results.every((row) => row.kind === "new")).toBe(true);
  });

  it("considers stored linked rows outside the current scan before matching a fallback", async () => {
    const config = settings();
    const initial = listing(["1", "2"], { title: "Shared title" }).replace(
      /<a class="wn-title-link" href="[^"]*">([^<]*)<\/a>/,
      '<span class="wn-no-doc">$1</span>',
    );
    await runCycle(config, site(initial), now, false, true);
    await runCycle(
      config,
      site(listing(["3"], { title: "Shared title" })),
      new Date(now.getTime() + 1000),
      false,
      true,
    );
    expect(await count("notices")).toBe(3);
    expect(await count("outbox")).toBe(1);
    expect(
      await env.DB.prepare(
        "SELECT notice_id, kind FROM notice_versions",
      ).first(),
    ).toMatchObject({ notice_id: "3", kind: "new" });
  });

  it("preserves a baseline notice when its document link becomes available", async () => {
    const config = settings();
    const html = listing(["363"], {
      title: "Existing historical announcement",
    });
    await runCycle(config, site(withoutDocument(html)), now, false, true);
    const first = await env.DB.prepare(
      "SELECT first_seen_at FROM notices",
    ).first<{ first_seen_at: string }>();
    await runCycle(
      config,
      site(html),
      new Date(now.getTime() + 1000),
      false,
      true,
    );
    expect(await count("notices")).toBe(1);
    expect(await count("outbox")).toBe(0);
    expect(
      await env.DB.prepare(
        "SELECT id, first_seen_at, document_url FROM notices",
      ).first(),
    ).toMatchObject({
      id: "363",
      first_seen_at: first?.first_seen_at,
      document_url: "https://nmc.org.in/whats-new/download/363",
    });
    await runCycle(
      config,
      site(withoutDocument(html)),
      new Date(now.getTime() + 2000),
      false,
      true,
    );
    await runCycle(
      config,
      site(html),
      new Date(now.getTime() + 3000),
      false,
      true,
    );
    expect(await count("notices")).toBe(1);
    expect(await count("outbox")).toBe(0);
  });

  it("still alerts for a genuinely new unlinked entry, once, when a file is later added", async () => {
    const config = settings();
    await runCycle(config, site(listing(["1"])), now, false, true);
    const html = listing(["2"]);
    await runCycle(
      config,
      site(withoutDocument(html)),
      new Date(now.getTime() + 1000),
      false,
      true,
    );
    expect(await count("outbox")).toBe(1);
    await runCycle(
      config,
      site(html),
      new Date(now.getTime() + 2000),
      false,
      true,
    );
    expect(await count("outbox")).toBe(1);
    expect(await count("notices")).toBe(2);
    expect(
      await env.DB.prepare(
        "SELECT notice_id FROM notice_versions WHERE kind = ?",
      )
        .bind("new")
        .first(),
    ).toMatchObject({ notice_id: "2" });
  });

  it("leaves baseline progress untouched after a bad page and records the failure", async () => {
    const ids = Array.from({ length: 20 }, (_, i) => String(i + 1));
    const fetcher: Fetcher = async (input) =>
      new Response(
        new URL(String(input)).searchParams.get("page") === "2"
          ? "<h1>Maintenance</h1>"
          : listing(ids, { total: 21 }),
        { headers: { "Content-Type": "text/html" } },
      );
    await runCycle(settings(), fetcher, now);
    expect(await count("notices")).toBe(0);
    const state = await getState(env.DB);
    expect(state.baseline_next_page).toBe(1);
    expect(state.consecutive_failures).toBe(1);
    expect(state.last_success_at).toBeNull();
  });

  it("rolls notice and outbox writes back if the transaction fails", async () => {
    const bad = env.DB.prepare("UPDATE missing_table SET value = 1");
    await expect(
      ingest(
        settings(),
        [
          {
            id: "1",
            title: "Test",
            documentUrl: "https://nmc.org.in/whats-new/download/1",
            publishedOn: null,
          },
        ],
        false,
        now,
        bad,
      ),
    ).rejects.toThrow();
    expect(await count("notices")).toBe(0);
    expect(await count("outbox")).toBe(0);
  });

  it("does not consume new notices until recipients are configured", async () => {
    await runCycle(settings(), site(listing(["1"])), now);
    await runCycle(settings({ EMAIL_TO: "" }), site(listing(["1", "2"])), now);
    expect(await count("notices")).toBe(1);
    expect((await getState(env.DB)).last_error).toContain("EMAIL_TO");
  });

  it("skips overlapping runs and recovers after a stale lease expires", async () => {
    expect(await acquireLease(env.DB, "other-worker", now)).toBe(true);
    const fetcher: Fetcher = async () => {
      throw new Error("Should not fetch");
    };
    expect(await runCycle(settings(), fetcher, now)).toMatchObject({
      skipped: true,
    });
    expect(
      await acquireLease(
        env.DB,
        "replacement",
        new Date(now.getTime() + 601_000),
      ),
    ).toBe(true);
  });

  it("finds a backdated notice beyond recent pages during a rolling audit", async () => {
    const ids = Array.from({ length: 20 }, (_, i) => String(i + 1));
    const config = settings({ RECENT_PAGES: "1" });
    const fetcher: Fetcher = async (input) =>
      new Response(
        new URL(String(input)).searchParams.get("page") === "2"
          ? listing(["21"], { page: 2, total: 21 })
          : listing(ids, { total: 21 }),
        { headers: { "Content-Type": "text/html" } },
      );
    await runCycle(config, fetcher, now);
    await env.DB.prepare("DELETE FROM notices WHERE id = '21'").run();
    await runCycle(config, fetcher, now);
    expect(await count("outbox")).toBe(1);
    expect((await getState(env.DB)).audit_due_at).not.toBeNull();
  });

  it("records re-listed archive entries without emailing old announcements", async () => {
    const config = settings();
    await runCycle(config, site(listing(["885"])), now);
    const old: [string, string, string] = ["17", "Sep", "2025"];
    const result = await runCycle(
      config,
      site(listing(["885", "399"], { date: old })),
      now,
    );
    expect(result).toMatchObject({ scan: { notifications: 0 } });
    expect(
      await env.DB.prepare(
        "SELECT kind FROM notice_versions WHERE notice_id = '399'",
      ).first(),
    ).toEqual({ kind: "new" });
    expect(
      (await env.DB.prepare("SELECT status, last_error FROM outbox").all())
        .results,
    ).toEqual([
      {
        status: "cancelled",
        last_error:
          "Published more than 30 days ago. Archive entries are recorded but not emailed.",
      },
    ]);
    // Entries without a readable date still notify: their age is unknown.
    const undated = await runCycle(
      config,
      site(listing(["885", "399", "1882"], { date: ["", "", ""] })),
      now,
    );
    expect(undated).toMatchObject({ scan: { notifications: 1 } });
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS count FROM outbox WHERE status = 'pending'",
        ).first<{ count: number }>()
      )?.count,
    ).toBe(1);
    // A longer window re-enables the alert for older publication dates.
    await env.DB.batch([
      env.DB.prepare("DELETE FROM outbox"),
      env.DB.prepare("DELETE FROM notice_versions WHERE notice_id = '399'"),
      env.DB.prepare("DELETE FROM notices WHERE id = '399'"),
    ]);
    await runCycle(
      settings({ NOTIFY_MAX_AGE_DAYS: "500" }),
      site(listing(["885", "399"], { date: old })),
      now,
    );
    expect(
      await env.DB.prepare("SELECT status FROM outbox").first(),
    ).toEqual({ status: "pending" });
  });
});
