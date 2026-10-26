import { useEffect, useState, type FormEvent } from "react";
import {
  Check,
  CircleAlert,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Save,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { api, ApiError } from "../api";
import { RecipientsInput } from "./recipients-input";
import { SendTestEmail } from "./email-actions";
import { mergeRecipients, splitRecipients } from "../lib/recipients";
import type { UserProfile } from "../types";

type Config = Record<
  | "EMAIL_TO"
  | "EMAIL_FROM"
  | "EMAIL_ENABLED"
  | "MONITOR_ENABLED"
  | "CHECK_INTERVAL_MINUTES"
  | "RECENT_PAGES"
  | "BASELINE_PAGES_PER_RUN"
  | "AUDIT_PAGES_PER_RUN"
  | "EMAILS_PER_RUN",
  string
>;
interface SettingsData {
  values: Config;
  revision: number;
  updatedAt: string | null;
  resendConfigured: boolean;
  resendSource: string;
  encryptionReady: boolean;
}

function Feedback({ error, success }: { error?: string; success?: string }) {
  return error ? (
    <div className="error-notice" role="alert">
      <CircleAlert size={18} />
      <span>{error}</span>
    </div>
  ) : success ? (
    <div className="success-notice" role="status">
      <Check size={18} />
      <span>{success}</span>
    </div>
  ) : null;
}

export function Settings({
  onSaved,
  onExpired,
  currentUser,
}: {
  onSaved: () => void;
  onExpired: () => void;
  currentUser: UserProfile | null;
}) {
  const [recipientEntry, setRecipientEntry] = useState("");
  const [recipientError, setRecipientError] = useState("");
  const [saved, setSaved] = useState<SettingsData | null>(null);
  const [draft, setDraft] = useState<Config | null>(null);
  const [key, setKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    api<SettingsData>("settings", { signal: controller.signal })
      .then((result) => {
        setSaved(result);
        setDraft(result.values);
        setError("");
        setKey("");
        setClearKey(false);
        setRecipientEntry("");
        setRecipientError("");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) onExpired();
        setError(error.message);
      });
    return () => controller.abort();
  }, [revision, onExpired]);
  const dirty = Boolean(
    saved &&
    draft &&
    (JSON.stringify(draft) !== JSON.stringify(saved.values) ||
      key.trim() ||
      recipientEntry.trim() ||
      clearKey),
  );
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function update(name: keyof Config, value: string) {
    setDraft((old) => (old ? { ...old, [name]: value } : old));
    setSuccess("");
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!saved || !draft) return;
    let emails: string[];
    try {
      emails = mergeRecipients(splitRecipients(draft.EMAIL_TO), recipientEntry);
      if (!emails.length) throw new Error("Add at least one recipient.");
      setRecipientError("");
    } catch (error) {
      setRecipientError((error as Error).message);
      document.getElementById("email-to")?.focus();
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const result = await api<SettingsData>("settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          values: { ...draft, EMAIL_TO: emails.join(", ") },
          revision: saved.revision,
          resendKey: key,
          clearResendKey: clearKey,
        }),
      });
      setSaved(result);
      setDraft(result.values);
      setKey("");
      setClearKey(false);
      setRecipientEntry("");
      setRecipientError("");
      setSuccess(
        "Settings saved. Subsequent checks and send cycles will use these values. No email was sent.",
      );
      onSaved();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onExpired();
      setError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordError("");
    setPasswordSuccess("");
    if (newPassword !== confirmPassword) {
      setPasswordError("Your new passwords do not match.");
      return;
    }
    setPasswordBusy(true);
    try {
      await api("auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          revokeOtherSessions: true,
        }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSuccess(
        "Password updated. Other sessions have been signed out.",
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onExpired();
      setPasswordError((error as Error).message);
    } finally {
      setPasswordBusy(false);
    }
  }
  if (!draft || !saved)
    return (
      <section className="panel">
        <div className="loading-state">
          {error ? (
            <div>
              <Feedback error={error} />
              <Button
                variant="outline"
                onClick={() => setRevision((n) => n + 1)}
              >
                Try again
              </Button>
            </div>
          ) : (
            <>
              <LoaderCircle className="spin" size={18} /> Loading settings…
            </>
          )}
        </div>
      </section>
    );
  return (
    <div className="editable-settings">
      <div className="settings-main">
        <form onSubmit={save} className="settings-form">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Email notifications</h2>
                <p>Choose who hears about new NMC announcements.</p>
              </div>
              <Settings2 size={20} className="muted" />
            </div>
            <fieldset disabled={saving} className="settings-fields">
              <div className="form-field">
                <label htmlFor="email-to">Recipients</label>
                <RecipientsInput
                  value={draft.EMAIL_TO}
                  entry={recipientEntry}
                  error={recipientError}
                  disabled={saving}
                  onChange={(value) => update("EMAIL_TO", value)}
                  onEntryChange={(value) => {
                    setRecipientEntry(value);
                    setSuccess("");
                  }}
                  onError={setRecipientError}
                  suggestions={[
                    ...(currentUser ? [currentUser] : []),
                    ...splitRecipients(saved.values.EMAIL_TO).map((email) => ({
                      name: "",
                      email,
                    })),
                  ]}
                />
              </div>
              <div className="form-field">
                <label htmlFor="email-from">Sender address</label>
                <Input
                  id="email-from"
                  value={draft.EMAIL_FROM}
                  onChange={(e) => update("EMAIL_FROM", e.target.value)}
                  required
                  maxLength={320}
                  placeholder="NMC Notices <notices@your-domain.com>"
                  aria-describedby="sender-help"
                />
                <p id="sender-help">
                  Use a verified Resend sender. The onboarding@resend.dev sender
                  can only email your Resend account address.
                </p>
              </div>
              <div className="form-field">
                <div className="field-label-row">
                  <label htmlFor="resend-key">Resend API key</label>
                  <span
                    className={`badge ${saved.resendConfigured ? "badge-green" : "badge-amber"}`}
                  >
                    {saved.resendConfigured
                      ? "Key configured"
                      : "No key configured"}
                  </span>
                </div>
                <Input
                  id="resend-key"
                  type="password"
                  value={key}
                  onChange={(e) => {
                    setKey(e.target.value);
                    setClearKey(false);
                    setSuccess("");
                  }}
                  placeholder={
                    saved.resendConfigured
                      ? "Leave blank to keep the current key"
                      : "re_…"
                  }
                  autoComplete="off"
                  maxLength={1024}
                  disabled={!saved.encryptionReady}
                  aria-describedby="key-help"
                />
                <p id="key-help">
                  {saved.encryptionReady
                    ? `New keys are encrypted in D1 and never shown again.${saved.resendSource === "environment" ? " The current key comes from the server environment." : ""}`
                    : "Set SETTINGS_ENCRYPTION_KEY on the server to enable encrypted key storage."}
                </p>
                {saved.resendConfigured ? (
                  <label className="checkbox-label remove-key">
                    <Checkbox
                      checked={clearKey}
                      disabled={saving}
                      onCheckedChange={(checked) => {
                        setClearKey(checked === true);
                        if (checked === true) {
                          setKey("");
                          update("EMAIL_ENABLED", "false");
                        }
                      }}
                    />
                    <span>Remove the current key when saving</span>
                  </label>
                ) : null}
              </div>
              <label className="toggle-row">
                <span>
                  <strong>Email sending</strong>
                  <small>
                    Allow scheduled cycles to send queued notice alerts.
                  </small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={draft.EMAIL_ENABLED === "true"}
                  onChange={(e) =>
                    update("EMAIL_ENABLED", String(e.target.checked))
                  }
                />
              </label>
              {draft.EMAIL_ENABLED !== saved.values.EMAIL_ENABLED &&
              draft.EMAIL_ENABLED === "true" ? (
                <p className="enable-notice">
                  <CircleAlert size={16} /> Saving will enable real email
                  sending on the next scheduled send cycle, including queued
                  notices.
                </p>
              ) : null}
              <SendTestEmail
                key={saved.revision}
                sender={saved.values.EMAIL_FROM}
                recipient={saved.values.EMAIL_TO}
                disabledReason={dirty || saving
                  ? "Save your settings before sending a test email."
                  : saved.values.EMAIL_ENABLED !== "true"
                    ? "Enable email sending and save settings before sending a test."
                    : !saved.resendConfigured
                      ? "Configure a Resend API key before sending a test."
                      : splitRecipients(saved.values.EMAIL_TO).length !== 1
                        ? "A test sends to exactly one recipient. Save a single recipient to use this action."
                        : ""}
                onExpired={onExpired}
              />
            </fieldset>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Monitoring</h2>
                <p>Set the pace of your notice checks.</p>
              </div>
              <ShieldCheck size={20} className="muted" />
            </div>
            <fieldset disabled={saving} className="settings-fields">
              <label className="toggle-row">
                <span>
                  <strong>Automatic monitoring</strong>
                  <small>
                    Pause scheduled checks and sends. Manual checks remain
                    available.
                  </small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={draft.MONITOR_ENABLED === "true"}
                  onChange={(e) =>
                    update("MONITOR_ENABLED", String(e.target.checked))
                  }
                />
              </label>
              <div className="form-field">
                <label htmlFor="check-interval">Minimum check interval</label>
                <Select
                  value={draft.CHECK_INTERVAL_MINUTES}
                  onValueChange={(value) =>
                    update("CHECK_INTERVAL_MINUTES", value)
                  }
                  disabled={saving}
                >
                  <SelectTrigger
                    id="check-interval"
                    aria-describedby="interval-help"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {[
                      ["15", "15 minutes"],
                      ["30", "30 minutes"],
                      ["60", "1 hour"],
                      ["120", "2 hours"],
                      ["360", "6 hours"],
                      ["720", "12 hours"],
                      ["1440", "24 hours"],
                    ].map(([value, label]) => (
                      <SelectItem key={value} value={value!}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p id="interval-help">
                  NMC scans follow this interval. Cloudflare wakes every minute
                  to send due queued emails independently of scans.
                </p>
              </div>
              <details className="advanced-settings">
                <summary>Advanced limits</summary>
                <div className="advanced-fields">
                  {(
                    [
                      ["RECENT_PAGES", "Recent pages per check", 3],
                      ["BASELINE_PAGES_PER_RUN", "Archive pages per import", 3],
                      ["AUDIT_PAGES_PER_RUN", "Older pages per audit", 2],
                      ["EMAILS_PER_RUN", "Emails per send cycle", 5],
                    ] as const
                  ).map(([name, label, max]) => (
                    <div className="form-field" key={name}>
                      <label htmlFor={name}>{label}</label>
                      <Input
                        id={name}
                        type="number"
                        min={1}
                        max={max}
                        step={1}
                        required
                        value={draft[name]}
                        onChange={(e) => update(name, e.target.value)}
                      />
                      <p>Between 1 and {max}.</p>
                    </div>
                  ))}
                </div>
              </details>
            </fieldset>
          </section>
          <Feedback error={error} success={success} />
          <div className="settings-save-bar">
            <span>
              {dirty
                ? "You have unsaved changes"
                : saved.updatedAt
                  ? "All changes saved"
                  : "Using initial server configuration"}
            </span>
            <div>
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => {
                  setSuccess("");
                  setRevision((n) => n + 1);
                }}
              >
                Reload settings
              </Button>
              <Button type="submit" disabled={!dirty || saving}>
                {saving ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Save size={16} />
                )}{" "}
                {saving ? "Saving…" : "Save settings"}
              </Button>
            </div>
          </div>
        </form>
        <section className="panel account-settings">
          <div className="panel-heading">
            <div>
              <h2>Your password</h2>
              <p>Keep access to this private workspace in your hands.</p>
            </div>
            <LockKeyhole size={20} className="muted" />
          </div>
          <form onSubmit={changePassword}>
            <fieldset disabled={passwordBusy} className="settings-fields">
              <div className="form-field">
                <label htmlFor="current-password">Current password</label>
                <Input
                  id="current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  maxLength={128}
                />
              </div>
              <div className="password-fields">
                <div className="form-field">
                  <label htmlFor="new-password">New password</label>
                  <Input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="repeat-password">Confirm new password</label>
                  <Input
                    id="repeat-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                  />
                </div>
              </div>
              <p className="field-help">
                Use at least 12 characters. Updating your password signs out
                other sessions.
              </p>
              <Feedback error={passwordError} success={passwordSuccess} />
              <Button type="submit" variant="outline" disabled={passwordBusy}>
                {passwordBusy ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <KeyRound size={16} />
                )}
                Update password
              </Button>
            </fieldset>
          </form>
        </section>
      </div>
      <aside className="settings-info">
        <h2>
          Your workspace.
          <br />
          Your preferences.
        </h2>
        <p>
          These settings are saved in Cloudflare D1 and apply to future checks
          and sends. Your credentials stay private.
        </p>
        <dl>
          <div>
            <dt>Notice source</dt>
            <dd>NMC · What’s New</dd>
          </div>
          <div>
            <dt>Storage</dt>
            <dd>Cloudflare D1</dd>
          </div>
          <div>
            <dt>Email provider</dt>
            <dd>Resend</dd>
          </div>
        </dl>
        <p className="schedule-note">
          Changing recipients affects newly detected notices. Emails already in
          the queue keep their original recipients and retry payloads.
        </p>
        <p className="schedule-note">
          Saving settings sends no email. To test a notice scan without sending,
          use “Check for notices”.
        </p>
      </aside>
    </div>
  );
}
