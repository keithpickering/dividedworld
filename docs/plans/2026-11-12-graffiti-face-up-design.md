# Graffiti face up: design

Record, written 2026-11-12. A design session with the owner, started from a screenshot: with Graffiti armed, each of the
owner's own posts showed two ghost marks that looked the same. It amends `docs/plans/2026-11-11-graffiti-design.md`
(sections 6 and 8) and the card mechanic's armed state (`docs/plans/2026-11-01-card-mechanic-design.md`).

## 0. What was found

- **Two ghosts.** A card played on the post itself (`CardUi.Compose`) opens no play form, so the form's "Play it now / Set
  face down" choice had nowhere to be asked. `GhostMark` (`engine/ui/cards/PlayActions.tsx`) offers one ghost for each
  choice instead. Only a screen reader's name ("Play Graffiti on post 4", "Set Graffiti face down on post 4") and an
  unstyled `data-kb-compose` tell the two apart. A sighted player sees two identical dashed "+" tiles.
- **Still armed while drawing.** While draw mode is open on a post, the hand's tag still says "Armed · pick a post" and
  every other post still shows its ghost. The post has already been picked. A card with a play form never shows this,
  because its form covers the screen.
- **Draw mode out of view.** On a wide screen the toolbar is drawn under the post. On a long post the owner pressed the
  ghost, saw the can cursor and nothing else, and the toolbar was below the fold with nothing scrolling to it.

The owner first asked for a play form like every other card's, then withdrew that once they saw the cast lands with
its first tag drawn: the tag lands at once, which is more of an event than a bare wall a player draws on later. "With
this logic it makes sense as built." Draw mode stays the play's form.

## 1. Surface cards are cast face up only

**Decided** (the owner, who raised it: "every move can be a trap" has not worked well for highly customized effects).
A surface card (`CardRules.surface`) is never set face down. `faceUpOnly` (`engine/rules/cards.ts`) gains `surface`
beside `writes`, `needsMessage`, `draws` and `drive`. `decideSet` then refuses the set in the sentence it already uses
for the others, the play form's Set switch is left out, and the server's `face_down_never_writes` trigger refuses a
`face_down` row for a surface card. With no set to offer, the ghost is one ghost again, as for every other card.

What a face-down Graffiti bought: a drawing nobody sees until someone quotes the post, which then lands on the quoting
post, stretched to a box the setter never drew for. The surprise is a trap's payoff, and a tag drawn blind for a box
nobody knows yet is a weak one. What it cost: the second ghost, the compose's `set` mode, `set_surface_card`, the
private `face_down_draws` table, and the draft branch of the spring.

Weighed:

- **Keep face down and fix the ghosts** (rejected): one ghost and the choice asked somewhere else, keeping all the
  machinery for a weak trap.
- **Return live backs to their setters' hands** (rejected): one change removes everything, but it ends plays already
  made and drops drafts.

**Backs already set ride out** (the owner chose the recommendation). A Graffiti set face down before this change keeps
the life it was set with: it springs as built (`lay_sprung` writes its draft into the wall), is taken back as built, or
runs out. No new back can be set, so `set_surface_card` is dropped. `face_down_draws` and the spring's draft branch stay
until no back can hold a draft. A back's life is bounded (`face_down.ends_at`), so a later migration drops them once the
longest set life has passed since this one. That cleanup is filed as an issue when this change merges. It is a
separate concern: it removes code no state reaches. It is not the proper version of this change.

## 2. Draw mode comes into view

**Decided** (the owner chose the recommendation). The toolbar's dock is fixed at every width, not only under 720px. It
sits at the window's foot just above the HUD (`--kb-hud-measured`), as it does on a phone today, and the page keeps its
foot clear of it (`--kb-graffiti-dock-h`). However long the post, the toolbar is in view the moment draw mode opens. On
a wide screen it is as wide as the thread's column, not the window, so it reads as belonging to the posts.

When a compose opens, the engine brings the post's body into view if its top is not on screen. The scroll is instant
under reduced motion and smooth otherwise. The card's toolbar keeps focus on its first control (`focusOnMount`), and the
status line says draw mode is open, as it does now. This applies to every draw mode, the first tag and a later one
through the Draw tile, so the toolbar is in one place every time.

Weighed: scrolling the page to a toolbar kept under the post (rejected: the post's top, where the drawing starts, then
leaves the screen on a long post); scrolling only to the post's top (rejected: the toolbar can still be below the fold).

**The world.** The dock is the glass, as the Graffiti design set it. Nothing about its look changes but where it sits.

## 3. Playing: the armed card's post is picked

**Decided** (the owner chose the recommendation). Once a compose opens on a post, the armed card is **playing** there:

- The hand's tag reads **"Playing · post #5"** in place of "Armed · pick a post": the fan's tag, the peek's tag above the
  HUD (`Hud.tsx`) and, on the Phone board, the hand button ("Playing · Graffiti, press to put it back"). Each
  screen-reader name follows the same words (", playing on post 5").
- **Every other ghost hides**: the other posts' ghosts and any reach ghost (a postbit's, a thread head's, a banner's).
  The playing post's own ghost stays, pressed, as it is now, and pressing it again does nothing new.
- **Ways out**, as now, each asking first when the drawing holds work: Esc and the toolbar's Cancel end the compose and
  leave the card **armed**, with the ghosts back and focus on the post's ghost, the same as closing any card's play form
  leaves it armed. Pressing the playing card in the hand, or the Phone board's hand button, puts it back. Landing the
  play clears it.

This is the engine's state (`engine/ui/cards/play.tsx` holds `compose` already). It names no card, so it holds for any
future `Compose` card.

## 4. The rules this answers to

- **No player is ever stuck.** Playing names its ways out: Esc, Cancel, the hand, and the play landing. A Graffiti back
  set before this change keeps the ways out it had (it springs, is taken back, or runs out).
- **A response never proves a private fact.** Nothing added is computed from who owns anything: the hiding of ghosts
  and the "Playing" tag are on the player's own screen from their own state. A refused set of a surface card says the
  same sentence for anyone.
- **The layers.** The face-up rule, the playing state and the scroll are the engine's and name no card. The dock's
  place is Divided World's CSS. `tools/check-engine-boundary.mjs` holds.
- **Append-only.** Nothing edits an Act. The migration redefines a trigger function and drops a function.
- **Record every schema change as a migration.** One migration, with its SQL test.

## 5. Open

- **When to drop `face_down_draws`** and the spring's draft branch: set by the longest set life the instance allows, in
  the follow-up issue filed at merge.
- **A future card that is played on the post and may be set face down** has no ghost for it after this change: the
  compose's `set` mode is removed (section 1). That card's design brings the choice back, in a form the player can
  see, and never as a second identical ghost.
