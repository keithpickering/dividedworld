/**
 * tools/check-edge-functions.mjs's `problems()`, driven red on purpose.
 *
 *   node tools/test-edge-functions.mjs
 *
 * Every case starts from the real config.toml, functions and migrations read from disk and breaks
 * exactly one thing, because a guard proved against a synthetic fixture proves only that it can
 * read the fixture. The cases that break something start from the real files with a
 * `[functions.conceal]` table added in memory, so each complaint they expect is the one they
 * planted and not the one the real files carried while conceal had no table (issue #646). The last
 * case asserts the untouched real files pass, so a `problems()` that has gone quiet fails here
 * rather than reading as green.
 */
import { problems, readFiles } from './check-edge-functions.mjs';

const REAL = readFiles();
const CONFIG = 'supabase/config.toml';
/** The real files with conceal's table present, so a case's own complaint is the only one. */
const BASE = { ...REAL, [CONFIG]: `${REAL[CONFIG]}\n[functions.conceal]\nverify_jwt = false\n` };

let failures = 0;

/** The base with one file changed by `fn` over its text. */
const change = (path, fn) => {
  if (!(path in BASE)) throw new Error(`${path} is not among the real files`);
  return { ...BASE, [path]: fn(BASE[path]) };
};
const without = (path) => {
  const copy = { ...BASE };
  delete copy[path];
  return copy;
};
/** A migration after every real one that schedules `job` posting to `fn`, with one header and a body. */
const schedule = (job, fn, header = `'apikey', s.secret`, body = `'{}'::jsonb`) => `
create function schedule_${job.replace(/\W/g, '_')}() returns bigint language plpgsql as $$
begin
  return cron.schedule('${job}', '* * * * *', $job$
    select net.http_post(
      url := s.base || '/functions/v1/${fn}',
      headers := jsonb_build_object('Content-Type', 'application/json', ${header}),
      body := ${body}
    )
    from (select 'x' as base, 'y' as secret) s
  $job$);
end $$;
`;
const LATER = 'supabase/migrations/9998_later.sql';
const LATEST = 'supabase/migrations/9999_latest.sql';

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

/* ---- E1: every function is deployed with verify_jwt = false ---- */
red('settle has no table', change(CONFIG, (t) => t.replace('[functions.settle]\nverify_jwt = false\n', '')), /E1 function settle has no \[functions\.settle\] table/);
red('settle says verify_jwt = true', change(CONFIG, (t) => t.replace('[functions.settle]\nverify_jwt = false', '[functions.settle]\nverify_jwt = true')), /E1 function settle has verify_jwt = true/);
red('settle has verify_jwt only in a comment', change(CONFIG, (t) => t.replace('[functions.settle]\nverify_jwt = false', '[functions.settle]\n# verify_jwt = false')), /E1 function settle's table has no verify_jwt setting/);
red('settle\'s verify_jwt sits under a later, unrelated header', change(CONFIG, (t) => t.replace('[functions.settle]\nverify_jwt = false', '[functions.settle]\n[auth.extra]\nverify_jwt = false')), /E1 function settle's table has no verify_jwt setting/);
red('a new function folder has no table', { ...BASE, 'supabase/functions/later/index.ts': 'export {};\n' }, /E1.*later/);
quiet('a commented-out table is no table', change(CONFIG, (t) => `${t}\n# [functions.zzz]\n# verify_jwt = false\n`));
quiet('_shared is not a function', { ...BASE, 'supabase/functions/_shared/index.ts': 'export {};\n' });

/* ---- E2: every table names a function ---- */
red('a table for a function that is gone', change(CONFIG, (t) => `${t}\n[functions.gone]\nverify_jwt = false\n`), /E2.*gone/);

/* ---- E3: every job's function exists ---- */
red('a job posts to a function that is not there', { ...BASE, [LATER]: schedule('kayfabb-ghost', 'ghost') }, /E3.*ghost/);
red('a job unscheduled and then scheduled again in one file is a job', { ...BASE, [LATER]: `select cron.unschedule('kayfabb-ghost');\n${schedule('kayfabb-ghost', 'ghost')}` }, /E3.*ghost/);
red('a job whose body is in another dollar tag, with an inner );', {
  ...BASE,
  [LATER]: `select cron.schedule('kayfabb-ghost', '* * * * *', $body$ select foo(1); select net.http_post(url := s.base || '/functions/v1/ghost', headers := jsonb_build_object('apikey', s.secret)) $body$);\n`,
}, /E3.*ghost/);
red('a job whose schedule is an expression and whose body is in another dollar tag, with an inner );', {
  ...BASE,
  // The form settle, meet, chatter and staff have: the schedule read from a setting, never a plain string.
  [LATER]: `select cron.schedule('kayfabb-ghost', setting('ghostCron') #>> '{}', $body$ select foo(1); select net.http_post(url := s.base || '/functions/v1/ghost', headers := jsonb_build_object('apikey', s.secret)) $body$);\n`,
}, /E3.*ghost/);
quiet('a job unscheduled in upper case is no job', { ...BASE, [LATER]: `${schedule('kayfabb-ghost', 'ghost')}\nselect CRON.UNSCHEDULE('kayfabb-ghost');` });
red('a job scheduled in upper case', { ...BASE, [LATER]: schedule('kayfabb-ghost', 'ghost').replace('cron.schedule', 'CRON.SCHEDULE') }, /E3.*ghost/);
red('a job whose one command posts to two functions', {
  ...BASE,
  [LATER]: schedule('kayfabb-two', 'settle', undefined, `jsonb_build_object('then', s.base || '/functions/v1/ghost')`),
}, /E3.*ghost/);

/* ---- E4: a job sends apikey and no Authorization ---- */
red('conceal is rescheduled with an Authorization header and no apikey', {
  ...BASE,
  [LATER]: schedule('kayfabb-conceal', 'conceal', `'Authorization', 'Bearer ' || s.secret`),
}, /E4.*kayfabb-conceal.*does not send the jobs key/);
red('conceal is rescheduled with neither header', {
  ...BASE,
  [LATER]: schedule('kayfabb-conceal', 'conceal', `'X-Other', 'y'`),
}, /E4.*kayfabb-conceal.*does not send the jobs key/);
red('conceal is rescheduled with apikey only in its body', {
  ...BASE,
  [LATER]: schedule('kayfabb-conceal', 'conceal', `'X-Other', 'y'`, `'{"apikey":1}'::jsonb`),
}, /E4.*kayfabb-conceal.*does not send the jobs key/);
red('conceal is rescheduled with both headers', {
  ...BASE,
  [LATER]: schedule('kayfabb-conceal', 'conceal', `'apikey', s.secret, 'Authorization', 'Bearer ' || s.secret`),
}, /E4.*kayfabb-conceal.*Authorization header/);

/* ---- E5: a job's function asks for the jobs key ---- */
red('mail no longer calls fromTheService', change('supabase/functions/mail/index.ts', (t) => t.replaceAll('fromTheService', 'fromSomeone')), /E5.*mail/);
red('mail calls fromTheService only in a test', {
  ...change('supabase/functions/mail/index.ts', (t) => t.replaceAll('fromTheService', 'fromSomeone')),
  'supabase/functions/mail/core.test.ts': 'if (!fromTheService(request, key)) throw new Error();\n',
}, /E5.*mail/);

const MAIL = 'supabase/functions/mail/index.ts';
const noCall = (t) => t.replaceAll('fromTheService', 'fromSomeone');
red('mail names the call only in a trailing line comment', change(MAIL, (t) => `${noCall(t)}\nconst a = 1; // fromTheService(request, env.jobs)\n`), /E5.*mail/);
red('mail names the call only in a block comment', change(MAIL, (t) => `${noCall(t)}\n/* fromTheService(request, env.jobs) */\n`), /E5.*mail/);
red('mail names the call only in a string', change(MAIL, (t) => `${noCall(t)}\nconst a = "fromTheService(";\n`), /E5.*mail/);
quiet('a /* inside a string does not hide mail\'s real call', change(MAIL, (t) => {
  if (!/^.*Deno\.serve/m.test(t)) throw new Error('mail/index.ts has no Deno.serve line');
  // The `*/` in the trailing line comment is what an old block-comment strip would run to.
  return `${t.replace(/^(.*Deno\.serve)/m, 'const g = "a/*";\n$1')}\n// done */\n`;
}));

/* ---- a check over nothing ---- */
red('config.toml is missing', without(CONFIG), /config\.toml/);
red('no function at all', Object.fromEntries(Object.entries(BASE).filter(([p]) => !/^supabase\/functions\/[^/]+\/index\.ts$/.test(p))), /holds no function/);

/* ---- what is not a complaint ---- */
// 0004's settlement job sent an Authorization header; 0071 scheduled it again without. Only the last counts.
if (!/authorization/i.test(REAL['supabase/migrations/0004_schedule.sql'] ?? '')) {
  failures += 1;
  console.error('FAIL  the superseded-job case needs 0004 to still hold an Authorization header');
}
quiet('0004\'s Authorization job is superseded by 0071', BASE);
quiet('a job scheduled and then unscheduled is no job', {
  ...BASE,
  [LATER]: schedule('kayfabb-ghost', 'ghost'),
  [LATEST]: `select cron.unschedule('kayfabb-ghost');\n`,
});
quiet('a job named only in a -- comment is no job', { ...BASE, [LATER]: `-- ${schedule('kayfabb-ghost', 'ghost').trim().replaceAll('\n', ' ')}\n` });
quiet('a job named only in a block comment is no job', { ...BASE, [LATER]: `/*${schedule('kayfabb-ghost', 'ghost')}*/\n` });
quiet('a job scheduled and then unscheduled in one file is no job', { ...BASE, [LATER]: `${schedule('kayfabb-ghost', 'ghost')}\nselect cron.unschedule('kayfabb-ghost');\n` });
quiet('a job whose command names no function is not held to anything', { ...BASE, [LATER]: `select cron.schedule('kayfabb-nothing', '* * * * *', 'select 1');\n` });

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
