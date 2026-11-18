Record, written 2026-11-18.

# A play keeps its terms: plan

Carries out section 2 of `docs/plans/2026-11-18-catalog-over-time-design.md`. One PR from `main`. It shares no code
with `docs/plans/2026-11-18-retired-cards-plan.md` and either may be built first.

Every task goes test first: write the failing test, record its red run, then the code. During a task, run only the
tests for the changed code (`npm run test:sql`, `node --experimental-strip-types --test <file>`,
`npx vitest run <file>`). Run `npm run typecheck` and `npm run build` once after the last task, with the tail in the
PR. No deployed database, bucket or connector is touched; SQL is tested against Postgres on localhost.

**One migration**, the next free number at build time, named `play_terms`, with SQL test files of the same number.
Every function it changes is written whole with `create or replace` from its latest definition and keeps its
signature, security, search_path and grants unless the task says otherwise. Line numbers below are as the tree stood
at `9d854c0`.

**The rule, whole.** After a play is made, nothing reads `card_kinds` (or `instance.cards`) by the play's card for
anything but the card's name. It reads the play's terms.

**The layers.** Tasks 1 to 5 are the engine's and name no card. Task 6 is Divided World's words.

**The masks.** A card's terms are public catalog data, the same for every caller. No response, Realtime event or
timing is added that differs by who asks. A play's version says only when it was made relative to a retune, which
its timestamp already says.

**States.** None added.

**Scale.** `card_terms` grows by one row per retune per card. A play's terms are read by primary key. The
settlement input grows by the distinct versions among the plays it holds.

## Task 1. The catalog keeps every version

Model: sonnet

**Files:** the migration; the SQL test file.

- `card_terms (card text references card_kinds (key), version integer, terms jsonb not null, since timestamptz not
  null default now(), primary key (card, version))`, append-only by trigger as `report_refunds` is (update, delete
  and truncate refused, the truncate guard `enable always`). Readable by `anon` and `authenticated`: it is the
  public catalog.
- `terms` holds every column the seed writes to `card_kinds` except `key` and `name` (the list is in
  `seed_instance`'s insert, `0361_discipline_cards.sql` line 369 as written), built by one function,
  `card_terms_of(card_kinds) returns jsonb`, so the seed, the fill and the guard in Task 5 share it.
- The migration fills version 1 for every row of `card_kinds` as it stands.
- `seed_instance`: after its upsert of `card_kinds`, each card whose `card_terms_of` differs from its latest
  version's `terms` gets the next version. A new card gets version 1.
- `card_terms_now(card text) returns integer`: the latest version.
- `play_terms(play uuid) returns jsonb`, `stable`: the terms of the version the play names, and version 1 for a
  play that names none (one made before this migration). For a `spring` Act it is the terms of the face-down row it
  sprang from.

**Tests first.** The fill gives every card one version. A seed that changes one card's `lasts` adds a version for
that card alone; a seed that changes only a name adds none; the same seed twice adds none. An update or a delete on
`card_terms` is refused.

## Task 2. A play records its version

Model: sonnet

**Files:** the migration; the SQL test file.

- `place_cast` (`0374_cards_on_a_spun_thread.sql`, the payload at lines 437 to 452) writes `'terms',
  card_terms_now(card)` on the `card` Act. Kind `card` has no payload key list to widen.
- `face_down` gains `terms integer` (null on rows already held, read as version 1). `place_set` (0374, the insert
  near line 604) writes the current version. The `set` Act's payload stays `{}` (`acts_set_payload`).
- `lay_sprung` (`0360_setting_thread.sql`, lines 426 to 431) writes on the laid `card` Act the version of the
  face-down row, not the current one.
- `staff_play_card` (`0149_card_writes.sql`) goes through `place_cast` and needs no change; confirm.

**Tests first.** A cast, a use, a set and a sprung lay each carry the version current when they were made, after a
later seed has added another. A play inserted as 0374 wrote it (no `terms`) reads version 1 through `play_terms`.

## Task 3. SQL reads the play's terms

Model: sonnet

**Files:** the migration; the SQL test file; existing tests of each function below where they assert a value that a
retune in the test would move.

Each of these replaces its read of the current `card_kinds` row, for a play already made, with `play_terms` (or the
`face_down` row's version). A play being made in the same call keeps reading the current row.

- `settlement_input` and `estimate_input` (`0376_cushion_kind.sql`, lines 239 and 358): which plays are `earn_up`,
  `skim_up`, `ride_gimmicks` and `my_gimmicks`; whether a play carries `ends` and `quadrant`. The lookback
  (`max(lasts)` over cards of a kind) is taken over every version in `card_terms`, so a play made under a longer
  `lasts` is still found. The input also gains `terms`: an object from `"<card>@<version>"` to that version's terms,
  for every play in `acts`, and each play its `terms` version (Task 4 reads them).
- `ward_refusal` (`0148_card_types.sql`, lines 122 to 145): each live ward's gimmick.
- `card_target` (`0368_client_reads_plan_once.sql`, lines 392 to 427) and `reach_effects` (0148, lines 84 to 91):
  each live play's gimmick, the quadrant gated on a skim, and a drive's close.
- `donate` (`0153_drives.sql`, line 868), `drive_plays` (0153, line 185) and `place_cast`'s drive join (0374, lines
  294 to 297): the drive's length, gifts, overhead and stack, of the play that opened the drive.
- `watched_characters` (`0362_patrol_weights.sql`): a watch's weight.
- `no_quote_on` (`0316_card_notes_part_4.sql`, line 541).
- `spring_facts` (0374, lines 717 to 807), `spring_traps` (`0357_post_veils.sql`, lines 987 to 1019): the set
  card's trap, stack, skim, `scores_as`, veil, reaches and rarity, from the version it was set under. The incoming
  card, being played now, reads the current row.
- The flags read later: `keeps` (`thread_page`, `0375_spun_thread_reads.sql` line 344; `reverse_card`,
  `0349_thread_page_under.sql` line 233), `writes` (`live_writing_plays` and `post_tails`, 0149), `scores_as`
  (`scored_as_plays`, `0151_card_payouts.sql` line 1071), and the fall kind (`infract`, `acts_warn_guard` and
  `file_visit` in 0361; `thread_page` line 572).

`thread_page`, `card_target` and the log's reads that carry a play to the client also carry its `terms` version, so
the screens can ask for the terms (Task 6).

Hold each changed read to the plan its own header or test asserts: `play_terms` is a primary-key read, and where a
function is inlined by its caller today (a `language sql` function with no `set` clause), keep it so.

**Tests first.** For each function, one case: a play, then a seed that changes the field that function reads, then
the same call, answering as before. Each is red before its function changes.

## Task 4. Settlement reads the play's terms

Model: sonnet

**Files:** `engine/rules/types.ts` (`InputAct`, `SettlementInput`); `engine/rules/settle.ts` (the maps at lines 200
to 232 and each use the session's inventory names: `alignmentOf` at 247, 439, 458, 465, 483, 501, 505; `reversals`
at 228; `earnOf` at 544 with 588 and 672; `cushionOf` at 545; `skimOf` at 622; the ride maps at 637 to 655;
`payout` at 616); `engine/rules/settle.test.ts`; the test helpers under `instances/divided-world/` that build an
input; `engine/ui/data/fake.ts` (its settlement input).

- `SettlementInput` gains `terms: Record<string, CardTerms>` and `InputAct` gains `terms?: number`. `CardTerms` is
  the subset of `CardRules` that `card_terms_of` writes, typed once in `types.ts`.
- `settle` looks a play's rules up by `"<card>@<terms>"` in the input. A play with no version reads version 1. A
  play whose terms the input does not hold is refused as a play of an unknown card is today (line 247): an input is
  never settled on a guess.
- `payout` writes the share it paid at into the entry's params (`{ card, share }`), for `card.skim` and `card.ride`.
- `estimateForOwner` and `shareEntries` (lines 842 and 763) call the same `settle` and need no change of their own.
- `instance.cards` is still read for nothing in `settle` but a card's existence check, if any remains; say in the
  PR which.

**Tests first.** The test #742 proposed: one Earn play up across two windows, the card's `by` raised between them,
both windows pay the first size, and the second window takes back no vote at the new size. Its poison: `earnOf`
read from `instance.cards`. The same shape for a cushion share, a skim share and a ride share. A play with no
version settles on version 1.

## Task 5. The guard: a retune moves no play

Model: sonnet

**Files:** a second SQL test file of this migration's number, named for the guard.

It seeds a small instance holding one card of every `play` and gimmick kind the engine knows (cast on a post, use,
set with each trap outcome, earn, cushion, ward, price, ride, noQuote, skim, drive, scores-as, watch, fall, veil,
keeps, writes). It makes one play of each, records the answer of every function in Task 3 for that play, then
rewrites every field of every card's current row (through a seed, so each gets a new version), and asserts each
answer is unchanged. A new card kind added later with no play in this test fails a count check at its head ("a kind
of card this guard makes no play of").

**The poison,** in the test's own self-test block: `ward_refusal` put back on the current row, and the guard red on
its ward case. `A guard that has never been red is not known to work` applies: record the red run.

## Task 6. The words say the play's terms

Model: sonnet

**Files:** `engine/ui/data/api.ts` (a read of `card_terms` for the versions a page's plays name, and `terms` on
the play rows); `engine/ui/data/fake.ts`; `engine/ui/log/lines.ts` (`logPlay` at lines 753 to 764, the ride spring
line at 1128, the set-waits words at 203 to 211, the flags at 895 and 1211); `engine/ui/cards/Lens.tsx` (lines 240
to 270 and 816 to 828), `plays.ts` (line 307), `marks.ts` (`gimmickWords`, lines 96 to 110), `discipline.ts`,
`PlayActions.tsx` (`effectOf`, line 180), `land.ts` (line 31), `Marks.tsx`; the interface an instance's card words
are called through; `instances/divided-world/ui/cards/*/ui.ts` and `words.ts` (`earnWords`, `skimShare`,
`tollShare`, `priceAdd`), `instances/divided-world/ui/index.ts` (the `card.skim` and `card.ride` reason words,
lines 112 to 123); their tests.

- The interface: a card's `logPlay`, `status`, `summary` and its Lens words are handed the play's terms beside its
  config, and say sizes from them. `describe`, the card's own description in the hand, the machine and the picker,
  is about a play not yet made and keeps reading the current rules.
- `gimmickWords` and `disciplineNote` are given the play's terms.
- The reasons `card.skim` and `card.ride` say the share from the entry's params; an entry settled before this has
  none and keeps today's words, as #777 did for boost and cushion.
- The retune tests that assert words follow the current rules (`engine/ui/log/lines.test.tsx` lines 1310 to 1312,
  `engine/ui/cards/marks.test.ts` lines 75 to 77, `instances/divided-world/ui/index.test.tsx` lines 899 to 967 and
  1010 to 1126) are turned over: a play made before the retune says the old size, one made after says the new.

No screen is added. The Lens and the log are the glass and already say these things plainly; only where the number
comes from changes.

**Tests first.** A log line and a Lens row for a play made under version 1, drawn after the card's current rules
changed, say version 1's size. `describe` in the hand says the current size.

## Task 7. The issues

Model: inline

`Closes #742` in the PR's description. Check item 2 of #572 and item 4 of #690 with a link to the PR. File one
issue, a question for the owner: economy settings a class's rules read at settlement are read as they stand when the
window settles; should a setting retuned inside a window reach it? Name the settings `settle` reads and one case.

## Review focus

- A play made before the migration, on a card retuned between its making and the migration: it is pinned to the
  terms of migration day, not of the day it was made. That is the best an append-only table allows; say so in the
  PR and check nothing claims more.
- The release minute (#735): a function serving new code against a database not yet seeded, or the reverse, and
  what `play_terms` and `settle` do with a version one side does not know.
- Any reader of `card_kinds` by a play's card that the inventory missed. The guard in Task 5 catches only the
  functions it calls; grep every `join card_kinds` and `from card_kinds` in the latest definition of each function
  and account for each in the PR.
- `settlement_input`'s cost on a busy instance with the `terms` object and the lookback over `card_terms`.
- A face-down card set under one version and sprung under another, where the new version changed its trap's
  trigger: it springs by the old trigger, and the set-waits words must say the old one.
- The export and import round trip with `card_terms`: an import must keep version numbers and must not add a
  version when the seed runs after it.
- The masks: `card_terms` is readable by `anon`; confirm no column of it is anything but catalog data.
