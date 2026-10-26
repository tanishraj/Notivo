import { useRef, useState } from "react";
import { CheckCircle2, CircleAlert, LoaderCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "../api";

export function EmailActionResult({ text, error }: { text: string; error: boolean }) {
  if (!text) return null;
  return (
    <div className={error ? "error-notice" : "success-notice"} role={error ? "alert" : "status"}>
      {error ? <CircleAlert size={18} /> : <CheckCircle2 size={18} />}
      <span>{text}</span>
    </div>
  );
}

export function SendPendingEmails({
  enabled, pending, onComplete, onExpired, onResult,
}: {
  enabled: boolean;
  pending: number;
  onComplete: () => void;
  onExpired: () => void;
  onResult: (result: { text: string; error: boolean }) => void;
}) {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  async function send() {
    if (inFlight.current || !enabled || !pending) return;
    inFlight.current = true;
    setBusy(true);
    onResult({ text: "", error: false });
    try {
      const { emails } = await api<{
        emails: { enabled: boolean; accepted: number; failed: number; retried: number; uncertain: number };
      }>("send", { method: "POST" });
      const processed = emails.accepted + emails.failed + emails.retried + emails.uncertain;
      onResult({
        error: !emails.enabled || emails.failed > 0 || emails.uncertain > 0,
        text: !emails.enabled
          ? "Email sending is disabled. Enable it in Configuration first."
          : !processed
            ? "No pending emails are due right now. Check retry times in the log below."
            : `Send cycle complete: ${emails.accepted} accepted by Resend, ${emails.failed} failed, ${emails.retried} scheduled for retry, ${emails.uncertain} need review. Check the log below for details.`,
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onExpired();
      onResult({ text: `${(error as Error).message} Refresh the email log before trying again.`, error: true });
    } finally {
      inFlight.current = false;
      setBusy(false);
      onComplete();
    }
  }
  return (
        <Button onClick={send} disabled={busy || !enabled || !pending} aria-describedby="pending-email-help">
          {busy ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />}
          {busy ? "Sending…" : "Send pending emails"}
        </Button>
  );
}

export function SendTestEmail({ sender, recipient, disabledReason, onExpired }: {
  sender: string;
  recipient: string;
  disabledReason: string;
  onExpired: () => void;
}) {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [result, setResult] = useState({ text: "", error: false });
  async function send() {
    if (inFlight.current || disabledReason || unconfirmed) return;
    inFlight.current = true;
    setBusy(true);
    setResult({ text: "", error: false });
    try {
      const result = await api<{ resendId: string; to: string[] }>("test-email", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      setResult({ text: `Test email accepted by Resend for ${result.to.join(", ")}. Check the inbox or spam folder. Resend ID: ${result.resendId}.`, error: false });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onExpired();
      // A timeout may have occurred after acceptance. Never automatically repeat a test.
      setUnconfirmed(true);
      setResult({ text: `${(error as Error).message} Check Resend before reloading this page to send another test.`, error: true });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="test-email-action">
      <h3>Test your email setup</h3>
      <p>{disabledReason || `Send one email labelled [TEST] to ${recipient}, from ${sender}. This does not send queued notices.`}</p>
      <Button type="button" variant="outline" onClick={send} disabled={busy || Boolean(disabledReason) || unconfirmed}>
        {busy ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />}
        {busy ? "Sending test…" : "Send test email"}
      </Button>
      <EmailActionResult {...result} />
    </div>
  );
}
