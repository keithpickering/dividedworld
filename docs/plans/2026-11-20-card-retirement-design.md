# Retiring a card: design

Record, written 2026-11-20. A design session with the owner on issue #612 (P1 in the roadmap #845), filed as a dead end
under "No player is ever stuck". The plan is `docs/plans/2026-11-20-card-retirement-plan.md`.

## 0. What was found

Bluff and Trap Card were removed from `instances/divided-world/cards/index.ts`, and the deployed `card_kinds` still
holds both: the instance seed (`seed_instance`, latest body in `supabase/migrations/0377_sealed_packs.sql`) only inserts
and updates a card kind. The issue's read of the deployed database (2026-11-12): 27 rows against 25 listed; Bluff
pulled 3 times after its removal, Trap Card twice; both still in `machine_slots` and `face_down`.

What the session read on main, beyond the issue:

- **Every pool reads `card_kinds` whole.** `draw_pool` (0207) feeds `roll_pack` (so `buy_pack`) and `random_event`'s
  card outcome. `machine_now` (0140) sells any slot's card, and `slot_for_sale` reads it. A Mod Bot's `cardsOnOffer`
  (`supabase/functions/chatter/core.ts`) reads the instance's code, so it never offered a dropped card, but it would
  offer a card that is only out of print.
- **A dropped card in a hand is already a hidden dead end.** `handOrder` (`engine/ui/cards/arc.ts`) draws only cards
  with a face, so a held Bluff is never shown while the hand's count includes it. Were it shown, `card` in
  `engine/rules/actions.ts` refuses its play ("the Vending Machine has no card \"bluff\""): the rules that would
  decide it are gone with its file.
- **The unknown face borrows art.** `unknownFace(k, faces[0])` in `engine/ui/vending/Vending.tsx` and
  `engine/ui/cards/Hand.tsx` takes the first card's art and play word, which is how Bluff showed as Stick Around.
- **Neither card left by accident.** The card types design (`docs/plans/2026-11-11-card-types-design.md`) deleted Bluff
  on purpose (section 7: "A bluff is as simple as placing a cheap move face down with an almost impossible
  condition") and renamed Trap Card to Card Collector under a new key.
- **A face-down back already ends by itself** at `setLasts` (`docs/plans/2026-11-07-face-down-moves-design.md`,
  sections 9 and 10), and an ended back that never sprang counts back into the hand (`card_held`, 0340).
- **The same hole beside cards.** A pack kind the instance stops listing stays in `pack_kinds`, and its slot keeps
  selling it. A dropped gear kind that a ledger row names stays in `gear_kinds`, and `draw_pool` keeps giving it.

## 1. Three ways a card leaves, each said in the instance's code

**Decided** (the owner chose the recommendation): a card's rules live in its file, so retiring a card cannot mean
deleting the file while copies of it are out. A card leaves in one of three ways:

- **Out of print.** The file stays, with `retired: true` on its `CardRules`. The seed stamps `card_kinds.retired_at`
  the first time it sees the flag, keeps the date while the flag stays, and clears it when the flag goes: a card back
  in print is a card like any other. A held copy, a face-down back and a sealed pack's copy are untouched and fully
  playable; nothing gives a new copy out (section 2).
- **Renamed.** The new card's file says `formerly: [{ key: 'trap-card', name: 'Trap Card' }]`. The seed writes the old
  key's `became` and `gone_at`, and moves every copy an account holds (section 3).
- **Withdrawn.** The instance lists `withdrawn: [{ key: 'bluff', name: 'Bluff', refund: 100 }]` (hundredths of an
  orb). The seed writes `gone_at` and `refund`, takes every copy an account holds out and refunds it (section 3).

**The guard is shape, not data.** Every `card_kinds` key must be listed by the payload as a card, a `formerly` entry or
a `withdrawn` entry, or the seed is refused, naming each key. The refusal does not depend on who holds what, so a seed
that passes once passes everywhere the catalog is the same. `instanceProblems` holds the instance's half: a key is in
at most one of the three lists, a `formerly` entry names no listed card, and a refund is a positive whole number of
hundredths.

**Renamed and withdrawn are one-way.** A key with `gone_at` that the payload lists as a card again is refused: a card
that comes back takes a new key. Out of print is the reversible one. Weighed: deleting the file as the retirement, with
held copies refunded or converted every time (it makes every out-of-print card a withdrawal, and an out-of-print
collectible is the better game); both at once (two ways to say the same thing).

**Pack kinds** (the owner chose the recommendation on scope): a pack kind is data alone, so a pack kind the payload
stops listing is out of print (`pack_kinds.retired_at`), and listing it again brings it back. Sealed packs of it still
open: their contents were written when they were made. **Gear** is filed as #848, since its ways out
(gear worn, the wardrobe) differ.

## 2. Nothing gives out a card that has left

- `draw_pool` leaves out every card with `retired_at` or `gone_at`. That one change covers `roll_pack`, `buy_pack` and
  `random_event`'s card outcome.
- `machine_now` leaves out a slot whose card or pack is out of print or gone, so `slot_for_sale` refuses it in the
  words a missing slot has today, and the Boss's slot moves never find it. The slot row is untouched: listing the card
  again brings the slot back at the admin's availability and price as they were.
- The admin machine page (`engine/ui/admin/Machine.tsx`, from `admin_machine`) still lists the slot, marked "Out of
  print", "Renamed to Card Collector" or "Withdrawn", plainly; its availability control is shown as not in use for it.
- `instanceProblems` refuses a pack (fixed or pull, the welcome pack among them) that holds or leaves out a card that is
  out of print or gone, and a machine slot of the instance's that names one: an instance cannot keep a source of a card
  it says has left.
- A Mod Bot's `cardsOnOffer` leaves out an out-of-print card, so a caught Mod Bot card (the setter's "rare drop from
  The System") is never one. A Card Collector that catches a player's out-of-print card moves an existing copy, which
  is play, not a new copy.

## 3. Ways out ("No player is ever stuck")

| State | Out of print | Renamed | Withdrawn |
|---|---|---|---|
| A held copy | Played as ever | Becomes the new card at the seed (`renamedOut` on the old key, `renamedIn` on the new) | Taken out at the seed (`withdrawn`), its refund credited once per account (`wallet_events` kind `withdrawal`) |
| A live face-down back | Springs as ever | Moved at the seed like a held copy; the back springs nothing and ends at `setLasts` | Refunded at the seed like a held copy; the back springs nothing and ends at `setLasts` |
| A sealed pack's copy | Opens as itself | Opens as the new card (`open_pack` writes `pulled` on the new key) | Refunded at opening, by `open_pack`, in the same transaction |

- An ended back of a gone key never counts back into the hand (`card_held` leaves it out), since its copy moved or was
  refunded when the seed ran.
- `take_back` of a back whose card is gone is refused in plain words: "Bluff was withdrawn on Nov 20, 2026, and this
  copy was refunded then. Its back ends by itself on Nov 27, 2026." (and the renamed form: "...renamed to Card
  Collector..., and this copy is in your hand as one").
- A refund over `walletCap` overflows as any credit does, and the log says so as it says any overflow.
- **Bluff's refund** (the owner chose the recommendation): the commons' going rate, the median price of the instance's
  common cards today, 1.00 orb (100). Trap Card is renamed, not refunded.

## 4. What the screens show

- **Out of print is invisible** (the owner's choice over a plain tag and a stamped face): no hand, Lens, sheet or
  machine words say a card is out of print. A player learns it by never pulling one.
- **The log** says what moved, plainly, under the player's own account: "Bluff was withdrawn from the game. Your 2
  copies were refunded 2.00 orbs." and "Trap Card is now Card Collector. Your copy is a Card Collector now." Old keys are
  named by a new engine resolver, `cardNameOf(instance, key)`, which reads the instance's cards, then each card's
  `formerly`, then `withdrawn`, so history never says "a card" for a card the instance once had.
- **The pack reveal** (the owner chose the refund slip): a withdrawn card is shown in its place as the instance's card
  back with one plain line, "Withdrawn: refunded 1.00 orb." It claims no rarity or alignment and borrows no art.
- **The unknown face.** `unknownFace` in the machine and the hand no longer borrows `faces[0]`: a key the client has no
  face for (a withdrawn one, or a deploy where client and database disagree) is the card back with "A card this machine
  no longer has", as the log's words already say.

## 5. The masks

Nothing new is public. The pools and the machine read the catalog alone. Renames and refunds are rows of each
account's own ledger and wallet, read by that account alone (`my_card_ledger`, the wallet's events). The seed runs as
the service role and answers it alone, with totals across accounts (copies moved, orbs refunded), never a row per
account. A refused `take_back` is the setter's own back, so its words say nothing to anyone else, and its refusal is the
same for every caller who may take it back.

## 6. Admins

**Decided** (the owner chose the recommendation): the seed lands its changes at once and its answer reports each
(`retired`, `renamed` with copies moved, `withdrawn` with copies and orbs refunded). Nothing is held: the 24-hour hold
in "The System acts" is for moves The System makes on a board, and a seed is a deploy whose change is reviewed in its
PR. No Updates entry is written, since that page is the admins' own words.

## 7. Export and import ("Portable by construction")

The new columns, ledger kinds and wallet kind are rows like any other, and `supabase/tests/e2e/0003-export.ts` dumps
every table, so they round-trip by construction. Its fixture gains an out-of-print card, a renamed pair and a withdrawn
card, with their ledger and wallet rows, so the round trip is shown and not assumed.

## 8. What the change does to what an instance holds

The first seed after the migration, on the deployed database: Trap Card's held copies and live backs become Card
Collectors; Bluff's are refunded at 1.00 orb each; both slots stop selling; packs bought before it that still hold
either open as Card Collector or a refund. No `card_ledger`, `face_down`, `packs` or `machine_slots` row is edited
("Append-only"). The issue's direction is kept: nothing is deleted, history resolves every key, and the test seeds a
card, seeds again without it, and shows the roll cannot give it.

## 9. Layers

Engine: the `retired` and `formerly` fields of `CardRules`, `Instance.withdrawn`, their checks, `cardNameOf`, the
columns, functions and screens. Instance: Divided World's two entries (Card Collector's `formerly` and Bluff's
`withdrawn`). No engine file names Bluff, Trap Card or Card Collector.

## Open

- Whether a later season review wants out-of-print cards to show somewhere a collector would look (a binder, a
  checklist). The owner chose invisible for now.
- Gear's retirement: filed as #848 on 2026-11-20.
