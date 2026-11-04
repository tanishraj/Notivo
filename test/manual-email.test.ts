import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../src/index";
import { manualEmailReview, sendNoticeManually } from "../src/manual-email";
import { runCycle, runScheduledCycle } from "../src/monitor";
import { sendPending } from "../src/email";
import { listing, migrate, now, reset, settings, site } from "./helpers";
import type { Env, Fetcher, MailPayload } from "../src/types";

beforeAll(migrate);
beforeEach(reset);

async function setup(extra: Partial<Env> = {}) {
  const config = settings(extra);
  await runCycle(config, site(listing(["1"])), now, false, true);
  return { ...config, EMAIL_ENABLED: "true", RESEND_API_KEY: "re_test_only" };
}
async function confirmation(config: Env, id = "1") {
  const review = await manualEmailReview(config, id);
  return { settingsRevision: review.settingsRevision, fingerprint: review.notice.fingerprint };
}

describe("manual archive email", () => {
  it("emails a baseline notice once, retaining archive identity and recording a separate manual audit trail", async () => {
    const config = await setup();
    const key = crypto.randomUUID();
    const body = await confirmation(config);
    let calls = 0;
    const fetcher: Fetcher = async (url, init) => {
      calls++;
      expect(String(url)).toBe("https://api.resend.com/emails");
      const payload = JSON.parse(String(init?.body)) as MailPayload;
      expect(payload.subject).toBe("NMC notice shared with you: Notice 1");
      expect(payload.to).toEqual(["reader@example.com"]);
      expect(payload.html).toContain("shared with you by your Notivo administrator");
      expect(payload.text).toContain("https://nmc.org.in/whats-new/download/1");
      return Response.json({ id: "manual-email-id" });
    };
    expect(await sendNoticeManually(config, "1", key, body, fetcher, now)).toMatchObject({ queued: 1, remaining: 0, emails: { accepted: 1 } });
    expect(await sendNoticeManually(config, "1", key, body, fetcher, now)).toMatchObject({ queued: 0, emails: { accepted: 0 } });
    expect(calls).toBe(1);
    expect(await config.DB.prepare("SELECT COUNT(*) AS count FROM notice_versions").first()).toEqual({ count: 0 });
    expect(await config.DB.prepare("SELECT COUNT(*) AS count FROM outbox").first()).toEqual({ count: 0 });
    const headers = { Authorization: `Bearer ${config.ADMIN_TOKEN}` };
    const archive = await app.fetch(new Request("https://monitor.example/admin/notices", { headers }), config);
    expect(await archive.json()).toMatchObject({ total: 1, items: [{ kind: "baseline", version_count: 0 }] });
    const emails = await app.fetch(new Request("https://monitor.example/admin/emails", { headers }), config);
    const log = await emails.json();
    expect(log).toMatchObject({ total: 1, items: [{ notice_id: "1", delivery_source: "manual", status: "accepted", resend_id: "manual-email-id" }] });
    expect(JSON.stringify(log)).not.toContain("payload_json");
  });

  it("keeps existing pending deliveries and requires acknowledgment before another accepted/uncertain copy", async () => {
    const config = await setup();
    await runCycle(config, site(listing(["1", "2"])), now, false, true);
    let calls = 0;
    const fetcher: Fetcher = async () => { calls++; return Response.json({ id: "accepted-id" }); };
    expect(await sendNoticeManually(config, "2", crypto.randomUUID(), await confirmation(config, "2"), fetcher, now))
      .toMatchObject({ queued: 0, existingPending: 1, emails: { accepted: 0 } });
    expect(calls).toBe(0);
    await sendPending(config, fetcher, now);
    const review = await confirmation(config, "2");
    await expect(sendNoticeManually(config, "2", crypto.randomUUID(), review, fetcher, now)).rejects.toThrow("already accepted");
    expect(await sendNoticeManually(config, "2", crypto.randomUUID(), { ...review, allowDuplicate: true }, fetcher, now))
      .toMatchObject({ queued: 1, emails: { accepted: 1 } });
    expect(calls).toBe(2);
    await config.DB.prepare("UPDATE manual_deliveries SET status = 'uncertain'").run();
    await expect(sendNoticeManually(config, "2", crypto.randomUUID(), review, fetcher, now)).rejects.toThrow("uncertain");
    expect(calls).toBe(2);
  });

  it("uses the corrected sender for a failed alert without rewriting the original attempt", async () => {
    const config = await setup();
    await runCycle(config, site(listing(["1", "2"])), now, false, true);
    await sendPending({ ...config, EMAIL_FROM: "onboarding@resend.dev" }, async () => Response.json({}, { status: 403 }), now);
    const corrected = { ...config, EMAIL_FROM: "noreply@snmih.in" };
    const fetcher: Fetcher = async (_url, init) => {
      expect((JSON.parse(String(init?.body)) as MailPayload).from).toBe("noreply@snmih.in");
      return Response.json({ id: "corrected-manual-send" });
    };
    expect(await sendNoticeManually(corrected, "2", crypto.randomUUID(), await confirmation(corrected, "2"), fetcher, now))
      .toMatchObject({ emails: { accepted: 1 } });
    const original = await config.DB.prepare("SELECT status, attempts, payload_json FROM outbox").first<{ status: string; attempts: number; payload_json: string }>();
    expect(original).toMatchObject({ status: "failed", attempts: 1 });
    expect(original?.payload_json).toContain("onboarding@resend.dev");
  });

  it("schedules remaining manual recipients independently and preserves exact retry payloads", async () => {
    const config = await setup({ EMAIL_TO: "a@example.com, b@example.com", EMAILS_PER_RUN: "1" });
    const key = crypto.randomUUID();
    const calls: string[] = [];
    const fetcher: Fetcher = async (url, init) => {
      expect(String(url)).toBe("https://api.resend.com/emails");
      calls.push(String(init?.body));
      return calls.length === 1 ? Response.json({}, { status: 429 }) : Response.json({ id: `accepted-${calls.length}` });
    };
    expect(await sendNoticeManually(config, "1", key, await confirmation(config), fetcher, now))
      .toMatchObject({ queued: 2, remaining: 2, emails: { retried: 1 } });
    const changed = { ...config, EMAIL_FROM: "different@example.com" };
    expect(await runScheduledCycle(changed, fetcher, new Date(now.getTime() + 61_000)))
      .toMatchObject({ emails: { accepted: 1 } });
    expect(calls[1]).toBe(calls[0]);
    expect(await runScheduledCycle(changed, fetcher, new Date(now.getTime() + 121_000)))
      .toMatchObject({ emails: { accepted: 1 } });
    expect(calls).toHaveLength(3);
    expect(calls[2]).not.toContain("different@example.com");
  });

  it("rejects stale reviews, missing notices, disabled sending, malformed keys, and concurrent cycles", async () => {
    const config = await setup();
    const body = await confirmation(config);
    const fail: Fetcher = async () => { throw new Error("Must not send"); };
    await expect(manualEmailReview(config, "missing")).rejects.toThrow("not found");
    await expect(sendNoticeManually(config, "1", "invalid", body, fail, now)).rejects.toThrow("UUID");
    await expect(sendNoticeManually({ ...config, EMAIL_ENABLED: "false" }, "1", crypto.randomUUID(), body, fail, now)).rejects.toThrow("Enable email");
    await expect(sendNoticeManually(config, "1", crypto.randomUUID(), { ...body, settingsRevision: 999 }, fail, now)).rejects.toThrow("changed");
    await expect(sendNoticeManually(config, "1", crypto.randomUUID(), { ...body, fingerprint: "old" }, fail, now)).rejects.toThrow("changed");
    await config.DB.prepare("UPDATE monitor_state SET lease_owner = 'other', lease_until = ?").bind(new Date(now.getTime() + 60_000).toISOString()).run();
    await expect(sendNoticeManually(config, "1", crypto.randomUUID(), body, fail, now)).rejects.toThrow("Another cycle");
    expect(await config.DB.prepare("SELECT COUNT(*) AS count FROM manual_deliveries").first()).toEqual({ count: 0 });
  });

  it("protects the manual endpoint and returns review data without sending", async () => {
    const config = await setup();
    const url = "https://monitor.example/admin/notices/1/email";
    expect((await app.fetch(new Request(url), config)).status).toBe(401);
    expect((await app.fetch(new Request(url, { method: "POST" }), config)).status).toBe(401);
    const headers = { Authorization: `Bearer ${config.ADMIN_TOKEN}` };
    const review = await app.fetch(new Request(url, { headers }), config);
    expect(await review.json()).toMatchObject({ notice: { id: "1" }, recipients: ["reader@example.com"], enabled: true });
    expect((await app.fetch(new Request(url, { method: "POST", headers: { ...headers, Origin: "https://other.example" } }), config)).status).toBe(403);
    expect(await config.DB.prepare("SELECT COUNT(*) AS count FROM manual_deliveries").first()).toEqual({ count: 0 });
  });
});
