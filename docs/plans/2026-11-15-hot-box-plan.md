# Hot Box, smoke over a post that readers wave away: plan

Record, written 2026-11-15. Carries out section 2.2 of `docs/plans/2026-11-15-wave-1-cards-design.md`. One PR from
`main`.

**May start** after `docs/plans/2026-11-15-wave-1-prep-plan.md` merges, beside Rope Break
(`docs/plans/2026-11-15-rope-break-plan.md`): the two keys fall in different slots of the sorted lists.

Every task goes test first: write the failing test, record its red run, then the code. During a task, run only the
tests for the changed code (`npx vitest run <file>`, or `node --experimental-strip-types --test <file>` for the
rules' tests). Run `npm run typecheck` and `npm run build` once after the last task, with the tail in the PR. No
deployed database, bucket or connector is touched.

**The layers.** Everything here is Divided World's, carried in through `CardRules` and `CardUi`. **This build edits
no file under `engine/` and adds no migration.** If a task cannot be done without an engine or SQL change, stop and
ask the owner.

**The world.** The smoke is a game piece on the board: the post under it stays the house style (Verdana, black and
white), and the only color is the smoke's own, the caster's. The control on the post is styled as Below the Fold's
in-words bar is (`instances/divided-world/ui/below-the-fold/fold.css`: the theme's header tokens, mono, small). The
play form and the Lens are the engine's.

**Names used below.** Key `hot-box`, between `heat-magnet` and `hype-up` in every sorted list. Screens in
`instances/divided-world/ui/hot-box/`; classes begin `dw-hotbox`. Effect CSS sits in that folder, never directly in
`ui/` (`tools/check-theme.mjs` reads `ui/*.css` as themes).

**What the engine gives, read and not changed:**

- A cast on a post with `lasts` gets `ends` on its play (`place_cast`), and `CardPlay.ends` reaches the effect. The
  engine goes on handing an ended post play to the effect (`engine/ui/cards/Effects.tsx`, the post layer has no time
  filter), so **this effect decides for itself whether its play is still up**, with `useAt`
  (`engine/ui/cards/plays.ts`), as `ui/whodunnit/Effect.tsx` does.
- `useMotionReduced()` (`engine/ui/appearance.ts`), `watchInView` (`engine/ui/shine/inView.ts`), `endsWords`
  (`engine/ui/cards/marks.ts`), `color()` (`engine/rules/cards.ts`).
- `instances/divided-world/ui/still.test.tsx` takes in every card with a `lasts` by itself and holds it to the
  moment's contract (`EffectProps.still`).

## Task 1. The rules

Model: sonnet

**Files:** a new `instances/divided-world/cards/hot-box.ts`, a new `instances/divided-world/cards/hot-box.test.ts`,
`instances/divided-world/cards/index.ts` (one import line and one list line, between `heat-magnet`'s and
`hype-up`'s), `instances/divided-world/cards/cards.test.ts` (one line, at the same place:
`['hot-box', 'salty', 100],`).

`hotBox: CardRules<{ color: string }>`:

- `key: 'hot-box'`, `name: 'Hot Box'`, `alignment: 'salty'`, `rarity: 'common'`, a cast on a post (no `play`, no
  `reaches`), no `stack` (one at a time), `lasts: { unit: 'day', count: 3 }` exported as `HOT_BOX_LASTS`.
- `playPrice: () => 0`; `canApply: (target, effects, _config, now) => landsOn(hotBox, target, effects, now)`.
- `validateConfig`: the color through `color()`, as `whoops.ts` reads its ink; anything else sent is not kept. The
  refusal: `'the smoke is a color: a named one, or #rgb or #rrggbb'`.
- `staffConfigs: [{ color: 'limegreen' }, { color: 'mediumpurple' }, { color: 'hotpink' }, { color: 'orange' },
  { color: 'lightgray' }]`. **No `staffOptions`**: a persona is given no option, so the lists of cards with options
  (`cards.test.ts`, `supabase/functions/chatter/core.test.ts`) do not change.
- Not `seeded`: the smoke is drawn on each screen and no two readers need the same puffs.
- `export const price: Hundredths = 100;`
- The header comment says what section 2.2 says: an obstacle read through by clearing it; the same for every reader,
  the author and the caster included; nothing saved or sent; three days, thinning; one to a post.

Tests, red first, in `hot-box.test.ts`:

- its facts (key, name, flavor, rarity, cast, `lasts` 3 days, no stack) and its machine price of 100;
- `validateConfig`: `{ color: ' Teal ' }` is kept as `color()` returns it; `{ color: '#abc', seed: 1, x: 2 }` keeps
  the color alone; `{}`, `{ color: 'nope' }` and `undefined` are refused in the words above;
- every `staffConfigs` entry validates, and `staffConfigOf(hotBox, () => 0)` is one of them;
- it lands on a post with no Hot Box; a second is refused (`'this post already carries that card'`) while the first
  is live, and lands when the first's `ends` is in the past (pass `now`); it is refused on a character;
- `decidePlay` on a long post costs 0;
- `decideSet(hotBox, settings, post(10), [], { color: 'teal' }, cards)` is ok: it can be set face down;
- `instanceProblems(instance)` is empty.

## Task 2. The art folder

Model: sonnet

**Files:** a new folder `instances/divided-world/ui/cards/hot-box/` with `art.webp`, `scene.py`, `mark.svg`,
`art.json`.

The card has no art folder; its render and scene are in `docs/research/2026-11-11-card-renders/` (`hot-box.png`,
1080 by 1680, and `hotbox.py`). The research folder is a record and is left as it is.

- `art.webp`: `hot-box.png` encoded as a still WebP at quality 90 (Pillow, or any encoder), at most 400 KB. The
  picture is not rendered again.
- `scene.py`: `hotbox.py` copied in, with the two lines every card scene opens with so it finds `rig.py` one folder
  up and writes no bytecode (copy them from `ui/cards/steel-chair/scene.py`, the `sys.path.insert` and
  `sys.dont_write_bytecode` lines), and its docstring saying what the picture is and, in parentheses, what the card
  does. Say in the PR that the scene was moved and not run from its new place; if it is run and differs, say that
  instead.
- `mark.svg`: a square (100 by 100) silhouette that reads at 18 pixels: the smiley's round face with its heavy
  lids, inside a ring of four or five cloud bumps. Three flat colors from the picture (the cloud's pale green, the
  face's blue, a dark line); no script, no image, no link, under 20 KB. The owner approves the mark in review: show
  it at 18, 36 and 100 pixels in the PR's description.
- `art.json`: the same credit and license as `ui/cards/steel-chair/art.json`.
- `node tools/check-card-art.mjs` passes.

## Task 3. The smoke, as a model

Model: sonnet

**Files:** a new `instances/divided-world/ui/hot-box/smoke.ts` and `smoke.test.ts`. Pure TypeScript: no DOM, no
clock of its own, no `Math.random` (a seeded generator is passed in).

The numbers, exported as one `SMOKE` object so the effect and the tests read the same ones:

| Name | Value | What it is |
|---|---|---|
| `full` | 0.94 | the fog's opacity when the play lands |
| `least` | 0.45 | the fog's opacity as the play ends |
| `hole` | 90 px, never under 56 and never over 22% of the box's width | a clearing's radius |
| `edge` | 0.35 | the share of a clearing's radius over which it fades back to fog |
| `roll` | 2500 ms | how long a clearing takes to close once left |
| `touchHold` | 4000 ms | how long a touched clearing stays open before it starts to close |
| `waved` | 20 000 ms | how long the post stays clear after a finished sweep |
| `puffArea` | 1800 px² a puff, from 24 to 160 puffs | the drifting texture's density |

- `strength(now, playedAt, ends): number`: 1 at `playedAt`, falling in a straight line to 0 at `ends`, clamped; a
  time that is no time gives 1.
- `fogAlpha(strength)`: `least + (full - least) * strength`.
- `holeRadius(boxWidth)`.
- `Clearing = { x, y, openedAt, leftAt | null, hold }` and `openness(clearing, now, reduced)`: 1 while the pointer
  is there (`leftAt` null) and for `hold` after it left; then down to 0 over `roll`; under reduced motion it is 1
  or 0 with nothing between, changing at the same times.
- `covered(x, y, clearings, radius, now, reduced): number`: the fog's share left at a point, 0 inside an open
  clearing, 1 away from all of them, the `edge` between.
- `puffs(seed, width, height)`: the drifting texture's puffs (place, radius, drift, a phase), and
  `puffAt(puff, t, width, height)`: where one is at time `t`, wrapping at the box's edges. Under reduced motion the
  effect calls it with `t = 0`.
- `sweepAt(lines, elapsedMs, boxWidth, pace)`: where a held sweep's clearing is after `elapsedMs`, given the post's
  lines (each a `top`, `bottom`, `left`, `right` in the box) and a pace in px per second: it travels along each line
  left to right, then drops to the next, and reports the index of the last line it has finished, and `done` after
  the last. With no lines it is done at once.

Tests, red first: each function's edges (strength at both ends and outside them; a hole radius at 200, 400 and
2000 px of width; openness at each boundary, with and without reduced motion; coverage at a clearing's center, its
rim and far away, and under two overlapping clearings; puffs wrap and their count is clamped; a sweep over three
lines finishes each in `width / pace` seconds, and its time is the same under reduced motion).

## Task 4. The effect

Model: sonnet

**Files:** new `instances/divided-world/ui/hot-box/Effect.tsx`, `Effect.test.tsx`, `hot-box.css`.

`HotBoxEffect(props: EffectProps)`:

- **Which play.** The first of `plays` whose `ends` is after `now`, where `now = useAt([...])` over the plays' ends
  (in a moment, `still`, the first play as given). With none, it draws `children` alone and calls `show(null)`.
- **What it draws.** `<div class="dw-hotbox">` (position relative) holding, in order: the control (below); the words
  wrapper `<div class="dw-hotbox-words">{children}</div>`; a `<canvas class="dw-hotbox-smoke" data-kb-effect-ink
  aria-hidden="true">` filling the wrapper, `pointer-events: none`; and a visually hidden, polite live region
  (`kb-visually-hidden`, `aria-live="polite"`) for the sweep's lines.
- **The canvas.** Sized to the wrapper by a `ResizeObserver`, at the screen's density capped at 2. Each frame: fill
  with the play's color at `fogAlpha(strength)`; draw the puffs over it as soft discs a little lighter and darker
  than the color; cut each open clearing with `destination-out` and a radial fade (`covered`). The color is read
  with Whoops!'s `rgbOf` (`cards/whoops/splat.ts`), which takes a named color; a color it cannot read draws
  `lightgray`.
- **When it draws.** Only while the post is in view (`watchInView` on the host), on `requestAnimationFrame`; out of
  view the loop stops. Under reduced motion (`useMotionReduced`) there is no loop: it draws once, and again when a
  clearing opens or closes, the box resizes or the strength has moved by a hundredth.
- **The pointer.** `pointermove` and `pointerdown` on the host, passive, never prevented, never captured:
  - a mouse or pen moves one clearing with it (`leftAt` set when the pointer leaves the host, `hold` 0);
  - a touch opens a clearing where it lands (`hold: SMOKE.touchHold`), replacing the touch clearing before it. The
    page's scroll is never taken.
- **The control.** A real `<button type="button" class="dw-hotbox-wave" data-kb-over-ink="">Wave the smoke</button>`
  above the words, with a hidden description (`aria-describedby`): "Hold Space or Enter on this button to wave the
  smoke off line by line, at the pace of a hand. Let go and it rolls back in. Hold to the end and the post stays
  clear for 20 seconds." It is a hold: start on pointer down and on Space or Enter (not on auto-repeat); stop on
  pointer up, leave, cancel, key up and blur, and when the effect unmounts mid-hold. `stop` is idempotent. It is at
  least 44 px tall on a coarse pointer, with the header's focus ring, as `fold.css` does it.
- **The sweep.** While held: the post's lines are read once with Whoops!'s `readLines`
  (`cards/whoops/lines.ts`), and `sweepAt` moves a clearing along them at Whoops!'s `SWEEP_PX_S` (import it from the
  module `cards/whoops/Effect.tsx` imports it from). Every line already finished stays clear while the hold lasts,
  and each finished line's text is put in the live region, one line at a time. Letting go before the end lets the
  smoke back (over `roll`). Holding to the end makes the post **waved**: for `SMOKE.waved` after that, no fog is
  drawn and the words are not inert; then the smoke rolls back.
- **Screen readers and the keyboard.** While the play is live, not `still` and not waved, the words wrapper is
  `inert`, as Whoops! makes an inked body (`cards/whoops/Effect.tsx`, `data-kb-whoops-layout`). So the words, and
  any link in them, are reached through the control: a link in a smoked post is followed after a finished sweep.
  That holds for a mouse too, and the description says it.
- **What it tells the Lens** (`show`), memoized so equal views cost nothing:
  - `state`: `'Smoke over the words'`; `'Waving it away'` while held; `'Waved clear for you'` while waved.
  - `ends`: `` `Point at the words, or hold Wave the smoke, to read. ${endsWords(play.ends)}.` ``
  - `progress`: `1 - strength` (how far the smoke has thinned); `yours: true` unless waved;
  - `controls`: `[{ kind: 'hold', label: 'Wave the smoke', describe: <the description above>, start, stop }]`, the
    same functions as the button's; none in a moment;
  - `notes`: `{}`.
  Each view passes `viewProblems(view, { holds: false, covers: true })` (`engine/ui/cards/lens-words.ts`).
- **`met`** is called once, the first time the smoke is drawn in view; never in a moment.
- **A moment (`still`).** The fog and the puffs as they stood (strength 1 is fine: a moment's `ends` filter is the
  engine's), drawn once; no handler bound, no button, nothing inert, no loop; `show` gives
  `state: 'Smoke over the words'` with no controls.
- **Nobody is special.** It reads neither `reader.author` nor `reader.caster`, and calls neither `save` nor
  `release`.

`hot-box.css`: the host, the canvas's place, the button (from `fold.css`'s bar: the theme's header tokens), the
coarse-pointer height, `forced-colors` (the canvas is hidden and the words are shown plainly: a forced-colors reader
is not smoked, since the fog cannot be drawn in system colors; the button stays), and nothing animated in CSS.

Tests, red first, in `Effect.test.tsx` (props built inline as `below-the-fold/Effect.test.tsx` builds them, inside
`renderInWorld` from `engine/ui/test-world.tsx` since `useAt` needs the world; stub the canvas's 2D context and
`requestAnimationFrame`, and fake the timers):

- a live play draws the canvas, the button and inert words; an ended play (its `ends` in the past) draws `children`
  alone and shows nothing; when the clock passes `ends` the smoke is gone without a reload;
- the fog's alpha at landing, at half way and near the end is `fogAlpha`'s;
- a mouse move opens a clearing at the pointer and it closes `roll` after the pointer leaves; a touch's clearing
  holds `touchHold` first; no handler calls `preventDefault`;
- holding the button (pointer, and Space) starts the sweep; lines reach the live region in order; letting go early
  restores the fog and leaves the words inert; holding to the end removes `inert` for `waved` and then restores it;
  blur and unmount stop the hold;
- under reduced motion (`data-kb-motion='reduce'` on the root) no frame loop runs, a clearing appears and goes with
  no steps between, and the sweep takes exactly as long;
- every view shown passes `viewProblems`, and `state` never exceeds six words;
- with `still`, nothing is inert, no button or handler exists and no frame is requested (`still.test.tsx` holds the
  rest);
- two readers' props that differ only in `reader.author` and `reader.caster` render the same.

## Task 5. The play form's color

Model: sonnet

**Files:** new `instances/divided-world/ui/hot-box/ConfigForm.tsx` and `ConfigForm.test.tsx`.

A fieldset with the legend "Smoke color": a radio group of Whoops!'s six swatches (`SWATCHES`,
`cards/whoops/names.ts`) and an "Any color" `<input type="color">`, laid out and labeled as
`cards/whoops/ConfigForm.tsx` does, without its splat preview. On mount with no color it calls
`onChange({ color: <the first swatch> })`. It may import Whoops!'s stylesheet for the swatches' look, or carry its
own rules in `hot-box.css`; it adds no `kb-` class that has no rule (`tools/check-css-classes.mjs`).

Tests, red first: the default is set on mount; picking a swatch and picking any color each call `onChange` with
`{ color }`; the group is a labeled radio group; a color already in `config` is shown as picked.

## Task 6. The face, the sheet and the lists

Model: sonnet

**Files:** a new `instances/divided-world/ui/cards/hot-box/ui.ts`, `instances/divided-world/ui/cards.ts` (one import
line and one list line, between `heat-magnet`'s and `hype-up`'s), `instances/divided-world/ui/index.test.tsx`.

`ui.ts` follows `ui/cards/whoops/ui.ts` (a lazy `Effect`, a `ConfigForm`, a `tag`):

- `art: { color: '#ff3d7f', ink: '#14030a', canvas, mark, credit, tagline: 'Smoke out a post.' }`
- `summary: 'Fills a post with smoke in your color. Readers wave it away to read, and it rolls back in.'`
- `status: 'Smoke on this post'`
- `hint: 'Point at the words to part the smoke.'`
- `Effect` (lazy, as Whoops!'s), `ConfigForm`
- `tag`: the play's color as a hex, as Whoops!'s `tag` does it with `rgbOf`.
- `describe: () =>` "A Salty card, common. It fills a post with smoke in the color you choose. Under the smoke the
  words can't be read: a reader points at them to clear a patch, or holds Wave the smoke to clear the post line by
  line, and the smoke rolls back in. It is the same for every reader, the post's author and you included. It lasts
  `${spanWords(HOT_BOX_LASTS)}`, thinning as it goes, then clears by itself. One fits on a post at a time.
  `${setMoveWords('the quoting post')}` It costs nothing more to play." The rarity and the span are read from the
  rules. Check `spanWords`' output reads "3 days" there.
- `logPlay: (config) =>` `` `It smoked the post in ${inkName(color)}.` `` where the color reads as one
  (`inkName`, `cards/whoops/names.ts`), else undefined.

Tests, red first, in `ui/index.test.tsx`, as a block of its own like THIS's (`'THIS has its face, its words …'`):
each string above, the art's two colors, that it has an `Effect` and a `ConfigForm`, `describe(instance.settings)`
whole, and `logPlay({ color: '#19e3ff' }, {})`. The file's rules over every card pass with the card in.

## Task 7. Stories, and in a browser

Model: sonnet

**Files:** a new `instances/divided-world/ui/hot-box/HotBox.board.stories.tsx`, `e2e/board-stories.test.ts` (one
line), a new `e2e/hot-box.spec.ts`.

- Stories, titled `'Boards/24 Hot Box'`, on the model of `ui/below-the-fold/Fold.board.stories.tsx` (seed the play
  with the fake's `seed.card`, `live: true`, `config: { color }`; pick the card with `cardOf` from
  `engine/ui/story.tsx` wherever the story needs its rules, never by place in `instance.cards`):
  `fresh-light`, `fresh-dark` (just landed, full strength), `thinning` (two and a half days in), `long-post` (a post
  of twelve paragraphs with a link in it), `reduced` (`data-kb-motion='reduce'`).
- `e2e/board-stories.test.ts`: one `arrayContaining` line with the five ids.
- `e2e/hot-box.spec.ts`, on the model of `e2e/fold.spec.ts`:
  - the words under the smoke are covered: the canvas's pixel at a word's center is the smoke's color, within a
    tolerance, and the body is inert;
  - moving the mouse over a line clears it there (the pixel is transparent) and it closes again after the pointer
    leaves;
  - a tap on the phone project opens a clearing and the page still scrolls with a swipe over the post;
  - Tab reaches "Wave the smoke"; holding Enter to the end leaves the post clear, the link in `long-post` can then
    be focused, and 20 seconds later (advance the page's clock) the smoke is back;
  - the Lens opens from the card's mark and shows "Smoke over the words", the way out and the hold control;
  - `reduced`: no animation frames after the first paint, and the hold still takes time;
  - `thinning` is visibly thinner than `fresh-light` (the fog pixel's alpha is lower);
  - axe finds nothing on `fresh-light`, `fresh-dark` and `reduced`;
  - at phone width the button is at least 44 px tall.

## Task 8. The build

Model: inline

`npm run typecheck` and `npm run build`, tails in the PR, with a screenshot of `fresh-light`, `thinning` and the
phone, and the mark at three sizes (Task 2).

## Review focus

- **Is it an obstacle of equal cost on every path?** Time a 12-paragraph post three ways: a mouse reading line by
  line, taps on a phone, and the held sweep. The owner's rule is that the accessible path costs about what the
  obstacle costs ("An accessible path costs what the obstacle costs"); the sweep must not be a shortcut (20 seconds
  of clear post after a full sweep is its reward) nor a punishment.
- **Inert words for three days.** A smoked post's links and selection are reached only after a finished sweep, for
  every reader. Confirm there is always a way: the button is never inert, never covered, and present wherever the
  post is drawn (a thread, the ORIGIN box), and a moment makes nothing inert.
- **An ended play is still handed to the effect.** Confirm the smoke goes at `ends` on a page left open, and that a
  second Hot Box cast after the first ended draws the new play and not the old.
- **Cost on a busy page.** Twenty smoked posts in one thread: only those in view run a loop, each canvas is capped at
  twice the density, and nothing runs under reduced motion. Profile `long-post` on the phone project.
- **Other cards on the same post.** Whoops! under or over the smoke (the ink registry: this layer has
  `pointer-events: none` and claims nothing, so a scrub passes through to Whoops!, but the words are inert);
  Below the Fold's bar (the engine's row fold, and the in-words bar in the ORIGIN box); Stick Around's takeover;
  THIS's notes. Each must stay usable or be plainly covered, never broken.
- **The masks.** Nothing is saved, sent, counted or broadcast when a reader clears smoke, and nothing differs for
  the author or the caster. Confirm no call to `save`, `release` or the api is reachable from the effect.
- **Forced colors.** A forced-colors reader is not smoked. That is a choice (the fog cannot be drawn in system
  colors) and a path cheaper than the obstacle: the owner should see it in the PR and may ask for the words to be
  held behind the button there instead.
- **The art** is the research render encoded again and a mark drawn by the build; the scene was moved, not run.
