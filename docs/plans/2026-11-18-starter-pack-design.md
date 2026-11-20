# The Starter Pack: design

Record, written 2026-11-18. A design session with the owner, who opened it: "Thinking a planned booster pack (fixed set
of cards across flavors) for every new player might be a better fit, so any Aura they get is earned." Each section was
confirmed by the owner before the plan was written. The plan is `docs/plans/2026-11-18-starter-pack-plan.md`. It takes
up #598.

## 0. Where it starts

- The onboarding design (`docs/plans/2026-11-02-onboarding-design.md`, section 4) decided a starting grant: once per
  account, at its first character, 1.00 Aura and one common card picked by the class chosen. Its plan's Task 11 was
  never built (#598): `create_character` gives nothing, and a new player starts with an empty wallet and an empty hand.
- Packs are lists of pulls, rolled on the server when bought (`docs/plans/2026-11-04-booster-packs-design.md`). The
  `packs` table (`supabase/migrations/0139_machine.sql`) already holds `opened_at` as "the recorded path for later": a
  sealed pack is a row whose cards have not yet been written to the ledger. Nothing builds that path yet, and `packs`
  is append-only, so `opened_at` can only be written in the row's own insert.
- Three commons cost Aura to play on a post, scaled by size: Whoops! (by the post's length), Autocorrect (by the
  phrase's volume) and You Were Saying?. Every other common plays for nothing.

## 1. No Aura, a pack instead

**Decided** (the owner): the starting grant is replaced. A new player gets **no Aura**, so every orb they ever hold
was earned. They get one **Starter Pack** instead: a pack with fixed contents, the same for every player.

The onboarding design's section 4 is a record and is left as written; this design supersedes it, and its starter table
(one card per class, and the Tweener's and the Lurker's later rows in #598) is not built.

## 2. What is in it

**Decided** (the owner chose six cards, two per flavor, then swapped two of the session's first picks):

| Flavor    | Cards                      |
| --------- | -------------------------- |
| Sweet     | Feelin' Fab, Rope Break    |
| Salty     | Steel Chair, Whoops!       |
| Pepperoni | THIS, Autocorrect          |

- Six fills a fan, every flavor is there twice, and a set card (Rope Break) is among the Moves.
- **Every card has a play that costs nothing,** so the pack is usable at 0 Aura. Whoops! is free on a post shorter than
  `whoops.lengthStep` (500 characters today), and Autocorrect on a phrase whose volume is under
  `autocorrect.volumeStep` (50 today). On a longer post they cost what they cost, which is a first lesson in what Aura
  is for. Whoops! and Autocorrect are the owner's choice over Hot Box and Overreaction, as the game's signature cards.
- An instance test holds this: six cards, two of each flavor, every one common, and every one with a target its
  `playPrice` prices at 0.

Weighed: three cards, one per flavor (the hand empties after three plays); nine, three per flavor (worth more than a
3.00 Booster, so the first trip to the machine matters less); cost cards that sit unplayable until the first
settlement (a hand that says "not yet" to a new player).

## 3. Fixed packs, in the engine

**Decided:** a pack is either a list of pulls (the Booster) or a fixed list of cards (`contents`, in reveal order),
never both.

- A fixed pack is a pack like any other: it can be granted (section 5) and it **can be sold in the machine**, where its
  slot's about panel lists the cards it holds in place of odds. Nothing sells one today.
- The instance check refuses a fixed pack with no cards, one naming a card the instance lacks, one naming a card the
  instance withholds (a card that writes, with no old voice), and one with `leaves` (which only a pull table reads).
- **The reveal:** a fixed pack has no hit. All its cards share one back, and none gets the gold tag. A pull pack's last
  card is its hit, as today.

## 4. A sealed pack

**Decided** (the owner: "let's ideally make it a reusable state in case we want to eventually make it possible to
purchase a pack and hold on to it before opening"): a sealed pack is one general state of a `packs` row, not something
only the starter has.

- A pack row whose opening is not recorded is **sealed**. Its cards are stored with it from the moment it is made (a
  pull pack's rolled then, as the booster design requires), and reach the ledger, and so the hand, only when it is
  opened.
- **Opening is one function,** `open_pack(pack)`, the caller's own pack alone. It records the opening in an
  append-only `pack_openings` row (the `packs` row is never updated: "Append-only") and writes one `pulled` ledger row
  per card, in one transaction. A second open, a racing open, or an open of a pack that is not the caller's is refused,
  and the last refuses in the same words as a pack that does not exist.
- **A sealed pack's cards are unreadable until it opens,** by any read, the owner's own included: a future bought
  sealed pack must not be peeked at, and the reveal is the moment the cards are learned. Its kind and when it was made
  are readable by its owner.
- **A pack row says where it came from:** `bought` (at a slot, at a price) or `welcome` (no slot, price 0). At most one
  `welcome` row per account, held by a unique index, so a retry or two characters made at once grant once.
- Buying is unchanged: a bought pack opens in the same transaction, now through the same opening path. Buying and
  holding sealed is a later design's; it changes only what buying does.

## 5. The grant

**Decided:**

- An engine setting, `startingPack`, names a fixed pack, or is null for no gift. The check refuses a name that is not
  one of the instance's packs, or is a pull pack.
- When an account makes its first character, `create_character` writes its sealed welcome pack in the same
  transaction. The grant is per account, never per character (the onboarding design's reason: a grant per mask is a
  farm).
- **Every account with a character gets one, once** (the owner chose a backfill). Since a migration runs before an
  instance's settings are seeded, the backfill runs where the setting is known: each seed gives a welcome pack to every
  account that has a character and none yet. The unique index makes it once ever. An instance that turns the grant on
  later gives every existing player one; one that changes `startingPack` gives no second.
- **The log**, plainly, in two lines: "Welcome gift: a sealed Starter Pack" when it is granted, and "You opened your
  Starter Pack: Feelin' Fab, Rope Break, …" when it is opened, in the instance's names. A bought pack's line is as today.

## 6. On screen

All of it is the glass's (the hand and the reveal), plain and never in character.

- **In the hand** (the owner chose the recommendation): each sealed pack stands first in the hand, before the cards,
  drawn in its own pack art at a card's size: on the Main board, first on the arc; on the Phone board, first in the
  row. It is a button, "Starter Pack, sealed: open it", in the list's keys like a card. A sealed pack is not a card:
  it cannot be armed and the hand's count of cards leaves it out.
- **The Hand button** carries a dot while a pack is sealed, and its name says so ("Hand, 1 sealed pack").
- **Opening** runs the existing reveal (`engine/ui/vending/PackOpening.tsx`), the pack rising from where it stood in
  the hand, its count the pack's own (six here), and the cards flying back into the hand when it closes.
- **The tour's hand step** names the pack ("a new pack waits here sealed until you open it"), in words that stay true
  after it is opened. The owner approves the copy in review.
- **The art** (the owner chose the recommendation): the Booster's scene, recolored, with STARTER on the film in place
  of the Booster's name, so it reads as the Booster's sibling. Its tagline says what it is: "Six cards, two of each
  flavor."

## 7. Ways out

- **A sealed pack** never expires; it is opened by a press in the hand, on the screen where it shows, at any time.
- A player who skips every tip still sees it first in the hand, and the Hand button's dot.
- Nothing else here is a state a player, a character or a post is put in.

## 8. The masks

- The pack is the account's own row; nothing public says it exists or was opened. Opening writes no Act and broadcasts
  nothing.
- The six cards are ordinary commons anyone can buy. A new mask playing them is a public clue, which the rules allow
  ("A response never proves a private fact"); a card picked by class, which this replaces, would have hinted at a
  class.
- `open_pack`'s refusal of another account's pack is the same as a pack that does not exist, so a pack id answers
  nothing about who owns it.
- `create_character`'s answer is the caller's own and does not change shape with the grant.

## 9. The layers

- **Engine:** fixed packs (rules, check, roll, odds, the about panel), sealed packs (`pack_openings`, `open_pack`, the
  sealed read), `Settings.startingPack` and its check, the grant in `create_character` and the seed's backfill, the
  log's lines, the hand's sealed packs and the Hand button's dot, the reveal's `hit`.
- **Instance (Divided World):** the `starter` pack kind and its six cards, `startingPack: 'starter'`, its art and its
  `InstanceUi.packs` entry, the tour copy, and the test of section 2.
- The interfaces: `PackRules` (now a pull pack or a fixed pack), `Settings.startingPack`, `InstanceUi.packs`.

## 10. Open

- Buying a pack and holding it sealed: a later design. This one builds the state and the opening it would use.
- Whether a pack can be given by an admin or The System (a sealed reward): not designed; `source` is where it would go.
