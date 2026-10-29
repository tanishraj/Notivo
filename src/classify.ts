import type { Version } from "./types";

/** NMC dates are calendar dates in India. */
export function indiaToday(now: Date): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

export function ageInDays(publishedOn: string, today: string): number {
  return Math.round((Date.parse(today) - Date.parse(publishedOn)) / 86_400_000);
}

/** Compare titles the way a reader would: without the leading date, spacing or dashes. */
export function normalizeTitle(title: string): string {
  return title
    .replace(/^\s*\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}\s*[-–—:]?\s*/, "")
    .replace(/[\s\-–—:.,;]+/g, " ")
    .trim()
    .toLowerCase();
}

export interface Rules {
  today: string;
  autoSendDays: number;
  newEntriesPerCheckLimit: number;
}

export type Decision = { send: true } | { send: false; reason: string };

/** Decide which new notices are emailed straight away. Anything uncertain is held
 * for the admin to send or dismiss, so nothing is dropped and nothing old is sent. */
export function decideNewNotices(
  versions: Version[],
  stored: { id: string; title: string; published_on: string | null }[],
  rules: Rules,
): Map<string, Decision> {
  const decisions = new Map<string, Decision>();
  const seen = new Map<string, string>();
  for (const s of stored)
    if (s.published_on) seen.set(`${s.published_on}|${normalizeTitle(s.title)}`, s.id);
  for (const version of versions) {
    if (!version.published_on) {
      decisions.set(version.id, { send: false, reason: "NMC listed it without a readable published date." });
      continue;
    }
    const age = ageInDays(version.published_on, rules.today);
    if (age < 0) {
      decisions.set(version.id, { send: false, reason: `Its published date, ${version.published_on}, is in the future.` });
      continue;
    }
    const key = `${version.published_on}|${normalizeTitle(version.title)}`;
    const twin = seen.get(key);
    seen.set(key, twin ?? version.notice_id);
    if (twin && twin !== version.notice_id) {
      decisions.set(version.id, {
        send: false,
        reason: `NMC ${twin} has the same title and published date. This may be a re-upload or a separate document.`,
      });
      continue;
    }
    if (age > rules.autoSendDays) {
      decisions.set(version.id, {
        send: false,
        reason: `It was published ${age} days ago. Recent NMC notices usually appear within ${rules.autoSendDays} days.`,
      });
      continue;
    }
    decisions.set(version.id, { send: true });
  }
  const sending = versions.filter((v) => decisions.get(v.id)?.send);
  if (sending.length > rules.newEntriesPerCheckLimit)
    for (const version of sending)
      decisions.set(version.id, {
        send: false,
        reason: `${sending.length} new entries appeared in one check. NMC may have renumbered or re-uploaded its notices.`,
      });
  return decisions;
}
