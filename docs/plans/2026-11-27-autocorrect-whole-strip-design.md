# Autocorrect: a strip that fits a line stays whole

Record, written 2026-11-27. Amends section 2 of `docs/plans/2026-11-11-autocorrect-tape-design.md` ("Pieces across
lines"). The plan is `docs/plans/2026-11-27-autocorrect-whole-strip-plan.md`.

## What the owner saw

On the front door at a phone's width, the example post's "a man" (replaced by "a Goomba") landed at the end of a line.
The strip's words fit there, so the browser broke the line inside the strip's room. The tape was cut into two pieces:
one on the first line over "a man", carrying "a", and one at the start of the next line carrying "Goomba", over nothing
but room. The owner: "this is not broken, but a strip with no text underneath it is a little odd."

## Why it happens

- **The room wraps like words.** A strip's footprint is its words and then enough room for the replacement, made of
  break-spaces (`.dw-ac-room`, `white-space: break-spaces`), so the line can break anywhere inside the room. Nothing
  asks the browser to start the strip on a new line.
- **Words are dealt piece by piece.** `dealWords` (`instances/divided-world/cards/autocorrect/tape.ts`) gives each piece
  the words that fit it, and a word that does not fit goes to the next piece. So "Goomba" went to the piece over the
  room, and the layout's `extra` pass grew the room until it fit.

Section 2 of the tape design allowed a piece that carries no words. It did not consider the reverse, a piece whose
words cover none of the post's text. That only happens because a short strip happened to land at a line's end.

## Decided

**A stack whose whole footprint fits on one line is laid as one unbreakable unit.** The owner approved this on
2026-11-27 ("Your solution makes sense, let's proceed").

- **The test.** A stack's footprint is its words from its first strip's start to its last strip's end, plus every room
  inside it, measured at one line's room: the rooms `roomOf` sets, before any `extra`. If that width is no more than
  the width of the line it sits in, the stack is **whole**. A line's width is the content width of the nearest
  block-level element around the stack's first segment, so a stack inside a quote is measured against the quote.
- **Whole.** Its segments do not wrap (`white-space: nowrap`), and its rooms keep their spaces without breaking inside
  them (`white-space: pre`). The browser moves the whole stack to the next line, as it would a long word, and the strip
  is one piece per strip. The room is not counted again for crossing lines: a whole stack takes no `extra`.
- **Not whole.** A footprint wider than its line wraps and is cut into pieces exactly as section 2 says. That case was
  what section 2 was written for: a 100-character phrase is wider than a phone.
- **A stack is tested as a stack.** Overlapping strips are never split from each other by this rule.
- **Strips peeled before this load.** A stack whose strips were all peeled before this load (`loaded`) has no room and
  no tape. It is left to wrap as the post's own words do, so a bare post reads as it was written.
- **It holds.** Whether a stack is whole is found when the post is measured: on mount, on a resize, when fonts arrive,
  and for a new version. It never changes because a strip is peeled or peeked, so nothing on the page moves when tape
  comes off (section 1's "It holds"). The test reads widths, not where the lines broke, so changing it cannot change
  its own answer.

## Weighed

- **Dealing the words onto the piece with text, and shrinking the marker to fit.** Rejected: "a Goomba" squeezed into
  "a man"'s width is the unreadable squeeze section 1 already turned down, and the second piece would still be tape
  over nothing.
- **Leaving it as it is.** It is not broken, but a piece of tape over no words reads as a fault, and it is the common
  case: any short phrase near a line's end does it.
- **The cost.** A whole stack near a line's end leaves the gap a long word leaves there. That gap is ordinary for a
  message board's text.

## The rules

- **Layers.** All of it is Divided World's, in Autocorrect's own files. The engine is not touched.
- **Masks.** Nothing new is sent or computed from a private fact. The layout reads only the post's words and the plays'
  replacements, which every reader sees.
- **Ways out.** No new state: a whole strip is peeled, peeked and saved as any strip is.
- **Fills the post.** The tape still lies over the strip's own footprint, inside the post's content area; this changes
  where a line breaks, not what the tape covers.
- **Scale.** One more sum per stack in a pass that already measures every stack, so it grows with the strips on a post
  as the pass already does.

## Open

Nothing.
