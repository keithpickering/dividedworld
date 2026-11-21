# The Pound: plan

Record, written 2026-11-21. Carries out `docs/plans/2026-11-21-the-pound-design.md`. One build session, one PR. The
tasks build in order; each writes its tests first and shows them red. Migrations are numbered from `0401` as of this
writing (main's latest is `0400_pierce.sql`); the build takes the next free numbers, one migration per task that
touches SQL, each with its `supabase/tests/NNNN-*.sql`.

## The layers

- **Engine** (`engine/`, `supabase/`, `web/`): settings and their checks, the `adoption` duty, `SystemContent.agency`,
  ownership over time, the waiting state, files and letters, the prompt and its repair, settlement's stretches, the
  data layer, the screens and the log.
- **Instance** (`instances/divided-world/`): `settings.ts`'s `pound` values, `system/index.ts`'s `duties.adoption` and
  `agency`, a new `system/agency.ts` with the agency's content, and a Strategy Guide section.
- No engine file names Divided World, The Pound's displayed name, or any persona; the boundary check holds it.

## The masks, for every task

- Every new public read (`pound_page`, the Pound thread's Acts, `season_standings`' mark) is computed from waiting
  stays, files, their closing times and fullness, and public Acts. None reads `characters.owner`, a letter's account,
  a chosen class or a count of letters short of the limit.
- Every refusal reads only the caller's own rows (their slots, their letter in the file, their ownership of the mask) or
  public ones (the mask waiting, the file full).
- `my_*` reads and `log_page` answer from `held_by` at each row's own time, so no account reads another stretch's
  private rows.
- The agency's prompt holds public record and letter text alone, letters ordered by their random id.
- No Realtime broadcast carries anything but the public Acts.

## Task 1: The rules: settings, the duty, the agency's content

Model: sonnet

- **Files:** `engine/rules/types.ts` (`SystemContent`, `DutyAssignee`, `Settings`), `engine/rules/instance.ts`
  (`instanceProblems`, the settings checks beside `MOD_BOTS_WHOLE`), `engine/system/duties.ts` (`DUTIES`,
  `DUTY_SPECS`), `instances/divided-world/settings.ts`, `instances/divided-world/system/index.ts`, a new
  `instances/divided-world/system/agency.ts`, the engine's test instance fixtures.
- `Settings.pound: { letterPrice: Hundredths; fileLength: Span; lettersPerFile: number; rulingsPerDay: number }`.
  Divided World: 50, 24 hours, 8, 20. Checks: the price a positive integer, the length at least an hour, letters per
  file 2 to 20, rulings per day at least 1.
- `DUTIES` gains `adoption`; `DUTY_SPECS.adoption = { mode: 'chat', tier: 'light' }`.
- `SystemContent.agency?: { key: string; name: string; selfPrompt: string; voice: 'chat' }`. `DutyAssignee` gains
  `'agency'`; `instanceProblems` refuses `duties.adoption = 'agency'` with no `agency`, and an agency key that is also
  a roster key. An instance with no agency sets `duties.adoption: 'boss'`.
- Divided World's agency: key `agency`, name "The Pound" (open in the design, for the owner's approval in the PR), a
  self-prompt that speaks as the board itself, protective of its characters, and keeps the adoption framing light.
- **Tests first:** each problem, red on an instance that has it; Divided World has none; `DUTY_SPECS` covers `DUTIES`.

## Task 2: Ownership over time

Model: sonnet

- **Files:** a migration, its SQL test; every view and function listed below.
- `character_owners(character uuid references characters, owner uuid not null references accounts, from_at timestamptz
  not null, cause_act uuid references acts, primary key (character, from_at))`, append-only by `ledger_append_only`
  as `face_down` is, no client grant. The migration backfills one row per player character `(id, owner, created_at,
  null)`. `create_character` (latest `0377_sealed_packs.sql`) inserts its row.
- `held_by(of_character uuid, account uuid, at timestamptz) returns boolean`, stable, security definer: the owner of the
  latest row with `from_at <= at` is `account`. `held_now(of_character, account)` is `characters.owner = account`.
- A deferred constraint trigger on `characters` holds that `owner` equals the latest `character_owners` row's, so the
  one writer (Task 4's landing) cannot update one without the other.
- `characters_within_cap` (latest `0043_staff.sql`) fires on insert and on update of `owner`, and counts characters
  `owner = new.owner and retired_at is null and not waiting(id)` (Task 3 defines `waiting`; this task's version reads
  no waiting until Task 3 adds it, and Task 3 re-declares it).
- **Policies:** `class_history.own` becomes `held_by(character, auth.uid(), started_at)`, so the adopter reads only rows
  that started under them and the old player keeps theirs. `pending_turns.own` and `characters.own` stay on the owner
  now.
- **The audit.** Each of these reads a mask's owner. Each is classified, in the migration's header, as *now* (a write or
  a current state, which keeps `characters.owner`) or *history* (a row with its own moment, which asks `held_by` at
  that moment), and each history one is re-declared from its latest definition with only that change:
  - views: `my_appeals`, `my_ballots`, `my_bans`, `my_cards_ended`, `my_characters` (now), `my_draws`,
    `my_falls_taken`, `my_followed_threads`, `my_group_moves`, `my_infractions`, `my_latest_ballots`,
    `my_poll_closes`, `my_posts_played_on`, `my_posts_written_on`, `my_reports`, `my_reports_left`, `my_scored_as`,
    `my_veiled_posts`, `my_walls_drawn_on`;
  - functions: `apply_settlement`, `estimate_input`, `settlement_input` (Task 5 owns these three), `characters_within_cap`,
    `conduct_author`, `conduct_decisions_well_formed`, `cosmetic_log_rows`, `create_character`, `donate`, `file_visit`,
    `fire_hint`, `following_thread`, `grant_gear`, `land_rows`, `mark_read`, `my_alerts_unread`, `my_apologies`,
    `my_conduct_log`, `my_hidden_version`, `my_wardrobe`, `place_cast`, `place_set`, `played_by`, `pool_signals`,
    `presence_mask`, `profile_cosmetics`, `random_event`, `react` (Task 5), `restore_character`, `reverse_card`,
    `save_effect_state`, `seed_instance`, `set_debut`, `set_outfit`, `spring_facts`, `system_digest`,
    `totals_withheld`, `wash_surface`, `write_alert`, `write_reply`.
  - The rule for the classification: a post's author, a card's caster or a trap's setter is the account that held the
    mask when the Act was made; an alert, a write, an act through a mask and a current state are the owner now. Find
    the list again on a replayed database with `select proname from pg_proc where prosrc ~ '\mowner\M'` and
    `select viewname from pg_views where definition ~ 'owner'`, so nothing added since this plan is missed.
- **Tests first** (the SQL test, with two accounts A and B and a mask moved from A to B by inserting a
  `character_owners` row and updating `owner` in one transaction): B reads none of A's `class_history`; A still reads
  theirs; every history view returns A's rows of the mask before the move to A alone and B's after it to B alone; the
  trigger refuses an `owner` update with no matching row; the cap refuses a move onto a full roster.
- **A check** (`tools/check-owner-reads.mjs`, with its `tools/test-owner-reads.mjs`, in `STEPS` of `tools/build.mjs`):
  every migration's view or function that compares `owner` with `auth.uid()` or an account argument is named in the
  audit list of the latest migration that classifies it, so a new private read cannot forget the history. Its poison:
  a planted migration with a new `my_` view reading `c.owner = auth.uid()` and not listed, which drives it red.

## Task 3: The waiting state and its Acts

Model: sonnet

- **Files:** a migration, its SQL test.
- `pound_stays(id uuid primary key, character uuid not null references characters, owner uuid not null, class_key text
  not null references class_kinds, act uuid not null references acts, at timestamptz not null)` and
  `pound_leaves(stay uuid primary key references pound_stays, how text check (how in ('reclaim', 'adoption',
  'retired')), act uuid references acts, at timestamptz not null)`, both append-only, no client grant.
  `waiting(of_character) boolean`: a stay with no leave. A unique partial index allows one open stay per character.
- Act kinds `give_up` and `reclaim` (the mask's own, no target, payload `{}`, no seq), and `placement` (the agency's,
  targeting the stay's `give_up` Act, payload `{verdict: 'placed' | 'nobody', line}` with `line` 1 to 280 characters).
  Follow `0395_polls.sql`'s header checklist: `acts_kind_check`, `acts_seq_check` and `acts_take_seq`,
  `acts_character_null`, `acts_check1`, a payload constraint each, `acts_well_formed` (a waiting mask makes no Act but
  its own `give_up` at the instant of the stay and `wash`), the public projection, `settlement_input` and
  `estimate_input`'s `win_acts` (a `give_up` earns nothing; a `placement` is staff), `react`'s refusals unchanged,
  `spin_written`. `engine/ui/data/api.ts` `ActKind`, `engine/rules/types.ts` where rule-relevant, `engine/ui/data/fake.ts`.
- `pound_thread(in_season bigint, out in_thread uuid, out opened boolean)`, made as `promos_thread` (0100) is, on the
  staff's board, its title an instance stock line.
- `give_up(through uuid) returns jsonb`, granted to authenticated: `acting(through)` (refuses the barred, the waiting
  to debut, the retired), refuses a mask already waiting ("that character is already in the Pound"), then writes the
  stay with `class_now(through, now())`, the `give_up` Act, deletes `pending_turns` and `gear_worn` as
  `retire_character` (0205) does, and clears `presence`. Returns the Act and, where opened, the thread's projection.
- `played_by` and `presence_mask` (latest `0340`, `0368`) refuse a waiting mask: "that character is in the Pound; you
  can reclaim it from My characters".
- `reclaim(through uuid) returns jsonb`, granted to authenticated: refuses a mask not waiting or whose stay's owner is
  not the caller ("you did not give that character up"), takes the account lock, then: with no open file, refuses a full
  roster, writes the `reclaim` Act and the leave, and the class is the stay's own (no `class_history` row is written,
  so the cooldown runs on); with an open file, records `pound_reclaims(stay primary key, at)` and answers `waits`. A
  second reclaim on the same stay answers `waits` again.
- `spring_facts` (latest `0393`) treats a waiting setter as it treats a retired one: nothing springs.
- `retire_character` (latest `0205`) on a waiting mask writes the leave `retired`; `restore_character` asks for a slot
  as it does.
- `characters_within_cap`: `and not waiting(id)`.
- `my_characters` gains `in_pound_since` and `reclaim_waits` (the caller's own pending reclaim).
- `season_standings` (latest `0206`) gains `in_pound boolean`.
- **Tests first:** a give-up frees the slot and writes the Act in the Pound thread; a waiting mask's post, card, react
  and presence are refused and its wash is not; its trap does not spring and still ends at its time; a reclaim with
  no file lands with the old class and the cooldown unchanged; a reclaim on a full roster is refused; a reclaim during a
  file waits; another account's reclaim is refused; an admin retire of a waiting mask leaves it retired.

## Task 4: Letters, files and the landing

Model: sonnet

- **Files:** a migration, its SQL test.
- `adoption_files(id uuid primary key, stay uuid not null references pound_stays, opened_at timestamptz, closes_at
  timestamptz)`, one open per stay; `adoption_letters(id uuid primary key default gen_random_uuid(), file uuid not null
  references adoption_files, account uuid not null references accounts, class_key text not null references class_kinds,
  body text not null check (char_length(body) between 1 and 1000), at timestamptz, unique (file, account))`;
  `adoption_rulings(file uuid primary key, verdict text check (verdict in ('placed', 'nobody', 'failed', 'off')),
  letter uuid references adoption_letters, act uuid references acts, at timestamptz)`;
  `letter_refunds(letter uuid primary key, why text check (why in ('failed', 'off', 'stale', 'setAside')))`. All
  append-only, no client grant. `wallet_events.kind` gains `letter` (the refund is the existing `refund`).
- `write_letter(of_character uuid, class text, body text) returns jsonb`, granted to authenticated: the caller is not
  barred, `systemEnabled`, the mask is waiting, the caller has a free slot, the class is a class kind, the body's
  length; takes an advisory lock on the stay; opens a file (closing at `now() + pound.fileLength`) when none is open;
  refuses a full file ("this file is full") and a second letter of the caller's; inserts the letter, then
  `wallet_spend(caller, pound.letterPrice, 'letter', letter)`. Writes no Act. Answers the file's closing time.
- `files_due(most integer)`, service only: files whose `closes_at` has passed with no ruling, oldest first.
- `close_file(file uuid, verdict text, letter_number integer, line text, staff text)`, service only, one transaction:
  - letters whose writer has no free slot now are refunded `setAside` and taken out before the numbering is read;
  - `placed`: the letter is the `letter_number`th of the remaining letters ordered by id; writes the `placement` Act
    through `write_staff_act`; inserts `character_owners (character, letter.account, now(), act)`, updates
    `characters.owner`, inserts `class_history (character, letter.class_key, now())`, writes the leave `adoption`;
    drops a pending reclaim;
  - `nobody`: writes the `placement` Act; lands a pending reclaim when the old player has a free slot (its `reclaim`
    Act and leave), and drops it otherwise;
  - `failed` and `off`: refunds every letter with that why; no Act; a pending reclaim lands or drops as for `nobody`;
  - the file's ruling row in every case.
- `refund_stale_files(minutes integer, most integer)`: a due file with no ruling past `minutes` is closed `failed`.
- `adoption_calls_today()`: `model_calls` rows with duty `adoption` today. `staff_call_records`' duty check gains
  `adoption`.
- `pound_page()`, readable by anyone: each waiting mask's public card (as `profile_page` (latest `0357`) shows it), its
  stay's `at`, and an open file's `closes_at` and whether it is full. Nothing else.
- `my_letters` view: the caller's letters, the mask, the file's close, the ruling as it reads for them (`chosen`,
  `notChosen`, `setAside`, `refunded`), the price and any refund. `my_pound` view: the caller's give-ups, reclaims
  (landed, waiting, dropped) and the adoptions of masks they gave up, each within their own stretch.
  `log_page` (latest `0396_poll_reads.sql`) unions both.
- **Tests first:** the first letter opens a file and the second joins it; a ninth is refused as full; a second letter
  by one account is refused; a letter without a free slot is refused; `placed` moves the owner, the class, the stay and
  the traps' setter wakes (a matching trap springs after it); the adopter's cooldown starts at the landing; `nobody`
  lands a waiting reclaim; `failed` refunds every letter; a writer whose roster filled is set aside and refunded and the
  numbering skips them; `pound_page` returns no account, class or letter count; a stale file is refunded.

## Task 5: Settlement over time

Model: sonnet

- **Files:** `engine/rules/settle.ts`, its tests, `supabase/migrations/` (re-declaring `settlement_input`,
  `estimate_input`, `apply_settlement` from `0398_debates_fixes.sql`, and `react` from its latest), their SQL test.
- `settlement_input` and `estimate_input` send, per character, `owners: [{player, from}]` from `character_owners` and
  `away: [{from, to | null}]` from its stays and leaves, in place of `player`.
- `settle.ts`: `playerAt(character, at)` replaces `playerOf`; `stretchesOf` cuts the `away` intervals out of a window
  and splits a stretch where the player changes, each stretch carrying its player; ledger entries are written for each
  stretch's player. A reaction's check is `playerAt(r.character, r.at) === r.player`. A reaction is a player's own when
  `r.player` is `playerAt` of the Act's character at the Act's time or at the window's end; such reactions are dropped
  wherever the own-player rule drops them today, crowd pay among them.
- The SQL comparisons of owners in `settlement_input`'s debates (`pc.owner <> sc.owner`, `oc.owner = s.owner`) ask
  `held_by` at each Act's time.
- `apply_settlement` accepts an entry whose player held its character at some instant inside the window.
- `react` refuses a reaction by an account that holds the Act's character now or held it when the Act was made, with
  today's words ("your characters cannot react to each other").
- **Tests first:** a mask given up mid-window scores its first stretch to its old player and nothing after; a mask
  adopted mid-window scores the rest to the adopter; the old player's reaction to a post they wrote, made after the
  adoption, is refused and, inserted directly, scores nothing; the adopter's reaction on the mask's old post is refused
  likewise; a reaction left through the mask by its old player keeps scoring for the post it was left on; every
  existing settle test passes with one owner per character.

## Task 6: The agency's call

Model: sonnet

- **Files:** `supabase/migrations/` (the seed's agency character), `supabase/functions/_shared/seed.ts` and its test, a
  new `engine/system/adoption.ts` with its test, `supabase/functions/staff/core.ts` (the run), a new
  `supabase/functions/staff/adoption.ts` with its test.
- `characters_staff_kind_check` takes `agency`; one index holds the one of it; `seed_instance` makes it from the
  payload's `agency` (name, key) once, as it makes the stand-in (`0357`), and renames it where the instance renames it.
  `adoption_judge()`: the agency character when it exists and `duties.adoption` is `agency`, else `current_boss()`.
- `engine/system/adoption.ts`: `adoptionPrompt({ mask, letters })`, the mask's public record and the letters numbered
  1 to n; `ADOPTION_SCHEMA` (`placement`: an enum of `nobody` and `"1"`…`"n"`, `line`: string);
  `repairPlacement(answer, n)`: an unknown placement throws `AnswerRejected` naming the predicate; a line is cut to 280
  and the cut recorded.
- The staff run (`runFilings` in `core.ts`, beside `refund_stale_appeals`): `refund_stale_files` runs whether The System
  is on or off; with it off, each due file closes `off`; with it on, while `adoption_calls_today() <
  pound.rulingsPerDay`, each due file's letters and the mask's public record are read, `models.chat({ duty: 'adoption',
  tier: DUTY_SPECS.adoption.tier, ... })` is called, `record_staff_call` and `close_file` follow. A transport failure
  is retried on the request ("Three unrelated timeouts are not a poison pill"); any other failure closes the file
  `failed`.
- **Tests first** (with the fake models): a placement of letter 2 closes `placed` on the second letter by id; `nobody`
  closes `nobody`; placement `"9"` of 3 letters closes `failed`, and refunds; an overlong line is trimmed and recorded;
  the prompt contains no account id, class key or letter id (asserted on the prompt text); the run over the allowance
  leaves files due; The System off closes `off`.

## Task 7: The data layer

Model: sonnet

- **Files:** `engine/ui/data/api.ts`, `web/src/data/supabase.ts`, `engine/ui/data/fake.ts`, `engine/ui/data/log-page.ts`.
- `giveUp(through)`, `reclaim(through)`, `writeLetter(character, class, body)`, `loadPound()`; the new Act kinds; the
  `my_characters` fields; the log's letter and Pound rows. The fake backend holds the same rules, its stays, files and
  letters, so the screens' tests drive it.
- **Tests first:** the fake refuses what the SQL refuses (Tasks 3 and 4's refusals, by message) and moves a mask on a
  placement.

## Task 8: The glass: My characters, the letter form, the log

Model: sonnet

- **Files:** `engine/ui/characters/Characters.tsx`, a new `engine/ui/pound/Letter.tsx` (beside `AppealForm` in
  `engine/ui/cards/Forms.tsx`, which it follows), `engine/ui/log/lines.ts` (`LineKind`, `ORDER`, a `poundRows()`),
  `engine/ui/glass-routes.tsx`, their tests.
- **The brief** (the glass's look, `docs/plans/2026-10-29-two-worlds-design.md` §§1 to 4; plain, never in character,
  for the owner to confirm in the PR's screenshots):
  - My characters: a live mask's card gains "Give up". Its confirmation says what happens, plainly: "Give up {name}?
    Its slot frees now. It waits in the Pound, where another player can adopt it, class cleared, with everything else
    it carries. You can take it back while nobody has a letter in for it." Buttons "Give it up" and "Keep it".
  - A waiting mask's card: "In the Pound since {date}." With no file open, "Take it back"; with one, "A letter is in
    for {name}. If nobody is chosen when the file closes at {time}, you get it back." once the reclaim waits, and
    "Take it back when the file closes" before.
  - The letter form: the mask's name, a class picker as `engine/ui/characters/NewCharacter.tsx` has, a text box (1 to
    1,000 characters), the price, and: "Your letter goes to the Pound's keeper, with any others, when the file closes
    at {time}. Nobody sees who wrote it. The price is kept whether you're chosen or not." Submit "Send the letter".
  - Log lines: "You gave up {name}." · "You took back {name}." · "Your request to take back {name} waits for its file
    to close." · "{name} didn't come back to you: {another player was chosen | your roster was full}." · "You wrote a
    letter for {name} (−{price})." · "Your letter was chosen: {name} is yours, as a {class}." · "Your letter for {name}
    wasn't chosen." · "Your letter for {name} was set aside because your roster was full when the file closed;
    {price} came back." · "The file on {name} closed without a ruling; {price} came back." · "{name} was adopted."
- **Tests first:** each control appears and disappears with its state; the confirmation's words; the form refuses an
  empty letter and an unpicked class; each log line from a fixture row; axe passes on each screen.

## Task 9: The board: the Pound page, the thread, Rankings

Model: sonnet

- **Files:** a new `engine/ui/pound/PoundPage.tsx` with its test, `web/src/App.tsx` (the `/pound` route), the index's
  links (beside Rankings' link), `engine/ui/thread/Post.tsx` (the three Act kinds as announce Acts show),
  `engine/ui/rankings/Rankings.tsx`.
- **The brief** (the board's house style: Verdana and Courier, black and white, 1px rules, color only on the game's
  pieces): a 2003 table titled THE POUND, one row per waiting mask: avatar, name (to its profile), title, standing,
  "waiting since", and its file's state ("no letters yet", "a file is open; it closes {time}", "this file is full").
  Each row's "Write a letter" opens the glass form. An empty Pound says "Nobody's waiting."
- The thread: a `give_up` reads "{name} was given up to the Pound."; a `reclaim` "{name} was taken back."; a
  `placement` shows the agency's line under "{name} was placed." or "Nobody was chosen for {name}."
- Rankings: a waiting mask's row says "in the Pound".
- **Tests first:** the page shows no count of letters and no player; a full file reads full; the route loads; each Act
  kind renders; Rankings marks the row.

## Task 10: The round trip, the guide, the rehearsal

Model: sonnet

- **Files:** `supabase/tests/e2e/0003-export.ts` (fixture rows and `HELD` for `character_owners`, `pound_stays`,
  `pound_leaves`, `pound_reclaims`, `adoption_files`, `adoption_letters`, `adoption_rulings`, `letter_refunds`),
  `instances/divided-world/guide/strategy-guide.md` (a short Pound section, for the owner's approval), the rehearsal's
  fake world where it seeds masks (`tools/rehearse/`).
- **Tests first:** the export round trip holds every new table.

## Review focus

- What the backfill of `character_owners` and the new `held_by` reads do to every Act and log row an instance already
  holds: each must read exactly as before for a mask that never moved.
- The audit's classification of each owner read (Task 2): a history read left on the owner now leaks the old stretch to
  the adopter or hides it from the old player.
- Settlement's cost at a busy instance: `playerAt` and the `away` cuts must stay a lookup per reaction, not a scan.
- A file closed twice (a retry of the staff run, a stale sweep racing a slow call): the ruling's primary key must hold
  one ruling, and the money must move once.
- A reclaim, a letter and a give-up racing on one mask, and a roster that fills between a letter and its file's close.
- Whether any answer of `write_letter` or `pound_page`, or the Pound thread's timing, can be made to vary with who owns
  a mask or who wrote a letter.
- A trap set before a give-up that springs after an adoption: whose alert, whose log, whose credit.
