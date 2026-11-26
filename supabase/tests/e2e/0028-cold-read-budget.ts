/**
 * The budget on a cold read (warm reads, Task 7; docs/plans/2026-11-15-warm-reads-design.md, section 6). A screen function is plpgsql with a fixed generic plan
 * (0368), so its first call on a connection plans every statement it holds and keeps the plans; that is what a pool connection holds from then on, and the figure the
 * pool's arithmetic needs (section 3). Reading `acts_public` thirty times in one function did this to thread_page (0357): nothing failed, a cold read took seconds
 * and a nano instance lived in swap. This file measures, for each screen function, the memory a fresh connection's contexts hold after that function's first call
 * (`pg_backend_memory_contexts`, summed before and after, as the harness's superuser) and holds it to a budget recorded for that function.
 *
 * What is measured is what a connection keeps, not the peak of the planning: the peak has no reading Postgres gives from inside a function. The kept figure moves with the
 * planning (the kept plan is what the planner built) and repeats from one fresh connection to the next to within a few hundredths of a megabyte.
 *
 * The catalog cache is counted by the bytes it uses, every other context by the blocks it holds (`keptBytes`; issue #968, the owner's choice, 2026-11-24).
 * CacheMemoryContext holds the relcache and syscache entries and the planner statistics that planning reads. Like any AllocSet it grows by blocks that double, up to
 * Postgres's 8 MB cap, so its next block is about as large as everything it holds already: 2 MB once it holds 2 MB. The call that first needs a byte past the
 * last block gets the whole new block. Counted by blocks, board_page's figure moved by 2 MB when about 150 kB more was used (0403, at BUDGETS). It also moved by 2 MB
 * with no SQL changed, when an analyze moved the statistics. That is a fact about the files' order and the statistics, not about a plan. The pool's arithmetic (README,
 * step 5; docs/plans/2026-11-15-warm-reads-design.md, section 3) reads what a connection allocates, and the used figure is still right for the cache, for three reasons:
 *   - There is one cache per connection, not one per page type. The bytes its last block leaves free are allocated once per connection, by whichever call first
 *     needed that block, and a connection that has served every page type holds them whatever order it served them in.
 *   - Those free bytes are mostly the unused tail of the last block, which is at most about as large as all the blocks before it and never more than 8 MB. The
 *     rest are freelist chunks, left over from earlier blocks or freed by the cache, which it takes again for requests of their size.
 *   - Charged to one function's budget, they make that function's figure depend on the order of the files and on the last analyze, not on its plan.
 * So they are a cost of the connection, about one block at most, and not a cost of any screen function. The kept plans are still counted by the blocks they hold:
 * every other context, including the CachedPlan and CachedPlanSource contexts that hang under CacheMemoryContext. The budget exists to catch them, and a plan that
 * grows by a block grows the connection by that block.
 *   1. Every screen function has a budget and every budget names a screen function. The names are the rule screen-functions.ts holds (`screenNames`), which the screen
 *      functions' guard (0016-screen-reads.ts) reads too, not a copy.
 *   2. A function over its budget fails, naming the figures. A budget far above what is measured guards nothing, so a measurement under its budget by more than the larger
 *      of a tenth of the budget and 0.6 MB fails too and asks for the budget to be lowered.
 *   3. Postgres 17 only: the figures differ by major version, so `requireRecorded` stops the file before the fixture and before every measurement on another, and every
 *      test that measures fails on that one message.
 * A megabyte is 1,048,576 bytes. A budget is its measurement in the workflow (the sql job, on its Postgres 17, on the template and this file's own fixture), rounded up to one decimal,
 * plus 0.3 MB of room, so ordinary run-to-run movement never fails
 * a build and the far-under gap (twice the room) never asks a freshly set budget to be lowered.
 *
 * Seeing the figures: a passing end-to-end file's output is discarded by tools/test-sql.mjs, so a green suite hides the table. To print it for this file, on a scratch database
 * the suite made or any local one with the migrations and fixtures replayed (the table is also in a failure's message):
 *   KAYFABB_SCRATCH_URL=postgres://postgres:pg@localhost:5432/<scratch> node --experimental-strip-types --no-warnings --test supabase/tests/e2e/0028-cold-read-budget.ts
 * The budgets are the workflow's: its Postgres 17 is the one they must hold on. If a developer's 17 differs from the workflow's and a line fails, read its measured figure and
 * compare it with the budget; a difference inside the room is the minor version, not a regression, and a budget is changed only to what the workflow's own run measured.
 * A Postgres 17.11 on Windows, on a database holding only the migrations and fixtures, measured up to 0.75 MB under the workflow (boot 5.28 against 6.02, both counted by blocks, before #968), so there the
 * far-under line can fire on a healthy build: that is the machine, and no budget is lowered for it.
 *
 * `budgetFaults` is that judgment, pure, and each poison below is the defect it exists to catch: a function that reads `acts_public` thirty times over (thirty branches, each
 * joining it to itself three times, since a bare thirty reads of its id alone keep only about half of thread_page's figure, and twice kept 14.144 MB once 0434 made the view's plan smaller, under thread_page's budget), committed in the scratch database (each measurement is
 * a connection of its own, so a rolled-back transaction would not be seen) and dropped in a `finally`, is measured against thread_page's budget and must be named as over; a
 * screen function with no budget, a budget with no function and a measurement far under its budget are each named, with cases that tell the larger of the tenth and the floor
 * from the smaller.
 *
 * The fixture (two accounts, three characters, a staff persona, a board of its own with a thread of twenty posts with five card plays and one post by the persona, an admin) is committed once so
 * each call answers a document and not a refusal. A call reads the fixture's own rows (its board, thread, characters and accounts), or something no file changes (season 1 and
 * the open season, which fixtures.sql makes, and ids or terms that match nothing), or the instance as the template holds it (index_page's boards, the queue,
 * a season's rankings, a search, the updates): the same rows in every run of the suite, since every end-to-end file runs on a clone of its own (tools/test-sql.mjs), which is why a
 * budget is the workflow's figure on that state: the template and this file's own fixture, and nothing an earlier file left. A run of this file alone on a clone measures the same state.
 * None names 'general', which an earlier file merged away when the files shared one database; no file does now.
 * It is committed to this file's own clone, which is dropped after it: no later file sees it. It would otherwise find every mask a file left online a day stale (below).
 * `drive_gifts_page` and `results_page` answer empty documents (no drive, no finished season in the fixture), so a helper those
 * pages call only for each row is not planned by these calls and its plan is not in their figures.
 *
 * Who is online is pinned, because it is what decides, by the clock, whether a helper is planned. The online box (`presence_box`, which index_page, board_page and
 * thread_page each call) names every mask seen inside the presence window (five minutes) and calls `banned_until` and `group_now` once for each name. A first call plans
 * only what it runs, so for index_page and board_page neither helper is planned with nobody online and both are with one mask online (thread_page plans them for its
 * posters whoever is online), and `ban_ends` and what it calls are planned only where that mask has a ban. When the files shared one database, an earlier file's
 * presence rows decided it by the clock: index_page measured 5.2 MB in one run and 5.960 MB in another of the same commit, by how long the files between took (the sql job,
 * 2026-11-15). Each file now runs on a clone of its own, which holds only the template's rows, but the pin stays: it is what makes the figure the plan's and not the
 * clock's. A board's and a thread's box also read every staff persona's posts inside the window, anywhere on the instance, to name those on that board or in that
 * thread, and reading them runs `conceal_layer` on each: 0.06 MB of board_page's figure.
 *
 * So the fixture makes one of its own masks the one mask online, browsing its own thread, and has its own persona post in that thread, as an instance with anyone on
 * it stands; and it sets every other presence row's `seen_at` a day back, so a presence row the template ever comes to hold cannot move the figure. The fixture's
 * persona is always there, so `conceal_layer` is always planned. The fixture's mask has no ban (one is
 * written only through `infract`, which needs an instance's settings a database holding only the fixtures does not have), so `ban_ends` is outside index_page's and
 * board_page's figures as a row's helper is outside drive_gifts_page's. `onlineFaults` holds the pin before the first measurement and after the last: a mask online
 * that is not the fixture's, or the fixture's mask or persona gone from the window (a machine that took five minutes over this file), fails by that name and not as a
 * budget.
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
interface Fixture { board: string; player: string; other: string; admin: string; mine: string; mate: string; theirs: string; persona: string; thread: string; post: string; }

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
      mod uuid;
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
      -- Who is online, pinned (the header): every presence row an earlier file left is set a day back, one of the fixture's masks browses the fixture's thread, and the
      -- fixture's own persona has just posted in it (a staff character acts only through write_staff_act).
      update presence set seen_at = now() - interval '1 day';
      insert into presence (character, place_kind, place, board, place_since, online_since, seen_at) values (c3, 'thread', t, bd, now(), now(), now());
      insert into characters (name, staff, staff_kind, debuted_at) values ('Cold ${tag} Mod', 'cold-${tag}', 'persona', now() - interval '60 days') returning id into mod;
      perform write_staff_act('cold-${tag}', 'post', t, null, '{"body": "Cold post by the persona."}');
      perform set_config('cold.ids', jsonb_build_object('board', 'cold-${tag}', 'player', pl, 'other', ot, 'admin', ad, 'mine', c1, 'mate', c2, 'theirs', c3, 'persona', mod, 'thread', t, 'post', first_post)::text, false);
    end $fx$;
    select current_setting('cold.ids');`);
  return JSON.parse(out) as Fixture;
}
let made: Fixture | undefined;
const fixture = (): Fixture => (made ??= makeFixture());

/** What `online` answers: ids, in order. */
export interface Online { masks: string[]; staff: string[]; }
/** Who the online boxes would name now: every character with a presence row inside the presence window (hidden ones too, so none is waved through), and every staff persona listed for a post inside it. */
export function online(): Online {
  const list = (q: string): string[] => { const out = sql(q); return out === '' ? [] : out.split(/\r?\n/); };
  return {
    masks: list(`select p.character from presence p where p.seen_at >= now() - span_interval(setting('presenceWindow')) order by 1`),
    staff: list(`select distinct l.id from presence_listed l where l.staff and l.seen_at >= now() - span_interval(setting('presenceWindow')) order by 1`),
  };
}

/**
 * One line for each way who is online is not what the fixture pinned: a mask online that is not the fixture's `mask`, `mask` not online, and the fixture's `persona`
 * not listed. Each moves which helpers a first call plans, so a figure measured then is not the one its budget was recorded for. Another persona listed beside the
 * fixture's is no fault: its post cannot be dated back, and the fixture's has the boxes read a staff post either way. (A post that quotes a hidden version would have `conceal_layer` plan more than the
 * fixture's does, for as long as it is in the window; no earlier file's Mod posts one.)
 */
export function onlineFaults(seen: Online, own: { mask: string; persona: string }): string[] {
  const out = seen.masks.filter((c) => c !== own.mask).map((c) => `${c}: it is online and is not the fixture's mask; the online boxes would call their helpers for it`);
  if (!seen.masks.includes(own.mask)) out.push(`${own.mask}: the fixture's mask is not online; the online boxes would name nobody and plan no helper`);
  if (!seen.staff.includes(own.persona)) out.push(`${own.persona}: the fixture's persona is not listed for a post inside the window; a board's box would read no staff post`);
  return out;
}

/**
 * What a connection's memory contexts hold at one moment: `cacheTotal` and `cacheFree` are CacheMemoryContext's own bytes (its blocks, and what they leave free),
 * `others` every other context's blocks (CacheMemoryContext's children too: a kept plan's CachedPlan and CachedPlanSource contexts are among them), and `caches`
 * how many contexts were named CacheMemoryContext, which is one on every Postgres this reads.
 */
export interface Held { others: number; cacheTotal: number; cacheFree: number; caches: number; }
/** The SQL that answers a `Held` as one line of JSON. `pg_backend_memory_contexts` gives each context's own bytes, never its children's. */
const HELD = `select json_build_object(
    'others', coalesce(sum(total_bytes) filter (where name <> 'CacheMemoryContext'), 0),
    'cacheTotal', coalesce(sum(total_bytes) filter (where name = 'CacheMemoryContext'), 0),
    'cacheFree', coalesce(sum(free_bytes) filter (where name = 'CacheMemoryContext'), 0),
    'caches', count(*) filter (where name = 'CacheMemoryContext'))
  from pg_backend_memory_contexts;`;

/**
 * What a call kept, in bytes, from what the connection held before it and after it: every context but the catalog cache by the blocks it holds, the catalog cache by
 * the bytes it uses (the header says why). A reading with no CacheMemoryContext, or more than one, throws: the cache would be counted as nothing, or twice.
 */
export function keptBytes(before: Held, after: Held): number {
  for (const [when, h] of [['before', before], ['after', after]] as const) {
    assert.equal(h.caches, 1, `${when} the call the connection had ${h.caches} contexts named CacheMemoryContext, not one; the catalog cache would not be counted once`);
  }
  return (after.others - before.others) + ((after.cacheTotal - after.cacheFree) - (before.cacheTotal - before.cacheFree));
}

/**
 * The two `Held` readings in a cold read's output: its first line and its last, each a line of JSON with every field a number. Anything else throws, naming the output,
 * so a reading psql did not print is never measured as nothing.
 */
export function heldPair(out: string): [Held, Held] {
  const lines = out.split(/\r?\n/);
  const read = (line: string | undefined): Held => {
    let h: Partial<Record<keyof Held, unknown>> | undefined;
    try { h = JSON.parse(line ?? '') as typeof h; } catch { h = undefined; }
    const ok = typeof h === 'object' && h !== null && (['others', 'cacheTotal', 'cacheFree', 'caches'] as const).every((k) => typeof h![k] === 'number');
    assert.ok(ok && lines.length >= 2, `no reading of the memory contexts in: ${out}`);
    return h as Held;
  };
  return [read(lines[0]), read(lines.at(-1))];
}

/**
 * One cold read: one `sql()` call, so one fresh connection. It reads what the connection's contexts hold as the harness's superuser (the view needs it), then in one
 * transaction becomes the fixture's account, makes the call once and unbecomes, then reads again. Answers what the call kept (`keptBytes`). `call` is a SQL expression
 * and `as` the account that makes it.
 */
export function kept(call: string, as: string): number {
  requireRecorded();
  const out = sql(`
    ${HELD}
    begin;
    do $cold$ begin perform tests.become('${as}'); perform ${call}; perform tests.unbecome(); end $cold$;
    commit;
    ${HELD}`);
  return keptBytes(...heldPair(out));
}

/**
 * What a cold read keeps, by memory context: the same call as `kept`, then the connection's largest contexts, one line each (its name, the start of its ident, which
 * for a cached plan is its query, and its kilobytes, with CacheMemoryContext's used kilobytes beside its blocks), then the tables with the largest column statistics. A
 * function over its budget names these in the failure, so the message says whether a plan grew or the catalog cache did: planning reads each planned table's
 * statistics into CacheMemoryContext, so the rows the files before this one committed move the figure with no change to any plan.
 */
export function contexts(call: string, as: string, most = 12): string {
  requireRecorded();
  return sql(`
    begin;
    do $cold$ begin perform tests.become('${as}'); perform ${call}; perform tests.unbecome(); end $cold$;
    commit;
    select name || coalesce(': ' || left(regexp_replace(ident, '\\s+', ' ', 'g'), 140), '') || ' (' || round(total_bytes / 1024.0) || ' kB'
      || case when name = 'CacheMemoryContext' then ', ' || round(used_bytes / 1024.0) || ' kB used, the figure counted' else '' end || ')'
    from pg_backend_memory_contexts order by total_bytes desc limit ${most};
    select 'statistics of ' || starelid::regclass || ': ' || round(sum(pg_column_size(s.*)) / 1024.0) || ' kB, ' || c.reltuples::bigint || ' rows'
    from pg_statistic s join pg_class c on c.oid = s.starelid where c.relnamespace = 'public'::regnamespace group by starelid, c.reltuples order by sum(pg_column_size(s.*)) desc limit ${most};`);
}

/** One screen function's call, the account that makes it, and its budget in megabytes to one decimal. */
interface Budget { call: (f: Fixture) => string; as: (f: Fixture) => string; mb: number; }
const player = (f: Fixture) => f.player;
const admin = (f: Fixture) => f.admin;
const budget = (call: (f: Fixture) => string, as: (f: Fixture) => string, mb: number): Budget => ({ call, as, mb });

/**
 * Each screen function, one real call that answers a document; a search read is called with a term and no filter, since the plan it keeps does not depend on the term.
 * The budgets were re-recorded for #587, when every file began to run on a clone of its own: the figures are the template's and this file's fixture's, and no longer
 * what the files before this one left. They come from the workflow's sql job on Postgres 17, run 45678827582 on e8bf5dc, the first run on clones, and each is rounded
 * up to one decimal plus 0.3 MB. Seven fell by more than the far-under gap: board_page from a budget of 10.4 to a measured 9.167 MB, boot 7.3 to 6.053, index_page
 * 7.4 to 5.984, my_characters_page 4.3 to 3.235, profile_page 6.5 to 5.452, queue_page 4.9 to 3.785 and record_page 6.4 to 5.385, the state measured being the
 * template's and not what other files committed. The others moved by less, and every budget follows the rule from this one run.
 * Lowered for 0434_reads_bounded_on_any_plan.sql, whose acts_public no longer hashes the live veils once for each statement: index_page from 6.3 to 5.9 (5.590 MB) and thread_page
 * from 19.2 to 15.1 (14.717 MB), by the rule, from the workflow's sql job on Postgres 17 on 930fd9e.
 * Before, for #968 (run 45475266814 on c1d072b), the catalog cache began to be counted by what it uses: a function whose call took the cache past a block fell by
 * 1.5 to 2 MB. Counted by blocks, board_page had moved by 2 MB twice, once for a change (0403_departed_personas.sql's two indexes) and once for no change at all,
 * by whether an analyze had run; both were one new block of CacheMemoryContext, which this count no longer reads.
 */
export const BUDGETS: Record<string, Budget> = {
  alerts_page: budget(() => 'public.alerts_page(null)', player, 5.4),
  board_page: budget((f) => `public.board_page('${f.board}', 1, array[]::text[])`, player, 9.5),
  boot: budget(() => 'public.boot()', player, 6.4),
  drive_gifts_page: budget(() => `public.drive_gifts_page(gen_random_uuid(), now(), 'ffffffff-ffff-ffff-ffff-ffffffffffff')`, player, 2.3),
  index_page: budget(() => 'public.index_page()', player, 5.9),
  log_page: budget(() => 'public.log_page(null)', player, 13.7),
  my_characters_page: budget(() => 'public.my_characters_page()', player, 3.6),
  profile_page: budget((f) => `public.profile_page('${f.theirs}')`, player, 5.8),
  queue_page: budget(() => 'public.queue_page()', admin, 4.1),
  record_page: budget((f) => `public.record_page('${f.mine}', 'post', 1)`, player, 5.7),
  results_page: budget(() => 'public.results_page(1, 1)', player, 0.7),
  search_posts: budget(() => `public.search_posts('post', null, null, null, null, false, null, null, 5)`, player, 5.6),
  search_suggest: budget(() => `public.search_suggest('co', null, null, false, 5)`, player, 3.0),
  search_threads: budget(() => `public.search_threads('cold', null, null, null, null, false, null, null, 5)`, player, 6.1),
  season_page: budget(() => `public.season_page('rankings', null, null, 1)`, player, 2.7),
  thread_page: budget((f) => `public.thread_page('${f.thread}', 1, null, 20, array['sweetie'])`, player, 15.1),
  updates_page: budget(() => 'public.updates_page(null, null, null)', player, 2.1),
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
  const own = { mask: f.theirs, persona: f.persona };
  assert.deepEqual(onlineFaults(online(), own), [], 'who is online is not what the fixture pinned, before the first measurement');
  for (const n of names) {
    const b = BUDGETS[n];
    if (b) measured[n] = mb(kept(b.call(f), b.as(f)));
  }
  assert.deepEqual(onlineFaults(online(), own), [], 'who is online is not what the fixture pinned, after the last measurement');
  const table = names.map((n) => `${n}: ${n in measured ? measured[n]!.toFixed(3) : 'not measured'} MB`).join('\n');
  const budgets = Object.fromEntries(Object.entries(BUDGETS).map(([n, b]) => [n, b.mb]));
  const faults = budgetFaults(names, budgets, measured);
  const over = names.filter((n) => n in measured && measured[n]! > budgets[n]!);
  const where = over.map((n) => `\n${n}, its largest contexts on a cold read:\n${contexts(BUDGETS[n]!.call(f), BUDGETS[n]!.as(f))}`).join('');
  assert.deepEqual(faults, [], `${faults.join('\n')}\nmeasured:\n${table}${where}`);
  console.log(`measured (MB kept by a fresh connection after the first call):\n${table}`);
});

test('the guard names a function that reads acts_public thirty times as over thread_page\'s budget', () => {
  const f = fixture();
  const reads = Array.from({ length: 30 }, () => 'select a.id from public.acts_public a join public.acts_public b on b.id = a.id join public.acts_public c on c.id = a.id join public.acts_public d on d.id = a.id').join(' union all ');
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

test('onlineFaults names another mask online, the fixture\'s mask gone and its persona gone, and sees each in the database', () => {
  const own = { mask: 'a', persona: 'm' };
  const other = `b: it is online and is not the fixture's mask; the online boxes would call their helpers for it`;
  const gone = `a: the fixture's mask is not online; the online boxes would name nobody and plan no helper`;
  const unlisted = `m: the fixture's persona is not listed for a post inside the window; a board's box would read no staff post`;
  assert.deepEqual(onlineFaults({ masks: ['a'], staff: ['m'] }, own), []);
  assert.deepEqual(onlineFaults({ masks: ['a'], staff: ['m', 'n'] }, own), [], 'another persona listed beside the fixture\'s is no fault');
  assert.deepEqual(onlineFaults({ masks: ['a', 'b'], staff: ['m'] }, own), [other]);
  assert.deepEqual(onlineFaults({ masks: [], staff: ['m'] }, own), [gone]);
  assert.deepEqual(onlineFaults({ masks: ['a'], staff: ['n'] }, own), [unlisted]);
  assert.deepEqual(onlineFaults({ masks: ['b'], staff: [] }, own), [other, gone, unlisted]);
  /* The poisons, each committed as an earlier file or a slow machine would leave it and taken back in its `finally`. */
  const f = fixture(), mine = { mask: f.theirs, persona: f.persona };
  const named = (what: string) => onlineFaults(online(), mine).map((x) => x.replace(/:.*$/u, `: ${what}`));
  assert.deepEqual(onlineFaults(online(), mine), []);
  /* An earlier file's mask, reached inside the window. */
  try {
    sql(`insert into presence (character, place_kind, place_since, online_since, seen_at) values ('${f.mate}', 'index', now(), now(), now())`);
    assert.deepEqual(onlineFaults(online(), mine), [`${f.mate}: it is online and is not the fixture's mask; the online boxes would call their helpers for it`]);
  } finally {
    sql(`delete from presence where character = '${f.mate}'`);
  }
  /* The fixture's mask, out of the window. */
  try {
    sql(`update presence set seen_at = now() - interval '1 day' where character = '${f.theirs}'`);
    assert.deepEqual(named('gone'), [`${f.theirs}: gone`]);
    assert.match(onlineFaults(online(), mine)[0]!, /the fixture's mask is not online/u);
  } finally {
    sql(`update presence set seen_at = now() where character = '${f.theirs}'`);
  }
  /* The fixture's persona, no longer listed: a retired persona is in no box, as one whose post has left the window is in none. */
  try {
    sql(`update characters set retired_at = now() where id = '${f.persona}'`);
    assert.deepEqual(named('unlisted'), [`${f.persona}: unlisted`]);
    assert.match(onlineFaults(online(), mine)[0]!, /the fixture's persona is not listed/u);
  } finally {
    sql(`update characters set retired_at = null where id = '${f.persona}'`);
  }
  assert.deepEqual(onlineFaults(online(), mine), []);
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

test('keptBytes counts the catalog cache by what it uses, so a new cache block alone moves a figure only by what the block holds', () => {
  const kB = 1024;
  // The figures #968 measured for board_page: a fresh database's cache holds 2227 kB with 2188 kB used; after the files before this one it holds 4284 kB with 2340
  // kB used. The new 2 MB block is the whole difference in blocks, and 152 kB is the difference in use. The plans (`others`) are the same.
  const before: Held = { others: 7 * MB, cacheTotal: 2227 * kB, cacheFree: (2227 - 2188) * kB, caches: 1 };
  const step: Held = { others: 7 * MB, cacheTotal: 4284 * kB, cacheFree: (4284 - 2340) * kB, caches: 1 };
  assert.equal(keptBytes(before, step), (2340 - 2188) * kB, 'a cache block step counts only the bytes the cache now uses');
  assert.deepEqual(budgetFaults(['a_page'], { a_page: 7.5 }, { a_page: mb(7 * MB + keptBytes(before, step)) }), [], 'a step alone does not take a function over its budget');
});

test('keptBytes counts every other context by its blocks, so a plan that grows is over its budget', () => {
  const kB = 1024;
  const before: Held = { others: 7 * MB, cacheTotal: 2227 * kB, cacheFree: 92 * kB, caches: 1 };
  // A plan 1 MB larger: one more megabyte of CachedPlan blocks (they hang under CacheMemoryContext but are contexts of their own), and the cache unchanged.
  const grown: Held = { ...before, others: 8 * MB };
  assert.equal(keptBytes(before, grown), MB);
  assert.equal(budgetFaults(['a_page'], { a_page: 7.5 }, { a_page: mb(7 * MB + keptBytes(before, grown)) }).length, 1, 'a plan 1 MB larger is over');
});

test('keptBytes refuses a reading with no catalog cache, or more than one', () => {
  const h: Held = { others: MB, cacheTotal: MB, cacheFree: 0, caches: 1 };
  assert.throws(() => keptBytes({ ...h, caches: 0 }, h), /before the call the connection had 0 contexts named CacheMemoryContext/);
  assert.throws(() => keptBytes(h, { ...h, caches: 2 }), /after the call the connection had 2 contexts named CacheMemoryContext/);
});

test('heldPair reads the first and last lines of a cold read, and refuses an output that is not two readings', () => {
  const h = { others: 1, cacheTotal: 2, cacheFree: 1, caches: 1 };
  const line = JSON.stringify(h);
  assert.deepEqual(heldPair(`${line}\n${JSON.stringify({ ...h, others: 5 })}`), [h, { ...h, others: 5 }]);
  assert.throws(() => heldPair(line), /no reading of the memory contexts/, 'one reading is not two');
  assert.throws(() => heldPair(`${line}\nnull`), /no reading of the memory contexts/, 'a last line of JSON that is no object');
  assert.throws(() => heldPair(`${line}\nCOMMIT`), /no reading of the memory contexts/, 'a last line that is not a reading');
  assert.throws(() => heldPair(`${line}\n${JSON.stringify({ ...h, others: '5' })}`), /no reading of the memory contexts/, 'a field that is not a number');
});
