# Mod Bots: the plan

Record, written 2026-11-06. Carries out `docs/plans/2026-11-06-mod-bots-design.md` (cited here as "the design"), task by
task. Each task writes its tests first and shows their red run, and every task is reviewed for the spec and for quality
(`.claude/skills/build-session/SKILL.md`). Migration and SQL test numbers are written here as "next": the build takes the
next free number when it reaches the task (the highest today is `0098_tilt_preference.sql`; SQL tests are numbered apart,
`supabase/tests/NNNN-kebab-name.sql`, the highest `0100-tilt-preference.sql`).

**Order.** Tasks 1 and 2 (descriptions) stand alone and build first. Task 3 (move offices and rules) comes before Task 4
(orders) and Task 5 (the warn bar). Task 6 (visits) needs 3, 4 and 5. Tasks 7 to 11 need Task 6; 7 comes before 8 to 11,
since it builds the Mod's one move they all reuse. Tasks 12 and 13 (the screens) need Tasks 5 to 10. Task 14 (the
instance's content) can build any time after Task 4. Task 15 is last.

**Nothing turns on.** Everything here runs only while `systemEnabled` is true, and Divided World's is false until The
System's Task 13, "Turning it on". Every task is tested against localhost Postgres and the fake model; no task touches a
deployed database.

## The layers

- **Engine** (`engine/`, `supabase/`): the predicate catalog and its SQL checks; `setRule` and `describeBoard`; move
  offices; orders, beats and allowances; the warn bar, infractions and the ban ladder; visits; reports; interception;
  appeals; patrols; the targeting cap; the `staff` Edge Function's judgments and filings; the visit mark, its Lens tab,
  the report and appeal forms, the warn meter, the violation notice, BANNED, the presence tag and the log lines.
- **Instance** (`instances/divided-world/`): stock lines for a rule landing, a visit's arrival and filing, a dismissal
  and a backfire, a ban; the role word for a Mod; every number in `Settings.modBots` and `Settings.warnBar`; persona
  strictness, weaknesses and quiz banks, as drafts for the owner.
- **The interfaces:** `Settings.modBots` and `Settings.warnBar` (Tasks 4 and 5), each checked by `settingsProblems`
  (`engine/rules/instance.ts:191`) and by `settings_held()` in SQL; the stock line keys in `engine/system/stock.ts`;
  `InstanceUi.copy` for role words. `SystemContent.oldVoice` is removed (Task 1).

## The masks, for every task

- Every judgment's prompt (report, patrol, appeal, filing) is built from the post, the thread, the board's premise, the
  rules in force, the Mod's order, memory and notes, and public Acts. None reads `characters.owner`, a class or a
  reactor. A patrol's sample is read by a function owned by `kayfabb_digest`, added to the pinned list in
  `supabase/tests/0050-digest.sql:64-74`, and the planted reads there stay red.
- A rule check compares characters, never accounts (`noDoublePost` above all).
- A report's quota is per character. The daily judgment budget reads one instance-wide count.
- An interception or report across one's own masks is allowed, so no refusal exists to leak.
- The targeting cap reads public punishments of one character.
- A ban and a tail are per character.

## Task 1: the Boss writes a rename's description

Model: sonnet

- **Files:**
  - `engine/system/meeting.ts`:
    - drop `MODEL_LEAVES` (:67-68), so `description` is a param the model writes, bounded at 2000 and trimmed past it;
    - drop the `'-'` stand-in and its delete (:396-400);
    - in `meetingSystemPrompt` (:162), say that a rename's description is the Boss's own words, in character, the board's
      subtitle under its new name, a sentence or two.
  - `supabase/functions/meet/core.ts`: `withDescription` (:316-359) loses the completion. A rename keeps the Boss's
    description; a missing or empty one takes the stock `boardDescription` line, chosen by the same name hash, and pushes
    the same note. Drop the `cutCompletion` import (:51) if nothing else uses it, and fix the header (:25).
  - `engine/rules/types.ts`: remove `OldVoiceFrame` (:585-589) and `SystemContent.oldVoice` (:620-621). The persona's
    `voice` stays.
  - `engine/rules/instance.ts:465`: `oldVoice` leaves the functions checked. `engine/rules/test-system.ts:44` loses its stub.
  - Delete `instances/divided-world/system/old-voice.ts` and `old-voice.test.ts`, and unwire them from `system/index.ts`
    (:20, :36).
  - `engine/ui/admin/Queue.tsx:11`: the header says the description is the Boss's words.
- **Tests first:**
  - `supabase/functions/meet/core.test.ts`: rewrite "the old voice writes for the five kept" (:153) and the frame tests
    (:237-259). A rename answered with a description keeps it word for word; one over 2000 is trimmed with a recorded
    trim; one with an empty description takes the stock line, with a note; the fake model's `complete` is never called
    by a meeting (assert its call count is zero).
  - `engine/system/meeting.test.ts`: the rule's schema lists `description` among the rename's params.
  - `engine/rules/instance.test.ts:85`, `:478`: the fixture has no `oldVoice`, and no problem names it.
  - `supabase/tests/e2e/0011-meeting.ts:68`: the description asserted is the fake Boss's.
- **Not touched:** `supabase/functions/chatter/core.ts`'s old-voice path, `chatterCompletion`, `cutCompletion` in
  `engine/system/validate.ts:127`, `DUTY_SPECS.standingOrderLine`.

## Task 2: `describeBoard`, and an admin's replacement

Model: sonnet

- **Migration (next), `describe_board.sql`:**
  - Act kind `describe` joins `acts_kind_check` (latest at `0092_card_end.sql:25-26`) and `acts_character_null`
    (`0046:56`): no character, `target` the board, payload `{description (1-2000), move_act uuid|null, admin uuid}`. A
    payload check names each field.
  - `queued_moves` gains `admin_description text` (1-2000, null), `described_by uuid`, `described_at timestamptz`.
  - `replace_queued_description(id bigint, description text)`: admin only, on a renameBoard row neither landed nor held;
    sets the three columns. A second call replaces them.
  - `describe_board(board uuid, description text)`: admin only. Writes a `describe` Act naming the board's open
    rename's `move_act`, or null when no rename is open.
  - `system_tick` (latest `0053_stored_progress.sql:120`): after landing a renameBoard row that carries an
    `admin_description`, it writes the `describe` Act naming the landed move in the same subtransaction.
  - `boards_now` (`0046:438`): `description` becomes the latest `describe` naming the open rename's move, else the
    move's own description; with no rename open, the latest `describe` with a null `move_act`, else `boards.description`.
    Every reader (`board_page`, `index_page`, `boot`, `thread_page`) reads `boards_now` and needs no change; the test
    proves it on each.
- **UI:** `engine/ui/admin/Queue.tsx`:
  - a waiting rename's description (:249-263) gains "Replace description", a field and Save, calling
    `api.replaceQueuedDescription`;
  - a new group, "Boards", lists each board with its current description and "Replace description", calling
    `api.describeBoard`. The words are plain, for admins.
  - `engine/ui/data/api.ts` declares both, and `web/src/data/supabase.ts` and `engine/ui/data/fake.ts` implement them.
- **Tests first:** SQL test (next), `describe-board.sql`:
  - a non-admin is refused by both functions;
  - a queued replacement lands as a `describe` Act after the rename's `move` Act, and `boards_now` shows it while the
    Boss's words stay on the `move` Act;
  - a `describe` after landing wins; once the rename ends, a `describe` naming it no longer shows and the board's base
    description returns;
  - a held row refuses a replacement.
  `engine/ui/admin/Queue.test.tsx`: replace a waiting description; replace a board's description.

## Task 3: offices on move kinds, the predicates, and `setRule`

Model: sonnet

- **`engine/system/moves.ts`:**
  - `MoveKind` (:34-61) gains `offices: readonly ('boss' | 'mod')[]`. `RENAME_BOARD` and `NAME_SUCCESSOR` are
    `['boss']`.
  - New `SET_RULE`: `{ key: 'setRule', structural: false, shapesBoard: false, askable: true, offices: ['boss', 'mod'],
    label: 'SET A RULE' }`. Params: `{ board: uuid | null (null: every board, the Boss's alone), predicate: string,
    param: string | number | null, band: 'minor' | 'moderate' | 'severe' }`, with `uuids: ['board']` allowing null.
    `plain`: "a rule". `template` and `parts` name the predicate's plain words and the board ("Set Rule 3 on General: no
    double posting").
  - `moveParamsProblems` (:113) checks the predicate and its param against the catalog.
- **New `engine/rules/predicates.ts`** (pure): `PREDICATES`, one entry per key in the design's section 4 table:
  `{ key, param: 'none' | 'count' | 'word' | 'tag', bounds, plain(param) }`. Bounds: `minLength` 1 to 200,
  `maxLength` 20 to 20000, `noNecropost` 1 to 365 days, a word 1 to 40 characters with no spaces, a tag from the BBCode
  tags `engine/bbcode` knows. `predicateProblems(key, param)` names the failed predicate. This is the one list. The seed
  writes it to SQL.
- **Migration (next), `rules.sql`:**
  - `move_kinds` gains `offices text[]`, seeded from the catalog by `seed_instance` (`supabase/functions/_shared/seed.ts`).
  - `rule_predicates(key pk, param_kind)`, seeded from `PREDICATES`.
  - `rules_now` view: each open `setRule` move with its board (null for every board), predicate, param, band, `number`
    (per board, `row_number()` over its board's rules in landing order, every-board rules numbered on their own as
    "House Rule N"), `move_act` and the staff member who made it.
  - `rule_conflict(board uuid, predicate text, param jsonb) returns text`: the plain reason a new rule would leave no
    compliant post against the rules in force there, or null. The pairs: `bannedWord`/`requiredWord` on the same word;
    `minLength` above a `maxLength`; `noTag` against a `requiredWord` that is only written with that tag (none today, kept
    as the pattern); a second rule of the same predicate and param.
  - `rule_breaks(post_act uuid) returns setof rules_now`: one `case` branch per predicate key, reading the post, its
    thread and that character's previous post in the thread. A key with no branch raises `no check for predicate %`.
  - `queued_moves_guard()` (latest `0082_offices.sql:134`) refuses a `setRule` whose `rule_conflict` is not null, naming
    the reason.
  - `system_line` (`0048:80`) gains the stock key `ruleSet`.
- **`engine/system/stock.ts`:** `ruleSet` with tokens `{rule}` and `{board}`.
- **The check and its poison:** `supabase/tests/(next)-rule-predicates.sql` asserts `rule_breaks` has a branch for every
  row of `rule_predicates`: for each key it posts a breaking and a compliant post and expects one row and none. Its
  poison is a planted `rule_predicates` row `noPoison` with no branch, which must make the test fail with `no check for
  predicate noPoison`. Watch it fail before the fix is trusted.
- **Tests first:**
  - `engine/rules/predicates.test.ts`: each key's bounds; an unknown key; a word with a space.
  - `engine/system/moves.test.ts`: `setRule`'s params; offices on every kind (a kind with no offices fails the test).
  - The SQL test above, plus `rule_conflict` for each pair and `rules_now`'s numbering. `noDoublePost` is not broken by
    a reply directly under a post of another mask of the same account (the mask test).

## Task 4: orders, beats, allowances, and the Mods' memory

Model: sonnet

- **`engine/rules/types.ts`:** `Settings.modBots`: `{ allowanceMost: 3, ruleDaysMost: 7, visitHours: { least: 2, most: 12
  }, patrolsPerDay: 6, patrolSample: 5, reportPrice: Hundredths (25), reportsPerDay: 3, judgmentsPerDay: 60,
  filingLinesPerDay: 60, appealPrice: Hundredths (50), tailHours: 24, cap: { punishments: 3, days: 7 }, filingCron: '*/5 * * * *',
  filingGraceMinutes: 10 }`, with a rule
  per field in `engine/rules/instance.ts`'s `SETTINGS` (:133) and in `settings_held()`. The Divided World values are the
  design's, in `instances/divided-world/settings.ts`.
- **`engine/system/meeting.ts`:** `MEETING_RULE` (:81-115) gains:
  - `orders[]`: `{ mod (staff key), boards (uuid[]), order (≤200), allowance (int ≥0), memory (MEMORY_RULE) }`;
  - `patrols[]`: `{ mod, at (time today, ISO) }` (Task 11 acts on them; this task keeps them).
  `repairAnswer` (:347-458): an order for a key not on staff is dropped and recorded; a board not a board is dropped; a
  board named in two orders stays with the first; `allowance` is clamped to `allowanceMost` with a trim, then the total
  is cut from the last order backward to what the bank holds after the Boss's own moves; patrols past `patrolsPerDay`
  are cut from the end. The prompt (`meetingSystemPrompt` :162) shows each Mod on staff: its name, career, beats
  preferences, pet rules, temperament, notes since its last memory, and what it spent of its last allowance.
  - Every move kind's offices are shown, and the Boss is told `setRule` is the one kind it can hand on.
- **Migration (next), `orders.sql`:**
  - `staff_orders(meeting, staff, boards uuid[], order_line, allowance, at)`, append-only; the latest per Mod is in
    force.
  - `mod_allowance(staff) returns int`: the latest order's allowance less the `setRule` moves that Mod queued since.
  - `beat_of(board uuid) returns text`: the Mod whose latest order names the board; else, among Mods on staff
    (`staff_now`), the one whose persona beats preference matches the board's key, then the one with fewest boards, then
    the first by key. It always answers while a Mod is on staff (the staff design: never empty).
  - `apply_meeting` (latest `0051_succession.sql:847`): before computing `bal`, it returns each Mod's unspent allowance to
    the Boss's `move_bank`, never above `bank_cap`. It then writes `staff_orders` and each Mod's `staff_memory`, and
    charges the bank for the allowances handed out. `bal - spent - handed` must stay at or above zero, else it raises, as
    today.
  - `queued_moves.staff` may now be a Mod's key. The guard refuses a move whose kind's `offices` do not hold the
    staff's office, a Mod's move on a board off its beat, and a Mod's `setRule` with a null board.
  - `meeting_context` (latest `0082:208`) returns the Mods on staff with what the prompt needs.
- **Tests first:**
  - `engine/system/meeting.test.ts`: each repair above with its trim or drop recorded.
  - SQL test (next), `orders.sql`: allowance returned and capped; `beat_of`'s fallback order with no orders, with a
    partial order, and with no Mod's beats matching; the guard's three refusals; the bank charged.
  - `supabase/functions/meet/core.test.ts`: a meeting with two Mods writes their orders and memories.

## Task 5: the warn bar, infractions and timed bans

Model: sonnet

- **`engine/rules/types.ts`:** `Settings.warnBar`: `{ size: 10, bands: { minor: 2, moderate: 4, severe: 7 }, decay: Span (14
  days), banDays: [1, 3, 7] }`, checked as Task 4's settings are. A band above `size` is a problem.
- **Migration (next), `warn_bar.sql`:**
  - Act kinds `infraction` (character target; payload `{band, points, rule_number, board, visit_act, staff,
    expires_at}`) and `ban` (character target; payload `{days, until, infraction_act, season}`), both written only by
    the functions below.
  - `warn_points(character uuid) returns int`: the points of its infractions not yet expired and landed after its last
    ban, less any reduced or overturned by appeal (Task 10 adds the appeal Acts; this reads them by kind once they
    exist, and the task leaves a test placeholder that Task 10 fills).
  - `infract(character, band, about_act, staff)`: writes the `infraction`; if `warn_points` reaches `size`, writes a
    `ban` whose length is the season's `banDays` ladder step (the last step repeats), counting this season's bans.
  - `banned_until(character) returns timestamptz | null`.
  - `post()` (latest `0078_reply_passes.sql:235`), new threads, `spin`, `react()`, `play_card` and `set_card` (latest
    `0086`) refuse a banned character with a plain message naming when the ban ends.
  - `characters_public` gains `warn_points` and `banned_until`; the thread, profile and presence reads carry them.
- **Tests first:** SQL test (next), `warn-bar.sql`:
  - points add by band;
  - an infraction drops off after the decay, set short by a test's settings;
  - a full bar bans, empties the bar and steps the ladder 1, 3, 7, 7;
  - the ladder resets in a new season;
  - each refusal when banned, and nothing refused once `banned_until` passes;
  - a ban on one mask refuses nothing to another mask of the same account (the mask test).

## Task 6: visits

Model: sonnet

- **Migration (next), `visits.sql`:**
  - Act kinds `visit` (target a post, written by a Mod; payload `{charges [{rule_number, board, band, cause: rule |
    report | patrol | tail, about_act}], ends_at, challenge: {kind, question_index?, price?}}`), `visit_join` (a charge
    added to an open visit) and `visit_end` (payload `{visit_act, outcome: filed | intercepted | trapped | reversed,
    by_act?, line}`). `write_staff_act`'s allowed kinds (`0082:367`) gain `visit`, `visit_join` and `visit_end`.
  - `visits_open(visit_act pk, post, ends_at)`, derived state the tick reads by a partial index on `ends_at`, filled by
    a trigger on `visit` Acts and cleared on `visit_end`, as `open_moves` is (`0046:78-111`).
  - `start_visit(post, staff, charge jsonb)`: the window is the persona's strictness clamped into
    `modBots.visitHours`, drawn by a hash of the post id, so a retry draws the same. A post with an open visit gets a
    `visit_join` instead, its band raised to the highest of its charges. The quiz question is drawn by the same hash.
    It springs `visit` traps on the post (Task 9 wires the trigger; this task calls `spring_traps('visit', ...)` behind
    a check that Task 9 removes).
  - `file_visit(visit_act, line text)`: writes `visit_end` filed with the line and calls `infract` with the band, the
    rule and the visit. Idempotent: a visit already ended returns its end.
  - `system_tick`: files each visit `filingGraceMinutes` (10) past `ends_at` that is still open, with the stock line
    `visitFiled`, so nothing waits on a model.
  - `post()` and new threads: after the insert, each row of `rule_breaks(act)` calls `start_visit` with the board's
    `beat_of` Mod. A rule never refuses the post. If the character has an open tail (Task 9), its post draws a visit for
    Obstruction.
  - `thread_page` (latest `0094`) carries each post's visit (open or its last end), with its charges and challenge but
    never the quiz's answer.
- **`engine/system/stock.ts`:** `visitArrived`, `visitFiled` with tokens `{mod}`, `{rule}`.
- **Tests first:** SQL test (next), `visits.sql`:
  - a breaking post goes up and starts a visit by the board's beat Mod;
  - a second breaking post on the same post joins the charge, and the band is the highest;
  - the tick files an overdue visit with the stock line, and the points land;
  - `file_visit` twice files once;
  - the window stays inside the settings;
  - `thread_page` never carries the quiz's answer;
  - a post by a staff character starts no visit.

## Task 7: the `staff` Edge Function: filings and the Mod's one move

Model: sonnet

- **New `engine/system/judgment.ts`** (pure), on the pattern of `engine/system/chatter.ts`:
  - `MOD_MOVE_RULE`: an optional `move` `{kind: 'setRule', params, expires_in_hours, why}`;
  - `repairModMove(raw, ctx)`: drops a kind the Mod's office may not make, a board off its beat, an expiry past
    `ruleDaysMost` (clamped with a trim), and a move when `mod_allowance` is zero, each recorded;
  - `modPrompt(persona, order, memory, notes, rulesInForce, career)`: the persona's prompt for a Mod's duty, its order in
    the Boss's words, and the catalog of predicates. The engine composes it; the instance's premise for the office comes
    from `persona.ts`.
  - `FILING_RULE` and `filingPrompt`: a line (≤280) in the Mod's voice about the post it inspected, plus
    `MOD_MOVE_RULE`.
- **`engine/system/duties.ts`:** `DUTIES` gains `filing`, `reportJudge`, `patrolJudge` (chat, light). `appeal` stays.
  The instance assigns `filing`, `reportJudge` and `patrolJudge` to `beat`, and `appeal` to `filer`
  (`instances/divided-world/system/index.ts:31`).
- **New `supabase/functions/staff/`** (`core.ts`, `index.ts`, `core.test.ts`), on the pattern of `chatter`:
  - `runFilings`: on a cron (`modBots.filingCron`, every 5 minutes), takes visits due and open, calls the beat Mod's
    filing (chat; an old-voice persona's line by completion, then its move by a chat call only when it has allowance),
    and calls `file_visit` with the line and, where repaired, `apply_mod_move`. Past `filingLinesPerDay`, the stock line
    and no move. A failed call files with the stock line ("Three unrelated timeouts are not a poison pill").
  - Each call writes its ledger row through `models()`, with the duty and the staff key.
- **Migration (next), `mod_moves.sql`:** `apply_mod_move(staff, move jsonb, cause_act uuid)`: queues the move as the
  Mod's, go-live now, inside the guard of Task 4, decrementing the allowance by queueing it. It returns null and writes
  nothing when the guard refuses, with the reason. `schedule_staff()` and its settings trigger, as
  `schedule_meeting` (`0047:252`) does.
- **Tests first:**
  - `engine/system/judgment.test.ts`: every drop and trim.
  - `supabase/functions/staff/core.test.ts`: a filing with a move queues it and spends the allowance; with no
    allowance the move is dropped; a model failure files with the stock line; the budget past its count files stock.
  - SQL test for `apply_mod_move`'s refusals.

## Task 8: reports

Model: sonnet

- **Migration (next), `reports.sql`:**
  - Act kinds `report` (by a character, target a post; payload `{reason ≤280}`) and `report_verdict` (by the beat Mod;
    payload `{report_act, verdict: visit | dismissed | backfire, line, visit_act?}`).
  - `wallet_events.kind` (latest `0086:29`) gains `report` and `refund`.
  - `open_report(through, post, reason)`: refuses past `reportsPerDay` for that character, past `judgmentsPerDay` for
    the instance (one count), a banned character, and a post by a staff character; spends `reportPrice` with
    `wallet_spend` (`0006:49`); writes the `report`. `close_report(report_act, verdict, line, charge)`: writes the
    verdict and, for a visit or backfire, `start_visit` (a backfire on the reporter's latest post, cause `backfire`).
    `refund_report(report_act)`: refunds and writes nothing else, so the report can be made again.
- **`supabase/functions/staff/`:** `report(request)` (invoked by the client with the player's session, as
  `supabase/functions/act` is): calls `open_report` as the player, judges on the beat Mod's call (`REPORT_RULE`:
  `verdict`, `charge {rule_number | premise, band}`, `line`, plus `MOD_MOVE_RULE`), repairs it (a charge naming no rule in
  force on the board is `premise` at the minor band), calls `close_report` and `apply_mod_move`. A failed call refunds.
- **Tests first:** the SQL limits and refunds; the function's three verdicts; a backfire's visit lands on the reporter's
  latest post; a report across one's own masks is allowed (the mask test); the budget refusal reads the instance's count.

## Task 9: interception, tails and the visit trap

Model: sonnet

- **Migration (next), `interception.sql`:**
  - Act kind `intercept` (by a character, target the visited post; payload `{visit_act, kind: quiz | bribe |
    distraction, answer?, succeeded}`).
  - `intercept(through, visit_act, answer)`: one per character per visit; a quiz compares the answer with the persona's
    question drawn at the start (the answers come from the instance's roster seeded to SQL; the seed writes each
    persona's weakness); a bribe spends its price with `wallet_spend` (kind `bribe`). Success writes `visit_end`
    intercepted with the `intercept` as `by_act`. Failure starts a tail: `tails(character, staff, until)`, append-only,
    read as "open while `until` has not passed and no visit it drew has ended".
  - `place_cast` (latest `0092:275`), `reach = 'thread'`: when the caster has not tried this visit, each open visit on
    the thread is ended by a distraction-weak Mod's visit, writing an `intercept` of kind `distraction`.
  - Wire the `visit` trigger: remove its refusal in `card_kinds_problem` (latest `0055:766`, :797-804) and in
    `engine/rules/instance.ts:342`; `start_visit`'s check from Task 6 goes, and `spring_traps('visit', post, visit_act)`
    runs. A sprung trap writes `visit_end` trapped.
  - A tail's next post draws Obstruction (Task 6's hook reads `tails`).
- **Tests first:** one attempt per character; a right quiz answer ends the visit; a wrong one tails; a bribe spends and
  ends; a short wallet is refused before anything is written; a thread-reach card ends a distraction-weak Mod's visit
  and no other's; a visit trap springs and ends it; `engine/rules/instance.test.ts:645` now accepts `visit`; the author
  may intercept their own post's visit.

## Task 10: appeals

Model: sonnet

- **Migration (next), `appeals.sql`:**
  - Act kinds `appeal` (by the punished character; target the `infraction` or `ban`; payload `{plea ≤1000}`) and
    `appeal_ruling` (by the hearing staff; payload `{appeal_act, verdict: overturned | upheld | reduced | increased,
    points_delta, line}`).
  - `open_appeal(through, punishment_act, plea)`: one per punishment; only the punished character; `appealPrice` with
    `wallet_spend` (kind `appeal`). `close_appeal(...)` writes the ruling and refunds on overturned. An increase adds at
    most one band's points (`infract`); a reduction subtracts at most the infraction's points. An overturned ban ends it
    at once. `refund_appeal` for a failed judge.
  - `warn_points` reads the rulings (Task 5's placeholder test is filled).
- **`supabase/functions/staff/`:** `appeal(request)`: the filer hears an infraction; the Boss hears a ban; `APPEAL_RULE`
  is verdict and line, and the prompt carries the persona's `persuadedBy`. The `appeal` duty, light tier.
- **Tests first:** each verdict's effect on `warn_points` and on a ban; the refund; a second appeal refused; another
  character's appeal refused; a failed judge leaves the appeal available.

## Task 11: patrols and the targeting cap

Model: sonnet

- **Migration (next), `patrols.sql`:**
  - `patrols(meeting, staff, at, ran_at, sampled uuid[])`, written by `apply_meeting` from the answer's `patrols`
    (Task 4 kept them).
  - `patrol_sample(staff, most)`: recent posts on the Mod's beat not by staff and not under a visit, newest first,
    owned by `kayfabb_digest`, added to the pinned list in `supabase/tests/0050-digest.sql`.
  - `staff_punishments(character, days)`: patrol-finding visits that filed and backfire visits, from public Acts.
    `start_visit` with cause `patrol` refuses past `cap.punishments` and records the drop on the patrol row; nothing is
    shown.
- **`supabase/functions/staff/`:** `runPatrols` on the same cron: each patrol due runs once (`ran_at`), judges the
  sample (`PATROL_RULE`: findings `[{post, charge}]` at most the sample's size, plus `MOD_MOVE_RULE`), starts a visit per
  finding, and applies the move.
- **Tests first:** the sample's reads (the digest pinned list, with its planted reads red); a patrol runs once on a
  retry; findings at the cap are dropped and recorded; rule breaks and reports are not counted.

## Task 12: the visit mark and its Lens tab

Model: sonnet

- **Files:** `engine/ui/cards/Marks.tsx` (`MarkStrip` :188, `PostMarks` :242), `engine/ui/cards/Lens.tsx` (tabs :465-468,
  :557), `engine/ui/data/api.ts` (`ActKind` :164, the thread's post shape), `engine/ui/cards/plays.ts`
  (`WITHOUT_EFFECTS` :427), `engine/ui/thread/Post.tsx`, `web/src/data/supabase.ts`, `engine/ui/data/fake.ts`.
- **What it draws** (the mocks `docs/research/2026-11-06-mod-bots/01-on-a-visit.png`, `02-filed-author.png`):
  - The visit's mark is first in the strip: the Marks' glass tile in `--kb-visit-ink` (the instance's yellow, a token),
    a stopwatch icon, the time left as `h:mm`, refreshed each minute, or "Filed". Its label names the Mod, the time left
    or "filed", and that it opens the visit.
  - The Lens gains a visit tab ahead of card kinds, "On a visit" or "Filed":
    - its plain state, built from the Acts;
    - "Talk it down" while open, spaced as the state's heading is: a quiz as full-width block buttons with centered
      text, a bribe as one button with its price, a distraction as a line saying any card cast on this thread talks it
      down; the result in a status region; the attempt's terms (one try for the current mask, the tail if wrong);
    - once filed, to the author's current mask alone, Appeal with its price and terms, opening the appeal form (Task 13);
    - "How it went": the report, the verdict, each attempt and the end, as Lens rows with React and Spin thread.
  - The Lens copy is the glass's plain voice, by the role words from `InstanceUi.copy`; the Mod's own lines are quoted
    as its words.
- **Tests first:** `engine/ui/cards/marks.test.tsx` and `lens.test.tsx`: the mark's label and time; the tab's states;
  the quiz's buttons reached and answered by keyboard; the author alone sees Appeal; axe passes on the Lens with the
  tab open. A Storybook story, "Boards/01 Lens: a visit", for each state.

## Task 13: the report and appeal forms, the warn meter, the notice, BANNED, presence, the logs

Model: sonnet

- **The report form** (`03-report.png`): "Report" after History in `Actions` (`engine/ui/thread/Post.tsx:111-120`), on
  posts not by staff and not the current mask's own. It opens the Lens's panel with one tab "Report post #N": who judges
  it and the three verdicts in plain words, a reason field (≤280, with `FieldCount`), "Report · 0.25 Aura" (the price
  from the settings), and "{mask} has N reports left today". The answer lands as the verdict's line, in a status region.
- **The appeal form:** the same panel, "Appeal": the punishment, the plea field (≤1000), the price and terms.
- **The warn meter** (`02-filed-author.png`): in `Postbit` (`engine/ui/postbit/Postbit.tsx`), under the rank:
  "Warnings: N/10" over a 84×16 inline SVG thermometer, a white tube with a black outline and a red bulb, the red
  filling to N/size. Board world, house tokens (`--kb-warn-fill` defaults to `#d01818`). None when N is 0. Its text is
  the accessible name.
- **BANNED:** the postbit's title line reads BANNED while `banned_until` holds, and the composer for a banned mask says
  plainly until when and that it ends by itself.
- **The notice:** a filed visit's post shows "This post was found in violation of Rule N: {plain}." as a bordered italic
  line at the top of the body, in the board's world; the post's words stay under it.
- **Presence** (`04-presence.png`): `presence_box` (`0093:10`) lists a Mod with an open visit in the thread, with its
  post number; `PresenceBox.tsx` (:34) draws the glass tag "On a visit · post #N" after its name, linking to the post,
  laid over the line.
- **The player's log** (`engine/ui/log/lines.ts`): `my_infractions`, `my_bans`, `my_reports` and `my_appeals` views,
  fields on `Log` (`api.ts:916`), reads in `supabase.ts:1303` and `fake.ts`, `LineKind`s and cases in `logRows` (:253).
  Each line says which Act did what, the points and when they drop off, in plain words ("The Clerk's visit to your post
  #41 filed Rule 2, No double posting: 2 warn points, dropping off Nov 13").
- **The Mod's moderation log:** `moves_log` (latest `0051:350`) gains visits filed, reports judged and appeals heard,
  each with how it ended.
- **Tests first:** each component's test, with axe; the meter's accessible name; the log lines; the report link absent
  on staff posts and the reader's own.

## Task 14: Divided World's content

Model: sonnet

- `instances/divided-world/system/lines.ts`: stock lines for `ruleSet`, `visitArrived`, `visitFiled`, a dismissal, a
  backfire and a ban, several each, in the staff's voice.
- `instances/divided-world/system/personas/*.ts`: each persona's `strictness`, `weakness` (a quiz bank of at least five
  questions, or a bribe price, or `distraction`) and `petRules` (keys from `PREDICATES`), marked as drafts for the owner,
  as the roster's placeholders are.
- `instances/divided-world/ui/` copy: the role word "A Moderator", and `--kb-visit-ink`.
- `instances/divided-world/settings.ts`: `modBots` and `warnBar` as the design's.
- **Tests first:** `instances/divided-world/system/system.test.ts`: every persona's pet rules are known predicates; every
  quiz answer is one of its choices; `instanceProblems` is empty.

## Task 15: a day of the Mods

Model: sonnet

- `supabase/tests/e2e/(next)-a-day-of-the-mods.ts`, on the pattern of `0015-a-day-of-the-staff.ts`: a meeting gives two
  Mods beats, orders and allowances; a breaking post draws a visit; a report is judged into a visit; a character fails a
  quiz and is tailed; another bribes; a visit files and the points land; a filing spends a Mod's allowance on a rule; the
  rule lands; a full bar bans; an appeal reduces; the next meeting returns the unspent allowance; a patrol runs once.
- Every call goes through the fake model; the ledger holds a row for each.

## Review focus

- **Acts an instance already holds:** `boards_now` is redefined. A board renamed before this change must show the same
  description after it.
- **The Boss's bank:** returning and charging allowances inside `apply_meeting`. A retried meeting must not return or
  charge twice, and a failed meeting must return nothing.
- **A second run or a retry:** `file_visit`, a patrol's `ran_at`, a report's refund, an appeal's refund and
  `apply_mod_move` must each act once when the cron, the tick and the function race.
- **A busy instance:** `rule_breaks` runs on every post. Measure it with ten rules in force on a board and 20,000 posts,
  and check that `noDuplicateTitle` and `noDoublePost` read by an index.
- **The masks:** `noDoublePost`, the report quota, tails and bans must compare characters. No judgment prompt may carry
  an owner, a class or a reactor. `patrol_sample` stays on the digest role's pinned list.
- **No player is stuck:** a visit whose Mod leaves the staff before it files, a ban whose season ends and a tail whose
  Mod is fired must each still end by themselves.
- **The fiction and the log:** a Mod's line may bluff. The log and the Lens's state must say exactly what landed, its
  points and when they drop off.
