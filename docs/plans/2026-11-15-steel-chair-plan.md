# Steel Chair, a chair thrown at a post: plan

Record, written 2026-11-15. Carries out section 2.3 of `docs/plans/2026-11-15-wave-1-cards-design.md`. One PR from
`main`.

**May start** after Rope Break (`docs/plans/2026-11-15-rope-break-plan.md`) merges: `rope-break` and `steel-chair`
fall between the same two keys of the sorted lists (`docs/plans/2026-11-14-base-set-design.md`, section 2), so this
build starts from a main that holds Rope Break's lines. It may build beside Hot Box.

Every task goes test first: write the failing test, record its red run, then the code. During a task, run only the
tests for the changed code (`npx vitest run <file>`, or `node --experimental-strip-types --test <file>` for the
rules' tests). Run `npm run typecheck` and `npm run build` once after the last task, with the tail in the PR. No
deployed database, bucket or connector is touched.

**The layers.** Everything here is Divided World's, carried in through `CardRules`, `CardUi` and the instance's
sounds (`SoundsUi`). **This build edits no file under `engine/` and adds no migration.** If a task cannot be done
without an engine or SQL change, stop and ask the owner.

**The world.** The chair and the dent are game pieces on the board: the post stays the house style, and the only
things drawn in color or in depth are the chair and the dent's shading. The mock the owner approved is described in
the design; its numbers are below. Where this plan and the mock's memory disagree, this plan wins on what is decided,
and the owner judges the look in review.

**Names used below.** Key `steel-chair`, between `rope-break` and `stick-around` in every sorted list. Screens in
`instances/divided-world/ui/steel-chair/`; classes begin `dw-chair`. Its art folder
(`instances/divided-world/ui/cards/steel-chair/`) exists and is not changed.

**What the engine gives, read and not changed:**

- A cast on a post with `lasts` gets `ends` on its play, and the engine goes on handing an ended post play to the
  effect (`engine/ui/cards/Effects.tsx`), so **this effect drops its ended plays itself**, with `useAt`
  (`engine/ui/cards/plays.ts`). With a stack of three, a fourth play can land once one has ended, and the effect is
  then handed four.
- `useMotionReduced()` (`engine/ui/appearance.ts`); `watchInView` (`engine/ui/shine/inView.ts`), used the way
  `ui/glitter-bomb/Effect.tsx` arms its burst; `useSound()` and `useGameSound()` (`engine/ui/audio/`), used the way
  `ui/laugh-track/Effect.tsx` does; `endsWords` (`engine/ui/cards/marks.ts`).
- `instances/divided-world/ui/still.test.tsx` takes in every card with a `lasts` or a stack by itself.
- The page's policy lets a filter read an image from a `data:` address (`web/headers.ts`, `img-src`), and allows no
  inline style sheet: every position is set through the element's `style` object, as the other effects do.

## Task 1. The rules

Model: haiku

**Files:** a new `instances/divided-world/cards/steel-chair.ts`, a new
`instances/divided-world/cards/steel-chair.test.ts`, `instances/divided-world/cards/index.ts` (one import line and
one list line, between `rope-break`'s and `stick-around`'s), `instances/divided-world/cards/cards.test.ts` (one
line, at the same place: `['steel-chair', 'salty', 100],`).

`steel-chair.ts`, whole:

```ts
/**
 * Steel Chair (Salty, common, a Move on a post): a folding chair is thrown at the post, dents it and falls to the floor under its
 * words (docs/plans/2026-11-15-wave-1-cards-design.md, section 2.3). It covers none of the words and holds nobody: it is loud, so
 * that it can outdraw the post it lands on. Up to three stack, each its own dent and chair, and each is gone 3 days after it landed.
 * Where a throw lands is chosen on each reader's screen each time (instances/divided-world/ui/steel-chair/), so nothing is seeded,
 * saved or sent. It costs nothing more to play than its price at the machine.
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';
import type { Hundredths, Span } from '../../../engine/rules/types.ts';

export const STEEL_CHAIR_LASTS: Span = { unit: 'day', count: 3 };

export const steelChair: CardRules<Record<string, never>> = {
  key: 'steel-chair',
  name: 'Steel Chair',
  alignment: 'salty',
  rarity: 'common',
  stack: 3,
  lasts: STEEL_CHAIR_LASTS,
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(steelChair, target, effects, now),
  validateConfig: () => ok({}),
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 100;
```

If `Span` is exported from another module, import it from there (`hype-up.ts`'s `PUBLICITY_LASTS` shows where).

Tests, red first, in `steel-chair.test.ts` (model: `below-the-fold.test.ts`):

- its facts (key, name, flavor, rarity, cast, stack 3, 3 days) and its machine price of 100;
- it lands on a bare post and on one with two live chairs; a fourth on three live chairs is refused
  (`'this post already carries 3 of that card, the most it takes'`); with one of the three ended (pass `now`), it
  lands; it is refused on a character;
- `decidePlay` costs 0 and keeps `{}`; `decideSet` is ok (it can be set face down);
- `staffConfigOf(steelChair, () => 0)` is `{}`; `instanceProblems(instance)` is empty.

## Task 2. The sounds

Model: sonnet

**Files:** five new files in `instances/divided-world/ui/sounds/` (`steel-chair-hit.mp3`,
`steel-chair-settle-1.mp3` to `-4.mp3`), `instances/divided-world/ui/sounds/sounds.json`,
`instances/divided-world/ui/sounds.ts`, `instances/divided-world/ui/sounds.test.ts` if it lists files,
`instances/divided-world/ui/index.test.tsx` (the sounds table, `'exactly the twelve slots of the design'`).

The owner's five raw sounds are in `docs/research/2026-11-15-steel-chair/sounds/` (a record; left as it is). Each
is 3.00 s. Cut them with `ffmpeg` (it must be on the path; `tools/measure-sounds.mjs` needs it too):

| Raw file | Keep | Becomes |
|---|---|---|
| `impact-raw.mp3` | 0.30 s to 1.20 s, the first hit alone (the main hit runs 0.37 to 1.00; a second, smaller one at 1.70 is cut), with a 0.15 s fade out | `steel-chair-hit.mp3` |
| `settle-1-raw.mp3` | 0 to 1.45 s | `steel-chair-settle-1.mp3` |
| `settle-2-raw.mp3` | 0 to 1.25 s | `steel-chair-settle-2.mp3` |
| `settle-3-raw.mp3` | 0.05 s to 0.90 s (two faint ticks after 2.1 s are cut) | `steel-chair-settle-3.mp3` |
| `settle-4-raw.mp3` | 0.15 s to 1.00 s | `steel-chair-settle-4.mp3` |

Each cut ends in a 0.1 s fade (0.15 for the hit) so it does not click, for example
`ffmpeg -ss 0.30 -to 1.20 -i impact-raw.mp3 -af "afade=t=out:st=0.75:d=0.15" -c:a libmp3lame -q:a 4 steel-chair-hit.mp3`.
Listen to each before going on (or read its `silencedetect` output): the hit must hold one impact and no second.

- `sounds.json`: five entries after the twelve, with `source: "ElevenLabs Sound Effects"`, and the `license` and
  `maker` strings the twelve carry, copied exactly. Then `node tools/measure-sounds.mjs` writes `lufs`, `peak` and
  `sha256`. `node tools/check-sounds.mjs` passes (each file under 300 KB, an MP3, in the manifest).
- `sounds.ts`: five imports and five slots, after the laugh track's:
  `slot('steel-chair.hit', 'steel-chair-hit.mp3', hit, 'A steel chair clangs', 'var(--kb-salty)')` and
  `slot('steel-chair.settle-N', …, 'A chair clatters to the floor', 'var(--kb-salty)')` for 1 to 4. The file's
  header comment says the folder now holds the laugh track and Steel Chair's sounds. `preview` is unchanged.
- `ui/index.test.tsx`: the sounds table grows to seventeen: rename the test and add the five keys and captions.

Tests, red first: the table (red until the slots exist), and `sounds.test.ts` as it stands (every manifest file is a
slot's and the reverse).

## Task 3. The chair's body

Model: sonnet

**Files:** new `instances/divided-world/ui/steel-chair/body.ts` and `body.test.ts`. Pure TypeScript: no DOM, no
clock of its own, no `Math.random` (a seeded generator, `rng(seed)`, is defined here and passed everywhere).

The owner's words for this task: "the chair is sort of snapping back to a standard 2D orientation once it's on the
floor, would be nice if we could make it settle on the floor in a way that completes the movement realistically."
So nothing in this file moves an orientation toward a chosen pose. Rest is what the contacts leave.

Units are CSS pixels and seconds; x right, y down, z toward the reader. The world is the words' box: a floor (the
plane `y = floorY`), two side walls (`x = 0`, `x = width`), and a back wall and a glass (`z = -DEPTH`, `z = DEPTH`,
`DEPTH = 40`) that keep the chair in front of the post.

- **The throw** (`throwOf(rand, width, height): Throw`): a target point inside the words' box, inset 15% from each
  side and from the top, and no lower than 60% of the height; a direction of approach, any angle; a start point one
  box-diagonal away along it; a speed of 1500 px/s; a starting spin (three angular velocities up to 600°/s) and
  orientation, random; a scale that falls from 2.2 to 1 on the way in, as the mock's did.
- **Flight.** A straight line to the target at that speed, the spin running, the chair open (`fold = 1`).
- **The hit**, the moment the target is reached: the event `{ kind: 'hit', at: target }` is reported once; the
  velocity becomes the approach reversed at 170 px/s plus a random sideways kick of up to 110 px/s and an upward
  180 px/s; a new random spin (up to 900°/s on two axes and 700°/s on the third); and the hinge starts to close
  (`fold` goes to 0 as a critically damped spring, about 0.15 s).
- **After the hit, a rigid body.** The folded chair is a box 46 wide, 90 tall and 8 thick, of uniform density, with
  a quaternion orientation. Each step (a fixed 1/120 s, the caller accumulates time): gravity 1900 px/s²; then, for
  each of the box's eight corners that is past a wall or the floor, or inside a resting chair's box (below), an
  impulse at that corner along the contact's normal, with restitution 0.35 on the floor and 0.5 on a wall, and
  Coulomb friction 0.5 along the surface; positions are pushed out of penetration. Angular velocity is damped by 0.6
  per second and linear by 0.1.
- **Sleep.** A body whose linear speed stays under 6 px/s and angular speed under 12°/s for 0.4 s sleeps. A sleeping
  body is a static obstacle for the others: its oriented box. A corner contact on a sleeping body with a closing
  speed over 200 px/s wakes it with the equal and opposite impulse, so a landing chair can knock a lying one.
- **Events:** `hit` (once), `floor` (the first time a corner meets the floor after the hit, with the closing speed),
  `rest` (on sleep).
- **The API:** `createWorld(width, height, floorY)`, `addThrow(world, throwOf(...))`, `step(world, dt): Event[]`,
  `bodies(world)` (each: position, quaternion, `fold`, `scale`, `phase`, `asleep`), `settle(world, maxSeconds)`
  (steps until every body sleeps, for reduced motion and a moment, and returns whether it did), and
  `resize(world, width, height, floorY)` (wakes every body).

Tests, red first, over 200 seeds each unless said:

- flight reaches the target and reports exactly one `hit`, at the target;
- after the hit no corner is ever more than 0.5 px past the floor or a wall at the end of a step;
- the body's energy (kinetic plus `g·height`) never rises between two steps after the hit, beyond rounding;
- every throw sleeps within 6 simulated seconds, and at rest four corners of one face lie within 0.75 px of the
  floor or of the body it lies on (it lies on a face, never balanced on an edge or a corner);
- **no snap:** between any two consecutive steps the orientation turns by no more than `|ω|·dt` plus a hundredth of a
  degree, right up to sleep; and over the 200 seeds the bodies come to rest on at least three different faces or
  headings (a fixed final pose would give one);
- three throws into one world all sleep, none overlapping another by more than 1 px, and at least one seed in the
  200 wakes a sleeping body;
- `settle` gives the same final state as stepping by hand; the same seed gives the same throw and the same rest.

If the corner-impulse model cannot meet "never balanced on an edge" within these numbers, tune the damping, the
sleep thresholds or the box's thickness, and say what changed in the PR; do not add a step that turns the box
toward a pose.

## Task 4. The chair's look, and the dent

Model: sonnet

**Files:** new `instances/divided-world/ui/steel-chair/chair.ts` and `chair.test.ts` (the pieces and their shade),
`dent.ts` and `dent.test.ts` (the displacement map and the filter's parts), `steel-chair.css`.

- **The pieces** (`chair.ts`): the chair as flat rectangles in its own frame, in two groups joined at a hinge line:
  the back frame (two legs and a top bar, drawn as a bordered box 46 by 90 with no bottom edge, and the backrest
  panel across its top, 42 by 26) and, hinged to it, the seat (42 by 38) and the rear legs' frame (42 by 58). Open
  (`fold = 1`) the seat stands 88° from the back frame and the rear frame -32°; shut (`fold = 0`) both lie in the
  back frame's plane, and the three together are the 46 by 90 by 8 box the body simulates. A tube is two thin
  strips crossed at right angles so it does not vanish edge-on.
  - `piecesOf(fold)`: each piece's size and its transform in the chair's frame (a `DOMMatrix`-ready 4 by 4).
  - `shadeOf(normal)`: the piece's steel gray from the angle it faces, lit from above and in front:
    `150 + 70·|n.z| − 40·n.y`, clamped to 60 to 235, with a little blue (`rgb(b, b + 6, b + 16)`), as the mock's.
- **Drawing** (`steel-chair.css` and the effect): a layer over the words with `perspective: 700px` and
  `perspective-origin: 50% 30%`, each chair a `transform-style: preserve-3d` group, each piece a `div`. All of it
  `aria-hidden`, `pointer-events: none`. Colors are literals here: the instance's CSS is not held to the engine's
  tokens.
- **The dent** (`dent.ts`):
  - `dentMap(size = 160)`: the displacement map's pixels: red and green carry a push away from the center,
    `sin(r·π)·(1 − r)` at distance `r` (0 to 1) from it, 128 where there is none, blue 128, opaque. `dentMapUrl()`
    draws it to a canvas once and keeps the `data:` address.
  - The filter, one per post, its `id` from `useId`: a flood of `rgb(128,128,128)`, each live dent's `feImage`
    (160 px, scaled so a dent is never wider than 60% of the box) composited over it, then one
    `feDisplacementMap` on the words with `xChannelSelector="R"`, `yChannelSelector="G"`,
    `color-interpolation-filters="sRGB"`, `primitiveUnits="userSpaceOnUse"`. `DENT_SCALE = 26`.
  - The shading: a round `div` per dent over the words, a radial gradient dark toward the upper left and light
    toward the lower right, as the mock's, with two thin crease lines; `aria-hidden`, `pointer-events: none`.
  - `filterTrusted()`: false on WebKit that is not Chromium (a user-agent test, with a comment saying why:
    WebKit's `feImage` on HTML content is uneven, design section 5), and where `CSS.supports('filter', 'url(#x)')`
    is false. Where it is false the words get no filter and the shading alone is the dent.
- Under `forced-colors`, the shading and the chairs are hidden and the filter stays.

Tests, red first: `piecesOf(0)` fits inside the 46 by 90 by 8 box and `piecesOf(1)` has the seat near 88° from the
back; `shadeOf` at the three axes and its clamps; `dentMap`'s center and rim are neutral, its ring pushes outward
in every direction, and its pixels are opaque; `filterTrusted` for a Chrome, a Firefox and a Safari user agent.

## Task 5. The effect

Model: sonnet

**Files:** new `instances/divided-world/ui/steel-chair/Effect.tsx` and `Effect.test.tsx`.

`SteelChairEffect(props: EffectProps)`:

- **Which plays.** Those whose `ends` is after `now` (`useAt` over the ends), in the order given, the first three.
  With none, `children` alone and `show(null)`.
- **What it draws.** `<div class="dw-chair">` (position relative) holding the SVG filter (zero size, `aria-hidden`),
  the words wrapper (`filter: url(#id)` set through its `style`, only where `filterTrusted()`), the dents' shading,
  the chairs' layer, and **the floor**: 28 px of padding under the words while any play is live, where the chairs
  come to rest. The floor is part of the wrapper's height, so a resting chair covers no words.
- **A run.** One `createWorld` per run, sized to the words' box (a `ResizeObserver` calls `resize`). For each live
  play, 350 ms apart, a throw from a generator seeded freshly for the run (`crypto.getRandomValues`): so every run,
  and every reader, sees a different throw. On each `hit`: that play's dent appears at the point, its displacement
  growing from 0 to `DENT_SCALE` over 90 ms, and the post shakes once (a 4 px, 0.25 s CSS shake on the wrapper).
  The loop runs on `requestAnimationFrame` only while a body is awake.
- **When a run starts.** When the post's middle has been in view for 300 ms (`watchInView` with
  `rootMargin: '-20% 0px -20% 0px'`, as Glitter Bomb arms). When the post has wholly left the view, the run is
  cleared (no dents, no chairs), so coming back to it starts a new one: "a slightly different effect every time it
  gets scrolled into view". A play that lands while the post is in view (the plays' list grows) throws that chair
  alone into the standing world.
- **Sound.** With `useSound()`: `steel-chair.hit` on a `hit`, and on that chair's `floor` event one of
  `steel-chair.settle-1` to `-4`, chosen by the run's generator, both in the group `'steel-chair'`. **Only on the
  first run after the effect mounts**; a replay, by scroll or by "Throw again", is silent. The engine mutes a game
  sound for a player who has them off and shows its caption either way; nothing here reads the preference except
  the Lens's switch.
- **Reduced motion.** No flight and no shake: on arming, the world is built, `settle` is run to the end, and the
  dents (at full depth) and the chairs at rest are drawn at once. No sound. It still differs run to run.
- **A moment (`still`).** As reduced motion, with the generator seeded from the plays' ids so the moment is the same
  each time it is opened; no observer, no handler, no sound, nothing inert.
- **What it tells the Lens** (`show`), memoized:
  - `state`: `'Dented by a chair'` for one live play, `` `Dented by ${n} chairs` `` for more;
  - `ends`: `endsWords(<the soonest live end>)`, and for more than one, "The first chair is gone
    `<day and time>`; each lasts 3 days." built from the same helper;
  - `progress: null`, `yours: false`, `notes: {}`;
  - `controls`: `[{ kind: 'press', label: 'Throw again', run: <clear and start a run, silent> },
    { kind: 'toggle', label: 'Game sounds', on: gameSound.on, set: gameSound.set }]`; none in a moment.
  Each view passes `viewProblems(view, { holds: false, covers: false })`.
- **`met`** once, when the first run starts; never in a moment.
- **Nobody is special**, and nothing is saved: it reads neither `reader.author` nor `reader.caster` and calls
  neither `save` nor `release`.

Tests, red first, in `Effect.test.tsx` (inside `renderInWorld`; stub `requestAnimationFrame`, the observer and the
sound's `play`; fake the timers; props inline as `below-the-fold/Effect.test.tsx` builds them):

- no live play: `children` alone, no floor, nothing shown; one, two and three live plays: that many chairs and
  dents after a run, and the floor's 28 px; a fourth play handed with one ended draws three;
- a play's `ends` passing removes its chair and dent on an open page;
- a run starts only after the post's middle has been in view 300 ms; leaving the view clears it; returning runs
  again with a different target (two runs' dent points differ);
- every chair ends inside the box and on the floor strip or on another chair, asleep, and the frame loop stops;
- the hit's sound and one settle sound play once per chair on the first run, and none on a replay or on
  "Throw again";
- reduced motion: no frame is requested, the dents and resting chairs are there at once, no sound, no shake class;
- `still`: the same picture for the same plays twice over; no observer; no sound; nothing inert;
- where `filterTrusted()` is false the words carry no `filter` and the shading is drawn;
- the views pass `viewProblems`; the status words for one, two and three plays are at most six words
  (`ui.status`, Task 6, is held by `instanceUiProblems` for each count);
- props that differ only in `reader` render the same.

## Task 6. The face, the sheet and the lists

Model: sonnet

**Files:** a new `instances/divided-world/ui/cards/steel-chair/ui.ts`, `instances/divided-world/ui/cards.ts` (one
import line and one list line, between `rope-break`'s and `stick-around`'s),
`instances/divided-world/ui/index.test.tsx`.

`ui.ts` follows `ui/cards/below-the-fold/ui.ts` (a lazy `Effect`, no form):

- `art: { color: '#ff3d7f', ink: '#14030a', canvas, mark, credit, tagline: 'Dent a post.' }`
- `summary: 'Hits a post with a folding chair and leaves a dent.'`
- `status: (plays) => plays.length <= 1 ? 'Dented by a chair' : `` `Dented by ${plays.length} chairs` ``
- `hint: 'Someone took a chair to this post. The Lens says who.'`
- `Effect` (lazy)
- `describe: () =>` "A Salty card, common. A folding chair is thrown at a post and dents it: the words bend into
  the dent, and the chair drops to the floor under them. It covers none of the words and holds nobody. It plays
  again each time the post scrolls into view, somewhere else each time; with Game sounds on, it clangs the first
  time. Up to `${steelChair.stack}` can stack on one post, each with its own dent, and each is gone
  `${spanWords(STEEL_CHAIR_LASTS)}` after it lands. `${setMoveWords('the quoting post')}` It costs nothing more to
  play." Check `spanWords`' output reads "3 days" there.

Tests, red first, in `ui/index.test.tsx`, a block of its own: each string, the art's colors, the status for one,
two and three plays, `describe(instance.settings)` whole, and that it has an `Effect` and no `ConfigForm`.

## Task 7. Stories, and in a browser

Model: sonnet

**Files:** a new `instances/divided-world/ui/steel-chair/Chair.board.stories.tsx`, `e2e/board-stories.test.ts` (one
line), a new `e2e/steel-chair.spec.ts`.

- Stories, titled `'Boards/25 Steel Chair'`, on the model of `ui/below-the-fold/Fold.board.stories.tsx` (the fake's
  `seed.card` with `live: true`; pick the card with `cardOf` from `engine/ui/story.tsx` where the story needs its
  rules): `one-light`, `one-dark`, `three` (three plays by three characters), `short-post` (one line of words),
  `reduced` (`data-kb-motion='reduce'`).
- `e2e/board-stories.test.ts`: one `arrayContaining` line with the five ids.
- `e2e/steel-chair.spec.ts`, on the model of `e2e/glitter.spec.ts` and `e2e/fold.spec.ts`:
  - `one-light`: within 6 seconds of the post being in view there is one dent and one chair, the chair's box lies
    inside the floor strip, and no animation frame is requested after it rests;
  - the post's words are all still in the page's text, selectable, and none is covered by the chair's box;
  - `three`: three dents, three chairs at rest, none outside the words' box;
  - scrolling the post out and back runs it again (the dent's place changes);
  - the Lens opens from the card's mark, shows "Dented by a chair" and "Throw again", and pressing it runs again;
  - `reduced`: the dent and the resting chair are there on first paint and nothing moves;
  - `short-post`: the row is as tall as its words plus the floor, and the chair rests inside it;
  - axe finds nothing on `one-light`, `one-dark` and `reduced`;
  - at phone width the chair stays inside the post and the page does not scroll sideways.

## Task 8. The build

Model: inline

`npm run typecheck` and `npm run build`, tails in the PR, with a short screen recording or four frames of one throw
(in flight, the hit, mid-fall, at rest), a frame of `three` at rest, and the five sounds named with their lengths,
for the owner to judge the look and to hear.

## Review focus

- **Does it settle like a thing?** The owner's one correction to the mock. Watch twenty throws: the chair must tip
  and slide to rest with no moment where it turns by itself toward a pose, and never hang on an edge. Read `body.ts`
  for any term that steers orientation.
- **Does it hide anything?** The card's claim is that it covers no words. At `DENT_SCALE` the words in a dent must
  stay readable on a phone-width post and on a one-line post; three dents on a short post is the worst case. If a
  dent makes a line unreadable, the scale comes down; the card does not gain an accessible path instead.
- **The filter on a long post.** A displacement filter makes the browser paint the whole words box off screen.
  Profile a post of several screens with three dents while scrolling, on the phone project; if it janks, the filter
  is applied to a box around each dent instead of the whole of the words.
- **Safari.** The dent is shading alone where `filterTrusted()` is false. Confirm the test covers both branches and
  say in the PR that Safari was not seen (design section 5).
- **Cost on a busy page.** Many posts with chairs: only posts in view run, each loop stops at rest, and a world is
  dropped when its post leaves the view. Check nothing keeps a `ResizeObserver` or a frame alive off screen.
- **Sound.** Once per mount and never on a replay; three chairs make three hits 350 ms apart. Confirm a thread of
  several chaired posts scrolled quickly is not a wall of clangs for a player with game sounds on, and that each
  sound's caption shows when sounds are off.
- **Other cards on the same post.** The chairs' layer and the shading take no pointer, so Whoops!'s scrub, Hot
  Box's clearing and Below the Fold's bar work under them. The filter wraps `children`, which hold the earlier
  cards' effects: confirm Whoops!'s ink and Hot Box's canvas inside a filtered wrapper still hit-test where they
  are drawn (a displacement moves pixels, not hit boxes), and that Stick Around's takeover is unaffected.
- **Ended plays.** With three live and one ended handed in, three are drawn; when a play ends on an open page its
  chair and dent go and the others stay where they lie.
- **The masks.** Every random choice is the reader's own screen's; nothing is saved, sent or broadcast, and nothing
  differs for the author or the caster.
- **The slot.** This PR's lines in the sorted places sit between `rope-break` and `stick-around`.
