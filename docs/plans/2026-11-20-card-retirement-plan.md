# Retiring a card: plan

Record, written 2026-11-20. Carries out `docs/plans/2026-11-20-card-retirement-design.md`. One build session, one PR,
which closes #612. The tasks build in order; each writes its tests first and shows them red. The migration is
`0379_card_retirement.sql` as of this writing; the build takes the next free number.

## The layers

- **Engine** (`engine/`, `supabase/`): `CardRules.retired` and `CardRules.formerly`, `Instance.withdrawn`, their checks
  in `instanceProblems`, `cardNameOf`; the seed payload; the columns, `seed_instance`, `draw_pool`, `machine_now`,
  `admin_machine`, `card_held`, `my_card_ledger`, `open_pack`, `take_back`, `spring_facts`; `cardsOnOffer`; the log, the
  reveal, the unknown face and the admin machine page.
- **Instance** (`instances/divided-world/`): Card Collector's `formerly` and Bluff's `withdrawn` entry.
- No engine file names Bluff, Trap Card, Card Collector or Divided World; the boundary check holds it as it does today.

## The masks, for every task

- The pools, `machine_now` and `admin_machine` read the catalog alone, never an account.
- Renames and refunds are written as each account's own `card_ledger` and `wallet_events` rows, read by that account
  alone. No Act is written and nothing broadcasts.
- `seed_instance` answers the service role alone, with totals across accounts.
- `take_back`'s new refusal is reached only by the back's own setter, after the existing ownership check, so it adds no
  answer another caller can see.

## Task 1: The rules: out of print, formerly, withdrawn

Model: sonnet

- **Files:** `engine/rules/cards.ts` (`CardRules`), `engine/rules/types.ts` (`Instance`), `engine/rules/instance.ts`
  (`instanceProblems`), a new `engine/rules/card-names.ts` with its test.
- `CardRules` gains `readonly retired?: true` and `readonly formerly?: readonly { key: string; name: string }[]`.
  `Instance` gains `readonly withdrawn: readonly { key: string; name: string; refund: Hundredths }[]` (every instance
  passes `[]` where it has none; the test instance in the engine's fixtures gains `[]`).
- `inPrint(rules) = rules.retired !== true`.
- `cardNameOf(instance, key): string | undefined`: a card's name, then the name in a card's `formerly`, then in
  `withdrawn`.
- `instanceProblems` adds, in the engine's words, each naming the key: a key in more than one of cards, any
  `formerly`, `withdrawn`; a `formerly` or `withdrawn` key that is not a valid card key; a refund that is not a
  positive integer; a pack whose `contents`, pulls' reach or `leaves` names an out-of-print card; a machine slot that
  names an out-of-print card.
- **Tests first:** each problem, red on an instance that has it; `cardNameOf` for each of the three sources and an
  unknown key; Divided World's instance has no problem.

## Task 2: The database

Model: sonnet

- **Files:** `supabase/migrations/0379_card_retirement.sql`, `supabase/tests/0379-card-retirement.sql`,
  `supabase/functions/_shared/seed.ts` (with `seed.test.ts`).
- `card_kinds` gains `retired_at timestamptz`, `gone_at timestamptz`, `became text references card_kinds (key)`,
  `refund integer check (refund > 0)`; checks: `became` and `refund` only with `gone_at`, never both, and one of the
  two always with `gone_at`; `retired_at` and `gone_at` not both. `pack_kinds` gains `retired_at timestamptz`.
- `card_ledger_kind_check` adds `renamedOut`, `renamedIn`, `withdrawn`; `withdrawn` rows carry the refund as `price`.
  `wallet_events_kind_check` adds `withdrawal`.
- The payload (`seed.ts`): each card's `retired`, the cards' `formerly` (as `{key, name, became}`), and `withdrawn`.
- `seed_instance` (0377's, everything else as it was), after the cards are written and before the packs and slots:
  1. Refuse, naming each, a `card_kinds` key the payload lists in none of its three lists, and a key with `gone_at`
     listed as a card.
  2. Set `retired_at = coalesce(retired_at, now())` where the card says `retired`, and null where it does not.
  3. For each `formerly` key not yet gone: set `gone_at`, `became`; for every account with a positive count of the old
     key (held, as `card_held` counts it, plus live backs), insert that many `renamedOut` rows on the old key and
     `renamedIn` on the new, in one statement each.
  4. For each `withdrawn` key not yet gone: set `gone_at`, `refund`; insert that many `withdrawn` rows per account and
     one `wallet_move(account, refund * copies, 'withdrawal', null, null)` per account.
  5. Set `pack_kinds.retired_at` for a pack kind the payload does not list, and clear it for one it lists.
  6. The answer gains `retired`, `renamed: [{from, to, copies}]` and `withdrawn: [{key, copies, refunded}]`.
  A second seed with the same payload writes nothing in steps 3 and 4.
- `card_held`: counts `renamedIn`, subtracts `renamedOut` and `withdrawn`, and leaves out ended backs of a key with
  `gone_at`. `my_card_ledger` the same for its returned rows; `my_cards` follows `card_held`.
- `draw_pool`: `and k.retired_at is null and k.gone_at is null`.
- `machine_now`: leaves out a slot whose card has `retired_at` or `gone_at`, or whose pack kind has `retired_at`.
  `admin_machine` carries `retired`, `became` and `withdrawn` for each card slot and `retired` for each pack slot.
- `open_pack`: a card with `became` is written `pulled` under the new key; a withdrawn one is written `withdrawn` with
  its refund, and the pack's refunds are one `wallet_move` (`withdrawal`). The answer gains
  `refunds: [{index, refund}]`.
- `spring_facts` (0374's): a back whose card has `gone_at` matches nothing.
- `take_back` (0317's): a back whose card has `gone_at` is refused after the setter check, in the design's section 3
  words, with the dates from `gone_at` and the back's `ends_at`.
- **Tests first** (localhost Postgres):
  - seed a card, roll packs under `setseed` until the card comes up; seed again with it `retired`; the same rolls never
    give it, and `random_event`'s card outcome never does; it stays playable from a hand (a `play_card` succeeds).
  - listing it again clears `retired_at`, and the roll gives it again.
  - a seed that drops a key from all three lists is refused naming it; one that lists a gone key as a card is refused.
  - rename: an account with 2 held and 1 live back gets 3 `renamedOut` / `renamedIn` rows; `card_held` moves 3; the
    back ends and adds nothing; a second seed writes nothing; a sealed pack holding the old key opens as the new one.
  - withdraw: the same counts as `withdrawn` rows and one `withdrawal` wallet event of 3 x refund; a refund past
    `walletCap` overflows as recorded; a sealed pack's copy is refunded at opening.
  - the slot of a retired card, a gone card and a retired pack kind is absent from `machine_now`; `buy_card` and
    `buy_pack` on it are refused in the missing slot's words; listing again brings it back with its availability.
  - a back of a gone key never springs; `take_back` of it is refused in the plain words.
  - `card_ledger`, `face_down`, `packs` and `machine_slots` take no update or delete across all of the above (the
    triggers are untouched).
  - `seed.test.ts`: the payload carries `retired`, `formerly` and `withdrawn`.

## Task 3: Mod Bots and the act service

Model: inline

- **Files:** `supabase/functions/chatter/core.ts` (`cardsOnOffer`), with its test.
- `cardsOnOffer` adds `inPrint(c)`. **Test first:** an out-of-print castable card is not offered.

## Task 4: The data layer and the log

Model: sonnet

- **Files:** `engine/ui/data/api.ts` (`CardEvent`, the admin machine slot type), `engine/ui/data/fake.ts`, the live data
  layer beside it, `engine/ui/log/lines.ts` with `lines.test.tsx` and `Log.test.tsx`.
- `CardEvent.kind` gains the three ledger kinds; the wallet's events gain `withdrawal`. The fake data layer writes them
  as the SQL does, for the stories and tests.
- The log: one row per seed per kind, under the account: "Bluff was withdrawn from the game. Your 2 copies were
  refunded 2.00 orbs." (one copy: "Your copy was refunded 1.00 orb."), and "Trap Card is now Card Collector. Your 2
  copies are Card Collectors now." (one: "Your copy is a Card Collector now."). An opened pack's refund is a line of
  its opening row: "1 card in it was withdrawn and refunded 1.00 orb."
- Every `instance.cards.find(...)?.name` in `lines.ts` that names a card from a key goes through `cardNameOf`.
- **Tests first:** each line, with one copy and several; a play of a withdrawn and of a renamed card in history names
  it by its old name, never "a card".

## Task 5: The reveal, the unknown face and the admin machine page

Model: sonnet

- **Files:** `engine/ui/vending/Vending.tsx`, `engine/ui/cards/Hand.tsx`, the reveal component they share
  (`cards={...}`), `engine/ui/admin/Machine.tsx` with their tests and stories.
- One `unknownFace(key)` (moved to `engine/ui/cards/faces.ts`, used by both) draws the instance's card back with the
  words "A card this machine no longer has", no art borrowed, no rarity, alignment or play word.
- A refunded card in an opening (`refunds` from `open_pack`) is that back with "Withdrawn: refunded 1.00 orb." in the
  glass's plain voice.
- The admin machine page marks a card slot "Out of print", "Renamed to <name>" or "Withdrawn", and a pack slot "Out of
  print", and shows its availability control as not in use for it.
- **Tests first:** the unknown face renders no `faces[0]` art (red today); the refund slip's words; the three marks.

## Task 6: Divided World's entries

Model: inline

- **Files:** `instances/divided-world/cards/card-collector.ts` (`formerly: [{ key: 'trap-card', name: 'Trap Card' }]`),
  `instances/divided-world/` where `Instance` is assembled (`withdrawn: [{ key: 'bluff', name: 'Bluff', refund: 100
  }]`), `instances/divided-world/cards/cards.test.ts`.
- **Test first:** the instance's seed payload lists both, and the instance has no problem.

## Task 7: Export

Model: haiku

- **Files:** `supabase/tests/e2e/0003-export.ts`.
- The fixture gains an out-of-print card, a renamed pair with `renamedOut` / `renamedIn` rows, a withdrawn card with a
  `withdrawn` row and its `withdrawal` wallet event, and a retired pack kind. The round trip holds them.

## Review focus

- What the first seed does to the deployed database: every Trap Card copy, held or face down, moved once; every Bluff
  refunded once; nothing written on the seed after.
- Every reader of a hand count (`card_held`, `my_card_ledger`, `my_cards`, the client's fold of `CardEvent`s) agrees on
  the three new kinds; a disagreement shows a card that cannot be played or hides one that can.
- A seed racing a play or a `take_back` of the card it renames or withdraws: the advisory lock serializes seeds, not
  plays, so the counts must be taken under a lock that stops a copy being played between count and write.
- The seed's cost at a busy instance's scale: steps 3 and 4 are one grouped statement per key over `card_ledger` and
  `face_down`, indexed on `(account, card)`, and run only the seed a key first leaves.
- `machine_now` hiding a slot: a flash sale or Pull already open on it must not show it or sell it.
- A refund past `walletCap`: the overflow is recorded and logged, never lost silently.
