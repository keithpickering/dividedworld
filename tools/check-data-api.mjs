/**
 * Guard: the Data API's connection pool on the deployed project is what the instance declares, and
 * the release sets it where it is not.
 *
 *   node tools/check-data-api.mjs --project <ref> --declared <file> [--set]
 *
 * The pool is part of how the warm reads work (docs/plans/2026-11-15-warm-reads-design.md, section 3):
 * each pooled connection keeps the plans it has made, and a pool left at Supabase's automatic size can
 * go back to timing out unnoticed. The instance declares it in instances/divided-world/data-api.json:
 * `pool` is a whole number of 1 or more, or null for the automatic size; `idleSeconds` is a whole
 * number from 1 to 60, or null for the default. Anything else is refused before a request is made.
 *
 * It reads GET https://api.supabase.com/v1/projects/<ref>/postgrest and compares `db_pool` with `pool`
 * and `db_pool_max_idletime` with `idleSeconds`. Without --set a difference is a problem, named with
 * both values. With --set it sends PATCH to the same address with only the fields that differ, then
 * reads again and compares; nothing is written when nothing differs, so a night with nothing to change
 * does not restart the API's pool. The field names and ranges are Supabase's management API reference
 * as read on 2026-11-15 (v1-update-postgrest-service-config).
 *
 * It reads and writes a deployed project through the management API, which the build has not got, so
 * it runs only in the release and is not a step of tools/build.mjs; tools/test-data-api.mjs, which is,
 * drives it red without connecting anywhere (`fetch` and `sleep` are injected). The token is read from
 * SUPABASE_ACCESS_TOKEN and never from an argument. It prints the project ref and the two values, never
 * the token, and every message passes through redact(), which takes the token out and then scrub()s
 * (tools/instance-files.mjs).
 *
 * A request that got no answer, a 429 and a 5xx are tried again, three attempts with a pause that
 * doubles between them: those are facts about the network or the moment. A 400, 401, 403 or 404, or
 * any other answer, is a fact about the request and is thrown at once with its status and the API's
 * message.
 * Exit status: 0 no problems, 1 problems (each names both values), 2 refused.
 */

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { scrub } from './instance-files.mjs';

const API = 'https://api.supabase.com/v1/projects';
const KEYS = ['pool', 'idleSeconds'];

/** A message with the token and any password taken out. */
export function redact(text, token) {
  const s = String(text);
  return scrub(token ? s.split(token).join('<token>') : s);
}

/** The declaration, checked: exactly `pool` and `idleSeconds`, each in range or null. Throws on anything else. */
export function validateDeclared(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('the declared file is not an object with pool and idleSeconds');
  for (const k of Object.keys(value)) if (!KEYS.includes(k)) throw new Error(`the declared file has a key ${k}; the keys are pool and idleSeconds`);
  for (const k of KEYS) if (!(k in value)) throw new Error(`the declared file has no ${k}; use null for the default`);
  const { pool, idleSeconds } = value;
  if (pool !== null && !(Number.isInteger(pool) && pool >= 1)) throw new Error(`pool is ${JSON.stringify(pool)}; it is a whole number of 1 or more, or null`);
  if (idleSeconds !== null && !(Number.isInteger(idleSeconds) && idleSeconds >= 1 && idleSeconds <= 60)) throw new Error(`idleSeconds is ${JSON.stringify(idleSeconds)}; it is a whole number from 1 to 60, or null`);
  return { pool, idleSeconds };
}

/** The declared fields beside the API's names for them. */
const FIELDS = [['pool', 'db_pool'], ['idleSeconds', 'db_pool_max_idletime']];
const show = (v) => (v === null || v === undefined ? 'automatic (null)' : String(v));

/** What is wrong between the declaration and the deployed config, each naming both values. */
export function problems(declared, deployed) {
  const out = [];
  for (const [key, field] of FIELDS) {
    const want = declared[key];
    const have = deployed[field];
    if (want !== have) out.push(`${key === 'pool' ? 'pool' : 'idle time'} (${field}) is ${show(have)} on the project and ${show(want)} in the declaration`);
  }
  return out;
}

/** The body a --set sends: only the fields that differ, under the API's names. */
export function patchBody(declared, deployed) {
  const body = {};
  for (const [key, field] of FIELDS) if (declared[key] !== deployed[field]) body[field] = declared[key];
  return body;
}

/** A status worth another try: no answer (0), too many requests, or a server error. */
export const isRetryable = (status) => status === 0 || status === 429 || status >= 500;

/** Runs `fn` up to `attempts` times, repeating only after a retryable status, pausing twice as long each time. */
export async function retrying(fn, { attempts = 3, baseMs = 1000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= attempts || !isRetryable(e?.status ?? -1)) throw e;
      await sleep(baseMs * 2 ** (attempt - 1));
    }
  }
}

/** The API's answer, checked: an object that holds both fields (null is a value, absent is not). Throws naming the answer. */
export function expectConfig(answer, token) {
  // Redacted before it is cut: a token across the cut would otherwise print as a prefix of itself.
  const shown = redact(JSON.stringify(answer) ?? String(answer), token).slice(0, 200);
  if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) throw new Error(`the API's answer is not an object with db_pool and db_pool_max_idletime: ${shown}`);
  for (const [, field] of FIELDS) if (!(field in answer)) throw new Error(`the API's answer has no ${field}, so the response shape may have changed: ${shown}`);
  return answer;
}

/** One request to the project's postgrest config; a status outside 2xx, or no answer, throws with `status` (0 for none). */
async function call({ project, token, fetch, sleep }, method, body) {
  return retrying(async () => {
    let res;
    try {
      res = await fetch(`${API}/${project}/postgrest`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (e) {
      throw Object.assign(new Error(`${method} got no answer: ${e?.message ?? e}`), { status: 0 });
    }
    if (!res.ok) {
      let message = '';
      try { message = await res.text(); } catch { /* the status is what matters */ }
      throw Object.assign(new Error(`${method} answered ${res.status}: ${message}`), { status: res.status });
    }
    const answer = await res.json();
    return method === 'GET' ? expectConfig(answer, token) : answer;
  }, { sleep });
}

/**
 * Reads, and with `set` writes what differs and reads again. Returns the problems left and the lines
 * to print; fetch and sleep are injected.
 */
export async function run({ project, declared, set, token }, { fetch, sleep }) {
  const ctx = { project, token, fetch, sleep };
  const log = [`reading the Data API config of project ${project}`];
  const describe = (d) => `pool ${show(d.db_pool)}, idle time ${show(d.db_pool_max_idletime)} s`;
  let deployed = await call(ctx, 'GET');
  log.push(`  deployed: ${describe(deployed)}; declared: pool ${show(declared.pool)}, idle time ${show(declared.idleSeconds)} s`);
  let found = problems(declared, deployed);
  if (set && found.length) {
    const body = patchBody(declared, deployed);
    await call(ctx, 'PATCH', body);
    log.push(`  set ${Object.keys(body).join(' and ')}`);
    deployed = await call(ctx, 'GET');
    log.push(`  deployed now: ${describe(deployed)}`);
    found = problems(declared, deployed);
  }
  return { problems: found, deployed, log };
}

/** What the command was asked for, or the plain reason it refuses (`refusal`); nothing here makes a request. */
export function parseArgs(argv, env = process.env) {
  let project;
  let declared;
  let set = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') project = argv[++i];
    else if (argv[i] === '--declared') declared = argv[++i];
    else if (argv[i] === '--set') set = true;
    else return { refusal: `unknown argument ${argv[i]}; the arguments are --project <ref>, --declared <file> and --set (the token is SUPABASE_ACCESS_TOKEN, never an argument)` };
  }
  if (!project || !/^[a-z0-9]+$/i.test(project)) return { refusal: 'no --project, or it is not a project ref: name the project to read, explicitly; there is no default' };
  if (!declared) return { refusal: 'no --declared: name the file that declares the pool (instances/<instance>/data-api.json)' };
  const token = env.SUPABASE_ACCESS_TOKEN;
  if (!token) return { refusal: 'SUPABASE_ACCESS_TOKEN is not set: the release\'s secret is missing from its environment' };
  let value;
  try { value = validateDeclared(JSON.parse(fs.readFileSync(declared, 'utf8'))); } catch (e) {
    return { refusal: `the --declared file cannot be used: ${e.message}` };
  }
  return { project, declared: value, set, token };
}

/**
 * The command, with its argv, environment and I/O handed in so the test can drive it: resolves to the
 * exit status (0 no problems, 1 problems or a failed request, 2 refused). Everything it prints passes
 * through redact().
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @param {{ fetch: any, sleep?: (ms: number) => Promise<void>, out?: (line: string) => void, err?: (line: string) => void }} io
 */
export async function main(argv, env, { fetch, sleep, out = console.log, err = console.error }) {
  const a = parseArgs(argv, env);
  if (a.refusal) {
    err(`  data-api: refused: ${redact(a.refusal, env.SUPABASE_ACCESS_TOKEN)}`);
    return 2;
  }
  try {
    const r = await run(/** @type {any} */ (a), { fetch, sleep });
    for (const line of r.log) out(redact(line, a.token));
    if (r.problems.length) {
      err(`  data-api: ${r.problems.length} problem(s):`);
      for (const f of r.problems) err(`    ${redact(f, a.token)}`);
      return 1;
    }
    out('  data-api: the project holds what the instance declares');
    return 0;
  } catch (e) {
    err(`  data-api: ${redact(e?.message ?? e, a.token)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2), process.env, { fetch: globalThis.fetch });
}
