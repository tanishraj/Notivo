import { sendPending } from "./email";
import { fetchListing } from "./nmc";
import { acquireLease, getState, ingest, releaseLease } from "./store";
import {
  errorMessage,
  intSetting,
  recipients,
  type Env,
  type Fetcher,
  type Notice,
} from "./types";
import { effectiveEnv } from "./config";

export async function scan(env: Env, fetcher: Fetcher, now: Date) {
  const state = await getState(env.DB);
  const baseline = !state.baseline_completed_at;
  if (!baseline) recipients(env); // Fail before recording notices if recipients are missing.
  const notices: Notice[] = [];
  let pages = 0;
  let nextPage = state.baseline_next_page;
  let baselineComplete = false;
  let auditPage = state.audit_next_page;
  let auditDue = state.audit_due_at;
  let sourceTotal = state.source_total;
  const load = async (page: number) => {
    if (pages) await new Promise((resolve) => setTimeout(resolve, 1_000));
    const listing = await fetchListing(page, fetcher);
    sourceTotal = listing.total;
    pages++;
    notices.push(...listing.notices);
    return listing;
  };
  if (baseline) {
    const count = intSetting(env.BASELINE_PAGES_PER_RUN, 3, 3);
    for (let i = 0; i < count; i++) {
      const listing = await load(nextPage);
      nextPage++;
      if (nextPage > listing.lastPage) {
        baselineComplete = true;
        break;
      }
    }
  } else {
    const first = await load(1);
    const recent = intSetting(env.RECENT_PAGES, 3, 3);
    for (let page = 2; page <= Math.min(recent, first.lastPage); page++)
      await load(page);
    // A full archive audit is spread across invocations to bound request/CPU work.
    if (!auditDue || auditDue <= now.toISOString()) {
      auditPage = Math.max(auditPage, recent + 1);
      const count = intSetting(env.AUDIT_PAGES_PER_RUN, 2, 2);
      for (let i = 0; i < count && auditPage <= first.lastPage; i++) {
        await load(auditPage);
        auditPage++;
      }
      if (auditPage > first.lastPage) {
        auditPage = 1;
        auditDue = new Date(now.getTime() + 86_400_000).toISOString();
      }
    }
  }
  const timestamp = now.toISOString();
  const update = baseline
    ? env.DB.prepare(
        `UPDATE monitor_state SET baseline_next_page = ?, baseline_completed_at = ?,
        last_success_at = ?, source_total = ?, last_error = NULL, consecutive_failures = 0 WHERE id = 1`,
      ).bind(
        nextPage,
        baselineComplete ? timestamp : null,
        timestamp,
        sourceTotal,
      )
    : env.DB.prepare(
        `UPDATE monitor_state SET audit_next_page = ?, audit_due_at = ?,
        last_success_at = ?, source_total = ?, last_error = NULL, consecutive_failures = 0 WHERE id = 1`,
      ).bind(auditPage, auditDue, timestamp, sourceTotal);
  const notifications = await ingest(env, notices, baseline, now, update);
  return {
    mode: baseline ? "baseline" : "monitor",
    baselineComplete: baseline ? baselineComplete : true,
    pages,
    notices: new Set(notices.map((n) => n.id)).size,
    notifications,
  };
}

export async function runCycle(
  env: Env,
  fetcher: Fetcher = fetch,
  now = new Date(),
  sendOnly = false,
  scanOnly = false,
) {
  return cycle(await effectiveEnv(env), fetcher, now, sendOnly, scanOnly);
}

export async function runScheduledCycle(
  env: Env,
  fetcher: Fetcher = fetch,
  now = new Date(),
) {
  const configured = await effectiveEnv(env);
  if (configured.MONITOR_ENABLED === "false")
    return { skipped: true as const, reason: "Scheduled monitoring is paused" };
  const state = await getState(env.DB);
  const interval = intSetting(configured.CHECK_INTERVAL_MINUTES, 15, 1440);
  if (
    state.last_success_at &&
    state.consecutive_failures === 0 &&
    now.getTime() - Date.parse(state.last_success_at) < interval * 60_000
  ) {
    return {
      skipped: true as const,
      reason: "Next configured check is not due yet",
    };
  }
  return cycle(configured, fetcher, now, false, false);
}

async function cycle(
  env: Env,
  fetcher: Fetcher,
  now: Date,
  sendOnly: boolean,
  scanOnly: boolean,
) {
  const owner = crypto.randomUUID();
  if (!(await acquireLease(env.DB, owner, now)))
    return { skipped: true as const, reason: "Another cycle holds the lease" };
  try {
    let scanResult:
      Awaited<ReturnType<typeof scan>> | { error: string } | undefined;
    if (!sendOnly) {
      try {
        scanResult = await scan(env, fetcher, now);
      } catch (error) {
        scanResult = { error: errorMessage(error) };
        await env.DB.prepare(
          "UPDATE monitor_state SET last_error = ?, consecutive_failures = consecutive_failures + 1 WHERE id = 1",
        )
          .bind(scanResult.error)
          .run();
      }
    }
    let emailResult:
      | Awaited<ReturnType<typeof sendPending>>
      | { error: string }
      | { skipped: boolean; reason: string };
    // Retry previously queued mail even while NMC is temporarily unavailable.
    try {
      emailResult = scanOnly
        ? { skipped: true, reason: "Scan only; queued emails were not sent" }
        : await sendPending(env, fetcher, now);
    } catch (error) {
      emailResult = { error: errorMessage(error) };
    }
    const ok = scanResult && !("error" in scanResult) ? scanResult : undefined;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO runs (started_at, completed_at, mode, pages, notices, notifications, error) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        now.toISOString(),
        new Date().toISOString(),
        ok?.mode ?? (sendOnly ? "send" : "scan"),
        ok?.pages ?? 0,
        ok?.notices ?? 0,
        ok?.notifications ?? 0,
        [
          scanResult && "error" in scanResult ? scanResult.error : "",
          "error" in emailResult ? emailResult.error : "",
        ]
          .filter(Boolean)
          .join("; ") || null,
      ),
      env.DB.prepare(
        "DELETE FROM runs WHERE id <= (SELECT MAX(id) - 1000 FROM runs)",
      ),
    ]);
    const result = {
      skipped: false as const,
      scan: scanResult,
      emails: emailResult,
    };
    console.log(JSON.stringify({ event: "monitor_cycle", ...result }));
    return result;
  } finally {
    await releaseLease(env.DB, owner);
  }
}
