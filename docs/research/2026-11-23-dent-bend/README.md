# What bending the foil costs: the gate

Record, written 2026-11-23, for docs/plans/2026-11-23-dent-bend-plan.md, Task 4 (the design is docs/plans/2026-11-23-dent-bend-design.md, section 2.4). It surveys one question: with a Steel Chair's dent standing on a post that also has a Feelin' Fab, what does it cost the page's frames if the foil is bent by the dent too (the engine's `data-kb-bend`, set on the foil's canvas) instead of only shaded? The verdict decides whether the foil bends. This document is left as written.

## What was run

- The page: the `Dented` story of `instances/divided-world/ui/Shine.board.stories.tsx`, the busy thread of `e2e/shine.spec.ts` (seventeen posts: twelve Feelin' Fab posts, four Glitter Bomb posts, one plain) with a Steel Chair on every post that has a foil. In the bent runs the story sets `data-kb-bend` on every `canvas.dw-fab-foil` (the story, not the effect; it reads `window.__kbBend`, which the spec sets before the page loads); in the shade-only runs it sets none. Steel Chair's effect is the same in both.
- The spec: `e2e/dent-bend.spec.ts`, using the shine spec's scroll (`scrollRun`, `fireBursts` and the helpers under them were moved to `e2e/shine-share.ts`, not copied). A fresh browser context a run, CPU throttled by 2 (CDP `Emulation.setCPUThrottlingRate`), a viewport of 1200 by 900, the Glitter Bombs' bursts fired first, then one scroll from the top of the page to its bottom under a moving mouse, with the gap between animation frames taken from every frame. The runs alternate, bent first.
- The scroll's speed is 300 px a second, not the shine spec's 1,290 (`SCROLL_SPEED`). A Steel Chair throws once a post's middle has been in view 300 ms, and its dent is cleared when the post has wholly left the view, so at 1,290 px a second the first run of this spec saw no dent stand in view in any of 47 sampled frames, and would have measured nothing. At 300 a post is in view for some four seconds. A sampler in the page looks at every fourth frame for a dent standing in view over a foil (and, in a bent run, over a foil that carries the attribute); a run in which it sees none fails, and the last column of each table is what it saw.
- The machine: Intel Core i7-10750H at 2.6 GHz, 6 cores, 12 threads, 64 GB; Windows 11 Home 10.0.26200. Node 22.23.3; Playwright 1.63.0 with its Chromium (build 1243, headless, software-drawn, with the config's three launch flags, as CI runs it); one worker.
- The command: `DENT_BEND_RUNS=8 KB_E2E_PORT=4391 npx playwright test e2e/dent-bend.spec.ts --trace off --workers=1`
- The rule: **bent** if the bent runs' 95th-percentile frame gap (the median of the eight) is within 10% of the shade-only runs'; otherwise **shade only**. The median of eight is the mean of the two middle values.

## The poison

A guard never red is not known to work. The gate was run once with `DENT_BEND_POISON=1`, three runs of each: in the bent runs only, a busy loop of 25 ms in every animation frame while a foil carries `data-kb-bend` (planted by the spec, never in the product). It reads red: the bent runs' median 95th-percentile gap is 166.5 ms against 100.1 ms for the shade-only runs, a ratio of 1.663, far over 1.10, so the rule says shade only. (Of three values the median is the middle one, so the lower-middle slip described below does not touch these figures.)

| Run | Foil | 95th percentile of the gap, ms | Median gap, ms | Frames | Frames sampled with a dent in view |
|---|---|---|---|---|---|
| 1 | bent, poisoned | 166.5 | 83.3 | 299 | 11 of 111 |
| 2 | shade only | 133.3 | 50 | 390 | 36 of 217 |
| 3 | bent, poisoned | 150 | 83.3 | 296 | 12 of 94 |
| 4 | shade only | 100 | 50 | 432 | 45 of 159 |
| 5 | bent, poisoned | 166.7 | 83.3 | 267 | 6 of 82 |
| 6 | shade only | 100.1 | 50 | 406 | 41 of 140 |

## The sixteen runs

| Run | Foil | 95th percentile of the gap, ms | Median gap, ms | Frames | Frames sampled with a dent in view |
|---|---|---|---|---|---|
| 1 | bent | 133.4 | 50 | 379 | 25 of 124 |
| 2 | shade only | 116.7 | 33.4 | 462 | 44 of 145 |
| 3 | bent | 150 | 50 | 378 | 25 of 123 |
| 4 | shade only | 116.7 | 50 | 441 | 44 of 148 |
| 5 | bent | 166.6 | 50.1 | 360 | 18 of 111 |
| 6 | shade only | 150 | 50 | 373 | 26 of 134 |
| 7 | bent | 166.7 | 50 | 333 | 19 of 108 |
| 8 | shade only | 166.6 | 50.1 | 325 | 17 of 107 |
| 9 | bent | 200 | 50.1 | 314 | 11 of 109 |
| 10 | shade only | 150 | 50 | 352 | 21 of 106 |
| 11 | bent | 133.3 | 50 | 403 | 28 of 114 |
| 12 | shade only | 166.7 | 50.1 | 338 | 20 of 108 |
| 13 | bent | 133.4 | 50 | 370 | 24 of 108 |
| 14 | shade only | 83.3 | 33.3 | 647 | 87 of 182 |
| 15 | bent | 133.3 | 50 | 412 | 30 of 118 |
| 16 | shade only | 66.7 | 33.3 | 700 | 98 of 199 |

The median of the eight bent runs' 95th-percentile gaps is 141.7 ms; of the eight shade-only runs', 133.4 ms. The ratio is 1.063, within the 1.10 line.

For the owner, not for the verdict: the means are 152.1 ms bent and 127.1 ms shade only, a ratio of 1.197. The plan's rule is the median, and the median decides.

## Verdict

**Shade only.** The foil does not ask to be bent; the dent's shading lies over it.

The design bends the foil only if the gate passes (section 2.4: "the foil is bent only if" the bent page's gap is within 10% of the shade-only page's). Two sets of eight pairs were run, and they disagree:

- The first set reads within the line: a ratio of the medians of 1.063 (above). It passes by less than one frame step (16.7 ms), and its runs are not steady: its shade-only runs spread from 66.7 to 166.7 ms, which reads as a machine busy with other work in some runs and not in others.
- The confirmation set (below), run with no other browser on the machine, is steady in both variants (bent 116.7 to 133.3 ms, shade only 66.7 to 83.3 ms) and reads far over the line: a ratio of 1.749.

A gate that passes by less than its grain on the noisier set and fails by seven times its margin on the steadier one has not passed, so the design's fallback stands. This is a change from what the build session declared before the confirmation ran (that the first set's verdict would stand and the confirmation would only be reported), and it is put to the owner as a design question on the pull request; turning the foil's bend on is one attribute on its canvas (`BEND_LAYER`, engine/ui/cards/body.ts).

The first write-up of this record also said **shade only**, for a different reason: it took the lower of the two middle values of the eight (a helper that was `percentile(xs, 0.5)`), 133.4 ms bent against 116.7 ms shade only, a ratio of 1.143. That is not the median of an even count; the spec now takes the mean of the two middle values, and the first set's figures above are recomputed from the same sixteen runs.

## What to read with it

- The gaps are whole frames: every figure is a multiple of the display's 16.7 ms (33.3, 50, 66.7, 83.3, ...), and with a page this slow (a median gap of 33 to 50 ms in both variants) the 95th percentile moves a frame at a time. One step is 12 to 14% of 117 to 133 ms, so a verdict at 1.10 is inside the noise of one step.
- The runs are not steady. The bent runs' 95th percentiles run from 133.3 to 200 ms and the shade-only runs' from 66.7 to 166.7; the last pairs (runs 14 and 16, shade only) were the fastest of the sixteen, with the most frames and the most sampled frames with a dent, which reads as a freer machine at that moment more than a cheaper shade.
- The frame gap is the only instrument. Run without `DENT_BEND_RUNS`, the spec logs one pair of `dent-bend-data` lines and a `dent-bend-verdict` line and asserts nothing about the gap (the owner's ruling on the frame gap, keithpickering/dividedworld#318).

## The confirmation set

Run after the review of the first write-up, with nothing else running a browser on the machine, by the same command and at the same speed, to see whether the first set was luck. The verdict above weighs both sets.

| Run | Foil | 95th percentile of the gap, ms | Median gap, ms | Frames | Frames sampled with a dent in view |
|---|---|---|---|---|---|
| 1 | bent | 116.6 | 33.4 | 480 | 43 of 141 |
| 2 | shade only | 66.6 | 33.3 | 692 | 101 of 197 |
| 3 | bent | 116.6 | 33.4 | 471 | 44 of 137 |
| 4 | shade only | 66.6 | 33.3 | 669 | 96 of 192 |
| 5 | bent | 116.6 | 33.4 | 471 | 44 of 136 |
| 6 | shade only | 66.7 | 33.3 | 681 | 98 of 194 |
| 7 | bent | 116.7 | 33.4 | 471 | 43 of 137 |
| 8 | shade only | 66.7 | 33.3 | 628 | 89 of 183 |
| 9 | bent | 133.3 | 50 | 385 | 29 of 112 |
| 10 | shade only | 83.4 | 49.9 | 502 | 59 of 144 |
| 11 | bent | 116.7 | 33.4 | 435 | 33 of 126 |
| 12 | shade only | 66.7 | 33.3 | 685 | 99 of 197 |
| 13 | bent | 116.6 | 33.4 | 471 | 45 of 136 |
| 14 | shade only | 66.7 | 33.3 | 668 | 97 of 190 |
| 15 | bent | 116.7 | 33.4 | 460 | 40 of 133 |
| 16 | shade only | 66.7 | 33.3 | 658 | 93 of 188 |

The median of the eight bent runs' 95th-percentile gaps is 116.7 ms (mean 118.7); of the eight shade-only runs', 66.7 ms (mean 68.8). The ratio of the medians is 1.749, over the 1.10 line, where the first set's was within it. The ratio of the means is 1.727.
