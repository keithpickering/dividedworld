Record, written 2026-11-18.

# A retired card is never deleted: plan

Carries out section 1 of `docs/plans/2026-11-18-catalog-over-time-design.md`. One PR from `main`. It shares no code
with `docs/plans/2026-11-18-play-terms-plan.md` and either may be built first.

Every task goes test first: write the failing test, record its red run, then the code. During a task, run only the
tests for the changed code (`npm run test:sql`, `node --experimental-strip-types --test <file>`,
`npx vitest run <file>`). Run `npm run typecheck` and `npm run build` once after the last task, with the tail in the
PR. No deployed database, bucket or connector is touched; SQL is tested against Postgres on localhost.

**One migration**, the next free number at build time, named `retired_cards`, with one SQL test file of the same
number.

**The layers.** Tasks 1 to 3 are the engine's and name no card. Task 4 is Divided World's.

**The masks.** Nothing added reads a private fact. Whether a card is retired is public catalog data.

**States.** None added: a held or face-down copy of a retired card works as any card does.

**Scale.** `draw_pool` gains one predicate over a table of dozens of rows.

## Task 1. The catalog knows a retired card, and the seed never loses one

Model: sonnet

**Files:** `engine/rules/types.ts` (`CardRules`); `engine/rules/instance.ts` (`instanceProblems` and the packs and
machine problems near line 414) and its test; the migration; the SQL test file; whatever builds the seed's payload
from the instance (find it from `seed_instance`'s callers under `tools/` and `supabase/`).

- `CardRules` gains `readonly retired?: true`.
- `instanceProblems`: a retired card has no machine slot, is in no card's `draws`, and is not a pack's only card of
  a rarity the pack weighs (a pull must still have something to give; the existing check for that counts live cards
  only). Each problem is a sentence naming the card.
- `card_kinds` gains `retired_at timestamptz` (null: live).
- `seed_instance` (from its latest definition, `0361_discipline_cards.sql` as this is written):
  - Before anything is written, it raises when a key in `card_kinds` is not in `payload -> 'cards'`, exactly:
    `the instance no longer lists <keys>; a card is retired, never removed: mark it retired in the instance's
    cards` (errcode `22023`).
  - The upsert sets `retired_at` to `now()` for a card the payload marks retired whose `retired_at` is null, keeps
    an earlier date, and sets it null for a card the payload lists as live.
  - A machine slot whose card is retired is set to `hidden`. (A retired card has no slot in the payload, so the
    insert leaves it; this is for the slot an instance already holds.)

**Tests first.** SQL: seed a card; seed again without it and read the refusal; seed it retired and read
`retired_at`, its slot hidden; seed it live again and read null. Engine: each `instanceProblems` sentence, red on a
fixture instance that breaks it.

## Task 2. Nothing deals a retired card

Model: sonnet

**Files:** the migration and SQL test; `supabase/functions/chatter/core.ts` (the offer near `cardRarityMost`) and
its test; `engine/ui/data/fake.ts` (its pack roll and pool, so the stories and the screens' tests agree).

- `draw_pool` (`0207_random_events.sql`): the card branch adds `and k.retired_at is null`. It is the one place that
  says which cards a pool gives; `roll_pack` and `draw_by_rarity` read it and need no change. Confirm by grep that
  no other function picks a card from `card_kinds` at random (the session found none after 0207).
- The Vending Machine's read of its slots already leaves out `hidden`; a test holds that a retired card's slot is
  not sold and that buying it by a hand-made request is refused as a hidden slot is.
- The chatter function's offer of cards to a persona leaves out a retired card.

**Tests first.** SQL: with one live and one retired card of a rarity, a thousand pulls of that rarity give only the
live one; with only a retired card of a rarity, the pull refuses in `roll_pack`'s existing words. A retired card in a
hand is played, and one set face down springs, as before the retirement (the same assertions run before and after
the seed that retires it). Poison for the pull test: the predicate removed.

## Task 3. The unknown face claims nothing

Model: sonnet

**Files:** `engine/ui/vending/Vending.tsx` (`unknownFace`, and its use near line 641), its test and story.

`unknownFace` takes no other card's face: no art, the neutral colors it already falls back to, and `play` left
empty. A test renders an opening with an unknown key beside Stick Around and asserts the unknown face holds none of
Stick Around's art.

This is the glass, plain and never in character. The words "A card this machine no longer has" stay.

## Task 4. Divided World: Bluff and Trap Card, retired

Model: sonnet

**Files:** `instances/divided-world/cards/` (the two cards' rules, their folders if they had any, `index.ts`);
`instances/divided-world/ui/` (their faces, words and effects, and `trap-words.ts`, which still names them);
`instances/divided-world/cards/cards.test.ts`.

- Restore both cards from the commit that removed them (`git log --diff-filter=D --all -- instances/divided-world`
  finds it; fetch the full history first if the clone is shallow). Bring them to today's `CardRules` shape and mark
  each `retired: true`.
- `index.ts`: `listed` holds a card with a price or a retired card with none; `cards` holds both; `prices` and the
  machine's list hold only the live ones. The `staffOptions` enums for Card Collector and 4D Chess leave retired
  cards out.
- The pack odds test (`cards.test.ts`, near "the hit pull") counts live cards only.

If the restored cards cannot be brought to today's shape without a design choice (a rule they relied on is gone),
stop and ask the owner, naming the rule.

**Tests first.** `instanceProblems(dividedWorld)` is empty. Neither card is in any pack's chances. Each has a face,
so the hand and the pack screens draw it by name and art.

## Task 5. What an instance already holds

Model: sonnet

**Files:** the SQL test file.

A test that builds the state the test deployment is in, by the migrations before this one: `card_kinds` rows for
`bluff` and `trap-card`, copies in `card_ledger`, a `machine_slots` row and a `face_down` row. It then runs this
migration and Divided World's seed and asserts: both are retired, the slot is hidden, the held copies are still in
the hand (`my_cards`) and playable, the face-down one still springs, and no pull gives either.

The deployed database is not touched by the build. The PR's description says the seed must run with the release,
and that a release without Task 4 would now be refused by the seed.

## Task 6. The issue

Model: inline

`Closes #612` in the PR's description.

## Review focus

- A release in which the functions serve before the seed runs (#735): what a client sees for a retired card in
  that minute.
- Every reader of `machine_slots` with a slot the seed has hidden: a slot hidden by an admin and one hidden by
  retirement are told apart only by the card's `retired_at`, and bringing a card back does not show its slot again
  by itself.
- An instance whose every card of one rarity is retired: packs that weigh that rarity.
- The export and import round trip with `retired_at`: an import must not read as a fresh retirement.
- Whether any Mod Bot path other than the chatter offer can name a retired card (`staff_play_card`'s pool).
