# Face-down returns: design

Record, written 2026-11-08. Designed with the owner in a design session. The plan is
`docs/plans/2026-11-08-face-down-returns-plan.md`.

## 1. The question

Every card set face down ends by itself at `setLasts` (7 days, `instances/divided-world/settings.ts`), and the card is
gone. The owner asked whether that is arbitrary and whether it punishes the face-down play: setting a card takes more
finesse than casting it once someone has posted, because it bets on what someone will do, and only the bet carries a
clock that can take the card away. Long quiet stretches make it worse, since a back can run out while nobody is looking.

The 7 days was a placeholder that stuck; no design argues for the number. The loss of the card was the part that
punished: a face-down play could end worse than never playing the card.

## 2. An unsprung card comes back to the setter's hand

**Decided** (the owner's proposal): a back keeps its one public lifetime, `setLasts`, and when it ends with nothing
springing it, its card comes back to its setter's hand. It cannot be taken back sooner. The face-down play's only cost
beside a direct cast is time: the card is out of the hand while it waits, and a post holds one back.

- A quiet stretch costs a setter a re-set: once the back ends the post is free again, and the card that came back can be
  set on the same post at once.
- `setLasts` stays a setting, still 7 days, left to the season review.
- Weighed: no lifetime at all, with a withdrawal Act that takes the card back (the first recommendation; it needed a
  new Act, a separate end for staff backs and a timer for Bluff, see section 3); a clock that pauses while a thread is
  quiet; an early take-back beside the return. The owner chose the return as simpler, and it holds the masks with
  nothing new public.

## 3. A Bluff is spent

**Decided** (the owner chose the recommendation): a card that can never spring (a Gimmick with no trap: Bluff) is used
up at its end, as every back is today. A decoy then costs one common card per week, so endless decoys are never free.

- Which cards come back is the engine's existing line between a back that can spring and one that cannot (`springs` in
  `my_card_ledger`, 0142: a Gimmick with a trap, or a Move). No new card field: the engine already names a trapless
  Gimmick a bluff (`CardRules.trap`'s comment).
- The difference shows only in the setter's own hand and log. In public every back ends the same way at the same time.
- Weighed: a private Bluff timer (rejected: any back older than the longest Bluff would be provably real, a private fact
  measured from its age, however the timer was jittered); a per-character cap on live backs; every card coming back,
  Bluff included.

## 4. Staff backs, admin ends and caught cards are unchanged

- **A Mod Bot's back** is spent at its end. Staff hold no hand (`place_set` writes it with no account), so nothing comes
  back. A staff back already ends at `setLasts` like any other.
- **A back an admin ended** (`card_end`) is not refunded, as the bot-card-options design says of every ended card. It
  comes back to nobody.
- **A sprung back** spent its card in springing, and a Trap Card's catch still puts the caught card in the setter's hand.

## 5. In public, nothing changes

**Decided** (the owner): the mark leaves the post when the back ends, as it does today (`shownPlays`,
`engine/ui/cards/plays.ts`). The mark stands for a card waiting, to make other posters think twice. Once nothing waits,
it says nothing, and an ended back is not much to spin or react to.

The owner's line, "Pipewrench's face-down card never activated, and was removed from the post.", becomes the setter's
own log line for the end, which goes on to say where the card went: "It came back to your hand." or, for a Bluff, "It
is used up." Weighed: keeping the ended back's mark with that line in its Lens, as an ended ward keeps its mark; that
line in public with no mark (the Lens opens only from a post's marks, `markedPlays`).

## 6. The masks

- The return is computed, not written: the hand count (`card_held`) adds the caller's own backs that ended unsprung, read
  from the caller's own `face_down` rows. No Act, no Realtime event, no job and no write happens at the end, so nothing
  is timed from which card was face down.
- `card_held` stays security invoker. A signed-in caller's count reads only their own `card_ledger` and `face_down` rows
  under each table's `own` policy, and another account's count is 0, as today. The definer functions that spend a card
  get the true count of the account they act for.
- The public end of a back is unchanged: its set time plus `setLasts`, the same for every card, so a back's age and its
  end reveal nothing about which card it is.
- A setter who re-sets a post the moment the old back ends shows that they are around: a clue from what a character
  does in public, which is play.

## 7. Ways out

No state is added. A back springs once, or ends by itself at `setLasts`; its card then comes back to the setter's hand,
or is used up where it is a Bluff, a staff back or one an admin ended.

## 8. The layers

All of it is the engine's: the hand count, the fake API, the log lines and the play form's words. Divided World gives
only its cards' descriptions and the Strategy Guide's sentence. No interface is added: whether a card can spring is read
from `CardRules.trap` and the play, which the engine already holds.

## Open

- **How long `setLasts` is.** 7 days is unchanged. The season review may find a better number now that a back costs
  only time.
- **An alert on a return.** The setter learns of it from the hand and the log. A quiet alert ("Your Trap Card came back
  to your hand") is possible, but no alert is added here.
