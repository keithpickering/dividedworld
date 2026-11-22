Record, written 2026-11-21.

# The Trading Post: design

A design session with the owner on the trading half of the idea board
[#209](https://github.com/keithpickering/dividedworld/issues/209) ("Trading between players, and cosmetic items"; the
cosmetic half was taken up by `docs/plans/2026-11-04-cosmetics-design.md`). The plan is
`docs/plans/2026-11-21-trading-post-plan.md`.

The owner's brief: "anonymous trade offers between players who never see each other's identity. The path for players
who find themselves with 30 salty cards when they only want sweet ones, etc: enter any combo of cards from your hand
and gear in your inventory, enter the item(s) you want, advertise the trade, auto accepted by the first person who
agrees to fulfill it."

## 0. What was found

- **A hand and a wardrobe are an account's, not a character's.** `card_ledger` (`supabase/migrations/0006_cards.sql`)
  and `gear_ledger` (`0205_gear.sql`) are keyed by `account`, and `card_held` (latest `0340_conduct.sql`) and
  `gear_held` (`0205_gear.sql`) count by kind. So the question #209 names as the hard one, a trade between two of one
  player's own masks, does not arise: there is nothing to move between them, and a trade is always account to account.
- **The ledgers were built for this.** The booster design (`docs/plans/2026-11-04-booster-packs-design.md`, section 5)
  made the hand "a sum of ledger rows by source" and wrote that "a trade, later, is two more kinds". `gear_held`'s
  header says "this is where rows out will be taken off": the gear ledger has only rows in today.
- **A sealed pack is a row that is never updated.** `packs` (`0139_machine.sql`, `0377_sealed_packs.sql`) is
  append-only, and its holder is `packs.account`. A pack that changes hands needs a ledger of its own.
- **A sealed pack's look is already data.** A pack names its `pack_kinds` key, and the instance gives each key its name
  and art (`InstanceUi.packs`, `engine/ui/types.ts`; Divided World's `instances/divided-world/ui/packs.ts`).
- **Grouping columns exist.** A card has `alignment` (sweet, salty, pepperoni), `play` (cast, set, use, which the
  instance words as Move, Reversal and Gimmick) and `rarity`; a gear kind has `rarity`; a pack has its kind.
- **One account's spending is already serialized** by locking its `accounts` row (`play_card`, latest
  `0374_cards_on_a_spun_thread.sql`: "one player's plays at a time, so two at once cannot both spend the last card"),
  and an outfit by the advisory lock `kayfabb.outfit` (`set_outfit`, `0205_gear.sql`).

## 1. What can be traded

**Decided** (the owner chose the recommendation): an offer gives and asks for **cards, gear and sealed packs**. Orbs
are never part of a trade. A sealed pack keeps the pulls rolled when it was bought, which is the "pack from a specific
time" the booster design hoped trading would make worth chasing.

Each side holds at least one item: there is no gift (nothing wanted) and no begging (nothing given).

Weighed: cards and gear only (leaves the sealed pack's payoff for later); orbs too (makes the Trading Post a market
with prices, a bigger thing to balance against the machine).

## 2. The two sides

**Decided** (the owner chose the recommendation):

- **The give side is exact.** Each line is a held item and a count: "12 Whoops!", "1 Mustache", or one particular
  sealed pack.
- **The want side is exact lines and group lines.** A line is either an exact item and count ("2 Glitter Bomb", "1
  sealed Booster") or "any N of a group". The groups are read from columns the engine already has:
  - **a card**, narrowed by any of its alignment, its type (`play`) and its rarity: "any 3 Sweet cards", "any 1 rare
    Reversal", "any 5 cards";
  - **a gear**, narrowed by rarity: "any 2 gear", "any 1 legendary gear";
  - **a sealed pack**, narrowed by kind: "any 1 sealed pack", "any 1 sealed Booster".

  The engine never names an instance's card in a group: the groups are its own columns, and their words are the
  instance's (`cardKinds`, rarity names).
- **The taker chooses what fills a group line**, from their own hand (section 6). The offerer's log and alert then say
  exactly what came in.

Weighed: exact items only (the "30 Salty for Sweet ones" offer would have to list particular Sweet cards, and fewer
people could fill it); groups only (no one could chase one particular card).

## 3. Escrow

**Decided** (the owner chose the recommendation): posting an offer takes its give side out of the hand at once, into
escrow, as new ledger rows (CLAUDE.md, "Append-only"). Taking an offer therefore always goes through on the offerer's
side, because the goods are already set aside, and no offer can be left hollow by a card its offerer has since played.

- **Only what is held is offered.** A face-down back is not in the hand until it ends (`card_held`), so it cannot be
  offered.
- **Only unworn gear is offered** (the owner chose the recommendation). A copy a character wears is used, as
  `set_outfit` already counts it. To offer it, the player first takes it off on the dress-up page, which is their own
  public move. The engine never strips a mask itself: if a character's one Mustache vanished the minute an anonymous
  offer of a Mustache went up, the engine would have tied that mask to the offer. Gear a trade brings in arrives
  unworn.
- **A pack's holder is a ledger.** A sealed pack's moves (into escrow, back out, to a taker) are rows in a ledger of
  their own, and its holder is computed from them. The `packs` row is never touched. An opened pack cannot be traded:
  its cards are already in a hand.

Weighed: checking the give side when the offer is taken (the items stay playable, but an offer can turn out hollow).

## 4. How an offer ends

**Decided** (the owner chose the recommendation). An open offer ends in one of four ways, and each is recorded once:

| End | Who | What happens |
|---|---|---|
| **Taken** | the first account that holds what is wanted and presses Take | the trade lands in one transaction (section 6) |
| **Withdrawn** | the offerer, at any time, from Mine | the escrow comes back to the hand |
| **Expired** | by itself, 7 days after it was posted (`trading.offerHours`, 168) | the escrow comes back to the hand, with an alert |
| **Closed** | an admin, from the admin page | the escrow comes back to the hand, with an alert |

An offer past its end time is refused to a taker at once, whether or not the sweep has run yet. Every open offer
shows when it ends.

**At most 5 open offers per account** (`trading.openMost`), and each side has at most 8 lines (`trading.linesMost`)
and 60 copies (`trading.copiesMost`). The cap bounds how much of an instance can sit in escrow and how much work the
list does (section 9), and it is the account's own: only its own player is told.

Weighed: the offerer choosing 1 to 14 days per offer; no expiry (offers no one can fill pile up on a busy instance).

## 5. The masks

**Decided:** an offer and a trade name no account and no character, anywhere. The tables that know who posted and who
took carry `account` columns, keep row level security on with no policy, and are read only through functions that
never return them. They are never in a publication (`supabase/tests/0014-realtime.sql`).

Every response this adds, and why none is computed from a private fact (CLAUDE.md, "A response never proves a private
fact"):

- **The list** is the same for every viewer but one bit: `mine`, true on the caller's own offers, which tells the
  caller only what they already know. "Only ones I can fill" reads the caller's own hand.
- **The refusals** are each computed from the offer's own state or from the caller's own hand and count: "This offer
  is no longer open" (taken, withdrawn, expired and closed read alike), "That's your own offer" (only its offerer can
  trigger it), "You need 2 more Sweet cards", "You have 5 open offers". None differs with who owns the offer.
- **The timing of a take does not wait on the offerer.** A take locks the offer row and the taker's own account, never
  the offerer's: the offerer's side is already in escrow, and crediting them is inserts, which need no lock. Otherwise
  a taker could time a take against the offerer playing cards at that moment, and match the offer to whichever
  character just played.
- **A sealed pack shows its kind and the month it was bought** (the owner's choice), never its day, its id or its
  buyer. The month keeps the time-capsule play, and it is coarse enough that no offer matches a minute someone was at
  the machine. No pack id is public, so a pack cannot be followed from one trade to the next, which would tie the
  taker of one anonymous trade to the offerer of another.
- **No two offers are linked.** The list carries no account, and an account's count of open offers is seen by that
  account alone.
- **The clue that is allowed, knowingly:** "Recently traded" shows a Glitter Bomb going for 6 Salty cards at 14:02,
  and a character plays a Glitter Bomb at 14:05. That is public play, the kind of clue the game leaves on purpose.
- **The alert to the offerer** goes to their own account's channel (`broadcast_later`), as every alert does.

## 6. Taking an offer

**Decided** (the owner chose the recommendation): Take opens the offer with its group lines **prefilled and
editable**. Each group line is filled from the taker's largest stacks first, and any pick can be swapped. If the taker
does not hold enough, the dialog names what is missing, in plain words, and Take stays off.

The prefill is one function in the engine's rules, `fillOffer` (the plan's Task 1). The SQL list's "Only ones I can
fill" filter runs the same fill, and one table of cases holds the two to the same answers (CLAUDE.md, "Two lists that
must agree are one list"). The fill is greedy: exact lines first, then group lines from the narrowest group to the
widest, each taking from the stacks left. A fill it misses, which only overlapping groups make possible, can still be
taken with picks made by hand from the offer's own page, where Take reads the picks and not the fill.

The take itself is one transaction:

1. It locks the offer and refuses an offer that is no longer open.
2. It locks the taker's own account (and their outfit, for gear) and checks that the picks fill each want line and are
   held: for gear, unworn; for a pack, sealed and the taker's.
3. It writes the taker's picks out, the offerer's escrow in to the taker, and the picks in to the offerer, and records
   the end. An end is one row per offer under a primary key, so two takes at once cannot both land: the second finds it
   and is refused.

## 7. Where it lives, and how it looks

**Decided** (the owner): the Trading Post is a **glass** page (`docs/plans/2026-10-29-two-worlds-design.md`), in the
menu beside the Vending Machine. An offer is an account's move, not a character's, so it has no place on a board, where
every Act is a mask's.

The owner on the look: "Plain glass. Vending machine comes from a sort of halfway point where we had not figured out
the board vs glass split. Skeuomorphism is more or less reserved for the effects within the board (whoops,
autocorrect etc) and the vending machine remains slightly stylized but still mainly 'modern' (no realistic textures
etc). For item trading I think plain glass is the move, if any skeuomorphism is used it should be more of a nod (a la
vending machine) than an earnest attempt at portrayal of a physical object."

**The brief** (impeccable's `shape`, confirmed by the owner):

1. **Job and mode.** Operate. A player with too much of one thing comes to swap it for what they want, or browses to
   fill someone else's offer. Success is finding an offer you can fill in seconds, and posting one in under a minute.
2. **Look.** The glass as it stands: chamfered panels, skewed buttons and tabs, Anton for the heading. Cyan for the
   selected, gold for what you can take, Salty pink for what you are missing. Items are drawn with their existing small
   faces (a card's art and name, a gear's piece, a pack's art). At most a nod to a physical thing, such as a small
   TRADED stamp on a Recently traded row; no textures.
3. **Layout.** Three tabs: **Open offers**, **Mine** and **Recently traded**.
   - Open offers is a list of chamfered rows, each GIVES | WANTS | Take, filtered at the top by an item (a card, gear or
     pack picker) and by "Only ones I can fill". The caller's own offers show in it marked Yours, with no Take.
   - Mine shows each of the caller's open offers with its time left and Withdraw, and the count ("3 of 5 open").
   - Recently traded shows what went for what, and how long ago.
   - **Post an offer**, a primary button, opens a dialog with a GIVES half (a tray of the caller's hand, unworn gear and
     sealed packs, with counts) and a WANTS half (lines, each an exact item or "any N of" a group). Under them, in plain
     words: "These leave your hand now. They come back if you withdraw the offer or it expires on <date>." Then Post.
   - **Take** opens a dialog with the group lines prefilled (section 6).
4. **States.** No offers at all ("No open offers. Post the first."); none matching the filter; at the cap (Post off,
   with the reason); "This offer is no longer open" after another taker won, and the row leaves the list; loading as the
   glass loads; signed out as the glass's other pages are. A side of more than 4 lines folds to "+N more", which
   expands.
5. **Phone.** One column: each row stacks GIVES over WANTS, with Take full width. The dialogs become bottom sheets. Text
   by the glass's rules (17px body on a phone, up to 200%).
6. **Boundaries.** No account or character anywhere. No live updates: the list is read when the page loads and when the
   player changes tab or filter, and a stale Take is answered "no longer open". The copy is plain glass, never in
   character.

The page's name is the instance's (`tradingPostName` in `InstanceUi`, "Trading Post" for Divided World), as the
machine's `shopName` is.

Weighed: a drawn board of pinned trade slips (the owner: plain glass); a swap counter showing one offer at a time
(slow to browse on a busy instance); a two-step composer (one more screen between a player and an offer).

## 8. The log and alerts

The log is true and plain, and never names the other side (CLAUDE.md, "The fiction may lie; the log never does"). A
trade is one line in its own source, and the ledger rows of the new kinds are left out of the card and gear lines so
that nothing shows twice:

- "You posted a trade offer: 12 Whoops! set aside, for any 3 Sweet cards. It expires Nov 28."
- "Your trade offer was taken: 12 Whoops! out; Force Field ×2 and Hall Pass in."
- "You took a trade offer: Force Field ×2 and Hall Pass out; 12 Whoops! in."
- "You withdrew a trade offer: 12 Whoops! back in your hand." / "…expired: …" / "An admin closed your trade offer: …"

A sealed pack the player bought and then traded away keeps its bought line in their log, and its contents are shown
only to whoever opened it.

Alerts go to the offerer: **tradeTaken**, **tradeExpired** and **tradeClosed**. The taker gets none, since they did it.
Each is account-level, with no character and no Act.

## 9. A busy instance

(CLAUDE.md, "Weigh a design at the scale of a busy instance".)

- **Open offers are bounded** by `openMost` × accounts: 5,000 offers and at most 80,000 lines at a thousand accounts.
- **The list pages by keyset** (posted time, then id), 25 rows at a time. The item filter is an index probe on the
  lines.
- **"Only ones I can fill" reads the caller's hand once** and runs the fill over every open offer before paging. It is
  one pass over a bounded set, and the plan asks for its plan and timing at the bound (Review focus).
- **The expiry sweep** closes at most 500 offers a run, `for update skip locked`, every 5 minutes, so a take and the
  sweep never wait on each other for long.
- **Recently traded** pages the ended-and-taken offers by the end's time.

## 10. Ways out

(CLAUDE.md, "No player is ever stuck".)

| State | Its way out |
|---|---|
| An item in escrow | the offer is taken, withdrawn by its offerer from Mine, expires by itself at the time it shows, or an admin closes it |
| At the cap of open offers | withdraw one from Mine, or wait for one to expire or be taken; the Post button says so |
| A take refused for want of items | the dialog names what is missing; the player can trade or buy for it, or leave |
| A worn copy that cannot be offered | take it off on the dress-up page, which the composer links to |

## 11. Layers

(CLAUDE.md, "KayfaBB never knows which instance it runs".) Everything here is engine: the rules
(`engine/rules/trades.ts`), the SQL, the page and the log. What the instance supplies is through interfaces it already
uses: the names and art of cards, gear and packs (`InstanceUi`), the words for card types and rarities, its settings
values (`trading` in `instances/divided-world/settings.ts`) and toast defaults, and one new `InstanceUi` field, the
page's name.

## 12. Open

- **The System and the Trading Post.** Whether the Boss gets a move over it (an embargo on a card, a fee, a flash
  "hot item"), and whether a Mod Bot ever posts or takes an offer. Each is a design of its own.
- **"Packs are the floor."** The booster design kept the Boss from pulling a single-card slot unless the card still
  comes in a pack on sale, because nothing else could supply it. Trading is another supply, so that guard can be
  revisited (#209).
- **A want line by month**: asking for "a sealed Booster from November 2026". The month is already shown; asking for it
  is not built.
- **A pack kind's own look on the list** (the owner: a later "Poll Set" "can potentially have its own name"). It
  already follows from the data: a new set is a new pack kind with its own `InstanceUi.packs` entry, and the list draws
  whatever kind the pack is. Nothing more is needed until such a set exists.
- **Retiring a card** (`docs/plans/2026-11-20-card-retirement-design.md`) moves or refunds every copy an account
  holds when a card is renamed or withdrawn. Copies in escrow and want lines naming the card must be handled too.
  Whichever of the two builds lands second handles it (the plan, "Overlap").
