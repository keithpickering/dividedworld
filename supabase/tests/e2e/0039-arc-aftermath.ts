/**
 * End to end: the handover when Everything is World -1 is held (docs/plans/2026-11-25-arc-announcements-plan.md, Task 9). 0021 plays the season where it lands and the new Boss is shown `restore`; this file plays the other
 * run. The Split lands, the last beat is played in the last week with its announcement and the Boss's recap, an admin holds its merge before it lands, and the season rolls over. What a reader or a prompt sees:
 *
 *   the announcement thread of the last beat is pinned and holds the announcement alone: nothing in it says the merge landed, because it did not (the fiction may lie, the move threads never do);
 *   the new Boss's meeting is shown the recap and the `unfinished` beat's brief, and never `restore`'s; the `restore` beat has no event at all;
 *   playing `unfinished` opens its own pinned thread under `after:fangame:unfinished`, the only pin of the new season, and the old season's pin is gone;
 *   after the honeymoon's days the recap leaves the plot so far, and the initiative stays.
 *
 * Stepped over, as 0021 steps over them: time (the season's start and the handover's time), the queue's go-live times, the bank, the placeholder Bosses (added so the season has a successor), and the sealed-off scratch database's
 * earlier seasons. Run by tools/test-sql.mjs.
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
import { leadInMoods } from '../../../engine/system/beats.ts';
import { plotSections, type PublicRecord } from '../../../engine/system/chatter.ts';
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
const arcRead = (): { beats: { key: string; mini: boolean; due: boolean }[]; heldBack: string[]; leadIns: string[] } =>
  JSON.parse(sql(`select arc_for_meeting(current_boss(), (select id from seasons where ends_at is null))`));
const lastEvent = (beat: string) => sql(`select coalesce((select e.event from arc_beat_events e where e.staff = '${BOSS}' and e.beat = '${beat}' and e.season = (select id from seasons where ends_at is null) order by e.id desc limit 1), 'none')`);
const noDrift = (step: string) => assert.equal(sql(`select count(*) from thread_places_drift()`), '0', `thread_places_drift is empty after ${step}`);
const boardId = (name: string) => sql(`select id from boards_now where name = '${name}'`);
const merged = (board: string) => sql(`select coalesce(merged_into::text, '') || '/' || closed from boards_now where id = '${board}'`);

test('the handover after a held Everything is World -1: the new Boss is shown unfinished and never restore', async () => {
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
  /** An admin, to take a pin down. */
  const admin = sql(`with u as (insert into auth.users (email) values ('e2e-fangame-season-admin@test.invalid') returning id), a as (insert into accounts (id) select id from u returning id), m as (insert into admins (account) select id from a returning account) select account from m`);
  /** The story a staff persona's pool call is given: `pool_record` as the chatter reads it (the Boss's lead-ins mapped to their mood lines through its file), then the record's sections as `chatterPrompt` writes them. */
  const poolStory = async (staff: string, boss: boolean, in_thread: string) => {
    const record = await db.rpc<PublicRecord & { push?: string[]; leadIns?: string[] }>('pool_record', { in_thread, staff_key: staff });
    const persona = world.system.roster.find((p) => p.key === staff)!;
    const given = Array.isArray(record.leadIns) ? { ...record, leadIns: leadInMoods(persona, record.leadIns, world.system.roster) } : record;
    return { record, given, text: plotSections(given, { key: staff, boss }, world.settings.titleMaxLength).join('\n\n') };
  };
  /** The announcement of a beat the Boss played in the open season. */
  const announced = (staff: string, beat: string) => JSON.parse(sql(`select coalesce((select to_jsonb(n) from arc_announcements n where n.staff = '${staff}' and n.beat = '${beat}' and n.season = (select id from seasons where ends_at is null) order by n.id desc limit 1), 'null')`)) as { thread: string; act: string; title: string; pitch: string; push: string } | null;
  const stickiesOf = async (thread: string) => {
    const board = sql(`select board from threads where id = '${thread}'`);
    return (await player.rpc<{ stickies: { id: string; title: string }[] }>('board_page', { in_slug: slugOf(board), in_page: 1, effect_cards: [] })).stickies.map((x) => x.id);
  };
  const poolThread = thread(boardId('General'), 'The pool reads this thread', 1, Date.now() - 40 * DAY);

  const adminDb = psqlDb(admin);
  const BEATS = world.system.roster.find((p) => p.key === BOSS)!;
  const unfinishedBrief = BEATS.aftermath!.find((b) => b.key === 'unfinished')!.brief;
  const restoreBrief = BEATS.aftermath!.find((b) => b.key === 'restore')!.brief;

  // ---- The Split is played and lands. ----
  dayOfSeason(22);
  await tick();
  const first = await meet(1, { beats: [{ beat: 'split', slots: { fangames: { name: 'Mario Maker Mansion' } }, why: 'The idea of my career.' }] });
  assert.deepEqual(first.beatsPlayed, ['split']);
  makeDue(`meeting = ${first.meeting}`);
  await tick();
  await tick();
  assert.equal(sql(`select count(*) from queued_moves where meeting = ${first.meeting} and landed_act is not null`), '2', 'both boards landed');
  assert.equal(lastEvent('split'), 'played');
  noDrift('the Split');

  // ---- The last week: Everything is World -1 is played with its defaults, and the merge is held by an admin before it lands. ----
  endsInDays(1.25);
  await tick();
  const lastRecap = 'E2E-RECAP-HELD: I tried to put everything in one board. I am told it is still two.';
  const second = await meet(2, { farewell: 'Per my programming, goodbye.', handoff: 'It is not finished. The merge was held.', recap: lastRecap, successor: { boss: NEXT, why: 'It has the stamina.' } });
  assert.deepEqual(second.beatsPlayed, ['everything']);
  const everythingAnn = announced(BOSS, 'everything')!;
  assert.ok(everythingAnn, 'the last beat was announced');
  assert.ok((await stickiesOf(everythingAnn.thread)).includes(everythingAnn.thread), 'its thread is a sticky');
  const mergePart = Number(sql(`select id from queued_moves where meeting = ${second.meeting} and kind = 'mergeBoard'`));
  await adminDb.rpc('hold_move', { id: mergePart });
  makeDue(`meeting = ${second.meeting}`);
  await tick();
  await tick();
  assert.equal(sql(`select (held_at is not null)::text || '/' || (landed_act is null)::text from queued_moves where id = ${mergePart}`), 'true/true', 'the merge was held and never landed');
  assert.equal(sql(`select count(*) from queued_moves where meeting = ${second.meeting} and kind = 'nameSuccessor' and landed_act is not null`), '1', 'the nomination landed');
  // The fiction may lie: the thread announced the merge. The log does not: nothing in it says the merge happened.
  assert.equal(sql(`select count(*) from acts where thread = '${everythingAnn.thread}' and kind = 'move'`), '0', 'no move line in the announcement thread says the merge landed');
  assert.equal(sql(`select count(*) from acts where thread = '${everythingAnn.thread}'`), '1', 'the thread holds the announcement alone');
  assert.equal(sql(`select coalesce(merged_into::text, '') || '/' || closed from boards_now where name = 'Mario Maker Mansion'`), '/false', 'the fangame board is still its own board');
  noDrift('the held merge');

  // ---- The handover. ----
  assert.equal(sql(`select reveal_season(starts_at + span_interval(setting('seasonLength'))) is not null from seasons where ends_at is null`), 't');
  assert.equal(sql(`select boss from seasons where ends_at is null`), NEXT);
  assert.ok(!(await stickiesOf(everythingAnn.thread)).includes(everythingAnn.thread), 'the old season\'s pin is gone');
  await tick();
  const offered = arcRead().beats.map((b: any) => b.key);
  assert.ok(offered.includes('unfinished'), `the new Boss is offered unfinished: ${offered}`);
  assert.ok(!offered.includes('restore'), `and never restore: ${offered}`);
  assert.equal(sql(`select count(*) from arc_beat_events where staff = '${NEXT}' and beat like 'after:${BOSS}:restore'`), '0', 'restore has no event');

  const unfinishedAnnounce = { title: 'Sorting it out (E2E)', body: 'E2E-UNFINISHED-BODY: threads, back where they belong.', pitch: 'E2E-UNFINISHED-PITCH: out of World -1.' };
  const third = await meet(3, { beats: [{ beat: 'unfinished', why: 'He wants to be liked.', announce: unfinishedAnnounce }] }, 3, NEXT);
  assert.equal(third.boss, NEXT);
  assert.ok(seen[2]!.system.includes(unfinishedBrief), 'the new Boss\'s meeting shows the unfinished beat');
  assert.ok(!seen[2]!.system.includes(restoreBrief), 'and never the restore beat');
  assert.ok(seen[2]!.system.includes(lastRecap), 'with the recap, in the plot so far');
  assert.deepEqual(third.beatsPlayed, ['unfinished']);
  const ann = announced(NEXT, `after:${BOSS}:unfinished`)!;
  assert.ok(ann, 'playing it announced it under its own key');
  assert.equal(sql(`select a.payload ->> 'body' from acts a where a.thread = '${ann.thread}' and a.seq = 1`), unfinishedAnnounce.body);
  assert.deepEqual((await stickiesOf(ann.thread)).filter((i) => [everythingAnn.thread, ann.thread].includes(i)), [ann.thread], 'the new thread is the only pin');
  assert.equal((await poolStory(BOSS, false, poolThread)).text.includes(`Last season you were the Boss. This is how you summed it up: ${lastRecap}`), true, 'FanGaME reads it in the second person');
  assert.equal(sql(`select count(*) from arc_beat_events where staff = '${NEXT}' and beat = 'after:${BOSS}:restore'`), '0');
  noDrift('the next Boss\'s first meeting');

  // ---- After the honeymoon's days: the recap leaves the plot so far, and the initiative stays. ----
  sql(`update season_handovers set at = at - interval '60 days' where season = (select id from seasons where ends_at is null)`);
  const later = await poolStory(NEXT, true, poolThread);
  assert.ok(!later.text.includes(lastRecap) && later.text.includes(unfinishedAnnounce.pitch));
  noDrift('after the honeymoon');
});
