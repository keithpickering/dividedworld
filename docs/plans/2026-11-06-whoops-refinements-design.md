# Whoops! refinements: design

Record, written 2026-11-06. A design session with the owner, started from five notes on Whoops! as it renders in a real
post: the suds, the reactions row, a cursor hint, the splat's sharp corners, and the post's text at phone width. Its
plan is `docs/plans/2026-11-06-whoops-refinements-plan.md`. The owner approved the look in an interactive mockup, the
Whoops! bench (`docs/research/2026-11-06-whoops-bench/01-bench.html`), and tested it on a Pixel 8 with no lag. Where this
design and the bench disagree, this design wins on what is decided and the bench on how it looks and moves.

## 0. Where it starts

- **The fixed layout.** While a post is splatted, its body is laid out at a 988px reference width (`REF_WIDTH` in
  `instances/divided-world/cards/whoops/scrub.ts`, the post body at the board's 1200px) and scaled down as a whole to the
  frame (`layoutOf`). The point was that line breaks stay the same everywhere, so a saved stroke lands on the same words.
  On a 390px phone the scale is about 0.39, which puts the board's 15px type at about 6px. The owner chose this knowingly
  on 2026-10-30 (`docs/plans/2026-10-29-screens-cards-plan.md`, the amendments of that date). Seen in a real post, it is
  the effect's biggest problem.
- **The promise it was for was never kept.** The board's body font is `Verdana, Geneva, sans-serif` with no web font
  behind it (`engine/ui/tokens.css`). Android and most Linux machines have no Verdana, so a splatted post already breaks
  its lines differently there.
- **The splat** (`splat.ts`) is a 160-point outline with harmonic lumps, random jitter and a clamp, plus arm beads and
  droplets drawn as whole circles. The jitter and the clamp leave small kinks, and where a bead's circle meets the
  outline the union has a sharp inside corner.
- **The suds** are white `<span>`s with a 1px ring, thrown out and shrunk over about 0.7s by the Web Animations API.
- **The reactions row and the spun line** (`.kb-act-main > .kb-reactions`, `.kb-spun`) are lifted over the ink by
  `engine/ui/thread/thread.css`. Both are block-level, so their empty space beside the chips sits over the ink. They are
  also siblings of the effect, outside its frame, so a press there never reaches the effect at all.
- **Touch.** The frame has `touch-action: pan-y pinch-zoom`. Once the browser reads a drag as vertical it scrolls and
  cancels the pointer, so a wipe with any up-or-down movement dies partway. The owner hit this on the bench, and the
  live effect has the same setting.

## 1. The layout: real-size text, with the ink fitted to the body's box

**Decided.** A splatted post's words are laid out like any other post's, at their natural size and width, on every
screen. The fixed reference layout and its scale-down go away (`REF_WIDTH`, `BODY_GUTTER`, `MAX_SCALE`, `layoutOf`,
`toLayout`, and the layout's inline width, transform and padding).

The ink lives in **the body's box**:
- **In the thread,** the box is the post body's padding box (`.kb-act-main`), border to border and bar to bar, as the
  ink covers it today.
- **In the ORIGIN box,** the box is the effect's own frame, as today.

Every position the effect keeps is a share of that box, across from 0 to 1 and down from 0 to 1: the splat's place, the
strokes' points, the sweep's bands, the lines of text. Each screen maps those shares onto its own box.

**What this gives up, and the owner accepted it.** The same saved stroke no longer lands on the same words on every
screen. The owner's reasoning:
- People often wipe a *drawing* into the ink, and a drawing scales cleanly when it is fitted to the box.
- Uncovering specific lines of text was never an expectation of the "legacy" feature on Minus World.
- Fonts already break the promise, as section 0 says.

**Alternatives weighed:**
- **A narrower reference layout of about 640px** (rejected). Desktop text at its real size in a narrower column, phone
  text at about 9px. It makes the problem smaller instead of removing it.
- **The ink following the words** (rejected). Every screen lays out naturally, and each line of text carries the strip
  of ink that lay over it in the reference layout, so a saved stroke uncovers the same words everywhere. On a phone the
  splat would arrive cut into strips, which ruins drawings. It is the most engineering of the three and is still
  defeated by font differences.
- **Lifting the post into a full-screen view on a phone** (rejected). Reading a splatted post would always cost a tap
  and a pan.

**Fixed-width board breakpoints** (about three widths instead of every pixel from 320 to 1200) were raised by the owner
as an option for this effect and others. Whoops! does not need them under this design, since it fits any box. They
would change every screen, so they are their own design session if a later effect wants them. Open; see section 11.

**How the body's box can change.** The box is the body as it stands, so anything that changes the body's height
stretches the ink and the strokes with it:
- an edit that reflows the text;
- the spun line appearing under the reactions.

This is the model the owner chose: the ink is fitted to the body. It is not a defect, and the plan's tests pin it.

## 2. The splat: metaballs, kept round, over the whole body

**Shape: a field of balls (metaballs).** A splat is a list of balls, each a center and a radius. Its ink is wherever the
balls' summed field reaches a threshold. Each ball contributes `(1 − d²/R²)³` within `R = 2r`, and the threshold is
`0.42`, so a lone ball's edge sits at its radius `r`. Where balls are near each other their fields add, so every join
is rounded: body to arm, bead to bead, arm to bulb. Only droplets stand apart, and they are round. This replaces the
outline and circles. The seed is still the server's, and `mulberry32` is unchanged. The layout of the balls is the
bench's `makeSplat`, as the owner approved it on its last version:
- a core ball and six inner balls;
- a ring of fifteen balls whose distance from the center swells and shrinks with five harmonics;
- 9 to 15 arms of ten shrinking beads, each ending in a bulb, with one to three droplets beyond;
- 5 to 11 small flecks scattered round.

These shapes are generated in a design box 1.25 wide by 1 tall.

**Kept round (the owner's choice).** A ball's center is placed by shares of the box, so the splat's spread fits the body
on every screen. Its radius is measured in pixels of that screen, scaled with the box's area: a design unit is
`√(W·H / 1.25)` px. So a droplet is round on every screen, and the splat never looks stretched. The owner: "the spirit
is the same between screen sizes and it doesn't look visibly stretched, which makes it more realistic and immersive
overall."
- **What it costs.** The outline differs a little between screens: a tall phone body spreads the same balls further
  apart than a wide desktop one. Nothing that crosses screens depends on the outline. Only the saved strokes and the
  clean mark travel (section 4).
- **Alternative weighed: stretched with the box** (rejected). One shape everywhere, but droplets turn into ovals on a
  wide desktop body and the whole splat stretches tall on a phone.

**Coverage: the whole body (A).** The splat is generated for the whole box and covers it, however tall. That is how
Minus World inks a post. The owner likes this splat better than Minus World's "nickelodeon splat". Long posts are already
guarded by price: Whoops! charges 0.25 Aura per 500 characters of the post, capped at 3.00 in all (`whoops.playPrice`).
- **Alternative weighed: keep today's band at the top** (rejected). Only part of the post could be drawn on, and that
  part's proportions would change with the screen.
- **Alternative left open: a looser splat on long posts** (B; the owner doesn't dislike it). More arms and droplets as a
  post gets longer. If it is ever built, it must key on something every screen shares, such as the post's character
  count when the card was played. It must never key on the box's on-screen proportions. See section 11.

**Painting: wet ink.** The splat is painted from its field, pixel by pixel, as the bench does (`renderSplat` there):
- **The edge** is anti-aliased from the field's signed distance: `(v − T) / |∇v|` px.
- **The meniscus** is a surface height that rises over about 3.5 CSS px from the edge and is flat inside.
  - Its normal is lit from up and to the left.
  - That gives a bright rim and a specular glint on edges facing the light, and a darker rim on the far side.
- **Pale inks** get a darker rim, scaled by the ink's luminance, so white or yellow ink still has an edge on a white page.
- **On top** comes a broad wet gloss toward the upper left (stronger on dark inks) and a slightly darker underside.

The numbers are the bench's, as it was approved. `shading()` and its luminance rules stay. The play form's preview
(`ConfigForm.tsx`) draws the same painter on a small canvas in place of its SVG path.

## 3. Strokes, as the card keeps them

A stroke is kept in shares of the box it was made in, with that box's proportions, so a round brush on the drawer's
screen is the same ellipse, in shares, on every screen:

```ts
type Stroke =
  | { tool: 'wash'; width: number; aspect: number; points: [number, number][] }
  | { tool: 'ink'; color: string; width: number; aspect: number; points: [number, number][] };
// width:  the brush's diameter as a share of the box's width, (0, 1]
// aspect: the drawer's box width over its height, kept to three significant figures, [0.001, 1000]
// points: across 0 to 1 and down 0 to 1, kept to a ten-thousandth
```

On a screen whose box is `W × H` px, a stroke's brush is an ellipse with these radii:
- across: `width / 2 · W` px
- down: `width / 2 · aspect · H` px

On the drawer's own screen both come to `width / 2 · W`, so the brush is round there.

`STROKES.widest` becomes 1 and `STROKES.deepest` becomes 1. Points are kept to a ten-thousandth because a share of a
tall phone body needs it: a thousandth of a 20,000px body is 20px, and a ten-thousandth is 2px. Counts stay (200
strokes, 500 points each, 12,000 points in all). The largest save must still fit the database's bound
(`effect_state.state` at 256 KiB, `supabase/migrations/0006_cards.sql`), and `cards.test.ts` measures it as Postgres
writes it. A ten-thousandth costs the same characters as today's "63.988" did, so it is expected to fit. If it does
not, the plan's task lowers `STROKES.totalPoints` until it does and says so.

**Strokes saved before this are not converted.** No instance is deployed and there are no players (CLAUDE.md, "Nobody
is waiting on a hotfix"). A saved stroke with no `aspect`, or with a point past 1 down, is dropped when read, as a
malformed stroke is today (`savedOf` in `Effect.tsx`). The card refuses it on save (`validateState`).

**The brush** stays the size it is on screen: 30 CSS px wide (`BRUSH`), the author's pen 0.3 of that. Each is turned
into a share of the box's width when the stroke begins. The sweep's brush is 1.15 rows (`SWEEP_BRUSH`). A row is the
board's line: 22.5px at its 15px type.

## 4. The model on each screen

The layer model stays geometry, never a read of pixels (`LayerInk` in `scrub.ts`). It is now built for one screen's box:
- **`covers(splat, box, x, y)`** evaluates the field at a point. It costs a pass over the splat's balls (about 150) and
  is memoized by point, as today.
- **The grid** that counts the washed share is spaced in CSS px: 12.5px, as today's `CELL` was at the reference width.
- **A stroke's segments** are tested as ellipses: the distance is measured after scaling across by `1/rx` and down by
  `1/ry`.

What follows from a per-screen model:
- **The washed share** is each screen's own. For the same strokes it is close everywhere, and not exactly equal. That
  matches what a reader sees: their own screen's ink.
- **Clean** is decided where the strokes are made, at the instance's share (`whoops.clean`, 95 by default). The author's
  clean mark is saved and clears the layer for everyone, as today. A reader's is their own.
- **The lines under ink** are read from the post as it is laid out on this screen (`readLines`, at scale 1, in shares
  of the box), so what a screen reader is given matches what the eye sees there.
- **The sweep ("Hold to scrub")** keeps its pace: 0.55 of the box's width a second across, so a line takes a little
  under two seconds, as a hand does. Its bands are the body's rows on this screen, each 22.5px. The accessible path
  costs what the obstacle costs (CLAUDE.md, "An accessible path costs what the obstacle costs"). It never clears a
  layer at once.

## 5. The surface: the whole body is wipeable, and what is lifted stays usable

**In the thread, the effect takes its pointer and touch input on the post body (`.kb-act-main`), not only its frame.**
The effect already finds that cell to measure it. So a press beside the reactions, on the tag's row, or in the body's
gutters reaches the effect wherever there is ink. In the ORIGIN box the surface is the frame, as today.

**What the engine lifts over the ink is marked for any effect to respect.** The engine adds `data-kb-over-ink` to the
reactions row (`Reactions.tsx`, where `look` is the board's) and the spun line (`SpunInto.tsx`). `thread.css` lifts
`.kb-act-main [data-kb-over-ink]` over the ink by that attribute. The effect starts no stroke on an element inside one.
- **Engine side:** this is the interface, named for what it means.
- **Instance side:** the effect never names the engine's classes for reactions or spun threads.

**Each lifted element is as wide as its content.** `width: fit-content; max-width: 100%` on both. Only the chips, the
React button and the spun line's words are in front of the ink. The rest of their row is wipeable.

**Links and buttons in the post's own words** are under the ink while ink covers them. A press on ink there starts a
stroke and swallows the click, as today. Once washed off, they work as usual.

## 6. Touch: hold to wipe, swipe up or down to scroll

On a touch screen the effect reads a finger by touch events, so it can refuse the page's scroll while there is still time.
A press that starts on ink goes one of these ways:
- **A quick swipe up or down** moves past 8px mostly vertically before 180ms. The page scrolls, and nothing is washed:
  no dab is left where the swipe began.
- **A sideways swipe** moves past 8px mostly sideways. It wipes, and keeps wiping in any direction until the finger
  lifts.
- **Press and hold for 180ms.** The ink is grabbed: a puff of suds, and a short vibration where the device allows it
  (`navigator.vibrate(8)`, which may be refused). Then it wipes in any direction, and the page does not scroll.
- **A tap** washes one dab, as a click does.
- **A second finger** is the page's: a pinch or a scroll. A wipe already under way stops where it got to.

Once a press becomes a wipe, the touch-move handler cancels the page's scroll for the rest of that touch. The handler is
not passive, so this works on Chrome for Android and on iOS Safari.

**The way out (CLAUDE.md, "No player is ever stuck").** A tall post on a phone can fill the screen with ink. The quick
vertical swipe is the reader's way past it, and it never washes anything.

The bench was tested with simulated touches on an emulated Pixel 7:
- A quick swipe scrolled 204px and washed nothing.
- A hold, then a downward drag, washed and did not scroll.
- A sideways swipe washed.

The owner then used the bench on a Pixel 8.

## 7. The suds

Each post draws its own suds on a canvas inside its body, above the ink and under what is lifted, so the suds scroll
with the post. A layer pinned to the window and repositioned to follow posts broke inside a phone's frame and left the
suds stuck on the screen. Nothing is drawn while a post has no suds, and the canvas exists only while the post's ink
does (near the viewport, section 9). Five kinds, all from the bench's numbers:

- **Bubbles.**
  - Look: a clear center, a bright rim with a thin-film rainbow that turns over time, a dark hairline so they read on
    white, and a specular glint with a smaller one opposite.
  - Movement: they drift up and wobble.
  - End: about two thirds pop into a ring and a little spray, and the rest fade.
  - Rate: about one per 16px of brush travel.
- **Lather.** Clusters of three to seven small foam cells along the stroke, tinted with the ink where they formed over
  ink. Each cell breaks up at its own time over about 2.2s, and the cluster sags a little.
- **The wet sheen.** The washed path holds a translucent film of dirty water (the ink thinned into grey-blue) that
  dries over about 0.6s.
- **Running drips.** Drops of dirty water that run down the post from the brush, slowly speeding up and leaving a
  trail. **At 2× the bench's first rate** (the owner's choice): a chance of `2 × travel / 140px` per move over ink, and
  0.35 of that off it.
- **Sponge drips.** From the cursor (section 8), at 2× too.

Pre-rendered sprites keep it cheap: twelve bubble frames, a foam cell, and a drop, each in its plain and ink-tinted
versions. Particles are capped at 900 on a page; past the cap the oldest lather goes first. **Reduced motion** draws no
suds and no drips, as today, and the wash still works.

## 8. The cursor: a dripping sponge over wipeable ink

**Only for a mouse on a device that can hover** (`(hover: hover) and (pointer: fine)`, and the pointer's type is
`mouse`).

- **Over ink a stroke would take,** the system cursor is hidden and a drawn sponge follows the pointer. The sponge is
  yellow cellulose with a green scour pad, pores, a highlight and a line of foam along its bottom edge, tilted 12°. It
  is the bench's SVG.
  - It squishes while pressed.
  - It sheds drops that fall and fade: about 1.8 a second at rest, more as it moves faster and while pressed.
- **The normal cursor everywhere else:**
  - over anything marked `data-kb-over-ink`;
  - over a link or button the wash has uncovered;
  - over washed areas and margins.
- **The author's "Write in ink" tool** shows a drawn felt-tip pen in the layer's ink in place of the sponge. It is not in
  the bench; it is drawn in the sponge's style.

A drawn cursor is chosen over a CSS `cursor: url(…)` image because browsers do not animate cursor images, so a cursor
image could not drip. The cost is that the drawn cursor trails the system cursor by about a frame. One sponge, one pen
and one drips layer (a canvas fixed to the window) serve the whole page. They are made the first time they are needed
and removed when no post needs them. The sponge's own drips fall freely, so they are the one thing drawn in window
coordinates.

## 9. What a post costs a page

The ink canvas now covers the whole body, not a band, and a long phone post is a tall canvas. Every canvas is still drawn
only for a post near the viewport, and dropped when it leaves (as today). Beyond that:
- **The pixel density is capped at 2,** and lowered further so that no post's ink canvas holds more than 4 million
  pixels (`dpr = min(2, screen, √(4,000,000 / (W·H)))`). The ink's edge is soft, so the loss is not seen.
- **Each layer's painted splat is cached at CSS-pixel density** (at most one pixel per CSS px) while the post is near.
  The washes are cut from it into the one shared scratch canvas, as today, so three layers never hold three
  full-density canvases.
- **The field** is computed once per layer per box size, with each ball touching only the pixels within its reach.
  This is not per frame.
- **At a busy instance's scale** (CLAUDE.md), many splatted posts hold nothing beyond what is near the viewport, and one
  particle pool serves them all.

## 10. The rules

- **Masks (CLAUDE.md, "A response never proves a private fact").** No response, payload, Realtime event or timing is
  added. The saved state gains `aspect`, which comes from the author's screen: the proportions of the post body on the
  device the author washed on. It says nothing private. Who reacted and who owns what are not read.
- **Ways out.** No new state is added for a character or a post. The touch rule's quick vertical swipe is the reader's
  way past ink that fills a phone screen (section 6). A splat ends as it does today: washed clean on the reader's
  screen, by the author for everyone, or by an admin's "End this card".
- **The fiction and the log.** Nothing in the log changes. The Lens's words are unchanged.
- **Accessibility.**
  - Hold to scrub keeps its pace (section 4).
  - Reduced motion drops the suds, the drips and the fade, never the wash.
  - The sponge is a hint for a mouse and nothing else: a keyboard or touch reader loses nothing.
  - The reactions and the spun line stay in front of the ink and fully usable.
- **The layers (CLAUDE.md, "KayfaBB never knows which instance it runs").**
  - Engine: `data-kb-over-ink` on the reactions row and the spun line; `thread.css` lifting by it and fitting both to
    their content; and the comments that named the fixed layout (`tokens.css`, `thread.css`).
  - Instance: everything else, in `instances/divided-world/cards/whoops/`.
- **Append-only.** A layer's saved state is a row of its own (`effect_state`), outside the Act, as today. Nothing here
  changes an Act.
- **American English** for every word a player reads.

## 11. Open

- **A looser splat on long posts** (section 2, B). Not built. If wanted, it keys on the post's length when played.
- **Fixed-width board breakpoints** (section 1). Not needed by Whoops!. A design session of their own if another effect
  needs them.
- **Drawings stretch when the body's height changes** (section 1). Accepted as the model. If it bothers players once
  there are some, the remedy is a design question, not a defect.
