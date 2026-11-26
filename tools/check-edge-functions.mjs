/**
 * Every Edge Function is deployed with its JWT check off, and every job that calls one sends the jobs key
 * and the function asks for it, held by a build check.
 *
 *   node tools/check-edge-functions.mjs
 *
 * Three lists must agree, and nothing held them together: the function folders under
 * `supabase/functions/` (what a deploy uploads), the `[functions.<name>]` tables in
 * `supabase/config.toml` (how each is deployed), and the scheduled jobs in the migrations that post
 * to `/functions/v1/<name>` (who calls them, and with what). `conceal` arrived as a folder and a job
 * and never got its table, so it deployed with the platform's JWT check on. That check takes the
 * legacy keys only, the job sends the `kayfabb_jobs` secret key in `apikey` and no JWT, and the
 * gateway refused every call before the function ran (issue #646). A post quoting a hidden post
 * then waited, as "It will show again in a moment", for a job that could not run. Every function
 * turns the platform's check off and authorizes in its own code (docs/plans/2026-11-02-api-keys-design.md,
 * section 2), so a function without that line is one the platform's check will refuse.
 *
 * The rules, each complaint naming its rule and the function or job:
 *   E1  every function has a `[functions.<name>]` table whose `verify_jwt` is `false`.
 *   E2  every `[functions.<name>]` table names a function (a removed or renamed one leaves its table behind).
 *   E3  every job's function exists.
 *   E4  every job's command sends `'apikey'` as a header key and no `Authorization` header: the
 *       functions take the jobs key in `apikey` alone (`fromTheService`, supabase/functions/_shared/serve.ts).
 *   E5  every job's function calls `fromTheService(` in a non-test `.ts` of its own folder. With the
 *       platform's check off, a function a job calls and that never asks for the key runs for any caller.
 *   E6  every function job's function calls `asJob('<the job that posts to it>', ...)` in a non-test `.ts` of its
 *       own folder, and every SQL job's command calls `record_job_run('<its own name>')` after its first
 *       statement and no other job's. A job that never records reads stopped for ever (issue #653,
 *       docs/plans/2026-11-20-job-health-design.md): pg_cron's `succeeded` only says a request was queued.
 *   E7  every scheduled job is in the engine's `JOBS` (engine/rules/jobs.ts), has a `jobGraceMinutes` key
 *       (instances/divided-world/settings.ts) and has its row begun, and every `JOBS` entry is scheduled. A job
 *       the engine does not list is never watched; a job with no grace has no time to be late by; and a job
 *       whose schedule never notes its row reads stopped from its seed. The row is begun when the job's latest
 *       schedule function (the migration that last calls `cron.schedule` for it, to the end of that function)
 *       calls `note_job_scheduled('<job>')`, or when some migration's `insert into job_runs` names it.
 * A `files` with no config.toml, or with no function, is a complaint too: a check over nothing has
 * nothing wrong in it.
 *
 * A job is a `cron.schedule('<job>', ...)` (any letter case) in a migration whose command, in any
 * `$tag$` dollar quote or a plain string, posts to `/functions/v1/<name>`; a command that names several
 * functions is held for each. `--` and block comments are not read. The migrations are read in
 * file-name order, the last schedule of a job name is the job (0071 rescheduled 0004's and 0047's
 * commands), and a later `cron.unschedule('<job>')` ends it. A schedule whose command names no
 * function (`kayfabb-system-tick`) is not held to E3 to E5. There is no TOML package, so the tables are read by line, as tools/check-release-workflows.mjs reads netlify.toml:
 * a line that starts with `#` is not a setting, and a key belongs to the latest table header. E5 reads a
 * function's `.ts` with comments removed and strings emptied, so a call named in either is no call.
 *
 * `problems(files, { jobs, grace })` is pure: `jobs` and `grace` are the engine's job names and the instance's
 * grace keys (the CLI reads them with `readContext`), and `files` maps a repository path to its text (`supabase/config.toml`, every
 * `.ts` under `supabase/functions/` and every `supabase/migrations/*.sql`), and it returns one string
 * per complaint. The CLI reads the files from disk and exits 1 on any.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CONFIG = 'supabase/config.toml';
const FUNCTIONS = 'supabase/functions';
const MIGRATIONS = 'supabase/migrations';

/**
 * The functions: a folder directly under supabase/functions/, other than `_shared`, with an index.ts.
 * @param {Record<string,string>} files @returns {string[]}
 */
export function functionsOf(files) {
  const names = [];
  for (const path of Object.keys(files)) {
    const m = path.match(/^supabase\/functions\/([^/]+)\/index\.ts$/);
    if (m && m[1] !== '_shared') names.push(m[1]);
  }
  return names.sort();
}

/**
 * Each `[functions.<name>]` table of config.toml and its `verify_jwt` (`'true'`, `'false'`, or
 * undefined where the table has none). A key belongs to the latest table header, of any kind.
 * @param {string} toml @returns {Map<string, string|undefined>}
 */
function functionTables(toml) {
  /** @type {Map<string, string|undefined>} */
  const tables = new Map();
  let current = null;
  for (const line of toml.split('\n')) {
    // A `#` line matches neither pattern below: both are anchored on the line's first character that is not a space.
    const head = line.match(/^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/);
    if (head) {
      const fn = head[1].match(/^functions\.(?:"([^"]+)"|([\w-]+))$/);
      current = fn ? fn[1] ?? fn[2] : null;
      if (current !== null && !tables.has(current)) tables.set(current, undefined);
      continue;
    }
    const key = line.match(/^\s*verify_jwt\s*=\s*(true|false)\s*(#.*)?$/);
    if (key && current !== null) tables.set(current, key[1]);
  }
  return tables;
}

/**
 * The last string literal of a plain-string schedule call, read from just after the job name: a SQL string runs
 * to its closing quote, `''` being a quote inside it, and the call ends at the first `)` outside every string.
 * A SQL job's command holds `);` of its own, so the first `);` is no end for it.
 * @param {string} rest @returns {string}
 */
function plainCommand(rest) {
  let depth = 0;
  let last = '';
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (c === "'") {
      let j = i + 1;
      let text = '';
      for (; j < rest.length; j++) {
        if (rest[j] === "'" && rest[j + 1] === "'") { text += "'"; j++; } else if (rest[j] === "'") break; else text += rest[j];
      }
      last = text;
      i = j;
    } else if (c === '(') depth++;
    else if (c === ')') { if (depth === 0) break; depth--; }
  }
  return last;
}

/**
 * Every job the migrations leave scheduled, function jobs and SQL jobs, as `{ job, command, path, after }`:
 * `command` is the last schedule's, `path` its migration and `after` the text of that migration from the
 * schedule call to the end of the function it sits in (where a schedule function notes its row).
 * @param {Record<string,string>} files
 * @returns {{ job: string, command: string, path: string, after: string }[]}
 */
export function scheduledOf(files) {
  /** @type {Map<string, { command: string, path: string, after: string }>} */
  const scheduled = new Map();
  const paths = Object.keys(files).filter((p) => /^supabase\/migrations\/[^/]+\.sql$/.test(p)).sort();
  for (const path of paths) {
    // A `--` or block comment may name a job it does not schedule; the bodies here hold no `--` of their own.
    const sql = files[path].replace(/(^|\s)--[^\n]*|\/\*[\s\S]*?\*\//g, '$1');
    const events = [];
    for (const m of sql.matchAll(/cron\.schedule\(\s*'([^']+)'/gi)) {
      const rest = sql.slice(m.index + m[0].length);
      // A command in any `$tag$` dollar quote runs to the matching tag, so an inner `);` does not end it. The
      // quote is the first one that opens before the call's first `);`, whatever the schedule before it is
      // (a plain string, or `setting('x') #>> '{}'` as settle, meet, chatter and staff have it); with none
      // there, the command is a plain string.
      const close = rest.indexOf(');');
      const open = rest.match(/\$\w*\$/);
      let command;
      let end;
      if (open && open.index !== undefined && (close < 0 || open.index < close)) {
        const start = open.index + open[0].length;
        const stop = rest.indexOf(open[0], start);
        command = rest.slice(start, stop < 0 ? undefined : stop);
        end = stop < 0 ? rest.length : stop + open[0].length;
      } else {
        command = plainCommand(rest);
        end = close < 0 ? rest.length : close;
      }
      const tail = rest.slice(end);
      const fnEnd = tail.search(/\bend\b\s*\$\w*\$/);
      events.push({ at: m.index, job: m[1], command, after: fnEnd < 0 ? tail : tail.slice(0, fnEnd) });
    }
    for (const m of sql.matchAll(/cron\.unschedule\(\s*'([^']+)'\s*\)/gi)) events.push({ at: m.index, job: m[1], command: null, after: '' });
    events.sort((a, b) => a.at - b.at);
    for (const e of events) {
      if (e.command === null) scheduled.delete(e.job);
      else scheduled.set(e.job, { command: e.command, path, after: e.after });
    }
  }
  return [...scheduled].map(([job, v]) => ({ job, ...v }));
}

/**
 * The jobs the migrations leave scheduled that post to a function, as `{ job, fn, command }`.
 * @param {Record<string,string>} files
 * @returns {{ job: string, fn: string, command: string }[]}
 */
export function jobsOf(files) {
  const jobs = [];
  for (const { job, command } of scheduledOf(files)) {
    for (const fn of new Set([...command.matchAll(/\/functions\/v1\/([\w-]+)/g)].map((m) => m[1]))) jobs.push({ job, fn, command });
  }
  return jobs;
}

/**
 * A TypeScript text with its comments gone and its strings emptied (or, given `strings`, swapped for their index in it), in one pass so that a `/*` inside a
 * string and a quote inside a comment mislead nothing. (A template literal's `${}` goes with it.)
 */
function bare(ts, strings) {
  return ts.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, (m) => (/^[/]/.test(m) ? '' : strings ? `'${strings.push(m.slice(1, -1)) - 1}'` : m[0] + m[0]));
}

/** Whether a function's own non-test `.ts` files call `fromTheService(` (an import line alone does not). */
function asksForTheKey(files, fn) {
  const prefix = `${FUNCTIONS}/${fn}/`;
  return Object.keys(files)
    .filter((p) => p.startsWith(prefix) && p.endsWith('.ts') && !p.endsWith('.test.ts'))
    .some((p) => /\bfromTheService\(/.test(bare(files[p])));
}

/**
 * The engine's job names (`JOBS`, engine/rules/jobs.ts) and Divided World's `jobGraceMinutes`
 * (instances/divided-world/settings.ts): the two lists E7 holds the schedules to. A `.ts` is imported the way
 * tools/check-guide.mjs imports one.
 * @returns {Promise<{ jobs: string[], grace: Record<string, number> }>}
 */
export async function readContext(root = '.') {
  const load = (rel) => import(pathToFileURL(path.resolve(root, rel)).href);
  const { JOBS } = await load('engine/rules/jobs.ts');
  const { defaults } = await load('instances/divided-world/settings.ts');
  return { jobs: JOBS.map((j) => j.name), grace: defaults.jobGraceMinutes };
}

/**
 * Whether a function's own non-test `.ts` files call `asJob(` with the string literal `job` as its first argument,
 * read from the text with comments gone, so a call named in a comment or a string is no call. Each string is
 * swapped for its index, so the one that follows `asJob(` is looked up and no other string is read as code.
 */
function recordsAs(files, fn, job) {
  const prefix = `${FUNCTIONS}/${fn}/`;
  return Object.keys(files)
    .filter((p) => p.startsWith(prefix) && p.endsWith('.ts') && !p.endsWith('.test.ts'))
    .some((p) => {
      /** @type {string[]} */
      const strings = [];
      const text = bare(files[p], strings);
      return [...text.matchAll(/\basJob\(\s*'(\d+)'/g)].some((m) => strings[Number(m[1])] === job);
    });
}

/**
 * E6 for a SQL job: its command calls `record_job_run('<job>')`, after the first statement, and no other job's name.
 * @param {string} job @param {string} command @returns {string[]}
 */
function sqlRecordProblems(job, command) {
  const out = [];
  const calls = [...command.matchAll(/\brecord_job_run\(\s*'([^']*)'\s*\)/g)];
  const own = calls.find((m) => m[1] === job);
  for (const m of calls) {
    if (m[1] !== job) out.push(`${MIGRATIONS}: E6 SQL job ${job} records as another job (record_job_run('${m[1]}')); record its own name`);
  }
  if (!own) {
    if (!calls.length) out.push(`${MIGRATIONS}: E6 SQL job ${job}'s command never calls record_job_run('${job}'); with no heartbeat it reads stopped for ever`);
    return out;
  }
  const first = command.indexOf(';');
  if (first < 0 || own.index < first) out.push(`${MIGRATIONS}: E6 SQL job ${job} records before its work; call record_job_run('${job}') after the first statement, so a run that throws records nothing`);
  return out;
}

/**
 * @param {Record<string,string>} files
 * @param {{ jobs: readonly string[], grace: Readonly<Record<string, number>> }} context the engine's job names and the instance's grace keys
 * @returns {string[]}
 */
export function problems(files, context) {
  if (!context) throw new Error('problems(files, { jobs, grace }): E7 needs the engine\'s job names and the instance\'s jobGraceMinutes');
  const { jobs, grace } = context;
  const out = [];
  const fns = functionsOf(files);
  if (!(CONFIG in files)) out.push(`${CONFIG}: is missing; with no tables, every function would deploy with the platform's JWT check on`);
  if (!fns.length) out.push(`${FUNCTIONS}: holds no function (a folder with an index.ts); a check over nothing has nothing wrong in it`);

  if (CONFIG in files) {
    const tables = functionTables(files[CONFIG]);
    for (const fn of fns) {
      const jwt = tables.get(fn);
      if (!tables.has(fn)) out.push(`${CONFIG}: E1 function ${fn} has no [functions.${fn}] table; add it with verify_jwt = false`);
      else if (jwt === undefined) out.push(`${CONFIG}: E1 function ${fn}'s table has no verify_jwt setting; set verify_jwt = false`);
      else if (jwt !== 'false') out.push(`${CONFIG}: E1 function ${fn} has verify_jwt = ${jwt}; set it to false`);
    }
    for (const name of tables.keys()) {
      if (!fns.includes(name)) out.push(`${CONFIG}: E2 [functions.${name}] names no function folder with an index.ts; remove the table or restore the function`);
    }
  }

  const sendChecked = new Set(); // a command naming two functions is one command: E4 speaks once
  for (const { job, fn, command } of jobsOf(files)) {
    if (!fns.includes(fn)) {
      out.push(`${MIGRATIONS}: E3 job ${job} posts to /functions/v1/${fn}, which is not a function; fix the name or add the function`);
      continue;
    }
    const first = !sendChecked.has(job);
    sendChecked.add(job);
    if (first && !/'apikey'\s*,/.test(command)) out.push(`${MIGRATIONS}: E4 job ${job} does not send the jobs key in apikey; send it there, as the other jobs do`);
    if (first && /authorization/i.test(command)) out.push(`${MIGRATIONS}: E4 job ${job} sends an Authorization header; the functions take the jobs key in apikey alone`);
    if (!asksForTheKey(files, fn)) {
      out.push(`${FUNCTIONS}/${fn}: E5 job ${job} calls this function, which never calls fromTheService( outside a test; with the platform's check off it would run for any caller`);
    }
    if (!recordsAs(files, fn, job)) {
      out.push(`${FUNCTIONS}/${fn}: E6 job ${job} posts to this function, which never calls asJob('${job}', ...) outside a test; with no heartbeat the job reads stopped for ever`);
    }
  }

  const scheduled = scheduledOf(files);
  const allSql = Object.entries(files).filter(([p]) => /^supabase\/migrations\/[^/]+\.sql$/.test(p)).map(([, t]) => t.replace(/(^|\s)--[^\n]*|\/\*[\s\S]*?\*\//g, '$1')).join('\n');
  for (const { job, command, after } of scheduled) {
    if (!/\/functions\/v1\/[\w-]+/.test(command)) out.push(...sqlRecordProblems(job, command));
    if (!jobs.includes(job)) out.push(`${MIGRATIONS}: E7 job ${job} is scheduled but is not in JOBS (engine/rules/jobs.ts), so nothing watches it; add it there`);
    if (!Object.hasOwn(grace, job)) out.push(`${MIGRATIONS}: E7 job ${job} has no jobGraceMinutes entry in the instance's settings; add one`);
    const noted = new RegExp(`\\bnote_job_scheduled\\(\\s*'${job}'\\s*\\)`).test(after)
      || new RegExp(`insert\\s+into\\s+(?:public\\.)?job_runs\\b[^;]*'${job}'`, 'i').test(allSql);
    if (!noted) out.push(`${MIGRATIONS}: E7 job ${job}'s schedule function never calls note_job_scheduled('${job}') and no insert into job_runs names it, so its row never begins and it reads stopped from its seed`);
  }
  const live = new Set(scheduled.map((s) => s.job));
  for (const job of jobs) {
    if (!live.has(job)) out.push(`${MIGRATIONS}: E7 JOBS lists ${job} but no migration leaves it scheduled; schedule it or remove the entry`);
  }
  return out;
}

/**
 * config.toml, every `.ts` under supabase/functions/ and every migration, read from disk.
 * @returns {Record<string, string>}
 */
export function readFiles(root = '.') {
  /** @type {Record<string, string>} */
  const files = {};
  if (fs.existsSync(`${root}/${CONFIG}`)) files[CONFIG] = fs.readFileSync(`${root}/${CONFIG}`, 'utf8');
  /** @param {string} rel */
  const walk = (rel) => {
    for (const e of fs.readdirSync(`${root}/${rel}`, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      if (e.isDirectory()) walk(`${rel}/${e.name}`);
      else if (e.name.endsWith('.ts')) files[`${rel}/${e.name}`] = fs.readFileSync(`${root}/${rel}/${e.name}`, 'utf8');
    }
  };
  if (fs.existsSync(`${root}/${FUNCTIONS}`)) walk(FUNCTIONS);
  const dir = `${root}/${MIGRATIONS}`;
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort() : []) {
    files[`${MIGRATIONS}/${f}`] = fs.readFileSync(`${dir}/${f}`, 'utf8');
  }
  return files;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const files = readFiles();
  const found = problems(files, await readContext());
  for (const p of found) console.error(`  ${p}`);
  if (!found.length) {
    console.log(`  edge-functions: ${functionsOf(files).length} function(s), each with verify_jwt = false; ${jobsOf(files).length} job(s), each sending the jobs key to a function that asks for it`);
  }
  process.exit(found.length ? 1 : 0);
}
