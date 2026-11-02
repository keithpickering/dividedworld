# The staff roster: the plan

Record, written 2026-11-02. Carries out `docs/plans/2026-11-02-staff-roster-design.md` (cited here as "the design"),
task by task. Each task writes its tests first and shows their red run, and every task is reviewed for the spec and
for quality (`.claude/skills/build-session/SKILL.md`). Migration and SQL test numbers are written here as "next": the
build takes the next free number when it reaches the task, since other plans (onboarding's `0066_debut_now.sql`) may land
first.

**Order.** Tasks 1 to 4 build in order: the roster, the offices, the career and the group. Task 5 pins a rule. Tasks 6
and 7 (notes, the staff card path) can build in either order after Task 2. Tasks 8 to 10 (signals, the pick, the post)
build in order after Tasks 3, 6 and 7. Task 11 (the to-do) needs only Task 2. Task 12 is last.

**Nothing turns on.** The pool runs only while `systemEnabled` is true, and Divided World's is false until The System's
Task 13, "Turning it on". Every task here is tested against localhost Postgres and the fake model; no task touches a
deployed database.

## The layers

- **Engine** (`engine/`, `supabase/`): offices, the office log, the career, the staff group's place on the postbit, the
  pool's settings, triggers, priority and pick, the pool's prompt frame and answer rules, the staff card path, notes, the
  handover's to-do, the `chatter` Edge Function.
- **Instance** (`instances/divided-world/`): the roster's personas (every field each), the group's name ("Personality
  Cores"), each trigger's strength if it differs from the engine's default, the pool's numbers.
- **The interfaces:** `SystemContent.roster: Persona[]` (replacing `bosses` and `modBots`) and `SystemContent.staffGroup`
  (Task 1); the pool's settings in `Settings.pool` (Task 9). Each is checked by `instanceProblems`.

## The masks, for every task

- Every signal the pick reads comes from `pool_signals`, owned by the digest role `kayfabb_digest` (0045), which cannot
  read `characters.owner`, a class or a reactor. Task 8 adds its function to the role's pinned list in
  `supabase/tests/0050-digest.sql`, and the planted reads there stay red.
- A staff card's target is the post the pool post replies to or the staff character's own post: chosen from the
  trigger, never from who owns anything.
- A caught staff card pays its base price whatever the trapper holds.
- Offices, careers and the group are facts about staff characters, who have no owner.

## Task 1: one roster of personas

- **Files:** `engine/rules/types.ts`:
  - `BossPersona` (:497) and `ModBotPersona` (:525) become one `Persona`: `StaffSeed` plus `persona`, `startingHobby`,
    `temperament`, `inheritsMemoryOf?`, `phases?`, `beats`, `petRules`, `strictness`, `weakness`, `voice` and
    `persuadedBy`.
  - `SystemContent` (:560): `roster: Persona[]` replaces `bosses` and `modBots`. `firstBoss` and `firstStaff` stay, both
    naming roster keys. Add `staffGroup: { name: string }`.
- `engine/rules/instance.ts` `systemProblems` (:367):
  - The checks now read one list. Every persona must have every field.
  - Drop "a staff key is one or the other" (:388).
  - `firstStaff` must be non-empty roster keys and must not include `firstBoss`.
  - `staffGroup.name` must be 1 to 40 characters.
- `instances/divided-world/system/`:
  - `bosses/*.ts` and `bots/placeholder-monitor.ts` move to `personas/`, one file each, with every field. The Bosses gain
    bot fields and the placeholder gains Boss fields, each marked as a draft for the owner, as today's placeholder is.
  - `persona.ts`'s `bossPersona()` and `modBotPersona()` become one `persona()`. `BOSS_PREMISE` and `MOD_BOT_PREMISE`
    stay as the premise for each duty's prompt, since a persona's office picks the premise.
  - `index.ts` lists `roster` and `staffGroup: { name: 'Personality Cores' }`.
- `supabase/functions/_shared/seed.ts` `instanceSeed()` (:42-45): `system.staff` is the roster with no `kind`, and the
  seed carries `staffGroup`. `supabase/functions/meet/core.ts:141` finds the Boss in `tuned.system.roster`.
- **Tests first:** `engine/rules/instance.test.ts` covers a persona missing a bot field, a persona missing a Boss field,
  `firstStaff` naming `firstBoss`, an empty group name, and a duplicate key, each a named problem. The
  `instances/divided-world` instance has no problems. The poison is a persona with no `weakness`, which must be reported
  where today a Boss with none passes.

## Task 2: offices and the office log

- **Migration** (next number, `_offices.sql`):
  - `characters.staff_kind`'s check becomes `('persona', 'developer')`. Existing `boss` and `bot` rows become `persona`
    in the same migration. The developer is unchanged.
  - **The office log.** Table `staff_offices`:
    - `id` bigint identity; `staff` text references `characters(staff)`;
    - `office` text, one of `mod`, `member`, `benched`;
    - `cause` text, one of `seed`, `handover`, `move`, `admin`;
    - `season` bigint null; `move_act` uuid null references acts; `admin` uuid null references accounts;
    - `at`, default now.
    - It is append-only with the same guards as `staff_changes` (0043:61-70), has no client access, and has index
      `(staff, id desc)`.
    - A trigger refuses the developer.
    - `staff_changes` rows are copied in (`on_staff` true becomes `mod` with cause `seed` or `move` as `move_act` says;
      false becomes `member`), and then `staff_changes` and `staff_changes_only_bots` are dropped. The design's one list
      of who holds what is the office log.
  - **The current office.** `staff_office_now` view, granted to anon and authenticated, gives `staff`, `office` and
    `since`:
    - `boss` where `c.staff = current_boss()`;
    - `waiting` where `debuted_at is null`;
    - otherwise the latest row, or `member` where there is none.
    - `staff_now` (0043:88) is redefined as `staff_office_now` where `office = 'mod'`, keeping its columns.
  - **`characters_public`** (0043:363) replaces `staff_kind` with `office` from `staff_office_now`, null for players and
    `developer` for the developer. `supabase/tests/0001-core.sql:27`'s pinned columns change with it.
  - **`seed_instance`** (current form 0062:272): a persona is created with `debuted_at` null unless it is `firstBoss` or
    in `firstStaff`. `firstStaff` writes `mod` rows with cause `seed` only where the key has no row, so a reseed never
    rehires. The seed writes the setting `staffGroup`.
  - **`boss_roster()`** (0051:399) lists every unretired persona whose office is not `benched`, waiting ones included.
    `nominated_boss` (0051:415) and `rotation_boss` (0051:437) read it unchanged.
    `queued_moves_guard`'s nomination check (0051:206) and `replace_successor` (0051:247) read `staff_kind = 'persona'`
    in place of `'boss'`.
  - **`hand_over`** (0051:477), in its transaction, after seating the Boss:
    - it debuts a waiting successor (`debuted_at = now()`);
    - it writes the outgoing Boss's `member` row with cause `handover` and the season;
    - if no persona is then `mod`, it writes the outgoing Boss as `mod` instead of `member`, since the staff design's
      "never empty" holds and the joke is better.
  - **`set_office(staff, office)`** is admin only (`only_admins`) and writes cause `admin` with the admin's id. Offices:
    - `member` (from `waiting`, which debuts the persona, or from `benched`);
    - `benched` (from `member` or `mod`, refused for the season's Boss and for the last `mod`);
    - `mod` (an admin's hire, refused for the Boss).
    A refusal names its predicate.
  - `write_staff_act` (0062:115) refuses a persona that is `waiting` or `benched` (a benched persona is silent).
- **Every reader of `staff_kind`** the survey found changes in the same task:
  - the SQL tests that insert `staff_kind` `boss` or `bot`:
    - `supabase/tests/0048-staff.sql`, `0049-director.sql`, `0051-moves.sql`, `0052-meeting.sql`, `0053-tick.sql`,
      `0056-succession.sql`, `0057-digest-meeters.sql`, `0059-card-plays.sql`, `0060-card-reach.sql`, `0063-alerts.sql`,
      `0064-follows.sql`, `0069-hints.sql`;
    - `supabase/tests/e2e/0003-export.ts:134,150`;
  - `web/src/data/supabase.ts:437,443,458,683`, where the Boss list reads `staff_office_now`;
  - `engine/ui/data/api.ts:191`, where `staffKind` becomes `office?: Office`;
  - `engine/ui/postbit/StaffBadge.tsx`; `engine/ui/profile/Staff.tsx:80`.
- **Tests first** (next SQL test, `-offices.sql`):
  - A seed leaves every persona but the first Boss and the first staff waiting and undebuted, and absent from
    `characters_public`.
  - A handover to a waiting persona debuts it; the outgoing Boss reads `member`; a handover that would leave no `mod`
    makes the outgoing Boss `mod`.
  - `set_office` covers waiting to member (debuts), member to benched, a refused bench of the Boss, a refused bench of
    the last mod, and a refused call from a non-admin.
  - `write_staff_act` refuses a benched persona.
  - The office log refuses update and delete.
  - A reseed leaves a benched persona benched.
  - `staff_now` lists exactly the mods.
  - The poison is an office row for the developer (refused), plus a `staff_offices` row naming `boss` (refused by the
    check, since the Boss's office is computed).

## Task 3: the career

- **Migration** (next): `staff_career(of_staff text)` returns jsonb, granted to anon, authenticated and
  `kayfabb_digest`. It returns `{ led: [{season, from, until, how}], offices: [{office, from, until, cause}] }`, built from
  `seasons.boss`, `season_handovers` (0051:386, `landed_at` from 0063) and `staff_offices`. All of it is public.
- `engine/system/career.ts`:
  - `careerText(career, seasonNames)` gives plain sentences, at most `CAREER_MOST` (12) entries, newest first, with "and
    N more" past that.
  - `meetingSystemPrompt` (`engine/system/meeting.ts:156`) gains the Boss's career.
- `engine/ui/profile/Staff.tsx` gains a Career list from `api.staffCareer(staff)`, with
  `web/src/data/supabase.ts`'s reader.
- **Tests first:** `engine/system/career.test.ts` covers a persona that led two seasons and was a mod between them, a
  never-served member, and the 13-entry cut. `supabase/tests/` (next) `-career.sql` covers the jsonb for a persona
  through seed, handover and admin bench. A UI test checks the profile lists the career. The poison is a career that
  reads a season led by another persona (the test names two).

## Task 4: Personality Cores on the postbit and in presence

- `engine/ui/postbit/StaffBadge.tsx` replaces `STAFF_BADGE` (:8) with:
  - the group label from the setting `staffGroup`, read where `developerAvatar` is read today, shown for every persona
    at every office;
  - the office's title beside it: `ADMINISTRATOR` for the Boss, `MODERATOR` for a mod, nothing extra for a member. The
    persona's profile title stays where `Postbit.tsx:83` shows it.
  - Nothing for the developer.
  - The label is drawn as a game piece in the house style (`docs/plans/2026-10-29-two-worlds-design.md`).
- The profile (`profile/Staff.tsx`) shows the same.
- **Presence:**
  - Migration (next) `presence_listed` (0041:99) also lists a staff character in a thread's and a board's box for
    `presenceWindow` after its own post there, read from `acts_public`.
  - `engine/ui/presence/PresenceBox.tsx` shows the group's label after a staff name; `Presence.names` (api.ts:449)
    carries `staff: boolean`.
- **Tests first:**
  - `engine/ui/postbit/StaffBadge.test.tsx` checks a member persona shows the group and no `MODERATOR`, a mod shows both,
    and the Boss shows `ADMINISTRATOR`.
  - A presence SQL test checks a staff post makes the persona listed in its thread for the window and gone after it.
  - A board story for the postbit's three offices.
  - The poison is a player character with a group label (the test plants one through the fixture and expects none).

## Task 5: staff never react, pinned

- **Tests first and only** (next SQL test, `-staff-never-react.sql`): `react` through a staff character is refused
  (`played_by`), and a direct insert of a reaction with a staff `reactor_character` fails on `reactor_account not null`.
  The test names the design's section 9, so a later writer that opens a staff reaction path meets it.

## Task 6: notes

- **Migration** (next):
  - Table `staff_notes`: `id`, `staff` references `characters(staff)`, `act` uuid references acts (the pool post that
    wrote it), `at`, and `body` text with a check `length(btrim(body)) between 1 and noteMost`, where `noteMost` is 280,
    held by the check and named in the engine.
  - It is append-only, with no client access.
  - `staff_notes_recent(of_staff, since, most)` is for the service role.
- `engine/system/memory.ts`: `meetingContext`'s inputs gain the Boss's notes since its last memory version, at most
  `notesRead` (setting, 12). The meeting's prompt tells the Boss they are its own recent thoughts. `supabase/functions/
  meet/core.ts:157` reads them.
- **Tests first:** an SQL test covers a 281-character note (refused) and append-only. `engine/system/meeting.test.ts`
  checks notes appear in the prompt, capped. The poison is a note with no act (refused: `act` is not null).

## Task 7: the staff card path

- **Migration** (next):
  - **The shared rules.** `play_card` (current form 0058_alerts.sql:101) and `set_card` (0054:374) are split.
    - `place_cast(caster uuid, card, target, config, message, reach, from_post, payer uuid, price)` holds every rule after
      authorization: reach, wards, stack, layer, `spring_traps`, the Act, `play_reach`, the alert.
    - `place_set(setter, card, target, config, payer, price)` holds the Set's rules and the `face_down` row.
    - `play_card` and `set_card` keep their signatures, grants and behavior: they authorize, check the hand, call the
      inner function, then spend the wallet.
  - **The staff writers.** `staff_play_card(staff_key, card, target, config, message)` and
    `staff_set_card(staff_key, card, target, config)` are granted to `service_role`. Each:
    - opens `kayfabb.staff_writer`;
    - refuses a waiting or benched persona;
    - refuses a card above the setting `poolCardRarityMost`;
    - refuses a Set whose trap pays out;
    - calls the inner function with `payer` null and price 0.
  - `face_down.account` becomes nullable, with the check that it is null exactly when the setter is a staff character.
  - **`spring_traps`** (0058:251):
    - It opens `kayfabb.staff_writer` around the `spring` and strike Acts when the setter is staff, so a staff trap never
      refuses the write that sets it off (the card design's rule).
    - The `trapStruck` alert is skipped for a null owner.
    - When the caught play's caster is staff, Pay out credits the trapper with the card's base price, read from its
      `priceKey`, through `wallet_move(fd.account, base, 'trapSystem', null, sprung)`. `wallet_events.kind`'s check
      (0003:82 as later widened) gains `trapSystem`.
  - The settlement is unchanged: `is_staff_side` (0054:627) already leaves a staff caster's play unpaid, and a player's
    post it lands on is judged as for any card.
- `engine/ui/log/lines.ts` gives the trapper's line for `trapSystem`: "Your {card} caught {staff}'s {card}. The System
  paid you {n} Aura."
- **Tests first** (next SQL test, `-staff-cards.sql`):
  - A staff Cast of Whoops! lands on a player's post with its stack and ward rules (a warded post refuses it as for a
    player).
  - A staff Set of Bluff lands face down.
  - A staff Set of Trap Card is refused (pays out).
  - A rare card is refused.
  - A player's Trap Card catches a staff Cast and pays the base price as `trapSystem`.
  - A strike trap set by staff springs on a player's reply without refusing the reply (a fixture strike card).
  - Every existing card test still passes unchanged, which shows the split kept behavior.
  - A log line test for `trapSystem`.
  - The poison is a staff Cast with a non-null payer (refused: the staff writer passes none), plus a spring on a staff
    trap with the staff flag left closed, which must fail red before `spring_traps` opens it.

## Task 8: the signals, read by the digest role

- **Migration** (next): `pool_signals(since, until)` returns jsonb. It is owned by `kayfabb_digest`, security definer,
  and executable by the service role. It returns:
  - `named`: `[{staff, act, thread}]`, posts in the window whose words contain a debuted persona's name, matched once
    over the window's posts with the name folds (`0010_name_folds.sql`);
  - `quoted`: `[{staff, act, thread}]`, quotes and replies to a staff post, read as `system_digest`'s `quoted`
    (0052:78) reads them;
  - `legacy`: `[{staff, move, act, how}]`, `move_end` and `move_keep` Acts and admin reversals on moves whose owner
    (`move_owner()`, 0051:54) is not the current Boss;
  - `reversals`: admin reversals of the current Boss's moves in the window;
  - `handovers`: `season_handovers` landed in the window;
  - `hot`: the top `digestThreads` threads with board, heat and starter, and whether a staff character started each;
  - `tallies`: `[{staff, posts, reactions}]` over the staff's posts in the last `poolPriorityDays`, from
    `reaction_tallies`.
  - `supabase/tests/0050-digest.sql:55-62`'s pinned list gains `pool_signals`.
- **Tests first** (next SQL test, `-pool-signals.sql`):
  - Each signal kind is found from a planted fixture, and one outside the window is not.
  - A name inside a word ("Clerkenwell" for "the Clerk") follows the folds' own rule and is recorded either way the folds
    decide.
  - `explain` shows the named match is one pass over the window's posts, not one per persona.
  - The poison is `pool_signals` reading `characters.owner`, planted in a copy, which must raise `insufficient_privilege`
    as the role's other poisons do.

## Task 9: the pick, in pure TypeScript

- `engine/rules/types.ts` `Settings.pool`:
  - `weekly` 20; `holdback` 0.2; `threadsWeekly` 1; `cardRarityMost` `'common'`; `priorityDays` 28; `notesRead` 12;
  - `strengths: Record<Trigger, number>`, defaulting to 5 for named, quoted, legacy, successorStumbles and oldFlame, and
    2 for homeTurf, seasonTurn and hotOnBeat;
  - `chatterCron`.
  - `engine/rules/instance.ts` checks each: positive whole numbers, holdback in [0, 0.5], a known rarity.
- `engine/system/pool.ts`:
  - `TRIGGERS`, the design's eight, as a fixed list.
  - `candidates(signals, roster, memories, phase)`:
    - It reads `oldFlame` from each persona's memory opinions and grudges against the hot posts' authors.
    - It reads `successorStumbles` from `phaseAt` (`engine/system/phases.ts:72`) crossing into meltdown within the
      window, and from `reversals`.
    - It reads `hotOnBeat` from `persona.beats` against hot boards.
    - It leaves out every waiting or benched persona and the persona named by the signal's own act.
  - `priority(tallies)` is reactions per post. A persona with fewer than 3 posts in the window counts as new.
  - `allowance(spentThisWeek, weekly, today)` is the week's remainder over the days left, rounded down, at least 0.
  - `pick(candidates, priorities, allowance, threadsLeft, rng)`:
    - It holds back `ceil(allowance * holdback)` for new personas, filled from them first, and returns the rest to the
      others if none are new.
    - At most one per persona.
    - The top scorer may start a thread while `threadsLeft` is above 0.
    - It returns `{staff, trigger, thread, quoting, startThread, cardSlot}[]` and a `cardSlot` budget equal to what
      remains.
    - `rng` breaks ties, seeded from the day so a rerun picks the same.
- **Tests first:** `engine/system/pool.test.ts` covers:
  - each trigger from a signal;
  - the one-per-persona rule;
  - the holdback with and without new personas;
  - a week whose pool is spent gives 0;
  - the thread share;
  - a rerun with the same day picks the same;
  - a benched persona is never picked.
  The poison is a `pick` that lets a persona post twice, planted and caught.

## Task 10: the pool's posts

- `engine/system/duties.ts`: `DUTIES` (:8) gains `chatter`, chat or completion by the persona's voice, light tier.
  `DUTY_SPECS` gives it.
- `engine/system/chatter.ts`:
  - `chatterPrompt({ premise, persona, career, memory, notes, thread, quoting, trigger, offeredCards })`. The thread is
    its last `chatterThreadPosts` (setting, 8) public posts, cut to `excerptChars`.
  - The answer schema is `{ words, title?, card?: { key, on: 'reply' | 'own' }, note? }`.
  - `repairChatter`, under the validator rule ("A validator tighter than the schema"):
    - words over `postMaxLength` are cut at a sentence;
    - a note over 280 is cut;
    - a card not offered, or `own` on a reply-only Cast, is dropped with a trim;
    - a title when none was asked for is dropped;
    - words that are empty or missing are rejected, naming the predicate.
- **Migration** (next):
  - `pool_spends`: `id`, `day`, `staff`, `trigger`, `post_act`, `card_act` null, `started_thread` boolean, `at`. It is
    append-only, unique on `(day, staff)` so a rerun on the same day cannot post twice for a persona; the week's spend is
    counted from it (a row with a card counts two slots).
  - `write_staff_thread(staff_key, board, title, body)` is for the service role, under the staff flag, held to
    `titleMaxLength` and `postMaxLength`, and refuses waiting or benched personas.
  - The cron job `kayfabb-chatter` runs at `chatterCron`, scheduled as `kayfabb-meet` is (0047:255).
- `supabase/functions/chatter/index.ts` and `core.ts`, in the shape of `meet/core.ts`'s `runMeeting`:
  1. Do nothing unless `systemEnabled`.
  2. Read `pool_signals` for the last day, memories (`staff_memory_latest`), notes and careers.
  3. Run `candidates`, then `pick`.
  4. For each pick, call the model with duty `chatter` and `staff` set, so every call is a ledger row ("Cost is a
     column").
  5. Repair the answer.
  6. Write the post (`write_staff_act` kind `post`, or `write_staff_thread`), then the card if there is one and a card
     slot is left (`staff_play_card` or `staff_set_card`), then the note, then the `pool_spends` row.
  - **Failures:** a transport failure is retried on the request itself ("Three unrelated timeouts are not a poison
    pill"). A rejected answer is skipped and spends nothing. A database error stops that pick and is recorded in the
    ledger row's outcome. A pick whose card is refused by the card rules still posts its words, and the refusal is
    written on the pick's record.
- **Tests first:**
  - `engine/system/chatter.test.ts` covers each repair and the rejection.
  - `supabase/functions/chatter/core.test.ts` uses the fake model and a fake database and covers:
    - a day with three picks writes three posts, one card, notes and three spends;
    - a disabled System writes nothing;
    - a rejected answer spends nothing;
    - a transport failure is retried once and then succeeds;
    - a refused card leaves its post.
  - The poison is a model answer naming a card outside the offer, which must be dropped and never reach
    `staff_play_card`.

## Task 11: Gabe's to-do

- **Migration** (next):
  - Table `handover_dismissals`: `season` references `season_handovers`, `admin`, `at`. It is append-only, one per
    season.
  - `admin_queue()` (current form 0053:50) gains `todos`: each `season_handovers` row whose Boss changed
    (`season_boss_changes`, 0063:149), with no `update` Act after its `landed_at` (index `acts_updates`, 0062:89) and no
    dismissal. Each todo gives `{season, boss, bossName, outgoing, outgoingName, outgoingOffice, how, landedAt}`.
  - `dismiss_handover_todo(season)` is admin only.
- `engine/ui/admin/Queue.tsx` gains a To do group above Waiting (:172), one row per todo, with "Write the announcement"
  linking to `/updates?write=handover&season=N`, and Dismiss.
- `engine/ui/updates/Updates.tsx` reads `write` from `query` (:170) and opens the writer (:116's `writing`).
- `engine/ui/admin/WriteUpdate.tsx` (:25) accepts `initial?: { title, words }`. The handover's facts are filled in as
  plain lines ("Season 4's Boss: Comptroller (was a Moderator). Hype Man is now a member."), each in a draft block the
  admin replaces. No model is called.
- **Tests first:**
  - An SQL test covers a handover making a todo, an update after it clearing it, a dismissal clearing it, an update before
    it not clearing it, and a non-admin refused.
  - `Queue.test.tsx` checks the To do row and its link.
  - `WriteUpdate.test.tsx` checks the form opens filled in from `initial` and posts what the admin typed.
  - The poison is a todo that clears on an update posted before the handover (the test plants one).

## Task 12: a day of the staff

- `supabase/tests/e2e/` (next number) `-a-day-of-the-staff.ts`, on the scratch database with the fake model:
  1. Seed.
  2. Make posts that name an ex-Boss and quote a mod.
  3. Hand over the season (an ex-Boss becomes a member, a waiting persona debuts as Boss).
  4. Run `chatter`.
  5. Assert the ex-Boss replied in the naming thread, quoting it, and the week's spend is recorded.
  6. Assert a staff Whoops! on a player's post shows in the post's marks, and the player's trap that caught it paid
     `trapSystem`.
  7. Assert the to-do is in the admin queue until an update is posted.
- `supabase/tests/e2e/0003-export.ts`: the new tables (`staff_offices`, `staff_notes`, `pool_spends`,
  `handover_dismissals`) round-trip, as every table does.

## Review focus

- What the `staff_kind` migration does to an instance that already holds staff Acts: every persona keeps its character,
  key, Acts, profile and memory, and its office follows from `staff_changes`.
- `staff_changes` is dropped after its copy: the copy must carry every row, `move_act` included, before the drop.
- The split of `play_card` and `set_card`: a player's play must behave exactly as before, wallet and hand included. A
  refactor that moves the wallet spend before a refusal would charge for a refused play.
- `spring_traps` opening the staff flag inside a player's write: it must close again before the player's own Act is
  checked, or a player's write could pass as staff.
- `trapSystem` creates Aura. The pool's card slots and the rarity cap bound it; confirm no other path reaches it.
- `hand_over`'s "never empty" fallback when the promoted Boss was the last mod.
- `pool_signals`'s name match at a busy instance: one pass over the day's posts. Confirm by `explain`, not by the test's
  size.
- A second `chatter` run on the same day: the seeded pick and `pool_spends` must not post twice.
- A staff card's target must never be chosen by reading who owns a post.
