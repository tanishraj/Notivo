import { useState } from "react";
import { Clock3, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "../api";
import type { Review } from "../types";

/** New NMC entries Notivo held back because it could not be sure they are new. */
export function ReviewQueue({
  reviews,
  onChanged,
  onExpired,
}: {
  reviews: Review[];
  onChanged: () => void;
  onExpired: () => void;
}) {
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  if (!reviews.length && !message) return null;

  async function decide(review: Review, action: "send" | "dismiss") {
    setBusy(`${review.id}:${action}`);
    setMessage("");
    setError("");
    try {
      const result = await api<{ queued: number }>(
        `reviews/${encodeURIComponent(review.id)}/${action}`,
        { method: "POST" },
      );
      setMessage(
        action === "send"
          ? `Queued for ${result.queued} ${result.queued === 1 ? "recipient" : "recipients"}. It goes out with the next send.`
          : "Dismissed. It stays in notice history and will not be emailed.",
      );
      onChanged();
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) onExpired();
      setError((failure as Error).message);
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="review-queue" aria-labelledby="review-queue-title">
      <div className="review-queue-head">
        <Clock3 size={17} />
        <div>
          <strong id="review-queue-title">
            {reviews.length === 1
              ? "1 NMC entry is waiting for your review"
              : `${reviews.length} NMC entries are waiting for your review`}
          </strong>
          <p>
            Notivo could not be sure these are new, so your recipients have not been emailed. Send
            the ones that are new and dismiss the rest.
          </p>
        </div>
      </div>
      {message ? <p className="review-queue-message" role="status">{message}</p> : null}
      {error ? <p className="review-queue-error" role="alert">{error}</p> : null}
      <ul>
        {reviews.map((review) => (
          <li key={review.id}>
            <div className="review-text">
              {review.document_url ? (
                <a href={review.document_url} target="_blank" rel="noreferrer" className="review-title">
                  {review.title} <ExternalLink size={11} />
                </a>
              ) : (
                <span className="review-title">{review.title}</span>
              )}
              <span className="review-meta">
                NMC {review.id} · published {review.published_on ?? "date not given"}
              </span>
              <span className="review-reason">{review.reason}</span>
            </div>
            <div className="review-actions">
              <Button
                size="sm"
                disabled={Boolean(busy)}
                onClick={() => decide(review, "send")}
                aria-label={`Send NMC ${review.id} to recipients`}
              >
                {busy === `${review.id}:send` ? "Sending…" : "Send"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={Boolean(busy)}
                onClick={() => decide(review, "dismiss")}
                aria-label={`Dismiss NMC ${review.id}`}
              >
                {busy === `${review.id}:dismiss` ? "Dismissing…" : "Dismiss"}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
