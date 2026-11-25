# A spin picks its board: plan

Record, written 2026-11-25. The plan for `docs/plans/2026-11-25-spin-board-design.md`. One build session builds it in
one PR from `main`, after the design's PR is merged.

Every task is test first: name the test, record its red run, then write the code. This plan adds no check under
`tools/`; its guards are tests.

**Migrations.** One migration, `NNNN_spin_board.sql`, taking the next free number in `supabase/migrations/` (0428 as
this is written); its SQL test takes the same number in `supabase/tests/` (`NNNN-spin-board.sql`). Each function and
view it replaces is copied from its latest definition (`grep -l "function <name>(" supabase/migrations/*.sql | tail -1`,
and for the view `grep -l "view thread_open" ... | tail -1`), and everything it does that this plan does not name stays
as written, its lock order, grants and `set search_path` included. As this is written the latest are: `spin_written`
0395, `spin` 0357, `apologize` 0130, `write_staff_spin` 0420, `thread_open` 0422, `players_board` 0339. Applying the
migration to dw.gripe is the owner's go-ahead, never the build's.

**The layers.** Everything here is the engine's. No instance file changes.

## The words this plan uses

- **Today's board** for an origin: its thread's board, or `players_board()` when that board is The System's.
- A **named board** is a board slug the caller sends; **no board** is the slug left out (null), which means today's
  board.
- **The form** is `SpinForm` (`engine/ui/spin/SpinForm.tsx`), in both its spin and apology modes.

## Task 1. The server: one rule for the board, and a board the caller names

Model: sonnet

**Files:** new `supabase/migrations/NNNN_spin_board.sql`, new `supabase/tests/NNNN-spin-board.sql`.

1. `spin_board(origin uuid) returns uuid`, `stable security definer`: today's board, exactly the `case when b.is_system
   then players_board() else b.id end` that `spin_written` and `write_staff_spin` each write now, over the same join
   (`acts a join threads t join boards b`, `a.kind <> 'edit'`); null for no such Act or an edit. Revoked from public and
   anon, granted to authenticated and service_role.
2. `spin_written` gains a last parameter `board_slug text default null` (drop the 7-argument function and create the
   8-argument one; grants as 0374 gave them: service_role only). Its board is found so:
   - The origin is checked first as now (`spin_board(origin)` null: "there is no such Act to spin from"), so a bad
     origin is told of before a bad board.
   - No board: `on_board := spin_board(origin)`.
   - A named board: `select id ... from boards where slug = board_slug`; none: "there is no such board" (P0002, the
     `kayfabb.refusal` hint, `start_thread`'s words). An `is_system` board: "a thread cannot be spun onto The System's
     board; pick another board" (42501, the refusal hint).
   - Then, for either, in `start_thread`'s order: `lock_board_start(on_board)`, `not_closed(on_board)`, and, when
     `check_bar`, `not_barred(through, on_board)` (where the bar check stands now, after the at-post check).
   Everything else (the poll and ballot checks, the at-post check, the inserts, `write_framed`,
   `write_forged_framed`, `draw_visits`, the answer) as 0395 wrote it.
3. `spin` gains `board_slug text default null` last (drop the 6-argument, create the 7-argument; grants as 0357: execute
   to authenticated, not public or anon) and passes it to `spin_written`.
4. `apologize` gains `board_slug text default null` last (drop the 5-argument, create the 6-argument; grants as 0130)
   and calls `spin_written(in_move, through, title, body, false, framing, null, board_slug)`. Its header comment's
   "onto the board it bars, if that is where the spin opens" becomes "onto the board the player picks, today's board
   if none, the bar not checked".
5. `write_staff_spin` gains `board_slug text default null` last (drop and create; grants as 0420: service_role only).
   Its board is `spin_board(origin)` when none is named, else the named board with the same two refusals as item 2
   (its own errcodes, no refusal hint, as its other refusals have none); no bar is checked. Chatter
   (`supabase/functions/chatter/core.ts:916`) is not changed: it names its arguments, and passes no board.
6. `spin_places(origin uuid, through uuid) returns jsonb`, `stable security definer`, granted to authenticated:
   `perform acting(through)`; then `{"default": <today's board's slug, or null>, "boards": [{"slug", "name", "barred",
   "until"}, ...]}`, the boards from `boards_now` where `not is_system and not closed`, ordered `created_at, id`;
   `barred` from `bars_of(through)` (read once, not once per board), `until` the latest `expires_at` of that board's bars
   or null (no end set). The name is `boards_now.name` (a rename in force shows). An origin that is no Act answers
   `default` null and the list as it is.
7. `thread_open`: `create or replace view`, the same columns in the same order, with `origin_place` wrapped so that,
   where it is not null, its kind is not `update`, and `ot.board` is not null, it is `origin_place || jsonb_build_object(
   'board', ot.board)`. `ot` is the join the view already has; add no join and no column. `thread_list` (`select *`
   over `thread_open`) is unchanged by this, since its columns are the same.

**Tests first** (`supabase/tests/NNNN-spin-board.sql`, in the style of `0298-spin-at-post.sql` and `0127-bars-
apologies.sql`, with that file's helpers for a bar where they serve):

- `spin_board`: a post on a player board answers that board; an Act on The System's board answers the first open
  board; with the oldest board closed, the next open one; an edit and a missing id answer null.
- A spin with no board lands where `spin_board` says (on a player board and from The System's board).
- A spin naming another open board lands there, and its Act and thread are as a spin's are otherwise (the `spin` Act is
  the thread's first, `origin_act_id` is the origin).
- A spin naming a missing slug, The System's board, a closed board, or a board the character is barred from is refused,
  each in its words, and writes no thread and no Act.
- A spin from a post on a board the character is barred from, naming an open board it is not barred from, lands.
- With today's board barred, a spin naming no board is refused as before (the bar's words).
- An apology naming the board it is barred from lands there, and its `apologies` row is written; an apology naming
  The System's board is refused.
- `write_staff_spin` with no board lands on today's board; naming a board lands there; naming The System's board is
  refused.
- `spin_places`: the default and the list (no system board, no closed board, in order), a barred board with its `until`
  and a bar with no end (`until` null); a call through a character not the caller's is refused by `acting`.
- `thread_open.origin_place ->> 'board'`: the origin's thread's board for a post origin, a play, a poll and a
  verdict origin; absent for an Update origin; the board of The System's board for an announcement origin.
- Every refusal raised by a named board leaves `threads` and `acts` counts unchanged.

## Task 2. The action carries the board

Model: inline

**Files:** `engine/rules/actions.ts`, `engine/rules/actions.test.ts`.

- `spin` and `apologize` take an optional `board`: absent or null, no `board_slug` argument is sent (the server's
  default); else a string that passes `SLUG` (as `startThread` checks it), sent as `board_slug`; anything else is
  refused with field `board`, "is not a board", `startThread`'s words.
- Tests first: absent, null, a good slug, a bad slug and a number, for both actions.

## Task 3. The API, the client and the fake

Model: sonnet

**Files:** `engine/ui/data/api.ts`, `web/src/data/supabase.ts`, `engine/ui/data/fake.ts`, and their tests
(`engine/ui/data/fake.test.ts` or the fake's existing spin tests, and the supabase client's tests where its spin and
place mapping are tested).

- `KayfaApi.spin(origin, character, title, body, framing?, at?, board?)` and `apologize(move, character, title, body,
  framing?, board?)`: `board` a slug, sent as the request's `board` only when given.
- `KayfaApi.spinPlaces(origin: Id, character: Id): Promise<SpinPlaces>`, with `SpinPlaces = { readonly default: string
  | null; readonly boards: readonly { readonly slug: string; readonly name: string; readonly barred: boolean; readonly
  until: string | null }[] }`. The supabase client reads it by `client.rpc('spin_places', ...)`; a failed read throws,
  as the client's other reads do.
- `OriginPlace` gains `board?: Id` on every kind but `update` (an intersection on the union, so each branch keeps its
  shape); the client maps `origin_place.board` where it maps the rest of the place.
- The fake mirrors Task 1: a `spinBoard(origin)` beside `spin` (the code at `fake.ts:1844`, which it replaces); a named
  board checked for existence, The System's, closed and (spin, not apology) barred, in the server's words; `apologize`
  and `spinPlaces` the same; its thread places carry `board` as `thread_open` does.
- Tests first: the fake's spin with and without a board, each refusal, `spinPlaces`, and an origin place's `board`.

## Task 4. One `useBoards`

Model: haiku

**Files:** new `engine/ui/boards.ts`; `engine/ui/search/SearchScreen.tsx`.

- Move `useBoards` (`SearchScreen.tsx:210`, boot's boards, else one read of `api.boards()`) to `engine/ui/boards.ts`,
  exported, and import it in the search screen. Add `useBoardName(): (id: Id) => string | null` beside it, a lookup
  over the same list.
- No behavior changes: the search screen's tests stay green, which is this task's proof.

## Task 5. The Board field

Model: sonnet

**Files:** `engine/ui/spin/SpinForm.tsx`, `engine/ui/spin/spin.css` if a rule is needed, `engine/ui/spin/Spin.test.tsx`,
`engine/ui/spin/Spin.stories.tsx`.

The board world, house style: a native `<select>` with the form's other fields' look (`kb-field`, `kb-input`), labeled
**Board**, first in the form, above "Thread title".

- On mount the form reads `api.spinPlaces(origin, hudCharacter.id)`, and again when the HUD's character changes (the
  bars are the character's). While it reads, the select is disabled and holds one option, "Loading boards…".
- The options are the list in its order, each its name. A barred board, in a spin, is a disabled option reading
  "{name} (barred until {YYYY-MM-DD HH:MM} UTC)", the time rounded up to the minute as `not_barred` words it, or "{name}
  (barred until a time not yet set)" with no end. In an apology every board is enabled and reads its name alone.
- The select starts on `default`. In a spin where the default is barred, it starts on a first, empty option ("Pick a
  board"), and a note under it reads "{character} is barred from posting on {board} until {time}. Pick another board.";
  the button is disabled until a board is picked. Where no option is choosable, the note reads "{character} is barred
  from posting on every board right now." and the button stays disabled.
- A failed read: the select is replaced by a plain line, "The boards could not be read. The thread will open where
  spins open by default." and the spin is sent with no board, so a failed read never stops a spin.
- Sending: the chosen slug is passed as `board` to `api.spin` or `api.apologize`; when the choice is the default it is
  still sent (the player saw it and kept it). A refusal naming the board shows in the server's words, as any other.
- The draft (`SpinDraft`) gains `board?: string`, so a remount keeps the choice as it keeps the title.
- Tests first (`Spin.test.tsx`, on the fake): the field starts on the origin's board; a spin from an Act on The System's
  board starts on the first open board; picking another board lands the thread there and the player is taken to it;
  a barred board is disabled and worded; a barred default starts empty with its note and a disabled button; every
  board barred; in an apology the barred board is choosable and the apology lands on it; a failed read sends no board
  and the thread lands on the default; the choice survives a remount through the draft; the select has its label and
  is reachable by keyboard.
- Stories: the field on a post, with a barred board, and in an apology.

## Task 6. "on {Board}" where a spin crossed boards

Model: sonnet

**Files:** `engine/ui/spin/SpunInto.tsx`, `engine/ui/spin/OriginLink.tsx`, their callers (`engine/ui/thread/Post.tsx`,
`engine/ui/polls/Poll.tsx`, `engine/ui/board/Board.tsx`, `engine/ui/spin/Origin.tsx`), and their tests
(`engine/ui/spin/Spin.test.tsx`, `engine/ui/spin/poll-origin.test.tsx`, the board's tests).

- `SpunInto` takes `here: Id | null`, the board being read (the post's thread's board; null where none is known). An
  entry whose `board` is not `here` reads "{title} (on {Board}, {n} replies)", the board's name from `useBoardName`;
  an entry on `here`, or whose board's name is not known, reads as now.
- `OriginLink` takes `here: Id | null`, the spun thread's own board. Where `place.board` is set and is not `here`, and
  its name is known, the phrase ends " on {Board}", plain text, inside the same sentence. The board's row passes the
  board it lists; the ORIGIN box's head passes the summary's board.
- Tests first: a spin onto the same board reads as now in both places; onto another board names it in both; a spin
  from The System's board names that board; a spin from an Update names none; an unknown board id reads as now.

## Filed for later

- The persona's choice of board when chatter spins (design, section 4): #1110.

## Review focus

- `thread_open` is replaced whole: a branch of `origin_place` dropped or changed in the copy would change every thread's
  origin silently; compare the new view's text with 0422's line by line, `board` being the only difference.
- The cold-read budget (`supabase/tests/e2e/0028-cold-read-budget.ts`): the `||` on `origin_place` must add no join; run
  the budget test and compare.
- Dropping and recreating `spin`, `apologize`, `spin_written` and `write_staff_spin`: any caller with positional
  arguments (the `apologize` call into `spin_written`, any other function or test calling them) must be found
  (`grep -rn "spin_written(\|apologize(\|write_staff_spin(" supabase`), and every grant restored as it was.
- A spin on a busy instance: `spin_places` reads `bars_of(through)` once, not per board; a board list of dozens is the
  whole read.
- Masks: `spin_places` answers only public facts for a character the caller acts through; no response or refusal
  differs with who owns a board, a bar or the origin.
- Lock order: the named board's `lock_board_start` is taken where `spin_written` took none before (the
  `threads_on_open_board` trigger took it on insert); a closing move on that board meets it as `start_thread`'s does.
