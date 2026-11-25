# Ended visit marks: screen mocks

Record, written 2026-11-25. The mocks for `docs/plans/2026-11-25-ended-visit-marks-design.md`. Each is a crop of post #41's
date row in the built visit story (`engine/ui/cards/Visit.board.stories.tsx`, Storybook's "Boards/01 Lens: a visit",
TalkedDown), with a Whoops! mark beside the visit for scale. Only the visit mark's contents are mock; the row, the tile
and the Whoops! mark are the built ones.

- `01-options.png`: the two options as first shown to the owner, beside the marks as built: A, the plain stopwatch with
  a corner badge per outcome; B, the stopwatch itself drawn differently per outcome. Its filed icon in B is the first
  try (a solid face), which the owner replaced.
- `02-approved.png`: the approved set, option B with filed drawn as a "!" (the clock hand over a dot), and the open
  visit's "2:41", unchanged.

To shoot `02-approved.png` again, run Storybook (`npm run storybook`), then
`node docs/research/2026-11-25-ended-visit-marks/shoot.cjs`. It draws option A as it was shown, but writes only the
approved sheet; `01-options.png` is kept as shown.
