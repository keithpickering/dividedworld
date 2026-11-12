Record, written 2026-11-12.

# A tail is always next to the words: plan

Carries out `docs/plans/2026-11-12-tail-innermost-design.md`. Two tasks, in order. No migration, no rules change, no
change to any card's own code or CSS.

## What the code is now

`engine/ui/cards/Effects.tsx`:

- `PostEffects` builds `wraps` (each layer's cards in the order each was first played there) and `ordered`: the
  `beneath` cards, the rest, then the takeovers. Its loop wraps `words` in a `BoundEffect` for each, the first
  innermost, and gives each its place in the loop as `rank` (`claims.at`). `words` is the post's `children`, or
  `<WordsIn el={bodyEl}>{children}</WordsIn>` while a compose is open on the post. While a moment is shown
  (`momentAct`), only the takeovers wrap.
- `MomentEffects` and `VersionEffects` each order their cards as the rest, then the takeovers, with no `beneath`.
- `writingKeys(instance.cards)` is the set of keys of the cards that write; `PostEffects` and `MomentEffects` hold it
  as `writing`. A card that writes reaches a post alone (`writes`).

`engine/ui/cards/Effects.test.tsx` holds the nesting tests, on the engine's own test cards (`nesting`).

## Tasks

### Task 1: the story and the browser check, red

Model: sonnet

Files: `instances/divided-world/ui/you-were-saying/YouWereSaying.board.stories.tsx`,
`e2e/you-were-saying.spec.ts` (new).

1. The story file gains two cases and a story for each, `TapedFirst` and `TapedLast`: one post whose words wrap to at
   least three lines at the board's width and hold a phrase Autocorrect covers once, away from the last line; one play
   of Autocorrect and one of You Were Saying? with its text. In `TapedFirst` Autocorrect has the lower `layer` (played
   first); in `TapedLast` You Were Saying? has. Autocorrect's play is seeded as its own story seeds one
   (`instances/divided-world/ui/autocorrect/Autocorrect.board.stories.tsx`). Both stories set reduced motion, so the
   tail is whole at once.
2. `e2e/you-were-saying.spec.ts`, modeled on `e2e/autocorrect.spec.ts` (the story route, the fonts ready). For each of
   the two stories, at a desktop and a phone width:
   - `[data-kb-tail]` is the next element sibling of the post's `.kb-bb`, and both are inside `[data-kb-autocorrect]`;
   - the tail's first client rect is on the line of the last client rect of the words (a Range over `.kb-bb`): their
     vertical centers are within half a line, and the tail's left edge is at or after the words' right edge;
   - the tape is where it was: every `[data-kb-ac-piece]` box lies over a box of its strip's `[data-kb-ac-seg]` words.
3. The red run, recorded: `TapedFirst` fails the first two assertions and `TapedLast` passes. This is the poison for
   the check: the nesting as it is on main.
4. The new stories pass the board stories' own checks (`e2e/a11y.spec.ts` reads every board story).

### Task 2: one ordering, a card that writes innermost

Model: sonnet

Depends on Task 1 (its red run).

Files: `engine/ui/cards/Effects.tsx` (`PostEffects`, `MomentEffects`, `VersionEffects`, a new `nestOrder`, the file's
header comment), `engine/ui/cards/Effects.test.tsx`, `engine/ui/cards/moment.test.tsx`, `engine/ui/cards/types.ts`
(the comments on `CardUi.beneath`, `ComposeProps.under` and `ComposeProps.box`), and any current document that
describes how effects nest (search for "outermost" and "innermost" outside records; a record is left as written).

Tests first, each with its red run:

1. `Effects.test.tsx`, with a test card whose rules have `writes` and whose effect draws
   `<>{children}<span data-kb-tail /></>`:
   - a card that writes, played last, is innermost: the tail is the words' next sibling;
   - it is inside a `beneath` card played before it and one played after it;
   - a takeover is outside it;
   - two cards that write keep their play order, both inside every other card;
   - a card that writes on the post is inside the effect of a play above the post (a thread's or a board's);
   - the ranks the effects are given (`ink`) ascend from the innermost out, in the new order;
   - with a compose open on the post, the tail is inside the compose's body element (`.kb-compose-body`), next to the
     words, and the other cards' effects are outside it.
2. The moment and History paths (`moment.test.tsx`, or `Effects.test.tsx` where `VersionEffects` is easier to reach):
   a card that writes is innermost in `MomentEffects` and in `VersionEffects` whatever the play order, and a `beneath`
   card drawn in a moment is inside a card without it.

Then the code:

- `nestOrder`: given the cards to wrap in play order, the `CardUi` list and the writing keys, returns them as cards
  that write (on the post's own reach), then `beneath`, then the rest, then takeovers, each group in the order given.
  A takeover is a takeover whatever else it is. Pure, exported for the tests, and the only place the order is stated.
- `PostEffects` uses it. The effects of the cards that write wrap `children` first; `words` is that, or that inside
  `WordsIn` while a compose is open; the other effects wrap `words` as now. `rank` counts from the innermost across
  both. While a moment is shown nothing changes: only takeovers wrap, and `MomentView` is given the words as now.
- `MomentEffects` and `VersionEffects` use `nestOrder` in place of their own lists.
- The header comment of `Effects.tsx` and the comment on `beneath` say the order as it now is; `under` and `box` say
  that the element holds the words and any tail.

Then Task 1's spec is run again and both stories pass, with the output shown. `e2e/autocorrect.spec.ts`,
`e2e/fold.spec.ts` and the Whoops! and Graffiti specs are run too, since their cards' boxes can now hold a tail.

## Review focus

- A post an instance already holds, with a covering card played before a tail: the tail moves inside the cover on the
  next load. Whoops! and Graffiti keep what is drawn by shares of the post's box, which is now taller by the tail;
  what a splat or a wall already saved covers after the change, against a post where the tail was played first (where
  the box always held it).
- The mount of the writing card's effect when a compose opens and closes: nothing is saved twice, no hold is left
  running, and focus on the tail is not dropped to the page.
- `rank` and the ink claims (`claims.at`): a press on an outer card's ink still works that card with the writing card
  beneath it.
- A shown moment and a History version draw the tail next to the words they name, and no live effect is mounted under
  a moment that was not before.
- The tape's measuring with a tail inside `.dw-ac`: the tail typing in changes the box's height many times a second
  while it types (`ResizeObserver`); the cost on a page of long Autocorrected posts with tails.
- Nothing in the ordering reads who played a card or who owns a character ("A response never proves a private fact").
