/**
 * The build's check on the e2e cost manifest and the suite's keys.
 *
 *   node tools/check-e2e-cost.mjs
 *
 * Design docs/plans/2026-11-26-e2e-cost-shards-design.md, sections 4 and 5. `problems` is pure:
 * it validates the manifest `e2e/cost.json` (`measured` is null or `{ run, date }`; every spec
 * entry has an integer count >= 1 and a mean > 0; every test entry is a number > 0 whose file
 * has a spec entry), adds `keyProblems(keys)`, and, when it is handed `list` (the list JSON),
 * `listProblems(list)` too. A key string cannot show a title holding " › " (it reads as a
 * describe), so the check passes the list JSON as well as the keys, and the title is found there.
 *
 * It also returns a `report`, which is never a problem: a new spec has no timing until its own CI
 * run, and failing its PR for that would add a push for nothing. The report says what share of the
 * suite's estimated cost was priced by fallback (no test entry, and its spec has none) and the
 * busiest shard's estimate at `shards`: its total over WORKERS, in minutes, against
 * BUDGET_MINUTES, with a line to add a shard number to web.yml's matrix when it is over.
 *
 * The CLI lists the suite (`playwright test --list --reporter=json`, read from stdout), reads
 * e2e/cost.json, and reads `shards` as the length of the e2e job's `shard` list in
 * .github/workflows/web.yml, so the matrix stays the one list. It exits 1 on any problem.
 * Self-test: tools/test-e2e-cost.mjs.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { keysOf, keyProblems, listProblems, price, pack, WORKERS, BUDGET_MINUTES } from './e2e-cost.mjs';

const SEP = ' › ';
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** @param {any} manifest @returns {string[]} */
function manifestProblems(manifest) {
  const out = [];
  if (!isObject(manifest)) return ['the manifest is not an object'];
  const { measured, specs, tests } = manifest;
  if (measured !== null && !(isObject(measured) && typeof measured.run === 'string' && measured.run && typeof measured.date === 'string' && measured.date)) {
    out.push('measured must be null or { run, date } with both strings');
  }
  if (!isObject(specs)) out.push('specs must be an object');
  else {
    for (const [file, s] of Object.entries(specs)) {
      if (!isObject(s) || !Number.isInteger(s.count) || s.count < 1) out.push(`spec ${file}: count must be an integer of at least 1`);
      if (!isObject(s) || typeof s.mean !== 'number' || !(s.mean > 0)) out.push(`spec ${file}: mean must be a number above 0`);
    }
  }
  if (!isObject(tests)) out.push('tests must be an object');
  else {
    for (const [key, secs] of Object.entries(tests)) {
      if (typeof secs !== 'number' || !(secs > 0)) out.push(`test "${key}": seconds must be a number above 0`);
      const file = key.split(SEP)[0];
      if (!isObject(specs) || !(file in specs)) out.push(`test "${key}": its file ${file} has no spec entry`);
    }
  }
  return out;
}

/**
 * @param {{ manifest: any, keys: string[], shards: number, list?: any }} input
 * @returns {{ problems: string[], report: { unpricedShare: number, busiestMinutes: number, lines: string[] } }}
 */
export function problems({ manifest, keys, shards, list }) {
  const found = manifestProblems(manifest);
  const manifestOk = found.length === 0;
  found.push(...keyProblems(keys));
  if (list) found.push(...listProblems(list));
  const usable = manifestOk ? manifest : { specs: {}, tests: {} };
  let all = 0;
  let unpriced = 0;
  for (const key of keys) {
    const cost = price(key, usable);
    all += cost;
    if (typeof usable.tests?.[key] !== 'number' && !usable.specs[key.split(SEP)[0]]) unpriced += cost;
  }
  const share = all > 0 ? unpriced / all : 0;
  const { totals } = pack(keys, usable, shards);
  const busiest = Math.max(0, ...totals) / WORKERS / 60;
  const lines = [
    `${keys.length} tests; ${(share * 100).toFixed(0)}% of the estimated cost is unpriced (priced by fallback)${share > 0 ? ': refresh e2e/cost.json from a CI run' : ''}`,
    `busiest shard at ${shards} shards: ${busiest.toFixed(1)} min of tests over ${WORKERS} workers, budget ${BUDGET_MINUTES} min`,
  ];
  if (busiest > BUDGET_MINUTES) lines.push(`over budget: add a shard number to the e2e matrix in .github/workflows/web.yml`);
  return { problems: found, report: { unpricedShare: share, busiestMinutes: busiest, lines } };
}

/** The length of the e2e job's `shard` list in web.yml. @param {string} text */
export function matrixShards(text) {
  const wf = parse(text);
  for (const job of Object.values(wf.jobs ?? {})) {
    const shard = job?.strategy?.matrix?.shard;
    if (Array.isArray(shard)) return shard.length;
  }
  throw new Error('web.yml has no job with a strategy.matrix.shard list');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
  const run = spawnSync(process.execPath, [cli, 'test', '--list', '--reporter=json'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  let list;
  try {
    list = JSON.parse(run.stdout);
  } catch {
    console.error(`playwright --list did not print JSON (exit ${run.status})\n${run.stderr}`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync('e2e/cost.json', 'utf8'));
  const shards = matrixShards(fs.readFileSync('.github/workflows/web.yml', 'utf8'));
  const { problems: found, report } = problems({ manifest, keys: keysOf(list), shards, list });
  for (const line of report.lines) console.log(line);
  for (const p of found) console.error(`PROBLEM ${p}`);
  if (found.length) {
    console.error(`\n${found.length} problem${found.length === 1 ? '' : 's'}`);
    process.exit(1);
  }
}
