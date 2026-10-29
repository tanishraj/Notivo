import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  Eye,
  FileText,
  LoaderCircle,
  LockKeyhole,
  Mail,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { Dialog, Tabs } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { AppSidebar, Brand } from "./components/app-sidebar";
import { api, ApiError } from "./api";
import { Login } from "./components/login";
import { Settings } from "./components/settings";
import { EmailActionResult, SendPendingEmails } from "./components/email-actions";
import { ArchiveEmail } from "./components/archive-email";
import { ReviewQueue } from "./components/review-queue";
import type { Email, List, Notice, Page, Run, Status } from "./types";

const titles: Record<Page, string> = {
  overview: "Overview",
  notices: "Notice archive",
  emails: "Email activity",
  runs: "Check history",
  settings: "Configuration",
};
const dateFormat = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const timeFormat = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const numberFormat = new Intl.NumberFormat("en");
function date(value: string | null, time = false) {
  return value
    ? (time ? timeFormat : dateFormat).format(
        new Date(value.length === 10 ? `${value}T12:00:00` : value),
      )
    : "Not available";
}
function ago(value: string | null) {
  if (!value) return "No checks yet";
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(value)) / 60000),
  );
  return minutes < 1
    ? "Just now"
    : minutes < 60
      ? `${minutes} min ago`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)} hr ago`
        : `${Math.floor(minutes / 1440)} days ago`;
}
function cleanTitle(title: string) {
  return title.replace(/^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}\s*[-–—:]?\s*/, "");
}
function pageFromHash(): Page {
  const key = window.location.hash.slice(1);
  return Object.hasOwn(titles, key) ? (key as Page) : "overview";
}

function useList<T>(path: string, revision: number, onExpired: () => void) {
  const [state, setState] = useState<{
    path: string;
    data?: List<T>;
    error?: string;
    loading: boolean;
  }>({ path, loading: true });
  useEffect(() => {
    const controller = new AbortController();
    setState((old) => ({
      path,
      data: old.path === path ? old.data : undefined,
      loading: true,
    }));
    api<List<T>>(path, { signal: controller.signal })
      .then((data) => setState({ path, data, loading: false }))
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) onExpired();
        setState({ path, error: error.message, loading: false });
      });
    return () => controller.abort();
  }, [path, revision, onExpired]);
  return state.path === path ? state : { path, loading: true };
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
function Empty({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon}
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Loading() {
  return (
    <div className="loading-state" role="status">
      <LoaderCircle className="spin" size={20} /> Loading activity…
    </div>
  );
}
function ErrorNotice({
  children,
  onRetry,
}: {
  children: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div className="error-notice" role="alert">
      <CircleAlert size={18} />
      <span>{children}</span>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
function OriginalLink({
  url,
  title,
  compact = false,
}: {
  url: string | null;
  title: string;
  compact?: boolean;
}) {
  if (!url)
    return compact ? (
      <span
        className="document-icon muted"
        role="img"
        aria-label="No document available"
      >
        <FileText size={16} />
      </span>
    ) : (
      <span className="muted text-sm">No document</span>
    );
  return (
    <a
      className={compact ? "document-icon" : "text-link"}
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open original document: ${cleanTitle(title)}`}
    >
      {compact ? (
        <ArrowUpRight size={19} />
      ) : (
        <>
          Open document <ArrowUpRight size={15} />
        </>
      )}
    </a>
  );
}
function Pagination({
  data,
  onPage,
  loading,
}: {
  data: List<unknown>;
  onPage: (n: number) => void;
  loading: boolean;
}) {
  const start = data.total ? (data.page - 1) * data.pageSize + 1 : 0;
  return (
    <div className="pagination">
      <p>
        {start}–{Math.min(data.page * data.pageSize, data.total)} of{" "}
        {numberFormat.format(data.total)}
      </p>
      <div>
        <Button
          variant="outline"
          size="sm"
          disabled={data.page === 1 || loading}
          onClick={() => onPage(data.page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft size={16} />
          <span>Previous</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={data.page * data.pageSize >= data.total || loading}
          onClick={() => onPage(data.page + 1)}
          aria-label="Next page"
        >
          <span>Next</span>
          <ChevronRight size={16} />
        </Button>
      </div>
    </div>
  );
}

function NoticeRows({
  items,
  compact = false,
  onEmail,
}: {
  items: Notice[];
  compact?: boolean;
  onEmail?: (notice: Notice) => void;
}) {
  return (
    <div className={compact ? "notice-list compact" : "notice-list"}>
      {items.map((notice) => (
        <article className={`notice-row${onEmail ? " notice-row-with-email" : ""}`} key={notice.id}>
          <div className="notice-file">
            <FileText size={20} strokeWidth={1.6} />
          </div>
          <div className="notice-content">
            <div className="notice-meta">
              <span>NMC · {notice.id}</span>
              {notice.kind === "new" ? (
                <Badge tone="green">New</Badge>
              ) : notice.kind === "updated" ? (
                <Badge tone="blue">Updated</Badge>
              ) : null}
            </div>
            <h3>
              {notice.document_url ? (
                <a href={notice.document_url} target="_blank" rel="noreferrer">
                  {cleanTitle(notice.title)}
                </a>
              ) : (
                cleanTitle(notice.title)
              )}
            </h3>
            {!compact ? (
              <p className="notice-tracking">
                {notice.removed_at
                  ? "Removed by NMC · "
                  : ""}
                {notice.kind === "baseline"
                  ? "Imported from archive"
                  : `First seen ${date(notice.first_seen_at, true)}`}
                {notice.version_count > 1
                  ? ` · ${notice.version_count} recorded versions`
                  : ""}
              </p>
            ) : null}
          </div>
          <div className="notice-date">
            <time dateTime={notice.published_on ?? undefined}>
              {date(notice.published_on)}
            </time>
          </div>
          {onEmail ? <div className="notice-row-actions">
            <Button variant="outline" size="sm" onClick={() => onEmail(notice)} aria-label={`Email notice ${notice.id}`}>
              <Mail size={15} /><span>Email notice</span>
            </Button>
            <OriginalLink url={notice.document_url} title={notice.title} compact />
          </div> : <OriginalLink url={notice.document_url} title={notice.title} compact />}
        </article>
      ))}
    </div>
  );
}

function Overview({
  status,
  revision,
  navigate,
  onExpired,
  retry,
}: {
  status: Status;
  revision: number;
  navigate: (page: Page) => void;
  onExpired: () => void;
  retry: () => void;
}) {
  const notices = useList<Notice>("notices", revision, onExpired);
  const counts = Object.fromEntries(
    status.emails.map((e) => [e.status, e.count]),
  );
  const healthy = Boolean(
    status.monitorEnabled &&
    status.state.baseline_completed_at &&
    status.state.last_success_at &&
    Date.now() - Date.parse(status.state.last_success_at) <
      Math.max(3600000, status.checkIntervalMinutes * 120000) &&
    !status.state.consecutive_failures,
  );
  const baseline = Boolean(status.state.baseline_completed_at);
  const attention = status.emailAttentionCount;
  return (
    <>
      <div
        className={`health-banner ${healthy ? "healthy" : !status.monitorEnabled ? "paused" : ""}`}
      >
        <div className="health-icon">
          {healthy ? <CheckCircle2 size={21} /> : <Clock3 size={21} />}
        </div>
        <div>
          <strong>
            {!status.monitorEnabled
              ? "Scheduled monitoring is paused"
              : !baseline
                ? "Building your notice archive"
                : healthy
                  ? "Your monitor is up to date"
                  : "Your monitor is ready for a check"}
          </strong>
          <p>
            {!status.monitorEnabled
              ? "Manual checks remain available. Scheduled checks and sends are paused."
              : status.state.last_error
                ? status.state.last_error
                : !baseline
                  ? `Next archive page: ${status.state.baseline_next_page}. Imported notices will not trigger emails.`
                  : healthy
                    ? "The latest NMC check completed successfully."
                    : "Run a check below, or review the deployed schedule."}
          </p>
        </div>
        <Badge tone={healthy ? "green" : "amber"}>
          {!status.monitorEnabled
            ? "Paused"
            : healthy
              ? "Healthy"
              : !baseline
                ? "Initializing"
                : "Check needed"}
        </Badge>
      </div>
      <ReviewQueue reviews={status.reviews ?? []} onChanged={retry} onExpired={onExpired} />
      <section className="metrics" aria-label="Monitor summary">
        <div>
          <span>Unique notices tracked</span>
          <strong>{numberFormat.format(status.counts.notices)}</strong>
          <p>
            {status.state.source_total
              ? `${numberFormat.format(status.state.source_total)} entries listed on NMC`
              : "Original links stay on NMC"}
            {status.counts.removed
              ? ` · ${numberFormat.format(status.counts.removed)} removed by NMC`
              : ""}
          </p>
        </div>
        <div>
          <span>In the email queue</span>
          <strong>{numberFormat.format(counts.pending ?? 0)}</strong>
          <p>
            {status.emailEnabled
              ? "Waiting for the next send cycle"
              : "Sending is currently paused"}
          </p>
        </div>
        <div>
          <span>Accepted by Resend</span>
          <strong>{numberFormat.format(counts.accepted ?? 0)}</strong>
          <p>Across all recipients</p>
        </div>
        <div>
          <span>Needs attention</span>
          <strong className={attention ? "attention" : ""}>
            {numberFormat.format(attention)}
          </strong>
          <button className="inline-link" onClick={() => navigate("emails")}>
            {attention
              ? "Review email activity"
              : "No failed or uncertain emails"}{" "}
            <ArrowRight size={13} />
          </button>
        </div>
      </section>
      <div className="overview-grid">
        <section className="panel latest-panel">
          <div className="panel-heading">
            <div>
              <h2>Latest notices</h2>
              <p>The most recent publications from NMC.</p>
            </div>
            <button className="text-link" onClick={() => navigate("notices")}>
              View archive <ArrowRight size={15} />
            </button>
          </div>
          {notices.error ? (
            <ErrorNotice onRetry={retry}>{notices.error}</ErrorNotice>
          ) : notices.data ? (
            notices.data.items.length ? (
              <NoticeRows items={notices.data.items.slice(0, 6)} compact />
            ) : (
              <Empty icon={<FileText />} title="Your archive starts here">
                Run your first check to import NMC notices.
              </Empty>
            )
          ) : (
            <Loading />
          )}
          <div className="panel-footer">
            <ShieldCheck size={15} />
            <span>Documents open directly on nmc.org.in</span>
          </div>
        </section>
        <aside className="overview-aside">
          <section className="source-panel">
            <div className="source-panel-top">
              <span className="source-mark">N</span>
              <Badge>NMC source</Badge>
            </div>
            <h2>
              National Medical
              <br /> Commission
            </h2>
            <p>
              Public notices, circulars,
              <br />
              and important announcements.
            </p>
            <a
              href="https://nmc.org.in/whats-new"
              target="_blank"
              rel="noreferrer"
            >
              View official notice board <ArrowUpRight size={16} />
            </a>
          </section>
          <section className="check-summary">
            <h2>A little peace of mind.</h2>
            <dl>
              <div>
                <dt>Last successful check</dt>
                <dd title={status.state.last_success_at ?? ""}>
                  {ago(status.state.last_success_at)}
                </dd>
              </div>
              <div>
                <dt>Minimum check interval</dt>
                <dd>
                  {status.monitorEnabled
                    ? `${status.checkIntervalMinutes} minutes`
                    : "Paused"}
                </dd>
              </div>
              <div>
                <dt>Archive import</dt>
                <dd>
                  {baseline ? (
                    <>
                      <Check size={13} /> Complete
                    </>
                  ) : (
                    "In progress"
                  )}
                </dd>
              </div>
              <div>
                <dt>Email sending</dt>
                <dd>{status.emailEnabled ? "Enabled" : "Paused"}</dd>
              </div>
            </dl>
            <p className="schedule-note">
              Automatic checks run after deployment. For local testing, use
              “Check for notices”.
            </p>
          </section>
        </aside>
      </div>
      <section className="recent-checks">
        <div className="section-heading">
          <h2>Recent checks</h2>
          <button className="text-link" onClick={() => navigate("runs")}>
            Full history <ArrowRight size={15} />
          </button>
        </div>
        {status.recentRuns.length ? (
          <div className="recent-check-list">
            {status.recentRuns.slice(0, 3).map((run) => (
              <div className="recent-check" key={run.id}>
                <span className={`run-icon ${run.error ? "run-error" : ""}`}>
                  {run.error ? <CircleAlert size={17} /> : <Check size={17} />}
                </span>
                <div>
                  <strong>
                    {run.mode === "baseline"
                      ? "Archive import"
                      : run.mode === "send"
                        ? "Email send cycle"
                        : run.mode === "manual_send"
                          ? "Manual notice email"
                        : "Notice check"}
                  </strong>
                  <p>
                    {run.error ??
                      `${run.pages} pages checked · ${run.notices} notices reviewed · ${run.notifications} changes queued`}
                  </p>
                </div>
                <time dateTime={run.started_at}>
                  {date(run.started_at, true)}
                </time>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Your first check will appear here.</p>
        )}
      </section>
    </>
  );
}

function NoticeArchive({
  revision,
  onExpired,
  retry,
}: {
  revision: number;
  onExpired: () => void;
  retry: () => void;
}) {
  const [emailNotice, setEmailNotice] = useState<Notice | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [page, setPage] = useState(1);
  const list = useList<Notice>(
    `notices?${new URLSearchParams({ q: search, kind, page: String(page) })}`,
    revision,
    onExpired,
  );
  return (
    <>
    <section className="panel archive-panel">
      <div className="list-toolbar">
        <form
          className="search-form"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSearch(query.trim());
          }}
        >
          <Search size={17} />
          <label className="sr-only" htmlFor="notice-search">
            Search notices
          </label>
          <Input
            id="notice-search"
            placeholder="Search by title or notice ID…"
            maxLength={200}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button variant="outline" type="submit" size="sm">
            Search
          </Button>
        </form>
        <div className="select-label">
          <Select
            value={kind}
            onValueChange={(value) => {
              setKind(value);
              setPage(1);
            }}
          >
            <SelectTrigger aria-label="Notice type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value="all">All notices</SelectItem>
              <SelectItem value="new">New notices</SelectItem>
              <SelectItem value="updated">Updated notices</SelectItem>
              <SelectItem value="baseline">Imported archive</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {search ? (
        <div className="search-summary">
          Results for “{search}”{" "}
          <button
            className="text-link"
            onClick={() => {
              setSearch("");
              setQuery("");
              setPage(1);
            }}
          >
            Clear search <X size={13} />
          </button>
        </div>
      ) : null}
      <div aria-busy={list.loading}>
        {list.error ? (
          <ErrorNotice onRetry={retry}>{list.error}</ErrorNotice>
        ) : list.data ? (
          list.data.items.length ? (
            <NoticeRows items={list.data.items} onEmail={setEmailNotice} />
          ) : (
            <Empty icon={<Search />} title="No notices found">
              {search || kind !== "all"
                ? "Try another search or choose all notices."
                : "Run a check to start importing NMC notices."}
            </Empty>
          )
        ) : (
          <Loading />
        )}
      </div>
      {list.data ? (
        <Pagination data={list.data} onPage={setPage} loading={list.loading} />
      ) : null}
    </section>
    {emailNotice ? <ArchiveEmail key={emailNotice.id} notice={emailNotice} onClose={() => setEmailNotice(null)} onComplete={retry} onExpired={onExpired} /> : null}
    </>
  );
}

function Emails({
  revision,
  onExpired,
  retry,
  status,
}: {
  revision: number;
  onExpired: () => void;
  retry: () => void;
  status: Status;
}) {
  const [view, setView] = useState("queue");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [sendResult, setSendResult] = useState({ text: "", error: false });
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);
  const reviewInFlight = useRef(false);
  const pending = status.emails.find((item) => item.status === "pending")?.count ?? 0;
  const list = useList<Email>(
    `emails?view=${view}&status=${view === "history" ? filter : "all"}&page=${page}`,
    revision,
    onExpired,
  );
  async function reviewAttempt(email: Email, dismiss: boolean) {
    if (reviewInFlight.current) return;
    reviewInFlight.current = true;
    setReviewBusy(email.id);
    setSendResult({ text: "", error: false });
    try {
      await api(`emails/${email.delivery_source}/${email.id}/${dismiss ? "dismiss" : "restore"}`, { method: "POST" });
      setSendResult({ text: dismiss
        ? "Attempt dismissed. Its history is preserved; no email was sent."
        : email.resolved
          ? "Attempt restored. A later accepted email already resolved it; no email was sent."
          : "Attempt restored to Needs attention. No email was sent.", error: false });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onExpired();
      setSendResult({ text: (error as Error).message, error: true });
    } finally {
      reviewInFlight.current = false;
      setReviewBusy(null);
      retry();
    }
  }
  async function retryAttempt(email: Email) {
    if (reviewInFlight.current) return;
    reviewInFlight.current = true;
    setReviewBusy(email.id);
    setSendResult({ text: "", error: false });
    try {
      const result = await api<{ deliveryStatus: string }>(`emails/${email.delivery_source}/${email.id}/retry`, {
        method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      setSendResult({ error: ["failed", "uncertain"].includes(result.deliveryStatus), text: result.deliveryStatus === "accepted"
        ? `Retry accepted by Resend for ${email.recipient}. The earlier attempt remains in History.`
        : result.deliveryStatus === "pending"
          ? "Retry queued. Any temporary failure will be retried automatically; check Queue for its next attempt."
          : "The retry needs review. See the latest attempt in Needs attention for details." });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onExpired();
      setSendResult({ text: `${(error as Error).message} Refresh the activity before trying again.`, error: true });
    } finally {
      reviewInFlight.current = false;
      setReviewBusy(null);
      retry();
    }
  }
  return (
    <>
      <div className="info-note">
        <Mail size={18} />
        <p>
          Successful sends leave the queue automatically. Review failed or
          uncertain attempts in Needs attention. All completed attempts remain
          in History; “accepted” means accepted by Resend, not confirmed inbox delivery.
        </p>
      </div>
      <section className="panel">
        <Tabs.Root value={view} onValueChange={(value) => { setView(value); setPage(1); setSendResult({ text: "", error: false }); }}>
        <Tabs.List className="email-view-tabs" aria-label="Email activity views">
          <Tabs.Trigger className="email-view-tab" value="queue">Queue <span>{pending}</span></Tabs.Trigger>
          <Tabs.Trigger className="email-view-tab" value="attention">Needs attention <span>{status.emailAttentionCount}</span></Tabs.Trigger>
          <Tabs.Trigger className="email-view-tab" value="history">History</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value={view}>
        <div className="list-toolbar">
          <div className="email-log-heading">
            <h2>{view === "queue" ? "Email queue" : view === "attention" ? "Needs attention" : "Email history"}</h2>
            <p id="pending-email-help">{status.emailEnabled
              ? `${pending} pending. Uses your saved send limit.`
              : "Email sending is disabled. Enable it in Configuration."}</p>
          </div>
          <div className="email-log-controls">
          <SendPendingEmails enabled={status.emailEnabled} pending={pending} onComplete={retry} onExpired={onExpired} onResult={setSendResult} />
          {view === "history" ? (
          <div className="select-label">
            <Select
              value={filter}
              onValueChange={(value) => {
                setFilter(value);
                setPage(1);
              }}
            >
              <SelectTrigger aria-label="Email status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="accepted">Accepted by Resend</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="uncertain">Uncertain</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
                <SelectItem value="dismissed">Dismissed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          ) : null}
          </div>
        </div>
        {sendResult.text ? <div className="email-action-feedback"><EmailActionResult {...sendResult} /></div> : null}
        {list.error ? (
          <ErrorNotice onRetry={retry}>{list.error}</ErrorNotice>
        ) : list.data ? (
          list.data.items.length ? (
            <div className="email-list">
              {list.data.items.map((email) => (
                <article className="email-row" key={email.id}>
                  <div className="email-row-top">
                    <div className="email-badges">
                    <Badge
                      tone={
                        email.status === "accepted"
                          ? "green"
                          : email.status === "cancelled"
                            ? "neutral"
                            : email.status === "failed"
                              ? "red"
                              : "amber"
                      }
                    >
                      {email.status === "accepted"
                        ? "Accepted by Resend"
                        : email.status}
                    </Badge>
                    {email.dismissed_at ? <Badge>Dismissed</Badge> : email.resolved ? <Badge tone="green">Resolved</Badge> : email.retried ? <Badge>Retried</Badge> : null}
                    </div>
                    <time dateTime={email.created_at}>
                      {date(email.created_at, true)}
                    </time>
                  </div>
                  <h3>{cleanTitle(email.title)}</h3>
                  <p className="email-recipient">
                    To {email.recipient} · NMC {email.notice_id}{email.retry_of_id ? " · Manual retry" : email.delivery_source === "manual" ? " · Manually sent" : ""}
                  </p>
                  <div className="email-details">
                    <span>
                      {email.attempts}{" "}
                      {email.attempts === 1 ? "attempt" : "attempts"}
                    </span>
                    {email.status === "pending" ? (
                      <span>
                        {email.attempts ? "Retry scheduled" : "Next attempt"}:{" "}
                        {date(email.next_attempt_at, true)}
                      </span>
                    ) : null}
                    {email.accepted_at ? (
                      <span>Accepted {date(email.accepted_at, true)}</span>
                    ) : null}
                    <OriginalLink
                      url={email.document_url}
                      title={email.title}
                    />
                    {email.status === "failed" && !email.resolved && !email.retried ? <Button
                      variant="outline" size="sm" disabled={reviewBusy !== null || Boolean(email.retry_pending) || !status.emailEnabled}
                      onClick={() => retryAttempt(email)} aria-label={`Retry email to ${email.recipient}, notice ${email.notice_id}`}
                    ><RefreshCw size={14} className={reviewBusy === email.id ? "spin" : ""} />{email.retry_pending ? "Email already queued" : "Retry"}</Button> : null}
                    {["failed", "uncertain"].includes(email.status) ? <Button
                      variant="outline" size="sm" disabled={reviewBusy !== null}
                      onClick={() => reviewAttempt(email, !email.dismissed_at)}
                      aria-label={`${email.dismissed_at ? "Restore" : "Dismiss"} attempt for ${email.recipient}, notice ${email.notice_id}`}
                    >{reviewBusy === email.id ? <LoaderCircle size={14} className="spin" /> : null}{email.dismissed_at ? "Restore" : "Dismiss"}</Button> : null}
                  </div>
                  {email.resolved ? <p className="email-state-note">A later email for this notice was accepted for this recipient. This earlier attempt remains in history.</p> : null}
                  {email.retried && !email.resolved ? <p className="email-state-note">A newer retry is recorded in Queue or History. This earlier attempt remains in history.</p> : null}
                  {email.dismissed_at ? <p className="email-state-note">Dismissed {date(email.dismissed_at, true)}. Restore to review this attempt again.</p> : null}
                  {email.last_error ? (
                    <p
                      className={
                        email.status === "cancelled" || email.dismissed_at || email.resolved || email.retried
                          ? "email-provider-id"
                          : "email-error"
                      }
                    >
                      {email.last_error}
                    </p>
                  ) : null}
                  {email.resend_id ? (
                    <p className="email-provider-id">
                      Resend ID: {email.resend_id}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <Empty
              icon={<Mail />}
              title={
                view === "queue" ? "Your queue is clear"
                  : view === "attention" ? "No emails need attention"
                  : filter === "all" ? "No email history yet" : `No ${filter} emails`
              }
            >
              {view === "queue" ? "New notice emails appear here while waiting to send. Completed attempts are available in History."
                : view === "attention" ? "Failed or uncertain attempts appear here until dismissed or resolved by a later accepted email."
                : "Completed and dismissed attempts are retained here. Choose another status to see more activity."}
            </Empty>
          )
        ) : (
          <Loading />
        )}
        {list.data ? (
          <Pagination
            data={list.data}
            onPage={setPage}
            loading={list.loading}
          />
        ) : null}
        </Tabs.Content>
        </Tabs.Root>
      </section>
    </>
  );
}

function Runs({
  revision,
  onExpired,
  retry,
}: {
  revision: number;
  onExpired: () => void;
  retry: () => void;
}) {
  const [page, setPage] = useState(1);
  const list = useList<Run>(`runs?page=${page}`, revision, onExpired);
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Every check, recorded</h2>
          <p>Up to 1,000 recent runs. Times use your device’s timezone.</p>
        </div>
        <Activity size={20} className="muted" />
      </div>
      {list.error ? (
        <ErrorNotice onRetry={retry}>{list.error}</ErrorNotice>
      ) : list.data ? (
        list.data.items.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Check type</th>
                  <th>Pages</th>
                  <th>Notices</th>
                  <th>Changes queued</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <time dateTime={run.started_at}>
                        {date(run.started_at, true)}
                      </time>
                    </td>
                    <td>
                      {run.mode === "baseline"
                        ? "Archive import"
                        : run.mode === "send"
                          ? "Email send"
                          : run.mode === "manual_send"
                            ? "Manual notice email"
                          : "Notice check"}
                    </td>
                    <td>{run.pages}</td>
                    <td>{run.notices}</td>
                    <td>{run.notifications}</td>
                    <td>
                      <Badge tone={run.error ? "red" : "green"}>
                        {run.error ? "Failed" : "Complete"}
                      </Badge>
                      {run.error ? (
                        <p className="run-error-detail">{run.error}</p>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon={<Activity />} title="No checks recorded yet">
            Run a check to begin your monitor’s history.
          </Empty>
        )
      ) : (
        <Loading />
      )}
      {list.data ? (
        <Pagination data={list.data} onPage={setPage} loading={list.loading} />
      ) : null}
    </section>
  );
}

function Preview({
  open,
  onOpenChange,
  onExpired,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExpired: () => void;
}) {
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setHtml("");
    setError("");
    api<{ html: string }>("preview?format=json", { signal: controller.signal })
      .then((mail) => setHtml(mail.html))
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) onExpired();
        setError(error.message);
      });
    return () => controller.abort();
  }, [open, onExpired]);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="preview-dialog">
          <div className="preview-header">
            <div>
              <Dialog.Title>Email preview</Dialog.Title>
              <Dialog.Description>
                The latest notice in the minimal template. Nothing is sent.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close email preview"
              >
                <X size={20} />
              </Button>
            </Dialog.Close>
          </div>
          {error ? (
            <ErrorNotice>{error}</ErrorNotice>
          ) : html ? (
            <iframe title="Email template preview" srcDoc={html} sandbox="" />
          ) : (
            <Loading />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// Stable callback shared by request hooks so navigation doesn't refetch unrelated data.
const expiredEvent = () => window.dispatchEvent(new Event("notivo:expired"));

export function App() {
  const [auth, setAuth] = useState<"checking" | "yes" | "no">("checking");
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [page, setPage] = useState<Page>(pageFromHash);
  const [revision, setRevision] = useState(0);
  const [poll, setPoll] = useState(0);
  const [checking, setChecking] = useState(false);
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    const change = () => {
      if (window.location.hash !== "#main") setPage(pageFromHash());
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    const expire = () => {
      setAuth("no");
      setStatus(null);
      setPreview(false);
    };
    window.addEventListener("notivo:expired", expire);
    return () => window.removeEventListener("notivo:expired", expire);
  }, []);
  useEffect(() => {
    if (auth === "no") return;
    const controller = new AbortController();
    api<Status>("status", { signal: controller.signal })
      .then((value) => {
        setStatus(value);
        setError("");
        setAuth("yes");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) expiredEvent();
        else {
          setError(error.message);
          if (auth === "checking") setAuth("yes");
        }
      });
    return () => controller.abort();
  }, [auth, revision, poll]);
  useEffect(() => {
    if (auth !== "yes") return;
    const timer = setInterval(() => {
      if (!document.hidden) setPoll((v) => v + 1);
    }, 30000);
    return () => clearInterval(timer);
  }, [auth]);
  useEffect(() => {
    document.title = `${titles[page]} · Notivo`;
  }, [page]);
  function refresh() {
    setRevision((n) => n + 1);
  }
  function navigate(next: Page) {
    setPage(next);
    window.location.hash = next;
    setNotice("");
  }
  async function logout() {
    try {
      await api("auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      expiredEvent();
      setError("");
      setNotice("");
    } catch (error) {
      setError(`Could not sign out: ${(error as Error).message}`);
    }
  }
  async function check() {
    setChecking(true);
    setNotice("");
    setError("");
    try {
      const result = await api<{
        scan?: { pages: number; notices: number; notifications: number };
      }>("check", { method: "POST" });
      setNotice(
        result.scan
          ? `Check complete. ${result.scan.pages} pages checked, ${result.scan.notices} notices reviewed, ${result.scan.notifications} changes queued. No emails sent by this check.`
          : "Check complete.",
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) expiredEvent();
      setError((error as Error).message);
    } finally {
      setChecking(false);
      refresh();
    }
  }
  if (auth === "checking")
    return (
      <main className="boot-screen">
        <Brand />
        <Loading />
      </main>
    );
  if (auth === "no")
    return (
      <Login
        onLogin={() => {
          setError("");
          setAuth("yes");
        }}
      />
    );
  const descriptions: Record<Page, string> = {
    overview: "A clear view of your NMC notices and the activity behind them.",
    notices: "Find a notice. Open the original. Stay in the loop.",
    emails: "Follow each notification from the queue to Resend.",
    runs: "A transparent record of what your monitor has checked.",
    settings: "Manage notifications, monitoring, and your account.",
  };
  return (
    <SidebarProvider>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <AppSidebar
        page={page}
        onNavigate={navigate}
        onLogout={logout}
        user={status?.currentUser ?? null}
      />
      <SidebarInset>
        <header className="topbar">
          <div className="breadcrumb">
            <SidebarTrigger aria-label="Toggle navigation" />
            <span className="breadcrumb-workspace">
              Workspace <ChevronRight size={13} />
            </span>
            <span>{titles[page]}</span>
          </div>
          <div className="topbar-right">
            <LockKeyhole size={13} />
            <span>Private workspace</span>
            <span className="topbar-separator" />
            <span className="source-dot" aria-hidden="true" />
            <span>NMC source</span>
          </div>
        </header>
        <main id="main" className="main-content" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <h1>{titles[page]}</h1>
              <p>{descriptions[page]}</p>
            </div>
            <div className="page-actions">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Refresh dashboard"
                title="Refresh dashboard"
                onClick={refresh}
                disabled={checking}
              >
                <RefreshCw size={16} />
              </Button>
              <Button
                variant="outline"
                onClick={() => setPreview(true)}
                disabled={!status?.counts.notices}
              >
                <Eye size={16} />
                <span>Email preview</span>
              </Button>
              <Button onClick={check} disabled={checking || !status}>
                <RefreshCw size={16} className={checking ? "spin" : ""} />
                <span>{checking ? "Checking NMC…" : "Check for notices"}</span>
              </Button>
            </div>
          </div>
          {error ? <ErrorNotice onRetry={refresh}>{error}</ErrorNotice> : null}
          {notice ? (
            <div className="success-notice" role="status">
              <CheckCircle2 size={18} />
              <span>{notice}</span>
              <button
                aria-label="Dismiss check result"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          ) : null}
          {status ? (
            page === "overview" ? (
              <Overview
                status={status}
                revision={revision}
                navigate={navigate}
                onExpired={expiredEvent}
                retry={refresh}
              />
            ) : page === "notices" ? (
              <NoticeArchive
                revision={revision}
                onExpired={expiredEvent}
                retry={refresh}
              />
            ) : page === "emails" ? (
              <Emails
                status={status}
                revision={revision + poll}
                onExpired={expiredEvent}
                retry={refresh}
              />
            ) : page === "runs" ? (
              <Runs
                revision={revision}
                onExpired={expiredEvent}
                retry={refresh}
              />
            ) : (
              <Settings
                onSaved={refresh}
                onExpired={expiredEvent}
                currentUser={status.currentUser}
              />
            )
          ) : error ? null : (
            <Loading />
          )}
          <footer className="workspace-footer">
            <span>
              Notivo<span className="footer-dot">·</span>Important updates,
              delivered.
            </span>
            <span>Independent service. Notices sourced from NMC.</span>
          </footer>
        </main>
      </SidebarInset>
      <Preview
        open={preview}
        onOpenChange={setPreview}
        onExpired={expiredEvent}
      />
    </SidebarProvider>
  );
}
