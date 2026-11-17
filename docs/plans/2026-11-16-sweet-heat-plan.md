# Sweet Heat, a Gimmick that pays half a vote for each excited reaction: plan

Record, written 2026-11-16. Carries out Sweet Heat's row of `docs/plans/2026-11-16-settlement-design.md` (section 4),
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

**What already works, so it is not built here** (read, not changed): the engine's flat Earn and its settlement
(`engine/rules/settle.ts`), its catalog check and `settlement_input` (the engine plan's migration), the stack of one
that refuses a second live play (`landsOn`), and that a use card is played on the holder's own character (the
engine's).

**The card's place in the lists.** Key `sweet-heat`, between `super-happy-heart` and `take-the-fall` in every sorted
list.

## Task 1. The rules

Model: haiku

**Files:** a new `instances/divided-world/cards/sweet-heat.ts`, a new
`instances/divided-world/cards/sweet-heat.test.ts`, `instances/divided-world/cards/index.ts` (one import line and one
list line, each at the card's place), `instances/divided-world/cards/cards.test.ts` (one line in the list of `'the
instance sells its cards at their prices'`, at the same place: `['sweet-heat', 'pepperoni', 150],`).

`sweet-heat.ts`, whole:

```ts
/**
 * Sweet Heat (Pepperoni, uncommon, Gimmick on a character): for 3 days, each excited reaction to the character's posts, positive (hype) or
 * negative (heat), pays half a vote more, to any class, then it ends by itself (docs/plans/2026-11-16-settlement-design.md, section 4). The
 * settlement's is the pay, the largest-applies rule and the own-player rule; this file names only the effect and its size. It is uncommon, as a
 * card that reaches a character is here (`reachRarity`, ../settings.ts).
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';
import type { Hundredths } from '../../../engine/rules/types.ts';

export const sweetHeat: CardRules<Record<string, never>> = {
  key: 'sweet-heat',
  name: 'Sweet Heat',
  alignment: 'pepperoni',
  rarity: 'uncommon',
  play: 'use',
  reaches: ['character'],
  gimmick: { kind: 'earn', quadrants: ['excitedPositive', 'excitedNegative'], flat: 0.5 },
  lasts: { unit: 'day', count: 3 },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(sweetHeat, target, effects, now),
  validateConfig: () => ok({}),
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 150;
```

In `index.ts`: `import { sweetHeat, price as sweetHeatPrice } from './sweet-heat.ts';` and `[sweetHeat as CardRules,
sweetHeatPrice],`.

Tests, red first, in `sweet-heat.test.ts` (model: `toll.test.ts`; helpers from `test-kit.ts`):

- its facts: key, name, alignment `pepperoni`, rarity `uncommon`, `play` `use`, the gimmick and `lasts` deep-equal to
  those above, and the machine sells it for 150;
- `decideUse` on a character target, built as `cards.test.ts` builds one for Heat Magnet, is ok with price 0;
  `decidePlay` is refused (a Gimmick is not cast); with a live play of the same card on the target, `decideUse` is
  refused;
- `instanceProblems(instance)` is empty with the card in the pool.

## Task 2. What it pays, settled with the real instance

Model: sonnet

**Files:** `instances/divided-world/cards/sweet-heat.test.ts`.

Model: the settlement test the engine plan added beside the earn cards' facts in `cards.test.ts` (Heat Magnet on a
Technician): build a `SettlementInput` by hand and call `settle(input, instance)`. A vote is 10 hundredths. Red first:
write them before Task 1's card is in the list.

- a Face under Sweet Heat with one hype vote from another player on a post: `face.cheered` 10 and a `card.boost` of 5
  with params `{ card: 'sweet-heat', flat: 0.5 }`;
- a Technician with one heat vote: `technician.draggedIn` -10 and the same boost of 5;
- a Tweener with one hype and one heat vote from two players on one post: its split as today, and a boost of 10;
- a calm vote, a vote on a card the character played, and a vote before the play: no boost;
- Heat Magnet and Sweet Heat both up on one heat vote: one boost, Heat Magnet's (the larger), of 8 (7.5, rounded).

## Task 3. The face and the sheet

Model: sonnet

**Files:** a new `instances/divided-world/ui/cards/sweet-heat/ui.ts` (the folder holds `art.webp`, `mark.svg`,
`art.json` and `scene.py` already; none changes), `instances/divided-world/ui/cards.ts` (one import line and one list
line, at the card's place), `instances/divided-world/ui/index.test.tsx`.

`ui.ts` follows `ui/cards/heat-magnet/ui.ts`. Every size and span in a sentence is read from `sweetHeat`
(`shareWords`, `spanWords`, and `LARGEST` from `ui/cards/words.ts` where the sentence is that one), never restated as
a literal. Its entry, exactly:

- `key: 'sweet-heat'`
- `art: { color: '#d24a2c', ink: '#0d0301', canvas, mark, credit: <art.json's credit>, tagline: 'Earn more from
  excited reactions.' }`
- `summary`: "Used on your own character. For 3 days, each excited reaction to its posts, positive or negative, pays
  half a vote more."
- `status: 'Paid more for excited reactions'`
- `describe: (settings) =>` "A Pepperoni card, uncommon, used on your own character, the one playing it. For 3 days,
  each excited reaction to its posts, positive or negative, pays half a vote more, whatever its class makes of that
  reaction, and then it stops by itself. It counts reactions from players who first react to a post while it is up.
  Where two cards pay on the same reaction, only the larger pays. It costs nothing more to use."
- `logPlay: () =>` "Each excited reaction to that character's posts, positive or negative, pays half a vote more until
  it ends."
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

- **The Tweener.** This is the card's reason: confirm the boost reaches a character whose class earning for the vote
  carries no quadrant.
- **Beside Heat Magnet.** On heat the larger pays, so the pair is worth less than their sum; confirm the sheet's last
  sentence says so and no word promises both.
- **The log never lies.** The play's log line and the sheet state the size from the card's rules; a settled line
  states the size it was paid at (the engine plan). Confirm the two agree for this card and that no sentence promises
  pay the settlement does not give (a reaction by the holder's own player pays nothing, as for every card).
- **One player, two masks.** Nothing in a refusal or an answer differs with who owns anything; confirm no test or word
  added here distinguishes it.
- **The slot.** Confirm this PR's lines in the sorted places (`cards/index.ts` twice, `ui/cards.ts` twice,
  `cards.test.ts` once) sit at the card's place.
- **The words** are drafts the owner reads in the PR.
