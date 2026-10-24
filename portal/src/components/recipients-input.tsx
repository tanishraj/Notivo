import { useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, Mail, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  initials,
  MAX_RECIPIENTS,
  mergeRecipients,
  splitRecipients,
} from "../lib/recipients";
import type { UserProfile } from "../types";

interface Props {
  value: string;
  entry: string;
  error: string;
  disabled: boolean;
  suggestions: UserProfile[];
  onChange: (value: string) => void;
  onEntryChange: (value: string) => void;
  onError: (value: string) => void;
}

export function RecipientsInput({
  value,
  entry,
  error,
  disabled,
  suggestions,
  onChange,
  onEntryChange,
  onError,
}: Props) {
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  const [announcement, setAnnouncement] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const selected = splitRecipients(value);
  const available = suggestions.filter(
    (contact, index, all) =>
      !selected.includes(contact.email.toLowerCase()) &&
      all.findIndex(
        (other) => other.email.toLowerCase() === contact.email.toLowerCase(),
      ) === index &&
      `${contact.name} ${contact.email}`
        .toLowerCase()
        .includes(entry.trim().toLowerCase()),
  );
  const open =
    focused && available.length > 0 && selected.length < MAX_RECIPIENTS;
  function commit(raw = entry) {
    if (!raw.trim()) return true;
    try {
      const next = mergeRecipients(selected, raw);
      onChange(next.join(", "));
      onEntryChange("");
      onError("");
      setActive(-1);
      setAnnouncement(
        `${next.length} ${next.length === 1 ? "recipient" : "recipients"} selected.`,
      );
      return true;
    } catch (error) {
      onError((error as Error).message);
      return false;
    }
  }
  function remove(email: string) {
    onChange(selected.filter((other) => other !== email).join(", "));
    onError("");
    setAnnouncement(`${email} removed.`);
    input.current?.focus();
  }
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (
      event.key === "ArrowDown" &&
      available.length &&
      selected.length < MAX_RECIPIENTS
    ) {
      event.preventDefault();
      setFocused(true);
      setActive((old) => (old + 1) % available.length);
    } else if (
      event.key === "ArrowUp" &&
      available.length &&
      selected.length < MAX_RECIPIENTS
    ) {
      event.preventDefault();
      setFocused(true);
      setActive((old) => (old <= 0 ? available.length - 1 : old - 1));
    } else if (event.key === "Escape") {
      event.preventDefault();
      setFocused(false);
      setActive(-1);
    } else if (
      event.key === "Enter" ||
      event.key === "," ||
      event.key === ";"
    ) {
      event.preventDefault();
      commit(
        event.key === "Enter" && open && active >= 0
          ? available[active]?.email
          : entry,
      );
    } else if (event.key === "Tab" && entry.trim()) {
      commit();
    } else if (event.key === "Backspace" && !entry && selected.length) {
      event.preventDefault();
      remove(selected[selected.length - 1]!);
    }
  }
  return (
    <div
      className="recipients-control"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocused(false);
          setActive(-1);
        }
      }}
    >
      <div className="recipient-entry-wrapper">
        <div
          className={`recipient-field ${error ? "recipient-field-invalid" : ""} ${disabled ? "recipient-field-disabled" : ""}`}
          onClick={() => input.current?.focus()}
        >
          {selected.map((email) => (
            <Badge key={email} variant="secondary" className="recipient-chip">
              <span className="recipient-avatar" aria-hidden="true">
                {initials(email.split("@")[0]!)}
              </span>
              <span className="recipient-email" title={email}>
                {email}
              </span>
              <button
                type="button"
                className="recipient-remove"
                aria-label={`Remove ${email}`}
                disabled={disabled}
                onClick={(event) => {
                  event.stopPropagation();
                  remove(email);
                }}
              >
                <X size={12} />
              </button>
            </Badge>
          ))}
          <input
            ref={input}
            id="email-to"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={
              open && active >= 0 && available[active]
                ? `${listId}-${active}`
                : undefined
            }
            aria-describedby={`recipients-help recipient-count${error ? " recipients-error" : ""}`}
            aria-invalid={Boolean(error)}
            type="text"
            inputMode="email"
            autoComplete="off"
            maxLength={6000}
            value={entry}
            disabled={disabled}
            placeholder={
              selected.length ? "Add another email…" : "Add an email address…"
            }
            onFocus={() => setFocused(true)}
            onKeyDown={keyDown}
            onChange={(event) => {
              onEntryChange(event.target.value);
              onError("");
              setFocused(true);
              setActive(-1);
            }}
            onPaste={(event) => {
              const text = event.clipboardData.getData("text");
              if (/[,;\s]/.test(text.trim())) {
                event.preventDefault();
                const start =
                  event.currentTarget.selectionStart ?? entry.length;
                const end = event.currentTarget.selectionEnd ?? start;
                const combined =
                  entry.slice(0, start) + text + entry.slice(end);
                if (!commit(combined)) onEntryChange(combined);
              }
            }}
          />
        </div>
        {open ? (
          <div
            className="recipient-suggestions"
            id={listId}
            role="listbox"
            aria-label="Suggested recipients"
          >
            {available.map((contact, index) => (
              <div
                key={contact.email}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={active === index}
                className={`recipient-option ${active === index ? "recipient-option-active" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  commit(contact.email);
                  input.current?.focus();
                }}
              >
                <span className="recipient-option-avatar" aria-hidden="true">
                  {contact.name ? initials(contact.name) : <Mail size={14} />}
                </span>
                <span>
                  <strong>{contact.name || contact.email}</strong>
                  {contact.name ? <small>{contact.email}</small> : null}
                </span>
                {active === index ? <Check size={14} /> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="recipient-field-meta">
        <p id="recipients-help">
          Type an email and press Enter or comma. You can paste a list.
        </p>
        <span id="recipient-count">
          {selected.length}/{MAX_RECIPIENTS}
        </span>
      </div>
      {error ? (
        <p id="recipients-error" className="recipient-error" role="alert">
          {error}
        </p>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
