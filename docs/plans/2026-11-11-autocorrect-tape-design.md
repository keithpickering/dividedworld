# Autocorrect as masking tape

Record, written 2026-11-11. A design session with the owner, started from the owner's wish to give Autocorrect the
realistic, physical look and feel the Whoops! refinements gave Whoops! and Shine gave Feelin' Fab and Glitter Bomb
(`docs/plans/2026-11-06-whoops-refinements-design.md`, `docs/plans/2026-11-06-shine-design.md`). It refines the card's
first design (`docs/plans/2026-11-03-autocorrect-design.md`), whose sections 1 (what it does), 2 (edits), 7 (where the
correction shows), 8 (how a Pepperoni card settles) and 11's log lines for a play still hold. The plan is
`docs/plans/2026-11-11-autocorrect-tape-plan.md`. The owner judged the look and the feel on the Autocorrect tape bench
(`docs/research/2026-11-11-autocorrect-tape-bench/01-bench.html`). Where this design and the bench disagree, this design
wins on what is decided and the bench on how it looks and moves.

## 0. Where it starts

- **Today's strip** (`instances/divided-world/cards/autocorrect/Effect.tsx`) is a `replace` text run: a button standing in
  the line where the words were. It holds the covered words, hidden, and the replacement, typed in Courier, in one grid
  cell, so it is as wide as the wider of the two. It is off-white label tape with CSS-clipped torn ends.
- **The width bug** the owner found. A strip longer than 28 characters (`LONG`) becomes inline tape that wraps. It drops
  the hidden words, so it takes only the replacement's width. A short strip is an unbreakable `inline-grid`, so on a phone
  it can run off its line. Peeling a strip whose replacement was wider reflows the post, because the words take only their
  own width.
- **Peeling.** Peeling is too easy for something permanent. A drag past twice the strip's height, or a 700ms key hold
  (`autocorrect.peelMs`), takes a strip off, and the author's peel is saved for everyone. Whoops! asks for about two
  seconds of scrubbing a line.
- **The adhesive** is a flat yellow tint behind the words.
- **The fall** is a paper drift swaying down the screen (`fall.ts`), which a peeled strip of masking tape would never do.
- **Stacks.** Where plays overlap, the top play's strip is drawn over everything the stack covers together (`stripsOf` in
  `peel.ts`).

**The principle this design follows**, which the owner agreed to in the session: what a removal costs grows with how long
it lasts and how many people see it. A reader's own look under the tape is cheap, because nobody else sees it and it does
not last. The author's peel holds for everyone, forever, so it is slow.

## 1. The footprint

**Decided** (the owner: "the phrase and the replacement both need to be the same width, permanently"; then "Residue
should keep the full footprint at least until the next load. If the strip is removed permanently we can probably silently
restore to a more natural width"):

- **What it is.** Each strip has a footprint in the line: its words, then just enough room after them for its replacement
  (Section 3's marker at its full size, plus padding). The room is made of break-spaces, so it wraps as words do, and the
  strip is never squeezed. Where the words are already wider, no room is added.
- **It holds.** The tape, then the residue, then the bare words all sit in the same footprint, so nothing on the page
  moves when tape comes off.
- **Peeled strips on the next load.** A strip the author peeled in an earlier visit takes its words' own width, with no
  room after them. Its residue follows the words.
- **Stacks.** In a stack, the room for each strip is placed right after that strip's own words (Section 8). So every
  strip, including a buried one, has room for its own replacement.

Weighed: never letting tape wrap (a 100-character phrase is about 900px of bold marker, wider than a phone); squeezing the
replacement to the words' width (unreadable for a long replacement over a short word).

## 2. Pieces across lines

**Decided** (the owner offered this choice, and the bench showed it): where a footprint crosses a line break, the tape is
cut into one piece per line, as someone taping over words across a line break would do.

- **The words on it.** The replacement's words are dealt across the pieces in order. Each piece takes the words that fit
  it at the marker's size. A word that does not fit goes to the next piece. Only when the last piece would overflow does
  the whole strip's marker shrink, in steps of 5%, down to 60%. A piece may carry no words; it is tape over the room.
- **Peeling them.** Each piece peels on its own.
- **They belong to the screen.** Pieces depend on a screen's width and fonts, so they are never saved. What is saved is
  in terms of the whole strip's length (Section 9), and each screen cuts that at its own line breaks.

## 3. The tape

**Decided** (the owner: "we need some texture to make it look more like real masking tape"; marker lettering, "Gochi Hand
is nice"):

- **Masking tape, drawn on a canvas, seeded by the strip** so every screen sees the same tape:
  - a beige-cream paper with slow variation along its length;
  - crepe: fine ridges across the width, each a little crooked, darker and lighter by turns;
  - faint fiber flecks;
  - factory-straight long edges, a touch darker, with a lit lip just inside the top one;
  - hand-torn ends, ragged and a little diagonal, slightly darkened, with loose fibers standing out of them;
  - a thin drop shadow, since tape lies flat;
  - a slight seeded tilt.
- **It is opaque.** Real masking tape is a little see-through, but tape that showed the words beneath would give away the
  hidden phrase.
- **The writing** is the replacement in **Gochi Hand** (SIL Open Font License), in near-black marker ink with a faint bleed.
  The face is vendored with the card, never fetched at run time. Its size is 1.3 times the board's text size times 1.02
  (the bench's figure).
- **Its colors.** The tape keeps its own colors on both boards, as today: it is one of the game's pieces laid on the 2003
  page. The ink holds 7:1 on the paper.
- **Drawn near the reader.** Until a piece's canvas is drawn, it shows a plain paper fill, so the words are never visible
  under it.

## 4. The residue

**Decided** (the owner: "When tape is peeled the adhesive beneath should look like real leftover adhesive, not just a
yellow highlight"):

- **Its shape and texture.** Residue is a tacky film in the tape's exact torn outline, uneven, thick here and thin there,
  from two scales of seeded value noise. The tape's crepe ridges are pressed into it. The film is thickest along the line
  where the tape's edge sat.
- **What is stuck in it.** A little seeded dust, and a few fibers of paper the tape left behind. Where the tape tore
  (Section 6), a small cluster of torn fibers is added at the tear.
- **It catches the light.** Residue has a gloss lit by the page's one light (`engine/ui/shine/light.ts`), so the sheen
  moves with scrolling, the pointer and tilt, as the foil does. That sheen is what makes it read as tacky.
- **Where it shows.** Only where a strip touched the post. Where a strip lay on another strip (Section 8), the glue is on
  that strip, so there is none.
- **Readability.** The residue's tint and gloss stay inside the board's readable band (`engine/ui/shine/band.ts`), so
  every post ink holds 4.5:1 over it at every light, on both boards. The bright Effects setting widens the band, as it
  does for the shine.

## 5. Who removes what

**Decided** (the owner chose C, "Aligns with whoops and the Lens keeps the joke accessible"): a reader peeks; the author
peels.

- **A reader** lifts a strip by an end to read under it, and it lays back down (Section 7). Nothing a reader does is kept,
  and no reader peels tape off any more.
- **The post's author** peels tape off for good, slowly (Section 6). The author's peels are saved and hold for everyone.
- **The author's other ways out** stay: editing the phrase away, which is one public edit. The Lens names every play's
  phrase, and History and a Quote always hold the author's words.

Weighed: Minus World's own behavior, where tape comes back on every load and a tap peels it (a toll on every read,
forever, and noise across a busy thread); a slow peel saved for everyone with no peek (a reader's only look would be the
author's work or History).

## 6. The author's peel

**Decided** (the owner: "It should feel like slowly peeling the tape away, rolling it up", and the bench's numbers, which
the owner accepted):

1. **Pick.** Press at an end of a piece, within the larger of 16px and 0.9 of its height, and hold for `pickMs` (450ms).
   A corner lifts as the hold goes on. Letting go before it is up drops the corner back.
2. **Pull.** Drag back along the strip. The peel line follows the hand, never faster than `pace` (90px a second). The tape
   peeled so far curls into a roll at the peel line, which grows as it takes up tape: its diameter is √(9 + 0.55 ×
   pixels rolled).
3. **Tear.** If the hand gets more than `give` (34px) ahead of the peel line, the tape strains: the paper whitens toward
   the line and the roll shakes. Strain builds at 1.2 a second plus (lag − give) / 30. When it is full the tape tears: the
   roll drops, the new end is ragged, and it must be picked again. Strain drains at 2.5 a second once the hand is back
   within `give`.
4. **Let go.** If you let go partway, the roll waits at the peel line. Grabbing it again carries on with no new pick.
5. **Drop.** When a piece is all peeled, or when it tears, the roll drops: a small hop, then a quick fall under gravity,
   turning as it goes, off the bottom of the screen in 260 + 13 × √(distance) milliseconds. It never drifts.
6. **Both ends work.** A piece can be peeled from either end, and from both, in turns.
7. **When it counts.** A strip is peeled once every piece of it is. Its residue then shows over the whole footprint.

`pace`, `pickMs` and `give` are card settings the screens read, replacing `autocorrect.peelMs`.

## 7. A reader's peek

**Decided:**

- **Lifting.** Drag from either end and the tape folds back from that end, as far as the hand has pulled. The words
  show where it has lifted.
- **How the lifted part looks.** It is a plane hinged at the fold and turned up toward the eye: nearly folded flat for a
  small lift, and nearly upright, at about 92°, once all of it is up. It is drawn in perspective, so its free end, nearer
  the eye, stands taller than the fold, by at most about half again. This is the owner's note: "the strip could use a bit
  of perspective while being lifted so it looks less like just a rectangle decreasing in width". Its sticky side faces
  up: lighter, with a gloss.
- **No residue under a peek.** The glue lifts with the tape.
- **Letting go.** When a peek is let go, it stays up for `peekStayMs` (300ms), then lays back down at `peekSettle` (300px a
  second). The owner: "300/300 does the job". Grabbing it again before it is down picks it up where it is, and the pull
  carries on from there. That is the owner's fix for a phone, whose short drags could not reach under a whole stack.
- **The keyboard.** Holding Enter or Space lifts at one piece's width every 0.45 seconds. Letting go lays it down the same
  way.

## 8. Stacks

**Decided** (the owner: "Coverage is working" on the bench's layered stack; peeking "in turn" was the default the owner
judged "working well"):

- **Layered tape.** Each strip is drawn over its own words and its own room, and the later play is stuck on top. Where
  strips overlap, the lower one's writing is hidden under the upper one, and the parts it does not cover still show, as
  real tape layered on a page does. This replaces the first design's one strip drawn over everything a stack covers.
- **The order of removal.** Only a strip with nothing over it can be picked, peeled or peeked. Pressing a covered strip
  says, in the bench's words, that another strip is stuck over it.
- **The author's peel is one layer at a time.** Each layer is its own slow peel and can tear on its own. Three stacked
  plays cost the author three peels.
- **A reader's peek lifts the layers in turn on one pull.** The top lifts first. Pulling on brings the strip beneath up
  after it, then the next, until the author's words show. "Beneath" means the strips of lower plays whose pieces overlap
  this piece on its line, highest first. Letting go lays them down in reverse, last lifted first. A deeper stack takes a
  longer pull, and is never a wall.
- **Residue between layers.** Where a strip lay on another strip, it leaves no residue (Section 4).

Weighed for the peek: the top only (a stack would have no way for a reader to reach the words, which the owner found on
the bench); every layer lifted together (simpler, but a stack would hide no more than one strip).

## 9. Saving the author's peel

**The session's recommendation, which the owner did not answer before asking for the plan; confirm or overturn it in the
design's review:** a half-peeled strip is saved, as the stretches of tape still stuck.

- **The saved state** keeps today's `peeled` (whole strips, by place) and `clean`. It adds `stuck`: for each strip that is
  partly peeled, the stretches of its length still stuck, as shares of the strip's length from 0 to 1, to 4 decimal
  places, with what each stretch's two edges are.
- **An edge is one of three kinds:**
  - the strip's own end;
  - a peel line, where the roll waits: its size is the peeled length on that side, and it needs no pick to carry on;
  - a tear, which needs a pick.
- **Any screen.** Shares carry over between screens: a phone and a desktop show the same half-peeled strip, each cut at
  its own line breaks.
- **Everyone sees it,** with the roll waiting at the peel line. It is the author's own act, made public, as every saved
  peel is.
- **What the rules check.** A strip in `peeled` has no `stuck` entry. Stretches are in order, do not overlap, and have
  positive length. A save holds at most 2,000 stretches, so the largest save fits `effect_state`'s 256 KiB bound,
  measured in `cards.test.ts` as Postgres writes it.
- **Saved states already held** (`{ peeled, clean }`) stay valid as they are.

Weighed: keeping a half peel only for the visit (simplest, but a long strip's ten seconds are lost on a reload); one share
per strip peeled from its start (it loses peels made from the far end and every tear).

## 10. Screen readers, the keyboard and quotes

**Decided by the session**, carrying the first design's section 6 and the quote contract (`engine/ui/thread/SelectionQuote.tsx`):

- **The overlay is for the eye.** The tape is drawn in a layer over the post's words. So that a screen reader and a quote
  read in order, each taped strip also has an anchor in the line, at the start of its words. The anchor is a button,
  visually hidden but focusable.
  - It is named "Autocorrected text: “Luigi”. Hold Enter or Space to peel it off for good" for the author, and "…Hold
    Enter or Space to lift it and read under it" for a reader.
  - It carries `data-kb-quotable="shown"` and the replacement's text, so a highlighted quote holds the replacement.
  - The words under the tape are `aria-hidden` and `data-kb-quotable="hidden"` while any tape covers them.
  - Focusing an anchor draws the focus ring around its pieces.
- **A covered strip's anchor** is out of the tab order until the strip above it is gone.
- **When a strip comes off,** the status region says what was under it ("Peeled. Under it: “Mario”."), and focus goes to
  the next exposed strip on the post, or to the post.
- **The keyboard path costs what the hand's does** ("An accessible path costs what the obstacle costs"). A held key picks
  for `pickMs` and peels at `pace`. It cannot tear, because it cannot go faster than the pace. Letting go keeps what is done.

## 11. Reduced motion

- **No falling, no shaking.** A roll that drops is gone at once, and a straining strip does not shake.
- **The same cost.** The pick, the pace, the peek and the stay are unchanged. A peek lays down at once when its stay ends.
- **The light rests.** The residue's gloss is held at the resting light, as the shine is.
- **A play's moment** (`still`) draws the tape as it landed, or as the author's saved peel leaves it, with no
  interaction and no light movement.

## 12. The Lens and the words

**Drafts, for the owner to approve in review** (the glass's plain words):

- **State.** "3 strips, 1 peeled" (for the author, "3 strips, 1 peeled, 1 started").
- **Ends.**
  - For a reader: "Lift a strip by one end to read under it; it lays back down. Only the post's author can peel strips
    off for good."
  - For the author: "Peel a strip off for good: hold one end until it lifts, then pull slowly. Pull too fast and it tears."
- **Each play's note.** "“Mario” → “Luigi”, 3 places", and a stacked play adds ", layer 2 of 3".
- **Progress** for the author is the share of all strips' length peeled; a reader's view has no edge.
- **The card's hint** becomes "Lift a strip by one end to read what is under it."
- **The card's description:** "Any reader can lift a strip by one end to read under it, and it lays back down. Only the
  post's author can peel strips off, slowly, for everyone, and the author's words are always under the tape and in the
  post's History."
- **The log.** It keeps "Strips peeled" and "Peeled clean". A save with a half-peeled strip adds: "You peeled N of its
  strips, and started on M more."

## 13. The engine and the instance

- **Instance** (`instances/divided-world/cards/autocorrect/`): everything in Sections 1 to 12 that names tape. That is the
  footprint and pieces model, the paper, the residue, the peel and peek, the drop, the saved state and its bounds, the
  vendored face, and the words.
- **Engine, two small interfaces, each naming no card:**
  - **A run's trail** (`engine/ui/bbcode/layers.tsx`, `render.tsx`). A `TextRun` may give `trail`, which the renderer draws
    once, right after the run's last piece, inside the same formatting. This is how a strip's room follows its words in
    the line.
  - **A quiet shine host** (`engine/ui/shine/loop.ts`). `register`'s options take `quiet: true`: the host is drawn by the
    loop and lit by the light, but it never counts as a shiny post for `watchShinyInView`. So the residue's gloss never
    brings up the tilt tip.

## 14. The masks

Nothing this adds reads who owns anything.

- The footprint and the pieces read the post's public words and the plays' public configurations.
- The author's partial peel is a save by the post's author, public as every effect state is.
- A peek is never sent anywhere.
- Whether the reader is the author is the screen's own `reader.author`, computed on the reader's screen from their own
  characters, as today.

## 15. Ways out

| State | Way out |
| --- | --- |
| A strip covering words | A reader peeks; the author peels it off; the author edits the phrase away; Quote, History and the Lens show the words. |
| A strip under another strip | A reader's peek lifts it in turn; the author peels the one above first. |
| A torn strip | Pick the new end and go slower; the keyboard cannot tear. |
| A half-peeled strip | Its roll waits; pick it up again, today or after a reload. |
| A peek too long for one drag | Grab it again before it lays down; or hold a key. |
| The play | A finished Act, with no state that traps anyone. |

## 16. A busy instance

- **Matching** is unchanged: once per decision on the server, and once per render of an autocorrected post's words on
  the screens.
- **Layout.** The pieces are measured from the line boxes once per layout (mount, resize, fonts ready, a new version of
  the post), never per frame. During a peel or a peek only the pieces in hand are redrawn.
- **Drawing.** A piece's paper canvas and its residue film are drawn when they first come within a margin of the viewport,
  through the shine loop's in-view watching. A page of 50 autocorrected posts draws only what is near the reader. A film is
  W × H pixels at density 2, once per piece.
- **The gloss** rides the shared shine loop as one quiet host per post with residue, at a share of 0.5. A still light
  draws nothing.
- **The saved state** stays one `effect_state` row per play. Its largest is bounded (Section 9).

## 17. What it changes for plays already held

No migration and no SQL change. Configurations are unchanged. Saved states in the old shape are valid in the new one.
`autocorrect.peelMs` leaves the instance's card settings, and `pace`, `pickMs`, `give`, `peekStayMs` and `peekSettle` come
in.

## Open

- **The card face** (`instances/divided-world/ui/cards/autocorrect/art.svg`) is still "a strip of label tape, typed on".
  Matching it to the masking tape is a card-art question for the card template's sessions.
- **The marker's size** on the dark board and in the bright Effects setting is the bench's; the owner judges the shots in
  the build's review.
