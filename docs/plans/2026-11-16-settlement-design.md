Record, written 2026-11-16.

# Settlement: the flat Earn, the cushion, and the four cards that wait on them: design

A design session with the owner, on a phone. It is the Settlement step of the Base Set roadmap
(`docs/plans/2026-11-14-base-set-design.md`, section 1): the engine work the Wave 2 cards wait on, and those cards,
from their rows in `docs/plans/2026-11-15-base-set-card-numbers-design.md` (section 3.1) and the owner's direction in
[keithpickering/dividedworld#683](https://github.com/keithpickering/dividedworld/issues/683) ("Every Earn card moves
to a flat amount per vote"). Its plans:

- `docs/plans/2026-11-16-settlement-engine-plan.md`: the engine plan. It adds no card.
- `docs/plans/2026-11-16-sweet-heat-plan.md`, `docs/plans/2026-11-16-front-row-plan.md`,
  `docs/plans/2026-11-16-thick-skin-plan.md`, `docs/plans/2026-11-16-required-reading-plan.md`: one per card.

## 1. What settles today, and how

`settle(input, instance)` (`engine/rules/settle.ts`) is a pure function over one daily window, fed by
`settlement_input` (last defined in `supabase/migrations/0370_caught_casts_never_end.sql`). The live estimate is the
same function with the shared vote and the halving off, fed by `estimate_input`.

- **Votes.** A player's reactions on one Act share one vote, split across the quadrants they reacted in
  (`engine/rules/votes.ts`). A player's vote on a character's first Act of the window counts whole, and each further
  Act half the one before (`settings.halving`). A player's reactions to their own characters never count. A window
  pays the difference between a vote's shares now and what earlier windows paid, so a vote that moves to another
  quadrant is a negative vote in the one it left.
- **Classes.** Each class's `earn` turns the votes its character received into gains and losses, each an `Earning`
  with a reason, and for one reaction its Act, quadrant and time.
- **Earn cards** (the gimmick `earn`): each adds `by` times every *positive* class earning of the character's own Act
  that falls in the play's time and names its quadrant or reaction kind, as `card.boost`. Heat Magnet is 0.75,
  Publicity Tour 0.2, Hype-Up 1 on one post, Class Clown 1 on 😂 and 🙄. Earns add, except those sharing a `group`
  (Hype-Up and Publicity Tour alone), where the largest applies.
- **Payout cards.** Mooch (`skim`) and Toll and 4D Chess (`ride`) pay a flat share of a vote for each vote, with no
  class, at the vote's unhalved share. Mooch pays only for players who first reacted after it was played, and takes
  its pay back when the vote moves away.

What that leaves undone, and two faults:

- A percentage of a gain does nothing for a class with no gain in the quadrant (no salvage), and nothing for the
  Tweener's split, which carries no quadrant.
- Nothing softens a loss, and nothing filters by the kind of Act.
- **A boost is never taken back.** A boost is added to positive earnings only, so when a vote moves away the class
  earning is taken back and the boost stays. The owner noted a reaction cannot be removed today; a vote still moves
  when a player adds a second reaction in another quadrant, which splits it.
- **A card's size is read from the rules at settlement, not from the play** (#742).

## 2. What the owner decided, and what was weighed

1. **The reveal perk gets a design session of its own.** The roadmap lists it under Settlement; no Wave 2 card waits
   on it and its rates and scope are open in #683. The engine keeps its percentage Earn (`by`) for it, and this plan
   leaves what a `by` Earn pays unchanged. Weighed: designing it here, a longer session and a larger engine plan.
2. **A flat Earn pays on the vote as the class is paid for it, halving included.** The owner chose it over the full
   amount on every vote, as Mooch and Toll pay. With the halving, Heat Magnet softens a Technician's heat loss by
   three quarters on every post; without it, the third post's vote costs 0.025 and the card pays 0.075, so heat
   becomes income and the card rewards posting a lot.
3. **A vote that moves away takes its pay back.** Asked whether a flat Earn takes back what it paid, the owner
   answered that the screens offer no way to take a reaction back, "which I think simplifies things (though maybe
   there should be a grace period of a few seconds)". A vote still splits when its player adds a reaction in another
   quadrant, so the flat Earn follows the vote exactly, as the class earnings do: it pays for votes from players who
   first react to the Act while the card is up, and a share that moves away while it is up takes its pay back. A
   play then never costs its holder. Weighed: paying each positive move and never taking back, as today's boost does,
   which pays twice for a vote that splits and returns.
4. **A character's Earn pays on its posts only; Front Row alone pays on its cards.** The words of Heat Magnet,
   Publicity Tour, Class Clown and Sweet Heat say "its posts", and that becomes true: a post, or a spun thread's
   opening post (`isPost`). Front Row pays on the character's card Acts and on a Reversal of its own that springs.
   The two never overlap. Weighed: character Earns paying on everything, with Front Row overlapping them.
5. **On any one vote, the largest flat Earn applies; `group` is gone.** From the card-numbers design (section 0.5).
   A tie goes to the earliest play, then the smaller play id, as a group's tie does today.
6. **The sizes** (card-numbers design, sections 0.6 and 6): Heat Magnet three quarters of a vote, Publicity Tour half,
   Class Clown a whole vote for each 😂 and 🙄, Hype-Up a whole vote on one post. New: Sweet Heat and Front Row half,
   Required Reading a whole vote on one post.
7. **Thick Skin gives back half of each class loss from a reaction**, on anything the character does. It does not
   touch the Lurker's cost for posting too much, which no reaction causes, and it changes no gain.
8. **#742, in part.** Each settled line records the size it was paid at, so a retune never restates a settled line.
   Recording a card's numbers on the play itself needs the play functions, which the Plays plan owns; #742 stays open
   for it, and until then a play's own log line (`logPlay`) is still said from the card's current rules. Weighed:
   all of it here, which breaks the roadmap's rule that Plays owns `place_cast`; none of it.
9. **A build check on tagline length is not this plan's.** It is filed as
   [#772](https://github.com/keithpickering/dividedworld/issues/772). A check that renders each card's face and
   fails on overflow will fail on cards already built, and those need the owner's new words: a short session of its
   own. Each card plan here holds its tagline to two lines of 20 characters by a test of its own.

## 3. The engine work

All of it is the engine's and names no card and no class.

### 3.1 The flat Earn

An `earn` gimmick has exactly one size: `by` (the percentage, as today, without `group`) or `flat`, a share of a vote
above 0 and at most 1. A flat Earn may name `acts`, the kinds of Act whose votes it pays on; with none it pays on
posts (`isPost`).

For each vote line the window pays on an Act (`windowVotes`: a player's share in one quadrant, positive or negative,
times its halving), the flat Earns that apply are the plays on the Act's character and on the Act itself:

- whose time holds the vote's (`[at, ends)`);
- that name its quadrant or its reaction kind;
- whose `acts` hold the Act's kind (or, with none, the Act is a post);
- and whose play is no later than the voter's first reaction to that Act.

The largest `flat` among them pays `flat` times `settings.vote` times the line's votes to the Act's character, as
`card.boost`, with `{ card, flat }` in the entry's params, and the Act, quadrant and time of the vote on its line. It
has no class, as every card's payout has none, so it is in no class's season total.

- **Never negative for its holder.** A negative line is paid only where the voter first reacted while the play was
  up, so whatever it takes back, the same play paid at the same or a larger size.
- **Staff.** A staff character's Acts are not settled, so no flat Earn pays one.
- **The estimate.** With the shared vote off each reaction is a voter of its own at a whole vote, so each line is a
  reaction's own. It can differ from the settlement where one player reacted twice; the settlement is exact.

### 3.2 The cushion

A new gimmick, `{ kind: 'cushion', share }`, with `share` above 0 and at most 1. While a play of it is up on a
character (or a post), each class earning that is **a loss from a reaction** on that character's own Act gets
`share` of it back, as `card.cushion` with `{ card, share }` in the entry's params. Where two apply, the largest.

A loss from a reaction is an earning with a time, a negative amount, and positive `votes`: `Earning` gains
`votes?: number`, the signed votes of the one reaction it pays for, which a class sets where it pays per vote. So a
gain taken back (a negative amount on negative votes) is no loss, and an earning with no `votes` is never cushioned.

- **A loss that is later taken back is given back whole**, though half was cushioned: the engine does not hand a
  class who voted, so an earning cannot be tied to its voter's first reaction as a flat Earn's vote is. A reaction
  cannot be removed, so this happens only when a voter adds a reaction in another quadrant, and it is bounded by the
  kinds of reaction there are: under half a vote per voter and Act for a half cushion. Accepted, and named in the
  plan's review focus.
- **Beside a flat Earn:** both apply, each on its own; neither reads the other.

### 3.3 What a settled line records

A `card.boost` entry's params gain the size it was paid at (`flat`, or `by`), and a `card.cushion` entry its `share`.
The instance's words for those reasons say the size from the entry, falling back to today's words for a row that has
none.

### 3.4 The SQL

One migration. `card_kinds.gimmick` is jsonb and its numbers are checked by `instanceProblems` alone, so the flat
size needs no SQL. The cushion is a new kind: the catalog's kind constraint and `card_kinds_problem` name it, and
`settlement_input` and `estimate_input` carry a cushion play made before the window and still up in it, as they carry
an Earn play (`earn_up`).

### 3.5 The built cards

The engine plan converts Heat Magnet, Publicity Tour, Class Clown and Hype-Up to their flat sizes and their words,
gives the classes' per-vote earnings their `votes`, and rewrites the instance's words for `card.boost`.

## 4. The cards

Each row is the card-numbers design's (section 3.1), unchanged in rarity, price, time and size. What this session
adds is how each is expressed in the engine, and its words in full in its plan.

| Card | Rules |
|---|---|
| Sweet Heat | use, reaches a character, 3 days, `earn` flat 0.5 on `excitedPositive` and `excitedNegative` |
| Front Row | use, reaches a character, 3 days, `earn` flat 0.5 on all four quadrants, `acts: ['card', 'spring']` |
| Thick Skin | use, reaches a character, 3 days, `cushion` share 0.5 |
| Required Reading | use on one's own post, a week, `earn` flat 1 on `calmPositive` |

- Sweet Heat, Front Row and Thick Skin reach a character, so each is uncommon, as `reachRarity` requires. Required
  Reading is on a post, and common.
- "Refused while one is already up" is every card's default stack of one (`landsOn`).
- Required Reading's "only votes after it is played count" is the flat Earn's own rule.
- Each sentence that says a size is built from the card's rules (`shareWords`), so a retune changes the words with
  the number.

## 5. What Settlement leaves ready for Kick Me

Kick Me (Wave 3) is a Gimmick on one's own post that pays a whole vote for each negative vote there and refunds the
first three Salty casts. After this plan its Earn half is exactly Required Reading's shape with other quadrants:
`{ kind: 'earn', quadrants: ['excitedNegative', 'boredNegative'], flat: 1 }` on a use card on a post, beside Heat
Magnet on the author by the largest-applies rule. What Plays must still decide: a card holds one `gimmick`, so the
refund cannot be a second gimmick on the same card; it needs a place of its own in the card's rules.

## 6. What it does to the rest of the game

- **The masks.** A flat Earn pays any class the same, so playing one names no class. What it pays is computed in
  settlement from who reacted (the voter's first reaction, the shared vote), which is the scoring exception: it
  shows only as settled sums in the holder's own log. The live estimate reads no private fact: each reaction is its
  own voter, and the caller's own reactions are left out as today. No refusal, payload or timing is added. A
  cushion reads only the holder's own class earnings. Hype-Up on another's post pays the post's author whoever cast
  it, as today.
- **The log.** Each line names its card, the Act, the quadrant and the amount, and now the size it was paid at.
- **Ways out.** No state is added beyond a timed play: each ends at its time, and an admin can end it sooner.
- **Append-only.** Nothing is edited: settlement writes ledger rows, and an Act an instance already holds is read as
  before. A `card.boost` row settled before this change keeps its words.
- **A busy instance.** The flat pass is one pass over the window's vote lines, each reading the plays on its Act and
  its Act's character; the cushion is one pass over a character's own earnings. Neither reads the instance's plays
  as a whole. `earn_up` finds plays by creation time inside the longest time up, as today.
- **The layers.** The engine holds `flat`, `acts` and `cushion`; Divided World's cards, classes and words plug in
  through `CardRules`, `ClassRules` and its reason words.

## 7. Open

- **A grace period for a reaction** (the owner: "maybe there should be a grace period of a few seconds"). Its own
  change; nothing here depends on it.
- **The reveal perk**: its own design session (section 2.1).
- **#742's remainder**: a card's numbers on the play itself, for Plays.
- **The words.** The converted cards' sentences and the four new cards' are drafts for the owner's read in this PR.
  The card-numbers design drafted "one vote more"; the built words say sizes through `shareWords`, which says "a
  vote", so these read "a vote more".
- **Is a whole vote on Class Clown too much on a character?** It is #683's number, kept; the season review tunes it.
