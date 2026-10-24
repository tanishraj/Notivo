import type { Env as MonitorEnv } from '../src/types';

declare global {
  namespace Cloudflare {
    interface Env extends MonitorEnv {}
  }
}
