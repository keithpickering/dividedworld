# The ORIGIN box wears the column head's band: plan

Record, written 2026-11-11. Carries out `docs/plans/2026-11-11-origin-band-design.md` (its sections are cited as §N),
task by task.

Every task is test first: the test named, its red run recorded, then the code, then the green run. No task touches SQL,
a deployed service or an instance file. Both tasks are engine. The look is carried by the `--kb-head-*`, `--kb-row-2`,
`--kb-frame` and `--kb-grid` tokens each theme already sets (`engine/ui/tokens.css`), so no interface is added. No
check (`check-*.mjs`) is added, so there are no poisons beyond each test's own red run.

## Task 1. The box's stylesheet (engine)

Model: haiku

**Layer:** engine. Files: `engine/ui/spin/spin.css`, `engine/ui/cards/marks.css` (a comment only), and a new test
`engine/ui/spin/band.test.tsx`. Read nothing else.

**Test first, `engine/ui/spin/band.test.tsx`.** It reads the CSS as text, comments stripped, the way
`engine/ui/tables.test.tsx` and `engine/ui/thread/brightInk.test.tsx` do. Copy their `css`/`strip` and `rules`
helpers into the file: `rules(text, selector)` returns the declaration blocks of every rule whose selector list
includes `selector`. Cases:
1. `.kb-origin` has `border: 1px solid var(--kb-frame)`, `background: var(--kb-row-2)` and
   `--kb-post-bg: var(--kb-row-2)`. It has no `double` anywhere in its blocks and no `%` in its `padding` (§2.2, §2.3
   item 6).
2. `.kb-origin-head` in `spin.css` has `background: var(--kb-head-bg)`, `color: var(--kb-head-fg)`,
   `text-shadow: var(--kb-head-shadow)`, `font-weight: bold` and `border-bottom: 1px solid var(--kb-grid)` (§2.1, §2.3
   items 1 and 5). It keeps `min-height: calc(var(--kb-meta-tile) - 0.4rem)` (§2.3 item 8).
3. The band takes back the box's inset: `.kb-origin` sets `--kb-origin-inset`, and `.kb-origin-head`'s `margin` holds
   `calc(-1 * var(--kb-origin-inset))` and its `padding` holds `var(--kb-origin-inset)` (§2.3 item 6).
4. The link: the blocks for `.kb-origin-head a`, `.kb-origin-head a:visited` and `.kb-origin-head a:hover` each set
   `color: var(--kb-head-fg)`. The hover block also sets a `text-decoration-thickness`. The block for
   `.kb-origin-head a:focus-visible` sets `outline-color: var(--kb-head-focus)`. No rule in `spin.css` names
   `.kb-origin-head :focus-visible` or `.kb-origin-head *:focus-visible`, which would reach the mark tiles (§2.3 items
   2 and 3).
5. Bright ink (§2.3 item 4): in `engine/ui/thread/thread.css`, no selector containing `data-kb-bright-ink` names
   `.kb-origin-head`. The band's own `color` and `text-shadow` are declared on `.kb-origin-head` itself (case 2 already
   holds this; repeat it here in the bright-ink case's name, so a later edit that moves them to `.kb-origin` fails
   under the bright-ink name).

Run `npx vitest run engine/ui/spin/band.test.tsx` and record the red run: cases 1 to 4 fail on today's `spin.css`.
Case 5 passes today and must keep passing.

**Code, `engine/ui/spin/spin.css`.** Replace the file's first two rules (`.kb-origin` and `.kb-origin-head`) with:

```css
/*
 * The ORIGIN box (docs/plans/2026-11-11-origin-band-design.md): a strip of another thread's table set into this post. Its head is the
 * column head's band, in the theme's own --kb-head-* tokens, edge to edge inside the theme's frame. The Act under it stands on the
 * second row's ground, so the words lifted in are told from the spinner's own: the opening post is seq 1, always on the first row's.
 * What inside paints the post's ground (a play's moment, cards/moment.css) paints the box's.
 */
.kb-origin {
  --kb-origin-inset: 0.75em;
  --kb-post-bg: var(--kb-row-2);
  border: 1px solid var(--kb-frame);
  background: var(--kb-row-2);
  padding: 0 var(--kb-origin-inset) 0.4em;
  margin: 0 0 0.6em;
  overflow-wrap: anywhere;
}

/*
 * The band. It sets its own color and shadow, so the bright ink's reset of the box (thread.css) never reaches it. The rule under it is
 * a border, which forced colors keep and paint in a system color where they drop the gradient, so the band still reads as a head.
 */
.kb-origin-head {
  margin: 0 calc(-1 * var(--kb-origin-inset)) 0.4em;
  padding: 0.35em var(--kb-origin-inset);
  background: var(--kb-head-bg);
  color: var(--kb-head-fg);
  text-shadow: var(--kb-head-shadow);
  border-bottom: 1px solid var(--kb-grid);
  font-family: var(--kb-font-mono);
  font-weight: bold;
  /* As the date bar's: the strip is centered on the head, and a tile hangs a few pixels past it (cards/marks.css). */
  box-sizing: border-box;
  min-height: calc(var(--kb-meta-tile) - 0.4rem);
}

/*
 * The link on the band is the band's ink, visited or not, and keeps it under the pointer with a heavier underline: --kb-link-hover is
 * held only against the page and the rows (contrast.ts), never the band. Its ring is the column head's. The mark tiles keep their own.
 */
.kb-origin-head a,
.kb-origin-head a:visited {
  color: var(--kb-head-fg);
}

.kb-origin-head a:hover {
  color: var(--kb-head-fg);
  text-decoration-thickness: 2px;
}

.kb-origin-head a:focus-visible {
  outline-color: var(--kb-head-focus);
}
```

Leave the rest of `spin.css` (the spin form, "Spun into", the ghost mark) as it is.

**Code, `engine/ui/cards/marks.css`.** The three `.kb-origin-head` rules stay. Change the comment above them to: "The
ORIGIN box's band carries the strip the same way (spin/spin.css): a cell of the head with the strip's width, and the
head's words wrap in the room left."

**`Origin.tsx`** is not changed. Its head's comment about the strip still holds.

Run the new test green, then `npx vitest run engine/ui/thread/brightInk.test.tsx engine/ui/spin` and
`npx vitest run engine/ui/contrast.test.tsx`, all green. Record each run.

## Task 2. The band in a browser (engine, end to end)

Model: sonnet

**Layer:** engine, tested through the web app's end-to-end build. New file: `e2e/origin-band.spec.ts`. Read
`e2e/chrome-button.spec.ts` (how a thread is opened and how `forcedColors` is used), `e2e/a11y.spec.ts`, near "a
thread, a picker and a spin form have none" (how a spin form is opened), and `engine/ui/spin/SpinForm.tsx` (the
form's fields: "Thread title", "Your opening post (optional)", and the primary submit button).

A shared step, `spunThread(page)`: open the General board and the thread "Who keeps reacting with a thumbs up?" as
`a11y.spec.ts` does (the fixture thread whose post 1 that spec already spins from), press post 1's Spin thread, fill "Thread title" with "Band check" and the opening post with "Carrying on over here.", press
the form's primary button, and wait for the group named "Origin". Spinning lands on the new thread (`went` in
`SpinForm.tsx`).

Cases, at a 1280 by 900 viewport, under the house theme:
1. **The band is the column head's.** The computed `background-image` of `.kb-origin-head` equals that of the
   thread's own `.kb-acts-head > span`, and it is a `linear-gradient`. Its `color` equals the `.kb-acts-head > span`'s.
2. **It runs edge to edge in the frame.** The head's left and right edges are within 0.5px of the box's inner edges
   (the box's border box minus its 1px border). The box's computed `border-top-style` is `solid` and its width `1px`.
3. **The body is on the second row's ground, the post on the first's.** The box's `background-color` differs from the
   opening post's `.kb-act-main` `background-color`.
4. **The link keeps the band's ink.** The head's link (`.kb-origin-head a`) has the head's `color`, and still does after
   `hover()`. Its `text-decoration-thickness` grows on hover.
5. **The link's ring is the column head's.** Focus the link with the keyboard (Tab from the box, which takes focus
   when the thread is spun). Its computed `outline-color` is not the page's `--kb-focus` color read from the root. This
   case is only meaningful where the two differ: assert first that they differ under the house theme, so the case
   cannot pass vacuously.

Under `forcedColors: 'active'` (a `test.describe` with `test.use({ forcedColors: 'active' })`, as in
`chrome-button.spec.ts`):
6. **The band is still a head.** The head's computed `border-bottom-style` is `solid` and its width `1px`, and the
   box's `border-top-width` is `1px`.

Run `npm run test:e2e -- e2e/origin-band.spec.ts --trace off` against today's `spin.css` first (stash Task 1's CSS or
run it before Task 1 lands), and record the red run: cases 1 to 4 and 6 fail. Then run it green with Task 1 in place.

**A screenshot for the review.** Write none into the repository. Take one per theme of the spun thread's opening
post with the Storybook `Spin/Spin` stories, as `docs/research/2026-11-11-origin-band/` was made. Attach them to the
PR's description, beside `03-band-in-context.png`, so the reviewer and the owner can compare the build with the
approved mockup.

## Review focus

- The band's look in each of the five themes, light and dark, against `03-band-in-context.png` and
  `04-band-phone.png`. Fan Site's layered head and Hot Rod's tall gradient are the two the mockups say look different
  at the band's height. A theme that reads worse than the mockup is a finding, not a follow-up.
- A card play's moment in the box (`02-three-heads-card-play.png`): the moment's list now paints `--kb-post-bg`, which
  the box sets to `--kb-row-2`. Check that nothing inside the moment still shows a row-1 strip.
- Stick Around's ring in the box (`instances/divided-world/ui/stick-around/hold.css`, `.kb-origin .kb-hold`) is drawn
  on `--kb-glass-ground`. Check that it still reads on a row-2 body, and that the box's new 1px frame does not clip
  it.
- The negative margin that takes the inset back: at 200% text and on the phone, the band must neither overflow the
  frame nor leave a gap at its sides.
- A mark's tile on the band: the head keeps the date row's `min-height`, so the tile should hang a few pixels past the
  band as on a post. The end-to-end fixture's spun post carries no mark, so only the review screenshot (the `Spin/Spin`
  story spun from a card play) shows it.
- No other rule in the engine styles `.kb-origin` or `.kb-origin-head` in a way that now fights the band: `grep` the
  engine and the instance for both classes.
