import { env } from './env';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { renderEmail, sendPending, sendTestEmail, testEmailPayload } from '../src/email';
import { runCycle, runScheduledCycle } from '../src/monitor';
import { listing, migrate, now, reset, settings, site } from './helpers';
import type { Env, Fetcher, MailPayload } from '../src/types';

beforeAll(migrate);
beforeEach(reset);

async function queue(): Promise<Env> {
  const config = settings();
  await runCycle(config, site(listing(['1'])), now);
  await runCycle(config, site(listing(['1', '2'])), now);
  return { ...config, EMAIL_ENABLED: 'true', RESEND_API_KEY: 'test-key-not-a-real-key' };
}

describe('Resend delivery', () => {
  it('drains pending recipients on successive scheduler ticks without waiting for another scan', async () => {
    const config = settings({ EMAIL_TO: 'admin@example.com, reader@example.com', EMAILS_PER_RUN: '1' });
    await runCycle(config, site(listing(['1'])), now, false, true);
    await runCycle(config, site(listing(['1', '2'])), now, false, true);
    const enabled = { ...config, EMAIL_ENABLED: 'true', RESEND_API_KEY: 'test-key-not-a-real-key' };
    let calls = 0;
    const fetcher: Fetcher = async (url) => {
      expect(String(url)).toBe('https://api.resend.com/emails');
      calls++;
      return calls === 1
        ? Response.json({ name: 'validation_error' }, { status: 403 })
        : Response.json({ id: 'accepted-second-recipient' });
    };
    expect(await runScheduledCycle(enabled, fetcher, new Date(now.getTime() + 60_000)))
      .toMatchObject({ skipped: false, emails: { failed: 1, accepted: 0 } });
    expect(await runScheduledCycle(enabled, fetcher, new Date(now.getTime() + 120_000)))
      .toMatchObject({ skipped: false, emails: { accepted: 1 } });
    expect(calls).toBe(2);
    expect((await env.DB.prepare('SELECT status FROM outbox ORDER BY status').all()).results)
      .toEqual([{ status: 'accepted' }, { status: 'failed' }]);
    expect((await env.DB.prepare('SELECT last_success_at FROM monitor_state').first())?.last_success_at)
      .toBe(now.toISOString());
    expect(await runScheduledCycle(enabled, fetcher, new Date(now.getTime() + 180_000)))
      .toMatchObject({ skipped: true });
    expect(calls).toBe(2);
  });

  it('processes queued mail after a manual scan without bypassing pause, backoff, or the cycle lease', async () => {
    const config = await queue();
    const manualTime = new Date(now.getTime() + 600_000);
    await runCycle(config, site(listing(['1', '2'])), manualTime, false, true);
    let calls = 0;
    const fetcher: Fetcher = async (url) => {
      expect(String(url)).toBe('https://api.resend.com/emails');
      calls++;
      return Response.json({ id: 'accepted-after-manual-scan' });
    };
    const tick = new Date(manualTime.getTime() + 60_000);
    expect(await runScheduledCycle({ ...config, MONITOR_ENABLED: 'false' }, fetcher, tick))
      .toMatchObject({ skipped: true });
    expect(await runScheduledCycle({ ...config, EMAIL_ENABLED: 'false' }, fetcher, tick))
      .toMatchObject({ skipped: true });
    await env.DB.prepare('UPDATE outbox SET next_attempt_at = ?').bind(new Date(tick.getTime() + 60_000).toISOString()).run();
    expect(await runScheduledCycle(config, fetcher, tick)).toMatchObject({ skipped: true });
    await env.DB.prepare("UPDATE monitor_state SET lease_owner = 'other', lease_until = ?")
      .bind(new Date(tick.getTime() + 180_000).toISOString()).run();
    expect(await runScheduledCycle(config, fetcher, new Date(tick.getTime() + 60_000)))
      .toMatchObject({ skipped: true, reason: 'Another cycle holds the lease' });
    expect(calls).toBe(0);
    await env.DB.prepare('UPDATE monitor_state SET lease_owner = NULL, lease_until = NULL').run();
    expect(await runScheduledCycle(config, fetcher, new Date(tick.getTime() + 60_000)))
      .toMatchObject({ emails: { accepted: 1 } });
    expect(calls).toBe(1);
  });

  it('builds a test payload using configured addresses without altering pending alerts', async () => {
    const config = await queue();
    const mail = await testEmailPayload({ ...config, EMAIL_FROM: 'onboarding@resend.dev', EMAIL_TO: 'owner@example.com' });
    expect(mail).toMatchObject({ from: 'onboarding@resend.dev', to: ['owner@example.com'] });
    expect(mail.subject).toMatch(/^\[TEST\]/);
    expect(mail.html).toContain('Test email');
    expect((await env.DB.prepare('SELECT status, attempts FROM outbox').first())).toEqual({ status: 'pending', attempts: 0 });
  });

  it('sends exactly one explicit test with its own idempotency key, leaving queued alerts untouched', async () => {
    const config = await queue();
    const requestId = '4af7aaf4-c04f-4a54-96a6-69e04e8416ae';
    let calls = 0;
    const fetcher: Fetcher = async (_url, init) => {
      calls++;
      expect(new Headers(init?.headers).get('Idempotency-Key')).toBe(`nmc/test/${requestId}`);
      const mail = JSON.parse(init!.body as string) as MailPayload;
      expect(mail.subject).toMatch(/^\[TEST\]/);
      expect(mail.to).toEqual(['reader@example.com']);
      return Response.json({ id: 'test-email-id' });
    };
    expect(await sendTestEmail(config, requestId, fetcher)).toMatchObject({ accepted: true, resendId: 'test-email-id' });
    expect(calls).toBe(1);
    expect((await env.DB.prepare('SELECT status, attempts FROM outbox').first())).toEqual({ status: 'pending', attempts: 0 });
  });

  it('blocks disabled, unconfigured, or multi-recipient test sends', async () => {
    const config = await queue();
    const key = crypto.randomUUID();
    const fail: Fetcher = async () => { throw new Error('Should never contact Resend'); };
    await expect(sendTestEmail({ ...config, EMAIL_ENABLED: 'false' }, key, fail)).rejects.toThrow('EMAIL_ENABLED');
    await expect(sendTestEmail({ ...config, RESEND_API_KEY: '' }, key, fail)).rejects.toThrow('RESEND_API_KEY');
    await expect(sendTestEmail(config, 'invalid', fail)).rejects.toThrow('UUID');
    await expect(sendTestEmail({ ...config, EMAIL_TO: 'a@example.com,b@example.com' }, key, fail)).rejects.toThrow('single EMAIL_TO');
  });

  it('explains test-sender rejection and does not automatically retry an ambiguous result', async () => {
    const config = await queue();
    const key = crypto.randomUUID();
    await expect(sendTestEmail(config, key, async () => Response.json({}, { status: 403 }))).rejects.toThrow('match your Resend account email');
    let calls = 0;
    await expect(sendTestEmail(config, key, async () => { calls++; throw new Error('Timeout'); })).rejects.toThrow('Check the Resend dashboard');
    expect(calls).toBe(1);
  });

  it('keeps mail pending without any outbound API request when disabled', async () => {
    const config = await queue();
    const fail: Fetcher = async () => { throw new Error('Should not make an API request'); };
    expect(await sendPending({ ...config, EMAIL_ENABLED: 'false' }, fail, now)).toMatchObject({ enabled: false });
    expect(await env.DB.prepare('SELECT status, attempts FROM outbox').first()).toEqual({ status: 'pending', attempts: 0 });
  });

  it('sends a private email with the original NMC link and records API acceptance', async () => {
    const config = await queue();
    let sent: MailPayload | undefined;
    const fetcher: Fetcher = async (url, init) => {
      expect(String(url)).toBe('https://api.resend.com/emails');
      expect(new Headers(init?.headers).get('Idempotency-Key')).toMatch(/^nmc\/[a-f0-9]{64}$/);
      sent = JSON.parse(init!.body as string) as MailPayload;
      return Response.json({ id: 'resend-email-123' });
    };
    expect(await sendPending(config, fetcher, now)).toMatchObject({ accepted: 1 });
    expect(sent!.to).toEqual(['reader@example.com']);
    expect(sent!.html).toContain('https://nmc.org.in/whats-new/download/2');
    expect(sent).not.toHaveProperty('attachments');
    expect(await env.DB.prepare('SELECT status, resend_id FROM outbox').first()).toEqual({ status: 'accepted', resend_id: 'resend-email-123' });
    expect(await sendPending(config, fetcher, now)).toMatchObject({ accepted: 0 });
  });

  it('reuses the identical body and key after an ambiguous timeout', async () => {
    const config = await queue();
    const calls: { key: string | null; body: RequestInit["body"] }[] = [];
    const fetcher: Fetcher = async (_url, init) => {
      calls.push({ key: new Headers(init?.headers).get('Idempotency-Key'), body: init?.body });
      if (calls.length === 1) throw new Error('Connection closed after server accepted request');
      return Response.json({ id: 'same-resend-id' });
    };
    expect(await sendPending(config, fetcher, now)).toMatchObject({ retried: 1 });
    await sendPending({ ...config, EMAIL_FROM: 'Changed sender <changed@example.com>' }, fetcher, new Date(now.getTime() + 61_000));
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
    expect(await env.DB.prepare('SELECT status, attempts FROM outbox').first()).toEqual({ status: 'accepted', attempts: 2 });
  });

  it('backs off on 429 and respects next_attempt_at', async () => {
    const config = await queue();
    let calls = 0;
    const fetcher: Fetcher = async () => { calls++; return Response.json({ name: 'rate_limit_exceeded' }, { status: 429 }); };
    expect(await sendPending(config, fetcher, now)).toMatchObject({ retried: 1 });
    await sendPending(config, fetcher, now);
    expect(calls).toBe(1);
    expect((await env.DB.prepare('SELECT next_attempt_at FROM outbox').first<{ next_attempt_at: string }>())!.next_attempt_at).toBe('2026-10-24T12:01:00.000Z');
  });

  it('holds an ambiguous result before the provider idempotency window expires', async () => {
    const config = await queue();
    await sendPending(config, async () => { throw new Error('Timeout'); }, now);
    const fail: Fetcher = async () => { throw new Error('Should not send after retry window'); };
    expect(await sendPending(config, fail, new Date(now.getTime() + 23 * 3_600_000))).toMatchObject({ uncertain: 1 });
    expect((await env.DB.prepare('SELECT status FROM outbox').first())!.status).toBe('uncertain');
  });

  it('marks permanent provider failures for review', async () => {
    const config = await queue();
    expect(await sendPending(config, async () => Response.json({ name: 'validation_error' }, { status: 422 }), now)).toMatchObject({ failed: 1 });
    expect((await env.DB.prepare('SELECT status FROM outbox').first())!.status).toBe('failed');
  });

  it('retries queued emails even when the next website scan fails', async () => {
    const config = await queue();
    const fetcher: Fetcher = async (url) => String(url).startsWith('https://api.resend.com')
      ? Response.json({ id: 'accepted-during-outage' })
      : new Response('Maintenance', { headers: { 'Content-Type': 'text/html' } });
    const result = await runCycle(config, fetcher, now);
    expect(result).toMatchObject({ scan: { error: expect.any(String) }, emails: { accepted: 1 } });
  });

  it('escapes untrusted notice text in HTML email', () => {
    const mail = renderEmail({ id: 'v1', notice_id: '1', kind: 'new', title: '<script>alert("x")</script>',
      published_on: null, document_url: 'https://nmc.org.in/whats-new/download/1', detected_at: now.toISOString() },
    'reader@example.com', 'NMC <notices@example.com>');
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
  });
});
