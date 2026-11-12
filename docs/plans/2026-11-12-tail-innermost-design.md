Record, written 2026-11-12.

# A tail is always next to the words: design

## Where it starts

You Were Saying?'s tail is drawn right after the post's words and flows on from their last line: the engine makes the
words inline where a tail follows them (`.kb-bb:has(+ [data-kb-tail])`, `engine/ui/bbcode/bbcode.css`). That holds only
while the tail is the words' next sibling, and whether it is depends on play order. `PostEffects`
(`engine/ui/cards/Effects.tsx`) nests each card's effect around the ones played before it:

- You Were Saying? played first, Autocorrect after: the tail is inside Autocorrect's box (`.dw-ac`), right after the
  words, and flows on from them.
- Autocorrect played first, You Were Saying? after: the tail is outside `.dw-ac`, after a block, and starts on a line of
  its own.

The same is true of every card whose effect wraps the words in a box: Laugh Track, Feelin' Fab, Glitter Bomb, Below the
Fold, Whoops! and Graffiti. Play order also decides whether those cards cover the tail: a fold made before the tail was
played leaves the tail showing below the bar, and one made after folds it away.

## What was weighed

**`.dw-ac { display: inline-block }`** (the owner's first idea). Tried in Chromium with the real `bbcode.css`,
`tail.css` and `autocorrect.css` on a 500px column. It joins the tail to a post of one short line and nothing else: a
post that wraps fills the column, so the tail still drops below it. It also shrinks every Autocorrected post's box to
its words, with or without a tail: `[center]` and `[right]` lose their alignment, a rule is as wide as the longest line
and a post that is only a rule is 0px wide, and a quote box shrinks to its contents. Refused.

**`.dw-ac` inline where a tail follows.** An inline box that is `position: relative` gives the tape an origin that
differs between browsers once it spans lines, and a `ResizeObserver` never fires on an inline box, which is how the
tape is measured again when the post's width changes. It would also be Autocorrect's fix alone, with the same fault
left in six other cards. Refused.

**The engine nests a card that writes innermost** (chosen). The tail is then the words' next sibling under every card,
in every play order, and no card's CSS changes.

## What was decided

1. **A card that writes nests innermost.** In every drawing of a post, the effect of a card that writes
   (`CardRules.writes`) wraps the post's words before any other card's, inside a `beneath` card's too, whatever the
   play order. Among several cards that write, play order holds. A takeover is still outermost, and a card that both
   writes and takes over is a takeover.

2. **The tail is part of the post's body under every card** (the owner's answer). Below the Fold folds it away with the
   words, a Whoops! splat and a Graffiti wall can cover it, Glitter Bomb and Feelin' Fab draw over it, in any play
   order. The two alternatives put to the owner and not taken: the tail inside the cards that only work on words and
   outside the covering cards played before it; and inside every card but Below the Fold.

3. **The engine knows a card that writes from its rules.** `PostEffects` already reads `writes` (`writingKeys`). No
   `CardUi` flag is added: a card that writes is the only kind that draws a `data-kb-tail`, so a second flag could only
   disagree with the first.

4. **One ordering for every drawing.** The live post (`PostEffects`), a play's moment (`MomentEffects`) and a version
   in History (`VersionEffects`) each build their own nesting today, and the last two do not know `beneath`. They take
   one function: cards that write, then `beneath` cards, then the rest, each group in play order, then takeovers. A
   `beneath` card drawn in a moment then nests there as it does live ("Two lists that must agree are one list").

5. **While a card is being drawn on the post, the tail moves in with the words** (the owner's answer). During a
   compose the engine puts the post's words in an element of their own (`WordsIn`, the compose's `under`); the effect
   of a card that writes is drawn inside it, so the tail stays on the words' last line and the box a card is drawn in
   includes the tail, as the landed effect's box does. The cost, accepted: the writing card's effect is mounted again
   when a compose opens or closes on its post, so on that screen the tail types in again and a reader's screen-only
   erase of it comes back. The alternative not taken left the compose as it is, with the tail on a line of its own
   until the play lands.

## Engine and instance

Engine only: the ordering and its tests. Nothing in it names a card. The instance gains a story and a browser check
that show the rule on its own two cards; Autocorrect's and You Were Saying?'s code and CSS do not change.

## The masks

The ordering is computed from which cards are played on the post and their rules, all public. It adds no request,
payload, event or timing.

## States and ways out

No state is added. A tail under a cover played before it is reached the way a tail under a cover played after it
already is: the fold opens, a splat is washed, a strip is peeled. The tail's own way out (a hold erases it) is
unchanged, and a tail that is covered is erased once it is uncovered.

## A busy instance

The ordering is a stable sort of the cards on one post, at most `PLAYS_PER_POST` of them, done where the nesting is
already built. Nothing grows with players, threads or Acts.

## Open

Nothing.
