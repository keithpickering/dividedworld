# Face-down Moves: any card can be set, and the trigger is the setter's choice: design

Record, written 2026-11-07. A design session with the owner. It revises `docs/plans/2026-11-01-card-mechanic-design.md`
sections 3, 4, 6 and 10 where they say what a Set card is, and answers #233. Its plan is
`docs/plans/2026-11-07-face-down-moves-plan.md`.

## Why

Divided World had one real Set card, Trap Card, and Bluff, which lies about being one. Every new Set card the session first
proposed (a reply trap that splats, a quote trap that tapes) was a Cast card with a trigger baked in, so the shop would
have grown a copy of every Cast per trigger. The owner: "we should have the set card focus on the trigger more than the
effect. The effect can come from an actual play card." And on what a Set is worth: "it seems like both are sort of equal
actions so that points to just the ability to play the cards in multiple ways." Bluff gets more interesting, too: once a card back can be
anything in anyone's hand, one cheap Bluff deters every move at once.

## 1. One card, two plays

**Decided** (the owner chose the recommendation): every card that is cast on another's target can also be **set face
down** on one of the setter's own posts, with a trigger the setter chooses. When the trigger fires, that same card
lands on what set it off, configured as the setter configured it when they set it.

- **One card is spent** per Set, as one is per Cast. Weighed: trigger cards that a Cast card is loaded into (two cards
  per Set, and a second product line); the owner did not count a Set as twice the worth of a Cast.
- **Setting costs nothing more** than the card (the owner chose the recommendation). A sprung card lands free, as a
  trap's strike does today, so a surcharge a Cast would pay on its target (Whoops!'s long-post price) is never paid by
  a Set. Setting is the gamble: it may never spring, and at its time it is gone. Weighed: charging the setter at spring
  time (a spring that fails for lack of money is a fact about the setter's wallet others could watch for); charging the
  most the play could cost up front with a refund (a lot for a gamble, and a refund to explain).
- **Use cards stay Use-only.** A Use lands on the player's own post, so setting it for someone else to set off does
  nothing.
- **Trap Card is retired** (the owner: "ax spell trap as its own unique card and just have that be one of the
  triggers"). Its catch is now the cast trigger's (section 2), which any card can carry.

## 2. The triggers

**Decided:** two triggers a setter chooses from, each held as privately as the card (section 5):

- **cast:** the next card cast on the post, at or below the set card's rarity, is **caught**. Its Act stays and shows
  as caught, it does nothing else, and **its card goes into the setter's hand** (the owner chose the recommendation,
  after asking whether stealing was ruled out). A rarer card passes over it, lands as usual, and the back stays set. A
  card set on cast that reaches a character also lands on the caster. A post card set on cast only catches, since the
  caster has no post here for it to land on.
- **quote:** the next post that quotes the trapped post, by any character, a Mod Bot's included (#233, the owner chose
  the recommendation). The card lands on what that post is at the card's reach (section 3).

What was weighed and dropped:

- **The steal replaces the payout.** No money moves between players through traps. The card mechanic design dropped
  stealing because "it would be the first card moving between players"; that was caution, not a rule. A steal is
  one more row in the setter's card ledger, while the caster's `played` row stays. The masks hold (section 5), and a
  player casting on their own other mask's back gets their card back, which only breaks even. Weighed: steal and payout
  both (two payoffs to explain), and catch with no payout or steal.
- **A caught Mod Bot card** gives the setter a new copy, a rare drop from The System (the owner chose the
  recommendation). The pool's one card per post and its rarity cap (`pool.cardRarityMost`) bound how many are made.
  Weighed: catching a Mod Bot's card and making nothing.
- **Reply is dropped.** The owner: "replying to a thread is not necessarily a response to any one post." The first
  later post by another character catches whoever happens to post next.
- **Reaction is dropped.** A card cannot land on the character who reacted, because who reacted is a private fact. The
  owner chose to drop the trigger rather than land it on the trapped post itself.
- **Visit is no longer a trigger.** Any card set on it only ended the visit, so which card did not matter. It is a
  Gimmick's now (section 4).
- **Says is open** (below): a trigger on what a later post says, weighed and wanted, waiting for a cost design.

## 3. Where a sprung card lands

**Decided:** on what set it off, at the card's own reach.

| Trigger | A post card | A character card | A thread card | A board card |
|---|---|---|---|---|
| quote | the quoting post | the quoting post's character | the quoting post's thread | that thread's board |
| cast | (it only catches) | the caster | the trapped post's thread | that thread's board |

- **The set form offers only the triggers a card can land on.** Every Move lands on a quote. On cast, a post card's
  set is a catch. A card may narrow its own triggers (section 6, Autocorrect).
- **A sprung card that cannot land** leaves the back set for the next one: its target already holds its stack of the
  card, a board already carries its one live board card, or a card's own landing condition fails (Autocorrect's
  phrase). The write that set it off lands as if no card were there. **A trap never refuses, delays or rolls back the
  write that springs it** (the card mechanic design, section 4, unchanged).
- **The rarity bound** applies only to the cast trigger's catch. It exists so a rare card is never wasted by being
  caught by something commoner. A sprung card on a quote cancels nothing, so it needs no bound.
- **A thread card set on cast lands on the trapped post's thread**, which is the setter's own. A Main Event set on cast
  pins the thread its setter posted in. That is legal and the setter's choice.

## 4. Kinds of card: Move, Gimmick, Ward

**Decided:** the play tag on a card's face names what kind of card it is, in the instance's words. Divided World's are
**Move** (cast or set), **Gimmick** (set only) and **Ward** (Use). The owner chose them over "Spell / Trick / Ward" and
over listing the plays ("Cast · Set"). The engine's plays stay `cast`, `use` and `set`, and the instance names each one
through its copy.

The Gimmicks:

- **Bluff** (Pepperoni, common): a card back that does nothing. It never springs, and it ends at `setLasts` with nothing
  revealed. Its alignment only colors it, since it never draws a play's reactions; giving the engine an "unaligned"
  value would touch the type, settlement and every class rule to change a color (the owner agreed).
- **Hall Pass** (Sweet, uncommon): ends the next Mod Bot visit to its post when the visit starts. The visit's Acts
  stay. Its spring is a public Act that draws reactions and settles under its alignment, as any spring does
  (`engine/rules/settle.ts`), so a great save earns its setter by class: a Face's rescue. The owner named it; "Get Out
  of Jail Free" is Monopoly's card. Weighed: Alibi, Lawyer Up.
- **Trap Card** leaves the shop. Its kind stays in the instance as a **retired** card, for the Acts and ledgers that
  name it (section 9).

A Gimmick's trigger is its own and fixed (Hall Pass on a visit), and it is held privately like any card. A Gimmick has
no Cast form, and the play form never offers one.

## 5. The masks

- **One back for every card.** Every set sits on one of the setter's own posts, one back per post, the same back
  whatever is face down. The owner chose this over setting "on the thread" because a back's place is public, and a
  place that differs by trigger would show the trigger.
- **The card, the trigger and the card's configuration** live only in the setter's `face_down` row. The Set Act, its
  Realtime event and `card_target` name none of them, as today.
- **Even work.** Every write that can spring a back does the same reads for every back it meets, before anything is
  decided: a Bluff, a back on another trigger, a back whose card cannot land, and a back that springs. Only the spring
  itself differs, and it is public. This is the trap-locks design's rule (`docs/plans/2026-11-03-trap-locks-design.md`,
  #136 F4), extended to the reads a sprung Move's landing makes (its target's stack at its reach, a board's live card).
- **A post checks less than it does today.** Without the reply trigger, a new post meets only the back on the post it
  quotes, never every live back in its thread. `face_down_reply` and the reply-pass probe go.
- **The steal** writes a row only to the setter's own ledger. The spring names the caught card in public, as today. No
  answer to anyone else carries the setter's account, and no refusal reads an owner.
- **The setter's character is public** on the spring, as it is today. Who owns it is not.

## 6. Autocorrect on a quote

**Decided** (the owner chose "Not on reply", then sharpened it): Autocorrect is set on **quote** only. It springs on the
next quote, and lands only if its phrase is in the quoting post's own words: not in the quoted text, a code block or a
link, which is how Autocorrect's matcher reads a post (`instances/divided-world/cards/autocorrect/match.ts`). A quote
without the phrase lands no card, and the back stays set for the next quote. The owner: "the appeal here is being able
to predict what somebody will say in response to your post, so the payoff comes when you guessed it right."

So a card may say two things about being set, through `CardRules`: the triggers it accepts, and a phrase its landing
needs. The server checks the phrase inside the write that springs the back, so the engine holds one SQL matcher that
must agree with the instance's TypeScript one on every post. The plan holds them together with a parity test over a
shared table of cases.

## 7. The struck player feels it

**Decided** (the owner: the receiver "should feel that impact just as the caster does"): a card that lands from a
back is told apart from a card cast, everywhere the struck player meets it.

- **The alert** (`trapStruck`, already its own kind beside `cardOnYours`) names the setter's character, says the card
  was set ahead of time and how long before, and names what set it off. In plain words, then in the instance's voice:
  "Pipewrench saw this coming. Their face-down Whoops! sprang when you quoted their post, two days after they set it."
- **The caught caster's alert** names the card that caught theirs, and says the card is now the setter's.
- **The Lens** on a sprung card shows it as sprung, "Set face down by Pipewrench on 5 November; sprang when Spritey
  quoted it", beside the spring Act.
- **The log** says, for the setter, what sprang, what it landed on or caught, and which card came into their hand; for
  the struck and the caught, what happened to them and who did it.

Everything named is public once the back springs: the spring names the card, the trigger and the setter's character.
The struck player always gets the alert, a staff setter's included (#226's question, answered as the build left it).
The glass may gloat ("saw this coming"); it never bluffs.

## 8. The screen: the play form (the glass)

**Decided** (the owner chose the recommendation): arming works as it does today. A Move's ghost marks show on others'
posts and on the player's own. Opening the play form on one's own post adds a two-way choice at its top, **Play it now**
or **Set face down**; casting on one's own post still works. Choosing Set swaps the price and message rows for the
trigger picker and the card's own settings:

```
┌ PLAY FORM · Whoops! · your post #41 ─────┐
│ [ Play it now ] [▸Set face down ]        │
│                                          │
│ Springs when:                            │
│  ○ someone casts a card on this post     │
│    (catches it; you take the card)       │
│  ● someone quotes this post              │
│                                          │
│ Ink: [green ▾]                           │
│ Lands on the post that quotes yours.     │
│ Ends by itself in 7 days.                │
│                 [Cancel] [Set face down] │
└──────────────────────────────────────────┘
```

A Gimmick's form opens as Set, with no choice and no trigger picker (its trigger is fixed), and says plainly what the
Gimmick does. Weighed: two buttons on every card in the hand (Cast and Set); a "Set a card" action on one's own posts
(the board's 2003 chrome holds no glass, which the owner ruled before).

## 9. What the change does to what an instance holds

- **Trap Card is retired, not deleted.** The engine adds `CardRules.retired`. A retired card stays in the instance so
  its Acts settle and its log lines name it. The Vending Machine does not sell it. A copy still held can still be set,
  as a Gimmick on the cast trigger, which now catches and steals. This is the session's default for the first retired
  card, so a season can retire a card the same way; the owner may revise it.
- **Backs already face down** keep their card's own trigger: a back with no stored trigger reads its card's
  (`card_kinds.trap`), so no `face_down` row is edited ("Append-only").
- **Reply and reaction backs** on an instance that holds them: the instance's cards carry neither trigger once this
  lands, so a back on one comes only from a test card, and it ends by itself at `setLasts`.
- **Payouts already paid** stay in the wallet ledger under their kinds (`trap`, `trapSystem`); nothing new is written
  under them.

## 10. Ways out of the states this adds

- **A face-down Move or Gimmick:** springs once, or ends by itself at `setLasts`. A back whose card cannot land waits for
  the next trigger or its time.
- **A caught play:** a finished Act. Its card is now the setter's, and nothing remains to clear.
- **A stolen card:** a card in the setter's hand like any other.
- **A visit a Hall Pass ended:** a finished visit, ended by its spring (`visit_end` trapped, as today).

## Open

- **Says.** Springs on the next new post later in the thread, by another character, whose own words contain a phrase
  the setter picks (whole words, any case; quoted text does not count; edits never spring it, of posts written before
  the set or after). Any Move could be set on it ("splat a green Whoops! on whoever next says a certain phrase"), and
  Autocorrect's phrase would be its trigger phrase. The owner calls it a nice-to-have beside cast and quote. Its cost:
  each new post checks every live back in its thread plus a phrase match each, as the reply trigger's probe does
  today. Its design settles that at a busy thread's scale first, for example a cap on live backs per thread, which is
  public since backs are.
- **A Mod Bot setting a Move.** A persona sets only Gimmicks for now. A Move set by a persona needs its trigger among the
  persona's options (`CardRules.staffOptions`), and a back that catches a player's card into a staff hand that does not
  exist.
- **The rest of section 4's triggers**, if a later card wants one: a new trigger is engine work, as before.
