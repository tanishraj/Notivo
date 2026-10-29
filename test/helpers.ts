import { applyD1Migrations, env } from "cloudflare:test";
import migration from "../migrations/0001_initial.sql?raw";
import portalMigration from "../migrations/0002_portal_indexes.sql?raw";
import authMigration from "../migrations/0003_auth_and_settings.sql?raw";
import identityMigration from "../migrations/0004_notice_identity.sql?raw";
import manualEmailMigration from "../migrations/0005_manual_email.sql?raw";
import emailActivityMigration from "../migrations/0006_email_activity.sql?raw";
import emailRetriesMigration from "../migrations/0007_email_retries.sql?raw";
import quietArchiveMigration from "../migrations/0008_quiet_archive_entries.sql?raw";
import reviewsMigration from "../migrations/0009_notice_reviews.sql?raw";
import removalsMigration from "../migrations/0010_notice_removals.sql?raw";
import titleIndexMigration from "../migrations/0011_notice_title_index.sql?raw";
import type { Env, Fetcher } from "../src/types";

export async function migrate() {
  await applyD1Migrations(env.DB, [
    {
      name: "0001_initial.sql",
      queries: migration
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean),
    },
    {
      name: "0002_portal_indexes.sql",
      queries: portalMigration
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean),
    },
    {
      name: "0003_auth_and_settings.sql",
      queries: authMigration
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean),
    },
    {
      name: "0004_notice_identity.sql",
      queries: identityMigration
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean),
    },
    {
      name: "0005_manual_email.sql",
      queries: manualEmailMigration.split(";").map((s) => s.trim()).filter(Boolean),
    },
    {
      name: "0006_email_activity.sql",
      queries: emailActivityMigration.split(";").map((s) => s.trim()).filter(Boolean),
    },
    {
      name: "0007_email_retries.sql",
      queries: emailRetriesMigration.split(";").map((s) => s.trim()).filter(Boolean),
    },
    {
      name: "0008_quiet_archive_entries.sql",
      queries: quietArchiveMigration.split(";").map((s) => s.trim()).filter(Boolean),
    },
    {
      name: "0009_notice_reviews.sql",
      queries: reviewsMigration.split(";").map((s) => s.trim()).filter(Boolean),
    },
    {
      name: "0010_notice_removals.sql",
      queries: removalsMigration.split(";").map((s) => s.trim()).filter(Boolean),
    },
    {
      name: "0011_notice_title_index.sql",
      queries: titleIndexMigration.split(";").map((s) => s.trim()).filter(Boolean),
    },
  ]);
}

export async function reset() {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_user"),
    env.DB.prepare("DELETE FROM auth_rate_limit"),
    env.DB.prepare(
      "UPDATE auth_setup SET lock_id = NULL, locked_until = NULL WHERE id = 1",
    ),
    env.DB.prepare(
      "UPDATE app_settings SET config_json = '{}', resend_cipher = NULL, revision = 0, updated_at = NULL WHERE id = 1",
    ),
    env.DB.prepare("DELETE FROM email_retries"),
    env.DB.prepare("DELETE FROM email_dismissals"),
    env.DB.prepare("DELETE FROM manual_deliveries"),
    env.DB.prepare("DELETE FROM manual_email_requests"),
    env.DB.prepare("DELETE FROM notice_reviews"),
    env.DB.prepare("DELETE FROM outbox"),
    env.DB.prepare("DELETE FROM notice_versions"),
    env.DB.prepare("DELETE FROM notices"),
    env.DB.prepare("DELETE FROM runs"),
    env.DB
      .prepare(`UPDATE monitor_state SET baseline_next_page = 1, baseline_completed_at = NULL,
      audit_next_page = 1, audit_due_at = NULL, last_success_at = NULL, last_error = NULL,
      consecutive_failures = 0, lease_owner = NULL, lease_until = NULL, source_total = NULL,
      admin_alerted_at = NULL, admin_alert_attempted_at = NULL, outage_alerted_at = NULL WHERE id = 1`),
  ]);
}

export function settings(extra: Partial<Env> = {}): Env {
  return {
    ...env,
    EMAIL_ENABLED: "false",
    ADMIN_TOKEN: "test-admin-token-long-enough-1234",
    BETTER_AUTH_SECRET: "test-auth-secret-at-least-32-characters-long",
    SETTINGS_ENCRYPTION_KEY: "ab".repeat(32),
    EMAIL_TO: "reader@example.com",
    EMAIL_FROM: "NMC <notices@example.com>",
    ...extra,
  };
}

export const now = new Date("2026-10-24T12:00:00.000Z");

export function listing(
  ids: string[],
  options: {
    page?: number;
    total?: number;
    title?: string;
    titles?: Record<string, string>;
    date?: [day: string, month: string, year: string];
    dates?: Record<string, [day: string, month: string, year: string]>;
    /** Like NMC, rows dated in the 4 weeks before the test clock show NEW unless overridden. */
    badges?: Record<string, boolean>;
  } = {},
) {
  const page = options.page ?? 1;
  const [day, month, year] = options.date ?? ["22", "Oct", "2026"];
  const badgeFor = (id: string) => {
    if (options.badges?.[id] !== undefined) return options.badges[id];
    const [d, m, y] = options.dates?.[id] ?? [day, month, year];
    const at = Date.parse(`${d} ${m} ${y} UTC`);
    const age = (now.getTime() - at) / 86_400_000;
    return /^\d{4}$/.test(y) && Number(y) > 1900 && age >= -1 && age <= 28;
  };
  const total = options.total ?? ids.length;
  const last = Math.ceil(total / 20);
  return `<div class="wn-info-bar">Showing <strong>${(page - 1) * 20 + 1}–${(page - 1) * 20 + ids.length}</strong> of <strong>${total}</strong> results</div>
    <table class="wn-table"><tbody>${ids
      .map(
        (id) => `<tr class="wn-tr">
      <td class="wn-td-desc"><a class="wn-title-link" href="https://nmc.org.in/whats-new/download/${id}">${options.titles?.[id] ?? options.title ?? `Notice ${id}`}</a>${badgeFor(id) ? '<span class="notice-new">New</span>' : ""}</td>
      <td><a class="wn-dl-btn" href="https://nmc.org.in/whats-new/download/${id}">PDF</a></td>
      <td><span class="wn-date-day">${(options.dates?.[id] ?? [day])[0]}</span><span class="wn-date-mon">${(options.dates?.[id] ?? [, month])[1]}</span><span class="wn-date-yr">${(options.dates?.[id] ?? [, , year])[2]}</span></td>
    </tr>`,
      )
      .join(
        "",
      )}</tbody></table><div class="wn-pager"><span class="wn-pg-active">${page}</span>
    ${last > 1 ? `<a href="http://nmc.org.in/whats-new?page=${last}" title="Last page">Last</a>` : ""}</div>`;
}

export function site(html: string): Fetcher {
  return async () =>
    new Response(html, { headers: { "Content-Type": "text/html" } });
}

export async function count(
  table: "notices" | "notice_versions" | "outbox" | "notice_reviews",
) {
  return (await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{
    count: number;
  }>())!.count;
}
