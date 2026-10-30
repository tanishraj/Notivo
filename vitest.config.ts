import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
        test: { name: 'workers', include: ['test/**/*.test.ts'], exclude: ['test/node/**'] },
      },
      {
        // The same suite on Node with SQLite, as the self-hosted server runs it.
        // The lookup test measures D1's rows-read meter, which only Cloudflare reports.
        resolve: { alias: { 'cloudflare:test': fileURLToPath(new URL('./test/node/cloudflare-test.ts', import.meta.url).href) } },
        test: {
          name: 'node',
          environment: 'node',
          include: ['test/**/*.test.ts'],
          exclude: ['test/lookup.test.ts'],
          setupFiles: ['test/node/setup.ts'],
        },
      },
    ],
  },
});
