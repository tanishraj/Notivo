import {
  preview,
  sendTestEmail,
  testEmailPayload,
  TestEmailError,
} from "./email";
import { runCycle, runScheduledCycle } from "./monitor";
import { getState, status } from "./store";
import { errorMessage, sha256, type Env } from "./types";
import { dismissEmail, emailHistory, noticeHistory, QueryError, runHistory } from "./portal";
import { authInfo, bootstrapAdmin, createAuth, InputError, readJson } from "./auth";
import { effectiveEnv, saveSettings, settingsView } from "./config";
import { manualEmailReview, retryFailedEmail, sendNoticeManually } from "./manual-email";
import { decideReview } from "./reviews";

const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
const json = (data: unknown, code = 200) =>
  Response.json(data, { status: code, headers });

async function authorized(request: Request, token: string): Promise<boolean> {
  const supplied = request.headers.get("Authorization") ?? "";
  if (!supplied.startsWith("Bearer ") || supplied.length > 4096) return false;
  const [actual, expected] = await Promise.all([
    sha256(supplied.slice(7)),
    sha256(token),
  ]);
  let diff = 0;
  for (let i = 0; i < actual.length; i++)
    diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      try {
        const state = await getState(env.DB);
        const configured = await settingsView(env);
        const paused = configured.values.MONITOR_ENABLED === "false";
        const maxAge = Math.max(
          3_600_000,
          Number(configured.values.CHECK_INTERVAL_MINUTES) * 120_000,
        );
        const healthy =
          state.last_success_at &&
          Date.now() - Date.parse(state.last_success_at) < maxAge &&
          state.consecutive_failures === 0;
        return json(
          {
            service: "nmc-notice-monitor",
            status: paused ? "paused" : healthy ? "ok" : "degraded",
            baselineComplete: Boolean(state.baseline_completed_at),
          },
          paused || healthy ? 200 : 503,
        );
      } catch {
        return json(
          { service: "nmc-notice-monitor", status: "database_unavailable" },
          503,
        );
      }
    }
    if (!url.pathname.startsWith("/admin/")) {
      if (!env.ASSETS || !["GET", "HEAD"].includes(request.method))
        return json({ error: "Not found" }, 404);
      const response = await env.ASSETS.fetch(request);
      const asset = new Response(response.body, response);
      asset.headers.set("X-Content-Type-Options", "nosniff");
      asset.headers.set("Referrer-Policy", "no-referrer");
      if (response.headers.get("Content-Type")?.includes("text/html")) {
        asset.headers.set("Cache-Control", "no-store");
        asset.headers.set(
          "Content-Security-Policy",
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        );
      }
      return asset;
    }
    try {
      const bearer = Boolean(
        env.ADMIN_TOKEN &&
        env.ADMIN_TOKEN.length >= 24 &&
        (await authorized(request, env.ADMIN_TOKEN)),
      );
      if (url.pathname === "/admin/auth/info" && request.method === "GET")
        return json(await authInfo(env));
      if (url.pathname.startsWith("/admin/auth/")) {
        if (
          request.method !== "GET" &&
          request.headers.get("Origin") !== url.origin
        )
          return json({ error: "Request must come from this portal" }, 403);
        if (url.pathname === "/admin/auth/setup" && request.method === "POST") {
          if (!bearer)
            return json({ error: "The setup token did not match" }, 401);
          const response = await bootstrapAdmin(env, request);
          const result = new Response(response.body, response);
          for (const [name, value] of Object.entries(headers))
            result.headers.set(name, value);
          return result;
        }
        const allowed = new Map([
          ["/admin/auth/sign-in/email", "POST"],
          ["/admin/auth/sign-out", "POST"],
          ["/admin/auth/get-session", "GET"],
          ["/admin/auth/change-password", "POST"],
        ]);
        if (allowed.get(url.pathname) !== request.method)
          return json(
            { error: "Registration is closed. Use the private admin login." },
            403,
          );
        if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32)
          return json(
            { error: "Configure BETTER_AUTH_SECRET before signing in" },
            503,
          );
        const response = await createAuth(env, request).handler(request);
        const result = new Response(response.body, response);
        for (const [name, value] of Object.entries(headers))
          result.headers.set(name, value);
        return result;
      }
      const session =
        !bearer && env.BETTER_AUTH_SECRET && env.BETTER_AUTH_SECRET.length >= 32
          ? await createAuth(env, request).api.getSession({
              headers: request.headers,
            })
          : null;
      if (!bearer && !session?.user)
        return json({ error: "Unauthorized" }, 401);
      if (!["GET", "HEAD"].includes(request.method)) {
        const origin = request.headers.get("Origin");
        if (
          (origin && origin !== url.origin) ||
          (!bearer && origin !== url.origin)
        )
          return json({ error: "Request must come from this portal" }, 403);
      }
      if (url.pathname === "/admin/session" && request.method === "POST")
        return json({ error: "Sign in with your email and password" }, 410);
      if (url.pathname === "/admin/session" && request.method === "GET")
        return json({ authenticated: true });
      if (url.pathname === "/admin/settings" && request.method === "GET")
        return json(await settingsView(env));
      if (url.pathname === "/admin/settings" && request.method === "PUT")
        return json(await saveSettings(env, request));
      if (url.pathname === "/admin/account" && request.method === "DELETE") {
        if (!bearer)
          return json(
            {
              error:
                "Use the recovery CLI with ADMIN_TOKEN to reset admin access",
            },
            403,
          );
        await env.DB.batch([
          env.DB.prepare("DELETE FROM auth_user"),
          env.DB.prepare(
            "UPDATE auth_setup SET lock_id = NULL, locked_until = NULL WHERE id = 1",
          ),
        ]);
        return json({
          reset: true,
          message:
            "Admin account and sessions removed. Create a new admin account in the portal.",
        });
      }
      if (url.pathname === "/admin/status" && request.method === "GET")
        return json({
          ...(await status(await effectiveEnv(env))),
          currentUser: session?.user
            ? { name: session.user.name, email: session.user.email }
            : null,
        });
      if (url.pathname === "/admin/notices" && request.method === "GET")
        return json(await noticeHistory(env, url));
      const review = /^\/admin\/reviews\/([^/]+)\/(send|dismiss)$/.exec(url.pathname);
      if (review && request.method === "POST")
        return json(await decideReview(env, decodeURIComponent(review[1]!), review[2] as "send" | "dismiss"));
      const manualNotice = /^\/admin\/notices\/([^/]+)\/email$/.exec(url.pathname);
      if (manualNotice && ["GET", "POST"].includes(request.method)) {
        const noticeId = decodeURIComponent(manualNotice[1]!);
        return json(request.method === "GET"
          ? await manualEmailReview(env, noticeId)
          : await sendNoticeManually(env, noticeId, request.headers.get("Idempotency-Key") ?? "", await readJson(request)));
      }
      if (url.pathname === "/admin/emails" && request.method === "GET")
        return json(await emailHistory(env, url));
      const emailAction = /^\/admin\/emails\/(automatic|manual)\/([a-f0-9]{64})\/(dismiss|restore)$/.exec(url.pathname);
      if (emailAction && request.method === "POST")
        return json(await dismissEmail(env, emailAction[1]!, emailAction[2]!, emailAction[3] === "dismiss"));
      const emailRetry = /^\/admin\/emails\/(automatic|manual)\/([a-f0-9]{64})\/retry$/.exec(url.pathname);
      if (emailRetry && request.method === "POST")
        return json(await retryFailedEmail(env, emailRetry[1]!, emailRetry[2]!, request.headers.get("Idempotency-Key") ?? ""));
      if (url.pathname === "/admin/runs" && request.method === "GET")
        return json(await runHistory(env, url));
      if (url.pathname === "/admin/test-email" && request.method === "GET")
        return json(await testEmailPayload(await effectiveEnv(env)));
      if (url.pathname === "/admin/test-email" && request.method === "POST") {
        return json(
          await sendTestEmail(
            await effectiveEnv(env),
            request.headers.get("Idempotency-Key") ?? "",
          ),
        );
      }
      if (url.pathname === "/admin/preview" && request.method === "GET") {
        const mail = await preview(await effectiveEnv(env));
        if (url.searchParams.get("format") === "json") return json(mail);
        return new Response(mail.html, {
          headers: {
            ...headers,
            "Content-Type": "text/html; charset=utf-8",
            "Content-Security-Policy":
              "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
          },
        });
      }
      if (
        ["/admin/run", "/admin/send", "/admin/check"].includes(url.pathname) &&
        request.method === "POST"
      ) {
        const result = await runCycle(
          env,
          fetch,
          new Date(),
          url.pathname === "/admin/send",
          url.pathname === "/admin/check",
        );
        const failed =
          !result.skipped &&
          ((result.scan && "error" in result.scan) ||
            (result.emails && "error" in result.emails));
        return json(result, result.skipped ? 409 : failed ? 502 : 200);
      }
      return json({ error: "Unknown route or unsupported method" }, 404);
    } catch (error) {
      if (error instanceof InputError)
        return json({ error: error.message }, error.status);
      if (error instanceof QueryError)
        return json({ error: error.message }, 400);
      if (error instanceof TestEmailError)
        return json({ error: error.message }, error.status);
      console.error(
        JSON.stringify({ event: "admin_error", message: errorMessage(error) }),
      );
      return json({ error: "Operation failed; inspect the Worker logs" }, 500);
    }
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const result = await runScheduledCycle(env);
    if (
      !result.skipped &&
      ((result.scan && "error" in result.scan) ||
        (result.emails && "error" in result.emails))
    ) {
      throw new Error(
        "Monitor cycle failed; inspect the structured monitor_cycle log and /admin/status",
      );
    }
  },
} satisfies ExportedHandler<Env>;
