Record, written 2026-11-20.

# Higher stakes on the left: a balance pass on the classes: design

A design session with the owner. It began with a request for a balance check: how hard each class is to play with the
Base Set as built, the reaction pool and the way a crowd of friends reacts. Its plan is
`docs/plans/2026-11-20-class-balance-plan.md`. It takes up the reveal perk from
[#683](https://github.com/keithpickering/dividedworld/issues/683), which the settlement design
(`docs/plans/2026-11-16-settlement-design.md`, section 2.1) left for a session of its own.

## 0. The appraisal it starts from

Every reaction pays one class and costs another: hype pays the Face and costs the Jabroni; heat pays the Heel and
costs the Technician; calm pays the Technician and costs the Heel (and the Tweener half a vote); a groan pays the
Jabroni and costs the Face (and the Tweener half). Every vote on a Lurker's card pays the Lurker, and no reaction
costs it.

Among friends, hype and calm are the free, kind reactions. Heat and groans take intent, and a bait that fails draws
silence or a polite 👍. So the easy side of the grid is the right side, as the owner judged in #683. From easiest to
hardest: **Face, Technician, Lurker, Tweener, Jabroni, Heel.** The owner: "Face as the easiest and Heel as the hardest
are good in principle."

The session found five problems with that standing:

1. **Nothing makes a hard class worth the risk.** The owner: "the easy choice is to just not bother with those classes
   and there's not much of a reason to take the risk beyond a desire for a greater challenge. It should feel enticing
   for a 'natural Face player' to create a Heel or Jabroni character, tap into these parts of themself, and gain more
   aura than they can by playing an easier class. Higher difficulty, higher rewards (or at least higher stakes) seems
   to be a sensible pattern."
2. **The Starter Pack works against the Heel.** Every new player holds a Rope Break, which catches the first Salty
   common cast on their post; the Heel's two starter Salty cards, Steel Chair and Whoops!, are exactly that. The owner:
   "a bit unfair."
3. **The Heel has no card of its own** as accessible as Rope Break. The owner: "Rope Break's exact opposite would be a
   common reversal that steals a Sweet card."
4. **The Lurker is the safe pick.** A player's reactions share one vote whichever mask gives them, so reacting through
   a Lurker costs the post's author nothing more, while the Lurker is paid for every early call that comes true and
   charged for none that does not. The owner: "the meta for any player serious about farming aura will be to just have
   a Lurker character and switch to it to leave all their reactions. Which is fine I guess, since this becomes a
   character that takes up one of your slots, which is a real trade off. But it would be nice if there was some kind of
   gotcha for having it on your team to make it less of a safe pick."
5. **The Face's lift escapes the halving.** `face.liftedAPost` pays a vote for each hype that lands on another
   player's post after the Face's Sweet card there (`engine/rules/settle.ts`, the `after` tally in the played-cards
   block). It is read per target post, at each vote's unhalved share, so the halving that bounds every other income
   of a character's own Acts does not reach it: a Face that Feelin' Fabs every rising post at 0.20 a card earns from
   all of them. `tweener.stirredThePot` is built the same way, though it needs both sides of the room to arrive after
   the card and so is far harder to farm.

## 1. The left side pays double

**Decided:** a heat vote pays the Heel two votes' worth (`heel.heatVotes: 2`), and a groan pays the Jabroni two
(`jabroni.groanVotes: 2`). Their weaknesses stay at one vote's worth. Their card earnings (`heel.stoleThunder`,
`jabroni.soldTheL`) stay at 0.20. Both are economy settings, starting points for the season review.

Why the reward and not the stakes: heat and groans are scarce among friends, so a higher rate pays for the work of
drawing them; the weaknesses (👍 and 😂) are the most plentiful reactions there are, so raising them would make the
classes harder without making them more enticing.

Why two and not one and a half: the owner, "2x definitely reads as more of a boost psychologically, unless it's too
big a bump to the point of being an overcorrection." It is judged not to be: an honest crowd's heat stays scarce, so a
Heel's ordinary day can still fall short of a Face's; the weakness gives the crowd a free counter the Face never
faces; and the halving still holds one voter to about two votes' worth per character a window, 0.40 for a Heel against
0.20 for a Face.

Weighed: raising both the reward and the weakness (a crowd that guesses the class punishes with a free 👍, so it mostly
widens the hole); a flat bonus on a window that nets positive (lumpier, and harder for the log to say).

What 2× does to collusion: friends who know a mask can give it heat on purpose, and the rules cannot stop a mask being
told out of band. A Face's friends can do the same with 🔥, so 2× doubles what collusion was already worth, and the
season review has the numbers.

## 2. The reveal perk: one rate, every class

**Decided:** while a character's reveal is current, what its class earns from reactions counts 20% more
(`revealPerk: 0.2`, an engine setting). The same rate for every class: the tilt toward the left side that #683
proposed is now in section 1's base rate, so the perk only has to say that playing openly to the crowd pays. A revealed
Heel drawing real heat is the best-paid character in the game, which fits the most exposed position on the board.

Weighed: dropping the perk (revealing stays roleplay with nothing to gain, as the class-reveal design first decided);
a perk that halves a revealed character's losses from reactions (it answers the exposure directly, but it is a
defensive reward and leaves Thick Skin no use to a revealed character).

It keeps #683's rules for the rest, which this design adopts:

- **Current** means no Turn since the character's latest reveal. A reveal is an `unmask` Act, which a reveal from the
  character's page, a debut that names its class and an announced Turn that names its new class all write
  (`supabase/migrations/0027_unmask.sql`, `write_unmask`). Any Turn, announced or silent, ends the perk until a new
  reveal.
- **Only settlement reads it.** Whether a silent Turn happened is private, so the perk is The System's scoring under
  the exception CLAUDE.md names ("A response never proves a private fact"): nothing live, no badge and no profile
  line says whether it is up. The character's own log names its earnings plainly. The live estimate shows it for the
  caller's own characters, whose reveals and Turns the caller knows.
- **It pays on a gain and never on a loss,** and is added after a card's boost, so neither is boosted by the other.
- **What counts as "from reactions"** (the session's default, from #683's proposal, not a choice the owner was asked):
  the earnings a reaction to the character's own Acts caused, and the Lurker's calls: `face.cheered`,
  `heel.drewHeat`, `jabroni.drewTheGroan`, `technician.respected`, `technician.evergreen`,
  `tweener.splitTheRoom`, `lurker.calledIt` and `lurker.cardDrew`. Not a card's outcome (`face.liftedAPost`,
  `heel.stoleThunder`, `jabroni.soldTheL`, `tweener.stirredThePot`), a spun thread or a spark (`tweener.litTheFuse`,
  `tweener.outvoted`). A class marks the earnings it means; the engine names none.
- **Off Day** (a character scored as another class for a window) changes nothing about whether the reveal is current:
  a revealed Face scored as a Heel by Off Day is perked on the Heel's earnings. The card is legendary and the case is
  rare; it is left as it falls.

## 3. The Starter Pack swaps Rope Break for Hype-Up

**Decided:** the pack becomes Feelin' Fab, Hype-Up, Steel Chair, Whoops!, THIS and Autocorrect. The owner noted the
pack seed has not run on any instance, so nothing granted changes.

Hype-Up is a Sweet common cast on anyone's post that pays its author a flat vote more for each positive vote for 3
days, the same for every class, so casting it hints at nothing. It is a gift for a friend, which is good onboarding,
and it even helps a Heel (it cancels the calm loss on the post it is on).

Weighed: Required Reading (it brings a Gimmick into the pack, but it mostly serves the Technician and so hints at a
class when played early); Stick Around (a gag with no economy, so it teaches nothing about Aura).

What is lost: the pack's one Reversal, which the Starter Pack design counted among its reasons. A new player meets a
card back in a Booster pull or on another player's post, which is the better lesson. Rope Break stays a common on sale
at the machine.

## 4. Pop Steal

**Decided:** Pop Steal (Salty, common, 1.00, a Reversal set face down on one's own post). It springs on the first
Sweet common card cast there and catches it: the cast does nothing, and its card goes to the setter's hand. It is the
exact mirror of Rope Break (`instances/divided-world/cards/rope-break.ts`), the same configuration with `'sweet'`, and
needs no engine work. A "pop" is the crowd's cheer in wrestling, so the Heel steals it.

What it catches is what a Heel should want to: the Hype-Up every new player now holds, and a Face's 0.20 Feelin' Fab.
It is also a check on section 0's fifth problem: a Face that Fabs every rising post will one day Fab a Heel's trap.

Weighed: reaching uncommon (it would catch Jimmy Wails and Take the Fall, but it breaks the pairing, and a common
catching an uncommon goes against the rarity bound every Reversal keeps); letting the cast land and still taking the
card (louder, but it needs a new spring outcome, Pay It Forward's refund pointed at the setter, and so waits on Plays).

Its art is a scene in the cards' own manner (`instances/divided-world/ui/cards/README.md`), made by its build and
approved by the owner in review. Its subject is the build's to propose; the session's suggestion is a gloved hand
snatching a lit APPLAUSE sign off its hook, in Salty's colors.

## 5. A wrong call costs the Lurker

**Decided:** an early reaction whose quadrant is not where the post ends up costs what a right one pays:
`lurker.earlyMatch` times the vote's share, under a new reason, `lurker.misread`. It is judged at the moment a right
call is: in the window in which the post first has `lurker.crowd` other players, by where it leans then without the
Lurker's own vote. A post that ties (no single leading quadrant) costs nothing. An even bet: the owner chose it over a
miss at half, since the herd makes most calls easy.

So every reaction through the Lurker is a bet. A good reader still profits, a coin-flip reader breaks even, and
"react to everything as the Lurker" stops being free. It does not quiet a contrarian reaction: the post scores the
same whichever mask voices it, so a player who disagrees with the room gives that reaction through another mask, and
choosing which is the gotcha of having a Lurker on the team. A Lurker that spreads one vote over three quadrants now
loses (a third lands, two thirds miss), which fits the class's rule that a hedge is paid only the part that landed.

A miss is not a loss from a reaction the character received, so Thick Skin does not cushion it (the session's
default).

Weighed: votes on its cards costing where they are negative (it gives the Lurker a weakness to reactions, but leaves
the reacting farm untouched); both at once (the season review can add the second).

## 6. The Face's lift and the Tweener's stir halve

**Decided:** in a window, a character's first paying lift (`face.liftedAPost`) pays in full, and each further one pays
`settings.halving` of the one before, in the order the cards were played. The Tweener's `tweener.stirredThePot` halves
the same way, so the two rules that pay for reactions on another's post match. Only a play that pays counts in the
chain: a Fab that drew no hype does not halve the next. One or two good lifts a day still pay well, and a Face spraying
Fabs across the board tops out. It is the halving the catalyst uses for a character's repeated sparks
(`docs/plans/2026-11-18-tweener-catalyst-design.md`, section 4).

Weighed: capping each lift at a few votes (simpler to say, but it does not bound how many plays a Face makes); leaving
it (the easiest class keeps the highest ceiling, against section 1's pattern).

A class's rules are run once for each stretch of a class inside a window, so a Turn in the middle of a window starts
the chain again. That is left as it falls.

## 7. The masks

- **Section 1 and section 6** change only what a class's own rules return from what they are given today. A class
  already decides a character's settled sums; nothing new is read.
- **Section 2** reads `class_history`, a private fact, in settlement alone and in the caller's own estimate, and the
  times of a character's `unmask` Acts, which are public. A watcher of a revealed character's settled sums who sees
  them fall by a fifth may suspect a silent Turn; a Turn changes how the character scores far more than the perk does,
  and the exception accepts that settled sums can be read in a quiet stretch.
- **Section 4** is Rope Break's case, mirrored: a card back is a card back.
- **Section 5** reads the Lurker's own reactions, as `lurker.calledIt` already does, and shows only in its player's
  settled sums and own estimate.
- No response, payload, Realtime event or timing is added.

## 8. The layers

- **Engine:** the reveal perk: `Settings.revealPerk`, the reveal times in the settlement's and the estimate's input,
  a mark on an `Earning` that says a reaction caused it, and the `reveal.perk` entry. It names no class.
- **Instance (Divided World):** the two rates and the Heel's and Jabroni's rules; the Lurker's miss; the halving of the
  lift and the stir; which earnings each class marks as from reactions; Pop Steal; the Starter Pack's contents; the
  log's, the class descriptions' and the Strategy Guide's words.

## 9. States and ways out

None is added. The perk holds no one; Pop Steal's back is a set card, which springs once or ends by itself after
`setLasts`, as every set card does.

## Open

- Whether `face.liftedAPost` and `tweener.stirredThePot` should be perked (section 2 leaves them out).
- Whether Thick Skin should cushion a Lurker's miss (section 5 says not).
- Whether the Lurker's cards should be able to bomb (section 5), after the season review.
- Kick Me may lean toward the Jabroni more than the Heel; #683 already asks whether it is underpowered.
- The numbers: 2×, 20%, the even bet. The season review has them.
