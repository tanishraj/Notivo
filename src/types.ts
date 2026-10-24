export interface Env {
  DB: D1Database;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  ADMIN_TOKEN?: string;
  BETTER_AUTH_SECRET?: string;
  SETTINGS_ENCRYPTION_KEY?: string;
  MONITOR_ENABLED?: string;
  CHECK_INTERVAL_MINUTES?: string;
  EMAIL_ENABLED?: string;
  EMAIL_TO?: string;
  EMAIL_FROM?: string;
  RESEND_API_KEY?: string;
  RECENT_PAGES?: string;
  BASELINE_PAGES_PER_RUN?: string;
  AUDIT_PAGES_PER_RUN?: string;
  EMAILS_PER_RUN?: string;
}

export interface Notice {
  id: string;
  title: string;
  publishedOn: string | null;
  documentUrl: string | null;
}

export interface Listing {
  notices: Notice[];
  page: number;
  lastPage: number;
  total: number;
}

export interface State {
  source_total: number | null;
  baseline_next_page: number;
  baseline_completed_at: string | null;
  audit_next_page: number;
  audit_due_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
}

export interface Version {
  id: string;
  notice_id: string;
  kind: "new" | "updated";
  title: string;
  published_on: string | null;
  document_url: string | null;
  detected_at: string;
}

export interface MailPayload {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
}

export type Fetcher = typeof fetch;

export const SOURCE_URL = "https://nmc.org.in/whats-new";
export const RESEND_URL = "https://api.resend.com/emails";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function sha256(value: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(hash)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}

export function intSetting(
  value: string | undefined,
  fallback: number,
  max: number,
): number {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) {
    throw new Error(
      `Invalid numeric setting: expected an integer between 1 and ${max}`,
    );
  }
  return number;
}

export function recipients(env: Env): string[] {
  const values = [
    ...new Set(
      (env.EMAIL_TO ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (
    !values.length ||
    values.length > 20 ||
    values.some((v) => !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(v))
  ) {
    throw new Error(
      "Set EMAIL_TO to 1–20 comma-separated email addresses before monitoring new notices",
    );
  }
  return values;
}
