Record, written 2026-11-20.

# Two timing checks that fail on a loaded runner: plan

Design: `docs/plans/2026-11-20-timing-flakes-design.md`. Designed and built in one session at the owner's request. The tasks
are `inline`: each is a few lines in one test file, and the session that measured them holds the figures.

## Task 1: the foil's bound is a ratio to a reference

Model: inline

- `engine/ui/shine/foil.test.ts`, the test "one 988 x 300 render takes under 4ms in Node": becomes "one 988 x 300 render
  costs under 4 times a reference pass over the same cells, timed in turn with it".
- A `reference(out, k)` beside the test: one pass over the buffer's cells, a sine and a cosine of the cell's index each,
  four bytes written per cell where the render writes its own.
- For each pattern and board: 20 warm-up renders and references, then 10 rounds of (reference, render) timed in turn;
  the ratio is the best render over the best reference. `RATIO_MOST = 4`, with its measured figures in the comment.
- The poison, a test of its own beside it: the same measurement with a render that calls `render` five times (the
  per-cell code's cost); its worst ratio over the six must be over `RATIO_MOST`. The honest and the poisoned ratios are
  printed.

Tests first: the poisoned measurement asserted over the bound runs red when the bound is set at 100 (the poison would pass
it), then green at 4. The honest assertion runs green beside both suites (`test:ui` and `test:engine` running), several
times, where the old bound's test is shown red or slow under the same load with its printed times.

## Task 2: the fog sweep waits for the ladder to settle

Model: inline

- `e2e/hot-box.spec.ts`, `sweepFor(page, ms, story)`: after `ms`, the sweep goes on, checking at the first move past it
  and then every tenth move, until the frames painted since the ladder's last step (`__hbRung`) are `LADDER_SETTLED` or
  more (`LADDER_FIRST`, read from `instances/divided-world/ui/hot-box/Effect.tsx` as `FOG_BUDGET_MS` is), or
  `SETTLE_CAP_MS = 6000` more has passed. The figures returned are the ones that check read, in one round trip. It returns `waited` (null when the ladder had settled by `ms`; otherwise how long it waited and whether the cap ran out).
- The cost line (`hot-box cost: …`) adds "and N s past it, waiting for the ladder to settle" when it waited, and ", which it
  had not by the cap" when the cap ran out.
- The assertions are unchanged.

Tests first: with the 4x sweep cut to 1 s (an environment override used for the run only, not committed; 400 ms is too short for the painter to run the 10 frames asserted first), the case
"the longest post the instance allows at 4x CPU" runs red on the current code on "the ladder has settled", and green
with the change. With the change and the cap set to 0, the same short sweep is red again: the cap is what bounds it.

## Review focus

- The reference must not be optimized away or made cheaper by the JIT than the render in ways that differ by machine:
  its bytes are written to the buffer the render uses, and the ratio is read on GitHub's runner from the PR's `build` log.
- The fog sweep's extra time adds to the e2e shard's length only when the ladder steps late; the cap bounds it at 6 s a
  case.
