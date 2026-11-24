# Staff requests: fulfill, reject or confer: plan

Record, written 2026-11-24. Carries out `docs/plans/2026-11-24-staff-requests-design.md`; read it first, and CLAUDE.md.

**Before Task 1.** This plan is built on main after the whole-posts build (`docs/plans/2026-11-23-whole-posts-plan.md`,
PR #1045 and the build PR that follows it) has merged. If main does not carry `engine/system/read.ts` and `pool_read`,
the build session stops and asks the owner. The file and function names below are main's as of this writing; where the
whole-posts build renamed or moved one (the turn's prompt and its read, `oneTurn`'s steps), the build session follows the
whole-posts code and keeps this plan's decisions. The migration is the next free number at build time (one migration,
`NNNN_staff_requests.sql`, in sections); its SQL tests are `supabase/tests/NNNN-staff-requests.sql`.

## The words this plan uses

- **A request:** a reply to a staff persona that the persona, in a turn, rules on. Its **request post** is that reply.
- **A ruling:** `fulfill`, `reject` or `confer` in a turn; `fulfill` or `reject` at a meeting; `lapsed` by the tick.
- **Waiting:** a request whose latest ruling is `confer`.

## Task 1. `moveThread` is a Mod's too (engine, SQL)

Model: sonnet

**Files:** `engine/system/moves.ts` (`MOVE_THREAD.offices`), `engine/system/judgment.ts` (`repairModMove`),
`engine/system/meeting.ts` (`modsText`, the `handed` list), the migration section 1, tests beside each.

- `MOVE_THREAD.offices` becomes `['boss', 'mod']`; the migration updates `move_kinds.offices` for `moveThread` to match
  (the catalog seeds it; a test asserts the two agree, as the existing catalog test does).
- `repairModMove`: a lasting kind (`kind.lasting`) takes no expiry: `expires_in_hours` is set to 0 by the code, and a
  given value is dropped with the trim `lastingHasNoExpiry`. For `moveThread` the beat check reads two boards: the
  thread's board (a new `ModMoveContext.threadBoards: ReadonlyMap<string, string>`, thread id to board id, for the
  threads the call may name) and `params.board`; each must be on `ctx.beat`, else drop with `onBeat` at the failing path.
  A thread missing from `threadBoards` drops with `knownThread`.
- `apply_mod_move` (re-created in section 1): a lasting kind skips the expiry clamp and passes `expires_at` null.
- The queue guard (re-created from 0335's): for a Mod's `moveThread`, `watched` is the thread's current board
  (`thread_places_now` or whatever main's view of a thread's place is), and `params.board` must also be `beat_of` the
  Mod; each refusal names which board.
- `modsText`: `handed` includes `moveThread` ("moveThread (both boards on its beat)").
- The judgment prompts' list of kinds a Mod may make comes from the catalog (`modKinds()`), so it now names
  `moveThread`; their `ModMoveContext` is given `threadBoards` for the thread the judgment reads.

**Tests first.** `judgment.test.ts`: a Mod's `moveThread` with both boards on beat is kept with expiry 0; source off
beat drops `move.params.thread` `onBeat`; target off beat drops `move.params.board` `onBeat`; an unknown thread drops
`knownThread`; a given expiry on a lasting kind is trimmed `lastingHasNoExpiry`. SQL: a Mod's `moveThread` on beat
queues with `expires_at` null and spends one of the allowance; each board off beat is refused with its words; the Boss's
`moveThread` is unchanged. `meeting.test.ts`: the Mods' paragraph names `moveThread`. Red first.

## Task 2. The request block: schema, rule and repair (engine)

Model: sonnet

**Files:** `engine/system/chatter.ts`, `chatter.test.ts`.

- `ChatterAnswer.request?: { reply: string; ruling: 'fulfill' | 'reject' | 'confer'; move?: ModMove }`.
- `RepairFacts.ruling?: { answering: readonly string[]; office: 'boss' | 'mod'; mod?: ModMoveContext; boss?: BossMoveContext }`.
  Absent: the block is not offered (a member persona, a pick), and a given block is dropped with the trim `notAsked`.
- `BossMoveContext` (new, in `judgment.ts` beside `ModMoveContext`): `bank` (whole moves the bank can pay now), the
  `threadBoards` map, `expiryLeastHours`, `moveExpiryMostDays` (the phase's), and `structuralHoldHours`.
- `repairRuling(raw, ruling)` (exported, pure): `reply` must be one of `answering` (else the block is dropped,
  `answering`); `ruling` must be one of the three (else dropped, `oneOf(fulfill, reject, confer)`). A fulfill's move is
  repaired by `repairModMove` for a Mod and by a new `repairBossMove` for the Boss (the meeting's checks for one move:
  kind in the catalog and the Boss's office, `moveParamsProblems`, the expiry clamp to the phase, lasting kinds at 0,
  `bank >= 1`). **A fulfill whose move is missing or dropped becomes `confer`**, with the trim `fulfillToConfer` and
  the drop's path and predicate on the record. A reject or a confer carrying a move has the move dropped (`noMove`).
- `CHATTER_RULE.request`: `{ type: 'object', optional: true, fields: { reply: string, ruling: string, move: any optional } }`,
  so a malformed ruling never costs the post.
- `chatterSchema(c)` gains `ruling?: { office }`: when given, the schema offers `request` with `ruling` as an enum and
  `move` as the move shape the persona's office may make. Absent, no `request` key.
- The prompt: a staff turn's system text gains `RULING_WORDS(office, facts)`: that a reply may ask staff for something
  the game can do; that the persona may grant it with one move it may make (it names the kinds, its bank or allowance,
  its beat's boards by name and id), refuse it, or pass it to the meeting ("confer": the Boss rules on it at its next
  meeting, and it lapses unanswered after `daysMost` days); that the post is its words either way; and the
  `TURN_PREMISE` sentence "This is not a meeting and not a ruling" becomes, for staff only, "This is not a meeting: you
  are one voice in a thread, and what you write is a post like anyone's, though if someone asks you for something you
  may rule on it." Member personas keep `TURN_PREMISE` unchanged. `POOL_PREMISE` is unchanged (picks never rule).

**Tests first.** Each predicate above, one case each (the poisons: a reply not answered, a ruling `"maybe"`, a Mod's
fulfill of `renameBoard`, a fulfill with allowance 0, a Boss fulfill with bank 0, a reject carrying a move, a block on a
member's turn, a block with `move` a string); the schema offers `request` only with `ruling` given and names only the
office's kinds; the member premise is byte-identical to today's. Red first.

## Task 3. The tables, the writes and the reads (SQL)

Model: sonnet

**Files:** the migration, section 2; `supabase/tests/NNNN-staff-requests.sql`.

- `staff_requests` (id bigint identity, `request_act` uuid references acts, `thread` uuid, `asker` uuid character,
  `staff` text, `turn_act` uuid references acts (the persona's post), `ruling` text check in (fulfill, reject, confer),
  `move` bigint references queued_moves null, `at` timestamptz default now(); unique (`staff`, `request_act`)).
  `staff_request_rulings` (id, `request` references staff_requests, `ruling` text check in (fulfill, reject, lapsed),
  `move` bigint null, `meeting` bigint null, `post_act` uuid null, `at`; unique (`request`): a waiting request is ruled
  once). Both are append-only: `staff_rows_append_only()` (0415) guards them. RLS: service role only.
- `staff_requests_now` (view): each request with its latest ruling and, while waiting, `lapses_at` (`at` +
  `staffRequests.daysMost`).
- `apply_boss_move(staff text, move jsonb, cause_act uuid) returns jsonb`: as `apply_mod_move` for the Boss: the Boss's
  lock, idempotent on (staff, cause_act), `bank_now` at least 1 else `{queued: false, reason}`, debits `move_bank`
  (balance := `bank_now` − 1, `as_of` := now()) in the same transaction as the insert, the guard decides the rest,
  structural moves queue with `go_live_at` now + `structuralHoldHours` as the meeting's do. `meeting` on the queued row
  is the latest meeting's id (the column is not null today; check, and if it is, use the latest closed meeting as
  `apply_mod_move` uses the order's).
- `rule_request(staff_key text, request_act uuid, turn_act uuid, ruling text, move jsonb) returns jsonb`: one
  transaction: checks `request_act` is a reply in the same thread as `turn_act` and that `turn_act` is the staff's;
  for a fulfill calls `apply_mod_move` or `apply_boss_move` by the staff's office; **a fulfill whose move is refused is
  written as `confer`** with the refusal's reason returned; inserts the `staff_requests` row; idempotent on (staff,
  request_act) (a second call returns the first row).
- `requests_waiting(most integer) returns jsonb`: the waiting requests, oldest first, `most` of them, each with thread,
  title, board name, asker's public name, conferring staff key and name, `request_act`, and the post's current public
  body as `pool_read` reads it (whole). Rows whose post is no longer public are left out (the tick lapses them).
- `requests_ruled(meeting bigint, answers jsonb) returns jsonb`: called inside `apply_meeting` (Task 5): for each
  answer naming a waiting request, the fulfill's move is queued as the Boss's other moves are (bank permitting, else the
  ruling is `reject` with the reason recorded) and a `staff_request_rulings` row written; returns, per request, the
  ruling and what to post.
- `system_tick` (re-created from main's latest): lapses each waiting request past `lapses_at`, or whose post is no
  longer public, writing `staff_request_rulings` (`lapsed`) and, where the post is still public, the Boss's reply to it
  with the stock line `requestLapsed` (`{boss}`, `{asker}`), through the path the tick already uses for stock lines.
- The setting `staffRequests` (`{ daysMost, meetingMost }`, whole numbers at least 1) with `setting_staffrequests(v)`
  in the shape of `setting_modbots` (0103), and its poisons in the SQL test.

**Tests first.** Each function's refusals and its idempotence; a fulfill whose move the guard refuses becomes confer; a
Boss fulfill debits the bank once on a retry; the append-only guard refuses an UPDATE and a DELETE on both tables;
`requests_waiting` is oldest first and bounded; the tick lapses at `lapses_at` and not a minute before, writes one reply,
and lapses a hidden request with no reply; the setting's poisons (a zero, a string, an unknown key). Red first.

## Task 4. The turn rules (Edge Function)

Model: sonnet

**Files:** `supabase/functions/chatter/core.ts` (`oneTurn`, `repairAnswer`, `personaReads`), `core.test.ts`.

- For a staff persona's turn, read its office (`staff_office_now`), and for a Mod `mod_allowance` and its beat
  (`beat_of` over the open boards, as the judgments read it), for the Boss `bank_now` with the phase's numbers, and the
  `threadBoards` for the thread; pass them as `RepairFacts.ruling` and into the prompt.
- After the turn's post is written (`write_staff_turn`), a repaired `request` is written with `rule_request`. A database
  refusal of the ruling never takes the post back: it is recorded on the turn's `staff_call_records` row with its reason,
  and the run goes on ("Three unrelated timeouts": a transport failure to the database stops the run as today).
- The turn's record names the ruling, the move queued or the reason it became a confer, and every trim.

**Tests first** (the fake `Db`, as `core.test.ts` does): a Mod's turn granting a thread move queues it and writes the
request; a Boss's turn granting `renameBoard` queues it structural; a member's turn given a `request` block writes none;
a refused move writes a confer; a retried turn writes one request. Red first.

## Task 5. The meeting rules (engine, Edge Function, SQL)

Model: sonnet

**Files:** `engine/system/digest.ts` (`RawDigest.requests`, `renderDigest`), `engine/system/meeting.ts`
(`fieldRules`, the `staff` part of `MEETING_PARTS`, `repairAnswer`, a `requestsText`), `supabase/functions/meet/core.ts`,
the migration section 3 (`system_digest` gains `requests` from `requests_waiting(meetingMost)`; `apply_meeting` calls
`requests_ruled`), tests beside each.

- The digest's `requests` section: each waiting request with its id, thread, board, asker, the persona that conferred,
  how long it has waited and when it lapses, and the post whole, said once with the whole-posts line ("Every post you
  are shown is whole…"). This section is outside the digest's excerpt budget; its size is bounded by `meetingMost` and
  the reader's `readMost` over the bodies, longest dropped first with the count said, never cut.
- The `staff` part's fields gain `requests`: a list of `{id, ruling, move?, line}`. `repairAnswer`: an id not shown is
  dropped (`shownRequest`); a ruling outside fulfill and reject is dropped; a fulfill's move is repaired as the Boss's
  moves are and counted against the bank after the Boss's own moves and its bundle, cut from the end with the trim named,
  and a fulfill that loses its move is a reject (`fulfillToReject`); the line is cut to `postMaxLength` at a sentence, a
  blank line is null (the stock line then stands).
- `meet/core.ts`: after `apply_meeting` returns, for each ruling it reports, write the Boss's reply to the request post
  (`write_staff_act`, kind `post`, quoting the request), the line or the stock line `requestGranted` / `requestRefused`.
  A post that fails is recorded on the meeting's record and does not fail the meeting; the ruling stands.

**Tests first.** The digest renders the section with posts whole and the left-out count; the prompt shows it only when a
request waits; each repair predicate with its poison (an unknown id, a ruling `confer`, a fulfill with the bank spent
by the Boss's own moves, a blank line); SQL: `apply_meeting` with a ruling writes it and queues the move once on a
re-run. Red first.

## Task 6. Stock lines and settings (engine, instance)

Model: haiku

**Files:** `engine/system/stock.ts` (`STOCK_LINE_KEYS` and `STOCK_LINE_TOKENS`: `requestGranted`, `requestRefused`,
`requestLapsed`, each with `boss` and `asker`), `engine/rules/types.ts` (`StaffRequestSettings { daysMost; meetingMost }`
on the instance's settings), `engine/rules/instance.ts` (its rule, mirroring `setting_staffrequests`),
`instances/divided-world/system/lines.ts` (three lines a key, in the Boss's register), `instances/divided-world/settings.ts`
(`staffRequests: { daysMost: 3, meetingMost: 10 }`), and their tests.

Lines (the owner reviews them in the PR): `requestGranted`: "Fine. Done. Don't make it a habit, {asker}.", "Granted.
Enjoy it while it lasts.", "The meeting says yes. I said no, but I was outvoted by me."; `requestRefused`: "No.",
"Brought it to the meeting. The meeting laughed.", "{asker}, the answer is no, and the question is noted."; `requestLapsed`:
"I was going to get to this.", "Lost in the shuffle. Ask again, nicer.", "The meeting ran long, {asker}."

**Tests first.** The instance's stock-line test lists the three keys and fails without them; the settings rule's
poisons. Red first.

## Task 7. The moderation log (engine UI, SQL)

Model: sonnet

**Files:** the migration section 4 (`moves_log`, re-created from 0401's, gains request rows: kind `request`, with
`params` {thread, post, ruling, ruled, lapses_at, move_kind}), `engine/ui/profile/modlog.ts` (`isModAct`, `didWords`,
`endedModWords`), `engine/ui/data/api.ts` (`MoveLogRow`), `engine/ui/profile/Staff.tsx`, tests and stories.

The words, exactly (the glass's voice, true, never a model's summary): did: "Granted a request in " + thread link + "
(post #N): " + the move's plain words; "Rejected a request in …"; "Passed a request in … to the Boss" (a Mod's confer);
"Took a request in … to the meeting" (the Boss's). Ended: while waiting "waiting, lapses " + date; then "ruled: granted",
"ruled: refused", "lapsed". A granted move's own row stays as it is today.

**Tests first.** `modlog.test.ts`: each of the seven phrasings; SQL: `moves_log` lists a request for its staff member
and not another's. Red first.

## Task 8. End to end

Model: sonnet

**Files:** `supabase/tests/e2e/NNNN-staff-requests.ts` (the next free number), with the scripted model the e2e tests use.

A player asks a Mod to move a thread on its beat: the Mod's turn grants it and the thread moves. A player asks a Mod to
move a thread off its beat: the turn's fulfill becomes a confer; the meeting grants it; the Boss's reply is in the thread
and the thread moves. A confer the meeting leaves out lapses at `daysMost` with the stock reply. The modlog shows each.

## Ways out of the states this adds

A waiting request lapses by itself within `staffRequests.daysMost` days (the tick), or is ruled at a meeting; a request
whose post is hidden lapses at the next tick. A granted move ends as every move does. Nothing else is added.

## The masks

Every read added is public play or staff state: the request post's public body (`pool_read`), thread and board, the
asking character's public name, the persona's office, bank, allowance and beat. `rule_request` and the guard decide on
the staff member's state and the boards, never on who owns the asker or the thread, so a confer, a refusal and their
timing are the same whoever is behind the request. The digest's section is built by the role that builds the digest
today, which reads public relations only.

## Review focus

- A Mod's `moveThread` from a judgment (not a request) is now possible: check the judgment prompts and repairs give it the
  thread's board, and that no existing judgment test assumed a Mod never moves a thread.
- `apply_boss_move` and the meeting both spend the bank: a turn and a meeting at the same minute must not overspend
  (the same lock, or the meeting's `bank_now` read under it).
- A turn retried after `write_staff_turn` and before `rule_request`: the post exists once, and the ruling is written once.
- A lasting move with expiry 0 through `apply_mod_move`: Acts already queued by Mods are untouched (rules only), and the
  clamp still holds for `setRule`.
- The digest's new section on a busy instance: bounded by `meetingMost` and `readMost`, never by the waiting count.
- The modlog's words never carry the persona's or the Boss's text.
