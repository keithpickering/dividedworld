# The mobile postbit: the whole 1:2 avatar, and rank above group: plan

Record, written 2026-11-14. Carries out `docs/plans/2026-11-14-mobile-postbit-design.md` (its sections are cited as §N).
One build session builds it in one PR from `main`. Where a number here differs from the design, the design wins.

Every task goes test first: the failing test, its red run shown, then the code. During a task run only the tests for the
changed code (`npx vitest run <file>`, or `node tools/test-e2e.mjs <spec> --trace off`). Run `npm run build` once after
the last task. Every task is engine. No instance file changes, no migration, and nothing touches a database. No check is
added, so no poison is needed; the tests below are the guards. "A phone" is the stylesheet's `(max-width: 40em)` and, in
a component, `useNarrow()`, as today.

The look is the mock: `docs/research/2026-11-14-mobile-postbit/1-tall-swapped-fitted-post1.png`, made by `mock.cjs`
beside it, whose injected CSS is the starting point of Task 2's.

The order: 1, 2, 3, 4, 5.

## Task 1. A narrow postbit draws the side markup, and the side markup holds one outfit layer (§2)

Model: sonnet.

Files: `engine/ui/postbit/Postbit.tsx` (`Postbit`, `Avatar`, the header comment), `engine/ui/postbit/Postbit.test.tsx`.

- In `Postbit`, `const shape = layout === 'stacked' && !narrow ? 'stacked' : 'side'`: the root's `data-kb-postbit`,
  `<Avatar layout>` and `counts` use it. `counts` stays `layout === 'side' && !narrow` (a phone drops Posts and Joined,
  as now). `ActArticle`'s own `data-kb-postbit` (Post.tsx:309) is the reader's setting and does not change.
- In `Avatar`, the side branch with a portrait draws no `<source>`, no `data-kb-square`, and no `Outfit on="square"`.
  The stacked branch, and the branch for a mask with no portrait (square in the `tall` slot, or the initial), are
  unchanged. `squareFor` is built only where the stacked/no-portrait branch uses it.
- The header comment's sentences about a phone ("a phone is always stacked ... the square then stands in for a
  portrait through `<picture>`") become what is true: a phone draws the side markup whatever the reader chose, with the
  portrait.

Tests first, in `Postbit.test.tsx`:
- Rewrite "side by side puts the portrait in the tall slot, with the square for a phone": the slot's `img` is
  `tall.webp` and the slot has no `source` at all.
- New: at `widthOf(390)`, `show(person(), 'stacked')` has `data-kb-postbit="side"`, the slot is `data-kb-slot="portrait"`
  and its `img` is `tall.webp`. At `widthOf(1440)` the same call is `stacked`, `sq.webp`, no `source`.
- Rewrite "stacked uses the square, and never loads the portrait" to say "on a wide screen" (the test sets
  `widthOf(1440)`).
- Rewrite "a side by side portrait carries both layers in the DOM at every width": the portrait's slot holds only the
  `data-kb-on="portrait"` layer, at 1440 and at 390; the stacked band at 1440 holds only `square`.
- Rewrite "a phone stacks whatever the reader chose, so it drops them too": add the stacked-at-390 case to it.
- Delete "no rule hides the square outfit outside the side layout" and "on a phone its portrait gear is hidden" (they
  held rules Task 2 removes); Task 2 writes their replacements.

Red run: the rewritten tests fail on the current markup (a `source` is there, `stacked` stays stacked at 390).

## Task 2. The phone block draws the tall slot, in the order name, rank, title, group (§2)

Model: sonnet.

Files: `engine/ui/postbit/postbit.css` (the phone block `@media (max-width: 40em)`, the wide block's comment on the
text-over-gear rule, the header comment), `engine/ui/postbit/Postbit.test.tsx` (the CSS-reading tests),
`engine/ui/thread/thread.css` only if the build finds a stacked rule that assumed the band (read lines 301–335 and
531–560 first; the phone block there is generic over `data-kb-postbit`).

- Phone block: `.kb-postbit[data-kb-postbit="side"] .kb-postbit-avatar[data-kb-slot="portrait"]` is `flex: 0 0 3.6em`,
  `width: 3.6em`, `overflow: visible`, `container-type: inline-size` (the outfit's `cqw` needs it), and takes the
  portrait's own shape: the same `aspect-ratio` rules the wide block has (`auto`, with `[data-kb-shaped]` setting the
  inline shape), not `1 !important`. The picture inside is `object-fit: fill`, not `cover`. The postbit row is
  `align-items: flex-start` (the avatar is taller than the text). The slot's `data-kb-slot="tall"` (a square in a tall
  slot, no portrait) and `square` keep `3.2em`.
- Delete the phone rules that exist only for the square: `aspect-ratio: 1 !important` on the portrait slot, the
  `cover` rule, the three `.kb-outfit` show/hide rules, and the wide block's "the square's gear is for the phone" rule
  (a portrait slot no longer has a square layer).
- Order, phone only, on `.kb-postbit-text` children (the text is `display: flex` there): name 0, rank 1, title 2,
  group 3, warn meter 4, revealed class 5. The marks strip is absolute and takes no order. Wide windows keep their own
  orders (the rank at 0, the avatar at 1, the group at 3, the counts, class and warn at 4).
- The text-over-gear rule (`.kb-postbit[data-kb-postbit="side"] .kb-postbit-text > *`: `position: relative`,
  `z-index: 2`, `align-self: flex-start`, `max-width: 100%`, the post's ground) and the marks exception under it move out
  of the wide-only block to the top level, so they hold at every width (§2). Reword the comments that say "wide windows
  only".

Tests first, in `Postbit.test.tsx` (the file already reads `postbit.css` with comments stripped and slices it by
media block):
- The phone block gives the portrait slot `width: 3.6em` and `overflow: visible`, and no `aspect-ratio: 1`, no
  `object-fit: cover` on its picture.
- The phone block orders `.kb-postbit-name` 0, `.kb-postbit-rank` 1, `.kb-postbit-title` 2, `.kb-postbit-group` 3,
  `.kb-postbit-warn` 4, `.kb-postbit-class` 5; the wide block still has the rank at 0 and the group at 3.
- The text-over-gear rule sits outside any media block (adapt "the text-over-gear rule is scoped to wide windows and
  the phone side layout is not touched by it" to say the reverse), and the existing "the phone block comes after the
  wide block" test still holds.
- No rule hides a `data-kb-on="square"` layer inside a portrait slot (there is none to hide).

Red run: these fail on the current CSS.

## Task 3. A highest piece standing above the slot gets room on a phone (§2)

Model: sonnet.

Files: `engine/rules/cosmetics.ts` (a new pure `outfitOverhang`), `engine/rules/cosmetics.test.ts`,
`engine/ui/postbit/Postbit.tsx`, `engine/ui/postbit/postbit.css`, `engine/ui/postbit/Postbit.test.tsx`.

- `outfitOverhang(pieces, aspectOf, tallness)`: in units of the slot's width, how far above the slot's top the highest
  piece's turned box stands, never below 0. The slot is 1 wide and `tallness ?? 2` tall. A piece's half-height is
  `(w * |sin turn| + w * aspect * |cos turn|) / 2` (the formula `touchesSquare` in `Outfit.tsx` uses), its center is
  `y * tallness`, and a piece with no art (`aspectOf` returns `undefined`) is skipped as `Outfit` skips it. The result is
  capped at the settings' `gear.reach`, which the layer's own clip cuts at.
- `Postbit` sets `--kb-overhang` (a number, the function's result) as an inline style on the root where it is above 0,
  for the side shape only.
- Phone block: `.kb-postbit[data-kb-postbit="side"] { padding-top: calc(var(--kb-overhang, 0) * 3.6em) }`, the slot's
  width in ems, in a comment that says so.

Tests first: `cosmetics.test.ts` (a piece centered at `y: 0.05` with `w: 0.76` and the baseball cap's shape reaches
above; a piece well inside returns 0; a turned piece counts its turned box; an unknown art is skipped; the cap at
`reach`; tallness `null` reads as 2). `Postbit.test.tsx`: the root carries `--kb-overhang` for a character whose cap
stands above its slot and none for one whose gear is inside; the CSS test reads the padding rule.

## Task 4. The boards and the browser hold the phone's postbit

Model: sonnet.

Files: `e2e/phone-postbit.spec.ts` (new), `e2e/boards/2026-11-06-board-look/07-phone.ts` and any other manifest the board
match shows moving, `engine/ui/postbit/Postbit.board.stories.tsx` only if its band is drawn at a width a phone reaches.

- New spec, run at 390 by 844 against `?fixture=boards&story=boards-01-postbit-gear--gear-and-trophies`: for each post,
  (a) the avatar slot is `3.6em` wide (54px at the 15px body), (b) its picture's rendered shape is the portrait's own,
  so the whole crop shows (the slot's and the image's boxes agree), (c) its height is at most twice its width, and no
  more than the right column's height for the post whose postbit has all four rows (name, rank, title, group), (d) in
  DOM order the rank's box is above the title's and the title's above the group bar's, and (e) with a stacked reader
  (set through the story's preferences, or `data-kb-postbit` read on the postbit) the same three hold. Also at 1280 wide,
  the stacked band's avatar is still the 3.2em square (nothing wide changed).
- Run the board match for every phone board (`node tools/test-e2e.mjs boards --trace off`). `07-phone.ts` draws the
  postbit as a band with the group bar between the name and the rank (`GROUP_BAR`); the rank now stands directly under the
  name, and the band's height is the avatar's. Re-measure `post-41-rank`, `post-41-when` and `post-41-permalink`'s
  `buildShift`, remove `GROUP_BAR` from the rank's shift, and write the departure in the manifest's header as the other
  departures are (the owner's word, 2026-11-14, this design), with the numbers the match measures, never estimated.
  Any other board the run shows moving gets the same treatment, and one the run does not show moving is left alone.
- The existing phone-width tests that reached into the postbit (`e2e/thread.spec.ts` "a post folds to one column",
  `e2e/phone-board.spec.ts`, `e2e/callout.spec.ts`, `e2e/post-layers.spec.ts`) run unchanged and pass; one that does not
  is read for what it held before it is changed.

Red run: the new spec fails on the current phone postbit (the slot is `3.2em` and square).

## Task 5. Close the loop

Model: inline.

Files: `docs/research/2026-11-14-mobile-postbit/` (a built picture), `docs/plans/2026-11-14-mobile-postbit-design.md`
only if §3's open item resolves differently.

- Take a 390-wide screenshot of the built thread at `deviceScaleFactor: 2` beside the mock's, as the card forms' did
  (`02-laugh-track-form-built.png`), and commit it as `3-built-post1.png`. Say in the PR what differs from the mock,
  if anything.
- Run `npm run build` once and show it green.

## Review focus

- **Gear on a narrow slot.** A piece reaches up to 21.6px past a 54px slot on every side. The text keeps its ground over
  it at every width now; check that a piece reaching right over the name never hides the name's link or the BANNED
  flag, and that the overhang's top padding is exactly the cap's height and not the clip's full `reach` for every mask.
- **Both layouts on a phone.** A stacked reader now loads the portrait on a phone and the square on a wide screen; a
  window resized across 40em swaps one for the other without a stale layer or a flash of the wrong shape. The sentinel is
  `useNarrow`'s one query.
- **A row of the wrong height.** The avatar is a fixed `3.6em`; a character with no title (and so a shorter right
  column), a long BANNED title that wraps, and a staff badge (two lines: group and office) each make the row's height
  differ. The first leaves the avatar taller than the text (design §3, open); the other two make the text column the
  taller one, where the avatar must not stretch.
- **Reading order.** The order on screen is CSS. A screen reader and Tab follow the DOM, so the name still reads first,
  then the group, marks, title, rank. The phone's order differs from the DOM's as the desktop's already does; nothing
  new is out of order for a keyboard, because the only focusable thing in the postbit is the name's link.
- **A mask with a portrait and no square, on a phone**, wore no gear and was cropped; it now shows whole and wears its
  gear. Check one in the story, since every existing fixture has both.
- **Cost.** A phone loads the portrait file instead of the square for every post on a page. Portraits are the larger
  file; at a busy instance's page of posts, the distinct characters on it set the count, and `loading="lazy"` already
  holds each below the fold.
