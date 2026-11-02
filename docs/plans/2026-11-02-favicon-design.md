# Divided World's favicon: design

Record, written 2026-11-02. The design for the icon Divided World shows in a browser tab and on a home screen, made with
the owner from a question ("What could a Divided World favicon look like? The Minus World one had a `-` in a circle
with a rainbow pinwheel"). The sheets and the approved art are `docs/research/2026-11-02-favicon/`. The plan is
`docs/plans/2026-11-02-favicon-plan.md`.

## 0. Where it starts

The site has no icon. `web/index.html` names the page's title and nothing else, so a tab shows the browser's blank
page, and a request for `/favicon.ico`, which browsers and many other clients make without being told to, falls
through `netlify.toml`'s single-page redirect and is answered with `index.html`, as text, with a 200.

## 1. The mark: a coin split by the bar of a division sign

**Decided** (the owner, after four concepts and two rounds; `q1-concepts.png` to `q3-pixel-pass.png`): a coin whose
upper half is the board (white) and whose lower half is the glass (a violet glow), split by a flat seam of pale cyan
over cyan. The seam is the bar of a division sign, and each half holds one dot in the other half's color, as a
yin-yang's halves do. Minus World's mark was a minus in a circle; Divided World's is a division sign, and the two
dots are the two worlds the two-worlds design (`docs/plans/2026-10-29-two-worlds-design.md`) divides the site into.

Weighed:
- A, the division sign in Minus World's pinwheel circle (the warmest nod to the community; the owner kept it in the
  running with B, then chose B's split).
- B with a slanted seam (the division sign is cut in two and goes to mush at 16px).
- B with a black bar for its seam (B2 to B4, `q2-flat-seam.png`): the strongest division sign at 16px, but a black
  bar across a white-over-color coin reads as a Poké Ball.
- A split domino mask (about the masks rather than the name; it loses the Minus World line).
- A "DW" monogram on a glass tile (on brand, generic).
- Glass on top (`q3-pixel-pass.png`): the violet half sinks into a dark tab; with the board on top, the white half
  carries the shape on both.

## 2. Two drawings: the owner's sprite at 16px, the vector above it

**Decided** (the owner): the 16px icon is the owner's own sprite (`coin-16.png`), drawn pixel by pixel, with
transparent and half-transparent pixels on its rim so it holds on a light tab and a dark one. Every larger size is a
rendering of the B1 vector (`coin.svg`), whose seam was moved to land on whole pixels at 32px.

The two are not the same drawing and are not meant to be. The sprite carries a gray rim on its white half, a teal
shadow under its seam and a lilac glow around its lower dot, which the vector does not; the owner: "sprites sometimes
need differences in scaling, colors etc to evoke the same appearance of the larger version, which was my goal here".

Weighed: the sprite doubled to 32px with hard edges (one drawing everywhere; the owner preferred the vector from 32px
up); the vector redrawn in the sprite's colors (`q5-vector-beside-sprite.png`; the owner kept the vector as drawn).

## 3. The files a browser is given

**Decided:** two files at the site's root.

- **`/favicon.ico`**, holding three images: 16px (the sprite's PNG, byte for byte), 32px and 48px (the vector,
  rendered). The ICO container is kept, though most browsers also take a PNG, because it is still the one way to hand
  a browser several sizes of one icon and have it choose: a tab on a 1x screen takes the 16, a 2x screen the 32,
  Windows's shortcuts the 48. Each image is stored as a PNG inside the ICO, which every browser that reads ICO reads.
  It sits at the root because clients ask for `/favicon.ico` there unprompted, and the single-page redirect would
  otherwise answer them with HTML.
- **`/apple-touch-icon.png`**, 180px: the vector's coin on the glass's ground (`#07050d`), opaque, with a margin, since
  iOS fills a transparent pixel with black and rounds the corners itself. Also at the root, where iOS looks for it
  when a page names none.

`web/index.html` names both (`<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">` and
`<link rel="apple-touch-icon" href="/apple-touch-icon.png">`).

Weighed:
- An SVG favicon (`<link rel="icon" type="image/svg+xml">`): Chrome and Firefox take an SVG over an ICO and draw it at
  every size, the 16px tab included, so the owner's sprite would never be seen.
- PNG files named by `sizes` on separate `<link>` tags: browsers choose among them inconsistently (some take the last,
  some the largest), where they choose among an ICO's images by size.
- A web app manifest with 192px and 512px icons and a theme color, so the site installs as an app: it brings an app's
  name, display mode and colors, which are a design of their own. Not in this design; it is a follow-up if the owner
  wants the site installable.

## 4. Committed files, and a record of what they were made from

**Decided** (the owner): the ICO and the home-screen PNG are committed, not built. A script makes them from the two
sources (the vector rendered in Chromium, which the repository already has for its end-to-end run) and writes, beside
them, a record of each source's and each output's SHA-256. The build has no browser (`tools/build.mjs`,
`OUTSIDE_THE_BUILD`), so it cannot re-render the vector to compare. What it can read is whether the files still are
what the record says they were made from: a sprite or vector edited without the script run again fails the build,
naming the script to run.

Weighed: the build making them every time (the sizes could never drift; it would need a browser in the build, or a
second rasterizer as a dependency, to draw an SVG).

## 5. The layers

**Decided:** the icon is the instance's, and the engine gains nothing. Divided World's sources sit in
`instances/divided-world/ui/icon/` and its served files in `instances/divided-world/ui/public/`. The convention the
web app keeps is that an instance's `ui/public/` is the site's root: `web/vite.config.ts` names it as Vite's
`publicDir`, so a build copies it to the root of `web/dist/`. `web/` is the composition root, which already names the
instance (it imports `instances/divided-world/ui/` and its title is Divided World's), so naming the instance's public
folder there crosses no line `tools/check-engine-boundary.mjs` guards. The script that makes the icons takes the
folders as arguments and names no instance.

## 6. The rules this touches

- **A response never proves a private fact.** The icon is the same file for every visitor, signed in or not; nothing
  in it is computed from anything about anyone.
- **No player is ever stuck.** The change adds no state a player, a character or a post can be in.
- **A guard that has never been red is not known to work.** Section 4's check arrives with its test, which drives each
  of its failures red on a poisoned input (the plan's Task 1).
- **Portable by construction.** The files are static and live in the instance's folder, so an instance moved to its
  own repository or host carries its icon with it. They are not part of an instance's data export, which is the
  forum, not its look.

## 7. Open

- A web app manifest (section 3), if the owner wants the site installable.
- Whether a sprite drawn for 32px would beat the vector at 32px on a 2x screen. The owner judged them identical in
  `q5-vector-beside-sprite.png`; a later change can put a hand-drawn 32px image in the ICO's place for it without
  changing anything else here.
