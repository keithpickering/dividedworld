# The screens' engine changes: plan

Record, written 2026-10-29. The first of three plans for `docs/plans/2026-10-29-screens-design.md`: what the engine,
its SQL and its Edge Functions must change before the screens can be built (design, section 14). It draws no screen.
A build session carries it out task by task, tests first, each red run recorded (`.claude/skills/build-session/SKILL.md`).

**It starts after PR #2 ("Build the core loop's engine") is merged.** Every file below that is not marked new is PR #2's,
read on its branch `ccr-1b539416-dzl89u` when this was written; a builder who finds it changed in review reads the merged
version and lists any difference under `Plan gaps`. Migrations take the next free numbers after PR #2's last
(`0009_registration.sql`); the names below say which.

**Amended 2026-10-29, after PR #7** (`docs/plans/2026-10-29-core-loop-build-answers.md`, built into PR #2 as its fix
round): the owner decided there that masks change at the tally. A new character debuts at the next settlement, a Turn
is pending until it, and each settlement The System posts one tally Act naming the night's debuts and announced Turns;
sign-in is passwordless. Tasks 2, 3 and 9 below are rewritten to build on that rather than repeat it; where this plan
and PR #2's merged code disagree, the merged code is the base and the difference goes under `Plan gaps`.

No instance is deployed with players, so no task migrates a live board ("Nobody is waiting on a hotfix"); each migration
still runs on an instance that already holds PR #2's tables and rows, and each task's tests say what it does to them.

## The layers

Every change here is engine (pure TypeScript under `engine/`, plain SQL under `supabase/migrations/`) or composition root
(`supabase/functions/`), except where a task names `instances/divided-world/`, which is the instance's content plugging
into an interface this plan adds. New interfaces on `Instance` (`engine/rules/types.ts`): a board's `system` flag,
`ranks`, `pipStyles`, and new `Settings` keys. The engine still names no instance ("KayfaBB never knows which instance
it runs").

## Tasks

### Task 1. The System's board

- `engine/rules/types.ts`: `BoardSeed` gains `system?: boolean`. `engine/rules/instance.ts`, `instanceProblems()`:
  exactly one board is `system`, and at least one is not.
- `instances/divided-world/index.ts`: a second board, `{ slug: 'the-system', name: 'The System', description: …,
  system: true }`; the description is the owner's copy to give, a placeholder until then.
- New `supabase/migrations/0010_system_board.sql`: `boards.is_system boolean not null default false`, with a unique
  partial index so at most one is; `seed_instance()` (PR #2's `0004_schedule.sql`) writes it from the seed;
  `system_board()` (`0007_seasons.sql`) reads it, falling back to the first board only on an instance seeded before
  this migration, which an admin re-seeds. `start_thread()` and `post()` (`0005_actions.sql`) refuse a thread on the
  System's board ("only The System posts here; spin a thread from what it said"). `spin()` from an Act on the System's
  board opens the thread on the first board that is not the System's, never on the System's own.
- **Tests first** (`supabase/tests/` and `engine/rules/instance.test.ts`): an instance with no System board, or two, is
  refused; a post, a reply and a new thread on the System's board are refused in plain words; a spin from a reveal Act
  lands on the ordinary board; the season's Turns thread and the reveal open on the System's board; an instance seeded
  before the migration keeps its threads where they are.

### Task 2. The tally on The System's board

PR #7's Task F makes a Turn pending until the settlement (its player may change or withdraw it) and posts The System's
tally Act each settlement. What is left for the screens:

- The tally, the season's reveal and anything else The System posts land on the System's board of Task 1, which
  `system_board()` now returns.
- `engine/rules/actions.ts` and `supabase/functions/act/core.ts`: whatever PR #7 named the change and withdraw actions,
  their answers say plainly when the Turn takes effect (the window's end), so My characters can show it.
- A `my_pending_turns` view (`security_invoker`, own rows) if PR #7 left the pending Turns readable only through a
  function.
- **Tests first:** the tally opens on the System's board; a player reads their own pending Turn and nobody else's.
- **Way out:** a pending Turn ends at the settlement, or its player withdraws it (PR #7).

### Task 3. Reactions on The System's own Acts

- `react()` (`0002_reactions.sql`): a target with no character (a `reveal` Act, or The System's tally) is reacted to
  like any Act; the check on the author's owner is skipped when there is no author. The settlement
  already skips System Acts (`SettlementInput.systemActs`); it moves nobody's Aura.
- **Tests first:** reacting to a reveal Act and to a tally is accepted and tallied; the cap and the shared vote hold on it; the
  settlement pays nobody for it. This settles the issue #5 line "Reacting to a reveal Act".

### Task 4. Cards: stacking, seeds, messages, releases

- `engine/rules/cards.ts`: `CardRules` gains `stack?: number` (how many of this card one post may carry, default 1) and
  `seeded?: boolean`. `landsOncePerPost()` becomes `landsOnPost(rules, target, effects)`, holding the stack.
  `decidePlay()` takes the caster's `message`: plain text, at most 200 characters, may be empty.
- `instances/divided-world/cards/whoops.ts`: `stack: 3`, `seeded: true`. `validateState()` takes the new stroke shape:
  `{ strokes: [{ tool: 'wash' | 'ink', color?, width, points }], clean?: boolean }`, where a point's across is 0 to 1
  of the fixed layout's width and its down is in widths of it, 0 to 64 (design, section 11: a stroke keeps its place
  when an edit reflows the text); an `ink` stroke carries a color, a `wash` stroke none. `STROKES`' bounds stay sized so
  the largest save fits `effect_state`'s bound, as `cards.test.ts` measures.
- `instances/divided-world/cards/stick-around.ts`: its header's "kept on the reader's own device, never the server"
  becomes the server-side release below.
- New `supabase/migrations/0012_cards_screens.sql`: `play_card()` (`0006_cards.sql`) takes `message`, stores it and, for
  a seeded card, a seed it chooses (a random 31-bit integer) in the Act's payload; the unique index
  `acts_one_card_per_post` is replaced by one on (target, card, layer), the layer counted under the target's lock, and a
  play past the card's stack is refused ("this post already carries three"). The stack per card is seeded into
  `card_kinds`. New `effect_releases` (account, play, released_at; private, read by its own account) and
  `release_effect(play)`, written as the player.
- **Tests first:** a fourth Whoops! is refused; two plays at once take layers 1 and 2; the seed is the server's, and one
  sent by a client is ignored; a message of 201 characters is refused; a stroke with a down of 65 or an across of 1.01
  is refused; the largest save fits; another account cannot read a release.

### Task 5. The live estimate

- `engine/rules/settle.ts`: `settle(input, instance, options?)` with `{ sharedVote: boolean, halving: boolean }`, both
  true by default; `engine/rules/votes.ts`' `shareVotes()` and `halveAcrossActs()` honor them. `previewForOwner()`
  becomes `estimateForOwner()`: the same `settle()` with both off, filtered to the caller's characters (design,
  section 7). Its entries carry, per reaction, the Act, the quadrant, the time and the amount, never who reacted. With
  the shared vote off, everything that counts players counts reactions instead (the Lurker's "among the first three",
  a post's direction by weight), so no estimate says that two reactions were one player's.
- The input it reads is scoped: new SQL `estimate_input(account)` in `0013_estimate.sql` returns the open window's Acts
  by the caller's characters, every reaction on them, and every Act the caller's characters reacted to with its
  reactions (the Lurker's "where it ends up"); it never returns another player's identity, only `player` keys hashed
  per request so the engine can drop self-reactions and count distinct players. Read by the service only.
- New `supabase/functions/estimate/` (`core.ts`, `core.test.ts`, `index.ts`): the signed-in caller's estimate.
- **Tests first:** on fixtures, the scoped estimate equals the full-window estimate filtered to the caller; with the
  shared vote off, a second reaction from one player never changes the first's amount; with the halving off, a third
  post's reaction counts whole; the answer for one player is the same whoever else reacted and with how many characters;
  the exact settlement is unchanged by the options' defaults.

### Task 6. Reading, views and a player's own reactions

- New `supabase/migrations/0014_reading.sql`:
  - `reading` (account, thread, furthest_seq, first_character, first_read_at, read_at), private, own rows only;
    `mark_read(in_thread, seq, through)` raises `furthest_seq` monotonically and records the HUD's character on a
    player's first read of a thread.
  - `thread_view_counts` (thread, players, counted_at), public; `count_thread_views()` recounts only threads read
    since the last count, scheduled with `pg_cron` at a new setting `viewCountCron` (hourly by default).
  - `my_reactions`, a `security_invoker` view of the caller's own reactions (Act, kind, character), so a screen can
    outline them and say "2 of 3 left".
- **Tests first:** a count moves only when the job runs; one player reading through three characters counts once;
  `mark_read` never lowers `furthest_seq`; another account reads no reading row and no reaction of another's;
  `thread_view_counts` and `reading` hold no column the Realtime publication test forbids.

### Task 7. Preferences, profiles, avatars, ranks and pips

- `engine/rules/types.ts`: `Instance` gains `ranks: readonly { name: string; from: Hundredths }[]` (ascending from 0)
  and `pipStyles: readonly { key: string; name: string; full: string; empty: string }[]` with a `default` key;
  `instanceProblems()` holds both. `instances/divided-world/` gives placeholder ranks (Jobber, Enhancement Talent,
  Midcarder, Main Eventer, Headliner, Legend; thresholds the owner sets) and the default pip style.
- New `supabase/migrations/0015_profiles.sql`:
  - `account_preferences` (account, theme, postbit `side`|`stacked`, motion `system`|`reduce`|`full`), own rows only.
  - `character_profiles` (character, title ≤ 40, signature ≤ 500 in BBCode, avatar keys for source, square and portrait,
    the two crop frames, pip_style, updated_at), public read; `set_profile(through, …)` as the character's player.
  - `pip_styles` seeded from the instance; a profile's pip style is one of them.
- New `supabase/functions/avatar/` (`core.ts`, `core.test.ts`, `index.ts`): takes the three WebP files the browser
  re-encoded (square 256×256, portrait 256 wide and at most 512 tall, source at most 1600 on its long side), refuses any
  that is not WebP, carries an EXIF or XMP chunk, or is over its size, stores them under random names in the `avatars`
  bucket through an injected storage interface, and writes the profile. Tests use a fake storage; no build session
  touches a deployed bucket.
- **Tests first:** a WebP with an EXIF chunk is refused; a portrait taller than 2:1 is refused; another player cannot
  set a character's profile; a preference is read by its own account only; an unknown pip style is refused.

### Task 8. Invites with a cap and an expiry; admins

- `engine/rules/types.ts`, `Settings`: `invitesPerPlayer` (3) and `inviteLifetime` (`{ unit: 'day', count: 7 }`).
- New `supabase/migrations/0016_admins_invites.sql`: `admins` (account), written only by the service (an operator's
  act); `is_admin()`. `create_invite()` (`0009_registration.sql`) refuses a player holding `invitesPerPlayer` unused,
  unexpired invites, admins exempt; `invites.expires_at`; `invite_open()` refuses an expired code in the same words as
  an unknown one; `reissue_invite()` gives a fresh expiry.
- **Tests first:** a fourth open invite is refused for a player and allowed for an admin; an expired code reads like an
  unknown one, in words and timing; a reissued invite opens for another seven days.
- **Way out:** an expired invite is reissued. This adds the cap issue #4's question 14 left for later (PR #7 kept
  "no cap yet").

### Task 9. The season's standings

PR #7's Task F debuts a new character at the next settlement, which answers issue #4's question 16; the screens' own
answer ("listed from its first Act or settlement") is withdrawn.

- New `0017_characters_listed.sql`: a view `season_standings` (character, name, standing, place) ranking the open
  season's settled standings of debuted characters.
- **Tests first:** a character waiting to debut is in no row of it; after its first settlement it is.

### Task 10. Retiring a character

- `characters.retired_at`, in `0017_characters_listed.sql`; `characters_within_cap()` counts unretired characters;
  `acting()` (`0005_actions.sql`) refuses a retired one ("retired; an admin can restore it"); new admin-only
  `retire_character(character)` and `restore_character(character)`, the second refused when its owner's roster is
  full.
- **Tests first:** a retired character's Acts all remain readable; it frees a slot; it cannot act; restoring it into a
  full roster is refused in plain words.
- **Way out:** a retired character is restored by an admin.

### Task 11. The edit grace period

- `engine/rules/types.ts`: `Span['unit']` gains `minute`; `Settings.editGrace` (`{ unit: 'minute', count: 2 }`).
- `acts_public` (in `0017_characters_listed.sql`, or its own migration) gains `shown_edited_at`: the latest edit made
  after the post's creation plus the grace; null when every edit fell inside it. `edited_at` stays.
- **Tests first:** an edit a minute after posting leaves `shown_edited_at` null and is still in the post's history; one
  three minutes after sets it.

### Task 12. Export, import and live updates

- `tools/export-instance.mjs`, `tools/import-instance.mjs`, `tools/instance-files.mjs`: every new table, and the
  `avatars` bucket's objects ("Portable by construction"); the round-trip test (`supabase/tests/e2e/0003-export.ts`) is
  seeded with each.
- `supabase/tests/0014-realtime.sql`'s list of forbidden columns gains `account`, `first_character` and `released_at`;
  no new table is published.
- **Tests first:** the round trip with every new table and an avatar is the same instance; the Realtime test fails on
  a planted publication of `reading`.

## Ways out of the states this adds

| State | Its way out |
|---|---|
| A pending Turn | The next settlement applies it; the player withdraws it (PR #7) |
| A retired character | An admin restores it |
| An expired invite | The inviter reissues it |
| A player at their invite cap | An invite used, expired or reissued frees one |
| A post on the System's board refused | Spin a thread from what The System said |

## What could vary with a private fact, and how it does not

- `estimate_input()` and the `estimate` function answer one player about their own characters only, and with the shared
  vote and the halving off, no amount depends on how another player's reactions group.
- `reading`, `my_reactions`, `effect_releases`, `account_preferences` and `my_pending_turns` are read by their own
  account only; nothing about them is broadcast.
- View counts move only when the hourly job runs.
- A character debuts, and a Turn takes effect, at a settlement (PR #7), so neither shows a sitting's minute.
- An expired invite and an unknown one are refused alike.

## Review focus

- What each migration does to an instance that already holds PR #2's rows: threads on the first board, a Turn already
  in `class_history`, a card play under the old unique index.
- The estimate at a busy instance's scale: `estimate_input()` for a player whose posts drew thousands of reactions, and
  how often the screens will call it.
- The tally on the System's board: an instance whose earlier tallies or reveal opened on the first board.
- The hashed player keys in `estimate_input()`: that no answer lets a caller tell two reactors apart across requests.
- An avatar's bytes: a WebP with metadata hidden somewhere the chunk check does not read.
- `count_thread_views()` at a busy instance: rows read per run.
