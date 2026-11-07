# Shine: Feelin' Fab and Glitter Bomb as materials

Record, written 2026-11-06. A design session with the owner, started from the owner's wish to give Feelin' Fab and
Glitter Bomb the realistic, physical look the Whoops! refinements gave Whoops!
(`docs/plans/2026-11-06-whoops-refinements-design.md`), and to share a particle system between them. The plan is
`docs/plans/2026-11-06-shine-plan.md`. The owner approved the look in an interactive mockup, the Shine bench
(`docs/research/2026-11-06-shine-bench/01-bench.html`). Where this design and the bench disagree, this design wins on
what is decided and the bench on how it looks and moves.

## 0. Where it starts

- **Feelin' Fab** (`instances/divided-world/ui/feelin-fab/`) is a CSS gradient slid by the compositor behind the
  words. Level 1 cycles one stop at a time, level 2 is a linear rainbow and level 3 a radial one, with 4, 8 or 10 SVG
  four-point stars pulsing in place (`docs/plans/2026-11-02-onboarding-design.md`, section 5). Its palettes,
  `FAB_STOPS` (pastels under black text, deep colors under white), are held to 4.5:1 against every post ink by
  `stopsAreReadable`. One shared IntersectionObserver (`inView.ts`) pauses it out of view.
- **Glitter Bomb** (`instances/divided-world/ui/glitter-bomb/`) is 22 CSS-clipped stars in gold, pink and cyan,
  twinkling in place, the whole layer drawn at `GLITTER_ALPHA` (0.28) so it stays readable.
- **Shared today:** only `seeded.ts`, the seeded generator both place their decoration with.
- **No particle system exists on main.** The Whoops! build in progress (branch `ccr-f283e9c1-0jnt2p`) adds one for its
  suds, `instances/divided-world/cards/whoops/suds.ts`: a page-wide pool, `register(host, canvas, box, density)`, one
  animation loop started on demand and stopped when nothing is left to draw, a particle cap, a per-host draw that cannot
  stop the loop, and a `probe` for tests. Its drawn cursor (`cursor.ts`) is a page-fixed layer made on first use and
  removed after an idle spell.

What made Whoops! work, as the session read the Whoops! bench: a real material with real optics (a wet ink with a
meniscus and a highlight), a material that answers the reader (the sponge, the lather, the drips), geometry seeded so
every screen sees the same thing while the reader's own play stays local, and a cost held to what is near the viewport.
Both of these cards are decoration, never obstacles, so what answers the reader here is light, not a scrub.

## 1. Feelin' Fab is holographic foil

**Decided** (the owner chose the recommendation over a soap-film look and over polishing today's CSS): Feelin' Fab is a
holographic trading-card foil under the post's words, in three grades by its stack, which stays its intensity:

1. **Pearl.** A milky sheen that holds the whole rainbow across the post in slow soft swirls, turning as the light moves,
   with one broad soft highlight where the light lands.
2. **Holo bands.** Diagonal rainbow stripes, repeating about every 360px or 40% of the post (whichever is less), with
   fine diffraction lines and a narrow bright stripe that slides with the light.
3. **Prism.** Cracked-ice holo: facets about 17px across, each tilted its own way, each throwing its own hue from a
   rainbow that spreads out from the post's middle, each flashing when it faces the light, with faint seams between.

Every grade keeps its 4, 8 or 10 starbursts at spots seeded from the plays' ids, each facing its own way, flaring when
the light lines up with it.

**Decided** (the owner, on the bench: "focus more on a variety of all colors of the rainbow visible at once"): at every
grade, on both boards, every one of the palette's six hues is on the post at once. The highlights are narrow enough that
they never wash a grade out to one color.

The palettes stay `FAB_STOPS`, with the board each is for. The lifetime does not change (permanent, as section 6 of the
onboarding design decided).

Weighed: a soap-bubble thin film (softer, echoes Whoops!'s bubbles, less tied to cards); today's CSS with a moving glare
(cheapest, but a stylized effect rather than a material).

## 2. Glitter Bomb is real glitter

**Decided** (the owner chose the fullest of three): settle, burst and cling.

- **Settled.** Tiny foil flakes cover each of the character's posts, about one per 70 square px (a 988 by 300 post body
  holds about 4,200), thickest around the spot where the bomb went off. Each flake has a seeded position, size, rotation,
  tilt and ink, so every reader sees the same glitter on the same post. Only the few flakes whose tilt faces the light
  flash at once, and the brightest throw a small four-point flare.
- **Rainbow.** **Decided** (the session carried the owner's rainbow note to the glitter, and the owner approved it on the
  bench): seven rainbow inks (red, orange, yellow, green, cyan, blue, violet) and silver holographic flakes, three in ten,
  that flash whatever hue their tilt throws. These replace today's gold, pink and cyan.
- **The burst.** The first time each of the character's posts comes 40% into view on a page load, a puff goes off at a
  seeded spot. About 85% of the post's glitter flies out, tumbling (each flake's flash follows its spin), drifts down
  and lands on its resting place. In flight a flake is drawn over the words for under two seconds, and it lands under
  them. Before its burst a post shows the other 15%. A post never bursts twice on a load, and a reload is a new load.
- **Cling.** A mouse that passes over a bombed post picks up flakes (at most 26 at a time) that ride with the pointer,
  tumbling with its speed. Over anything else they drop off one by one and land on whatever post is under them, any
  post, where they stay until the page is left. Loose glitter on the whole page is capped at 300 flakes, oldest first.
  It is the reader's own: never saved, sent or shown to anyone else.

The card's rules do not change: a week, then it stops by itself.

## 3. One light for the page

**Decided** (the owner chose scroll and pointer, and added phone tilt: "make sure it degrades gracefully if they deny the
permission. It's a reasonable permission for a game"): the foil and the glitter are lit by one light for the whole page.
Each post reads it at its own place, so posts lit together look like one surface under one lamp. The light comes from:

- **Scrolling.** A post's place in the viewport tilts its light: up and down strongly (2.8 across the viewport, on a
  light range of about ±1.5) and a little sideways (0.9). **Decided** (the owner, on the bench: "a bit more movement
  while scrolling").
- **A mouse.** Toward the pointer, for a fine pointer that can hover.
- **Phone tilt**, when the player has turned it on (section 4).
- **Idle shimmer.** **Decided** (the owner: "Yes on the idle shimmer", then "a bit more idle twinkling"): while nothing
  moves, the light drifts a little (about ±0.1, on two slow periods and two quicker small ones), about one flake in
  eight winks on its own every so often, and the foil's starbursts wink in turn. A still screen is never dead.
- **Rest.** With no input the light rests up and to the left, as the Whoops! ink is lit.

The light moves toward its target with a time constant of about 110ms, so it feels weighty rather than twitchy.

**Reduced motion.** The light is held at rest: no scroll, pointer, tilt or idle input moves it. There is no burst (the
glitter has already landed) and no cling, and the shine stays as a still image. That is the cards' accessible path:
they are decoration, never obstacles ("An accessible path costs what the obstacle costs").

**A play's moment** (`still`, docs/plans/2026-11-03-effect-history-design.md, section 5) draws the effect at the rest
light, with every flake landed and no burst or cling. The idle shimmer may run there, as a decoration that loops over
the same state may.

## 4. Turning tilt on

**Decided** (the owner chose the recommendation, and added: "let's try to abstract this so we can also integrate it with
the unbuilt booster pack and card art redesign plan"):

- **A switch in Appearance:** "Tilt shiny cards with your phone". **Decided** (the owner chose the recommendation): it
  is an account preference like motion and theme, so it follows the player. A browser grants motion per device, so on a
  device that has not granted it yet, the row offers "Allow on this phone". iOS needs that tap; Android grants without
  asking.
- **One tip, once.** The first time a shiny post is in view on a device that can tilt and has not been asked, one
  onboarding tip offers it. Its button turns tilt on and asks the browser, in the same tap.
- **The ways it can end, each said plainly in the row:**
  - granted: on;
  - the browser said no: "Your browser said no, so shiny cards follow your scrolling instead", with how to change it
    in the browser's settings;
  - no sensor: the device does not report tilt, so shiny cards follow scrolling and the pointer;
  - reduced motion: off while motion is reduced, since the light is held still.
  
  A refusal is never asked again by the game. The player turns it back on from the row, which asks again in that tap.
- **Graceful.** A refusal, a missing sensor or a switch turned off changes only the light's inputs. Nothing else about
  either card changes.
- **For later cards.** The light, the tilt switch and its permission are the engine's (section 7), so a foil card face
  (`docs/plans/2026-11-05-card-template-design.md`, section 11, "Foil") or the booster pack reveal can be lit by the
  same light without asking again.

The words are draft until the owner approves them in review: the tip is the developer persona's (Gabe) and the row is
the glass's plain words.

## 5. Contrast: held everywhere

**Decided** (the owner, after comparing three on the bench, including a soft calm-style scrim under the words: "Held
everywhere is still the best"): every pixel of the shine, at every grade, at every light, on both boards, holds 4.5:1
against every ink a post's words use (`--kb-fg`, `--kb-link`, `--kb-link-visited`, `--kb-muted`).

- **The band.** From those inks and the board's ground, each board has a luminance band the shine must stay inside.
  On the engine's tokens that is 0.59 to 1 on the light board (its darkest ink, muted #555, sets the floor) and 0 to
  0.048 on the dark board (its lightest, muted #aaa, sets the ceiling). The band is computed from the tokens as the
  board resolves them, never written down twice.
- **The clamp.** Each color is moved into the band keeping its hue: scaled down toward black past the ceiling, mixed
  toward white under the floor, in linear light. On the light board the foil keeps its whites. On the dark board it
  reads as deep jewel tones whose hues shift with the light.
- **The words keep their text shadow** in the board's ground, as Feelin' Fab's do today.
- **The check.** The foil at each grade and the glitter flakes are sampled across a grid of light angles on both
  boards, and every sample is checked against every ink. Its self-test drives it red with a palette and a clamp that
  let a bright stripe through.

Weighed: holding the bound only under the letters, as a calm with a solid pad and a long feather like the glass
polish's (it looked better than a slab per line, but the owner still preferred the even look); leaving the shine free
with a heavy halo on the words (bends the 4.5:1 rule rather than meets it).

This replaces `stopsAreReadable` and `GLITTER_ALPHA`'s layer rule. The palettes still pass alone, and the band now
holds every highlight drawn from them.

**Amended 2026-11-07: the dark board's glints leave the band** (issue #340, the owner choosing its option 3). Held to the
letter on the dark board, the band ends at 0.048, at most about 2:1 against the ground for any flake, and Glitter Bomb
read as faint dust (the owner: "I would love to see it brighter, more like real glitter in its shading onscreen"). The
decision now reads: every pixel of the shine holds 4.5:1 against every ink a post's words use, on both boards, **except
the dark board's glitter glints**: the flares over the few settled flakes facing the light, lit past `GLINT_MIN`, which
come and go as the light moves or a flake winks.

- **The glint.** It is added to what is under it, in the flake's own hue at full brightness (each ink saturated as at
  the ceiling, then its largest channel at 1), with the instance's glint (Divided World's white) over its heart at half
  its size, as real glitter flashes white at its center and colored at its edge.
- **The settled field stays inside.** Every flake's own color, lit or not, is clamped as before; so are the burst over
  the words, the puff, the cling layer and loose glitter (flakes carried off by the pointer and dropped on a post), which
  are not a post's own settled glints. A flare in those keeps the in-band tint it had.
- **Not under reduced motion.** There the light rests, so a glint would never pass, and the accessible path would carry a
  lasting patch out of the band under the words. Under reduced motion a flare keeps the in-band tint.
- **The check.** The readable-band check samples everything but the glints. A second check, `glintsAreFew`
  (`engine/ui/shine/flakes.ts`), holds that at every light of the grid and every moment of a 20-second idle walk at most
  3% of a post's settled flakes glint, or 16 of them on a short post where that is more (a few hundred flakes put a
  handful past a share by chance alone). Today the most crowded light glints about 1.6% of a tall post and at most 12
  flakes of a short one, over posts from 120 by 60 to 988 by 300 px. Its self-tests drive it red with a post whose
  flakes all face one light, and with 17 flakes facing one on a short post. `engine/ui/shine/flakes.glint.test.ts` holds
  that a glint is out of the band, in its flake's hue and added, and that nothing else is: the flakes' own fills, loose
  glitter, and every flare under reduced motion.

## 6. A busy page

- **One loop for the page**, in the suds' shape: hosts register a canvas, a box and a density, and one animation loop
  serves them. It runs only while a registered host is in view and has something to draw (a light that moved, a burst
  or a falling flake in flight, the idle shimmer). It stops itself otherwise, and a page with no shiny post in view
  costs nothing. A host whose draw throws loses its frame, never the loop.
- **Only in view.** One shared IntersectionObserver (today's `inView.ts`, moved to the engine) tells the loop which
  hosts are in view. A host out of view drops its field buffers and builds them again when it returns.
- **Cheap frames.** The foil is computed on a grid one third of a CSS px's resolution (3px cells) and drawn scaled with
  smoothing, so a 988 by 300 post is about 33,000 cells. A redraw happens only when that post's light moved past a small
  step. Idle-shimmer redraws run at 30 frames a second, and light that the reader moves runs at the display's rate.
  Glitter is about 4,200 flakes a post, filled as rects. The bench holds the display's rate with five shiny posts on
  screen.
- **Caps.** Burst flakes in flight across the page: 1,500. Loose glitter: 300. Flakes on the cursor: 26.
- **2D canvas, not WebGL.** Browsers cap a page's WebGL contexts at a handful, so a busy thread of shiny posts would pass
  it. One shared WebGL canvas would have to draw over the words.

## 7. The layers

- **The engine** gets `engine/ui/shine/`, with nothing named for a card or an instance:
  - `band.ts`: the readable band from a board's tokens, and the clamp;
  - `light.ts`: the page's light and its inputs;
  - `tilt.ts`: the device's motion permission and the switch;
  - `loop.ts`: the host registry and the page's one loop;
  - `inView.ts`: moved from Feelin' Fab;
  - `foil.ts`: the three foil patterns, given a palette and stars;
  - `flakes.ts`: flake fields, the burst, loose glitter and the cling layer, given inks.

  It also gets the Appearance row, the preference and its migration, and the tip's action button.
- **Divided World** keeps Feelin' Fab's and Glitter Bomb's Effects, which choose a pattern by level, pass `FAB_STOPS`
  and the glitter inks, set the counts, and give the tip's words in Gabe's voice. Those words reach the engine through
  `InstanceUi.onboarding.tips`, as every tip does.
- **Whoops!** **Decided** (the owner: "we can leave it for now but maybe peek at what its implementation looks like so
  the port will be easy"): this plan does not touch Whoops!. `loop.ts` takes the suds' exact host shape (`register(host,
  canvas, box, density)` plus a draw callback, `unregister`, a `probe`) and `flakes.ts`'s cling layer takes `cursor.ts`'s
  lifecycle (made on first use, removed after `IDLE_MS`), so moving the suds onto the page's loop later is a move, not a
  rewrite.

## 8. The rules

- **The masks.** Everything the effects draw from is public: the post's id and its plays' ids, as today. The light, the
  tilt permission, the burst having gone off and loose glitter never leave the device. The tilt preference is saved to
  the player's own account, read only by them, and changes no response anyone else sees. No payload, Realtime event or
  timing is added that could be computed from a private fact.
- **Ways out.** No state a player, a character or a post can be stuck in is added. Glitter Bomb still ends after a week
  by itself. Loose glitter ends when the page is left. The tilt switch is off with a tap.
- **Append-only.** No Act changes. The one schema change is the preference's column.
- **Portable.** The migration is plain SQL. The instance export carries the new column with the table, and its
  round-trip test covers it.
- **Accessible.** The forum stays fully readable: every word holds 4.5:1 over the shine (section 5), and reduced motion
  holds everything still. The Appearance row and the tip meet the glass's usual standards.

## 9. Open

- **Foil card faces and the booster reveal** are the variant design's and the booster packs plan's to take up. This
  design only leaves them the light and the switch.
- **Moving Whoops!'s suds onto the page's loop** waits until the Whoops! refinements land.
- **A gyroscope seen for real.** The bench's tilt pad stood in for one. The gains in section 3 are first numbers, to be
  tuned once the owner has tilted a phone.

## 10. A post's body, drawn at a share of the rate (amended 2026-11-07)

Since keithpickering/dividedworld#295 the shine paints a post's whole body, not only its words' box, and the draw cost
was held to what the words cost. Every draw still changed the whole body on screen, about twice the words' area across
a busy thread, and on CI's software-composited Chromium the busy-thread scroll dropped frames. The owner chose, on
keithpickering/dividedworld#304, to redraw only what is on screen and to redraw big posts less often. This replaces
section 6's "Idle-shimmer redraws run at 30 frames a second, and light that the reader moves runs at the display's
rate" for a post whose body is bigger than its words:

- **A share of the rate.** A post is redrawn at the share of the loop's rate that keeps the screen area its draws change
  in a second to what its words' box changed at the full rate: the words' area over the body's, at most 1 and at least a
  quarter (`paintShare` in `engine/ui/cards/body.ts`). A post at a half shimmers 15 times a second and follows a moving
  light 30 times a second. A post of a line in a tall body stops at a quarter: 7.5 and 15. A post whose body is no
  bigger than its words is drawn as section 6 says. A post's first draw, and a Glitter Bomb's burst, are never slowed.
  The loop spreads the posts' draws over the frames, so the slowed posts do not all draw on the same one.
- **Only what is on screen.** A draw redraws only the rows of the body that are on screen, with 120 CSS px above and
  below (`SPAN_MARGIN` in `engine/ui/shine/loop.ts`). The rest keeps what the post last drew there, never blank: a post's
  first draw, a draw after it was resized or freed, and a burst are whole. Glitter's settled flakes off screen show their
  unlit color until a draw reaches them.
- **How it is held.** `e2e/shine.spec.ts` counts the screen area a scroll's draws change against what the words would
  change drawn on every frame (at most 1.25 times; before this, 2.29 in that spec's thread), and the rest-rate check
  holds each post to its share of thirty draws a second.

## 11. Glitter Bomb's burst, seen from above (amended 2026-11-07)

The owner, trying Glitter Bomb on a deployed preview, asked for five changes. Four replace parts of section 2; the fifth
is held by section 5.

- **When it goes off.** It went off when the post was barely in view. It now waits for the reader to be looking at the
  spot: the burst point must be in the middle three fifths of the view's height and stay there 300 ms by the loop's
  clock. A scroll that only passes it fires nothing. This replaces section 2's "comes 40% into view".
- **Seen from above the whole time.** The flakes flew up the screen and fell down it, as if seen from the side, then were
  pulled back over the post; the settled glitter is seen from above. Now every flake is thrown out from the burst point
  along the post toward its resting place, fast at first and slowing, wandering a little off its line, while it rises
  toward the reader and settles back (drawn up to about twice its size at its highest). Nothing falls down the screen.
  It still lands inside two seconds, under the words.
- **Its own spot each load.** The seed is now the play's and the post's ids and a draw made for the post's mount, so each
  load bursts from its own spot and leaves its own glitter around it, and a post that leaves view and returns keeps
  what it had. A play's moment (`still`) is still the public seed alone. This replaces section 2's "every reader sees the
  same glitter on the same post"; nothing private enters the seed.
- **A fast scroll shakes glitter off.** A touch reader has no pointer to pick glitter up. A scroll of the page faster than
  2,200 CSS px a second shakes a few flakes off each post on screen (up to 8 a post a frame, 160 falling on the page).
  They are thrown the way the page moved and fall on the page-fixed layer, outside the post's box, landing on whatever
  post is under them or fading, as a dropped flake does. Like a mouse's pickup, a shaken flake is a copy and the post
  keeps its own: taking it would repaint the post's whole base on every frame of a fast scroll, which multiplied the
  pixels rastered a frame by more than ten in `e2e/shine.spec.ts`. A mouse's scroll wheel shakes too. Reduced motion
  shakes nothing.
- **Brighter on the dark board, inside the band.** The dark board's band ends at a luminance of 0.048 (section 5), so the
  glitter there cannot be much brighter without breaking 4.5:1 under the words. Inside it, each ink is now taken at the
  ceiling with its chroma pushed (a lit flake mixed toward white came out a flat gray once scaled back under the
  ceiling), an unlit flake shows 42% of that rather than 5%, and a flake facing the light flares in its own hue, drawn
  over it rather than added. Going brighter than the band is the owner's question, not this amendment's: section 5's
  "held everywhere" stands until the owner says otherwise. (The owner answered the same day, in issue #340: the glints
  now leave the band and are added, in their hue at full brightness; section 5's amendment.)
