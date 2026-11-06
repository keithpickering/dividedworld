# Shine: plan

Record, written 2026-11-06. The plan for `docs/plans/2026-11-06-shine-design.md`. One build session builds it in one PR
from `main`. The look and the motion are the Shine bench (`docs/research/2026-11-06-shine-bench/01-bench.html`), which
the owner approved on 2026-11-06. Its numbers are the defaults unless this plan names others: the bench's `foil`,
`drawFlakes`, `flakeColour`, `holoAt`, `fire`, `stepBurst`, `lightFor` and cling code are the reference to port, typed
and split as the tasks say. Where the bench and the design disagree, the design wins on what is decided and the bench on
how it looks.

Every task is test first: name the test, record its red run, then write the code. The one check this plan adds (Task 1's
readability check) arrives with the poison that drives it red. One migration (Task 4). Each task says whether it is
engine or instance. The engine's new files name no card and no instance (`tools/check-engine-boundary.mjs` holds the
imports).

Whoops! is not touched. Its build (branch `ccr-f283e9c1-0jnt2p`) adds `instances/divided-world/cards/whoops/suds.ts` and
`cursor.ts`. Read both before Tasks 3 and 7: the loop's registry and the cling layer copy their shapes on purpose, so the
suds can move onto the page's loop later.

## Task 1: the readable band and the clamp (engine)

Model: sonnet

Files: `engine/ui/shine/band.ts`, `band.test.ts`. Reads `engine/ui/contrast.ts` (`ratio`, `Mode`, `Tokens`).

- `POST_INK = ['--kb-fg', '--kb-link', '--kb-link-visited', '--kb-muted']` moves here from Feelin' Fab's Effect.
- `bandOf(tokens: Tokens): { lo: number; hi: number }`, in relative luminance. If the inks are darker than `--kb-bg`,
  `lo = max over inks of 4.5·(Lᵢ + 0.05) − 0.05` and `hi = 1`. Otherwise `lo = 0` and `hi = min over inks of
  (Lᵢ + 0.05) / 4.5 − 0.05`. Each bound is moved inward by 0.002 so rounding to 8 bits can't cross it.
- `bandFor(el: Element)`: reads the five tokens from `getComputedStyle(el)`, so the band follows however the board
  resolved (device, player's choice, instance theme). The result is cached per token string.
- Linear-light helpers: `toLinear(hex)` and `toSrgb8(l)`, using a 4,097-entry lookup table as the bench's `LUT` does.
- `clampInto(c: [r, g, b], band)`, in place, keeping hue: past `hi` scale by `hi / L`; under `lo` mix toward white by
  `(lo − L) / (1 − L)`.
- `shineIsReadable(tokensByMode, sample: (mode, light) => Iterable<string /* sRGB hex */>)`: for each mode in
  `contrast.ts`'s set, for a 9 × 9 grid of lights over x, y ∈ [−1.5, 1.5], checks every sampled color against every
  `POST_INK` at 4.5:1. It returns the failures in words ("dark: #2a1b55 is 3.9:1 against --kb-muted at light (0.75,
  −1.5)") or an empty list.

Tests first:
- `bandOf` on the engine's tokens (`engine/ui/tokens.css`, read as `contrast.test.tsx` reads them) gives about 0.59/1
  for light and 0/0.048 for dark.
- After `clampInto`, every color of a 4,096-color sweep has a ratio of at least 4.5 against every ink on both boards.
  A color already inside the band is unchanged, and the hue of a clamped saturated color stays within 2° (HSL).
- **The poison:** `shineIsReadable` with a sampler that returns `#ffffff` on the dark board returns a failure naming it.
  A sampler that skips the clamp on one light angle is caught. Record both red runs.

## Task 2: the page's light (engine)

Model: sonnet

Files: `engine/ui/shine/light.ts`, `light.test.ts`. Reads `engine/ui/appearance.ts` (`motionReduced`).

- `REST = { x: −0.35, y: −0.45 }`.
- A pure function, `lightAt(input, rect, viewport, t, phase)`, that ports the bench's `lightFor`:
  - rest at 0.4;
  - pointer: `x += px·0.9`, `y += py·0.55`;
  - scroll: with `s` the rect's center as a share of the viewport height minus 0.5, `y += s·2.8` and `x += s·0.9`;
  - tilt: `x += tx·1.1`, `y += ty·1.1`, only when `input.tilt` is on;
  - idle: `x += sin(t/1700 + phase)·0.1 + sin(t/640 + 0.3·phase)·0.025` and
    `y += cos(t/2100)·0.08 + cos(t/530 + phase)·0.02`;
  - clamped to ±1.5.

  Under reduced motion it returns `REST`, whatever the input.
- `ease(cur, target, dt)`: the 110ms time constant.
- The input store, `light`: `px` and `py` from `pointermove` (only `pointerType` mouse or pen, with
  `(hover: hover) and (pointer: fine)`), and `tx` and `ty` from `deviceorientation` (gamma and beta mapped to ±1 over
  ±30°, only while Task 5's `tiltState()` is `'on'`). Both listeners are passive, and attach when the first host
  registers (Task 3) and detach with the last. `phase` is the host's own seed, so posts don't shimmer in lockstep.

Tests first:
- `lightAt` matches the bench for a table of inputs, and returns `REST` when reduced motion is on.
- A touch `pointermove` doesn't move the light.
- `deviceorientation` is ignored while tilt isn't `'on'`.
- Listeners are added once for three hosts and removed when the last unregisters (spy on `addEventListener`).

## Task 3: the page's loop and the shared in-view observer (engine)

Model: sonnet

Files: `engine/ui/shine/loop.ts`, `loop.test.ts`, `engine/ui/shine/inView.ts` and its test (moved with `git mv` from
`instances/divided-world/ui/feelin-fab/`, unchanged).

- `register(host: object, canvas, box: { w, h }, density, draw: (frame: ShineFrame) => boolean)`, `unregister(host)`
  and `probe`, in the shape of `suds.ts`.
- `ShineFrame` is `{ t, dt, light: { x, y }, moved: boolean, idle: boolean }`. `draw` returns whether the host still has
  something in flight (a burst, a falling flake).
- **The frame loop:**
  - it is one `requestAnimationFrame`, started when a host in view needs a frame, and stopped when none does;
  - each frame eases every in-view host's light, and calls its `draw` when the light moved more than 0.004 (summed |dx|
    + |dy|), when the host is busy, or on the idle cadence (every second frame, about 30 a second) while shimmer runs;
  - the next frame is asked for first, and each host's draw is wrapped in try/catch, as in `suds.ts`;
  - the canvas size is the host's to set; `density` is capped at 2.
- The host's element is watched with `watchInView`. Out of view, the host isn't drawn and is told so (`draw` isn't
  called), so it can drop its buffers.

Tests first (fake rAF and IntersectionObserver, as `inView.test.tsx` fakes them):
- No frame is asked for with no host in view.
- A host in view with a still light and no shimmer draws once, then the loop stops.
- Shimmer keeps the loop running at half rate.
- A host whose draw throws doesn't stop the others.
- `unregister` mid-frame is safe.
- `probe.reset()` returns a fresh page.

## Task 4: the tilt preference (engine, migration)

Model: sonnet

Files:
- `supabase/migrations/0093_tilt_preference.sql` (or the next free number when built);
- `supabase/tests/<next>-tilt-preference.sql`;
- `engine/ui/data/api.ts` (`Preferences.tilt: 'off' | 'on'`, `DEFAULT_PREFERENCES.tilt = 'off'`, the
  `setPreferences` input);
- `engine/ui/data/fake.ts`;
- `web/src/data/supabase.ts` (the select list and its mapping at about lines 108 and 1062).

- The migration:
  - `alter table account_preferences add column tilt text not null default 'off' check (tilt in ('off', 'on'))`;
  - `set_preferences` is dropped and made again with `tilt text default null` added after `text_size`, refusing anything
    but `'off'` and `'on'` with a `kayfabb.refusal`;
  - `preferences_answer` gains the `tilt` key;
  - the grants are restated.

  Drop and recreate rather than replace, as 0033 and 0064 did, because two signatures would make every call ambiguous.
  Copy the body from `0092_card_end.sql`, which holds today's.
- The export needs no change. Its round-trip test covers the column.

Tests first:
- pgTAP: the default is `'off'`; `'on'` is kept; `'sideways'` is refused, naming the choice; another account can't read
  it.
- The fake matches.
- The supabase adapter maps it both ways.

## Task 5: the device's permission and the Appearance row (engine)

Model: sonnet

Files: `engine/ui/shine/tilt.ts`, `tilt.test.ts`, `engine/ui/account/appearanceRows.tsx` (a `TiltRow`),
`engine/ui/account/Settings.tsx`, `Settings.test.tsx`.

- `tiltState(pref)` returns one of:
  - `'on'`: the preference is on and the device has granted, or needs no grant;
  - `'off'`: the preference is off;
  - `'needs-allow'`: the preference is on, and `DeviceOrientationEvent.requestPermission` exists and hasn't been
    granted on this device;
  - `'denied'`: the browser refused;
  - `'unsupported'`: no `DeviceOrientationEvent`, or no event arrives within 1s of listening;
  - `'held'`: reduced motion is on.

  The device's answer is kept in `localStorage` under `kb-tilt-device` (`'granted'` or `'denied'`). It's per device by
  nature, never sent, and is a convenience a cleared browser simply asks again for.
- `allowTilt()` must be called inside a tap. It calls `requestPermission()` where it exists and stores the answer. A
  refusal is never retried without a tap.
- `TiltRow` uses the glass's plain words; these are draft for owner review:
  - legend: "Tilt shiny cards with your phone";
  - on: "On. Tilting your phone moves the light across shiny cards.";
  - needs-allow: a button, "Allow on this phone", which runs `allowTilt()`;
  - denied: "Your browser said no, so shiny cards follow your scrolling instead. To change that, allow motion and
    orientation access for this site in your browser's settings, then turn this on again.";
  - unsupported: "This device doesn't report tilt, so shiny cards follow your scrolling and your pointer instead.";
  - held: "Off while motion is reduced. Shiny cards hold their light still."

  The row is shown only on a device with a coarse pointer, or where `DeviceOrientationEvent` exists, and the account
  choice still saves from any device.

Tests first:
- Each state from a stubbed `DeviceOrientationEvent` (with and without `requestPermission`, granted, denied, throwing).
- `allowTilt` outside a tap isn't called by any effect (assert no call on mount).
- Each row's words.
- Axe on the row in both glass themes.
- Toggling saves `tilt` through `setPreferences`.

## Task 6: the tip with an action (engine and instance words)

Model: sonnet

Files:
- `engine/ui/tips/keys.ts` (add `'shine'` to `TIP_KEYS`);
- `engine/ui/tips/store.ts` (`TipRequest.action?: { run: () => void }`);
- `engine/ui/tips/Tips.tsx` (`TipOptions.action`);
- `engine/ui/tips/Spotlight.tsx` (a third button before Got it when the tip has an action; it runs the action and then
  sees the tip);
- `engine/ui/types.ts` (`InstanceUi.onboarding.tips` entries gain an optional `action: string` label);
- `engine/ui/tips/problems.ts` (a tip the engine gives an action must have a label);
- `instances/divided-world/ui/onboarding.ts`.

- The engine asks for `'shine'` from `loop.ts`'s first registered host. It asks only when that host is in view and
  `tiltState` is `'needs-allow'` (or `'off'` with no device answer stored), on a coarse pointer, under full motion. The
  action calls `allowTilt()` and sets the preference to `'on'`.
- Divided World's words, in Gabe's voice, draft for owner review:
  - title: "This post is shiny";
  - line: "Tilt your phone and the light moves across it, like tilting a real foil card.";
  - action: "Turn on tilt".

Tests first:
- The tip shows once, with three buttons.
- The action runs `allowTilt` in the click and marks the tip seen.
- It doesn't show on a fine pointer, under reduced motion, or once seen.
- `instanceUiProblems` refuses a `'shine'` entry with no action label.
- Axe on the open tip.

## Task 7: the foil (engine)

Model: sonnet

Files: `engine/ui/shine/foil.ts`, `foil.test.ts`.

- `makeFoil({ seed, pattern: 'pearl' | 'bands' | 'prism', palette: readonly string[] /* sRGB, six */, stars: number })`
  returns a foil whose `draw(ctx, box, density, light, band, now, idle)` ports the bench's `foil()`:
  - the 3px grid;
  - the pearl swirls, the bands at `min(0.4·w, 360)`, the prism's 17px seeded facets with seams;
  - highlights toward white;
  - on a dark band, a hue shift toward the palette's opposite stop before the clamp;
  - `clampInto` on every cell;
  - starbursts as a pre-rendered sprite, with alpha scaled by how far the band lets white through (zero on the dark
    board), and the idle wink (`0.85 · max(0, sin(now·0.9 + x·0.05))^24`).
- It keeps its `ImageData` and the prism's cell map. `release()` drops them.
- `sampleFoil(foil, box, light, band)` returns every cell's sRGB color for Task 1's check.

Tests first:
- Determinism: one seed gives the same cells twice, and `Math.random` isn't read (spy).
- **Readable:** `shineIsReadable` passes for all three patterns, with both of Feelin' Fab's palettes, against the
  engine's tokens. Its poison (Task 1) already proves it can fail; here also plant a palette stop of `#ffffff` on the
  dark board without the clamp and see red.
- **The whole rainbow:** on a 988 × 300 box at rest light, each pattern's cells fall into all six hue sextants of its
  palette, at least 2% each.
- Prism facets average 15 to 20px across.
- Cost: one 988 × 300 draw in Node under 40ms (a guard against a per-pixel loop at CSS resolution).

## Task 8: flakes, the burst and cling (engine)

Model: sonnet

Files: `engine/ui/shine/flakes.ts`, `flakes.test.ts`.

- `makeFlakes({ seed, box, inks: readonly string[], holo: number /* index from which inks are holographic */, density:
  70 /* px² per flake */ })`:
  - places flakes as the bench's `buildFlakes` does, seeded, with `tw` (one in eight twinkles) as in its `flake`;
  - `origin` is the seeded burst point;
  - `draw(ctx, light, band, now, idle)` ports `drawFlakes`, `flakeColour` and `holoAt`, with the flare's alpha scaled
    by the band.
- `burst(flakes, now)`: the bench's `fire` and `stepBurst`, drawn on a second canvas over the words. It returns whether
  flakes are still in flight. It runs once per flakes object, and not at all under reduced motion. At most 1,500 flakes
  are in flight across the page; past that a burst lands its remainder at once.
- `loose(host)`: a list per host. The page-wide cap is 300, oldest first.
- **The cling layer:**
  - one page-fixed canvas, `aria-hidden` and `pointer-events: none`;
  - made on the first pickup, and removed after `IDLE_MS` (4,000) with nothing carried or falling, as `cursor.ts` does;
  - pickup from a host marked `sticky` happens only for a mouse on a fine pointer, at most 26 carried;
  - a dropped flake lands on whichever registered host's box is under it, or fades;
  - nothing under reduced motion.

Tests first:
- Determinism.
- About one flake per 70 px² (±5%).
- About three in ten of the bench's inks are holographic.
- **Readable:** `shineIsReadable` passes over flake colors at every light, both boards.
- A burst lands every flake within 3.5s of simulated frames, and none is lost.
- A second `burst` call does nothing.
- Reduced motion: no burst, and all flakes are placed at once.
- The caps.
- The layer is removed after `IDLE_MS`.
- A touch pointer picks nothing up.

## Task 9: Feelin' Fab on the foil (instance)

Model: sonnet

Files: `instances/divided-world/ui/feelin-fab/Effect.tsx`, `fab.css`, `Effect.test.tsx`, `Fab.board.stories.tsx`,
`e2e/fab.spec.ts`, `instances/divided-world/ui/still.test.tsx`.

- The Effect keeps `FAB_STOPS`, `MOST`, `TWINKLES` (now the star counts) and the seed
  (`post.id` + the plays' ids). Its layout:
  - `<div class="dw-fab" data-kb-fab data-kb-level>`;
  - a `<canvas class="dw-fab-foil" aria-hidden>` sized to the box and absolutely placed under the words;
  - the words with their text shadow, as today.
- Level 1 is `'pearl'`, level 2 is `'bands'` and level 3 is `'prism'`. The palette is chosen per board by the band:
  dark when `bandFor(el).hi < 0.5`.
- It registers with `loop.ts` on mount, re-registers on resize (a `ResizeObserver`), and unregisters on unmount. `still`
  draws once at `REST` and registers nothing that moves.
- `fab.css` loses the gradient layers, the keyframes, the twinkle SVGs and `data-kb-running`. It keeps the wrapper, the
  canvas placement and the words' shadow. `stopsAreReadable` goes, since Task 7's check replaces it. Keep the test that
  each palette passes alone, through `bandOf`.
- `e2e/fab.spec.ts` is rewritten for the canvas:
  - the canvas lies under the words and takes no pointer;
  - a post scrolled out of view draws no frames (count the host's draws through `probe`);
  - reduced motion draws once;
  - the poisons, each planted with a style tag as today: a canvas raised over the words, and a canvas that takes the
    pointer.

Tests first: the rewritten Effect tests (the level picks the pattern, the seed is public ids only, `still` draws once at
rest, unmount unregisters), then e2e.

## Task 10: Glitter Bomb on the flakes (instance)

Model: sonnet

Files: `instances/divided-world/ui/glitter-bomb/Effect.tsx`, `glitter.css`, `Effect.test.tsx`, a new
`Glitter.board.stories.tsx`, `instances/divided-world/ui/still.test.tsx`.

- `GLITTER_INKS` becomes the seven rainbow inks then silver `#dfe4ec` three times, as in the bench's `GLITTER`.
  `GLITTER_HOLO = 7`. `GLITTER_ALPHA` and its layer go.
- Two canvases go around the words: settled and loose flakes under them, the burst over them. The seed is
  `${play.id}:${post.id}`.
- The burst fires the first time the post is at least 40% in view: a second IntersectionObserver threshold, through
  `watchInView`'s options, added there.
- The host is `sticky` for cling.
- `still` draws every flake landed at `REST`, with no burst and no cling.

Tests first:
- The seed is public ids only.
- The burst fires once per mount, and never under reduced motion or `still`.
- Unmount unregisters and drops loose flakes.
- The new story shows light and dark boards.

## Task 11: a busy page (instance e2e)

Model: sonnet

Files: `e2e/shine.spec.ts`, a story with 12 posts (four of each Feelin' Fab level, four Glitter Bomb, one plain).

- In Chromium at 1200 × 900, scroll the story top to bottom over 3s with a moving mouse. Record frame times with
  `requestAnimationFrame` in the page.
- Assert the 95th percentile is under 20ms on the CI runner, and that no host out of view draws.
- At rest with shimmer, the loop runs at about 30 draws a second per in-view host.
- With every shiny post scrolled away, the loop stops within one frame.
- Reduced motion: zero frames after the first draw.

Tests first: the spec, red against today's CSS effects (they register no host).

## Review focus

- A post already holding Feelin' Fab or Glitter Bomb plays: the Effects read the same plays and `post.id` as before, so
  existing posts change look only. Check no saved state or Act is read differently.
- The band is read from computed tokens. Check a theme change while posts are drawn (the player switches board mode)
  re-reads it, and that an instance theme with other inks gets its own band, not the engine default's.
- A busy thread: twenty shiny posts, five in view, idle shimmer. Measure the loop's cost per frame, and check that
  buffers out of view are released (memory over a long scroll).
- The tilt permission: a second device, a cleared browser, a refusal then a tap, reduced motion turned on mid-session.
  Check the game never calls `requestPermission` outside a tap, and never asks after a refusal without one.
- The masks: nothing the light, the burst or loose glitter does is sent anywhere. The tilt preference is read only by its
  own account. No timing differs with who owns a post.
- The cling layer and Whoops!'s cursor on one page, once Whoops! lands: two page-fixed layers. Check their z-order and
  that both are removed when idle.
- Contrast at the band's edge: the clamp's 8-bit rounding, and the starburst sprite's `lighter` compositing on the light
  board, which can only brighten (inside the band there) but must be checked on any instance theme whose light board
  is not white.
