Record, written 2026-11-20.

# The refund outcome: Kick Me and Pay It Forward: design

A design session with the owner for the two cards that share one piece of engine work, a cast that lands and whose card
goes back to its caster's hand: **Kick Me** (Pepperoni, common, Gimmick on one's own post) and **Pay It Forward**
(Sweet, uncommon, Reversal). Both are in wave 3 of `docs/plans/2026-11-14-base-set-design.md`, and both rows (rarity,
price, words) were settled by `docs/plans/2026-11-15-base-set-card-numbers-design.md` (section 3). Their art is
already rendered (`instances/divided-world/ui/cards/kick-me/`, `instances/divided-world/ui/cards/pay-it-forward/`).
The roadmap gave the refund outcome to a Plays design session. No Plays design has been written, so, as Whoopee
Cushion's session did for its ride, this session settles the refund outcome and plans it with the two cards. Its plan
is `docs/plans/2026-11-20-refund-outcome-plan.md`. Read on `main` at `f47ef9c2`, with the Whoopee Cushion design and
plan (PR #890, merged; its build not yet merged) read for overlap.

## 1. The cards

**Pay It Forward** (Sweet, uncommon, 1.50, Reversal set face down on one's own post). It springs on the first Sweet card
cast on that post, up to uncommon. The cast lands as usual, and its card goes back to its caster's hand. The setter
gets nothing beyond what any spring already earns. It springs once, or comes back to the setter's hand when the set
time ends (`settings.setLasts`).

**Kick Me** (Pepperoni, common, 1.00, Gimmick used on one's own post, 3 days). A "Kick Me" sign is taped on the post.
While it is up, each negative vote on the post (heat or groan) pays its author one vote more, whatever their class: the
flat earn Required Reading already uses. The first three Salty cards cast on the post land, and each goes back to its
caster's hand. Refused while one is already up on the post.

Words, from the numbers design and kept: Pay It Forward's tagline "Give a Sweet card back to its caster.", summary "Set
face down on your post. The first Sweet cast there, up to uncommon, lands, and its card goes back to the caster's
hand.", status every Reversal's "Set, face down to everyone else", and the caster's log "A Pay It Forward on that post
gave your card back." Kick Me's tagline "Earn more when your post bombs.", summary "Used on your post. For 3 days, each
negative reaction to it pays one vote more, and the first three Salty cards cast there go back to their casters'
hands.", status "Wearing a Kick Me sign", its log "Each negative reaction to that post pays one vote more until it
ends, and the first three Salty cards cast there go back to their casters.", and the caster's "The Kick Me sign on
that post gave your card back."

## 2. What the owner decided, and what was weighed

1. **The room sees the sign count down; a refunded cast carries no mark** (the owner's pick). Kick Me's sign shows
   three boot prints, and each refund scuffs one out. Pay It Forward's back flips to its face as every Reversal's does.
   The caster's log says the card came back in both cases. Weighed: a "handed back" mark under each refunded cast (a
   new mark on a card play, for two cards); nothing visible at all (the room cannot tell whether the kicks are used
   up, which weakens the lure). The cast's flavor and caster are already public, so the count proves nothing private.
2. **The card goes back; a play price does not** (the owner's pick). Whoops!, Autocorrect, Laugh Track and You Were
   Saying? cost a play price on top of the card. A refund returns the card alone, which is what "goes back to the
   caster's hand" says, and it keeps a Kick Me post from being three free Whoops! in a row. Weighed: card and play
   price, which needs a second kind of refund (a wallet row) for a larger lure.
3. **Kick Me's refunds are a field of their own, beside its one effect** (the owner's pick): `refunds: { flavors:
   ['salty'], count: 3 }` on a Gimmick used on a post, and its `gimmick` stays the flat earn. Every reader of a
   Gimmick's one effect (wards, earns, prices, the staff pool, settlement, the screens) stays as it is, and the
   refunds are read only where a cast lands. Weighed: a Gimmick carrying a list of effects, with refund joining the
   list: more general, and every one of those readers changes.
4. **The sign is taped across the content area's top edge** (the owner's pick). Half of it lies over the post's bar,
   half inside the content area, and the content area's top padding grows by half the sign's height while it is up, so
   no word sits under it. It leaves the content area on purpose: the joke is a sign someone slapped on the post's back
   when it wasn't looking, and it reads as slapped on because it breaks the frame (CLAUDE.md, "An effect fills the
   post, border to border": it fills nothing, and where it leaves the area this is why). In a spun thread's ORIGIN box
   it is taped across that box's top border, under its band, the same way. Three boot prints along its bottom edge;
   each refund scuffs one. Weighed: pinned at the content area's top right with the words flowing around it (covers
   nothing, stays in the frame, and reads less as a prank); dangling from the bottom border outside the box (covers
   nothing, but is easy to miss on a long post).
5. **When a card is handed back** (the owner confirmed each):
   - Only a cast that lands is refunded. A cast turned away by a Ward is not spent, and a cast caught by a card set face
     down goes to that card's setter; neither is refunded, and neither uses a kick.
   - A Move that lands from a quote is no cast and is never refunded, as Whoopee Cushion's design says of its ride.
   - A Mod Bot's cast passes over both: it has no hand to give a card back to. It uses no kick and does not spring Pay It
     Forward, so a player's gift is never spent on The System. A staff character is public, so this difference reads
     nothing private.
   - Once all three kicks are used, the sign stays up, still paying on negative votes, until its 3 days end.
   - Pay It Forward may be offered to a Mod Bot persona (if the staff pool ever reaches uncommon), since its refund goes
     to the caster and not the setter. Whoopee Cushion's plan stops offering any set card whose trap has an outcome;
     this narrows that rule to a ride.
6. **A cast by the setter's own player is refunded like any other** (the numbers design, kept): a refusal or a
   difference there would show who owns the caster. It never pays the Jabroni, as today, which is settlement's.

## 3. The engine need

**The refund outcome.** A cast trap's `outcome` becomes one of two kinds: `{ kind: 'ride', share, every? }` (4D Chess,
Whoopee Cushion) and `{ kind: 'refund' }`. A refund outcome sits beside a `match` or a `catches`, and takes no
configuration and no quadrant. Its spring is written `did: 'returned'`.

**The refunds field.** `CardRules.refunds?: { flavors: readonly Alignment[]; count: number }`, only on a Gimmick
(`play: 'use'`) that reaches a post alone and has a `lasts`. A `refunds` column on `card_kinds` carries it, seeded as
every other card field is.

**One way a card goes back.** Both refunds happen in `place_cast`, where the cast lands, so both write the same two
things:
- the cast's own Act carries `handedBack: { by: <play id>, card: <card key> }`, where `by` is the Pay It Forward's set
  play or the Kick Me's use play, and `card` that play's card;
- the caster's account gets a `returned` row in `card_ledger` naming the cast's Act, the row a take-back writes today
  (`card_held` already counts it; `card_ledger_check` already allows it with an Act).

The cast's Act is a new Act, so nothing is edited in place (CLAUDE.md, "Append-only"). The order in `place_cast`: the
Ward refuses first, as today; then the back is met (`spring_traps`); a back that catches takes the cast, and nothing is
refunded; a back that rides or refunds lets it land; a cast that lands and was not refunded by its back meets the live
`refunds` Gimmick on the post, if it has one with a kick left and the cast's flavor, and is refunded by it. A cast is
refunded at most once. A staff cast (no payer) is never refunded and never springs a refund back.

**The count.** Kicks used are the casts on the post whose `handedBack.by` names the sign's play: public Acts, read under
the post's row lock that `place_cast` already takes, so two casts at once are counted one after the other. The screen
counts the same Acts.

**The screens.** The engine's sentences for a set card's form, the setter's spring alert, the setter's log line and the
caster's `returned` line each gain the refund case, branching on the data they already have and never on a card's key.
The play model carries `handedBack`, and the post's plays as they are handed to an effect carry, on a play some cast
names, how many casts it has handed back (`handedOut`), so the sign redraws live when a refunded cast arrives.

## 4. Overlap with Whoopee Cushion's build

Whoopee Cushion's plan (`docs/plans/2026-11-20-whoopee-cushion-plan.md`) changes the same objects, and its build has not
merged. **This build starts from `main` after Whoopee Cushion's build merges**, and copies its versions:
- `card_kinds_problem` (latest `0376_cushion_kind.sql` today, not `0357` as Whoopee's plan says; that plan re-reads it at
  build time): Whoopee removes the "outcome beside a match" refusal and adds the `every` check; this adds the refund
  kind and the `refunds` checks.
- The `acts_spring_payload` constraint (latest `0317_surfaces.sql`): Whoopee loosens the quadrant; this adds
  `('cast', 'returned')`.
- `CardRules.trap.outcome`, `outcomeProblems`, `decideSet`'s quadrant guard, `staffOffers`, `springWords`, the
  `trapSprang` alert and the log's spring line: each is edited by both.
- `place_set` (latest `0374_cards_on_a_spun_thread.sql`) refuses any set card with an outcome whose configuration names
  no quadrant. Whoopee Cushion's plan does not redefine it, so its set with configuration `{}` would be refused there;
  its SQL test will show it, and its build will have to narrow that check to a ride without `every`. This build narrows
  it to a ride (with the `every` exception Whoopee's build leaves), whichever version it finds.

This build also redefines `spring_traps`, `place_cast`, `place_set` and `seed_instance`, which the Cheap Shot,
Interference and SoVeryHappy builds are likely to reach too; none of those builds beside it.

## 5. What it does to the rest of the game

- **The masks.** The spring and the refund are computed from the cast card's flavor and rarity, the back or sign on
  the post, the kicks already used (public casts) and whether the caster is staff (public), never from who owns the
  caster or the post. A cast by the setter's own other mask is refunded the same. The `returned` ledger row is the
  caster's own, read only by the caster's log. No timing, refusal or answer differs with ownership. The sign's count
  and the flipped back are public.
- **Ways out.** The sign ends by itself after 3 days, or an admin ends it. Pay It Forward's back springs once or ends at
  the set time, and comes back to the setter's hand if nothing springs it. A refunded cast is an ordinary landed play,
  with its own ways out. No state is added that a player could be stuck in.
- **The layers.** The refund outcome, the `refunds` field, the column, the SQL, the play model's `handedBack` and
  `handedOut`, and every sentence are the engine's, named for what they do. The two cards, their faces, sheets, the
  sign's drawing and the `trapStruck` voice are Divided World's, through `CardRules`, `CardUi` and `AlertCopy`.
- **A busy instance.** The refund check reads the live Gimmick plays on one post and the casts on that post naming one
  play, through the `target_act_id` index, under a lock `place_cast` already holds: its cost grows with the plays on
  one post, never with players or Acts overall. Settlement is unchanged: a refunded cast earns and is boosted as any
  landed cast.
- **Acts an instance already holds.** The constraint and the checks only loosen or add; no existing spring, card row or
  ledger row changes meaning. A `returned` ledger row naming a card Act with no `handedBack` keeps today's reading (the
  old voice's refund).
- **Accessibility.** The sign is not an obstacle: it covers no word and nothing to press. It has a text label that
  says how many Salty cards it will still give back, and no motion.

## 6. Departures from the numbers design

- **The caster's log line.** The numbers design wrote "A Pay It Forward on that post gave your card back." and "The
  Kick Me sign on that post gave your card back." The caster's `returned` line is the engine's, one sentence for both:
  "The {card} on {post} gave your card back.", with the card's name from the instance. That is the same fact, in the
  engine's sentence, with the post linked.

## 7. Open

- Whether Kick Me's whole vote per negative vote is underpowered beside Heat Magnet stays with the season review, as the
  numbers design (section 7) left it.
