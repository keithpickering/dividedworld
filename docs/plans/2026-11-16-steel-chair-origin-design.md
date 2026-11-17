Record, written 2026-11-16.

# Steel Chair in a spun thread's ORIGIN box: design

A design session with the owner, started from issue #768: six faults the owner saw on an iPhone (Brave, so WebKit) in
the ORIGIN box of a thread spun from a Steel Chair play on a one-character post. Its plan is
`docs/plans/2026-11-16-steel-chair-origin-plan.md`. The screenshots named here are in
`docs/research/2026-11-16-steel-chair-origin/`.

## 1. What was reproduced, and where

The owner's case was built as a story (a thread spun from a Steel Chair play on a post that reads "!") and opened at
390 by 844, density 3, in Playwright's WebKit (build 2359, with an iPhone's user agent) and in Chromium; then at 1440
wide in both; then the same post in its own thread, and a three-line post, live and as a moment. Playwright's WebKit
was available locally. It is not Safari on a phone: the same engine, on Windows, with other fonts. Nothing here was
seen on a real iPhone.

`as-found-webkit-phone.png` is the owner's screenshot again, and `as-found-chromium-phone.png` is the same picture in
Chromium. **None of the six faults is WebKit's.** Every one shows in desktop Chromium too.

| # | Fault | Whose it is | Root cause |
|---|---|---|---|
| 1 | The dent is an opaque white rectangle | The shading's own, shown by the ORIGIN box and by any card that wraps it | The shade and the light are opaque gray images laid on with `mix-blend-mode`. A blend takes its backdrop from the nearest stacking context. The box's area (`.kb-origin-area`) isolates and paints no ground of its own (the ground is `.kb-origin`'s, outside it), so the backdrop is empty and the image is drawn as it is: white. |
| 2 | The dent covers the band | The short post's, in a box with no least height | The dent is 129 px tall and the area 111 px when the run measures it. `hitZone` then puts the dent's center at the area's middle, so it leaves the area by 9 px at the top, over the band, and as much at the bottom. A post's body in a thread is never under 22.5em, and the effect was written against that. |
| 3 | The band's third line is cut | Not the band's | In both engines at 390 wide the band grows to hold its three lines (76.8 px) and every line is inside it. What cuts the line in the owner's screenshot is fault 2's block lying over the band's foot. |
| 4 | The dent is over the status line | The engine's moment frame, for every card | The line ("Steel Chair: Dented by a chair") is a moment's list of words, on a ground of its own over any effect. The dent passes under it, and with fault 1 that reads as a gap in a block. |
| 5 | A chair lies mid-box | The still run's, wherever a moment is shown | A moment's run measures the area once, when it mounts, and watches nothing. The moment's list of words is drawn one render later (the effect's own `show` causes it), the area grows by 28 px, and the layers and the floor stay where they were measured: 111 px tall in a 139 px area. |
| 6 | The dent's box is far larger than the words | The short post's (fault 2 again) | The dent's size comes from the area's width alone (at most 160 px, at most 60% of the width). Nothing sizes it to the area's height. The hit zone's widening itself keeps a dent inside an area that is big enough. |

Three things the reproduction found that #768 did not list:

- **Fault 1 shows in a thread, on a desktop, with no ORIGIN box:** Steel Chair and Feelin' Fab on one post
  (`as-found-with-feelin-fab-thread-desktop.png`). Feelin' Fab's words wrapper is a stacking context (`z-index: 0`)
  with nothing painted in it, so the dent is a white block that hides the words under it.
- **A dent can leave the area on a long post at a phone's width:** where the text is taller than a dent the throw aims
  at the text's box as it is, and a dent's center may fall within its radius of a border (7.6 px out at the left in one
  run).
- **In its own thread, on WebKit at a phone's width, the dent is right** (`own-thread-webkit-phone.png`): shaded, lit,
  no block. The words are not bent there, as PR #751 built it.

The experiment that confirms fault 1's cause: with the area given the box's ground and nothing else changed, the block
is gone inside the area and still white where it lies over the band (`experiment-area-ground-webkit-phone.png`).

## 2. The shading needs no blend

**Decided:** the shade is drawn as black with an alpha and the light as white with an alpha, laid on plainly. No
`mix-blend-mode` is left in the effect.

It is the same picture. Multiplying a post by a gray `g` gives `post × g`; black at alpha `1 - g` over the post gives
`post × g`. Screening a light `l` gives `post + l × (1 - post)`; white at alpha `l` gives the same. So flat metal is
alpha 0 and draws nothing over any backdrop, in any stacking context, in any browser, and the `@supports` fallback that
hid the shading goes.

What the blend also did was cap overlapping dents: the shade of two was the darker of them, not their product, so a
word is never darkened below half. Plain alpha would compound (two dents at their darkest would leave a quarter). So
the cap is done in the pixels: a dent that overlaps earlier ones is drawn from an image corrected against them. Where
the earlier dents' darkest gray at a pixel is `m` and this dent's is `g`, the image carries `min(m, g) / m`, so that
laid over the earlier ones the result is `min(m, g)`. The light is capped the same way against the earlier dents'
brightest. A dent that overlaps nothing uses its own image, kept per play as today.

Weighed and not chosen:

- **Give the box's area a ground.** One line of engine CSS, and it fixes the box. It leaves the white block wherever
  another card wraps the effect in a stacking context, which Feelin' Fab does today and any later card may. The
  effect would stay one wrapper away from hiding a post's words.
- **One composed image per layer.** The cap falls out of a per-pixel minimum, but the image is the box around all the
  dents, up to the area's size at twice the density, made again as each dent lands. Issue #755 already asks what a
  dent's images cost on the main thread.
- **An SVG filter or mask to turn gray into alpha.** It would keep the images as they are, and it rests on WebKit's
  filters on HTML content, which the effect already distrusts (`filterTrusted`).

**A build check holds it for every effect:** no CSS under the engine's or an instance's interface, and no inline
style, sets `mix-blend-mode`. An element that blends is right only while everything between it and an opaque ground
makes no stacking context, and a place that shows a post, or another card's wrapper, may make one.

## 3. The dent stays in the content area

**Decided:** a dent is never larger than the room it has, and its box never leaves the area.

- A dent's larger axis is at most 160 px, at most 60% of the width, and now at most the height it may land in: the
  area less the chairs' room, where that is at least 80 px, else the whole area.
- The dent's center is held at least its radius from each border in every case, the tall text's included.

This is what holds where no rule gives the area a height: a preview, Stick Around's view, a box narrowed after the
dent landed.

## 4. The box grows to hold a full dent

**The owner's choice** (mock A, `mock-a-box-grows.png`, over mock B, `mock-b-dent-shrinks.png`): on a tiny post the
box grows to hold a full-size dent; the dent is not cut down to fit a small box.

The effect already marks the content area it found (`data-dw-chair-room`) to give the chairs their room. The marked
area is now at least 237 px tall: a full dent (160) and the room (77). In a thread a post's body is already at least
22.5em, by the engine's own rule, and that stands. Section 3 is what happens where this cannot hold.

Weighed and not chosen: the engine giving every ORIGIN box a least height, as it gives a post's body, so that no card
is wasted on a one-line post there. It would make every plain box tall. The owner chose the growth for the dent; the
wider question is left open (section 8).

## 5. A still run keeps to the box it is in

**Decided:** a moment's run watches the size of its host and of the area, as a live run does. When the box changes
it is drawn again from the same seed, so the picture is the one that seed gives in the box as it now is: the layers
fill the area and the chairs lie on its bottom border.

A size observer is no input and no animation, so the still mode's contract (`EffectProps.still`) is kept.

The owner asked in this session whether a moment should be drawn still at all (section 7). This fix is right under
today's rule and goes with the still path if that rule changes.

## 6. A moment's own words: left as they are

The line under the post ("Steel Chair: Dented by a chair") is the engine's moment frame, drawn for every card, on a
ground of its own over any effect. With section 2 the dent passes under it as Whoops!'s ink does, and the line cuts a
strip through the dent (`mock-a-box-grows.png`).

The owner weighed changing it here ("There is already a Mark there to explain the effect, which speaks for itself
regardless. We'd be keeping it just to fit the rule when the rule itself might be flawed"), and then took it out of
this design: "remove 'Status line' from this plan and focus only on Steel Chair specifically, leaving the out-of-scope
concerns to the other design." So nothing in the engine changes here, and what a moment says under its post is
section 7's design to settle.

## 7. What the owner asked that is not designed here

"'As it landed's propensity to show a 'frozen' version of the effect may also be flawed. Part of an effect when it
landed is the way it can be interacted with at the time." The record's reason for the still mode is that a change
made in a moment has nowhere true to be saved; that is a reason to refuse saving, not to refuse input or motion.
Fifteen effects honor the still mode. The owner chose a design session of its own: issue #770. That design also
takes section 6's question, what a moment says under its post.

## 8. Open

- **Not seen on a real iPhone.** Playwright's WebKit showed the six faults exactly as Chromium did, and section 2
  leaves nothing that depends on the browser beyond a PNG's alpha. The owner looks at the built stories on a phone.
- **The band.** No fault was found in it, and this plan adds no test of the band's own, since it is the engine's
  and not Steel Chair's; the plan holds that no dent lies above the area's top. If the third line is still cut on the owner's phone once the dent stays in
  its area, that is a fault of the band's own and a new issue.
- **No spec runs in WebKit.** The story build does not parse in Playwright's WebKit when minified (issue #769), which
  is why neither Steel Chair PR was seen there. Whether CI should run any spec in WebKit is the owner's to decide.
- **A least height for every ORIGIN box** (section 4).
- **The 80 px** below which the room is given up (section 3) is this session's number; the owner judges it on the
  stories.
