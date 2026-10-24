import { preview, sendTestEmail, testEmailPayload, TestEmailError } from './email';
import { runCycle } from './monitor';
import { getState, status } from './store';
import { errorMessage, sha256, type Env } from './types';

const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (data: unknown, code = 200) => Response.json(data, { status: code, headers });

async function authorized(request: Request, token: string): Promise<boolean> {
  const supplied = request.headers.get('Authorization') ?? '';
  if (!supplied.startsWith('Bearer ') || supplied.length > 4096) return false;
  const [actual, expected] = await Promise.all([sha256(supplied.slice(7)), sha256(token)]);
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') {
      try {
        const state = await getState(env.DB);
        const healthy = state.last_success_at && Date.now() - Date.parse(state.last_success_at) < 3_600_000 && state.consecutive_failures === 0;
        return json({ service: 'nmc-notice-monitor', status: healthy ? 'ok' : 'degraded', baselineComplete: Boolean(state.baseline_completed_at) }, healthy ? 200 : 503);
      } catch { return json({ service: 'nmc-notice-monitor', status: 'database_unavailable' }, 503); }
    }
    if (!url.pathname.startsWith('/admin/')) return json({ error: 'Not found' }, 404);
    if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 24) return json({ error: 'Configure ADMIN_TOKEN with at least 24 characters' }, 503);
    if (!await authorized(request, env.ADMIN_TOKEN)) return json({ error: 'Unauthorized' }, 401);
    try {
      if (url.pathname === '/admin/status' && request.method === 'GET') return json(await status(env));
      if (url.pathname === '/admin/test-email' && request.method === 'GET') return json(await testEmailPayload(env));
      if (url.pathname === '/admin/test-email' && request.method === 'POST') {
        return json(await sendTestEmail(env, request.headers.get('Idempotency-Key') ?? ''));
      }
      if (url.pathname === '/admin/preview' && request.method === 'GET') {
        const mail = await preview(env);
        if (url.searchParams.get('format') === 'json') return json(mail);
        return new Response(mail.html, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" } });
      }
      if (['/admin/run', '/admin/send'].includes(url.pathname) && request.method === 'POST') {
        const result = await runCycle(env, fetch, new Date(), url.pathname === '/admin/send');
        const failed = !result.skipped && ((result.scan && 'error' in result.scan) || (result.emails && 'error' in result.emails));
        return json(result, result.skipped ? 409 : failed ? 502 : 200);
      }
      return json({ error: 'Unknown route or unsupported method' }, 404);
    } catch (error) {
      if (error instanceof TestEmailError) return json({ error: error.message }, error.status);
      console.error(JSON.stringify({ event: 'admin_error', message: errorMessage(error) }));
      return json({ error: 'Operation failed; inspect the Worker logs' }, 500);
    }
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const result = await runCycle(env);
    if (!result.skipped && ((result.scan && 'error' in result.scan) || (result.emails && 'error' in result.emails))) {
      throw new Error('Monitor cycle failed; inspect the structured monitor_cycle log and /admin/status');
    }
  },
} satisfies ExportedHandler<Env>;
