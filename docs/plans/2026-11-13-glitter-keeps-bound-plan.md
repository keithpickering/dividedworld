# Glitter Bomb keeps: the kept read bounded at both ends

Record, written 2026-11-13. An addition to `docs/plans/2026-11-12-glitter-keeps-plan.md`, built inside PR #632 before it
merges. It answers the final review's finding F1 (issue #634) as the owner decided there on 2026-11-13 (option A):
"`play_reach` gains the play's start, filled from the Act for the rows an instance already holds, with an index the scan
can use, so a page reads only plays that began at or before its latest post. It is built inside #632, not as a
separate change, and covers Part 2's thread rows (`0349_thread_page_under.sql`) as well." Task 3 carries the owner's
copy answer on #635.

**The defect.** `play_reach` (`supabase/migrations/0055_card_reach.sql`, line 166) holds a play's end and not its
start, so `thread_page`'s `kept_reach` (both branches: the thread's, from 0349, and the authors', from
`supabase/migrations/0480_kept_character.sql`) is bounded below by the page's earliest post and not above. An old page
reads every worn-off play on each author, and on the thread, from that date to now, each with a primary-key read of its
Act: 20 authors with 470 later plays each is 9,400 rows read to return 20.

## Decided here

- **The column.** `play_reach.started_at timestamptz not null`, the play Act's `created_at`. A play's window is
  `[started_at, ends_at)`, which `kept_window` already tests post by post (`a.created_at <= p.created_at and
  p.created_at < r.ends_at`); the column copies a fact the Act already holds and never changes.
- **Filled by a trigger, no writer rewritten.** The writers are `place_cast` and `lay_sprung`, both last defined in
  `supabase/migrations/0317_surfaces.sql` (`play_card`, last in `supabase/migrations/0348_post_under.sql`, writes
  through `place_cast`; the inserts in 0055 to 0153 are earlier bodies of the same three functions). Each inserts the
  card Act first, with `created_at` its default `now()` (the transaction's start), and the `play_reach` row after it in
  the same transaction. Rewriting them whole would collide with the PRs in flight that touch them (#607, card notes
  Part 3, #619). So `play_reach_start()`, a `before insert` trigger, sets `new.started_at` from `acts.created_at` for
  `new.play`, whatever the writer passed, and refuses a row whose Act is not there (`23503`, "a play beyond a post is
  written after its Act"). It is enabled as an ordinary trigger, not `always`: an import writes as a replica
  (`tools/import-instance.mjs`), where it does not fire, so an exported row is carried as written, as 0336's beat
  guard carries an export. Its execute is revoked from `public, anon, authenticated`, as every trigger function's is
  (`supabase/tests/0005-default-deny.sql` fails otherwise; measured).
- **A play cannot end before it starts.** `check (started_at <= ends_at)`, named `play_reach_starts_before_end`. Every
  writer ends a play at `now()` plus a span whose count is 1 to 1000 (`engine/rules/instance.ts` checks `lasts`;
  `reachLasts` is checked in 0055), or at a scored-as window's close, which `play_card` refuses unless it is after the
  next settlement. The range index below cannot hold a row that ends before it starts (`tstzrange` throws), so the
  check says it in words of its own. An instance holding such a row fails the migration by name and rolls back.
- **Existing rows, in the migration.** `play_reach` is append-only (`play_reach_no_update` and `play_reach_no_truncate`,
  both `enable always`). The migration, inside its own `begin; … commit;` (as `0030_screens_reads.sql` does, so no
  other session ever writes while the guard is off): adds the column nullable; `disable trigger play_reach_no_update`;
  `update play_reach r set started_at = a.created_at from acts a where a.id = r.play`; `enable always trigger
  play_reach_no_update`; then `set not null` and the check. This is the schema's own change, not a player or The System
  editing a row: no Act is touched, and "Append-only" reads on it as it does on any derived row: the column is a copy
  of an immutable fact of the Act, and nothing an Act says changes. The truncate guard is never disabled.
- **The index: GiST over the window.** `create extension if not exists btree_gist with schema extensions` (as
  `supabase/migrations/0117_search.sql` takes `btree_gin`; `supabase/tests/setup/auth-shim.sql` makes the schema;
  btree_gist 1.7 ships with local Postgres 16 and with Supabase), then `play_reach_character_window` on
  `using gist (character, tstzrange(started_at, ends_at)) where character is not null`, and `play_reach_thread_window`
  the same on `thread`. The read asks `tstzrange(x.started_at, x.ends_at) && tstzrange(s.lo, s.hi, '[]')`, which is
  exactly `started_at <= hi and ends_at > lo`, the plays whose window can hold a post on the page. Measured below; the
  other candidates each bound only one side. No card column is copied: the kind is read from the Act only for the
  rows that overlap the page, which is what returns, and the measurements ask for nothing more.
- **The old indexes stay.** `play_reach_character` and `play_reach_thread` serve `effects_above`'s live plays
  (`ends_at > now()`), `play_moment`'s bounded range and the onMine branches (`supabase/migrations/0092_card_end.sql`),
  and `supabase/tests/0060-card-reach.sql` holds the live probe to `play_reach_character`.
- **One migration file.** `0480_kept_character.sql` gains, before `thread_page`, the extension, the column, the
  trigger, the backfill, the check and the two indexes: the function needs the column, and the PR stays one migration.
- **`thread_page`** is derived again from main's current body (`0349_thread_page_under.sql`; main holds no later one on
  2026-11-13, checked at `ee9934fc`) with 0480's character branch, and only `kept_reach`'s two predicates change:
  `x.ends_at <= now() and x.ends_at > s.lo` becomes `tstzrange(x.started_at, x.ends_at) && tstzrange(s.lo, s.hi, '[]')
  and x.ends_at <= now()` (and `r.` the same in the authors' lateral). `kept_window`, `kept` and the shape are as they
  were. The header's cost statement is written again to the new truth (A busy instance, below).
- **The fake needs no change.** `engine/ui/data/fake.ts`'s `kept` (line 3908) reads each play's start from its Act
  (`acts.get(play)!.at`) and filters in memory; nothing it answers changes.
- **The export needs no change.** `tools/instance-files.mjs` reads each table's columns from the catalog, so the
  column travels; `supabase/tests/e2e/0003-export.ts` holds `play_reach` and compares every column after the round trip.

## Task 1. The play's start: column, trigger, backfill

Model: sonnet

**Files:** `supabase/migrations/0480_kept_character.sql`, `supabase/tests/0480-kept-character.sql`,
`supabase/tests/e2e/0026-kept-across-0480.ts` (new), and the fixtures the check meets:
`supabase/tests/0094-card-end.sql` (lines 99 and 720 write a row ending before its Act, dated now: the Acts are dated
before their ends), `supabase/tests/0075-play-moments.sql` (line 370 writes rows as a replica, where the trigger does
not fire: the insert names `started_at` from `later.created_at`).

Tests first, red before the column exists:

- **Every writer's row carries its Act's date** (`0480-kept-character.sql`): a cast through `play_card` at character,
  thread and board reach (0060's way) has `started_at` equal to its Act's `created_at`; a direct insert naming another
  `started_at` gets the Act's; an insert for an id with no Act is refused with the trigger's words, not a null; a row
  ending before its Act's date is refused by `play_reach_starts_before_end`.
- **Still append-only:** after the migration, an update, a delete and a truncate of `play_reach` are each refused.
- **The backfill** (`0026-kept-across-0480.ts`, after `supabase/tests/e2e/0008-turns-across-0028.ts`): the suite
  replays from zero, so no row exists when 0480 runs there, and a row cannot be written without `started_at` once it
  has run. The honest proof is a database of its own: the shim and the migrations before 0480; Acts dated in the
  past and their `play_reach` rows at character, thread (one with `pins_board`) and board reach, as that schema wrote
  them; then 0480 and every migration after it. Each row's `started_at` equals its Act's `created_at`; the column is
  `not null`; both guards are `enable always` again (`pg_trigger.tgenabled = 'A'`); an update is refused.
- **The rest stays green:** the fixtures above, `supabase/tests/e2e/0003-export.ts` unchanged, and
  `supabase/tests/0005-default-deny.sql`.

## Task 2. The index, and `thread_page` bounded above

Model: sonnet

**Files:** `supabase/migrations/0480_kept_character.sql`, `supabase/tests/0480-kept-character.sql`,
`supabase/tests/0294-thread-page-under.sql`.

Tests first; the cost check is red against the head of #632 (the recorded "before") and green after:

- **Rows read do not grow with history.** One post long ago by author A, the one play that holds it, then N later
  worn-off plays of a keeping kind on A; one real `thread_page` call (one post a page), counted. The counter is
  `pg_stat_get_xact_tuples_returned` on `play_reach` and on each of its indexes, summed before and after the call (the
  `pg_stat_xact_user_indexes` view the review named does not exist; these functions read the transaction's own counts,
  inside the harness's `begin; … rollback;` and as `authenticated`; checked). `set local enable_seqscan = off` around
  the call: on a toy table the planner seq-scans `play_reach` for `spun` whatever `kept` does, which would hide the
  difference. Assert rows read at N = 500 are at most those at N = 5 plus 5. The same for a thread with N later
  worn-off thread plays. Measured on a scratch database migrated to the head: before, 14 rows read at N = 5 and 509 at
  N = 500, for the authors and for the thread alike; after, 15 and 9.
- **A btree counter cannot see a walk.** A btree counts only entries that pass its index conditions, so a
  `(character, started_at, ends_at)` index would read the whole history before a recent page and still count 1. The
  plan-shape blocks therefore stay: 0480's (line 192) and 0294's (line 290) explain the new probe, with the range
  predicate, and name `play_reach_character_window` and `play_reach_thread_window`, with no `Seq Scan on play_reach`.
- Every existing case in both files stays green (0294's thread rows exactly as Part 2 expects).

## Task 3. Glitter Bomb's words (#635)

Model: inline

**Files:** `instances/divided-world/ui/cards.ts`, `instances/divided-world/ui/index.test.tsx`,
`instances/divided-world/cards/glitter-bomb.ts`.

Already on the branch as `aaadb207`; a build session confirms it and changes nothing. "Keep their sparkle after it
ends" stands in place of "keep their sparkle for good", and "settled" alone in place of "settled where it landed";
"wherever it is" stays. The test pinning them came first (`index.test.tsx`, "Glitter Bomb's words say what the week
leaves"). The resulting sentences, exactly: `describe` holds "For a week, every one of that character's posts sparkles,
wherever it is. When the week is up, the posts written during it keep their sparkle after it ends, settled; every other
post stops." and `logPlay` is "Posts that character writes before it ends keep their sparkle after it ends."

## Ways out

No state is added. A row's start is a date; a play's ways out are as the glitter keeps plan says (its week, an admin's
end). A row the trigger refuses is a writer's bug, never a player's state.

## The masks

`started_at` is the play Act's `created_at`, which `acts_public` already shows every reader beside the play; the row
already carries the play and its end. Nothing reads who owns a character, and `thread_page` is the same document for
every caller (0480's test, unchanged).

## A busy instance

Measured on a scratch database of 20 characters and 20 threads, each with 470 weekly week-long plays over nine years
(9,400 a side), beside 200,000 other Acts; a page two days wide at the old end, the middle and the recent end:

| Index | One author: rows read (old, middle, recent) | 20 authors, old page |
| --- | --- | --- |
| before: `(character, ends_at)` | 468 + 470 Acts, 235 + 237, 3 + 5 | 9,360 (8,807 buffers) |
| (b) `(character, ends_at) include (started_at)` | 468 + 3 Acts, 235 + 3, 3 + 3 | 9,360 + 22 Acts |
| (c) `(character, started_at, ends_at)` | walks every play before the page | 285 index pages on a recent page* |
| (a) GiST `(character, tstzrange(...))` | 1 + 3 Acts at every age | 20 + 22 Acts, ~100 buffers |

\* One character with 47,000 plays: (c) read 285 pages to return 101 on a recent page; the GiST read 4 at either end.
The thread branch measured the same. So a page's kept read is one GiST probe for each author (at most the page size)
and one for the thread, each returning what overlaps the page; the Act is read only for those. The cost moves to
writes: one more index entry for each play beyond a post, and the GiST is larger (1,336 kB against the btree's 392 kB
for 9,400 rows). The backfill is one pass over `play_reach` by the Acts' primary key, once.

## Review focus

- **The backfill under append-only:** only `play_reach_no_update` is disabled, inside the migration's own transaction,
  and it is `enable always` again before the transaction ends (the e2e test reads `tgenabled`).
- **The trigger on every writer:** `place_cast` and `lay_sprung` in 0317 write the Act before the row; a test's direct
  insert is covered too; the import, as a replica, carries the exported start.
- **The index bounds rows read at both ends of history:** the counted test at N = 500, and the plans naming the GiST.
- **`thread_page` derived from main's current body** with 0480's character branch and only the two predicates changed:
  diff it against `supabase/migrations/0349_thread_page_under.sql`.
- **The export** round-trips with the new column (`supabase/tests/e2e/0003-export.ts`).
