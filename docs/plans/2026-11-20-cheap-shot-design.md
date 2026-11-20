Record, written 2026-11-20.

# Cheap Shot: design

A design session with the owner for Cheap Shot, the Base Set's answer to Wards and Reversals
(`docs/plans/2026-11-14-base-set-design.md`, wave 3; [#683](https://github.com/keithpickering/dividedworld/issues/683),
gap 4, "Nothing answers a card"). Its row (rarity, price, time, words) was settled by
`docs/plans/2026-11-15-base-set-card-numbers-design.md` (section 3, "Cheap Shot"), which also answered #683's two open
questions: it does nothing about Last Word, and a trap's setter is told nothing when it gets past one. Its art is
already rendered (`instances/divided-world/ui/cards/cheap-shot/`). This session settles what the engine needs for it.
Its plan is `docs/plans/2026-11-20-cheap-shot-plan.md`. Read on `main` at `2ca24f4`.

## 1. The card

**Cheap Shot** (Salty, uncommon, 1.50, a Gimmick used on one's own character, 3 days). The character's next Move gets
past every Ward and every catching Reversal whose card is no rarer than uncommon. That Move spends it. With no Move
cast, it ends by itself after 3 days.

- It gets past Force Field (uncommon), Rope Break (common) and any other catch up to uncommon. It does not get past
  Sugar Coat (rare). A Ward or a catch above uncommon works as it always does.
- A Reversal that lets the cast land (a ride such as Whoopee Cushion or 4D Chess, a refund such as Pay It Forward)
  springs as usual.
- A catch it gets past stays face down and unsprung. Its setter is told nothing, and it can still spring on a later
  cast.
- It does nothing about Last Word, which stops quotes, not casts, and nothing for a Move that lands from a quote.
- Its words are the numbers design's. Tagline: "Your next Move slips past defenses." Summary: "Used on your own
  character. Its next Move within 3 days can't be turned away or caught by a card up to uncommon." Status: "Lining up
  a cheap shot". Log: "That character's next Move can't be turned away or caught by a card up to uncommon."
- Its key, `cheap-shot`, falls alone in its slot of the sorted lists (between `card-collector` and `class-clown`).

## 2. What the owner decided, and what was weighed

1. **It gets past catches only, not every Reversal** (the owner's pick). The card says "can't be turned away or caught",
   and a ride or a refund does neither: the cast lands. Getting past Pay It Forward would cost the caster the refund
   they wanted. Weighed: every Reversal up to uncommon (skips Pay It Forward's refund, which works against the
   caster); catches and rides but not refunds (a rule nobody could read off the card).
2. **The room sees a line in the Move's Lens** (the owner's pick). Every Move that spent a Cheap Shot says "Cast on a
   Cheap Shot" in its row, and adds "past {Ward}" where it got past a face-up one. The line shows whether or not
   anything was in the way, so it never hints at a hidden Reversal, and a reader who finds a Salty card on a Force
   Field post can see why. Weighed: nothing for the room (the numbers design's row; a card on a Force Field post reads
   as a fault); a line only past a Ward (it would mark only the Moves that met one, which is fine for Wards but makes
   the line rarer than the thing it explains).
3. **The next Move spends it, and the cast form warns** (the owner's pick). The form says "This Move uses up your
   Cheap Shot." whenever the caster's character has one up. Planning the next Move is the card's cost. Weighed: a
   checkbox, "Use my Cheap Shot", checked by default, so only a Move cast with it spends it. That makes the card
   stronger: it waits up to 3 days for the Move that needs it.
4. **The caster is told privately, by an alert, when it got past a Reversal** (the owner's pick). The Move's Act is
   public, so it cannot say the back was a catch: that would tell everyone what the hidden card does. The alert is a
   `trapStruck` alert with the sub `passed`: "Your Cheap Shot got your {Move} past a card set face down." It needs no
   new alert kind, so no preference or toast list changes. Weighed: a line in the caster's log (a private mark on
   `card_ledger`, and `my_card_ledger` and `log_page` redefined, which other builds touch); both.
5. **A cast a rare Ward turns away does not spend it.** This departs from the numbers design ("the Cheap Shot is
   still used up"). A turn-away is a refusal, and a refusal writes nothing and spends nothing, in the same words for
   every caster. Spending the Cheap Shot would need a refusal that writes. A cast a rare Reversal catches is written
   (caught), so it does spend it. The owner confirmed this.

## 3. The engine need

Section 1 of the roadmap left "getting past Wards and Reversals" to a Plays plan. No Plays design has been written, and
the other Plays cards (Whoopee Cushion, Kick Me and Pay It Forward) each carry their own engine part. This plan does too.
It shares no decision with the ride, the refund, the lockout or ending a Gimmick.

### 3.1 A new Gimmick kind, `pierce`

`{ kind: 'pierce', upTo: Rarity }`, on a Use card that reaches a character alone. While it is up on a character, that
character's next cast gets past every live Ward whose card's rarity is at or below `upTo`, and past a catching back
whose card's rarity is at or below `upTo`. The rarity compared is the defending card's own printed rarity, not the
Ward's `upTo`: Force Field is uncommon, Sugar Coat is rare. `upTo` is at or below the pierce card's own rarity, as a
Reversal's `match` is. The instance checks (`gimmickProblems`, `playProblems`) and SQL's `card_kinds_problem` refuse a
pierce on a cast or set card, one that reaches anything but a character, a missing or unknown `upTo`, and an `upTo`
above the card's own rarity.

Weighed: a flag on the Ward and on the trap ("passable by"), which puts the rule on every defending card instead of on
the one card that breaks it; a cast-time option the caster pays for, which is not what Cheap Shot is.

### 3.2 Spending it is a fact of the Move, computed, never written over

The Move's Act carries `pierce: { by: <the pierce play's id>, card: <its card key>, ward?: <the Ward's card key> }`. It
is public, and the Lens line reads it. `ward` is the oldest live Ward the cast would have met without the Cheap Shot,
named only where there was one.

A pierce play is spent when a card Act names it in `pierce.by`. `card_ended` is redefined to say so, beside an admin's
`card_end` and a write refund. Every reader that already leaves an ended play out (`ward_refusal`, the character's live
plays, a stack's count, `spin_written`) then leaves a spent Cheap Shot out with no change of its own, and a character
can use another at once. A partial expression index on `acts ((payload #>> '{pierce,by}'))` keeps the probe one index
lookup. On the page, the store marks the named play spent when a Move naming it arrives (`setSpent`, which Take the
Fall's filings already use), so the status ends on the page as it ends on the server.

Weighed:
- **A `card_end` Act with `why: 'used'`.** Every reader of `card_end` (the store's `reversed`, the Lens's "ended by an
  admin", the log's ended rows, the fake's alert) reads an admin's reversal, so each would need to branch.
- **A spent list returned beside the page,** as Take the Fall's is. That redefines the page reads for one card.

### 3.3 Where the cast meets it

All of it is in `place_cast`, with two helpers changed:

- `ward_refusal` gains an optional fourth argument, `passing` (a rarity). A Ward whose card is at or below it is
  skipped. The function is dropped and created again with the argument defaulting to null, so every existing
  three-argument call (`spring_facts` among them) keeps its meaning. Both it and a new `wards_against` read one
  predicate: `wards_against` lists the live Wards that would turn the card away, with each one's card and rarity, and
  `ward_refusal` and the passed Ward's name both read from it.
- `spring_traps` gains an optional last argument, `passing`. A cast back that would catch (no outcome) and whose card
  is at or below `passing` returns `{"passed": true}` and writes nothing: no spring, no ledger row, no alert. A ride or
  a refund springs as before. Dropped and created again with the argument defaulting to null.
- `place_cast`: for a cast (`play = 'cast'`, any reach, not a staff character), after the target's lock and before the
  Ward check, it reads the caster character's live, unspent pierce play and locks its `play_reach` row
  `for update`. It then asks again, after the lock, whether a Move already spent it. With one found, the Ward check and
  `spring_traps` are given its `upTo`, and the cast's payload carries `pierce`. Where `spring_traps` answered `passed`,
  it writes `write_alert(caster, 'trapStruck', 'passed', written)` after the Act. The lock is taken last of
  `place_cast`'s locks before the Ward check, and no other function locks a `play_reach` row, so two casts by one
  character take it one after the other and only the first spends it.

A Use, a set and `lay_sprung` (a Move landing from a quote) never read a pierce.

### 3.4 The page

- `decidePlay` (`engine/rules/cards.ts`) takes `pierce?: Rarity` and `rarityOf?: (key) => Rarity` in its context and
  skips a Ward whose card is at or below it, so the ghost marks (`land.ts`) and the form offer a Force Field post to a
  character with a Cheap Shot up.
- The cast form reads the caster's live plays (`effectsAbove([caster])`) and, with a live pierce among them, says
  "This Move uses up your {card}." beside the price.
- The Lens's play row says "Cast on a {card}" or "Cast on a {card}, past {Ward}".
- The `trapStruck` alert's words gain the `passed` case, and `TrapStruckFacts.how` gains `'passed'` for the instance's
  voice.
- The caster's log line for the Move adds "Your {card} got it past a {Ward} that would have turned it away." where
  `pierce.ward` is set. It reads only the public payload.

## 4. What it does to the rest of the game

- **The masks.** A Cheap Shot is a public play on a character. The Ward it passes is face up. Whether a back is passed
  is computed from the back's card and the cast card alone, as `spring_facts` decides a catch, never from who cast or
  who set it, so a cast on one's own other mask's back is passed the same. What it passed is told only to the caster's
  account, by an alert on the account's own channel. The public Act names the Cheap Shot and a Ward, never a back. The
  Cheap Shot is spent by every Move, whatever was in the way, so its ending says nothing about the target either.
  Nothing new is read from a private fact. No new payload or timing is added beyond the Act's public `pierce` and the
  caster's own alert.
- **Ways out.** The Cheap Shot ends by its time (3 days), by the next Move, or by an admin. A back it passed stays set
  until its own time, a later spring or the setter's take-back, as any back does. Nothing new can leave anyone stuck.
- **The layers.** The `pierce` kind, the checks, `place_cast`, the helpers, the store, the form's line, the Lens line,
  the alert's and the log's words are the engine's, named for what they do and never for a card. The card, its face,
  its sheet and its `trapStruck` voice are Divided World's.
- **A busy instance.** `card_ended` gains one probe of a partial index that holds only the Moves that spent a pierce.
  `place_cast` adds one indexed read of the caster's character plays (`play_reach_character`) per cast. The Ward check
  reads the same plays as before.
- **Acts an instance already holds.** No Act carries `pierce` yet, so `card_ended` answers as before for every
  existing play. The dropped functions are created again with their old calls unchanged.

## 5. Departures from the numbers design

- **A rare Ward's turn-away does not spend it** (section 2.5).
- **The "past a card set face down" line is an alert, not a log line** (section 2.4). The Ward's line is in the log, as
  the numbers design wrote it.
- **The Lens line** is new (section 2.2).
- **Reversals that let the cast land spring as usual** (section 2.1). The numbers design predates them.

## 6. Open

- **A trap's setter is told nothing.** The numbers design (section 7) keeps this open for the season review: if "my
  Rope Break didn't fire" feels like a fault, the setter's log could name it after the fact.
