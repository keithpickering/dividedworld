Record, written 2026-11-27.

# Graffiti that holds up on every screen, and on the wall: design

A design session with the owner, started from a screenshot of the front door on a phone. Post #1's wall was drawn for a
desktop: a red ring and arrow aimed at the sprite sheet's Example Wiggler, a "??" beside its Build Your Own row, a black
bar over its credit, and a pink heart at the post's end. On the phone each of them sat on something else, and the "??" was
stretched tall. The owner: "how do we reconcile the ability to draw anywhere on a post with a post's ability to wrap at
different points? … multiple characters can draw on the board across multiple devices at different times."

This is the question `docs/plans/2026-11-06-whoops-refinements-design.md` left open in its section 11 ("Drawings stretch
when the body's height changes … If it bothers players once there are some, the remedy is a design question, not a
defect"), and that the Graffiti design accepted for a wall (`docs/plans/2026-11-11-graffiti-design.md`, section 12). Midway
the owner also brought in the tougher wash the Whoops! ink-field design named and left out for Graffiti
(`docs/plans/2026-11-12-whoops-ink-field-design.md`, sections 6 and 7). The owner chose that from a bench,
`docs/research/2026-11-27-graffiti-everywhere/01-scrub-bench.html`. The plan is
`docs/plans/2026-11-27-graffiti-everywhere-plan.md`.

Each question below was put to the owner one at a time, with alternatives and a recommendation.

## 0. Where it starts

- **A stroke is kept in shares of the post body's box** (`instances/divided-world/cards/graffiti.ts`, its header). A point
  is `[across, down]` from 0 to 1, and `aspect` is the drawer's box width over its height. Each screen maps the shares onto
  its own box (`instances/divided-world/cards/graffiti/spray.ts`, `paintWall`).
- **A desktop body is wide and short; a phone body is narrow and tall.** The words reflow and an image keeps its pixels, so
  the same shares land on different content. A drawing made in a wide box is also stretched into a tall one.
- **The cap is a share of the box's width** (`CAPS`: Stock is 0.016, about 16px on desktop and 6px on a phone), so the same
  tag is drawn thinner on a phone.
- **Coverage is one grid for the whole wall**, 100 by 100 cells in shares of the box, with each cell owned by the draw
  that last inked it (`supabase/migrations/0317_surfaces.sql`: `surfaces.cover`, `owners`, `surface_step`). Ink over ink
  costs nothing because every draw shares that grid.
- **A wash takes every coat in one pass**, as Whoops!'s did before its ink-field design.
- **The post parser knows where its words are.** `engine/bbcode/visible.ts` gives a post's visible text, with an offset for
  every text node, read the same by the server and the screens. The renderer's text layers
  (`engine/ui/bbcode/layers.tsx`) draw runs over those offsets.
- **A reader may enlarge the board's text** to 125%, 150% or 200% (`engine/ui/base.css`, `data-kb-text-size`).

## 1. A mark is attached to the content under it

**Decided** (the owner chose the recommendation). What a tag means is tied to the content it was drawn on, and the box is
the one thing screens do not share. So each mark records what it was drawn over, and each screen finds that in its own
layout and places the mark there, rigid: never stretched, and shrunk evenly only when it is wider than the box.

- **An image attachment** is a point within an image, in the image's own shares. An image scales evenly, so a mark on it is
  exact on every screen.
- **A text attachment** is a run of the post's visible text and an offset from it, in the size of the post's text.
- **A box attachment** is a spot as a share of the box. It is the last resort and the fallback (section 5).
- **A wash belongs to the ink it washes, not to a place** (section 4), so it follows its tag to every screen.
- **Whoops! is unchanged.** A splat is thrown at the wall, not aimed at anything, so it stays fitted to the box.

This is not the "ink following the words" that the Whoops! refinements design rejected. That cut a splat into strips line
by line. Here each group of figures moves as one rigid piece.

Weighed:
- **A wall fixes its layout** (rejected). One width on every screen, panned or zoomed on a phone. Every mark is exact, but
  walls become the least readable posts on a phone, which Whoops! already rejected, and fonts still break lines differently.
- **Keep the box, and fix only the stretch** (rejected). Marks would look right and still land on the wrong content.

## 2. Figures and groups

**Decided** (the owner chose the recommendation, from their own example: "somebody writes 'HELLO': each letter's strokes
should be kept together of course, but the relative positioning of the distinct figures is still important, even if it
must be adjusted as the container width changes").

- **A figure** is the strokes of one drawing whose paint touches: a letter, a ring, a "?". It is always rigid.
- **A group** is the figures of one drawing that lie close: a gap between two figures smaller than the taller one's height
  joins them, and the rule is followed through (a chain of close figures is one group). HELLO is one group. A ring with its
  arrow is one group. A ring and a "??" drawn across the post from it are two.
- **A group keeps its figures' exact spacing**, is attached at its center, and shrinks evenly when it is wider than the
  box. It never wraps.
- **The promise:** two figures of one drawing that did not overlap on the drawer's screen never overlap on any screen. Two
  groups of one drawing that would overlap on a reader's screen are moved apart: the later is nudged down until it is clear,
  or up where down would leave the box, and where neither clears it, it takes the place of least overlap. Groups of
  different drawings may overlap, because layering is what a wall is.
- **Grouping is done on the drawer's screen**, when the drawing is tagged, and the server checks only its bounds. A client
  that sends odd groups only rearranges its own drawing.

Weighed:
- **A whole drawing is one rigid group** (rejected). HELLO is always perfect and nothing is guessed, but a drawing aimed at
  two things is right next to only one of them.
- **Groups wrap like text** (rejected). HELLO breaks to HEL / LO at the drawer's size, which keeps the size and breaks
  pictures made of separate figures, such as a face's eyes and mouth.

**What it gives up.** The grouping rule is a guess about what belongs together. Two words written far apart may split, and
an arrow drawn far from its ring may be left behind. The threshold is the taller figure's height, and the plan's tests pin
it against drawings that must group and drawings that must not.

## 3. A group over empty space

**Decided** (the owner chose the recommendation). Many tags go in the blank part of a post, such as the empty right half
beside a short line on desktop. A group whose center has no word or image under it is attached to the nearest content
(the nearest word's run, or the nearest image), with its offset kept, and pulled into the box where it would leave it. A
KILROY drawn beside the last line stays beside it; on a phone, where that space does not exist, it is pulled in over the
end of the line it sat beside.

Weighed:
- **Its spot as a share of the box, as today** (rejected). Blank-space tags would drift onto whatever is there, which is
  the screenshot's failure for those tags.
- **The margin as content of its own** (rejected). A group tied to the box's right edge at a line's height overlaps the
  words there on a phone: close to the decision, but tied to the edge rather than to what it sat beside.

## 4. What a drawing stores, and how a screen places it

**Confirmed by the owner** as a section.

**A drawing holds groups.** Each group stores:
- **its attachment:** text (the post's version it was drawn on, a run of that version's visible text, and an offset from the
  run's first box), image (the version, which image, and a point in the image's shares), or box;
- **its spot as a share of the drawer's box**, with the drawer's box size in the text's size. That is the fallback of
  section 6 and the frame the server counts in (section 7);
- **its strokes in its own rigid units.** For a text or box attachment the unit is the size of the post's text (an em), so a
  mark keeps its size beside the words on every screen and at every text size. For an image attachment the unit is the
  image's width, so a mark scales with its image, and the group keeps how many ems an image unit was when it was drawn, so
  its caps and the server's count are true.

**The caps are sized against the text** (the owner chose this over a share of the drawer's box): Skinny 0.4em, Stock
1.07em and Fat 2.67em, today's desktop sizes at the board's 15px. Under the old rule a tag drawn on a phone would show
hairline-thin on desktop, and the other way round.

**A reader's screen places a group** in five steps:
1. find its attachment in this screen's layout (the run's first box, through a text layer, or the image's box);
2. place the group rigidly at its offset from there;
3. shrink it evenly if it is wider than the box;
4. pull it into the box if it hangs outside;
5. nudge it clear of an earlier group of the same drawing that it now overlaps (section 2).

Placement runs again when the box resizes, an image loads or the text size changes. At a busy instance's scale, a wall's 48
live drawings of a handful of groups each cost a few box reads per group, small beside drawing the paint.

## 5. Paint has depth

**Decided** (the owner chose to fold it into this design, from the bench: "2 coats feels right. Rest of the defaults are
good"). Before, the sponge took a wall's paint out in one pass, where Whoops! takes a little each pass.

- **A stroke lays 2 coats** where its core lies, counted once per stroke. Strokes of one drawing that cross stack to **at
  most 4 coats** (two lines' worth). Overspray and speckle thin as the core under them does.
- **Each pass of the sponge takes one coat.** It presses a disc every third of its radius, each taking a share that falls
  off as `(1 − d²/R²)³` within `R = 2r`, so one straight pass takes one coat under its center (the Whoops! ink-field rule).
- **The top group first.** Each press goes to the top group of the wall that still has paint under its center on the
  washer's screen. A group beneath is reached only once the one above it is clean there.
- **A wash is saved as presses**, each given to its group, in that group's own units. So every screen and the server replay
  exactly the same take, and a wash follows its tag to every screen.
- **Thinned paint turns see-through**, by the Whoops! rule: once a wash has touched paint, its opacity is
  `min(1, 0.35 + 0.65 · (coats − T) / 1)`. Paint under `T` (0.12 of a coat) is clean.
- **The sponge is sized against the text too**: 4em, today's 60px at 15px. It is the same effort on every screen.
- **Everyone scrubs at the same pace.** The author's saved wash, a reader's own scrub and Hold to scrub take one coat a pass.
  Hold to scrub goes round only the bands that still have paint, so it keeps going until the wall is clean (CLAUDE.md, "An
  accessible path costs what the obstacle costs").
- **The numbers are the card's** (`surface.coats` in Graffiti's rules); the engine's surface reads them.

On the bench's sample wall a quick line goes in 2 passes, the first leaving it see-through, and a worked block of crossing
Fat strokes takes about 4 in its middle.

Weighed, on the bench: a line of 1, 1.5 or 3 coats; strokes that do not stack, or stack to three lines' worth; every tag
under the sponge worn at once instead of the top tag first; thinned paint that stays solid until it is gone. And keeping
the wash instant here, to make it tougher in a design of its own: rejected, because the wash's format and the server's
count of paint would be designed and migrated twice.

## 6. Edits

**Decided** (the owner chose C2 below, after rejecting the first recommendation). A post with a wall may be edited, and an
edit can move or remove the very words a group is attached to.

- **A group whose run and the 8 characters on each side of it lie in one unchanged stretch keeps its attachment**, moved by
  the text added or taken before it. The comparison is by position in the visible text (a diff of the version the group was
  drawn on against the version now), never by searching for the words.
- **Any other group falls back to its spot as a share of the box**, rigid and pulled into the box. So does every group
  when a rewrite leaves little standing.
- **An image attachment holds while that image is still in the post**, the same address at the same place among its
  copies; otherwise it falls back.
- **An edit never washes and never frees paint.** The way out of a misplaced tag is the sponge, and a new tag.

Weighed:
- **The group follows its words through any edit** (the first recommendation, rejected). The owner: "Suppose the post is
  edited foundationally and the words occur in a totally different place, multiple times, or not at all." A position
  carried through a heavy rewrite means nothing.
- **Every group falls back after any edit** (C1, rejected): a typo fix would cost a whole wall its attachments.
- **A group whose words go leaves the wall** (rejected): an instant, free wash that cannot be scribbled back, which undoes
  the hand wash the Graffiti design chose.

(A word that moves from the start of a line to its end, which the owner raised against the first recommendation, is the
same as two screen widths and needs no edit: section 4's pull into the box covers it.)

## 7. The budget counts each tag's own paint

**Decided** (the owner chose the recommendation). Under attachment the server cannot know how two drawings from different
screens overlap, so ink over another tag's ink can no longer be free.

- **Each live drawing has its own grid of coats**: 100 by 100 cells in the drawer's own frame (its box as it was when it was
  tagged), each holding its coats in tenths, from 0 to 40. It is computed from the drawing's strokes, and the wash's takes
  against it are subtracted, by pure functions in `engine/rules/surface.ts` that the server function and the screens share.
- **A cell counts until its last coat is gone.** The wall's total is the sum, over its live drawings, of their cells that
  still hold paint. Overlap inside one drawing is free; painting over another tag is paid for again.
- **A drawing that would take the total past the limit (40%) is refused**, in today's words with the wall's own figures.
- **A drawing leaves the live list when its last cell is clean**, and the takes against it leave with it. The 48-drawing
  bound is unchanged.
- **The Lens** says each drawing's own share ("6% of the wall") and counts the drawings no longer live as washed off.

Weighed:
- **The shared grid, counted in each drawer's frame** (rejected). Overlap would be free between similar screens and paid
  between different ones, so a phone drawer painting over a desktop tag they can see would be charged as if it were bare.
  The meter would contradict their own screen, which the out-of-character screens must never do.
- **A fixed amount of paint per wall** (rejected). A one-line post could be buried whole and a long one barely touched; the
  40% is there to keep a post readable.

**At a busy instance's scale.** A write takes one lock and touches the grids of the drawings it changes, at most 48 of
10,000 cells, the same on a wall of ten Acts or ten thousand. A read is the live list, as today. The rows are derived from
the Acts and rebuilt from them, so an instance exported and imported again is the same wall.

## 8. What stays, and what follows

- **Drawings already stored.** Their Acts are never changed (CLAUDE.md, "Append-only"). Each is read as one group with a box
  attachment at its old shares, laid at 2 coats. A wash already stored is read as it was made: an instant cut, taking every
  coat of each older drawing under it. A migration rebuilds every wall's rows by these rules.
- **Mod Bot stencils** keep `{ stencil, can, spot }`. The spot is a box attachment at the center of its cell of the 3 by 3
  grid, and the stencil is drawn rigid, 12em across, shrunk to fit. It no longer stretches with the post.
- **The front door's script** (`instances/divided-world/ui/front-door.ts`, with `front-door/marks.ts`) names what each mark
  is aimed at, as image or text attachments, and the content check holds every one to its post.
- **The ORIGIN box and a quote** find a group's attachment in whatever box shows the post.
- **A face-down draft that springs on a quoting post** falls back to its box spots, since its words are not in the quoting
  post. #593 already plans to remove that path.
- **Ways out** (CLAUDE.md, "No player is ever stuck") are unchanged: the author's wash at any time, a reader's scrub on
  their own screen, and an admin's End this card. Tougher paint makes washing slower and never impossible: every pass takes
  paint, and Hold to scrub keeps going until the wall is clean.
- **Private facts** (CLAUDE.md, "A response never proves a private fact"). A drawing already shows its drawer's box
  proportions, so whether a mask drew on a phone shows today, and that is a clue, not a private fact. A wash's presses are
  the post's own character's, already public. Nothing here is computed from who owns a character.
- **Engine and instance.** Groups, attachments, placement, coats, the edit mapping and the count are the engine's surface
  (`engine/rules/anchor.ts`, `engine/rules/surface.ts`, `engine/ui/cards/`). The cans, the caps, the coat numbers, the
  sponge and the stencils are Graffiti's, carried in through `CardRules.surface`.

## 9. Open

- **A stencil aimed at an image or at words.** A Mod Bot choosing "on the image" or "on this phrase" would be The System
  choosing from the post's own content: a new bounded choice, its own design. Filed as an issue with this design's PR.
- **Telling a screen reader which words the paint covers** (#745) is easier once a group knows its run, and stays that
  issue's.
- **Hold to scrub's time on a full wall.** On the bench's sample wall (about 14% of a desktop post) it took about 34
  seconds, longer than a hand. It is held to Whoops!'s pace and its bands, and tuned with them if players find it slow.
