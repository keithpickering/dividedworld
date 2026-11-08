# Face-down Moves: any card can be set, and Trap Card names its catch: design

Record, written 2026-11-07. A design session with the owner. It revises `docs/plans/2026-11-01-card-mechanic-design.md`
sections 3, 4, 6 and 10 where they say what a Set card is, and answers #233. Its plan is
`docs/plans/2026-11-07-face-down-moves-plan.md`.

## Why

Divided World had one real Set card, Trap Card, and Bluff, which lies about being one. Every new Set card the session first
proposed (a reply trap that splats, a quote trap that tapes) was a Cast card with a trigger baked in, so the shop would
have grown a copy of every Cast per trigger. The owner: "we should have the set card focus on the trigger more than the
effect. The effect can come from an actual play card." And on what a Set is worth: "it seems like both are sort of equal
actions so that points to just the ability to play the cards in multiple ways." Bluff gets more interesting, too: once a
card back can be anything in anyone's hand, one cheap Bluff deters every move at once.

## 1. One card, two plays

**Decided** (the owner chose the recommendation): every card that is cast on another's target can also be **set face
down** on one of the setter's own posts. The next post that **quotes** that post springs it, and that same card lands on
what quoted it, configured as the setter configured it when they set it.

- **One card is spent** per Set, as one is per Cast. Weighed: trigger cards that a Cast card is loaded into (two cards
  per Set, and a second product line); the owner did not count a Set as twice the worth of a Cast.
- **Setting costs nothing more** than the card (the owner chose the recommendation). A sprung card lands free, as a
  trap's strike does today, so a surcharge a Cast would pay on its target (Whoops!'s long-post price) is never paid by
  a Set. Setting is the gamble: it may never spring, and at its time it is gone. Weighed: charging the setter at spring
  time (a spring that fails for lack of money is a fact about the setter's wallet others could watch for); charging the
  most the play could cost up front with a refund (a lot for a gamble, and a refund to explain).
- **Use cards stay Use-only.** A Use lands on the player's own post, so setting it for someone else to set off does
  nothing.

## 2. The triggers

**Decided:** a Move springs on a **quote**: the next post that quotes the trapped post, by any character, a Mod Bot's
included (#233, the owner chose the recommendation). The set form has no trigger picker until a second trigger a Move
can carry exists ("says", below).

What was weighed and dropped:

- **A Move set on a cast** first caught the cast and took its card. The owner: "it's just 'sacrifice any unwanted card
  to potentially steal a card of that rarity or higher'... Since it seems this effectively nullifies the effect of
  whatever actual card you play, I wonder if it is a job for Spell Trap (a Set-only, as today) after all." The set card
  was a shell with a rarity, its own effect never used. Catching is Trap Card's again (section 4). A counter that lets
  the cast land and fires a character card back at the caster was weighed and dropped.
- **Reply** (the owner: "replying to a thread is not necessarily a response to any one post"). The first later post by
  another character catches whoever happens to post next.
- **Reaction.** A card cannot land on the character who reacted, because who reacted is a private fact. The owner chose
  to drop the trigger rather than land it on the trapped post itself.
- **Visit** as a trigger players choose. Any card set on it only ended the visit, so which card did not matter. It is a
  Gimmick's (section 4).
- **Says** is open (below): a trigger on what a later post says, weighed and wanted, waiting for a cost design.

## 3. Where a sprung Move lands

**Decided:** on what quoted it, at the card's own reach: a post card on the quoting post, a character card on the
quoting post's character, a thread card on the quoting post's thread, a board card on that thread's board.

- **A sprung card that cannot land** leaves the back set for the next quote: its target already holds its stack of the
  card, a board already carries its one live board card, or a card's own landing condition fails (Autocorrect's
  phrase, section 6). The quote lands as if no card were there. **A trap never refuses, delays or rolls back the write
  that springs it** (the card mechanic design, section 4, unchanged).
- **No rarity bound.** A sprung Move cancels nothing, so it needs none.

## 4. Kinds of card: Move, Gimmick, Ward

**Decided:** the play tag on a card's face names what kind of card it is, in the instance's words. Divided World's are
**Move** (cast, or set to spring on a quote), **Gimmick** (set only) and **Ward** (Use). The owner chose them over
"Spell / Trick / Ward" and over listing the plays ("Cast · Set"). The engine's plays stay `cast`, `use` and `set`, and
the instance names each one through its copy.

The Gimmicks each spring on a trigger of their own, held as privately as the card:

- **Trap Card** (Salty, uncommon): the setter **names the exact card** they expect, as Minus World's Spell Trap did. The
  next cast of that card on the post is **caught**: its Act stays and shows as caught, it does nothing else, and **its
  card goes into the setter's hand**. Any other card passes over it and lands as usual, and the back stays set.
  - **Any card can be named, at any rarity** (the owner chose the recommendation). Guessing the exact card is the hard
    part, and the caster saw a card back and cast anyway. The card mechanic design's rarity bound (a rare should not be
    wasted on a cheap trap) weighs less once the trap had to name it. Weighed: keeping the bound; rarer trap cards that
    lift it.
  - **The steal replaces the payout** (the owner chose the recommendation, after asking whether stealing was ruled
    out). No money moves between players through traps. The card mechanic design dropped stealing because "it would be
    the first card moving between players"; that was caution, not a rule. A steal is one more row in the setter's card
    ledger, while the caster's `played` row stays. A player casting on their own other mask's trap gets their card back,
    which only breaks even. Weighed: steal and payout both; catch with neither.
  - **A caught Mod Bot card** gives the setter a new copy, a rare drop from The System (the owner chose the
    recommendation). The pool's one card per post and its rarity cap (`pool.cardRarityMost`) bound how many are made.
  - **A Mod Bot's Trap Card** catches a player's card, and the card is spent, since staff hold no hand.
- **Hall Pass** (Sweet, uncommon, new): ends the next Mod Bot visit to its post when the visit starts. The visit's Acts
  stay. Its spring is a public Act that draws reactions and settles under its alignment, as any spring does
  (`engine/rules/settle.ts`), so a great save earns its setter by class: a Face's rescue. The owner named it; "Get Out
  of Jail Free" is Monopoly's card. Weighed: Alibi, Lawyer Up.
- **Bluff** (Pepperoni, common): a card back that does nothing. It never springs, and it ends at `setLasts` with nothing
  revealed. Its alignment only colors it, since it never draws a play's reactions; giving the engine an "unaligned"
  value would touch the type, settlement and every class rule to change a color (the owner agreed).

So a card back now means: perhaps a Trap Card waiting for one card, perhaps a Move waiting for a quote, perhaps a Hall
Pass waiting for a Mod, perhaps a Bluff.

## 5. The masks

- **One back for every card.** Every set sits on one of the setter's own posts, one back per post, the same back
  whatever is face down. The owner chose this over setting "on the thread" because a back's place is public, and a
  place that differs by kind of card would show it.
- **The card and its configuration** (a Move's settings, a Trap Card's named card) live only in the setter's `face_down`
  row. The Set Act, its Realtime event and `card_target` name none of them, as today.
- **Even work.** Every write that can spring a back does the same reads for every back it meets, before anything is
  decided: a Bluff, a Trap Card naming another card, a Move whose card cannot land, and a back that springs. Only the
  spring itself differs, and it is public. This is the trap-locks design's rule
  (`docs/plans/2026-11-03-trap-locks-design.md`, #136 F4), extended to the reads a sprung Move's landing makes.
- **A post checks less than it does today.** Without the reply trigger, a new post meets only the back on the post it
  quotes, never every live back in its thread. `face_down_reply` and the reply-pass probe go.
- **The steal** writes a row only to the setter's own ledger. The spring names the caught card in public, as today. No
  answer to anyone else carries the setter's account, and no refusal reads an owner.

## 6. Autocorrect on a quote

**Decided** (the owner, sharpening "Not on reply"): a set Autocorrect springs on the next quote, and lands only if its
phrase is in the quoting post's own words: not in the quoted text, a code block or a link, which is how Autocorrect's
matcher reads a post (`instances/divided-world/cards/autocorrect/match.ts`). A quote without the phrase lands no card,
and the back stays set for the next quote. The owner: "the appeal here is being able to predict what somebody will say
in response to your post, so the payoff comes when you guessed it right."

So a card may name a phrase its landing needs, through `CardRules`. The server checks it inside the write that springs
the back, so the engine holds one SQL matcher that must agree with the TypeScript one on every post. The plan holds them
together with a parity test over a shared table of cases.

## 7. The struck player feels it

**Decided** (the owner: the receiver "should feel that impact just as the caster does"): a card that lands from a back is
told apart from a card cast, everywhere the struck player meets it.

- **The alert** (`trapStruck`, already its own kind beside `cardOnYours`) names the setter's character, says the card was
  set ahead of time and how long before, and names what set it off. In plain words, then in the instance's voice:
  "Pipewrench saw this coming. Their face-down Whoops! sprang when you quoted their post, two days after they set it."
- **The caught caster's alert** says a Trap Card named their exact card, and that the card is now the setter's.
- **The Lens** on a sprung card shows it as sprung, "Set face down by Pipewrench on 5 November; sprang when Spritey
  quoted it", beside the spring Act.
- **The log** says, for the setter, what sprang, what it landed on or caught, and which card came into their hand; for
  the struck and the caught, what happened to them and who did it.

Everything named is public once the back springs: the spring names the card, the trigger and the setter's character. The
struck player always gets the alert, a staff setter's included (#226's question, answered as the build left it). The
glass may gloat ("saw this coming"); it never bluffs.

## 8. The screen: the play form (the glass)

**Decided** (the owner chose the recommendation): arming works as it does today. A Move's ghost marks show on others'
posts and on the player's own. Opening the play form on one's own post adds a two-way choice at its top, **Play it now**
or **Set face down**; casting on one's own post still works. Choosing Set swaps the price and message rows for what the
set will do, and keeps the card's own settings:

```
┌ PLAY FORM · Whoops! · your post #41 ─────┐
│ [ Play it now ] [▸Set face down ]        │
│                                          │
│ Springs when someone quotes this post,   │
│ and lands on the post that quotes it.    │
│                                          │
│ Ink: [green ▾]                           │
│ Ends by itself in 7 days.                │
│                 [Cancel] [Set face down] │
└──────────────────────────────────────────┘
```

A Gimmick's form opens as Set, with no choice, and says plainly what the Gimmick does. Trap Card's form holds one
setting, the card it names, picked from every card that can be cast on a post (not only the setter's hand). The picture
is the session's sketch; the plan runs impeccable's `shape` step on it with the owner. Weighed: two buttons on every card
in the hand (Cast and Set); a "Set a card" action on one's own posts (the board's 2003 chrome holds no glass, which the
owner ruled before).

## 9. What the change does to what an instance holds

- **Trap Card backs already face down** name no card, so they catch nothing and end at `setLasts`. No `face_down` row is
  edited ("Append-only"). No instance is deployed, so no player holds one.
- **Reply and reaction backs** come only from test cards; they end by themselves at `setLasts`.
- **Payouts already paid** stay in the wallet ledger under their kinds (`trap`, `trapSystem`); nothing new is written
  under them.

## 10. Ways out of the states this adds

- **A face-down Move or Gimmick:** springs once, or ends by itself at `setLasts`. A back whose card cannot land waits for
  the next quote or its time.
- **A caught play:** a finished Act. Its card is now the setter's, or spent where the setter is staff.
- **A stolen card:** a card in the setter's hand like any other.
- **A visit a Hall Pass ended:** a finished visit, ended by its spring (`visit_end` trapped, as today).

## Open

- **Says.** Springs on the next new post later in the thread, by another character, whose own words contain a phrase
  the setter picks (whole words, any case; quoted text does not count; edits never spring it, of posts written before
  the set or after). Any Move could be set on it ("splat a green Whoops! on whoever next says a certain phrase"), and
  Autocorrect's phrase would be its trigger phrase. With it, the set form gains a trigger picker. The owner calls it a
  nice-to-have beside quote. Its cost: each new post checks every live back in its thread plus a phrase match each, as
  the reply trigger's probe does today. Its design settles that at a busy thread's scale first, for example a cap on
  live backs per thread, which is public since backs are.
- **A Mod Bot setting a Move.** A persona sets Gimmicks only. A Move set by a persona is a choice of card and settings
  through the persona's options (`CardRules.staffOptions`), weighed when the pool is next designed.
- **Rarer trap cards**, if the season review finds Trap Card's unbounded catch too strong.
