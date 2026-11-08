# Member groups: plan

Record, written 2026-11-06. The plan for `docs/plans/2026-11-06-member-groups-design.md`. One build session builds it in
one PR from `main`. The look is `docs/research/2026-11-06-member-groups/01-bars.html`, option A and the barred reply box,
which the owner approved on 2026-11-06. It is drawn on the board look's Silver theme (branch
`claude/2003-board-screen-design-eposbs`, not yet on `main`): build the bar on whatever house tokens `main` holds, with
its shape in tokens, so Silver restyles it when it lands.

Every task is test first: name the test, record its red run, then write the code. Migrations take the next free numbers
when the build starts (0099 and on at the time of writing; read `supabase/migrations/` and
`tools/check-migration-versions.mjs` first). SQL tests go in `supabase/tests/` under the numbering the suite uses today
(its numbers run ahead of the migrations': `0046_moves.sql` is tested by `0051-moves.sql`), and run with
`npm run test:sql`. The engine names no group and no instance (`tools/check-engine-boundary.mjs`).

What the build reuses, read before Task 4: `engine/system/moves.ts` (`MoveKind`, `MOVE_KINDS`, `moveParamsProblems`),
`engine/system/demands.ts` (`DEMAND_KINDS`, `demandProblems`), `engine/system/meeting.ts` (`meetingSystemPrompt`,
`repairAnswer`, `DEMAND_ID_ROLES`), `supabase/functions/meet/core.ts` (`runMeeting`), and in SQL: `queued_moves_guard`
(latest `0082_offices.sql`), `apply_meeting` (`0051_succession.sql`), `end_move` and `acts_move_end_payload`
(`0051_succession.sql`), `demand_progress` and `demand_params_problem` (`0046_moves.sql`), `system_tick` (latest
`0053_stored_progress.sql`), `reverse_move` (`0049_admin_queue.sql`), `moves_log` (`0051_succession.sql`),
`write_staff_act` (`0051_succession.sql`). A redefinition starts from the latest definition, whole.

**Amended 2026-11-06, after the Mod Bots design** (the design's section 8). This plan builds **after the Mod Bots plan
(`docs/plans/2026-11-06-mod-bots-plan.md`) has merged, all fifteen tasks**, and reuses what it builds:
`MoveKind.offices` and `move_kinds.offices` (its Task 3); `beat_of`, `mod_allowance` and the guard's office and beat
refusals (Task 4); per-character bans in `post`, `start_thread`, `spin` and `edit_post` (Task 5); the `staff` Edge
Function, `MOD_MOVE_RULE` and `repairModMove` in `engine/system/judgment.ts`, and `apply_mod_move` (Task 7); `open_appeal`,
`close_appeal`, `refund_appeal` and the `appeal` and `appeal_ruling` Acts (Task 10); `staff_punishments` and
`Settings.modBots.cap` (Task 11); the log's `my_*` views (Task 13). Read each before the task here that names it. Where a
task below and this paragraph disagree, the task's amended text (marked **Amended**) wins. Tasks 13 and 14 are new.

**Amended 2026-11-07, aligned with `main` at `047f7d1`** (Mod Bots and the board look both merged). Where this paragraph
and a task disagree, this paragraph wins.

- *Numbers and latest definitions.* Migrations and SQL tests start at 0116. The latest definitions are:
  `queued_moves_guard` and `apply_mod_move` in 0106; `apply_meeting` and `staff_punishments` in 0110; `meeting_context`,
  `beat_of` and `mod_allowance` in 0103; `system_tick`, `post`, `start_thread` and `spin` in 0105; `seed_instance` in
  0108; `characters_public` and `edit_post` in 0104; `write_staff_act`, `open_appeal`, `close_appeal` and
  `refund_appeal` in 0109; `moves_log` in 0111. The board look is on `main`, with Silver in
  `instances/divided-world/ui/theme.css` and four tribute themes beside it: the bar's shape tokens must read in each.
- *Names that moved.* `acts_move_end_payload` is a check constraint on `acts` (0051), dropped and re-added with
  `unmet` and `overturned`; `end_move`'s own `why` list and `say_move_end`'s line cases gain both. `open_moves` has no
  `expires_at` (see Task 14). `runPatrols` is in `supabase/functions/staff/patrol.ts`, chained after filings by
  `runPatrolsAfterFilings`; `runApologies` is chained the same way in `staff/index.ts`. `SystemBoardNote` is a function
  in `engine/ui/composer/Composer.tsx`; `StaffGroup` is exported from `StaffBadge.tsx`. Stock line keys are
  `STOCK_LINE_KEYS` in `engine/system/stock.ts`, their words in `instances/divided-world/system/lines.ts`. The ban
  refusal is `not_banned(through)`; the bar's refusal follows it.
- *What carries `group` to the screens (Task 3).* Besides `characters_public`, every function that builds a character
  object by explicit keys gains `group`: `thread_page`, `profile_page`, `record_page`, `presence_box` and `my_characters`
  (latest 0111), and `toCharacter` in `web/src/data/supabase.ts`.
- *Settings.* `apologyEveryHours`, `apologyJudgeBatch` and `apologyRulingMaxWords` live under `Settings.apology` (not `groups`, which `ScreenSettings` uses for the group looks), with
  their defaults in `instances/divided-world/settings.ts`, validated in `engine/rules/instance.ts` and in SQL's
  `settings_held`/`setting_valid` lists, in Task 6's migration.
- *The duty.* `apologyJudge` joins `DUTIES` and `DUTY_DEFAULTS` in `engine/system/duties.ts`; the instance assigns it
  `filer`, which resolves to the move's staff member, the Boss's or a Mod's.
- *New thread.* `engine/ui/board/NewThread.tsx` has no ban note today; Task 10 builds the barred box there and in the
  reply box, and shows the ban note in New thread too, so the two composers agree.
- *Appeals (the owner, 2026-11-07).* A group move's expiry is moved as a ban's is: the `appeal_ruling` Act carries
  `until`, and a `move_expires_at(move)` function reads the latest ruling's `until`, else the move's own `expires_at`,
  as `banned_until` does. The tick's expiry pass, `bars_now`, the barred box and the log read it; `open_moves` gains no
  column. The verdicts mean what they mean on a ban: **reduced** ends at the move's landing plus half its length (it may
  end at once); **increased** adds half its length, never past the phase's `moveExpiryMostDays` from landing. Task 14's
  text below is superseded where it says otherwise.
- *Renumbered on merging `main`.* The groups migrations landed as 0119–0128 (tests 0121–0129), after `main`'s
  0116–0118 (tweener standings, search, BBCode tags); the numbers 0116–0125 in this plan name them as first written.
  Merging `main` again moved them to 0124–0134 (tests 0125–0134), after `main`'s 0119–0123 (the glass-load pages).

## Task 1: groups in the engine (engine)

Model: sonnet

Files: `engine/rules/groups.ts`, `groups.test.ts`; `engine/rules/types.ts` (`Instance` gains `groups: GroupsContent`).

- Types: `GroupLook { key; name; color /* #rrggbb */; stripe?: boolean }`;
  `Rung = GroupLook & { when: { kind: 'default' } | { kind: 'posts'; atLeast: number } | { kind: 'seasons'; atLeast: number } | { kind: 'staff' } }`;
  `Conferred = GroupLook & { tone: 'punishment' | 'favor' }`; `GroupsContent { ladder: readonly Rung[]; conferred: readonly Conferred[] }`.
  The ladder is ordered lowest first.
- `CONDITION_KINDS = ['default', 'posts', 'seasons', 'staff'] as const`: the one list SQL's `group_now` has a case for.
- `groupsProblems(content): string[]`, in words: exactly one `default` rung and it is first; exactly one `staff` rung and
  it is last; keys unique across ladder and conferred; `atLeast` a positive integer; colors `#rrggbb`; names 1–32
  characters. `seed` refuses content with problems.
- `earnedGroup(ladder, facts: { posts; seasons; staff }): string`: the key of the highest rung whose condition holds.
  It is the reference the SQL view is tested against (Task 3 runs the same table of cases).

Tests first: a table of facts against a four-rung ladder (0 posts → default; 100 posts → posts rung; 5 posts and 2
seasons → seasons rung; staff with 0 posts → staff rung); each poison for `groupsProblems` (no default, two staff rungs,
a duplicate key, `#fff`, a 33-character name) named in its failure.

## Task 2: Divided World's groups (instance)

Model: haiku

Files: `instances/divided-world/groups.ts`, `instances/divided-world/index.ts` (adds `groups`),
`instances/divided-world/groups.test.ts` (runs `groupsProblems` and expects none). Reads only these and
`engine/rules/groups.ts`.

The content, exactly (drafted for the owner's review in the PR):

| Key | Name | Color | Stripe | Kind |
| --- | --- | --- | --- | --- |
| `members` | Members | `#7a7a7a` | | rung, default |
| `regulars` | Regulars | `#2f6fb0` | | rung, posts at least 100 |
| `oldGuard` | Old Guard | `#9c6b30` | | rung, seasons at least 2 |
| `personalityCores` | Personality Cores | `#d4a017` | | rung, staff |
| `trialMembers` | Trial Members | `#d2691e` | yes | conferred, punishment |
| `teachersPet` | Teacher's Pet | `#c2408f` | | conferred, favor |
| `hallMonitors` | Hall Monitors | `#3f8f5a` | | conferred, favor |

`staffGroup` leaves `instances/divided-world/system/index.ts` in Task 9, not here.

## Task 3: groups in the database (migration)

Model: sonnet

Files: a new migration (`NNNN_groups.sql`); `supabase/functions/_shared/seed.ts` (`instanceSeed` sends `groups`);
`supabase/tests/NNNN-groups.sql`.

- `group_kinds(key text primary key, name, color, stripe boolean, source text check (source in ('ladder','conferred')), rung int null, condition text null, at_least int null, tone text null)`
  with checks tying `source` to which columns are set and `condition` to `CONDITION_KINDS`. No client grant: screens get
  names and colors from `screen_settings`.
- `seed_instance`, redefined whole from its latest (`0091_seed_reaction_kinds.sql`), upserts `group_kinds` from
  `payload -> 'groups'` and deletes rows no longer in it only when no move names them (a group named by a past move keeps
  its row so its log line can still name it).
- `group_now(in_character uuid) returns text`, stable: the `groupKey` of the open `conferGroup` move whose
  `params->>'character'` is the character (through `open_moves`), else the highest rung by a `case` per condition kind
  over `character_post_counts.posts`, the count of the character's `reveal` Acts (the 0032 index), and `staff_office_now`.
  A condition kind it has no case for raises (the pair with Task 1's list).
- `characters_public` (latest `0082_offices.sql`) gains `"group" text` from `group_now(id)`.
- `screen_settings` (latest `0084_staff_presence.sql`) carries a `groups` key: `[{key, name, color, stripe}]` for every
  row of `group_kinds`. Add it to `engine/ui/guide/markdown.ts`'s key list as `staffGroup` is.

Tests first: the Task 1 table of cases, made with `tests.character` and `tests.post` and a reveal Act, read through
`characters_public`; a seed with an unknown condition kind refused (the poison); a seed that drops a group a move named
keeps its row.

Cost on a busy instance: `group_now` is a primary-key read, an index count of a character's reveals (a handful), an office
lookup and a probe of `open_moves` (moves in force, a few). It runs per row a screen reads, never per Act.

## Task 4: the move, the demand and the favor's check (engine)

Model: sonnet

Files: `engine/system/moves.ts`, `moves.test.ts`; `engine/system/demands.ts`, `demands.test.ts`;
`engine/system/duties.ts` (adds `apologyJudge`, chat, light); `engine/ui/board/move-words.ts` (`endedWords`/`endedBase`
gain `unmet` and `apology`).

- `CONFER_GROUP: MoveKind`: key `conferGroup`, small, not `shapesBoard`, askable; label `THE BOSS MOVED A MEMBER`; params
  `{ character: uuid; group: string 1..40; board?: uuid; checkAt?: string }`; `uuids: ['character']` (and `board` when
  present: extend `moveParamsProblems` with optional uuids rather than special-casing); `plain`: `moving a member into
  "{groupName}"`; `template` in plain words, e.g. "The Boss put Pipewrench in Trial Members, barred from posting on
  General." `parts` for the moderation log: "Put Pipewrench in Trial Members, barred from General" / "Put … (planned)".
  The words read the group's name from the instance, passed in, never named here.
- `APOLOGY_ACCEPTED: DemandKind`: key `apologyAccepted`, params `{}` (the move is its own subject), unit "apology", met
  when one is accepted; template "an accepted apology". The meeting may not choose it: the code sets it (Task 7).
- `MoveKind` gains no field for inversion: a favor's move carries `checkAt` in its params, and the tick (Task 5) reads it.
- **Amended:** `CONFER_GROUP.offices` is `['boss', 'mod']` (Mod Bots Task 3). `endedWords` also gains `overturned` ("Ended:
  overturned on appeal"). `apologyJudge` is assigned by the instance as `appeal` is, to the staff member who made the move
  (Mod Bots Task 7 names that assignee `filer`).

Tests first: `moveParamsProblems('conferGroup', …)` accepting a punishment with a board and a favor with `checkAt`,
rejecting a non-uuid board and naming `isUuid`; a 41-character group key rejected; `demandProblems` accepting
`apologyAccepted`; `endedWords` for `unmet` ("Stripped: the demand was not met by its check") and for an accepted apology
("Ended: an apology was accepted").

## Task 5: the move in SQL, the cap and the favor's check (migration)

Model: sonnet

Files: a new migration (`NNNN_group_moves.sql`); `supabase/tests/NNNN-group-moves.sql`.

- `demand_params_problem` and `demand_progress` gain the `apologyAccepted` case: met when an `apologies` row for the move
  is `accepted` (the table is Task 6's; this migration creates it, Task 6 adds its functions).
- `end_move` and `acts_move_end_payload` accept `why = 'unmet'` and (**Amended**, Task 14) `why = 'overturned'`.
- `queued_moves_guard`, redefined whole, gains a `conferGroup` case:
  - the character is in `characters_public` and is not staff;
  - the group is a `conferred` row of `group_kinds`;
  - a board is named only by a punishment, and is a board that is not the system's;
  - a punishment that names a board carries the demand `apologyAccepted`, and nothing else carries it;
  - a favor carries `checkAt` between its go-live and its expiry, and a punishment carries none;
  - no other `conferGroup` move on the character is in force or queued unheld;
  - a punishment is refused when `staff_punishments(character, cap.days) >= cap.punishments` (**Amended:** Mod Bots
    Task 11's function and `Settings.modBots.cap`; no setting of this plan's own);
  - **Amended:** a Mod's `conferGroup` (`queued_moves.staff` a Mod's key) is a punishment and names a board whose
    `beat_of` is that Mod; a Mod's favor, or a Mod's punishment with no board or a board off its beat, is refused.
- **Amended:** `staff_punishments`, redefined whole from Mod Bots Task 11, also counts landed `move` Acts and unheld
  queued moves of kind `conferGroup` whose group is a punishment and whose `params->>'character'` is the character, in
  the window, whoever made them. The cap is one function and one setting ("Two lists that must agree are one list").
- `system_tick`, redefined whole, gains a pass after pass 3: for each open `conferGroup` move whose `params->>'checkAt'`
  has passed and whose `progress` is not met, `end_move(act, 'unmet', 'check')` then `say_move_end`. A met favor is left
  to its expiry. Add a stock line key `moveUnmet` to the instance's system lines and `seed`'s line list.
- `bars_now` view (security invoker, public): `(character, board, move_act, group, expires_at)` from `open_moves` for
  `conferGroup` moves with a board.

Tests first: each guard refusal, one at a time, with its message; the cap at 3 within 7 days and a fourth refused, and
the window passing; a favor met before `checkAt` kept and an unmet one ended `unmet` by `system_tick`; `reverse_move` on a
group move returning the character to its rung through `characters_public`.

## Task 6: the bar and the apology (migration, engine rules)

Model: sonnet

Files: a new migration (`NNNN_bars_apologies.sql`); `engine/rules/actions.ts` (an `apologize` action beside `spin`);
`supabase/functions/act/core.ts` if it lists actions; `supabase/tests/NNNN-bars-apologies.sql`; `actions.test.ts`.

- `barred(in_character, in_board) returns boolean` reads `bars_now`. `post` (latest `0078_reply_passes.sql`),
  `start_thread` (latest `0013_system_board.sql`), `spin` (same) and `edit_post` (latest `0005_actions.sql`, or later if
  redefined) each refuse with `"%s is barred from posting on %s until %s"` (character name, board name from
  `boards_now`, the move's `expires_at`) after `acting(through)` and the board lookup, beside `not_the_systems`. A spin's
  board is the board its thread opens on.
  **Amended:** each of the four is redefined from Mod Bots Task 5's version, which refuses a banned character first; the
  ban's refusal stays first, so a banned and barred character is told of its ban.
- `apologies(id, move_act, apology_act, character, state text check (state in ('pending','accepted','rejected','returned')), ruling_act null, created_at)`:
  the state lives here, never in an Act ("Append-only").
- `apologize(in_move uuid, through uuid, title text, body text)`: `acting(through)`; **Amended:** refused while
  `through` is banned (the ban ends by itself, then the apology is open); the move is an open `conferGroup`
  move whose character is `through` and whose demand is `apologyAccepted`; no `pending` row for it; no `accepted`,
  `rejected` or `pending` row for this character and move in the last `apologyEveryHours` (setting, 24); then writes the
  spin of the move Act exactly as `spin` does, skipping only the bar, and a `pending` row. Returns the thread.
- `rule_apology(in_apology uuid, verdict text, ruling text)`, service role only: for `accepted` or `rejected`, writes the
  ruling as a post by the move's staff character in the apology's thread through `write_staff_act`, with payload
  `{ruling: verdict, apology: <act>}`, and sets the row; for `returned` sets the row only. A second ruling on a row that
  is not `pending` is refused.
- `pending_apologies()`, service role only: the pending rows with the move's params, the staff key, the apology's body
  and the move's stock line, oldest first, limited to `apologyJudgeBatch` (setting, 10).

Tests first: a barred character refused by each of the four functions, and the same player's other character allowed on
the same board (the masks: a bar is per character); an apology accepted for a move that bars the very board it spins
onto; a second apology within 24 hours refused and one after a `returned` allowed; `apologize` on someone else's move
refused; `rule_apology('accepted')` meeting the demand so that `system_tick` ends the move `met`.

## Task 7: the judge (the `staff` Edge Function, engine prompt, instance duty)

Model: sonnet

Files: `engine/system/apology.ts`, `apology.test.ts` (the prompt, the schema, the repair); **Amended:** a `runApologies`
job in Mod Bots' `supabase/functions/staff/` (`core.ts`, `core.test.ts`), run on its cron (`modBots.filingCron`) beside
`runFilings` and `runPatrols`, with no function, cron or schedule of its own; `instances/divided-world/system/index.ts`
assigns `apologyJudge` as it assigns `appeal`. The judge is the move's staff member, the Boss or a Mod.

- `apologyPrompt(persona, move words, apology body)`: the persona's voice, what the move did in plain words, the apology,
  and the two verdicts. It is given no owner and no class.
- Schema `{verdict: 'accepted' | 'rejected', ruling: string}`; `repairApology`: a verdict outside the list is rejected
  (it cannot be repaired without inventing content); a ruling over `apologyRulingMaxWords` (setting, 80) is trimmed and the
  trim recorded on the call's record ("A validator tighter than the schema …").
- `core.ts`: for each of `pending_apologies()`, one `models.chat` with duty `apologyJudge` (ledgered as every call is),
  then `rule_apology`. A transport failure is retried on the request; a call that still fails, or an answer rejected,
  calls `rule_apology(id, 'returned', '')`. A database error is thrown at once.

Tests first: the repair's table (an unknown verdict rejected naming `oneOf`, an 81-word ruling trimmed to 80 with the trim
recorded); `core.test.ts` with a fake `Models` that fails once and then answers, and one that answers "maybe", ending
`returned`.

Cost on a busy instance: an apology needs a punishment move with a bar in force, moves come from the bank (5 a week, 10
banked at most), and each character apologizes at most once a day per move, so calls a day stay under the bank's
moves in force, however many players there are.

## Task 8: the meeting confers groups (engine, edge)

Model: sonnet

Files: `engine/system/meeting.ts`, `meeting.test.ts`; `supabase/functions/meet/core.ts`; the migration that redefines
`meeting_context` and `apply_meeting` (latest definitions first).

- `meeting_context` gains `groups`: the conferred catalog (key, name, tone), and for each character the digest names, its
  group now and whether it is `capped` (`punishments_in_window` at the cap) or `held` (a group move in force or queued).
- `meetingSystemPrompt` lists the conferred groups with their tones and the rule: a punishment may name one board and then
  its demand is an accepted apology; a favor names a check and an inverted demand; capped and held characters can't be
  chosen.
- `repairAnswer`'s `conferGroup` branch: the character is public now (`DEMAND_ID_ROLES`); a key outside the catalog
  drops the move and records it; a capped or held character drops it; a punishment naming a board gets its demand set to
  `apologyAccepted` by the code, whatever the model wrote; a favor without a `checkAt` gets one at half its expiry; a
  favor naming a board drops the board and records the trim.
- `apply_meeting` passes `checkAt` through in `params`.
- **Amended:** the prompt's line from Mod Bots Task 4, that `setRule` is the one kind the Boss can hand on, becomes
  `setRule` and `conferGroup` punishments on the Mod's beat.

Tests first: `repairAnswer` on each branch above, each with its recorded drop or trim.

## Task 9: the rank bar (engine UI, instance)

Model: sonnet

Files: `engine/ui/postbit/GroupBar.tsx`, `GroupBar.test.tsx`; `engine/ui/postbit/Postbit.tsx`, `postbit.css`;
`engine/ui/postbit/StaffBadge.tsx`; `engine/ui/profile/Profile.tsx` and `Staff.tsx` (a Group row); the presence boxes'
use of `StaffGroup`; `engine/ui/tokens.css` (`--kb-group-bar-width`, `-height`, `-radius`, `-edge`, `-font`);
`engine/ui/data/api.ts` (`Character.group`, `ScreenSettings.groups` replacing `staffGroup`);
`web/src/data/supabase.ts` (`toCharacter`), `web/src/data/settings.ts`; `instances/divided-world/system/index.ts`,
`engine/rules/types.ts` (`SystemContent.staffGroup` removed); `seed.ts` and `seed_instance` stop writing `staffGroup`
(in Task 3's or Task 5's migration, whichever is still unshipped).

- `GroupBar({ group })`: the mockup's bar, the group's name in capitals as real text, its color a game piece's (an inline
  custom property from settings, so `check-ui-tokens` passes), the stripe for `stripe`. Text contrast is measured on the
  bar's face (`engine/ui/contrast.ts`); a color too light for white text gets a dark text shadow strong enough to pass, and
  the test says which.
- The postbit shows it under the name for every character. **Amended:** top down, a postbit reads name, group bar,
  title or BANNED, pips, warn meter (Mod Bots Task 13 places the meter under the rank).
  A staff postbit shows the staff rung's bar and the office title
  (ADMINISTRATOR or MODERATOR) beside it; `StaffBadge` keeps only the title.
- The profile shows a Group row. The presence boxes' staff chip reads the staff rung's name.

Tests first: `GroupBar` for each Divided World group passes the contrast test; the postbit for a member, a Trial Member
and a staff character (stories in `Postbit.stories.tsx` for the three); no `staffGroup` left (`rg staffGroup` empty).

## Task 10: the barred box, the apology and the move's posts (engine UI)

Model: sonnet

Files: `engine/ui/composer/` (a `BarredNote` beside `SystemBoardNote`), `engine/ui/thread/Thread.tsx`, the board page's New
thread; `engine/ui/thread/Post.tsx` (a `conferGroup` move and a ruling post); `engine/ui/board/MoveSentence.tsx`,
`MoveNotice.tsx`; `engine/ui/data/api.ts` and `web/src/data/supabase.ts` (`barsNow`, `apologize`).

- Where the acting character is barred, the composer's place holds the mockup's box: "{name} can't post on {board} right
  now." then "The Boss put {name} in {group} on {date}, and {group} can't post here. It ends on {expiry}, or sooner if the
  Boss accepts a public apology. You can still read everything here." with **Write an apology** (opens the composer as a
  spin of the move, through `apologize`) and **See the move**. While an apology waits: "Your apology is with the Boss."
  After a rejection, the time the next one may be written. Board copy, plain and true.
- A ruling post shows ACCEPTED or REJECTED in the move's label style above the staff member's words.
- The other masks: the box is per acting character; swapping masks in the composer swaps the box away.
- **Amended:** a banned character's composer note (Mod Bots Task 13) shows instead of this box, and its Write an apology
  is not offered while the ban holds.
- **Amended:** the barred box gains **Appeal** with its price, opening Mod Bots' appeal form on the move (Task 14).

Tests first: the box for a barred character, gone for the same player's other character; the three apology states.

## Task 11: the log (migration, engine UI)

Model: sonnet

Files: a migration with `my_group_moves` (a security-invoker view in the shape of `my_cards_ended`,
`0092_card_end.sql`), beside Mod Bots Task 13's `my_*` views; `engine/ui/log/lines.ts` (`LineKind` gains `grouped`), `Log.tsx`, `lines.test.tsx`;
`supabase/tests/NNNN-group-log.sql`.

- A row for each `conferGroup` move on one of the caller's characters, and its end. The line, in plain words: "The Boss
  put Pipewrench in Trial Members and barred it from posting on General until Nov 13." and "Pipewrench left Trial
  Members: an apology was accepted." (or: it expired; an admin reversed it; the demand wasn't met by its check). It names
  the move with a link. It never names who else is in a group.
- **Amended:** no alert (the design's section 8), as Mod Bots sends none for a visit. An appeal's ruling on a group move
  is a line too: "The Boss reduced Pipewrench's Trial Members on appeal: it now ends Nov 10." (or overturned, upheld,
  increased).

Tests first: the caller sees their own character's rows and not another player's; the four end lines.

## Task 12: the Strategy Guide (instance words)

Model: inline

Files: `instances/divided-world/guide/` (the section on staff moves). The developer persona's words, true and never
bluffing, approved by the owner in review:

> **Groups.** Every character wears a group bar. Most climb on their own: post enough and you're a Regular; survive two
> seasons and you're Old Guard. The staff can also move a character into a group for a while: the Boss as a favor or a
> punishment, a Mod as a punishment only. A punishment can bar a character from one board until it ends. The fastest
> way out is a public apology, read by whoever put you there, and you can appeal too. Your log always says what
> happened and when it ends.

## Task 13: a Mod's one move confers a group (engine, edge) — added 2026-11-06

Model: sonnet

Files: `engine/system/judgment.ts`, `judgment.test.ts`; `supabase/functions/staff/core.ts`, `core.test.ts`. Builds after
Tasks 4, 5 and 8.

- `MOD_MOVE_RULE`'s `kind` widens from `'setRule'` to `'setRule' | 'conferGroup'`, with `conferGroup`'s params from
  `CONFER_GROUP`.
- `repairModMove`'s `conferGroup` branch, each drop recorded: a key outside the conferred catalog; a favor; no board, or
  a board off the Mod's beat; a capped or held character (the same reads as Task 8's `meeting_context`, passed in the
  call's context). It sets the demand to `apologyAccepted` whatever the model wrote, as Task 8 does for the Boss.
- `modPrompt` lists the conferred punishments by key and name beside the predicates, with the rule: one board, on your
  beat, and an apology you will judge.
- A Mod's `conferGroup` goes through `apply_mod_move` and spends its allowance as a `setRule` does (Mod Bots Task 7); the
  guard of Task 5 refuses it again in SQL.

Tests first: `repairModMove` on each drop and on the demand it sets; `staff/core.test.ts` with a patrol whose answer
carries a `conferGroup` queueing it and spending one allowance, and one with no allowance dropping it.

## Task 14: appealing a group punishment (migration, edge, engine UI) — added 2026-11-06

Model: sonnet

Files: a migration redefining `open_appeal` and `close_appeal` from Mod Bots Task 10, and `system_tick`'s expiry pass and
`open_moves` from their latest; `supabase/functions/staff/core.ts` (`appeal`); `engine/system/moves.ts` or the appeal's
words in Mod Bots' `judgment.ts` for the prompt's description of the punishment; the appeal form (Mod Bots Task 13);
`supabase/tests/NNNN-group-appeals.sql`.

- `open_appeal` accepts a landed `conferGroup` move Act whose group is a punishment, appealed only by its
  `params->>'character'`, one per move, at `appealPrice`. The hearer is the move's staff character (Boss or Mod).
- `close_appeal` on a group move:
  - **overturned:** `end_move(move, 'overturned', 'appeal')` then `say_move_end`, and the fee refunded;
  - **upheld:** nothing;
  - **reduced:** the ruling's payload carries `expires_at = now + (expiry - now) / 2`;
  - **increased:** `expires_at = expiry + least((expiry - landed_at) / 2, the phase's moveExpiryMostDays from landing - (expiry - landed_at))`.
  The ruling Act carries the new time; `open_moves` gains `expires_at`, set from the move when it lands and from the
  latest such ruling after, and the tick's expiry pass reads it. Nothing is written into the move Act ("Append-only").
- `bars_now`, the barred box and the log read the expiry from `open_moves`, never the move's payload.
- The appeal and the apology are independent: an apology pending while an appeal is ruled is judged as usual; whichever
  ends the move first wins, and `end_move`'s idempotence makes the second a no-op.

Tests first: each verdict's effect on `open_moves.expires_at` and on `characters_public.group` after the tick; the
increase clamped by the phase; a second appeal refused; another character's appeal refused; an apology accepted after a
reduced ruling ends the move once.

## Review focus

- Acts an instance already holds: `characters_public` gains a computed column and `staffGroup` leaves the settings;
  check that boot, presence and every staff screen read the staff rung after the seed, and that an instance seeded before
  this change still boots.
- A bar's refusal in `post`, `start_thread`, `spin` and `edit_post` must differ only with the acting character's own
  public move: check no path reads the owner, and that a second mask of the same player posts freely.
- The apology's path from spin to ruling to `met` to the tick's `end_move`: a retry of the judge, a second judge run
  overlapping the first, or an admin reversal landing between ruling and tick must not double-rule or double-end.
- `group_now` per row on a thread page of 50 posts: confirm the plan's cost holds in an `explain` against a seeded busy
  instance.
- The targeting cap counts queued as well as landed punishments, so the meeting can't queue a fourth before the third
  lands.
- The barred box's words and the log's lines say exactly what happened and when it ends, never in the Boss's voice.
- **Amended:** a group move's expiry now comes from `open_moves`, moved by an appeal's ruling: check the tick, `bars_now`,
  the barred box and the log all read it there, and that a ruling racing the tick's expiry pass ends the move once.
- **Amended:** a Mod's `conferGroup` must spend its allowance once and stay on its beat, and `staff_punishments` must
  count it with the Boss's: a Boss and a Mod together cannot pass the cap on one character.
