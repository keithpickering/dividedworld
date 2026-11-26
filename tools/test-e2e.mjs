/**
 * The keyboard end-to-end flows of the web app, under Playwright (playwright.config.ts).
 *
 *   node tools/test-e2e.mjs [playwright args]
 *   node tools/test-e2e.mjs --cost-shard=k/n [playwright args]
 *
 * Outside the build (tools/build.mjs's OUTSIDE_THE_BUILD): it needs a browser, which the build
 * does not have. It runs in .github/workflows/web.yml, and in a session against the Chromium the
 * environment provides; nothing here downloads a browser.
 *
 * With --cost-shard=k/n (design docs/plans/2026-11-26-e2e-cost-shards-design.md, section 2) it
 * runs shard k of n of the suite, cut by cost (tools/e2e-cost.mjs): it lists the suite, refuses on
 * key problems, packs with e2e/cost.json, writes e2e/report/timings/shard.list (what Playwright is
 * told to run) and assigned.json ({ k, n, commit, keys }, what CI uploads beside results.json),
 * runs Playwright on that list, and compares the json report with what was assigned. A missing or
 * an extra key exits 1 even when Playwright passed, so a shard that quietly ran something else
 * cannot refresh the manifest. Without --cost-shard it runs Playwright exactly as before.
 *
 * KB_E2E_POISON_LIST=1 exists only to drive that comparison red: it changes one key in shard.list
 * to a title that does not exist, so the run must exit 1 naming the missing key. Never set it
 * outside that test.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { parseCostShard, keysOf, keyProblems, listProblems, pack, compareRun, testList, WORKERS } from './e2e-cost.mjs';
import { listSuite } from './check-e2e-cost.mjs';

const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
const argv = process.argv.slice(2);

function plain() {
  const r = spawnSync(process.execPath, [cli, 'test', ...argv], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

let shard;
try {
  shard = parseCostShard(argv);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
if (shard === null) plain();
else {
  const { k, n, rest } = shard;
  const dir = 'e2e/report/timings';
  const listFile = `${dir}/shard.list`;
  const resultsFile = `${dir}/results.json`;

  const listed = listSuite();
  if ('error' in listed) {
    console.error(listed.error);
    process.exit(1);
  }
  const keys = keysOf(listed.list);
  const found = [...keyProblems(keys), ...listProblems(listed.list)];
  if (found.length) {
    for (const p of found) console.error(`PROBLEM ${p}`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync('e2e/cost.json', 'utf8'));
  const { shards, totals } = pack(keys, manifest, n);
  const mine = shards[k - 1];
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();

  fs.mkdirSync(dir, { recursive: true });
  /* An old report left in the folder would be compared as this run's: remove it before Playwright writes its own. */
  fs.rmSync(resultsFile, { force: true });
  fs.writeFileSync(path.join(dir, 'assigned.json'), `${JSON.stringify({ k, n, commit, keys: mine }, null, 2)}\n`);
  const onList = process.env.KB_E2E_POISON_LIST === '1' && mine.length > 0 ? [`${mine[0]} (poisoned)`, ...mine.slice(1)] : mine;
  fs.writeFileSync(listFile, testList(onList));
  console.log(`shard ${k} of ${n}: ${mine.length} tests, about ${(totals[k - 1] / WORKERS / 60).toFixed(1)} min`);

  const r = spawnSync(process.execPath, [cli, 'test', ...rest, '--test-list', listFile], { stdio: 'inherit' });

  if (!fs.existsSync(resultsFile)) {
    console.error(`no report at ${resultsFile}: Playwright wrote none (is the CI json reporter on? CI=1), so the run cannot be compared with what was assigned`);
    process.exit(1);
  }
  const { missing, extra } = compareRun(mine, JSON.parse(fs.readFileSync(resultsFile, 'utf8')));
  for (const key of missing) console.error(`MISSING assigned but not run: ${key}`);
  for (const key of extra) console.error(`EXTRA run but not assigned: ${key}`);
  if (missing.length || extra.length) {
    console.error(`shard ${k} of ${n}: ${missing.length} missing, ${extra.length} extra (Playwright exited ${r.status})`);
    process.exit(1);
  }
  process.exit(r.status ?? 1);
}
