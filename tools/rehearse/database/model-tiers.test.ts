// The model tiers a rehearsal run names are written to the rehearsal's own `settings`, merged over the instance's, on a scratch
// database on the local Postgres. Run by `npm run test:rehearse`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
// @ts-expect-error test-sql.mjs is untyped JavaScript
import { LOCAL_HOSTS } from '../../test-sql.mjs';
import { connectUrl, type Connection } from '../db.ts';
import { writeModelTiers } from '../setup.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set (postgres://postgres:pg@localhost:5432/postgres)');
const parsed = new URL(url);
if (!LOCAL_HOSTS.has(parsed.hostname)) throw new Error(`refusing DATABASE_URL on host "${parsed.hostname}": this test creates and drops a database, and reads only Postgres on localhost`);

const name = `rehearse_tiers_${process.pid}_${Date.now()}`;
const scratch = new URL(url);
scratch.pathname = `/${name}`;
let admin: pg.Client;
let conn: Connection;

const SEEDED = { strong: 'claude-opus-5-5', light: 'claude-haiku-5-5' };
const tiersNow = async () => (await conn.sql("select value from settings where key = 'modelTiers'"))[0]?.value;

before(async () => {
  admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`create database ${name}`);
  conn = await connectUrl(scratch.toString());
  await conn.sql('create table settings (key text primary key, value jsonb not null)');
});
after(async () => {
  await conn?.end();
  await admin.query(`drop database if exists ${name}`);
  await admin.end();
});

const reseed = async () => {
  await conn.sql("delete from settings");
  await conn.sql("insert into settings values ('modelTiers', $1::jsonb), ('systemEnabled', 'true')", [JSON.stringify(SEEDED)]);
};

test('neither tier named: the instance\'s setting is left as it is', async () => {
  await reseed();
  await writeModelTiers(conn, {});
  assert.deepEqual(await tiersNow(), SEEDED);
});

test('one tier named: it replaces that tier and the other keeps the instance\'s model', async () => {
  await reseed();
  await writeModelTiers(conn, { light: 'claude-sonnet-5-5' });
  assert.deepEqual(await tiersNow(), { strong: 'claude-opus-5-5', light: 'claude-sonnet-5-5' });
});

test('both named: both are written, and no other setting is touched', async () => {
  await reseed();
  await writeModelTiers(conn, { strong: 'claude-sonnet-5-5', light: 'claude-sonnet-5-5' });
  assert.deepEqual(await tiersNow(), { strong: 'claude-sonnet-5-5', light: 'claude-sonnet-5-5' });
  assert.equal((await conn.sql("select value from settings where key = 'systemEnabled'"))[0]?.value, true);
});

test('a row with an extra key keeps it through the merge', async () => {
  await reseed();
  await conn.sql("update settings set value = value || '{\"fallback\": \"claude-sonnet-5-5\"}'::jsonb where key = 'modelTiers'");
  await writeModelTiers(conn, { strong: 'claude-sonnet-5-5' });
  assert.deepEqual(await tiersNow(), { strong: 'claude-sonnet-5-5', light: 'claude-haiku-5-5', fallback: 'claude-sonnet-5-5' });
});

test('no modelTiers row yet: both tiers named are written', async () => {
  await conn.sql("delete from settings");
  await writeModelTiers(conn, { strong: 'claude-opus-5-5', light: 'claude-haiku-5-5' });
  assert.deepEqual(await tiersNow(), SEEDED);
});

test('no modelTiers row yet and one tier named: refused in plain words naming the missing tier, nothing written', async () => {
  await conn.sql("delete from settings");
  await assert.rejects(writeModelTiers(conn, { strong: 'claude-opus-5-5' }), /no modelTiers setting.*"light"/);
  assert.equal(await tiersNow(), undefined);
  await assert.rejects(writeModelTiers(conn, { light: 'claude-opus-5-5' }), /no modelTiers setting.*"strong"/);
  assert.equal(await tiersNow(), undefined);
});
