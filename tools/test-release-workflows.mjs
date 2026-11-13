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
const E2E_RUN = 'npm run test:e2e -- --shard=${{ matrix.shard }}/${{ strategy.job-total }}';
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
red('seed does not check out the candidate', edit(RELEASE, (d) => {
  for (const s of d.jobs.seed.steps) if (String(s.uses ?? '').startsWith('actions/checkout')) delete s.with;
}), /R13.*seed.*check out/);
red('functions checks out main', edit(RELEASE, (d) => {
  for (const s of d.jobs.functions.steps) if (String(s.uses ?? '').startsWith('actions/checkout')) s.with = { ref: 'main' };
}), /R13.*functions.*check out/);

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
