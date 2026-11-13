/**
 * End to end: a day of the Director (the system plan, Task 13), across the meeting's own core (supabase/functions/meet/core.ts), the tick
 * and the settlement, against the real migrations on the scratch database, with the real model adapters over a fake `fetch`. A meeting
 * queues a rename of a board with a demand that three different characters post on it; the tick lands it once its hold has passed (the
 * board is called by the new name, the move Act's body is a stock line); characters post until the demand is met, the tick ends the move
 * `met` and the old name returns; and the next meeting's digest shows the move as met and the characters who met it, in the data
 * `system_digest` returns and in the text the model is sent, naming neither a staff member nor a poster from before the move landed.
 * Also: a reaction to the Boss's move Act is in the public tallies and pays nobody once a settlement runs over its window (staff Acts earn
 * nothing), while a reaction to a player's post in the same window does pay. Run by tools/test-sql.mjs.
 *
 * The structural hold is stepped over as 0013-handover.ts steps over it: there is no clock or test-only path for a queued move's time (the
 * hold is a setting at least an hour, the tick reads now()), so the queue's guard is disabled for one update as superuser. The same
 * goes for the tick's pacing of demand checks (open_moves.checked_at, derived state, reset as supabase/tests/0053-tick.sql does) and for
 * the time of the two reactions (moved into the middle of the window next_settlement_window gives, so the file needs no earlier file's settlements).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstMessageOf, partOf, partAnswer } from './meeting-fake.ts';
import { psqlDb, sql, scratchSeed } from './psql-db.ts';
import { runMeeting } from '../../functions/meet/core.ts';
import { runSettlement } from '../../functions/settle/core.ts';
import { instance } from '../../functions/_shared/instance.ts';
import { models } from '../../functions/_shared/models/index.ts';
import { ledgerWriter } from '../../functions/_shared/models/ledger.ts';
import type { Instance } from '../../../engine/rules/types.ts';

const quiet: Instance = { ...instance, system: { ...instance.system, feeds: [] } };
const BOSS = instance.system.firstBoss;
const tiers = { strong: 'claude-opus-5-5', light: 'claude-haiku-5-5' };

test('a rename is queued, lands, is met by three characters and ends, and the next meeting is told who met it', async () => {
  const db = psqlDb();
  await db.rpc('seed_instance', { payload: scratchSeed(instance) });
  sql(`update settings set value = 'true' where key = 'systemEnabled'`);
  sql(`update seasons set boss = '${BOSS}' where ends_at is null`);
  sql(`insert into move_bank (staff, balance, as_of) values ('${BOSS}', 3, now()) on conflict (staff) do update set balance = 3, as_of = now()`);
  // Moves other files left in force would crowd the digest's capped list; they end here, before this day's move is made.
  sql(`select end_move(move_act, 'expired', 'e2e') from open_moves`);

  sql(`insert into boards (slug, name, description) values ('director-day', 'Director Day Diner', 'Where the Director spends a day.') on conflict (slug) do nothing`);
  const board = sql(`select id from boards where slug = 'director-day'`);
  const thread = sql(`insert into threads (board, title) values ('${board}', 'A day on the board') returning id`);
  const boardName = () => sql(`select name from boards_now where id = '${board}'`);
  assert.equal(boardName(), 'Director Day Diner');

  // Players and their masks: Ada (a heel) posts twice, Bea and Cyd once, Dov posted before the move landed, and Rex reacts.
  const names = ['Dayrun Ada', 'Dayrun Bea', 'Dayrun Cyd', 'Dayrun Dov', 'Dayrun Rex'] as const;
  const classes: Record<string, string> = { 'Dayrun Ada': 'heel', 'Dayrun Rex': 'face' };
  const accounts: Record<string, string> = JSON.parse(sql(`
    with u as (insert into auth.users (email) values ${names.map((n, i) => `('e2e-day-${i}@test.invalid')`).join(', ')} returning id, email),
    a as (insert into accounts (id) select id from u returning id)
    select json_object_agg(email, id) from u`));
  const account = (name: string) => accounts[`e2e-day-${names.indexOf(name as (typeof names)[number])}@test.invalid`]!;
  const chars: Record<string, string> = JSON.parse(sql(`
    with c as (insert into characters (owner, name, created_at, debuted_at) values
      ${names.map((n) => `('${account(n)}', '${n}', now() - interval '1 day', now() - interval '1 day')`).join(', ')} returning id, name),
    h as (insert into class_history (character, class_key, started_at)
      select id, case name ${Object.entries(classes).map(([n, k]) => `when '${n}' then '${k}'`).join(' ')} else 'face' end, now() - interval '1 day' from c returning 1)
    select json_object_agg(name, id) from c`));
  const say = (who: string, body = 'Hello.') => sql(`insert into acts (character, kind, thread, payload) values ('${chars[who]}', 'post', '${thread}', '{"body": "${body}"}') returning id`);
  // The same, in a thread on another board: it never counts.
  const elsewhere = sql(`insert into threads (board, title) select id, 'Elsewhere' from boards where slug <> 'director-day' and not is_system order by slug limit 1 returning id`);

  // ---- The meeting queues the rename, with a demand of three different characters on the board. ----
  const answer = {
    memory: { hobby: { name: 'tag team matches', since: 'today', from: 'a board' }, opinions: [], grudges: [], wheelhouse: [], realWorld: [], marks: [] },
    profile: { interests: ['tag teams'], favorites: [], mood: 'smug', signature: 'It is decided.' },
    moves: [{
      kind: 'renameBoard',
      params: { board, name: 'Director Day Docks', premise: 'A diner, but on a dock.' },
      demand: { kind: 'distinctCharactersOnBoard', params: { board, count: 3 } },
      go_live_at: new Date(Date.now() + 3_600_000).toISOString(),
      expires_in_hours: 72,
      why: 'The board needed a gimmick.',
    }],
  };
  let second = false;
  let asked = '';
  const fake = (async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).includes('anthropic')) {
      if (second) asked = firstMessageOf(body);
      const part = partOf(body);
      assert.ok(part, 'the meeting asks for one of its parts');
      const reply = partAnswer(second ? { ...answer, moves: [] } : answer, part);
      return new Response(JSON.stringify({ model: tiers.strong, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(reply) }], usage: { input_tokens: 4000, output_tokens: 700, service_tier: 'standard' } }), { status: 200 });
    }
    return new Response(JSON.stringify({ choices: [{ text: ' a diner on a dock!\nBoard: next' }], usage: { prompt_tokens: 300, completion_tokens: 12 } }), { status: 200 });
  }) as unknown as typeof fetch;
  const env = (name: string) => ({ ANTHROPIC_API_KEY: 'test-key', SYSTEM_COMPLETIONS_URL: 'https://completions.test' } as Record<string, string>)[name];
  const real = models(env, ledgerWriter(db), { tiers, fetch: fake });

  const firstSlot = new Date(Math.floor(Date.now() / 60_000) * 60_000 - 2 * 3_600_000 + 23_000).toISOString();
  const first = await runMeeting(db, real, quiet, firstSlot, Date.now, fake);
  assert.equal(first.status, 'ok', JSON.stringify(first));
  const queued = JSON.parse(sql(`select to_jsonb(q) from queued_moves q where meeting = ${first.status === 'ok' ? first.meeting : 0}`));
  assert.equal(queued.kind, 'renameBoard');
  assert.equal(queued.demand.kind, 'distinctCharactersOnBoard');
  assert.equal(queued.landed_act, null);
  assert.equal(boardName(), 'Director Day Diner', 'a queued move changes nothing');

  // A tick before its hold has passed lands nothing; Dov posts on the board meanwhile, before the move lands.
  const early = await db.rpc<{ landed: number }>('system_tick', {});
  assert.equal(early.landed, 0);
  say('Dayrun Dov', 'First!');

  // ---- The hold passes (stepped over as 0013 does), and the tick lands the rename. ----
  sql(`
    alter table queued_moves disable trigger queued_moves_guard;
    update queued_moves set go_live_at = now() - interval '1 minute' where id = ${queued.id} and landed_act is null and held_at is null;
    alter table queued_moves enable trigger queued_moves_guard;`);
  const landing = await db.rpc<{ landed: number }>('system_tick', {});
  assert.equal(landing.landed, 1, JSON.stringify(landing));
  const moveAct = sql(`select landed_act from queued_moves where id = ${queued.id}`);
  assert.ok(moveAct, 'the move landed');
  assert.equal(boardName(), 'Director Day Docks', 'the board is called by the Boss\'s name for it');
  assert.equal(sql(`select c.staff from acts a join characters c on c.id = a.character where a.id = '${moveAct}'`), BOSS, 'the move is signed by the Boss');
  const lines: string[] = JSON.parse(sql(`select value -> 'moveLanded' from settings where key = 'systemLines'`));
  const words = sql(`select value ->> 'renameBoard' from settings where key = 'systemMoveWords'`).replace('{name}', 'Director Day Docks');
  const body = sql(`select payload ->> 'body' from acts where id = '${moveAct}'`);
  assert.ok(lines.length > 0 && lines.map((l) => l.replace('{move}', words)).includes(body), `the move's body is a stock line: ${body}`);

  // ---- Characters post until the demand is met; the tick checks the demand a few times, paced. ----
  const recheck = () => sql(`update open_moves set checked_at = null`);
  const ada = say('Dayrun Ada', 'Ada one.');
  say('Dayrun Ada', 'Ada two.');
  say('Dayrun Bea', 'Bea one.');
  sql(`select write_staff_act('${BOSS}', 'post', '${thread}', null, '{"body": "The Boss posts on the board."}')`);
  sql(`insert into acts (character, kind, thread, payload) values ('${chars['Dayrun Rex']}', 'post', '${elsewhere}', '{"body": "Not on the board."}')`);
  recheck();
  const mid = await db.rpc<{ met: number }>('system_tick', {});
  assert.equal(mid.met, 0, 'two characters, a staff member and a post elsewhere are not three characters on the board');
  assert.equal(boardName(), 'Director Day Docks');
  assert.equal(sql(`select count(*) from open_moves where move_act = '${moveAct}'`), '1');

  say('Dayrun Cyd', 'Cyd one.');
  recheck();
  const done = await db.rpc<{ met: number }>('system_tick', {});
  assert.equal(done.met, 1, JSON.stringify(done));
  const ended = JSON.parse(sql(`select to_jsonb(e) from acts e where e.kind = 'move_end' and e.target_act_id = '${moveAct}'`));
  assert.deepEqual([ended.payload.why, ended.payload.by], ['met', 'demand']);
  assert.equal(boardName(), 'Director Day Diner', 'the old name returns');
  assert.equal(sql(`select count(*) from open_moves where move_act = '${moveAct}'`), '0');
  assert.equal(sql(`select count(*) from acts a join characters c on c.id = a.character where c.staff = '${BOSS}' and a.kind = 'post' and a.created_at >= '${ended.created_at}'`), '1', 'the Boss says it');

  // ---- The next meeting's digest shows the move as met, and who met it. ----
  // Its window ends 30 seconds after the move's end, however far ahead other files left the last slot.
  second = true;
  const secondSlot = new Date(Date.parse(sql(`select to_jsonb(created_at)#>>'{}' from acts where id = '${ended.id}'`)) + 30_000).toISOString();
  const next = await runMeeting(db, real, quiet, secondSlot, Date.now, fake);
  assert.equal(next.status, 'ok', JSON.stringify(next));
  assert.match(asked, /Dayrun Ada/, 'the model is sent the digest');
  const digest = await db.rpc<{ moves: { act: string; state: string; ended: { why: string }; metBy: string[]; progress: { met: boolean } }[] }>('system_digest', { since: new Date(Date.parse(secondSlot) - 60_000).toISOString(), until: secondSlot });
  const entry = digest.moves.find((m) => m.act === moveAct);
  assert.ok(entry, `the digest lists the move: ${JSON.stringify(digest.moves)}`);
  assert.equal(entry.state, 'ended');
  assert.equal(entry.ended.why, 'met');
  assert.deepEqual(entry.metBy, [chars['Dayrun Ada'], chars['Dayrun Bea'], chars['Dayrun Cyd']], 'those who posted on the board after it landed, in the order they first did');
  const line = asked.split('\n').find((l) => l.startsWith('renameBoard: ended met'));
  assert.ok(line, `the prompt has the met move: ${asked.slice(0, 600)}`);
  assert.match(line, /demand distinctCharactersOnBoard 3 of 3, met/);
  assert.match(line, /met by Dayrun Ada \([a-z]+\/[a-z]+\), Dayrun Bea \([a-z]+\/[a-z]+\) and Dayrun Cyd \([a-z]+\/[a-z]+\)\./, line);
  assert.ok(!line.includes('Dayrun Dov') && !line.includes('Dayrun Rex'), 'neither the early poster nor the one elsewhere is credited');
  assert.ok(!line.includes(instance.system.roster.find((b) => b.key === BOSS)!.name), 'a staff member is never credited');

  // ---- A reaction to the Boss's move Act is public and pays nobody; one to a player's post in the same window does pay. ----
  const rex = psqlDb(account('Dayrun Rex'));
  await rex.rpc('react', { target: moveAct, through: chars['Dayrun Rex'], reaction: 'tomato' });
  await rex.rpc('react', { target: ada, through: chars['Dayrun Rex'], reaction: 'tomato' });
  await psqlDb(account('Dayrun Dov')).rpc('react', { target: ada, through: chars['Dayrun Dov'], reaction: 'tomato' });
  assert.equal(sql(`select count from reaction_tallies where act = '${moveAct}' and kind = 'tomato'`), '1', 'the tally of the move shows it, in public');
  // Self-contained: the window is the one next_settlement_window gives, whatever earlier files left settled (nothing, when this file runs
  // alone). It starts where the last settled window ended, or at the season's start, and a run until exactly one settlement length
  // later (the instance's is a day) asks for that one whole window and no other: a first window ends in step with `until`, less whole
  // lengths, so an `until` of start + one length ends it there. The reactions go to its middle, and every Act of this file was made
  // before its end, so the settlement reads them all.
  // Run alone, nothing is settled yet and the fixtures' first season began in 2000, so thousands of daily windows would come before this
  // file's day: the season is moved to begin an hour ago, the one change that leaves exactly this day due (the real runSettlement settles
  // at most a month of windows a run). Where an earlier file left settlements, the season and its windows are theirs and are not touched.
  sql(`update seasons set starts_at = now() - interval '1 hour' where ends_at is null and not exists (select 1 from settlements)`);
  const windowStart = sql(`select to_jsonb(coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons)))#>>'{}'`);
  assert.equal(sql(`select span_interval(setting('settlementLength'))::text`), '1 day', 'the window below is one day long');
  const win = await db.rpc<{ start: string; end: string } | null>('next_settlement_window', { until: new Date(Date.parse(windowStart) + 86_400_000).toISOString() });
  assert.ok(win, 'there is a window to settle');
  const windowMid = new Date((Date.parse(win.start) + Date.parse(win.end)) / 2).toISOString();
  sql(`update reactions set created_at = '${windowMid}' where act in ('${moveAct}', '${ada}')`);
  const settled = await runSettlement(db, instance, win.end);
  assert.equal(settled.status, 'applied', JSON.stringify(settled));
  assert.equal(settled.windows.length, 1, 'only the reactions\' window is settled');
  assert.equal(sql(`select count(*) from ledger_shares where act = '${moveAct}'`), '0', 'a staff Act pays nobody');
  assert.equal(sql(`select count(*) from ledger l where l.character in (select id from characters where staff is not null)`), '0', 'and no staff character is paid');
  assert.notEqual(sql(`select count(*) from ledger_shares where act = '${ada}'`), '0', 'while the same reaction to a player\'s post does');
  assert.equal(sql(`select count from reaction_tallies where act = '${moveAct}' and kind = 'tomato'`), '1', 'the tally of the move is still there after the settlement');
});
