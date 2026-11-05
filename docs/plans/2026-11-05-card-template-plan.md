# The card template: plan

Record, written 2026-11-05. The plan for `docs/plans/2026-11-05-card-template-design.md`. One build session builds it in
one PR from `main`. The look is the board `docs/research/2026-11-05-card-template/01-layouts.html`, which the owner
confirmed on 2026-11-05: a card face matches it, and where the board and the design disagree, the design wins on what is
decided and the board on how it looks. The board's two full-art pieces are the model for Task 3.

Every task is test first: name the test, record its red run, then write the code. One `check-*.mjs` is added (Task 2),
with its self-test and poisons. No migration and no SQL.

## The shapes, exactly

```ts
// engine/ui/cards/template.ts
export const TEMPLATE = {
  card: { w: 600, h: 900 },
  border: 30,
  outerRadius: 45,                              // border + canvas.r: the border is 30 thick all the way round
  canvas: { x: 30, y: 30, w: 540, h: 840, r: 15 },
  keepClear: 12,                                // no piece is drawn outside this line, 12 units in from the outer edge
  focus: { x: 70, y: 100, w: 460, h: 400 },     // card units; an optional guide, never a mask
  plateTop: 600,                                // card units; the plate zone runs from here to the canvas's bottom
} as const;

export type PostcardSize = 'slot' | 'phone' | 'fan' | 'sheet';
export const SIZES: Readonly<Record<PostcardSize, number>> = { slot: 86, phone: 104, fan: 150, sheet: 276 }; // widths in px; height is 1.5×
```

```ts
// engine/ui/cards/types.ts: CardArt, as the instance gives it (every field required but tagline)
export interface CardArt {
  readonly color: string;
  readonly ink: string;
  /** The card's art: an SVG on the 540 by 840 canvas (TEMPLATE.canvas), a URL the bundler resolved. */
  readonly canvas: string;
  /** The mark: a square SVG drawn to read at 18px, a URL the bundler resolved. */
  readonly mark: string;
  /** Who made the art, from its manifest, said on the sheet's foot line: "Art · <credit>". */
  readonly credit: string;
  readonly tagline?: string;
}

// engine/ui/cards/faces.ts: the art a face carries, which a card with no CardUi has only the color and ink of
export type FaceArt = Pick<CardArt, 'color' | 'ink'> & Partial<Pick<CardArt, 'canvas' | 'mark' | 'credit' | 'tagline'>>;
```

```json
// instances/divided-world/ui/cards/<key>/art.json
{ "credit": "Divided World", "license": "The project's own art. The owner gives its license when the repository has one." }
```

## Task 1. The template module and the artist's template file (engine)

Model: sonnet

**Files:** `engine/ui/cards/template.ts` (new), `engine/ui/cards/template.test.tsx` (new, a `.tsx` so Vitest runs it),
`engine/ui/cards/card-template.svg` (written by the test's file snapshot).

- **`TEMPLATE` and `SIZES`** as in the shapes above. `PostcardSize` moves here from `Postcard.tsx`, which re-exports it.
- **`templateVars(size)`** returns the custom properties the card face draws from: `--kb-pc-w` (the size's width in px)
  and each length as a fraction of it (`--kb-pc-border`, `--kb-pc-radius`, `--kb-pc-canvas-radius`, `--kb-pc-keep`),
  each written as `calc(var(--kb-pc-w) * <fraction>)`. Never `cqw` on the card itself: on the card's own box a container
  unit measures the nearest container above it, the page, which is the board's first corner bug.
- **`templateSvg()`** returns the artist's template as a string: a 600 by 900 SVG with two layers, `art` (empty, its
  `<g>` holding a 540 by 840 transparent rect at 30, 30 to show the canvas) and `guides` (locked with
  `sodipodi:insensitive="true"`, which Inkscape honors, and named "Guides, locked"), drawing the frame's outline at radius
  45, the canvas at radius 15, the keep-clear line, the focus zone dashed, and the plate zone hatched, each labeled. It
  draws no card's color: guides are one neutral green, as the board's are.

**Tests first** (`template.test.tsx`):
- Every size is 2:3 in whole pixels: `SIZES[s] * 1.5` is an integer for each size.
- `outerRadius === border + canvas.r`; `keepClear < border`; the canvas is the card less the border on every side; the
  focus zone lies inside the canvas; `plateTop` lies inside the canvas.
- `templateVars('slot')['--kb-pc-w']` is `86px`, and no value holds `cqw`.
- `templateSvg()` has viewBox `0 0 600 900`, a `guides` layer marked insensitive, and an `art` layer; it matches the file
  `card-template.svg` (`expect(templateSvg()).toMatchFileSnapshot('./card-template.svg')`), so a change to the module
  that leaves the committed file stale fails, and `vitest -u` writes it.

## Task 2. The art guard (tools)

Model: sonnet

**Files:** `tools/check-card-art.mjs` (new), `tools/test-card-art.mjs` (new), `tools/build.mjs` (`STEPS`: the test's
line, then the check's, after `node tools/check-glass-contrast.mjs`).

The check reads every `instances/*/ui/cards/*/` folder (it names no instance) and reports each fault with its file and
the rule it broke, exiting 1 on any. Its function, `cardArtFaults(root)`, is exported for the test, as `iconFaults` is in
`tools/check-icons.mjs`. The rules:

1. A folder holds `art.svg`, `mark.svg` and `art.json`.
2. `art.svg`'s root `svg` has `viewBox="0 0 540 840"` exactly (four numbers, any whitespace).
3. `mark.svg`'s viewBox is square.
4. `art.json` parses, and its `credit` and `license` are non-empty strings.
5. Size caps: `art.svg` at most 200 KB, `mark.svg` at most 20 KB, `art.json` at most 2 KB.
6. Nothing in either SVG runs or reaches out, read case-insensitively over the whole file: no `<script`, no
   `<foreignObject`, no `<image` (the required set is vector), no attribute whose name starts `on`, no `@import`, and
   every `href`, `xlink:href` and `url(` value starts with `#`.

**Tests first** (`test-card-art.mjs`): it writes repository-shaped scratch folders in `os.tmpdir()` (an instance with a
`ui/cards/<key>/` folder), as `tools/test-icons.mjs` does, and runs the check over each through its function and through
the command, whose exit code is what the build reads. A clean folder passes. Each poison fails, naming its rule:
- `mark.svg` missing; `art.json` missing.
- a canvas at `0 0 120 110`; a canvas with no viewBox.
- a mark at `0 0 120 110`.
- a manifest with `"credit": ""`; one with no `license`; one that is not JSON.
- a canvas of 201 KB.
- a canvas holding `<SCRIPT>`; one holding `<foreignObject>`; one holding `<image href="data:image/png;base64,…">`; one
  with `onload="…"`; one with `<style>@import "x.css";</style>`; one with `fill="url(https://example.com/a#b)"`; one with
  `<use href="https://example.com/a.svg#b"/>`.
- And a fragment `fill="url(#g)"` and `<use href="#p"/>` pass, so the rule is not simply "no url".

The build refuses a check without its test (`tools/test-build-steps.mjs`), so both lines go in together.

## Task 3. Full art for Stick Around, Whoops!, Trap Card, Force Field and Bluff (instance)

Model: sonnet

**Files:** `instances/divided-world/ui/cards/<key>/art.svg`, `mark.svg` and `art.json` for each of `stick-around`,
`whoops`, `trap-card`, `force-field` and `bluff` (new).

Each canvas is a full-art SVG, viewBox `0 0 540 840`, filling the whole canvas in the card's color family, in the spirit of
the board's two (the board's `stickFull()` and `whoopsFull()` in `01-layouts.html` are Stick Around's and Whoops!'s,
lifted as they are). The subject sits around the focus zone (70, 70 to 530, 470 in canvas units, which is the template's
focus zone less the border); the lower third is texture behind the plates, with nothing there a reader has to see. Keep
each file under 200 KB, with no `<image>`, no script and no outside reference (Task 2's rules).

- **Stick Around**, `#2ee6ff`: the board's piece.
- **Whoops!**, `#ff3d7f`: the board's piece.
- **Trap Card**, `#ff3d7f`: a sprung jaw trap or snare, open, under a pink light, the card it caught half inside it.
- **Force Field**, `#2ee6ff`: a hex-cell dome over a post, a card glancing off it in a spray of cyan.
- **Bluff**, `#d24a2c`: a card back held up, the glass's crossed bands on it, and behind it nothing at all, a shrug of
  red smoke. It must not look like the engine's real back (Task 6), or it bluffs the player and not the reader.

Each mark is today's `<key>-mark.svg` drawing set on a square viewBox (its content centered, the box widened to the
larger side), simplified where it does not read at 18px. Each manifest is the shapes' `art.json`. Old files are removed
in Task 5, with their imports.

**Test first:** `node tools/check-card-art.mjs` fails on the five new folders before they are drawn (an empty folder
breaks rule 1), and passes after. Render each card at the fan's and the sheet's size (Task 6 is not built yet, so render
the board's own `card()` with the new canvas, by a scratch copy of the board) and look at each before committing.

## Task 4. Full art for Autocorrect, Glitter Bomb, Main Event and Feelin' Fab (instance)

Model: sonnet

As Task 3, for:

- **Autocorrect**, `#d24a2c`: a strip of masking tape across a line of words, a new word written on the tape in marker.
- **Glitter Bomb**, `#d24a2c`: a burst of glitter out of a split envelope, sparkles to the card's edges.
- **Main Event**, `#2ee6ff`: a spotlight from above on a thread pinned at the top of a board, a championship belt's
  plate catching the light.
- **Feelin' Fab**, `#2ee6ff`: a radial rainbow spreading from the middle, twinkles over it. The rainbow is its own colors;
  the card's cyan is the ring and the twinkles.

## Task 5. `CardArt` in the engine, the art set in the instance (engine, instance)

Model: sonnet

**Files:** `engine/ui/cards/types.ts` (`CardArt`, as in the shapes), `engine/ui/cards/faces.ts` (`FaceArt`, `CardFace.art:
FaceArt`, `PLAIN`), `engine/ui/cards/Marks.tsx` (:98 and :122, `art.mark ?? art.image` becomes `art.mark`),
`engine/ui/cards/PlayActions.tsx` (:60 and :126, the same), `engine/ui/log/Log.test.tsx` (:340, the fixture's art),
`instances/divided-world/ui/cards.ts` (each card's art from its folder: `import stickAroundCanvas from
'./cards/stick-around/art.svg?url'`, its mark, and `credit` from `./cards/stick-around/art.json`), and every other
fixture `tsc` names. The old `instances/divided-world/ui/cards/<key>.svg` and `<key>-mark.svg`, eighteen files, are
deleted.

**Tests first:**
- `engine/ui/cards/faces.test.tsx`: `faceOf` carries a `CardUi`'s `canvas`, `mark` and `credit` onto the face; a card
  with no `CardUi` has a face with the plain color and ink and no canvas, mark or credit.
- `instances/divided-world/ui/index.test.tsx`: every card of the instance's rules has a `CardUi` whose `canvas` and
  `mark` end in `.svg` and whose `credit` is not empty.
- `npm run typecheck` is red while any `CardUi` gives `image` or leaves out `canvas`, `mark` or `credit`.

## Task 6. The card face and the card back in the frame (engine)

Model: sonnet

**Files:** `engine/ui/cards/Postcard.tsx`, `engine/ui/cards/postcard.css`, `engine/ui/cards/postcard.test.tsx` (new),
`engine/ui/cards/Hand.board.stories.tsx` (the sheet's description).

The face is the board's layout A, drawn from `templateVars(size)`:

- **The card**: `width: var(--kb-pc-w)`, `aspect-ratio: 2 / 3`, `border-radius: var(--kb-pc-radius)`, the card's ground
  (`--kb-glass-card`), and the ring and glow in `--kb-card-color` as today. The armed pulse, reduced motion and forced
  colors carry over unchanged.
- **The canvas**: inset by the border, `border-radius: var(--kb-pc-canvas-radius)`, `overflow: hidden`, the only clip.
  Under the art, the ground and a soft radial glow in the card's color; the art is an `<img>` filling the canvas
  (`object-fit: cover`), `alt=""`, aria-hidden; over it, a 1px inner hairline in the card's color at 50%.
- **The pieces**, positioned in `cqw` of the card (they are inside the card, so `cqw` measures it), each inside the
  keep-clear line: the alignment tag and the play word as parallelograms at the top left; the gem on its point at the top
  right, its glyph from `gemOf`; the name inside its skewed plate (the name counter-skewed, centered vertically, padded
  6.5cqw at the left and 0.8cqw at the top); the text plate, chamfered at two corners by `clip-path`, with its 1px edge
  drawn all the way round by a `::before` ring cut from the same outline with `polygon(evenodd, …)` (the board's rule,
  whose inner line runs 0.414px further along each side at a 45° cut); the price on the bottom border at the right; the
  foot line in the bottom border, "Postcard · <One per post | Stacks N deep>" at the left and "Art · <credit>" at the
  right, ending before the price.
- **What each size holds** is the design's section 2 table. The fan's plate holds the tagline, the sheet's the summary.
  A face with no credit draws no credit.
- **Markup order** stays the label's (`cardLabel`): name, tag, play, gem, then the rest, every part placed, every word
  real text and aria-hidden, as today.
- **The plates' backgrounds are single tokens** (`--kb-glass-panel` for the name plate, `--kb-glass-panel-soft` for the
  text plate, or darker), with no gradient, so Task 8's guard can read them.
- **The sheet's description** in `Hand.board.stories.tsx` ends with "Art by <credit>." where the face has a credit, so a
  screen reader hears what the foot line shows.

**`PostcardBack`** (new, in `Postcard.tsx`): the same frame at any size, for the booster packs plan's reveal. Its canvas
is the glass's crossed bands in `--kb-glass-text-hi` on `--kb-glass-field` (as `.kb-card-back` draws the mark's), its
ring in `--kb-glass-text-hi`, and nothing of any card: no `data-kb-card`, no card color, no name. `hit` draws its ring and
bands in `--kb-glass-ready` (the machine's gold). The caller names it, as it names a face.

**Tests first** (`postcard.test.tsx`):
- Each size sets `--kb-pc-w` to its width, and the card's style holds no `cqw` on its own box.
- The slot draws the name and the gem and no tag, play, plate text, price or foot; the phone adds the tag and play; the
  fan adds the tagline; the sheet adds the summary, the price and the foot, whose text holds "Art · Divided World" for a
  face credited so.
- A face with no canvas draws no `<img>`; a face with one draws it inside the canvas element.
- `PostcardBack` holds no card's key, color or name; `hit` sets `data-hit`.
- The text plate's `::before` is in the stylesheet with `evenodd` (read from `postcard.css`, as
  `engine/ui/glass/board.test.tsx` reads a stylesheet).
- The sheet story's description ends "Art by Divided World."

## Task 7. The machine, the hand's sheet and the boards (engine, docs)

Model: sonnet

**Files:** `engine/ui/vending/vending.css` (`.kb-vending-slot > .kb-postcard`, :241, re-centered for 86 by 129),
`engine/ui/cards/hand-board.css` (:54 to :61, 276 by 480 becomes 276 by 414; :110's column stays 276), the boards
`docs/research/2026-10-29-two-worlds/05-cards.html` and `07-vending.html` (each card's box at its new size, centered where
the old box was), their notes in `docs/research/2026-10-29-two-worlds/README.md` (a dated amendment: "Amended 2026-11-05,
by the card template design", naming the new sizes), and the manifests `e2e/boards/05-cards.ts` and
`e2e/boards/07-vending.ts` where a comment states a size.

**Test first:** run `npx playwright test e2e/boards.spec.ts` after Task 6 and before this task: boards 05 and 07 fail on
the cards' boxes. Amend the boards, then the same run passes, with boards 01 and 02 unchanged.

## Task 8. The plates in the contrast guard (tools)

Model: sonnet

**Files:** `tools/check-glass-contrast.mjs`, `tools/test-glass-contrast.mjs`.

The guard already reads an overlay's panel base from its stylesheet (`readPanelBase`) and its text over white. Add the
card's two plates as overlays read from `engine/ui/cards/postcard.css`: the name plate's background token under
`--kb-glass-text-hi` held to 3:1 (the name is large display type), and the text plate's under `--kb-glass-text-2` held to
4.5:1, each over pure white, the brightest art can be, in every instance's every key.

**Tests first** (`test-glass-contrast.mjs`): a plate whose background token is `rgb(0 0 0 / 0.3)` fails, naming the
plate, the token and the ratio; a plate whose rule is missing from the stylesheet fails as unreadable; the real
stylesheet passes.

## Task 9. The art contract and the submission guide (docs)

Model: sonnet

**Files:** `specs/card-art.md` (new, a current document: the engine's contract), and
`instances/divided-world/ui/cards/README.md` (new: Divided World's guide for an artist).

- **`specs/card-art.md`** says what an art set is (the design's section 6), the template's numbers by name from
  `engine/ui/cards/template.ts`, the template file `engine/ui/cards/card-template.svg`, the rules
  `tools/check-card-art.mjs` holds, and that a variant's canvas is the same canvas (SVG, or a 1080 by 1680 image once the
  variant design builds it).
- **The README** tells an artist, plainly and in American English, how to make a card's art: download the template, draw
  on the art layer, export `art.svg` at the canvas's viewBox and a square `mark.svg`, write `art.json` with their credit
  and license, and open a pull request; the owner approves art in review. It may joke where it describes the game; it
  never bluffs. The owner approves its words in review.

**Test first:** `node tools/check-doc-references.mjs` passes with both files naming only paths that exist.

## Last. The full build, the pictures and the final review

Model: inline

`npm run typecheck`, then `npm run build:ci`, green. Screenshots of all nine cards at every size, default and armed, at
`deviceScaleFactor: 2`, into `docs/research/2026-11-05-card-template-shots/`, for the owner's look in the PR. The final
review, by the build-session skill's charter, with the focus below.

## Ways out of the states this touches

None. The card face and back are drawings; no state a player, a character or a post can be put in is added or changed.

## The masks

Nothing added is computed from a private fact. A card's art, mark and credit are the card's, the same for every player
and every screen; the back names no card. No response, payload, Realtime event or timing is added.

## Review focus

- The SVG rules (Task 2) against a hostile file: an entity-encoded `&#x6a;avascript:`, a `<set>` or `<animate>` that
  writes an `href`, `xml:base`, a `<!DOCTYPE>` with an entity that expands to a URL. A card's SVG is shown through `<img>`,
  where a browser runs no script and loads nothing, so the guard is the second wall, for the template's other readers
  (an artist's editor, a raw view on GitHub); say which of these it misses and whether that matters.
- The booster packs plan's Task 5 draws its reveal with `Postcard.tsx` and a back. Whichever lands second must use
  `PostcardBack`; check that nothing in that plan's reveal assumes the old sizes.
- `cqw` on the card's own box measures the page, not the card. Any length on `.kb-postcard` itself must come from
  `--kb-pc-w`; check the armed and forced-colors rules too.
- The plates over the real art at the slot's size: the name must still read at 86 wide over the busiest canvas.
- The boards: only 05 and 07 changed, and only their card boxes.
