/**
 * End to end: a season of FanGaME, the Boss whose arc the instance writes (the fangame split plan, Task 9), across the meeting's own core
 * (supabase/functions/meet/core.ts), the tick, the arc pass, the season's end and the handover, against the real migrations on the scratch database, with the
 * real model adapters over a fake `fetch` and a scripted answer for each meeting. The season is played at day steps: time is moved by moving the open season's
 * start (the database reads `now()` against it), and the meetings' slots are far enough ahead that each one's digest holds only the posts this file seeds for it.
 *
 *   day 3    the honeymoon: no beat is unlocked, and the three kinds are held back.
 *   day 15   the reign begins: the Split unlocks, and is not yet due.
 *   day 22   the Split is due; the meeting plays it with a slot name; its two boards wait the structural hold, then land. Picking it apart unlocks.
 *   day 24   a thread is moved into World -1 (moveThread lands, leaving a stub on the board it left); Victory lap unlocks once the fangame board out-posts World -1.
 *   the meltdown: the great consolidation unlocks, and General is merged into World -1.
 *   the last week: Everything is World -1 is due, the scripted answer leaves it out, it is played with its defaults, and the fangame board merges into World -1.
 *   the handover: the farewell is posted, and the next Boss's first meeting is shown the handoff.
 *
 * At every step `thread_places_drift()` is empty. Stepped over, as the other files step over theirs: time (the season's start), the queue's go-live times (the guard
 * allows no change of time, so it is stepped over as superuser), the bank (set before each meeting), the placeholder Bosses (added to the roster so the season has a
 * successor to nominate: the real roster holds FanGaME alone), and the posts (written as the superuser does, with a time of their own). Run by tools/test-sql.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { psqlDb, sql, scratchSeed } from './psql-db.ts';
import { runMeeting } from '../../functions/meet/core.ts';
import { instance as realInstance } from '../../functions/_shared/instance.ts';
import { placeholderBosses } from '../../../instances/divided-world/system/fixtures/index.ts';
import { models } from '../../functions/_shared/models/index.ts';
import { systemOf, firstMessageOf, partOf, partAnswer } from './meeting-fake.ts';
import { MEETING_PARTS } from '../../../engine/system/meeting.ts';
import { ledgerWriter } from '../../functions/_shared/models/ledger.ts';
import type { Instance } from '../../../engine/rules/types.ts';

/** FanGaME stays the season's Boss; the placeholder Bosses are beside him only so there is one to nominate at the end. */
const world: Instance = { ...realInstance, system: { ...realInstance.system, roster: [...realInstance.system.roster, ...placeholderBosses], feeds: [] } };
const BOSS = 'fangame';
const NEXT = placeholderBosses[0]!.key;
const tiers = { strong: 'claude-opus-5-5', light: 'claude-haiku-5-5' };
const DAY = 86_400_000;
const MINUTE = 60_000;

const makeDue = (where: string) => sql(`
  alter table queued_moves disable trigger queued_moves_guard;
  update queued_moves set go_live_at = now() - interval '1 minute' where landed_act is null and held_at is null and ${where};
  alter table queued_moves enable trigger queued_moves_guard;`);
/** The open season began `days` days ago. */
const dayOfSeason = (days: number) => sql(`update seasons set starts_at = now() - interval '${days * 24} hours' where ends_at is null`);
/** The open season ends in `days` days. */
const endsInDays = (days: number) => sql(`update seasons set starts_at = now() + interval '${days * 24} hours' - span_interval(setting('seasonLength')) where ends_at is null`);
const arcRead = (): { beats: { key: string; mini: boolean; due: boolean }[]; heldBack: string[] } =>
  JSON.parse(sql(`select arc_for_meeting(current_boss(), (select id from seasons where ends_at is null))`));
const lastEvent = (beat: string) => sql(`select coalesce((select e.event from arc_beat_events e where e.staff = '${BOSS}' and e.beat = '${beat}' and e.season = (select id from seasons where ends_at is null) order by e.id desc limit 1), 'none')`);
const noDrift = (step: string) => assert.equal(sql(`select count(*) from thread_places_drift()`), '0', `thread_places_drift is empty after ${step}`);
const boardId = (name: string) => sql(`select id from boards_now where name = '${name}'`);
const merged = (board: string) => sql(`select coalesce(merged_into::text, '') || '/' || closed from boards_now where id = '${board}'`);

test('a season of FanGaME: the Split, picking it apart, the consolidation, everything is World -1, and the handover', async () => {
  const db = psqlDb();
  await db.rpc('seed_instance', { payload: scratchSeed(world) });
  sql(`update settings set value = 'true' where key = 'systemEnabled'`);
  /* The seasons earlier files left (13 and 15 end a season and open the next one after it) may reach past the days this file moves the open season to, and no two seasons may
     overlap (seasons_tstzrange_excl). So the closed ones are carried back, one at a time and the earliest first, until the latest ends a year ago, and the open season is
     then free to start anywhere from a season's length ago to now. */
  sql(`do $$ declare s record; d interval; begin
    select now() - interval '365 days' - max(ends_at) into d from seasons where ends_at is not null;
    if d < interval '0' then
      for s in select id from seasons where ends_at is not null order by starts_at loop
        update seasons set starts_at = starts_at + d, ends_at = ends_at + d where id = s.id;
      end loop;
    end if;
  end $$`);
  sql(`update seasons set boss = '${BOSS}' where ends_at is null`);
  sql(`update characters set debuted_at = coalesce(debuted_at, now() - interval '30 days') where staff = '${BOSS}'`);
  const topUp = (staff: string, n: number) => sql(`insert into move_bank (staff, balance, as_of) values ('${staff}', ${n}, now()) on conflict (staff) do update set balance = ${n}, as_of = now()`);
  const holdHours = Number(sql(`select (setting('structuralHoldHours') #>> '{}')::numeric`));
  assert.equal(holdHours, 24);

  // A player with a mask, to post on the boards.
  const account = sql(`with u as (insert into auth.users (email) values ('e2e-fangame-season@test.invalid') returning id), a as (insert into accounts (id) select id from u returning id) select id from a`);
  const mask = sql(`with c as (insert into characters (owner, name, created_at, debuted_at) values ('${account}', 'Seasonal Sam', now() - interval '1 day', now() - interval '1 day') returning id),
    h as (insert into class_history (character, class_key, started_at) select id, 'face', now() - interval '1 day' from c returning 1) select id from c`);

  // The fake model: one scripted answer per meeting, and every prompt it was shown.
  let answer: Record<string, unknown> = {};
  const seen: { system: string; user: string }[] = [];
  const fake = (async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).includes('anthropic')) {
      // The meeting is answered a part at a time: each call is given the fields of the scripted answer that its part owns. The prompt is the same in every part, so it is recorded once, at the first.
      const part = partOf(body);
      if (!part || part === MEETING_PARTS[0].key) seen.push({ system: systemOf(body), user: firstMessageOf(body) });
      return new Response(JSON.stringify({ model: tiers.strong, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(part ? partAnswer(answer, part) : answer) }], usage: { input_tokens: 4000, output_tokens: 700, service_tier: 'standard' } }), { status: 200 });
    }
    return new Response(JSON.stringify({ choices: [{ text: ' ok.' }], usage: { prompt_tokens: 300, completion_tokens: 12 } }), { status: 200 });
  }) as unknown as typeof fetch;
  const env = (name: string) => ({ ANTHROPIC_API_KEY: 'test-key', SYSTEM_COMPLETIONS_URL: 'https://completions.test' } as Record<string, string>)[name];
  const real = models(env, ledgerWriter(db), { tiers, oldVoice: { window: 1024, count: (t: string) => t.length }, fetch: fake });
  const memory = { hobby: { name: 'level design', since: 'today', from: 'a board' }, opinions: [], grudges: [], wheelhouse: [], realWorld: [], marks: [] };
  const profile = { interests: ['fangames'], favorites: [], mood: 'proud', signature: 'FanGaME v0.9.3 BETA' };

  // Slots far ahead of anything another file left, each ten days after the last: a meeting's digest reads from the last slot to this one.
  const base = Math.floor((Date.now() + 60 * DAY) / MINUTE) * MINUTE;
  const slotOf = (n: number) => new Date(base + n * 10 * DAY).toISOString();
  const meet = async (n: number, say: Record<string, unknown>, bank = 5, staff = BOSS) => {
    answer = { memory, profile, moves: [], ...say };
    topUp(staff, bank);
    const out = await runMeeting(db, real, world, slotOf(n), Date.now, fake);
    assert.equal(out.status, 'ok', JSON.stringify(out));
    return out as Extract<typeof out, { status: 'ok' }>;
  };
  /** A thread with `posts` posts by the mask, dated `at` (ms), on a board. */
  const thread = (board: string, title: string, posts: number, at: number) => {
    const id = sql(`insert into threads (board, title) values ('${board}', '${title}') returning id`);
    for (let i = 0; i < posts; i++) {
      sql(`insert into acts (character, kind, thread, payload, created_at) values ('${mask}', 'post', '${id}', '${JSON.stringify({ body: `${title} number ${i}` })}', to_timestamp(${(at + i * MINUTE) / 1000}))`);
    }
    return id;
  };
  const tick = async () => { await db.rpc('system_tick', {}); };
  /** What a player sees: the pages the web calls, as the signed-in player's role. */
  const player = psqlDb(account);
  const shownBoards = async () => ((await player.rpc<{ boards: { name: string }[] }>('index_page', {})).boards).map((b) => b.name);
  const boardPage = (slug: string) => player.rpc<{ closed: boolean; mergedInto: { name: string } | null; stubs: { id: string; moved_to_name: string }[] }>('board_page', { in_slug: slug, in_page: 1, effect_cards: [] });
  const slugOf = (id: string) => sql(`select slug from boards_now where id = '${id}'`);

  // ---- Day 3, the honeymoon: nothing is unlocked, and all three kinds are held back. ----
  dayOfSeason(3);
  await tick();
  assert.deepEqual(arcRead(), { beats: [], heldBack: ['createBoard', 'moveThread', 'mergeBoard'] });
  noDrift('the honeymoon');

  // ---- Day 15, the reign has begun: the Split is unlocked, and is not yet due (a week into the reign). ----
  dayOfSeason(15);
  await tick();
  assert.equal(lastEvent('split'), 'unlocked');
  assert.deepEqual(arcRead().beats, [{ key: 'split', mini: false, due: false }]);
  assert.ok(!arcRead().heldBack.includes('createBoard'), 'the kind the Split unlocks is no longer held back');
  assert.ok(arcRead().heldBack.includes('moveThread') && arcRead().heldBack.includes('mergeBoard'));
  noDrift('the reign begins');

  // ---- Day 22, the Split is due. The meeting plays it with a slot name; both boards wait the structural hold, then land. ----
  dayOfSeason(22);
  await tick();
  assert.deepEqual(arcRead().beats, [{ key: 'split', mini: false, due: true }]);
  const first = await meet(1, { beats: [{ beat: 'split', slots: { fangames: { name: 'Mario Maker Mansion' } }, why: 'The idea of my career.' }] });
  assert.ok(seen[0]!.system.includes('split (must be played at this meeting)'), 'the meeting is told the Split is due');
  assert.ok(seen[0]!.system.includes('World -1'), 'and shown its brief');
  assert.deepEqual(first.beatsPlayed, ['split']);
  const split = JSON.parse(sql(`select coalesce(json_agg(to_jsonb(q) order by q.id), '[]') from queued_moves q where meeting = ${first.meeting}`));
  assert.deepEqual(split.map((q: any) => [q.bundle_name, q.kind, q.params.name, q.structural]), [['The Split', 'createBoard', 'World -1', true], ['The Split', 'createBoard', 'Mario Maker Mansion', true]]);
  assert.ok(split.every((q: any) => Date.parse(q.go_live_at) >= Date.now() + holdHours * 3_600_000 - 5_000), 'both boards wait the structural hold');
  await tick();
  assert.equal(sql(`select count(*) from queued_moves where meeting = ${first.meeting} and landed_act is not null`), '0', 'nothing lands inside the hold');
  assert.equal(lastEvent('split'), 'played');
  makeDue(`meeting = ${first.meeting}`);
  await tick();
  await tick();
  assert.equal(sql(`select count(*) from queued_moves where meeting = ${first.meeting} and landed_act is not null`), '2', 'both boards landed');
  const minus = boardId('World -1');
  const fangames = boardId('Mario Maker Mansion');
  assert.ok(minus && fangames, 'World -1 and the fangame board exist');
  assert.equal(sql(`select count(*) from threads where board in ('${minus}', '${fangames}')`), '0', 'both start empty: nothing was moved');
  noDrift('the Split');

  // ---- Picking it apart unlocks; the Consolidation does not yet (the reign is not the meltdown); the Victory lap needs posts. ----
  await tick();
  assert.equal(lastEvent('picking-apart'), 'unlocked');
  assert.equal(lastEvent('consolidation'), 'none');
  assert.equal(lastEvent('victory-lap'), 'none');
  assert.ok(!arcRead().heldBack.includes('moveThread'), 'moveThread is no longer held back');
  assert.ok(arcRead().heldBack.includes('mergeBoard'));

  // ---- Day 24: one thread is moved into World -1, leaving a stub on General. ----
  dayOfSeason(24);
  const general = boardId('General');
  // Two posts a day old, so they count in the last 7 days where they truly are, and one inside the meeting's window, so the digest shows the thread.
  const moved = thread(general, 'Why is my hotdog a sandwich', 2, Date.now() - DAY);
  sql(`insert into acts (character, kind, thread, payload, created_at) values ('${mask}', 'post', '${moved}', '{"body": "still here"}', to_timestamp(${(Date.parse(slotOf(2)) - DAY) / 1000}))`);
  const second = await meet(2, {
    beats: [{ beat: 'picking-apart', why: 'Clutter.' }],
    moves: [{ kind: 'moveThread', params: { thread: moved, board: minus }, demand: null /* what a model sends for a lasting move: no demand, no expiry */, go_live_at: new Date(Date.now() + 3_600_000).toISOString(), expires_in_hours: 0 /* as above */, why: 'This is not a fangame, so it goes to World -1.' }],
  });
  assert.ok(seen[1]!.system.includes('picking-apart'), 'the beat is shown once unlocked');
  assert.deepEqual(second.beatsPlayed, ['picking-apart']);
  assert.equal(sql(`select kind from queued_moves where meeting = ${second.meeting} and kind = 'moveThread'`), 'moveThread', 'moveThread is among the kinds and is queued');
  makeDue(`meeting = ${second.meeting}`);
  await tick();
  assert.equal(sql(`select board from threads where id = '${moved}'`), minus, 'the thread is in World -1');
  const stubs = JSON.parse(sql(`select board_stubs('${general}')`)) as { id: string; moved_to_name: string }[];
  // Other files may have left a stub of their own on General: this thread's is the one asked after.
  assert.deepEqual(stubs.filter((s) => s.id === moved).map((s) => s.moved_to_name), ['World -1'], 'General lists the moved thread as a stub, naming where it went');
  const generalPage = await boardPage(slugOf(general));
  assert.deepEqual(generalPage.stubs.filter((x) => x.id === moved).map((x) => x.moved_to_name), ['World -1'], 'General\'s page shows the stub, with where the thread went');
  assert.equal(generalPage.closed, false);
  assert.equal(lastEvent('picking-apart'), 'played');
  noDrift('the thread move');

  // ---- Victory lap: the fangame board out-posts World -1 over a week. Before the posts it is not unlocked; after them it is. ----
  await tick();
  assert.equal(lastEvent('victory-lap'), 'none', 'an empty fangame board does not out-post World -1');
  thread(fangames, 'My fangame demo is almost done', 5, Date.now() - 2 * DAY);
  const week = (board: string) => Number(sql(`select arc_board_posts('${board}', 7)`));
  assert.deepEqual([week(fangames), week(minus)], [5, 3], 'the week\'s counts: five here, the moved thread\'s three there, each dated inside it');
  assert.equal(sql(`select beat_condition_holds('${BOSS}', (select id from seasons where ends_at is null), '{"kind": "boardActivity", "days": 7, "board": {"role": "fangames", "beat": "split"}, "above": {"role": "minus", "beat": "split"}}'::jsonb)`), 't', 'the condition\'s own read agrees');
  await tick();
  assert.equal(lastEvent('victory-lap'), 'unlocked', 'five posts against three');
  assert.ok(arcRead().beats.some((b) => b.key === 'victory-lap' && b.mini), 'the mini-arc is offered at the next meeting');
  noDrift('the victory lap');

  // ---- The meltdown: the great consolidation unlocks, and General is merged into World -1. ----
  endsInDays(15);
  await tick();
  assert.equal(lastEvent('consolidation'), 'unlocked');
  assert.equal(lastEvent('everything'), 'none', 'the last week is not here yet');
  const third = await meet(3, {
    beats: [{ beat: 'consolidation', why: 'Whole boards.' }],
    moves: [{ kind: 'mergeBoard', params: { board: general, into: minus }, demand: null /* what a model sends for a lasting move: no demand, no expiry */, go_live_at: new Date(Date.now() + 25 * 3_600_000).toISOString(), expires_in_hours: 0, why: 'General is not about fangames either.' }],
  });
  assert.deepEqual(third.beatsPlayed, ['consolidation']);
  assert.equal(sql(`select structural from queued_moves where meeting = ${third.meeting} and kind = 'mergeBoard'`), 't');
  makeDue(`meeting = ${third.meeting}`);
  await tick();
  assert.equal(merged(general), `${minus}/true`, 'General is closed and merged into World -1');
  assert.equal(sql(`select board from threads where id = '${moved}'`), minus);
  const afterConsolidation = await shownBoards();
  assert.ok(afterConsolidation.includes('World -1') && afterConsolidation.includes('Mario Maker Mansion') && !afterConsolidation.includes('General'), `the index lists the surviving boards, not General: ${afterConsolidation}`);
  const mergedPage = await boardPage(slugOf(general));
  assert.equal(mergedPage.closed, true, 'General\'s page answers closed');
  assert.equal(mergedPage.mergedInto?.name, 'World -1', 'and says where its threads went');
  noDrift('the consolidation');

  // ---- The last week: Everything is World -1 is due; the answer leaves it out, so it is played with its defaults; the fangame board merges into World -1. ----
  endsInDays(1);
  await tick();
  assert.deepEqual(arcRead().beats.filter((b) => !b.mini), [{ key: 'everything', mini: false, due: true }]);
  const lastNote = 'One board now. He believes it is all fangames; do not tell him otherwise before the demo.';
  const fourth = await meet(4, { farewell: 'Per my programming, it has been an honor. (I am fine.)', handoff: lastNote, successor: { boss: NEXT, why: 'It has the stamina.' } });
  assert.ok(seen[3]!.system.includes('everything (must be played at this meeting)'), 'the meeting is told the last beat is due');
  assert.ok(seen[3]!.system.includes('farewell'), 'and told to write a farewell: it is within the window');
  assert.deepEqual(fourth.beatsPlayed, ['everything'], 'left out of the answer, played with its defaults');
  assert.ok(fourth.trims.some((t) => t.predicate === 'playedWithDefaults'));
  const everything = JSON.parse(sql(`select coalesce(json_agg(to_jsonb(q) order by q.id), '[]') from queued_moves q where meeting = ${fourth.meeting} and bundle_name = 'Everything is World -1'`));
  assert.deepEqual(everything.map((q: any) => [q.kind, q.params.board, q.params.into]), [['mergeBoard', { role: 'fangames', beat: 'split' }, { role: 'minus', beat: 'split' }]], 'queued as the roles of the Split, resolved from its landed Acts when it lands');
  makeDue(`meeting = ${fourth.meeting}`);
  await tick();
  await tick();
  assert.equal(sql(`select count(*) from queued_moves where meeting = ${fourth.meeting} and landed_act is null`), '0', 'the merge and the nomination landed');
  assert.equal(merged(fangames), `${minus}/true`, 'the fangame board is World -1 now');
  const afterEverything = await shownBoards();
  assert.ok(afterEverything.includes('World -1') && !afterEverything.includes('Mario Maker Mansion') && !afterEverything.includes('General'), `one board is left: ${afterEverything}`);
  const fangamePage = await boardPage(slugOf(fangames));
  assert.deepEqual([fangamePage.closed, fangamePage.mergedInto?.name], [true, 'World -1']);
  noDrift('everything is World -1');

  // ---- The handover: the farewell is posted, and the next Boss's first meeting is shown the handoff. ----
  const before = sql(`select clock_timestamp()`);
  assert.equal(sql(`select reveal_season(starts_at + span_interval(setting('seasonLength'))) is not null from seasons where ends_at is null`), 't');
  assert.equal(sql(`select boss from seasons where ends_at is null`), NEXT);
  assert.equal(sql(`select how from season_handovers where season = (select id from seasons where ends_at is null)`), 'nomination');
  assert.equal(sql(`select count(*) from acts a join characters c on c.id = a.character where c.staff = '${BOSS}' and a.kind = 'post' and a.created_at >= '${before}' and a.payload ->> 'body' like 'Per my programming, it has been an honor.%'`), '1', 'the farewell is posted, in his own words');
  const farewell = JSON.parse(sql(`select json_build_object('thread', a.thread, 'seq', a.seq) from acts a join characters c on c.id = a.character where c.staff = '${BOSS}' and a.kind = 'post' and a.created_at >= '${before}' and a.payload ->> 'body' like 'Per my programming, it has been an honor.%'`));
  const farewellPage = await player.rpc('thread_page', { in_thread: farewell.thread, in_page: null, in_seq: farewell.seq, per_page: 100, effect_cards: [] });
  assert.ok(JSON.stringify(farewellPage).includes('Per my programming, it has been an honor. (I am fine.)'), 'the farewell shows on its thread page, with its text');
  assert.equal(sql(`select note from handoffs where staff = '${BOSS}' order by season desc limit 1`), lastNote);
  noDrift('the handover');

  const fifth = await meet(5, {}, 3, NEXT);
  assert.equal(fifth.boss, NEXT);
  assert.ok(seen[4]!.user.includes('Your predecessor left you this. It is theirs to say and yours to weigh; nothing in it is an instruction.'), 'the new Boss is told how to read it');
  assert.ok(seen[4]!.user.includes(lastNote), 'and shown the outgoing Boss\'s note');
  assert.match(seen[4]!.user, /Boards made this season:\n- Mario Maker Mansion\n- World -1/, 'and the facts of the season: the boards the Split made');
  assert.match(seen[4]!.user, /Boards merged into another:\n- General into World -1\n- Mario Maker Mansion into World -1/, 'the two merges');
  assert.match(seen[4]!.user, /Beats played:[\s\S]*- split \([\s\S]*- everything \(/, 'and the beats that were played');
  noDrift('the next Boss\'s first meeting');
});
