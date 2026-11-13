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
 * `problems(files)` is pure: `files` maps a repository path to its text (`supabase/config.toml`, every
 * `.ts` under `supabase/functions/` and every `supabase/migrations/*.sql`), and it returns one string
 * per complaint. The CLI reads the files from disk and exits 1 on any.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

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
 * The jobs the migrations leave scheduled that post to a function, as `{ job, fn, command }`.
 * @param {Record<string,string>} files
 * @returns {{ job: string, fn: string, command: string }[]}
 */
export function jobsOf(files) {
  /** @type {Map<string, string>} */
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
      // there, the command is a plain string and the call ends at that `);`.
      const close = rest.indexOf(');');
      const open = rest.match(/\$\w*\$/);
      let command;
      if (open && open.index !== undefined && (close < 0 || open.index < close)) {
        const start = open.index + open[0].length;
        const end = rest.indexOf(open[0], start);
        command = rest.slice(start, end < 0 ? undefined : end);
      } else {
        command = rest.slice(0, close < 0 ? undefined : close);
      }
      events.push({ at: m.index, job: m[1], command });
    }
    for (const m of sql.matchAll(/cron\.unschedule\(\s*'([^']+)'\s*\)/gi)) events.push({ at: m.index, job: m[1], command: null });
    events.sort((a, b) => a.at - b.at);
    for (const e of events) {
      if (e.command === null) scheduled.delete(e.job);
      else scheduled.set(e.job, e.command);
    }
  }
  const jobs = [];
  for (const [job, command] of scheduled) {
    for (const fn of new Set([...command.matchAll(/\/functions\/v1\/([\w-]+)/g)].map((m) => m[1]))) jobs.push({ job, fn, command });
  }
  return jobs;
}

/**
 * A TypeScript text with its comments gone and its strings emptied, in one pass so that a `/*` inside a
 * string and a quote inside a comment mislead nothing. (A template literal's `${}` goes with it.)
 */
function bare(ts) {
  return ts.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, (m) => (/^[/]/.test(m) ? '' : m[0] + m[0]));
}

/** Whether a function's own non-test `.ts` files call `fromTheService(` (an import line alone does not). */
function asksForTheKey(files, fn) {
  const prefix = `${FUNCTIONS}/${fn}/`;
  return Object.keys(files)
    .filter((p) => p.startsWith(prefix) && p.endsWith('.ts') && !p.endsWith('.test.ts'))
    .some((p) => /\bfromTheService\(/.test(bare(files[p])));
}

/** @param {Record<string,string>} files @returns {string[]} */
export function problems(files) {
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
  const found = problems(files);
  for (const p of found) console.error(`  ${p}`);
  if (!found.length) {
    console.log(`  edge-functions: ${functionsOf(files).length} function(s), each with verify_jwt = false; ${jobsOf(files).length} job(s), each sending the jobs key to a function that asks for it`);
  }
  process.exit(found.length ? 1 : 0);
}
