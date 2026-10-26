export type Page = "overview" | "notices" | "emails" | "runs" | "settings";
export interface Run {
  id: number;
  started_at: string;
  completed_at: string;
  mode: string;
  pages: number;
  notices: number;
  notifications: number;
  error: string | null;
}
export type EmailStatus =
  "pending" | "accepted" | "failed" | "uncertain" | "cancelled";
export interface UserProfile {
  name: string;
  email: string;
}
export interface Status {
  currentUser: UserProfile | null;
  state: {
    source_total: number | null;
    baseline_completed_at: string | null;
    baseline_next_page: number;
    audit_next_page: number;
    last_success_at: string | null;
    last_error: string | null;
    consecutive_failures: number;
  };
  counts: { notices: number };
  emails: { status: EmailStatus; count: number }[];
  recentRuns: Run[];
  emailEnabled: boolean;
  monitorEnabled: boolean;
  checkIntervalMinutes: number;
  configured: {
    adminToken: boolean;
    recipients: boolean;
    sender: boolean;
    resend: boolean;
  };
}
export interface Notice {
  id: string;
  title: string;
  published_on: string | null;
  document_url: string | null;
  first_seen_at: string;
  last_seen_at: string;
  kind: "new" | "updated" | "baseline";
  version_count: number;
}
export interface Email {
  id: string;
  notice_id: string;
  title: string;
  recipient: string;
  status: EmailStatus;
  attempts: number;
  created_at: string;
  next_attempt_at: string;
  accepted_at: string | null;
  last_error: string | null;
  resend_id: string | null;
  document_url: string | null;
  kind: "new" | "updated";
  delivery_source: "automatic" | "manual";
}
export interface List<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
