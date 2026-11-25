/**
 * End to end: a day on the staff's board (docs/plans/2026-11-24-staff-board-threads-plan.md, Task 11), across the act function's own core (supabase/functions/act/core.ts), the meeting's core
 * (supabase/functions/meet/core.ts), the tick (system_tick) and the settlement's core (supabase/functions/settle/core.ts, with the Roster Report it runs after the windows), against the real
 * migrations on the scratch database (0427 to 0432), with the real model adapters over a fake `fetch`. What is asserted is what a player or a caller sees: the answers, the threads and the posts in them.
 *
 * The day (invented words; the instance's own copy keys, as the seed writes them):
 *   a. A player makes a character: it is active at once and wrote no Act. It posts in a thread: that is its first public Act, and it is a newcomer.
 *   b. Another character Turns, announced, in that thread: the announcement is there at once (ahead), and a withdrawal, a change and a second announcement of it are refused.
 *   c. A board card is played in a thread on its board: it lands there. On a board with no thread it is refused with the way forward.
 *   d. The Boss's meeting runs and gives minutes: they are the Boss's post in the season's Staff Meetings thread. Its move (a rename) lands in a staff thread of its own, titled for its kind.
 *   e. The settlement runs, with the Roster Report: the Turn lands, and the season's Roster Report holds the newcomer under New faces, the Turn under both Turns announced and Turns taking effect, and
 *      the commentary the fake model gave. A character that had been listed before is not listed as new.
 *   f. The announcements thread, where an instance that has one keeps it, holds nothing new from all of it.
 *
 * Stepped over, as 0012 and 0029 step over theirs: the structural hold of the queued move (a setting of at least an hour; the queue's guard is disabled for one update), the season's start where nothing is
 * settled yet (the fixtures' first season began in 2000, which would put thousands of daily windows before this day; as 0012 does), the characters an earlier report listed (roster_seen, written by the superuser:
 * this file asserts who this day's report lists, not who an earlier file left unlisted) and, where an earlier file left a window ahead of now, the time of this file's own Acts (the player-side acts the report reads
 * are moved into that window, behind the Act table's own guard, as 0029 moves its own). Reads only the scratch database tools/test-sql.mjs made; run by tools/test-sql.mjs. It commits what it sets and leaves it,
 * as the files before it do, under names and boards of its own.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partOf, partAnswer } from './meeting-fake.ts';
import { psqlDb, sql, scratchSeed, openSeasonAhead } from './psql-db.ts';
import { runAction } from '../../functions/act/core.ts';
import { runMeeting } from '../../functions/meet/core.ts';
import { runSettlement } from '../../functions/settle/core.ts';
import { instance } from '../../functions/_shared/instance.ts';
import { models } from '../../functions/_shared/models/index.ts';
import { ledgerWriter } from '../../functions/_shared/models/ledger.ts';
import { rosterCopyOf } from '../../../engine/system/roster.ts';
import type { Instance } from '../../../engine/rules/types.ts';

const quiet: Instance = { ...instance, system: { ...instance.system, feeds: [] } };
const BOSS = instance.system.firstBoss;
const tiers = { strong: 'claude-opus-5-5', light: 'claude-haiku-5-5' };
const MINUTES = 'MINUTES-STAFFDAY: we argued about the dock and the dock won.';
const COMMENTARY = 'COMMENTARY-STAFFDAY: fresh faces and a fresh coat of paint.';
const rows = (query: string) => JSON.parse(sql(`select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (${query}) x`)) as Record<string, any>[];

test('a day on the staff\'s board: a new face, a Turn announced at once, a board card in its board\'s thread, the minutes, a move in its own thread, and the Roster Report', async (t) => {
  const db = psqlDb();
  await db.rpc('seed_instance', { payload: scratchSeed(instance) });
  sql(`update settings set value = 'true' where key = 'systemEnabled'`);
  sql(`update seasons set boss = '${BOSS}' where ends_at is null`);
  t.after(openSeasonAhead());
  sql(`insert into move_bank (staff, balance, as_of) values ('${BOSS}', 3, now()) on conflict (staff) do update set balance = 3, as_of = now()`);
  sql(`select end_move(move_act, 'expired', 'e2e') from open_moves`);
  // Nothing settled yet: the season begins an hour ago, so that this day is its first window (as 0012 does).
  sql(`update seasons set starts_at = now() - interval '1 hour' where ends_at is null and not exists (select 1 from settlements)`);
  const tag = Date.now().toString(36);
  const announcements = () => sql(`select coalesce((select value #>> '{}' from settings where key = 'systemAnnouncements'), '')`);
  const annThread = announcements();
  const annActs = () => (annThread ? Number(sql(`select count(*) from acts where thread = '${annThread}'`)) : 0);
  const annBefore = annActs();

  // ---- The players. Ann, Bea and Cy have characters from before; Dee makes one today. ----
  const names = ['Ann', 'Bea', 'Cy', 'Dee'] as const;
  const accounts: Record<string, string> = JSON.parse(sql(`
    with u as (insert into auth.users (email) values ${names.map((n) => `('e2e-sb-${tag}-${n}@test.invalid')`).join(', ')} returning id, email),
    a as (insert into accounts (id) select id from u returning id)
    select json_object_agg(split_part(split_part(email, '@', 1), '-', 4), id) from u`));
  const label = (n: string) => `Staffday ${n} ${tag}`;
  const chars: Record<string, string> = JSON.parse(sql(`
    with c as (insert into characters (owner, name, created_at, debuted_at) values
      ${['Ann', 'Bea', 'Cy'].map((n) => `('${accounts[n]}', '${label(n)}', now() - interval '3 days', now() - interval '3 days')`).join(', ')} returning id, name),
    h as (insert into class_history (character, class_key, started_at) select id, 'face', now() - interval '3 days' from c returning 1)
    select json_object_agg(name, id) from c`));
  const char = (n: string) => chars[label(n)]!;
  const as = (n: string) => ({ player: psqlDb(accounts[n]), service: db });
  // The characters an earlier report listed (stepped over): this file asks who today's report lists.
  sql(`insert into roster_seen (character, window_end) select id, now() - interval '1 day' from characters where staff is null on conflict do nothing`);

  const general = sql(`select id from boards where slug = 'general'`);
  const thread = sql(`insert into threads (board, title) values ('${general}', 'Staffday ${tag}') returning id`);
  const opening = sql(`insert into acts (character, kind, thread, payload) values ('${char('Ann')}', 'post', '${thread}', '{"body": "Who is new around here?"}') returning id`);

  // ---- a. A character is made: active at once, no Act. It posts: a newcomer. ----
  const made = await runAction(as('Dee'), instance, { action: 'createCharacter', name: label('Dee'), class: 'heel', pronouns: { subject: 'they', object: 'them', determiner: 'their', possessive: 'theirs', reflexive: 'themself', plural: true } });
  assert.equal(made.status, 200, JSON.stringify(made));
  const dee = sql(`select id from characters where name = '${label('Dee')}'`);
  assert.equal(sql(`select debuted_at is not null from characters where id = '${dee}'`), 't', 'active at once');
  assert.equal(sql(`select count(*) from acts where character = '${dee}'`), '0', 'making a character writes no Act');
  const hello = await runAction(as('Dee'), instance, { action: 'post', thread, character: dee, body: 'Hello, I am new.', quote: opening });
  assert.equal(hello.status, 200, JSON.stringify(hello));
  const helloAct = (hello.body as { id: string }).id;

  // ---- b. Bea Turns, announced, in the thread: the Act is there at once, and it stands. ----
  const turned = await runAction(as('Bea'), instance, { action: 'turn', character: char('Bea'), class: 'heel', loudness: 'announced', showFrom: true, showTo: true, thread });
  assert.equal(turned.status, 200, JSON.stringify(turned));
  const announcement = (turned.body as { announcement: { id: string; thread: string; payload: Record<string, unknown> } }).announcement;
  assert.equal(announcement.thread, thread);
  assert.equal(announcement.payload.ahead, true);
  assert.equal(sql(`select count(*) from acts where id = '${announcement.id}' and thread = '${thread}' and kind = 'announce'`), '1', 'the announcement is in the thread at once');
  for (const request of [{ action: 'withdrawTurn', character: char('Bea') }, { action: 'turn', character: char('Bea'), class: 'tweener', loudness: 'silent' }, { action: 'announceTurn', character: char('Bea'), thread }]) {
    const refused = await runAction(as('Bea'), instance, request);
    assert.ok(refused.status >= 400 && refused.status < 500, JSON.stringify(refused));
    assert.match(String((refused.body as { error: string }).error), /announced/);
  }
  assert.equal(sql(`select count(*) from pending_turns where character = '${char('Bea')}' and announce_act = '${announcement.id}'`), '1', 'the Turn stands');
  assert.equal(sql(`select class_key from class_now('${char('Bea')}', now())`), 'face', 'it has not taken effect');

  // ---- c. A board card is played in a thread on its board; on a board with no thread it is refused with the way forward. ----
  sql(`insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts) values ('sdquake${tag}', 'Staffday Quake', 'salty', 'legendary', 'cast', '{board}', interval '1 day')`);
  sql(`insert into card_ledger (account, card, kind, price) select '${accounts.Cy}', 'sdquake${tag}', 'bought', 0 from generate_series(1, 2)`);
  const bare = sql(`insert into boards (slug, name, description) values ('sd-bare-${tag}', 'Staffday Bare ${tag}', 'No thread yet.') returning id`);
  const arena = sql(`insert into boards (slug, name, description) values ('sd-arena-${tag}', 'Staffday Arena ${tag}', 'A board with a thread.') returning id`);
  const arenaThread = sql(`insert into threads (board, title) values ('${arena}', 'Staffday Arena Talk ${tag}') returning id`);
  const play = (board: string, inThread: string | null) => db.rpc<{ id: string; thread: string }>('play_card', { who: accounts.Cy, card: `sdquake${tag}`, through: char('Cy'), target: board, config: {}, price: 0, message: '', reach: 'board', in_board_thread: inThread });
  await assert.rejects(play(bare, null), /start a thread on Staffday Bare \w+ first/);
  const card = await play(arena, arenaThread);
  assert.equal(card.thread, arenaThread, 'the board card lands in the thread on its board');
  assert.equal(sql(`select count(*) from acts where id = '${card.id}' and thread = '${arenaThread}' and kind = 'card'`), '1');

  // ---- d. The Boss's meeting: its minutes are posted in the Staff Meetings thread, and its move lands in a thread of its own. ----
  const dock = sql(`insert into boards (slug, name, description) values ('sd-dock-${tag}', 'Staffday Diner ${tag}', 'Where the staff dines.') returning id`);
  const answer = {
    memory: { hobby: { name: 'dock work', since: 'today', from: 'a board' }, opinions: [], grudges: [], wheelhouse: [], realWorld: [], marks: [] },
    profile: { interests: ['docks'], favorites: [], mood: 'smug', signature: 'It is decided.' },
    minutes: MINUTES,
    moves: [{
      kind: 'renameBoard',
      params: { board: dock, name: `Dockside Dock Diner`, premise: 'A diner, but on a dock.' },
      demand: { kind: 'distinctCharactersOnBoard', params: { board: dock, count: 3 } },
      go_live_at: new Date(Date.now() + 3_600_000).toISOString(),
      expires_in_hours: 72,
      why: 'The board needed a gimmick.',
    }],
  };
  const asked: string[] = [];
  const fake = (async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).includes('anthropic')) {
      const part = partOf(body);
      const reply = part ? partAnswer(answer, part) : { commentary: COMMENTARY };
      if (!part) asked.push(String(body.messages?.map((m: { content: unknown }) => m.content).join('\n')));
      return new Response(JSON.stringify({ model: part ? tiers.strong : tiers.light, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(reply) }], usage: { input_tokens: 4000, output_tokens: 300, service_tier: 'standard' } }), { status: 200 });
    }
    return new Response(JSON.stringify({ choices: [{ text: ' a diner on a dock!\nBoard: next' }], usage: { prompt_tokens: 300, completion_tokens: 12 } }), { status: 200 });
  }) as unknown as typeof fetch;
  const env = (name: string) => ({ ANTHROPIC_API_KEY: 'test-key', SYSTEM_COMPLETIONS_URL: 'https://completions.test' } as Record<string, string>)[name];
  const real = models(env, ledgerWriter(db), { tiers, oldVoice: { window: 1024, count: (s: string) => s.length }, fetch: fake });

  const slot = new Date(Math.floor(Date.now() / 60_000) * 60_000 - 5 * 3_600_000 + 41_000 + (Number.parseInt(tag, 36) % 1000) * 1000).toISOString();
  const meeting = await runMeeting(db, real, quiet, slot, Date.now, fake);
  assert.equal(meeting.status, 'ok', JSON.stringify(meeting));
  const season = sql(`select id from seasons where ends_at is null`);
  const meetings = sql(`select meetings_thread from seasons where id = ${season}`);
  assert.ok(meetings, 'the meeting opened the season\'s Staff Meetings thread');
  assert.match(sql(`select title from threads where id = '${meetings}'`), /Staff Meetings/);
  const minutes = rows(`select c.staff, a.kind, a.payload ->> 'body' as body from acts a join characters c on c.id = a.character where a.thread = '${meetings}' order by a.seq`);
  assert.deepEqual(minutes.map((m) => [m.staff, m.kind, m.body]), [[BOSS, 'post', MINUTES]], 'the Staff Meetings thread holds the minutes, as the Boss\'s post');

  const queued = JSON.parse(sql(`select to_jsonb(q) from queued_moves q where meeting = ${meeting.status === 'ok' ? meeting.meeting : 0}`));
  assert.equal(queued.kind, 'renameBoard');
  sql(`
    alter table queued_moves disable trigger queued_moves_guard;
    update queued_moves set go_live_at = now() - interval '1 minute' where id = ${queued.id} and landed_act is null and held_at is null;
    alter table queued_moves enable trigger queued_moves_guard;`);
  const landing = await db.rpc<{ landed: number }>('system_tick', {});
  assert.equal(landing.landed, 1, JSON.stringify(landing));
  const moveAct = sql(`select landed_act from queued_moves where id = ${queued.id}`);
  assert.ok(moveAct, 'the move landed');
  const moveThread = JSON.parse(sql(`select to_jsonb(t) from threads t where t.id = (select thread from acts where id = '${moveAct}')`));
  assert.equal(moveThread.board, sql(`select system_board()`), 'on the system board');
  assert.equal(moveThread.staff_placed, true, 'a staff thread');
  assert.equal(moveThread.title, instance.system.threadTitles.renameBoard!.replace('{board}', `Staffday Diner ${tag}`).replace('{name}', `Dockside Dock Diner`), 'titled for its kind');
  assert.equal(sql(`select seq from acts where id = '${moveAct}'`), '1', 'the move is the thread\'s first Act');
  assert.notEqual(moveThread.id, announcements(), 'and not the announcements thread');

  // ---- e. The settlement, with the Roster Report. ----
  const windowStart = sql(`select to_jsonb(coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons)))#>>'{}'`);
  const win = await db.rpc<{ start: string; end: string } | null>('next_settlement_window', { until: new Date(Date.parse(windowStart) + 86_400_000).toISOString() });
  assert.ok(win, 'there is a window to settle');
  if (Date.parse(win.start) > Date.now() - 60_000) {
    // An earlier file left its windows ahead of now: this day's Acts are moved into the one the report reads (behind the guard on Acts, as 0029 moves its own).
    const into = new Date(Date.parse(win.start) + 60_000).toISOString();
    sql(`
      alter table acts disable trigger acts_no_update;
      update acts set created_at = '${into}' where id in ('${helloAct}', '${announcement.id}');
      alter table acts enable trigger acts_no_update;
      update pending_turns set asked_at = '${into}' where character = '${char('Bea')}';`);
  }
  // The settlement reads this day's board card, so the instance it settles under holds the card's rules (the instance's own cards reach no board).
  const withCard = { ...instance, cards: [...instance.cards, { key: `sdquake${tag}`, name: 'Staffday Quake', alignment: 'salty', rarity: 'legendary', play: 'cast', reaches: ['board'], lasts: { unit: 'day', count: 1 } }] } as unknown as Instance;
  const settled = await runSettlement(db, withCard, win.end, { roster: { models: () => real, copy: rosterCopyOf(instance.system) } });
  assert.equal(settled.status, 'applied', JSON.stringify(settled));
  assert.equal(settled.windows.length, 1, 'this day\'s window alone');
  assert.equal(sql(`select class_key from class_now('${char('Bea')}', '${win.end}')`), 'heel', 'the Turn took effect at the settlement');
  assert.equal(sql(`select count(*) from acts where kind = 'announce' and character = '${char('Bea')}'`), '1', 'the settlement wrote no second announcement of it');
  assert.equal(asked.length, 1, 'one commentary call');
  assert.ok(!asked[0]!.includes(accounts.Dee!) && !asked[0]!.includes(accounts.Bea!), 'the commentary call names no account');

  const reportThread = sql(`select turns_thread from seasons where id = ${season}`);
  assert.ok(reportThread, 'the season has its Roster Report');
  assert.match(sql(`select title from threads where id = '${reportThread}'`), /Roster Report/);
  const posts = rows(`select c.staff, a.payload ->> 'body' as body from acts a join characters c on c.id = a.character where a.thread = '${reportThread}' and a.kind = 'post' order by a.seq`);
  assert.ok(posts.length >= 1 && posts.every((p) => p.staff === BOSS), 'the Boss writes the report');
  const report = posts.map((p) => p.body as string).join('\n');
  assert.ok(report.includes(COMMENTARY), `the fake model's commentary opens it: ${report.slice(0, 400)}`);
  const headings = instance.system.rosterHeadings;
  const section = (heading: string, next: string[]) => {
    const from = report.indexOf(heading);
    if (from < 0) return '';
    const rest = report.slice(from + heading.length);
    const ends = next.map((h) => rest.indexOf(h)).filter((i) => i >= 0);
    return rest.slice(0, ends.length ? Math.min(...ends) : undefined);
  };
  const all = [headings.newcomers, headings.announced, headings.landed, headings.reveals];
  const faces = section(headings.newcomers, all.filter((h) => h !== headings.newcomers));
  const told = section(headings.announced, all.filter((h) => h !== headings.announced));
  const took = section(headings.landed, all.filter((h) => h !== headings.landed));
  assert.ok(faces.includes(label('Dee')), `the newcomer is under ${headings.newcomers}: ${report}`);
  assert.ok(!faces.includes(label('Bea')) && !faces.includes(label('Ann')) && !faces.includes(label('Cy')), 'a character listed before, or one with no Act, is not a new face');
  assert.ok(told.includes(label('Bea')), `the Turn is under ${headings.announced}: ${report}`);
  assert.ok(took.includes(label('Bea')), `and under ${headings.landed}: ${report}`);
  assert.ok(faces.includes(`/thread/${thread}`) || faces.includes(thread), 'the newcomer links to the thread of its first Act');
  const entry = JSON.parse(sql(`select to_jsonb(e) from roster_entries e where window_end = '${win.end}'`));
  assert.equal(entry.record.counts.newcomers, 1, JSON.stringify(entry.record));
  assert.equal(entry.record.counts.announced, 1);
  assert.equal(entry.record.counts.landed, 1);
  assert.equal(entry.record.commentary, COMMENTARY);
  assert.equal(sql(`select count(*) from roster_seen where character = '${dee}'`), '1', 'the newcomer is listed once in its life');
  assert.equal(sql(`select count(*) from roster_seen where character = '${char('Bea')}' and window_end = '${win.end}'`), '0', 'a Turn is no newcomer');

  // ---- f. The announcements thread holds nothing new. ----
  assert.equal(announcements(), annThread, 'no announcements thread appeared');
  assert.equal(annActs(), annBefore, 'the announcements thread holds nothing new');
  assert.equal(sql(`select count(*) from acts where thread in (select id from threads where title ~ 'Announcements') and created_at > now() - interval '10 minutes' and character in (select id from characters where staff is not null)`), '0');
});
