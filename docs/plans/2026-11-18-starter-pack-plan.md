# The Starter Pack: plan

Record, written 2026-11-18. Carries out `docs/plans/2026-11-18-starter-pack-design.md`. One build session, one PR,
which closes #598. The tasks build in order; each writes its tests first and shows them red.

## The layers

- **Engine** (`engine/`, `supabase/`): `PackRules` as a pull pack or a fixed pack, its check, roll and odds; the
  sealed state (`pack_openings`, `open_pack`, the sealed read); `Settings.startingPack` and its check; the grant in
  `create_character` and the seed's backfill; the log's lines; the hand's sealed packs, the Hand button's dot; the
  reveal's `hit`; the machine's about panel for a fixed pack.
- **Instance** (`instances/divided-world/`): the `starter` pack, `startingPack: 'starter'`, its art and `packsUi`
  entry, the tour's hand copy, and the test of the design's section 2.
- No engine file names `starter`, a card of the pack, or Divided World; the boundary check holds it as it does today.

## The masks, for every task

- A pack, sealed or opened, is the caller's own row, read by its own account alone; opening writes no Act and
  broadcasts nothing.
- `open_pack` refuses a pack that is not the caller's in the same words, and the same error code, as one that does not
  exist. The SQL test asserts the two are byte-identical.
- `create_character`'s answer has the same shape with a grant and without.
- No read the client can make returns a sealed pack's `contents`.

## Task 1: Fixed packs in the rules

Model: sonnet

- **Files:** `engine/rules/packs.ts`, `engine/rules/instance.ts` (`packProblems`, `settingsProblems` or the instance
  check that sees both settings and packs), `engine/rules/types.ts` (`Settings.startingPack`).
- `PackRules` becomes `PullPack | FixedPack`: `{ key; pulls; leaves? }` or `{ key; contents: readonly string[] }`.
  Export `isFixed(pack)`. `rollPack` returns a fixed pack's `contents` as they are, drawing nothing from `random`.
  `packOdds` is for pull packs alone (its type says so); a new `packHit(pack)` says whether the last card is a hit
  (true for a pull pack, false for a fixed one).
- `packProblems` refuses: a pack with both `pulls` and `contents`, or neither; a fixed pack with no cards; a fixed
  pack naming a card the instance lacks; a fixed pack naming a card `withheld` under the instance's settings; a fixed
  pack with `leaves`.
- `Settings.startingPack: string | null`. The check refuses a name that is no pack of the instance's, and one that is
  a pull pack.
- **Tests first:** `engine/rules/packs.test.ts`: `rollPack` on a fixed pack returns its contents and calls `random`
  zero times; `packHit` both ways. `engine/rules/instance.test.ts`: one assertion per refusal above, each matched on
  its sentence, and a good fixed pack and a good `startingPack` pass. Every other call of `packOdds` and `rollPack`
  (`grep -rn "packOdds\|rollPack" engine web instances`) still compiles and its test passes.

## Task 2: The database: fixed packs, sealed packs, opening, the grant

Model: sonnet

- **Files:** a migration `supabase/migrations/0377_sealed_packs.sql` (the next number when built), with
  `supabase/tests/0377-sealed-packs.sql`.
- `pack_kinds` gains `contents text[]`; `pulls` becomes nullable; a check holds exactly one of the two, and
  `pack_pulls_problem` runs only on a non-null `pulls`. The latest `seed_instance` (0361's, as of this writing) is
  replaced to write `contents` from the payload's packs, everything else as it was.
- `packs` gains `source text not null default 'bought' check (source in ('bought', 'welcome'))`. The price check
  becomes: a bought pack's price is positive and a welcome pack's is 0 with no slot. `odds` becomes nullable (a fixed
  pack has none). A unique index `packs_one_welcome on packs (account) where source = 'welcome'`.
- `pack_openings (pack uuid primary key references packs (id), at timestamptz not null default now())`, append-only
  with the triggers `packs` uses (`ledger_append_only`). A pack is opened when it has a row here or its own
  `opened_at` is set (every pack bought before this migration).
- `open_pack(pack uuid) returns jsonb`, security definer, granted to `authenticated` alone: lock the caller's own pack
  row (`for update` on a row of `packs` matched on `id` and `account = auth.uid()`); refuse a missing or foreign pack
  in one message, and an opened one; insert its `pack_openings` row and one `pulled` `card_ledger` row per card in
  `contents` order; return `{ pack, kind, contents }`.
- `buy_pack` (0140's): a fixed kind's contents in place of `roll_pack`; the row is written with `opened_at` as today,
  so a bought pack is never sealed.
- `my_packs` answers `contents` null and `opened_at` null while sealed, and `opened_at` from `pack_openings` once
  opened, plus `source`. The caller loses any read of `packs.contents` that bypasses it: revoke `packs` from
  `authenticated` if nothing else reads it as the caller (`grep -rn "from packs\|packs p" supabase/migrations` and
  `web/src`), else revoke the column. The log read (0368's, which reads `my_packs`) is checked to carry `source`.
- `create_character` (0124's, same signature and grants): after the character is made, where
  `setting('startingPack')` is a string and names a fixed pack kind, insert the caller's welcome pack
  (`contents` from the kind) `on conflict do nothing` against `packs_one_welcome`.
- `seed_instance`, after the settings are written: the backfill, one insert of a welcome pack for every account with a
  character and none yet, when `startingPack` names a fixed pack. Indexed on `characters (account)` and the unique
  index, so its cost is one anti-join, and nothing on a second seed.
- If `settings_held` or the settings check lists the keys a seed may write, `startingPack` joins it.
- **Tests first** (the SQL test, run against localhost Postgres):
  - a fixed `pack_kinds` row seeds; one with both columns, and one with neither, is refused.
  - the first `create_character` writes one sealed welcome pack; a second character, and a second call racing the
    first (two sessions), write none.
  - with `startingPack` null, no pack is written.
  - while sealed: `my_packs` shows the row with `contents` null; `select contents from packs` as the owner is refused
    or returns nothing; `my_cards` holds none of its cards.
  - `open_pack` writes six `pulled` rows in order, and `my_cards` and `card_held` count them; a second `open_pack`
    is refused; `open_pack` of another account's pack and of a random uuid are refused in byte-identical words and
    error codes.
  - `pack_openings` and `packs` refuse an update and a delete.
  - `buy_pack` of the Booster is unchanged (the existing test passes), and of a fixed pack sold in a test slot writes
    its contents, opened.
  - the backfill: an account with a character and no welcome pack gets one on seed; a second seed writes nothing; an
    account with no character gets none.
  - an export taken with a sealed and an opened welcome pack round-trips (`supabase/tests/e2e/0003-export.ts` gains
    both).

## Task 3: The data layer

Model: sonnet

- **Files:** `engine/ui/data/api.ts`, `engine/ui/data/fake.ts`, `web/src/data/supabase.ts`, with their tests.
- `SealedPack { pack: Id; kind: string; at: string }`. The player API gains `sealedPacks(): Promise<readonly
  SealedPack[]>` (from `my_packs` where unopened) and `openPack(pack: Id): Promise<Answer<Opened>>` (`open_pack`;
  `Opened.balance` becomes optional, since opening moves no Aura, or `openPack` answers its own type; the build picks
  one and says which).
- The log's pack entries carry `source` and whether they are opened.
- The fake backend mirrors Task 2: its `createCharacter` grants once per account from `instance.settings.startingPack`,
  its packs hold `contents` and an opening, `openPack` refuses as the SQL does, and `myCards` counts opened cards only.
- **Tests first:** the fake's own tests for the grant, the once, the opening and the refusals; the adapter's test that
  `sealedPacks` and `openPack` call `my_packs` and `open_pack` with their arguments.

## Task 4: The log

Model: sonnet

- **Files:** `engine/ui/log/lines.ts`, `engine/ui/log/lines.test.tsx`.
- A `welcome` pack row is its own line at its `bought_at`: "Welcome gift: a sealed Starter Pack" (the instance's pack
  name, with its article). Its `pulled` rows, once opened, are one line at the opening: "You opened your Starter Pack",
  details listing the cards in `contents` order. No Aura moves on either. A bought pack's line is unchanged (its
  existing tests pass).
- **Tests first:** both lines from a fake log; a sealed welcome pack shows the first line alone; a bought pack's line
  is byte-identical to today's.

## Task 5: The reveal and the machine

Model: sonnet

- **Files:** `engine/ui/vending/PackOpening.tsx`, `engine/ui/vending/Vending.tsx`, their tests and stories.
- `PackOpeningProps` gains `hit: boolean`. With `false`, no card is the hit: no gold back, tag, beat, halo or sparks,
  and the head's count and every "of N" read the pack's own length (check nothing says five). Vending passes
  `packHit(pack)`.
- `PackOpeningProps` gains an origin for the rise (`from?: () => HTMLElement | null`), so the hand can open it from
  the sealed pack; Vending keeps rising from its slot.
- The machine's about panel for a fixed pack lists its cards, in order, in place of the odds and the "equally likely"
  line.
- **Tests first:** a six-card reveal with `hit={false}` turns six, says "6 of 6", and draws no hit tag; the existing
  five-card tests pass with `hit`; the about panel of a fixed pack lists its cards and no percentage.

## Task 6: Sealed packs in the hand

Model: sonnet

- **Files:** `engine/ui/cards/Hand.tsx`, `engine/ui/frame/Hud.tsx` (the Hand button), `engine/ui/frame/frame.css`,
  `engine/ui/tips/tour.ts` only if the target changes (it does not: the step stays on the Hand button), their tests and
  board stories.
- The Hand reads `sealedPacks()` with the cards and draws each sealed pack first, before every card group, as a
  button with the pack's art at a card's size (`PackArt`), named "<Pack name>, sealed: open it". On the Main board it
  stands first on the arc (`engine/ui/cards/arc.ts` counts it as a place); on the Phone board it is first in the row
  and can reach the middle like any card. It is in the list's keys; it cannot be armed; the sheet's count of cards
  leaves it out.
- Pressing it calls `openPack`, then opens `PackOpening` with `hit={false}` for a fixed pack, `from` the pressed pack;
  the hand refreshes its cards and sealed packs when the reveal closes, and the cards fly to the Hand button. A refusal
  shows the answer's words in the sheet's line and leaves the pack where it was.
- The Hand button carries a dot while any pack is sealed, and its accessible name gains ", 1 sealed pack" (", N sealed
  packs").
- **Tests first:** with a sealed pack, the hand's first item is the pack's button and the arc holds one more place;
  Left from the first card reaches it; pressing it opens the reveal with six cards and, closed, the hand holds them and
  no pack; the Hand button's name and dot, with and without; a refused open leaves the pack and says why; the phone
  sheet's row starts with it. The reduced-motion test of the reveal passes from the hand.

## Task 7: Divided World's Starter Pack

Model: sonnet

- **Files:** `instances/divided-world/packs.ts` (`{ key: 'starter', contents: ['feelin-fab', 'rope-break',
  'steel-chair', 'whoops', 'this', 'autocorrect'] }`), `instances/divided-world/settings.ts`
  (`startingPack: 'starter'`), `instances/divided-world/ui/packs.ts` (a `starter` entry, name "Starter Pack", tagline
  "Six cards, two of each flavor."), `instances/divided-world/ui/packs/starter/` (`scene.py` copied from the Booster's
  with its palette changed and STARTER on the film; `art.webp`, `relief.webp`, `mark.svg`, `art.json`),
  `instances/divided-world/ui/onboarding.ts` (the `tour-hand` line, and the header comment's sentence about Task 11
  replaced by this design's name).
- The tour's hand line, a draft for the owner's review: "Cards live here, shared by all your characters. A new pack
  waits here sealed until you open it. Open the hand, arm a card, and pick where it lands."
- The art: render both files with the cards' rig as `scene.py`'s docstring says. If Blender (`bpy`) is not available
  in the build's container, the build says so in the PR, ships the Booster's files under the starter's own palette
  (`color`, `ink`) as the placeholder, and leaves the render to the owner with the script committed. A pack's art test
  (`engine/ui/vending/packLight.test.tsx` and the instance's UI checks) passes either way.
- **Tests first:** a new `instances/divided-world/packs.test.ts`: the starter is six cards, two of each flavor, every
  one common, and each has a target its `playPrice` prices at 0 (a post shorter than `whoops.lengthStep`; an
  Autocorrect phrase whose volume is under `autocorrect.volumeStep`, read from the instance's settings, never retyped).
  `instanceProblems(instance)` stays empty.

## Task 8: End to end

Model: sonnet

- **Files:** an e2e under `supabase/tests/e2e/`, in the style of the onboarding tour's.
- A fresh invited account makes its first character, sees the pack first in its hand and the Hand button's dot, opens
  it, turns all six, and holds the six cards; its log shows the welcome line and the opening line; its wallet is 0.00.
  A second character grants nothing.

## Review focus

- What the migration does to packs already held: every pack bought before it has `opened_at` set and must read as
  opened in `my_packs`, the log and the hand, with no `pack_openings` row.
- The backfill on each seed: a busy instance's seed must stay one anti-join, and a seed must never grant twice.
- A racing `create_character` or `open_pack` from two tabs: one welcome pack, one opening, six ledger rows.
- Every read the client can make of `packs` (direct, `my_packs`, the log's reads, the export) for a sealed pack's
  `contents`.
- `open_pack`'s refusals: no difference in words, code or timing between a foreign pack and a missing one.
- The reveal's existing five-card hit pack: unchanged in look, motion and words after `hit` and `from` are added.
