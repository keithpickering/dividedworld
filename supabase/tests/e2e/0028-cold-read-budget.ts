/**
 * The budget on a cold read (warm reads, Task 7; docs/plans/2026-11-15-warm-reads-design.md, section 6). A screen function is plpgsql with a fixed generic plan
 * (0368), so its first call on a connection plans every statement it holds and keeps the plans; that is what a pool connection holds from then on, and the figure the
 * pool's arithmetic needs (section 3). Reading `acts_public` thirty times in one function did this to thread_page (0357): nothing failed, a cold read took seconds
 * and a nano instance lived in swap. This file measures, for each screen function, the memory a fresh connection's contexts hold after that function's first call
 * (`pg_backend_memory_contexts`, summed before and after, as the harness's superuser) and holds it to a budget recorded for that function.
 *
 * What is measured is what a connection keeps, not the peak of the planning: the peak has no reading Postgres gives from inside a function. The kept figure moves with the
 * planning (the kept plan is what the planner built) and was identical to the tenth of a megabyte from one fresh connection to the next.
 *   1. Every screen function has a budget and every budget names a screen function. The names are the rule 0016-screen-reads.ts holds (`screenNames`), not a copy.
 *   2. A function over its budget fails, naming the figures. A budget far above what is measured guards nothing, so a measurement more than a tenth under its budget
 *      fails too and asks for the budget to be lowered. "A tenth" is a tenth of the budget, and at least the half megabyte a budget is rounded up by, so a small
 *      function whose figure was rounded up is not asked to be lowered at once.
 *   3. Postgres 17 only: the figures differ by major version, so on another the file fails before measuring, saying where they were recorded.
 * A megabyte is 1,048,576 bytes. Each budget is the measurement on Postgres 17.11 rounded up to the next half megabyte. If CI's 17 and a developer's differ by
 * more than the tenth, the budgets are the workflow's: read the failing line's measured figure, and change a budget only to what the workflow's own run measured.
 *
 * `budgetFaults` is that judgment, pure, and each poison below is the defect it exists to catch: a function that reads `acts_public` thirty times over (thirty branches, each joining it to itself twice, since a bare thirty reads of its id alone keep only about half of thread_page's figure), committed in the
 * scratch database (each measurement is a connection of its own, so a rolled-back transaction would not be seen) and dropped in a `finally`, is measured against
 * thread_page's budget and must be named as over; a screen function with no budget, a budget with no function and a measurement far under its budget are each named.
 * The scratch database holds a fixture this file commits once (two accounts, three characters, a thread of twenty posts with five card plays, an admin) so each call
 * answers a document and not a refusal. Reads only the scratch database tools/test-sql.mjs made (scratchUrl refuses any other); run by tools/test-sql.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './psql-db.ts';
import { screenNames } from './0016-screen-reads.ts';

const MB = 1024 * 1024;
/** The major version the budgets were recorded on. */
const RECORDED_ON = 17;

/** The ids the fixture made. */
interface Fixture { player: string; other: string; admin: string; mine: string; mate: string; theirs: string; thread: string; post: string; }

/** Makes the fixture once, committed (every measurement is a fresh connection, so it reads only what is committed), and answers its ids. */
function makeFixture(): Fixture {
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
      t uuid := tests.thread('Cold ${tag} thread');
      p uuid;
      first_post uuid;
      i integer;
    begin
      insert into admins (account) values (ad);
      for i in 1 .. 20 loop
        p := tests.post((array[c1, c2, c3])[1 + i % 3], t, 'Cold post ' || i, now() - interval '1 hour' + i * interval '1 minute');
        if i = 1 then first_post := p; end if;
        if i <= 5 then perform tests.act((array[c2, c3, c1])[1 + i % 3], 'card', t, jsonb_build_object('card', 'sweetie'), p); end if;
      end loop;
      perform set_config('cold.ids', jsonb_build_object('player', pl, 'other', ot, 'admin', ad, 'mine', c1, 'mate', c2, 'theirs', c3, 'thread', t, 'post', first_post)::text, false);
    end $fx$;
    select current_setting('cold.ids');`);
  return JSON.parse(out) as Fixture;
}
let made: Fixture | undefined;
const fixture = (): Fixture => (made ??= makeFixture());

/**
 * One cold read: one `sql()` call, so one fresh connection. It reads what the connection's contexts hold as the harness's superuser (the view needs it), then in one
 * transaction becomes the fixture's account, makes the call once and unbecomes, then reads again. Answers the difference, in bytes. `call` is a SQL expression and
 * `as` the account that makes it.
 */
export function kept(call: string, as: string): number {
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
 * Each screen function, one real call that answers a document. The budgets are Postgres 17.11's measurements, each rounded up to the next half megabyte; a search read
 * is called with a term and no filter, since the plan it keeps does not depend on the term.
 */
export const BUDGETS: Record<string, Budget> = {
  alerts_page: budget(() => 'public.alerts_page(null)', player, 5.5),
  board_page: budget(() => `public.board_page('general', 1, array[]::text[])`, player, 8.0),
  boot: budget(() => 'public.boot()', player, 5.5),
  drive_gifts_page: budget(() => `public.drive_gifts_page(gen_random_uuid(), now(), 'ffffffff-ffff-ffff-ffff-ffffffffffff')`, player, 3.0),
  index_page: budget(() => 'public.index_page()', player, 5.5),
  log_page: budget(() => 'public.log_page(null)', player, 15.0),
  my_characters_page: budget(() => 'public.my_characters_page()', player, 4.0),
  profile_page: budget((f) => `public.profile_page('${f.theirs}')`, player, 6.0),
  queue_page: budget(() => 'public.queue_page()', admin, 4.5),
  record_page: budget((f) => `public.record_page('${f.mine}', 'post', 1)`, player, 6.0),
  results_page: budget(() => 'public.results_page(1, 1)', player, 1.0),
  search_posts: budget(() => `public.search_posts('post', null, null, null, null, false, null, null, 5)`, player, 5.5),
  search_suggest: budget(() => `public.search_suggest('co', null, null, false, 5)`, player, 3.5),
  search_threads: budget(() => `public.search_threads('cold', null, null, null, null, false, null, null, 5)`, player, 6.0),
  season_page: budget(() => `public.season_page('rankings', null, null, 1)`, player, 3.5),
  thread_page: budget((f) => `public.thread_page('${f.thread}', 1, null, 20, array['sweetie'])`, player, 16.5),
  updates_page: budget(() => 'public.updates_page(null, null, null)', player, 2.5),
};

/**
 * One line for each fault: a screen function with no budget; a budget for a name that is no screen function; a measurement over its budget; a measurement more than a
 * tenth of its budget under it (and at least the half megabyte a budget is rounded up by), so the budget is to be lowered. `budgets` and `measured` are in megabytes.
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
    if (m > b) out.push(`${n}: it kept ${m.toFixed(1)} MB, over its budget of ${b.toFixed(1)} MB`);
    else if (b - m > Math.max(b / 10, 0.5)) out.push(`${n}: it kept ${m.toFixed(1)} MB, far under its budget of ${b.toFixed(1)} MB; lower the budget`);
  }
  return out;
}

const mb = (bytes: number) => bytes / MB;

test('the budgets were recorded on this Postgres major version', () => {
  const major = Math.floor(Number(sql('show server_version_num')) / 10000);
  assert.equal(major, RECORDED_ON, `the budgets in this file were recorded on Postgres ${RECORDED_ON} and this is ${major}; the figures differ by major version`);
});

test('every screen function keeps within its budget on a cold read, and no budget is far above it', () => {
  const f = fixture();
  const names = screenNames(sql);
  const measured: Record<string, number> = {};
  for (const n of names) {
    const b = BUDGETS[n];
    if (b) measured[n] = mb(kept(b.call(f), b.as(f)));
  }
  const table = names.map((n) => `${n}: ${n in measured ? measured[n]!.toFixed(1) : 'not measured'} MB`).join('\n');
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
  sql(create);
  try {
    const m = mb(kept('public.cold_poison_page()', f.player));
    const budget = BUDGETS.thread_page?.mb ?? 0;
    const faults = budgetFaults(['cold_poison_page'], { cold_poison_page: budget }, { cold_poison_page: m });
    assert.ok(faults.some((x) => /^cold_poison_page: it kept [\d.]+ MB, over its budget of/.test(x)), `kept ${m.toFixed(1)} MB against thread_page's ${budget.toFixed(1)} MB: ${JSON.stringify(faults)}`);
  } finally {
    sql('drop function if exists public.cold_poison_page()');
  }
});

test('budgetFaults names a function with no budget, a budget with no function and a measurement far under its budget', () => {
  const faults = budgetFaults(['a_page', 'b_page', 'c_page'], { a_page: 10, c_page: 12, gone_page: 5 }, { a_page: 10, c_page: 4, gone_page: 5 });
  assert.deepEqual(faults, [
    'b_page: it is a screen function with no budget',
    'c_page: it kept 4.0 MB, far under its budget of 12.0 MB; lower the budget',
    'gone_page: it has a budget and is no screen function',
  ]);
  assert.deepEqual(budgetFaults(['a_page'], { a_page: 10 }, { a_page: 9.5 }), [], 'a tenth under is allowed');
  assert.deepEqual(budgetFaults(['a_page'], { a_page: 10 }, { a_page: 10 }), [], 'at the budget is allowed');
  assert.equal(budgetFaults(['a_page'], { a_page: 10 }, { a_page: 10.1 }).length, 1, 'over by a tenth of a megabyte is a fault');
});

