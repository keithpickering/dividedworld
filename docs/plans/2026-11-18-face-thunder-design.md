Record, written 2026-11-18.

# The Face's stolen thunder, judged by how the room took what was upstaged: design

A design session with the owner. It revises the Face's second weakness in
`docs/plans/2026-10-28-core-loop-design.md` (section 6, "its card outdrawing the post it landed on", and section 10's
−0.20), and makes true the line in `docs/plans/2026-11-11-card-types-design.md` (section 2) that "a clean save the room
loves earns a Face". Its plan is `docs/plans/2026-11-18-face-thunder-plan.md`.

## 1. What the penalty does today

`instances/divided-world/classes/face.ts` charges `face.cardOutdraws` (−0.20) under the reason `face.stoleThunder` for
every card of the Face's, on another player's Act, that drew more votes in the window than that Act did
(`outdraws`, `instances/divided-world/classes/shared.ts`). Read from `engine/rules/settle.ts`:

- **Any card, any target.** The card's flavor is not read, and neither is anything about the Act it outdrew.
- **One window.** A play is judged once, in the window it was made in, on that window's votes alone. Most outdraws are
  one vote against none, on a post that was quiet that day.
- **A Reversal's spring is judged against the cast it caught.** So a Face's Sweet save that the room cheers past a
  Heel's Salty cast pays −0.20 today.
- **Flat against linear.** A cheer on the card pays the Face +0.10, so a card with three or more cheers nets positive
  whatever it outdraws. The penalty bites on small outdraws.

The owner's finding: showing up a villain is face play, and the penalty does not know the difference.

## 2. Why the test cannot be class

A player's own log is true about what was charged ("The fiction may lie; the log never does"). A penalty waived when
the outdrawn post's author is a Heel or a Jabroni would let any Face play one card on a post, outdraw it, and read the
author's class group off its own log, on any character, as often as it liked. That is "A response never proves a
private fact", and no wording of the log fixes it. Weighed and rejected.

## 3. Decided: the room's verdict on what was upstaged

**The Face is charged for stealing thunder only where there was thunder the room valued.** A Face's play on another
player's Act that outdraws it is charged unless one of these holds:

1. **The room booed it.** The reactions on the outdrawn Act lean negative: heat and groans together outweigh the two
   positive quadrants.
2. **It answered a Salty play.** The outdrawn Act is a cast, and that cast reads as Salty this window.

Upstaging a post the crowd loved is unbecoming; upstaging one it booed is the Face doing its job. In wrestling the
crowd decides who the villain is, and here it does too: a Heel whose post the room cheered is, for that post, no
villain, and upstaging it costs.

How each part is read:

- **The lean** is positive vote shares minus negative ones on the outdrawn Act, over every reaction up to the window's
  end, unhalved, as a Pepperoni card's flavor is read (`readsAs`, `engine/rules/settle.ts`). Weighed: this window's
  votes alone, which would let one stray groan today flip a post loved for weeks; the dominant quadrant, which would
  call a post with two heats, two groans and three cheers well received.
- **The caster's own player's votes are left out,** so a Face's player cannot boo the post from another mask to waive
  their own penalty. The author's own player's reactions are never counted on their own Act. This is the rule
  `readsAs` and the Lurker's `endsUp` already follow.
- **A tie, or no reactions at all, holds the penalty.** The owner chose it: "Outdrawing a post with no reactions is
  more like punching down than saving the day - at EOD it turns out to be a vain look for a face, so penalty makes
  sense." Weighed: charging only where the post leans positive ("there must be thunder to steal"), which cuts the
  weakness much further and removes the one-reaction grief on a quiet post.
- **A Salty cast is heel conduct** by the card types design's section 2, and a Reversal springs only on something
  aimed at the setter's own post, so the other player swung first. A Salty Move's reactions land mostly on the post it
  hit and not on the card, so the lean alone would leave the usual clean save charged. The owner chose the
  recommendation. A Pepperoni cast reads as Salty only where its own reactions lean negative. Weighed: the lean alone
  (one rule, and the clean save stays mostly charged); never charging a spring (it would free a Face's dirty counter
  that upstages a Sweet play, the most unbecoming case).

Nothing else about the weakness changes: the amount, the reason `face.stoleThunder`, one window, any flavor of the
Face's own card, and that a big outdraw can still net positive.

Weighed and rejected beside these: waiving by the Face's card's flavor (a Face's Salty card on a loved post is the
case the rule exists for); waiving where the Face's own card was cheered (every popular card would be exempt, and a
cheered card upstaging a loved post is exactly stealing thunder).

## 4. The masks

- **Nothing new is computed from who owns a character.** The test reads reactions and a card's printed flavor, which
  anyone can watch. A Face can read a post's tallies before it plays, and that is play.
- **The settled bit.** Charged or waived is one more settled result computed from vote shares, which group reactions
  by player. It can, in a quiet window, show that two reacting masks were one player, as the outdraw itself and every
  per-vote amount already can. This is The System's scoring, the exception the rule names, and it adds no new kind of
  reading.
- **The live estimate** counts every other reaction as anyone's and knows only the caller's own, which are the ones
  the lean leaves out. It can say a penalty the settlement then waives, or the reverse, as it can for the outdraw
  today; the settlement is exact.
- **Who can trigger and watch:** only the Face's own player sees the line, in their own log. The post's author and the
  reactors see nothing.

## 5. Balance

The weakness is two votes' worth per card, so this moves where cards are aimed more than it moves totals.

- **Face.** Beside the Lurker it is the only class with a second weakness; this narrows it and keeps it. Booed posts
  become safe to upstage, so Face cards will drift toward them.
- **Heel.** Loses nothing directly. Its heat-drawing posts attract more Face cards, which take reactions away from the
  post. It keeps the only bonus for outdrawing (+0.20).
- **Jabroni.** Gains a little: more Salty cards land on its groaners, +0.20 each. A Heel partner can already run that
  loop, the Face gets no bonus from it, and a card costs far more than it pays.
- **Technician.** The misfire: a sincere post dragged with heat becomes free to upstage. Nothing is charged to the
  Technician, and it invites a pile-on. Accepted; the game may be unfair.
- **Tweener.** Its ideal post is an even split, which holds the penalty and flips on one vote.
- **Lurker.** Unchanged.

Fighting over a post's lean has a price in every direction: a boo that frees a Face pays a Heel or Jabroni author, and
a cheer that re-arms the penalty hurts one. Each settlement already records what each class earned, and the season
review reads it.

## 6. The layers

- **Engine:** `PlayedCard` (`engine/rules/types.ts`) gains two public facts about what a play is scored against, its
  lean and, where it is a cast, the flavor it reads as. `settle` fills them. The engine names no class.
- **Instance:** the Face's rule reads them (`instances/divided-world/classes/face.ts`), and the log's and the Strategy
  Guide's words say the rule plainly (`instances/divided-world/ui/index.ts`).

## 7. States and ways out

This design adds no state a player, a character or a post can be put in. A charge is a ledger entry in a settled
window, as it is today.

## 8. Open

- **Hall Pass.** Its spring is scored against a Mod Bot's visit, which is no cast and draws no reactions, so a Face
  whose Hall Pass spring draws one vote is charged for upstaging the visit, today and after this. Whether showing up
  The System is face play was not asked. The plan leaves it as it is and the question is filed as an issue.
- **The numbers.** −0.20 flat against +0.10 a cheer was not revisited; the season review has it.
