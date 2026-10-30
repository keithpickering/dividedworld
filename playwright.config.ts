/**
 * The keyboard end-to-end flows, against `vite preview` of a build that runs on the in-memory
 * backend (web/src/data/fake.ts). It uses the Chromium the environment provides and never
 * downloads one: a session runs no `playwright install`.
 */
import { defineConfig } from '@playwright/test';

/* One preview per checkout: two worktrees running at once each set their own port, so neither reuses the other's server. */
const port = Number(process.env.KB_E2E_PORT ?? 4173);

export default defineConfig({
  testDir: 'e2e',
  /* Vitest runs e2e/*.test.ts (the board match's self-test); Playwright runs only the specs. */
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: `npx vite build web --mode e2e && npx vite preview web --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
