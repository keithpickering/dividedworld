/**
 * End to end: staff requests (docs/plans/2026-11-24-staff-requests-plan.md, Task 8), across the `chatter` Edge Function's own core (supabase/functions/chatter/core.ts: a Mod's turn rules on a request),
 * the meeting's core (supabase/functions/meet/core.ts: the Boss rules on the requests passed to it), the tick (system_tick: a move lands, a request lapses) and the moderation log (moves_log), against the real migrations
 * on the scratch database (supabase/migrations/0424_staff_requests.sql), with the real model adapters over a fake `fetch`. What is asserted is what a player or a caller sees: the turn's answer, the thread's board,
 * the posts in the thread and the log's rows.
 *
 * The scene (invented words): the quality-control persona is a Mod whose order holds two boards (A and B) and an allowance of 3, and has a session all day. Three players each reply to one of its posts with a request:
 *   a. Ann asks for her thread on A to go to B: both boards are its beat, so its turn grants it (fulfill) and, once the tick lands the move, the thread is on B.
 *   b. Bo asks for his thread on C (off its beat) to go to A: the fake model says fulfill, the engine's repair cannot hold it to the beat, so the turn confers; the request waits and the meeting is shown it. The Boss
 *      (the instance's first) grants it in its meeting; its reply is in the thread beneath the request, and once the tick lands the move, the thread is on A. The Boss's bank is debited once.
 *   c. Cy asks for his thread on C to go to B and its turn confers outright; the meeting leaves it out. Its age is stepped over to the days staffRequests.daysMost allows, the tick lapses it, and the stock
 *      line `requestLapsed` is the reply in the thread; the thread has not moved.
 *   d. moves_log shows each, in facts: the Mod's grant, the Mod's two confers, how each confer ended (fulfill, none while waiting before the meeting, lapsed), and the moves that landed. Nothing the persona
 *      or the Boss wrote is in a row, and no asker.
 *
 * Stepped over, as 0017 and 0034 step over theirs: the Mod's order (a finished meeting row and a staff_orders row, written by the superuser) and office, the day's session (written for the whole day), the pool's picks
 * (weekly 1 and a spend row for yesterday leave no allowance for one, so the round makes only the session's turns), the open season's Boss (the instance's first, with a bank) and the age of the waiting request
 * c (the queue's row is back-dated; an Act is never edited, and the queue is a state row). Reads only the scratch database tools/test-sql.mjs made; run by tools/test-sql.mjs. It commits what it sets and leaves it,
 * as the files before it do, under keys and boards of its own.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstMessageOf, partOf, partAnswer } from './meeting-fake.ts';
import { psqlDb, sql, scratchSeed, openSeasonAhead } from './psql-db.ts';
import { runChatter } from '../../functions/chatter/core.ts';
import { runMeeting } from '../../functions/meet/core.ts';
import { instance } from '../../functions/_shared/instance.ts';
import { models } from '../../functions/_shared/models/index.ts';
import { ledgerWriter } from '../../functions/_shared/models/ledger.ts';
import type { Instance } from '../../../engine/rules/types.ts';

const tiers = { strong: 'claude-opus-5-5', light: 'claude-haiku-5-5' };
const MOD = instance.system.roster.find((p) => p.key === 'quality-control')!;
/** The Boss for this run is a persona whose arc holds no kind back (the first Boss holds moveThread back until a beat unlocks); the first Boss is the other Mod, whose beat is board C. */
const BOSS = 'ontopic';
const OTHER_MOD = instance.system.firstBoss;
const quiet: Instance = { ...instance, system: { ...instance.system, feeds: [] } };
const json = <T = Record<string, any>>(text: string): T => JSON.parse(text) as T;
const rows = (query: string) => json<Record<string, any>[]>(sql(`select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (${query}) x`));

test('a Mod grants a request on its beat; one off its beat is conferred and the Boss grants it at the meeting; one the meeting leaves out lapses; the log shows each', async (t) => {
  const db = psqlDb();
  await db.rpc('seed_instance', { payload: scratchSeed(instance) });
  sql(`update settings set value = 'true' where key = 'systemEnabled'`);
  sql(`update settings set value = value || '{"weekly": 1, "threadsWeekly": 0}'::jsonb where key = 'pool'`);
  const daysMost = Number(sql(`select value ->> 'daysMost' from settings where key = 'staffRequests'`));
  assert.ok(daysMost >= 1, `the setting is seeded: ${daysMost}`);

  // ---- The staff: the Boss is the open season's, with a bank; the persona is a Mod with an order (two boards, an allowance) and a session all day. ----
  sql(`update seasons set boss = '${BOSS}' where ends_at is null`);
  t.after(openSeasonAhead());
  sql(`update characters set debuted_at = coalesce(debuted_at, now() - interval '30 days') where staff in ('${BOSS}', '${MOD.key}', '${OTHER_MOD}')`);
  for (const mod of [MOD.key, OTHER_MOD]) if (sql(`select office from staff_office_now where staff = '${mod}'`) !== 'mod') sql(`insert into staff_offices (staff, office, cause) values ('${mod}', 'mod', 'seed')`);
  sql(`insert into move_bank (staff, balance, as_of) values ('${BOSS}', 5, now()) on conflict (staff) do update set balance = 5, as_of = now()`);
  const today = sql(`select ((now() + interval '5 minutes') at time zone 'UTC')::date::text`);
  sql(`select write_sessions('${today}'::date, '[{"staff": "${MOD.key}", "start": 0, "end": 1440}]')`);

  // ---- Three boards of this file's own (A and B the Mod's beat, C not) and a thread each for the three requests. ----
  const tag = Date.now().toString(36);
  const board = (n: string) => sql(`insert into boards (slug, name, description) values ('req-${n}-${tag}', 'Req ${n} ${tag}', 'A board of its own for requests.') returning id`);
  const [boardA, boardB, boardC] = [board('a'), board('b'), board('c')] as [string, string, string];
  const seconds = Number.parseInt(tag, 36) % 100000;
  const meetingRow = sql(`insert into meetings (slot, started_at, finished_at, outcome) values (now() - interval '3 hours' - interval '${seconds} seconds', now() - interval '3 hours', now() - interval '3 hours', 'ok') returning id`);
  sql(`insert into staff_orders (meeting, staff, boards, order_line, allowance) values (${meetingRow}, '${MOD.key}', array['${boardA}', '${boardB}']::uuid[], 'Watch A and B.', 3), (${meetingRow}, '${OTHER_MOD}', array['${boardC}']::uuid[], 'Watch C.', 3)`);

  const player = (n: string) => {
    const account = sql(`with u as (insert into auth.users (email) values ('e2e-req-${n}-${tag}@test.invalid') returning id) insert into accounts (id) select id from u returning id`);
    return sql(`with c as (insert into characters (owner, name, created_at, debuted_at) values ('${account}', 'Req ${n} ${tag}', now() - interval '2 days', now() - interval '2 days') returning id),
      h as (insert into class_history (character, class_key, started_at) select id, 'face', now() - interval '2 days' from c returning 1) select id from c`);
  };
  const scene = (n: string, on: string, asks: string) => {
    const thread = sql(`insert into threads (board, title) values ('${on}', 'Req thread ${n} ${tag}') returning id`);
    const asker = player(n);
    const opening = json<{ id: string }>(sql(`select write_staff_act('${MOD.key}', 'post', '${thread}', null, '${JSON.stringify({ body: `The Mod opens thread ${n}.` })}')`)).id;
    const request = sql(`insert into acts (character, kind, thread, target_act_id, payload, created_at) values ('${asker}', 'post', '${thread}', '${opening}', '${JSON.stringify({ body: asks }).replace(/'/g, "''")}', now() + interval '1 minute') returning id`);
    return { thread, asker, opening, request, asks };
  };
  const a = scene('Ann', boardA, 'MARK-ANN please move this thread to the other board.');
  const b = scene('Bo', boardC, 'MARK-BO please move this thread to Req A.');
  const c = scene('Cy', boardC, 'MARK-CY please move this thread to Req B.');
  const place = (thread: string) => db.rpc<string>('thread_place', { in_thread: thread });
  const nameOf = (character: string) => sql(`select name from characters where id = '${character}'`);
  assert.equal(await place(a.thread), boardA);
  assert.equal(await place(b.thread), boardC);

  // ---- The fake model: a Mod's chat turn answers by the marker of the request it is shown; the meeting's staff part rules on the one the scenario sets. ----
  const turnAnswer: Record<string, unknown> = {
    'MARK-ANN': { words: 'Moving it.', request: { reply: a.request, ruling: 'fulfill', move: { kind: 'moveThread', params: { thread: a.thread, board: boardB }, expires_in_hours: 0, why: 'It belongs on B.' } } },
    // The model says fulfill; the thread is off the Mod's beat, so the engine's repair turns it into a confer.
    'MARK-BO': { words: 'Not my beat, so I will pass it on.', request: { reply: b.request, ruling: 'fulfill', move: { kind: 'moveThread', params: { thread: b.thread, board: boardA }, expires_in_hours: 0, why: 'It belongs on A.' } } },
    'MARK-CY': { words: 'This is above me.', request: { reply: c.request, ruling: 'confer' } },
  };
  const scripted: { meeting: Record<string, unknown> | null } = { meeting: null };
  const BOSS_LINE = 'Granted by the Boss, with great reluctance.';
  const calls: { duty: string }[] = [];
  const fake = (async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (!String(url).includes('anthropic')) return new Response(JSON.stringify({ choices: [{ text: ' ok.' }], usage: { prompt_tokens: 100, completion_tokens: 4 } }), { status: 200 });
    const part = partOf(body);
    if (part) {
      calls.push({ duty: 'meeting' });
      assert.ok(scripted.meeting, 'the meeting is asked only when the scenario set its answer');
      return new Response(JSON.stringify({ model: tiers.strong, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(partAnswer(scripted.meeting, part)) }], usage: { input_tokens: 4000, output_tokens: 300, service_tier: 'standard' } }), { status: 200 });
    }
    calls.push({ duty: 'chatter' });
    const shown = (body.messages ?? []).map((m: { content: unknown }) => String(m.content)).join('');
    const mark = Object.keys(turnAnswer).find((k) => shown.includes(k));
    assert.ok(mark, `a Mod's turn was shown one of the requests: ${shown.slice(0, 300)}`);
    return new Response(JSON.stringify({ model: tiers.light, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(turnAnswer[mark]) }], usage: { input_tokens: 1200, output_tokens: 60, service_tier: 'standard' } }), { status: 200 });
  }) as unknown as typeof fetch;
  const env = (name: string) => ({ ANTHROPIC_API_KEY: 'test-key', SYSTEM_COMPLETIONS_URL: 'https://completions.test' } as Record<string, string>)[name];
  const real = models(env, ledgerWriter(db), { tiers, oldVoice: { window: 1024, count: (x: string) => x.length }, fetch: fake });

  // ---- The round: the Mod's turns. ----
  const slot = new Date(Math.floor(Date.now() / 60_000) * 60_000 + 5 * 60_000).toISOString();
  const out = await runChatter(db, real, instance, slot);
  assert.equal(out.status, 'ok', JSON.stringify(out));
  const turn = (s: { thread: string }) => out.turns.find((x) => x.thread === s.thread)!;
  for (const s of [a, b, c]) assert.ok(turn(s) && turn(s).status === 'taken', `the Mod took a turn in ${s.thread}: ${JSON.stringify(out.turns)}`);

  // a. The grant: the turn says fulfill and names the move; the thread is still where it was until the move lands.
  assert.equal(turn(a).ruling?.written?.ruling, 'fulfill', JSON.stringify(turn(a).ruling));
  assert.ok(turn(a).ruling?.written?.move, 'the grant queued a move');
  const grant = json(sql(`select to_jsonb(q) from queued_moves q where q.staff = '${MOD.key}' and q.cause_act = '${a.request}'`));
  assert.equal(grant.kind, 'moveThread');
  assert.equal(grant.params.thread, a.thread);
  assert.equal(grant.params.board, boardB);
  assert.equal(grant.expires_at, null, 'a thread move lasts until reversed');
  assert.equal(await place(a.thread), boardA, 'the thread has not moved before the move lands');
  assert.equal(Number(sql(`select count(*) from acts where thread = '${a.thread}' and character = (select id from characters where staff = '${BOSS}')`)), 0, 'a Mod\'s grant has no Boss reply');
  sql(`select system_tick()`);
  assert.equal(await place(a.thread), boardB, 'once the move lands the thread is on the other board');

  // b. The confer: the model said fulfill, the turn's ruling is confer with the engine's reason, and the request waits for the meeting; no move was queued.
  assert.equal(turn(b).ruling?.ruling, 'confer', `the turn's ruling is the repaired one: ${JSON.stringify(turn(b).ruling)}`);
  assert.equal(turn(b).ruling?.written?.ruling, 'confer', JSON.stringify(turn(b).ruling));
  assert.ok(turn(b).trims.some((x) => x.predicate === 'fulfillToConfer'), `the turn says it was turned into a confer: ${JSON.stringify(turn(b).trims)}`);
  assert.equal(Number(sql(`select count(*) from queued_moves where cause_act = '${b.request}'`)), 0, 'a confer queues nothing');
  assert.equal(turn(c).ruling?.written?.ruling, 'confer');
  assert.equal(Number(sql(`select balance from move_bank where staff = '${BOSS}'`)), 5, 'no turn touched the Boss\'s bank');
  const waiting = json<{ id: number; thread: string; body: string; lapsesAt: string }[]>(sql(`select requests_waiting(10)`));
  const mine = waiting.filter((r) => [b.thread, c.thread].includes(r.thread));
  assert.equal(mine.length, 2, `both confers wait: ${JSON.stringify(waiting)}`);
  assert.equal(waiting.some((r) => r.thread === a.thread), false, 'the grant is not waiting');
  const idOf = (s: { thread: string }) => mine.find((r) => r.thread === s.thread)!.id;
  assert.ok(mine.every((r) => /MARK-/.test(r.body)), 'the meeting is shown the request whole');

  // The meeting: the Boss grants Bo's request (its line is its reply), and says nothing of Cy's.
  const memory = { hobby: { name: 'tag team matches', since: 'today', from: 'a board' }, opinions: [], grudges: [], wheelhouse: ['mario hacks'], realWorld: [], marks: [] };
  scripted.meeting = {
    memory, profile: { interests: ['tag teams'], favorites: [], mood: 'smug', signature: 'It is decided.' }, moves: [],
    requests: [{ id: idOf(b), ruling: 'fulfill', line: BOSS_LINE, move: { kind: 'moveThread', params: { thread: b.thread, board: boardA }, expires_in_hours: 0, why: 'The Mod passed it up, so it moves.' } }],
  };
  const meetSlot = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
  const met = await runMeeting(db, real, quiet, meetSlot, Date.now, fake);
  assert.equal(met.status, 'ok', JSON.stringify(met));
  assert.deepEqual(met.status === 'ok' ? met.requests : null, [{ id: idOf(b), ruling: 'fulfill', posted: true }], `the meeting ruled on the one request it answered (reason: ${sql(`select coalesce(string_agg(reason, '|'), '') from staff_request_rulings`)}; notes: ${JSON.stringify(met.status === 'ok' ? met.notes : null)})`);
  const reply = rows(`select a.payload ->> 'body' as body, a.target_act_id as target, c.staff from acts a join characters c on c.id = a.character where a.thread = '${b.thread}' and c.staff = '${BOSS}' and a.kind = 'post'`);
  assert.equal(reply.length, 1, 'the Boss replied once in the thread');
  assert.equal(reply[0]!.body, BOSS_LINE, 'the reply is the Boss\'s own line');
  assert.equal(reply[0]!.target, b.request, 'beneath the request');
  // The meeting also credits the bank (a week's accrual, and the allowance the Mods left unspent), so the debit is read in the moves it queued: one, for this request.
  assert.equal(Number(sql(`select count(*) from queued_moves where staff = '${BOSS}' and cause_act = '${b.request}'`)), 1, 'the grant is one queued move of the Boss\'s, caused by the request');
  assert.equal(Number(sql(`select count(*) from queued_moves where staff = '${BOSS}' and meeting = ${met.status === 'ok' ? met.meeting : 0} and kind = 'moveThread'`)), 1, 'and the meeting made no other grant');
  const bank = Number(sql(`select balance from move_bank where staff = '${BOSS}'`));
  assert.equal(await place(b.thread), boardC, 'the thread moves when the move lands, not before');
  sql(`select system_tick()`);
  assert.equal(await place(b.thread), boardA, 'once it lands the thread is on A');
  assert.equal(waiting.length > 0 && json<{ thread: string }[]>(sql(`select requests_waiting(10)`)).some((r) => r.thread === b.thread), false, 'a ruled request no longer waits');

  // c. The lapse: Cy's request was left out; its queue row is aged to the days it may wait, and the tick lapses it with the stock line.
  assert.equal(json<{ thread: string }[]>(sql(`select requests_waiting(10)`)).some((r) => r.thread === c.thread), true, 'the request the meeting left out still waits');
  sql(`select system_tick()`);
  assert.equal(json<{ thread: string }[]>(sql(`select requests_waiting(10)`)).some((r) => r.thread === c.thread), true, 'and waits until its days are up');
  sql(`update staff_requests_open set at = now() - interval '${daysMost} days' - interval '1 minute' where request = ${idOf(c)}`);
  const ticked = json<{ requestsLapsed: number }>(sql(`select system_tick()`));
  assert.ok(ticked.requestsLapsed >= 1, `the tick lapsed it: ${JSON.stringify(ticked)}`);
  assert.equal(json<{ thread: string }[]>(sql(`select requests_waiting(10)`)).some((r) => r.thread === c.thread), false, 'a lapsed request no longer waits');
  const stock = (instance.system.stockLines as unknown as Record<string, readonly string[]>)['requestLapsed']!;
  const lapse = rows(`select a.payload ->> 'body' as body, a.target_act_id as target from acts a join characters c on c.id = a.character where a.thread = '${c.thread}' and c.staff = '${BOSS}' and a.kind = 'post'`);
  assert.equal(lapse.length, 1, 'the Boss replied once, with the stock line');
  assert.equal(lapse[0]!.target, c.request);
  const lines = stock.map((l) => l.replaceAll('{asker}', nameOf(c.asker)).replaceAll('{boss}', nameOf(sql(`select id from characters where staff = '${BOSS}'`))));
  assert.ok(lines.includes(lapse[0]!.body), `the reply is one of the stock lines for a lapse: ${lapse[0]!.body}`);
  assert.equal(await place(c.thread), boardC, 'a lapsed request moves nothing');
  assert.equal(Number(sql(`select balance from move_bank where staff = '${BOSS}'`)), bank, 'a lapse spends nothing');
  const again = json<{ requestsLapsed: number }>(sql(`select system_tick()`));
  assert.equal(again.requestsLapsed, 0, 'a lapsed request lapses once');

  // d. The log: a row for each request the persona ruled on, in facts, and the moves that landed.
  const log = rows(`select kind, params, ended_why, thread from moves_log where staff = '${MOD.key}' and thread in ('${a.thread}', '${b.thread}', '${c.thread}') order by at, kind`);
  const reqRow = (s: { thread: string }) => log.find((r) => r.kind === 'request' && r.thread === s.thread)!;
  assert.deepEqual([reqRow(a).params.ruling, reqRow(a).params.by, reqRow(a).params.move_kind, reqRow(a).params.ruled, reqRow(a).ended_why], ['fulfill', 'mod', 'moveThread', 'fulfill', null], 'the grant');
  assert.deepEqual([reqRow(b).params.ruling, reqRow(b).params.by, reqRow(b).params.move_kind, reqRow(b).params.ruled, reqRow(b).ended_why], ['confer', 'mod', 'moveThread', 'fulfill', 'fulfill'], 'the confer the meeting granted');
  assert.deepEqual([reqRow(c).params.ruling, reqRow(c).params.by, reqRow(c).params.move_kind, reqRow(c).params.ruled, reqRow(c).ended_why], ['confer', 'mod', null, 'lapsed', 'lapsed'], 'the confer that lapsed');
  assert.equal(reqRow(a).params.post, 2, 'a row says the request\'s number in its thread');
  assert.equal(reqRow(a).params.title, `Req thread Ann ${tag}`);
  const landed = rows(`select staff, kind, params ->> 'board' as board from moves_log where kind = 'moveThread' and params ->> 'thread' in ('${a.thread}', '${b.thread}') order by at`);
  assert.deepEqual(landed.map((r) => [r.staff, r.board]), [[MOD.key, boardB], [BOSS, boardA]], 'the two moves that landed are in the log under whoever made them');
  const serialized = JSON.stringify(log);
  for (const secret of ['Moving it', 'Not my beat', 'This is above me', BOSS_LINE, 'MARK-']) assert.ok(!serialized.includes(secret), `the log carries none of the persona's or the Boss's words: ${secret}`);
  for (const s of [a, b, c]) assert.ok(!serialized.includes(s.asker) && !serialized.includes(nameOf(s.asker)), 'and no asker');
  assert.ok(calls.some((x) => x.duty === 'meeting') && calls.filter((x) => x.duty === 'chatter').length === 3, 'three turns and a meeting made the model calls');
});
