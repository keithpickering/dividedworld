# A rendered card back: the plan

Record, written 2026-11-11. It carries out `docs/plans/2026-11-11-rendered-card-back-design.md`, and surveys the same
files. Tasks run in order. Each goes test first: the failing test and its red run, then the code.

## Task 1: the guard reads a back folder

Model: sonnet

Files: `tools/check-card-art.mjs`, `tools/test-card-art.mjs`.

- The reading of one canvas moves into a function, `canvasFaults(dir, base, required)`, where `base` is `art` or `hit`:
  it reads `<base>.svg` and `<base>.webp`, says when both are there, says when neither is and `required` is true, applies
  each file's cap, and runs the SVG's or the WebP's checks. `folderFaults` (a card's folder) calls it for `art`,
  required, and is otherwise unchanged; its messages keep their words.
- A new `backFaults(dir)` for `instances/<name>/ui/card-back/`: `canvasFaults(dir, 'art', true)`,
  `canvasFaults(dir, 'hit', false)`, and `art.json` as a card's (present, JSON, `credit` and `license` non-empty). No
  `mark.svg` is asked for. Its "missing a canvas" message says what a back folder holds.
- `cardArtFaults(root)` adds the faults of each instance's `ui/card-back/`, where that folder exists. `CAPS` gains
  `hit.svg` (200 KB) and `hit.webp` (400 KB). The command's passing line counts card folders and back folders. The
  header comment says all of this.

Tests first, in `tools/test-card-art.mjs`, with a helper that writes a back folder beside the clean card folder.

Green: a back with `art.webp` and `art.json`; one with `art.webp`, `hit.webp` and `art.json`; one with `art.svg` and
`hit.svg`; a repository with no back folder (the existing cases).

Poisons: a back folder with no `art.*`; with `art.svg` and `art.webp`; with `hit.svg` and `hit.webp`; a `hit.webp` of
540 by 840; a `hit.webp` that is a PNG; an `art.svg` holding `<script`; no `art.json`; an `art.json` with an empty
credit; a `hit.webp` padded past 400 KB.

## Task 2: the back draws a picture

Model: inline

Files: `engine/ui/types.ts`, `engine/ui/test-world.tsx`, `engine/ui/cards/Postcard.tsx`,
`engine/ui/cards/postcard.test.tsx`, `engine/ui/cards/postcard.css`, `engine/ui/vending/Vending.tsx`,
`engine/ui/vending/PackOpening.tsx`, `engine/ui/cards/Postcard.stories.tsx`.

- `InstanceUi.cardBack` becomes `{ readonly mark: string; readonly canvas?: string; readonly hitCanvas?: string }`, with
  its comment saying what each is and that a picture replaces the mark on the back. `test-world.tsx`'s copy of the type
  follows.
- `PostcardBackProps` gains `canvas?: string` and `hitCanvas?: string`. `PostcardBack` picks its picture:
  `hit ? hitCanvas : canvas`. With a picture it draws
  `<img class="kb-postcard-art" src=… alt="" aria-hidden="true" draggable={false} decoding="async">` in the canvas, no
  emblem, and sets `data-kb-pictured` on the card. With none it draws today's back. In `postcard.css`,
  `.kb-postcard-back[data-kb-pictured] .kb-postcard-canvas` has no smoke under the picture
  (`background-image: none`), so a picture that is late shows the plain field and not a second back.
- The three callers pass the instance's pictures with its mark. Each passes `mark` today through a conditional spread;
  they pass `canvas` and `hitCanvas` the same way.

Tests first, in `postcard.test.tsx`'s "the back" block:
- with `canvas`, the back draws one `img.kb-postcard-art` with that address, `decoding="async"`, empty alt, hidden from
  assistive technology, and no `.kb-postcard-emblem`, though a `mark` is given too;
- with `hit` and `hitCanvas`, the picture is the hit one;
- with `hit`, a `canvas` and no `hitCanvas`, there is no picture and the mark is drawn (the stylesheet's gold back);
- with neither, the back is unchanged (the existing tests);
- the stylesheet lays no smoke under a pictured back.

And one in the Vending Machine's and the pack opening's tests each, where a back is already asserted: given a
`cardBack` with pictures, a back draws the picture.

## Task 3: Divided World's back

Model: inline (it needs Blender)

Files: `instances/divided-world/ui/card-back/scene.py`, `art.webp`, `hit.webp`, `art.json`;
`instances/divided-world/ui/index.ts`; `instances/divided-world/ui/index.test.tsx`;
`instances/divided-world/ui/cards/README.md`.

- Render `art.webp` (`python scene.py art.webp`) and `hit.webp` (`BACK=hit python scene.py hit.webp`) from the scene,
  at the rig's defaults. `art.json` credits "Divided World" under the project's own terms, as the cards' do.
- `index.ts` imports both with `?url` and gives `cardBack: { mark: coinUrl, canvas, hitCanvas }`.
- Test first in `index.test.tsx`: the card back has a `canvas` and a `hitCanvas`, each a WebP or SVG address, beside
  the mark it already asserts.
- The art README gains a short section: the back's folder, its two pictures, and how to render them.

## Task 4: the contract's words

Model: inline

Files: `specs/card-art.md`.

A section "The card back": the folder, its files, that a picture replaces the mark on the back and that the hit pull
with no picture of its own keeps the stylesheet's gold back, that the small tile keeps the stylesheet's smoke, and what
the guard holds the folder to.

## Task 5: the whole build

Model: inline

`npm run build`, then the Card Backs story shot at the four sizes for the PR, then the PR (one for the whole follow-up
branch, as the owner chose).

## Review focus

- A pictured back whose image fails to load: is the back still plainly a card back (frame, field), at every size?
- The hit pull with a `canvas` and no `hitCanvas`: does every caller still draw the gold stylesheet back, and never the
  default picture under a gold frame?
- The pack opening shows many backs at once and flips them: does an `<img>` in the back change the flip's timing or
  its reduced-motion form?
- The guard's refactor: does any message a card folder used to get change its words, and is every old poison still red
  for the same reason?
- Anything that draws a back without going through `PostcardBack` and would now differ from it.
