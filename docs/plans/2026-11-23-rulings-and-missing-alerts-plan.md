Record, written 2026-11-23.

# Rulings, and the other things done to a player that never alerted: plan

Carries out `docs/plans/2026-11-23-rulings-and-missing-alerts-design.md`. One PR from `main`.

**The SQL this build redefines**, each copied whole from its latest migration with only the named change. Before
copying, find each object's latest with
`grep -liE "^\s*create( or replace)? function (public\.)?<name>\s*\(" supabase/migrations/*.sql | tail -1`, since later
migrations write `CREATE OR REPLACE FUNCTION public.<name>` in capitals. The column is where each stood on 2026-11-23.

| Object | Latest on `main` today | Task |
|---|---|---|
| `alerts_kind_check`, `account_preferences_toasts_check` (constraints) | `0213_cosmetics_log.sql` | 2 |
| `set_preferences` | `0213_cosmetics_log.sql:295` | 2 |
| `settings_held` | `0416_crowd_floor_setting.sql:7` | 2 |
| `file_visit` | `0361_discipline_cards.sql:1555` | 3 |
| `close_appeal` | `0361_discipline_cards.sql:1614` | 3 |
| `refund_appeal` | `0109_appeals.sql:525` | 3 |
| `close_report`, `refund_report` | `0401_report_no_visit.sql:154`, `:123` | 3 |
| `system_tick` | `0403_departed_personas.sql:579` | 4 |
| `reverse_card` | `0405_cut.sql:1394` | 5 |
| `reverse_award` | `0206_trophies.sql:259` | 5 |
| `close_poll_as_admin` | `0395_polls.sql:759` | 5 |
| `grant_gear` | `0213_cosmetics_log.sql:30` | 5 |
| `decide` | `0341_conduct_mail.sql:156` | 6 |
| `donate` | `0153_drives.sql:868` | 7 |
| `surface_apply` | `0317_surfaces.sql:354` | 7 |
| `refund_card_write` | `0149_card_writes.sql:651` | 8 |
| `my_alerts` | `0368_client_reads_plan_once.sql:1178` | 8 |
| `log_page` | `0396_poll_reads.sql:915` | 9 |

`write_alert` (`0061_account_channel.sql:113`) is called, never changed.

Every task goes test first: write the failing test, record its red run, then the code. During a task, run only the
tests for the changed code (`npx vitest run <file>`, `node --experimental-strip-types --test <file>` for the rules'
tests, or `node tools/test-sql.mjs <file>` for one SQL test). Run `npm run typecheck`, `npm run build` and
`npm run test:sql` once after the last task, with the tails in the PR. No deployed database, bucket or connector is
touched; SQL tests run against Postgres on localhost.

**The layers.** Every task is the engine's (design, section 8). Nothing names an instance, a persona or a card.

**The world.** Alerts and Settings are the glass, in its plain words. The conduct words are plain and never playful
(CLAUDE.md, "The fiction may lie; the log never does"). Nothing is drawn on the board.

**The migration.** One file, `NNNN_rulings_alerts.sql`, where `NNNN` is one above the highest number in
`supabase/migrations/` on `main` **at the time this build merges**. Rebase and renumber if `main` moves during review.
Tasks 2 to 9 each add a numbered section to it, in order, each headed by a comment naming the design's section. The
SQL test is `supabase/tests/NNNN-rulings-alerts.sql`, one block per task, built up task by task.

## Task 1. The catalog

Model: inline

**Files:** `engine/rules/alerts.ts`, `engine/rules/alerts.test.ts`.

- `WRITTEN_KINDS` gains `'gift'` and `'conduct'`, last, in that order.
- `RULING_SUBS` becomes `['warning', 'ban', 'fallTaken', 'reportJudged', 'reportRefunded', 'appealAnswered',
  'appealRefunded', 'grouped', 'threadMoved', 'trophyReversed', 'pollClosed', 'gearGiven'] as const`.
- New: `CARD_ENDED_SUBS = ['onYours', 'refunded'] as const` (null stays the caster's own, as built),
  `CARD_ON_YOURS_SUBS = ['drew'] as const`, and
  `CONDUCT_SUBS = ['hide', 'hideUntilEdited', 'unhide', 'approve'] as const` (the outcomes' own names in
  `conduct_decisions`), each with its type.
- The header comment's ruling paragraph is rewritten: "A ruling is written with a sub-key naming what landed (design
  `docs/plans/2026-11-23-rulings-and-missing-alerts-design.md`, section 7). A Mod Bot visit while it runs, and one
  that ends unfiled, writes none."

Tests, red first: the sorted `WRITTEN_KINDS` assertion gains the two; `RULING_SUBS` equals the list above;
each sub list holds no duplicate; every kind is in exactly one set (the existing test, unchanged).

## Task 2. SQL: the kinds and the toast preferences

Model: sonnet

**Files:** the migration (section 1), the SQL test, `engine/rules/settings-held.test.ts` (run, not changed).

- `alerts_kind_check` and `account_preferences_toasts_check` are dropped and added again with `'gift'` and
  `'conduct'` last. Take the current lists from `0213` and check no later migration changed either
  (`grep -l "alerts_kind_check\|account_preferences_toasts_check" supabase/migrations/*.sql`).
- `set_preferences`: its `known` array gains the two, with 0213's drop-and-create and its revoke and grant, as 0213
  did it.
- `settings_held`: its `kinds` array gains the two.

Tests, red first: an alert row of kind `gift` and one of `conduct` insert; one of kind `confetti` is refused;
`set_preferences(toasts => array['gift', 'conduct'])` is accepted. `settings-held.test.ts` (line 86 compares the SQL
array with `ALERT_KINDS`) goes red after Task 1 and green after this task; record both runs.

## Task 3. SQL: what a Mod Bot's work lands

Model: sonnet

**Files:** the migration (section 2), the SQL test.

- `file_visit`, after `hit := infract(...)`:
  - to `who`: `write_alert(who, 'ruling', case when hit ->> 'ban' is not null then 'ban' else 'warning' end,
    coalesce((hit ->> 'ban')::uuid, (hit ->> 'infraction')::uuid), null)`.
  - where `fall` is not null (`who` is the taker): `write_alert(author, 'ruling', 'fallTaken',
    (hit ->> 'infraction')::uuid, (select c.owner from characters c where c.id = who))`, so a player who took the
    fall for their own other mask hears nothing on it.
- `close_appeal`: once the ruling Act is written, `write_alert(<the appeal Act's character>, 'ruling',
  'appealAnswered', <the ruling Act>, null)`. Its `increased` call to `infract` writes no alert of its own (only
  `file_visit` writes `warning` and `ban`). Where the appeal expires unheard (its `'expired'` path), write
  `appealRefunded` about the appeal Act instead.
- `refund_appeal`: `write_alert(<the appeal's character>, 'ruling', 'appealRefunded', <the appeal Act>, null)`, once
  per refund. If `close_appeal`'s expired path calls `refund_appeal`, the alert is written in `refund_appeal` alone.
  Read both and keep one writer per refund.
- `close_report`: after the `report_verdict` Act, `write_alert(<the report's character>, 'ruling', 'reportJudged',
  <the verdict Act>, null)`.
- `refund_report`: `write_alert(<the report's character>, 'ruling', 'reportRefunded', <the report Act>, null)`. Check
  whether `close_report`'s refund path goes through `refund_report` or `pay_report_back`, and write once per refund.

Tests, red first, each on Postgres with a seeded visit, report or appeal as `supabase/tests/0109-reports.sql` and its
neighbours seed them:
- a filing writes one `ruling/warning` alert to the author's account, about the infraction;
- a filing that fills the bar writes one `ruling/ban` alert about the ban, and no `warning`;
- a filing with a live fall writes `warning` to the taker's account and `fallTaken` to the author's; with taker and
  author owned by one account, only the taker's `warning`;
- a visit ended `intercepted` or `dropped` writes no alert to the author;
- each appeal verdict writes one `appealAnswered` to the appellant; `increased` writes no `warning`;
- an expired appeal writes one `appealRefunded`; a report judged writes one `reportJudged` to the reporter, and a
  refunded one writes one `reportRefunded`;
- a staff character is never written to (an appeal or report by staff: no row).

## Task 4. SQL: a Boss's moves that land on yours

Model: sonnet

**Files:** the migration (section 3), the SQL test.

In `system_tick`, after `update queued_moves set landed_act = written where id = due.id;`:

- `due.kind = 'conferGroup'`: `write_alert(safe_uuid(lp ->> 'character'), 'ruling', 'grouped', written, null)`.
  Read `engine/system/moves.ts` (`conferGroup`, near line 271) for the param's name and use it.
- `due.kind = 'moveThread'`: `write_alert(<the character of the thread's origin Act>, 'ruling', 'threadMoved',
  written, null)`, the thread from `lp ->> 'thread'` (as the `moveThread` branch below reads it), the starter from
  `threads.origin`'s Act.
- `mergeBoard`, and leaving a group (`end_move`), write nothing.

Tests, red first: a landed `conferGroup` writes one `grouped` alert to the character's account; a landed `moveThread`
writes one `threadMoved` to the starter's; a `mergeBoard` writes none; a move whose landing is refused writes none; a
staff starter gets none.

## Task 5. SQL: an admin's in-game acts on yours

Model: sonnet

**Files:** the migration (section 4), the SQL test.

- `reverse_card`: beside the caster's `write_alert(p.character, 'cardEnded', null, written, null)`, the target's:
  `write_alert(<target character>, 'cardEnded', 'onYours', written, <the caster's owner>)`. The target character is
  found as `my_cards_ended` (`0402_thread_lockout.sql`, near line 1281) finds the target side: the post's author at post reach, the
  character at character reach, the thread starter at thread reach, the locked character for a lockout. None at board
  reach. Passing the caster's owner as acting writes nothing where caster and target are one player's.
- `reverse_award`: `write_alert(<the award's character>, 'ruling', 'trophyReversed', null, null)`.
- `close_poll_as_admin`: `write_alert(<the poll post's character>, 'ruling', 'pollClosed', <the close Act>, null)`.
- `grant_gear`: `write_alert(of_character, 'ruling', 'gearGiven', null, null)`.

Tests, red first: each writes one row, of the kind and sub above, to the right account; `reverse_card` on a card
whose caster and target share an owner writes the caster's alert alone; on a board-reach card, the caster's alone.

## Task 6. SQL: real moderation on a post

Model: sonnet

**Files:** the migration (section 5), the SQL test.

`decide`: where it writes a decision whose outcome is `hide`, `hideUntilEdited`, `unhide` or `approve` (read
`conduct_write`, `0340_conduct.sql:1351`, for the column names and the version Act), `write_alert(<the version Act's
character>, 'conduct', <outcome>, <the version Act>, null)`. The account-level outcomes write no alert. The mail
`0341` sends is unchanged.

Tests, red first: each of the four outcomes writes one `conduct` row with that sub to the post author's account; a
`nudge` and a `suspend` write none; the mail queue's rows are as before.

## Task 7. SQL: gifts and drawings

Model: sonnet

**Files:** the migration (section 6), the SQL test.

- `donate`: after the `donation` Act, `write_alert(<the drive post's character>, 'gift', null, <the donation Act>,
  (select c.owner from characters c where c.id = <the donor character>))`. `donate` is service-role, so
  `auth.uid()` is null: the acting account is the donor character's owner.
- `surface_apply`: for kind `draw`, after the Act, `write_alert(<the wall post's character>, 'cardOnYours', 'drew',
  <the draw Act>, (select c.owner from characters c where c.id = <the drawing character>))`. A staff draw
  (`staff_draw_on_surface` lands here too) has a null owner, so the author is told. A wash writes none.

Tests, red first: a gift writes one `gift` row to the author's account; a gift between one player's two masks writes
none; a draw writes one `cardOnYours/drew` row; a draw by one's own other mask writes none; a staff draw writes one;
a wash writes none; a refused gift or draw writes none.

## Task 8. SQL: the refunded writing card, and crowd pay in the settlement alert

Model: sonnet

**Files:** the migration (section 7), the SQL test.

- `refund_card_write`: `write_alert(<the play's character>, 'cardEnded', 'refunded', <the play Act>, null)`, once
  per refund.
- `my_alerts`: its settlement branch (`st_k` and `st_tie`, near `0368:1220`) counts a settlement where the account has
  a ledger line **or** a `wallet_events` row of kind `crowd` with that `settlement`. Its `count` stays the number of
  the account's characters with ledger lines, which may now be 0. Copy the function whole; change only those two
  CTEs. Check `alerts_page` still reads the same columns.

Tests, red first: a refunded write writes one `cardEnded/refunded` row to the caster's account; a settlement that paid
the account crowd pay and no ledger line appears in `my_alerts` with `count` 0; one with ledger lines is as before.
Keep `supabase/tests/0065-alerts-read.sql`'s buffer bound green (issue #316 notes it was raised once); report any
change it needs in the PR.

## Task 9. A thread moved, in My log

Model: sonnet

**Files:** the migration (section 8), the SQL test, `engine/ui/log/lines.ts`, `engine/ui/log/useLog.ts`,
`engine/ui/log/lines.test.tsx`, the log's types in `engine/ui/data/`.

- `log_page` gains `moved`: for each landed `moveThread` move whose thread was started by one of the caller's
  characters, `{move, at, thread, character, from, to}`, from the move Act's public payload (its `params` and the
  board names its line already names, `engine/system/moves.ts` near line 175). Newest first, within the page's window
  as its other lists are.
- `lines.ts` gains a row of kind `threadMoved`: "'<title>' was moved to the <board> board", details naming the board
  it left, `characters: [character]`.

Tests, red first: the SQL test reads one moved thread for its starter and none for another account;
`lines.test.tsx` builds the row's words from a `moved` entry.

## Task 10. The fake

Model: sonnet

**Files:** `engine/ui/data/fake.ts`, `engine/ui/data/fake.test.tsx`.

- `derivedAlert` (near line 733) and its return type gain: a `donation` Act, as `gift` to the drive post's author;
  a `draw` Act, as `cardOnYours` sub `drew` to the wall post's author; a `card_end` Act by an admin, as `cardEnded`
  sub `onYours` to the target side as Task 5 finds it, beside the caster's. Each skips the acting account's own
  characters and staff, as the function does now. The live event's `sub` carries the sub, not `null`.
- `closePollAsAdmin` (near line 1659) writes a `ruling/pollClosed` alert to the poll's account.
- The seed's `alert(...)` (near line 142) accepts the new kinds and subs, so stories and tests can seed the rulings the
  fake does not simulate (filings, appeals, reports, Boss moves, conduct, gear, trophies).

Tests, red first, beside the fake's alert tests: a donation, a draw and an admin's end of a card on yours each reach
the target's account on `account:<id>`; none for one's own other mask.

## Task 11. The words, the batches, Settings and the icons

Model: sonnet

**Files:** `engine/ui/alerts/words.ts`, `engine/ui/alerts/words.test.tsx`, `engine/ui/alerts/Alerts.tsx`,
`engine/ui/alerts/AlertIcon.tsx`, `engine/ui/alerts/alerts.css`, `engine/ui/alerts/toasts.css`,
`engine/ui/alerts/toast-kinds.ts`, `engine/ui/account/Settings.tsx`, `engine/ui/alerts/Alerts.board.stories.tsx`.

- `wordsFor`'s `ruling` case becomes one line per sub. Each line is plain and names the character (`row.name`). Its
  detail sentence names what landed, read from the Act where there is one. Its way is the post (a filing, a fall),
  the log (a ban, a trophy, gear, a group), the thread (a move), or the Lens of the report or appeal. The lines:
  - `warning`: "<name> got <n> warn points". Detail: the rule and the Mod from the infraction, "They drop off <date>.
    You can appeal from the post."
  - `ban`: "<name> was banned until <date>". Detail: "The warn bar filled. The ban ends by itself; you can appeal it
    to the Boss."
  - `fallTaken`: "<taker> took the fall for <name>'s post". Detail: the points landed on the taker.
  - `reportJudged`: "<name>'s report was judged: <verdict>". `reportRefunded`: "<name>'s report could not be heard"
    and "Its cost was refunded."
  - `appealAnswered`: "<name>'s appeal was <verdict>". `appealRefunded`: "<name>'s appeal was not heard" and "Its
    cost was refunded. You can appeal again."
  - `grouped`: "<name> was put in <group>". Detail: when it ends, and how to leave it (the appeal, an apology), from
    the move.
  - `threadMoved`: "<title> was moved to the <board> board".
  - `trophyReversed`: "An admin took back a trophy from <name>" and "The log says which."
  - `pollClosed`: "An admin closed <name>'s poll".
  - `gearGiven`: "An admin gave <name> gear" and "The log says what."
  - An unknown or null sub keeps today's words.
- `cardEnded`: sub `onYours`: "An admin ended <card> on <place>", with the target side's place words (`endedOn`).
  Sub `refunded`: "Your <card> did not take; it was refunded".
- `cardOnYours` sub `drew`: "<drawer> drew on the wall on your post #<n>". `targetKey` batches drawings per wall
  (`wall:<the play>`) and `batchWords` says "<n> drawings on the wall on your post #<n>".
- `gift`: "A gift of <amount> reached <name>", batched per drive (`drive:<the drive's opening play>`): "<n> gifts
  reached <name>'s drive".
- `conduct`, plain, one line per outcome, its way the post (and its edit for `hideUntilEdited`):
  - `hide`: "An admin hid <name>'s post for the code of conduct"
  - `hideUntilEdited`: "An admin hid <name>'s post until it is edited", with "Edit the post to bring it back."
  - `unhide`: "An admin brought back <name>'s post"
  - `approve`: "An admin approved the edit to <name>'s post"
- `settlement` with `count` 0: "Crowd pay came in." in place of "It moved 0 of your characters."
- `TOAST_DEFAULTS` gains `gift: true, conduct: true`. `Settings.tsx`'s list (near line 73) gains "Gifts" ("A gift
  reaches one of your characters through a drive.") and "Code of conduct" ("An admin hides or brings back one of
  your posts."). "Rulings"' sentence becomes "A Mod Bot, the Boss or an admin rules on one of your characters."
- `AlertIcon` and both stylesheets give `gift` and `conduct` an icon and an ink, chosen from the glass's existing
  inks so contrast holds (`engine/ui/contrast.test.tsx`).
- The story seeds one of each new sub.

Tests, red first, in `words.test.tsx`: each sub's line from a seeded row; an unknown sub's fallback; the two batches'
words; the crowd-only settlement's words. `engine/ui/a11y.selftest.test.tsx` and the contrast test stay green.

## Task 12. The build

Model: inline

Run `npm run typecheck`, `npm run build` and `npm run test:sql`, and put the tails in the PR. Its body says which
earlier designs this one revises (the design's sections 1 and 2) and that those records are left as written.

## Review focus

- **Double alerts:** an `increased` appeal that lays a ban must write one `appealAnswered` and no `ban`; a refund
  reached by two paths (`close_appeal` → `refund_appeal`, `close_report` → a refund) must write once.
- **The masks:** every player-acted writer (`donate`, `surface_apply`, `file_visit`'s fall, `reverse_card`'s target
  side) passes the acting player's account, so one's own other masks never alert. Check no response or its timing
  differs with whether a row was written.
- **The silent visit:** no path through `end_visit` other than a filing writes to the visited author, including a
  trap's end and an admin's reversal.
- **Copies whole:** every redefined function is its latest on `main` when the build starts, with only the named
  change; a function another PR redefines in the meantime is copied again.
- **A busy instance:** `my_alerts`' crowd branch must read `wallet_events` by account (`wallet_events_account`) and
  keep `0065-alerts-read`'s bound; a wall's drawings and a drive's gifts batch on the page.
- **Acts already held:** no backfill. Alerts start from the build's deploy, and every past ruling stays in My log.
