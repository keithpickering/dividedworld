Record, written 2026-11-20.

# The Lens's Who rows at scale: design

Decided with the owner in a design session on 2026-11-20, for #873. The plan is `docs/plans/2026-11-20-lens-who-rows-plan.md`.
It revises the Who row and the tab row of the Lens (`docs/plans/2026-10-31-marks-and-the-lens-design.md`, section 2). The
read behind Who (which plays a page holds, and paging a kind's older plays in) is #871's and is not decided here; this design
says where its pager will stand.

The Lens is the glass. Every word added here is plain and out of character.

## Why

The famous-post stress story (`engine/ui/cards/FamousPost.board.stories.tsx`, commit 84a12d3 on branch
`ccr-ec41863e-3bkmsa`) seeds one post with 85 plays of 16 kinds over three years. Measured with Who unfolded on Sugar Coat
(14 plays, one up now):

| | 1440 × 1120 | 390 × 844 |
|---|---|---|
| Each row's height | 162 to 200px | 184 to 215px |
| Lens body, visible | 783px | 300px |
| Lens body, scroll height | 2,764px | 3,043px |

Every row draws four action tiles (React, Spin thread, As it landed, Go to post) whether the play is up now or ended years
ago, and only the dates tell the two apart. On the thread page, Go to post links the page the reader is already on. The tab
row shows about three of the sixteen kinds at a time. Once #871 pages Who, a row's height multiplies by every page shown.

## What was decided

1. **Two groups (option A of three).** Who lists **Up now**, then **Ended · N**. Up-now rows keep today's order (a card whose
   rules stack lists them by layer, top first; any other card in billing order). Ended rows run newest first, by when they
   were played. A group's heading is drawn only where it says something: "Up now" only when an Ended group follows it, and
   "Ended · N" whenever ended rows exist, since a reader opening a kind with nothing up should still read that it is over. The
   foot of Ended is where #871's pager for older plays will stand. The owner weighed one list with ended rows dimmed (state
   told by style alone, and ended rows still interleaved with live ones in billing order) and ended plays behind a second
   fold (one more press to reach any history) and chose the groups.
2. **What "up now" means.** A play is up now when it is still in force on this screen: not ended by an admin (`reversed`),
   not untaken, not caught, not instant (a heart, an Unban: over when it lands), not a spent fall, and its `ends` not
   passed, unless its card keeps (`CardRules.keeps`: the level it left stays until an admin ends it). A live card back
   (face down, not sprung, not taken back, not over) is up now; a back gone by its own end is already dropped by
   `shownPlays`. A play whose `starts` is ahead is up now (it is set and waiting, and its note says so). One engine
   predicate says this (`inForce`, plan Task 1), beside `endable`, which it agrees with on every face-up play.
   *Amended 2026-11-22, the owner's answer to #984:* a card whose effect is still in force is up now, even after its trap
   has sprung: a sprung back whose lockout is still live is up now, and is ended when the lockout ends. The owner sees a
   trap's life as Set, then Up now, then Ended; for now the face-down and the sprung-and-live phases both stand under Up now.
3. **Up-now rows stay full.** They are today's row: ink bar, avatar, caster in capitals, when, the message, the card's note,
   "More reactions than the post", "Your play", the reactions with React, the action tiles, and the threads spun. There are
   few of them at once (a stack is bounded by its card's rules), and they are the rows a reader acts on.
4. **Ended rows are compact, and expand in place (option A of three).** Folded, an ended row is one disclosure button of one
   or two lines:
   - Line 1: the play's ink bar, the caster's avatar, the caster's name in the glass's display face (cut with an ellipsis
     where it runs out of room; the full name is in the expanded row), and the date the play was played (no time), with a
     chevron at the right.
   - Line 2, drawn only when it has something on it: the play's fate where the play did not simply run its time (the
     row's note for a play an admin ended, one that did not take, one a trap caught), else the caster's message cut to one
     line; and at its right the play's reaction totals, each reaction's glyph and count, from the tallies the post already
     reads (owner's choice over the one-line row and the two-line row without totals: a reader can spot which old plays
     landed).
     *Amended 2026-11-22, the owner's answer to #978:* the fate is shown for a play that did not simply run its time (ended
     by an admin, cut, did not take, caught, instant, spent, or a cutting play), not only the three named above.
   - Pressed, the row unfolds into today's full row under its line 1, which stays as the row's head: the note, the whole
     message, its reactions with React, Spin thread, As it landed, the admin's End where it applies, and the threads spun.
     Pressed again it folds. One ended row is open at a time: opening another folds the first. Changing tab folds it.
   The owner weighed a ⋯ menu on each row (a floating menu inside a floating panel, and a play's reactions never seen) and
   making every row compact, up-now rows included (the rows a reader acts on behind one more press), and chose this.
5. **Go to post only where it leads somewhere.** On the thread page every Lens is opened from the post, postbit or thread
   head it would link to, so Go to post is drawn there no more. It stays where it leads off the page: a spun thread's
   ORIGIN box and the board index's thread marks. The Lens keeps its `to` prop; the thread page's three strips pass `null`.
6. **The kinds menu (option A of three).** When the tab row overflows, the Lens's bar adds an **All N** button (N the
   number of tabs) between the tab row and the ×. Pressed, it swaps the Lens body for a grid of every kind in the marks'
   order, each a button with its name, its count of plays, and an up-now sign where any of its plays is up now (the sign
   has words for a screen reader: "1 up now"). Choosing one opens its tab, scrolls it into view, closes the grid and puts
   focus on the tab. Esc closes the grid first and the Lens only the next time, as a picker opened from the Lens does; the
   All button pressed again closes it too. The tabs keep scrolling and the arrow keys still walk them. The owner weighed
   ordering tabs with up-now kinds first (breaks the marks' order the tabs mirror) and leaving the tabs to their own issue.
7. **A moment's rows are not grouped.** In a spun thread's ORIGIN box, the rows in `then` are plays as they stood at the
   moment the box shows, all up then. They stay one list, drawn as today (state, held controls, Go to post).
8. **Reduced motion.** The chevron turns as the Who fold's sign does today, and instantly under Motion Off. Nothing else
   moves.

## Layers

All engine: `engine/ui/cards/Lens.tsx`, `engine/ui/cards/lens.css`, and `inForce` in `engine/ui/cards/plays.ts`. Every word
added ("Up now", "Ended", "All N", "N up now") is the engine's and names no instance. No interface is added: the rows read
what the card's view and the instance's reactions already hand the engine.

## The masks

Nothing added reads a private fact. The groups and the up-now sign are computed from a play's public state and dates. The
counts are counts of plays the page already shows. The reaction totals are the public tallies the post's own reaction list
draws, read through the same store. "Your play" is decided on the reader's screen from their own characters, as today. No
payload, read, Realtime event or timing is added.

## Ways out

No state a player, a character or a post can be put in is added. An expanded row folds by pressing it again, by opening
another, or by changing tab. The kinds grid closes by Esc, by the All button, or by choosing a kind.

## At a busy instance's scale

Rows draw only while Who is unfolded, as today. A compact row subscribes to its own play's tally, as the full row's
reactions do today, so a reaction to an old play wakes its own row and never the list. Only one row at a time draws the full
row's controls and its spun threads. With #871's pager, Ended holds one page at a time, and a page of compact rows is about
a third of the height of today's. The grid has one entry per kind on the post, bounded by the instance's card count.

## Open

- What #871 decides a page reads. This design draws whatever ended plays the page holds and leaves the pager's place at the
  foot of Ended.
- Whether the compact row's date should say the year only for plays from an earlier year. Built as the full date; the
  owner can ask for the shorter form once it is seen.
