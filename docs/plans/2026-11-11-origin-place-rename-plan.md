# A board play's place names the board as it is called now: plan

Record, written 2026-11-11. The plan for item F2 of issue #205 (the follow-ups of
`docs/plans/2026-11-04-origin-place-plan.md`). The owner asked for the build straight from the issue, so no design
session ran and this plan is the build session's own first commit. One build session builds it in one PR from `main`.
The PR names F2 and does not close #205, which holds other items.

Every task is test first: name the test, record its red run, then write the code. No `check-*.mjs` is added.

## The bug

A thread spun from a card played on a board carries its origin's place as
`{"kind":"play","card":…,"on":{"kind":"board","slug":…,"name":…}}` (`thread_open.origin_place`, and `thread_list`
through it). The board's row and the ORIGIN box read "spun from Whoops! on the board General". After a `renameBoard`
move lands, the board is called by its new name on every other screen, and this line still gives the old one. The link,
by slug, is right.

## The root cause

`supabase/migrations/0079_origin_place.sql` is still the live definition of `thread_open` (no later migration defines
the view or names `origin_place`). It joins `boards rb` and reads `rb.name`. Nothing is ever written to `boards`
(`supabase/migrations/0046_moves.sql`): what a board is called now is computed by the view `boards_now`, from the
board's latest `renameBoard` move with no `move_end`, else the board's own row. So `boards.name` is the board's first
name, for good. The origin-place plan named `boards`; that was the plan's defect.

The fake API has the same defect, written to agree with the SQL: `originPlace` in `engine/ui/data/fake.ts` reads
`boards.find(…).name`, the seeded row, where every other read there goes through `boardNow`.

## The direction: the view reads `boards_now`

The issue offers two: read `boards_now` in the view, or map the slug to a name through the client's board list in
`OriginLink`. This plan takes the first.

- The place is a value the server gives (`origin_place` is read by the board's rows, the ORIGIN box and `spunFrom`).
  Fixed in the view, every reader is right at once, and a reader added later cannot forget a client-side mapping.
- The second leaves a wrong name in the payload and a second source for one fact on the client: two lists that must
  agree.
- Because `boards_now` computes the name from the moves in force, the place follows it with nothing more to write: a
  later rename shows, and a rename that expires, is met or is reversed by an admin gives the earlier name back.

**The form.** The `board` branch of the `case` becomes a scalar subquery on `boards_now` keyed by the play's board, and
the `boards rb` join goes:

```sql
when 'board' then (select jsonb_build_object('kind', 'board', 'slug', n.slug, 'name', n.name)
                   from boards_now n where n.id = r.board)
```

`play_reach.board` references `boards (id)` and `boards_now` has a row for every board, so the subquery finds one row
wherever the old join did. The view's columns do not change, so the migration is `create or replace view thread_open`:
`thread_list` (`select *` from it) and the grants stand as they are.

**Why a subquery and not `left join boards_now rb`.** Both were measured on a scratch database on localhost: 5,000
threads on one board, half of them spun from a board play, 42 boards, 5 renames in force, the board's page at offset
2000 (`select * from … where board = $1 order by last_at desc offset 2000 limit 30`), five runs each.

| Form | offset 0 | offset 2000 |
|---|---|---|
| `boards rb` (today) | about 1 ms | 16 to 22 ms |
| `left join boards_now rb` | about 1 ms | 17 to 19 ms (one outlier at 29) |
| the scalar subquery | about 1 ms | 25 to 32 ms |

The join computes `boards_now` whole (every board, and the moves in force for each) once per query when the planner
hashes it, on every read of `thread_open`, spun or not, the thread page's one-row read included; and `boards_now` holds
a materialized step, so it cannot be turned into a primary-key probe, and a plan that nests the loop would walk every
board for every row. The subquery runs only for a row whose origin is a board play: one probe of `boards` and one read
of the moves in force (`open_moves`, a handful of rows; its materialized step runs once per query). A thread not spun
from a board play, which is nearly every thread, pays nothing, on any plan.

## What it costs on a busy instance

The issue's own note is the baseline: `origin_place` is computed for the rows an offset skips too, and offset paging on
a board is linear in the offset already (offset 2000: 47 ms before 0079, 77 ms after, on 5,000 threads). This change
adds, for each row walked whose origin is a board play, one `boards` probe and one pass over the moves in force: about
9 µs per such row as measured above (about 1,000 such rows among the 2,030 walked, 9 ms). That measurement is a bad
case on purpose, with half a board spun from board plays; a board play is one card's reach and a spin from one is rare.
The cost does not grow with players, Acts or boards. It grows with the offset, as the page already does, and with the
renames in force, which are few and short-lived (0046). Keyset paging, the "Deep board pages" item of #205, removes the
offset's cost and this share with it; it is that item's work, not this one's.

## Task 1. The view reads the board's name now (SQL)

Model: inline

**Files:** a new `supabase/migrations/NNNN_origin_place_board_now.sql` (the next free number, 0150 on this date; it is
renumbered if `main` takes it, and `node tools/check-migration-versions.mjs` says so), and
`supabase/tests/0081-origin-place.sql`, which gains a section and whose header names the new migration.

**Tests first.** A new section in `supabase/tests/0081-origin-place.sql`, after "Every origin a thread can be spun
from", with its own fixtures. It stages a card played on the board General (a `play_reach` row), spins a thread from
it, and reads the thread's place from both views through `pg_temp.place`:
- before any move: the name is `General`;
- a `renameBoard` move on General lands (a staff Boss's `move` Act, written as `supabase/tests/0051-moves.sql` writes
  one): the name is the move's, and `boards_now` gives the same name; the slug is still `general`;
- a second rename lands later: the name is the second's;
- the second is reversed (`end_move(…, 'reversed', 'admin')`): the name is the first rename's again;
- the first expires (`end_move(…, 'expired', 'tick')`): the name is `General` again;
- a rename of another board never shows in General's place.

The red run is this section against the migrations as they stand: it fails on the second assertion with the old name.

**Then** the migration: `create or replace view thread_open` as 0079 wrote it, with the `board` branch and the join
changed as above. Its header says what changed, why, and the cost above.

## Task 2. The fake API agrees

Model: inline

**Files:** `engine/ui/data/fake.ts` (`originPlace`), `engine/ui/data/fake.test.tsx`.

**Tests first.** A new test in `engine/ui/data/fake.test.tsx` beside "a thread spun from a play has the place the SQL
gives it": a thread spun from a play on General reads `name: 'General'`; after `fake.seed.move` renames the board the
same thread's row reads the new name, from `fake.thread` and from `fake.threads`' row alike, and equals
`fake.boards()`' name for that board; after `fake.seed.endMove(…, { why: 'reversed' })` it reads `General` again. The
red run fails on the renamed name.

**Then** `originPlace` reads the board through `boardNow`, and its comment names the migration that set the rule.

## What is not touched

`OriginLink`, `Origin.tsx` and `Board.tsx` draw `place.on.name` as given and do not change. The other items of #205
stay as they are.

## Review focus

- The place's name equals `boards_now`'s name for the same board at every step of a rename's life: landed, superseded
  by a later one, reversed, expired.
- `thread_open`'s columns, their order, `thread_list` and the grants on both are exactly as before the migration.
- The subquery runs only for a board play's row, and the one-row read of `thread_open` (the thread page) for a thread
  not spun from a board play does not touch `boards_now`.
- The fake and the SQL give the same place for the same steps.
