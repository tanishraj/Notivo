import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowRight,
  CircleAlert,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Brand } from "./app-sidebar";
import { api } from "../api";

interface AuthInfo {
  initialized: boolean;
  ready: boolean;
  bootstrapReady: boolean;
}

export function Login({ onLogin }: { onLogin: () => void }) {
  const [info, setInfo] = useState<AuthInfo | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<AuthInfo>("auth/info", { signal: controller.signal })
      .then(setInfo)
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [retry]);
  const setup = info && !info.initialized;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (setup && password !== confirm) {
      setError("Your passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await api(setup ? "auth/setup" : "auth/sign-in/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(setup ? { Authorization: `Bearer ${token.trim()}` } : {}),
        },
        body: JSON.stringify(
          setup
            ? { name: name.trim(), email: email.trim(), password }
            : { email: email.trim(), password, rememberMe: true },
        ),
      });
      setPassword("");
      setConfirm("");
      setToken("");
      onLogin();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <div className="login-brand">
        <Brand />
      </div>
      <section className="login-panel">
        <div className="login-symbol">
          <LockKeyhole size={24} />
        </div>
        <h1>
          {setup ? (
            <>
              Make this
              <br />
              your workspace.
            </>
          ) : (
            <>
              Your notice desk,
              <br />
              all in one place.
            </>
          )}
        </h1>
        <p>
          {setup
            ? "Create the private admin account for this Notivo installation. You will use your email and password to sign in."
            : "Sign in to follow NMC notices, monitor checks, and manage your notification settings."}
        </p>
        {!info ? (
          <div className="login-status" role="status">
            {error ? (
              <>
                <p role="alert">{error}</p>
                <Button
                  variant="outline"
                  onClick={() => {
                    setError("");
                    setRetry((n) => n + 1);
                  }}
                >
                  Try again
                </Button>
              </>
            ) : (
              <>
                <LoaderCircle className="spin" size={18} /> Getting your
                workspace ready…
              </>
            )}
          </div>
        ) : !info.ready || (setup && !info.bootstrapReady) ? (
          <div className="error-notice" role="alert">
            <CircleAlert size={18} />
            <span>
              {!info.ready
                ? "Authentication needs a server secret. Locally, restart npm run dev to initialize it. On Cloudflare, set BETTER_AUTH_SECRET."
                : "Set ADMIN_TOKEN on the server to protect the initial account setup."}
            </span>
          </div>
        ) : (
          <form onSubmit={submit}>
            {setup ? (
              <div className="login-field">
                <label htmlFor="admin-name">Your name</label>
                <Input
                  id="admin-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={80}
                  autoComplete="name"
                  disabled={busy}
                />
              </div>
            ) : null}
            <div className="login-field">
              <label htmlFor="login-email">Email address</label>
              <Input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                maxLength={254}
                autoComplete="username"
                autoFocus={!setup}
                disabled={busy}
              />
            </div>
            <div className="login-field">
              <label htmlFor="login-password">
                {setup ? "Create a password" : "Password"}
              </label>
              <Input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={setup ? 12 : undefined}
                maxLength={128}
                autoComplete={setup ? "new-password" : "current-password"}
                disabled={busy}
                aria-describedby={setup ? "password-help" : undefined}
              />
              {setup ? (
                <p id="password-help" className="field-help">
                  Use at least 12 characters.
                </p>
              ) : null}
            </div>
            {setup ? (
              <>
                <div className="login-field">
                  <label htmlFor="confirm-password">Confirm password</label>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    minLength={12}
                    maxLength={128}
                    autoComplete="new-password"
                    disabled={busy}
                  />
                </div>
                <div className="login-field setup-token">
                  <label htmlFor="setup-token">One-time setup token</label>
                  <Input
                    id="setup-token"
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    required
                    minLength={24}
                    autoComplete="off"
                    disabled={busy}
                  />
                  <p className="field-help">
                    Use ADMIN_TOKEN from your server configuration to claim this
                    installation. You will not need it for future logins.
                  </p>
                </div>
              </>
            ) : null}
            {error ? (
              <div className="error-notice" role="alert">
                <CircleAlert size={18} />
                <span>{error}</span>
              </div>
            ) : null}
            <Button type="submit" disabled={busy} className="login-button">
              {busy ? <LoaderCircle className="spin" /> : null}
              {busy
                ? "Please wait…"
                : setup
                  ? "Create admin account"
                  : "Sign in"}
              <ArrowRight size={17} />
            </Button>
          </form>
        )}
        <div className="login-security">
          <ShieldCheck size={15} /> Private access · session expires after 8
          hours
        </div>
        {info?.initialized ? (
          <p className="login-recovery">
            Lost access? The installation owner can reset admin access with the
            recovery CLI.
          </p>
        ) : null}
      </section>
      <p className="login-footer">
        Independent monitoring. Original documents from NMC.
      </p>
    </main>
  );
}
