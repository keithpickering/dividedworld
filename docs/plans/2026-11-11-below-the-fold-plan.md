# Below the Fold: plan

Record, written 2026-11-11. The plan for Part 1 of `docs/plans/2026-11-11-card-notes-design.md` (its section 2, "Below
the Fold"), built in one PR from `main`. Parts 2 to 8 of that design each get a plan of their own once the owner has
answered its section 5.

Every task is test first: the test named, its red run recorded, then the code. No `check-*.mjs` is added, so no new
check needs a poison. No migration, and nothing in `engine/` or `supabase/` changes: the card is Divided World's
content, read by the engine through `CardRules` and `CardUi` as every card is. The engine boundary check
(`tools/check-engine-boundary.mjs`) holds throughout. No deployed database, bucket or connector is touched.

**The world.** The fold is drawn on a post, so it is in the board's world
(`docs/plans/2026-10-29-two-worlds-design.md`): a 2003 `[spoiler]` bar, Verdana, the board's own ink and ground from
its tokens, with color only on the card's own piece (the toggle's arrow, in Salty's pink). Its Lens words are the
glass's, plain.

**What the card is** (the design's words, settled here into numbers):

- Key `below-the-fold`, name "Below the Fold", Salty, common (the owner decided common, after the notes' uncommon), a Move on a post, stack 1, no configuration, no play price, no end.
- A post that wears it is drawn as one bar and nothing else until a reader presses the bar. It is folded for every
  reader alike, its author and the caster included.
- Pressing the bar opens the post for that reader, on that page, until the page is left. Pressing it again folds it.
  Nothing is saved or sent.
- Like any Move it can be set face down on one's own post, and then lands on the post that quotes it.

## Task 1. The rules

Model: inline

**Files:** `instances/divided-world/cards/below-the-fold.ts` (new), `instances/divided-world/cards/index.ts`
(`listed`, and the header comment), `instances/divided-world/cards/cards.test.ts`.

```ts
export const belowTheFold: CardRules<Record<string, never>> = {
  key: 'below-the-fold',
  name: 'Below the Fold',
  alignment: 'salty',
  rarity: 'common',
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(belowTheFold, target, effects, now),
  validateConfig: () => ok({}),
};
```

Its header comment says what the card does, that the fold is the screens' to draw, and names the design.

Tests first, in `cards.test.ts`, beside Feelin' Fab's: it lands on a post with no fold; it is refused on a post that
already carries a live fold (stack 1), with `landsOn`'s words; it costs nothing to play; `validateConfig` returns `{}`
for anything; it is in `cards` and `castOnPost` holds for it (so Trap Card can name it).

## Task 2. The machine and the art

Model: sonnet

**Files:** `instances/divided-world/machine.ts` (one slot, after Whoops!:
`{ item: { card: 'below-the-fold' }, availability: 'onSale', price: 100 }`, the commons' price),
`instances/divided-world/ui/cards/below-the-fold/art.svg`, `mark.svg`, `art.json` (new), and whichever tests list the
machine's slots or the cards with art (`instances/divided-world/ui/index.test.tsx`, `instances/divided-world/packs`
tests, `engine/ui/admin` and `engine/ui/vending` stories read the instance's list and need no edit unless a test
counts slots).

- `art.svg`: vector placeholder art in the existing cards' style, viewBox `0 0 540 840`: a sheet of paper folded over
  so its lower half is tucked behind, lines of text on the top strip only, and a disclosure triangle beside the fold,
  in Salty's pink (`#ff3d7f`) on a transparent ground, the subject in the focus zone (the upper part).
- `mark.svg`: a square silhouette of a folded sheet with the triangle, legible at 18 px.
- `art.json`: the credit and license the other placeholder folders carry, word for word.

Tests first: `node tools/check-card-art.mjs` is red with the folder missing a file (run it once with only `art.svg`
present and record the refusal), then green. Any test that enumerates the machine is updated with its red run.

## Task 3. The effect and the card's words

Model: sonnet

**Files:** `instances/divided-world/ui/below-the-fold/Effect.tsx`, `fold.css`, `Effect.test.tsx`,
`Fold.board.stories.tsx` (new); `instances/divided-world/ui/cards.ts` (the imports, the lazy effect, and the card's
`CardUi` entry); `instances/divided-world/ui/index.test.tsx` (the `lands` table near line 90 gains
`'below-the-fold': 'the quoting post'`, and any list of every card's key); `instances/divided-world/ui/hint-words.ts`
and `instances/divided-world/ui/still.test.tsx` only if their tests name every card.

**The effect** (`BelowTheFoldEffect`, an `EffectProps` component):

- It holds one piece of state, `open`, false at mount.
- It draws a host `div.dw-fold` holding:
  - a `<button type="button" class="dw-fold-bar">` with `aria-expanded` and `aria-controls` naming the region. Its
    text is "Show post" when folded and "Hide post" when open, after an arrow glyph (▸ folded, ▾ open) that is
    `aria-hidden`;
  - a `div.dw-fold-body` with that id, holding `children`, with the `hidden` attribute while folded.
- No animation at all, so reduced motion has nothing to change.
- `show` is called whenever `open` changes, with: `progress: null`; `state` "Folded for you" or "Open for you";
  `ends` "Ends when you press Show post."; `yours` true while folded; one control,
  `{ kind: 'press', label: 'Show post' | 'Hide post', run }`, which toggles `open`; `notes` empty. It is cleared with
  `show(null)` on unmount.
- `met()` is called once, when the bar is first drawn.
- In a play's moment (`still`): drawn folded, the bar `disabled`, no handler bound, `show` given the folded view with
  no controls, `met` not called.
- In the ORIGIN box (`place === 'origin'`) it behaves as in the thread.
- It reads nothing about who owns the post or who played the card.

**`fold.css`:** the bar is a full-width row in the board's tokens (the ones `thread.css` uses for a quote box's
header), at least 44 px tall on a coarse pointer, with the engine's focus ring; the arrow alone takes
`--kb-salty`. No fixed colors but through tokens.

**The `CardUi` entry** (after Whoops!'s), with `Effect` the lazy import:

- `art`: `color: '#ff3d7f'`, `ink: '#14030a'`, the folder's canvas, mark and credit, `tagline: 'Fold a post away.'`
- `summary`: `'Folds a post behind a bar. Any reader opens it with one press.'`
- `status`: `'Folded behind a bar'`
- `hint`: `'Press the bar to read the post.'`
- `describe`: `` `A Salty card, ${belowTheFold.rarity}. It folds a post behind a bar, for every reader alike: the post's words are still there, and anyone opens them with one press of the bar, which lasts until they leave the page. One fold fits on a post. ${setMoveWords('the quoting post')} It costs nothing more to play.` ``

Tests first, in `Effect.test.tsx` (Testing Library, as `feelin-fab/Effect.test.tsx` is set up):

1. Folded at mount: the button says "Show post" with `aria-expanded="false"`, and the children are not visible.
2. A press opens it: `aria-expanded="true"`, the children visible, the button says "Hide post"; a second press folds.
3. The keyboard opens it (Enter and Space on the focused button).
4. `show` got the folded view at mount and the open view after a press, each with the words above, and the view's
   control toggles it too.
5. `still`: the button is disabled, a click changes nothing, and `show`'s view has no controls.
6. `show(null)` on unmount.
7. The engine's Lens word rules pass for both views (`lens-words.ts`, as the other effects' tests call it).

The board story (`Fold.board.stories.tsx`, after `Fab.board.stories.tsx`): a thread with a folded post on the light
board and on the dark, and one opened by a play function.

## Task 4. The fold in a browser

Model: sonnet

**Files:** `e2e/fold.spec.ts` (new), `e2e/board-stories.test.ts` (the new story ids, as it lists Feelin' Fab's), and
the a11y spec's story list if it is a list.

Tests first: on the story, the folded post shows the bar and none of its words; a click shows them; Tab reaches the
bar and Enter opens it; axe finds nothing on the folded and the open post, on both boards; at a phone's width the bar
is at least 44 px tall.

Then the full build, `npm run build`, with its tail in the PR.

## Review focus

- **A fold and the cards around it.** A later card's effect wraps the fold and an earlier one is inside it: Whoops!'s
  ink over a folded post, a Stick Around hold of a folded post (the reader must be able to open it inside the hold),
  and Autocorrect's tape inside a fold, each read in a browser.
- **A fold in a play's moment** and in the ORIGIN box of a thread spun from a folded post.
- **Find in page and print.** A folded post's words are `hidden`, so the browser's find does not reach them; whether
  that is the card's obstacle or a defect is the owner's to say.
- **Nothing sent.** The fold's state is the reader's own on one page; no request, Realtime event or saved state is
  added, and the effect reads neither `reader.author` nor `reader.caster`.
- **A busy page.** A page of forty folded posts mounts forty buttons and no observer, timer or canvas.
