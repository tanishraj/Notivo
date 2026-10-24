import { decodeHTML } from 'entities';
import { SOURCE_URL, sha256, type Fetcher, type Listing, type Notice } from './types';

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function publishedDate(day: string, month: string, year: string): string | null {
  if (!clean(day + month + year)) return null;
  const d = Number(clean(day));
  const m = months.indexOf(clean(month).toLowerCase());
  const y = Number(clean(year));
  const date = new Date(Date.UTC(y, m, d));
  // The real archive contains years 0202, 0024 and 0022. Preserve the notice
  // with an unavailable date instead of guessing a corrected year.
  if (m < 0 || y < 1900 || date.getUTCDate() !== d || date.getUTCMonth() !== m || date.getUTCFullYear() !== y) return null;
  return date.toISOString().slice(0, 10);
}

export function documentLink(href: string): { id: string; url: string } {
  const url = new URL(href, SOURCE_URL);
  const match = /^\/whats-new\/download\/(\d+)\/?$/.exec(url.pathname);
  if (url.hostname !== 'nmc.org.in' || !['http:', 'https:'].includes(url.protocol) || url.port || !match || url.username || url.password) {
    throw new Error('Unexpected NMC document URL');
  }
  return { id: match[1]!, url: `https://nmc.org.in/whats-new/download/${match[1]}` };
}

/** Parse the actual server-rendered NMC table. Fail closed if its layout changes. */
export async function parseListing(response: Response, expectedPage: number): Promise<Listing> {
  type Row = { title: string; description: string; badge: string; noDoc: boolean; href: string; day: string; month: string; year: string };
  const rows: Row[] = [];
  let row: Row | undefined;
  let info = '';
  let active = '';
  let lastPage = 1;
  let tableCount = 0;
  const rewriter = new HTMLRewriter()
    .on('table.wn-table', { element() { tableCount++; } })
    .on('.wn-table tbody tr', {
      element() {
        row = { title: '', description: '', badge: '', noDoc: false, href: '', day: '', month: '', year: '' };
        rows.push(row);
      },
    })
    .on('.wn-table tbody tr .wn-td-desc', { text(t) { if (row) row.description += t.text; } })
    .on('.wn-table tbody tr .notice-new', { text(t) { if (row) row.badge += t.text; } })
    .on('.wn-table tbody tr .wn-no-doc', { element() { if (row) row.noDoc = true; } })
    .on('.wn-table tbody tr .wn-title-link', {
      element(element) { if (row) row.href = element.getAttribute('href') ?? ''; },
      text(text) { if (row) row.title += text.text; },
    })
    .on('.wn-table tbody tr .wn-date-day', { text(t) { if (row) row.day += t.text; } })
    .on('.wn-table tbody tr .wn-date-mon', { text(t) { if (row) row.month += t.text; } })
    .on('.wn-table tbody tr .wn-date-yr', { text(t) { if (row) row.year += t.text; } })
    .on('.wn-info-bar', { text(t) { info += t.text; } })
    .on('.wn-pg-active', { text(t) { active += t.text; } })
    .on('.wn-pager a[href]', {
      element(element) {
        const link = new URL(element.getAttribute('href')!, SOURCE_URL);
        const page = Number(link.searchParams.get('page'));
        if (link.hostname !== 'nmc.org.in' || link.pathname !== '/whats-new' || !Number.isInteger(page) || page < 1) {
          throw new Error('Unexpected NMC pagination link');
        }
        lastPage = Math.max(lastPage, page);
      },
    });
  // Consume the complete stream; HTMLRewriter handlers run while it is read.
  await rewriter.transform(response).text();
  const range = /Showing\s+([\d,]+)\s*[–−-]\s*([\d,]+)\s+of\s+([\d,]+)\s+results/i.exec(clean(info));
  const number = (s: string) => Number(s.replaceAll(',', ''));
  if (tableCount !== 1 || !rows.length || !range) throw new Error('NMC notice table is missing or empty; scan was not committed');
  const start = number(range[1]!);
  const end = number(range[2]!);
  const total = number(range[3]!);
  if ((active && Number(clean(active)) !== expectedPage) || start !== (expectedPage - 1) * 20 + 1 ||
      end !== Math.min(expectedPage * 20, total) || end - start + 1 !== rows.length || total < end) {
    throw new Error('NMC pagination or row count changed; scan was not committed');
  }
  lastPage = Math.max(lastPage, Math.ceil(total / 20));
  if (lastPage > 500) throw new Error('Unexpected NMC page count; review the listing');
  const notices = await Promise.all(rows.map(async (r): Promise<Notice> => {
    const badge = clean(decodeHTML(r.badge));
    let description = clean(decodeHTML(r.description));
    if (badge && description.endsWith(badge)) description = description.slice(0, -badge.length).trim();
    const title = clean(decodeHTML(r.title)) || (r.noDoc ? description : '');
    if (!title || (!r.href && !r.noDoc)) throw new Error('NMC notice row has no title or document link');
    const publishedOn = publishedDate(r.day, r.month, r.year);
    const link = r.href ? documentLink(r.href) : null;
    return { id: link?.id ?? `text:${await sha256(JSON.stringify([title, publishedOn]))}`,
      title, documentUrl: link?.url ?? null, publishedOn };
  }));
  if (new Set(notices.map((n) => n.id)).size !== notices.length) throw new Error('Duplicate notice IDs in NMC page');
  return { notices, page: expectedPage, lastPage, total };
}

export async function fetchListing(page: number, fetcher: Fetcher = fetch): Promise<Listing> {
  const url = new URL(SOURCE_URL);
  if (page > 1) url.searchParams.set('page', String(page));
  let failure: unknown;
  // Retry transient network/server errors once. Schema errors need investigation.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetcher(url.toString(), {
        headers: { 'User-Agent': 'NMCNoticeMonitor/0.1', Accept: 'text/html', 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(15_000),
        // Workers supports follow/manual, but not the browser's error mode.
        redirect: 'manual',
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status < 500 && response.status !== 429) throw new PermanentFetchError(`NMC returned HTTP ${response.status}`);
        throw new Error(`NMC returned HTTP ${response.status}`);
      }
      if (!response.headers.get('content-type')?.includes('text/html')) {
        await response.body?.cancel();
        throw new PermanentFetchError('NMC returned a non-HTML response');
      }
      // Do not retry parser failures or mistake a challenge page for an empty list.
      return await parseListing(response, page);
    } catch (error) {
      failure = error;
      if (error instanceof PermanentFetchError || (error instanceof Error && !/fetch|network|timeout|abort|HTTP 5|HTTP 429|connection/i.test(error.message))) throw error;
      if (!attempt) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw failure;
}

class PermanentFetchError extends Error {}
