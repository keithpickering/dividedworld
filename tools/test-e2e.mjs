/**
 * The keyboard end-to-end flows of the web app, under Playwright (playwright.config.ts).
 *
 *   node tools/test-e2e.mjs [playwright args]
 *
 * Outside the build (tools/build.mjs's OUTSIDE_THE_BUILD): it needs a browser, which the build
 * does not have. It runs in .github/workflows/web.yml, and in a session against the Chromium the
 * environment provides; nothing here downloads a browser.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
const r = spawnSync(process.execPath, [cli, 'test', ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
