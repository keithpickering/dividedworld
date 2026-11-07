# Booster packs, the machine's catalog, and the Boss's hand on the machine: plan

Record, written 2026-11-04. The plan for `docs/plans/2026-11-04-booster-packs-design.md`. One build session builds it in
one PR from `main`, after the design's PR is merged. No issue tracks it. Amended 2026-11-07: Tasks 5 and 6 build from
the boards redrawn on the card template, `docs/research/2026-11-07-booster-packs/` (the design's amendment of that date).

Every task is test first: name the test, record its red run, then write the code. No `check-*.mjs` is added.

**Two migrations.** Each takes the next free number in `supabase/migrations/` when it is written:
`NNNN_machine.sql` (Task 2) and `NNNN_machine_moves.sql` (Task 4). Their SQL tests take the next free numbers in
`supabase/tests/`. All run against Postgres on localhost (`npm run test:sql`).

## The shapes, exactly

In `engine/rules/packs.ts` (new, engine):

```ts
/** One pull of a pack: a weight for each rarity it can roll, positive whole numbers. */
export interface Pull { readonly weights: Readonly<Partial<Record<Rarity, number>>> }
/** A pack an instance sells: its pulls in reveal order (the last is the hit pull), and cards it leaves out. */
export interface PackRules { readonly key: string; readonly pulls: readonly Pull[]; readonly leaves?: readonly string[] }
/** A slot the instance seeds. `price` is in hundredths of an orb. */
export interface SlotSeed {
  readonly item: { readonly card: string } | { readonly pack: string };
  readonly availability: 'onSale' | 'soldOut' | 'hidden';
  readonly price: number;
}
```

`Instance` (`engine/rules/types.ts:614`) gains `packs: readonly PackRules[]` and `machine: readonly SlotSeed[]`, in grid
order. `InstanceUi` (`engine/ui/types.ts:221`) gains `packs: Record<string, { name: string; art: ... }>`, shaped as
`ui.cards` faces are. `CardRules.priceKey` (`engine/rules/cards.ts:156`) and `basePrice` (`cards.ts:186`) are removed.

Divided World's starting values (`instances/divided-world/packs.ts` and `machine.ts`, new):

- **Booster** (`booster`): four pulls of `{ common: 85, uncommon: 15 }`, then one of `{ uncommon: 75, rare: 25 }`. It
  leaves out nothing.
- **Slots, in order:**

  | Slot | Price | Availability |
  |---|---|---|
  | Booster | 300 | on sale |
  | Whoops! | 100 | on sale |
  | Stick Around | 100 | on sale |
  | Autocorrect | 100 | on sale |
  | Bluff | 25 | on sale |
  | Feelin' Fab | 20 | on sale |
  | Trap Card | 150 | on sale |
  | Force Field | 150 | on sale |
  | Glitter Bomb | 150 | on sale |
  | Main Event | 300 | hidden |

  Each price is the one in `instances/divided-world/settings.ts` today, and those `*.price` keys are removed from
  `economy`.
- **The machine-move settings** (engine defaults, in `Settings.economy`):
  - `machine.pullMost` 2
  - `machine.moveDaysMost` 7
  - `machine.repriceLeast` 50 and `machine.repriceMost` 200 (percent)
  - `machine.flashHoursLeast` 24 and `machine.flashHoursMost` 48

## Task 1. Packs and slots as instance content (engine rules, instance)

Model: sonnet

**Files:**
- `engine/rules/packs.ts` (new): the types above, plus two functions.
  - `packOdds(pack, cards)`: for each pull, each rarity's chance and the eligible cards, each with its chance.
  - `rollPack(pack, cards, random: () => number)`: one card key per pull, in pull order.
  Both are pure. The fake backend rolls with `rollPack`, the SQL rolls on its own (Task 2), and the screens show
  `packOdds`.
- `engine/rules/types.ts`: `Instance.packs` and `Instance.machine`.
- `engine/rules/cards.ts`: remove `priceKey` and `basePrice`. The card's `reads` stay.
- `engine/rules/instance.ts`, `instanceProblems` (:211). Remove the price check (:268). Add these problems:
  - a pull weight that is not a positive whole number;
  - a pull naming a rarity with no eligible card;
  - a pack with no pulls;
  - `leaves` naming an unknown card;
  - a slot naming an unknown card or pack;
  - two slots for the same item;
  - a price that is not a positive whole number at most `INT4_MAX`.
- `instances/divided-world/packs.ts`, `machine.ts` (new) and `index.ts`. Remove the price keys from `settings.ts`, and
  each card's `priceKey`.
- `instances/divided-world/ui/`: `packs` with the Booster's name and a placeholder art, the way a card's face art is
  placed. The art is the owner's to give.

**Tests first** (`engine/rules/packs.test.ts`, `engine/rules/instance.test.ts`, `instances/divided-world/cards/cards.test.ts`):
- `packOdds` for the Booster over the nine cards. The hit pull gives Main Event 25%, and each uncommon 25%.
- `rollPack` with a scripted `random` returns the expected keys. With `random` always 0.999…, it returns the last
  eligible card of the last rarity.
- `instanceProblems` names each problem above, one fixture each.
  - Poison: a pull of `{ legendary: 1 }` over today's cards is a problem.
- Divided World's instance has no problems, and its machine names every card.

## Task 2. The catalog, packs and the hand in SQL (migration)

Model: sonnet

**Files:** `supabase/migrations/NNNN_machine.sql` and its SQL test; `supabase/functions/_shared/seed.ts`; the export
round trip (`supabase/tests/e2e/0003-export.ts` seed rows, and `tools/instance-files.mjs` where it lists tables).

**What the migration holds:**
- **`pack_kinds`** (`key`, `pulls jsonb`, `leaves text[]`), seeded and replaced by `seed_instance` from `Instance.packs`.
- **`machine_slots`** (`id uuid`, `position integer`, `card text` or `pack text` (exactly one), `availability`,
  `price integer > 0`). `position` is unique and deferrable.
  - `seed_instance` inserts only the slots whose item is not already in a slot, at the end, in the instance's order.
  - It never updates an existing slot (the design, section 2).
  - The latest `seed_instance` is `0062_updates.sql:272`.
- **The data migration** for an instance that already holds a catalog. It writes a slot for each card in `card_kinds`,
  ordered by key, on sale, at `setting('economy') ->> price_setting`. Then it drops `card_kinds.price_setting`, the
  `card_kinds_priced` trigger and `price_holds` (`0006_cards.sql:169-216`), and the price keys from the `economy` row.
  The Booster's slot comes from the next seed.
- **`packs`** (`id`, `account`, `slot`, `pack`, `price`, `odds jsonb`, `contents text[]`, `bought_at`, `opened_at`).
  - `odds` is the pulls as they stood at purchase.
  - It is append-only, like `card_ledger`. `opened_at` is set in the same insert today. A sealed pack, later, is a row
    with `opened_at` null, and its contents are written to the ledger when it is opened.
- **`card_ledger`:**
  - `kind` gains `'pulled'`, and a `pack` column referencing `packs`, with `(kind = 'pulled') = (pack is not null)`.
  - A pulled row's `price` is 0, since its pack row holds the price.
- **`card_held(who uuid, card text) returns integer`.** Rows in (`bought`, `pulled`) less rows out (`played`). It replaces
  the inline counts in:
  - `my_cards` (`0006:44`);
  - `buy_card`;
  - `play_card` (latest `0058_alerts.sql:101`, count at :131);
  - `set_card` (latest `0078_reply_passes.sql:182`, count at :197).

  The onboarding plan's `granted` kind (`docs/plans/2026-11-02-onboarding-plan.md`, Task 11) is then one line in this
  function.
- **`machine_now`**: a public view of each slot as players see it: position, item, rarity (for a card), availability
  and price. Task 4 layers the moves over it. *Hidden* slots are not in it.
- **`buy_card(who, slot uuid, price integer)`**: the slot must be in `machine_now`, on sale, a card, and its price must
  equal `price`. Otherwise the refusal is in plain words, the same for every caller: "this slot is sold out", or "the
  price is now 2.00, not 1.00". It spends from the wallet and writes `bought`.
- **`buy_pack(who, slot uuid, price integer)`**: the same checks, then the roll.
  - For each pull, it draws a rarity by weight with `random()`, then a card uniformly among the eligible cards in
    `card_kinds` at that rarity, less `leaves`.
  - It writes the `packs` row and one `pulled` row per card in pull order.
  - It returns `{ pack, contents, balance }`.
- **`my_packs`**, the caller's own packs, for the log.

**Tests first** (the SQL test):
- A slot sold out, a slot hidden, and a stale price are each refused with the words above, and write nothing.
- `buy_pack` with `setseed()` writes five `pulled` rows in pull order. Over 2,000 rolls with a fixed seed, the hit pull's
  rare share is between 20% and 30%.
- `card_held` counts bought + pulled − played. A played pulled card leaves the hand.
- A re-seed after an admin has changed a slot's price leaves the price.
- A `packs` row cannot be updated or deleted.
- `machine_now` holds no hidden slot.
  - Poison: a view that lists hidden slots.
- The export round trip carries `machine_slots`, `pack_kinds` and `packs`.

## Task 3. The client, the Edge Function and the fake (engine data, web, function)

Model: sonnet

**Files:**
- `engine/rules/actions.ts:181`: the `buyCard` decider takes a slot. A new `buyPack` decider does too.
- `supabase/functions/act/core.ts:149-150`: replace the price overwrite with a read of the slot's price from
  `machine_now`. `live()` gains `buy_pack: () => []`.
- `engine/ui/data/api.ts`:
  - `machine(): Answer<Slot[]>`;
  - `buyCard(slot)`;
  - `buyPack(slot): Answer<Opened>`, where `Opened` is `{ pack, contents, balance }`;
  - `Slot` carries `move` from Task 4, null until then.
  - Remove `cardEconomy`'s price keys from `screen_settings`. The latest is `0073_core_loop_answers.sql:557`, so this goes
    in Task 2's migration.
- `web/src/data/supabase.ts`: the adapter's `buyCard` (:855), and the new `buyPack` and `machine` calls.
- `engine/ui/data/fake.ts`: the same, rolling with `rollPack`.
- `engine/ui/player.tsx:205`: `buyCard`, and the new `buyPack`.
- Every reader of `basePrice` or `cardEconomy`'s price: `engine/ui/cards/faces.ts:81-111`, `Hud`, `PlayActions`,
  `PlayForm`, `Lens`, `engine/ui/guide/markers`, `engine/ui/economy.ts`. A card's face has no buy price. Where a screen
  showed one, it reads the card's on-sale slot, or shows none.

**Tests first:**
- `actions.test.ts`: `buyPack` names the slot and the shown price.
- `fake` tests: a pack adds five cards to the hand.
- `supabase.test.tsx`: an admin-tuned slot price shows on the machine.

## Task 4. The Boss's three machine moves (engine system, SQL)

Model: sonnet

**Files:** `engine/system/moves.ts`, `engine/system/meeting.ts`, `supabase/functions/meet/core.ts`, and
`supabase/migrations/NNNN_machine_moves.sql` with its SQL test.

- **`PULL_SLOT`, `REPRICE_SLOT` and `FLASH_SALE`** in `MOVE_KINDS`. Each is `structural: false`, `shapesBoard: false`
  and `askable: true`, with params `{ slot }`, `{ slot, percent }` and `{ slot, hours }`. Each has plain words, a log
  template and `parts`, following `RENAME_BOARD` (:65).
- **Limits.** Each limit is checked twice: in `moveParamsProblems` and the meeting's `repairAnswer` (`meeting.ts:335`),
  and again in SQL at landing (the queued-move guard, latest `0051_succession.sql:183`, or the tick's landing, latest
  `0053_stored_progress.sql:152`). A move that fails one at landing ends `reversed`, with the reason recorded, and is
  never applied. The limits:
  - a pulled slot must be an on-sale single whose card is eligible in an on-sale pack slot (packs are the floor);
  - at most `machine.pullMost` pulls in force;
  - one move per slot;
  - `percent` within the bounds, and not 100;
  - a flash sale only on a hidden slot, with `hours` within the bounds, and one at a time;
  - an expiry within `machine.moveDaysMost`.
- **Demands.** A Pull and a markup must carry one. A markdown and a flash sale must carry none.
- **`machine_now`** applies the open moves:
  - a Pull makes its slot *sold out*;
  - a Reprice sets `round(price * percent / 100)`, at least 1;
  - a flash sale lists its hidden slot as on sale.

  Each moved slot carries `move` (`kind`, `act`, `ends`, and the demand's words and progress where it has one), read as
  `moves_log` reads them.
- **The meeting's reference text** (`referenceText`, `meeting.ts:237`) lists the machine's public slots, so the Boss can
  name one. `meet/core.ts` reads them with the other references (:177-184). It reads no purchase.

**Tests first:**
- `moves.test.ts`: each limit refused by `moveParamsProblems`, naming its predicate. A Pull over `pullMost` is dropped by
  `repairAnswer`.
- The SQL test:
  - A landed Pull shows its slot sold out in `machine_now`, and the slot comes back at its expiry, when its demand is met,
    and when an admin reverses it.
    - Poison: `machine_now` ignoring an ended move.
  - A Pull of a card in no on-sale pack is refused at landing.
  - A markup during an admin's price change reads the new price times the factor.
  - A flash sale lists a hidden slot, and hides it again after.
  - A Reprice on a slot an admin marked sold out leaves it sold out.

## Task 5. The machine (engine UI)

Model: sonnet

**Files:** `engine/ui/vending/Vending.tsx`, `Vending.test.tsx`, `Vending.board.stories.tsx`, `vending.css` in the
instance, and `engine/ui/vending/PackOpening.tsx` (new), with a board story for each of boards 01 to 04, and a manifest
for each (`e2e/boards/2026-11-07-booster-packs/<NN>-<name>.ts`), taking its board out of `PENDING` in `e2e/boards.spec.ts`.

**The look** is the boards in `docs/research/2026-11-07-booster-packs/` (board 01 for the machine, 02 and 03 for the
reveal, and the first three screens of 04 on a phone), redrawn on 2026-11-07 on the card template; the first drawing,
`docs/research/2026-11-04-booster-packs/`, which the owner confirmed on 2026-11-04, is the record of the choices they keep
(the design's amendment of 2026-11-07). The pack is just another slot, drawn as a foil pack with the instance's mark, its
name and "5 CARDS", at the slot's 2:3. When a pack is selected, the space beside the slots shows a small row of five card
backs (`PostcardBack`), the last one gold, and "Five cards, the last one at least uncommon. It opens as soon as you buy
it." The column to the right of the machine shows the selected pack's odds as a table, and below it, in plain words,
each Boss move in force on the machine. The pack's foil and wrapper are a placeholder until the owner gives the art, and
come from the instance (`InstanceUi.packs`).

Board 04 is one phone board with screens of two tasks (the machine and the reveal here, the admin page in Task 6), so its
manifest is a `phone` export of board 01's with the reveal's screens as further sides (`also`), as the backfill's
`e2e/boards/2026-11-05-backfill/14-sign-in.ts` holds its four; Task 6 adds the admin screen's side.

- **Slots come from `api.machine()`** in their order, in place of `facesOf` over every card (`Vending.tsx:199`). Empty
  slots stay sealed as today (`slotsFor`, :55).
- **A pack slot** draws the pack's art and price. Its info shows `packOdds` plainly: each pull's table, and each card's
  chance in the hit pull.
- **A sold-out slot** is greyed and says why in plain words: "Sold out" for an admin's choice, or the move's words from
  the design's section 6 for a Pull. A moved price shows the admin's price struck through beside the new one.
- **Buying a pack opens the reveal**, a modal over the machine (boards 02, 03 and 04 in
  `docs/research/2026-11-07-booster-packs/`). The torn pack sits at the top, with "N OF 5 TURNED OVER" under it.
  - **The cards** lie face down in a row, in pull order, at the fan's size (`PostcardBack`, `size="fan"`, the hit's with
    `hit`), and turn face up in place (`Postcard`, `size="fan"`).
  - **The spotlight:** the card last turned is shown above the row at the sheet's size (`size="sheet"`), so each card is
    read large as it is turned; before the first, it holds the first card's back. The row marks the card shown.
  - **Turning a card:** the player turns them one at a time, by clicking or tapping a card, with "Turn the next card",
    or with Space. A card turns over on its vertical axis.
  - **The hit** is last. Its back is gold. Once turned, it carries a gold tag naming its rarity and card ("RARE · MAIN
    EVENT"), with a soft gold glow and a few sparkles.
  - **"Turn all"** turns every card that is left.
  - **When all five are turned,** the modal offers "Done" and Esc ("Back to the machine"), with the plain line "These five
    are already in your hand." The cards were in the hand from the moment of purchase, so closing early loses nothing.
  - **On a phone,** the cards are a pile at the sheet's size: the top one turns with a tap or a swipe, and a row of five
    outlines counts down, the last one gold.
  - **Reduced motion** shows each card turned with no rotation. Turning stays one at a time; "Turn all" is still there.
  - **A screen reader** hears each card as it is turned, and the whole pack once all are turned.
  - **What is shown** is the answer's `contents`, never a roll on the client. The modal holds focus and returns it to the
    slot.
- **Rarity is drawn as a gem**, as the card face draws it (`gemOf`): its glyph says the rarity by shape (● common,
  ◆ uncommon, ★ rare, ✦ legendary) in a rotated tile, never by color alone. The odds panel uses the same gems.
- **A refusal** (sold out, or a price changed) shows the server's words and refreshes the machine.

**Tests first** (`Vending.test.tsx`):
- The machine draws the fake's slots in order, and no hidden slot.
- A pack's info lists its odds.
- Buying a pack adds its five cards to the hand, in the answer's order, before any card is turned.
- The reveal turns one card per Space, click or "Turn the next card", in pull order. "Turn all" turns the rest.
- The hit's back is marked as the hit, and once turned, its tag names its rarity.
- Esc before every card is turned closes the reveal, and the hand still holds all five.
- Reduced motion turns each card with no rotation.
- A stale price is refused and the machine refreshes.
- A pulled slot reads its move's words.

## Task 6. The machine's admin page (engine UI, SQL)

Model: sonnet

**Files:**
- `engine/ui/admin/Machine.tsx` (new), with its test and story.
- `engine/ui/admin/Queue.tsx`: the admin pages' strip, shared with the machine's page.
- `engine/ui/glass/nav.ts`: `GLASS_NAV.adminMachine = '/admin/machine'`.
- `web/src/App.tsx:54`: the route.
- The admin menu's link beside the queue.
- In Task 2's or Task 4's migration:
  - `admin_machine()`, every slot including hidden ones;
  - `set_slot(slot, availability, price)`;
  - `move_slot(slot, direction)`.

  Each starts with `only_admins` (`0021:89`). When `set_slot` takes a pack off sale, it ends every Pull whose card is
  left in no on-sale pack, as `reversed` by that admin, in the same transaction. That way the floor holds after the
  Pull has landed too.

The page is board 05 in `docs/research/2026-11-07-booster-packs/`, and on a phone the fourth screen of board 04: a plain
glass table under the menu's Admin tab, with one "Save changes" for the page after it. The admin's pages, Moves (the
queue) and The machine, are reached from each other by a strip of two small buttons under the page's lead, the current
one filled (`aria-current="page"`); the Admin tab still opens the queue, which gains the same strip (the design's
amendment of 2026-11-07). The backfill's board 37 draws the queue without it, so the queue's manifest
(`e2e/boards/2026-11-05-backfill/37-admin-queue.ts`) names the strip as a departure by this design and compares what
stands below it by the strip's height lower. A manifest for board 05 takes it out of `PENDING`, and board 04's manifest
gains the admin screen as a side.

**Tests first:**
- A player is refused, in SQL and on the page (as `Queue.test.tsx` does for the queue).
- Moving the first slot up does nothing.
- A saved price shows on the machine.

## Task 7. The log (engine UI)

Model: inline

`engine/ui/log/lines.ts`: `LineKind` gains `'pack'`. In `cardRows` (:326), the pulled rows of one pack become one line,
paired with that pack's purchase:

> You bought a Booster: Whoops!, Bluff, Feelin' Fab, Stick Around and Trap Card. From the {shopName}, for 3.00.

A purchase at a moved price adds: "The Boss had repriced it."

**Test first** (`lines.test.tsx`): five pulled rows and their purchase read as that one line.

## Task 8. The onboarding plan's grant

Model: inline

Add a dated amendment under `docs/plans/2026-11-02-onboarding-plan.md` Task 11: `card_ledger.kind`'s `granted` is added
to `card_held` (this plan's Task 2), and is not counted inline.

## Task 9. The card back, clouded (engine UI)

Model: inline

Added 2026-11-07, from the card template design's amendment of that date. It touches no other task and may be built at
any point; the boards of Tasks 5 and 6 already draw it.

**Files:** `engine/ui/cards/postcard.css`, `engine/ui/cards/postcard.test.tsx`.

**The code** is `BACK_CSS` in `docs/research/2026-11-07-booster-packs/gen.mjs`, word for word, merged into the
stylesheet's back section: its `.kb-postcard-back` properties join that rule, its canvas background replaces the crossed
bands of `.kb-postcard-back .kb-postcard-canvas`, its emblem's size, padding, background and shadow replace those of
`.kb-postcard-emblem` (which only a back draws), and its `[data-hit]` properties join `.kb-postcard-back[data-hit]`. The
section's comments say what the amendment says. Once it lands, `gen.mjs` drops `BACK_CSS` and reads the stylesheet alone.

**Tests first** (`postcard.test.tsx`, beside "is drawn in the glass's text and field, and gold on a hit"), each red on
main before the change:
- The back's canvas draws no crossed bands (no `45deg` gradient in its rule), and its background multiplies a gradient of
  tokens over the noise (`background-blend-mode: multiply`).
- The emblem is `66cqw` square and its shadow reads `--kb-back-glow`.
- `.kb-postcard-back[data-hit]` sets `--kb-back-glow` to `var(--kb-glass-ready)`.

`node tools/check-ui-tokens.mjs` passes, since the noise's only literals are inside `url()`. A screenshot of the backs
at the four sizes, normal and hit, goes in the PR for the owner's word.

## Last. The full build and the final review

`npm run build:ci` and `npm run typecheck`, with their output. Then shots of the machine (the pack slot, its info, the
opening mid-flight, a pulled slot) and of the admin page, for the owner's word.

## Ways out of the states this touches

- **A slot pulled or marked up by the Boss:** its demand, its expiry (at most 7 days) or an admin's REVERSE. Its card
  stays in an on-sale pack.
- **A slot an admin made sold out or hidden:** an admin, on the machine's page.
- No state is added to a player, a character or a post.

## The masks

- `machine_now` and the moves over it are public and the same for every caller.
- `buy_card` and `buy_pack` refuse from the slot alone, in the same words for everyone.
- `packs`, `pulled` rows and `my_packs` are read by their own account only, as `card_ledger` is.
- The roll reads no account or character.
- The meeting reads the machine's public slots and no purchase.
- No Realtime event is added.

## Review focus

- The data migration on an instance that already holds cards: every card kind gets a slot at its old price, and no
  price is lost or doubled.
- The four places that counted a hand inline now call `card_held`, with nothing left counting `bought − played` itself.
- A Boss move and an admin's change in the same minute: the admin's *sold out* or *hidden* wins, and a moved price is
  computed from the admin's current price.
- Packs are the floor at landing: a Pull is refused when an admin has since hidden the only pack holding its card.
- At a busy instance, `machine_now` costs the slots times the open machine moves, never the purchases. `card_held` reads
  `card_ledger` by its `(account, card)` index.
- No screen still reads a card's price from `economy`, `basePrice` or `priceKey`.
