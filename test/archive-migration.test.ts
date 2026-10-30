import { env } from "./env";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import migration from "../migrations/0008_quiet_archive_entries.sql?raw";
import { count, migrate, reset } from "./helpers";

beforeAll(migrate);
beforeEach(reset);

const at = "2026-10-29T08:30:00.000Z";

describe("archive entry cleanup", () => {
  it("removes Cancelled age-rule rows and their history, keeping real sends", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO notices (id, title, published_on, document_url, fingerprint, first_seen_at, last_seen_at) VALUES
        ('885', 'Rabies', '2025-09-17', 'https://nmc.org.in/whats-new/download/885', 'f885', ?1, ?1),
        ('399', 'Rabies', '2025-09-17', 'https://nmc.org.in/whats-new/download/399', 'f399', ?1, ?1),
        ('1881', 'De-notification', '2026-10-26', 'https://nmc.org.in/whats-new/download/1881', 'f1881', ?1, ?1)`,
      ).bind(at),
      env.DB.prepare(
        `INSERT INTO notice_versions (id, notice_id, kind, title, published_on, document_url, detected_at) VALUES
        ('v399', '399', 'new', 'Rabies', '2025-09-17', NULL, ?1),
        ('v1881', '1881', 'new', 'De-notification', '2026-10-26', NULL, ?1)`,
      ).bind(at),
      env.DB.prepare(
        `INSERT INTO outbox (id, version_id, recipient, status, created_at, next_attempt_at, attempts, last_error) VALUES
        ('o1', 'v399', 'a@example.com', 'cancelled', ?1, ?1, 0, 'Published more than 30 days ago. Archive entries are recorded but not emailed.'),
        ('o2', 'v399', 'b@example.com', 'cancelled', ?1, ?1, 0, 'Published more than 30 days ago. Archive entries are recorded but not emailed.'),
        ('o3', 'v1881', 'a@example.com', 'accepted', ?1, ?1, 1, NULL)`,
      ).bind(at),
    ]);
    for (const query of migration.split(";").map((q) => q.trim()).filter(Boolean))
      await env.DB.prepare(query).run();
    expect(await env.DB.prepare("SELECT id FROM outbox").all().then((r) => r.results)).toEqual([{ id: "o3" }]);
    expect(await env.DB.prepare("SELECT id FROM notice_versions").all().then((r) => r.results)).toEqual([{ id: "v1881" }]);
    expect(await count("notices")).toBe(3);
  });
});
