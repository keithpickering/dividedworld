# The ORIGIN box wears the column head's band: design

Record, written 2026-11-11. Designed with the owner in a design session. The plan that carries it out is
`docs/plans/2026-11-11-origin-band-plan.md`. The mockups are in `docs/research/2026-11-11-origin-band/`. They were drawn
from the real `Spin/Spin` stories, with each theme's own file laid over them and only the candidate CSS added.

## 1. What was wrong

The ORIGIN box at the top of a spun thread (`engine/ui/spin/Origin.tsx`) was designed before the board look
(`docs/plans/2026-11-06-board-look-design.md`). It is still drawn the old way (`engine/ui/spin/spin.css`): a 3px double
rule in `--kb-rule` around the box, 2% padding, and a head that is a plain mono line with only "ORIGIN" in bold. Since
the board look, every theme has its own look: Silver's chrome gradient, Blue Steel's blue, Midnight's navy, Hot Rod's
flames, and Fan Site's grid of squares. The box shows none of it, so in a themed board it reads as a framed paragraph
of the post. It does not read as what it is: an Act from somewhere else, set into this thread.

The owner asked whether the box could wear the styled header look so it is recognized at once as an external entity.

## 2. What was decided

### 2.1 The head is the column head's band (B)

The box's head (`.kb-origin-head`) is drawn in the column head's tokens: `--kb-head-bg`, `--kb-head-fg` and
`--kb-head-shadow`. Those are the tokens a table's `th`, the thread's Author | Message head and the pager's current page
already use. Every theme sets them, so every theme draws the band its own way and no instance file changes.

Weighed (`01-three-heads.png`, `02-three-heads-card-play.png`):
- **A, today's look.** Shown for reference.
- **B, the column head's band.** This is the one chosen. It reads most plainly as "a piece of another thread's table"
  in every theme, and the mark tile sits on it cleanly.
- **C, the light category band (`--kb-bar-*`).** Quieter, and it does not echo the thread's own head. But in the dark
  themes it barely separates from the post: in Midnight and Hot Rod it is a faint strip. It reads as a section of this
  post, not as something from elsewhere.

The two heads together were checked against B's one risk: the thread's own Author | Message head stands just above
the opening post (`03-band-in-context.png`). The thread's head is a thin strip of small type. The ORIGIN band is
taller, its words are bold and carry a link, and it is inset inside the post with a frame of its own, so the two are
told apart. A gradient shows more of its stops the taller the band, so Hot Rod's thread head is mostly pale yellow
where the ORIGIN band shows the whole run to flame. That difference helps.

### 2.2 The body stands on the second row's ground (B1)

Under the band, the box's body stands on `--kb-row-2`, in the theme's frame (`--kb-frame`, 1px), with a 1px rule in
`--kb-grid` between the band and the body: a small table of one head and one row. The opening post is seq 1, so it is
always on `--kb-row-1` (`thread.css`, `data-kb-parity`). The Act lifted in is therefore always on a different ground
from the spinner's own words under it, as a quote is.

Weighed (`03-band-in-context.png`):
- **B1, the second row's ground.** This is the one chosen. In Silver light and Blue Steel the difference is plain. In
  the dark themes it is slight, and the frame does most of the work.
- **B2, the post's own ground.** Cleaner, but the origin's words and the spinner's share one ground, and only the box's
  bottom edge parts "theirs" from "mine".

The box also sets `--kb-post-bg` to `--kb-row-2` for what is inside it. A card play's moment draws its list on
`--kb-post-bg` (`engine/ui/cards/moment.css`), and without this it would paint a row-1 strip inside a row-2 box.

### 2.3 The smaller choices, confirmed as one section

1. **The band's words.** The whole head is bold mono, like a column head. Its size stays today's: the owner approved
   the size the mockups show.
2. **The link in the band** ("#1 in Where it began", drawn by `OriginLink.tsx`) takes the band's color
   (`--kb-head-fg`), underlined, visited or not. On hover it keeps that color and its underline thickens. The theme's
   `--kb-link-hover` is held only against the page and the rows (`engine/ui/contrast.ts`, `PAIRS`), never against the
   band, so it could be unreadable on a dark gradient. This adds no token and no contrast pair: the link is held by
   `--kb-head-fg` on `--kb-head-bg`, a pair every theme already passes at 4.5.
3. **The focus ring on the link** is `--kb-head-focus`, the column head's ring, which `PAIRS` already holds at 3:1 on
   `--kb-head-bg`. The mark tiles on the band keep their own ring (`engine/ui/glass/meta-tile.css`), so the rule names
   the link, not every focusable thing in the head.
4. **Bright ink.** When an effect brightens the opening post's words (Feelin' Fab), the box already takes the board's
   inks back (`thread.css`, the `:is(.kb-tally, .kb-origin, …)` rule). The band sets its own color and shadow on
   itself, so the reset cannot put a board color on the band. A test holds that, and holds that no bright-ink rule
   names the head.
5. **Forced colors** drop the gradient and the row's ground. The rule under the band (2.2) and the frame are borders,
   which forced colors keep and paint in a system color, so the band still reads as a head. No `forced-colors` block
   is needed. An end-to-end test under `forcedColors: 'active'` holds it.
6. **Spacing is in ems.** About 0.75em at the sides of the band and the body, set once on the box. The band runs edge
   to edge inside the frame by taking that inset back with a negative margin. Today the box pads in percents, so a
   head that ran to the edge would have to take back a percent of a different width.
7. **Every kind of origin gets the same box.** That covers a post, a card play's moment ("· as it landed"), an unmask,
   an announce, a tally and a reveal. They differ only in what is under the band.
8. **Engine only.** The change is in `engine/ui/spin/spin.css`, plus the comment on the head's strip rules in
   `engine/ui/cards/marks.css`. It adds no instance file and no token. Every theme follows from the tokens it already
   sets, so the engine still knows no instance (CLAUDE.md, "KayfaBB never knows which instance it runs"). The 3px
   double rule and the 2% padding go.

   A correction to what the owner was shown: item 8 there also said the head's `min-height` would go. It stays. That
   `min-height` makes a mark's tile hang a few pixels over the band, as it hangs over a post's date row, and the
   mockups the owner approved kept it.

## 3. What this does not change

- **The words.** "ORIGIN · Spun from …", "· as it landed", and the box's group name ("Origin") are as they were.
- **The board's spun row** ("↳ spun from …" in a board's index), the spin form and "Spun into" keep their look.
- **No state, Act, payload or response is added.** No way out is needed (CLAUDE.md, "No player is ever stuck").
  Nothing is computed from a private fact (CLAUDE.md, "A response never proves a private fact"): the band is a style
  over words the box already showed to every reader.
- **The glass's pieces on the box** (the mark tiles, Stick Around's ring in
  `instances/divided-world/ui/stick-around/hold.css`) keep their own colors.

## 4. Open

Nothing. Each question was answered by the owner.
