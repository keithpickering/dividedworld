# The 2003 board look: design

Record, written 2026-11-06. A design session with the owner, started from the owner's request to draw design boards for
the board world's screens as the backfill session drew them for the glass
(`docs/plans/2026-11-05-backfill-boards-design.md`), so a build session has an accurate reference. The owner: the board
should look "very quaint. But still well organized ... the best version of an old school forum", and asked whether the
house theme could be more period-accurate than "maximum simplicity", whether image buttons could be simulated with CSS,
and what support exists for themes beyond light and dark. This document is written in rounds as the session goes; the
plan follows once the screen boards are approved.

## 0. Where it starts

Shot on main (354dbc4) from the in-memory demo (`npx vite build web --mode e2e`), the index, a board, a thread and a
profile at 1440 and 390, light and dark. The critique:

- **Every rule is the same rule.** The outer frame, the column heads and the lines between rows are one 1px line in
  `--kb-rule`, so a table has no anchor.
- **Three things look identical.** The NEW chip, the avatar's letter box and Start a thread are each a black-bordered
  box; a control cannot be told from a label.
- **Rows do not alternate**, so a long thread list is a field of lines.
- **The page stops rather than ends**: nothing follows Who is online.
- **Dark mode is #fff on #000**, and its 1px rules shimmer at that edge.

What exists for themes: a theme is a stylesheet of `--kb-*` tokens only (`tools/check-theme.mjs`); an instance lists
its themes as `ThemeOption`s (`engine/ui/types.ts`), each with `modes` of both, light or dark; `ThemeRow`
(`engine/ui/account/appearanceRows.tsx`) appends every instance theme after the house's two; Divided World lists one
(`instances/divided-world/ui/index.ts`). The tokens (`engine/ui/tokens.css`) name about eleven chrome colors, so no
period skin can be written in them.

## 1. Round one: the look

The board `docs/research/2026-11-06-board-look/00-look.html` (published for the owner as an artifact) draws the index,
a board and a thread in each look, light and dark, with three button treatments, four tribute concepts and a sketch of
a theme picker on the glass.

1. **The house is Silver** (the owner, agreeing with the recommendation, over Strict). The house stays black and white
   with grays between: the page on a gray so the tables lift off it; the table drawn as `cellspacing="1"` draws it, the
   gaps in a mid gray as the grid; the column heads a dark gradient band with white text; the category a light gradient
   band; rows alternating between two grays and counts and post feet in a third; folder icons (new posts, none, busy,
   locked) in place of the NEW chip; a footer with "Powered by KayfaBB" and 80×15 badges whose words are true. Dark is
   charcoal (#141414 page, #262626 and #1f1f1f rows), text #e8e8e8. Color stays only on the game's pieces. PRODUCT.md's
   brand commitment "black and white" becomes "black, white and grays", which the owner approves in review of this
   design.
2. **Buttons are Chrome** (the owner, agreeing with the recommendation, over Bevel and Plain). New thread, Post reply,
   a post's Quote, Spin thread, Edit and History, and the composer's buttons are drawn as a 2003 Photoshop button: a
   gradient with a hard midline, a 1px stroke, an inner highlight, a soft drop shadow, lettering in bold lowercase
   Verdana with a glow. Each is real text in a real `<button>`: its accessible name keeps the copy's case, its contrast
   is measured on its face, it has a focus ring. A theme recolors it through tokens.
3. **Themes are part of this design** (the owner, agreeing with the recommendation). The token vocabulary grows to what
   a period skin needs (row grays, the head and category bands, the grid gap, the banner, the nav bar, links' hover,
   inputs, icons, the button faces; about twenty-five, each able to hold a gradient where it is a background); Settings'
   board row splits into a Theme picker of preview tiles, each drawn from that theme's own tokens read at build time,
   and a Mode row that a single-mode theme greys and explains; and tribute themes ship as Divided World's own theme
   files, named for how they look and using no other product's art. The tributes drawn as concepts in round one: Blue
   Steel (light), Midnight (dark), Hot Rod (dark), Fan Site (light).

4. **All four tributes ship** (the owner): Blue Steel, Midnight, Hot Rod and Fan Site are drawn properly and ship
   with the plan. The owner gave screenshots for two of them:
   - **Hot Rod** keeps round one's flames (the owner: "I like yours better") and takes its buttons from a red
     proto-MFGG ezboard: gray pillow-shaded GIFs, lit from the center and dark at every edge, black bold lettering in
     title case. So the button's background and case are tokens a theme sets, not only its gradient's four stops.
   - **Fan Site** becomes classic MFGG blue (the owner), from a 2008 Invision Power Board capture: a black page under a
     dim tiled navy pattern, royal-blue panels with pale-blue text, a teal sub-bar, yellow links in the nav, and the
     column heads in that board's texture, a navy gradient under a grid of small squares fading downward with cyan
     lettering spaced wide. It is dark only. The tile is drawn from plain shapes, never MFGG's sprite, and its name is
     open.
5. **Screen boards in the order a reader meets them** (the owner, agreeing with the recommendation), each batch at 1440
   with one phone board at 390, in Silver light and dark: 1. the index and a board; 2. a thread, the composer and New
   thread; 3. a profile and its record; 4. the standings and the reveal; 5. The System's profile and the move notice;
   6. the errors and Unavailable; 7. the theme picker.

## 2. Batch 1: the index and a board

Drawn on main (354dbc4)'s screens (`engine/ui/index/Index.tsx`, `engine/ui/board/Board.tsx`) in Silver, light and dark:
`docs/research/2026-11-06-board-look/01-index.html` and `-dark`, `02-board.html` and `-dark` at 1440 by 1000, and
`03-phone.html`, the four at 390 by 844 side by side, all written by `gen.mjs` in the token names this design proposes.
The boards draw only what the screens show; round one's mock had a locked thread and a "new posts" state on the index,
which the app does not have, and both are gone.

- **Folder icons on the thread list only.** A thread row's NEW and HOT chips become a folder icon, with four states from
  those two facts: new posts filled, none hollow, and either with a flame when the thread is hot
  (`settings.hotReplies` replies this week). Each icon carries its state as hidden text ("New, hot"). The owner: the
  first pixel icons "end up getting rendered at an arbitrary size and the pixel grid gets messed up. Also they are a bit
  more 1990 than 2003". So the icons are drawn as 2003 icon GIFs were, a few flat tones with a 1px outline and a
  highlight line (new posts a sheet in a dark folder, none an empty light one), as vectors drawn at their own viewBox's
  whole-pixel size with every stroke on a half pixel, so no icon is ever scaled. Their tones are theme tokens
  (`--kb-icon-ink`, `-back`, `-front`, `-new`, `-hi`, `-line`, `-hot`). The index draws no
  icon, because it has no state to show (`Index.tsx`: a board's unread count would need a read of every thread).
- **A legend** under the thread list names the icons, in plain words: "Hot: 10 replies this week" takes its number from
  the setting, and is a draft for the owner's review. The pin is not in it (the owner: a mark in the legend "is a bit of
  an antipattern (pressing it gives this info regardless, and it's intermingling with the board world in a sort of
  illusion-breaking way)"); the board's key speaks only of the board's own things.
- **A character's mini avatar and name are one unit**, the box centered on the name's capitals rather than its line box,
  which in Verdana holds more room under the capitals than over them (2px at these sizes in the boards, which render a
  Verdana substitute; the build measures it on Verdana itself). The owner found the first boards' avatars misaligned.
- **No category bar.** Divided World's boards are not grouped; the light band heads real sections only (Who is online,
  Users browsing this board), each an `h2`.
- **The banner and the boards' bar are one block**, the logo on the light gradient and the board links on the dark bar.
- **Pinned threads are a group of their own** above the rest, split by a 4px row in the third gray; the pin's mark keeps
  the glass's cyan, as a card's mark is a game piece.
- **Counts sit in the third gray** with tabular figures.
- **A footer ends every board page**: "Powered by KayfaBB" and three 80×15 badges reading GAME ON, MASKS ON and KILTER
  OFF (the owner's words), hidden from assistive tech. It links nothing on the glass: every way into the glass is the HUD's.
- **On the phone a row's counts fold into one line** ("169 replies · 4 views · last: Pipewrench, Oct 5"), where today
  each takes a line and a phone shows two and a half threads; the index folds the same way, and a date never breaks.
  Boards is a Chrome button in the banner.

**Batch 1 approved by the owner** ("Looks great, approved"), after the nits above.

## Open

- Fan Site's name, now that it salutes one board's blue.
- The legend's words.
