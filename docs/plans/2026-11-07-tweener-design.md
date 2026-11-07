# The Tweener, a class that earns by splitting the room: design

Record, written 2026-11-07. The design session for issue #29, with the owner. Its plan is
`docs/plans/2026-11-07-tweener-plan.md`, and its mock of the class marks is `docs/research/2026-11-07-tweener/marks.html`.
Each section was confirmed by the owner before the next.

## Why

The owner's reason: no class in the lineup is an outlet for a playstyle that seeks controversy, an equilibrium of
high-energy positive and negative reactions.

Every class that reads reactions today earns from one quadrant and is hurt by one:

| Class | Earns from | Hurt by |
|---|---|---|
| Face | excited-positive (hype) | bored-negative |
| Heel | excited-negative (heat) | calm-positive |
| Technician | calm-positive | excited-negative |
| Jabroni | bored-negative | excited-positive |
| Lurker | timing: calling where a post ends up | posting past a few posts a window |

No class reads the *shape* of a post's reactions. A thread half 🔥 and half 🍅, the most electric thing a forum does,
means nothing to anyone as such. The Tweener is the first class to earn from a relation between quadrants.

**The name.** In wrestling the tweener is the act between face and heel, cheered and booed in one breath (Stone Cold,
the Attitude-era Rock). It keeps the lineup's wrestling vocabulary (Face, Heel, Jabroni, Technician). The wrestling
tweener is ambiguous more than divisive; "Lightning Rod" was weighed as a plainer name for the controversy-seeker and
not taken.

**The overlap the spec's Jester had** (`docs/plans/2026-10-28-kit-step-1-design.md`, section 8: its favored quadrants
overlapped both Face's and Heel's) is what this design is shaped around. A Tweener that earned from hype plus heat
would be the Face and the Heel together, strictly stronger than either. So it is paid on the balance, never the sum.

## 1. Split the room: what a split pays

**Decided** (the owner chose A). On each of its own posts and cards, the Tweener earns

> one vote's worth × 2 × the smaller of the post's hype side and heat side

read from the Act's whole history and paid as the difference at each settlement, as the vote math already pays a vote
(`engine/rules/votes.ts`, `payVotes`). 6 against 6 pays 12 votes' worth; 10 against 2 pays 4; 12 against 0 pays
nothing. A post that was 6 against 6 and later draws 6 more 🔥 pays nothing more; one whose smaller side grows later
pays then; a vote that moves from the smaller side takes its part back.

- At a perfect split it pays what a Face earns on a clean crowd-pleaser of the same size, so neither class is the
  stronger one where they meet.
- Everything past the smaller side is worth nothing: the equilibrium is the thing paid for.
- Each vote that joins the losing side visibly helps, and no vote in a post's favor ever lowers it: no cliff, nothing
  for the live estimate to jump on.

Weighed:
- **B. The total scaled by balance**, (hype + heat) × smaller ÷ larger. The same at a perfect split, steeper when
  lopsided, but not monotonic: a vote on the larger side can lower the pay, so a Tweener's own fans could cost it,
  which is hard to say in the log.
- **C. A threshold:** every excited vote paid in full once the smaller side reaches a share (say 35%), else nothing.
  A cliff: one vote moves a post from nothing to everything, the easiest kind of rule to farm.

## 2. Shrugged off: the weakness

**Decided** (the owner chose A). Each calm-positive and each bored-negative vote on its posts and cards costs **half a
vote's worth**: the shrug, either way. A polite 👍 and a 🥱 both say the room did not take a side.

- Spread across two quadrants at half each, the weakness weighs what every other class's one quadrant does.
- Calm-positive is the Heel's weakness and bored-negative the Face's: the Tweener carries half of each, which is what
  standing between them is.
- Consensus is not charged: a lopsided post already pays nothing past its smaller side.

Weighed:
- **B. Consensus itself:** a charge on the larger side's surplus, |hype − heat|. A Face's hit post would cost a Tweener
  money, so cheering one becomes a weapon against it.
- **C. Bored-negative alone**, a whole vote: the Face's weakness exactly, and a nod (👍) would cost nothing, though it is
  as far from controversy as a yawn.

## 3. What counts as a side: each player by their net lean

**Decided** (the owner chose A, with no headcount minimum). For the Tweener's reading alone, each player's vote on an Act
counts as its **net lean**: its excited-positive share minus its excited-negative share, at the vote's weight, on the
side that is larger. Calm and bored shares lean neither way.

- One player who leaves 🔥 and 🍅 on one post (a hedge, which the shared vote would split half and half) nets nothing.
  A hedge by one person never reads as a divided room.
- 🔥🔥🍅 counts a third of a vote on the hype side.
- The Face's and the Heel's rules read the shares as they do today; nothing else changes.
- It holds at any scale: it is a property of each vote, not a count of people.

Two friends reacting opposite ways on purpose pay the Tweener two votes, what two friends' 🔥 pay a Face. That is the
game's ordinary friend problem, not this class's, and it gets no defense of its own.

Weighed:
- **B. A minimum of players on each side** (two, say), on top of A. On a small instance it cripples an honest split in
  a quiet thread; on a busy one it is met at once and guards nothing where farming would be.
- **C. No rule.** A hedge would pay a Tweener what one sincere vote pays any class, and one person would read as a
  divided room, against the class's premise.

## 4. Cards

**Decided.** Reactions to the Tweener's own card plays read as its posts' do: they split the room and they shrug, as the
Face, Heel and Technician read their cards. This gives Pepperoni its home: a play whose own reactions are split evenly
"stays Pepperoni" (`docs/plans/2026-11-03-autocorrect-design.md`, section 8), and that is the play a Tweener wants.

**Decided** (the owner chose A): **Stirred the pot.** A card the Tweener plays on another player's post earns the split
on that post, read from the players the card drew in: those whose first reaction to the post came after the card,
each at their whole vote, by net lean, at the same rate (one vote's worth × 2 × the smaller side).

- Any alignment counts, Sweet, Salty or Pepperoni: the measure is whether the room divides, not what the card is.
- It mirrors the Face's "lifted a post" (`face.liftedAPost`): paid in the window of the play, from other players, the
  caster's and the post author's players left out. Two of one player's cards on one post pay what one would: the
  earliest of that player's plays on the post (any alignment, an earlier window's included) holds the post.
- **Decided** (the owner confirmed): **"after the card" means players who first reacted after it.** The Face's lift
  sums its window's vote differences after the card, which a sum allows. The smaller of two sides cannot be added up
  difference by difference, so it needs a whole group of voters to read, and the crowd the card drew in is that group
  and the one the log can say plainly. A player who had reacted before the card and changes side after it does not
  count.

Weighed:
- **B. No card rule.** The only reaction-reading class whose hand would do nothing a character's own cards don't.
- **C. A Pepperoni bonus:** a fixed amount when a Tweener play ends a window still Pepperoni. An exact tie is rare and
  brittle, a play with no reactions also stays Pepperoni, and the split on its own play already pays it.

## 5. The starter card

**Decided** (the owner chose A): **Autocorrect**, which the Jabroni's row also names
(`docs/plans/2026-11-02-onboarding-design.md`, section 4). It is Pepperoni and a Cast on another's post that twists
their words: the plainest way to stir the pot, so a newcomer's first play shows the class's card rule. The grant is not
built yet (the onboarding plan's Task 11); its check refuses an instance whose grant misses a class it has, so the row
is held whenever that task lands.

Weighed: Bluff (Pepperoni, a Set that does nothing: a quieter first lesson); Whoops! (Salty: teaches heat, the Heel's
game, more than division).

## 6. Its marks on the reaction map

**Decided** (the owner chose A2, from the mock). The class card's map draws the split as a mark of its own:
the two excited cells (Heat and Hype, the map's top row) each **half-filled toward the other, joined by a bar**. The
calm-positive and bored-negative cells carry the hurt mark (−). The marks' label, which a screen reader hears:
"Earns from a room split between hype and heat, hurt by the shrug".

The owner's reason: it looks like an H, which is inconsequential, and it is the only drawing that makes the class look
neither more nor less powerful than its neighbors at a glance.

Weighed:
- **A1. One wide cell** across Heat and Hype, with ⇆. Clear, but a single solid cell reads as a bigger earning than the
  others' single plus.
- **B. A plus on both excited cells.** Says "the Face plus the Heel", which is what the class is not; a 12-hype post would
  look like a win and pays nothing. The glass may joke, never mislead.
- **C. Hurt marks only.** Honest, and the only class whose map hides how it earns.

The engine gains `ClassMarks.splits`, a pair of quadrants, so the engine draws a split without knowing which class has
one. It refuses a pair the map does not set side by side.

## 7. Small decisions, defaults the owner accepted

- **The order:** Face, Heel, Jabroni, Technician, **Tweener**, Lurker. The owner kept the Lurker last.
- **No economy numbers of its own** (the owner chose A). The split and Stirred the pot pay one vote's worth (`vote`) ×
  2 × the smaller side, and the shrug costs half a vote's worth, as the Face, Heel and Technician pay per vote and the
  Face's lift pays. The 2 and the ½ are not tuning: they are what keep the Tweener level with the Face at a perfect split
  and its weakness the weight of every other class's. Retuning `vote` moves every class together. Weighed: three
  numbers (`tweener.split`, `tweener.shrug`, `tweener.stirred`) the season review could tune alone, which would let
  that parity drift unseen.
- **The live estimate** counts each reaction as a voter of its own at a whole vote, as it does for every class
  (`estimateForOwner`, the shared vote and the halving off), and reads the sides from the reactions themselves. A hedge
  looks like a split in the estimate and settles at nothing: the estimate never groups reactions into players, and the
  settlement is exact.
- **A Turn in the window:** a split's difference lands in the stretch of the class held at the time of the latest vote
  that moved it, as an earning for many votes is placed today.
- **Look and copy, placeholders and drafts for the owner's review:** a magenta in the glass's classes (the Lurker
  already holds violet), a pattern for the reveal's bar, the class card's words and the log's lines (the plan holds
  them), and the Strategy Guide hint "Say the thing half the room will hate."

## 8. Under the rules

- **A response never proves a private fact.** Everything new is computed inside The System's scoring and shown only as
  a settled window's sums, the exception the rule names. One exposure is named and accepted: if two masks leave 🔥 and
  🍅 on a quiet post and its split settles at nothing, the Tweener's player can infer one person is behind both. That is
  the exposure the shared vote already gives every class (two masks' 🔥 paying one vote), it falls under the scoring
  exception, and no noise is added. The live estimate never groups reactions by player, so nothing live is computed
  from who reacted.
- **No player is ever stuck.** The class adds no state a player, character or post is put in.
- **Append-only.** Nothing is edited: earnings are ledger rows as every class's are.
- **The fiction may lie; the log never does.** The log's lines say the rule plainly, with the amount, and never who
  reacted.
- **Weigh a design at the scale of a busy instance.** The split's cost per settled Act grows with that Act's reactors,
  as the vote math's does. The settlement input already reads every earlier reaction on each Act touched in the window;
  it now also reads each of those reactors' paid vote (section 9), one indexed read per touched Act. Stirred the pot
  reads the votes in the window on the play's target, as the Face's lift does.
- **KayfaBB never knows which instance it runs.** The engine gains two fields of class input and a mark kind, none of
  which names the Tweener.

## 9. What the engine adds

- **The standing of a character's Acts.** `ClassInput.standings`: for each of the character's own Acts with a vote
  moved in the window, every other player's vote there as it stood at the window's start and at its end: its weight
  times each quadrant's share, with no player named.
- **The crowd a card drew.** `PlayedCard.drawnAfter`: the same, for the players whose first reaction to the target came
  after the play, read for the holding play only.
- **The settlement input widens.** `settlement_input()` carries a paid vote only for a player who reacted in the
  window, so a split could not see the players who did not. A migration widens `paid` to every reactor on each Act
  touched in the window, and indexes `paid_votes` by Act. The engine's `payVotes` already ignores a paid vote it does
  not touch, so the extra rows change no other class's pay.
- **A split mark.** `ClassMarks.splits`, drawn as section 6 says, in the class cards and the Strategy Guide's classes,
  with a line in the guide's legend.

## Open

Nothing is open. The owner reviews the look and the words with the build, as the plan says.
