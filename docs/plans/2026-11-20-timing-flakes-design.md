Record, written 2026-11-20.

# Two timing checks that fail on a loaded runner: design

Designed with the owner in one session, which also builds it (the owner's word: "go ahead"). Issues: #472 (its last open
item, the foil's 4 ms bound) and #864 (the fog ladder's settling check). Both failed the nightly Release, on 2026-11-20
(run 44680201686) and 2026-11-19 (run 44464384789), and neither failure is a regression: no product code is changed here.

## 1. The foil's render bound (`engine/ui/shine/foil.test.ts`, "one 988 x 300 render takes under 4ms in Node")

**What it is for.** A scroll redraws about five posts a frame, so one render is a fifth of the frame at most. The render
was measured at 1.1 to 1.8 ms where the bench's per-cell code took 5.4 to 9.4 ms; the bound goes red if a render slides
back toward that cost.

**Why it fails.** It is a wall-clock bound. On the Release's `build` job, `test:engine` runs beside `test:ui` on a
4-CPU runner, and a whole stretch of the run is slow: `bands/light took 5.99 ms` (run 44680201686), `bands/dark took 6.06
ms` (#472). Measured here with both suites running beside the test, the best of three still reached 3.0 ms, and the slow
renders came in pairs (a pattern's light and dark together), so a slow stretch spans several renders and the best of
three does not escape it.

**Alternatives weighed.**
- *The best of many more renders, same 4 ms.* Cheap, but a slow stretch is sustained, and a runner whose CPUs are slower
  than this machine's by half is over 4 ms however many renders are taken. Not chosen.
- *A step of its own that nothing runs beside.* Costs a build step (`tools/build.mjs`'s one list) for one test, and a
  shared cloud runner is still slower on some days than others. Not chosen.
- *A ratio to a reference timed in turn with the render (chosen).* A fixed reference workload over the same cells and
  buffer is timed just before each render; the bound is on the best render over the best reference. A slow stretch or a
  slow runner slows both. Measured here (2026-11-20): the worst ratio of the six renders was 1.66 to 1.94 idle and 1.62
  to 2.07 with both suites running (eleven runs), while the times themselves moved by up to 3x. The bound is 4, about
  twice the slowest, as the old bound was about twice the slowest time. A render doing its work five times, the
  per-cell code's cost, read 8.7 to 32.7 under that load (eight runs); one doing it three times read as low as 4.75,
  too near the bound to be a poison that is always red.

**The test's own red.** A poison: the same measurement with a render that does its work five times (the per-cell code's
cost) must exceed the bound. It is asserted in the test, beside the honest one, so the pair travels together and the bound is never one that
nothing could fail.

## 2. The fog ladder's settling check (`e2e/hot-box.spec.ts`, "… at 4x CPU: the fog's painter is within 8 ms a frame …")

**What it is for.** At a phone's speed (4x CPU throttle), the frames painted at the rung the ladder settled on are within
`FOG_BUDGET_MS`; at least 8 of them, so that a mean is judged and not one frame.

**Why it fails.** `sweepFor` sweeps for a fixed time (6 s at 4x) and reads the frames since the ladder's last step. The
ladder (`instances/divided-world/ui/hot-box/Effect.tsx`, `closeFrame`) judges the mean of the last 8 frames for as long
as the post paints, and rung 0 at 4x is 7.6 to 9.4 ms (its own comment), right at the 8 ms budget. So whether and when a
window goes over is chance on a slow runner, and a late one steps in the sweep's last frames. In run 44464384789 the
ladder stepped to rung 2 on the 139th and last frame: "mean at the rung it settled on 4.20 ms over 1 frames". The fog
did fit; the test had no frames to judge it on.

**Alternatives weighed.**
- *A longer fixed sweep.* Makes a late step rarer, never impossible; costs every run the extra seconds. Not chosen.
- *Accept fewer than 8 frames.* A mean of one frame is no mean. Not chosen.
- *Sweep until settled, with a cap (chosen).* After the fixed sweep, the pointer keeps sweeping until 8 frames have been
  painted at the ladder's last rung, or a cap of 6 s more. The ladder can step at most `FOG_LEVEL_MOST` (4) times and
  each step waits 8 frames, so a ladder that is settling settles well inside the cap; one that never does fails the
  same assertion it fails today. The budget, the throttle and the first 6 s are unchanged. The extra time the sweep took
  is written in the run's cost line, so a run that needed it says so.

## Open

Nothing for the owner. Whether the ratio holds on GitHub's runner is read from the PR's own `build` job, which prints
the six ratios.
