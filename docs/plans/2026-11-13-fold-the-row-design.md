Record, written 2026-11-13.

# Below the Fold folds the whole row: design

Decided with the owner in a design session on 2026-11-13. The plan is `docs/plans/2026-11-13-fold-the-row-plan.md`. It
revises how Below the Fold is drawn (`docs/plans/2026-11-11-below-the-fold-plan.md`, Task 3); the card's rules, price and
rarity are unchanged (`docs/plans/2026-11-11-card-notes-design.md`, "Below the Fold").

## Why

Below the Fold is drawn today as a bar inside the post's words cell. The postbit, the date line and the actions stay out,
so the post reads as a post with a spoiler in it, not as a post folded away. The owner asked for the whole row
(postbit and all) to collapse behind a bar in the theme's header styling, and for the show and hide to move like a special
effect, so it never reads as a moderation element.

## What was decided

1. **The whole row folds.** A post wearing a live fold is drawn as one full-width bar. Its postbit, date line, words,
   actions and panels are hidden but stay mounted, so an open editor, an effect's state and Whoops! ink all survive a
   press.
2. **The bar's content (option A of three).** The author's square-cropped avatar, the author's name, the post's
   number (`#12`), the post's card marks, then "Show post" and a chevron on the right. The owner weighed B (two lines,
   with the time; taller) and C (avatar, name and chevron only; the action reads only as an arrow) and chose A.
3. **The theme's header look.** The bar is drawn in the tokens a table header uses: `--kb-head-bg`, `--kb-head-fg`,
   `--kb-head-shadow`, `--kb-head-focus`, bold mono at the small size (`.kb-table th`, engine/ui/base.css). On Divided
   World's Silver house that is the grey gradient with white Courier, and every theme gets its own.
4. **The bar stays when the post is open**, as the row's header, reading "Hide post" with the chevron turned. The
   owner weighed a bar that goes away (re-folding from the Lens alone) and chose the classic accordion: the press
   that folds it again stays where it was.
5. **The marks live on the bar** for as long as the post wears a fold, open or folded, and not on the date line. A
   reader sees what else is on a folded post (a splat waiting under the fold) and opens its Lens without unfolding,
   and a press never moves the marks between parents (which would remount them and close an open Lens).
6. **It unfolds like a newspaper.** On a press to open, the row swings down from the bar's lower edge (the crease) in
   3D, from nearly edge-on to flat, shaded while it is angled away and settling with a small spring, while the space
   it takes grows from nothing. A press to fold swings it back up into the bar, faster and without the spring. The
   owner weighed accordion pleats (the row stretched out of the bar with crease shadows; the text squashes as it moves)
   and a plain height-and-fade ease ("what any accordion does") and chose the newspaper: the card's name made
   literal. It is built with `motion`, already the engine's.
7. **Reduced motion snaps.** Under the player's Motion Off, or the device's reduced motion where the player follows it
   (`currentFeel`, engine/ui/glass/motion.ts), the row opens and folds at once. The press costs the same, as the rule
   on accessible paths asks of Stick Around's snap-back.
8. **Where a post has no row, today's bar stays.** The ORIGIN box of a spun thread, the front door, a play's moment and
   History draw a post without its article, so there the card's effect draws its own bar inside the words, as today,
   restyled to match: the header tokens and a chevron on the right.

## Where it lives

The row is the engine's: its article, its grid and its marks are the engine's anatomy, and a card that folds a row
names that it does through an interface.

- **Engine.** `CardUi.foldsRow` (a card's live play on a post folds the post's row) and `EffectProps.fold` (the row's
  state and its toggle, given to that card's effect where a row exists, absent elsewhere). The engine owns the fold's
  state (a reader's own, in the page's memory: nothing saved, sent or counted), draws the bar, places the marks, hides
  the cells, moves focus and runs the motion. To move the row as one sheet, the post's cells move into an inner grid
  (`.kb-act-grid`) inside every `<article class="kb-act">`, folded or not, so a fold that lands live never remounts a
  post's cells.
- **Divided World.** Below the Fold sets `foldsRow: true`. Its effect, given `fold`, draws its children and nothing else,
  and gives the Lens the row's state, with the same "Show post" or "Hide post" press bound to `fold.toggle`. Without
  `fold` it draws today's bar, restyled.
- **Weighed and set aside:** a card-drawn row component (`CardUi.Row`) that would hand an instance the engine's grid to
  hide and animate. The bar's anatomy (marks, focus, mounted cells) is the post's, and a second card that folds a row
  would want the same; the theme's tokens give each instance its look. CSS in the instance reaching into `.kb-act`
  with `:has()` was set aside first: it would make Divided World read the engine's DOM.

## Rules held

- **No player is ever stuck.** The folded state's way out is the bar's press (and the Lens's), on the screen where it
  shows, as today. A press during the motion reverses it from where it is; nothing waits on the motion to finish.
- **A response never proves a private fact.** The bar shows the name and avatar the postbit would show for the
  character the screen draws: a veiled post's stand-in on a veiled post. The fold's state is never saved or sent. No
  payload, event or timing is added.
- **An accessible path costs what the obstacle costs.** The bar is a real button with `aria-expanded`, named "Show post
  #12 by Spritey" (its visible words lead the name), with a 44px target on a coarse pointer. The press is the
  challenge, the same for everyone; under reduced motion only the movement goes.
- **KayfaBB never knows which instance it runs.** The engine knows a flag and a prop, never the card's name.
- **Append-only.** Nothing about an Act changes. Plays of Below the Fold already in a database draw as row folds
  without a migration.

## Open

- **Timings and the spring** are the build's to tune against the mock (about 560 ms to open, 380 ms to fold) and the
  owner's to adjust on the stories.
- **Stick Around on a folded post** lifts only once the post is opened (its in-view check sees a hidden post as out of
  view). Settled as right ("below the fold" is not on screen), and named for the reviewer.
