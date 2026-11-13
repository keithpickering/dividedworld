/**
 * The shape of the daily release, held by a build check.
 *
 *   node tools/check-release-workflows.mjs
 *
 * Production moves once a day, in `.github/workflows/release.yml`, and nowhere else (design
 * docs/plans/2026-11-05-daily-release-design.md, sections 1 and 3): the candidate is main's head,
 * it is built, its SQL suite and e2e flows run, and only then does `production` fast-forward to
 * it. Netlify builds `production`. The release is a handful of `needs:` edges, a ref passed
 * down to three called workflows and a push that must never force, and a quiet edit to any one
 * of them (a dropped job, a `--force`, a second workflow that also pushes, a production-only
 * build command) leaves the site deploying something the tests never saw. This check fails the
 * build on each; its rules R1 to R7 are the design's section 4. R8 and R9 are not the release's.
 * R10 to R13 are the backend design's section 4 (docs/plans/2026-11-12-release-backend-design.md),
 * whose own numbers R8 to R11 were taken here: its R8 is R10, its R9 is R11, its R10 is R12 and
 * its R11 is R13. R1's chain there grows to build, sql, web, schema, functions, seed, promote.
 * R8: the Postgres every workflow's service starts is named by version and digest, and is one
 * string across all of them. The `postgres:17` tag moved from 17.11 to 17.12 on 2026-11-12 and
 * every SQL run failed (issue #596), and two workflows that must name one image are two lists
 * that must agree, which a workflow file cannot check of another. R9 holds the e2e shards in
 * web.yml: the job that runs `npm run test:e2e` has a matrix whose only key is `shard`, a list
 * that is exactly 1 to n in order, and a command whose total is `${{ strategy.job-total }}`, so
 * the matrix is the one list. A list with a gap, or a command whose total is larger than the
 * list, runs fewer tests and stays green (issue #605), and a second matrix key would multiply
 * `job-total`.
 *
 * R10: only `schema`, `functions` and `seed` name `environment: production`, and each does, so
 * the secrets are readable by no pull-request workflow. R11: only those three jobs name the four
 * Supabase and jobs-key secrets, and no other workflow does; they come through `env:`, never
 * inside a `run:` line. R12: no workflow runs `--include-all`, `db reset` or `functions delete`,
 * and no backend job traces its shell (`set -x`), which would print a secret. R13: `schema` runs
 * check-deployed-migrations --before, then `db push`, then the check --after, in that order, and
 * each backend job checks out the candidate.
 *
 * Carried from currents' check of the same name, cut down: its state paths, ignore script,
 * alive check and cockpit reference stay behind.
 *
 * `problems(files)` is pure: `files` maps a repository path to its text (every
 * `.github/workflows/*.yml` and `netlify.toml`), and it returns one string per broken rule,
 * each naming the file and the rule. The CLI reads the files from disk and exits 1 on any.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const WORKFLOWS = '.github/workflows';
const RELEASE = `${WORKFLOWS}/release.yml`;
const CALLED = ['build', 'sql', 'web'];
const BACKEND = ['schema', 'functions', 'seed'];
const JOBS = ['candidate', 'build', 'sql', 'web', ...BACKEND, 'promote', 'report'];
const SECRET_NAMES = ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_URL', 'SUPABASE_PROJECT_REF', 'KAYFABB_JOBS_KEY'];
const SECRET_NAME = new RegExp(`\\b(?:${SECRET_NAMES.join('|')})\\b`);
const SHA = '${{ needs.candidate.outputs.sha }}';
const REF = '${{ inputs.ref }}';
/**
 * `push` as git's subcommand, after any global options (`git -C . push`, `git -c k=v push`), and
 * never a word later in another command's arguments (`git commit -m "fix push"`).
 */
const GIT_PUSH = /\bgit(?:\s+(?:-[Cc]\s+\S+|--?[\w-]+(?:=\S+)?))*\s+push\b/;

/** A Postgres image: Docker's official one, under any of its three names. */
const POSTGRES_IMAGE = /^(?:(?:docker\.io\/)?library\/)?postgres(?:[:@]|$)/;
/** The one accepted spelling: a version tag and the digest Docker actually pulls by. */
const PINNED_POSTGRES = /^(?:(?:docker\.io\/)?library\/)?postgres:[0-9][\w.-]*@sha256:[0-9a-f]{64}$/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
/** The trigger names a workflow's `on:` declares, whether it is a string, a list or a map. */
const triggers = (doc) => {
  const on = doc?.on;
  return isObj(on) ? Object.keys(on) : list(on).map(String);
};
const checkoutSteps = (job) => list(job?.steps).filter((s) => String(s?.uses ?? '').startsWith('actions/checkout'));
/** A step's shell with its comment lines gone and backslash continuations joined. */
const shellLines = (step) =>
  String(step?.run ?? '')
    .replace(/\\\n/g, ' ')
    .split('\n')
    .filter((l) => !/^\s*#/.test(l));

/** @param {Record<string,string>} files @returns {string[]} */
export function problems(files) {
  const out = [];
  const docs = {};
  const paths = Object.keys(files).filter((p) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p)).sort();
  for (const path of paths) {
    try {
      docs[path] = parse(files[path]);
    } catch (e) {
      out.push(`${path}: does not parse as YAML (${String(e.message).split('\n')[0]})`);
    }
    if (path in docs && !isObj(docs[path])) {
      out.push(`${path}: does not parse into a workflow (not a mapping)`);
      delete docs[path];
    }
  }

  // R1 to R4: the release.
  const rel = docs[RELEASE];
  if (!rel) {
    if (!(RELEASE in files)) out.push(`${RELEASE}: R1 the release workflow is missing`);
  } else {
    const jobs = isObj(rel.jobs) ? rel.jobs : {};
    const missing = JOBS.filter((j) => !isObj(jobs[j]));
    const chain = [['sql', 'build'], ['web', 'sql'], ['schema', 'web'], ['functions', 'schema'], ['seed', 'functions'], ['promote', 'seed']];
    const broken = chain.filter(([job, before]) => isObj(jobs[job]) && !list(jobs[job].needs).includes(before));
    const bad1 = [
      ...(missing.length ? [`jobs missing: ${missing.join(', ')}`] : []),
      ...broken.map(([j, b]) => `the chain build -> sql -> web -> schema -> functions -> seed -> promote is broken: ${j} does not need ${b}`),
    ];
    if (bad1.length) out.push(`${RELEASE}: R1 ${bad1.join('; ')}`);

    const bad = [];
    for (const name of CALLED) {
      const job = jobs[name];
      if (!isObj(job)) continue;
      if (job.uses !== `./${WORKFLOWS}/${name}.yml`) bad.push(`${name} calls ${JSON.stringify(job.uses)}, not ./${WORKFLOWS}/${name}.yml`);
      if (job.with?.ref !== SHA) bad.push(`${name} passes ref ${JSON.stringify(job.with?.ref)}, not ${SHA}`);
    }
    if (bad.length) out.push(`${RELEASE}: R2 ${bad.join('; ')}`);

    if (isObj(jobs.promote)) {
      const promote = jobs.promote;
      const bad3 = [];
      const pushes = list(promote.steps).flatMap(shellLines).filter((l) => GIT_PUSH.test(l));
      if (!pushes.length) bad3.push('has no git push');
      for (const line of pushes) {
        if (/--force/.test(line)) bad3.push(`forces its push (${line.trim()})`);
        if (/\s-[A-Za-z]*f[A-Za-z]*(\s|$)/.test(line)) bad3.push(`passes -f (${line.trim()})`);
        if (/(^|[\s"'])\+|:\+/.test(line.replace(/\$\{\{[^}]*\}\}/g, 'X'))) bad3.push(`pushes a + refspec (${line.trim()})`);
        if (/(^|\s)(--delete|--mirror|--prune|-[A-Za-z]*d[A-Za-z]*)(\s|$)/.test(line)) bad3.push(`deletes or mirrors refs (${line.trim()})`);
        if (!/[^\s"':]:refs\/heads\/production(["'\s]|$)/.test(line.replace(/\$\{\{[^}]*\}\}/g, 'X'))) bad3.push(`does not push to refs/heads/production (${line.trim()})`);
      }
      const perms = promote.permissions;
      if (!isObj(perms) || Object.keys(perms).length !== 1 || perms.contents !== 'write') {
        bad3.push(`permissions are ${JSON.stringify(perms)}, not exactly { contents: write }`);
      }
      if (bad3.length) out.push(`${RELEASE}: R3 promote ${bad3.join('; ')}`);
    }

    // Nothing else in the release pushes: a push anywhere but promote is a way to move a ref unseen.
    const strays = Object.entries(jobs)
      .filter(([name]) => name !== 'promote')
      .filter(([, job]) => list(job?.steps).flatMap(shellLines).some((l) => GIT_PUSH.test(l)))
      .map(([name]) => name);
    if (strays.length) out.push(`${RELEASE}: R3 job ${strays.join(', ')} has a git push; only promote pushes`);

    const on = triggers(rel).sort();
    const dispatch = isObj(rel.on) ? rel.on.workflow_dispatch : undefined;
    const schedule = isObj(rel.on) ? rel.on.schedule : undefined;
    const bad4 = [];
    if (on.join(',') !== 'schedule,workflow_dispatch') bad4.push(`runs on ${on.join(', ') || 'nothing'}, not exactly schedule and workflow_dispatch`);
    else {
      if (!list(schedule).length) bad4.push('has an empty schedule');
      if (isObj(dispatch) && ('inputs' in dispatch)) bad4.push('its workflow_dispatch takes inputs');
    }
    if (bad4.length) out.push(`${RELEASE}: R4 ${bad4.join('; ')}`);
  }

  // R5: the called workflows.
  for (const name of CALLED) {
    const path = `${WORKFLOWS}/${name}.yml`;
    if (!(path in files)) {
      out.push(`${path}: R5 the workflow is missing`);
      continue;
    }
    const doc = docs[path];
    if (!doc) continue;
    const call = isObj(doc.on) ? doc.on.workflow_call : undefined;
    const ref = isObj(call) && isObj(call.inputs) ? call.inputs.ref : undefined;
    const bad5 = [];
    if (!isObj(doc.on) || !('workflow_call' in doc.on)) bad5.push('takes no workflow_call');
    else if (!isObj(ref) || ref.type !== 'string' || ref.required !== true) bad5.push('workflow_call has no required string input ref');
    const checkouts = Object.values(isObj(doc.jobs) ? doc.jobs : {}).flatMap(checkoutSteps);
    if (!checkouts.length) bad5.push('has no checkout');
    if (checkouts.some((s) => s.with?.ref !== REF)) bad5.push(`a checkout does not read ref: ${REF}`);
    if (bad5.length) out.push(`${path}: R5 ${bad5.join('; ')}`);
  }

  // R6: production moves in release.yml and nowhere else, and nothing runs on push.
  for (const [path, doc] of Object.entries(docs)) {
    const bad6 = [];
    if (triggers(doc).includes('push')) bad6.push('runs on push');
    if (path !== RELEASE) {
      for (const [jobName, job] of Object.entries(isObj(doc.jobs) ? doc.jobs : {})) {
        for (const step of list(job?.steps)) {
          const lines = shellLines(step);
          const text = lines.join('\n');
          const pushes = lines.some((l) => GIT_PUSH.test(l));
          const env = JSON.stringify(step?.env ?? {});
          if ((pushes && (/production/.test(text) || /production/.test(env))) || /refs\/heads\/production/.test(text)) {
            bad6.push(`job ${jobName} pushes to production`);
          }
          const withs = Object.values(isObj(step?.with) ? step.with : {}).map(String);
          if (withs.some((v) => /^(refs\/heads\/)?production$/.test(v.trim()))) bad6.push(`job ${jobName} names production in a step's inputs`);
        }
      }
    }
    if (bad6.length) out.push(`${path}: R6 ${[...new Set(bad6)].join('; ')}`);
  }

  // R7: no netlify.toml context sets its own build command.
  if (typeof files['netlify.toml'] === 'string') {
    let table = '';
    const ctx = new Set();
    for (const line of files['netlify.toml'].split('\n')) {
      const head = line.match(/^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/);
      if (head) table = head[1];
      else if (/^context\./.test(table) && /^\s*command\s*=/.test(line)) ctx.add(`[${table}]`);
    }
    if (ctx.size) out.push(`netlify.toml: R7 ${[...ctx].join(', ')} sets its own command; production must build what a branch deploy builds`);
  }

  // R8: every Postgres service image is `postgres:<version>@sha256:<digest>`, one string in all.
  // A Postgres image is Docker's official one under any of its names (`postgres`,
  // `library/postgres`, `docker.io/library/postgres`), with any tag or digest after it. Other
  // images (redis, another publisher's such as supabase/postgres) are not held to it.
  const pinned = new Map();
  for (const [path, doc] of Object.entries(docs)) {
    for (const [jobName, job] of Object.entries(isObj(doc.jobs) ? doc.jobs : {})) {
      for (const [svc, def] of Object.entries(isObj(job?.services) ? job.services : {})) {
        const image = String(def?.image ?? '');
        if (!POSTGRES_IMAGE.test(image)) continue;
        const where = `${path}: R8 job ${jobName} service ${svc}`;
        if (!PINNED_POSTGRES.test(image)) out.push(`${where} image ${JSON.stringify(image)} is not postgres:<version>@sha256:<64 hex>`);
        else pinned.set(`${path} job ${jobName} service ${svc}`, image);
      }
    }
  }
  if (new Set(pinned.values()).size > 1) {
    const by = [...pinned].map(([where, image]) => `${where} is ${image}`);
    out.push(`${WORKFLOWS}: R8 the Postgres images differ: ${by.join('; ')}`);
  }

  // R9: web.yml's e2e shards are one list, and the command takes its total from it.
  const web = docs[`${WORKFLOWS}/web.yml`];
  if (web) {
    const path = `${WORKFLOWS}/web.yml`;
    const isE2e = (s) => /npm run test:e2e/.test(String(s?.run ?? ''));
    const jobs = Object.values(isObj(web.jobs) ? web.jobs : {}).filter((j) => list(j?.steps).some(isE2e));
    if (!jobs.length) out.push(`${path}: R9 no job runs npm run test:e2e; the release would run no e2e`);
    for (const job of jobs) {
      const matrix = job.strategy?.matrix;
      const bad9 = [];
      const keys = isObj(matrix) ? Object.keys(matrix) : [];
      if (keys.length !== 1 || keys[0] !== 'shard') bad9.push(`its matrix's only key must be shard (it has ${keys.join(', ') || 'no matrix'})`);
      const shard = isObj(matrix) ? matrix.shard : undefined;
      if (keys.includes('shard') && !(Array.isArray(shard) && shard.length >= 1 && shard.every((v, i) => v === i + 1))) {
        bad9.push(`the shard list must be the integers 1 to n in order, with no gap or repeat (it is ${JSON.stringify(shard)})`);
      }
      for (const step of list(job.steps).filter(isE2e)) {
        // The whole command, not a part of it: a digit after the total, a second --shard, or the
        // flag behind a `#` would each run fewer tests and stay green.
        if (String(step.run).trim() !== 'npm run test:e2e -- --shard=${{ matrix.shard }}/${{ strategy.job-total }}') {
          bad9.push('the command must be exactly npm run test:e2e -- --shard=${{ matrix.shard }}/${{ strategy.job-total }}');
        }
      }
      if (bad9.length) out.push(`${path}: R9 the e2e job: ${bad9.join('; ')}`);
    }
  }

  // R10: the Environment holding the secrets is named by the three backend jobs and no other.
  if (docs[RELEASE]) {
    const rj = isObj(docs[RELEASE].jobs) ? docs[RELEASE].jobs : {};
    for (const name of BACKEND) if (!isObj(rj[name])) out.push(`${RELEASE}: R10 job ${name} is missing, so nothing declares environment production for it`);
  }
  for (const [path, doc] of Object.entries(docs)) {
    for (const [jobName, job] of Object.entries(isObj(doc.jobs) ? doc.jobs : {})) {
      const env = job?.environment;
      const named = typeof env === 'string' ? env : isObj(env) ? env.name : undefined;
      const isBackend = path === RELEASE && BACKEND.includes(jobName);
      if (isBackend && named !== 'production') out.push(`${path}: R10 job ${jobName} declares environment ${JSON.stringify(named)}, not production`);
      if (!isBackend && env !== undefined) out.push(`${path}: R10 job ${jobName} names an environment; only schema, functions and seed in release.yml do`);
    }
  }

  // R11: the secrets' names appear in the three backend jobs and nowhere else, and only in `env:`.
  for (const [path, doc] of Object.entries(docs)) {
    const found = new Set();
    const text = (v) => JSON.stringify(v ?? {});
    for (const [jobName, job] of Object.entries(isObj(doc.jobs) ? doc.jobs : {})) {
      const isBackend = path === RELEASE && BACKEND.includes(jobName);
      if (!isBackend && SECRET_NAME.test(text(job))) found.add(`job ${jobName} names a secret; only schema, functions and seed in release.yml may`);
      if (isBackend) {
        for (const step of list(job?.steps)) {
          if (/\$\{\{\s*secrets\./.test(String(step?.run ?? ''))) found.add(`job ${jobName} puts \${{ secrets.* }} inside a run line; pass it through env:`);
          for (const [k, v] of Object.entries(isObj(step?.env) ? step.env : {})) {
            const m = String(v).match(/^\$\{\{\s*secrets\.(\w+)\s*\}\}$/);
            if (SECRET_NAMES.includes(k) && !(m && m[1] === k)) found.add(`job ${jobName} env ${k} is not \${{ secrets.${k} }}`);
          }
        }
        if (SECRET_NAME.test(text({ ...job, steps: undefined })) ) found.add(`job ${jobName} names a secret outside a step's env`);
      }
    }
    if (path !== RELEASE) {
      const rest = text({ ...doc, jobs: undefined });
      if (SECRET_NAME.test(rest)) found.add('names a secret outside a job');
    }
    if (found.size) out.push(`${path}: R11 ${[...found].join('; ')}`);
  }

  // R12: nothing runs a command that destroys or skips what the deploy protects.
  for (const [path, doc] of Object.entries(docs)) {
    const bad12 = new Set();
    for (const [jobName, job] of Object.entries(isObj(doc.jobs) ? doc.jobs : {})) {
      const isBackend = path === RELEASE && BACKEND.includes(jobName);
      for (const step of list(job?.steps)) {
        for (const l of shellLines(step)) {
          if (/--include-all\b/.test(l)) bad12.add(`job ${jobName} runs --include-all (${l.trim()})`);
          if (/\bdb\s+reset\b/.test(l)) bad12.add(`job ${jobName} runs db reset (${l.trim()})`);
          if (/\bfunctions\s+delete\b/.test(l)) bad12.add(`job ${jobName} runs functions delete (${l.trim()})`);
          if (isBackend && (/(^|[;&|\s])set\s+(-[a-z]*x|[+-]o\s+xtrace)/.test(l) || /\bbash\s+-[a-z]*x/.test(l))) bad12.add(`job ${jobName} traces its shell, which would print a secret (${l.trim()})`);
        }
      }
    }
    if (bad12.size) out.push(`${path}: R12 ${[...bad12].join('; ')}`);
  }

  // R13: schema's order, and every backend job runs the candidate's code.
  const rel13 = docs[RELEASE];
  if (rel13 && isObj(rel13.jobs)) {
    const bad13 = [];
    for (const name of BACKEND) {
      const job = rel13.jobs[name];
      if (!isObj(job)) continue;
      const cos = checkoutSteps(job);
      if (!cos.length || cos.some((s) => s.with?.ref !== SHA)) bad13.push(`${name} does not check out ${SHA}`);
    }
    if (isObj(rel13.jobs.schema)) {
      const lines = list(rel13.jobs.schema.steps).flatMap(shellLines);
      const at = (re) => lines.findIndex((l) => re.test(l));
      const before = at(/check-deployed-migrations\S*\s.*--before\b/);
      const push = at(/\bsupabase\s+db\s+push\b/);
      const after = at(/check-deployed-migrations\S*\s.*--after\b/);
      if (before < 0) bad13.push('schema never runs check-deployed-migrations --before');
      if (push < 0) bad13.push('schema never runs supabase db push');
      if (after < 0) bad13.push('schema never runs check-deployed-migrations --after');
      if (before >= 0 && push >= 0 && after >= 0 && !(before < push && push < after)) bad13.push('schema must run --before, then db push, then --after, in that order');
    }
    if (bad13.length) out.push(`${RELEASE}: R13 ${bad13.join('; ')}`);
  }
  return out;
}

/**
 * Every workflow and netlify.toml, read from disk.
 * @returns {Record<string, string>}
 */
export function readFiles(root = '.') {
  /** @type {Record<string, string>} */
  const files = {};
  const dir = `${root}/${WORKFLOWS}`;
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /\.ya?ml$/.test(n)).sort() : []) {
    files[`${WORKFLOWS}/${f}`] = fs.readFileSync(`${dir}/${f}`, 'utf8');
  }
  if (fs.existsSync(`${root}/netlify.toml`)) files['netlify.toml'] = fs.readFileSync(`${root}/netlify.toml`, 'utf8');
  return files;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const found = problems(readFiles());
  for (const p of found) console.error(`  ${p}`);
  process.exit(found.length ? 1 : 0);
}
