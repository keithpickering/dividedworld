# A Mod Bot's card options, and an admin's reversal of a card

Record, written 2026-11-05. The design session that followed #218 (the staff roster's pool posts), made with the owner. It
answers two things. First, a pool persona that plays a card now chooses the card's options itself, as a player does.
Second, an admin can end any face-up card play after it lands (#236), which is what keeps the first one safe. The owner
confirmed each section below. The plan is `docs/plans/2026-11-05-bot-card-options-plan.md`, built by one build session in
one PR.

## 0. Where this started

#218 built the pool's card plays as the staff roster design, section 7, decided them: "The model picks a card from the
fixed list and a target from two choices; it never invents an effect." The build read that as "the model never chooses a
configuration". So code builds every staff card's options (`staffConfigOf`, `engine/rules/cards.ts`), picking Whoops!'s
ink from a list of five with a generator seeded from the day and the persona (`supabase/functions/chatter/core.ts`).
Autocorrect has no default and no list, so it is never offered to the pool, and Stick Around always plays its default
sentence.

The owner asked why the model could not choose. The design's sentence does not forbid it: an ink is not an effect. What
did stand in the way was a clause in CLAUDE.md's "The System acts": "free text a model returns is shown, never acted on".
That clause came over from currents' rule "The AI proposes; a person signs" when the rules were first rewritten
(`docs/plans/2026-10-28-kit-step-1-design.md:66`). No incident in this game earned it, and the code already breaks its
letter: pool posts are model words posted at once, and the Director's rename makes a model's free text a board's name.
What it rightly protects is narrower: the code never reads a model's prose as a decision.

## 1. The rule is reworded

**Decided** (the owner, 2026-11-05). CLAUDE.md's clause becomes: a model's free text is never read as a choice. Its words
may be posted, or become a card's words within the bounds that card's own rules check for any player. A card a Mod Bot
plays is a game move like a player's: it lands at once, and an admin can end it after it lands. A move that reshapes a
board still waits about a day in the admin queue, unchanged.

Weighed: holding a bot's free-text cast in the admin queue for a short hold (an hour was proposed). The owner first
proposed the hold and then dropped it: "I'm actually wondering if they need to be queued at all if they can be reversed.
The joke lands better if it comes along with the post or shortly after, and the code is probably simpler too. System
actions like board renames are larger and make sense to queue; a card is just a standard game move."

That holds up:
- The bot's post beside the card is already unreviewed model text, up to the full post length. Holding a 100-character
  strip while that post goes straight up would guard the smaller risk.
- Players already do exactly this: any player can Autocorrect a friend's post with free text.
- Every card is a layer the game itself can take off: Autocorrect is peeled by the post's author, Whoops! is washed, and
  Stick Around is released by its sentence. Nothing a card does destroys what was written.

The one real difference is that a bot's words reach a player's post with no person choosing them. That argues for an
easy admin reversal (section 3), not for a queue.

## 2. The bot chooses a card's options

**Decided:** a pool persona on the chat voice sets a card's options as a player would, held to the card's own validator
and canApply, and nothing tighter. Weighed: menus for cards that have a list (Whoops!'s five inks), with free text only
where none exists; and free text only, with lists staying random. The owner chose "same as a player": a card is a
standard game move.

- **What changes per card in Divided World:**
  - Whoops! takes any ink its validator accepts, which is any named color or hex.
  - Autocorrect joins the pool's offer. The bot writes the phrase, which must be in the post it replies to, and the
    replacement.
  - Stick Around takes the bot's sentence, or the default when it gives none.
  - The cards with no options are unchanged.
- **The engine stays unaware of each card.** A card declares what the model is told about its options and the shape of
  its options for the provider's schema (`CardRules.staffOptions`). The engine puts them in the prompt and the schema
  without reading them.
- **When the bot's options fail** the card's validator or canApply (a phrase that is not in the post, an ink that is not
  a color), the card falls back to what code builds today (`staffConfigOf`: the default, else a seeded pick from
  `staffConfigs`) and the trim names the failure. Where code can build nothing (Autocorrect), the card is dropped with a
  trim. The post stands either way. This follows CLAUDE.md, "A validator tighter than the schema": nothing paid for is
  thrown away for a fixable part.
- **Checked twice.** The chatter run decides the play with the card's TypeScript rules against the target as the act
  Edge Function reads it (`card_target_reach`), as a player's play is decided. The database then holds every rule it
  holds for a player's play (`place_cast`).
- **No hold.** The card lands with the post, as it does today.
- **The old voice** plays no cards, as today.

## 3. An admin ends a card play

**Decided** (the owner chose to design #236 here, since section 1's safety rests on it).

- **The Act.** A new Act kind, `card_end`, written by a new admin-only function `reverse_card(play)`. Like `move_end`, it
  belongs to no character, targets the play, sits in the play's thread, carries `{why: 'reversed', by: 'admin'}`, and is
  at most one per play. The admin's account is not on the Act, as with moves.
- **What can be reversed.** Any face-up card play still in force: a Cast or a Use, on a post, a character, a thread or a
  board, a trap's strike included (it is a card Act). A face-down Set, a caught play and an ended play cannot be, and the
  refusal says why in plain words. A reversal is final: an admin who regrets one has no undo, and the card can simply be
  played again.
- **What drops out.** A reversed play holds no place in the stack and wards nothing, on the server and on the screens.
  It still keeps its layer number, since the layer index never reuses one. `play_reach` is append-only, so a play beyond
  a post is ended by its `card_end` too, never by rewriting `ends_at`.
- **Aura.** The owner chose "layer and unsettled Aura". A play reversed before a settlement window closes counts in no
  window settled from then on. Aura already settled stays, the price and the card stay spent, and a trap the play already
  sprang stands. Weighed: refunding the caster's price and card (a reversal is usually moderation, so no); moving settled
  Aura back (it reaches into settled windows whose sums are already public).
- **What players see.** Plain words, never in character ("The fiction may lie; the log never does"):
  - The play's layer comes off at once. In the Lens, the play reads "Ended by an admin".
  - The log of the post's author (or the character's, for a play on a character) says an admin ended the card on it.
  - The caster's log, where a player cast it, says an admin ended their card and that nothing came back.
  - The caster's player gets an alert, `cardEnded`. A staff caster has no player and gets none.
  - No Mod Bot or Boss says anything about it. A move's reversal is said in the Boss's stock line because a move is the
    Boss's own; a card is a single play, and its end is the admin's, said plainly.
- **Where admins reverse one.** The owner chose both places:
  - an "End this card" control in the Lens, on a face-up play still in force, shown to admins alone;
  - in the admin queue, a new group, "Mod Bots' cards", listing the staff characters' face-up plays of the last 30 days
    still in force, each with an end button. The queue's Ended group also lists card reversals.

## 4. What is open

- Whether a persona learns that its card was ended (as `pool_signals` tells personas of reversed moves) is left open. It
  would feed the persona's memory, and the pool reads nothing of it until a later design adds it.
- A per-persona signature ink was mentioned and not chosen. An instance can write one into a persona's prompt with no
  engine change.

## 5. The masks

- `reverse_card` is an admin's. Its refusals name the play's state (face down, caught, ended), which an admin can open
  only for a face-up play. The Lens control is drawn only for face-up plays, so it says nothing about a back.
- The "Mod Bots' cards" group lists staff characters' plays, which are public Acts. It lists no face-down Set, so an admin,
  who is also a player, learns nothing about where a trap is.
- The alert goes to the caster's own player, about their own play. The log lines name a card, its public caster and its
  public target, never a reactor or an owner.
- The chatter prompt shows the persona the public thread it already sees. A card's options are decided from that thread
  and the target's public text.
