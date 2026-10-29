import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runCycle } from "../src/monitor";
import { decideReview } from "../src/reviews";
import { status } from "../src/store";
import type { Fetcher } from "../src/types";
import { count, listing, migrate, now, reset, settings, site } from "./helpers";

beforeAll(migrate);
beforeEach(reset);

type Date3 = [string, string, string];
const daysAgo = (n: number): Date3 => {
  const d = new Date(Date.UTC(2026, 9, 24 - n));
  return [String(d.getUTCDate()).padStart(2, "0"), d.toLocaleString("en", { month: "short", timeZone: "UTC" }), String(d.getUTCFullYear())];
};
const later = (hours: number) => new Date(now.getTime() + hours * 3_600_000);
const pending = async () =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM outbox WHERE status = 'pending'").first<{ n: number }>())!.n;
const waiting = async () => (await status(settings())).reviews as { id: string; reason: string }[];

describe("new notice rules", () => {
  const badDate: Date3 = ["10", "Aug", "0202"];

  it("emails a new notice with the NEW badge or a date in the last 30 days", async () => {
    const config = settings();
    await runCycle(config, site(listing(["1"])), now);
    const page = listing(["1", "2", "3", "4"], {
      dates: { "2": daysAgo(2), "3": daysAgo(30), "4": daysAgo(2) },
      badges: { "2": true, "3": false, "4": false },
    });
    expect(await runCycle(config, site(page), later(1))).toMatchObject({ scan: { notifications: 3 } });
    expect(await pending()).toBe(3);
    expect(await count("notice_reviews")).toBe(0);
  });

  it("emails a recent notice even when its title and date match a stored one", async () => {
    const config = settings();
    await runCycle(config, site(listing(["1"], { title: "22/10/2026 - Seat Matrix for PG" })), now);
    await runCycle(config, site(listing(["1", "2"], { title: "22/10/2026 - Seat Matrix for PG" })), later(1));
    expect(await pending()).toBe(1);
  });

  it("records an old entry without the badge quietly, with no review or admin note", async () => {
    const config = settings();
    await runCycle(config, site(listing(["1"])), now);
    await runCycle(config, site(listing(["1", "399"], { dates: { "399": ["17", "Sep", "2025"] } })), later(1));
    expect(await count("notices")).toBe(2);
    expect(await pending()).toBe(0);
    expect(await count("notice_reviews")).toBe(0);
  });

  it("holds an unreadable, missing or future date, and an old date marked New", async () => {
    const config = settings();
    await runCycle(config, site(listing(["1"])), now);
    const page = listing(["1", "2", "3", "4", "5"], {
      dates: { "2": badDate, "3": ["", "", ""], "4": ["30", "Oct", "2026"], "5": ["17", "Sep", "2025"] },
      badges: { "5": true },
    });
    expect(await runCycle(config, site(page), later(1))).toMatchObject({ scan: { notifications: 0 } });
    expect(await pending()).toBe(0);
    expect((await waiting()).map((r) => [r.id, r.reason]).sort()).toEqual([
      ["2", 'NMC shows its published date as "10 Aug 0202", which is not a valid date.'],
      ["3", "NMC listed it without a published date."],
      ["4", "Its published date, 2026-10-30, is in the future."],
      ["5", "NMC marks it New, but its published date is 2025-09-17, 402 days ago."],
    ]);
  });

  it("holds every recent entry when more than 5 appear in one check", async () => {
    const config = settings();
    await runCycle(config, site(listing(["1"])), now);
    await runCycle(config, site(listing(["1", "2", "3", "4", "5", "6"])), later(1));
    expect(await pending()).toBe(5);
    await runCycle(config, site(listing(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"])), later(2));
    expect(await pending()).toBe(5);
    const held = await waiting();
    expect(held).toHaveLength(6);
    expect(held[0]!.reason).toBe("6 new entries appeared in one check. NMC may have renumbered or re-uploaded its notices.");
  });

  it("queues a held notice for every recipient on Send, once", async () => {
    const config = settings({ EMAIL_TO: "a@example.com, b@example.com" });
    await runCycle(config, site(listing(["1"])), now);
    const page = listing(["1", "2"], { dates: { "2": badDate } });
    await runCycle(config, site(page), later(1));
    expect(await decideReview(config, "2", "send")).toMatchObject({ status: "sent", queued: 2 });
    expect(await pending()).toBe(2);
    expect(await waiting()).toEqual([]);
    await expect(decideReview(config, "2", "send")).rejects.toThrow("already sent");
    expect(await pending()).toBe(2);
    // A later scan does not hold or queue it again.
    await runCycle(config, site(page), later(2));
    expect(await pending()).toBe(2);
  });

  it("keeps a dismissed notice in history without emailing it", async () => {
    const config = settings();
    await runCycle(config, site(listing(["1"])), now);
    await runCycle(config, site(listing(["1", "2"], { dates: { "2": badDate } })), later(1));
    expect(await decideReview(config, "2", "dismiss")).toMatchObject({ status: "dismissed" });
    expect(await pending()).toBe(0);
    expect(await waiting()).toEqual([]);
    expect(await count("notices")).toBe(2);
    await expect(decideReview(config, "1", "send")).rejects.toThrow("not waiting for review");
  });
});

describe("admin alerts", () => {
  const admin = () =>
    env.DB.prepare(
      `INSERT INTO auth_user (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES ('admin', 'Admin', 'admin@example.com', 1, ?, ?)`,
    )
      .bind(now.toISOString(), now.toISOString())
      .run();
  const sending = settings({ EMAIL_ENABLED: "true", RESEND_API_KEY: "re_test_key", EMAIL_TO: "reader@example.com" });
  function nmc(html: string, sent: { to: string[]; subject: string; text: string }[], fail = false): Fetcher {
    const page = site(html);
    return async (input, init) => {
      if (String(input).startsWith("https://api.resend.com")) {
        sent.push(JSON.parse(String(init!.body)));
        return Response.json({ id: `email-${sent.length}` });
      }
      if (fail) return new Response("Maintenance", { headers: { "Content-Type": "text/html" } });
      return page(input, init);
    };
  }
  const adminMail = (sent: { to: string[] }[]) => sent.filter((m) => m.to[0] === "admin@example.com");

  it("emails only the admin when a notice is held, then reminds daily while it waits", async () => {
    await admin();
    const sent: { to: string[]; subject: string; text: string }[] = [];
    await runCycle(sending, nmc(listing(["1"]), sent), now);
    expect(sent).toEqual([]);
    const page = listing(["1", "2"], { titles: { "2": "Held notice" }, dates: { "2": ["10", "Aug", "0202"] } });
    await runCycle(sending, nmc(page, sent), later(1));
    expect(adminMail(sent)).toHaveLength(1);
    expect(sent.every((m) => m.to[0] === "admin@example.com")).toBe(true);
    expect(sent[0]!.subject).toBe("Notivo: 1 NMC entry needs your review");
    expect(sent[0]!.text).toContain("Held notice (NMC 2, published date not given)");
    expect(sent[0]!.text).toContain('NMC shows its published date as "10 Aug 0202"');

    await runCycle(sending, nmc(page, sent), later(2));
    expect(adminMail(sent)).toHaveLength(1);
    await runCycle(sending, nmc(page, sent), later(26));
    expect(adminMail(sent)).toHaveLength(2);
    expect(sent[1]!.subject).toBe("Notivo reminder: 1 NMC entry is waiting for your review");
  });

  it("sends no admin email for an old entry recorded quietly", async () => {
    await admin();
    const sent: { to: string[]; subject: string; text: string }[] = [];
    await runCycle(sending, nmc(listing(["1"]), sent), now);
    await runCycle(sending, nmc(listing(["1", "399"], { dates: { "399": ["17", "Sep", "2025"] } }), sent), later(1));
    expect(sent).toEqual([]);
  });

  it("alerts once when checks have failed for 2 hours, and again after a recovery", async () => {
    await admin();
    const sent: { to: string[]; subject: string; text: string }[] = [];
    await runCycle(sending, nmc(listing(["1"]), sent), now);
    await runCycle(sending, nmc("", sent, true), later(1));
    expect(sent).toEqual([]);
    await runCycle(sending, nmc("", sent, true), later(2.5));
    expect(sent.map((m) => m.subject)).toEqual(["Notivo: NMC checks have failed for over 2 hours"]);
    await runCycle(sending, nmc("", sent, true), later(3));
    expect(sent).toHaveLength(1);
    await runCycle(sending, nmc(listing(["1"]), sent), later(4));
    await runCycle(sending, nmc("", sent, true), later(7));
    expect(sent).toHaveLength(2);
  });

  it("sends nothing to the admin during the first archive import or with email off", async () => {
    await admin();
    const sent: { to: string[]; subject: string; text: string }[] = [];
    await runCycle(settings({ EMAIL_ENABLED: "false" }), nmc(listing(["1"]), sent), now);
    await runCycle(settings({ EMAIL_ENABLED: "false" }), nmc(listing(["1", "2"], { dates: { "2": ["10", "Aug", "0202"] } }), sent), later(1));
    expect(sent).toEqual([]);
    expect(await count("notice_reviews")).toBe(1);
  });
});
