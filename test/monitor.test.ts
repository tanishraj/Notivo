import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runCycle } from '../src/monitor';
import { acquireLease, getState, ingest } from '../src/store';
import { count, listing, migrate, now, reset, settings, site } from './helpers';
import type { Fetcher } from '../src/types';

beforeAll(migrate);
beforeEach(reset);

describe('monitor state and outbox', () => {
  it('baselines historical notices without creating emails', async () => {
    const result = await runCycle(settings(), site(listing(['1880', '48'])), now);
    expect(result).toMatchObject({ scan: { mode: 'baseline', baselineComplete: true, notifications: 0 } });
    expect(await count('notices')).toBe(2);
    expect(await count('outbox')).toBe(0);
    expect((await getState(env.DB)).baseline_completed_at).toBe(now.toISOString());
  });

  it('resumes a multi-page baseline without notifying the archive', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => String(i + 1));
    const config = settings({ BASELINE_PAGES_PER_RUN: '1' });
    await runCycle(config, site(listing(ids, { total: 21 })), now);
    expect((await getState(env.DB)).baseline_next_page).toBe(2);
    expect((await getState(env.DB)).baseline_completed_at).toBeNull();
    await runCycle(config, site(listing(['21'], { page: 2, total: 21 })), now);
    expect(await count('notices')).toBe(21);
    expect(await count('outbox')).toBe(0);
    expect((await getState(env.DB)).baseline_completed_at).not.toBeNull();
  });

  it('queues same-date notices even when the new numeric ID is lower', async () => {
    const config = settings({ EMAIL_TO: 'first@example.com,second@example.com, FIRST@example.com' });
    await runCycle(config, site(listing(['1880'])), now);
    await runCycle(config, site(listing(['1880', '48'])), now);
    expect(await count('notice_versions')).toBe(1);
    expect(await count('outbox')).toBe(2);
    const version = await env.DB.prepare('SELECT kind, notice_id FROM notice_versions').first();
    expect(version).toEqual({ kind: 'new', notice_id: '48' });
  });

  it('does not queue duplicates on repeated scans or a New badge change', async () => {
    const config = settings();
    await runCycle(config, site(listing(['1'])), now);
    await runCycle(config, site(listing(['1', '2'])), now);
    await runCycle(config, site(listing(['1', '2']).replaceAll('>New<', '>Old<')), now);
    expect(await count('notice_versions')).toBe(1);
    expect(await count('outbox')).toBe(1);
  });

  it('queues an updated listing title once', async () => {
    const config = settings();
    await runCycle(config, site(listing(['1'])), now);
    const changed = site(listing(['1'], { title: 'Revised notice &amp; deadline' }));
    await runCycle(config, changed, now);
    await runCycle(config, changed, now);
    expect(await count('outbox')).toBe(1);
    expect(await env.DB.prepare('SELECT kind, title FROM notice_versions').first()).toEqual({ kind: 'updated', title: 'Revised notice & deadline' });
  });

  it('leaves baseline progress untouched after a bad page and records the failure', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => String(i + 1));
    const fetcher: Fetcher = async (input) => new Response(new URL(String(input)).searchParams.get('page') === '2'
      ? '<h1>Maintenance</h1>' : listing(ids, { total: 21 }), { headers: { 'Content-Type': 'text/html' } });
    await runCycle(settings(), fetcher, now);
    expect(await count('notices')).toBe(0);
    const state = await getState(env.DB);
    expect(state.baseline_next_page).toBe(1);
    expect(state.consecutive_failures).toBe(1);
    expect(state.last_success_at).toBeNull();
  });

  it('rolls notice and outbox writes back if the transaction fails', async () => {
    const bad = env.DB.prepare('UPDATE missing_table SET value = 1');
    await expect(ingest(settings(), [{ id: '1', title: 'Test', documentUrl: 'https://nmc.org.in/whats-new/download/1', publishedOn: null }], false, now, bad)).rejects.toThrow();
    expect(await count('notices')).toBe(0);
    expect(await count('outbox')).toBe(0);
  });

  it('does not consume new notices until recipients are configured', async () => {
    await runCycle(settings(), site(listing(['1'])), now);
    await runCycle(settings({ EMAIL_TO: '' }), site(listing(['1', '2'])), now);
    expect(await count('notices')).toBe(1);
    expect((await getState(env.DB)).last_error).toContain('EMAIL_TO');
  });

  it('skips overlapping runs and recovers after a stale lease expires', async () => {
    expect(await acquireLease(env.DB, 'other-worker', now)).toBe(true);
    const fetcher: Fetcher = async () => { throw new Error('Should not fetch'); };
    expect(await runCycle(settings(), fetcher, now)).toMatchObject({ skipped: true });
    expect(await acquireLease(env.DB, 'replacement', new Date(now.getTime() + 601_000))).toBe(true);
  });

  it('finds a backdated notice beyond recent pages during a rolling audit', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => String(i + 1));
    const config = settings({ RECENT_PAGES: '1' });
    const fetcher: Fetcher = async (input) => new Response(new URL(String(input)).searchParams.get('page') === '2'
      ? listing(['21'], { page: 2, total: 21 }) : listing(ids, { total: 21 }), { headers: { 'Content-Type': 'text/html' } });
    await runCycle(config, fetcher, now);
    await env.DB.prepare("DELETE FROM notices WHERE id = '21'").run();
    await runCycle(config, fetcher, now);
    expect(await count('outbox')).toBe(1);
    expect((await getState(env.DB)).audit_due_at).not.toBeNull();
  });
});
