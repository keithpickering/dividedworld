Record, written 2026-11-15.

# The Base Set's unbuilt cards: rarity, price, numbers and words: design

A design session with the owner, on a phone, which settled the row of every Base Set card that has art and no rules:
its rarity, price, duration, size, who it is played on, its way out, how it stacks, and its words. It follows the
roadmap (`docs/plans/2026-11-14-base-set-design.md`) and the living list in
[keithpickering/dividedworld#683](https://github.com/keithpickering/dividedworld/issues/683) ("Game balance"). Its one
plan is `docs/plans/2026-11-15-heat-magnet-common-plan.md`. It designs no engine work: each card below says what it
needs from the engine plan it waits on, and that plan's design session writes the card's build plan from its row here.

## 0. What the owner decided, and what was weighed

1. **The cards are these 13.** The owner asked about "14 cards that still need rarity, description text, price", and
   thought they were stat modifiers. Fourteen folders under `instances/divided-world/ui/cards/` hold art and no
   `ui.ts`: the 13 cards of the roadmap's waves 2 to 4 (Interference's folder is named `buzzkill`) and Steel Chair,
   which is designed (`docs/plans/2026-11-15-wave-1-cards-design.md`) and in review. Four of the 13 are stat modifiers
   (Sweet Heat, Required Reading, Front Row, Thick Skin); the rest are plays and post effects. The owner had them all
   settled here.
2. **None of the 13 builds today.** Each needs engine work that is not built (section 1). Weighed: building Sweet Heat
   and Required Reading now on the percentage `by` and letting Settlement turn them flat, as it will Heat Magnet. As a
   percentage Sweet Heat does not reach the Tweener, the class it is for (`tweener.splitTheRoom` earnings carry no
   quadrant), so both wait.
3. **Kick Me is the negative mirror of Hype-Up.** The owner: "there may not be enough ways for Heel/Jabroni, the harder
   classes arguably, to capitalize on negative reacts. They really only have Heat Magnet and Class Clown (which only
   works if you're funny)." The positive side has a common boost on one post (Hype-Up, a whole vote per vote); the
   negative side had no common and no boost on one post. Kick Me, already a common Gimmick on one's own post, now also
   pays a whole vote for each negative vote on the post. Weighed: a 53rd card that does only this (one more card to
   draw); making Heat Magnet common alone (no play on one post).
4. **Heat Magnet becomes common, at 1.00, and larger.** The owner: "people may consider it unappealing in most classes,
   but it has a legitimate use case of salvaging a post that bombs. Maybe the 20% could be boosted so it's strictly
   better than the equivalent Sweet card to compensate for the relative lack of Salty perks." It goes to 75% now and
   three quarters of a vote once Settlement turns it flat, against Publicity Tour's half a vote at uncommon. Weighed: a
   whole vote, which would equal Kick Me's boost across every post the character has and leave Kick Me its refunds
   alone. The owner noted Kick Me may now be a little underpowered and left it to this session's judgment: it stays at
   a whole vote, and the question goes to the season review (section 7).
5. **One rule for every Earn: on any one vote, the largest boost applies.** Today Earn effects add unless they share a
   `group`. With seven Earn cards whose quadrants overlap (Heat Magnet and Sweet Heat on heat, Kick Me and Heat Magnet
   on a post's negative votes, Hype-Up, Publicity Tour and Required Reading on calm), a group per pair is a table
   nobody can hold. Thick Skin is a different kind of effect and works beside any Earn.
6. **Sizes follow #683's flat rate:** half a vote on a character for 3 days; a whole vote on one post (Hype-Up's
   size). A vote is 0.10 aura (`settings.vote`).
7. **Cheap Shot reaches up to its own rarity,** as every Ward and Reversal does: it gets past Force Field, Rope Break
   and Hall Pass, and not Sugar Coat. Weighed: rare, getting past everything, which makes a rare Ward answerable by one
   card and takes the rarity bound out of the one place it would be new.
8. **Time Machine runs 3 days, blocks cards up to rare, and the author's edit ends it.** #683 found it too strong at a
   week against every rarity. Weighed: the author unable to edit for the whole time, which leaves an author who needs
   to change something real waiting on an admin.
9. **Ratio's mark stays until an admin lifts it.** Weighed: a mark that fades after 30 days. The owner approved the row
   as proposed.
10. **The words in section 3 are drafts for the owner's review in this PR.** The owner approved every number and
    effect in conversation; the taglines, summaries, log lines and statuses were drafted afterward in the house style
    of the built cards and were sent, at the owner's request and marked as drafts, to the session rendering the cards'
    promotional images.

## 1. The cards, and what each waits on

| Key | Name | Kind | Waits on | What it needs from that plan |
|---|---|---|---|---|
| `sweet-heat` | Sweet Heat | Gimmick, own character | Settlement | The flat Earn: an amount per vote received, by quadrant, whatever the class does with the vote |
| `required-reading` | Required Reading | Gimmick, own post | Settlement | The flat Earn on a post |
| `front-row` | Front Row | Gimmick, own character | Settlement | The flat Earn filtered by the kind of Act: votes on the character's card Acts |
| `thick-skin` | Thick Skin | Gimmick, own character | Settlement | A new effect: a share taken off each loss from a reaction |
| `kick-me` | Kick Me | Gimmick, own post | Settlement and Plays | The flat Earn on a post; and a Gimmick on a post that refunds casts by flavor, up to a count |
| `cheap-shot` | Cheap Shot | Gimmick, own character | Plays | A Gimmick the character's next cast uses up, which gets that cast past Wards and Reversals up to a rarity |
| `buzzkill` | Buzzkill | Move, post or character | Plays | A cast that ends one named Gimmick on its target |
| `pay-it-forward` | Pay It Forward | Reversal | Plays | A spring outcome that lets the cast land and returns its card |
| `whoopee-cushion` | Whoopee Cushion | Reversal | Plays | A ride outcome beside a `match`, paying on every quadrant (today `card_kinds_problem` refuses "an outcome beside a match", and a ride spring pays in one named quadrant) |
| `so-very-happy` | SoVeryHappy | Reversal | Plays | A `match` that excludes a flavor; and a spring outcome that locks the caster out of the thread for a time |
| `time-machine` | Time Machine | Move, post | Post and thread | Showing a post as of an earlier Act, refusing casts on it up to a rarity, and ending on the author's edit |
| `ratio` | Ratio | Move, post | Post and thread | A layer that takes its own reactions, and a mark decided by comparing two vote counts at its end |
| `necro-bump` | Necro Bump | Move, post | Post and thread | A cast that moves a thread to the top of its board, and a minimum age for the target |

Kick Me is the one card that waits on two plans. It builds after Plays, the later of the two.

## 2. Rules every card here shares

- **The layers.** Each card is Divided World's, in `instances/divided-world/cards/<key>.ts` and
  `instances/divided-world/ui/cards/<key>/ui.ts`. Each effect in section 1's last column is the engine's, named for
  what it does and never for a card or a class.
- **Ways out.** Every timed effect ends by itself at its time, and an admin can end any play sooner. A card that adds a
  state names it in its row.
- **No play price.** Each costs its machine price and nothing more to play.
- **The masks.** Every flat Earn pays the same amount to any class, so playing one names no class. No refusal below
  depends on who owns a target: "your own post" and "another character's post" are about the character playing, which
  is public. The votes a card pays on are settled, and shown only as each settled window's sums; nothing live is
  computed from who reacted. Votes by the setter's own player never pay, as today, and that is settlement's to apply.
- **A Mod Bot** earns nothing and has no wallet. The staff pool offers only casts and sets (`cardsOnOffer`,
  `supabase/functions/chatter/core.ts`), so no Gimmick here is offered. Whether a common Reversal that pays (Whoopee
  Cushion) is offered is already decided: a Set whose trap pays out is not (`0086_staff_cards.sql`).
- **Stacking.** Section 0.5.

## 3. Each card's row

Prices are orbs at the Vending Machine. "Status" is the line shown where the play is up (`CardUi.status`); "log" is
the line in the player's own log (`CardUi.logPlay`), which says plainly what the play did.

### 3.1 The stat cards (after Settlement)

**Sweet Heat** (Pepperoni, uncommon, 1.50, Gimmick on one's own character, 3 days)
- Each hype (excited-positive) or heat (excited-negative) vote on the character's posts pays half a vote more.
- Refused while a Sweet Heat is already up on the character.
- Tagline: "Get paid for the pop and the boos."
- Summary: "Used on your own character. For 3 days, each excited reaction to its posts, positive or negative, pays
  half a vote more."
- Status: "Paid more for excited reactions". Log: "Each excited reaction to that character's posts, positive or
  negative, pays half a vote more until it ends."
- Why Pepperoni and not rare: it serves the Tweener, whose split needs both; at the flat rate it is modest (#683).

**Required Reading** (Sweet, common, 1.00, Gimmick on one's own post, a week)
- Each calm-positive vote on the post pays one vote more. Only votes after it is played count.
- Refused while one is already up on the post.
- Against Hype-Up: Hype-Up is stronger for its 3 days (both positive quadrants, anyone's post); Required Reading runs
  a week, past the day the Technician's Evergreen starts paying.
- Tagline: "Make them take notes."
- Summary: "Used on your post. For a week, each calm positive reaction to it pays one vote more."
- Status: "Paid more for calm positive reactions". Log: "Each calm positive reaction to that post pays one vote more
  until it ends."

**Front Row** (Pepperoni, uncommon, 1.50, Gimmick on one's own character, 3 days)
- Each vote, in any quadrant, on a card the character plays pays half a vote more.
- Refused while one is already up on the character.
- Tagline: "Get paid for the cards you play."
- Summary: "Used on your own character. For 3 days, each reaction to a card it plays pays half a vote more."
- Status: "Paid more for reactions to its cards". Log: "Each reaction to a card that character plays pays half a
  vote more until it ends."

**Thick Skin** (Sweet, uncommon, 1.50, Gimmick on one's own character, 3 days)
- Each loss the character takes from a reaction is halved. It changes no earning.
- Beside a flat Earn: the loss is halved first, and the Earn's amount is added after. Both apply.
- Refused while one is already up on the character.
- Tagline: "Let it bounce off."
- Summary: "Used on your own character. For 3 days, what it loses from reactions is halved."
- Status: "Loses half as much from reactions". Log: "What that character loses from reactions is halved until it
  ends."

**Kick Me** (Pepperoni, common, 1.00, Gimmick on one's own post, 3 days; after Plays)
- A "Kick Me" sign hangs on the post. Each negative vote on it, heat or groan, pays one vote more. The first three
  Salty cards cast there land, and each goes back to its caster's hand.
- A cast by the setter's own player is refunded like any other (a refusal or a difference there would show who owns
  the caster); it never pays the Jabroni, as today.
- The sign fills nothing: it is drawn hung on the post's content area, at its top edge, and covers no words. Its look
  is the owner's to settle in its build plan's design.
- Refused while one is already up on the post.
- Tagline: "Hang a sign on your own post."
- Summary: "Used on your post. For 3 days, each negative reaction to it pays one vote more, and the first three Salty
  cards cast there go back to their casters' hands."
- Status: "Wearing a Kick Me sign". Log: "Each negative reaction to that post pays one vote more until it ends, and
  the first three Salty cards cast there go back to their casters." A caster's log, on a refund: "The Kick Me sign
  on that post gave your card back."

### 3.2 The plays (after Plays)

**Cheap Shot** (Salty, uncommon, 1.50, Gimmick on one's own character)
- The character's next Move, cast within 3 days, gets past Wards and Reversals up to uncommon. That Move uses it up;
  with no Move cast, it ends after 3 days.
- A Reversal it gets past stays face down, unsprung, and nothing is told to its setter. A Ward or Reversal above
  uncommon works as it always does, and the Cheap Shot is still used up.
- It does nothing about Last Word, which stops quotes, not casts. It does nothing for a Move that lands from a quote.
- Tagline: "Hit them while the ref isn't looking."
- Summary: "Used on your own character. Its next Move within 3 days gets past Wards and Reversals up to uncommon."
- Status: "Lining up a cheap shot". Log: "That character's next Move gets past Wards and Reversals up to uncommon."
  And on the Move: "Your Cheap Shot got this card past a Ward" or "past a card set face down", only where it did.

**Buzzkill** (Salty, rare, 3.00, Move on a post or a character; instant)
- Ends one Gimmick up on the target, up to rare, which the caster picks from those showing there. The Gimmick is not
  refunded. It does not reach a Gimmick on a thread.
- Wards are asked as for any Salty cast: Sugar Coat turns it away; Force Field, which wards up to uncommon, does not,
  so a Buzzkill can end a Force Field.
- Refused where the target has no Gimmick up.
- Nothing is destroyed: the ended play is an Act beside the Gimmick's, and an admin can reverse it.
- Tagline: "Party's over."
- Summary: "Cast on a post or a character. Ends one Gimmick there, up to rare. You choose which."
- Log, caster: "It ended the {card} there." Log, the Gimmick's owner: "A Buzzkill ended your {card} early."

**Pay It Forward** (Sweet, uncommon, 1.50, Reversal on one's own post)
- Springs on the first Sweet cast there, up to uncommon. The cast lands, and its card goes back to the caster's hand.
  The setter is paid nothing beyond what a spring already earns.
- Springs once, or ends after the instance's set time (`settings.setLasts`).
- Tagline: "One good turn."
- Summary: "Set face down on your post. The first Sweet cast there, up to uncommon, lands, and its card goes back to
  the caster's hand."
- Status: every Reversal's, "Set, face down to everyone else". Log, caster: "A Pay It Forward on that post gave your
  card back."

**Whoopee Cushion** (Pepperoni, common, 1.00, Reversal on one's own post)
- Springs on the first common cast there, whatever its flavor. The cast lands, and each vote it draws, in any
  quadrant, pays the setter a quarter of a vote. Votes by the setter's own player pay nothing.
- Springs once, or ends after the set time. Once sprung it pays for as long as the cast draws votes, as 4D Chess does.
- Tagline: "Have a seat."
- Summary: "Set face down on your post. The first common cast there lands, and every reaction to it pays you a
  quarter of a vote."
- Log, setter: "It sprang on a {card}. Each reaction to that card pays you a quarter of a vote."

**SoVeryHappy** (Salty, rare, 3.00, Reversal on one's own post)
- Springs on the first cast there that is not Sweet, up to rare. The cast lands, and its caster's character cannot
  post or play cards in that thread for 24 hours. Reading and reacting are untouched.
- **The state it adds, and its way out:** the thread lockout ends by itself after 24 hours, and an admin can end it.
  The locked-out character's own screens say so with the time it ends, on the reply form and the card tray of that
  thread.
- The lockout is public, as the cast that earned it is.
- Springs once, or ends after the set time.
- Tagline: "Good vibes only. Or else."
- Summary: "Set face down on your post. The first cast there that isn't Sweet, up to rare, lands, and its caster is
  locked out of the thread for 24 hours."
- Log, caster: "A SoVeryHappy on that post locked {character} out of the thread until {time}."

### 3.3 The post and the thread (after the post and thread plan)

**Time Machine** (Pepperoni, rare, 3.00, Move on any post, 3 days)
- The post shows as it was at a point the caster picks from its public edit history: as first posted, or as of any
  edit shown there. A version saved inside the edit grace window is never a point.
- While it is up, no card up to rare can be cast on the post.
- Cards already on the post are hidden, not ended: their clocks run, a Mooch or a Toll keeps scoring, and they show
  again when it ends. A card set face down stays and cannot spring.
- Refused on a post with nothing to rewind: never edited, and no card showing on it.
- Wards are asked as for any Pepperoni cast.
- **Its way out:** 3 days; the author's edit, which ends it at once and lands as the post's newest version; or an
  admin. Nothing is destroyed: the post is computed from its Acts as of the point.
- Tagline: "Take it back."
- Summary: "Cast on a post. For 3 days it shows as it was at an earlier point you pick, and no card up to rare can be
  cast on it. The author's edit ends it."
- Status: "Showing an earlier version". Hint, to the author: "Edit this post to end the Time Machine." Log: "That
  post shows as it was on {date} until it ends."

**Ratio** (Salty, common, 1.00, Move on another character's post, 3 days)
- A RATIO stamp sits under the post and takes its own reactions for 3 days. At the end, if the stamp drew more votes
  than the post did in those 3 days, the post keeps a "ratioed" mark. A stamp that fails leaves nothing.
- Only votes cast during the 3 days count, on both sides. The comparison is made once, at the end, by settlement, from
  counts that are already public on the post and the stamp.
- Refused on the caster's own character's post, and while a Ratio is already up on the post.
- **The state it adds, and its way out:** the mark is a layer over the post that changes none of its words; an admin
  can lift it.
- The stamp is placed under the post's words and fills nothing; the mark's look is its build plan's.
- Tagline: "Outdraw the post."
- Summary: "Cast on another character's post. A stamp sits under it for 3 days. If the stamp draws more reactions than
  the post, the post is marked ratioed."
- Status: "Being ratioed". Log, caster, at the end: "Your Ratio drew {n} votes to the post's {m}. The post is marked
  ratioed." or "The post is not marked."

**Necro Bump** (Pepperoni, uncommon, 1.50, Move on any post at least 3 days old; instant)
- The post's thread goes to the top of its board, as if someone had just posted in it, and the post reads "bumped"
  for a day.
- The 3 days is the card's own setting (`necroBump.days`), never the Technician's `technician.evergreenDays`.
- Refused on a younger post, and in a thread where a post still reads "bumped": one bump per thread per day.
- Tagline: "Raise a dead thread."
- Summary: "Cast on a post at least 3 days old. Its thread goes to the top of its board, and the post reads bumped for
  a day."
- Log: "It bumped that thread to the top of its board."

## 4. Heat Magnet (buildable now)

| | Today | Now | After Settlement |
|---|---|---|---|
| Rarity, price | Uncommon, 1.50 | Common, 1.00 | the same |
| Size | 20% higher | 75% higher | three quarters of a vote for each negative vote |
| Lasts | 3 days | 3 days | 3 days |

For a class that earns from a negative vote, 75% of the earning and three quarters of a vote are the same amount, so
the card can change now. Until Settlement it still does nothing for a class that loses from the vote; the salvage use
arrives with the flat Earn. The plan is `docs/plans/2026-11-15-heat-magnet-common-plan.md`: instance files alone, no
migration.

What changes for a player: Heat Magnet is on sale on a newly seeded machine, with the commons' Gimmicks. A machine a
database already holds keeps its slot as it is until an admin changes it (`seed_instance` never touches a held slot).

## 5. The machine and the set, with every card here built

- **Commons:** the 12 on main with Steel Chair, and Heat Magnet, Required Reading, Kick Me, Whoopee Cushion and
  Ratio: 17. With the Booster the machine draws 18 slots: nine full rows.
- **By rarity:** 17 common, 22 uncommon, 11 rare, 2 legendary: 52.

## 6. The order of building

- **Now:** Heat Magnet's plan. It touches no slot of the sorted lists (the card is already in them), so it runs beside
  any card build.
- **After each engine plan,** its design session writes one plan per card from section 3's rows, and the cards build
  by the roadmap's waves and slots (`docs/plans/2026-11-14-base-set-design.md`, section 2). Two things differ from
  that table:
  - **`interference` is `buzzkill`.** Its slot is between `blind-study` and `card-collector`, which holds no other
    new card, and not between `hype-up` and `jimmy-wails`.
  - **Kick Me waits for Plays** though it is also a flat Earn.
- **The shared slot** is still `publicity-tour` to `stick-around`: Required Reading (wave 2), SoVeryHappy (wave 3) and
  Ratio (wave 4) each start after the one before merges, and Required Reading after Steel Chair.
- **Settlement's conversion** of the built Earn cards takes these sizes: Heat Magnet three quarters of a vote, Publicity
  Tour and Class Clown as #683 has them, Hype-Up a whole vote; and section 0.5's rule in place of `group`.

## 7. Open

- **Is Kick Me underpowered beside a common Heat Magnet?** The owner raised it and left it to judgment. It is kept at a
  whole vote on one post with its three refunds; the season review tunes it.
- **The words in section 3** await the owner's read.
- **Kick Me's sign, Ratio's stamp and mark, and the "bumped" label** are screens whose look is the owner's, settled
  when each card's plan is written.
- **Cheap Shot and a trap it gets past:** the trap's setter is told nothing. If the season shows that feels like a
  fault ("my Rope Break didn't fire"), the setter's log could name it after the fact.
- **#683's questions this does not settle:** the reveal perk's rates and what counts as "from reactions"; whether Line
  Cutter's reply counts toward the Lurker's limit; starter cards (#598).

## 8. What this settles in #683

- Sweet Heat's rarity and rate; Required Reading's and Front Row's; Thick Skin's overlap with flat Earns.
- "Sizing (open)" for the flat rate: half a vote on a character, a whole vote on a post, three quarters for Heat
  Magnet.
- "The group rule says how a flat boost and a fractional one combine": the largest applies on each vote.
- Cheap Shot: Last Word, and whether a trap it gets past is told.
- Pay It Forward: whether the setter gets more.
- Interference: its name, threads, and Wards.
- Time Machine: who picks the point, hidden effects, a face-down card, the author's edit, and its strength.
- Necro Bump: the minimum age's setting.
- Ratio: what is compared, and the mark's way out.
- Gap 3's "Heel and Jabroni": Kick Me's negative Earn and the common Heat Magnet.
