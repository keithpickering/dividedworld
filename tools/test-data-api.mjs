/**
 * Tests for the guard in tools/check-data-api.mjs.
 *
 *   node tools/test-data-api.mjs
 *
 * The check reads and sets a deployed project's Data API pool through Supabase's management API, so
 * it runs only in the release, and this test is the part of it the build runs. Nothing here connects
 * anywhere: the comparison, the body a --set sends and the retry classification are driven with plain
 * values, the whole run with an injected `fetch` and `sleep`, and the command as a child process only
 * on the refusals, which happen before any request.
 *
 * The poisons, each its own case: equal values; each field differing, named with both values; null
 * declared against a number deployed and the reverse; --set sending only what differs and nothing
 * when equal; a --set whose second read still differs; a declared file with a pool of 0, an idle time
 * of 61, a string, a missing key and an extra key; the command with no project, no file and no token;
 * a 500 then a 200 retried and a 403 thrown at once; the token in no output; and the real declaration.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as checkModule from './check-data-api.mjs';

const { validateDeclared, problems, patchBody, isRetryable, retrying, run, main } = checkModule;

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'check-data-api.mjs');
const TOKEN = 'sbp_secrettoken0123456789';
let pass = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    failures.push(name + (detail ? '  <- ' + detail : ''));
    console.log('  FAIL  ' + name + (detail ? '  <- ' + detail : ''));
  }
  return Boolean(condition);
}

/* ----------------------------------------------------------------------- problems ---- */

const declared = { pool: 2, idleSeconds: 60 };
check('1. equal values are no problem', problems(declared, { db_pool: 2, db_pool_max_idletime: 60 }).length === 0);
let p = problems(declared, { db_pool: 5, db_pool_max_idletime: 60 });
check('2a. a differing pool is named with both values', p.length === 1 && /pool/.test(p[0]) && p[0].includes('2') && p[0].includes('5'), JSON.stringify(p));
p = problems(declared, { db_pool: 2, db_pool_max_idletime: 30 });
check('2b. a differing idle time is named with both values', p.length === 1 && /idle/.test(p[0]) && p[0].includes('60') && p[0].includes('30'), JSON.stringify(p));
p = problems({ pool: null, idleSeconds: 60 }, { db_pool: 2, db_pool_max_idletime: 60 });
check('3a. null declared against a number deployed is a problem', p.length === 1 && /pool/.test(p[0]), JSON.stringify(p));
p = problems(declared, { db_pool: null, db_pool_max_idletime: 60 });
check('3b. a number declared against null deployed is a problem', p.length === 1 && /pool/.test(p[0]), JSON.stringify(p));
check('3c. null against null is no problem', problems({ pool: null, idleSeconds: null }, { db_pool: null, db_pool_max_idletime: null }).length === 0);

/* ----------------------------------------------------------------------- the body ---- */

check('4a. the body holds only the fields that differ', JSON.stringify(patchBody(declared, { db_pool: 5, db_pool_max_idletime: 60 })) === '{"db_pool":2}', JSON.stringify(patchBody(declared, { db_pool: 5, db_pool_max_idletime: 60 })));
check('4b. both differing sends both', JSON.stringify(patchBody(declared, { db_pool: null, db_pool_max_idletime: 30 })) === '{"db_pool":2,"db_pool_max_idletime":60}');
check('4c. equal values send an empty body', Object.keys(patchBody(declared, { db_pool: 2, db_pool_max_idletime: 60 })).length === 0);

/* ----------------------------------------------------------------------- the declared file ---- */

const refused = (name, value) => {
  let err = null;
  try { validateDeclared(value); } catch (e) { err = e; }
  check(name, err !== null, 'was accepted');
};
check('5a. a valid declaration passes through', JSON.stringify(validateDeclared({ pool: 2, idleSeconds: 60 })) === '{"pool":2,"idleSeconds":60}');
check('5a2. null for both is valid', validateDeclared({ pool: null, idleSeconds: null }).pool === null);
refused('5b. a pool of 0 is refused', { pool: 0, idleSeconds: 60 });
refused('5c. an idle time of 61 is refused', { pool: 2, idleSeconds: 61 });
refused('5c2. an idle time of 0 is refused', { pool: 2, idleSeconds: 0 });
refused('5d. a string is refused', { pool: '2', idleSeconds: 60 });
refused('5d2. a fraction is refused', { pool: 2.5, idleSeconds: 60 });
refused('5e. a missing key is refused', { pool: 2 });
refused('5f. an extra key is refused', { pool: 2, idleSeconds: 60, extra: 1 });
refused('5g. a non-object is refused', [2, 60]);

/* ----------------------------------------------------------------------- the command ---- */

/** @param {string[]} argv @param {Record<string, string>} [env] */
function cli(argv, env = {}) {
  /** @type {Record<string, string | undefined>} */
  const e = { ...process.env, ...env };
  if (!('SUPABASE_ACCESS_TOKEN' in env)) delete e.SUPABASE_ACCESS_TOKEN;
  return spawnSync(process.execPath, [script, ...argv], { encoding: 'utf8', timeout: 10_000, env: e });
}
const goodFile = path.join(here, '..', 'instances', 'divided-world', 'data-api.json');
const refuses = (name, argv, env, want) => {
  const c = cli(argv, env);
  check(name, c.status === 2 && want.test(c.stderr) && !c.stderr.includes(TOKEN) && !c.stdout.includes(TOKEN), `${c.status} ${c.stdout}${c.stderr}`);
};
refuses('6a. no --project exits 2', ['--declared', goodFile], { SUPABASE_ACCESS_TOKEN: TOKEN }, /--project/);
refuses('6b. no --declared exits 2', ['--project', 'abcdefghij'], { SUPABASE_ACCESS_TOKEN: TOKEN }, /--declared/);
refuses('6c. no token exits 2', ['--project', 'abcdefghij', '--declared', goodFile], {}, /SUPABASE_ACCESS_TOKEN/);
refuses('6d. a declared file that does not exist exits 2', ['--project', 'abcdefghij', '--declared', path.join(here, 'no-such-file.json')], { SUPABASE_ACCESS_TOKEN: TOKEN }, /declared/);
refuses('6e. a token as an argument is an unknown argument', ['--project', 'abcdefghij', '--declared', goodFile, '--token', TOKEN], { SUPABASE_ACCESS_TOKEN: TOKEN }, /unknown argument/);
refuses('6f. a project that is not a ref exits 2', ['--project', 'a/b', '--declared', goodFile], { SUPABASE_ACCESS_TOKEN: TOKEN }, /--project/);

const real = JSON.parse(fs.readFileSync(goodFile, 'utf8'));
let realOk = true;
try { validateDeclared(real); } catch (e) { realOk = e.message; }
check('7. the real instances/divided-world/data-api.json validates', realOk === true, String(realOk));

/* ----------------------------------------------------------------------- the retry ---- */

check('8a. status 0, 429 and 5xx are retried', [0, 429, 500, 502, 503, 504].every(isRetryable));
check('8b. 400, 401, 403 and 404 are not', [400, 401, 403, 404].every((s) => !isRetryable(s)));

const noSleep = async () => {};

/** A fake fetch answering from a script of [status, body] steps; it records each request. */
/** @param {any[]} steps */
function fakeFetch(steps) {
  const calls = [];
  const f = async (url, init = /** @type {any} */ ({})) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body, auth: init.headers?.Authorization });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step instanceof Error) throw step;
    const [status, body] = step;
    return { status, ok: status >= 200 && status < 300, json: async () => body, text: async () => JSON.stringify(body) };
  };
  f.calls = calls;
  return f;
}
const config = (pool, idle) => [200, { db_pool: pool, db_pool_max_idletime: idle }];
const go = (fetch, opts = {}) => run({ project: 'abcdefghij', declared, set: false, token: TOKEN, ...opts }, { fetch, sleep: noSleep });

{
  const f = fakeFetch([[500, { message: 'oops' }], config(2, 60)]);
  const r = await go(f);
  check('9a. a 500 then a 200 is retried and succeeds', r.problems.length === 0 && f.calls.length === 2, `${f.calls.length} calls ${JSON.stringify(r.problems)}`);
}
{
  const f = fakeFetch([new TypeError('fetch failed'), config(2, 60)]);
  const r = await go(f);
  check('9b. a request that got no answer is retried', r.problems.length === 0 && f.calls.length === 2);
}
{
  const f = fakeFetch([[429, { message: 'slow down' }], config(2, 60)]);
  const r = await go(f);
  check('9c. a 429 is retried', r.problems.length === 0 && f.calls.length === 2);
}
{
  const f = fakeFetch([[503, { message: 'down' }]]);
  let err = null;
  try { await go(f); } catch (e) { err = e; }
  check('9d. three 5xx fail after three attempts', err && f.calls.length === 3 && /503/.test(err.message), `${f.calls.length} calls ${err?.message}`);
}
for (const status of [400, 401, 403, 404]) {
  const f = fakeFetch([[status, { message: `refused ${status} by the api` }]]);
  let err = null;
  try { await go(f); } catch (e) { err = e; }
  check(`9e. a ${status} is thrown at once with the status and the API's message`, err && f.calls.length === 1 && err.message.includes(String(status)) && err.message.includes('by the api'), `${f.calls.length} calls ${err?.message}`);
}
{
  let calls = 0;
  let err = null;
  try { await retrying(() => { calls++; if (calls > 5) throw new Error('past the cap'); throw Object.assign(new Error('x'), { status: 502 }); }, { sleep: noSleep }); } catch (e) { err = e; }
  check('9f. the retry stops at three attempts', calls === 3 && !/past the cap/.test(err?.message), `${calls}`);
}

/* ----------------------------------------------------------------------- the run ---- */

{
  const f = fakeFetch([config(5, 30)]);
  const r = await go(f);
  const get = f.calls[0];
  check('10a. without --set a difference is a problem and nothing is sent but a read', r.problems.length === 2 && f.calls.length === 1 && get.method === 'GET' && get.url === 'https://api.supabase.com/v1/projects/abcdefghij/postgrest' && get.auth === `Bearer ${TOKEN}`, `${f.calls.length} calls ${JSON.stringify(r.problems)}`);
}
{
  const f = fakeFetch([config(5, 60), [200, {}], config(2, 60)]);
  const r = await go(f, { set: true });
  const patch = f.calls[1];
  check('10b. --set sends PATCH to the same address with only what differs, then reads again', r.problems.length === 0 && f.calls.length === 3 && patch.method === 'PATCH' && patch.url === f.calls[0].url && patch.body === '{"db_pool":2}' && f.calls[2].method === 'GET', JSON.stringify(f.calls.map((c) => [c.method, c.body])));
}
{
  const f = fakeFetch([config(2, 60)]);
  const r = await go(f, { set: true });
  check('10c. --set with nothing differing writes nothing', r.problems.length === 0 && f.calls.length === 1 && f.calls.every((c) => c.method === 'GET'), JSON.stringify(f.calls.map((c) => c.method)));
}
{
  const f = fakeFetch([config(5, 60), [200, {}], config(5, 60)]);
  const r = await go(f, { set: true });
  check('10d. a --set whose second read still differs is a problem', r.problems.length === 1 && /pool/.test(r.problems[0]) && f.calls.length === 3, JSON.stringify(r.problems));
}
{
  const f = fakeFetch([[403, { message: `forbidden for ${TOKEN}` }]]);
  let err = null;
  try { await go(f); } catch (e) { err = e; }
  // The message is thrown raw from run(); the command passes it through redact, which this exercises.
  check('11a. redact takes the token out of any message', err && !checkModule.redact(err.message, TOKEN).includes(TOKEN) && checkModule.redact(err.message, TOKEN).includes('forbidden'), err?.message);
}
{
  const f = fakeFetch([config(5, 60)]);
  const r = await go(f);
  check('11b. the lines a run reports never hold the token and name the project and both values', !r.log.join('\n').includes(TOKEN) && r.log.join('\n').includes('abcdefghij') && /5/.test(r.log.join('\n')) && /60/.test(r.log.join('\n')), r.log.join('|'));
}

/* ----------------------------------------------------------------------- the answer's shape ---- */

for (const [name, answer] of [['null', null], ['a string', 'ok'], ['an array', []], ['missing db_pool', { db_pool_max_idletime: 60 }], ['missing db_pool_max_idletime', { db_pool: 2 }]]) {
  const f = fakeFetch([[200, answer]]);
  let err = null;
  try { await go(f, { declared: { pool: null, idleSeconds: null } }); } catch (e) { err = e; }
  check(`12. an answer that is ${name} is an error naming the answer, not a pass`, err instanceof Error && /answer/.test(err.message) && !(err instanceof TypeError), String(err));
}
{
  const f = fakeFetch([[200, { db_pool: 2, db_pool_max_idletime: 60, extra: TOKEN }]]);
  let err = null;
  try { await go(f, { declared: { pool: null, idleSeconds: null } }); } catch (e) { err = e; }
  check('12b. a null in the answer is a value, not a missing field', err === null, String(err));
  const g = fakeFetch([[200, { db_pool: null, db_pool_max_idletime: null }]]);
  const r = await go(g, { declared: { pool: null, idleSeconds: null } });
  check('12c. null for both against null declared is no problem', r.problems.length === 0);
}

/* ----------------------------------------------------------------------- main, driven ---- */

/** Runs main with a fake API and collects what it printed. */
/** @param {string[]} argv @param {any[]} steps @param {Record<string, string | undefined>} [env] */
async function drive(argv, steps, env = { SUPABASE_ACCESS_TOKEN: TOKEN }) {
  const out = [];
  const err = [];
  const f = fakeFetch(steps);
  const code = await main(argv, env, { fetch: f, sleep: noSleep, out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, text: [...out, ...err].join('\n'), f };
}
const args = ['--project', 'abcdefghij', '--declared', goodFile];
{
  const d = await drive(args, [[403, { message: `forbidden, token ${TOKEN} is wrong` }]]);
  check('13a. a thrown API error carrying the token exits 1 and prints it nowhere', d.code === 1 && d.text.includes('forbidden') && !d.text.includes(TOKEN), `${d.code} ${d.text}`);
}
{
  const d = await drive(args, [[200, { db_pool: 5, db_pool_max_idletime: 60, note: TOKEN }]]);
  check('13b. the problems path exits 1, names the values and prints no token', d.code === 1 && /problem/.test(d.text) && d.text.includes('5') && !d.text.includes(TOKEN), `${d.code} ${d.text}`);
}
{
  const d = await drive(args, [[200, { db_pool: 2, db_pool_max_idletime: 60 }]]);
  check('13c. equal values exit 0', d.code === 0 && !d.text.includes(TOKEN), `${d.code} ${d.text}`);
}
{
  const d = await drive(args, [[200, null]]);
  check('13d. a malformed answer exits 1 naming the answer', d.code === 1 && /answer/.test(d.text), `${d.code} ${d.text}`);
}
{
  const d = await drive(['--project', 'abcdefghij', '--declared', goodFile], [[200, {}]], {});
  check('13e. no token exits 2 through main and makes no request', d.code === 2 && d.f.calls.length === 0, `${d.code} ${d.text}`);
}
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'data-api-'));
  const bad = path.join(dir, 'bad.json');
  const broken = path.join(dir, 'broken.json');
  fs.writeFileSync(bad, '{ "pool": 0, "idleSeconds": 60 }');
  fs.writeFileSync(broken, '{ not json');
  refuses('13f. a declared file out of range exits 2 on the command', ['--project', 'abcdefghij', '--declared', bad], { SUPABASE_ACCESS_TOKEN: TOKEN }, /pool/);
  refuses('13g. a declared file that does not parse exits 2 on the command', ['--project', 'abcdefghij', '--declared', broken], { SUPABASE_ACCESS_TOKEN: TOKEN }, /declared/);
  const d = await drive(['--project', 'abcdefghij', '--declared', bad], [[200, {}]]);
  check('13h. through main the out-of-range file exits 2 with no request', d.code === 2 && d.f.calls.length === 0, `${d.code}`);
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  // The token straddles character 200 of the answer: cutting before redacting would leave a prefix of it.
  const d = await drive(args, [[200, { pad: 'x'.repeat(172), note: TOKEN }]]);
  check('13i. a malformed answer with the token across character 200 prints no part of it', d.code === 1 && /answer/.test(d.text) && !d.text.includes(TOKEN.slice(0, 8)) && !d.text.includes(TOKEN.slice(-8)), `${d.code} ${d.text}`);
}

/* ----------------------------------------------------------------------- the tail ---- */

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error('  FAILED: ' + f);
  process.exit(1);
}
