Record, written 2026-11-21.

# Buzzkill: a Move that ends a Gimmick early: design

A design session with the owner for Buzzkill, the Base Set's answer to Gimmicks (`docs/plans/2026-11-14-base-set-design.md`,
wave 3; [#683](https://github.com/keithpickering/dividedworld/issues/683), gap 4, "Nothing answers a card", where it is
proposed as **Interference**). The numbers design (`docs/plans/2026-11-15-base-set-card-numbers-design.md`, section 3,
"Buzzkill") renamed it, settled its row and answered #683's two open questions: it does not reach a Gimmick on a thread,
and Wards are asked as for any Salty Move. Its art is already rendered (`instances/divided-world/ui/cards/buzzkill/`).
This session settles what ending a Gimmick means to the engine. Its plan is `docs/plans/2026-11-21-buzzkill-plan.md`.
Read on `main` at `d9151dc`, with SoVeryHappy's build (PR #936, `0401_thread_lockout.sql`) open.

## 1. The card

**Buzzkill** (Salty, rare, 3.00, a Move on a post or a character; instant). It ends one Gimmick up on its target, which
the player picks from the Gimmicks showing there, up to rare. The Gimmick is not refunded.

- A Gimmick is a Use card's play: on a post, one used on that post (Kick Me, Required Reading, Force Field, Sugar Coat,
  Last Word, Toll); on a character, one used on that character (Cheap Shot, Heat Magnet, Publicity Tour, Thick Skin, Sweet
  Heat, Front Row, Class Clown). A Move's earn on a post (Hype-Up) is not a Gimmick. A Gimmick on a thread (Good Vibes) is
  not reached.
- Wards are asked as for any Salty Move. Sugar Coat turns it away, so a Sugar Coat cannot be Buzzkilled. Force Field wards
  up to uncommon, so it does not, and a Buzzkill can end a Force Field. A Reversal on the post can catch it (a catch up to
  rare) or spring on it (SoVeryHappy), as on any Move. A caught Buzzkill ends nothing.
- It is refused where the target has no Gimmick up to rare, before anything is paid.
- Its words are the numbers design's, with the owner's verb ("play", never "cast"). Tagline: "End a Gimmick early."
  Summary: "Played on a post or a character. Ends one Gimmick there, up to rare. You choose which." Log, the player who
  played it: "It ended the {card} there." Log, the Gimmick's player: "A Buzzkill ended your {card} early."
- Its key, `buzzkill`, falls alone in its slot of the sorted lists (between `blind-study` and `card-collector`).

## 2. What the owner decided, and what was weighed

1. **What the Gimmick already did stands** (the owner's pick). The Gimmick is cut short at the Buzzkill's moment: its
   earnings, refunds, Ward and cushion up to then all stand, and only what was still ahead is gone. Settlement reads the
   cut as an earlier end. Weighed: treating it as an admin's end, which settlement voids whole for every window not yet
   settled, so a play's timing would reach backward into votes already cast while the Gimmick was up.
2. **An admin who reverses the Buzzkill brings the Gimmick back** (the owner's pick), up for what is left of its own
   time, as if it had never been ended. Windows already settled stay settled. Weighed: the Gimmick stays over, and the
   reversal only drops the Buzzkill's own Act, which would leave an admin no way to undo what the Buzzkill did.
3. **Face up only** (the owner's pick). A Buzzkill is played now, on a Gimmick the player can see. Weighed: set face down
   on a quoting post, naming the Gimmick when set; by the time a quote landed it the Gimmick could be over, and a rare
   3.00 card would land and end nothing.
4. **Quiet** (the owner's pick). It draws no effect. The ended Gimmick's layer and status leave the post or the
   character, the Buzzkill shows in the card list like any Move, and the Lens says what it ended. Weighed: a one-time
   flourish over the ended Gimmick (a record-scratch, a deflating sign), which would need its look designed.
5. **Players only** (the owner's pick). The pool never offers it to a Mod Bot persona, as with the cards that carry a
   reply or act on discipline. Weighed: offering it, with the persona naming one of the target's live Gimmicks from a list
   the code builds. A later Mod Bot design may add it.

## 3. The engine need

Section 1 of the roadmap left "ending a Gimmick" to a Plays plan. Cheap Shot, Kick Me, Pay It Forward, Whoopee Cushion
and SoVeryHappy each carried their own engine part, and this plan does too. It shares no decision with them.

### 3.1 A new card property, `cuts`

`cuts: { upTo: Rarity }`, on a cast card. Its play ends one live Gimmick on its target, the one its checked configuration
names (`{ play: <the Gimmick's play id> }`), whose card is a Use card no rarer than `upTo`. The card is **instant**, as a
heart and an Unban already are (`instant` in `engine/rules/cards.ts`, `0361_discipline_cards.sql`): it writes no `ends`,
no `play_reach` row and no layer, and takes no place in a stack, so a second Buzzkill on the same post or character is
never refused for the first. It is cast face up and never set face down (`faceUpOnly`), and never offered to a staff
persona (`staffOffers`).

The instance checks (`playProblems`) and SQL's `card_kinds_problem` refuse a `cuts` on anything but a cast card; a
missing or unknown `upTo`; an `upTo` rarer than the card; a `reaches` that names a thread or a board; a `lasts`; and any
other effect beside it (a gimmick, a skim, refunds, a discipline, writes, replies, keeps, scoresAs, draws, a drive, a
surface, a veil, a needed message). `card_reach_problem` lets a `cuts` card reach a character with no `lasts`, as it lets
a heart. `face_down_never_writes` refuses its back in the words `decideSet` gives.

Weighed: a Gimmick kind (`gimmick: { kind: 'cut' }`). A Gimmick is a Use card's effect that stays up; this is a Move's
one act.

### 3.2 Being cut is a fact of the Buzzkill, computed, never written over

The Buzzkill's Act carries `cut: { play: <the Gimmick's play id>, card: <its card key> }`, written only when it lands
(not when a Reversal catches it). It is public: the Lens and both logs read it.

A Gimmick is cut while some landed card Act names it in `cut.play` and that Act has no `card_end` (an admin has not
reversed it). One new function, `card_cut_at(play) returns timestamptz`, says when: the earliest such Act's time, or
null. `card_ended` is redefined with a fourth way a play is over, `card_cut_at(play) is not null`, so every reader that
already leaves an ended play out (the Ward check, a stack's count, `reach_effects`, `card_target`, the refunds Gimmick,
the pierce, the page reads) leaves a cut Gimmick out with no change of its own, and the player can use another at once.
Reversing the Buzzkill makes `card_cut_at` null again, and the Gimmick is in force for what is left of its `ends`. A
partial expression index, `acts_cut_play`, on `acts ((payload #>> '{cut,play}'))` where `kind = 'card' and payload ?
'cut'`, keeps the probe one lookup.

**Settlement** (`settlement_input`, `estimate_input`) sends each play's `ends` as the least of its own and
`card_cut_at`. `engine/rules/settle.ts` already pays an earn, a cushion, a skim and a ride only inside `[at, ends)`, so
nothing in the rules changes, and votes before the cut keep what they earned. A cut play is not in the `ended` list
those functions build (that list reads admins' `card_end` Acts alone), so it is never voided.

**`reverse_card`** tells an admin the truth about a play that is over for another reason. Today it answers "an admin has
already ended that card" for any play `card_ended` is true of, which is false for a spent Cheap Shot, a refunded write
and now a cut Gimmick. The refusal splits: an admin's `card_end` keeps its words; a cut play says "a {card} already ended
that card; end that card to bring this one back"; any other says "that card is already over".

Weighed:
- **A `card_end` Act with `why: 'cut'`.** Every reader of `card_end` (settlement's `ended` list, which voids a play
  whole; the store's `reversed`; the Lens's "Ended by an admin"; the log's ended rows) reads an admin's end, so each would
  need to branch, and settlement's voiding is exactly what the owner refused (2.1).
- **A row of its own (a `cuts` table) the Buzzkill writes beside its Act.** It says the same as the payload, and reversal
  would have to delete or mark it.

### 3.3 Where the play meets it

All of it is in `place_cast`, in both the post and the character branch:

- A cut card is instant: in the post branch it writes `instant: true` and no `layer`, and the post's stack count leaves
  out instant plays; in the character branch it joins the heart and the Unban (`is_instant`).
- After the Ward check and before the Reversal (`spring_traps`), `cut_refusal(kind_of, reach, target, config)` returns
  the refusal's words or null, from public facts alone and in the same words for every player: none up ("there's no
  Gimmick up on this {post|character} for {Buzzkill} to end"), none named ("{Buzzkill} names the Gimmick it ends"), the
  named play not a live Gimmick on this target ("that Gimmick isn't up on this {post|character}"), or rarer than `upTo`
  ("{Buzzkill} ends a Gimmick up to {rare}, and {card} is {legendary}").
- The lock. A post's Gimmicks are serialized by the post's row, which `place_cast` already locks. A character's are
  serialized by the character's row, also locked, except against the Gimmick's own player spending a Cheap Shot from
  another post: so where the named play has a `play_reach` row, its row is locked with the caster's own live pierce
  rows in one statement, ordered by play id, before the pierce loop. The named play is asked again after the lock.
- On landing, the payload carries `cut`. The Gimmick's player is already told by the `cardOnYours` alert `place_cast`
  writes for any Move on their post or character.
- A staff caster is refused a cut card in plain words, as a discipline card is.

### 3.4 The page

- `CardRules.cuts`, `instant` and `faceUpOnly` widened, `staffOffers` refusing it.
- `decidePlay` refuses a cut card before its configuration where the target's effects hold no live Use-card Gimmick up
  to `upTo` (so the ghost marks do not offer a Buzzkill on a post or a postbit with none), and with a configuration
  where the named play is not one of them. It reads whether an effect's card is a Use card and its rarity through a
  new `PlayContext.rulesOf`; with none given it refuses nothing, and the server decides again.
- `ConfigFormProps` gains `gimmicks`: the live Gimmicks on the target up to the card's `upTo`, each with its play, card,
  caster and end, given only to a card that cuts. Buzzkill's own form (the instance's, as 4D Chess's is) lists them by
  face and name, and gives `{ play }`.
- The store: `CardPlay` gains `cut?: { by, card }` on the cut Gimmick, set when a Buzzkill naming it arrives (or held
  until the Gimmick does) and cleared when that Buzzkill is reversed. Every reader that leaves a `reversed` play out of
  force (`stackPlays`, `livePlays`, `effectsOf`, `markedPlays`, `endable`, the statuses) leaves a cut one out too.
  `markedPlays` keeps it for its Lens row, as it keeps a reversed one.
- The Lens: the Buzzkill's row says "Ended the {card} here early"; the cut Gimmick's row says "Ended early by a
  {Buzzkill}".

### 3.5 The log

`engine/ui/log/lines.ts` reads the public `cut` alone; no log read changes on the server.

- The player of the Buzzkill: their `played` row adds "It ended the {card} there."
- The Gimmick's player: the `onMine` row for the Buzzkill adds "It ended your {card} early, at {time}."
- The Gimmick's own `played` row says it ended at the cut's time, "A {Buzzkill} ended it early.", in place of the timed
  end ("ended") at its original `ends`, which would be false. With the Buzzkill reversed, the timed end is said as before.
- An admin's reversal of the Buzzkill is already an `ended` row for its player and an `onMine` ended row for the
  Gimmick's player (`my_cards_ended`); where the ended play has `cut`, the Gimmick's player's row adds "Your {card} is
  back up until {time}." (or "Your {card} came back and has since ended." where that time has passed).

## 4. What it does to the rest of the game

- **The masks.** A Gimmick is a public play; the list the form shows, every refusal and the `cut` payload are computed
  from the target's public plays and the cards' printed rarity alone, never from who owns the player, the target or the
  Gimmick. A player may Buzzkill a Gimmick on their own other mask, and is refused or not in the same words as anyone.
  Settlement's cut end is a public time. The alert to the Gimmick's player is the existing `cardOnYours`, written to the
  target's owner for every Move on their post or character, so it says nothing new. No new payload, event or timing is
  added beyond the Act's public `cut`.
- **Ways out.** A Buzzkill is instant and leaves no state. A cut Gimmick is over, as an expired one is; its player may
  use another at once, and an admin's reversal of the Buzzkill brings it back. Nothing new can leave anyone stuck.
- **The layers.** `cuts`, its checks, `place_cast`, `card_cut_at`, `cut_refusal`, the settlement's end, the store, the
  form's `gimmicks`, the Lens and log words are the engine's, named for what they do and never for a card. Buzzkill's
  rules, face, sheet and form are Divided World's, through `CardRules`, `CardUi` and `ConfigForm`.
- **A busy instance.** `card_ended` gains one probe of a partial index that holds only landed Buzzkills; it answers false
  for every other play in one lookup. Settlement adds the same probe for each play it sends an `ends` for, which it
  already reads one by one. `cut_refusal` reads the target's live Gimmicks, which the Ward check already reads.
- **Acts an instance already holds.** No Act carries `cut`, so `card_ended`, `card_cut_at` and settlement answer as
  before for every existing play. Only `reverse_card`'s words change, and only for plays that are over for a reason other
  than an admin's end.

## 5. Departures from the numbers design

- **"Cast on a post or a character"** becomes "Played on a post or a character", by the owner's copy rule.
- **Earnings before the end stand, and a reversed Buzzkill brings the Gimmick back** (sections 2.1 and 2.2). The
  numbers design said only that "an admin can reverse it".

## 6. Open

- **A second play laid while the first was cut.** A player whose Kick Me was cut may use another on the post; if an
  admin then reverses the Buzzkill, both are up for their times, one over the card's stack. The stack is a rule of a
  play, never of a reversal; the season review can say if that is a problem.
- **Mod Bots** may be offered it by a later design (section 2.5).
