import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Database } from "../src/db";
import { findStoredMatches } from "../src/store";
import { env, sqlite } from "./env";
import { migrate, reset } from "./helpers";

beforeAll(migrate);
beforeEach(reset);

const at = "2026-10-24T12:00:00.000Z";

describe("stored notice lookup", () => {
  it("finds matches by ID or by title and date using indexes, never scanning the notices table", async () => {
    const stored = Array.from({ length: 1000 }, (_, i) => ({
      id: String(i + 1),
      title: `Notice ${i + 1}`,
      published_on: `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
    }));
    await env.DB.prepare(
      `INSERT INTO notices (id, title, published_on, document_url, fingerprint, first_seen_at, last_seen_at)
      SELECT json_extract(value, '$.id'), json_extract(value, '$.title'), json_extract(value, '$.published_on'),
        'https://nmc.org.in/whats-new/download/' || json_extract(value, '$.id'), 'f', ?, ? FROM json_each(?)`,
    )
      .bind(at, at, JSON.stringify(stored))
      .run();
    // Like a scan of 3 pages: 60 rows, of which 40 are known by ID and 20 match only by title and date.
    const incoming = [
      ...stored.slice(0, 40).map((n) => ({ ...n, fallback_id: `text:${n.id}` })),
      ...stored.slice(500, 520).map((n) => ({ ...n, id: `9${n.id}`, fallback_id: `text:9${n.id}` })),
    ];
    const queries: string[] = [];
    const db = new (class extends Database {
      override prepare(sql: string) {
        queries.push(sql);
        return super.prepare(sql);
      }
    })(sqlite);
    const result = await findStoredMatches<{ id: string }>(db, incoming);
    expect(result.results.map((r) => r.id).sort()).toEqual(
      [...stored.slice(0, 40), ...stored.slice(500, 520)].map((n) => n.id).sort(),
    );
    const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${queries[0]}`).all("[]", "[]").map((row) => String(row.detail));
    expect(plan.filter((step) => /^SCAN (notices|n)\b/.test(step))).toEqual([]);
    expect(plan).toContain("SEARCH n USING INDEX notices_title_published (title=? AND published_on=?)");
  });
});
