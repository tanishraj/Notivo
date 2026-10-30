import { env } from "./env";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runCycle } from "../src/monitor";
import { status } from "../src/store";
import type { Fetcher } from "../src/types";
import { listing, migrate, now, reset, settings } from "./helpers";

beforeAll(migrate);
beforeEach(reset);

const later = (days: number) => new Date(now.getTime() + days * 86_400_000);

/** Serves `html`, answers document links with `codes[id]` (default 200), and records HEAD checks. */
function nmc(html: string, codes: Record<string, number> = {}, heads: string[] = []): Fetcher {
  return async (input, init) => {
    const id = /\/whats-new\/download\/(\d+)/.exec(String(input))?.[1];
    if (id && init?.method === "HEAD") {
      heads.push(id);
      return new Response(null, { status: codes[id] ?? 200 });
    }
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  };
}
const removed = async () =>
  (await env.DB.prepare("SELECT id FROM notices WHERE removed_at IS NOT NULL ORDER BY id").all()).results;

describe("notices removed by NMC", () => {
  it("marks a notice unseen for 3 days whose link is gone, and counts it separately", async () => {
    const config = settings();
    await runCycle(config, nmc(listing(["404", "884"])), now);
    const heads: string[] = [];
    await runCycle(config, nmc(listing(["404"]), { "884": 404 }, heads), later(2));
    expect(heads).toEqual([]);
    await runCycle(config, nmc(listing(["404"]), { "884": 404 }, heads), later(3.5));
    expect(heads).toEqual(["884"]);
    expect(await removed()).toEqual([{ id: "884" }]);
    expect((await status(config)).counts).toEqual({ notices: 1, removed: 1 });
    // The notice stays in history.
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM notices").first()).toEqual({ n: 2 });
  });

  it("does not mark a notice whose link still works, and rechecks it only daily", async () => {
    const config = settings();
    await runCycle(config, nmc(listing(["1", "2"])), now);
    const heads: string[] = [];
    await runCycle(config, nmc(listing(["1"]), {}, heads), later(3.5));
    await runCycle(config, nmc(listing(["1"]), {}, heads), later(3.7));
    expect(heads).toEqual(["2"]);
    await runCycle(config, nmc(listing(["1"]), {}, heads), later(4.6));
    expect(heads).toEqual(["2", "2"]);
    expect(await removed()).toEqual([]);
  });

  it("treats an unreachable link as not removed", async () => {
    const config = settings();
    await runCycle(config, nmc(listing(["1", "2"])), now);
    const failing: Fetcher = async (input, init) => {
      if (init?.method === "HEAD") throw new Error("network down");
      return nmc(listing(["1"]))(input, init);
    };
    await runCycle(config, failing, later(3.5));
    expect(await removed()).toEqual([]);
  });

  it("un-marks a removed notice when NMC lists it again", async () => {
    const config = settings();
    await runCycle(config, nmc(listing(["1", "2"])), now);
    await runCycle(config, nmc(listing(["1"]), { "2": 404 }), later(3.5));
    expect(await removed()).toEqual([{ id: "2" }]);
    await runCycle(config, nmc(listing(["1", "2"])), later(4));
    expect(await removed()).toEqual([]);
    expect((await status(config)).counts).toEqual({ notices: 2, removed: 0 });
  });

  it("checks nothing during the first archive import", async () => {
    const heads: string[] = [];
    await runCycle(settings({ BASELINE_PAGES_PER_RUN: "1" }), nmc(listing(["1"], { total: 21 }), {}, heads), now);
    expect(heads).toEqual([]);
  });
});
