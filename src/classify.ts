import type { Version } from "./types";

/** NMC dates are calendar dates in India. */
export function indiaToday(now: Date): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

export function ageInDays(publishedOn: string, today: string): number {
  return Math.round((Date.parse(today) - Date.parse(publishedOn)) / 86_400_000);
}

export interface NewEntry {
  version: Version;
  markedNew: boolean;
  dateText: string;
}

export interface Rules {
  today: string;
  maxAgeDays: number;
  newEntriesPerCheckLimit: number;
}

export type Decision = { send: true } | { send: false; reason: string };

/** Decide which new notices are emailed straight away. A new entry is held for
 * the admin whenever Notivo cannot be sure it is new, so nothing is dropped. */
export function decideNewNotices(entries: NewEntry[], rules: Rules): Map<string, Decision> {
  const decisions = new Map<string, Decision>();
  for (const { version, markedNew, dateText } of entries) {
    if (!version.published_on) {
      decisions.set(version.id, {
        send: false,
        reason: dateText
          ? `NMC shows its published date as "${dateText}", which is not a valid date.`
          : "NMC listed it without a published date.",
      });
      continue;
    }
    const age = ageInDays(version.published_on, rules.today);
    if (age < 0) {
      decisions.set(version.id, { send: false, reason: `Its published date, ${version.published_on}, is in the future.` });
      continue;
    }
    if (markedNew && age > rules.maxAgeDays) {
      decisions.set(version.id, {
        send: false,
        reason: `NMC marks it New, but its published date is ${version.published_on}, ${age} days ago.`,
      });
      continue;
    }
    decisions.set(version.id, { send: true });
  }
  const sending = entries.filter((e) => decisions.get(e.version.id)?.send);
  if (sending.length > rules.newEntriesPerCheckLimit)
    for (const { version } of sending)
      decisions.set(version.id, {
        send: false,
        reason: `${sending.length} new entries appeared in one check. NMC may have renumbered or re-uploaded its notices.`,
      });
  return decisions;
}
