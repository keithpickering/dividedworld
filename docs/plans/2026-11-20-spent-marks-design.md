Record, written 2026-11-20.

# Spent marks: design

A design session with the owner. Its plan is `docs/plans/2026-11-20-spent-marks-plan.md`. It changes how the marks and
the Lens (`docs/plans/2026-10-31-marks-and-the-lens-design.md`) show a card whose plays on a post are all over, and adds
each card's icon to its Lens tab. Everything here is in the glass, and all of it is engine code.

## 0. Where it starts

- **The Lens says "Ends {date}" after the date has passed.** `defaultView` (`engine/ui/cards/plays.ts`) gives a play
  with a timer its way out through `endsWords` (`engine/ui/cards/marks.ts`), which always says "Ends …". Only a card
  that keeps (`keptEndedWords`) and a gimmick (`gimmickWords`, "Ended, changing nothing") switch tense. The heading
  above it keeps the card's present-tense status ("Sparkling every post by that character") after it has stopped
  being true. A Use on a post stays in `livePlays` once its end has passed ("A Use's end on a post is the Lens's to
  say"), so its effect stays mounted and keeps its own view. Hot Box keeps saying "Smoke over the words" and "Ends …"
  after it has ended. The glass speaks plainly and truly (CLAUDE.md, "The fiction may lie; the log never does"), and
  both lines are false.
- **A mark looks live after its card has ended.** A mark has one dimmed look, `data-kb-caught` (opacity 0.55 and a
  dashed border, `engine/ui/cards/marks.css`). It is set only when every play of the kind was caught, ended by an
  admin, or didn't take. A play whose time ran out, a fall a filing spent and an instant play all keep a lit,
  glowing mark. The dashed border is also the ghost mark's sign for "not landed", and 0.55 opacity puts a button's
  border at risk of falling under 3:1.

## 1. What "spent" means

**Decided** (the owner chose the recommendation): **every way a play ends.** A play is **over** when any of these
holds. Each is a fact the page already holds, and each is the same for every reader:

- a trap caught it (`caught`);
- an admin ended it (`reversed`);
- it didn't take (`untaken`);
- it is instant, over the moment it landed (`instant`: a heart);
- a filing spent it (`spent`: a fall);
- it was a card back that sprang (`revealed`). Its Lens already says "It has sprung, and ended", and what it laid is
  a play of its own;
- its time is up (`ends` at or before now), unless its card keeps (`CardRules.keeps`). A card that keeps still has its
  effect on the post it fell on, so it is in force there, and its Lens keeps saying "Ended … Posts written while it
  was up keep it."

A face-down back that ran out or was taken back is already gone from the strip (`shownPlays`) and is not part of
this. A play whose `starts` lies ahead has not started, which is not over.

A **kind is spent** on a post when it has plays there and every one is over. The mark and the Lens's heading are the
kind's, so "spent" is said per kind, never per play.

Rejected:
- **Also reader-side completion** (Whoops! fully washed for you). The mark would differ from reader to reader, and the
  mark's edge already shows that progress.
- **Timed ends only,** keeping today's caught look apart. Two dimmed looks for one meaning.

**Instants** (the owner's answer): an instant's mark is unlit from the moment it lands. That follows the rule: an unlit
mark means nothing of the card is still in force on the post. Its art is still seen in color on its Lens tab (section
5), which the owner asked for.

**In a moment.** A strip that shows a post as it stood in a moment (a spun thread's ORIGIN box, `then`) draws the
plays named in `then` as they stood then, which is why `asThen` already strips an admin's end from them. A timed end
of a play in `then` does not make it over there either. Caught, didn't take, instant, a spent fall and a sprung back are
facts from the moment the play landed, so they still count.

## 2. The mark

**Decided** (the owner chose B of four mockups): **unlit.** A spent mark has no glow, and a solid gray border (the
glass text color mixed toward transparent) in place of its card's color or ink. It sits on the glass ground in place of
the field, with its icon grayed and faded. Its count stays in text color and readable, and its edge is not drawn.

- It replaces `data-kb-caught`: one attribute, `data-kb-spent="true"`, and one look for every way a kind is spent.
- It stays a button that opens the Lens, so its border is held to 3:1 against the ground under it, and a test proves
  that for every instance key.
- It is solid, never dashed, so it cannot be mistaken for the ghost mark.
- Hover and the open state lift it the way they lift any mark: the shared hover's white border, and a faint fill
  while its Lens is open.
- Under forced colors its border is `GrayText`.
- Its accessible name carries the Lens heading (`markName` reads `view.state`), so a screen reader hears "Front Row, 1
  play, Ended." No extra words are needed.

Rejected: A, today's caught look for all (dashed means "not landed", and 0.55 opacity threatens contrast); C, B with a
diagonal stroke (reads as "forbidden" and crosses the count); D, the card's own border kept with a corner wedge (too
close to a live mark at a glance).

## 3. The Lens's words

**Decided:** the way-out line is in past tense once its time has passed: "Ended Nov 7, 9:14 PM", in the reader's zone,
from the same `dayAndTime` as "Ends". There is one function for both tenses, and it takes the time to compare against,
so no caller can forget the tense: `endsWords(ends, now)`.

**Decided** (the owner chose the recommendation): **the engine's plain heading.** A spent kind's heading is the
engine's own, in the family the Lens already has:

| Every play of the kind… | Heading | Way-out line |
|---|---|---|
| ran out of time | `Ended` (new, `ENDED_STATE`) | `Ended {latest end}` |
| was ended by an admin | `Ended by an admin` (as today) | none |
| didn't take | `Didn't take` (as today) | none |
| was caught | `Caught, did nothing` (as today) | none |
| is instant, or a fall a filing spent | the card's own status (as today: it already says what the card did, "Took the fall") | none |
| was over in more than one of these ways | `Over` (as today) | `Ended {latest end}` where any ran out of time |

The gimmick's "Ended, changing nothing" gives way to `Ended`, since a spent gimmick reaches the table first. Rejected: a
per-card past-tense status (`CardUi.endedStatus`), which is one more string for every card to write and check; and
keeping the card's status, which keeps a false line.

**Decided** (the owner chose the recommendation): **the engine wins, always.** Once a kind is spent, the view its
effect last gave is stale, as the Lens already rules for a kind an admin ended (`allEnded` in `useResolvedView`), and
the engine's view above is shown. This fixes Hot Box and every future effect that forgets its own end. Blind Study
("Totals are showing") and Whodunnit ("The name is back") lose their after-the-end headings, and their branches for that
are removed. Rejected: an effect keeps its heading, which leaves every effect responsible for its own end.

**A play's row.** In a kind that is still live, a play whose time ran out gets the note "Ended {its end}." in its
Lens row, beside the notes the engine already gives a caught, ended or untaken play.

## 4. Where a spent mark stands

**Decided** (the owner chose the recommendation): **spent last, at page read.** When a page is read and its plays are
billed (`billPost`), kinds with a live play come first in billing order, then the spent ones in billing order, so
live cards are what fills a strip's four (two on a phone) before "+N". A mark that goes spent while the page is open
stays where it is, because no mark moves under a reader's pointer (the marks-and-the-lens design, section 1). The
Lens's tabs follow the same order, as they already read `kindsOf`. Rejected: billing order alone (spent cards can
push live ones into "+N"), and a live re-sort (a mark jumps under the pointer).

## 5. The card's icon on its Lens tab

The owner's ask, in answer to section 1, and something they had meant to do: each card's Lens tab shows the card's
mark icon, always in full color, spent or not. This is where an instant card's art is seen.

**Decided** (the owner chose D, then adjusted it): the icon stands straight on the tab before its name, at 1.35em. It
carries a tight halo in the glass field color, so it reads even on its own ink fill (Whoops!'s pink splat on Whoops!'s
pink tab), and under that a soft drop shadow, set lower and lighter than the mockup's: `drop-shadow(0 0 1.5px field)`
twice, then `drop-shadow(0 3px 5px rgb(0 0 0 / 0.5))`. Rejected: no shadow (A: the icon vanishes on its own ink), a
dark square chip (B), and the soft shadow alone (C: Whoops! still blends at the edges).

- A card with a `CardUi.art.mark` shows it. A card with art but no mark shows a square swatch in `art.color`, as the
  mark does. A card with no art shows nothing.
- A sprung back's tab shows the card it became, as its tab's name does (`kindName`). A face-down back's tab ("Card
  back") and the visit's tab show no icon. A back is the same for everyone, and its cloud is the mark's own drawing.
- A form's tab (`onForm`) shows its card's icon.
- The icon is decoration (`alt=""`). The tab's name is unchanged.
- Under forced colors the filters are dropped.

## 6. The layers, the masks, the ways out and scale

- **Layers.** All engine: `engine/ui/cards/` (`marks.ts`, `plays.ts`, `billing.ts`, `Lens.tsx`, `Marks.tsx`,
  `marks.css`, `lens.css`) and the callers of `billPost` (`engine/ui/thread/Thread.tsx`, `engine/ui/spin/Origin.tsx`).
  The instance's art reaches the tab through the existing `CardUi.art`. Instance code changes only where it calls
  `endsWords` (Blind Study, Steel Chair, Hot Box, Whodunnit), and to drop the two after-the-end branches. No interface is
  added. `endsWords` gains a required argument.
- **The masks.** "Spent" and the spent-last order read only public facts of a play: its end, an admin's end, a catch,
  didn't-take, instant, a filing's spend and a spring, all already on the page for every reader. Nothing new is read
  or sent: no payload, no Realtime event, no timing. A face-down back's end is the same span for every card, and an
  over back is dropped as today.
- **Ways out.** No state is added that a player, a character or a post can be put in. A spent mark is a look, and it
  still opens the Lens.
- **A busy instance.** Spent is worked out per kind from that kind's plays, at most `PLAYS_PER_POST` per post. The
  mark's existing `useUntil` clock already wakes it when a play's end passes. Billing's partition is one more pass over
  a post's plays at page read.

## Open

- Whether a card should one day say its own past tense (`CardUi.endedStatus`). Not now: the owner chose the engine's
  plain heading.
