# Thick Skin, a Gimmick that halves what a character loses from reactions: plan

Record, written 2026-11-16. Carries out Thick Skin's row of `docs/plans/2026-11-16-settlement-design.md` (section 4),
from `docs/plans/2026-11-15-base-set-card-numbers-design.md` (section 3.1). One PR from `main`.

**May start** after `docs/plans/2026-11-16-settlement-engine-plan.md` merges, beside the other Wave 2 cards.

Every task goes test first: write the failing test, record its red run, then the code. During a task, run only the
tests for the changed code (`npx vitest run <file>`, or `node --experimental-strip-types --test <file>` for the rules'
tests). Run `npm run typecheck` and `npm run build` once after the last task, with the tail in the PR. No deployed
database, bucket or connector is touched.

**The layers.** Everything here is Divided World's, carried in through `CardRules` and `CardUi`. **This build edits no
file under `engine/` and adds no migration.** The card reaches the database through the instance's seed
(`supabase/functions/_shared/seed.ts`), which sends `gimmick` whole. If a task cannot be done without an engine or SQL
change, stop and ask the owner.

**The world.** The card draws nothing of its own on a post. Its face and its sheet are the glass, in the words below;
its status line shows where the play is up, as Heat Magnet's does.

**What already works, so it is not built here** (read, not changed): the engine's cushion and its settlement
(`engine/rules/settle.ts`), its catalog check and `settlement_input` (the engine plan's migration), the stack of one
that refuses a second live play (`landsOn`), and that a use card is played on the holder's own character (the
engine's).

**The card's place in the lists.** Key `thick-skin`, between `tattle-tale` and `this` in every sorted list.

## Task 1. The rules

Model: haiku

**Files:** a new `instances/divided-world/cards/thick-skin.ts`, a new
`instances/divided-world/cards/thick-skin.test.ts`, `instances/divided-world/cards/index.ts` (one import line and one
list line, each at the card's place), `instances/divided-world/cards/cards.test.ts` (one line in the list of `'the
instance sells its cards at their prices'`, at the same place: `['thick-skin', 'sweet', 150],`).

`thick-skin.ts`, whole:

```ts
/**
 * Thick Skin (Sweet, uncommon, Gimmick on a character): for 3 days, half of each loss the character's class takes from a reaction is given
 * back, then it ends by itself (docs/plans/2026-11-16-settlement-design.md, sections 3.2 and 4). It changes no gain, and no cost that no
 * reaction caused. The settlement's is the giving back; this file names only the effect and its share.
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';
import type { Hundredths } from '../../../engine/rules/types.ts';

export const thickSkin: CardRules<Record<string, never>> = {
  key: 'thick-skin',
  name: 'Thick Skin',
  alignment: 'sweet',
  rarity: 'uncommon',
  play: 'use',
  reaches: ['character'],
  gimmick: { kind: 'cushion', share: 0.5 },
  lasts: { unit: 'day', count: 3 },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(thickSkin, target, effects, now),
  validateConfig: () => ok({}),
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 150;
```

In `index.ts`: `import { thickSkin, price as thickSkinPrice } from './thick-skin.ts';` and `[thickSkin as CardRules,
thickSkinPrice],`.

Tests, red first, in `thick-skin.test.ts` (model: `toll.test.ts`; helpers from `test-kit.ts`):

- its facts: key, name, alignment `sweet`, rarity `uncommon`, `play` `use`, the gimmick and `lasts` deep-equal to
  those above, and the machine sells it for 150;
- `decideUse` on a character target, built as `cards.test.ts` builds one for Heat Magnet, is ok with price 0;
  `decidePlay` is refused (a Gimmick is not cast); with a live play of the same card on the target, `decideUse` is
  refused;
- `instanceProblems(instance)` is empty with the card in the pool.

## Task 2. What it pays, settled with the real instance

Model: sonnet

**Files:** `instances/divided-world/cards/thick-skin.test.ts`.

Model: the settlement test the engine plan added beside the earn cards' facts in `cards.test.ts` (Heat Magnet on a
Technician): build a `SettlementInput` by hand and call `settle(input, instance)`. A vote is 10 hundredths. Red first:
write them before Task 1's card is in the list.

- a Technician under Thick Skin with one heat vote from another player on a post: `technician.draggedIn` -10 and a
  `card.cushion` of 5 with params `{ card: 'thick-skin', share: 0.5 }`;
- a Face with one hype vote: its gain, and no cushion;
- a loss on a card the character played is halved too;
- a Lurker past its posts allowed: `lurker.postedTooMuch` whole, and no cushion;
- Thick Skin and Heat Magnet both up on a Technician's heat vote: -10, a cushion of 5 and a boost of 8 (7.5, rounded).

## Task 3. The face and the sheet

Model: sonnet

**Files:** a new `instances/divided-world/ui/cards/thick-skin/ui.ts` (the folder holds `art.webp`, `mark.svg`,
`art.json` and `scene.py` already; none changes), `instances/divided-world/ui/cards.ts` (one import line and one list
line, at the card's place), `instances/divided-world/ui/index.test.tsx`.

`ui.ts` follows `ui/cards/heat-magnet/ui.ts`. Every size and span in a sentence is read from `thickSkin`
(`shareWords`, `spanWords`, and `LARGEST` from `ui/cards/words.ts` where the sentence is that one), never restated as
a literal. Its entry, exactly:

- `key: 'thick-skin'`
- `art: { color: '#2ee6ff', ink: '#03141a', canvas, mark, credit: <art.json's credit>, tagline: 'Lose half as much
  from reactions.' }`
- `summary`: "Used on your own character. For 3 days, what it loses from reactions is halved."
- `status: 'Loses half as much from reactions'`
- `describe: (settings) =>` "A Sweet card, uncommon, used on your own character, the one playing it. For 3 days,
  whenever a reaction to something that character did costs it Aura, half of that loss is given back, and then it
  stops by itself. It changes nothing the character earns, and nothing it loses for any other reason. A card that pays
  more for the same reaction still pays. It costs nothing more to use."
- `logPlay: () =>` "What that character loses from reactions is halved until it ends."
- No `Effect`, no `ConfigForm`, no `hint`.

Tests, red first, in `ui/index.test.tsx`, beside the earn cards' assertions:

- its `art.color` and `ink`, tagline, summary, status, `describe(instance.settings)` and `logPlay()` are the strings
  above, and it has no `Effect` and no `ConfigForm`;
- its tagline fits the plate: wrapped greedily at spaces it makes at most two lines of at most 20 characters (a small
  function in the test; issue #772's check replaces it when it lands);
- its words hold no "%" and no class's name;
- the file's rules over every card (art, key order, `instanceUiProblems` empty) pass with the card in.

`node tools/check-card-art.mjs` passes with the folder as it is.

## Task 4. The build

Model: inline

`npm run typecheck` and `npm run build`, tails in the PR. `npm run test:sql` is not needed: no SQL changed, and the
seed's test (`supabase/functions/_shared/seed.test.ts`) recomputes from the instance and runs in `test:engine`.

## Review focus

- **The sheet's promise.** "Half of that loss is given back" must hold for every class loss a reaction causes: read
  each class's `earn` and confirm each such earning carries `votes` (the engine plan's Task 6), and that no other loss
  is implied.
- **It names no class.** Every class has a loss from some reaction; confirm no word here points at one.
- **The log never lies.** The play's log line and the sheet state the size from the card's rules; a settled line
  states the size it was paid at (the engine plan). Confirm the two agree for this card and that no sentence promises
  pay the settlement does not give (a reaction by the holder's own player pays nothing, as for every card).
- **One player, two masks.** Nothing in a refusal or an answer differs with who owns anything; confirm no test or word
  added here distinguishes it.
- **The slot.** Confirm this PR's lines in the sorted places (`cards/index.ts` twice, `ui/cards.ts` twice,
  `cards.test.ts` once) sit at the card's place.
- **The words** are drafts the owner reads in the PR.
