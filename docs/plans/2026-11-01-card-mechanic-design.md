# The card mechanic: plays, traps, wards and reach

Record, written 2026-11-01. The design session on group #132, made with the owner, covering the core of the card
mechanic: #55's plays and traps, #34's targets beyond a post, and #122's cards on a staff post. The owner chose this scope
over the whole group. #55's second half (card condition and a supply of individual copies), #83 (a post's images in what
it costs to splat) and #33 (the pool itself) each wait for a design of their own, and their issues stay open. Each section
was confirmed by the owner before the plans were written. The plans are `docs/plans/2026-11-01-card-plays-plan.md` (Part 1:
sections 1 to 6 and 9) and `docs/plans/2026-11-01-card-reach-plan.md` (Part 2: sections 7 and 8), each built by one build
session in one PR, Part 1 first.

The owner on what this is for: Minus World had "Spell Trap", a single card, and no others. "This basically expands on
that idea so the players' actions against themselves and others are under a unified system, where power lies in what
you've found rather than how long you've been saving up."

## 0. Where it starts

- A card is bought from the Vending Machine at its base price, held in the hand, and played on a post
  (`CardRules`, `CardTarget`, `decidePlay` and `landsOnPost` in `engine/rules/cards.ts`). A play is an Act of kind `card`
  whose `target_act_id` is the post (`play_card`, `supabase/migrations/0016_cards_screens.sql`). Its rules are run by the
  act Edge Function (`supabase/functions/act/core.ts`), and SQL holds the stack, the wallet and the hand again.
- Arming a card in the hand (`engine/ui/cards/Hand.tsx`) puts a ghost mark on every post it can land on
  (`GhostMark`, `engine/ui/cards/PlayActions.tsx`; `landing`, `engine/ui/cards/land.ts`). That is the only way to play a
  card. The 2003 action row (Quote, Edit, Spin) holds no card controls, because the glass is kept apart from the board's
  chrome (marks-and-the-lens design, section 1). The owner restated this in this session.
- A post's plays show as marks, and a mark opens the Lens (`engine/ui/cards/Marks.tsx`, `engine/ui/cards/Lens.tsx`), with
  React and Spin for each play.
- A card on a staff post lands, shows, and pays nobody. `is_staff_side` (`supabase/migrations/0043_staff.sql`) leaves it out
  of `settlement_input` with the staff post, because `settle.ts` has no scored target to judge it against (#122).
- The staff design (`docs/plans/2026-10-31-the-staff-design.md`, section 14) left three hooks for this design: a Use play on
  a thread that ends a Mod Bot's visit (the distraction weakness), a set trap that springs on a visit, and worn cards in
  Random Events. The first two are named here (sections 1 and 3). The third waits for card condition.

## 1. One play per card

**Decided** (the owner chose the recommendation): each card names the one way it is played.

| Play | Where it goes | Face | Minus World's version |
|---|---|---|---|
| **Cast** | any target its reaches allow (section 7) | up | every spell; today's cards |
| **Use** | the player's own post or own character, or a thread | up | Respellent, a ward |
| **Set** | the player's own post | down | Spell Trap |
| **Keep** | stays in the hand until something calls for it | none | Knick-Knacks |

- The Vending Machine's slot and the card's face say its play, so a player knows how a card is played before buying it. A
  card that is needed two ways is two cards in the pool.
- **A Use or Set Act is written by the post's own author** (or, on a character, by that character), so the public line is
  "Pipewrench set a card face down" and reads no owner. A Use on a thread is written by the armed character.
- **Keep is named and not built.** No card calls for a Keep yet. It is designed with its first consumer: combinations (#27)
  or the Killing Game's roles (#37).
- **No own-mask refusal.** A Cast is not refused for whose mask the target is. Instead, no outcome pays more than the
  caster's wallet spent (section 4), so a player's masks never come out ahead by playing on each other, and nothing reads
  who owns what (#55's second option).

Weighed: a card listing several plays, picked when played (every card would price and rule each one, and the play form
would gain a step); no named plays, with "own post, face down" as just a target (traps and wards lose a name players
learn).

## 2. Rarity

**Decided:** every card has a rarity: common, uncommon, rare or legendary. The engine names these four in order, and an
instance's cards each choose one. Rarity bounds a trap's catch (section 4), a ward's reach (section 5) and a card's reach
(section 7). Which cards the Vending Machine sells, and which only drop or come in packs, is the gacha's design. The
owner: "Not every card will be purchasable from the vending machine directly - rare ones would be in booster packs or
found from exceptionally rare random events." So nothing in this design reads a card's machine price as its value.

The first rarities: Whoops! and Stick Around are common; Bluff is common; Trap Card, Force Field and Glitter Bomb are
uncommon; Main Event is rare.

## 3. Face down

**Decided** (the owner chose the recommendation): a Set is a public Act with a card back on the post.

- **Everyone sees a card back** in the post's marks: one back, the same for every Set card, so a trap cannot be told
  from a Bluff. The Lens on it says "A card set face down by Pipewrench", when it was set, and when it ends, with React
  and Spin like any play.
- **Which card it is** lives in a private row (`face_down`), read only by the setter's account. The Set Act's payload names
  no card. The setter's own screen shows their card's face on the back.
- **One face-down card per post at a time.** A second Set on the post is refused in plain words, which is public, since the
  back is.
- **Every Set lasts the same time**, an instance setting (`setLasts`, 7 days by default). A lifetime per card would let the
  back's end date name the card.
- **Its ways out:** it springs once, or it ends at `setLasts`. A spring is a new Act that reveals the card (section 4). An
  end reveals nothing: the back goes, and a Bluff stays a bluff. The setter's log says plainly which happened, and what
  the card was.

Weighed: nothing shown until it springs (no deterrence, no bluff, and the one Act nobody could see); a back with no name
(on one's own post the name is the author's anyway).

## 4. Traps: triggers and outcomes

**Triggers** (the owner chose the recommendation): a fixed list in the engine, and each trap names one.

- **cast:** a card is cast on the post.
- **reaction:** a reaction of a named quadrant lands on the post.
- **reply:** the first post in the thread after it by another character.
- **quote:** a post that quotes it.
- **visit:** a Mod Bot's visit to the post (the staff design, section 14). It is named in the list now and wired when visits
  are built, by the staff build. Until then no card names it.

A new trigger kind is engine work and goes in a plan. A trap springs inside the transaction of the write that sets it off.
**A trap never refuses, delays or rolls back the write that springs it.**

**Outcomes** (the owner chose the recommendation, and dropped one):

- **Nullify:** a cast lands as a "caught" play. Its Act stays ("Append-only"), it shows as caught and does nothing else,
  and its card is spent. A visit just ends.
- **Pay out:** Nullify, and the trapper's wallet gains exactly what the caster's wallet paid for that play (Whoops!'s
  length price, for example), capped like any income. Nothing is paid for the card itself. The owner chose this over a
  worth per rarity, because cards from packs and drops have no clean price. A card that is free to play makes a Pay out a
  Nullify, and a player casting on their own mask's trap only ever breaks even.
- **Strike:** the trap lays a card it carries on the Act that sprang it, or for a reaction, on the reacting character
  (section 7). The setter configures the struck card when they Set the trap, and its own rules check that configuration.
  It costs nothing more to play. A strike that cannot land (its target already holds its stack) leaves the trap set.
- **Reflect is dropped.** The owner: "a card being played is often customized toward the exact post it's being used on, so
  a pure switch may not work." Stealing the card into the trapper's hand was weighed and dropped too, since it would be the
  first card moving between players.

**The rarity bound** (the owner chose the recommendation): a trap catches only a card at or below its own rarity. A rarer
card passes over it, lands as usual, and the trap stays set. A struck card is at or below its trap's rarity. The owner's
reason: "People will feel discouraged from playing a super rare card ... if there's a chance it fails altogether and they
don't get another attempt." A caught card is spent, as in Minus World, so a trap is a real trade, and the card back
tells a caster that the risk is there.

**The reveal:** a spring writes an Act of kind `spring` by the setter's character on the trapped post, naming the card,
the trigger, the outcome and the Act it caught. It is public, reacted to and spun from, and it earns its author by class as
a play of the trap card does (section 9). The caught play's own reactions count as any play's do.

Weighed: only cast triggers (the fixed list was chosen); an open hook running instance code on every event on a trapped
post (SQL could not hold it); Minus World's three outcomes; Strike alone.

## 5. Wards

**Decided:** a Use card can be a ward. While it is up, it refuses casts on its own target at or below its rarity. The ward
is checked before the incoming card's own `canApply`, by `decidePlay` and again by `play_card`. The refusal is public and
the same for everyone ("this post's Force Field turns away cards up to uncommon"), since the ward is face up. A ward never
blocks a Set, and it refuses casts on its own target only, never on posts under a thread it covers. It ends at its card's
stated time, and that is its way out.

## 6. The first cards (Part 1)

The owner on names: avoid mail references. A postcard is a post plus a trading card, "more a TCG vibe".

- **Trap Card** (uncommon, Salty, Set): springs on a cast, Pay out. Minus World's Spell Trap, said plainly as the gag it
  was.
- **Force Field** (uncommon, Sweet, Use on one's own post): a ward for a week.
- **Bluff** (common, Pepperoni, Set): a card back that does nothing.
- **Whoops!** and **Stick Around** become common Casts, otherwise unchanged.

Each card's price is an economy setting, as today. The plans set starting numbers, and the season review replaces them.

## 7. Reach (#34)

**Decided** (the owner chose the recommendations):

- **`CardTarget` becomes a sum type**: a post, a character, a thread, or a board. Each card lists the reaches it accepts
  (`reaches`, a post unless it says otherwise). Ladder Match's rival post goes in its configuration, not in a fifth kind.
- **Reach by rarity is held once:** an instance setting gives each reach's least rarity (`reachRarity`: character
  uncommon, thread rare, board legendary). `instanceProblems` refuses a card that reaches further than its rarity allows,
  so a seed cannot hold one.
- **Ghost marks where each target shows.** With a card armed, a ghost mark is drawn on each postbit in view (character),
  on the thread's head (thread), or on the board's banner (board), wherever the card can land. Each target's marks open
  the same Lens, with React and Spin.
- **Where each play's Act sits:**
  - a character play: the thread it was played in
  - a thread play: that thread
  - a board play: The System's announcements thread, beside the moves, since a legendary that shakes a board reads like one
- **Every effect beyond a post ends on a timer** (its way out). The card names how long, and an instance bound per reach
  caps it (`reachLasts`: character 7 days, thread 1 day, board 1 day). The play's end is stored with it when it lands, a
  fact of the play, never edited.
- **Stacking:** a target carries at most its stack of each card, as a post does. A board carries one board card at a time;
  a second is refused in plain words while one is live. A card's `canApply` sees every effect above its target (board,
  then thread, then character, then post), and the screens wrap effects in that order, so cards combine across reaches.
- **The masks:** a character effect falls on the mask alone. Nothing reaches a player's other masks or the wallet, and
  nothing reads who owns the character.
- **Board moves:** a rename keeps the board's card. An admin's hold on a move does not touch it. The moves hold no merge
  today (`engine/system/moves.ts`); when one is added, its design ends a merged-away board's card at the merge, and the
  caster's log says so.
- **Staff can be targets** (section 9), and the Use play's thread reach is the staff design's distraction.
- **Settlement:** a play beyond a post has no target post to outdraw. Its reactions pay its caster by class as any card's
  do, and class rules that read a card's target post pass it over. This is the session's default, not a choice the owner
  was asked, and the owner may revise it before Part 2 is built.

Weighed: five kinds by convention, with nothing checking rarity; post and character now and the rest later; a home per
reach (the profile, a pinned cards thread per board); every play beyond a post in The System's thread. The owner rejected
"cast from a post's action row", since the 2003 chrome holds no glass.

## 8. The first cards (Part 2)

- **Glitter Bomb** (uncommon, Pepperoni, Cast on a character): the character's posts sparkle for a week. It is decoration,
  so its accessible path is only reduced motion, which holds the sparkle still.
- **Main Event** (rare, Sweet, Cast on a thread): the thread is pinned to the top of its board's list for a day.
- **The board reach** ships proven by an engine test card. Minus World, the legendary board card, waits for its own screen
  design, since its look is the whole card.

## 9. Staff posts (#122)

**Decided** (the owner chose the recommendation): a Cast lands on a staff post, a staff character and The System's threads,
and earns its caster by class as any card does. `settlement_input` gives `settle.ts` a staff post a card landed on as an
unscored target, with its public reactions, so whether the card drew more than the post can be judged. The staff post
itself still pays nobody. Staff never Set or Use, since they hold no hand. A Boss may read a play on its post in its
digest, as it reads any reaction.

A trap's `spring` Act is settled as a play of its trap card on the trapped post: its reactions count for the setter by
their class's rules on cards, under the trap's alignment.

## 10. The log

Every Set, spring, catch, end, payout, ward refusal and timed end has a plain line in the log of each player it touched
("The fiction may lie; the log never does"):

- the setter: "Trap Card set face down on post N", then "Trap Card caught Spritey's Whoops! on post N; +0.75 to your
  wallet", or "Bluff on post N ended; nothing sprang it"
- the caster: "Your Whoops! on post N was caught by a Trap Card; it cost 1.00 and 0.75, and nothing came back"
- the struck: "A Trap Card on post N laid Whoops! on your reply"
- a timed end: "Main Event on 'thread' ended"

No line names who owns anything, and a caster's line names the trap only once it has sprung, which is public.

## 11. The masks

- **A face-down card's identity** is held like a class. Only the setter's account reads `face_down`. The Set Act, its
  Realtime event and `card_target` carry no card key. A trap that does not match an event and a Bluff do the same read and
  the same nothing, so a write's timing does not say which is there.
- **Wards and rarity passes** read only public facts: the card's rarity and the ward on the post.
- **Pay out** reads the setter's account from `face_down` (the setter's own row) to credit them. No response to anyone
  else carries it, and the amount shown publicly is none. The trapper's and caster's logs each say only their own wallet.
- **Effects beyond a post** are public layers, read in one batched request per page for the page's characters, its thread
  and its board, never one per post.
- **No refusal reads an owner.** Casting on one's own mask is allowed, and the payout bound makes it pointless.

## 12. A busy instance

- A trap check is one probe of `face_down` by post, through an index, inside writes that already lock the post. It runs on
  every cast, reaction and post, and only finds a row on a post with a live card back.
- A page's effects beyond its posts are one read for the page's distinct authors, one for its thread and one for its board.
- Main Event's pins join the board's list as one indexed read of the board's live thread plays, never a scan of threads.

## 13. Ways out of the states this adds

- **A face-down card:** springs once, or ends by itself at `setLasts`.
- **A ward:** ends at its card's time.
- **A caught play:** a finished Act. Its card is spent, and nothing remains to clear.
- **A character, thread or board effect:** ends at its time, at most its reach's bound.
- **A Keep card:** not built.

## Open

- **Keep:** designed with its first consumer (#27 or #37).
- **Card condition and a supply of copies** (#55's second half), with the hand's size and an archive or book, and a
  worth per rarity if one is ever wanted.
- **The gacha, packs and drops:** which cards the Vending Machine sells, and a card with no machine price
  (`CardRules.priceKey` is required today).
- **#83**, image-measured splat pricing.
- **Minus World**, the board card's screen design.
- **The visit trigger and the distraction Use** are wired by the staff build.
- **A merge move** ends a board card when the moves gain one.
