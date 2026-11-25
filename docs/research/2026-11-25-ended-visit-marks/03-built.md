# Ended visit marks: the built marks

Record, written 2026-11-25. Shots and measurements of the marks as built, from a static Storybook build of
`engine/ui/cards/Visit.board.stories.tsx` (Filed, TalkedDown, Trapped, and Quiz for the open visit), by `shoot-built.cjs`
(Playwright, Chromium, deviceScaleFactor 2; run `node shoot-built.cjs <storybook url>`). Each `03-built-*.png` is a tight
crop of post #41's date row; compare `02-approved.png`. `03-built-forced-colors.png` is TalkedDown with
`emulateMedia({ forcedColors: 'active' })`; `03-built-talked-down-phone.png` is the phone story.

Widths, in CSS px (`getBoundingClientRect`, every mark 36 high). The other mark is the Whoops! mark, `.kb-mark.kb-meta-tile`.

| Layout | Filed | Talked down | Trapped | Open (2:41) | Whoops! mark |
| --- | --- | --- | --- | --- | --- |
| Default (1200 wide, `data-kb-layout="main"`) | 46.72 | 46.72 | 46.72 | 99.91 | 47.91 |
| Phone (390 wide, `data-kb-layout="phone"`) | 46.72 | 46.72 | 46.72 | 92.47 | 47.91 |

The ended tile is 1.19 px narrower than the Whoops! mark in both layouts. No story shows a visit mark in a spun thread's
ORIGIN box (zero `.kb-visit-mark` in every Spin story), so that case is not measured.
