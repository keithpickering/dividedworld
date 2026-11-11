# Card types: Moves, Reversals and Gimmicks: design

Record, written 2026-11-11. A design session with the owner. It revises `docs/plans/2026-11-01-card-mechanic-design.md`
sections 1, 4, 5 and 6, and `docs/plans/2026-11-07-face-down-moves-design.md` sections 1 and 4, where they say what kinds
of card there are, what a card's flavor means, what a ward is, and what happens to a face-down card that never springs.
Its plan is `docs/plans/2026-11-11-card-types-plan.md`.

## Why

The owner, on the pool as it stood: "it can be difficult to tell the 'effect' cards like whoops/fab/stick around (moves)
from cards that are used differently at a glance. And among the ones that are not moves, there's another distinction
to make between face up and face down. Something like 'hall pass' begins to blur the line between a Trap and a buff."

Three more things came out of the session:

- **The ward kind had one card and one job.** Force Field turned away casts by rarity and nothing else, so "Ward" named
  a single card's rule, not a kind of card.
- **Flavor did nothing on a card played on one's own post.** A class scores a play only when it is on another player's
  target (`onOthers`, `engine/rules/settle.ts`). A spring's Act sits on the setter's own post and a ward on the user's
  own, so Trap Card's Salty and Force Field's Sweet scored for no class. The 11-07 design's "a great save earns its
  setter by class: a Face's rescue" never held in code.
- **Bluff had outstayed its use.** Once any Move can be set face down, a cheap Move with a condition that almost never
  matches is a better bluff, because it might actually spring.

## 1. Three types

**Decided** (the owner's draft, refined in session). Divided World names the engine's three plays:

| Play | Divided World's word | What it is |
|---|---|---|
| `cast` | **Move** | Played face up on any target its reaches allow, or set face down on one's own post to spring on a quote |
| `set` | **Reversal** | Set face down on one's own post only. Springs once, on something aimed at the post |
| `use` | **Gimmick** | Played face up on one's own post, one of one's own characters, or a thread one of one's own characters started. Lasts a stated time |

- **"Trap" names a state, not a type.** Any face-down card is a trap, a Move or a Reversal. The owner: "a Move also
  becomes a Trap when it's face-down, whereas Reversal is a distinct card type that is only played as a Trap." A card
  is "set as a trap"; a trap springs.
- **The engine's words stay `cast`, `set` and `use`.** The kind words are the instance's copy (`UiCopy.cardKinds`).
- **Keep** stays named and unbuilt, as the card mechanic design left it.

Weighed: "Trap" as the type's name (it would also name every face-down Move); "Ward" and then "Buff" for the face-up
kind (the owner: "Gimmick might even be a better term for Ward/Buff: it implies a temporary nature"); dividing the types
by who an effect lands on, which would make Hall Pass a face-down Gimmick and blur the line the owner wanted drawn.

## 2. Flavor is face or heel conduct

**Decided** (the owner chose the recommendation): a card's flavor says which side of the face/heel line the play is on,
for every type.

- **Sweet** is babyface work: a Move that helps, a Reversal that makes a clean save, a Gimmick that rewards clean play.
- **Salty** is heel work: a Move that gets in the way, a Reversal that is a dirty counter, a Gimmick that rewards
  underhanded play.
- **Pepperoni** could read as either, and the room's reactions decide which at settlement, as today.

The owner: "it finally gives the flavor something to do for the different card types without feeling arbitrary or
forced."

Weighed: flavor as what an effect does to whatever it lands on (nearly every Reversal would be Salty, so clean saves
and dirty counters could not both exist); flavor for Moves only (it loses Salty Gimmicks, and the 11-07 design found
that an "unaligned" value touches the type, settlement and every class rule).

## 3. How flavor scores

**Decided** (the owner chose the recommendation for both):

- **A Reversal's spring scores as a play on the Act that sprang it.** For a catch, that is the caught cast, whose
  character is the caster. For Hall Pass, it is the Mod Bot's visit, which is staff and so another's. Every class rule
  then reads a spring as it reads any play:
  - a clean save the room loves earns a Face;
  - a dirty counter that outdraws the play it caught earns a Heel;
  - a Jabroni whose play is dirty-countered "sells the L".

  A spring on one's own other mask's play is on one's own player, so it scores for no class, as any such play does.
- **A Gimmick's play never scores by flavor.** Its effect is the payoff (Heat Magnet's boost is what a Heel or Jabroni
  gets from it). This also shuts out a Jabroni earning "a Salty card landed on me" from its own Salty Gimmick.
- **Reactions to either type's Act** still count for Lurker and Technician, which read reactions to a card's Act
  whatever its flavor.

Weighed: scoring a spring only on its own Act (flavor stays a label); new class rules per Reversal (a class-balance
design of its own); counting a Gimmick as a play on oneself (self-farming, and an exception in every class rule).

## 4. What a Reversal springs on

**Decided** (the owner chose the recommendation): a Reversal springs only on something aimed at its post:

- **a cast on the post**, matched by the card's name (Card Collector's), its printed flavor, or its rarity; or
- **a Mod Bot's visit** to the post (Hall Pass's).

The rules around it:

- **The quote stays the face-down Move's trigger.** So the two face-down types never overlap, and quoting a post is
  never the attack a Reversal punishes.
- **A Reversal matches the flavor printed on the card.** A Pepperoni card's flavor is decided only at settlement, so
  Pepperoni is its own category to a Reversal: one that matches Salty casts lets Pepperoni through, and one could name
  Pepperoni.
- **A Reversal names or matches only cards at or below its own rarity.** This is the card mechanic design's rarity
  bound, back for Reversals. The 11-07 design had let Trap Card name any rarity. The owner's Card Collector names only
  common and uncommon Moves; it is uncommon, so the bound gives it that range with no new setting.
- **Every Reversal has a trigger.** A set card that can never spring is gone with Bluff (section 7).
- **What a matched cast spring does** is the engine's, as today: the cast is caught, does nothing else, and its card
  goes into the setter's hand (the 11-07 steal). A visit spring ends the visit.

Weighed: adding the quote, which would make a Move and a Reversal on the same back indistinguishable even in principle
and quoting riskier in a way the face-down Move already covers; any interaction, reactions included, which would reveal
who reacted.

## 5. Gimmicks

**Where** (the owner chose the recommendation): one's own post, one of one's own characters, or a thread one of one's
own characters started. Who started a thread is public, so the check reveals nothing. A Gimmick on a thread is a match
stipulation, and it affects everyone who posts there, who chose to post in that thread. A Gimmick never goes on a
board, and never on another's thread (that would be griefing).

**What** (the owner chose the recommendation): the engine holds a fixed list of Gimmick effects, and each card picks
one and sets its numbers, as a Reversal picks its trigger. The first three:

- **Ward.** Turns away casts on the Gimmick's own target: those at or below a rarity, those of named printed flavors,
  or those of named cards. It refuses on its own target only, never on what is under it. It never blocks a Set or a
  Use, as today. Its refusal is public and the same for every caster ("this post's Force Field turns away cards up to
  uncommon").
- **Earn.** Raises what reactions earn the character it is on, or the post it is on. It names the reactions by quadrant
  or by kind (the instance's reaction keys), and a fraction it adds. **It only raises an earning and never deepens a
  loss**, so a Face with Heat Magnet does not lose more to negative reactions. It is applied in settlement, for
  reactions given while it is up.
- **Price.** Adds a flat amount to what a cast of named printed flavors costs to play on its target or anything under
  it, and the amount is spent: it goes to nobody. The price of a play is never below zero. It is flat, not a percentage,
  because most cards cost nothing to play (only Whoops! and Autocorrect have play prices); a card's buy price is the
  Vending Machine's, the same on every thread.

Each Gimmick lasts a stated time and then ends by itself. A new kind of effect is engine work with its own plan, as a new
trigger is.

Weighed: each Gimmick as instance code the engine calls (`play_card` and settlement cannot run instance code; the card
mechanic design rejected an open hook on the same ground); wards alone first (the design states the full form, since
nobody is waiting on it).

## 6. A face-down card comes back

**Decided** (the owner chose the recommendation): a face-down card goes back to its setter's hand at any time before it
springs, and a face-down card whose time ends unsprung goes back to the hand too. A card is spent only when it is cast
or springs.

The owner: "The trade-off of leaving something face down is simply that you can't use it elsewhere, and taking it back
into the hand removes the trap." It is also kind to a player who is away for a while.

- **Taking a card back is a public Act** by the post's author: "Pipewrench took back a face-down card." It names no
  card. The back's going is public anyway.
- **Every take-back does the same work** whatever the card is.
- **This reverses the 11-07 design's "Setting is the gamble: it may never spring, and at its time it is gone."** The
  cost of a set is now that the card is tied up.

Weighed: take-back with expiry still spending the card (it only punishes forgetting); a fee for taking a card back
(keeps the gamble and makes backs rarer).

## 7. Bluff is deleted

**Decided:** the owner: "A bluff is as simple as placing a cheap move face down with an almost impossible condition."
No instance is deployed, so no database holds a Bluff play. Its tests, fixtures and boards move to a cheap face-down
Move, and "a Gimmick with none is a bluff" leaves the engine.

Weighed: retiring it (keep its rules so old plays settle, stop offering it). That is the right form for a deployed
instance, and a general need then (open, below), but nothing needs it today.

Bluff's removal does little for how many backs there are, because what makes backs cheap is section 6. If backs ever
feel too common, the lever is a cap on live backs per character (open, below).

## 8. The cards

**Decided** (the owner named the new cards; rarities and numbers are starting economy settings the season review
replaces):

| Card | Type | Flavor | Rarity | What it does |
|---|---|---|---|---|
| **Card Collector** (was Trap Card) | Reversal | Salty | uncommon | Names a common or uncommon Move. The next cast of it on the post is caught, and its card goes into the setter's hand |
| **Hall Pass** | Reversal | Sweet | uncommon | Ends the next Mod Bot visit to the post when it starts |
| **Force Field** | Gimmick (Ward), own post | Sweet | uncommon | Turns away casts up to uncommon, for a week |
| **Publicity Tour** | Gimmick (Earn), own character | Sweet | uncommon | +10% from excited-positive and calm-positive reactions, for 36 hours |
| **Heat Magnet** | Gimmick (Earn), own character | Salty | uncommon | +10% from excited-negative and bored-negative reactions, for 36 hours |
| **Class Clown** | Gimmick (Earn), own character | Pepperoni | uncommon | +50% from 😂 and 🙄, for 36 hours |
| **Good Vibes** | Gimmick (Price), own thread | Sweet | uncommon | Salty Moves cost 0.25 orbs more to play in the thread, for 3 days |

Good Vibes was first "Sweet Moves cost less in this thread". The owner chose a surcharge on Salty casts once the
session found that every Sweet Move is free to play, so a discount would save nothing. The surcharge is spent, so no
money moves between players through a card (the 11-07 rule).

The new cards' art is placeholder art in the existing style; the final art is open.

## 9. The faces

**Decided** (the owner chose A of three mockups, made over the live `Postcard`): the frame says the type.

- **Move:** a single solid frame, as today.
- **Reversal:** a double frame with a folded corner.
- **Gimmick:** a dashed, ticket-like frame.

The flavor keeps the frame's color, and the type badge keeps its word. The frame's lines hold at the hand's sizes, where
the badges are not drawn. **A card back is the same for every card**: the owner turned down the silhouettes because
"different shapes would not look the same from the back". Weighed: a type band across the card's foot; a silhouette
per type.

## 10. The masks

- A Ward's refusal and a Reversal's match read only what is printed on the incoming card (its name, flavor and rarity),
  which is public. A refusal is the same for every caster.
- Whether a thread is the caller's own is read from the thread's starting character, which is public, against the
  caller's own characters. The refusal tells the caller only about their own characters, as a Use on another's post
  does today.
- A take-back is an Act by the post's author that names no card, and does the same work whatever the card is. A back
  ending at its time, and its card's return, write nothing anyone else can read.
- Earn and spring scoring are applied only inside settlement, which already reads who owns what, and shows only each
  settled window's sums ("A response never proves a private fact", the scoring exception).
- A Price surcharge is read from the target's public effects and the card's printed flavor.

## 11. Ways out

- **A face-down card** springs once, is taken back, or ends at its time. The last two return it to the hand.
- **A Gimmick** ends by itself at its time, or by an admin's end.
- **A cast turned away by a Ward** is refused before it is written; the caster keeps the card and the money.
- **A caught cast** is a finished Act, as today.

## 12. The layers

The engine names no card, no kind word and no reaction. The Gimmick effects and the Reversal match are engine types
(`CardRules`); Divided World's cards choose them, and its kind words, art and copy come through `CardUi` and `UiCopy`.
The engine's own strings that say "Gimmick" today move to its neutral words ("set", "use").

## Open

- **The reply and "Says" triggers for face-down Moves.** The owner would like reply back ("it's no more powerful than
  waiting for the reply before casting manually"). Both need each new post to check every live back in its thread, so
  they are designed together, with that cost at a busy instance's scale.
- **A use count for Gimmicks** ("cleared after a certain number of covered events"). No first card needs one. Counting
  a Ward's refusals needs a write that a refusal does not make today, so it waits for its first card.
- **A cap on live backs per character**, if backs come to feel too common.
- **Retiring a card**, once an instance is live: keep its rules so old plays settle, and stop offering it anywhere.
- **Cards for later designs:** Be Nice (a Sweet Reversal that returns a Salty cast to its caster's hand and locks the
  caster character out of Salty casts until it casts a Sweet one on the post, with a timed way out too); Hot Potato (a
  Pepperoni Reversal whose back moves to whoever quotes the post); a Salty Reversal that siphons the caster's active
  Gimmick; Gimmicks that set posting rules; "doubling" effects, which need a strength on every Move.
- **Final art** for Card Collector's rename and the four new cards.
- **Pepperoni that reads "thread state"**, from the owner's draft, beside the room's reactions.
