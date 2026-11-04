import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";
import { runCycle } from "../src/monitor";
import { manualEmailReview, retryFailedEmail, sendNoticeManually } from "../src/manual-email";
import { sendPending } from "../src/email";
import { listing, migrate, now, reset, settings, site } from "./helpers";
import type { Env } from "../src/types";

beforeAll(migrate);
beforeEach(reset);
const origin = "https://monitor.example";
function request(config: Env, path: string, init: RequestInit = {}) {
  return app.fetch(new Request(`${origin}/admin/${path}`, {
    ...init, headers: { Authorization: `Bearer ${config.ADMIN_TOKEN}`, ...init.headers },
  }), config);
}
async function setup() {
  const config = settings({ EMAIL_TO: "a@example.com, b@example.com" });
  await runCycle(config, site(listing(["1"])), now, false, true);
  await runCycle(config, site(listing(["1", "2", "3"])), now, false, true);
  return config;
}
async function list(config: Env, query: string) {
  const response = await request(config, `emails?${query}`);
  expect(response.status).toBe(200);
  return response.json() as Promise<{ total: number; items: { id: string; recipient: string; status: string; resolved: number; dismissed_at: string | null; delivery_source: string }[] }>;
}

describe("email queue and review views", () => {
  it("keeps accepted records in history while the queue contains only pending work", async () => {
    const config = await setup();
    await config.DB.prepare("UPDATE outbox SET status = 'accepted', accepted_at = ? WHERE recipient = 'a@example.com'")
      .bind(now.toISOString()).run();
    const queue = await list(config, "view=queue");
    expect(queue.total).toBe(2);
    expect(queue.items.every(row => row.status === "pending")).toBe(true);
    const history = await list(config, "view=history");
    expect(history.total).toBe(2);
    expect(history.items.every(row => row.status === "accepted")).toBe(true);
    expect((await list(config, "view=attention")).total).toBe(0);
    await config.DB.prepare("UPDATE outbox SET status = 'accepted'").run();
    expect((await list(config, "view=queue")).total).toBe(0);
    expect((await list(config, "view=history")).total).toBe(4);
  });

  it("dismisses and restores failures without sending, deleting delivery history, or changing status", async () => {
    const config = await setup();
    await config.DB.prepare("UPDATE outbox SET status = 'failed'").run();
    const row = (await list(config, "view=attention")).items[0]!;
    const path = `emails/automatic/${row.id}`;
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    try {
      for (let i = 0; i < 2; i++) expect((await request(config, path + "/dismiss", { method: "POST" })).status).toBe(200);
      expect((await list(config, "view=attention")).total).toBe(3);
      const history = await list(config, "view=history&status=dismissed");
      expect(history.total).toBe(1);
      expect(history.items[0]).toMatchObject({ id: row.id, status: "failed", dismissed_at: expect.any(String) });
      const status = await (await request(config, "status")).json() as { emailAttentionCount: number };
      expect(status.emailAttentionCount).toBe(3);
      expect((await request(config, path + "/restore", { method: "POST" })).status).toBe(200);
      expect((await list(config, "view=attention")).total).toBe(4);
      expect((await list(config, "view=history")).total).toBe(4);
      expect((await list(config, "view=history&status=dismissed")).total).toBe(0);
      expect(network).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it("resolves only the matching notice and recipient after a later manual acceptance", async () => {
    const config = await setup();
    await config.DB.prepare("UPDATE outbox SET status = 'failed'").run();
    const single = { ...config, EMAIL_TO: "a@example.com", EMAIL_ENABLED: "true", RESEND_API_KEY: "re_test_only" };
    const review = await manualEmailReview(single, "2");
    await sendNoticeManually(single, "2", crypto.randomUUID(), { settingsRevision: review.settingsRevision, fingerprint: review.notice.fingerprint },
      async () => Response.json({ id: "resolved-manual" }), new Date(now.getTime() + 1000));
    const attention = await list(config, "view=attention");
    expect(attention.total).toBe(3);
    const history = await list(config, "view=history&status=failed");
    expect(history.total).toBe(4);
    const resolved = history.items.filter(row => row.resolved);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.recipient).toBe("a@example.com");
    const status = await (await request(config, "status")).json() as { emailAttentionCount: number; emailProblems: unknown[] };
    expect(status.emailAttentionCount).toBe(3);
    expect(status.emailProblems).toHaveLength(3);
    const manual = (await list(config, "view=history&status=accepted")).items[0]!;
    await config.DB.prepare("UPDATE manual_deliveries SET status = 'uncertain' WHERE id = ?").bind(manual.id).run();
    expect((await request(config, `emails/manual/${manual.id}/dismiss`, { method: "POST" })).status).toBe(200);
    expect((await list(config, "view=history&status=dismissed")).items[0]?.delivery_source).toBe("manual");
    const after = await manualEmailReview(single, "2");
    expect(after.history.some(row => row.status === "uncertain")).toBe(true);
  });

  it("rejects unauthorized, cross-origin, invalid view, missing, and pending-record changes", async () => {
    const config = await setup();
    const row = (await list(config, "view=queue")).items[0]!;
    const path = `emails/automatic/${row.id}/dismiss`;
    expect((await app.fetch(new Request(`${origin}/admin/${path}`, { method: "POST" }), config)).status).toBe(401);
    expect((await request(config, path, { method: "POST", headers: { Origin: "https://other.example" } })).status).toBe(403);
    expect((await request(config, path, { method: "POST" })).status).toBe(400);
    expect((await request(config, `emails/automatic/${"0".repeat(64)}/dismiss`, { method: "POST" })).status).toBe(404);
    expect((await request(config, "emails?view=bad")).status).toBe(400);
    expect((await list(config, "view=queue")).total).toBe(4);
  });
});

async function failedAttempt() {
  const config = { ...await setup(), EMAIL_ENABLED: "true", RESEND_API_KEY: "re_test_only", EMAIL_FROM: "onboarding@resend.dev", EMAILS_PER_RUN: "1" };
  await sendPending(config, async () => Response.json({}, { status: 403 }), now);
  const original = await config.DB.prepare("SELECT * FROM email_activity_current WHERE status = 'failed'")
    .first<{ delivery_id: string; recipient: string; notice_id: string; payload_json: string }>();
  return { config: { ...config, EMAIL_FROM: "nmc_notice@snmih.in", EMAIL_TO: "current-list@example.com" }, original: original! };
}

describe("explicit failed-email retries", () => {
  it("uses the corrected sender and original recipient, preserving history and preventing duplicate retries", async () => {
    const { config, original } = await failedAttempt();
    const key = crypto.randomUUID();
    const network = vi.fn(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      expect(payload.from).toBe("nmc_notice@snmih.in");
      expect(payload.to).toEqual([original.recipient]);
      return Response.json({ id: "accepted-manual-retry" });
    });
    expect(await retryFailedEmail(config, "automatic", original.delivery_id, key, network, new Date(now.getTime() + 1000)))
      .toMatchObject({ queued: 1, deliveryStatus: "accepted", emails: { accepted: 1 } });
    expect(await retryFailedEmail(config, "automatic", original.delivery_id, key, network, new Date(now.getTime() + 2000)))
      .toMatchObject({ queued: 0, deliveryStatus: "accepted" });
    expect(network).toHaveBeenCalledTimes(1);
    const before = await config.DB.prepare("SELECT status, payload_json, attempts FROM outbox WHERE id = ?").bind(original.delivery_id).first();
    expect(before).toMatchObject({ status: "failed", payload_json: original.payload_json, attempts: 1 });
    expect((await list(config, "view=attention")).total).toBe(0);
    const accepted = await list(config, "view=history&status=accepted");
    expect(accepted.items[0]).toMatchObject({ recipient: original.recipient, delivery_source: "manual" });
    await expect(retryFailedEmail(config, "automatic", original.delivery_id, crypto.randomUUID(), network, now)).rejects.toThrow("already accepted");
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("moves a temporary retry to the queue and hides the superseded failure from attention", async () => {
    const { config, original } = await failedAttempt();
    const network = vi.fn(async () => Response.json({}, { status: 429 }));
    expect(await retryFailedEmail(config, "automatic", original.delivery_id, crypto.randomUUID(), network, now))
      .toMatchObject({ deliveryStatus: "pending", emails: { retried: 1 } });
    expect((await list(config, "view=queue")).total).toBe(4);
    expect((await list(config, "view=attention")).total).toBe(0);
    await expect(retryFailedEmail(config, "automatic", original.delivery_id, crypto.randomUUID(), network, now)).rejects.toThrow("already has a retry");
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("can retry the latest failed manual attempt while retaining the complete chain", async () => {
    const { config, original } = await failedAttempt();
    await retryFailedEmail(config, "automatic", original.delivery_id, crypto.randomUUID(), async () => Response.json({}, { status: 403 }), now);
    const latest = (await list(config, "view=attention")).items[0]!;
    expect(latest.delivery_source).toBe("manual");
    expect(await retryFailedEmail(config, "manual", latest.id, crypto.randomUUID(), async () => Response.json({ id: "accepted-second-retry" }), new Date(now.getTime() + 1000)))
      .toMatchObject({ deliveryStatus: "accepted" });
    expect((await list(config, "view=attention")).total).toBe(0);
    expect((await list(config, "view=history")).total).toBe(3);
  });

  it("protects retry actions and blocks unsafe or disabled attempts before sending", async () => {
    const { config, original } = await failedAttempt();
    const path = `emails/automatic/${original.delivery_id}/retry`;
    expect((await app.fetch(new Request(`${origin}/admin/${path}`, { method: "POST" }), config)).status).toBe(401);
    expect((await request(config, path, { method: "POST", headers: { Origin: "https://other.example" } })).status).toBe(403);
    const fail = vi.fn(async () => { throw new Error("Must not send"); });
    await expect(retryFailedEmail(config, "automatic", original.delivery_id, "invalid", fail, now)).rejects.toThrow("UUID");
    await expect(retryFailedEmail({ ...config, EMAIL_ENABLED: "false" }, "automatic", original.delivery_id, crypto.randomUUID(), fail, now)).rejects.toThrow("Enable email");
    await config.DB.prepare("UPDATE outbox SET status = 'uncertain' WHERE id = ?").bind(original.delivery_id).run();
    await expect(retryFailedEmail(config, "automatic", original.delivery_id, crypto.randomUUID(), fail, now)).rejects.toThrow("Only confirmed failed");
    expect(fail).not.toHaveBeenCalled();
  });
});
