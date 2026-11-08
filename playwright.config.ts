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
  /* Tests, not files, are spread over the workers and over CI's shards (.github/workflows/web.yml), so a long spec (a11y) is split
     too. No spec shares state between its tests: none has a beforeAll or a module-level variable a test writes. The one serial block (e2e/shine.spec.ts's timing tests) shares nothing either; it only keeps those tests from slowing each other's frames. */
  fullyParallel: true,
  use: {
    baseURL: `http://localhost:${port}`,
    /*
     * Text is set the same on every machine. A headless Chromium hints its glyphs by default, rounding each advance to a whole
     * pixel, so the same words measure differently at 11.25px and at 12.5px than their outlines say, and a board compared at one
     * size against a build set at the other (a manifest's buildSize) lands a few pixels off on one machine and not another: CI's
     * stock browser failed three board-look boards that a session's passed, whose browser is started with these three flags
     * (e2e/board-snapshot.spec.ts holds the hinting). The other two keep its text's antialiasing and its colors' profile alike.
     */
    launchOptions: { args: ['--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb'] },
  },
  webServer: {
    command: `npx vite build web --mode e2e && npx vite preview web --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
