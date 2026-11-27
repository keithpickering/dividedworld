# Live lists and the player's own state: plan

Record, written 2026-11-25. The plan for `docs/plans/2026-11-25-live-lists-and-self-design.md`. One build session
builds it in one PR from `main`, after the design's PR is merged.

Every task is test first: name the test, record its red run, then write the code. The one check this adds is the SQL
test in Task 2 that holds every Act kind to a classification, driven red once by an Act kind added to
`acts_kind_check` and listed in neither set.

**Migrations.** One migration, `NNNN_live_lists_and_self.sql`, taking the next free number in `supabase/migrations/`
(0426 as this is written); its SQL test takes the same number in `supabase/tests/` (`NNNN-live-lists-and-self.sql`).
`masks_change` is copied from its latest definition (`grep -l "function masks_change" supabase/migrations/*.sql | tail
-1`: `0100_announce.sql` as this is written) and changes only as Task 1 says. The realtime policy follows the
fail-closed pattern of `0008_realtime.sql` and `0061_account_channel.sql`. Applying the migration to dw.gripe is the
owner's go-ahead, never the build's.

**The layers.** Everything here is the engine's (`supabase/`, `engine/ui/`, the adapter in `web/src/data/`). No
instance file changes.

## The words this plan uses

- A **seq Act** is an Act with a thread and a place number (`acts.seq is not null`): what bumps a thread in
  `thread_list`.
- A **row** is one `thread_list` row as `board_page` lists it (`to_jsonb(l)` over `thread_list`,
  `0328_board_review_fixes.sql`), and a **board summary** one entry of `index_page`'s `boards`
  (`0326_board_stubs.sql`).
- A **poke** is the `self` event on `account:<id>`: an empty payload.

## Task 1. `row` on the board, `board` on the index (SQL)

Model: sonnet

**Files:** the migration; its SQL test.

- `thread_row(in_thread uuid) returns jsonb`: the row as `board_page` lists it, or null for a thread `thread_list`
  does not list. `board_summary(in_board uuid) returns jsonb`: the board's entry as `index_page` builds it, the same
  keys (`id`, `slug`, `name`, `description`, `is_system`, `move_act`, `thread_count`, `last_at`, `last_character`,
  `last_thread`, `last_title`), or null for a closed board. Both `security definer`, revoked from `public, anon`, no
  grant to `authenticated` (only the trigger calls them). Where the board page or the index can reuse either, leave
  them as they are: this task does not rewrite the readers.
- `acts_live_lists()`, a trigger function after insert on `acts` `for each row when (new.thread is not null and
  new.seq is not null)`: `broadcast_later('board:' || board, 'row', thread_row(new.thread))` and
  `broadcast_later('index', 'board', board_summary(board))`, each skipped when its projection is null.
- `masks_change` from its latest definition, with its `broadcast_later('board:' …, 'thread', …)` removed and nothing
  else changed (the first Act of the thread it makes fires the trigger).
- The policy "signed-in players hear the board" (`0008_realtime.sql`) is dropped and made again with `or
  realtime.topic() = 'index'` added, inside the same fail-closed block.

**Tests first** (`supabase/tests/NNNN-live-lists-and-self.sql`, against local Postgres with the auth shim):
- a post in a thread queues one `row` on `board:<board>` whose payload equals that thread's row from `board_page`, and
  one `board` on `index` whose payload equals that board's entry from `index_page`;
- an edit, a tally and a reaction (no seq) queue neither;
- the `row` payload has no key named `views` or containing `view`, and none of `reading`, `owner`, `account`;
- `masks_change` queues no `thread` event on a board topic;
- the policy lets a signed-in role select an `index` message and still refuses `account:<another id>`.

## Task 2. The poke (SQL)

Model: sonnet

**Files:** the migration; its SQL test.

- `poke_self(in_account uuid)`: `broadcast_later('account:' || in_account, 'self', '{}'::jsonb)`.
- A trigger after insert on `wallet_events` `when (new.kind <> 'settlement')`: `poke_self(new.account)`.
- A trigger after insert on `card_ledger`: `poke_self(new.account)`.
- `self_kinds()` returns the Act kinds that can change what `my_characters` shows (`supabase/migrations/0402_thread_lockout.sql`,
  the view's latest definition at the time of writing): read the view and the functions it calls (`banned_until`, `bars_of`,
  `warn_points` through `live_infractions`, `class_history`, `pending_turns`, lockouts) before fixing the list. As this
  is written it is at least `infraction`, `ban`, `move` (a move that names `params.character`), `move_end`,
  `card_end`, `appeal_ruling`, `reveal`, `spring` (a lockout). `quiet_kinds()` returns every other kind in
  `acts_kind_check`. Rows written to tables other than `acts` that change the view (`ban_lifts`, `warn_reliefs`, a
  `class_history` row written by a Turn outside a settlement) get their own insert triggers, each found by that read.
- `acts_self()`, after insert on `acts` for the kinds in `self_kinds()`: resolves the character the Act changes (its
  `payload ->> 'character'`, its `payload #>> '{params,character}'`, or the character of the Act it ends or rules
  on), then `poke_self` the owner's account. An Act whose character cannot be resolved pokes no one.

**Tests first:**
- `grant_aura` queues one `self` on its account and none on any other; a settlement (`apply_settlement` with an entry
  for the account) queues none;
- a `card_ledger` row for an account queues one `self` for it;
- for each kind in `self_kinds()`, a fixture Act on a character queues `self` on its owner's account alone;
- **the check:** the kinds parsed from `acts_kind_check`'s definition (`pg_get_constraintdef`) equal `self_kinds() ∪
  quiet_kinds()`, and the two sets do not overlap. Drive it red by adding a kind to the constraint inside the test's
  transaction and listing it in neither, record the failure, then roll back.
- the `self` payload is `{}`.

## Task 3. The adapter and the fake (web, engine)

Model: sonnet

**Files:** `engine/ui/data/api.ts`, `web/src/data/supabase.ts`, `web/src/data/supabase.test.tsx`,
`engine/ui/data/fake.ts`, `engine/ui/data/fake.test.tsx`, `web/src/data/fixtures/boards.ts`.

- `BoardListener` becomes `{ onRow?: (row: ThreadSummary) => void }`; `onThread` goes. `subscribeBoard` joins
  `board:<id>` for `['row']` and maps the payload with `toThread`.
- `IndexListener { onBoard?: (board: BoardSummary) => void }` and `subscribeIndex(listener)`, joining `index` for
  `['board']` and mapping with `toBoardSummary`. Add `subscribeIndex` to the fake's `NOT_PROMISED`.
- `AccountListener` gains `onSelf?: () => void`; `subscribeAccount` joins `account:<id>` for `['alert', 'self']`.
- The fake sends `row` and `board` on every seq Act it writes (where it sends `act` on the thread, `fake.ts` near
  `send(\`thread:…\`, 'act', …)`), drops its `thread` board event, and sends `self` where it moves a wallet (any kind
  but settlement) or a hand, or writes an Act of a kind the SQL lists in `self_kinds()`.

**Tests first:** in `supabase.test.tsx`, the existing `subscribeBoard` tests rewritten for `row`; one each for
`subscribeIndex` and `onSelf`, with the channel names and events asserted. In `fake.test.tsx`, a post reaches
`onRow` and `onBoard`, and a grant-like wallet move reaches `onSelf`.

## Task 4. The thread list goes live (engine UI)

Model: sonnet

**Files:** `engine/ui/board/Board.tsx`, its stylesheet, its tests and stories.

- `BoardView` subscribes with `api.subscribeBoard(boardId, { onRow })`. A row whose thread is on the page replaces
  that row's fields in place and never moves. A row whose thread is not on the page, or whose `lastAt` is later than the
  row shown above it, is added to a set of waiting thread ids (pins and stubs excepted; a thread on the page that later
  arrives in place is still counted if its order would change).
- The bar: above the list, inside the board's content, `role="status"`, "1 thread has new posts" / "N threads have
  new posts", and a **Show** button that calls the router's `navigate` to the address shown (with `replace`), which
  reads the page document again and clears the set. Look in the house style: the classic table's own bar, black and
  white, no color. Focus stays where it was; nothing scrolls.
- NEW on a row is computed from the reader's reading row against the row's `lastSeq`, as the page already does on load.
- A character named by a row and not in `characters` is read once by id, as `Board.tsx` does for a live play
  (`setExtra`).

**Tests first:** a row on the page updates its replies and Last post without moving; a row for a thread off the page
shows the bar with "1 thread has new posts", a second makes it "2 threads"; the same thread twice counts once; Show
re-reads and the bar goes; a row for a pinned thread updates the pin's row and shows no bar; NEW appears on a row
whose new `lastSeq` passes the reader's own reading. An axe pass over the list with the bar shown.

## Task 5. The index goes live (engine UI)

Model: sonnet

**Files:** `engine/ui/index/Index.tsx`, its tests.

- `IndexScreen` subscribes with `api.subscribeIndex({ onBoard })`. A board on the page takes the summary's count and
  Last post in place; a board not on the page navigates to `/` with `replace` (reads the index again). A Last-post
  character not in `characters` is read once by id.

**Tests first:** a summary for a listed board updates its count and Last post in place; one for an unlisted board
reads the index again; a character not known is read once and its name shown.

## Task 6. The HUD hears its own state (engine UI)

Model: sonnet

**Files:** `engine/ui/player.tsx`, its tests; `engine/ui/alerts/useAlertFeed.ts` only to export what is shared.

- `PlayerProvider` subscribes for the signed-in account: `api.subscribeAccount({ onSelf })` and
  `api.subscribeReach({ onSettled })`. `onSelf` schedules one `refresh` about 300 ms later, joined by any poke that
  arrives meanwhile (a trap's wallet move and its card's ledger row come together). `onSettled` schedules one
  `refresh` at a random moment within `REACH_SPREAD_MS`, joined the same way. A refresh already in flight absorbs a
  poke that lands during it by running once more after it, never twice at once. Both are dropped when the account
  changes, as the estimate's cache is.
- Nothing else changes: the orbs' cascade from `walletSeen` already plays when the balance moves.

**Tests first** (with the fake): a grant-like wallet move moves the HUD's wallet with no action by the player; three
pokes inside the debounce run one read; a `settled` runs one read within the spread (fake timers); a poke for a signed
out session reads nothing.

## Task 7. Words and records

Model: inline

**Files:** the header comments of `Board.tsx` (it says the list is in bump order and read once), `Index.tsx` and
`player.tsx` (what keeps each current); `docs/plans/2026-10-29-screens-design.md` is a record and is not edited.

## Review focus

- A busy board's readers each get a `row` per post: confirm the trigger projects one row and one summary per Act and
  that nothing in it scans a board's threads.
- The `row` payload is `to_jsonb` over a view: a column added to `thread_list` later is broadcast to every signed-in
  reader. Confirm the payload test would catch a private one, and that the keys list in the test is the gate.
- `self_kinds()`: an Act kind that changes a player's characters but was put in `quiet_kinds()` leaves the HUD stale
  without failing anything. Read each choice against `my_characters`.
- A poke's timing reaches only its owner; confirm no `self` is ever queued on a topic other than `account:<owner>`.
- A board move (a thread moved to another board): whether the old board's list shows a stale row until a reload, and
  whether the move should send `row` to both boards (design, section 8).
- The board bar's count with a thread on page 2 that is bumped to the top of page 1: it counts on page 1 and on page 2,
  and pressing Show on page 2 leaves the reader on page 2.
