Record, written 2026-11-23.

# Minimal Green, the sixth theme: design

A design session with the owner, who opened it with "a sixth theme, Minimal Green. A dark black and emerald green theme
with flat colors, rounded corners and no gradients." Partway through, the owner said where it comes from: "it's a bit
more modern though still based on an old mfgg theme", which was called **Simplistic Green**. No screenshot of it has
been found; the owner remembers "a warmer green, closer to #0ba13d". Its plan is
`docs/plans/2026-11-23-minimal-green-plan.md`.

The theme is on the board, in the board's world (`docs/plans/2026-10-29-two-worlds-design.md`). It joins the house
theme and the four tributes of the board look design (`docs/plans/2026-11-06-board-look-design.md`, section 3) as a
Divided World theme file. The mockups are the real board under a draft token sheet, in
`docs/research/2026-11-23-minimal-green/`. The draft sheet there, `minimal-green-draft.css`, is the source of the
theme's values.

## 0. What a theme could do before this

A theme is a stylesheet of `--kb-*` tokens and nothing else (`tools/check-theme.mjs`). With today's tokens a theme
can already draw Minimal Green's colors, flat buttons (`--kb-button-bg` as a plain color, no shadows) and rounded
buttons (`--kb-button-radius`). Three things it could not:

1. **Rounded boxes.** No token rounds the banner, the tables, the thread's frame, panels or fields; `.kb-input`,
   `.kb-select` and `.kb-textarea` set `border-radius: 0` outright (`engine/ui/base.css`).
2. **A sans heading.** Every heading and head band reads `--kb-font-mono`, so a theme could make its headings sans only
   by making its code sans too.
3. **A flat rank bar.** The group bar's gloss is drawn by the engine with no token to flatten it
   (`engine/ui/postbit/postbit.css`).

## 1. Decisions

1. **One radius token, `--kb-radius`** (the owner: "One token is fine"). Its default is `0`, so the house theme and
   the four tributes draw exactly what they draw today. Weighed: a token per kind of piece (boxes, fields, avatars,
   badges), which buys finer control at the cost of more tokens every theme must keep in agreement; and no rounded
   boxes at all, rounding only the buttons inside the theme file, which reads less like what the owner asked for.
2. **A heading font token, `--kb-font-heading`** (the owner: "Go with the heading token"). Its default is
   `var(--kb-font-mono)`, so every other theme is unchanged. Minimal Green sets it to the system sans. Weighed:
   pointing Minimal Green's `--kb-font-mono` at sans, which needs no engine change but takes the monospace away from
   code and `[code]` blocks; and keeping monospace headings (mockups `a-board.png` against `b-board.png`).
3. **The rank bar keeps its gloss** (the owner: "Gloss is fine for the member bars, on an old forum these would be
   images and normally the same between themes"). No token is added, and Minimal Green leaves the group bar's tokens
   alone.
4. **The green is halfway between emerald and Simplistic Green** (the owner chose variant d). Three were drawn: b,
   emerald (`#10b981`, links `#34d399`); c, Simplistic Green's `#0ba13d` (links `#3fd46e`); d, each value the midpoint
   of the two. The owner asked for "something between" after seeing b and c, then chose d.
5. **8px everywhere** (the owner: "8 everywhere"). One token gives one size, so boxes, fields and avatars share the
   buttons' 8px. Weighed: 12px, which softens the big boxes but makes a short search field look nearly pill-shaped
   (mockups `d-board-12px.png` against `e-board-8px.png`).
6. **Dark only** (the owner: "dark only is fine"), as Midnight, Hot Rod and Fan Site are: the tokens are set on `:root`
   and in both dark blocks alike.
7. **The radius rounds the page's own boxes, never a box inside a post** (the owner: "Agreed with 1"). Rounded: the
   banner and the boards bar under it, tables, the thread's post frame, panels and forms (`.kb-box`), modals, text
   fields and avatars. Square: what a post's words draw, as BBCode drew them (quotes, code, spoilers) and the spun
   thread's ORIGIN box. CLAUDE.md's "An effect fills the post, border to border" is why: in a thread the content area
   (`.kb-act-main`) touches none of the frame's corners (measured on the demo thread: it ends above the post's foot
   bar and inside the frame's border), but the ORIGIN box's area runs to its bottom border, and a fill effect
   (Whoops!'s ink, Feelin' Fab's foil, Hot Box's tiles) would paint square corners past a rounded one. Weighed:
   rounding the ORIGIN box too and teaching every fill effect its box's corners, which is more consistent and changes
   every effect.

## 2. The palette

Set in full in `docs/research/2026-11-23-minimal-green/minimal-green-draft.css`. Its principal values:

| Piece | Tokens | Value |
|---|---|---|
| Page | `--kb-bg`, `--kb-banner-bg`, `--kb-nav-bg`, `--kb-grid` | `#0b0d0c` |
| Rows | `--kb-row-1`, `--kb-row-2` (flat, no stripes), `--kb-row-3` | `#121715`, `#121715`, `#151b18` |
| Frame and rules | `--kb-frame`, `--kb-rule` | `#1d2823`, `#2b3a33` |
| Text | `--kb-fg`, `--kb-muted` | `#e4ebe7`, `#8d9c95` |
| Heads and section bars | `--kb-head-bg`/`--kb-head-fg`, `--kb-bar-bg`/`--kb-bar-fg` | `#0f2c1b`/`#7ae9ad`, `#101815`/`#39d383` |
| Links and logo | `--kb-link`, `--kb-logo-fg`; hover; visited | `#39d383`; `#7ae9ad`; `#97bb9e` |
| Primary button | `--kb-button-primary-bg`/`-fg`; hover | `#0dad5f`/`#04140d`; `#39d383` |
| Other buttons | `--kb-button-bg`/`-fg`/`-edge`; hover | `#1a2320`/`#e4ebe7`/`#2b3a33`; `#22302a` |
| Corners | `--kb-radius`, `--kb-button-radius` | `8px`, `8px` |
| Type | `--kb-font-body`, `--kb-font-heading`; `--kb-font-mono` | the system sans; `ui-monospace` and its stack |

Flat throughout: every shadow token is `none`, no value is a gradient, the vignette's two opacities are `0`, and
buttons are in their label's own case (`--kb-button-case: none`) at weight 600 with no tracking. The game's own pieces
(orbs, the class colors, the badge font, the pips) keep the house theme's values, as `tools/check-theme.mjs` requires.

## 3. The theme picker

Six themes do not fit the picker's row of five (`engine/ui/account/account.css`, `.kb-tp-tiles`, which divides by a
literal 5). The row lays out the instance's own count of tiles where they fit, and on a narrower column it breaks into
even rows (two of three) rather than leaving one tile alone on a row. The miniature draws the chosen theme's radius and
heading font, read from the theme's file at build time with the other preview tokens (`tools/theme-preview.mjs`).

## 4. The rules it touches

- **The layers.** The two tokens and where they apply are the engine's (`engine/ui/`); the theme file and its line
  in the theme list are Divided World's. The engine names no instance.
- **The masks.** A theme is a stylesheet chosen by the player and stored with their preferences, as today. Nothing
  here is computed from a private fact.
- **States.** None added.
- **Accessibility.** The board keeps its contrast, checked for every theme in every mode it shows
  (`web/contrast.test.tsx`), and the corners clip nothing, so no focus ring at a box's edge is cut off.
- **Scale.** A stylesheet's cost does not grow with players, threads or Acts.

## 5. Open

- The vignette is off (both opacities `0`), as "no gradients" reads. The tributes each set one in the instance's
  colors. If the owner wants a faint green edge kept, it is one value in the theme file.
