Record, written 2026-11-22.

# The staff's threads follow the system board: plan

Carries out `docs/plans/2026-11-22-system-threads-follow-the-flag-design.md`. One PR from `main`, which closes #983.

Every task goes test first: write the failing test, record its red run, then the code. During a task, run only the
tests for the changed code: `npm run test:sql` for the SQL (it replays every migration into a scratch database on the
local Postgres `DATABASE_URL` names). Run `npm run typecheck` and `npm run build` once after the last task, with the
tail in the PR. No deployed database, bucket or connector is touched.

The migration is one file, `supabase/migrations/NNNN_system_threads_follow_the_flag.sql`, NNNN the next free number on
`main` when the build starts (0407 when this plan was written). Each function it rewrites is copied from its **latest**
definition, which the build confirms before copying (`grep -lE "function (public\.)?<name>\(" supabase/migrations/*.sql
| tail -1`); the latest named below is as of this plan, and a later migration on `main` wins. Each rewrite opens with
"`<name>` (`<latest>`), <what changes>. Everything else as `<latest>` wrote it."

**The rule, whole.** A thread in `system_threads()` (the thread `systemAnnouncements` names, the thread `updatesThread`
names, and every `seasons.turns_thread`) is placed at `system_board()`, before any move is read. The seed rebuilds those
threads after it moves the system flag, and sets both affected boards' thread counts from their rows.

**The layers.** All engine. No instance file changes.

**The masks.** Nothing added reads who owns a character, a class or who reacted; a thread's board is public.

**States.** None added.

**Scale.** The design, section 4.

**Rows already held.** Forward only for the counts: a board whose flag does not move keeps its counts. A database whose
flag has already moved (dw.gripe) is put right by the first seed after the build, because the seed rebuilds and recounts
whenever an instance-placed thread is not on the system board, not only when the flag moves in that very run (Task 2,
step 1).

## Task 1. The placement: the staff's threads live on the system board

Model: sonnet

**Files:** the new migration; `supabase/tests/NNNN-system-threads.sql` (new).

- **`system_threads()`**, new: `returns setof uuid`, `language sql stable security definer`, execute revoked from every
  API role, as `setting_thread` is. It answers `setting_thread('systemAnnouncements')`, `setting_thread('updatesThread')`
  and every non-null `seasons.turns_thread`, without nulls or duplicates.
- **`thread_place(thread)`** (latest `0323_moved_in_goes_back.sql`): if the thread is in `system_threads()` and
  `system_board()` is not null, return `system_board()` at once, before the origin, the moves and the merges are read.
- **`thread_places_computed()`** (latest `0323_moved_in_goes_back.sql`): the final select places a thread in
  `system_threads()` at `system_board()` (a `left join` on the set and a `coalesce`, or a `union` of the two cases),
  so it agrees with `thread_place` for every thread. `thread_places_drift()` (`0319`) needs no change; it reads the
  computed set.
- **The meeting's `moveThread`.** Find where a `moveThread` is offered and repaired at its latest definition
  (`0403_departed_personas.sql`, the block under `kind_row.key in ('createBoard', 'moveThread', 'mergeBoard')`, and the
  landing at `due.kind = 'moveThread'`). If a thread in `system_threads()` can be named, refuse it there with `that
  thread is the staff's own and stays on their board` (`hint = 'kayfabb.refusal'`). Record in the PR what was found:
  already refused, or refused now.

**Tests first** (`supabase/tests/NNNN-system-threads.sql`, with two boards `a` and `b` and `a` flagged):

1. `system_threads()` answers the announcements thread, the Updates thread and a season's Turns thread, and nothing
   else (an ordinary thread on `a` is not in it).
2. With the flag moved to `b` by hand in the test (`update boards set is_system`, the seed's own statement), each of the
   three is placed at `b` by both `thread_place` and `thread_places_computed`, and an ordinary thread opened on `a`
   stays on `a`.
3. A landed `moveThread` naming the announcements thread, written the way the move tests write one: both placements
   still answer `system_board()`.
4. `thread_places_drift()` after `rebuild_thread_places()` is empty.

## Task 2. The seed rebuilds and recounts

Model: sonnet

**Files:** the same migration; `supabase/tests/NNNN-system-threads.sql`.

**`seed_instance`** (latest `0406_seed_board_order.sql`), after the boards block and after the announcements and Updates
threads are made:

1. `strays` is the instance-placed threads whose `threads.board` is not `system_board()`. If there are none, do nothing
   more (a reseed with no change writes nothing).
2. Otherwise: note each stray's current board, `perform rebuild_thread_places(strays)`, then recount
   `board_thread_counts` for each board that a stray left and for `system_board()`. The count is what `thread_list`
   lists for the board: threads on it that thread lists show (confirm the rule from `thread_list`'s latest definition;
   the Updates thread is never listed, and the system board's threads are never counted). Write the count to shard 0
   and zero the other shards, under the shards' row locks, in board id order.
3. Add `placed` (how many threads moved) to the seed's answer.

**Tests first** (the same file, now through `seed_instance` with a minimal payload, as `0406-seed-board-order.sql` does):

1. A seed with `a` flagged, then the season's Turns thread opened, then a reseed with `b` flagged: the three
   instance-placed threads are on `b`; an ordinary thread on `a` stays; `post()` into the announcements thread by a
   player's character is refused by `not_the_systems`; `thread_list` of `a` and the count it reports agree, and so do
   `b`'s.
2. A third identical reseed writes nothing: no row of `threads`, `board_thread_counts` or `post_search` changes, and
   `placed` is 0.
3. A reseed flagging `a` again sends the three back to `a`, with the counts agreeing.
4. **dw.gripe's shape:** the flag moved to `b` by an older seed (by hand in the test, the threads left on `a`), then
   a seed with `b` flagged: the strays are found and placed even though the flag did not move in this run.

## Task 3. The build

Model: inline

`npm run typecheck`, `npm run build` and `npm run test:sql`, with the tails in the PR. The PR body says, for the owner:
after it merges and the release runs, dw.gripe's seed moves the three staff threads to Staff Announcements, and the
seed's answer in the release log shows `placed`.

## Review focus

- The two placements agree for every thread: `thread_place` and `thread_places_computed` both put the rule first.
- The counts after a flag move, on an instance that holds threads made before 0339 on the old system board and the
  hand-netted Updates thread: `thread_list`'s count equals what it lists on both boards.
- Idempotence: a reseed after the strays are placed writes nothing, so the nightly release is quiet.
- A `moveThread` naming a staff thread can't be offered, repaired or landed so that it moves the thread.
- `rebuild_thread_places`' lock and its "moved by another writer" refusal hold when the seed calls it while a tick
  rebuilds a lasting move.
