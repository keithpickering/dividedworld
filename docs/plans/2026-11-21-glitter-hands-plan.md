# Glitter in hand: a finger moves it, a pickup takes it, the Reply box catches it

Record, written 2026-11-21. A plan made in one session that designs and then builds it, as the owner allowed ("write a
plan and build if straightforward"). It changes the cling layer of `engine/ui/shine/flakes.ts`
(docs/plans/2026-11-06-shine-design.md section 6, docs/plans/2026-11-11-shake-design.md) and the landing surfaces of
`engine/ui/shine/landing.ts`. The owner's report, 2026-11-21:

> a cursor handles this very well, it collects glitter and tosses it around the page with realistic physics as if the
> post is on a table and the camera is looking down from above. On a touch screen, the only way we have to move the
> glitter around is to scroll quickly. It would be great if a finger movement could drag it around a bit, without
> impacting regular drag events like selecting text.
>
> though the cursor does a good job of tossing glitter around, the glitter that gets tossed around the page seems
> sharper than the glitter on the main post canvas. It is clear that glitter isn't actually disappearing from the
> latter, it is just being generated on the cursor tip. [...] would be nice if we could show it getting picked up more
> realistically (leaving one canvas, tossed to another)
>
> the Reply box does not catch glitter, it floats down over it like snow

## What was found

- **Touch.** `onMove` acts only on `pointerType === 'mouse'` on a fine pointer. A finger's pointer events are cancelled
  (`pointercancel`) the moment the browser takes the gesture for a scroll, so pointer events cannot follow a finger
  across a drag. Touch events can: a passive `touchmove` keeps firing through a native scroll on iOS Safari and Chrome
  for Android, and a passive listener can neither block the scroll nor the long press that starts a text selection.
- **The pickup.** A pickup makes a new flake (`flake(cr, 0, 0, palette)`) at the pointer and leaves the post's settled
  field as it was, so nothing leaves the post. The difference in sharpness has a second cause: the post's canvases are
  drawn at a share of the device's density (`paintScale`, engine/ui/cards/body.ts), the cling layer at the device's
  own. A flake that is really taken leaves a gap where it lay, so the eye follows it from one canvas to the other.
- **The Reply box.** A flake past its hang lands on a registered host, or on the page where the ground under it is the
  page's (`groundOf`). The reply form paints its own ground (`.kb-form`, `--kb-row-1`) and is not registered, so a
  flake over it is neither and keeps falling until it leaves the screen.

## Decided here

- **A finger slides glitter.** While a sticky host is registered, the cling layer listens, passively, to `touchstart`,
  `touchmove`, `touchend` and `touchcancel` on the window (on and off with the scroll listener). It follows the first
  touch only. What counts is the finger's movement over the page, not over the screen: a touch move's movement on screen
  plus the page's scroll since the last one. A scroll drag carries the page under the finger, so it moves nothing
  over the page and picks up nothing (a fast one still shakes, as today); a finger sliding sideways, or across the
  scroll, slides over the post and picks flakes up as a mouse does, with the same chance per px (`min(0.6, px / 40)`).
  The point under the finger is hit-tested (`elementFromPoint`) only when a pickup's roll succeeds or something is
  carried, never on every move. Carried flakes ride the finger in a ring just outside its contact (12 to 24 px), so a
  fingertip does not hide them. On the finger's lift (or a cancel) everything carried is tossed: it leaves at
  `TOSS` (0.5) of the finger's speed over the page, capped at `TOSS_MAX` (2,400 px a second), sprayed by `SPRAY` of that
  speed sideways, and then flies, drags, settles and lands as shaken glitter does. Moving off the sticky host drops
  carried flakes as the mouse's do. Reduced motion picks nothing up, as for the mouse. Nothing is prevented: no
  `preventDefault`, no `touch-action`, so scrolling and selecting text are the browser's as before.
- **A pickup takes a real flake.** A mouse's or a finger's pickup takes the settled flake nearest the pointer within
  `REACH_PICK` (14 px) out of the post (`take(flakes, x, y, r)` in the engine), and none where none lies there: a
  sweep clears a path, and an emptied spot lends nothing. The flake keeps its ink, size, turn and tilt. It starts on the
  cling layer where it lay and eases (`1 - e^(-14 dt)` a frame) to its riding place by the pointer, so it is seen to
  lift off the post. A pickup measures the host it takes from once (`getBoundingClientRect`, to put the pointer in the
  host's px); a pointer move that picks nothing up measures nothing, as today. A shake still sends copies: taking 40
  flakes a frame from every post on screen during a fling would repaint each post's base layer every frame
  (docs/plans/2026-11-11-shake-design.md section 3 keeps that reason).
- **What was taken stays taken for the mount.** The flakes object is dropped out of view and built again from its seed
  on return. `FlakesOptions.taken` is a set the host keeps for its mount; `take` adds the flake's place to it
  (`x,y`), and a flakes object built with it leaves those flakes out. Glitter Bomb's effect passes one set per mount,
  so a post that leaves view and comes back shows its gaps. A resize builds flakes at new places, which no gap names.
- **The base layer's key counts takes.** `baseKey` holds the settled count, which a burst only ever raised. A take
  lowers it, so a take and a landing between two draws would leave the count, and the key, unchanged over a different
  field. The key gains the number of flakes taken from this object.
- **The Reply box catches glitter.** `landBox(el)` in `engine/ui/shine/landing.ts` makes one element a landing place of
  the `cell` rank, with tiles in it, as `landPost` does for each of a post's cells (both share one helper). The thread's
  reply form calls it on mount. Its tiles lie over the form's own ground and under its content (the owner's choice,
  2026-11-21: "Under, form ground only"), by the same CSS as a post cell's, in `engine/ui/base.css` for any
  `[data-kb-land-box]`: so a flake on the head bar, the field or a button lies under it and is not seen, and what the
  reader types is never covered. The way out is the page's: leaving the thread sweeps every loose flake, and the form's
  unmount drops its own.

## Tasks

### Task 1: a pickup takes a real flake

Model: inline.

Files: `engine/ui/shine/flakes.ts`, `engine/ui/shine/flakes.test.ts`, `engine/ui/shine/flakes.test.tsx`,
`instances/divided-world/ui/glitter-bomb/Effect.tsx`.

Tests first: `take` removes the nearest settled flake within the reach and returns it, returns null where none lies
within it, records it in `taken`; a flakes object built with `taken` leaves those out, before and after its burst;
`baseKey` changes on a take. In jsdom: a mouse pickup over a sticky host lowers its settled count by what is carried;
over an emptied spot it picks nothing up; the carried flake starts where it lay on screen. The test that a pointer move
measures no post becomes: a move that picks nothing up measures nothing, and a pickup measures only the host it takes
from.

### Task 2: a finger slides glitter

Model: inline.

Files: `engine/ui/shine/flakes.ts`, `engine/ui/shine/flakes.test.tsx`.

Tests first (jsdom touch events): a finger sliding sideways over a sticky host picks flakes up on a coarse device; a
scroll drag (the finger's movement on screen matched by the page's scroll) picks none up; the lift tosses everything
carried the way the finger was going and it lands on the host under it after its hang; reduced motion picks nothing up;
the listeners are passive and are on only while a sticky host is registered; no touch event's default is prevented.

### Task 3: the Reply box catches glitter

Model: inline.

Files: `engine/ui/shine/landing.ts`, `engine/ui/shine/landing.test.tsx`, `engine/ui/base.css`,
`engine/ui/composer/Composer.tsx`.

Tests first: a flake falling over a `landBox` element lands on it in its px and draws a tile in it; its way out drops
its glitter and tiles; the element is marked `data-kb-land-box`, and base.css positions and isolates it and puts its
tiles at z-index -1.
