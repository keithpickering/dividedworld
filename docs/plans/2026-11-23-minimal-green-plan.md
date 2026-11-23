Record, written 2026-11-23.

# Minimal Green, the sixth theme: plan

Carries out `docs/plans/2026-11-23-minimal-green-design.md`. One PR from `main`.

Every task goes test first: write the failing test, record its red run, then the code. During a task, run only the
tests for the changed code (`npx vitest run <file>` for the screens', `npx playwright test <spec> --trace off` for a
browser spec, `node tools/test-theme-preview.mjs` and `node tools/test-theme.mjs` for the tools). Run `npm run
typecheck` and `npm run build` once after the last task, with the tail in the PR. No deployed database, bucket or
connector is touched, and no migration is added.

**The layers.** Tasks 1 to 3 are the engine's (`engine/ui/`, `tools/`) and name no instance. Their tests use
stylesheets of their own or the engine's, never Divided World's theme. Task 4 is Divided World's
(`instances/divided-world/ui/`).

**The masks.** A theme is a stylesheet the player chooses, stored with their preferences as today. No payload, read,
Realtime event or timing is added or changed.

**States.** None added.

**Scale.** Stylesheets only. Nothing grows with players, threads or Acts.

## Task 1. `--kb-font-heading`

Model: sonnet

**Files:** `engine/ui/tokens.css`, and the head selectors below: `engine/ui/base.css`, `engine/ui/frame/frame.css`,
`engine/ui/composer/composer.css`, `engine/ui/thread/thread.css`, `engine/ui/thread/fold.css`,
`engine/ui/search/board-search.css`, `engine/ui/cards/hand-board.css`, `instances/divided-world/ui/below-the-fold/fold.css`;
a new spec `e2e/theme-shape.spec.ts`.

- `tokens.css`, beside `--kb-font-mono`, with a comment saying what reads it and why its default is the monospace:
  ```css
  /* The board's headings and head bands (h1 to h3, a table's head, a section bar, a box's or a modal's head, the logo): a theme may
     set them in a face of their own while code, captions and the small print keep --kb-font-mono. Unset, they are the monospace, as
     the 2003 board drew them. */
  --kb-font-heading: var(--kb-font-mono);
  ```
- Read `--kb-font-heading` in place of `--kb-font-mono` in these, and only these: `h1, h2, h3`, `.kb-table th`,
  `.kb-table td.kb-bar`, `.kb-box-head`, `.kb-modal-head` (`base.css`); `.kb-logo` (`frame.css`);
  `.kb-form > .kb-box-head` (`composer.css`); `.kb-acts-head > span` (`thread.css`); `.kb-fold-bar` (`fold.css`);
  `.kb-search-head` (`board-search.css`); `.kb-hand-board-post-bar` (`hand-board.css`); `.dw-fold-bar` (the instance's
  `fold.css`, which already reads engine tokens).
- Kept on `--kb-font-mono`: `.kb-mono`, `.kb-bb-code`, captions, the letter placeholders (`.kb-mini-none`,
  `.kb-postbit-none`, `.kb-profile-none`), `.kb-system-name`, `.kb-presence-visit`, `.kb-readonly-tag`, the moment's
  small print, the poll's meta and counts, `.kb-origin-head` (it is inside a post, design section 1.7),
  `.kb-class-label` and Hot Box's sign. The theme picker's miniature is Task 3's.

**Tests first:** `e2e/theme-shape.spec.ts`, built the way `e2e/table-defaults.spec.ts` is: the engine's own sheets
(`tokens.css`, `base.css`, `frame.css`, `thread.css`) loaded into a page with a small markup of each piece named
above, read with `getComputedStyle`.
- Unset: every heading piece's `font-family` equals `.kb-bb-code`'s (the monospace), so no theme that sets neither
  token changes.
- Set (`:root { --kb-font-heading: serif }` laid over): every heading piece is `serif`, and `.kb-bb-code`, `.kb-mono`
  and `.kb-origin-head` are still the monospace.
- Red: before the selectors change, the "set" case fails on every piece. Record it.

## Task 2. `--kb-radius`

Model: sonnet

**Files:** `engine/ui/tokens.css`, `engine/ui/base.css`, `engine/ui/frame/frame.css`, `engine/ui/thread/thread.css`,
`engine/ui/composer/composer.css`, `engine/ui/postbit/postbit.css`; `e2e/theme-shape.spec.ts`.

- `tokens.css`, beside `--kb-button-radius`, with a comment that it rounds the page's own boxes and never a box a post's
  words draw (the design, section 1.7, and why: CLAUDE.md, "An effect fills the post, border to border"):
  `--kb-radius: 0;`.
- Rounded by it: `.kb-banner` (its top corners) and `.kb-nav` (its bottom corners), so the two read as one box;
  `.kb-table`; `.kb-acts`; `.kb-box`, with `.kb-box-head` taking the top corners; `.kb-modal`; `.kb-input`,
  `.kb-select` and `.kb-textarea` (each `border-radius: 0` becomes the token); `.kb-postbit-avatar` and the image in
  it; the banner's meter (`.kb-meter`).
- **No clipping.** Nothing gains `overflow: hidden` or `clip`, so no focus ring at a box's edge is cut. Where a box's
  children paint their own ground at its corners (a table's corner cells, `.kb-acts-head`'s ends, the last row's ends),
  those children take the matching corner, `calc(var(--kb-radius) - 1px)` inside a 1px edge, floored at 0
  (`max(0px, …)`), so a radius of 0 draws exactly today's square.
- Square whatever the token: `.kb-origin` and its parts, BBCode's quotes, code and spoilers (`bbcode.css`), and every
  glass piece (the glass has its own look and no `--kb-*` radius).
- `--kb-radius` is not a size token for `tools/check-theme.mjs` (it does not hide text), so no check changes. Confirm
  `tools/check-theme.mjs` lets it through, and say so in the PR.

**Tests first:** in `e2e/theme-shape.spec.ts`:
- Unset: every piece above has a `0px` radius, as `e2e/table-defaults.spec.ts` already holds for the table.
- Set (`:root { --kb-radius: 8px }`): the banner's top corners, the nav's bottom corners, the table and its four corner
  cells, the thread's frame and its head's ends, `.kb-box`, the modal, the three fields and the avatar are rounded;
  `.kb-origin`, a BBCode quote and a code block are `0px`; and the table's, the frame's and the box's `overflow` is
  `visible`.
- Red: the "set" case fails before the CSS changes. Record it.
- Then, by eye: the demo thread and board (`npm run dev:web -- --mode e2e`) with a stylesheet setting both tokens, at
  1280 wide and 390 wide, with a screenshot of each in the PR.

## Task 3. The picker: six tiles, and the miniature's corners and heading

Model: sonnet

**Files:** `tools/theme-preview.mjs` (`OPTIONAL_TOKENS`), `tools/test-theme-preview.mjs`,
`engine/ui/account/ThemePicker.tsx` (`SCOPE`, `ThemeRow`), `engine/ui/account/account.css` (`.kb-tp-*`,
`.kb-tp-tiles`), `engine/ui/account/ThemePicker.test.tsx`, `engine/ui/account/ThemePicker.board.stories.tsx` (its
comment's "five").

- `OPTIONAL_TOKENS` gains `--kb-radius` and `--kb-font-heading`. A theme that sets neither previews as today: each
  resolves through `engine/ui/tokens.css` (`0`, and the monospace).
- `SCOPE` gains `['--tp-radius', '--kb-radius']` and `['--tp-font-heading', '--kb-font-heading']`. The miniature
  (`.kb-tp-banner`, `.kb-tp-nav`, `.kb-tp-table`, `.kb-tp-btn`) reads `--tp-radius`, and its logo, title and head row
  (`.kb-tp-banner > b`, `.kb-tp-title`, `.kb-tp-h > span`) read `--tp-font-heading` in place of `--kb-font-mono`. The
  thumb draws the radius as well, so a tile shows a rounded theme is rounded.
- `.kb-tp-tiles` lays out the instance's own count of tiles. `ThemeRow` sets `--kb-tp-count` (the themes' length) on
  the row, and the grid divides by it in place of the literal 5 (and `count - 1` gaps in place of 4). Where the count
  does not fit, the row breaks into even rows: a column count that divides the tile count (six: 6, then 3, then 2),
  never one tile alone on a row. The comment above the grid is rewritten to say so.

**Tests first:**
- `tools/test-theme-preview.mjs`: a theme that sets `--kb-radius: 8px` and `--kb-font-heading: serif` previews
  them; one that sets neither previews `0` and the monospace resolved from tokens.css. Red before `OPTIONAL_TOKENS`
  changes.
- `ThemePicker.test.tsx`: the preview's style carries `--tp-radius` and `--tp-font-heading` from the chosen theme's
  preview. Red before `SCOPE` changes.
- A browser check of the tile row with six tiles at 1440 and at 390 (the picker's stories, `ThemePicker.board.stories.tsx`,
  in the board-stories run): six across at 1440, two rows of three at 390, and no row of one. Red with five columns
  hard-coded and six themes listed.

## Task 4. Minimal Green

Model: sonnet

**Files:** a new `instances/divided-world/ui/themes/minimal-green.css`; `instances/divided-world/ui/index.ts` (the
imports and `themes`); `instances/divided-world/ui/themes.test.tsx`; `instances/divided-world/ui/group-bars.test.tsx`
(its list of tribute files).

- The theme file is `docs/research/2026-11-23-minimal-green/minimal-green-draft.css`, token for token, in the shape
  Midnight's file has: the same values on `:root`, in the `prefers-color-scheme: dark` block and in
  `:root[data-kb-mode="dark"]`. It opens with a header comment in the tributes' manner:
  ```css
  /*
   * Minimal Green, a tribute: Simplistic Green, an old MFGG skin, made flat. Near-black ground, one green between that skin's
   * warmer #0ba13d and emerald, 8px corners on the page's own boxes, a sans face for headings, and no gradient, shadow or glow.
   * Dark only, so it sets its tokens on :root and in both dark blocks alike (docs/plans/2026-11-23-minimal-green-design.md).
   * The game's own pieces keep the house theme's colors.
   */
  ```
  The draft holds the vignette's colors from Midnight with both opacities at `0`. Set the two colors to `transparent`
  so the file shows no look it does not draw.
- `index.ts`: import `./themes/minimal-green.css?url` and `?preview`, and append
  `{ key: 'minimal-green', name: 'Minimal Green', href: minimalGreen, modes: 'dark' as const, preview: minimalGreenPreview }`.
  The comment above `themes` says "then five tributes".
- `group-bars.test.tsx` reads `minimal-green` with the others.

**Tests first:** `themes.test.tsx` lists six themes, the last `['minimal-green', 'Minimal Green', 'dark']`, six
distinct hrefs, and six tiles ending `'Minimal GreenDark only'`, with "four tributes" in its title and comment made
"five". Red before the theme is listed. Then run `npx vitest run web/contrast.test.tsx
instances/divided-world/ui/group-bars.test.tsx instances/divided-world/ui/this/ink.test.ts`, and `node
tools/check-theme.mjs`: each picks the new theme up from the list. A contrast failure is fixed in the theme's values
and named in the PR, never by loosening a check.

By eye: the index, a board, a thread and Settings' theme row under Minimal Green, at 1280 and 390, in the PR beside
`docs/research/2026-11-23-minimal-green/d-thread.png` and `e-board-8px.png`.

## Review focus

- A corner child left square under a rounded parent shows as a notch only when the radius is set: look at the thread
  frame's head ends, a table's corner cells and the last row under Minimal Green, at both widths.
- A post's content area must never meet a rounded corner (design, section 1.7). Check a post whose foot bar is empty or
  hidden (a removed post, a post on the front door, a post's moment), where `.kb-act-main` could reach the frame's
  bottom corner.
- No box gained `overflow: hidden` to round its corners. A focus ring on a link in a corner cell is drawn whole.
- Every other theme is unchanged: both tokens default to today's look, and `e2e/table-defaults.spec.ts` still passes
  untouched.
