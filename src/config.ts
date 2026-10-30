import { intSetting, recipients, type Env } from "./types";
import { InputError, readJson } from "./auth";

export interface AppConfig {
  EMAIL_TO: string;
  EMAIL_FROM: string;
  EMAIL_ENABLED: string;
  MONITOR_ENABLED: string;
  CHECK_INTERVAL_MINUTES: string;
  RECENT_PAGES: string;
  BASELINE_PAGES_PER_RUN: string;
  AUDIT_PAGES_PER_RUN: string;
  EMAILS_PER_RUN: string;
}
interface SettingsRow {
  config_json: string;
  resend_cipher: string | null;
  revision: number;
  updated_at: string | null;
}
const defaults: AppConfig = {
  EMAIL_TO: "",
  EMAIL_FROM: "",
  EMAIL_ENABLED: "false",
  MONITOR_ENABLED: "true",
  CHECK_INTERVAL_MINUTES: "15",
  RECENT_PAGES: "3",
  BASELINE_PAGES_PER_RUN: "3",
  AUDIT_PAGES_PER_RUN: "2",
  EMAILS_PER_RUN: "5",
};
const intervalOptions = ["15", "30", "60", "120", "360", "720", "1440"];

async function row(env: Env): Promise<SettingsRow> {
  const result = await env.DB.prepare(
    "SELECT config_json, resend_cipher, revision, updated_at FROM app_settings WHERE id = 1",
  ).first<SettingsRow>();
  if (!result)
    throw new Error("Apply database migrations before using settings");
  return result;
}

function values(env: Env, stored: SettingsRow): AppConfig {
  const overrides = JSON.parse(stored.config_json) as Partial<AppConfig>;
  return Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => [
      key,
      overrides[key as keyof AppConfig] ??
        env[key as keyof AppConfig] ??
        fallback,
    ]),
  ) as unknown as AppConfig;
}

async function encryptionKey(env: Env) {
  if (!/^[a-fA-F0-9]{64}$/.test(env.SETTINGS_ENCRYPTION_KEY ?? ""))
    throw new InputError(
      "Configure a 64-character hex SETTINGS_ENCRYPTION_KEY before saving a Resend key",
      503,
    );
  const raw = Uint8Array.from(
    env.SETTINGS_ENCRYPTION_KEY!.match(/../g)!,
    (part) => parseInt(part, 16),
  );
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (base64: string) =>
  Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

async function encrypt(env: Env, value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode("notivo:resend:v1"),
    },
    await encryptionKey(env),
    new TextEncoder().encode(value),
  );
  return `v1.${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
}
async function decrypt(env: Env, value: string) {
  const [version, iv, cipher] = value.split(".");
  if (version !== "v1" || !iv || !cipher)
    throw new Error("Stored Resend key is invalid");
  try {
    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decode(iv),
        additionalData: new TextEncoder().encode("notivo:resend:v1"),
      },
      await encryptionKey(env),
      decode(cipher),
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    throw new Error(
      "Cannot decrypt the saved Resend key; restore SETTINGS_ENCRYPTION_KEY or replace the key in settings",
    );
  }
}

export async function effectiveEnv(env: Env): Promise<Env> {
  const stored = await row(env);
  return {
    ...env,
    ...values(env, stored),
    RESEND_API_KEY:
      stored.resend_cipher === null
        ? env.RESEND_API_KEY
        : stored.resend_cipher === ""
          ? ""
          : await decrypt(env, stored.resend_cipher),
  };
}

export async function settingsView(env: Env) {
  const stored = await row(env);
  return {
    values: values(env, stored),
    revision: stored.revision,
    updatedAt: stored.updated_at,
    resendConfigured:
      stored.resend_cipher === null
        ? Boolean(env.RESEND_API_KEY)
        : Boolean(stored.resend_cipher),
    resendSource:
      stored.resend_cipher === null && env.RESEND_API_KEY
        ? "environment"
        : stored.resend_cipher
          ? "dashboard"
          : "none",
    encryptionReady: /^[a-fA-F0-9]{64}$/.test(
      env.SETTINGS_ENCRYPTION_KEY ?? "",
    ),
  };
}

export async function saveSettings(env: Env, request: Request) {
  const body = await readJson(request);
  if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 0)
    throw new InputError(
      "A settings revision is required. Reload settings and try again.",
    );
  const incoming = body.values;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming))
    throw new InputError("Settings values are required");
  const data = incoming as Record<string, unknown>;
  const config = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof AppConfig)[]) {
    if (typeof data[key] !== "string")
      throw new InputError(`Missing or invalid ${key}`);
    config[key] = (data[key] as string).trim();
  }
  try {
    config.EMAIL_TO = recipients({ ...env, EMAIL_TO: config.EMAIL_TO }).join(
      ", ",
    );
  } catch {
    throw new InputError(
      "Enter 1–20 valid recipient email addresses, separated by commas",
    );
  }
  if (
    config.EMAIL_FROM.length > 320 ||
    /[\r\n]/.test(config.EMAIL_FROM) ||
    !/^(?:[^<>]+\s+<[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>|[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)$/.test(
      config.EMAIL_FROM,
    )
  )
    throw new InputError(
      "Enter a valid sender email, optionally with a display name",
    );
  for (const key of ["EMAIL_ENABLED", "MONITOR_ENABLED"] as const)
    if (!["true", "false"].includes(config[key]))
      throw new InputError(`Invalid ${key}`);
  if (!intervalOptions.includes(config.CHECK_INTERVAL_MINUTES))
    throw new InputError("Choose a supported monitoring interval");
  for (const [key, max] of [
    ["RECENT_PAGES", 3],
    ["BASELINE_PAGES_PER_RUN", 3],
    ["AUDIT_PAGES_PER_RUN", 2],
    ["EMAILS_PER_RUN", 5],
  ] as const) {
    try {
      intSetting(config[key], defaults[key] ? Number(defaults[key]) : 1, max);
    } catch {
      throw new InputError(`${key} must be between 1 and ${max}`);
    }
  }
  const current = await row(env);
  let cipher = current.resend_cipher;
  if (
    body.clearResendKey !== undefined &&
    typeof body.clearResendKey !== "boolean"
  )
    throw new InputError("Invalid clear key option");
  if (body.resendKey !== undefined && typeof body.resendKey !== "string")
    throw new InputError("Invalid Resend API key");
  const replacement =
    typeof body.resendKey === "string" ? body.resendKey.trim() : "";
  if (replacement && body.clearResendKey)
    throw new InputError("Choose either replacing or removing the Resend key");
  if (replacement) {
    if (
      !replacement.startsWith("re_") ||
      replacement.length < 10 ||
      replacement.length > 1024 ||
      /\s/.test(replacement)
    )
      throw new InputError("Enter a valid Resend API key starting with re_");
    cipher = await encrypt(env, replacement);
  } else if (body.clearResendKey) cipher = "";
  if (
    config.EMAIL_ENABLED === "true" &&
    !(cipher === null ? env.RESEND_API_KEY : cipher)
  )
    throw new InputError("Add a Resend API key before enabling email sending");
  const result = await env.DB.prepare(
    `UPDATE app_settings SET config_json = ?, resend_cipher = ?, revision = revision + 1, updated_at = ? WHERE id = 1 AND revision = ?`,
  )
    .bind(
      JSON.stringify(config),
      cipher,
      new Date().toISOString(),
      body.revision,
    )
    .run();
  if (result.meta.changes !== 1)
    throw new InputError(
      "Settings changed in another session. Reload settings before saving again.",
      409,
    );
  return settingsView(env);
}
