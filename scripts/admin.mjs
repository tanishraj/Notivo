// Credentials come from the environment, never command-line arguments or URLs.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
async function main() {
  if (existsSync('.dev.vars')) process.loadEnvFile('.dev.vars');
  const action = process.argv[2] ?? 'status';
  const dryRun = process.argv.includes('--dry-run');
  const htmlPreview = process.argv.includes('--html');
  const requestId = randomUUID();
  let base = new URL(process.env.MONITOR_URL ?? 'http://localhost:8787');
  let temporaryWorker;
  let startupAttempted = false;
  const token = process.env.ADMIN_TOKEN;
  if (!token || token.length < 24) throw new Error('Set ADMIN_TOKEN to the same token configured on the Worker (24+ characters)');
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) {
    throw new Error('Use HTTPS for remote monitor URLs');
  }
  if (!['status', 'run', 'send', 'preview', 'baseline', 'test-email'].includes(action) ||
      process.argv.slice(3).some((arg) => !['--dry-run', '--html'].includes(arg)) ||
      (dryRun && action !== 'test-email') || (htmlPreview && action !== 'preview')) {
    throw new Error('Usage: npm run admin -- status|run|send|preview [--html]|baseline|test-email [--dry-run]');
  }
  async function request(path, method = 'GET') {
    let response;
    try {
      response = await fetch(new URL(path, base), {
        method, headers: { Authorization: `Bearer ${token}`,
          ...(action === 'test-email' ? { 'Idempotency-Key': requestId } : {}) }, signal: AbortSignal.timeout(300_000),
      });
    } catch (error) {
      const refused = error.cause?.code === 'ECONNREFUSED' ||
        error.cause?.errors?.some((cause) => cause.code === 'ECONNREFUSED');
      if (refused) {
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
        // An explicit URL always targets that server. Only the default local
        // URL can fall back to a temporary Worker, and only on connection refusal
        // (never after a timeout or an ambiguous failed mutation).
        if (local && !process.env.MONITOR_URL && !startupAttempted) {
          startupAttempted = true;
          console.error('Starting a temporary local Worker for this command…');
          const { startLocalWorker } = await import('./local-worker.mjs');
          temporaryWorker = await startLocalWorker();
          base = new URL(temporaryWorker.url);
          return request(path, method);
        }
        throw new Error(`Cannot connect to the monitor at ${base.origin}.\n${local
          ? 'Start "npm run dev" in another terminal in this directory and leave it running, then retry this command. If Wrangler uses another port, set MONITOR_URL to match.'
          : 'Check MONITOR_URL and ensure the deployed Worker is reachable.'}`);
      }
      throw new Error(`Request to ${base.origin} failed: ${error.message}`);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    return response.json();
  }
  try {
    if (action === 'baseline') {
      // Each call processes a bounded chunk, preserving progress on interruptions.
      for (let step = 0; step < 200; step++) {
        const status = await request('/admin/status');
        if (status.state.baseline_completed_at) { console.log('Baseline complete. Future runs monitor for new notices.'); break; }
        const result = await request('/admin/run', 'POST');
        console.log(JSON.stringify(result));
        if (result.scan?.baselineComplete) { console.log('Baseline complete. No historical emails were queued.'); break; }
        if (step === 199) throw new Error('Baseline step limit reached; inspect status, then rerun to continue');
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    } else {
      const path = action === 'preview' ? '/admin/preview?format=json' : `/admin/${action}`;
      const sendsTest = action === 'test-email' && !dryRun;
      const result = await request(path, ['run', 'send'].includes(action) || sendsTest ? 'POST' : 'GET');
      if (htmlPreview) {
        if (typeof result.html !== 'string') throw new Error('The server returned no email HTML');
        mkdirSync('.wrangler', { recursive: true });
        const file = resolve('.wrangler/email-preview.html');
        writeFileSync(file, result.html);
        console.log(`Email preview saved to ${file}\nOpen this file in your browser. No email was sent.`);
      } else console.log(JSON.stringify(result, null, 2));
    }
  } finally {
    await temporaryWorker?.dispose();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
