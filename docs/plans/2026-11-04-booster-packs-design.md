# Booster packs, the machine's catalog, and the Boss's hand on the machine: design

Record, written 2026-11-04. A design session made with the owner. Each section was confirmed by the owner before the plan
was written. The plan is `docs/plans/2026-11-04-booster-packs-plan.md`, built by one build session in one PR. It takes up
the gacha's first part, which the card mechanic's design left to a design of its own
(`docs/plans/2026-11-01-card-mechanic-design.md`, section 2: "Which cards the Vending Machine sells, and which only drop
or come in packs, is the gacha's design").

The owner, opening the session: "buying the exact card you need is a nice option to have, and it works today. There's
more of a risk/reward if you can buy a pack of 5 and be surprised by the result."

## 0. Where it starts

- Every card kind with a price is sold singly. A card's price is a key in the `economy` settings row, named by
  `CardRules.priceKey` (`engine/rules/cards.ts`) and `card_kinds.price_setting`. `buy_card`
  (`supabase/migrations/0006_cards.sql`) reads it live. An admin can retune a price only with SQL, and there is no
  admin screen for the machine.
- The Vending Machine (`engine/ui/vending/Vending.tsx`) draws one slot per card, from `facesOf` over every card in the
  instance. There is no catalog: "what is for sale" is not a concept yet.
- The hand is `bought` less `played` rows of `card_ledger`, counted inline in `my_cards`, `buy_card`, `play_card` and
  `set_card`.
- The System's moves are built as a catalog with an effect, a demand and a hard expiry (`engine/system/moves.ts`,
  `engine/system/demands.ts`, `supabase/migrations/0046_moves.sql`). Two exist: `renameBoard` and `nameSuccessor`.

## 1. Where a pack's cards come from: minted, with a seam

**Decided** (the owner chose the recommendation): opening a pack makes its cards by the slot's odds, the way a single
buy does today. Scarcity comes from odds, from which cards are sold singly, and from the Boss's moves (section 6). The
draw is one function, so a finite supply could later replace what it draws from without reshaping packs.

**Per-copy condition is dropped.** The owner: it "sounds like too much work for no additional gameplay value. The idea
of 'played-condition card that might not work as well' is better served by a simple boolean if it exists at all, and it
might be unnecessary altogether." #55's card condition and wear are not designed or planned.

Weighed:
- A finite print run now: each kind has a supply count, and packs and singles draw from it. Without trading between
  players, a finite supply in a small cast is a race to whoever checks the machine first.
- The full economy first: supply, condition and trading designed together before packs.

## 2. Three layers, each owned by one place

**Decided:**

| Layer | Lives in | Who changes it |
|---|---|---|
| What a card does, its rarity, each pack's pull tables, which cards a pack leaves out | instance code, seeded into the database | a PR, reviewed with the cards |
| Each slot's order, availability and price | the database, seeded from the instance | admins, on the machine's admin page (section 7) |
| The Boss's moves over a slot | Acts, a layer over the admin's settings | the Boss, within the code's limits (section 6) |

The owner, on what an admin needs: "New cards must already be added via code in order to do anything. If booster packs
are just lists of pulls, it seems the only things to really decide are: the order of items in the machine grid; which
items are available in the machine at all ('out of stock' or fully hidden); their prices."

- **A slot sells an item.** An item is a card or a pack today, and later a cosmetic (section 9).
- **A slot's availability** is one of: *on sale*; *sold out*, which draws the slot greyed, so it teases what exists;
  *hidden*, which draws nothing.
- **Prices move onto the slots.** The `economy` row loses each card's price, and `CardRules.priceKey` and
  `card_kinds.price_setting` go. A card's price sits next to the thing it prices. A card with no on-sale single slot has
  no buy price, which the card mechanic's design already allowed for ("nothing in this design reads a card's machine
  price as its value").
- **A re-seed never overwrites an admin's choice.** Seeding adds the slots the instance names that the database does not
  hold yet, and leaves every existing slot as the admin set it.

## 3. A pack is a list of pulls

**Decided** (the owner chose the recommendation): a pack is a list of pulls, each with its own rarity table. Within a
rarity, each eligible card is equally likely. This is the trading-card-game shape: a pack can have a floor and a long
shot.

- **Which cards are eligible:** every card at that rarity, unless the pack's own list leaves it out. A new card joins
  packs by its rarity without editing anything else.
- **The instance's check refuses** a pull table that names a rarity with no eligible card, so the odds shown are never a
  promise the draw cannot keep. Adding the first legendary card is the same PR that puts legendary in a table.

Weighed: one rarity table for the whole pack (a pack can roll five commons, which in a small cast happens often enough
to sting); a weight for each card (tedious, and every new card is added to every pack by hand).

## 4. The starting catalog

**Decided** (the owner confirmed it as put). Every number is a setting the season review replaces.

- **Singles:** every common and uncommon is on sale at today's prices. **Main Event**, the one rare, is *hidden*. It
  comes from packs, or from the Boss's flash sale (section 6). Today it can be bought outright.
- **One pack, "Booster": 5 cards for 3.00 orbs.**
  - Four pulls at common 85 / uncommon 15.
  - One hit pull at uncommon 75 / rare 25.
  - At today's prices that is about 5 orbs of single-card value for 3.00: the deal is paid for in uncertainty.
  - Legendary is in no table yet, since no legendary card exists.

## 5. Buying a pack

**Decided:**

- **The pulls are rolled when the pack is bought**, against the catalog and pull tables as they stand that day, and are
  stored with the pack. One transaction spends the wallet, rolls the pulls on the server, writes the pack row, and
  writes one ledger row per card tagged with that pack.
- **Opening only reveals them.** Today the opening is the same moment as the purchase. The animation (the pack drops
  into the tray, tears open, the cards fly to the hand one by one with the hit pull last) shows what is stored. A reload
  or reduced motion, which shows all five at once, never changes what was bought.
- **A sealed pack is the recorded path for later.** The owner chose to open at once, "with a path for introducing B
  later". The owner on why the pulls are rolled at purchase either way: "a pack purchased in November 2026 has cards
  that were available in November 2026, not a collection of pulls from whenever it's eventually opened. Alongside
  rosters of cards that become harder to find over time, plus ideas like alternate art variants, it becomes potentially
  a very calculated move to pursue a pack from a specific time." A pack row with an `opened_at` is that path: a sealed
  pack is a row whose cards have not yet been written to the ledger.
- **The slot shows its odds plainly**, pull by pull, and each card's chance in the hit pull. The machine is glass, and
  the glass speaks plainly.
- **The hand is computed by source.** It is the sum of ledger rows by kind: bought, pulled from a pack, played, and the
  welcome gift's `granted` once the onboarding plan's Task 11 builds it. One function counts a hand, in place of the four
  inline counts today. A trade, later, is two more kinds.

Weighed: a pack held sealed in the hand now (a second kind of thing to hold, for a payoff that comes only with trading).

## 6. The Boss's moves over the machine

**Decided** (the owner chose the recommendation): the Boss gets three small moves over the machine. Each is a move in
the catalog The System already has: an effect from the code's fixed list with limits, a hard expiry, and a demand where
it punishes. Each lands on the Boss's schedule, costs one move from its weekly bank, and an admin can REVERSE it.

| Move | Targets | Limits (settings) | Ends |
|---|---|---|---|
| **Pull** | an on-sale single-card slot whose card is still in an on-sale pack | at most 2 slots pulled at once; at most 7 days | its demand met, its expiry, or an admin |
| **Reprice** | any on-sale slot, packs included | ×0.5 to ×2 of the admin's price; at most 7 days | a markup: as Pull. A markdown: its expiry, or an admin |
| **Flash sale** | any slot the admin has hidden | 24 to 48 hours; one at a time | its expiry, or an admin |

- **Packs are the floor** (the owner chose the recommendation). The Boss never pulls a pack slot, and it pulls a single
  only while that card can still come from a pack on sale. The owner: "I don't have any problem with the Boss pulling
  single slots if those cards are still available in boosters." A pulled single turns "buy it" into "gamble for it",
  never "you can't have it".
- **Favors carry no demand** (the owner agreed). A demand ends a move early when it is met, so on a markdown or a flash
  sale it would be the crowd ending its own deal. Pull and a markup are punishments, and their demand is a way out.
- **One Boss move per slot at a time.**
- **The admin's word wins.** A slot an admin marks *sold out* or *hidden* is never put on sale by a Pull or a Reprice.
  Flash sale is the one move that lifts *hidden*, and only for its window. A moved price is the admin's current price
  times the move's factor, so a retune during a markup still counts.
- **Reordering is the admin's alone.** It is layout, and the Boss gains nothing from it.
- **What players see:** the move is an Act by the Boss, posted as moves are, which may gloat in character. On the machine,
  which speaks plainly, the slot says what happened: "Pulled by the Boss · back Nov 9, or when 12 different characters
  post in Tomato Talk", or "Flash sale · until 9 PM".
- **What the Boss reads:** the machine's slots, prices and moves in force, all public. It never reads purchases or sales.
- **Inheritance:** a machine move shapes no board, so a new Boss does not review it. It runs out within a week.
- **A broken card is never hidden for safety.** The owner, on the risk of a flash sale reaching a card that was hidden
  because it does not work: that is "defended against by unit tests that require it to work for the build to happen at
  all." *Hidden* means "not in the machine now", never "unsafe to sell".

Weighed:
- Admin-only for now, with the Boss's machine moves designed later.
- Structural moves too, letting the Boss change the baseline through the admin queue: a Boss changing the machine for
  the next Boss crosses the regimes the inheritance review keeps apart.
- An inverted demand on a flash sale, so players could extend it.
- Expiry alone as the guard on Pull, with packs pullable too: a card could be wholly unobtainable for the move's length.

## 7. The machine's admin page

**Decided:** a glass page beside the move queue (`/admin/machine`), listing the slots in grid order. For each slot:
- move up and move down buttons, from the keyboard;
- an availability select: on sale, sold out or hidden;
- a price field.

A Boss move in force shows on its slot, with a link to REVERSE it in the queue. Changes are configuration, saved in place
as the settings row is, and travel with the export.

## 8. Layers, ways out and the masks

**Layers.** The engine holds the slot and pack mechanics, the roll, the three moves, the machine and its admin page. The
instance holds its packs (pull tables and leave-outs), its starting catalog, each pack's name and art, and the
machine's look. They come in through `Instance.packs`, `Instance.machine` and `InstanceUi.packs`.

**Ways out** ("No player is ever stuck"):
- A slot pulled by the Boss: its demand, its expiry, or an admin. The card stays in a pack on sale the whole time.
- A markup: the same.
- A slot an admin made *sold out* or *hidden*: an admin. No card is ever only in a hidden slot, since every card is in a
  pack unless the instance's code leaves it out.
- No state is added to a player, a character or a post.

**The masks** ("A response never proves a private fact"):
- Buying stays private, as today. A pack's contents are in the buyer's own ledger and log alone.
- The machine's state is computed from slots and public move Acts, and is the same for everyone.
- A refusal ("the price is now 2.00", "this slot is sold out") reads the slot, never the buyer.
- The roll reads no account and no character.
- The Boss reads no purchase.

## 9. Open

- **Trading between players and cosmetic items.** The owner: the Boss's moves feel "incomplete without between-player
  trading and cosmetic items in the mix (e.g. 'trade offer: 1 stick around + 6 mustaches for 1 glitter bomb')... But we
  should build things with that in mind in any case." Each is a design of its own. This one leaves three openings for
  them: a slot sells a typed item; the hand is a sum of ledger rows by source; and a pack's draw is one function.
- **A sealed pack** as an item in the hand (section 5).
- **A finite supply**, cards that become harder to find over time, and **alternate art**. Each ledger row is one
  acquisition, so a variant would be a column on that row, never per-copy state.
- **A hidden slot the Boss may not flash-sale**, such as a holiday pack an admin prepares ahead of time. If it matters,
  the slot gains a checkbox.
- **The machine's name** is still the owner's to give (`shopName`).
