# Heat Magnet, common and larger: plan

Record, written 2026-11-15. Carries out section 4 of `docs/plans/2026-11-15-base-set-card-numbers-design.md`. One PR
from `main`.

**May start** now. Heat Magnet is already in every sorted list, so this build takes no slot
(`docs/plans/2026-11-14-base-set-design.md`, section 2) and runs beside any card build. It must not run beside the
Settlement plan's build, which edits the same card.

Every task goes test first: change the test, record its red run, then the code. During a task, run only the tests for
the changed code (`node --experimental-strip-types --test <file>` for the rules' tests, `npx vitest run <file>` for
the screens'). Run `npm run typecheck` and `npm run build` once after the last task, with the tail in the PR. No
deployed database, bucket or connector is touched.

**The layers.** Everything here is Divided World's. **This build edits no file under `engine/` and adds no
migration.** The card reaches a database through the instance's seed (`supabase/functions/_shared/seed.ts`,
`instanceSeed`). If a task cannot be done without an engine or SQL change, stop and ask the owner.

**What changes.** Three values of one card:

| | From | To |
|---|---|---|
| `rarity` | `'uncommon'` | `'common'` |
| `price` | `150` | `100` |
| `gimmick.by` | `0.2` | `0.75` |

Its quadrants, its 3 days, its reach and its lack of a `group` stay. Its words are computed from its rules
(`earnWords`, `instances/divided-world/ui/cards/words.ts`, gives "75% higher"), so no sentence is rewritten by hand.

**Ways out, and the masks.** No state is added. The card is played on one's own character, in public, as now; nothing
here adds a response, payload, event or timing.

## Task 1. The rules

Model: haiku

**Files:** `instances/divided-world/cards/heat-magnet.ts`, `instances/divided-world/cards/cards.test.ts`.

**Tests first** (`node --experimental-strip-types --test instances/divided-world/cards/cards.test.ts`), each changed
and seen red before the rules change:
- `'the instance sells its cards at their prices'`: the line `['heat-magnet', 'salty', 150],` becomes
  `['heat-magnet', 'salty', 100],`.
- `'the instance sells Card Collector, Force Field and the new Gimmicks, each with its rarity and play, and stays
  whole'`: the line `['heat-magnet', 'uncommon', 'use', 'salty', 150],` becomes
  `['heat-magnet', 'common', 'use', 'salty', 100],`.
- `'Publicity Tour, Heat Magnet, Class Clown and Good Vibes are Gimmicks with the effects the design names'`: Heat
  Magnet's expected gimmick becomes `{ kind: 'earn', quadrants: ['excitedNegative', 'boredNegative'], by: 0.75 }`.

**Then** in `heat-magnet.ts`: `rarity: 'common'`, `by: 0.75`, `export const price: Hundredths = 100;`, and the header
comment's "uncommon" and "counts 0.2 more" brought to "common" and "counts three quarters more", with a pointer to the
design's section 4.

`instances/divided-world/machine.test.ts` needs no edit: it computes the commons from the cards. Run it and confirm it
passes with Heat Magnet on sale, after the commons' Reversals, among the Gimmicks.

## Task 2. The screens' words

Model: haiku

**Files:** `instances/divided-world/ui/index.test.tsx`; `instances/divided-world/ui/cards/heat-magnet/ui.ts` is read
and, if the test passes without it, not changed.

**Test first** (`npx vitest run instances/divided-world/ui/index.test.tsx`): in `'each new Gimmick reads its span and
its amount from its own rules'`, the loop over `['publicity-tour', 'heat-magnet']` becomes two lines: Publicity Tour
still matches `/3 days[\s\S]*earns from[\s\S]*20% higher/u`, and Heat Magnet matches
`/3 days[\s\S]*earns from[\s\S]*75% higher/u`. After Task 1 this passes with no change to `ui.ts`; record the red run
from before Task 1's rules change, or from the old pattern against the new rules.

## Task 3. What else names the card

Model: sonnet

**Files, each read, and changed only where a test or a sentence states the old rarity, price or size:**
- `supabase/functions/settle/core.test.ts` (`'the shares sent for a boost entry carry its card…'`) and
  `supabase/tests/e2e/0001-settlement.ts` (the Heat Magnet on the Heel): both assert that a boost entry exists and
  names its card. Run `npm run test:engine`; where an asserted amount moved with `by`, correct the amount and say so in
  the PR. Do not weaken an assertion to make it pass.
- `web/src/data/fixtures/boards.ts`, `BOARD_SLOTS`: **not changed.** The list is the machine the boards were drawn
  against, kept fixed on purpose; Heat Magnet stays where it is there.
- `e2e/boards/2026-11-07-booster-packs/05-admin.ts`: a header comment that names the card; not changed.
- `instances/divided-world/guide/`: search for a sentence that calls Heat Magnet uncommon or states "20%"; at the time
  of this plan there is none.
- Any Storybook story or fixture that hard-codes Heat Magnet's rarity or price (`git grep -n "heat-magnet"`): bring it
  to the new values.

## Task 4. The whole build

Model: inline

`npm run typecheck` and `npm run build`, tails in the PR. `npm run test:sql` is not needed: no SQL changed, and the
seed's test (`supabase/functions/_shared/seed.test.ts`) recomputes from the instance and runs in `test:engine`.

## Review focus

- **A machine a database already holds.** `seed_instance` never touches a held slot, so a seeded instance keeps Heat
  Magnet hidden at 1.50 until an admin changes it, while its card kind's rarity changes. Confirm what a re-seed does to
  the held `card_kinds` row and the held slot, and say in the PR what an admin of a seeded instance must do.
- **Packs.** A common is pulled far more often than an uncommon (`instances/divided-world/packs.ts`). Confirm the
  pack tests pass unchanged and that no test pins the count of commons or uncommons.
- **The staff pool.** `settings.pool.cardRarityMost` is `common`, and the pool offers only casts and sets
  (`cardsOnOffer`, `supabase/functions/chatter/core.ts`). Confirm Heat Magnet, a use card, is still not offered to a
  Mod Bot and the chatter tests pass unchanged.
- **Stacking until Settlement.** Heat Magnet has no `group`, so it adds to any other Earn on the same earning. Today no
  other Earn names a negative quadrant except Class Clown's eye-roll; confirm that a Heat Magnet and a Class Clown on
  one character still settle as the settlement tests expect at 0.75.
- **The size at a busy instance.** A 75% boost on every negative earning of a character for 3 days is paid from
  nowhere but the ledger; confirm the settlement's scale test (`engine/rules/settle.scale.test.ts`) is unaffected and
  note the season review tunes the number.
