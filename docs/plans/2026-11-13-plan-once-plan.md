# Client reads plan once: plan

Record, written 2026-11-13. Carries out `docs/plans/2026-11-13-plan-once-design.md` (its sections are cited as §N),
task by task.

Every task is test first: the test named, its red run recorded, then the code, then the green run. One migration is
added (Task 3), tested on Postgres on localhost; no task touches a deployed database or service. All of it is engine;
no instance content is involved and no interface changes. No state a player, a character or a post can be put in is
added, and no response, payload, Realtime event or timing is computed from a private fact (§6). Two checks are added,
each with its poison: the coverage guard (Task 1) and the plan-once check (Task 2).

Numbers: the migration is `0366` and the SQL test `0318`, the next free on main when this was written; if main has
taken them by the time the PR merges, take main's next numbers, as earlier PRs have.

This plan waits on `docs/plans/2026-11-14-cursor-bounds-plan.md`, which rewrites the cursor catch-alls a generic plan
cannot seek on and takes `0366` and `0318` first.

The order: 1, then 2, then 3, then 4.

## Task 1. Every client read is called somewhere in the suite (the guard, §5)

Model: sonnet

**Files:** `tools/test-sql.mjs` (`main`, and a new exported pure function), a new `tools/test-sql-coverage.mjs`,
`tools/build.mjs` (`STEPS`), and whichever `supabase/tests/NNNN-*.sql` files gain a call (below).

**What:**
- `tools/test-sql.mjs` imports `ALLOWED_RPCS` from `tools/check-web-reads.mjs` (the one list; no copy). With the
  bounds, it sets `track_functions` to `'all'` on the scratch database (`alter database … set`), so every connection to
  it counts function calls.
- After the end-to-end files, it opens one more psql to the scratch database and reads, for each name in
  `ALLOWED_RPCS` that is a stable function in `public`, the calls `pg_stat_user_functions` holds (summed over
  overloads). Every connection before it has ended, so their counts are flushed; call `pg_stat_force_next_flush()`
  first anyway. A name with no calls fails the step `coverage`, naming every such function and saying that a client
  read no test calls is one whose broken reference nothing would find.
- The comparison is an exported pure function, `uncalledReads(stableNames, callRows)` → the names with no calls, sorted.
  The step reports the suite failed if it returns any.
- `tools/test-sql-coverage.mjs` (in the build, beside `tools/test-sql-refusal.mjs`, in `STEPS` right after it): drives
  `uncalledReads` red on a planted name with no row and on a row with zero calls, and green on a full set; and asserts
  that `tools/test-sql.mjs`'s text sets `track_functions` and runs the coverage step after the end-to-end loop.
- **Red run first:** `npm run test:sql` with the step in place. Record the names it reports. For each, add one call to
  the assertion file that already tests that function (or, where none does, to the file that tests its screen), as a
  signed-in reader through `tests.become`, asserting one thing the function answers. Then the green run.

**Poison:** `uncalledReads(['thread_page', 'planted_read'], [{ name: 'thread_page', calls: 3 }])` must answer
`['planted_read']`; with `{ name: 'planted_read', calls: 0 }` added, the same.

## Task 2. The plan-once check (§3, §4)

Model: sonnet

**Files:** `tools/test-sql.mjs` (`main`), a new `supabase/tests/0318-client-reads-plan-once.sql`.

**What:**
- `tools/test-sql.mjs` also sets `kayfabb.client_rpcs` on the scratch database to `ALLOWED_RPCS` joined by commas,
  so an assertion file reads the list with `current_setting('kayfabb.client_rpcs')` and holds no copy.
- `0318-client-reads-plan-once.sql` defines `pg_temp.not_planned_once(names text[], exempt text[]) returns text[]`: the
  names, among those that are stable functions in `public`, that are not `plpgsql` or whose `proconfig` does not hold
  `plan_cache_mode=force_generic_plan`, less the exempt. Then:
  1. **The poison:** it creates `public.planted_client_read()` (stable, `language sql`, reading `acts_public`) and
     asserts `not_planned_once(array['planted_client_read'], '{}')` names it, and that with the name exempt it does not.
     Then it replaces the planted function with a `plpgsql` one without the setting, and asserts it is still named.
  2. **The exemptions:** a `values` list in the file of `(name, reason)`, empty today, with a comment saying an entry is
     for a helper that must stay inlinable into a caller or a policy, and that the reason says which.
  3. **The real list:** `not_planned_once(string_to_array(current_setting('kayfabb.client_rpcs'), ','), exempt)` must be
     empty, or the file raises naming every function it returned.
- **Red run first:** it fails naming the 41 `language sql` functions and the 20 `plpgsql` ones without the setting.

**Poison:** step 1 above, in the file itself; the file fails if the check does not name the planted read.

## Task 3. The migration: every stable client read in plpgsql with a fixed plan (§4, §6)

Model: sonnet

**Files:** a new `supabase/migrations/0366_client_reads_plan_once.sql`.

**What:**
- Take each function's current definition from a scratch database with every migration applied
  (`pg_get_functiondef`), never from a migration file, since a later migration may have replaced it. The 41 functions
  in `language sql`: `admin_contact`, `alerts_page`, `beat_mod_name`, `board_page`, `boot`, `conduct_accepted`,
  `drive_gifts_page`, `finished_seasons`, `index_page`, `is_admin`, `log_page`, `move_thread_names`,
  `my_account_opened`, `my_alerts`, `my_alerts_unread`, `my_apologies`, `my_bar`, `my_characters_page`,
  `my_conduct_log`, `my_open_reports`, `my_settlement_moved`, `my_wardrobe`, `pinned_threads`, `profile_page`,
  `queue_page`, `record_page`, `result_place`, `results_page`, `search_posts`, `search_suggest`, `search_threads`,
  `season_news`, `season_page`, `staff_career`, `standings_page`, `surface_acts`, `thread_page`, `trophies_of`,
  `updates`, `updates_page`, `whoami`. The `plpgsql` ones that gain only the setting are the rest of Task 2's red run
  (`alter function … set plan_cache_mode = force_generic_plan`).
- Each `language sql` one is written again with `create or replace function`, same name, arguments and their names,
  return type, volatility, `security definer` or invoker, `set search_path`, plus `set plan_cache_mode =
  force_generic_plan`, as `language plpgsql`, whose body opens with `#variable_conflict use_column`. A `begin atomic`
  body's statements before its last become `perform` (a statement that only refuses, such as thread_page's first);
  its last becomes `return (…);`, or `return query …;` for a set-returning function. A parameter qualified by the
  function's name (`thread_page.per_page`) stays as it is; `plpgsql` reads that the same way.
- Grants and revokes are kept by `create or replace`; the migration restates none, and adds nothing to them. A header
  comment says why (§1) in a few lines, and names the design.
- `supabase/tests/0318-client-reads-plan-once.sql` turns green, and the whole `npm run test:sql` passes: every file that
  tests these functions, the scale files above all (`0313-discipline-scale.sql`, `0065-alerts-read.sql`,
  `0166-surface-log.sql`, `0075-play-moments.sql` and the rest), now reads the generic plan from the first call.
- **The measure:** on a scratch database with every migration applied and a thread of 33 posts and 34 card plays by
  five characters, call `thread_page` five times in one session as a signed-in reader, before the migration and after,
  and put the timings in the PR. Before: about 200 ms a call. After: the first call is planned, the later ones should
  be tens of milliseconds.

## Task 4. The PR

Model: inline

The PR body says what §1 found, with the before and after timings from Task 3, and the post-deploy reading of §7 as the
step left to the owner or the dispatching session.

## Review focus

- A generic plan at a busy instance's scale: every page whose scale test asserts an index read or a bounded count of
  rows still does under `force_generic_plan`; a predicate such as `(in_seq is null or seq = in_seq)` that an argument's
  value used to settle at planning is now settled at run time, and a seq scan of `acts` there is the failure to look for.
- `#variable_conflict use_column` in every converted body, and no parameter that now silently means a column where
  the SQL function meant the parameter (a parameter left unqualified that has no column of its name stays a parameter).
- Each converted function is the same function: the same return shape and order (`order by` inside an aggregate kept),
  the same refusals with the same hints and codes, the same `security definer` or invoker.
- A plan kept across calls on a pooled connection that PostgREST switches between `anon` and `authenticated`: a
  security-invoker function's plan made under row-level security is planned again when the role changes, never reused
  across roles, and nothing about a plan depends on which account called first.
- The coverage guard counts calls made by the suite only: it must not pass because a step called every function in a
  loop with no assertion, and a client read added later without a test must fail it.
