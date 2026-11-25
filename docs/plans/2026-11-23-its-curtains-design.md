# It's Curtains, a curtain over a whole post: design

Record, written 2026-11-23. Designed with the owner in a design session. The plan is
`docs/plans/2026-11-23-its-curtains-plan.md`. The owner's references are in `docs/research/2026-11-23-its-curtains/`.

## 1. What it is

Minus World's Season 1 roster listed it, as The Big Reveal, as a Pepperoni spell, "Hide this post behind a red curtain which
will open dramatically when clicked", and it was never finished. It comes back here because it has proven use: the
same mechanic as Below the Fold (the whole post hidden behind one press), with far more fanfare. That fanfare can draw
readers in or be ironic, which is what makes it Pepperoni.

It was renamed from The Big Reveal before it was built (the owner, 2026-11-25), because Reveal is already the name of
the class-reveal mechanic (`docs/plans/2026-10-29-class-reveal-design.md`) and a card called a reveal would read as
one. The owner picked It's Curtains over Curtain Call.

A post wearing it is covered from the postbit to the foot by a stage curtain: two halves, with swags along the top edge.
When the mouse moves over it (or, on a touch screen, when it is on the reader's line), a drumroll loops and two
spotlights trace a figure 8 over it. A press opens it: the drumroll ends on a snare and cymbal hit, the halves fly left
and right, the swags fly up, a whoosh and an original tada play, and confetti falls. Behind it is the post and every effect on it, which only now begin.

## 2. Decisions

**2.1 Each reader opens their own.** The open state is in the page's memory for that reader, the way Below the Fold's
and a spoiler's are; nothing is saved, sent or counted. Weighed: saved for each account once opened (the joke used up
after one look, and a new row for a flourish), and opened for everyone by the first press (a race, and a "who opened
it" fact the game would have to decide about).

**2.2 It covers the whole row, the postbit included.** This leaves the content area, which "An effect fills the post,
border to border" allows where leaving is the joke: the author is hidden too, so the reveal is who is behind the
curtain as much as what they said. Inside Below the Fold's bar: where a post wears both, the bar is outermost, and
unfolding it shows the curtain.

**2.3 A new engine interface, `coversRow`.** Today `foldsRow` is one flag, and the engine draws one bar and holds one
open/closed state. A curtain is not a bar, must cover the row at its full size, and a stack has a state for each
curtain. So `CardUi.coversRow` names a card whose `Cover` component the engine mounts over the whole row in a thread,
holding the reader's state (how many curtains this reader has opened). Where a post has no row (a spun thread's ORIGIN
box under its band, the front door, a moment, History), the card's own `Effect` covers the content area instead, as
Below the Fold draws its in-words bar there. Weighed: widening `foldsRow` into a typed row-hider (the two cards would
compete for one slot, with a special case for both on one post), and a curtain over the content area alone (the author
shows, and it is not this card).

**2.4 Nothing under the curtain starts until it opens.** While a curtain is shut, the row under it is `inert`, and the
engine tells every other effect on the post that it is covered (`EffectProps.covered`). The effects that start on
sight (Steel Chair's throw, Glitter Bomb's burst, Hot Box's smoke rolling in, Laugh Track's line, Stick Around's
takeover) treat a covered post as out of view. They begin as the curtain opens: the reveal shows the post "and all its
other effects". Covers nest outermost of all, outside takeovers (`nestOrder`), so a card played after the curtain is
still under it.

**2.5 Stacking: up to three, each its own curtain, each costing more.** `stack: 3`. Opening one shows the next behind
it, latest played outermost, each in its own color. Every curtain gets the full show, drumroll, whoosh, tada and
confetti, because the false reveal is the joke. Weighed: the tada and confetti on the last curtain alone (the missing
tada would give the stack away), and a show that gets shabbier with each curtain (more sounds, and behavior that
depends on position). A deep stack makes a post tedious to reach, which is funny only when it is rare, so each extra
curtain costs more to play (2.6).

**2.6 Price.** Uncommon, 1.50 at the machine. The first curtain on a post adds nothing to play, the second adds 1.00
and the third 2.00: 4.50 for the full stack. The two surcharges are economy settings (`itsCurtains.secondAdd`,
`itsCurtains.thirdAdd`). Weighed: common at 1.00 with +1.00 and +3.00, and rare at 3.00 with a flat +1.50.

The engine gap: `CardRules.playPrice(settings, target, config)` never sees the effects already on the target, so no
card's price can depend on how many of it a post carries. It gains a fourth argument, the target's effects, the same
list `canApply` is given. What is on a post is public, so a price read from it proves nothing private. The price is
read as the post stands when the play is decided, as every price is (`decidePlay`'s own comment): two casters racing
for the second slot may both be priced as the second curtain, and SQL's stack check still refuses a fourth.

**2.7 Color: a fixed list of fabrics.** Red (the default), Royal Blue, Purple, Emerald, Gold and Black, each with dark,
mid and light shades set by hand, following the pleat gradient of the Minus World drawing. The form is a radiogroup
like Hot Box's, with no free picker. The server refuses a color not on the list, Mod Bots pick from it
(`staffConfigs`), and the log names it ("a Royal Blue curtain"). Weighed: Hot Box's swatches plus a free picker (some
colors do not read as cloth, and the log could only name a hex code), and red only.

**2.8 Opening.** A click or tap on the curtain, or Enter or Space with it focused: it is a real button, labeled "Open
the curtain" (with "1 of 3" where there is a stack). A press that ends a drag, a scroll or a text selection opens
nothing. The halves leave in about 750 ms. Under reduced motion it still takes the press (an accessible path costs
what the obstacle costs); the halves are removed at once, the spotlights stand still, and the confetti is not thrown.
The sounds still play, because they follow the sound preference, not the motion one.

**2.9 The drumroll.** With a mouse, it loops while the pointer is over the curtain, starting only on a real movement,
by Laugh Track's rule: a curtain scrolling under a mouse at rest starts nothing. On touch, it loops while the curtain is
on the reader's line (Laugh Track's `line` setting). The spotlights circle while it plays. Before the reader's first
gesture the browser holds sound back, so the first drumroll on a touch screen may show only its caption.

**2.10 Encore.** The Lens has a press control, Encore, that shuts every curtain again so the reader can replay the show,
as Steel Chair's Throw again does. The Lens's state reads "Curtain 1 of 3 shut for you" or "Open for you". The ways out
are the reader's press on the curtain and an admin ending the play.

**2.11 Sounds.** Four, which the owner made in ElevenLabs and put in `docs/research/2026-11-23-its-curtains/sounds/`,
as for Steel Chair: a steady drumroll that loops, a snare and splash cymbal hit that ends it, a fabric whoosh, and a
quick horn tada in the spirit of Windows 3.1's. Not Microsoft's own file, which is theirs and cannot be in an
open-source repository. On open the four run in order: the loop stops, the hit lands, the whoosh plays as the halves
leave, and the tada as the confetti flies. The owner added the hit when the takes came in (2026-11-25); the design
first named three. Weighed: generating them in this session, and a build session generating them, which would touch a
connector.

**2.12 Art.** The card face follows the owner's reference (`docs/research/2026-11-23-its-curtains/card-art-reference.png`),
made by the rendered card-art pipeline (`docs/plans/2026-11-11-rendered-card-art-design.md`).

**2.13 Not built.** The sad-trombone combination with a Salty card from the Minus World roster. The owner: "We never
did the sad trombone thing, I don't think it's needed here."

## 3. The rules this design answers to

- **No player is ever stuck.** The curtain's way out is the reader's own press on it, on every place it is drawn; an
  admin can end the play. Encore shuts only the reader's own curtains, in the page's memory.
- **A response never proves a private fact.** The open state is never sent. The price reads the post's live effects,
  which are public. Nothing reads who cast a curtain beyond what the post's marks already show.
- **The layers.** The engine gains `coversRow`, `Cover`, `EffectProps.covered`, a `covers` group in `nestOrder`, and
  `playPrice`'s effects argument, and none of them names a card. Everything else is Divided World's.
- **The world.** The curtain is a game piece on the board; the Lens and the play form are the engine's glass.
- **An accessible path costs what the obstacle costs.** One press for everyone, a button reached by keyboard; reduced
  motion still presses.

## 4. Open

- The six fabrics' exact shades, and the confetti's count, colors and fall time: the plan sets starting values, for the
  owner to tune in review.
- The exact length of the drumroll loop, where the hit, whoosh and tada are cut, and how they overlap on open: set by
  the build against the owner's takes, for the owner to tune in review.
