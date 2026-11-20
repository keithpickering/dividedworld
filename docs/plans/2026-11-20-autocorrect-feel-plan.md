# Autocorrect's feel: the plan

Record, written 2026-11-20. Carries out `docs/plans/2026-11-20-autocorrect-feel-design.md`. Six tasks, in order. Each goes test
first, with its red run. All of it is instance code under `instances/divided-world/`. The engine is untouched, and no interface is
added or changed.

The owner's picks on the bench are in the design: the buzz is `[10, 40, 10]`, and the glue's tint is 0.30 on both boards (gloss 0.5
light, 0.12 dark).

## Task 1. Where rolls fell, saved

Model: sonnet

- **Card** `instances/divided-world/cards/autocorrect.ts`:
  - `validateState` accepts `drops?: Record<string, number[]>`, keyed by place as `stuck` is. Each place must be in `stuck`. Each
    share must be in [0, 1], rounded to 4 places, strictly increasing, and not strictly inside a stuck stretch of that place
    (`from < share < to`).
  - The count of all drops plus all stretches is at most `STUCK.most`.
  - The returned state keeps `drops` only when non-empty.
  - The header's state paragraph says what `drops` is.
- **Tests first** in `instances/divided-world/cards/autocorrect.test.ts`:
  - a state with `drops` round-trips;
  - each refusal: a place not in `stuck`; a share out of range; unrounded; out of order; inside a stretch; the shared bound passed
    by one;
  - a state without `drops` is unchanged.
  - Red: `drops` is refused as unknown, or dropped.
- **Bound** in `instances/divided-world/cards/cards.test.ts`: the largest autocorrect save, measured as Postgres writes it, is built
  with `STUCK.most` split between stretches and drops in the way that makes it longest, and still fits 256 KiB.

## Task 2. The hands: peek or pick, unroll, drops

Model: sonnet

`instances/divided-world/cards/autocorrect/hands.ts`. The header comment is rewritten for the new rules.

- **Settings.** `HandSettings` gains `slop` (px, 8) and `cornerDelayMs` (150). Both are constants the Effect passes, not settings
  rows.
- **`press` for the author out of the hold.**
  - On a waiting roll's grip, it begins at once as today (`begin`, kind-1 edge).
  - At any other end within reach, it begins a **pending** work. This is a pick with `pick: 0`, plus the press's place, and a peek
    prepared for the same press (side and base as `pressPeek` computes them) but not yet in `peeks`.
  - Anywhere else on an open piece, it peeks as `pressPeek` does.
  - The return gains `'pending'`.
- **`move`.** While pending and the hand is more than `slop` from where it went down, the work is dropped and the prepared peek is put
  in `peeks` with the hand as its carrier, so the pull follows from the press's own place.
- **`stepWork`.**
  - When `pick` reaches `pickMs`, it emits `{ kind: 'picked', piece }` once (a new `HandEvent`).
  - The `corner` in `view` is null while `pick < cornerDelayMs`. After that, `t` runs from 0 at `cornerDelayMs` to 1 at `pickMs`.
- **Unroll.** With the pick up (or a roll grabbed), a hand that is *behind* the peel line, on the peeled side, moves the line back
  toward it.
  - The pace cap applies: `peelStep` is given the negative lead's magnitude.
  - Strain is never added, and drains.
  - The stretch's edge moves out, and `rolled` shrinks by what went down.
  - It stops at the roll's **root**: the nearest of the last drop on that side in the piece's local pixels, the neighbor stretch's
    edge, and the piece's end.
  - Reaching the strip's own end (local 0 or `w` at a piece whose edge there is the strip's end) sets that edge's kind to 0.
  - Reaching a neighbor stretch joins the two into one stretch with their outer kinds.
  - Each step that moves the line bumps the piece (`change`).
  - `waited` is replaced by `rollOf(p, k, side)`: the distance from the edge to its root.
- **Drops.** `Piece` gains `drops: number[]` (local px), taken from a new `PieceSpec.drops`. A tear pushes its `at`. A finished piece
  pushes its far end on the side the roll travelled to. `dropsOf(strip)` gives them back as shares, alongside `sharesOf`. Shares are
  joined over pieces by `tape.ts` `fromPieces`' widths, rounded, deduplicated, and those inside a stuck stretch are dropped.
- **Keys.** `keyDown(strip, mode: 'peek' | 'peel' | 'unroll')`.
  - `'peek'` is today's reader path, for everyone.
  - `'peel'` is today's author path. It is refused while held, and it emits `picked` when its pick is up.
  - `'unroll'` takes the first waiting roll of the strip in reading order and moves its line back at `pace` until its root or key-up.
    It returns false, and does nothing, when the strip has no waiting roll.
- **Tests first** in `hands.test.ts`, each red against today's code:
  - an author's press at an end and a move past `slop` within 300ms lifts a flap and changes nothing (no `change`);
  - the same press held still for `pickMs` emits one `picked`, then a drag peels (`change`);
  - the corner is null at 100ms of a pick and `t ≈ 0.5` at `(cornerDelayMs + pickMs) / 2`;
  - a roll grabbed and dragged back re-sticks at no more than `pace`, never strains or tears, and stops at a drop;
  - a roll unrolled to the strip's end leaves `sharesOf` empty (no `stuck` entry) and `dropsOf` empty;
  - a tear then a re-pick then an unroll stops at the tear's share, not at the strip's end;
  - `keyDown(strip, 'unroll')` with no roll returns false;
  - `keyDown(strip, 'peek')` as the author out of the hold peeks.

## Task 3. A second to pick

Model: inline

- `instances/divided-world/settings.ts`: `'autocorrect.pickMs': 1000`. Its comment says the pick is the held press that turns a
  drag's peek into a peel.
- `instances/divided-world/cards/autocorrect/Effect.tsx` `DEFAULTS.pickMs`: 1000.
- `instances/divided-world/settings.test.ts`: if it names the value, it changes with it.
- Test first: a settings test asserting 1000. Red at 450.

## Task 4. The corner fold

Model: sonnet

- **New** `instances/divided-world/cards/autocorrect/fold.ts`, pure geometry with no DOM. `creaseAt(t, w, h, endTop)` gives the
  crease for a pick at `t` (0..1) at the left end:
  - its normal `n` (`[-cos β, -sin β]`, β = 45° × (1 − smoothstep(t)));
  - a point `A` on the top edge (`endTop + h · (0.34 + 0.9t) · (cos β + sin β) / √2`);
  - the turn `angle` (110° + 40°t);
  - `foldMatrix(crease)`: the affine `[a, b, c, d, e, f]` that maps a point to `p − q n (n·p − n·A)`, with `q = 1 − cos angle`.
  - The right end is the left end mirrored (the caller flips the context).
  - It ports the bench's `drawPicked` (`docs/research/2026-11-20-autocorrect-feel-bench/01-bench.html`).
- **New** in `paper.ts`: `drawUnderside(c, w, h, seed)`, the sticky side as the bench draws it with `under`. It is paler (lightness 88),
  with the crepe at 0.6 and 0.45 of its strength, no fibers and no factory edges, the same end darkening, and the sheen gradient. It
  shares `endJags` and `tapePath`.
- **Effect** `Piece`: the `.dw-ac-corner` div is replaced by a `<canvas className="dw-ac-fold">` over the piece (PAD 10px around
  it), drawn while `view.corner` is set:
  - the paper canvas clipped to the far side of the crease;
  - the fold on a scratch canvas (the underside face, with the toward-the-crease darkening), laid with the shadow
    (blur `1.5 + 3t`, offset `0.6 + 1.2t`, `1 + 2t`);
  - the lit crease line.
  - While the fold canvas shows, the body's paper is hidden (`visibility`) so the corner region is open to the words. The marker's
    words are drawn on the fold's far side from the body's own text, clipped the same way.
  - `.dw-ac-corner` leaves `autocorrect.css`. A `.dw-ac-fold` rule positions the canvas.
- **Tests first:**
  - in `fold.test.ts`: at `t = 1` the crease is vertical (`|n[1]| < 1e-9`); every point on the crease maps to itself; a point `d`
    inside the corner lands `d · cos(angle)` from the crease; at `t = 0` the crease cuts the top edge a third of `h` from the end.
    Red: the module does not exist.
  - In `paper.test.ts`: `drawUnderside` draws no fiber strokes and fills within `tapePath`.
  - In `Effect.test.tsx`: a pick in hand renders `[data-kb-ac-fold]` and no `.dw-ac-corner`.
- **Stories** `instances/divided-world/ui/autocorrect/Autocorrect.board.stories.tsx`: a `PickingAuthor` story holds a pick at 0.6 on
  each board, for the owner's shots.

## Task 5. The glue, and the buzz

Model: sonnet

- **Residue** `instances/divided-world/cards/autocorrect/residue.ts`:
  - `RESIDUE_TINT: Record<Band['board'], number>` (0.30 light, 0.30 dark: the owner's pick).
  - `GLOSS_ALPHA` becomes `Record<Band['board'], number>` (0.5 light, 0.12 dark).
  - `glossAt(light, box)` gives the gradient's center in the post's pixels and its radius (150). The center is the light's place over
    the post's box, as the shine's relief maps `light * LIGHT_SCALE` over −1..1.
  - The header says the tint's strength is the tape bench's `--res-opacity` the first port dropped.
- **Effect** `Residue.paint`:
  - `lay(ctx, film, ink.tint, RESIDUE_TINT[band.board], r, top)`.
  - The gloss is laid through a radial gradient (white 0.9 at the center, 0.22 at 38%, clear at 72%) filled `source-in` on the
    scratch, at `GLOSS_ALPHA[band.board]`, and no longer as a flat color.
  - The fibers are unchanged.
- **The buzz.** In `apply`, a `picked` event calls `try { navigator.vibrate?.(BUZZ) } catch {}`, with `BUZZ = [10, 40, 10]`,
  the owner's pick. For a key, it says "Picked. Keep holding to peel." in the status region instead.
- **Tests first:**
  - In `residue.test.ts`, the band check composites at `RESIDUE_TINT[board] * FILM_PEAK` and the gloss at its peak, and still passes.
    Its POISON keeps failing.
  - A new test asserts `RESIDUE_TINT.light <= 0.48` and `RESIDUE_TINT.dark <= 0.30`, the approved bench's ceiling, which turns red at
    1.
  - In `Effect.test.tsx`, a residue paint lays the tint at `RESIDUE_TINT` (spy the context's `globalAlpha` at the tint's
    `drawImage`). Red at 1.
  - In `Effect.test.tsx`, as in Whoops!'s buzz tests (`instances/divided-world/cards/whoops/Effect.test.tsx`):
    - a held pick calls `navigator.vibrate([10, 40, 10])` once;
    - a drag into a peek calls it never;
    - a device that throws does not stop the pick.

## Task 6. Keys and words

Model: sonnet

- **Anchor** in `Effect.tsx`:
  - `onKeyDown` maps Enter or Space to `'peek'`, Shift with Enter or Space to `'peel'` (the author out of the hold; otherwise
    `'peek'`), and Backspace to `'unroll'` (the author out of the hold; otherwise nothing, and the key is not prevented).
  - `onKey` passes the mode to `keyDown`.
  - A refused `'unroll'` says "Nothing to press back down." in the status region.
  - Key-up of any of these ends the hold.
  - The anchor's names are the design's section 7.
- **Lens** `LENS.authorEnds` and `LENS.authorHeld` take the design's section 7 words.
- **Card** `instances/divided-world/ui/cards/autocorrect/ui.ts` `describe`: the design's added clause.
- **Tests first:**
  - `Effect.test.tsx`: the author's anchor with Shift+Enter peels, Enter peeks, and Backspace unrolls a waiting roll; a reader's
    Backspace does nothing.
  - The Lens and anchor strings as written.
  - `instances/divided-world/ui/index.test.tsx` (or wherever the description is asserted) carries the new clause.

## Review focus

- A half peel saved before this ships has no `drops`. Its unroll restores up to today's gap, which can bring back tape torn off before
  the change (accepted in the design, section 4). Check that nothing else reads a missing `drops` as an error.
- The pending press. A pointer that moves exactly at `slop`, a pick that completes on the same tick as a move past `slop`, and a
  release during the corner's delay must each end in exactly one of peek, pick or nothing, with no stray `change`.
- `dropsOf` across screens. A finished piece on a phone's line break is a share that a desktop, which has no break there, must still
  respect. A drop inside a later re-stuck stretch must be pruned, not refused on the next save.
- Unroll joining a neighbor stretch, or reaching a line break whose other half is stuck on the next piece. The joined edge kinds must
  pass `validateState`.
- The fold canvas hides the body's paper while it shows. A pick let go, or a resize mid-pick, must bring the body back.
- The buzz fires on the author's own screen only, and only from a pointer pick.
