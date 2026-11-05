/**
 * End to end: the meeting's own core (supabase/functions/meet/core.ts) against the real migrations on the scratch database, with
 * the real model adapters (supabase/functions/_shared/models/) over a fake `fetch`, so that what only this proves is proved: that the
 * ledger row of a model call names the meeting that was opened before it, that what the core sends is what apply_meeting takes, and
 * that a second run of a slot queues nothing more. Run by tools/test-sql.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { psqlDb, sql, scratchSeed } from './psql-db.ts';
import { runMeeting } from '../../functions/meet/core.ts';
import { instance } from '../../functions/_shared/instance.ts';
import { models } from '../../functions/_shared/models/index.ts';
import { ledgerWriter } from '../../functions/_shared/models/ledger.ts';
import type { Instance } from '../../../engine/rules/types.ts';

const quiet: Instance = { ...instance, system: { ...instance.system, feeds: [] } };
const BOSS = instance.system.firstBoss;
const tiers = { strong: 'claude-opus-5-5', light: 'claude-haiku-5-5' };

test('a meeting with a fake model queues a rename, writes memory and profile versions and debits the bank, once', async () => {
  const db = psqlDb();
  await db.rpc('seed_instance', { payload: scratchSeed(instance) });
  sql(`update settings set value = 'true' where key = 'systemEnabled'`);
  // Other end-to-end files may have named a Boss of their own on the open season; this one is the instance's first.
  sql(`update seasons set boss = '${BOSS}' where ends_at is null`);
  sql(`insert into move_bank (staff, balance, as_of) values ('${BOSS}', 3, now()) on conflict (staff) do update set balance = 3, as_of = now()`);
  const board = sql(`select id from boards where not is_system order by slug limit 1`);
  const before = (table: string) => Number(sql(`select count(*) from ${table}`));
  const [memories, profiles, queued, meetings] = ['staff_memory', 'staff_profiles', 'queued_moves', 'meetings'].map(before);

  const answer = {
    memory: { hobby: { name: 'tag team matches', since: 'today', from: 'a board' }, opinions: [], grudges: [], wheelhouse: ['mario hacks'], realWorld: [], marks: [] },
    profile: { interests: ['tag teams'], favorites: [], mood: 'smug', signature: 'It is decided.' },
    moves: [{
      kind: 'renameBoard',
      params: { board, name: 'Pirate Puns Palace', premise: 'Puns, but make them piracy.' },
      demand: { kind: 'postsOnBoard', params: { board, count: 12 } },
      go_live_at: new Date(Date.now() + 3_600_000).toISOString(),
      expires_in_hours: 72,
      why: 'The board needed a gimmick.',
    }],
  };
  const requests: string[] = [];
  const fake = (async (url: string, init?: RequestInit) => {
    requests.push(String(url));
    const body = JSON.parse(String(init?.body));
    if (String(url).includes('anthropic')) {
      assert.match(body.system, /Phase: /);
      return new Response(JSON.stringify({ model: tiers.strong, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answer) }], usage: { input_tokens: 4000, output_tokens: 700, service_tier: 'standard' } }), { status: 200 });
    }
    return new Response(JSON.stringify({ choices: [{ text: ' ur board is now about pirates!!!\nBoard: next' }], usage: { prompt_tokens: 300, completion_tokens: 12 } }), { status: 200 });
  }) as unknown as typeof fetch;
  const env = (name: string) => ({ ANTHROPIC_API_KEY: 'test-key', SYSTEM_COMPLETIONS_URL: 'https://completions.test' } as Record<string, string>)[name];
  const real = models(env, ledgerWriter(db), { tiers, fetch: fake });

  const slot = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
  const first = await runMeeting(db, real, quiet, slot, Date.now, fake);
  assert.equal(first.status, 'ok', JSON.stringify(first));
  assert.equal(first.status === 'ok' && first.queued, 1);

  assert.equal(before('queued_moves') - queued!, 1, 'a rename is queued');
  const move = JSON.parse(sql(`select to_jsonb(q) from queued_moves q where meeting = ${first.meeting}`));
  assert.equal(move.kind, 'renameBoard');
  assert.equal(move.staff, BOSS);
  assert.equal(move.structural, true);
  assert.ok(Date.parse(move.go_live_at) >= Date.now() + 24 * 3_600_000 - 5_000, `a structural move is held a day: ${move.go_live_at}`);
  assert.equal(move.params.name, 'Pirate Puns Palace');
  assert.equal(move.params.description, 'ur board is now about pirates!!!', 'the old voice wrote the description, cut at the line');
  assert.equal(move.demand.params.count, 12);
  assert.equal(before('staff_memory') - memories!, 1);
  assert.equal(before('staff_profiles') - profiles!, 1);
  assert.equal(sql(`select body -> 'hobby' ->> 'name' from staff_memory where meeting = ${first.meeting}`), 'tag team matches');
  assert.equal(sql(`select mood from staff_profile_now where staff = '${BOSS}'`), 'smug');
  const bank = Number(sql(`select balance from move_bank where staff = '${BOSS}'`));
  assert.ok(Math.abs(bank - 2) < 0.01, `three banked, one spent: ${bank}`);
  const row = JSON.parse(sql(`select to_jsonb(m) from meetings m where id = ${first.meeting}`));
  assert.equal(row.outcome, 'ok');
  assert.equal(row.slot, slot.replace('Z', '+00:00').replace(/\.000/, ''));
  assert.ok(Math.abs(row.bank_before - 3) < 0.01 && Math.abs(row.bank_after - 2) < 0.01);
  assert.equal(row.consecutive_failures, 0);

  // The ledger rows of both model calls name the meeting that was opened before them.
  const calls = JSON.parse(sql(`select coalesce(json_agg(json_build_object('duty', duty, 'staff', staff, 'outcome', outcome, 'model', model) order by id), '[]') from model_calls where meeting = ${first.meeting}`));
  assert.deepEqual(calls, [
    { duty: 'meeting', staff: BOSS, outcome: 'ok', model: tiers.strong },
    { duty: 'meeting', staff: BOSS, outcome: 'ok', model: 'self-hosted' },
  ]);

  // The same slot again: nothing more is queued, written or called.
  const calling = requests.length;
  const again = await runMeeting(db, real, quiet, slot, Date.now, fake);
  assert.equal(again.status, 'already met');
  assert.equal(requests.length, calling, 'no model is called for a slot already met');
  assert.equal(before('queued_moves') - queued!, 1);
  assert.equal(before('staff_memory') - memories!, 1);
  assert.equal(before('meetings') - meetings!, 1);

  // A later slot whose model fails closes failed, writes nothing else, and leaves the bank where it was.
  const broken = models(env, ledgerWriter(db), { tiers, fetch: (async () => new Response('{"error": "bad"}', { status: 400 })) as unknown as typeof fetch });
  const later = new Date(Date.parse(slot) + 24 * 3_600_000).toISOString();
  const failed = await runMeeting(db, broken, quiet, later, Date.now, fake);
  assert.equal(failed.status, 'failed', JSON.stringify(failed));
  assert.equal(before('queued_moves') - queued!, 1);
  assert.equal(before('staff_memory') - memories!, 1);
  assert.ok(Math.abs(Number(sql(`select balance from move_bank where staff = '${BOSS}'`)) - bank) < 0.0001);
  assert.equal(sql(`select outcome || ':' || consecutive_failures from meetings where slot = '${later}'`), 'failed:1');
  assert.equal(sql(`select count(*) from model_calls where meeting = (select id from meetings where slot = '${later}') and outcome = 'failed'`), '1', 'the failed call is in the ledger too');

  // With The System off, a slot is a row that says so.
  sql(`update settings set value = 'false' where key = 'systemEnabled'`);
  const off = await runMeeting(db, real, quiet, new Date(Date.parse(slot) + 48 * 3_600_000).toISOString(), Date.now, fake);
  assert.equal(off.status, 'off');
  assert.equal(requests.length, calling, 'and no model is called');
});
