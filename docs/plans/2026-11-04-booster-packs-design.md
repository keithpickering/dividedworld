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
- **Opening only reveals them.** Today the opening is the same moment as the purchase. The reveal shows what is stored,
  so a reload or reduced motion never changes what was bought. The owner chose **tap to flip**: "straight out of Pokemon
  TCG Pocket, a pretty modern reference which works well in the glass".
  - The pack tears open into a modal of five face-down cards.
  - The player turns each one over, with the hit pull last, gold-backed, and tagged with its rarity.
  - "Turn all" skips the rest.
  - On a phone, the cards are a pile turned with a tap.
  - The boards are in `docs/research/2026-11-04-booster-packs/`.
- **The pack is just another slot** (the owner's choice over a shelf of its own or a second machine), placed wherever
  the admin's order puts it.
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

## Amended 2026-11-07: the boards, redrawn on the card template

The owner, once the card template merged: "Let's check on the booster pack plan and see if it has proper design boards, if
not let's work on them." The boards of 2026-11-04 (`docs/research/2026-11-04-booster-packs/`) were drawn before the card
template and before the glass polish and the backfill, and nothing of the plan was built yet. Read against main on
2026-11-07, they could no longer be built from:

- **Every card face was blank.** The template moved each card's art into a folder of its own (`cards/<key>/art.svg`), and
  the boards still read `cards/<key>.svg`, so each face drew an empty box.
- **The cards were the old face.** A spot picture with its words under it, and a "?" seal for a back, where the build now
  draws one 2:3 card at four sizes (layout A, Low name, full art) and a back with the instance's mark (the template's
  section 8 and its amendment). The plan's Task 5 draws the reveal with `Postcard.tsx`, so the boards and the build would
  have disagreed on every card.
- **The menus were out of date.** The machine had the five-tab menu bar; the admin page had a sub-menu (Move queue, The
  machine, Updates) that no build has.
- **The machine was not the machine on main.** Its slots were not the template's slot, zoomed as the build zooms it, with
  the shelf edge's code, price and info control.
- **The backfill's sizes.** One phone board per batch with its screens side by side (the backfill design, section 1,
  decision 5): only the reveal had one.

So the boards are redrawn in `docs/research/2026-11-07-booster-packs/`, and the board match reads them in place of the
first drawing, which stays as the record. Every choice of 2026-11-04 is kept: the pack is just another slot, a pack opens
with tap to flip, the hit is last and gold-backed, the odds are shown plainly, and the admin page is a plain list.
`gen.mjs` there renders every face and back with the engine's own `Postcard` and `PostcardBack`, so a board shows the
template as the build draws it.

**Decided** (the owner chose the recommendation): **the reveal is a spotlight over a row.** The template allows four sizes,
and five sheets (276 wide) do not fit across 1440. The card last turned is shown large, at the sheet's size, in the middle;
the pack lies under it in pull order at the fan's size (150 by 225), turned cards face up and the rest face down, the hit's
back gold. When all five are turned, the hit is in the spotlight with its gold tag. On a phone the pack is a pile at the
sheet's size, as before. Weighed: five fans in a row the whole time (closest to the first boards, but small for the
moment at 1440), and five sheets overlapped like a held hand (each card partly hidden until all are turned).

**Decided** (the owner chose the recommendation): **the admin pages share sub-navigation.** The Admin tab stays one tab,
opening the queue, and the admin's pages (Moves, The machine) are reached from each other by sub-navigation under the
page's title, so a later admin page has a place to go. The board draws it as a strip of two small buttons under the
page's lead, at 1440 and on the phone, the current page filled. A rail beside the content, as Settings draws its
sections, was drawn first and dropped: it would move the queue's whole column right of where the backfill's board 37 has
it. Write update stays on `/updates`. Weighed: a second menu
tab (ten tabs, which the backfill's rule tightens or scrolls), and a link from the queue alone.

**Drawn as the template draws it, where the plan said otherwise:** a rarity in the odds table is the card face's own gem,
its glyph saying the rarity by shape (● common, ◆ uncommon, ★ rare, ✦ legendary, `gemOf` in `engine/ui/cards/faces.ts`)
in a rotated tile, never a color alone. The plan's Task 5 said hollow and colored diamonds, from the face before the
template.

## Amended 2026-11-07: the reveal's motion

The owner, on the redrawn boards: "we may want to think about how this screen can animate into view. Glass polish phase
3 will be merged soon which adds page transitions to glass screens, if we have motion in mind then it's best not to make
the build session guess at it." Phase 3 (`docs/plans/2026-11-04-glass-polish-design.md`, section 9; #293) gives the glass
one choreography in two feels, Smooth and Snappy, and Off, written once in `engine/ui/glass/motion.ts` as presets over
each feel's tokens (`enter`, `exit`, `screen`, `stagger`, `ease`, Snappy's `spring`, `distance`, `blur`, `scale`). The
reveal is choreographed in those presets and tokens, and adds no setting and no token of its own. Its prototype is
`docs/research/2026-11-07-booster-packs/motion/prototype.html`: the machine, both buys, and a switch for Smooth, Snappy
and Off, with the reveal's beats played on Phase 3's default tokens. The owner tunes it, as they tuned Phase 3's story.

**Decided** (the owner chose each recommendation):

- **The pack comes from its slot.** The reveal enters as an overlay anchored on the slot that was bought (Phase 3's
  `overlay`, from the slot's rect), and the machine behind dims in step (`backdrop`). Weighed: Phase 3's `modal` as it
  is, which gives the purchase no moment of its own.
- **A card lifts and flips.** Each card moves between its row slot and the spotlight (a shared layout), and turns over in
  the spotlight. Weighed: flipping in place in the row while the spotlight crossfades, which reads as two things.
- **The cards leave into the hand.** Done or Esc sends the five into the machine's Your hand link, which pulses as they
  land. The owner, on the same question: "ideally we will refactor the machine's animation so it does this too, which is
  much more advanced than its current rudimentary slide and fade." So **one flight serves both**: a single card bought
  drops into the tray as today and then flies to the hand by the same path, in place of the fixed `kb-vending-drop`
  keyframes, which fly every card to one hard-coded offset wherever the hand is. Weighed: Phase 3's `modal` exit.
- **The prototype and the written choreography** go to the build session together.

**The choreography.** Each beat names the token it runs on. Under Snappy, a beat that lands springs, by the feel's
`spring`. Under Off, nothing moves: each beat's end state is drawn at once, which is what reduced motion did in the plan
before.

1. **Entrance**, which starts when the purchase's answer arrives (the reveal shows what was stored; nothing starts
   before the answer, so a refusal and a success look the same until the words appear, as Phase 3 requires):
   - E1. The machine dims (`backdrop`, `enter`).
   - E2. The pack rises from its slot's rect to the middle, growing to its hero size (`overlay` from the slot, over
     `screen`; Smooth blurs in by `blur`).
   - E3. The pack's top tears away and travels up to the head, where it stays as the reveal's mark (`enter`).
   - E4. The deal: five backs fly out of the pack into the row, each settling from a slight tilt, staggered by
     `stagger(feel, 5)` at three times its step, the gold hit last (`enter` each). The pack's body sinks and fades
     (`exit`, `distance`).
   - E5. The head and the buttons land as a screen's head and panels do (`staggerItem`).
   - E6. The first back lifts into the spotlight, waiting to be turned (`enter`).
2. **A turn** (a click on the next card, "Turn the next card", or Space):
   - T1. The card in the spotlight settles back into its row slot, face up, as the next back lifts out of its slot into
     the spotlight (one shared layout per card, `enter`).
   - T2. The card turns on its vertical axis (`rotateY`, over `enter` × 1.2, Snappy's spring landing it). The counter
     moves and the screen reader hears the card when the turn starts, not when it ends.
   - The hit's beat: before it turns, its gold back pulses once (scale to 1.05 and back, over `screen`). Once turned,
     its ring goes gold and its halo fades in (`screen`), its sparks burst (`stagger` over the six, `enter` each), and
     its rarity tag drops in from above (`distance`, landing).
3. **Turn all**: the backs left in the row turn where they lie, staggered (`stagger(feel, n)` at three times its step),
   and the hit lifts last, with its beat.
4. **Input never waits.** A turn, Turn all, Done or Esc pressed while a beat runs finishes every running beat at once
   and goes on from there (Phase 3: input goes to the entering tree at once). During the entrance, a turn finishes the
   entrance and turns.
5. **Exit** (Done, Back to the machine, or Esc at any point): the head, the buttons, the tag and the sparks fade
   (`exit`); the five cards fly to the Your hand link along one arc each, shrinking and fading as they land, staggered
   by `stagger(feel, 5)` at twice its step (`screen` each); the link pulses once (`enter`); the dim lifts (`exit`). The
   modal is `inert` from the exit's first frame and focus returns to the slot at once, as Phase 3's modals do. The
   hand's count moved at the purchase, since the cards were in the hand from then.
6. **The single buy**: the card drops into the tray on its side (`enter`, landing), rests for half of `screen`, then
   flies to the hand by the same arc (`screen`), and the link pulses as it lands. The wallet's drain is unchanged.
7. **On a phone**: the pack rises from its slot as on the 1440 (if the slot has scrolled out of view, from the
   viewport's edge nearest it); the deal stacks the five into the pile instead of a row; a turn flips the top card where
   it lies; the next turn, a tap or a swipe, sends the turned card off the pile toward the swipe's side (left by
   default; a drag follows the finger and commits past a third of the card's width) and flips the next. The exit flies
   the cards toward the Your hand link, or toward the viewport's top edge where the link has scrolled away.

**Where it lives.** The flight to the hand, the lift, the turn, the deal and the hit's beat are presets in
`engine/ui/glass/motion.ts` beside Phase 3's, pure functions of the feel that are empty under Off, so the machine, the
reveal and any later screen that sends a card to the hand use one choreography. The hit's beat reads only the pack's
own stored contents, which only the buyer sees ("A response never proves a private fact"): nobody else can watch it.
