import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../src/index";
import { migrate, reset, settings } from "./helpers";
import type { Env } from "../src/types";

beforeAll(migrate);
beforeEach(reset);
const origin = "https://monitor.example";
const password = "a-test-password-never-used-outside-tests";
function authRequest(
  path: string,
  body?: unknown,
  extra: Record<string, string> = {},
) {
  return new Request(`${origin}/admin/auth/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "X-Client-Ip": "203.0.113.21",
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}
async function setup(config: Env) {
  return app.fetch(
    authRequest(
      "setup",
      { name: "Test Admin", email: "admin@example.com", password },
      { Authorization: `Bearer ${config.ADMIN_TOKEN}` },
    ),
    config,
  );
}

describe("private admin email/password login", () => {
  it("allows only one token-protected setup and stores a password hash", async () => {
    const config = settings();
    expect(
      await (await app.fetch(authRequest("info"), config)).json(),
    ).toMatchObject({ initialized: false, ready: true });
    expect(
      (
        await app.fetch(
          authRequest("setup", {
            name: "Test",
            email: "admin@example.com",
            password,
          }),
          config,
        )
      ).status,
    ).toBe(401);
    const response = await setup(config);
    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(response.headers.get("Set-Cookie")).toContain("SameSite=Strict");
    expect(response.headers.get("Set-Cookie")).toContain("Secure");
    const stored = await config.DB.prepare(
      "SELECT password FROM auth_account",
    ).first<{ password: string }>();
    expect(stored?.password).not.toBe(password);
    expect(stored!.password.length).toBeGreaterThan(100);
    expect((await setup(config)).status).toBe(409);
    expect(
      await (await app.fetch(authRequest("info"), config)).json(),
    ).toMatchObject({ initialized: true });
    expect(
      (
        await app.fetch(
          authRequest("sign-up/email", {
            name: "Intruder",
            email: "other@example.com",
            password,
          }),
          config,
        )
      ).status,
    ).toBe(403);
  });

  it("authenticates by password and revokes a logged-out session on the server", async () => {
    const config = settings();
    await setup(config);
    const bad = await app.fetch(
      authRequest("sign-in/email", {
        email: "admin@example.com",
        password: "incorrect-password",
      }),
      config,
    );
    expect(bad.status).toBe(401);
    const login = await app.fetch(
      authRequest("sign-in/email", { email: "admin@example.com", password }),
      config,
    );
    expect(login.status).toBe(200);
    const Cookie = cookies(login);
    const profile = await app.fetch(
      new Request(`${origin}/admin/status`, { headers: { Cookie } }),
      config,
    );
    const profileData = (await profile.json()) as {
      currentUser: Record<string, unknown>;
    };
    expect(profileData.currentUser).toEqual({
      name: "Test Admin",
      email: "admin@example.com",
    });
    const request = () =>
      new Request(`${origin}/admin/settings`, { headers: { Cookie } });
    expect((await app.fetch(request(), config)).status).toBe(200);
    expect(
      (await app.fetch(request(), settings({ ADMIN_TOKEN: undefined })))
        .status,
    ).toBe(200);
    expect(
      (await app.fetch(authRequest("sign-out", {}, { Cookie }), config))
        .status,
    ).toBe(200);
    expect((await app.fetch(request(), config)).status).toBe(401);
  });

  it("rejects cross-origin writes, validates password changes, and supports explicit owner recovery", async () => {
    const config = settings();
    const session = await setup(config);
    const Cookie = cookies(session);
    expect(
      (
        await app.fetch(
          authRequest(
            "sign-in/email",
            { email: "admin@example.com", password },
            { Origin: "https://untrusted.example" },
          ),
          config,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await app.fetch(
          new Request(`${origin}/admin/settings`, {
            method: "PUT",
            headers: { Cookie, "Content-Type": "application/json" },
            body: "{}",
          }),
          config,
        )
      ).status,
    ).toBe(403);
    const changed = await app.fetch(
      authRequest(
        "change-password",
        {
          currentPassword: password,
          newPassword: "a-new-password-used-in-tests-only",
          revokeOtherSessions: true,
        },
        { Cookie },
      ),
      config,
    );
    expect(changed.status).toBe(200);
    expect(
      (
        await app.fetch(
          authRequest("sign-in/email", {
            email: "admin@example.com",
            password,
          }),
          config,
        )
      ).status,
    ).toBe(401);
    const login = await app.fetch(
      authRequest("sign-in/email", {
        email: "admin@example.com",
        password: "a-new-password-used-in-tests-only",
      }),
      config,
    );
    expect(login.status).toBe(200);
    const denied = await app.fetch(
      new Request(`${origin}/admin/account`, {
        method: "DELETE",
        headers: { Cookie: cookies(login), Origin: origin },
      }),
      config,
    );
    expect(denied.status).toBe(403);
    const recovery = await app.fetch(
      new Request(`${origin}/admin/account`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${config.ADMIN_TOKEN}` },
      }),
      config,
    );
    expect(recovery.status).toBe(200);
    expect(
      (
        await app.fetch(
          new Request(`${origin}/admin/settings`, {
            headers: { Cookie: cookies(login) },
          }),
          config,
        )
      ).status,
    ).toBe(401);
    expect(
      await (await app.fetch(authRequest("info"), config)).json(),
    ).toMatchObject({ initialized: false });
  });

  it("rate limits repeated sign-in attempts with counters stored in the database", async () => {
    const config = settings();
    await setup(config);
    const responses = [];
    for (let i = 0; i < 7; i++)
      responses.push(
        (
          await app.fetch(
            authRequest("sign-in/email", {
              email: "admin@example.com",
              password: "wrong-password",
            }),
            config,
          )
        ).status,
      );
    expect(responses).toContain(429);
  });

  it("rejects expired database sessions and invalidates cookies when the auth secret changes", async () => {
    const config = settings();
    const session = await setup(config);
    const Cookie = cookies(session);
    const request = () =>
      new Request(`${origin}/admin/status`, { headers: { Cookie } });
    expect(
      (
        await app.fetch(
          request(),
          settings({
            BETTER_AUTH_SECRET:
              "a-different-test-auth-secret-at-least-32-characters",
          }),
        )
      ).status,
    ).toBe(401);
    await config.DB.prepare("UPDATE auth_session SET expiresAt = ?")
      .bind("2000-01-01T00:00:00.000Z")
      .run();
    expect((await app.fetch(request(), config)).status).toBe(401);
  });

  it("does not create two accounts when first-time setup requests race", async () => {
    const config = settings();
    const results = await Promise.all([setup(config), setup(config)]);
    expect(results.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    expect(
      await config.DB.prepare(
        "SELECT COUNT(*) AS count FROM auth_user",
      ).first(),
    ).toMatchObject({ count: 1 });
  });
});
