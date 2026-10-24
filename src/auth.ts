import { betterAuth } from "better-auth";
import type { Env } from "./types";

export function createAuth(env: Env, request: Request, allowSignup = false) {
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) {
    throw new Error("Configure BETTER_AUTH_SECRET with at least 32 characters");
  }
  const origin = new URL(request.url).origin;
  return betterAuth({
    appName: "Notivo",
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: origin,
    basePath: "/admin/auth",
    trustedOrigins: [origin],
    emailAndPassword: {
      enabled: true,
      disableSignUp: !allowSignup,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    user: { modelName: "auth_user" },
    session: {
      modelName: "auth_session",
      expiresIn: 8 * 60 * 60,
      disableSessionRefresh: true,
    },
    account: { modelName: "auth_account" },
    verification: { modelName: "auth_verification" },
    advanced: {
      cookiePrefix: "notivo",
      useSecureCookies: origin.startsWith("https:"),
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "strict",
        path: "/admin",
      },
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "auth_rate_limit",
      window: 60,
      max: 60,
      customRules: { "/sign-in/email": { window: 60, max: 5 } },
    },
    // Passwords, tokens and provider payloads must never appear in logs.
    logger: { disabled: true },
  });
}

export class InputError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export async function readJson(
  request: Request,
): Promise<Record<string, unknown>> {
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    throw new InputError("Send a JSON request", 415);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 16_384)
    throw new InputError("Request is too large", 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new InputError("Invalid JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new InputError("Expected a JSON object");
  return body as Record<string, unknown>;
}

export async function authInfo(env: Env) {
  const user = await env.DB.prepare("SELECT id FROM auth_user LIMIT 1").first();
  return {
    initialized: Boolean(user),
    ready: Boolean(
      env.BETTER_AUTH_SECRET && env.BETTER_AUTH_SECRET.length >= 32,
    ),
    bootstrapReady: Boolean(env.ADMIN_TOKEN && env.ADMIN_TOKEN.length >= 24),
  };
}

export async function bootstrapAdmin(env: Env, request: Request) {
  const data = await readJson(request);
  if (
    typeof data.email !== "string" ||
    !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(data.email) ||
    data.email.length > 254
  )
    throw new InputError("Enter a valid email address");
  if (
    typeof data.name !== "string" ||
    !data.name.trim() ||
    data.name.trim().length > 80
  )
    throw new InputError("Enter a name of up to 80 characters");
  if (
    typeof data.password !== "string" ||
    data.password.length < 12 ||
    data.password.length > 128
  )
    throw new InputError("Use a password with 12–128 characters");
  const auth = createAuth(env, request, true);
  const owner = crypto.randomUUID();
  const lock = await env.DB.prepare(
    `UPDATE auth_setup SET lock_id = ?, locked_until = ? WHERE id = 1
    AND (locked_until IS NULL OR locked_until < ?) AND NOT EXISTS (SELECT 1 FROM auth_user)`,
  )
    .bind(owner, Date.now() + 120_000, Date.now())
    .run();
  if (lock.meta.changes !== 1)
    throw new InputError(
      "Admin setup is already complete or in progress. Sign in instead.",
      409,
    );
  try {
    return await auth.api.signUpEmail({
      body: {
        name: data.name.trim(),
        email: data.email.trim().toLowerCase(),
        password: data.password,
      },
      headers: request.headers,
      asResponse: true,
    });
  } finally {
    await env.DB.prepare(
      "UPDATE auth_setup SET lock_id = NULL, locked_until = NULL WHERE id = 1 AND lock_id = ?",
    )
      .bind(owner)
      .run();
  }
}
