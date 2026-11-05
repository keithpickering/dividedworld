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

/* ---- R2: each job calls its own workflow on the candidate ---- */
red('sql releases main, not the candidate', edit(RELEASE, (d) => { d.jobs.sql.with.ref = 'main'; }), /R2/);
red('build calls web.yml', edit(RELEASE, (d) => { d.jobs.build.uses = './.github/workflows/web.yml'; }), /R2/);

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
red('promote asks pull-requests: write too', edit(RELEASE, (d) => { d.jobs.promote.permissions['pull-requests'] = 'write'; }), /R3/);

/* ---- R4: the release runs on a schedule and a bare dispatch, nothing else ---- */
red('release.yml runs on push', edit(RELEASE, (d) => { d.on.push = { branches: ['main'] }; }), /R4/);
red('the dispatch takes a sha', edit(RELEASE, (d) => { d.on.workflow_dispatch = { inputs: { sha: { type: 'string' } } }; }), /R4/);

/* ---- R5: the called workflows take a ref and use it ---- */
red('web.yml loses workflow_call', edit(WEB, (d) => { delete d.on.workflow_call; }), /R5/);
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
quiet('a comment that mentions production is not a push', {
  ...REAL,
  [BUILD]: `${REAL[BUILD]}\n# git push origin HEAD:production would be wrong here; only release.yml moves production.\n`,
});

/* ---- R7: production builds what a branch deploy builds ---- */
red('netlify.toml gives production its own command', {
  ...REAL,
  [NETLIFY]: `${REAL[NETLIFY]}\n[context.production]\n  command = "npm run build"\n`,
}, /R7/);

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
