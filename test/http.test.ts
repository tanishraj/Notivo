import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import { runCycle } from '../src/monitor';
import { listing, migrate, now, reset, settings, site } from './helpers';

beforeAll(migrate);
beforeEach(reset);

describe('administration endpoints', () => {
  it('protects status and mutations, including missing/weak token configuration', async () => {
    expect((await app.fetch(new Request('https://monitor.example/admin/status'), settings())).status).toBe(401);
    expect((await app.fetch(new Request('https://monitor.example/admin/run', { method: 'POST' }), settings())).status).toBe(401);
    expect((await app.fetch(new Request('https://monitor.example/admin/test-email', { method: 'POST' }), settings())).status).toBe(401);
    expect((await app.fetch(new Request('https://monitor.example/admin/send', { method: 'POST' }), settings())).status).toBe(401);
    expect((await app.fetch(new Request('https://monitor.example/admin/status'), settings({ ADMIN_TOKEN: '' }))).status).toBe(401);
  });

  it('reports readiness and returns private status with a valid token', async () => {
    const config = settings();
    expect((await app.fetch(new Request('https://monitor.example/health'), config)).status).toBe(503);
    await runCycle(config, site(listing(['1'])), new Date());
    expect((await app.fetch(new Request('https://monitor.example/health'), config)).status).toBe(200);
    const response = await app.fetch(new Request('https://monitor.example/admin/status', {
      headers: { Authorization: `Bearer ${config.ADMIN_TOKEN}` },
    }), config);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ counts: { notices: 1 }, emailEnabled: false });
  });

  it('previews a real notice without sending an email', async () => {
    const config = settings();
    await runCycle(config, site(listing(['1'])), now);
    const response = await app.fetch(new Request('https://monitor.example/admin/preview', {
      headers: { Authorization: `Bearer ${config.ADMIN_TOKEN}` },
    }), config);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('https://nmc.org.in/whats-new/download/1');
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
  });

  it('returns the configured test payload on GET and blocks sending when disabled', async () => {
    const config = settings({ EMAIL_TO: 'owner@example.com', EMAIL_FROM: 'onboarding@resend.dev' });
    await runCycle(config, site(listing(['1'])), now);
    const headers = { Authorization: `Bearer ${config.ADMIN_TOKEN}`, 'Idempotency-Key': crypto.randomUUID() };
    const response = await app.fetch(new Request('https://monitor.example/admin/test-email', { headers }), config);
    expect(await response.json()).toMatchObject({ to: ['owner@example.com'], from: 'onboarding@resend.dev' });
    const blocked = await app.fetch(new Request('https://monitor.example/admin/test-email', { method: 'POST', headers }), config);
    expect(blocked.status).toBe(400);
    expect(await blocked.json()).toMatchObject({ error: expect.stringContaining('EMAIL_ENABLED') });
  });

  it('manually sends a bounded pending cycle without scanning, bypassing the scan interval but preserving origin protection', async () => {
    const config = settings({ EMAIL_TO: 'first@example.com, second@example.com', EMAILS_PER_RUN: '1' });
    await runCycle(config, site(listing(['1'])), now, false, true);
    await runCycle(config, site(listing(['1', '2'])), now, false, true);
    const enabled = { ...config, EMAIL_ENABLED: 'true', RESEND_API_KEY: 'test-key-not-a-real-key' };
    const fetcher = vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      expect(String(url)).toBe('https://api.resend.com/emails');
      return Response.json({ id: 'manual-send-id' });
    });
    vi.stubGlobal('fetch', fetcher);
    const headers = { Authorization: `Bearer ${config.ADMIN_TOKEN}` };
    try {
      const blocked = await app.fetch(new Request('https://monitor.example/admin/send', {
        method: 'POST', headers: { ...headers, Origin: 'https://other.example' },
      }), enabled);
      expect(blocked.status).toBe(403);
      expect(fetcher).not.toHaveBeenCalled();
      const response = await app.fetch(new Request('https://monitor.example/admin/send', {
        method: 'POST', headers,
      }), enabled);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ emails: { accepted: 1 } });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect((await config.DB.prepare("SELECT COUNT(*) AS count FROM outbox WHERE status = 'pending'").first())?.count).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
