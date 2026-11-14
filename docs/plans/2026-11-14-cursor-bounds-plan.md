# Cursor bounds a generic plan can seek on: plan

Record, written 2026-11-14. Carries out `docs/plans/2026-11-14-cursor-bounds-design.md` (its sections are cited as §N),
task by task.

Every task is test first: the test named, its red run recorded, then the code, then the green run. One migration is
added (Task 3), tested on Postgres on localhost; no task touches a deployed database or service. All of it is engine. No
instance content is involved and no interface changes. No state is added, and no response, payload, Realtime event or
timing is computed from a private fact (§5): every rewritten function returns the same rows for every argument. One
check is added, with its poison (Task 1).

Numbers: the migration is `0366` and the SQL test `0318`, the next free on main when this was written. If main has
taken them by the time the PR merges, take main's next numbers. `docs/plans/2026-11-13-plan-once-plan.md` claims the
same numbers. This plan goes first (§1), and plan-once takes the numbers after it, as its own plan already allows.

The order: 1, then 2, then 3, then 4.

## Task 1. No cursor bound is a catch-all (the guard, §3)

Model: sonnet

**Files:** a new `supabase/tests/0318-cursor-bounds.sql`.

**What:** the file defines `pg_temp.catch_all_bounds() returns table (fn text, arg text)`. It reads every `language sql`
or `plpgsql` function in `public` (`prokind = 'f'`) by `pg_get_functiondef`, and returns each function and input
argument that has a cursor catch-all: `<arg> is null or <column> <op> <arg>`, or `<arg> is null or <arg> <op> <column>`,
where `<op>` is one of `<`, `<=`, `>`, `>=`. The other side counts as a column only when it isn't an input argument, a
literal (`null`, `true`, `false`, a number) or a function call. `<arg>` is the argument's name, optionally qualified by
the function's name (`trophies_of.before`), or `$n` for an unnamed one. Only the first `pronargs` names are inputs:
`returns table` puts its output columns in `proargnames` too (`cosmetic_log_rows` returns a column named `at`).

The probe's version, which found exactly §3's six on main, is the starting point. Lowercase the definition and fold
whitespace. Mark a call by rewriting `ident(` as `ident#(`. Drop the remaining parentheses, because `begin atomic`
bodies come back normalized as `((in_before IS NULL) OR (l.ends_at <= in_before))`. Then match
`\m<ref> is null or ([a-z_"][a-z0-9_."#]*) (<=|<|>=|>) <ref>` and the mirrored form, and reject an `other` that is an
input argument, a literal or contains `#`. The build session may write it differently if every case below holds.

1. **The poisons.** Each is created in the file's transaction and must be returned:
   - `public.planted_atomic(in_before timestamptz)`, `language sql`, `begin atomic`, reading `acts` with
     `where in_before is null or created_at <= in_before`;
   - `public.planted_plpgsql(before timestamptz)`, `plpgsql`, with `where planted_plpgsql.before is null or a.created_at < before`;
   - `public.planted_since(since timestamptz)`, `language sql` with a `$$` body, `where since is null or since < created_at`
     (the mirrored form);
   - `public.planted_positional(timestamptz)`, `language sql`, `where $1 is null or created_at <= $1`.

   The controls, which must not be returned:
   - `public.planted_bound(in_before timestamptz)` with `created_at <= coalesce(in_before, 'infinity')`;
   - `public.planted_equal(card text)` with `card is null or payload ->> 'card' = card` (an equality, §3);
   - `public.planted_check(ends timestamptz)`, `plpgsql`, with `if ends is null or ends <= now() then` (a call);
   - `public.planted_args(since timestamptz, until timestamptz)` with `if since is null or until <= since then` (both
     sides arguments);
   - `public.planted_table(in_before timestamptz) returns table (at timestamptz)` with
     `in_before is null or 1 <= in_before`. This catches `at` being mistaken for an input argument, and checks the
     literal rule.
2. **The real list:** the result, less the planted functions, must be empty. Otherwise the file raises, naming each
   function and argument.

**Red run first:** it fails naming `admin_awards.before`, `belt_lineage.before`, `cosmetic_log_rows.in_before`,
`log_page.in_before`, `staff_notes_recent.since` and `trophies_of.before`, and nothing else. A different list means the
matcher is wrong or main has moved. Find out which before going on.

## Task 2. Deep pages read a page, not the depth (the scale test, §1)

Model: sonnet

**Files:** the same `supabase/tests/0318-cursor-bounds.sql`, a second `do` block.

**What:** the cost the design measured, asserted on the real functions. It needs no plan-cache setting: Postgres 16
already plans these `language sql` bodies with the argument unknown, and the `plpgsql` ones are pinned with
`set_config('plan_cache_mode', 'force_generic_plan', true)` and called once, uncounted, before counting. That pinning
follows `0059-card-plays.sql`'s pattern. Reads are counted as the change in
`seq_tup_read + idx_tup_fetch` from `pg_stat_xact_user_tables` for the source table, around one call made as the
owning account (`tests.become`).

For each case, seed the caller with **20,000** rows one minute apart, plus 50 other accounts' rows at `now()`, and
`analyze` the table. Call once with a cursor 19,000 rows deep and once with null, and assert each call reads at most
**400** rows (page size 200, with room for a boundary probe and plan noise). One case for each rewritten function:

| Function | Source rows seeded | Index the bound seeks on |
|---|---|---|
| `log_page` | `wallet_events` (`account`, `kind`, `change`, `balance_after`, `at`) | `(account, at)` |
| `cosmetic_log_rows` | `random_events` for the caller | `(account, at)` |
| `trophies_of` | `trophy_awards` of one character, `most` 50 | `(character, at desc, id desc)` |
| `belt_lineage` | `trophy_awards` of one trophy, `most` 50 | `(trophy, at desc, id desc)` |
| `admin_awards` | `trophy_awards` read as an admin, `most` 50 | the global order (assert the bound is an index condition, see below) |
| `staff_notes_recent` | `staff_notes` of one staff | `(staff, at desc, id desc)` |

`admin_awards` reads every award with no owner key in front. Assert its deep call reads at most `most + 200`, which the
row comparison on an `(at, id)` order allows. If no index serves that order, record it on #673 rather than adding one
here.

For `log_page` only the wallet branch is seeded. The other branches read none of the caller's rows, so they show up in
other tables' counts, not in `wallet_events`'.

Seeding goes straight into the tables as the file's superuser, as `0313-discipline-scale.sql` does. Use whatever
`supabase/tests/setup/fixtures.sql` provides (`tests.account`, `tests.character`, `tests.act`) for the owners. Write
anything a table needs and the fixtures don't provide inline, and say so in a comment.

**Red run first:** on main, each deep call fails. Measured during the design: `log_page` reads 19,199 `wallet_events`
rows at a cursor 19,000 deep. Record each function's figure in the PR.

## Task 3. The rewrite (§2)

Model: sonnet

**Files:** a new `supabase/migrations/0366_cursor_bounds.sql`.

**What:** take each function's current definition from a scratch database with every migration applied
(`pg_get_functiondef`), never from a migration file, since a later one may have replaced it. Write it again with
`create or replace function`: same arguments, return type, language, volatility, `security definer` or invoker,
`set search_path`, body. Change only the cursor bounds:
- `log_page`: each of its 20 `in_before is null or <col> <= in_before` becomes `<col> <= coalesce(in_before, 'infinity')`.
  Where a branch also has `<col> is not null and` (`sv`, `se`, `sp`), that conjunct stays.
- `cosmetic_log_rows`: its six become `<col> <= coalesce(in_before, 'infinity')`.
- `trophies_of`, `belt_lineage`, `admin_awards`:
  `before is null or a.at < before or (before_id is not null and a.at = before and a.id < before_id)` becomes
  `(a.at, a.id) < (coalesce(before, 'infinity'), coalesce(before_id, '00000000-0000-0000-0000-000000000000'::uuid))`
  (§2 gives why the rows are the same).
- `staff_notes_recent`: `since is null or s.at > since` becomes `s.at > coalesce(since, '-infinity')`.

A header comment says why in a few lines and names the design. Grants are kept by `create or replace`. Restate none.

Then `0318` turns green, and the whole `npm run test:sql` passes. The existing tests of these functions are the proof
that the rows haven't changed: `0042-log-reads.sql`, `0124-log-page.sql`, `0165-plain-log-read.sql`,
`0172-cosmetics-log.sql`, `0167-trophies.sql`, `0169-award-trophy-move.sql`, `0171-admin-awards.sql`,
`0088-staff-notes.sql`, and any other `grep -l` finds.

## Task 4. The PR

Model: inline

The PR body says what §1 found, gives each function's deep-cursor reads before and after from Task 2, links #673, and
says that `docs/plans/2026-11-13-plan-once-plan.md` takes the numbers after this one.

## Review focus

- The same rows: a row-comparison keyset with a nil uuid, against the old three-part `or`, at exactly `a.at = before`
  with and without `before_id`; and `infinity` against a `timestamptz` column (no row is at `infinity`).
- The guard's reach: a catch-all written in a shape the matcher misses (`coalesce` is fine, but `case when in_before is
  null then true else ...`, or a cursor read through a CTE column). Name any such shape it can't see in the file's
  header, so a later reader knows the guard's limits.
- Counted reads are of the source table only. A branch could still read other tables in proportion to depth (a join
  probed for every row the bound skips). Confirm the deep call's total across `pg_stat_xact_user_tables` stays bounded
  too, not only the seeded table's.
- Plan-once's conversion of these functions to `plpgsql` must keep the bound as written here. Its own guard and this
  one both run in the same suite.
