# Rope Break, a common Reversal that catches a Salty common: plan

Record, written 2026-11-15. Carries out section 2.1 of `docs/plans/2026-11-15-wave-1-cards-design.md`. One PR from
`main`.

**May start** after `docs/plans/2026-11-15-wave-1-prep-plan.md` merges, beside Hot Box
(`docs/plans/2026-11-15-hot-box-plan.md`). Steel Chair waits for this one: the two keys share a slot of the sorted
lists (`docs/plans/2026-11-14-base-set-design.md`, section 2).

Every task goes test first: write the failing test, record its red run, then the code. During a task, run only the
tests for the changed code (`npx vitest run <file>`, or `node --experimental-strip-types --test <file>` for the
rules' tests). Run `npm run typecheck` and `npm run build` once after the last task, with the tail in the PR. No
deployed database, bucket or connector is touched.

**The layers.** Everything here is Divided World's, carried in through `CardRules` and `CardUi`. **This build edits
no file under `engine/` and adds no migration.** The card reaches the database through the instance's seed
(`supabase/functions/_shared/seed.ts`, `instanceSeed`, which sends `trap` whole, its match included). If a task
cannot be done without an engine or SQL change, stop and ask the owner.

**The world.** A card set face down is the board's own card back, the same for every card; Rope Break draws nothing
of its own on a post. Its face and its sheet are the glass, in the words below.

**What already works, so it is not built here** (read, not changed): `decideSet` accepts a set card with a `match`
(`engine/rules/cards.ts`); `place_set` and `spring_facts` store and apply it
(`supabase/migrations/0316_card_notes_part_4.sql`, `0357_post_veils.sql`), tested in
`supabase/tests/0152-reversal-matches.sql`; the fake mirrors it (`engine/ui/data/fake.ts`, the `matched` line in
`playCard`); and after the prep plan the set form, the log and the alerts say a match truly.

**The card's place in the lists.** Key `rope-break`, between `publicity-tour` and `stick-around` in every sorted
list.

## Task 1. The rules

Model: haiku

**Files:** a new `instances/divided-world/cards/rope-break.ts`, a new
`instances/divided-world/cards/rope-break.test.ts`, `instances/divided-world/cards/index.ts` (one import line and one
list line, each between `publicity-tour`'s and `stick-around`'s), `instances/divided-world/cards/cards.test.ts` (one
line in the list of `'the instance sells its cards at their prices'`, at the same place:
`['rope-break', 'sweet', 100],`).

`rope-break.ts`, whole:

```ts
/**
 * Rope Break (Sweet, common, Set): set face down on one of the player's own posts, it springs on the first Salty common card cast
 * there and catches it: the cast does nothing, and its card goes to the setter's hand (docs/plans/2026-11-15-wave-1-cards-design.md,
 * section 2.1). It names no card: it matches by flavor and rarity (`trap.match`), the first card here that does. A ward on the post
 * is asked before the back, and a Move that lands from a quote is no cast, so neither meets it. A card back shows on the post like
 * any other, so a reader cannot tell it from a Hall Pass or a Move.
 */
import { ok, type CardRules } from '../../../engine/rules/cards.ts';
import type { Hundredths } from '../../../engine/rules/types.ts';

export const ropeBreak: CardRules<Record<string, never>> = {
  key: 'rope-break',
  name: 'Rope Break',
  alignment: 'sweet',
  rarity: 'common',
  play: 'set',
  trap: { trigger: { on: 'cast' }, match: { flavors: ['salty'], upTo: 'common' } },
  playPrice: () => 0,
  canApply: () => ok(undefined),
  validateConfig: () => ok({}),
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 100;
```

In `index.ts`: `import { ropeBreak, price as ropeBreakPrice } from './rope-break.ts';` and
`[ropeBreak as CardRules, ropeBreakPrice],`.

Tests, red first, in `rope-break.test.ts` (model: `below-the-fold.test.ts`; helpers from `test-kit.ts`; `settings`
and `instance` as `cards.test.ts` imports them):

- its facts: key, name, alignment `sweet`, rarity `common`, `play` `set`, the trap deep-equal to the one above,
  no `catches`, no `lasts`, and the machine sells it for 100 (`instance.machine`'s slot for the key);
- `decideSet(ropeBreak, settings, post(10), [], {}, cards)` is ok with price 0 and no `catches`; with `undefined`
  for the configuration it is ok too (the set form starts with none);
- a second card face down on the post is refused in the engine's words (`'this post already holds a card face
  down'`), given an effect `{ card: null, act: 's1', faceDown: true }`;
- it is not cast: `decidePlay(ropeBreak, …)` is refused with `'Rope Break is set face down on your own post'`;
- `instanceProblems(instance)` is empty with the card in the pool;
- `staffConfigOf(ropeBreak, () => 0)` is `{}`: the staff pool is offered it with no options.

## Task 2. The picture, in Sweet's colors

Model: sonnet

**Files:** `instances/divided-world/ui/cards/rope-break/scene.py`, `art.webp`, `mark.svg` (and `art.json` unchanged).

The picture PR #688 added is pink and magenta, Salty's family; the card is Sweet, whose faces are cyan. The owner
chose to render it again.

- In `scene.py`, move the colors to the cyan family and change nothing else (the hand, the tape, the rope, the
  camera, the lights' places): the backdrop's four stops `#14030c`, `#6a1440`, `#e86fa8`, `#2a0618` become
  `#03141a`, `#0b4f63`, `#7fe3f2`, `#062a36`; the mat `#b8457c` becomes `#2a9fb8`; the wristband becomes `#2ee6ff`;
  any light or sparkle tinted pink takes the matching cyan. Update the docstring only if it names a color.
- Render it as `instances/divided-world/ui/cards/README.md` says ("The cards' own pictures are 3D scenes"): Blender's
  Python module in a virtual environment outside the repository's tracked files, `python scene.py art.webp` from the
  card's folder. A render takes three to eight minutes: run it in the background. Draft first at
  `ART_SCALE=1 ART_SAMPLES=40` under another name, look at it, and do not commit the draft.
- In `mark.svg`, the wristband's `#ff4f9a` becomes `#2ee6ff`; nothing else.
- `node tools/check-card-art.mjs` passes (1080 by 1680, at most 400 KB, a square mark).
- Put the old and the new picture side by side in the PR's description for the owner, who approves art in review.

If the Python module cannot be installed where the build runs, stop and say so in the PR; do not commit a scene
whose picture was not rendered from it.

No test: `tools/check-card-art.mjs` is the guard, and it is already driven red by its own self-test.

## Task 3. The face and the sheet

Model: sonnet

**Files:** a new `instances/divided-world/ui/cards/rope-break/ui.ts`, `instances/divided-world/ui/cards.ts` (one
import line and one list line, between `publicity-tour`'s and `stick-around`'s),
`instances/divided-world/ui/index.test.tsx`.

`ui.ts` follows `ui/cards/hall-pass/ui.ts` (a Sweet set card with no form). Its entry, exactly:

- `key: 'rope-break'`
- `art: { color: '#2ee6ff', ink: '#03141a', canvas, mark, credit: ropeBreakArt.credit, tagline: 'Reach the ropes.' }`
- `summary: 'Set face down on your post. Catches the first Salty common cast there, and takes it into your hand.'`
- `status: 'Set, face down to everyone else'`, with Hall Pass's comment: the same words as every Reversal, so none
  can be told from another.
- `describe: (settings) =>` "A Sweet card, common, set face down on one of your own posts. Everyone sees a card back
  there, the same as any card set face down. The first Salty common card cast on that post is caught: it lands as
  caught and does nothing, and you take it into your hand. Any other card passes over it, and a card your post's ward
  turns away never reaches it. It springs once, or ends by itself after `${setLastsWords(settings)}`. It costs
  nothing more to set." The rarity and the flavor in that text are read from `ropeBreak` (`ropeBreak.rarity`,
  `ropeBreak.trap.match`), never restated as literals; `setLastsWords` is `ui/cards/words.ts`'s.
- No `Effect`, no `ConfigForm`, no `hint`.

Tests, red first, in `ui/index.test.tsx`, beside the Reversals' assertions (search for `'Set, face down to everyone
else'`):

- Rope Break's `status` is that string and equals Card Collector's;
- its `art.color` is `#2ee6ff` and its `ink` `#03141a`, its tagline and summary are the strings above, and it has no
  `Effect` and no `ConfigForm`;
- `describe(instance.settings)` is the text above with "7 days" (today's `setLasts`), and it does not contain the
  word "names";
- the file's rules over every card (art, key order, `instanceUiProblems` empty) pass with the card in.

## Task 4. A catch, end to end on the fake

Model: sonnet

**Files:** a new `instances/divided-world/ui/cards/rope-break/ui.test.tsx`.

One test file against the fake with the real instance (`createFake({ instance, … })`; seed the two players, the post
and the hands the way `engine/ui/data/fake.test.tsx`'s match test does, near its `match: { flavors: ['salty'] }`
card). Red first: write them before Task 1's card is in the list, see them fail on "no such card", then run them
green.

- A sets Rope Break on A's post; B casts Whoops! (Salty, common) on it: the answer's play carries `caught`, A's hand
  holds one Whoops!, B's hand holds none, and the post's live effects hold no Whoops! layer.
- The back is spent: a second Whoops! by B on the same post lands.
- B casts THIS (Pepperoni, common) on a post with a fresh Rope Break: it lands, and the back is still there.
- B casts Mooch (Salty, uncommon) on a post with a fresh Rope Break: it lands, and the back is still there. If Mooch
  is not cast on a post, use any Salty card above common that is, found from `instance.cards`.
- The set form's sentence for the card (`springWords(ropeBreak)`, `engine/ui/cards/land.ts`) is "Waits for a Salty
  card, up to common, to be cast on this post, and takes it." This holds the prep plan's words to this card.

## Task 5. The build

Model: inline

`npm run typecheck` and `npm run build`, tails in the PR. `npm run test:sql` is not needed: no SQL changed, and the
seed's test (`supabase/functions/_shared/seed.test.ts`) recomputes from the instance and runs in `test:engine`.

## Review focus

- **The first card with a match in a deployed seed.** `card_kinds_problem` does not check a match
  (`0148_card_types.sql`: "The match of a trap … checked by instanceProblems alone"); confirm
  `instanceProblems(instance)` is empty and that the seed's payload for the card carries
  `trap.match` (`instanceSeed`).
- **The Mod Bots set it.** `settings.pool.cardRarityMost` is `common`, so this is the first Reversal the pool offers
  (`supabase/functions/chatter/core.ts`, the offer filter). A staff setter keeps no card ("is spent"). Confirm the
  chatter tests pass unchanged and read what a persona is told about a set card.
- **A caster pays in full for a caught cast**, Whoops!'s surcharge included (`play_card`, `0348_post_under.sql`).
  That is the engine's rule and the log says it; confirm the card's sheet does not promise otherwise.
- **One player, two masks.** A cast by another mask of the setter's player is caught like any other, and nothing in
  the answer differs with who owns the caster ("A response never proves a private fact"). Confirm no test or word
  added here distinguishes it.
- **The picture and its scene.** The committed `art.webp` must be the render of the committed `scene.py`; nothing in
  the build can check that, so the reviewer reads the PR's account of the render.
- **The slot.** Steel Chair's build starts from main after this merges; confirm this PR's lines in the four sorted
  places (`cards/index.ts` twice, `ui/cards.ts` twice, `cards.test.ts` once) sit between `publicity-tour` and
  `stick-around`.
