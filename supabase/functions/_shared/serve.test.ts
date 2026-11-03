import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundedJson, environment, fromTheService, notTheService, sameSecret } from './serve.ts';

const scheduled = (headers: Record<string, string>) => new Request('https://f.example/settle', { method: 'POST', headers });
const JOBS_KEY = 'sb_secret_jobs0123456789abc';

test('only a request carrying the jobs key in apikey is from the service', () => {
  assert.equal(fromTheService(scheduled({ apikey: JOBS_KEY }), JOBS_KEY), true);
  assert.equal(fromTheService(scheduled({ apikey: JOBS_KEY, Authorization: 'Bearer anything' }), JOBS_KEY), true, 'Authorization is ignored');
  for (const apikey of [JOBS_KEY.slice(0, -1), `${JOBS_KEY}c`, JOBS_KEY.toUpperCase(), '']) {
    assert.equal(fromTheService(scheduled({ apikey }), JOBS_KEY), false, apikey);
  }
  assert.equal(fromTheService(scheduled({}), JOBS_KEY), false, 'no apikey');
});

test('the jobs key in Authorization is not the jobs key in apikey', () => {
  assert.equal(fromTheService(scheduled({ Authorization: `Bearer ${JOBS_KEY}` }), JOBS_KEY), false);
  assert.equal(fromTheService(scheduled({ Authorization: JOBS_KEY }), JOBS_KEY), false);
});

test('another secret key of the project is not the jobs key', () => {
  const env = environment((n) => ({
    SUPABASE_URL: 'u',
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_default0123456789', kayfabb_jobs: JOBS_KEY }),
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'sb_publishable_default0123456' }),
  } as Record<string, string>)[n]);
  assert.equal(fromTheService(scheduled({ apikey: env.secret }), env.jobs), false);
  assert.equal(fromTheService(scheduled({ apikey: JOBS_KEY }), env.jobs), true);
});

test('with no jobs key, no request is from the service, not even one with no apikey', () => {
  for (const headers of [{}, { apikey: '' }, { apikey: JOBS_KEY }, { apikey: 'null' }, { Authorization: 'Bearer ' }]) {
    assert.equal(fromTheService(scheduled(headers), null), false, JSON.stringify(headers));
  }
});

test('the refusal names the missing jobs key, by name, and logs the same line', async () => {
  const logged: unknown[] = [];
  const error = console.error;
  console.error = (...line: unknown[]) => { logged.push(line.join(' ')); };
  try {
    const missing = notTheService(null, 'the settlement is run by the service');
    assert.equal(missing.status, 401);
    assert.deepEqual(await missing.json(), { error: 'this project has no secret key named kayfabb_jobs' });
    assert.deepEqual(logged, ['this project has no secret key named kayfabb_jobs']);
    const wrong = notTheService(JOBS_KEY, 'the settlement is run by the service');
    assert.equal(wrong.status, 401);
    const body = await wrong.text();
    assert.deepEqual(JSON.parse(body), { error: 'the settlement is run by the service' });
    assert.ok(!body.includes(JOBS_KEY), 'no key in the body');
    assert.equal(logged.length, 1, 'a wrong key is not logged');
  } finally { console.error = error; }
});

test('sameSecret compares whole strings, of any lengths', () => {
  assert.equal(sameSecret('', ''), true);
  assert.equal(sameSecret('a', ''), false);
  assert.equal(sameSecret('', 'a'), false);
  assert.equal(sameSecret('abc', 'abd'), false);
  assert.equal(sameSecret('abc', 'abc'), true);
});

const SECRET = 'sb_secret_default0123456789';
const JOBS = 'sb_secret_jobs0123456789abc';
const PUBLISHABLE = 'sb_publishable_default0123456';
const reader = (vars: Record<string, string>) => (name: string) => vars[name];
const platform = (secrets: Record<string, string>, publishables: Record<string, string> = { default: PUBLISHABLE }) => ({
  SUPABASE_URL: 'https://p.supabase.co',
  SUPABASE_SECRET_KEYS: JSON.stringify(secrets),
  SUPABASE_PUBLISHABLE_KEYS: JSON.stringify(publishables),
});

/** The message `environment` throws for `vars`, asserted to hold none of the values it was given. */
function refusal(vars: Record<string, string>): string {
  let message = '';
  assert.throws(() => environment(reader(vars)), (e: Error) => { message = e.message; return true; });
  const values = Object.values(vars).flatMap((v) => {
    try {
      const o: unknown = JSON.parse(v);
      if (typeof o === 'string') return [v, o];
      return typeof o === 'object' && o ? [v, ...Object.values(o).map(String)] : [v];
    } catch { return [v]; }
  }).filter((v) => v.length > 3);
  for (const v of values) assert.ok(!message.includes(v), `the message holds a value it was given: ${message}`);
  assert.doesNotMatch(message, /sb_(secret|publishable)_[A-Za-z0-9]|eyJ/, 'the message holds part of a key');
  return message;
}

test('on the platform, the keys are read by name from the JSON objects', () => {
  assert.deepEqual(environment(reader(platform({ default: SECRET, kayfabb_jobs: JOBS }))),
    { url: 'https://p.supabase.co', secret: SECRET, publishable: PUBLISHABLE, jobs: JOBS });
});

test('on the platform, jobs is the key named kayfabb_jobs and never default', () => {
  assert.equal(environment(reader(platform({ default: SECRET }))).jobs, null);
  assert.equal(environment(reader({ ...platform({ default: SECRET }), SUPABASE_SECRET_KEY: SECRET })).jobs, null,
    'a single secret key set beside the named ones is not the jobs key');
  assert.equal(environment(reader(platform({ default: SECRET, kayfabb_jobs: '' }))).jobs, null,
    'an empty kayfabb_jobs is no key, so a request with no apikey cannot match it');
});

test('with one key of each, as locally and self-hosted, the secret key is also the jobs key', () => {
  assert.deepEqual(environment(reader({ SUPABASE_URL: 'http://kong:8000', SUPABASE_SECRET_KEY: SECRET, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE })),
    { url: 'http://kong:8000', secret: SECRET, publishable: PUBLISHABLE, jobs: SECRET });
});

test('a missing key says what to set', () => {
  const single = { SUPABASE_URL: 'u', SUPABASE_SECRET_KEY: SECRET, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE };
  const { SUPABASE_URL: _u, ...noUrl } = single;
  const { SUPABASE_SECRET_KEY: _s, ...noSecret } = single;
  const { SUPABASE_PUBLISHABLE_KEY: _p, ...noPublishable } = single;
  assert.match(refusal(noUrl), /SUPABASE_URL/);
  assert.match(refusal(noSecret), /make a secret key named default, or set SUPABASE_SECRET_KEY/);
  assert.match(refusal(noPublishable), /make a publishable key named default, or set SUPABASE_PUBLISHABLE_KEY/);
  assert.match(refusal(platform({ kayfabb_jobs: JOBS })), /make a secret key named default/);
  assert.match(refusal(platform({ default: SECRET }, { other: PUBLISHABLE })), /make a publishable key named default/);
  assert.match(refusal(platform({ default: '' })), /make a secret key named default/, 'an empty key is no key');
});

test('each list is read on its own: the platform\'s secret keys beside a single publishable key', () => {
  const { SUPABASE_PUBLISHABLE_KEYS: _p, ...secretsOnly } = platform({ default: SECRET, kayfabb_jobs: JOBS });
  assert.deepEqual(environment(reader({ ...secretsOnly, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE })),
    { url: 'https://p.supabase.co', secret: SECRET, publishable: PUBLISHABLE, jobs: JOBS });
  // A blank SUPABASE_SECRET_KEYS is set, so it is read as the platform's list and refused, never passed over.
  assert.match(refusal({ ...secretsOnly, SUPABASE_SECRET_KEYS: '', SUPABASE_SECRET_KEY: SECRET, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE }),
    /SUPABASE_SECRET_KEYS is not a JSON object of strings/);
});

test('a key list that is not a JSON object of strings is refused by its name, not its value', () => {
  for (const bad of ['not json', '["sb_secret_inalist000"]', '{"default": 12345678}', 'null', '"sb_secret_bare000000"']) {
    assert.match(refusal({ ...platform({ default: SECRET }), SUPABASE_SECRET_KEYS: bad }), /SUPABASE_SECRET_KEYS is not a JSON object of strings/, bad);
    assert.match(refusal({ ...platform({ default: SECRET }), SUPABASE_PUBLISHABLE_KEYS: bad }), /SUPABASE_PUBLISHABLE_KEYS is not a JSON object of strings/, bad);
  }
});

test('a legacy JWT key is refused by name, in each of the four variables', () => {
  const legacy = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.sig';
  const said = /is a legacy JWT key; KayfaBB takes the publishable and secret keys \(sb_publishable_…, sb_secret_…\)/;
  assert.match(refusal(platform({ default: legacy, kayfabb_jobs: JOBS })), said);
  assert.match(refusal(platform({ default: SECRET, kayfabb_jobs: legacy })), said);
  assert.match(refusal(platform({ default: SECRET }, { default: legacy })), said);
  assert.match(refusal({ SUPABASE_URL: 'u', SUPABASE_SECRET_KEY: legacy, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE }), /SUPABASE_SECRET_KEY is a legacy JWT key/);
  assert.match(refusal({ SUPABASE_URL: 'u', SUPABASE_SECRET_KEY: SECRET, SUPABASE_PUBLISHABLE_KEY: legacy }), /SUPABASE_PUBLISHABLE_KEY is a legacy JWT key/);
});

test('a body is read as JSON up to a bound, and past it not at all', async () => {
  const post = (body: string, headers: Record<string, string> = {}) => new Request('https://f.example/act', { method: 'POST', body, headers });
  assert.deepEqual(await boundedJson(post('{"a":1}'), 100), { tooLong: false, body: { a: 1 } });
  assert.deepEqual(await boundedJson(post('not json'), 100), { tooLong: false, body: null });
  assert.equal((await boundedJson(post('x'.repeat(101)), 100)).tooLong, true);
  assert.equal((await boundedJson(post('{}', { 'Content-Length': '1000000' }), 100)).tooLong, true, 'refused on its declared length before it is read');
  assert.equal((await boundedJson(post(JSON.stringify('🔥'.repeat(30))), 100)).tooLong, true, 'counted in bytes');
});
