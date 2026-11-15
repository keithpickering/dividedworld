/**
 * The budget on a cold read (warm reads, Task 7; docs/plans/2026-11-15-warm-reads-design.md, section 6). A screen function is plpgsql with a fixed generic plan
 * (0368), so its first call on a connection plans every statement it holds and keeps the plans; that is what a pool connection holds from then on, and the figure the
 * pool's arithmetic needs (section 3). Reading `acts_public` thirty times in one function did this to thread_page (0357): nothing failed, a cold read took seconds
 * and a nano instance lived in swap. This file measures, for each screen function, the memory a fresh connection's contexts hold after that function's first call
 * (`pg_backend_memory_contexts`, summed before and after, as the harness's superuser) and holds it to a budget recorded for that function.
 *
 * What is measured is what a connection keeps, not the peak of the planning: the peak has no reading Postgres gives from inside a function. The kept figure moves with the
 * planning (the kept plan is what the planner built) and repeats from one fresh connection to the next to within a few hundredths of a megabyte.
 *   1. Every screen function has a budget and every budget names a screen function. The names are the rule screen-functions.ts holds (`screenNames`), which the screen
 *      functions' guard (0016-screen-reads.ts) reads too, not a copy.
 *   2. A function over its budget fails, naming the figures. A budget far above what is measured guards nothing, so a measurement under its budget by more than the larger
 *      of a tenth of the budget and 0.6 MB fails too and asks for the budget to be lowered.
 *   3. Postgres 17 only: the figures differ by major version, so `requireRecorded` stops the file before the fixture and before every measurement on another, and every
 *      test that measures fails on that one message.
 * A megabyte is 1,048,576 bytes. A budget is its measurement in the workflow (the sql job, on its Postgres 17, after the files before this one), rounded up to one decimal,
 * plus 0.3 MB of room, so ordinary run-to-run movement never fails
 * a build and the far-under gap (twice the room) never asks a freshly set budget to be lowered.
 *
 * Seeing the figures: a passing end-to-end file's output is discarded by tools/test-sql.mjs, so a green suite hides the table. To print it for this file, on a scratch database
 * the suite made or any local one with the migrations and fixtures replayed (the table is also in a failure's message):
 *   KAYFABB_SCRATCH_URL=postgres://postgres:pg@localhost:5432/<scratch> node --experimental-strip-types --no-warnings --test supabase/tests/e2e/0028-cold-read-budget.ts
 * The budgets are the workflow's: its Postgres 17 is the one they must hold on. If a developer's 17 differs from the workflow's and a line fails, read its measured figure and
 * compare it with the budget; a difference inside the room is the minor version, not a regression, and a budget is changed only to what the workflow's own run measured.
 * A Postgres 17.11 on Windows, on a database holding only the migrations and fixtures, measured up to 0.75 MB under the workflow (boot 5.28 against 6.02), so there the
 * far-under line can fire on a healthy build: that is the machine, and no budget is lowered for it.
 *
 * `budgetFaults` is that judgment, pure, and each poison below is the defect it exists to catch: a function that reads `acts_public` thirty times over (thirty branches, each
 * joining it to itself twice, since a bare thirty reads of its id alone keep only about half of thread_page's figure), committed in the scratch database (each measurement is
 * a connection of its own, so a rolled-back transaction would not be seen) and dropped in a `finally`, is measured against thread_page's budget and must be named as over; a
 * screen function with no budget, a budget with no function and a measurement far under its budget are each named, with cases that tell the larger of the tenth and the floor
 * from the smaller.
 *
 * The fixture (two accounts, three characters, a board of its own with a thread of twenty posts with five card plays, an admin) is committed once so each call answers a document and not a refusal.
 * Every call reads the fixture's own rows (its board, thread, characters and accounts) or something no file changes (season 1 and the open season, which fixtures.sql makes, and
 * ids or terms that match nothing); none names 'general', which an earlier file merges away.
 * It is left in the scratch database: this is the last end-to-end file, and a later file that counted accounts or characters would see it. `drive_gifts_page` and
 * `results_page` answer empty documents (no drive, no finished season in the fixture), so a helper those pages call only for each row is not planned by these calls and its
 * plan is not in their figures.
 *
 * Who is online is pinned, because it is the one thing these calls read that the clock changes. The online box (`presence_box`, which index_page, board_page and
 * thread_page each call) names every mask seen inside the presence window (five minutes), and calls `banned_until` and `group_now` once for each name: with nobody
 * online neither is planned, and with one mask online both are, and all they call. An earlier file commits a mask's presence at `now()` (0003-export.ts), so
 * index_page's figure was one or the other by how long the files between took: 5.2 MB in a run that reached this file 5 minutes 22 seconds after that one passed, 5.960
 * MB in a run that reached it after 4 minutes 20 (the sql job, 2026-11-15, the same commit of every file under supabase/). So the fixture makes its own mask the one
 * mask online, browsing its own thread, where an instance with anyone on it stands, and sets every other presence row's `seen_at` a day back; the rows are an earlier
 * file's leftovers and this is the last file. `onlineFaults` holds that before the first measurement and after the last: a mask online that is not the fixture's, or
 * the fixture's gone from the window (a machine that took five minutes over this file), fails by that name and not as a budget.
 * Reads only the scratch database tools/test-sql.mjs made (scratchUrl refuses any other); run by tools/test-sql.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './psql-db.ts';
import { screenNames } from './screen-functions.ts';

const MB = 1024 * 1024;
/** The major version the budgets were recorded on. */
const RECORDED_ON = 17;

/**
 * Refuses a Postgres whose major version is not the one the budgets were recorded on. Called before the fixture is made and before every measurement, so on another
 * major nothing is measured and every test that measures fails on this one message. `major` is the server's own unless a test names one.
 */
export function requireRecorded(major: number = Math.floor(Number(sql('show server_version_num')) / 10000)): void {
  assert.equal(major, RECORDED_ON, `the budgets in this file were recorded on Postgres ${RECORDED_ON} and this is ${major}; the figures differ by major version`);
}

/** The ids the fixture made. */
interface Fixture { board: string; player: string; other: string; admin: string; mine: string; mate: string; theirs: string; thread: string; post: string; }

/** Makes the fixture once, committed (every measurement is a fresh connection, so it reads only what is committed), and answers its ids. */
function makeFixture(): Fixture {
  requireRecorded();
  const tag = `${process.pid}-${Date.now()}`;
  const out = sql(`
    do $fx$
    declare
      pl uuid := tests.account('cold-${tag}-player');
      ot uuid := tests.account('cold-${tag}-other');
      ad uuid := tests.account('cold-${tag}-admin');
      c1 uuid := tests.character(pl, 'Cold ${tag} One', 'alpha', now() - interval '60 days');
      c2 uuid := tests.character(pl, 'Cold ${tag} Two', 'beta', now() - interval '60 days');
      c3 uuid := tests.character(ot, 'Cold ${tag} Three', 'alpha', now() - interval '60 days');
      bd uuid;
      t uuid;
      p uuid;
      first_post uuid;
      i integer;
    begin
      insert into admins (account) values (ad);
      -- Its own board and thread, written directly: an earlier file merges 'general' away (0021), and tests.thread writes into that board.
      insert into boards (slug, name) values ('cold-${tag}', 'Cold ${tag}') returning id into bd;
      insert into threads (board, title) values (bd, 'Cold ${tag} thread') returning id into t;
      for i in 1 .. 20 loop
        p := tests.post((array[c1, c2, c3])[1 + i % 3], t, 'Cold post ' || i, now() - interval '1 hour' + i * interval '1 minute');
        if i = 1 then first_post := p; end if;
        if i <= 5 then perform tests.act((array[c2, c3, c1])[1 + i % 3], 'card', t, jsonb_build_object('card', 'sweetie'), p); end if;
      end loop;
      -- Who is online, pinned (the header): every presence row an earlier file left is set a day back, and one of the fixture's masks browses the fixture's thread.
      update presence set seen_at = now() - interval '1 day';
      insert into presence (character, place_kind, place, board, place_since, online_since, seen_at) values (c3, 'thread', t, bd, now(), now(), now());
      perform set_config('cold.ids', jsonb_build_object('board', 'cold-${tag}', 'player', pl, 'other', ot, 'admin', ad, 'mine', c1, 'mate', c2, 'theirs', c3, 'thread', t, 'post', first_post)::text, false);
    end $fx$;
    select current_setting('cold.ids');`);
  return JSON.parse(out) as Fixture;
}
let made: Fixture | undefined;
const fixture = (): Fixture => (made ??= makeFixture());

/** The masks the online boxes would name now: every character with a presence row inside the presence window, by id, in order. Staff and hidden masks are listed too, so none is waved through. */
export function online(): string[] {
  const out = sql(`select p.character from presence p where p.seen_at >= now() - span_interval(setting('presenceWindow')) order by 1`);
  return out === '' ? [] : out.split(/\r?\n/);
}

/**
 * One line for each way who is online is not what the fixture pinned: a mask online that is not the fixture's `own`, and `own` not online. Either moves which helpers
 * a first call plans, so a figure measured then is not the one its budget was recorded for.
 */
export function onlineFaults(seen: string[], own: string): string[] {
  const out = seen.filter((c) => c !== own).map((c) => `${c}: it is online and is not the fixture's mask; the online boxes would call their helpers for it`);
  if (!seen.includes(own)) out.push(`${own}: the fixture's mask is not online; the online boxes would name nobody and plan no helper`);
  return out;
}

/**
 * One cold read: one `sql()` call, so one fresh connection. It reads what the connection's contexts hold as the harness's superuser (the view needs it), then in one
 * transaction becomes the fixture's account, makes the call once and unbecomes, then reads again. Answers the difference, in bytes. `call` is a SQL expression and
 * `as` the account that makes it.
 */
export function kept(call: string, as: string): number {
  requireRecorded();
  const out = sql(`
    select sum(total_bytes) as before_bytes from pg_backend_memory_contexts \\gset
    begin;
    do $cold$ begin perform tests.become('${as}'); perform ${call}; perform tests.unbecome(); end $cold$;
    commit;
    select sum(total_bytes) - :before_bytes from pg_backend_memory_contexts;`);
  const bytes = Number(out.split('\n').at(-1));
  assert.ok(Number.isFinite(bytes), `no figure from: ${out}`);
  return bytes;
}

/** One screen function's call, the account that makes it, and its budget in megabytes to one decimal. */
interface Budget { call: (f: Fixture) => string; as: (f: Fixture) => string; mb: number; }
const player = (f: Fixture) => f.player;
const admin = (f: Fixture) => f.admin;
const budget = (call: (f: Fixture) => string, as: (f: Fixture) => string, mb: number): Budget => ({ call, as, mb });

/**
 * Each screen function, one real call that answers a document. The budgets are the workflow's measurements (PR 720's sql job, 2026-11-15), each rounded up to one decimal plus 0.3 MB; a search read
 * is called with a term and no filter, since the plan it keeps does not depend on the term.
 */
export const BUDGETS: Record<string, Budget> = {
  alerts_page: budget(() => 'public.alerts_page(null)', player, 5.7),
  board_page: budget((f) => `public.board_page('${f.board}', 1, array[]::text[])`, player, 8.1),
  boot: budget(() => 'public.boot()', player, 6.4),
  drive_gifts_page: budget(() => `public.drive_gifts_page(gen_random_uuid(), now(), 'ffffffff-ffff-ffff-ffff-ffffffffffff')`, player, 3.0),
  index_page: budget(() => 'public.index_page()', player, 5.5),
  log_page: budget(() => 'public.log_page(null)', player, 15.7),
  my_characters_page: budget(() => 'public.my_characters_page()', player, 4.8),
  profile_page: budget((f) => `public.profile_page('${f.theirs}')`, player, 6.6),
  queue_page: budget(() => 'public.queue_page()', admin, 5.0),
  record_page: budget((f) => `public.record_page('${f.mine}', 'post', 1)`, player, 6.5),
  results_page: budget(() => 'public.results_page(1, 1)', player, 1.1),
  search_posts: budget(() => `public.search_posts('post', null, null, null, null, false, null, null, 5)`, player, 5.8),
  search_suggest: budget(() => `public.search_suggest('co', null, null, false, 5)`, player, 3.7),
  search_threads: budget(() => `public.search_threads('cold', null, null, null, null, false, null, null, 5)`, player, 6.2),
  season_page: budget(() => `public.season_page('rankings', null, null, 1)`, player, 3.5),
  thread_page: budget((f) => `public.thread_page('${f.thread}', 1, null, 20, array['sweetie'])`, player, 17.0),
  updates_page: budget(() => 'public.updates_page(null, null, null)', player, 2.8),
};

/** A budget is its measurement rounded up to one decimal, plus this much room (megabytes). */
const ROOM_MB = 0.3;
/** The least gap that asks for a budget to be lowered: twice the room, so a budget set by the rule is never asked to be lowered at once. */
const FLOOR_MB = 2 * ROOM_MB;

/**
 * One line for each fault: a screen function with no budget; a budget for a name that is no screen function; a measurement over its budget; a measurement under its
 * budget by more than the larger of a tenth of the budget and FLOOR_MB, so the budget is to be lowered. `budgets` and `measured` are in megabytes; a figure prints with
 * three decimals so a small excess is visible.
 */
export function budgetFaults(names: string[], budgets: Record<string, number>, measured: Record<string, number>): string[] {
  const out: string[] = [];
  for (const n of [...names].sort()) {
    if (!(n in budgets)) out.push(`${n}: it is a screen function with no budget`);
  }
  for (const n of Object.keys(budgets).sort()) {
    if (!names.includes(n)) out.push(`${n}: it has a budget and is no screen function`);
    const m = measured[n];
    if (m === undefined) continue;
    const b = budgets[n]!;
    if (m > b) out.push(`${n}: it kept ${m.toFixed(3)} MB, over its budget of ${b.toFixed(3)} MB`);
    else if (b - m > Math.max(b / 10, FLOOR_MB)) out.push(`${n}: it kept ${m.toFixed(3)} MB, far under its budget of ${b.toFixed(3)} MB; lower the budget`);
  }
  return out;
}

const mb = (bytes: number) => bytes / MB;

test('requireRecorded refuses a Postgres that is not the one the budgets were recorded on, and passes this one', () => {
  assert.throws(() => requireRecorded(16), /recorded on Postgres 17 and this is 16/);
  assert.throws(() => requireRecorded(18), /recorded on Postgres 17 and this is 18/);
  requireRecorded(17);
  requireRecorded();
});

test('every screen function keeps within its budget on a cold read, and no budget is far above it', () => {
  const f = fixture();
  const names = screenNames(sql);
  const measured: Record<string, number> = {};
  assert.deepEqual(onlineFaults(online(), f.theirs), [], 'who is online is not what the fixture pinned, before the first measurement');
  for (const n of names) {
    const b = BUDGETS[n];
    if (b) measured[n] = mb(kept(b.call(f), b.as(f)));
  }
  assert.deepEqual(onlineFaults(online(), f.theirs), [], 'who is online is not what the fixture pinned, after the last measurement');
  const table = names.map((n) => `${n}: ${n in measured ? measured[n]!.toFixed(3) : 'not measured'} MB`).join('\n');
  const budgets = Object.fromEntries(Object.entries(BUDGETS).map(([n, b]) => [n, b.mb]));
  const faults = budgetFaults(names, budgets, measured);
  assert.deepEqual(faults, [], `${faults.join('\n')}\nmeasured:\n${table}`);
  console.log(`measured (MB kept by a fresh connection after the first call):\n${table}`);
});

test('the guard names a function that reads acts_public thirty times as over thread_page\'s budget', () => {
  const f = fixture();
  const reads = Array.from({ length: 30 }, () => 'select a.id from public.acts_public a join public.acts_public b on b.id = a.id join public.acts_public c on c.id = a.id').join(' union all ');
  const create = `create function public.cold_poison_page() returns bigint language plpgsql stable set plan_cache_mode = force_generic_plan as $p$
      begin return (select count(*) from (${reads}) x); end $p$;
    grant execute on function public.cold_poison_page() to authenticated; revoke execute on function public.cold_poison_page() from public, anon;`;
  try {
    sql(create);
    const m = mb(kept('public.cold_poison_page()', f.player));
    const budget = BUDGETS.thread_page?.mb ?? 0;
    const faults = budgetFaults(['cold_poison_page'], { cold_poison_page: budget }, { cold_poison_page: m });
    assert.ok(faults.some((x) => /^cold_poison_page: it kept [\d.]+ MB, over its budget of/.test(x)), `kept ${m.toFixed(3)} MB against thread_page's ${budget.toFixed(3)} MB: ${JSON.stringify(faults)}`);
  } finally {
    sql('drop function if exists public.cold_poison_page()');
  }
});

test('onlineFaults names another mask online and the fixture\'s mask gone, and a mask an earlier file left online is seen', () => {
  assert.deepEqual(onlineFaults(['a'], 'a'), []);
  assert.deepEqual(onlineFaults(['a', 'b'], 'a'), [`b: it is online and is not the fixture's mask; the online boxes would call their helpers for it`]);
  assert.deepEqual(onlineFaults([], 'a'), [`a: the fixture's mask is not online; the online boxes would name nobody and plan no helper`]);
  assert.equal(onlineFaults(['b'], 'a').length, 2);
  /* The poison: the state an earlier file leaves when this one is reached inside the window, committed as that file commits it, and taken back in the `finally`. */
  const f = fixture();
  assert.deepEqual(onlineFaults(online(), f.theirs), []);
  try {
    sql(`insert into presence (character, place_kind, place_since, online_since, seen_at) values ('${f.mate}', 'index', now(), now(), now())`);
    assert.deepEqual(onlineFaults(online(), f.theirs), [`${f.mate}: it is online and is not the fixture's mask; the online boxes would call their helpers for it`]);
  } finally {
    sql(`delete from presence where character = '${f.mate}'`);
  }
  assert.deepEqual(onlineFaults(online(), f.theirs), []);
});

test('budgetFaults names a function with no budget, a budget with no function and a measurement far under its budget', () => {
  const faults = budgetFaults(['a_page', 'b_page', 'c_page'], { a_page: 10, c_page: 12, gone_page: 5 }, { a_page: 10, c_page: 4, gone_page: 5 });
  assert.deepEqual(faults, [
    'b_page: it is a screen function with no budget',
    'c_page: it kept 4.000 MB, far under its budget of 12.000 MB; lower the budget',
    'gone_page: it has a budget and is no screen function',
  ]);
  assert.deepEqual(budgetFaults(['a_page'], { a_page: 10 }, { a_page: 10 }), [], 'at the budget is allowed');
  assert.equal(budgetFaults(['a_page'], { a_page: 10 }, { a_page: 10.1 }).length, 1, 'over by a tenth of a megabyte is a fault');
  assert.match(budgetFaults(['a_page'], { a_page: 10 }, { a_page: 10.1234 })[0]!, /kept 10.123 MB, over its budget of 10.000 MB/, 'a fault prints three decimals');
});

test('the far-under gap is the larger of a tenth of the budget and 0.6 MB', () => {
  const far = (b: number, m: number) => budgetFaults(['a_page'], { a_page: b }, { a_page: m }).length === 1;
  // A large budget: the tenth decides (1.0 MB), not the floor.
  assert.equal(far(10, 9.2), false, 'budget 10, measured 9.2: allowed');
  assert.equal(far(10, 8.9), true, 'budget 10, measured 8.9: a fault');
  // A small budget: the floor decides (0.6 MB), not the tenth (0.25 MB).
  assert.equal(far(2.5, 2.0), false, 'budget 2.5, measured 2.0: allowed');
  assert.equal(far(2.5, 1.8), true, 'budget 2.5, measured 1.8: a fault');
  assert.equal(far(2.5, 1.95), false, 'budget 2.5, measured 1.95: inside the floor, allowed');
});
