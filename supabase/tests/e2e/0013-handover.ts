/**
 * End to end: a season's handover, across the meeting's own core (supabase/functions/meet/core.ts), the tick, the roll-over and the
 * inheritance review, against the real migrations on the scratch database, with the real model adapters over a fake `fetch`
 * (the system plan, Task 12b). The outgoing Boss's meeting queues a rename and names a successor the rotation would not choose; the tick
 * lands both; the season rolls over and the nominated Boss arrives with an empty bank; its first meeting is shown the old rename, keeps it,
 * and makes a rename of its own; and what the board is called is the new Boss's until that ends, then the kept one's. Run by tools/test-sql.mjs.
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
const tiers = { strong: 'claude-opus-5-5', light: 'claude-haiku-5-5' };
const ROSTER = instance.system.bosses.map((b) => b.key);
const OLD = instance.system.firstBoss;
const NOMINEE = ROSTER.find((k) => k !== OLD)!;
// What the rotation would have chosen: the Boss after the outgoing one, which the nomination must not be.
const ROTATION = ROSTER[(ROSTER.indexOf(OLD) + 1) % ROSTER.length]!;

/** The queue's rows become due at once: the guard allows no change of time, so it is stepped over for the test alone (as superuser). */
const makeDue = (where: string) => sql(`
  alter table queued_moves disable trigger queued_moves_guard;
  update queued_moves set go_live_at = now() - interval '1 minute' where landed_act is null and held_at is null and ${where};
  alter table queued_moves enable trigger queued_moves_guard;`);

test('the outgoing Boss names a successor, the season rolls over, and the new Boss keeps the old rename and makes its own', async () => {
  assert.notEqual(NOMINEE, ROTATION, 'the roster must let a nomination differ from the rotation');
  const db = psqlDb();
  await db.rpc('seed_instance', { payload: scratchSeed(instance) });
  sql(`update settings set value = 'true' where key = 'systemEnabled'`);
  sql(`update seasons set boss = '${OLD}' where ends_at is null`);
  sql(`insert into move_bank (staff, balance, as_of) values ('${OLD}', 3, now()) on conflict (staff) do update set balance = 3, as_of = now()`);
  /* A board of its own: other files leave moves in force on the instance's boards, and moves landed in one tick share a time. */
  sql(`insert into boards (slug, name, description) values ('handover-hall', 'Handover Hall', 'Where the Boss changes.') on conflict (slug) do nothing`);
  const board = sql(`select id from boards where slug = 'handover-hall'`);
  const boardName = () => sql(`select name from boards_now where id = '${board}'`);

  let answer: Record<string, unknown> = {};
  let sawInherited = '';
  const fake = (async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).includes('anthropic')) {
      const asked = String(body.messages?.[0]?.content ?? '');
      if (asked.includes('# Moves you inherited')) sawInherited = asked;
      return new Response(JSON.stringify({ model: tiers.strong, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answer) }], usage: { input_tokens: 4000, output_tokens: 700, service_tier: 'standard' } }), { status: 200 });
    }
    return new Response(JSON.stringify({ choices: [{ text: ' ur board is now about pirates!!!\nBoard: next' }], usage: { prompt_tokens: 300, completion_tokens: 12 } }), { status: 200 });
  }) as unknown as typeof fetch;
  const env = (name: string) => ({ ANTHROPIC_API_KEY: 'test-key', SYSTEM_COMPLETIONS_URL: 'https://completions.test' } as Record<string, string>)[name];
  const real = models(env, ledgerWriter(db), { tiers, fetch: fake });
  const memory = { hobby: { name: 'tag team matches', since: 'today', from: 'a board' }, opinions: [], grudges: [], wheelhouse: [], realWorld: [], marks: [] };
  const profile = { interests: ['tag teams'], favorites: [], mood: 'smug', signature: 'It is decided.' };
  /* The first meeting is held a day before the open season's end, whatever the seasons other files left, so it is the meltdown's last week. */
  const endsAt = Number(sql(`select (extract(epoch from starts_at + span_interval(setting('seasonLength'))) * 1000)::bigint from seasons where ends_at is null`));
  const lastWeek = () => endsAt - 86_400_000;
  const rename = (name: string, at: number) => ({
    kind: 'renameBoard',
    params: { board, name, premise: 'A premise.' },
    demand: { kind: 'postsOnBoard', params: { board, count: 12 } },
    go_live_at: new Date(at + 3_600_000).toISOString(),
    expires_in_hours: 72,
    why: 'The board needed a gimmick.',
  });
  const slotAfter = (days: number) => new Date(Math.floor((Date.now() + days * 86_400_000) / 60_000) * 60_000).toISOString();

  // The outgoing Boss's last meeting: a rename and a successor. The season's end is long past, so it is the meltdown's last week.
  answer = { memory, profile, moves: [rename('Pirate Puns Palace', lastWeek())], successor: { boss: NOMINEE, why: 'It has the stamina.' } };
  const first = await runMeeting(db, real, quiet, slotAfter(10), lastWeek, fake);
  assert.equal(first.status, 'ok', JSON.stringify(first));
  const queued = JSON.parse(sql(`select coalesce(json_agg(to_jsonb(q) order by q.id), '[]') from queued_moves q where meeting = ${first.meeting}`));
  assert.deepEqual(queued.map((q: any) => q.kind), ['renameBoard', 'nameSuccessor']);
  const nomination = queued[1];
  assert.equal(nomination.staff, OLD);
  assert.deepEqual(nomination.params, { boss: NOMINEE });
  assert.equal(nomination.demand, null);
  assert.equal(nomination.expires_at, null);
  assert.equal(nomination.structural, true);
  assert.ok(Date.parse(nomination.go_live_at) >= Date.now() + 24 * 3_600_000 - 5_000, 'a nomination waits the structural hold');
  const bankAfterFirst = Number(sql(`select balance from move_bank where staff = '${OLD}'`));
  assert.ok(Math.abs(bankAfterFirst - 2) < 0.01, `three banked, one spent on the rename and none on the successor: ${bankAfterFirst}`);

  // Both wait in the queue, then land.
  makeDue(`meeting = ${first.meeting}`);
  await db.rpc('system_tick', {});
  const landed = JSON.parse(sql(`select coalesce(json_agg(landed_act order by id), '[]') from queued_moves where meeting = ${first.meeting}`));
  assert.ok(landed.every((a: unknown) => typeof a === 'string'), 'both landed');
  const [oldRename, nominationAct] = landed as string[];
  assert.equal(boardName(), 'Pirate Puns Palace');

  // The season rolls over. The nominated Boss arrives, not the rotation's.
  const before = sql(`select clock_timestamp()`);
  assert.equal(sql(`select reveal_season(starts_at + span_interval(setting('seasonLength'))) is not null from seasons where ends_at is null`), 't');
  assert.equal(sql(`select boss from seasons where ends_at is null`), NOMINEE);
  assert.equal(sql(`select how from season_handovers where season = (select id from seasons where ends_at is null)`), 'nomination');
  assert.equal(sql(`select payload ->> 'why' || '/' || (payload ->> 'by') from acts where kind = 'move_end' and target_act_id = '${nominationAct}'`), 'spent/handover');
  assert.equal(sql(`select count(*) from open_moves where move_act = '${oldRename}'`), '1', 'the old rename carries over');
  assert.equal(boardName(), 'Pirate Puns Palace');
  assert.equal(Number(sql(`select balance from move_bank where staff = '${NOMINEE}'`)), 0, 'an arriving Boss starts at zero');
  const said = (staff: string) => Number(sql(`select count(*) from acts a join characters c on c.id = a.character where c.staff = '${staff}' and a.kind = 'post' and a.created_at >= '${before}'`));
  assert.equal(said(OLD), 1, 'the outgoing Boss says farewell once');
  assert.equal(said(NOMINEE), 1, 'the new Boss arrives once');

  // The new Boss's first meeting is shown the old rename, in plain words, keeps it, and makes a rename of its own.
  sql(`update move_bank set balance = 2, as_of = now() where staff = '${NOMINEE}'`);
  answer = { memory, profile, moves: [rename('Toast Tuesday Tavern', Date.now())], inherited: [{ move_act: oldRename, decision: 'keep' }] };
  const second = await runMeeting(db, real, quiet, slotAfter(11), Date.now, fake);
  assert.equal(second.status, 'ok', JSON.stringify(second));
  assert.match(sawInherited, new RegExp(`${oldRename}: Renamed .* to Pirate Puns Palace`), 'the review lists the old rename');
  assert.equal(sql(`select c.staff from acts k join characters c on c.id = k.character where k.kind = 'move_keep' and k.target_act_id = '${oldRename}'`), NOMINEE);
  const bankAfterSecond = Number(sql(`select balance from move_bank where staff = '${NOMINEE}'`));
  assert.ok(Math.abs(bankAfterSecond - 1) < 0.01, `two banked, one spent on the rename, none on the review: ${bankAfterSecond}`);
  assert.equal(sql(`select staff from queued_moves where meeting = ${second.status === 'ok' ? second.meeting : 0} and kind = 'renameBoard'`), NOMINEE, 'the next rename is the new Boss\'s');

  makeDue(`meeting = ${second.status === 'ok' ? second.meeting : 0}`);
  await db.rpc('system_tick', {});
  await db.rpc('system_tick', {});
  const newRename = sql(`select landed_act from queued_moves where meeting = ${second.status === 'ok' ? second.meeting : 0}`);
  assert.equal(sql(`select c.staff from acts a join characters c on c.id = a.character where a.id = '${newRename}'`), NOMINEE, 'the landed rename is signed by the new Boss');
  assert.equal(boardName(), 'Toast Tuesday Tavern', 'the new Boss\'s rename is the board\'s name now');
  assert.equal(sql(`select count(*) from open_moves where move_act = '${oldRename}'`), '1', 'the kept rename is still in force after the tick');
  assert.equal(sql(`select kept_by from moves_log where id = '${oldRename}'`), NOMINEE, 'the log says who keeps it');

  // Ending the new one brings back the kept one's name, not the board's own.
  sql(`select end_move('${newRename}', 'reversed', 'admin')`);
  assert.equal(boardName(), 'Pirate Puns Palace');
});
