# The staff's board as a staff keeps one: plan

Record, written 2026-11-24. Carries out `docs/plans/2026-11-24-staff-board-threads-design.md`; read it first, and
CLAUDE.md.

**Before Task 1.** The file and function names below are main's as of b61309b. Each migration is the next free number at
build time, named for its task (`NNNN_turns_announced_at_once.sql` and so on); its SQL tests are
`supabase/tests/NNNN-<slug>.sql`, in the style of `supabase/tests/0188-handoffs.sql` (`pg_temp.expect`,
`pg_temp.refusal`). A function re-created in a migration is copied from its latest definition named here, never from an
older one. Where a later merge has redefined one, the build session works from main's latest and keeps this plan's
decisions.

## The words this plan uses

- **An announcement:** the character's own `announce` Act for a Turn. **Ahead:** an announcement written before its Turn
  takes effect (payload `ahead: true`); every announcement this plan writes is ahead. Old ones (written at a settlement)
  are not.
- **Committed:** a queued Turn whose announcement is written (`pending_turns.announce_act` not null).
- **A staff thread:** a thread the staff opens on the system board (`threads.staff_placed`).
- **A move thread:** the staff thread a landed move opens, or joins when it is part of a bundle whose earlier part opened
  one.
- **The Roster Report:** the season's thread (`seasons.turns_thread`) and the Boss's entries in it.
- **The minutes:** the Boss's post in the season's Staff Meetings thread (`seasons.meetings_thread`).

## Task 1. Turns are announced at once and committed (SQL)

Model: sonnet

**Files:** migration `NNNN_turns_announced_at_once.sql`; tests `supabase/tests/NNNN-turns-announced-at-once.sql`, and
updates to `0021-pending-turns`, `0102-announce`, `0149-reveal-once`, `0394-reveal-perk`, `0077-settle-claim`.

- `pending_turns` gains `announce_act uuid references acts(id)`. `class_history` gains `announce_act uuid references
  acts(id)` (granted to `authenticated` beside its other columns, 0001:295).
- **`turn(through, to_class, loudness, show_from, show_to, in_thread uuid)`** replaces the five-argument `turn`
  (latest `0074_settle_claim.sql:162`); the three-argument shim (0028:253) and the five-argument function are dropped,
  and the grants (0028:260) move to the new one. Every refusal of 0074 stays, in its order. Then:
  - A committed pending Turn refuses any change: "that Turn was announced, so it stands until it takes effect at
    <refusal_time(next settlement)>" (42501, `kayfabb.refusal`).
  - `announced` requires `in_thread`; `silent` refuses one ("a silent Turn is posted nowhere").
  - The thread's checks are `unmask`'s (latest `0155_two_refusals.sql:18-45`): it exists, `not_the_systems` on its
    board, `not_locked_out`, `not_closed`, `not_barred`. Copy them in the same order, so the refusals read the same.
  - Announced: the pending row is written, then `write_announce(through, in_thread, 'turn', was, cls, clock_timestamp())`
    with `ahead: true` added to its payload, and its id stored in `pending_turns.announce_act`. `was` is
    `class_now(through, now)` when `show_from`; `cls` is `to_class` when `show_to`.
  - The answer gains `announcement` (the act projection) beside today's fields.
- **`announce_turn(through, in_thread, show_from, show_to)`** (new): a silent pending Turn is announced and committed, by
  the same thread checks and the same write; it refuses with no pending Turn ("no Turn of that character is waiting"),
  with a committed one ("that Turn was announced already"), and with both `show_` false allowed (a plain "has Turned").
- **`withdraw_turn`** (0007:187) refuses a committed Turn with the same words as the change.
- **`write_announce`** (0100:151) takes `ahead boolean default false` and adds it to the payload when true.
- **`acts_well_formed`** (latest `0402_thread_lockout.sql:464`): a new `announce` must be `what = 'turn'` ("a debut is
  no longer announced"; Acts already written are untouched, the check is on insert). An `announce` naming `class` with
  `ahead` must name the class of its character's pending Turn; without `ahead`, the class held, as today.
- **`masks_change`** (latest `0100_announce.sql:192`): the Turns half inserts `class_history (character, class_key,
  started_at, due_at, announce_act)` from the pending row's `announce_act`. A committed Turn writes no Act. A pending row
  with `loudness = 'announced'` and no `announce_act` (queued before this migration) is written the old way, in
  `promos_thread`, as today: the changeover. The debut half is removed in Task 2; leave it until then.
- **`class_reveals`** (0100:276): an `announce` with `class` and `ahead` is read through `class_history` on
  `announce_act`, its `at` that row's `started_at`; one with no such row (the Turn has not landed, or never will) is not
  a reveal. An `announce` without `ahead` is read as today. **`turns_announced`** (0100:285) the same way: an ahead
  announcement's `at` is the landing's `started_at`, and it is listed only once landed.
- **The backfill:** `class_history.announce_act` is set for each old `announce` turn Act whose character has a
  `class_history` row starting at that Act's `created_at`, so one join reads old and new alike. `class_history` is not an
  Act table; this is the one update, in the migration.
- `my_characters` (latest 0402:2103) exposes the pending Turn's `announce_act` and its thread and seq.
- `retire_character` (0205:393) deletes a pending Turn, committed or not: retiring ends everything, the announcement
  stays as written, and it is never read as a reveal, because no `class_history` row links it.

**Tests first.** A Turn announced in a thread writes one `announce` Act there at once with `ahead`, and commits; a change
and a withdrawal of it refuse with the words above; a silent Turn changes and withdraws as today, and `announce_turn`
announces and commits it; an announcement in a thread on the system board, a locked thread and a closed thread refuse as
`unmask` does. `class_reveals`: an ahead announcement naming the new class is not a reveal before the settlement and is
one, dated the settlement, after; `0394-reveal-perk`'s perk starts at the settlement. `masks_change` writes no Act for a
committed Turn, and writes the old Act for a pre-migration announced row. `acts_well_formed` refuses a new debut
`announce` and an ahead `announce` naming a class other than the pending one. Retiring a committed character leaves no
reveal. Red first.

## Task 2. No debuts: a character is made active (SQL)

Model: sonnet

**Files:** migration `NNNN_no_debuts.sql`; tests `supabase/tests/NNNN-no-debuts.sql`, updates to `0031-debuts`
(retired to the changeover's cases), `0005-default-deny`, `0305-veil-sweep`.

- **`create_character(name, class, pronouns jsonb default null)`** replaces the five-argument one (latest
  `0377_sealed_packs.sql:469-511`): `debuted_at = now()` always, no announcement. The answer drops `waiting`,
  `loudness` and `announcement`. Grants as 0124:127.
- Dropped: `set_debut`, `debut_options`, `announce_drop`, and their grants. The debut half of `masks_change` goes (the
  characters made before the window's end and waiting, and the owed announcements).
- **The changeover:** `update characters set debuted_at = now() where debuted_at is null and staff is null and
  retired_at is null`; staff personas keep their seeding (`seed_instance` sets theirs). `debut_announcement_due` and
  `debut_loudness` are dropped once no function reads them: the build session greps the latest definitions and the
  export and import tool (`supabase/functions/_shared/` and `tools/`) and removes each reader in this migration.
- `played_by`'s waiting refusal (0340:1507) stays: a staff persona can still be waiting.

**Tests first.** A new character is active at once and writes no Act; `set_debut` is gone (the default-deny list names
it no more, `0005`); a waiting player character is active after the migration; a settlement writes no debut. Red first.

## Task 3. The client: creation, Turns and the shared thread picker (engine UI)

Model: sonnet

**Files:** `engine/rules/actions.ts` (`createCharacter` :341, `setDebut` :348, `debut()` :208, `turn` :283, new
`announceTurn`), `engine/ui/data/api.ts` (`createCharacter`, `setDebut` gone, `turn` gains `thread`, `announceTurn`,
`PendingTurn` :1372 gains `announced: { act: Id; thread: Id; seq: number } | null`), `web/src/data/supabase.ts`
(:2407-2413), `supabase/functions/act/core.ts` and its test, `engine/ui/data/fake.ts` (:3141, :3154, :3170, :3183,
:5850-5878), `engine/ui/characters/` (`NewCharacter.tsx`, `DebutChoice.tsx` and `DebutDialog.tsx` deleted,
`TurnDialog.tsx`, `RevealOverlay.tsx`, a new `ThreadPicker.tsx`, `Characters.tsx`, `footers.ts`, `previews.ts`),
`engine/ui/frame/Hud.tsx`, `engine/ui/thread/lines.tsx`, `engine/ui/log/Settlement.tsx`; the tests beside each.

- **`ThreadPicker`** (new, glass): the board `<select>` and the `GlassCombobox` of threads lifted out of
  `RevealOverlay.tsx:46-101` unchanged, with props `{ value, onChange, boards?: (b) => boolean }`. `RevealOverlay` uses it.
- **`TurnDialog`** takes `at?: { id, title, board } | null` as `RevealOverlay` does. Announced shows the picker (or "It
  will be posted in this thread." when `at` is given), and its foot says: "Once announced, this Turn can't be changed or
  withdrawn. It takes effect at the next settlement." `submit` passes the thread. A silent Turn shows no picker.
- **Announce later:** `Characters.tsx`'s `turnCell` (:230-265) shows, for a silent pending Turn, Change, Withdraw and
  Announce (opening `TurnDialog` in an announce mode that keeps the class and asks only what to name and where); for a
  committed one, no button and the line "Announced in <thread link>. Takes effect <time>."
- **The HUD** (`Hud.tsx`) gains a Turn opener beside Reveal (:670), opening `TurnDialog` with `at={openThread}`.
- **`previews.ts`:** `turnPreview`'s `where` is "At once, in <thread>" (announced) or "Nowhere: a silent Turn is posted
  nowhere"; `debutPreview` goes; "own Promo" goes everywhere (`own()` :28 and its callers).
- **`NewCharacter.tsx`:** no `DebutChoice`, no timing or loudness; `newCharacterFooter` and `debutFooter` lose their
  debut lines. `Characters.tsx` drops the debut mounts (:415-416) and its "waiting" state.
- **`lines.tsx` `announceWords`:** an ahead Turn adds a second sentence, "It takes effect at the next settlement." Old
  Acts read as today, debuts included.
- **`Settlement.tsx`** (:153): "It was announced in <thread>{, with the old class,}." in place of "own Promo announced
  it"; `turnsTaken` (`log/lines.ts:311`) still matches by `at`, which Task 1 made the landing time.

**Tests first.** `previews.test.tsx`, `TurnDialog` (new `TurnDialog.test.tsx` if none): announced requires a thread and
says it commits; silent shows no picker. `Characters.test.tsx`: a committed Turn shows no Change or Withdraw; a silent
one shows Announce. `NewCharacter.test.tsx`: no debut fields; the request carries name, class and pronouns only.
`lines.test.tsx`: an ahead announcement's two sentences. `actions.test.ts`: `turn` with announced and no thread is
refused before the call. `fake.test.tsx` follows each. axe on the dialogs as the existing tests do. Red first.

## Task 4. Staff threads, and each move in its own (SQL)

Model: sonnet

**Files:** migration `NNNN_move_threads.sql`; tests `supabase/tests/NNNN-move-threads.sql`, updates to `0053-tick`,
`0056-succession`, `0103-describe-board`, `0126-group-moves`, `0131-group-appeals`, `0185-bundles`, `0188-handoffs`,
`0308-setting-thread`, `0403-departed-handover`, `0407-system-threads`, `0068-season-news`, and
`supabase/tests/e2e/0002-actions.ts`.

- **`threads.staff_placed boolean not null default false`**, with a partial index `threads (id) where staff_placed`.
- **`open_staff_thread(staff_key text, title text) returns uuid`** (service role only): a thread on `system_board()`
  with `staff_placed`, the title cut to `titleMaxLength`. It writes no Act; the caller's first `write_staff_act` takes
  seq 1.
- **The flag:** `system_thread_rows()` (0407:17) adds every `staff_placed` thread and `seasons.meetings_thread` (Task 6
  adds the column; this migration may add it first). `thread_place` and `thread_places_computed` (0407:36, :72) read
  `t.staff_placed` directly beside `system_threads()` so the set-based placement keeps its anti-join small: the
  settings' threads and the seasons' threads stay in the array; staff threads are read by the column. `lasting_move_problem`
  refuses a `moveThread` naming a staff thread.
- **`move_thread_title(kind, params, staff)`** fills the instance's `systemThreadTitles ->> kind` with the tokens
  `system_line` (latest `0209_award_trophy_words.sql:3-60`) fills, falling back to `systemMoveWords` when the instance has
  no title for the kind.
- **`system_tick`** (latest `0403_departed_personas.sql:579-917`): a landing no longer needs `ann`. The thread is: for a
  bundle part, the thread of the bundle's earliest landed part (`queued_moves.landed_act` of the same `bundle`); else a
  new staff thread opened by `due.staff` under `move_thread_title`. The move Act is written there. `ann`, the
  `enabled and ann is not null` gate (:635) and `noThread` (:916) go: the gate is `enabled`.
- **`write_describe`** (0101:161): with no move, the admin's description opens a staff thread by the current Boss titled
  as `renameBoard`'s title for that board, whose first post is the `boardDescription` stock line, and the `describe` Act
  follows it.
- **`hand_over`** (0403:89): opens a staff thread by the arriving Boss titled `handoverThreadTitle` (tokens `{boss}`,
  `{season}`); the farewell (`say_farewell`, 0403:61) and the arrival (`say_in_announcements`, 0082:233, renamed
  `say_in_thread(speaker, line_key, in_thread)`) are written there, farewell first. `season_handovers` gains `thread
  uuid`. `season_news` (0403:372) finds the quote in that thread, falling back to `ann` for handovers recorded before.
- **Unchanged, by design:** `end_move`, `say_move_end`, the `move_keep` write, `reverse_move`, `open_appeal` and
  `close_appeal` already write into the move Act's thread.
- **`seed_instance`** (latest `0413_rewind.sql`): a fresh instance opens no announcements thread; an instance that has
  one keeps it, and it stays in `system_thread_rows()`.

**Tests first.** A landed move opens a staff thread on the system board, with the move at seq 1, titled by its kind; a
bundle's second part lands in the first's thread; its end, keep, appeal and ruling follow it there; a handover opens a
thread with the farewell then the arrival; an admin description with no move opens its own thread; the announcements
thread takes nothing new. The flag: moving the system flag carries every staff thread (`0407`'s pattern); a `moveThread`
naming a staff thread is refused. A staff thread is never counted in `board_thread_counts`. The System off: nothing lands
(as today). Red first.

## Task 5. Board cards land on their board (SQL, engine UI)

Model: sonnet

**Files:** migration `NNNN_board_cards_on_their_board.sql`; tests `supabase/tests/NNNN-board-cards.sql`, updates to
`0060-card-reach`, `0094-card-end`, `0308-setting-thread`, `0135-face-down-moves`; `engine/rules/actions.ts` (`played()`
:138), `engine/ui/cards/PlayForm.tsx`, `engine/ui/board/Board.tsx` (`BoardBanner` :225), `engine/ui/thread/Thread.tsx`,
`engine/ui/thread/Post.tsx`, `engine/ui/data/fake.ts` (`playBeyond` :2890), `web/src/data/supabase.ts`, the act edge
function; tests beside each.

- **`play_card`** (0374:619) and **`place_cast`** (latest `0413_rewind.sql:1002`) take `in_board_thread uuid default
  null`. The board branch (0413:1310-1324) requires it: the thread exists and is placed on the target board
  (`thread_place`), and `not_locked_out(caster, it)`. Its refusals: "pick a thread on <board> to play it in" and "start a
  thread on <board> first" when the board has none. A board card on the system board is allowed as today, in a staff
  thread on it.
- **`lay_sprung`** (0360:374) and **`spring_facts`** (0411:1675): a sprung board card lands in the thread its `set` was
  laid in when that thread is on the target board, else in the target board's most recently active thread
  (`thread_list` by `last_at`); a board with no thread cannot take it (as a missing announcements thread could not,
  0411:1812).
- **The client:** `played()` carries `boardThread` for the board reach. `PlayForm` shows `ThreadPicker` (Task 3)
  limited to the target board, defaulting to the open thread when it is on that board.
- **Shown in its thread:** a board card played in a thread draws one line ("Spritey played Fog on Help", the log's words,
  `log/lines.ts:208`) under the newest post at the moment it was played, with its reactions, and a Spin from it. The
  thread's page read (`thread_page`, latest `0396_poll_reads.sql:180`) returns the thread's board-card Acts whose
  `created_at` falls between the page's first and last post; `Thread.tsx` places each under the newest post before it.
  The banner (`Board.tsx:225`) is unchanged.

**Tests first.** A board card with a thread on its board lands there; with none, or with a thread on another board,
refuses with the words above; a sprung board card follows the rule above; `0308`'s board card no longer lands in the
announcements thread. UI: `PlayForm` asks for a thread for a board reach and defaults it; `Thread.test.tsx` draws the
line under the right post on the right page. Red first.

## Task 6. The meeting's minutes (engine, Edge Function, SQL)

Model: sonnet

**Files:** `engine/system/meeting.ts` (`fieldRules` :163, `MEETING_PARTS` :247, `meetingSystemPrompt` :403,
`repairAnswer` :1463-1483, `RepairedAnswer` :796), `supabase/functions/meet/core.ts` (`PART_TOKENS` :163, the payload
:457-502), migration `NNNN_minutes.sql` (`apply_meeting`, latest `0415_chattier_staff.sql:752-1206`); tests
`meeting.test.ts` (:1363 field list, :1593), `meet/core.test.ts`, `supabase/tests/NNNN-minutes.sql`, `0193-meeting-parts`.

- `minutes: { type: 'string', optional: true }` in the `self` part; `MINUTES_MOST = 600`. The repair trims it to 600
  without splitting a surrogate pair, recording `{ path: 'minutes', predicate: 'maxLength(600)', before, after }`; blank
  is null. The prompt, beside memory and profile: "minutes: a few lines, in your voice, on the meeting you just held,
  for the board to read. Say what was argued and decided as you see it. It is posted as written, and decides nothing."
  The `self` ask names it. `PART_TOKENS.self` rises by 300.
- `seasons.meetings_thread uuid` (if Task 4 has not added it) and **`meetings_thread(in_season)`**, written as
  `promos_thread` (0100:135) is, titled `copy_of('meetingsThreadTitle', number)`, nets the board count as 0063's trigger
  does for `turns_thread`.
- `apply_meeting` posts the minutes, when given, after the moves are queued: `write_staff_act(boss, 'post',
  meetings_thread(season_id), null, {body})`, within `postMaxLength`. An already-applied meeting posts nothing again. The
  record gains `minutesPosted`.

**Tests first.** `meeting.test.ts`: the field-list test names `minutes` in `self`; a 700-character minutes is trimmed
with its trim recorded; the prompt names it. `core.test.ts`: the payload carries minutes; the self part's token cap.
SQL: `apply_meeting` with minutes opens the season's Staff Meetings thread once and posts in it as the Boss; without
minutes, nothing; a second apply posts nothing. Red first.

## Task 7. The Roster Report (engine, Edge Function, SQL)

Model: sonnet

**Files:** migration `NNNN_roster_report.sql`; `engine/system/roster.ts` (new) and `roster.test.ts`;
`engine/system/duties.ts` (`DUTIES` :9, `DUTY_SPECS` :18); `supabase/functions/settle/core.ts` (`runSettlement` :68-120)
and `settle/handler.ts`, their tests; `instances/divided-world/system/index.ts` (:33 duty assignment); tests
`supabase/tests/NNNN-roster.sql`, `0068-season-news.sql`; `engine/ui/season/Season.tsx` and its test;
`engine/ui/data/fake.ts`.

- **Tables** (append-only, guarded as `handoffs` is, 0337:47-58): `roster_entries (window_end timestamptz primary key,
  season, posted_at, acts uuid[], record jsonb)` and `roster_seen (character primary key, window_end, act uuid)`.
- **`roster_facts(window_end)`** (service role; reads `acts_public`, `characters_public`, `class_history`, never `acts`
  or `reactions`): for the window `(previous settlement's end, window_end]`:
  - **newcomers:** non-staff characters with no `roster_seen` row whose earliest `acts_public` row (character not the
    anonymous stand-in) is before `window_end`, each with that Act's thread and seq. Candidates are probed one by one
    through `acts_character (character, created_at)`; at a busy instance the never-acting characters stay candidates
    and cost one index probe each per settlement.
  - **announced:** ahead `announce` Acts in the window, with name, `was`, `class`, thread, seq.
  - **landed:** `class_history` rows starting at `window_end` with `announce_act`, with the announcement's thread and seq.
  - **reveals:** `unmask` Acts in the window.
- **`write_roster_entry(window_end, newcomers uuid[], bodies text[], record jsonb)`** (service role): returns at once if
  the entry exists; writes each body as the current Boss's `post` in `promos_thread(season)`, inserts `roster_seen` for
  the newcomers (on conflict nothing) and the entry. No Boss, or the System off: the entry is written with no posts and
  `record.skipped`.
- **`roster_due()`**: applied settlement windows of the open season with no entry, oldest first.
- **`engine/system/roster.ts`** (pure): `rosterBodies(facts, copy, postMaxLength)` builds the list as BBCode, one line per
  item, each name a `[url=<threadHref>]` link (the relative form of `engine/ui/thread/pages.ts:17`; if the parser does
  not keep a relative `[url]` as a link, this task makes it keep one, tested in `parse.test.ts`), grouped under the
  headings "New faces", "Turns announced", "Turns taking effect" and "Reveals" (instance copy, `rosterHeadings`), split
  into as many bodies as `postMaxLength` needs; the commentary, or the stock heading, opens the first. `rosterPrompt(boss
  persona, facts)` gives the Boss's `personaPrompt` and the list and asks for `{ commentary }`, at most 280 characters,
  trimmed and recorded past that.
- **The run:** after `runSettlement`'s windows (`settle/core.ts:118`, before `sendOutbox`), for each `roster_due()`
  window with something to report: `roster_facts`, one `models.chat({ duty: 'roster', tier: 'light', ... })` (the
  handler builds `Models` as `meet/handler.ts:30` does), `write_roster_entry`. A transport failure is retried on the
  request; a model failure writes the stock heading and records why; an entry with nothing to report is written with no
  posts. A settlement never fails for its roster: the roster runs after `apply_settlement` has committed, and an entry
  not written is `roster_due` at the next run.
- **Duty:** `roster` (`chat`, `light`), assigned `'boss'` in Divided World.
- **Season News:** `news_announce` (0100:318) makes no item for an ahead announcement; `news_landed`'s kind gains
  `roster`, inserted by `write_roster_entry` when the entry names Turns taking effect; `season_news` (0403:372) reads it
  as one item listing the first 20 and a count, linking to the entry's first post. `Season.tsx` (`newsKeys` :186,
  `Names` :113) draws it as Turns; old items draw as before.

**Tests first.** `roster.test.ts`: headings, links, splitting at `postMaxLength`, the stock heading when no commentary,
the prompt holds only the list and the persona. SQL: a newcomer is listed once in its life; a character whose only
activity is reactions is never listed; one whose only Act is a veiled post is not listed while the veil holds, and is
listed at the first entry after; a silent Turn appears nowhere; an announced Turn appears as announced in its window and
as taking effect at its settlement; `write_roster_entry` twice writes once. `settle/core.test.ts`: a failed commentary
posts the stock heading; a failed write leaves the window due; the settlement's answer is unchanged. `0050-digest.sql`'s
lists are unchanged (`roster_facts` is not the digest role's). Red first.

## Task 8. Copy, stock lines and the instance (engine, instance)

Model: haiku

**Files:** `engine/rules/types.ts` (`Copy.announcementsThreadTitle` :836 renamed `rosterThreadTitle`, new
`meetingsThreadTitle`; `SystemContent` :987 gains `threadTitles: Partial<Record<MoveKindKey, string>>`,
`handoverThreadTitle`, `rosterHeadings`, `rosterStockHeading`), `engine/rules/instance.ts` (:642, :1328-1347 checks),
`supabase/functions/_shared/seed.ts` (:71, :163; new keys `systemThreadTitles`, `handoverThreadTitle`,
`rosterHeadings`), the migration of Task 4 or 7 for `settings_copy_complete` (0099:415), `instances/divided-world/index.ts`
(:28-35), `instances/divided-world/system/index.ts`, tests `instance.test.ts` (:435, :585), `system.test.ts`,
`seed.test.ts`.

The strings (the owner approves them in review):

- `rosterThreadTitle`: "Season {season}: Roster Report". `meetingsThreadTitle`: "Season {season}: Staff Meetings".
- `handoverThreadTitle`: "{boss} takes the chair".
- `rosterHeadings`: `{ newcomers: 'New faces', announced: 'Turns announced', landed: 'Turns taking effect', reveals:
  'Reveals' }`. `rosterStockHeading`: "The roster, as of this morning's settlement."
- `threadTitles`: renameBoard "{board} is now {name}"; nameSuccessor "On the matter of succession"; setRule "New rule in
  {board}"; conferGroup "Welcome to {groupName}"; pullSlot "Machine notice: a card is pulled"; repriceSlot "Machine
  notice: new prices"; flashSale "Flash sale!"; createBoard "New board: {name}"; moveThread "A thread moves to
  {board}"; mergeBoard "{board} is closing"; awardTrophy "{trophyName} goes to {characterName}".
- The board's comment (`index.ts:28`): "Only the staff post here: a thread for each decision, each handover, the
  Roster Report and the meetings' minutes."

Checks: each title's tokens are among its kind's `STOCK_LINE_TOKENS` (`engine/system/stock.ts:24`) and its params; a
title for a kind the engine does not have is refused; the two season titles contain `{season}`. **Tests first:** each
check refuses a planted bad title (a stray token, an unknown kind, a season title without `{season}`). Red first.

## Task 9. The Strategy Guide (instance)

Model: sonnet

**Files:** `instances/divided-world/guide/strategy-guide.md` (:23, :77-94, :141, :154), its tests.

Rewrite, in Gabe's voice and true: a Turn is announced at once in a thread you pick and can't be changed or withdrawn
after; a silent one can be, and can be announced later; it takes effect at the next settlement; naming the new class
reveals it from then. New characters are active at once; there is no debut. The staff's board holds a thread for each
decision and each handover, the season's Roster Report and the Staff Meetings' minutes; you can't post there, and you can
spin a thread from anything on it. The line "The System posts that your character has Turned" (:84) goes. Coordinate
with the Gabe's voice plan (`docs/plans/2026-11-21-gabes-voice-plan.md`, Tasks 4 to 7) if it has merged: this plan's
facts win; its voice stays.

**Tests first:** the guide's tests (`{{setting:…}}` resolution, dead anchors) stay green, and a test asserts the guide
no longer contains "debut" as a choice or "The System posts". Red first.

## Task 10. The fake, stories and boards (engine UI, e2e)

Model: sonnet

**Files:** `engine/ui/data/fake.ts` (`announcements()` :1140, `seed.move` :5956, `seed.groupMove` :5935,
`seed.trophyMove` :5924, `seed.handover` :5761, `seed.reach` :6075, the Promos helpers :5850-5878), `fake.test.tsx`
(:3108, :3817, :6235), `engine/ui/thread/Staff.test.tsx`, `engine/ui/thread/Promos.board.stories.tsx` (renamed
`Roster.board.stories.tsx`), `e2e/boards/2026-11-06-board-look/14-staff.ts`, `e2e/boards/01-main.ts`, `e2e/focus.spec.ts`,
`engine/ui/test-world.tsx`.

The fake follows Tasks 1 to 7: moves open staff threads, a handover its thread, a board card its picked thread, the
season's thread takes Roster entries and the Staff Meetings thread the minutes. The staff board's story shows a list of
move threads, a handover thread, the Roster Report and the Staff Meetings. **Tests first:** `fake.test.tsx`'s three
announcements assertions are rewritten to the new places, red against today's fake.

## Task 11. End to end

Model: sonnet

**Files:** `supabase/tests/e2e/` (a new `NNNN-staff-board.ts` beside `0012-a-day-of-the-director.ts`), `e2e/` (a spec
beside `focus.spec.ts`).

A day on a seeded instance: a player creates a character (active at once, no Act); it posts (a newcomer); another Turns
announced in a thread (the Act there at once) and tries to withdraw (refused); a board card is played in a thread on its
board; the meeting runs with minutes; a move lands in its own thread; the settlement runs; the Roster Report lists the
newcomer, the Turn as taking effect, with commentary from the fake model; the Staff Meetings thread holds the minutes;
the announcements thread holds nothing new. The browser spec: the Turn dialog's picker and commit warning, by keyboard,
with axe.

## Ways out of the states this adds

- **A committed Turn** ends at its settlement, by itself, as a queued Turn does. Its player's screens say when.
- **Waiting to debut** is removed: every character is active from creation.
- **A board card on a board with no thread** is refused with the way forward: start a thread there first.
- **A Roster entry not written** (a crash) is due again at the next settlement's run; nothing waits on it.

## The masks

- `roster_facts` reads `acts_public`, `characters_public` and `class_history` (whose public columns are granted to
  `authenticated` already) and never `acts`, `reactions` or ownership. A reactor is never a newcomer; a veiled post's
  author is not one while the veil holds.
- The commentary call is given the list and the Boss's persona only.
- The minutes come from a meeting whose input is public (`digest.ts`, `meet/core.test.ts:767`).
- A Turn's announcement is posted when and where its player chooses; its refusals are `unmask`'s, none of which differs
  with who owns anything. A silent Turn appears nowhere but its own player's log.
- `class_reveals` hides an ahead announcement's reveal until the Turn lands, so the class is never "verified" before the
  character holds it.

## Review focus

- Acts already held: old `announce` Acts (debuts and settlement Turns), old tallies and the announcements thread still
  read and draw as before; the `class_history.announce_act` backfill matches every old Turn announcement and no other.
- `class_reveals` and `turns_announced` feed the reveal perk (`settle.ts:824-842`) and `turnsTaken`; an ahead
  announcement must never make a perk start before its Turn lands, and a retired character's committed Turn must never
  count.
- A pending Turn queued and announced before the migration lands the old way exactly once.
- `system_tick` without `ann`: a bundle whose parts land in different ticks, and a refused first part, still find or open
  one thread.
- The flag rule's set-based placement with thousands of staff threads: `thread_places_computed`'s plan, and the seed's
  stray rebuild.
- `roster_facts`'s newcomer probe at a busy instance, and that it never reads a table outside the public ones.
- The settle function now holds `Models`: a model outage must never fail or delay a settlement's own writes.
- `thread_page` returning board-card Acts by time range: a page boundary, an edited post, a card played before the
  thread's first post.
