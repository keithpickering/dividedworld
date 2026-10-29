/**
 * The keyboard end-to-end flows, against `vite preview` of a build that runs on the in-memory
 * backend (web/src/data/fake.ts). It uses the Chromium the environment provides and never
 * downloads one: a session runs no `playwright install`.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:4173' },
  webServer: {
    command: 'vite build web --mode e2e && vite preview web --port 4173 --strictPort',
    url: 'http://localhost:4173',
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
