import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";
import { effectiveEnv, settingsView } from "../src/config";
import { runCycle, runScheduledCycle } from "../src/monitor";
import { listing, migrate, now, reset, settings, site } from "./helpers";
import type { Env } from "../src/types";

beforeAll(migrate);
beforeEach(reset);
const origin = "https://monitor.example";
async function save(
  config: Env,
  changes: Partial<Record<string, string>> = {},
  extra: Record<string, unknown> = {},
) {
  const current = await settingsView(config);
  return app.fetch(
    new Request(`${origin}/admin/settings`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${config.ADMIN_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        values: { ...current.values, ...changes },
        revision: current.revision,
        ...extra,
      }),
    }),
    config,
  );
}

describe("dashboard settings", () => {
  it("starts with environment values, persists edits, and applies them to subsequent scans", async () => {
    const config = settings();
    expect(await effectiveEnv(config)).toMatchObject({
      EMAIL_TO: "reader@example.com",
      RECENT_PAGES: "3",
    });
    await runCycle(config, site(listing(["1"])), now, false, true);
    await runCycle(config, site(listing(["2"])), now, false, true);
    expect(
      (
        await save(config, {
          EMAIL_TO: "new@example.com, second@example.com",
          RECENT_PAGES: "1",
          EMAILS_PER_RUN: "2",
        })
      ).status,
    ).toBe(200);
    expect(
      await effectiveEnv(settings({ EMAIL_TO: "different@example.com" })),
    ).toMatchObject({
      EMAIL_TO: "new@example.com, second@example.com",
      EMAILS_PER_RUN: "2",
    });
    await runCycle(config, site(listing(["3"])), now, false, true);
    const recipients = await config.DB.prepare(
      "SELECT recipient FROM outbox ORDER BY recipient",
    ).all<{ recipient: string }>();
    expect(recipients.results.map((row) => row.recipient)).toEqual([
      "new@example.com",
      "reader@example.com",
      "second@example.com",
    ]);
  });

  it("encrypts API keys and never returns their plaintext or ciphertext to the dashboard", async () => {
    const config = settings({ RESEND_API_KEY: "re_environment_test_only" });
    const key = "re_new_dashboard_test_only";
    const response = await save(config, {}, { resendKey: key });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain(key);
    expect(body).not.toContain("v1.");
    expect(JSON.parse(body)).toMatchObject({
      resendConfigured: true,
      resendSource: "dashboard",
    });
    const stored = await config.DB.prepare(
      "SELECT resend_cipher FROM app_settings",
    ).first<{ resend_cipher: string }>();
    expect(stored?.resend_cipher).not.toContain(key);
    expect(stored?.resend_cipher).toMatch(/^v1\./);
    expect((await effectiveEnv(config)).RESEND_API_KEY).toBe(key);
    expect(
      (await save(config, { EMAIL_ENABLED: "false" }, { resendKey: "" }))
        .status,
    ).toBe(200);
    expect((await effectiveEnv(config)).RESEND_API_KEY).toBe(key);
    expect((await save(config, {}, { clearResendKey: true })).status).toBe(200);
    expect((await effectiveEnv(config)).RESEND_API_KEY).toBe("");
  });

  it("validates settings atomically and rejects stale saves", async () => {
    const config = settings({ RESEND_API_KEY: "" });
    for (const values of [
      { EMAIL_TO: "not-email" },
      { EMAIL_FROM: "a@example.com\r\nBcc: b@example.com" },
      { EMAIL_FROM: "sender@example.com>" },
      { CHECK_INTERVAL_MINUTES: "1" },
      { RECENT_PAGES: "4" },
      { EMAILS_PER_RUN: "99" },
      { EMAIL_ENABLED: "true" },
    ])
      expect((await save(config, values)).status).toBe(400);
    expect((await settingsView(config)).revision).toBe(0);
    expect((await save(config, { EMAILS_PER_RUN: "1" })).status).toBe(200);
    expect(
      (await save(config, { EMAILS_PER_RUN: "2" }, { revision: 0 })).status,
    ).toBe(409);
    expect((await effectiveEnv(config)).EMAILS_PER_RUN).toBe("1");
    expect(
      (
        await save(
          settings({ SETTINGS_ENCRYPTION_KEY: undefined }),
          {},
          { resendKey: "re_test_key_no_encryption" },
        )
      ).status,
    ).toBe(503);
  });

  it("does not send email while saving, even when enabling sending", async () => {
    const config = settings({ RESEND_API_KEY: "re_fake_test_only" });
    const outbound = vi.fn();
    vi.stubGlobal("fetch", outbound);
    try {
      expect((await save(config, { EMAIL_ENABLED: "true" })).status).toBe(200);
      expect(outbound).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("honors pause and interval settings while preserving manual scans", async () => {
    const config = settings();
    await runCycle(config, site(listing(["1"])), now, false, true);
    await save(config, { MONITOR_ENABLED: "false" });
    const network = vi.fn(site(listing(["2"])));
    expect(
      await runScheduledCycle(
        config,
        network,
        new Date(now.getTime() + 86400000),
      ),
    ).toMatchObject({ skipped: true });
    expect(network).not.toHaveBeenCalled();
    expect(await runCycle(config, network, now, false, true)).toMatchObject({
      scan: { notifications: 1 },
    });
    await save(config, {
      MONITOR_ENABLED: "true",
      CHECK_INTERVAL_MINUTES: "60",
    });
    network.mockClear();
    expect(
      await runScheduledCycle(
        config,
        network,
        new Date(now.getTime() + 1800000),
      ),
    ).toMatchObject({ skipped: true });
    expect(network).not.toHaveBeenCalled();
    expect(
      await runScheduledCycle(
        config,
        network,
        new Date(now.getTime() + 3600000),
      ),
    ).toMatchObject({ skipped: false });
  });

  it("reports health according to the configured interval and intentional pauses", async () => {
    const config = settings();
    await config.DB.prepare(
      "UPDATE monitor_state SET last_success_at = ?, baseline_completed_at = ? WHERE id = 1",
    )
      .bind(
        new Date(Date.now() - 7200000).toISOString(),
        new Date().toISOString(),
      )
      .run();
    const health = () => app.fetch(new Request(`${origin}/health`), config);
    expect((await health()).status).toBe(503);
    await save(config, { CHECK_INTERVAL_MINUTES: "120" });
    expect((await health()).status).toBe(200);
    await save(config, { MONITOR_ENABLED: "false" });
    expect(await (await health()).json()).toMatchObject({ status: "paused" });
  });
});
