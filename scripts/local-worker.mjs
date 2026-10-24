import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);

/** A short-lived Wrangler instance using the same local D1 storage as npm run dev. */
export async function startLocalWorker() {
  const child = spawn(process.execPath, [require.resolve('wrangler'), 'dev', '--local',
    '--ip', '127.0.0.1', '--port', '0', '--inspector-port', '0'], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    env: { ...process.env, WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH ?? resolve('.wrangler/logs'),
      WRANGLER_SEND_METRICS: 'false' },
  });
  // Drain stderr so a verbose startup cannot block the child. Wrangler writes
  // detailed diagnostics to its log file; never mix them into JSON stdout.
  child.stderr.resume();
  const exited = new Promise((done) => child.once('exit', done));
  let stopping;
  const stop = () => stopping ??= (async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    let timer;
    const forced = new Promise((done) => {
      timer = setTimeout(() => { child.kill('SIGKILL'); done(); }, 5_000);
    });
    try { await Promise.race([exited, forced]); }
    finally { clearTimeout(timer); }
  })();
  const interrupt = () => { void stop().finally(() => process.exit(130)); };
  const terminate = () => { void stop().finally(() => process.exit(143)); };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  const dispose = async () => {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
    await stop();
  };
  try {
    const url = await new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error('Local Worker startup timed out. Run "npm run dev" to inspect the startup logs.')), 45_000);
      const finish = (error, value) => { clearTimeout(timer); error ? fail(error) : done(value); };
      child.once('error', (error) => finish(error));
      child.once('exit', (code) => finish(new Error(`Local Worker exited during startup (${code ?? child.signalCode}). Run "npm run dev" to inspect the startup logs.`)));
      child.on('message', (message) => {
        let data;
        try { data = typeof message === 'string' ? JSON.parse(message) : message; }
        catch { return; }
        // Wrangler's IPC readiness event is sent only after the proxy is ready.
        if (data?.event === 'DEV_SERVER_READY' && data.ip === '127.0.0.1' && Number.isInteger(data.port) && data.port > 0 && data.port < 65536) {
          finish(null, `http://127.0.0.1:${data.port}`);
        }
      });
    });
    return { url, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
