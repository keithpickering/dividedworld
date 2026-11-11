# Shake: plan

Record, written 2026-11-11. Carries out `docs/plans/2026-11-11-shake-design.md`. One build session builds it in one PR
from `main`. The motion is the Shake bench's (`docs/research/2026-11-11-shake-bench/01-bench.html`) at the owner's
settings; the design's section 3 holds the numbers, and where a number here differs from the bench, the design wins.

Every task goes test first: write the failing test, show its red run, then write the code. During a task, run only the
tests for the changed code (`npx vitest run <file>`, or `node tools/test-e2e.mjs <spec> --trace off`). Run
`npm run build` once after the last task. Tasks 1 to 4 are engine; task 5 is Divided World's story and the e2e; task 6
is the records. The PR closes #412 (task 1 builds its three findings).

## Task 1. One owner per hit, and the #412 tests

Model: sonnet.

Files: `engine/ui/shine/flakes.ts` (`ClingOptions`, `hits`, `hostOf`, `unhit`, `cling.register`, `cling.tick`),
`engine/ui/shine/flakes.test.tsx`.

- `ClingOptions` gains `rank?: 'effect' | 'cell'` (default `'effect'`). `hits` becomes a map from a hit element to the
  list of hosts that name it, in registration order. `hostOf` takes, for each element on the walk up, the most recent
  host of the highest rank in its list. Unregistering a host takes it out of its hit's list, so the one before owns the
  hit again; the tick's sweep of disconnected hosts does the same. `ClingOptions.hit`'s comment says a hit has one
  owner at a time and how it is chosen.
- Tests, red first:
  - #412 N1: register host S with hit X, then S again with hit Y; a sweep over X carries nothing, a sweep over Y does.
  - #412 N2: a host with a hit is disconnected without unregistering; after a tick, a flake dropped over the hit lands
    on no host.
  - #412 N3: two effect hosts name one hit; the second owns it; unregistering the second hands it back to the first (a
    sweep picks up again); unregistering the first while the second holds it leaves the second.
  - A `cell` host and an `effect` host name one hit: the effect owns it whichever registered first.
- Poison for each: remove the line it covers and show the test red.

## Task 2. The flight

Model: sonnet.

Files: `engine/ui/shine/flakes.ts` (`Falling`, `onMove`'s drop, `shake`, `onScroll`, `cling.tick`, the constants and
the header comment's cling and shake bullets), `engine/ui/shine/flakes.test.tsx`.

- Replace the falling model with the design's section 3: `Falling` carries `vx, vy, ph, spin, age, hang` and no `land`,
  `fallen` or `over`. Constants, exported for the tests: `SHAKE_SPEED = 2200` (kept), `SHAKE_PER_FLICK = 40`,
  `SHAKE_FLICK_S = 0.4`, `THROW = 0.55`, `SPRAY = 0.11`, `DRAG = 7`, `GRAVITY = 480`, `FLUTTER = 35`,
  `FLUTTER_RATE = 5.5`, `HANG_S = 0.6`, `MAX_AIR = 400`. `SHAKE_PER_HOST` and `MAX_SHAKEN` go.
- `onScroll` keeps measuring the speed; a shake runs once a frame while the speed stays past `SHAKE_SPEED`, and is handed
  the frame's `dt`, so `shake(v, now, dt)` shakes `SHAKE_PER_FLICK × (0.4 + 0.6 × strength) × dt / SHAKE_FLICK_S` a
  post (the fraction carried by a draw from `cr`), where strength is `min(1, (|v| - SHAKE_SPEED) / SHAKE_SPEED)`.
- `tick` moves each flake as section 3 says and draws it at full alpha always. A flake whose hang has passed lands at
  the first frame it is over a landing place (task 3 adds the page and the cells; until then, a registered host). One
  that leaves the bottom or the sides of the viewport (by 10 px) is gone. The cursor's drop uses the cursor's numbers.
- The header comment's cling and shake bullets, and `shake`'s doc, are rewritten to the design; the comment on why a
  shaken flake is a copy stays.
- Tests, red first (`describe('a fast scroll shakes glitter off')` is rewritten):
  - A scroll down throws flakes up the screen at about half its speed, sprayed both ways; a scroll up throws them down.
  - Nothing in the air is drawn below alpha 1 (the old fade is gone): the fake context's `globalAlpha` values.
  - Drag settles a flake to between 60 and 80 px a second within a second.
  - A flick's first 0.4 s at twice `SHAKE_SPEED` sheds about 40 a post (30 to 50); at most 400 are in the air.
  - Under `SHAKE_SPEED`, under reduced motion, and off a post still bursting: nothing.
  - A flake does not land before its hang; after it, it lands on the host under it.
  - The existing "clears only where it drew the frame before" and "listens to the page's scroll only while a sticky
    post is registered" tests still pass.

## Task 3. Landing surfaces and tiles

Model: sonnet.

Files: a new `engine/ui/shine/landing.ts` and `engine/ui/shine/landing.test.tsx`, `engine/ui/shine/flakes.ts`
(`addLoose`, `dropLoose`, `sweepLoose`, the landing in `tick`, `hostUnder`), `engine/ui/shine/loop.ts` only if the
density is read from it (`MAX_DENSITY`).

- `landing.ts` exports:
  - `landPost(article: HTMLElement): () => void`. Registers each of the article's cells (its element children but a
    visually hidden heading: today the postbit, `.kb-act-meta`, `.kb-act-main` and the actions bar) with
    `cling.register(cell, { rank: 'cell', landed })`. The way out unregisters them and drops their glitter and tiles.
  - `landPage(): () => void`. The thread screen's page surface, and its lifetime: the way out sweeps every loose flake on
    the page (`sweepLoose`) and removes the page's tiles.
  - `TILE_W = 512`, `TILE_H = 256`, and a `probe` for tests and stories: `tiles()` (live tiles, by surface kind),
    `draws()` (tile draws so far), `landed()` (loose flakes by surface kind: `effect`, `cell`, `page`).
- A flake landing in `tick` goes, in order: to the owner of the hit under it (task 1), as today; else, if the page
  surface is live and the point's ground is the page's (below), to the page, in document px; else it keeps flying
  (section 4's chrome). "The page's ground": the walk up from the element at the point reaches `body` without passing an
  element whose computed background is not fully transparent; the answer is cached per element for the frame.
- A landed flake keeps its turn (`ph`) and the band of the surface it landed on (`bandAt`), and is drawn with
  `clingColor` at that turn, still. `addLoose` and the 300 cap count every surface; a flake dropped by the cap is
  removed from its tile, which is drawn again.
- Tiles: a canvas per 512 by 256 CSS px cell of a surface's own px, made when the first flake lands in it, `aria-hidden`,
  taking no pointer. A post cell's tiles are absolutely placed in the cell (the cell gets `data-kb-landed`, and
  `engine/ui/thread/thread.css` isolates a cell with that mark and places its tiles at `z-index: -1`, as
  `instances/divided-world/ui/glitter-bomb/glitter.css` places the flakes in the body). The page's tiles are absolutely
  placed in `document.body` at `z-index: -1` (a rule in `engine/ui/base.css`). Each tile is watched with
  `watchInView` (`engine/ui/shine/inView.ts`): out of view its backing store is zeroed; on return it is sized at the
  density and drawn. Landings in a frame mark their tiles, and each marked tile in view is drawn once at the frame's end.
  Nothing registers a tile with the loop.
- Tests, red first (`landing.test.tsx`, jsdom with `elementFromPoint` and rects faked as `flakes.test.tsx` does):
  - A flake landing on a plain post's body lands on its cell, in the cell's px, and makes one tile; a second landing in
    the same tile makes no new tile and one more draw.
  - A flake landing on a bombed post's body goes to the Glitter Bomb surface, not the cell.
  - A flake landing in a margin whose ground is the page's lands on the page in document px (the scroll added); over an
    element with its own ground it lands nowhere and is still in the air.
  - A tile out of view has a zero backing store and is drawn again on return; a tile in view is not drawn again when
    nothing landed (100 ticks, `probe.draws()` unchanged).
  - The 300 cap across a cell, the page and an effect host, oldest first, and the dropped flake's tile is redrawn.
  - `landPage`'s way out sweeps everything and removes the page's tiles; `landPost`'s way out drops its cells' glitter.
  - Reduced motion: nothing lands (nothing flies).
- Poison: a tile drawn every tick (the draw count check goes red); a page landing without the ground check (the chrome
  test goes red).

## Task 4. The thread registers its posts and its page

Model: sonnet.

Files: `engine/ui/thread/Post.tsx` (`ActArticle`), `engine/ui/thread/Thread.tsx` (`ThreadScreen`),
`engine/ui/thread/thread.css`, and `engine/ui/thread/Thread.test.tsx` (it renders the screen and its posts).

- `ActArticle` calls `landPost(ref.current)` in an effect on mount and its way out on unmount (skipped under a play's
  moment, which is `still`, if `ActArticle` is ever rendered as one). `ThreadScreen` calls `landPage()` on mount and its
  way out on unmount.
- `thread.css`: `.kb-act > [data-kb-landed] { isolation: isolate }` and the tile rule, with a comment naming the design.
- Tests, red first: mounting a post registers its cells (a spy on `landPost`, or the probe after a landing), unmounting
  drops them; unmounting the thread screen sweeps the page (`probe.landed()` empty, no page tiles in the document).
- Check by hand in the e2e of task 5 that isolating a cell clips nothing that overflows it (a menu from the actions bar,
  the postbit's hover card): open each with glitter on the cell.

## Task 5. The story and the e2e

Model: sonnet.

Files: `instances/divided-world/ui/glitter-bomb/Glitter.board.stories.tsx`, `e2e/glitter.spec.ts`, `e2e/shine.spec.ts`
(only if a check there needs the new probe).

- The story exposes `window.__kbLanding` (the landing probe), the way it exposes `__kbShineDraws`.
- e2e, red first, in Chromium on the Light story with reduced motion off:
  - A fling (the bench's: 6,000 px a second, coasting down with `exp(-2.6 × dt)`, by `scrollBy` each frame) from above
    the bombed post: within 3 s, glitter has landed on a post cell and on the page (`probe.landed()`), and nothing is in
    the air after 5 s.
  - Leaving the thread (navigating to the board) sweeps it: `probe.landed()` is empty and no page tile remains.
  - What landed shows: at a page flake's point and at a cell flake's point the screenshot differs from the ground there
    (the page's tiles lie under the body's ground only because `html` paints none and the body's propagates to the
    canvas; this check holds that).
  - The raster check in `e2e/shine.spec.ts` stays green; a scroll over landed glitter adds no tile draws.
- Under reduced motion (the Still story) the fling lands nothing.

## Task 6. Records

Model: inline.

Files: `docs/plans/2026-11-11-shake-design.md` only if the build found a gap, and the PR description.

- The PR lists the design's section 7 question under `Design questions`, and `Closes #412`.
- Run `npm run build` and show it green.

## Review focus

- React and a foreign child: the engine adds tiles inside cells React owns. A post that re-renders, edits, takes a card
  or is taken over must keep its tiles, or drop them cleanly, and never throw.
- Isolation on a cell with glitter: nothing that used to escape the cell (a menu, a hover card, a focus ring, a
  reaction picker) may be clipped or put behind the next post.
- The ground check's cost: computed backgrounds read on landing, per element and per frame. Landings come in bursts
  of hundreds; the cache must hold it to a few reads a frame.
- Memory: tiles' backing stores only in view, at most the density; a long thread scrolled with glitter on every post
  must not keep stores out of view.
- Layout shifts: the page's glitter is in document px. A thread that loads more posts above (the feed's slide-in) moves
  the posts and not the page's glitter; the design accepts that, but nothing may end up drawn over a post.
- The private-fact rule: nothing in landing reads who owns a post or who reacted.
