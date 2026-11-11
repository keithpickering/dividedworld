Record, written 2026-11-11.

# Jimmy Wails shots

The screenshots the Jimmy Wails plan's Task 9 asks for, for the owner's word on the text boxes, the type and the attribution line. Each is one post (#47 of the Main board's moment, by Spritey, with the appeal's plays on it) read by a signed-in account with a wallet of 5.00 Aura unless it says otherwise. The post is the whole picture: its words, the banner or carousel, the drive and its buttons, and the post's own buttons.

Each case is shot four ways, `<case>-<light|dark>-<1440|390>.png`: the light and the dark board, at the Main board's width (1440) and the Phone board's (390). All are at deviceScaleFactor 2, so a 1440 shot is about 2400 pixels wide.

| Case | What it shows |
| --- | --- |
| `plate-blue-short` | The blue-shirt plate (Jimbo's picture, a white panel for the words) with a 52-character message. |
| `plate-blue-long` | The same plate with a 200-character message, which the fit steps down to fit the box. |
| `plate-close-short` | The close-up plate (the words in its light left side) with a 39-character message. |
| `plate-close-long` | The close-up plate with the 200-character message. |
| `plate-dark-short` | The dark-logo plate (white words on a near-black panel) with a 45-character message. |
| `plate-dark-long` | The dark-logo plate with the 200-character message. |
| `drive-three-mid` | A drive of three appeals (one on each plate) at its second, with the carousel's previous and next, dots, "2 of 3" and Pause, and three gifts on the wall. |
| `drive-long-wall` | Three appeals and 26 gifts: the wall holds the latest 20 and says "and 6 more". |
| `drive-closed` | A drive of two appeals, a week and a day old: "This drive has ended. It raised 5.30 in 11 gifts.", no buttons, the wall kept. |
| `drive-earlier-collapsed` | A closed drive and, after it, a new drive of one appeal. The closed one is the line "An earlier drive raised 3.45 in 7 gifts", shown opened so its banners show. |
| `drive-reduced-motion` | The three-appeal carousel under reduced motion, on its second appeal: no Pause button, no fade, no rotation, and previous and next still work. |
| `origin-box` | A thread spun from the post: its ORIGIN box shows the banners and the totals and no buttons. |
| `button-short-wallet` | One appeal with a wallet of 0.20 Aura: 0.10 can be given, and 0.25, 0.50 and 1.00 are disabled. |

## How they were taken

The stories are `instances/divided-world/ui/jimmy-wails/Effect.board.stories.tsx` (Storybook's "Boards/21 Jimmy Wails"; each case has a Light, a Dark and a Phone twin there). They run on the fake backend: the plays are seeded with their drawn plate, the gifts through the fake's own `donate` from accounts of their own, and a closed drive by dating its plays a week and a day back, since the page judges a drive's close by the real clock. The build is the end-to-end one (`npx vite build web --mode e2e`, served by `npx vite preview web`), each story opened at `/?fixture=boards&story=<id>`, in Playwright's Chromium (default launch plus the three flags `playwright.config.ts` sets for stable text), at 1440 by 1120 and 390 by 844. The viewport is made taller than the post and the post's own element is screenshotted, so the fixed Game HUD covers none of it. The mid-carousel shots press "Show appeal 2" first, then move the pointer away and wait for the fade. The throwaway script that took them is not in the repository.

## What the shots show that is not the drive's design

- Nothing here is a known defect now: the donor wall names every donor by the name the gift carries (drive_gifts, 0150), whether or not the donor has posted in the thread. The drive, long-wall, closed and reduced-motion shots were retaken after that fix (an earlier set showed "A character" for every donor); the earlier-collapsed shots show no wall and are the first set.
- The clock in the post's header is the day the shots were taken; the closed shots' is a week and a day before it.

## Size

The PNGs were reduced from 29 MB to about 9.5 MB by 256-color quantization (median cut, Floyd-Steinberg dithering), at the same pixel size and deviceScaleFactor 2. Photographs show slight banding; text and borders are unchanged. Lossless recompression alone saved under 3%.
