Record, written 2026-11-23.

# The crowd floor: Aura for a reaction a class neither pays nor charges: design

A design session with the owner. It began with the owner's question: "Do characters get any aura for neutral reaction
quadrants? E.g. a technician getting 😂, not a + or - quadrant for them". They do not. The owner then asked for "an
equivalent reward for receiving any reaction which does not actively lose your class points", beside crowd pay
(`docs/plans/2026-11-20-crowd-pay-design.md`), "Getting any crowd reaction helps the game along." Its plan is
`docs/plans/2026-11-23-crowd-floor-plan.md`.

## 0. The appraisal it starts from

Every class pays one quadrant and charges another on its own Acts' reactions, and the two left over move nothing:

| Class | Pays | Charges | Moves nothing |
|---|---|---|---|
| Face | excited-positive | bored-negative | excited-negative, calm-positive |
| Heel | excited-negative | calm-positive | excited-positive, bored-negative |
| Jabroni | bored-negative | excited-positive | excited-negative, calm-positive |
| Technician | calm-positive | excited-negative | excited-positive, bored-negative |
| Tweener | hype and heat, only as they balance (`tweener.splitTheRoom`) | calm-positive, bored-negative | hype and heat, vote by vote |
| Lurker | every reaction to its cards (`lurker.cardDrew`) | (posting, which is no quadrant) | every reaction to its posts |

- **A neutral reaction is a riskless way to starve.** Crowd pay's appraisal rested on "every reaction pays some
  class", so a griefer who guesses wrong pays someone. A neutral reaction pays nobody, and under the shared vote it
  dilutes: a 😂 beside a 🙏 on a Technician's post halves its Respected pay. A griefer starves a suspected Technician at
  no risk.
- **And crowd pay pays for it.** The giver of that 😂 earns 0.02 orb; the Technician earns nothing.

With the floor, the only way to cost a character Aura is to guess its weakness, and a wrong guess pays someone again.

## 1. Where it pays: the character's standing

**Decided:** the floor is Aura, a ledger entry in the character's standing, beside its class pay.

Crowd pay is wallet only because it is counted per player across all their masks, so a standing that held it would
link them (crowd pay design, section 2). A received reaction lands on one character's Act, so the floor has no such
leak, and it closes the starving gap where it bites: in Rankings. That once the neutral quadrants pay, which quadrant
charged a character reads a little more plainly is inside the settled-sums exception class pay already lives under.

Weighed: the wallet, like crowd pay (no class signal, but it leaves the standings' gap open); both, split.

## 2. Which votes it pays: neither paid nor charged

**Decided:** the floor pays a received vote that the character's class neither paid nor charged. A favored vote pays
its class pay and no floor; a weakness vote is charged and has no floor.

The owner first proposed stacking it on favored votes too ("any reaction which does not actively lose"). Aura is also
the wallet's income, and the earn-cards balance (`docs/plans/2026-11-12-earn-cards-balance-design.md`) prices the card
economy at about 0.05 net a vote (60% favored, 10% hostile, 30% neutral), about 0.5 orb a day for an active poster. At
a floor of 2, stacking adds about 0.018 a vote (+36%), most of it from favored votes, not the gap this closes. Neutral
only adds about 0.006 (+12%), which the season review takes without a retune now.

Weighed: stacking on favored at 2 (+36%, a retune of the card economy in this design); stacking at 1 (+18%, and 0.01
a neutral vote is too small to see in a log).

**How "paid or charged" is known: from the class's own earnings.** A received vote is paid or charged when the class
returned, for the same stretch, an earning carrying `votes` with the same Act, quadrant, time and kind. That is how
every per-vote rule reports itself already (`perVote`, Evergreen, `tweener.shrugged`, `lurker.cardDrew`). No class
declares its quadrants, so there is no second list to drift from its rules ("Two lists that must agree are one
list"), and a class added later is covered. A rule paid on a room's shape rather than a vote (`tweener.splitTheRoom`,
`face.liftedAPost`, the stole-thunder rules) carries no `votes`, so the votes it reads stay unpaid for the floor.

So the floor lands: for the Face and the Jabroni, on excited-negative and calm-positive; for the Heel and the
Technician, on excited-positive and bored-negative; for the Tweener, on hype and heat; for the Lurker, nothing
(section 3).

## 3. The Lurker: a class may narrow it

**Decided:** `ClassRules` gains an optional `floorOn(reaction)`, by default every received vote. Divided World's
Lurker narrows it to its cards.

With no charging quadrant, every reaction to a Lurker's posts would pay the floor. A fourth post in a window drawing
five fresh voters would pay 10 against the over-posting charge of 10, and on a busy instance twenty voters would pay
40: posting past the allowance would profit, and the class's one defining limit would be gone. Its cards pay every
reaction already (`lurker.cardDrew`), so the Lurker earns no floor in practice; its `floorOn` is written as cards, not
as nothing, so a later change to its card rule reaches the floor without a second edit.

Weighed: the floor on posts within the allowance and on cards (more to say, and the hook would read post order); the
floor everywhere and a larger over-posting charge (no flat charge keeps pace with how many voters a post draws).

## 4. How much: 2, a fifth of a vote

**Decided:** 2 hundredths a whole vote. A favored vote pays 10, a neutral one 2, a weakness one −10. It mirrors crowd
pay, which pays 2 for giving: what reacting pays the giver, being reacted to neutrally pays the target. Five neutral
voters on a post earn what one favored voter does.

It is one engine setting, `crowdFloor` (hundredths of a vote), whole and at least 0; 0 switches it off. Divided World
sets 2. The season review retunes it with a settings row.

Weighed: 3; 5, half a vote (a Face played as a Heel would earn steadily, blurring the classes).

## 5. How it is counted

- **Per vote**, as class pay: the received line's `votes`, so the shared vote and the halving hold. Three reactions on
  one Act do not pay three floors, and a character posting much does not farm it.
- **A moved vote** takes the floor back by the difference, as class pay does: a vote that leaves a neutral quadrant in
  a later window is a negative line there, and pays a negative floor.
- **Not counted**, as class pay is not: staff Acts, The System's Acts, gifts and admin-ended plays (they are not in a
  character's `received`).
- **Where it lands:** an engine ledger entry with no class, reason `crowd.floor`, with the vote's Act, quadrant, time,
  kind and votes. It is no class's reason, so the log scores a character's class from its other lines, as it does a
  card's payout.
- **What reads it:** no earn boost (`card.boost` boosts the class's own earnings), no reveal perk, no cushion (a floor
  taken back is a gain taken back, which is no loss). A flat earn card pays on top of it, since a flat earn pays
  whatever the class does.

## 6. The masks

- **Read:** a character's received votes and its class, in settlement (The System's scoring, the exception CLAUDE.md
  names) and in the owner's own estimate (`estimateForOwner`), which runs the same code for the caller's characters.
- **Shown:** each character's settled standing, as its class pay is, and the owner's own log and estimate.
- **Added:** no page, payload, Realtime event, refusal or timing.

## 7. The words

The log names it plainly, in Divided World's reason words, as something like "A crowd noticed: a reaction the
character's class neither pays nor charges". The Strategy Guide says it under Aura, beside crowd pay, with the number
as a `{{setting:crowdFloor}}` marker. Both are Divided World copy, and the owner approves the words in review.

## 8. The rest of the rules

- **The layers.** The engine holds the rule, the hook, the setting, its SQL check and the class-less log handling; it
  names no instance. Divided World holds the number, the Lurker's `floorOn`, the reason's words and the guide's
  sentence.
- **Append-only.** It is a ledger entry like any other; no Act is touched.
- **Ways out.** No state is added.
- **A busy instance.** One pass over the `received` lines settlement already builds, with a set of the class's
  per-vote earnings' keys per stretch: linear in the reactions the settlement already reads.
- **Portable.** No table is added; the setting is a settings row the export already carries.
- **Accessibility.** A log line is text, as every log line.

## Open

- **The card economy.** About +12% income at the earn-cards balance's guess. Left to the season review, beside its
  open question of how many voters a post draws.
- **Cards that touch the floor** (one that raises it on a character for a day, one that takes it away): none now; the
  setting and the hook leave room.
- **The words.** The owner approves the log's and the guide's in review.
