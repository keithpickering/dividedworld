# Graffiti: design

Record, written 2026-11-11. A design session with the owner for Part 7 of `docs/plans/2026-11-11-card-notes-design.md`
(its section 2, "Graffiti", which held the card and left it "a design of its own"). The owner's note, as that design
quotes it:

> Allow players to draw over a post with multiple ink colors, up to a maximum ink amount. The author can wash ink
> away, but it can always be scribbled back. Readers can temporarily scrub anytime (similar to Whoops)

The card notes design already settled the card's type, flavor and rarity: a Move, Pepperoni, rare. Each question below
was put to the owner one at a time, with alternatives and a recommendation. The styles of the drawing tool were put as
a mockup (`docs/research/2026-11-11-graffiti/01-tool-styles.html`). The plan is `docs/plans/2026-11-11-graffiti-plan.md`.

## 0. Where it starts

- **Whoops! is the machinery it stands on** (`docs/plans/2026-11-06-whoops-refinements-design.md`). That covers strokes
  kept in shares of the post body's box, a brush's `width` and `aspect`, the layer model as geometry (`LayerInk`), a
  reader's scrub on their own screen, the author's saved washes, the touch rules (a quick vertical swipe scrolls, a
  hold or a sideways swipe wipes), the suds and the sponge cursor, and Hold to scrub at a hand's pace.
- **The one large difference**, in the card notes design's words: "anyone draws, so what is drawn is player content and
  not a seeded splat." A Whoops! layer is one play's seed plus one author's saved strokes, kept in a state row that each
  save overwrites (`effect_state`). That row has one writer, the post's author. A wall has many writers, and each of
  them is accountable for what they drew.
- **A rendered scene already exists** for the card (`docs/research/2026-11-11-card-renders/graffiti.py`,
  `graffiti.png`): a post on a brick wall under three colors of scribble, and the cans.

## 1. A wall, for good

**Decided** (the owner chose the recommendation for who draws, and set the rest in their own words). Playing Graffiti on
a post makes the post a **wall**:

- **Any character may draw on a wall, at any time.** A drawing is a batch of strokes added in one go, and each one is an
  Act by the character that drew it. The caster's first drawing lands with the play (section 6).
- **A wall never closes.** The owner: "I'm thinking of it like a real wall: anyone draws, the owner washes what they
  want to at any time. No expiry, the way out is washing. The shared ink limit between drawers is the nerf."
- **The author washes by hand, at any time** (section 4), and a wash frees its coverage at once.
- **Anyone may scribble back.** Washed ink goes back to the wall's budget, in full (the owner chose the recommendation).
  The limit caps how much is up at once, never how much is ever drawn. A wall is a tug of war that never has to end.

Weighed:
- **The caster alone draws** (rejected). It's simpler and close to Whoops!, but nobody else in the room can join in.
- **Only a character who plays its own Graffiti draws** (rejected). Every drawing would cost a card, and "scribbled back"
  would cost one each time.
- **A wall open for 24 hours or a week, then closed** (rejected). The author's wash would be final once the wall
  closed. The owner chose the real wall.
- **Washed ink never returns, or returns after a while** (rejected). These give a stronger nerf and a final way out,
  but "scribbled back" would last only until the ink ran dry.

**Who may draw.** Any character the player can play as, the author's own other masks included. Refusing a drawer
because the same player owns the post would prove who owns it (CLAUDE.md, "A response never proves a private fact").
A drawing is refused where a post would be: from a banned character (`not_banned`), or from a character barred from
posting on the board (`not_barred`). The refusal uses the same words those checks already give, and it is the same for
everyone who meets it. The board has no locked threads, so there is no lock to check.

## 2. The ink budget: coverage at once

**Decided** (the owner chose the recommendation, and its number): a wall holds at most **40%** of the post covered at
once. One drawing may use whatever coverage is free.

- **What is counted.** Coverage is counted on a fixed grid of **100 by 100 cells in shares of the post body's box**: a
  cell is a hundredth of the box across and a hundredth down. A cell is covered when a drawn stroke's core covers its
  center and no later wash has taken it. Because the grid is in shares, and strokes are kept in shares with the
  drawer's `aspect` (as Whoops!'s are), the count is the same on every screen, and the server computes it from the
  strokes alone.
- **Drawing over ink costs nothing.** Layering colors and adding detail inside a tag is free. A wash uncovers cells
  and frees them at once.
- **A drawing that would take the wall past its limit is refused before it is written**, in plain words that carry the
  wall's own figure: "This wall is 31% covered, and its limit is 40%. Your tag would take it to 46%. Make it smaller,
  or wait for a wash." The figure is the wall's, so it is the same for everyone (section 9).
- **The limit is an instance setting**, `graffiti.limit`, in whole percent (Divided World: 40). It is one of the card's
  `screenReads`, so the meter and the refusal read the same number.
- **Coverage counts the core only.** The overspray and the speckle (section 8) are drawn and never counted.

Weighed:
- **Paint spent** (rejected): every stroke spends paint by its length times its width, even over ink, and a wash
  refunds what it took. It's closer to a real can, but detail work costs paint, and the refund needs the same grid
  anyway.
- **Strokes and points** (rejected): a fat cap and a hairline would cost the same.
- **A cap per drawing of 15%** (rejected): first come, first served is wall culture, and the author's wash makes room
  for the next tagger.
- **60%** (rejected): readers would lean on the scrub more.

## 3. Drawings and washes are Acts

**Decided** (from the card notes design, and confirmed here). Each batch of strokes is an Act:

- **A drawing** is an Act by the character that drew it, holding its strokes (Whoops!'s stroke shape, with an ink
  `color` from the cans and a `cap`).
- **A wash** is an Act by the post's character, holding the author's sponge strokes since their last pause (section 4).

So the log is true about every one of them (CLAUDE.md, "Append-only"; "The fiction may lie; the log never does"), and
real moderation can reach each drawing as it reaches a post:

- **Report to admins** (`docs/plans/2026-11-02-conduct-design.md`, sections 1 and 2) is designed and not yet built.
  Every version of a post is reportable there, and a hide covers a version. When it is built, a drawing is reportable
  as a version is, and a hide covers a drawing: the drawing leaves the wall for everyone, its Act stays, and its cells
  are freed as a wash frees them. The conduct plan gains that line when it is written. Until then, an admin's **End this
  card** takes the whole wall off (section 4).
- **The board's in-game Report** (the Mod Bots design, section 7) stays on posts and spins. A Mod Bot reads words, and a
  drawing has none, so offering it on a drawing would be a report nobody can judge.

**What a wall shows now is computed from its Acts.** The wall is drawn by replaying its drawings and washes in order.
Since a wall never closes, its Acts are unbounded. So a row of the wall's own (CLAUDE.md, "Append-only": "a state that
changes often during play lives in a row of its own that the Act it belongs to points at") holds what the next write
and the next read need:

- the covered cells now;
- for each cell, the drawing that last inked it;
- the wall's **live list**, the Acts a reader needs to draw it now, in order.

  - A drawing leaves the live list once it no longer owns any cell, because washes and later drawings have taken
    every cell it inked.
  - A wash leaves the live list once no drawing older than it in the list owns a cell under it.

  The row is written in the same transaction as each Act, under a lock on the wall, so two drawers can never both
  squeeze under the limit. It is derived from the Acts alone and can be rebuilt from them, so an instance exported and
  imported again computes the same wall ("Portable by construction").

**At a busy instance's scale** (CLAUDE.md, "Weigh a design at the scale of a busy instance"), a read of a wall costs its
live list and never its history. A thread's page carries only each wall's coverage and its live list's ids, and a
wall's strokes are read only when the post comes near the viewport, as Whoops!'s canvases are drawn. A drawing is held
to 64 KiB, and a wall holds at most 48 live drawings. A drawing that would make a 49th is refused in plain words
("This wall holds 48 tags. Paint over one, or wait for a wash"). A wash is never refused, for the limit or for the
count. The live list is bounded by the wall's cells (at most 10,000 owners, and in practice
the handful of drawings a 40% wall holds). Each write costs one lock and a pass over the 10,000 cells, the same on a
wall of ten Acts or ten thousand.

**What it gives up.** A drawing that has left the live list is no longer drawn, even where a sliver smaller than a cell
still showed. That sliver is less than a hundredth of the box. The Lens still lists every drawing, and the log still
names every Act.

## 4. The author washes by hand

**Decided** (the owner chose the recommendation): the author washes with Whoops!'s sponge, by hand. The washes are
saved for everyone and free their coverage at once.

- **A wash batch** is the author's sponge strokes, sent once the author has paused for 1.5 seconds or left the post,
  as Whoops!'s author saves are debounced today. Each batch is one wash Act. A refusal is shown and not retried.
- **What it washes.** A sponge stroke takes the top ink where it starts, as on Whoops! (`topLayer`). Since a wall sits
  under every splat (section 5), the author washes a splat away first and then the graffiti under it.
- **The accessible path** is Hold to scrub, at Whoops!'s pace: 0.55 of the box's width a second across, in the body's
  rows (CLAUDE.md, "An accessible path costs what the obstacle costs"). For the author it saves as any wash does.
- **There is no button that clears the wall.** The owner chose the hand over a "wash this drawing" control on each
  drawing (the controls would crowd the ink) and over a one-click wash of the whole wall (the wall would rarely last
  while its author was active).

**The way out** (CLAUDE.md, "No player is ever stuck"). A wall is a state a post is put in, and it never closes, so its
way out is named here, for each person:

- **For the author:** the wash, at any time, taking effect for everyone the moment it is saved. A drawer may tag the
  wall again. The author may wash again. Nothing the drawers do can stop a wash or make it cost more.
- **For a reader:** the scrub, on their own screen, at any time (section 7). The quick vertical swipe always scrolls past
  ink.
- **For anyone:** an admin's "End this card" ends the wall for good. The drawings stay in the log, and the post is drawn
  without them.

## 5. Under any splat

**Decided** (the owner, overturning the recommendation): a post holds **one wall**, and it is always drawn **under every
Whoops! splat**, whichever was played first. The owner: "a splat (looks like a big paint bucket was thrown at the
wall) rendering over graffiti (spray paint/markers drawn on the wall) … The splat going on top makes physical sense …
The main risk here is somebody trolling by covering a mural in paint which then only the author can wash permanently,
which is just expected heel gameplay."

- **A drawer tags the post, never the splat.** Strokes drawn where a splat lies go onto the wall under it. They show where
  the splat is scrubbed or washed.
- **A second Graffiti on a wall is refused** in plain words: "This post is already a wall. Draw on it instead."
- **Other cards** nest as the engine nests them today. The wall is a layer over the post's words, and Below the Fold,
  Stick Around and the rest wrap the post with its wall as they wrap it with a splat.

Weighed: each play adding to the wall's limit, up to three (rejected: more plays, and a wall the author can barely read
past); disabling the combination with Whoops! (the owner: "doesn't seem necessary").

## 6. Playing it

- **Face up:** an armed Graffiti offers "Play Graffiti here" on a post. That opens draw mode on the post (section 8)
  with the cans, and "Tag it" lands the play with the drawing as its first tag. Cancel leaves the card in the hand. The
  drawing is the play's configuration, checked as any drawing is, and limited to the wall's 40%.
- **Face down:** set on one's own post, as any Move can be. Draw mode opens on the setter's own post, with the same
  tools, and "Set it" keeps the drawing face down with the card. A face-down card's configuration is private and held
  to 4 KB, and a drawing can be far larger, so the drawing is kept in a private row beside the face-down card (as
  `face_down` keeps the card), read by no player, and written into the wall as its first drawing when it springs. When someone quotes the post,
  the wall opens on the quoting post with that drawing, which lands where its shares put it. The quoting post's box may
  be a different shape, so the drawing stretches to it, as any Whoops! stroke does (the refinements design, section 1).
  A wall already on the quoting post means the card cannot land, and it waits as any such back does.
- **No play price.** The card sells at the Vending Machine's rare price. Drawing on an open wall costs nothing.

## 7. Readers scrub

**Decided** (from the card notes design): a reader scrubs a wall on their own screen, as on Whoops!, at the same pace and
with the same touch rules. A reader's scrub is never saved and lasts for their visit to the page. A press on ink scrubs
the top ink where it starts. On a wall under a splat, that is the splat first.

## 8. The screen

**The world** (`docs/plans/2026-10-29-two-worlds-design.md`). The ink is on a post, so it is the card's art on the board.
The drawing tool is the game's own interface, so it is the glass, like the Lens, the hand and the play form. The cans are
the card's art inside the glass, as Whoops!'s sponge and suds are art inside the board.

**Decided** (the owner chose D in the mockup, `docs/research/2026-11-11-graffiti/01-tool-styles.html`): **glass with
drawn cans**.

- **The Draw button.** A glass tile on a wall, at the body's top right, lifted over the ink (`data-kb-over-ink`, as the
  reactions row is). It holds a small drawn can in the color the reader last picked, and the word **Draw**. On a post
  with no wall there is no button. A wall is opened only by the card.
- **Draw mode.** The toolbar rises from the foot of the screen on a phone and sits under the post on a wider screen,
  in the glass's panel, with the cyan seam on its edge. From the top:
  - **The meter:** the can's name at the left ("Cyan"), and "Wall 31% of 40%" at the right, over a thin skewed bar.
    While drawing, the bar shows the wall with this drawing added.
  - **The cans:** fourteen drawn spray cans, the selected one lifted and lit. The palette is the instance's
    (section 10): black, white, red, orange, yellow, lime, green, teal, cyan, blue, purple, pink, brown, silver.
  - **The caps:** **Skinny**, **Stock** and **Fat**, the names of real spray caps (the owner: the pen names "imply
    pens"). Then **Undo**, which takes back this drawing's last stroke.
  - **Cancel** and **Tag it**. Tag it is the glass's ready yellow, and it is disabled while the drawing is empty or
    over the limit, with the reason under it in plain words.
- **While draw mode is open,** a press on the post draws and never scrubs. The touch rules hold: a quick vertical swipe
  scrolls, a hold or a sideways swipe draws, and a second finger is the page's. The strokes stay on this screen until
  Tag it, and leaving the page asks first if there is an untagged drawing.
- **The cursor.** Over the wall in draw mode, a mouse shows a drawn can in the selected color, tilted, with a puff of
  spray while pressed, in the sponge's style (Whoops!'s `cursor.ts`). For the author outside draw mode, the sponge is
  shown as it is on Whoops!.
- **The ink is spray paint** (the owner chose the recommendation). Each stroke has a solid core, a soft overspray edge
  and a scatter of speckles. A Skinny cap is nearly a clean line, a Fat cap sprays wide and soft, and a slow stroke
  pools a little darker where its points crowd. The speckles are seeded from the stroke's own points, so every screen
  draws the same tag. The core's width is the stroke's `width`, and it alone is counted (section 2).
- **Who drew what is shown only in the Lens** (the owner chose this over a "Tagged by" line under the post and over hover
  credits). The wall's Lens entry lists the play, then each drawing and wash in the live list, oldest first: who, when,
  the can colors used, and how much of the wall each drawing still holds ("Gloomba, 2:20 pm, pink and lime, 6% of the
  wall"). Drawings that have left the live list are counted in one line ("and 14 older tags, washed or painted over").
  The log names every one.
- **Reduced motion** keeps the wall and the spray, drops the puff and the suds, and never changes what is drawn or
  counted.

Weighed, in the mockup:
- **A. The '03 forum** (rejected): oekaki-applet chrome. It's a pure tribute, but the only game tool drawn as board
  chrome, with 11px buttons on a phone.
- **B. The glass with flat chips** (rejected): consistent, but the fun of the cans is lost.
- **C. Skeuomorphic** (rejected): a metal tray and glossy keys, the most toy-like, and a third look nothing else uses.

Also weighed for entering draw mode:
- **A Scrub / Draw toggle with every stroke saved** (rejected): one Act per stroke would flood the log and the Lens.
- **A full-screen drawing screen** (rejected): it loses sight of the thread.

## 9. Stencils, for Mod Bots and for everyone

**Decided** (the owner chose the recommendation). A model's free output is never read as a choice (CLAUDE.md, "The
System acts"), so a Mod Bot never freehands. The instance holds a fixed list of **stencils**: drawings made by hand and
committed as strokes, such as a mustache, horns, a crown, "KILROY WAS HERE", a big X and a smiley. A Mod Bot playing
Graffiti, or drawing on an open wall, picks:
- a stencil from the list;
- a can from the palette;
- a spot from a 3 by 3 grid over the body.

The code places the stencil's strokes there, and the drawing is checked against the wall's limit like anyone's. A
refusal is the bot's, as any of its refused plays is. Stencils are instance content.

**Players get the stencils too** (the owner chose the recommendation). The toolbar has a **Stencils** tab beside the
cans: pick a stencil, a can and a spot on the 3 by 3 grid, by keyboard or by touch, and Tag it. It is the same coverage
check and the same Act as a freehand drawing, and the Act names the stencil. That is the accessible path for a player
with no pointer (section 11): it costs about what drawing a small tag costs. Freehand is still where the art is.

Weighed: stencils offered only when a drawing is started from the keyboard (fragile to detect, and it hides a fun
shortcut); no stencils for players (a card a player without a pointer could not play).

## 10. Scoring

**Decided** (the owner chose the recommendation): **only the play's Act takes reactions** and scores its caster by class,
as a Pepperoni Move does (the room decides). Drawings and washes take no reactions and earn nothing. Drawing is free and
cannot be farmed, and a post keeps one reactions row. A great mural still pays: the room reacts to the play, and to the
post.

Weighed: drawings reacted to like posts (every wall becomes a second way to earn, and each drawing needs a reactions
control on the ink); reactions that pay nothing (a reaction that does nothing, which none of the game's reactions are).

## 11. The rules

- **Masks** (CLAUDE.md, "A response never proves a private fact"). Every response this adds is computed from public
  facts: the wall's Acts, its cells and its limit, the drawer's ban and the drawer's bar from the board. A refusal is the same
  whoever owns the drawer or the post. A drawer is never refused for drawing on their own player's post. Who drew is the
  character, public as any Act's author. The Realtime event for a new drawing or wash is the Act's, as any Act's, and
  carries nothing about owners. Timing: a drawing's write does the same lock and grid pass whoever sends it.
- **Ways out** (CLAUDE.md, "No player is ever stuck"). The wall is the one new state, and section 4 names its way out for
  the author, a reader and an admin. A drawer refused by the limit is told how far over they are and that a wash frees
  room. An untagged drawing is only on the drawer's screen, and Cancel or leaving drops it.
- **The fiction and the log** (CLAUDE.md, "The fiction may lie; the log never does"). The log names every drawing and
  wash in plain words: "Gloomba tagged Spritey's post (6% of the wall)", "Spritey washed 9% of the wall off their post".
  The refusals and the meter are plain.
- **Accessibility** (CLAUDE.md, "An accessible path costs what the obstacle costs"). The post's words under the wall are
  given to a screen reader as Whoops!'s are, by the lines under ink. Hold to scrub is the reader's and the author's path
  at the hand's pace. The toolbar meets the glass's standards: keyboard, focus, labels, and each can named by its color.
  Drawing freehand is a pointer act. The Stencils tab (section 9) is the path for a keyboard or a screen reader, by
  anyone's choice: the play and every addition to a wall can be made from it.
- **The layers** (CLAUDE.md, "KayfaBB never knows which instance it runs"). The engine gains a card's **surface**: a
  play whose layer any character may add to. Its additions and the author's washes are kept as Acts, with a coverage
  grid in shares, a limit read from a card setting, and the wall row with its live list. The engine also gains three
  interfaces:
  - **beneath:** a card's effect drawn under every other card's on the post, whatever the play order;
  - **ink:** a hit test, so the press goes to the topmost effect with ink at that point when two cards hold ink on one
    post;
  - **composing on the post:** draw mode opens on the target post, not in a glass form over it.

  The engine names no card, no can and no stencil. Graffiti's rules, palette, caps, stencils, spray painter, toolbar,
  cursor, words and art are the instance's.
- **Append-only.** Drawings and washes are Acts. The wall row is derived state the Acts point at, never an Act's content.
- **American English** for every word a player reads ("color", not "colour").

## 12. Open

- **Report to admins on a drawing** waits for the conduct design's hide to be built (section 3).
- **The stencils' first list and their drawings** are instance content. The plan commits six, and the owner may change
  them in review.
- **A wall's limit for long posts.** 40% of a very long post is a lot of wall in absolute terms. It's accepted as the
  model. If it bothers players once there are some, it is a design question, as Whoops!'s looser splat is.
- **Drawings stretch with the body** when an edit reflows the post, as Whoops!'s strokes do. This is accepted as the
  model (the refinements design, section 1).
