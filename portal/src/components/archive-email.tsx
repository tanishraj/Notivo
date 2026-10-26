import { useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { CheckCircle2, CircleAlert, LoaderCircle, Mail, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { api, ApiError } from "../api";
import type { Notice } from "../types";

interface Review {
  notice: { id: string; title: string; fingerprint: string };
  sender: string;
  recipients: string[];
  settingsRevision: number;
  enabled: boolean;
  limit: number;
  history: { recipient: string; status: string; count: number }[];
}

export function ArchiveEmail({ notice, onClose, onComplete, onExpired }: {
  notice: Notice;
  onClose: () => void;
  onComplete: () => void;
  onExpired: () => void;
}) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const inFlight = useRef(false);
  const requestId = useRef(crypto.randomUUID());
  const path = `notices/${encodeURIComponent(notice.id)}/email`;
  useEffect(() => {
    const controller = new AbortController();
    api<Review>(path, { signal: controller.signal }).then(setReview).catch((error) => {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError && error.status === 401) onExpired();
      setError(error.message);
    });
    return () => controller.abort();
  }, [path, onExpired]);
  const pending = new Set(review?.history.filter((row) => row.status === "pending").map((row) => row.recipient));
  const targets = review?.recipients.filter((recipient) => !pending.has(recipient)) ?? [];
  const risk = review?.history.some((row) => targets.includes(row.recipient) && ["accepted", "uncertain"].includes(row.status));
  async function send() {
    if (!review || inFlight.current || attempted || !review.enabled || !targets.length || (risk && !allowDuplicate)) return;
    inFlight.current = true;
    setBusy(true);
    setAttempted(true);
    setError("");
    try {
      const result = await api<{
        queued: number; existingPending: number; remaining: number;
        emails: { accepted: number; failed: number; retried: number; uncertain: number };
      }>(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": requestId.current },
        body: JSON.stringify({ settingsRevision: review.settingsRevision, fingerprint: review.notice.fingerprint, allowDuplicate }),
      });
      const message = `${result.emails.accepted} accepted by Resend. ${result.remaining} still pending. ${result.existingPending} already queued and left unchanged.`;
      if (result.emails.failed || result.emails.uncertain) {
        setError(`${message} ${result.emails.failed} failed; ${result.emails.uncertain} need review. See Email activity for details.`);
      } else {
        setResult(`${message} ${result.emails.retried ? "A temporary failure is scheduled for retry. " : ""}This manual send is recorded in Email activity.`);
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onExpired();
      setError(`${(error as Error).message} Check Email activity and Resend before starting another send.`);
    } finally {
      inFlight.current = false;
      setBusy(false);
      onComplete();
    }
  }
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="archive-email-dialog" onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}>
          <div className="preview-header">
            <div>
              <Dialog.Title>Email this notice</Dialog.Title>
              <Dialog.Description>Review the notice and recipients before sending.</Dialog.Description>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} disabled={busy} aria-label="Close email review"><X size={20} /></Button>
          </div>
          <div className="archive-email-body">
            <p className="manual-notice-id">NMC · {notice.id}</p>
            <h3>{review?.notice.title ?? notice.title}</h3>
            {review ? <>
              <dl className="manual-email-details">
                <div><dt>From</dt><dd>{review.sender}</dd></div>
                <div><dt>Recipients</dt><dd>{review.recipients.map((recipient) => <div key={recipient}>{recipient}{pending.has(recipient) ? " · already pending" : ""}</div>)}</dd></div>
              </dl>
              <p className="field-help">Sends this notice using the minimal email template and original NMC link. Up to {review.limit} emails are attempted now; remaining emails stay queued. Archive history stays unchanged.</p>
              {!review.enabled ? <p className="email-error">Enable email sending and configure Resend in Configuration first.</p> : null}
              {pending.size ? <p className="info-note">{pending.size} recipient(s) already have this notice pending. Another copy will not be queued for them.</p> : null}
              {risk ? <div className="manual-email-warning">
                <p>An email for this notice was already accepted or has an uncertain outcome. <a className="text-link" href="https://resend.com/emails" target="_blank" rel="noreferrer">Review Resend</a> before sending another copy.</p>
                <label className="checkbox-label"><Checkbox checked={allowDuplicate} disabled={busy || attempted} onCheckedChange={(value) => setAllowDuplicate(value === true)} /><span>I reviewed delivery history and want to send another copy.</span></label>
              </div> : null}
            </> : !error ? <p role="status"><LoaderCircle size={16} className="spin" /> Loading recipients and delivery history…</p> : null}
            {error ? <div className="error-notice" role="alert"><CircleAlert size={18} /><span>{error}</span></div> : null}
            {result ? <div className="success-notice" role="status"><CheckCircle2 size={18} /><span>{result}</span></div> : null}
          </div>
          <div className="archive-email-footer">
            <Button variant="outline" onClick={onClose} disabled={busy}>{attempted ? "Done" : "Cancel"}</Button>
            {!attempted || busy ? <Button onClick={send} disabled={busy || !review?.enabled || !targets.length || Boolean(risk && !allowDuplicate)}>
              {busy ? <LoaderCircle size={16} className="spin" /> : <Mail size={16} />}{busy ? "Sending…" : "Send notice email"}
            </Button> : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
