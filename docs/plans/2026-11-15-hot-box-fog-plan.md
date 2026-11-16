# Hot Box's smoke as real fog: plan

Record, written 2026-11-15. Carries out `docs/plans/2026-11-15-hot-box-fog-design.md` (read it whole first; section
numbers below are its). One PR from `main`. The PR body says `Closes #721` and the session comments on #722 with the
list in the design's section 7; #722 stays open.

**May start** only after the engine's tiled layer has merged. That layer is being designed in the owner's long-post
canvas session and had no committed plan when this was written, so this plan names what it needs from it and not its
files: the engine measures the content area, mounts fixed tiles near the view, runs one page-wide frame schedule, and
calls an effect's painter in body coordinates, at a density the effect may lower. **Before Task 3, read the merged
layer's plan and module and write, in the PR, which of its names stand for those four things.** If any of the four is
missing, stop and ask the owner; do not build a second tiling here.

Every task goes test first: write the failing test, record its red run, then the code. During a task, run only the
tests for the changed code (`npx vitest run <file>`; `npx playwright test <spec>` for a browser spec). Run
`npm run typecheck` and `npm run build` once after the last task, with the tail in the PR. No deployed database,
bucket or connector is touched; there is no migration.

**The layers.** The fog is Divided World's (`instances/divided-world/ui/hot-box/`). Two engine changes, each general
and neither naming a card: Task 1 (`engine/ui/cards/Kit.tsx`) and Task 2 (`engine/ui/cards/marks.ts`). Nothing else
under `engine/` is edited. `instances/divided-world/ui/cards/hot-box/art.*` and `scene.py` are not touched.

**The bench** `docs/research/2026-11-15-hot-box-fog/01-fog.html` is the record of the look the owner approved
("Proposed fog", wake 1.5 s, cell 5 px). Its `makeCloud`, `advect`, `step` and `drawFog` are the reference for Tasks
3 and 4; port their arithmetic and constants, not their page plumbing. Open it beside the built effect before the PR
and compare by eye; put one screenshot of each in the PR.

## Task 1. A click holds for one second (engine)

Model: sonnet

**Files:** `engine/ui/cards/Kit.tsx`, `engine/ui/cards/kit.test.tsx`, `e2e/hold.spec.ts`.

Design section 4.3. In `Hold`:

- Export `HOLD_PULSE_MS = 1000` and `HOLD_PULSE_HELP = 'Or press it again and again: each press holds for one second.'`.
- `onClick`: start the hold if it is not running, and (re)set one timer to stop it `HOLD_PULSE_MS` from now. A click
  while a pulse runs only resets the timer; it does not call `start` again.
- A pointer or key hold in progress owns the control: a `click` that arrives while a pointer or key is down does
  nothing, and pointer up or key up stops the hold as today. The click the browser sends after a pointer or key
  release then starts a pulse; that is intended (a quick mouse click is a one-second hold).
- Blur, pointer leave during a pulse, and unmount stop the hold and clear the timer. Stop is called once.
- The hidden description is the card's `describe` followed by `HOLD_PULSE_HELP`; a hold with no `describe` gets the
  help alone, and `aria-describedby` is then always set.

Tests first, in `kit.test.tsx` (fake timers):

1. A bare click calls `start` once and `stop` once, 1000 ms later. Poison: no `onClick` (never starts).
2. A second click at 600 ms: no second `start`; `stop` at 1600 ms, once. Poison: restart on each click.
3. Blur at 300 ms of a pulse stops it then, and the timer firing later does not call `stop` again. Poison: timer
   not cleared.
4. Pointer down, 3 s, pointer up, then the click: `start` twice and `stop` twice in all, the second pair a pulse; a
   `click` dispatched while the pointer is down changes nothing. Poison: click handled during a hold (stop fires at
   1 s under a held pointer).
5. Unmount mid-pulse stops once.
6. The description holds the card's words and the pulse help, with and without `describe`.

In `e2e/hold.spec.ts`, one case on Whoops!: `locator.dispatchEvent('click')` on "Hold to scrub" in the Lens scrubs
for about a second (ink share falls, then stops falling); twelve such clicks do no more than 12 s of holding does.
Poison: a pulse that never ends (share keeps falling after 1.5 s).

Whoops!'s, Graffiti's and Hot Box's own `describe` strings are left as they are.

## Task 2. An effect can find its post's mark (engine)

Model: haiku

**Files:** `engine/ui/cards/marks.ts`, `engine/ui/cards/marks.test.tsx`.

Add `markOf(host: Element, kind: string): HTMLElement | null`: the `button.kb-mark` with `data-kb-card` equal to
`kind` inside the nearest post (`.kb-act`) around `host`, or null. It reads the DOM `Marks.tsx` already writes and
adds no attribute. Tests first: found from a host inside the body; null for another kind; null outside any post; with
two posts on the page, the host's own post's mark. Poison: `document.querySelector` (the two-post case goes red).

## Task 3. The model gains the trail

Model: sonnet

**Files:** `instances/divided-world/ui/hot-box/smoke.ts`, `instances/divided-world/ui/hot-box/smoke.test.ts`.

Design section 3.1. Pure, no DOM, no `Math.random`, no clock of its own.

- `SMOKE.wake = 1500`, `SMOKE.trailStep = 1 / 3` (of a radius), `SMOKE.trailHard = 0.5`.
- `interface TrailPoint { x; y; leftAt }`.
- `extendTrail(trail, x, y, now, radius)`: returns the trail with a point added when `(x, y)` is at least
  `trailStep × radius` from the last, and with points older than `wake` dropped. The list is bounded:
  never more than `ceil(wake / 16) + 1` points.
- `trailOpenness(point, now, reduced)`: 1 at `leftAt`, linear to 0 at `leftAt + wake`; under `reduced`, 1 until
  `trailHard` of the wake and 0 after (the same switch the hard disc uses).
- `covered(...)` takes an optional trail after `clearings`: the most open of every clearing and every trail point
  wins at a point, with the same rim (`edge`) as a clearing.
- `hardOpen(x, y, clearings, trail, radius, now)`: true where forced colors shows the words: inside a clearing
  whose openness is at least `trailHard`, or a trail point's.
- Remove `Puff`, `puffs` and `puffAt` and their two tests (`smoke.test.ts` "puffs: the same seed…" and "a puff
  drifts and wraps…"); nothing else may import them after Task 4.

Tests first, each with its poison:

1. `the numbers are the plan's` gains `wake`, `trailStep`, `trailHard`. Poison: any other figure.
2. A point is added only after a third of a radius of travel; a still pointer adds none. Poison: add every call.
3. Points older than `wake` are dropped and the list never exceeds its bound over 10,000 calls a millisecond apart.
   Poison: no pruning.
4. `trailOpenness` is 1, 0.5 and 0 at 0, 750 and 1500 ms; reduced is 1 at 749 and 0 at 750. Poison: reduced fades.
5. `covered` with a trail: a point the pointer left 300 ms ago is partly open; the same call without the trail is 1
   there; every existing `covered` test passes unchanged with no trail. Poison: trail ignored.
6. `hardOpen` agrees with `covered < 1 − trailHard`'s side at a clearing's center and beyond its rim, and is true on
   a trail point at 749 ms and false at 750. Poison: no trail in `hardOpen`.

## Task 4. The fog field and its picture

Model: inline

**Files:** new `instances/divided-world/ui/hot-box/fog.ts` and `fog.test.ts`.

Design sections 2 and 3.2. Pure TypeScript over typed arrays: no DOM, no canvas, no clock, so it runs under vitest
and could run in a worker. Ported from the bench.

- `makeCloud(seed)`: the tileable cloud and its two lit tone tiles. Deterministic for a seed.
- `makeField(width, height, cell)`: density `D` (1 at rest), velocity `U`, `V`, carried offsets `OX`, `OY`, and the
  scratch arrays; `box: null`.
- `stepField(field, dt, now, input)`: `input` is `{ clearings, trail, radius, pointerVelocity, burst, target }`,
  where `target(x, y)` is the most fog the model allows at a point (`covered(...)`, 0 where clear and 1 where
  smoked), given by the caller. Does, in the
  bench's order: grow the disturbed box; drag; pressure (`rounds`, 8 by default); advect; damp; drive down to the
  target (70 ms); refill from neighbors over `SMOKE.wake`; reset cells at rest; shrink the box. Returns cells stepped.
  `dt` is clamped to 50 ms so a background tab's long frame cannot throw fog across the post.
- `paintFog(field, cloud, out, rows, { color, alpha, t, direct })`: writes RGBA for a band of rows into `out`
  (`Uint8ClampedArray`). `direct` (reduced motion, and the ladder's last step) reads density from a `target`
  function and no field, with no drift (`t` = 0) when `still` is set.
- Constants are exported and named (`FOG.cell`, `FOG.sheet1`, `FOG.sheet2`, `FOG.light`, `FOG.shade`, `FOG.sink`,
  `FOG.damp`, `FOG.settle`, `FOG.rounds`, `FOG.burst`), with one comment line pointing at the bench.

Tests first, each with its poison:

1. **The ghost.** A field at rest painted at any `t`: every pixel's alpha is exactly `round(alpha × 255)`. Poison:
   let tone into alpha.
2. **Shaded, in the caster's color.** At rest, the picture's red, green and blue each take at least 40 distinct
   values, some pixel is lighter than the color and some darker, and the mean hue is within 12 degrees of the
   color's. Poison: flat fill (the built smoke).
3. **The model is the floor.** After any 200 random steps with a moving clearing, no cell's density exceeds its
   target by more than 0.02 once it has been inside a clearing for 250 ms. Poison: remove the sink.
4. **The fog moves.** With a clearing moving right at 400 px/s, the mean `U` within a radius is positive after
   100 ms, and density just behind the clearing is lower than at the same distance ahead of it. Poison: no drag (a
   mask that follows the pointer passes neither).
5. **It goes around.** After the pressure rounds, mean absolute divergence in the box is under a quarter of what
   it was before them. Poison: zero rounds.
6. **It closes, within the wake.** A cell the clearing left is under 0.5 density at `0.5 × wake` and at least 0.97
   by `1.5 × wake`. Poison: refill rate ÷ 10. (This is the figure section 5 of the design leans on; if the bench's
   rule puts the crossing elsewhere, move `SMOKE.trailHard` to match and say so in the PR.)
7. **It settles to rest exactly.** Disturb, then step 12 s with no clearing: `box` is null and `D`, `U`, `V`, `OX`,
   `OY` are exactly their rest values. Poison: no rest reset.
8. **Only disturbed cells are stepped.** One clearing in a 2,400 × 20,000 px field steps fewer than 4,000 cells.
   Poison: step the whole field.
9. **Deterministic.** The same seed and inputs give the same bytes; `Math.random` is stubbed to throw.
10. **A long frame is clamped.** `dt` of 5 s moves fog no farther than 50 ms does.

## Task 5. The effect paints the fog through the tiled layer; the in-post button goes

Model: inline

**Files:** `instances/divided-world/ui/hot-box/Effect.tsx`, `Effect.test.tsx`, `hot-box.css`,
`instances/divided-world/ui/cards/hot-box/ui.ts` only if a word in it names the removed button (its `describe` is
asserted verbatim in `instances/divided-world/ui/index.test.tsx`; change both together or neither).

Design sections 3.3, 4 and 5.

- **Drawing.** Replace the whole-body canvas, the flat fill, the puff sprites and the `destination-out` cuts with a
  painter handed to the engine's tiled layer, asking for density 1. The painter steps the field once a frame (not
  once a tile) and paints each tile's rows with `paintFog`. Fog at rest repaints at 20 frames a second; a tile under
  a clearing, a trail or a moving cell repaints every frame. Out of view: nothing, by the layer.
- **Pointer.** The pointer handlers keep the clearings as today and now also keep the trail (`extendTrail`) and the
  pointer's velocity (px/s, smoothed over the last 3 moves). The held sweep feeds the same trail.
- **The ladder** (section 3.3): a rolling mean of the painter's last 30 frames against `FOG_BUDGET_MS = 4`; steps
  cell 5 → 7 → 10, rounds 8 → 4, then `direct`. Reset when the post leaves the view. The level is in a ref and on
  the host as `data-dw-fog-level` (0 to 4) for tests; it is never in React state.
- **Reduced motion**: `direct`, `still`, model with `reduced` true; drawn when something changes and not on a clock.
- **Forced colors**: the built mask path, with `hardOpen` in place of its circle test, so the trail's discs are
  drawn; no canvas work.
- **Remove** `button.dw-hotbox-wave`, `waveRef`, its `aria-describedby` span, its pointer-leave handling in
  `onControl` (keep `liftedOver`), and `.dw-hotbox-wave` in `hot-box.css`.
- **The in-body line**: a `p.kb-visually-hidden`, a sibling of the words and never inert, present while the words
  are inert: `This post is under smoke. To read it, open Hot Box in the cards on this post and hold Wave the smoke.`
  Not rendered when `still`.
- **Focus** when the read window ends: if `document.activeElement` is inside the words, focus
  `markOf(host, 'hot-box')`; otherwise leave focus alone.
- **Nothing lifted under smoke** (section 4.4): while the words are inert, `[data-kb-over-ink]` inside
  `.dw-hotbox-words` is not lifted above the fog (CSS in `hot-box.css`, keyed on the words' `inert` attribute). The
  engine's own lifted things outside the words (reactions row, History) are untouched.
- `view.controls` stays the one Lens hold; `ends` stays `Point at the words, or hold Wave the smoke, to read. …`.

`Effect.test.tsx` changes, tests first:

- The helper `button` (`button.dw-hotbox-wave`) and `press`/`release` are replaced by ones that drive
  `view.controls[0].start()` / `.stop()`, which is what the Lens calls. Every held-sweep test keeps its assertions
  through the new helpers.
- **New:** no `button` is rendered inside the effect at all. Poison: the old button.
- **New:** the in-body line is present and outside the inert subtree while smoked, absent in the read window and
  when `still`. Poison: put it inside the words.
- **New:** when the window ends with focus on a link in the words, focus is on the mark; with focus on a button
  outside the post, it has not moved. Poison: always focus the mark.
- **New:** a pointer moved across the words leaves a trail: `covered` at a point it left 300 ms ago is under 1, and
  is 1 again after `wake`. Poison: trail not kept.
- **New:** the painter is given to the tiled layer once, asks for density 1, and with no pointer the field is not
  stepped (spy on `stepField`). Poison: step every frame.
- **New:** the ladder: with a painter stubbed to take 9 ms, `data-dw-fog-level` rises 0 → 4 over frames and never
  falls while in view; it is 0 again after the post leaves and re-enters the view. Poison: lower the level when a
  frame is fast.
- **Changed:** the puff tests (`sprites`, drift) are removed with the puffs. The reduced-motion test ("nothing is
  drawn after the first paint") holds for the new painter. The forced-colors tests gain one: a trail point younger
  than 750 ms is a hole in the mask, an older one is not.
- `still.test.tsx` must pass unchanged.

## Task 6. Cards on cards (#721)

Model: sonnet

**Files:** new `instances/divided-world/ui/hot-box/nesting.test.tsx`.

Design section 4.4. Renders through the engine's `Effects` with real plays, both orders:

1. **Whoops! around Hot Box** (Hot Box played first): Hot Box renders no button for Whoops! to make inert; Hot
   Box's Lens hold is in its `view.controls` and calling it sweeps. Poison: bring back the in-post button (a button
   is found inside an inert subtree).
2. **Below the Fold inside Hot Box** (the fold played first): while smoked, the fold's bar is inside an inert
   subtree and the fold's Lens press is in its `view.controls` and works; after a finished sweep the bar is not
   inert and a click on it works. Poison: keep the words inert in the read window.
3. No element with `data-kb-over-ink` inside inert words computes a `z-index` above the fog's (jsdom reads the rule
   from `hot-box.css`; if jsdom cannot, this case moves to Task 7 and the PR says so). Poison: delete the CSS rule.

## Task 7. Stories and the browser spec

Model: sonnet

**Files:** `instances/divided-world/ui/hot-box/HotBox.board.stories.tsx`, `e2e/hot-box.spec.ts`,
`e2e/board-stories.test.ts` if it lists stories by name.

Stories: keep FreshLight, FreshDark, Thinning, LongPost, Reduced. Add **Parted** (a pointer parked on the second
line with a trail behind it, so the wake is in the snapshot; fixed clock and seed), **FoldUnderSmoke** (Below the
Fold played first), and **Degraded** (level 4 forced by a story arg). Poison for each snapshot: the built smoke.

`e2e/hot-box.spec.ts`:

- **Removed with the button:** `"Wave the smoke" is above the fog and a press on it…` (its "what else is hit and
  what is under the fog" half is kept as its own test), `moving the mouse from the words onto the control closes
  the clearing`, `the control's pointer leave stops a hold`, and `the control is at least 44px tall`.
- **Rewritten:** `Tab reaches the control…` becomes: Tab reaches the mark, Enter opens the Lens, Tab reaches "Wave
  the smoke", a held Enter clears the post, its link can be focused, the smoke is back 20 seconds later and focus is
  on the mark. `the Lens opens from the card's mark…` stays. The forced-colors `long-post: the hold takes as long…`
  drives the Lens control.
- **New: the fog is shaded.** Pixels read from the smoked area hold at least 40 distinct colors and none is the
  flat color alone. Poison: the built smoke.
- **New: the fog moves with the pointer.** Move the mouse right across a line at a steady pace; the clear region
  sampled 60 ms after the move is longer along the path than across it (a streak, not a circle). Poison: a round
  mask following the pointer.
- **New: the wake closes.** A point the pointer left is clearer than rest at 300 ms and at rest by 2.5 s.
- **New: a click holds for a second.** `dispatchEvent('click')` on the Lens control twelve times, 900 ms apart,
  finishes the short post's sweep; one click does not.
- **New: forced colors has the trail.** After a move, a word behind the pointer is unmasked at 500 ms and masked at
  1 s.
- **New: cost.** At 4x CPU throttle (CDP `Emulation.setCPUThrottlingRate`), on LongPost with the pointer sweeping
  for 3 s: the painter's mean script time a frame (read the way the spec's existing cost cases and the tiled layer's own
  read theirs; add no second way of measuring) is within `FOG_BUDGET_MS`, or the level has risen and it is within budget at
  that level. At rest for 3 s: no `stepField` call, and repaints are at most 21 a second. With the post scrolled
  3,000 px out of view: no repaint. Poison: step every frame; repaint at 60.
- **New: a phone.** At 390 px, a drag across a line leaves a wake and the page still scrolls on a vertical swipe.
- Axe cases stay, and gain the smoked post with the Lens open.

Record the cost figures the spec measured (ms a frame at each level, short and long post, throttled and not) in the
PR; they are the answer to the design's "not yet within the budget on a phone".

## Review focus

- **The model is the floor.** No path shows less than `covered` allows, and the field can only add clear space.
  Read `stepField`'s sink and Task 4's test 3 together.
- **One model, four pictures.** Full, reduced, forced colors and the ladder's last step all read `smoke.ts`; none
  has a radius or a timing of its own. The forced-colors trail's 0.5 is checked against the field (Task 4, test 6).
- **The ghost.** Shading never touches alpha at rest.
- **No unattended hold.** A click is one second, on all three cards; nothing latches. Check Whoops! and Graffiti by
  hand in the Lens with a mouse.
- **Nothing pressable is a lie.** With the fold under smoke, the bar neither looks nor is pressable until a wave;
  the in-body line and the mark say the way.
- **Focus is never thrown.** Only focus inside the words moves, and only to the mark.
- **Cost is per screen.** Nothing is stepped at rest, nothing is painted out of view, the ladder only steps down
  while in view, and no figure depends on a post's length.
- **The layers.** The two engine changes name no card; `fog.ts` and `smoke.ts` import no DOM and no vendor client.
- **The masks.** Nothing new is sent, saved or counted; the fog is the same for every reader.
- **Not touched:** the card's art, `scene.py`, its rules and its log lines.
