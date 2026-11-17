Record, written 2026-11-16.

# Playable moments: design

A design session with the owner on issue #770. The owner asked, in the design session for #768: "'As it landed's
propensity to show a 'frozen' version of the effect may also be flawed. Part of an effect when it landed is the way
it can be interacted with at the time, and freezing it at frame 1 removes that ability - do we have a good reason to
do that?" This design answers it: **a play's moment is playable.** Each effect in it starts from the state it had
then and runs as it ran then; nothing a reader does in it is saved or sent. Each decision below is the owner's choice
among alternatives, or is marked as the session's. The plan is `docs/plans/2026-11-16-playable-moments-plan.md`.

It replaces these parts of `docs/plans/2026-11-03-effect-history-design.md`, which is a record and is left as
written: section 3's rule for which cards are drawn and its "Accessible words", section 4's "While a moment shows,
the post takes no strokes", and section 5's still mode. Everything else there stands: what a moment records, when,
where it shows, and what it reads.

## 0. Where it starts

Read at `origin/main` 1a41d502.

- **The still mode** is `EffectProps.still` (`engine/ui/cards/types.ts`). `StillEffect` in
  `engine/ui/cards/Effects.tsx` gives a drawn card `still: true`, a `save`, `release`, `give` and surface that refuse
  without asking, a `met` and a `holdScreen` that do nothing, no marks, no wallet, no ink registry, and a reader who
  is nobody (`{ author: false, caster: false }`). Its `show` goes to the frame's words (`onWords`), never to a Lens.
- **The record's reason for it** is that a change made in a moment has nowhere true to be saved: it would rewrite the
  live play or the past. That is a reason to refuse saving. The effect-history design's own words are "a moment holds
  the state, not the motion", and nothing in it argues against input.
- **A moment holds only what the post's author had saved** (`PlayMoment.layers[].state`). A reader's own scrubbing, a
  smoke clearing, a pile of chairs and a burst of glitter were never recorded anywhere.
- **No effect is told the moment's time.** `PlayMoment.at` exists and `momentParts` judges liveness at it, but
  `EffectProps` carries nothing of it.
- **Two places show a moment:** over a post in its thread (As it landed in a play's Lens row, `PostEffects`), and as
  the content of the ORIGIN box of a thread spun from a card play (`engine/ui/spin/Origin.tsx`). A thread spun from a
  post has a live box already, drawn by `PostEffects` like any post.
- **History uses the same still mode** (`VersionEffects`) to draw a writing card's tail on each version row. That use
  is not a moment and is not changed here.

### What each effect does under `still` today

Fifteen `Effect.tsx` files stand under `instances/divided-world/`; fourteen read `still` (Stick Around does not).
Ten are drawn in a real moment today, and Glitter Bomb only as a spin's own play on a character.

| Card | Drawn today | Input frozen | Motion frozen | Saving or sending skipped | Sound |
|---|---|---|---|---|---|
| Whoops! | yes | scrub listeners, the Lens hold, the ink claim, the author's tool choice | the clean fade; words are not made inert | `save` (the author's strokes) | none |
| Autocorrect | yes | strip anchors are plain text, no hit boxes, no hands | the shine loop on the residue, the size observer | `save` (the author's peels) | none |
| You Were Saying? | yes | the erase (pointer, Backspace, the toggle) | the tail is whole at once, no retype | `save` (the author's erase) | none |
| Feelin' Fab | yes | none to freeze | the foil is painted once at the rest light | none | none |
| THIS | yes | none | none: it is the same drawing | none | none |
| Hot Box | yes | pointer clearing, the Lens hold | the fog at full strength, no drift; words are not made inert | none (it is local live) | none |
| Steel Chair | yes | Throw again | no flight, no shake: the pile is settled at once | none | the hits and the settle are silent |
| Whodunnit? | yes | none | the clock: never "wore off" | none | none |
| Blind Study | yes | none | the clock: never "totals are showing" | none | none |
| Jimmy Wails | yes, and draws nothing | the give buttons | the carousel does not advance | `give` | none |
| Glitter Bomb | as a spin's own play | the pointer's pickup | no burst, the flakes at rest | none | none |
| Below the Fold | no: named | the bar is disabled, and the post stays folded | none | none | none |
| Laugh Track | no: named | the cues are plain text | none | none | the murmur and every cue |
| Graffiti | no: named | scrub, Draw, Wash | the wall is empty: a moment holds no read of it | `surface.draw`, `surface.wash` | none |

Three things the survey found that no issue lists:

- **Jimmy Wails draws nothing in a real moment.** `StillEffect` passes no `drives`, so the effect returns the post's
  words alone, and because the card counts as drawn it is not named either.
- **Below the Fold, drawn still as written, would be a dead end:** folded, with a disabled bar. It is never reached,
  since the card is not drawn in a moment today.
- **In still mode a card's Lens controls reach nothing.** Whoops!'s and Hot Box's keyboard paths ("Hold to scrub",
  "Wave the smoke") and Steel Chair's Throw again live in the card's view, and a moment's views go only to the
  frame's words.

## 1. A moment is playable, in both places

**The owner's choice** ("Playable everywhere"), over playable in the ORIGIN box only, and over keeping it still.

Over a post and in a play-spun ORIGIN box alike, each effect drawn in a moment:

- starts from the state it had then: what the author had saved by then, the post's version then, the plays on it then;
- runs as it runs on a live post: it takes input, moves, and sounds;
- saves and sends nothing, and is as it landed again on Reset, on Back to now, and on a reload.

Weighed: playable in the box only, since over a post the live post is one press away. Not chosen: two kinds of
moment, with the same card behaving two ways under the same words "as it landed".

## 2. What a moment refuses, and what it allows

**Refused, without asking the server** (the session's, from the record's own reason):

- `save`, `release` and `give` answer a refusal, as they do today.
- A surface's `draw` and `wash` answer a refusal, and its `near` reads nothing.
- `met` does nothing: a moment sends nothing at all, the reader's own first-time callout included.
- `holdScreen` does nothing and no marks are handed in: no takeover is drawn in a moment (section 5).
- No Realtime event, presence update or request is added. Nothing a reader does in a moment leaves their screen.

**Allowed:** every input the card takes from a reader on a live post, every animation, its sounds (section 8), its
ink claims among the moment's own cards, making the words inert while an obstacle covers them, and its Lens controls
(section 6).

**The reader is nobody in particular** (the owner confirmed): `reader` is `{ author: false, caster: false }` for
everyone. The post's author gets no author tools in a moment, so nothing in it looks like a tool that saves. Whoops!,
Autocorrect and You Were Saying? each already have a reader's path that is local and never saved, and that is the
path every reader takes.

**The screen says so** (the owner's choice, "A line under the post", over saying it in the Lens only, and over
saying it nowhere): the moment's small print always carries "Nothing you do here is saved."

## 3. The clock is stopped at the moment's time

**The session's, confirmed by the owner.** Each effect in a moment is given the moment's time, and judges
everything it judges by a clock against that time, which does not advance:

- Hot Box's smoke is as thick as it was then. Its own play's moment is full strength; an older Hot Box under a later
  play is as thinned as it was when that play landed.
- Whodunnit? and Blind Study are up: never "wore off", never "totals are showing".
- Steel Chair draws every chair the moment hands it. The engine already left out a play that had ended by then.
- Nothing wears off while a reader looks.

Weighed: a clock that starts at the moment's time and runs. Over a three-day effect it changes nothing a reader could
see in a sitting, and it would need a second moving clock on the page.

**What was never recorded starts as the card starts on any post** (the owner confirmed): a reader's own scrubbing
(none), a smoke clearing (none), a chair pile (thrown again, from a fresh seed, as a live run is), a glitter burst
(fires when the post is in view, as live). So "a moment is the same for every reader" now means its starting state:
the words, the plays, and what was saved. The motion from there is each reader's own, as it is on a live post.

A writing card's tail is the one made for the moment's version. A generation that was still waiting then is not
drawn: it has long since finished or failed, and a cursor that waits forever would be a dead end.

## 4. The way back: Reset

**The owner's choice** ("Reset on the frame"), over a Reset in the Lens, and over no new control.

- Over a post the tag reads "As it landed · Reset · Back to now".
- In the ORIGIN box the head reads "… · as it landed · Reset" (or "as it was spun · Reset").
- Reset starts every effect in the moment again from its state then. Chairs fly again, a tail types in again, ink is
  back. Focus stays on Reset, and a polite status says "As it landed again."
- It is always there, in the same place in both, whether or not anything was changed: a control that appears only
  after a change would move the others.

This is the way out "No player is ever stuck" asks for, on the screen where the state shows. A reader who has washed
a moment clean can always see what the play did again. Back to now, closing the Lens, opening another post's Lens,
and leaving the page end a moment over a post as before. The box's mark still leads to the post as it is now.

## 5. Which cards are drawn

**The owner's choice** ("Every effect but holds"), over drawing a takeover too, and over keeping today's rule.

A card played on the post is drawn, and playable, in a moment when it has an effect and is not a takeover. Whether
its effect "can change after it lands" no longer decides it: how a card can be played with is part of how it landed,
and Below the Fold's fold and Laugh Track's cues are that.

- **Newly drawn:** Below the Fold (starts folded, with its own bar, which works), Laugh Track (its cues play), and
  Graffiti (the wall as it was then; a reader scrubs it locally; nobody draws on it or washes it for others).
- **A takeover stays named** (Stick Around). Its release is the reader's certification, saved for good. In a moment
  it cannot be saved, so the hold would take the reader again on every visit to a spun thread, which costs more than
  the card costs live. Over a post in its thread the live Stick Around keeps wrapping the moment, as today.
- **A play above the post stays named** (a card on the thread, the board or the author), as the effect-history
  design decided: its moment is not one post's. The one exception stands: a spin's own play on a character is drawn
  around the post (Glitter Bomb), and is now playable.
- **A card back and a caught play** are named as before. Which card a back is is never read.

The engine reads this from what it already holds: the card's `Effect` and `takeover` in `CardUi`. No card is named,
and a card sets nothing.

**Two cards wait for a read of the past** (the owner's choice, "One change, two plans"; section 11):

- Graffiti's wall is surface Acts, not saved state, and a moment holds no read of them.
- Jimmy Wails's drive (its total and its gifts) is read live, and a moment is handed none.

Until that read is built, a card whose rules have a surface or a drive is named in a moment and not drawn. For
Jimmy Wails that also ends today's silent gap, where it is neither drawn nor named.

## 6. An obstacle costs in a moment what it costs live

**The session's, from "An accessible path costs what the obstacle costs", confirmed by the owner.** Whoops!'s ink
and Hot Box's smoke cover a moment's words as they cover a live post's, the words are inert while covered, and the
way through is the same: the scrub or the wave by hand, or the Lens hold at hand pace. A moment gives no way around
that a live post does not. A reader's clearing on a live post is local until a reload too, so the cost is the same
cost.

That needs each drawn card's Lens to work in a moment:

- **A moment's views go to the strip where it shows.** Each drawn effect's `show` reaches the marks and the Lens of
  the place the moment is drawn in: the state then ("Gloomba's yellow, 40% washed for you"), the way out, and the
  controls (Hold to scrub, Wave the smoke, Throw again, Game sounds).
- **Over a post** the post's own strip is that strip. While a moment shows, the live effects it replaces are not
  drawn and say nothing, and the moment's effects say theirs.
- **In the ORIGIN box, a mark per drawn card** (the owner's choice, over one mark whose Lens lists every card, and
  over controls under the post). Today the box has one mark, the spun play's. An older Whoops! under a spun Steel
  Chair would have no Lens, and so no keyboard path through its ink. The box's strip now shows a mark for every card
  drawn in the moment. The spun play's row keeps React and Spin. The other plays' rows say the state then, hold their
  controls and link Go to post, with no React and no Spin: those are on the post itself, where the play's tallies are
  read.

## 7. What a moment says under its post

**The owner's choice** ("Only what no mark says"), over nothing under the post, and over keeping every line. The
owner, in the session for #768: "There is already a Mark there to explain the effect, which speaks for itself
regardless."

- **Gone, in both places:** a drawn card's line ("Steel Chair: Dented by a chair"). The mark names the card, its
  Lens says its state then, and the effect speaks to a screen reader as it does on a live post (below).
- **Kept:** what no mark says. What became of the play ("Caught by Trap Card"), "Also on the post then: …", "What
  else was on the post then wasn't recorded.", and the new "Nothing you do here is saved."
- **Where.** In the ORIGIN box the lines stand in a foot of the box, under the content area and outside it, so no
  effect that fills the area passes under them and nothing arrives late inside the area an effect has measured. Over
  a post they stay the glass panel at the frame's foot, as the tag is glass at its head: plainly laid over the post,
  which the rule on effects allows ("stays pressable or is plainly covered"). Whether that panel should also leave
  the post's body is for the owner to judge on the stories (section 13).

**What a screen reader is given.** The frame is still a group named "As it landed" with its date. Inside it each
effect says what it says on a live post: Whoops!'s readout of uncovered lines, Hot Box's live region, a tail's
status, THIS's hidden note, Laugh Track's captions. The marks name each card, and each Lens says its state and its
way out. The effect-history design gave a still card a line of words because a still drawing said nothing; a live
effect does.

## 8. Sound

**The owner's choice** ("As on a live post"), over sounding only after a press, and over silence.

A moment's effects play the sounds they play on a live post, with the same captions, under the same Game sounds
switch and the browser's first-gesture rule. A spun thread opened on a Steel Chair moment throws and clangs once the
box has been in view, as a live post with that card does, and Reset plays it again. The card's sounds are warmed for
a moment's effect as they are for a live one.

## 9. Reduced motion

**The session's, confirmed by the owner:** a moment under reduced motion is the card under reduced motion on a live
post. Each effect already has that form (Steel Chair settled at once and silent, Hot Box's fog still with clearings
open or shut, a tail whole at once, the foil at its rest light), and each keeps its cost: Hot Box's reduced form is
the same obstacle. A moment adds no rule of its own.

## 10. The engine names no card

Engine:

- `EffectProps.moment`: null on a live post; in a moment, the moment's time. It replaces `still` as what an effect in
  a moment is told. `still` stays in the contract for History's version rows alone, and only a writing card reads it.
- Which plays are drawn (`CardUi.Effect`, `CardUi.takeover`, and until plan 2 `CardRules.surface` and
  `CardRules.drive`).
- The moment's refusing callbacks, its own ink registry, the warmed sounds, and where its views go.
- Reset, the frame's words, the box's foot, and the box's marks.

Instance: each effect's own handling of `moment`. No new interface carries instance content.

## 11. How it is built

**The owner's choice** ("One change, two plans"), over card by card behind a flag, and over one plan for everything.

- **Plan 1** (`docs/plans/2026-11-16-playable-moments-plan.md`): the engine's contract changes once and every
  effect is converted in the same PR, a task each. No flag, no list of converted cards, and never two kinds of moment
  on one post once it merges.
- **Plan 2** (issue #774): the read of the past that two cards need, and those two cards: Graffiti's wall as it was
  at a moment's time, and Jimmy Wails's drive as it stood then, with no give buttons. It gets a design pass of its
  own first, because it adds a read and the masks have to be checked against it: a gift's giver and amount are
  public Acts today, and a wall's strokes are, but the read is new.

Weighed: a flag each card's UI sets as it is converted. It would leave a post showing one card live and one still
under one "as it landed" for as long as the conversion took, and a flag to take out at the end.

PR #771 (Steel Chair in the ORIGIN box) fixes a still run that measured its box once. Plan 1 removes the still run,
and that fix with it, whichever lands first; the plan says how.

## 12. The rules it was checked against

- **A response never proves a private fact.** No response, payload, Realtime event or timing is added. A moment is
  read as before (`play_moment`, `spin_moment`: public Acts and the snapshot, the same answer for every caller).
  The reader is nobody, so no effect in a moment branches on who owns the post or who cast the card, and the post's
  author sees exactly what a stranger sees. Nothing is sent, so nothing can be watched.
- **The fiction may lie; the log never does.** No Act is written and no log line is added. The frame is glass, in
  plain words: "As it landed", "Reset", "Nothing you do here is saved." It never speaks in character.
- **The System acts; it never destroys what a player wrote** and **Append-only.** A moment writes nothing.
- **No player is ever stuck.** Reset and Back to now, on the screen (section 4). No takeover is drawn. Below the
  Fold's bar works. A waiting tail is not drawn.
- **An accessible path costs what the obstacle costs.** Section 6.
- **An effect fills the post, border to border.** An effect in a moment fills the same content area as before. The
  box's lines leave the area (section 7).
- **KayfaBB never knows which instance it runs.** Section 10.
- **Weigh a design at the scale of a busy instance.** A page shows at most one moment over a post (one Lens is open
  at a time), and it replaces that post's live effects, so it adds none. A spun thread's first page shows one more:
  its box, which costs what one more post with those cards costs, and every effect already frees its canvases and
  stops its loops out of view. Later pages of the thread carry no box. No read is added, so nothing grows with
  players, threads or Acts. Reset costs one remount, by a press.

## 13. Open

- **The panel over a post.** Section 7 leaves the kept lines as a glass panel at the frame's foot over a post. The
  owner judges on the stories whether it should hang outside the body, as the tag hangs on the date bar.
- **Plan 2's design** (issue #774): the read of a wall and of a drive at a time.
- **The Strategy Guide.** The effect-history design left open whether its copy mentions As it landed. It is still
  open, and that copy is the owner's to approve.
- **A tab for a card that landed after the moment.** Over a post, while a moment shows, the strip still has marks
  for plays that landed later. Their effects are not drawn, so their Lens says the card's plain summary. Whether it
  should say "Not on the post then" was not asked.
