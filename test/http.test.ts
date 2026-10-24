import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index';
import { runCycle } from '../src/monitor';
import { listing, migrate, now, reset, settings, site } from './helpers';

beforeAll(migrate);
beforeEach(reset);

describe('administration endpoints', () => {
  it('protects status and mutations, including missing/weak token configuration', async () => {
    expect((await worker.fetch(new Request('https://monitor.example/admin/status'), settings())).status).toBe(401);
    expect((await worker.fetch(new Request('https://monitor.example/admin/run', { method: 'POST' }), settings())).status).toBe(401);
    expect((await worker.fetch(new Request('https://monitor.example/admin/test-email', { method: 'POST' }), settings())).status).toBe(401);
    expect((await worker.fetch(new Request('https://monitor.example/admin/status'), settings({ ADMIN_TOKEN: '' }))).status).toBe(503);
  });

  it('reports readiness and returns private status with a valid token', async () => {
    const config = settings();
    expect((await worker.fetch(new Request('https://monitor.example/health'), config)).status).toBe(503);
    await runCycle(config, site(listing(['1'])), new Date());
    expect((await worker.fetch(new Request('https://monitor.example/health'), config)).status).toBe(200);
    const response = await worker.fetch(new Request('https://monitor.example/admin/status', {
      headers: { Authorization: `Bearer ${config.ADMIN_TOKEN}` },
    }), config);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ counts: { notices: 1 }, emailEnabled: false });
  });

  it('previews a real notice without sending an email', async () => {
    const config = settings();
    await runCycle(config, site(listing(['1'])), now);
    const response = await worker.fetch(new Request('https://monitor.example/admin/preview', {
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
    const response = await worker.fetch(new Request('https://monitor.example/admin/test-email', { headers }), config);
    expect(await response.json()).toMatchObject({ to: ['owner@example.com'], from: 'onboarding@resend.dev' });
    const blocked = await worker.fetch(new Request('https://monitor.example/admin/test-email', { method: 'POST', headers }), config);
    expect(blocked.status).toBe(400);
    expect(await blocked.json()).toMatchObject({ error: expect.stringContaining('EMAIL_ENABLED') });
  });
});
