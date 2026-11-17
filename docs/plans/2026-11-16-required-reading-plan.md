# Required Reading, a common Gimmick that pays a vote for each calm positive reaction to a post: plan

Record, written 2026-11-16. Carries out Required Reading's row of `docs/plans/2026-11-16-settlement-design.md`
(section 4), from `docs/plans/2026-11-15-base-set-card-numbers-design.md` (section 3.1). One PR from `main`.

**May start** after `docs/plans/2026-11-16-settlement-engine-plan.md` merges, beside the other Wave 2 cards. It starts
after Steel Chair's build has merged if that is still open, and SoVeryHappy and Ratio wait for this one: the keys
share a slot of the sorted lists (`docs/plans/2026-11-14-base-set-design.md`, section 2).

Every task goes test first: write the failing test, record its red run, then the code. During a task, run only the
tests for the changed code (`npx vitest run <file>`, or `node --experimental-strip-types --test <file>` for the rules'
tests). Run `npm run typecheck` and `npm run build` once after the last task, with the tail in the PR. No deployed
database, bucket or connector is touched.

**The layers.** Everything here is Divided World's, carried in through `CardRules` and `CardUi`. **This build edits no
file under `engine/` and adds no migration.** The card reaches the database through the instance's seed
(`supabase/functions/_shared/seed.ts`), which sends `gimmick` whole. If a task cannot be done without an engine or SQL
change, stop and ask the owner.

**The world.** The card draws nothing of its own on a post. Its face and its sheet are the glass, in the words below;
its status line shows where the play is up, as Toll's does.

**What already works, so it is not built here** (read, not changed): the engine's flat Earn and its settlement
(`engine/rules/settle.ts`), its catalog check and `settlement_input` (the engine plan's migration), the stack of one
that refuses a second live play (`landsOn`), and that a use card is played on the holder's own post (the engine's).

**The card's place in the lists.** Key `required-reading`, between `publicity-tour` and `rope-break` in every sorted
list.

## Task 1. The rules

Model: haiku

**Files:** a new `instances/divided-world/cards/required-reading.ts`, a new
`instances/divided-world/cards/required-reading.test.ts`, `instances/divided-world/cards/index.ts` (one import line
and one list line, each at the card's place), `instances/divided-world/cards/cards.test.ts` (one line in the list of
`'the instance sells its cards at their prices'`, at the same place: `['required-reading', 'sweet', 100],`).

`required-reading.ts`, whole:

```ts
/**
 * Required Reading (Sweet, common, Gimmick on the player's own post): for a week, each calm positive reaction to the post pays its author a
 * vote more, to any class, then it ends by itself (docs/plans/2026-11-16-settlement-design.md, section 4). Only reactions after it is played
 * count. The settlement's is the pay and the largest-applies rule (a Hype-Up on the same post pays the same vote once, not twice); the
 * engine's is the week, the one-live-per-post stack and that the post is the player's own.
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';
import type { Hundredths } from '../../../engine/rules/types.ts';

export const requiredReading: CardRules<Record<string, never>> = {
  key: 'required-reading',
  name: 'Required Reading',
  alignment: 'sweet',
  rarity: 'common',
  play: 'use',
  gimmick: { kind: 'earn', quadrants: ['calmPositive'], flat: 1 },
  lasts: { unit: 'week', count: 1 },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(requiredReading, target, effects, now),
  validateConfig: () => ok({}),
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 100;
```

In `index.ts`: `import { requiredReading, price as requiredReadingPrice } from './required-reading.ts';` and
`[requiredReading as CardRules, requiredReadingPrice],`.

Tests, red first, in `required-reading.test.ts` (model: `toll.test.ts`; helpers from `test-kit.ts`):

- its facts: key, name, alignment `sweet`, rarity `common`, `play` `use`, the gimmick and `lasts` deep-equal to those
  above, and the machine sells it for 100;
- `decideUse` on `post(10)` is ok with price 0; `decidePlay` is refused (a Gimmick is not cast); with a live play of
  the same card on the target, `decideUse` is refused;
- `instanceProblems(instance)` is empty with the card in the pool.

## Task 2. What it pays, settled with the real instance

Model: sonnet

**Files:** `instances/divided-world/cards/required-reading.test.ts`.

Model: the settlement test the engine plan added beside the earn cards' facts in `cards.test.ts` (Heat Magnet on a
Technician): build a `SettlementInput` by hand and call `settle(input, instance)`. A vote is 10 hundredths. Red first:
write them before Task 1's card is in the list.

- a Technician's post under Required Reading with one calm positive vote from another player after the play:
  `technician.respected` 10 and a `card.boost` of 10 with params `{ card: 'required-reading', flat: 1 }`;
- a Heel's post with the same vote: `heel.shrugged` -10 and the same boost of 10;
- a hype vote, a vote before the play, and a calm vote from a player who first reacted before the play: no boost;
- a calm vote on another post of the same character: no boost;
- Required Reading and Hype-Up both up on the post, one calm vote: one boost of 10, the earlier play's card; one hype
  vote: Hype-Up's alone.

## Task 3. The face and the sheet

Model: sonnet

**Files:** a new `instances/divided-world/ui/cards/required-reading/ui.ts` (the folder holds `art.webp`, `mark.svg`,
`art.json` and `scene.py` already; none changes), `instances/divided-world/ui/cards.ts` (one import line and one list
line, at the card's place), `instances/divided-world/ui/index.test.tsx`.

`ui.ts` follows `ui/cards/toll/ui.ts`. Every size and span in a sentence is read from `requiredReading` (`shareWords`,
`spanWords`, and `LARGEST` from `ui/cards/words.ts` where the sentence is that one), never restated as a literal. Its
entry, exactly:

- `key: 'required-reading'`
- `art: { color: '#2ee6ff', ink: '#03141a', canvas, mark, credit: <art.json's credit>, tagline: 'Earn more from calm
  praise on a post.' }`
- `summary`: "Used on your post. For a week, each calm positive reaction to it pays a vote more."
- `status: 'Paid more for calm positive reactions'`
- `describe: (settings) =>` "A Sweet card, common, used on one of your own posts. For a week, each calm positive
  reaction to that post pays its author a vote more, whatever their class makes of it, and then it stops by itself.
  Only reactions after it is played count, and a post carries one at a time. Where two cards pay on the same reaction,
  only the larger pays. It costs nothing more to use."
- `logPlay: () =>` "Each calm positive reaction to that post pays a vote more until it ends."
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

- **A common on the machine.** It is on sale in the machine computed from the pool
  (`instances/divided-world/machine.ts`); the e2e boards read a fixed key list (the Wave 1 prep plan), so none should
  change. Confirm, and confirm no test counts the pool's cards by a literal this build missed.
- **The Mod Bots.** The staff pool offers casts and sets only (`cardsOnOffer`, `supabase/functions/chatter/core.ts`),
  so a common Gimmick is not offered; confirm the chatter tests pass unchanged.
- **Beside Hype-Up.** Both pay a whole vote on calm, so together they pay calm once; confirm the sheet's sentence says
  so.
- **The log never lies.** The play's log line and the sheet state the size from the card's rules; a settled line
  states the size it was paid at (the engine plan). Confirm the two agree for this card and that no sentence promises
  pay the settlement does not give (a reaction by the holder's own player pays nothing, as for every card).
- **One player, two masks.** Nothing in a refusal or an answer differs with who owns anything; confirm no test or word
  added here distinguishes it.
- **The slot.** Confirm this PR's lines in the sorted places (`cards/index.ts` twice, `ui/cards.ts` twice,
  `cards.test.ts` once) sit at the card's place.
- **The words** are drafts the owner reads in the PR.
