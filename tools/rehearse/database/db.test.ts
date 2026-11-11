// The rehearsal's database client against a scratch database on the local Postgres: each shape of function
// comes back as PostgREST would return it, a refusal keeps its code and hint, the caller's role and claims
// are the ones tests.become sets, and an argument is data, never SQL.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';
// @ts-expect-error test-sql.mjs is untyped JavaScript
import { LOCAL_HOSTS } from '../../test-sql.mjs';
import { connectUrl, type Connection } from '../db.ts';
import { DatabaseError } from '../../../supabase/functions/_shared/rpc.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set (postgres://postgres:pg@localhost:5432/postgres)');
const parsed = new URL(url);
if (!LOCAL_HOSTS.has(parsed.hostname)) throw new Error(`refusing DATABASE_URL on host "${parsed.hostname}": this test creates and drops a database, and reads only Postgres on localhost`);

const name = `rehearse_db_${process.pid}_${Date.now()}`;
const scratch = new URL(url);
scratch.pathname = `/${name}`;
let admin: pg.Client;
let conn: Connection;
const PLAYER = '11111111-1111-4111-8111-111111111111';

before(async () => {
  admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`create database ${name}`);
  conn = await connectUrl(scratch.toString());
  await conn.sql(readFileSync(new URL('../../../supabase/tests/setup/auth-shim.sql', import.meta.url), 'utf8'));
  await conn.sql(`
    create table x (id int);
    create table u (id int primary key);
    create function public.greet(who text, times integer) returns text language sql as $$ select repeat('hi ' || who || ' ', times) $$;
    create type public.pair as (a int, b text);
    create function public.pairs(n integer) returns setof public.pair language sql as $$ select i, 'r' || i from generate_series(1, n) i $$;
    create function public.one_pair() returns public.pair language sql as $$ select 7, 'seven' $$;
    create function public.echo(doc jsonb) returns jsonb language sql as $$ select jsonb_build_object('got', doc) $$;
    create function public.dflt(a integer, b integer default 10) returns integer language sql as $$ select a + b $$;
    create function public.refuse() returns void language plpgsql as $$ begin raise exception 'not for you' using errcode = '22023', hint = 'kayfabb.refusal'; end $$;
    create function public.who() returns jsonb language sql as $$ select jsonb_build_object('role', current_user, 'uid', auth.uid()) $$;
    create function public.only_service() returns text language sql as $$ select 'ok' $$;
    revoke execute on function public.only_service() from public, anon, authenticated;
    grant execute on function public.only_service() to service_role;
    create function public.ids(v integer[]) returns integer language sql as $$ select sum(i)::int from unnest(v) i $$;
    create function public.noop() returns void language sql as $$ select $$;
    create function public.dup() returns void language plpgsql as $$ begin insert into u values (1), (1); end $$;
    create function public.take(s text) returns text language sql as $$ select s $$;
    create function public.tbl(n integer) returns table (a integer, b text) language sql as $$ select i, 'r' || i from generate_series(1, n) i $$;
    create function public.outp(n integer, out doubled integer, out label text) language sql as $$ select n * 2, 'n' || n $$;
    create function public.isnull(d jsonb) returns boolean language sql as $$ select d is null $$;
    create function public.slow2() returns jsonb language plpgsql as $$ begin perform pg_sleep(0.2); return jsonb_build_object('role', current_user, 'uid', auth.uid()); end $$;
    create function public.partial() returns void language plpgsql as $$ begin insert into x values (99); insert into u values (2), (2); end $$;
    create function public.flag(f boolean, at timestamptz, id uuid, ids uuid[], maybe text default null) returns jsonb language sql as $$ select jsonb_build_object('f', f, 'at', at, 'id', id, 'ids', to_jsonb(ids), 'maybe', maybe) $$;
    create function public.nums(n integer) returns setof integer language sql as $$ select generate_series(1, n) $$;
    grant all on all tables in schema public to service_role, authenticated;
  `);
});

after(async () => {
  await conn?.end();
  await admin?.query(`drop database if exists ${name} with (force)`);
  await admin?.end();
});

const svc = () => conn.db('service');
const player = () => conn.db({ player: PLAYER });
const refused = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as DatabaseError; } throw new Error('expected a refusal'); };

test('a scalar of text and integer arguments', async () => {
  assert.equal(await svc().rpc('greet', { who: 'Ann', times: 2 }), 'hi Ann hi Ann ');
});

test('a setof composite is an array of objects, an empty set an empty array', async () => {
  assert.deepEqual(await svc().rpc('pairs', { n: 2 }), [{ a: 1, b: 'r1' }, { a: 2, b: 'r2' }]);
  assert.deepEqual(await svc().rpc('pairs', { n: 0 }), []);
});

test('a composite is an object, void is null', async () => {
  assert.deepEqual(await svc().rpc('one_pair', {}), { a: 7, b: 'seven' });
  assert.equal(await svc().rpc('noop', {}), null);
});

test('a jsonb argument takes the JSON value, an array argument a JSON array', async () => {
  assert.deepEqual(await svc().rpc('echo', { doc: { a: [1, { b: null }] } }), { got: { a: [1, { b: null }] } });
  assert.deepEqual(await svc().rpc('echo', { doc: 'text' }), { got: 'text' });
  assert.equal(await svc().rpc('ids', { v: [1, 2, 3] }), 6);
});

test('a default is used when the argument is left out, and overridden when given', async () => {
  assert.equal(await svc().rpc('dflt', { a: 1 }), 11);
  assert.equal(await svc().rpc('dflt', { a: 1, b: 2 }), 3);
});

test('a refusal keeps its SQLSTATE, words and hint, with the status PostgREST gives', async () => {
  const e = await refused(svc().rpc('refuse', {}));
  assert.ok(e instanceof DatabaseError);
  assert.equal(e.code, '22023');
  assert.equal(e.reason, 'not for you');
  assert.equal(e.hint, 'kayfabb.refusal');
  assert.equal(e.status, 400);
  assert.equal((await refused(svc().rpc('dup', {}))).code, '23505');
  assert.equal((await refused(svc().rpc('dup', {}))).status, 409);
});

test('the connection is usable after an error', async () => {
  await refused(svc().rpc('refuse', {}));
  assert.equal(await svc().rpc('dflt', { a: 2 }), 12);
});

test('the player is authenticated with their own id, the service is service_role', async () => {
  assert.deepEqual(await player().rpc('who', {}), { role: 'authenticated', uid: PLAYER });
  assert.deepEqual(await svc().rpc('who', {}), { role: 'service_role', uid: null });
});

test('a service-only function: the service may call it, a player gets 42501', async () => {
  assert.equal(await svc().rpc('only_service', {}), 'ok');
  const e = await refused(player().rpc('only_service', {}));
  assert.equal(e.code, '42501');
  assert.equal(e.status, 403);
});

test('an unknown function or argument is PGRST202', async () => {
  const a = await refused(svc().rpc('nope', {}));
  assert.equal(a.code, 'PGRST202');
  assert.equal(a.status, 404);
  const b = await refused(svc().rpc('greet', { who: 'a', times: 1, extra: 1 }));
  assert.equal(b.code, 'PGRST202');
});

test('an argument that looks like SQL is data', async () => {
  const text = `'); drop table x; --`;
  assert.equal(await svc().rpc('take', { s: text }), text);
  assert.deepEqual(await conn.sql('select count(*)::int as n from x'), [{ n: 0 }]);
});

test('RETURNS TABLE and OUT parameters are callable', async () => {
  assert.deepEqual(await svc().rpc('tbl', { n: 2 }), [{ a: 1, b: 'r1' }, { a: 2, b: 'r2' }]);
  assert.deepEqual(await svc().rpc('outp', { n: 4 }), { doubled: 8, label: 'n4' });
});

test('a JSON null for a jsonb argument is SQL NULL', async () => {
  assert.equal(await svc().rpc('isnull', { d: null }), true);
  assert.equal(await svc().rpc('isnull', { d: {} }), false);
});

test('calls on one connection do not interleave', async () => {
  const [a, b] = await Promise.all([player().rpc('slow2', {}), svc().rpc('slow2', {})]);
  assert.deepEqual(a, { role: 'authenticated', uid: PLAYER });
  assert.deepEqual(b, { role: 'service_role', uid: null });
});

test('the role is reset after a call', async () => {
  await player().rpc('who', {});
  assert.deepEqual(await conn.sql('select current_user as u'), [{ u: 'postgres' }]);
});

test('an error rolls back the whole call', async () => {
  await refused(svc().rpc('partial', {}));
  assert.deepEqual(await conn.sql('select count(*)::int as n from x where id = 99'), [{ n: 0 }]);
});

test('boolean, timestamptz, null and uuid[] arguments, and a setof scalar', async () => {
  const id = '22222222-2222-4222-8222-222222222222';
  const out = await svc().rpc<Record<string, unknown>>('flag', { f: true, at: '2026-01-02T03:04:05Z', id, ids: [id, PLAYER], maybe: null });
  assert.equal(out.f, true);
  assert.equal(new Date(out.at as string).toISOString(), '2026-01-02T03:04:05.000Z');
  assert.equal(out.id, id);
  assert.deepEqual(out.ids, [id, PLAYER]);
  assert.equal(out.maybe, null);
  assert.deepEqual(await svc().rpc('nums', { n: 3 }), [1, 2, 3]);
});
