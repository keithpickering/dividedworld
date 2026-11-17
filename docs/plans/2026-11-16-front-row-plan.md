# Front Row, a Gimmick that pays half a vote for each reaction to a card the character plays: plan

Record, written 2026-11-16. Carries out Front Row's row of `docs/plans/2026-11-16-settlement-design.md` (section 4),
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

**The card's place in the lists.** Key `front-row`, between `force-field` and `glitter-bomb` in every sorted list.

## Task 1. The rules

Model: haiku

**Files:** a new `instances/divided-world/cards/front-row.ts`, a new
`instances/divided-world/cards/front-row.test.ts`, `instances/divided-world/cards/index.ts` (one import line and one
list line, each at the card's place), `instances/divided-world/cards/cards.test.ts` (one line in the list of `'the
instance sells its cards at their prices'`, at the same place: `['front-row', 'pepperoni', 150],`).

`front-row.ts`, whole:

```ts
/**
 * Front Row (Pepperoni, uncommon, Gimmick on a character): for 3 days, each reaction, in any quadrant, to a card the character plays pays half
 * a vote more, to any class, then it ends by itself (docs/plans/2026-11-16-settlement-design.md, section 4). A card it plays is its card Act, or
 * the spring of a Reversal it set (`acts`); its posts are not. The settlement's is the pay; this file names only the effect and its size.
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';
import type { Hundredths } from '../../../engine/rules/types.ts';

export const frontRow: CardRules<Record<string, never>> = {
  key: 'front-row',
  name: 'Front Row',
  alignment: 'pepperoni',
  rarity: 'uncommon',
  play: 'use',
  reaches: ['character'],
  gimmick: { kind: 'earn', quadrants: ['excitedPositive', 'excitedNegative', 'calmPositive', 'boredNegative'], flat: 0.5, acts: ['card', 'spring'] },
  lasts: { unit: 'day', count: 3 },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(frontRow, target, effects, now),
  validateConfig: () => ok({}),
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 150;
```

In `index.ts`: `import { frontRow, price as frontRowPrice } from './front-row.ts';` and `[frontRow as CardRules,
frontRowPrice],`.

Tests, red first, in `front-row.test.ts` (model: `toll.test.ts`; helpers from `test-kit.ts`):

- its facts: key, name, alignment `pepperoni`, rarity `uncommon`, `play` `use`, the gimmick and `lasts` deep-equal to
  those above, and the machine sells it for 150;
- `decideUse` on a character target, built as `cards.test.ts` builds one for Heat Magnet, is ok with price 0;
  `decidePlay` is refused (a Gimmick is not cast); with a live play of the same card on the target, `decideUse` is
  refused;
- `instanceProblems(instance)` is empty with the card in the pool.

## Task 2. What it pays, settled with the real instance

Model: sonnet

**Files:** `instances/divided-world/cards/front-row.test.ts`.

Model: the settlement test the engine plan added beside the earn cards' facts in `cards.test.ts` (Heat Magnet on a
Technician): build a `SettlementInput` by hand and call `settle(input, instance)`. A vote is 10 hundredths. Red first:
write them before Task 1's card is in the list.

- a Lurker under Front Row with one vote on a card it cast: `lurker.cardDrew` as today and a `card.boost` of 5 with
  params `{ card: 'front-row', flat: 0.5 }`;
- a Face with one groan on a card it cast: the same boost of 5, whatever the class makes of the vote;
- a vote on the spring Act of a Reversal the character set: a boost of 5;
- a vote on the character's post, and a vote on the card before Front Row was played: no boost;
- Front Row and Sweet Heat both up (give the test a Sweet Heat of its own if that card has not merged: a copy of this
  card's rules with Sweet Heat's gimmick), a hype vote on a post and one on a card: the post's is paid by the one, the
  card's by the other, and neither vote twice.

## Task 3. The face and the sheet

Model: sonnet

**Files:** a new `instances/divided-world/ui/cards/front-row/ui.ts` (the folder holds `art.webp`, `mark.svg`,
`art.json` and `scene.py` already; none changes), `instances/divided-world/ui/cards.ts` (one import line and one list
line, at the card's place), `instances/divided-world/ui/index.test.tsx`.

`ui.ts` follows `ui/cards/heat-magnet/ui.ts`. Every size and span in a sentence is read from `frontRow` (`shareWords`,
`spanWords`, and `LARGEST` from `ui/cards/words.ts` where the sentence is that one), never restated as a literal. Its
entry, exactly:

- `key: 'front-row'`
- `art: { color: '#d24a2c', ink: '#0d0301', canvas, mark, credit: <art.json's credit>, tagline: 'Earn more from your
  cards\' reactions.' }`
- `summary`: "Used on your own character. For 3 days, each reaction to a card it plays pays half a vote more."
- `status: 'Paid more for reactions to its cards'`
- `describe: (settings) =>` "A Pepperoni card, uncommon, used on your own character, the one playing it. For 3 days,
  each reaction to a card that character plays, whatever the reaction, pays half a vote more, and then it stops by
  itself. A card it plays is a Move it casts, a Gimmick it uses, or a Reversal of its own when it springs. Reactions
  to its posts are not counted. It counts reactions from players who first react to the card while it is up. It costs
  nothing more to use."
- `logPlay: () =>` "Each reaction to a card that character plays pays half a vote more until it ends."
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

- **What a card Act is.** Confirm against `settlement_input` which of a character's Acts arrive as `card` and
  `spring`, that a play on a character (Front Row itself) is one, and that the sheet's list of them is true.
- **The Lurker.** Its `lurker.cardDrew` already pays per vote on its cards; confirm the two lines read clearly side by
  side in the log.
- **The log never lies.** The play's log line and the sheet state the size from the card's rules; a settled line
  states the size it was paid at (the engine plan). Confirm the two agree for this card and that no sentence promises
  pay the settlement does not give (a reaction by the holder's own player pays nothing, as for every card).
- **One player, two masks.** Nothing in a refusal or an answer differs with who owns anything; confirm no test or word
  added here distinguishes it.
- **The slot.** Confirm this PR's lines in the sorted places (`cards/index.ts` twice, `ui/cards.ts` twice,
  `cards.test.ts` once) sit at the card's place.
- **The words** are drafts the owner reads in the PR.
