# SQL plan checks that hold whatever statistics they meet: plan

Record, written 2026-11-12 by the build session that carries it out. No design session came before it: the owner asked
on 2026-11-12 for a proper fix to the SQL checks that fail by timing (#473, #490, #499), so this plan holds the
investigation's findings and the tasks. One PR from `main`.

## What was found

`npm run test:sql` runs every assertion file in one scratch database, each inside `begin; … rollback;`. A rollback does
not put the database back as it was. Four things leak from one file to the next:

- **Dead rows.** Rolled-back inserts stay on the tables' pages until a vacuum, so `relpages` and where a new row lands
  depend on which files ran before.
- **`pg_class` figures.** `analyze` inside a file writes `reltuples` and `relpages` in place, and they survive the
  rollback.
- **Autovacuum.** It vacuums and analyzes the scratch database's tables whenever its thresholds are met, at times set
  by the clock. This is why the same commit passes and fails.
- **Committed rows.** A race test commits through dblink; some later files rely on what an earlier one committed (see
  "Left for their own issues").

A plan assertion on a toy fixture reads whichever plan those leftovers happen to price lowest. Measured by pinning the
state: with `vacuum (analyze)` run before every file, five files fail on every run (0059, 0107, 0134, 0135, 0146); with
the runner as it is, the same commit gave 0 failures on one full local run.

What each of the five was hiding:

| File | Root cause | Whose fault |
|---|---|---|
| `0146-card-writes.sql` "the read is not index-led" | `my_posts_written_on` (0149) is a flat join. With a busy instance's rows (2,000 characters, 40,000 posts, 10,000 plays) and fresh statistics, the planner reads **every play in the instance** for a caller with 100 rows: it prices the whole `acts_layers` index at 49 rows (10,000 real), because the index's predicate holds `coalesce(payload ->> 'reach', 'post')`, an expression with no statistics. | The product. The toy assertion passed only with no statistics. |
| `0107-visits.sql` "the repeat-charge lookup is not read by…" | `visit_charge_matches` (0154) is a flat join too. With statistics gathered before the instance had joins, it reads all of `acts_visit_joins`: 35,202 Acts for a post that owns 7. | The product, under stale statistics. |
| `0134-group-reads-plan.sql` "reads many rows of open_moves" | The 400-row fixture is 3 heap pages, where a sequential scan (7.00) and the primary-key probe (8.29) price within 2%. One leftover dead page decides it, which is why the file passes in the suite and fails alone on a fresh database. At 20,000 to 200,000 rows the product reads 0 rows by scan in every statistics state. | The test's fixture. |
| `0059-card-plays.sql` "an Idle and a Move read differently" | The session's plan cache. The first counted call runs a custom plan that folds `thread = null` away; the second gets the generic plan, one scan more. Swapping the two calls gives the same counts, so the difference is the call's position and never the card. | The test's measurement. |
| `0135-face-down-moves.sql` "the backs make different reads" (#499) | A different fault from statistics, of the same family (page layout left by earlier files): whether each setter's `update characters` is a HOT update depends on free space on the row's page, and a non-HOT update leaves a second index entry that one more read finds. Root cause and reproduction are in #499's first comment. | The test's fixture. It belongs here: the same leftover state causes it, and pinning the runner turns it red on every run. |

`0116-search.sql` BOUND-2 (#473's second half) **could not be made to fail** on today's `main`: 12 runs on a fresh
database, 12 after the files before it (fresh, analyzed, vacuum-analyzed), 25 re-draws of `analyze post_search` inside
its fixture on Postgres 16, 12 re-draws on CI's Postgres 17.11 (a temporary probe file, run 43304094025, since removed),
and the full suite once locally and once in CI. The file was changed on 2026-11-12 (70b86786) after the failures #473
records. Its assertion is not touched. #473 stays open for that half, with this evidence on it.

## The fix, in two layers

1. **The runner fixes the state every file starts from.** `vacuum (analyze)` before each assertion file and each
   end-to-end file: dead rows reclaimed, `pg_class` figures and statistics true to the committed rows, autovacuum's
   thresholds reset so it has no reason to run during the file. A file then gives the same answer alone and in the
   suite, on every run. Measured cost: about 0.5 s a file, about 2 minutes on a 9-minute suite.
2. **Each assertion holds what it exists to hold by its own means.** A read that must be index-led at a busy
   instance's scale is tested on a busy instance's rows, analyzed in the file, and by the rows it really read; where
   the product's plan turned on an estimate, the product's SQL is rewritten so the join order is in the query.
   No assertion is loosened, skipped or deleted.

Considered and not taken: a fresh clone of a template database for each file (0.3 s a clone). It is the cleaner
isolation, but 12 files pass only on rows an earlier file committed, so it cannot land before those are fixed (their
own issue, below).

Migrations were built as 0343 and 0344 and took 0344 and 0345 when the PR was ready (`main`'s top was then 0343); the merging session is told
"ready for its numbers" before any renumbering. Every task is test first, with its red run recorded. Tests run against
Postgres on localhost only.

The state names used below: **fresh** (a database just built: shim, migrations, fixtures), **analyzed** (`analyze`
run on it), **vacuum-analyzed** (`vacuum analyze` run on it), each also **after the suite** (the same three on a
database where the files sorting before this one have run and rolled back).

## Task 1: the runner fixes the statistics state before every file

Model: sonnet

Files: `tools/test-sql.mjs`, `tools/test-sql-refusal.mjs`.

- Before each assertion file's psql and each end-to-end file, the runner runs `vacuum (analyze);` on the scratch
  database (its own psql call: `vacuum` cannot run in a transaction). If it fails, that file's step fails with the
  error and the file is not run.
- One exported constant holds the statement, so the self-test reads the same text the runner sends.
- The header comment gains a paragraph: what leaks across a rollback (the four above, briefly), why the state is
  fixed here and not in each file, and that a file's plan assertion must still stand on its own fixture and `analyze`.
- Test first, in `tools/test-sql-refusal.mjs` (it already stands a recording psql in through `KAYFABB_PSQL_SHIM`):
  with two assertion files in a scratch tests directory, or whatever the existing harness allows, the recorded calls
  show the statement sent to the scratch database immediately before each file's own call, and a failing vacuum fails
  that file's step without running it. Red run: the self-test against the runner as it is.

## Task 2: `my_posts_written_on` starts from the caller's characters

Model: sonnet

Files: `supabase/migrations/0344_writes_start_from_the_caller.sql` (new), `supabase/tests/0146-card-writes.sql`.

- **Test first.** A new block at the end of `0146-card-writes.sql`, "at a busy instance's scale": 400 accounts, 2,000
  characters (5 each), 40,000 posts (20 each, inserted with `alter table acts disable trigger user` as
  `0116-search.sql` does), a `cw-scribe` play on every fourth post (10,000) and a text for each; `analyze characters;
  analyze acts; analyze card_texts; analyze card_write_refunds;`. Then, as an owner whose five characters hold 100 posts, each with a play (100 rows of the view),
  with the planner left free:
  - `explain (analyze, format json)` of `select * from my_posts_written_on`; the rows of `acts` and of `card_texts`
    the plan read (heap and index scans: actual rows plus rows removed by filter, times loops, as `0116-search.sql`'s
    `rows_read` counts them) are at most `2 * P + 256` for `acts`, P the caller's own posts, and at most the view's
    rows plus 256 for `card_texts`;
  - the plan names `characters_owner` and `card_texts_play_version_key` and has no `Seq Scan` on `acts`, `card_texts`
    or `characters` (the existing assertion's words, held at scale);
  - the same holds a second time under **stale statistics**: the fixture analyzed before the plays and texts are
    inserted, and not after.
  The scratch file `exp146.sql` in the session's notes is the fixture this was measured with.
- The existing toy assertion at ~line 660 stays exactly as it is.
- **Red run:** the new block against the view as 0149 wrote it (reads 10,000 plays), and the existing assertion under
  the pinned runner (Task 1) or after a `vacuum analyze`.
- **The migration:** `create or replace view my_posts_written_on` with the same columns in the same order, the join
  order written into the query: `characters c` filtered by `owner = auth.uid()`, then `cross join lateral (… from acts
  p where p.character = c.id and p.kind = 'post' offset 0)`, then the plays on each post
  (`acts_layers`' predicate, `offset 0`), then the texts of each play (`offset 0`). The `opening` and `over` columns
  as 0149 wrote them. Its comment says why: an estimate cannot move the read off the caller's rows. Grants are kept by
  `create or replace`; the test's existing grant and column checks prove it.
- **Green:** the whole file in the six states (fresh, analyzed, vacuum-analyzed; each also after the suite).

## Task 3: `visit_charge_matches` starts from the post's visits

Model: sonnet

Files: `supabase/migrations/0345_visit_charge_lookup.sql` (new), `supabase/tests/0107-visits.sql`.

The investigation's patch (migration and test, validated in nine states with two poisons) is in the session's notes as
`inv0107/proposal.patch`; it names its migration 0340, which became 0345.

- **Test first.** Section 17 moves to the end of the file (its fixture is written with triggers off): 60,000 posts,
  22,000 visits, 16,500 ends; `analyze acts`; then 13,200 joins. It plans the function's body with the planner left
  free, twice: under those stale statistics, and after `analyze`. For four probe posts each time: the scans of `acts`
  are exactly `acts_visits_by_post`, `acts_visit_joins` and `acts_one_visit_end`, each with an Index Cond; the Acts
  read are no more than the post's own visits, joins and ends; the repeat answer is right. The `search_path` check is
  kept.
- **Red run:** the new section against 0154's function (35,202 Acts read under stale statistics).
- **The migration:** `create or replace function visit_charge_matches` with the signature, volatility, security and
  `search_path` 0154 gave it, the post's visits first behind `offset 0`, a lateral subquery for each visit's charge and
  joins, and the end check a `not exists (… offset 0)`. Same result rows: `0109`, `0110`, `0112` and `0128` pass.
- **Green:** the whole file in the six states.

## Task 4: `0134-group-reads-plan.sql` at a busy instance's scale

Model: sonnet

Files: `supabase/tests/0134-group-reads-plan.sql`. Patch in the session's notes: `inv0134/proposal.patch`.

- The fixture becomes 20,000 moves in force, 400 of them `conferGroup` (the target's is one). The limit of 50 rows read
  is unchanged.
- Rows read are counted by any path (`tuples_returned + tuples_fetched`), not sequential reads alone: the header's own
  example, a character cast to uuid, passed the old count.
- The header says what the investigation found: up to about 3 pages of `open_moves` the planner reads the table by
  choice, a bounded read that does not grow with the instance.
- **Red runs (poisons):** `group_now` as 0128 wrote it; `group_now` and `bars_of` with the uuid cast; each red against
  the patched file. And the unpatched file alone on a fresh database.
- **Green:** the six states.

## Task 5: `0059-card-plays.sql` counts reads with the plans already made

Model: sonnet

Files: `supabase/tests/0059-card-plays.sql`. Patch in the session's notes: `inv0059/proposal.patch`.

- The Idle and Move reads are compared under `plan_cache_mode = force_generic_plan` and again under
  `force_custom_plan`, each after one uncounted call per back, with the same strict comparison; a guard requires each
  counted table to have been read at least once.
- **Red runs:** the unpatched file after `vacuum analyze`; and a poison against the patched file: one extra read of
  `acts` for a cast in `spring_facts`.
- **Green:** the six states (after the suite, the file's own committed race fixtures are renamed in the scratch copy,
  since the file cannot run twice on one database).

## Task 6: `0135-face-down-moves.sql` gives every setter the same row history

Model: sonnet

Files: `supabase/tests/0135-face-down-moves.sql`. #499's first comment holds the root cause, the fix and its red step.

- Each setter's rewrite is made non-HOT on purpose by changing an indexed column `spring_facts` does not read
  (`created_at`, the key of `characters_waiting`): the retiree's `update … set retired_at = now(), created_at =
  created_at - interval '1 microsecond'`, and the five others' `set created_at = created_at - interval '1
  microsecond'`. The comment says why: whether an update is HOT depends on the page's free space.
- **Red run:** the unpatched file with 5 padding characters planted before the Even block, and under the pinned
  runner.
- **Green:** padding of 0 to 10 characters, and the six states.

## Task 7: the whole suite, and the record

Model: inline

- `npm run test:sql` three times in a row with 0 failed, and `npm run build`.
- The PR description records each red run, the sweep below, and the evidence on `0116-search.sql`.
- Issues filed: the two under "Left for their own issues".

## The sweep: other assertions that read a plan or count work

Read for this plan; none is changed here unless a task above names it. Under the pinned runner all of these pass.

- **Plan shape on a toy fixture with no `analyze` in the file** (the kind 0146 was): `0034-thread-list` 98-120,
  `0035-reveal-index` 21-26, `0036-bounded-reads` 201-211, `0048-staff` 397, `0060-card-reach` 277-278 and 422,
  `0068-season-news` 459-464, `0101-season-results` 238 and 248, `0125-groups` 226 and 231, `0146-card-writes` 99-100,
  `0186-arcs` 468 and 477.
- **Plan shape with an `analyze` in the file:** `0032-unmask` 181-187, `0036` 182 and 191, `0037-standings-page`
  207-217, `0038-standings-season` 113-117, `0046-presence` 210-245, `0053-tick` 382-392, `0064-follows` 214-216,
  `0065-alerts-read` 250-257 and 445-446, `0090-pool-signals` 552-563, `0116-search`, `0116-tweener-standings` 93,
  `0167-trophies` 256-258 and 474, `0169-award-trophy-move` 246.
- **Work counted (reads, buffers, calls):** `0058-progress-scale` 76-84, `0064` 292, `0068` 379-383,
  `0075-play-moments` 361-376, `0077-trap-locks` 213-219, `0146-quote-springs` 191-208, `0152-reversal-matches` 184,
  `0166-surface-log` 323-325, `0170-screen-cosmetics` 56, `0189-thread-places-at-scale` 114-124.
- **Timing:** `0118-bbcode-plain-scale` 52, `0144-phrase-scale` ~33, `0190-thread-places-interleave` 187-227.

## Left for their own issues

- **Reads never tested at a busy instance's scale.** The first group of the sweep asserts a plan on a few rows. Two of
  the five files fixed here were hiding product reads that grew with the instance; the others in that group may be
  too. Each needs the treatment of Tasks 2 and 3. A separate concern from the flake: they are other reads.
- **Files that pass only after another file's commit.** Alone on a fresh database, `0009`, `0010`, `0012`, `0013`,
  `0017`, `0023`, `0024`, `0025`, `0033`, `0036`, `0038` and `0099` fail (for `0009`, `0007-aura-race`'s committed
  settlement is what it needs). A different fault from statistics, and what stands between the runner and a clone for
  each file.
- **The session's container runs Postgres 16 and CI runs 17.** A plan read locally is not the plan CI reads.

## Review focus

- The two rewritten reads return the same rows as before for every caller, and their grants, security and
  `search_path` are unchanged.
- No assertion became weaker: each changed check is at least as strict, and each has a poison that turns it red.
- The runner's `vacuum (analyze)` reaches the scratch database only.
