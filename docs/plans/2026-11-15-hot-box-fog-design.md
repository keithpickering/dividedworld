# Hot Box's smoke as real fog: design

Record, written 2026-11-15. Decided with the owner on 2026-11-16. Reworks the smoke that
`docs/plans/2026-11-15-hot-box-plan.md` built (PR #713); the card's rules, price, length and art are unchanged. The
plan is `docs/plans/2026-11-15-hot-box-fog-plan.md`. The bench the owner judged is
`docs/research/2026-11-15-hot-box-fog/01-fog.html`.

## 0. What the owner said, and what was decided

The owner's notes on the built smoke:

> The smoke is too abstract/cartoony compared to effects like whoops and autocorrect that emulate real physical
> materials. Parting the clouds should feel more like your cursor/finger moving real fog out of the way. This is more
> like a solid color + blurred white and black circles floating around with a circular mask. The prototype was a
> better direction, something like that but shaded so it's not all a single color.

> "Wave the smoke" button in the post body is superfluous; the one in the Lens is fine.

Decisions, each the owner's:

1. **The look and the parting are the bench's "Proposed fog"** ("This is looking great as-is").
2. **The wake stays open 1.5 seconds** ("1.5s is a good wake length").
3. **The in-post button is removed; the Lens control is the only control.** When the read window ends, focus is not
   moved; only focus that was inside the words, which go inert, falls to the post's Hot Box mark.
4. **A click on a hold control holds for 1 second**, in the engine, for every card's hold (Hot Box, Whoops!,
   Graffiti). The owner's concern was a "set and forget" for a mouse; tapping answers it: keep clicking to keep going.
5. **The fog is built after the engine's tiled layer** and paints through it.
6. **Forced colors gets a matching trail**: hard-edged discs along the pointer's recent path.
7. **Issue #721: the Lens is the answer.** A card's control on the post may be covered and inert under another card's
   obstacle; its Lens control is always reachable.

Unchanged from the standing decisions: fresh smoke is 0.94 opaque and the ghost of the words shows (issue #719); the
smoke thins to 0.45 over its three days; it fills the post's content area border to border; nothing is saved, sent or
counted, and it is the same for every reader; the full effect keeps its soft edge and the hard edge is forced colors'
alone.

## 1. What the prototype did that the built smoke does not

"The prototype" is the widget shown in the Wave 1 design session to settle "obstacle or texture". It was never
committed; the bench's "Wave 1 mock" mode is a port of it.

| | Wave 1 mock | Built (PR #713) |
|---|---|---|
| What the fog is | about 70 large soft puffs in the caster's color, nothing under them | a flat fill of the color, with small white and black discs drifting over it |
| What the pointer does | pushes each puff away along the line from the pointer; the puff eases back when the pointer leaves | cuts a round hole in the layer; nothing in the layer reacts |
| What a reader sees move | the smoke | a hole |

The mock's fault is the owner's "all a single color", and its puffs read as discs once one is alone. The built
smoke's fault is that it is a picture of smoke with a mask over it. The new fog keeps the mock's one true thing (the
fog itself moves) and adds what both lacked: shading, and a body that flows.

## 2. The look

The fog is one continuous body, not sprites.

- **Shape.** Two sheets of the same tileable cloud (five octaves of value noise, 256 texels square), one fine and
  quick (3.2 px a texel, drifting 7 px/s right and 3.2 up), one broad and slow (8.5 px a texel, 2.6 px/s left and 1.4
  up). Their sum is the fog's height at a point.
- **Shading is in the color, never the opacity.** Each sheet is lit once, from the upper left. Where the fog faces
  the light the caster's color is mixed toward white (at most 0.62); where it turns away, toward a deeper, cooler
  shade of itself (red and green to about a third, blue to about 0.42 and lifted a little; at most 0.8). The walls of
  a clearing are lit the same way from the fog's own thickness, so a clearing reads as a hollow with a lit side.
- **The ghost.** Fog at rest is exactly `fogAlpha(strength)` opaque in every cell: 0.94 fresh, 0.45 at the end. The
  words show through it as faintly as they do today, evenly, because nothing about the shading changes alpha.
- **Thinning.** As today, `strength` runs 1 to 0 over the play's three days and only `fogAlpha` reads it. The
  shading's contrast is not reduced with age; thin fog is still fog.
- **The edge.** Where the fog is thinned (a clearing's rim, a wake), its alpha is cut by the cloud's own shape, so the
  edge breaks into wisps and is never a clean gradient ring. The soft edge the owner kept is this one.
- **Dark and bright boards.** The fog is the caster's color on any board. The post's ink rules for a covered body are
  the ones Hot Box already sets.

The exact constants are the bench's and are carried into the build as named constants with the bench as their record.

## 3. The parting

### 3.1 The model is still the rule

`instances/divided-world/ui/hot-box/smoke.ts` stays the one statement of what a reader can read: where the fog is
clear, how wide, for how long. Its radius (`holeRadius`), its timings (`roll`, `touchHold`, `waved`) and its sweep
(`sweepAt`, at Whoops!'s 400 px/s) are unchanged, so reading costs what it costs today. The model gains one thing,
the **trail**: the pointer's recent path stays partly open behind it for `SMOKE.wake` = 1500 ms.

- A trail is a list of points the pointer passed, one each time it has moved a third of a radius, each with the time
  it was left. `trailOpenness(point, now)` falls from 1 to 0 over `wake`, linearly.
- `covered(x, y, …)` takes the trail with the clearings: a point is as open as the most open thing over it.
- The held sweep leaves a trail the same way, so the Lens path and the pointer path show the same wake.
- A touch's clearing (held open `touchHold` after a tap) leaves no trail of its own; a dragging finger does.

Every path below draws from this model, which is what makes them cost the same.

### 3.2 The fog is a field that the model drives

On the full effect the fog is a low-resolution field over the content area, one cell every 5 CSS px, holding the
fog's density, its velocity, and how far its cloud has been carried.

- **The pointer moves it.** Within one and a half radii of a moving pointer the fog's velocity is pulled toward the
  pointer's own, strongest at the center. The fog is then carried along its velocity (semi-Lagrangian advection), and
  the cloud's texture is carried with it, so streaks of the same fog smear along the pointer's path.
- **It goes around.** A few rounds of a pressure solve (8 Jacobi iterations) keep the fog from piling up: what is
  pushed ahead of the pointer flows around it and closes behind.
- **A tap bursts.** A touch that opens a clearing pushes the fog outward from the point for 260 ms.
- **The model is the floor.** Each frame, wherever the model says a cell is clear, its density is driven down to the
  model's value quickly (a 70 ms time constant). The fog may never be thicker than the model allows. So motion can
  only add clear space and can never hide a word the model says is readable.
- **It closes from its rim.** Where the model no longer holds a cell open, density comes back at a rate that grows
  with its neighbors' density, so a wake fills inward from its edges over `wake` and not as a fade.
- **It settles.** Velocity decays (0.9 s), carried texture eases back (7 s), and a cell at rest is exactly the
  resting fog again, so the field never drifts away from the model.

What a reader feels: the hand moves fog, the fog trails and curls back, and the clear space is where the hand is and
has just been. There is no circle that follows the pointer; the round floor under a still pointer is softened into
wisps by the edge rule, and under a moving one it is a streak.

### 3.3 Cost, at a busy thread's scale

The fog paints through the engine's tiled layer (decision 5): the engine measures the body, mounts fixed tiles only
near the view and runs one page-wide frame schedule; Hot Box hands it a painter in body coordinates. That layer is
what bounds cost by what is on screen and not by how long a post is, and it is where issue #722's "cost per frame
grows with post length" is settled. This design adds only the fog's own costs and their bounds:

- **Only disturbed fog is simulated.** The field is stepped inside the "disturbed box": the cells a clearing reaches
  and the cells still moving. Fog at rest is not stepped. A post nobody is pointing at costs no simulation.
- **Only fog near the view is drawn**, by the tiled layer's rule. The fog asks the layer for density 1: it is drawn
  at one cell per 5 px and scaled up smooth, so a dense canvas buys nothing.
- **Fog at rest drifts at 20 frames a second**, not 60: its fastest sheet moves 7 px a second. A tile under a
  clearing or a wake is drawn every frame.
- **The budget is 4 ms of script a frame for all the fog in view together, on a phone** (measured at 4x CPU
  throttle). The bench runs 3 to 5 ms a frame unthrottled for a whole short post swept end to end, which is the worst
  case for one post and is not yet within the budget on a phone; the ladder below is how it gets there, and the plan's
  measuring task pins the figures.
- **It degrades in steps, each one invisible in the rules.** When the rolling cost of the last 30 frames is over
  budget: (1) cells grow from 5 px to 7, then 10; (2) pressure rounds drop from 8 to 4; (3) the simulation stops and
  the fog is drawn from the model directly, which is the reduced-motion picture (section 5). A step is undone only
  when the post leaves the view, so the fog never flickers between levels. Every step reads the same model, so no
  reader's device makes the post easier or harder to read.
- **Several smoked posts in view** share the one budget through the layer's schedule; the ladder is taken by the
  posts farthest from the pointer first.

No count from today's instance enters this: the bounds are per screen, so a thread of a thousand smoked posts costs
what the three on screen cost.

## 4. The control

### 4.1 The in-post button goes

`button.dw-hotbox-wave` and its styles are removed. Whoops! is the precedent: its "Hold to scrub" is in the Lens and
nowhere else. The Lens control keeps its label, "Wave the smoke", and its behavior: hold to sweep the lines at the
pace of a hand; let go and the smoke rolls back; hold to the end and the post stays clear for 20 seconds.

### 4.2 What a keyboard reader does

1. Tab reaches the post's Hot Box mark. It is in the post's header, before the body in the tab order and outside the
   smoked words. Its name is "Hot Box, 1 play, Smoke on this post. Opens the cards on this post."
2. Enter opens the Lens; focus lands on the Hot Box tab. Tab reaches "Wave the smoke".
3. They hold Space or Enter. The smoke clears line by line at 400 px/s, the same sweep a pointer makes by hand.
4. Held to the end, the words are live for 20 seconds: links can be followed, text selected. The Lens stays open
   beside the post.
5. When the window ends the smoke rolls back and the words go inert. **Focus is not moved.** If it was inside the
   words it would be dropped by the browser, so it goes to the post's Hot Box mark, the nearest thing that names the
   state and opens the way back.

That is two more keys than the removed button cost (open the Lens, Tab to the control), paid once a post; the hold
itself, which is the obstacle's cost, is identical. A pointer reader pays nothing for the Lens because they never
need it.

### 4.3 What a screen reader gets

While the smoke is up the words are `inert`, so a screen reader does not read them: that reader meets the obstacle as
a sighted one does. Three things tell them so and show the way:

- **A line in the post body, read in place of the words**, visually hidden and never inert: "This post is under
  smoke. To read it, open Hot Box in the cards on this post and hold Wave the smoke." It is the glass's voice: plain
  and true.
- **The mark's name** (above) and the Lens panel's own state and `ends` lines.
- **The live region** the effect already has, which says when the post is clear and for how long, and when the smoke
  is back.

**A click holds for one second** (decision 4). A screen reader in browse mode sends a button a click and never a key
held down, so today it cannot hold at all. In the engine's hold control a click now holds for 1 second at the held
pace; another click before it ends extends it to 1 second from that click; leaving the button stops it. A ten-line
post is about a dozen presses. A mouse click does the same, which is no shortcut: nothing runs unattended. The hold's
hidden description gains one engine-owned sentence, the same on every card: "Or press it again and again: each press
holds for one second." This reaches Whoops!'s and Graffiti's scrubbers too, by the owner's word.

Graffiti's words are never hidden from a screen reader (its body is not inert, by its own design), so that reader
does not meet Graffiti's paint as an obstacle. That is not this design's to change; it is listed in the PR as a
question for the owner.

### 4.4 Issue #721

The owner's answer: the Lens is the answer. So:

- **Whoops! around Hot Box**: with no button on the post there is nothing of Hot Box's for Whoops! to make inert.
  Hot Box's pointer clearing is bound outside Whoops!'s inert layout, as today.
- **Below the Fold inside Hot Box**: the fold's bar is inside the smoked words and is inert with them. It must not
  look pressable when it is not, so while the words are inert, nothing inside them is lifted above the fog: the bar
  is under the smoke like the words. After a finished wave it is live and lifted for the read window. The fold's own
  Lens control works throughout.
- A cross-card test holds both nestings. The plan's PR closes #721.

## 5. Reduced motion and forced colors

Three pictures of one model:

| | Full effect | Reduced motion | Forced colors |
|---|---|---|---|
| The fog | shaded, drifting, flows | the same shaded fog, still: no drift | none drawn; the words are masked |
| A clearing | the field, driven by the model | drawn from the model directly; soft, wispy edge | a hard-edged circle |
| The wake | fog closes in from its rim over 1.5 s | the trail is open, then shut, at half the wake | hard discs along the trail, each gone at once when its openness falls under 0.5 |
| The held sweep | same sweep, same pace | same | same |
| Thinning | `fogAlpha` | `fogAlpha` | `maskAlpha`, as built |

- **Reduced motion** shows no simulation and no drift: nothing travels and nothing fades. As the model's `openness`
  already is under reduced motion, a clearing and each point of its trail is open or shut, with the fog's soft, wispy
  edge around it; a trail point shuts at half the wake, the same moment as forced colors' disc. It is also the bottom
  step of the cost ladder (there with the animated openness, since that reader did not ask for stillness).
- **Forced colors** keeps the path the owner chose for PR #713: the words are masked and a hard circle clears them,
  with the same radius and timings. It gains the trail so that the same movement reveals about the same words for
  about the same time as the full effect: a trail disc is a full-radius hard disc for the first half of the wake
  (750 ms), which is when a cell of the full effect's wake is still more clear than not. The plan's measuring task
  checks that figure against the field and moves the 0.5 if it is wrong.
- Under both together, forced colors' picture wins and its discs do not animate.

The soft edge is on the full effect and on reduced motion; the hard edge is forced colors' alone.

## 6. Rules this was held to

- **An effect fills the post, border to border.** The fog fills the content area found with the engine's `bodyOf`,
  in a thread post and in the ORIGIN box. It never leaves it: pushed fog stops at the border.
- **An accessible path costs what the obstacle costs.** Every path reads one model; the keyboard, click and
  forced-colors paths are sections 4.2, 4.3 and 5.
- **No player is ever stuck.** The smoke ends by itself after three days; any reader can clear it by pointer, by
  holding, or by pressing; the mark and the in-body line say how; nothing here adds a state.
- **A response never proves a private fact.** Nothing is added to any payload, event or request. The field and the
  trail live in the page and are the same for every reader.
- **KayfaBB never knows which instance it runs.** The fog is Divided World's. Two engine changes are made, each
  general: the hold control's click (section 4.3), and a way for an effect to find its post's mark (section 4.2).
- **Weigh a design at the scale of a busy instance.** Section 3.3.
- **The fiction may lie; the log never does.** Nothing here writes to the log. The in-body line is the glass's and
  is true.

## 7. Issues

- **#721**: settled by this plan (section 4.4); its PR closes it.
- **#722**: left open, with two of its items settled here and one elsewhere. "A screen reader in browse mode cannot
  hold" is settled by the click (section 4.3). "Overlapping clearings multiply on the canvas" is gone with the
  canvas's cut-out circles: the field takes the most open thing over a cell. "Cost per frame grows with post length"
  is settled by the engine's tiled layer, in its own plan. The rest (timing the other two reading paths, a real
  forced-colors mode, the log's color name, the words remounting when the smoke ends, axe under emulated forced
  colors) are untouched and stay on the issue; the plan's PR comments on it with this list.

## 8. Not in this design

- The card's art and `scene.py`: redone by the owner, committed by another session.
- The engine's tiled layer itself.
- Any change to Hot Box's rules, price, length, form or log lines.
