# Autocorrect's feel: peek or peel, the buzz, unrolling, the corner and the glue

Record, written 2026-11-20. A design session with the owner, started from five notes on the Autocorrect tape as built:

- "continue allowing the temporary peek for the author after the 24hr timeout"
- "increase the time required for the corner peel to take effect, and maybe vibrate the phone slightly when it does (like a
  sponge scrub)"
- "when a roll is initiated, allow the strip to be unrolled as well, to restore the original state voluntarily"
- "consider a more realistic take on the corner peel (it doesn't match the actual corner of the tape)"
- "left-behind adhesive is too high opacity and looks a bit like tape itself more so than adhesive"

It refines `docs/plans/2026-11-11-autocorrect-tape-design.md` (the tape) and `docs/plans/2026-11-16-autocorrect-hold-design.md`
(the 24-hour hold). Every section of those still holds except where this one says otherwise. The plan is
`docs/plans/2026-11-20-autocorrect-feel-plan.md`. The owner judges the corner and the glue on the feel bench
(`docs/research/2026-11-20-autocorrect-feel-bench/01-bench.html`). Where this design and the bench disagree, this design wins on
what is decided and the bench on how it looks.

## 0. Where it starts

- **The author's hands only peel.** Outside the hold, `Hands.press` sends the author to `pressPeel` and never to `pressPeek`
  (`instances/divided-world/cards/autocorrect/hands.ts`). So once the hold is over, the author can no longer peek under their own
  tape without starting a permanent peel. A press away from an end does nothing.
- **The pick is 450ms** (`autocorrect.pickMs`), with no feedback at the moment it is up. Whoops! buzzes 8ms when its grab takes
  (`instances/divided-world/cards/whoops/Effect.tsx`).
- **A roll only goes one way.** A waiting roll can be grabbed to peel on, never pressed back down.
- **The corner** is a flat cream right triangle laid over the tape's top corner (`.dw-ac-corner` in `autocorrect.css`, drawn in
  `Effect.tsx`'s `Piece`). It ignores the torn end's ragged, slanted outline, and nothing lifts away under it, so the tape still
  shows where the corner has come up.
- **The glue is drawn at full strength.** The approved tape bench draws the film at 0.48 on the light board and 0.30 on the dark
  (`--res-opacity`), with a gloss only near the light (a radial highlight). The build's `Residue` lays the tint at 1 and the gloss
  as a flat warm-white layer over the whole film at 0.6. This is a porting slip, not a design choice. It is why the glue reads as a
  second layer of paper.

## 1. Peek or peel, by how the hand starts

**Decided** (the owner chose "drag peeks, hold peels" over a mode switch in the Lens and over a second grab that turns a peek into a
peel):

- **A drag peeks, for everyone.** Pressing a strip and moving starts a reader's peek (the tape design's section 7), whether or not the
  hand is the author's.
- **A held press picks, for the author.** The author presses within an end's reach (the tape design's section 6) and holds still. The
  corner lifts over `pickMs`. When the pick is up the device buzzes, and from then on the hand peels.
- **Moving first makes it a peek.** If the hand moves more than `slop` (8px) before the pick is up, the pick is dropped and the same
  press becomes a peek, lifted from where the hand went down. So the author's peek is a reader's peek, with nothing extra to learn.
- **The corner waits a moment.** The corner shows only after the first 150ms of a still hold, so a quick drag into a peek never
  flashes a corner.
- **A waiting roll needs no pick.** Pressing a roll that is waiting takes it in hand at once. A drag peels on or unrolls (Section 3),
  and never peeks.
- **During the hold** the press never picks. The author's hands are a reader's, as the hold design says. Its section 4's words about
  the hold stay.
- **A reader's held press** does nothing until the hand moves. Then it is a peek.

## 2. The pick: a second, and a buzz

**Decided** (the owner chose 1000ms over 800ms and 1500ms):

- `autocorrect.pickMs` goes from 450 to **1000**. Its bound (0 to 2000) is unchanged.
- **The buzz.** When the pick is up, `navigator.vibrate(8)`, as Whoops!'s grab does. A device that refuses is ignored. iOS Safari
  gives web pages no vibration, so an iPhone gets the corner standing up and no buzz. The bench offers 8, 15 and 25ms and a
  10-40-10 pattern for the owner to feel. 8ms stands unless the owner picks another on the bench.
- **The keyboard** has no buzz. The corner is drawn as the pointer's is, and the status region says "Picked. Keep holding to peel."
  once the pick is up.

## 3. Unrolling

**Decided** (the owner chose "paced like the peel" over a free unroll and over one that leaves a visible crease):

- **What it is.** A roll in hand follows the hand back the way it came, and the tape it takes up goes down on the post again. The
  re-stuck tape looks as it did before it was peeled. Its residue is covered again, and the marker's words are whole.
- **Its pace** is the peel's `pace`: the line moves toward the hand at no more than 90px a second.
- **It never tears.** Pressing tape down cannot tear it, so a hand that runs ahead of an unroll only waits for it. Strain does not
  build, and it drains as it does today.
- **How far it goes.** A roll holds only the tape it took up since it last fell. It unrolls back no further than the nearest of three
  places: where a roll last fell on that side (a tear, or a finished piece of the strip), the stretch of tape before it, or its piece's
  end. Tape that fell never comes back.
- **When it is all back.** A roll unrolled to its strip's own end leaves that end as it was (kind 0). A strip whose every stretch is
  back with no gaps has no `stuck` entry, so it is the play as it landed.
- **When it counts.** Every unroll is the author's save, public and kept as every peel is (the tape design's section 9). It is held
  by the 24-hour hold as any save is.
- **The keyboard.** Holding Backspace on a strip's anchor unrolls its waiting roll at `pace` (the first one, in reading order, when
  the strip has more than one). With no roll waiting, it does nothing, and the status region says "Nothing to press back down."

## 4. What the save adds: where rolls fell

**Decided by the session**, because unrolling needs it:

- **The gap.** Today the saved state cannot tell tape on a waiting roll from tape that fell at a tear. `Hands.waited` measures a roll
  as the whole gap to the stretch before it, which would let an unroll bring back torn-off tape.
- **`drops`.** The save adds `drops`: for each place in `stuck`, the shares where a roll fell, in order, to 4 decimal places. A tear
  adds its share. A finished piece adds the share of its far end. This holds on every screen, because a finished piece on one screen's
  line break is a share on all of them.
- **The rules check** that a place in `drops` is in `stuck`, and that each share is in [0, 1], rounded, increasing and not inside a
  stuck stretch. `drops` and `stuck` share one bound, `STUCK.most` (2,000 entries in all), so the largest save still fits
  `effect_state`'s 256 KiB.
- **Saves already held.** Saves without `drops` are valid and mean no drops. A strip half-peeled before this ships unrolls as far as
  today's gap. That can restore tape that fell at a tear made before this ships. With no players, that is accepted.

Weighed: a root number on each peel-line edge of a stretch (`[from, to, edges, startRoot, endRoot]`, which widens every stretch for a
fact only peel lines have); saving the roll's length (which depends on the screen's piece widths, which are never saved).

## 5. The corner: a fold, not a triangle

**Decided** (the owner chose the diagonal fold; the bench shows it at several picks):

- **The crease.** A pick folds the end back along a crease. It starts as a line at 45° across the corner, a third of the tape's height
  in, at the end the hand picked. As the pick goes on, the crease moves in and stands upright (smoothstep in the pick), so that when
  the pick is up it runs straight across the end. That is the peel line the roll then starts at.
- **The fold.** Everything on the corner's side of the crease turns about it, by an angle that grows from 110° to 150°. Seen from
  above, a point `d` from the crease lands `d · cos(angle)` from it. Past 90° that lies back over the tape. The fold is the tape's own
  outline, ragged torn end included, so its edge matches the end it came from.
- **What shows.** The fold shows the tape's sticky side: paler, smoother, the crepe faint, no fibers, with a sheen. It darkens toward
  the crease. It casts a soft shadow that grows with the pick, and a thin lit line runs along the crease.
- **Under it.** Where the fold came up, the tape is gone and the post's words show, as a peek shows them. The glue lifts with the tape
  until the pick is up, so no residue shows there.
- **Letting go early** lays the fold back down at once, as the triangle drops today.
- **Reduced motion** draws the same fold. It is a still shape that follows the hold, not an animation.

## 6. The glue

**Decided in direction** (the owner: "too high opacity and looks a bit like tape itself"). The strength is the owner's pick on the
bench:

- **The film's tint** is laid at a strength per board, `RESIDUE_TINT[board]`, and no longer at 1. The bench offers the approved
  tape bench's 0.48 / 0.30, a lighter 0.30 / 0.20 and a faint 0.18 / 0.12. **The session's recommendation is the lighter one**, which
  the plan uses unless the owner picks another.
- **The gloss** is the tape bench's radial highlight. It is centered where the page's light falls on the post (the light's `x`, `y`
  over the post's box, as the shine places it), and its radius is 150px. It goes from white at 0.9 to clear at 72%, laid at
  `GLOSS_ALPHA` per board (0.5 light, 0.12 dark). It is no longer a flat layer over the whole film. It stays what makes the film read as
  tacky: it moves with the light.
- **Readability.** A thinner film only moves the post's ink further inside the readable band. The band check
  (`residue.test.ts`) composites at the new tint strength times `FILM_PEAK`, and at the gloss's peak.
- The film's texture, outline, crepe, edge line, dust and torn fibers are unchanged.

## 7. Words

Drafts, for the owner to approve in review (the glass's plain words):

- **The Lens's ends for the author** (out of the hold): "Drag a strip by one end to read under it; it lays back down. To peel it off
  for good, hold one end still until the corner lifts, then pull slowly. Pull too fast and it tears. Push a roll back to stick the
  tape down again."
- **For a reader**, unchanged.
- **For the author during the hold**: "Stuck on for 5h 12m. Until then, drag a strip by one end to read under it. After that you can
  peel strips off for good: hold one end still until the corner lifts, then pull slowly."
- **The anchor's name for the author** (out of the hold): "Autocorrected text: “Luigi”. Hold Enter or Space to lift it and read under
  it. Hold Shift with Enter or Space to peel it off for good. Hold Backspace to press a started peel back down." During the hold, the
  hold design's name stands.
- **The card's description** gains, after "Only the post's author can peel strips off, slowly, for everyone": " and press a started
  peel back down".
- **The log** is unchanged. A save that re-sticks tape is still the author's save of strips peeled and started, so "You peeled N of
  its strips, and started on M more." stays true of the state it describes.

## 8. Keyboard and screen readers

- **Enter or Space held** peeks, for everyone (the tape design's section 10 lift).
- **Shift with Enter or Space held**, for the author out of the hold, picks for `pickMs` and peels at `pace`. As today, it cannot tear.
- **Backspace held** unrolls at `pace` (Section 3).
- **The accessible path costs what the hand's does.** The pick is the same second. The unroll is the same pace.

## 9. The masks

Nothing here reads who owns anything.

- The buzz is the author's own screen answering their own hold. Nothing is sent.
- `drops` is the author's save, public as every effect state is.
- A peek is never sent, the author's included.
- Whether the hand is the author's is the screen's own `reader.author`, as today.

## 10. Ways out

| State | Way out |
| --- | --- |
| A pick being held | Let go: the fold lays down. Move: it becomes a peek. |
| A roll waiting | Pick it up to peel on; push it back to stick the tape down; or leave it, today or after a reload. |
| Tape that fell | It is gone, as today. The words under it show, and the Lens, History and Quote hold them. |

Every way out in the tape design's section 15 and the hold design's section 5 is unchanged.

## 11. A busy instance

- **The fold** is drawn only on the piece in hand, on the frames of a pick. No other piece's drawing changes.
- **The gloss** is one radial gradient per region laid, on the shared shine loop, as the flat layer was. It costs no more.
- **`drops`** adds at most one share per drop. It shares the save's existing bound, and the largest save is measured in
  `cards.test.ts` as before.

## 12. What it changes for plays already held

No migration and no SQL change. Configurations are unchanged. Saved states without `drops` stay valid (Section 4). The deployed
settings row's `autocorrect.pickMs` is 450 until the release's seed sets the new default. The seed adds only missing keys, so an
instance that has the key keeps 450 until an admin changes it. The plan says so in the release notes.

## Open

- **The buzz's length**: 8ms unless the owner picks another on the bench.
- **The glue's strength**: the lighter variant unless the owner picks another on the bench.
- **Shift and Backspace** are the session's choice of keys. The owner confirms them in review.
- **iOS** cannot buzz from a web page. The pick's feedback there is the fold alone.
