Record, written 2026-11-26.

# Event rarity and fixed-item events: plan

The design is `docs/plans/2026-11-26-event-rarity-design.md`; read it first, and section 5 of
`docs/plans/2026-11-04-cosmetics-design.md` for the roll it extends. Built in one PR from `main`.

One migration, `supabase/migrations/0442_event_rarity.sql` (take the next free number if `main` has moved past it).
Applying it to any deployed instance is the owner's go-ahead, never the build's. No deployed database, bucket or
connector is touched; SQL is tested against Postgres on localhost. CLAUDE.md and `tools/build.mjs` are not changed.
Every task is test first, with its red run recorded in the PR.

What is engine and what is instance: Tasks 1, 3, 4 and 5 are engine (and the SQL is the engine's); Task 2 is
Divided World's content, carried in through `Instance.events.lines`, `Instance.gear`, `Instance.cards` and
`Settings.cosmetics.events`, the interfaces Task 1 widens. Nothing in the engine names an event, an item or the
instance.

The masks: the roll reads only the caller's account and the instance's content (unchanged). The one new answer field,
`eventRarity`, is about the caller's own roll. No state is added that a player, a character or a post can be put in.

## Task 1. The rules: an event's rarity and item, event-only items, and their checks

Model: sonnet

Files: `engine/rules/cosmetics.ts` (`EventLine`, `GearRules`), `engine/rules/cards.ts` (`CardRules`, beside
`retired`), `engine/rules/types.ts` (`CosmeticsSettings.events`), `engine/rules/instance.ts` (`cosmeticsRule`,
`cosmeticsProblems`, `packProblems`), `engine/rules/packs.ts` (`eligible`), and their tests
`engine/rules/instance.test.ts`, `engine/rules/packs.test.ts`, `engine/rules/cosmetics.test.ts`.

**The shapes.**
- `EventLine` gains `readonly rarity?: Rarity` (absent is common) and `readonly item?: string` (a gear key on a gear
  event, a card key on a card event). Add `export const eventRarity = (l: Pick<EventLine, 'rarity'>): Rarity =>
  l.rarity ?? 'common'` in `cosmetics.ts`, and use it everywhere a line's rarity is read.
- `GearRules` gains `readonly eventOnly?: true`; `CardRules` gains `readonly eventOnly?: true`, with a doc comment in
  the manner of `retired`'s: "Found only through the Random Events that name it: never drawn by a pack's pull or an
  event that names no item, never sold by the machine, never in a fixed pack. An admin may still give it."
- `CosmeticsSettings.events` gains `readonly eventRarity: Readonly<Partial<Record<Rarity, number>>>`, commented "The
  weight of each rarity of an event, rolled among the rarities that hold an event of the rolled outcome."

**Tests first** (each red before the code changes), in `instance.test.ts` unless named:
- `cosmeticsRule`: `events` without `eventRarity` is refused, naming `events.eventRarity`; `eventRarity: {}` is refused
  ("must give at least one weight"); `eventRarity: { epic: 1 }` is refused; a weight of 0 is refused. The shape
  sentence names eventRarity.
- `cosmeticsProblems`, each case its own test, each asserting the exact sentence:
  - an event with `rarity: 'mythic'`: `event line "x" has the rarity "mythic"; a rarity is common, uncommon, rare or legendary`;
  - a `line` event with an `item`: `event line "x" is a line event and names the item "cap"; only a gear or card event gives an item`;
  - a gear event naming a key that is no gear (including a card's key): `event line "x" names the gear "y", and the instance has no such gear`; the same for a card event and a card;
  - a common gear event naming rare gear: `event line "x" is common and names the rare gear "y"; an event is at least as rare as the item it gives`. A rare event naming common gear passes; an uncommon event naming uncommon gear passes;
  - an `eventOnly` gear piece that no event names: `gear "y" is event-only and no event line names it, so it could never be found`; the same for a card. An `eventOnly` card that is also `retired` and named by no event passes;
  - an outcome whose events all sit at rarities `eventRarity` does not weigh: `the events' outcome "gear" has no event line at a rarity events.eventRarity weighs, and a Random Event that picks it would have nothing to say`;
  - `events.gearRarity` naming a rarity at which every gear piece is `eventOnly` is refused as the existing "no gear of that rarity" sentence says, now reading "no gear of that rarity that can be drawn" (and the same for cards). Update the existing assertions to the new words.
- `packProblems`: a fixed pack whose contents hold an `eventOnly` card: `pack "p" holds "c", which is event-only; an event-only card is found only through its events`; the machine's slot for one: `the slot for c names an event-only card; an event-only card is found only through its events`; a pull naming a rarity whose only cards are `eventOnly` is refused by the existing "no eligible card of that rarity" sentence (the eligibility test gains `!c.eventOnly`). A pack whose `leaves` names an `eventOnly` card passes.
- `packs.test.ts`: `packOdds` and `rollPack` never list or return an `eventOnly` card (a pull with one common
  `eventOnly` card and one plain common lists only the plain one at the whole common chance).
- The real instance still passes `instanceProblems` (the existing test), once Task 2's content is in. Run it at the
  end of Task 2, not here.

**The code.** `cosmeticsRule` adds `eventRarity` to the `exactly` list and checks it with `weights(..., RARITIES,
'events.eventRarity')`. `cosmeticsProblems` adds the checks above, in the order listed, after the existing line checks.
Rarity order is `RARITIES.indexOf`. `packProblems` adds `eventOnly` to the fixed-pack loop (after the out-of-print
check), to the machine's card slot (after its own checks), and to the pull's eligibility. `packs.ts`'s `eligible`
filters `!c.eventOnly` beside `inPrint(c)`, and its doc comment says so.

## Task 2. Divided World's content

Model: haiku

Files: `instances/divided-world/settings.ts`, `instances/divided-world/events.ts`, `instances/divided-world/gear.ts`,
`instances/divided-world/machine.ts`, and the tests `instances/divided-world/settings.test.ts`,
`instances/divided-world/machine.test.ts`, `instances/divided-world/cards/cards.test.ts` (only if it asserts the
cosmetics settings' shape).

**Tests first:**
- `settings.test.ts`: `cosmetics.events.eventRarity` equals `{ common: 80, uncommon: 15, rare: 4, legendary: 1 }`.
- `machine.test.ts`: the test "the rest are every uncommon, rare and legendary card, hidden, by rarity and then by
  name" filters `!c.eventOnly` in its expected list, so it still passes today and keeps passing when a card is made
  event-only. Add a test that no slot names an `eventOnly` card.

**The content**, exactly:
- `settings.ts`, in `cosmetics.events` after `cardRarity`: `eventRarity: { common: 80, uncommon: 15, rare: 4, legendary: 1 },`.
  Extend the comment above `cosmetics` with: "An event's rarity is rolled after its outcome, by eventRarity, among the
  rarities that hold an event of that outcome; every event is common unless it says otherwise."
- `gear.ts`: the Nostalgic Hat gains `eventOnly: true`:
  `{ key: 'nostalgic-hat', name: 'Nostalgic Hat', line: 'It smells like a summer that never ended.', rarity: 'rare', eventOnly: true },`
  and the header comment adds: "The Nostalgic Hat is event-only: it is found only in the attic (`events.ts`)."
- `events.ts`: after `vending-slot`, add
  `{ key: 'attic', outcome: 'gear', rarity: 'rare', item: 'nostalgic-hat', text: 'You find the {item} in the attic. Someone has written your name inside the brim, in your handwriting.' },`
  and the header comment adds: "An event may say its rarity (common unless it says) and name the item it gives; an
  event is at least as rare as its item."
- `machine.ts`: `const rarer = cards.filter((c) => c.rarity !== 'common' && c.eventOnly !== true);` and the header
  comment says event-only cards have no slot.

Then run `npm test` for `instances/` and `engine/rules/`: `instanceProblems(instance)` is empty.

## Task 3. The database: columns, the draw, the roll and the seed

Model: sonnet

Files: `supabase/migrations/0442_event_rarity.sql` (new), `supabase/tests/0442-event-rarity.sql` (new),
`supabase/tests/0168-random-events.sql` (where its seeded draws change), `supabase/functions/_shared/seed.ts`,
`supabase/tests/e2e/0003-export.ts`. Read `0207_random_events.sql`, `0404_card_retirement.sql` (the current
`draw_pool`), and `0413_rewind.sql` (the current `seed_instance`) first.

**Tests first** (`0442-event-rarity.sql`, in the style of `0168-random-events.sql`, each red before the migration):
- `event_lines` takes `rarity` and `item`; refuses a rarity outside the four; refuses an `item` on a `line` event.
  `gear_kinds.event_only` and `card_kinds.event_only` exist, default false. `random_events.rarity` exists, not null,
  default `common`, checked to the four.
- `draw_pool('gear', …)` and `draw_pool('card', …)` leave out an `event_only` row; `roll_pack` never returns one.
- `random_event`, with `setseed` and a crafted instance:
  - an outcome with one common event and one rare event, under `eventRarity {common: 1, rare: 1000}`, rolls the rare
    one; its answer carries `"eventRarity": "rare"`, and its row's `rarity` is `rare`;
  - an event that names gear gives that gear, even when `gearRarity` weighs only another rarity, and even when the
    gear is `event_only`; the found ledger row names it;
  - an `event_only` gear piece is never given by a gear event that names no item (seed many rolls, or make it the
    only gear at the weighted rarity and see the roll answer null);
  - an event naming a retired or gone card is not eligible: with it the only card event, the roll answers null,
    stamps the window and writes no event;
  - a settings row with no `eventRarity` (a database not yet re-seeded) rolls every event as weight 1 of common, so
    an instance whose events are all common rolls as before;
  - a rarity with no eligible event is skipped, never answered as null while another rarity has one.
- `seed_instance`: writes `rarity` (absent is `common`) and `item` on `event_lines`, `event_only` on `gear_kinds` and
  `card_kinds`; refuses, naming the line, an event whose item is no gear (for gear) or no card (for a card), and an
  event less rare than its item. A re-seed that takes `eventOnly` off clears the column.

**The migration**, in sections with a header comment as `0207`'s has, saying why each is there:
1. `alter table event_lines add column rarity text not null default 'common' check (rarity in ('common', 'uncommon',
   'rare', 'legendary')), add column item text, add check (item is null or outcome in ('gear', 'card'))`.
2. `alter table gear_kinds add column event_only boolean not null default false`; the same on `card_kinds`.
3. `alter table random_events add column rarity text not null default 'common' check (…the four…)`. The comment says
   that every event before this migration was in effect common, so the default is true of them. `random_events` is
   append-only, and adding a column is no update of a row's content.
4. `draw_pool` (0404's), also leaving out `event_only` rows on both sides.
5. `event_pool(chosen text, cfg jsonb)`, `stable`, returning `table (key text, rarity text, item text)`: the lines of
   the outcome that are eligible. A line that names an item is eligible when that item is in the item's pool
   regardless of `event_only` (for a card: `retired_at is null and gone_at is null and (voice or not writes)`, the
   voice read as `draw_by_rarity` reads it). A gear or card line that names no item is eligible when
   `draw_pool` has a row at a rarity `cfg -> 'gearRarity'` (or `'cardRarity'`) weighs above 0. A `line` line is always
   eligible. Revoked from public, anon and authenticated.
6. `random_event` (0207's), rewritten in this order, each step one `random()` draw unless said:
   the window and day checks as before; the outcome (one draw, as before); then
   `weights := coalesce(cfg -> 'eventRarity', '{"common": 1}')`, the rarity among those with weight above 0 and a row
   in `event_pool` (one draw); a line of that rarity ordered by key (one draw); then the item: the line's `item` when it
   names one (no draw), else `draw_by_rarity` as before (two draws). No eligible line, or no weighted rarity with one,
   answers null with the window stamped and nothing written, as now. The row inserts `rarity`, and the answer gains
   `'eventRarity', <the line's rarity>`; `rarity` stays the item's. The header comment states the draw order, since a
   seeded test reads it.
7. `seed_instance` (0413's whole body, with only these changes, and its header comment saying so): the `gear_kinds`
   insert writes `event_only` from `coalesce((e ->> 'eventOnly')::boolean, false)` and updates it on conflict; the
   `card_kinds` insert does the same for cards; the `event_lines` insert writes `rarity` (`coalesce(e ->> 'rarity',
   'common')`) and `item`, updating both on conflict. After the lines are written: raise `22023`, naming the first
   line, for a line whose item is not a key of `gear_kinds` (gear) or `card_kinds` (card), and for a line whose rarity
   ranks below its item's (rank by `array_position(array['common','uncommon','rare','legendary'], …)`).

**The seed payload** (`supabase/functions/_shared/seed.ts`): `gear` gains `eventOnly: g.eventOnly === true`; each card
gains `eventOnly: c.eventOnly === true` (a comment as `retired`'s: the SQL knows only the flag); `eventLines` gains
`rarity: eventRarity(l)` and `...(l.item !== undefined ? { item: l.item } : {})`. Its test, if `seed.ts` has one, asserts
the three.

**The export** (`supabase/tests/e2e/0003-export.ts`): the inserted `event_lines` gain a rare line naming `expgear`;
`gear_kinds` gains `event_only = true` on `expgear`; one inserted `random_events` row has `rarity` `rare`. The round
trip already compares every column of every table, so this proves the new columns travel.

Update `0168-random-events.sql` only where the new draw order moves a seeded result, and say in the PR which
assertions moved and why.

## Task 4. The client: the answer's event rarity, and the fake's roll

Model: sonnet

Files: `engine/ui/data/api.ts` (`RandomEvent`), `web/src/data/supabase.ts` (`randomEvent`), `engine/ui/data/fake.ts`
(`randomEvent`, `drawByRarity`, `Seed.nextEvent`), `engine/ui/data/fake.test.tsx`, and the web client's test for
`randomEvent` if one exists (find it with `grep -rn randomEvent web/src`).

**Tests first:**
- `fake.test.tsx`: with `eventsOn` and a crafted instance, the fake's roll picks an event by `eventRarity` among
  eligible ones, gives a named item, never draws an `eventOnly` item at random, skips an event naming a retired card,
  and answers `eventRarity`. A scripted event (`nextEvent`) may give `eventRarity` and is answered with it, defaulting
  to the scripted line's rarity, else common.
- The web client maps `eventRarity` from the answer, and an answer without it (an edge function not yet deployed)
  reads as `common`.

**The code.** `RandomEvent` gains `readonly eventRarity: Rarity`, and its doc comment says it is the event's own
rarity, beside `rarity`, the item's. The fake's roll follows Task 3's order exactly (outcome, event rarity among
eligible, line by key, then the named item or `drawByRarity`). `drawByRarity`'s callers filter `eventOnly` (and, for
cards, `inPrint`, which the fake leaves out today; say so in the PR). `nextEvent` takes an optional `eventRarity`.

## Task 5. The dialog's tag

Model: sonnet

Files: `engine/ui/events/RandomEvent.tsx`, `engine/ui/events/events.css`, `engine/ui/events/RandomEvent.test.tsx`,
`engine/ui/events/RandomEvent.stories.tsx`, `engine/ui/vending/vending.css` and a shared glass stylesheet for
`.kb-gem` (below), and any test that reads `.kb-gem` (`engine/ui/vending/Vending.test.tsx`,
`engine/ui/wardrobe/Wardrobe.test.tsx`).

The world is the glass. The look is the one the owner chose from the prototype (design, section 3, option A): the
title stays at the bar's start; at its end, the rarity's gem (`.kb-gem`, `gemOf`) and `{rarityName} event`, set in the
glass's label type, uppercase with the bar's tracking, in the rarity's color: uncommon `--kb-glass-sweet`, rare
`--kb-glass-ready`, legendary `--kb-glass-salty-text`. The frame, the body and the foot are unchanged. A common event
shows nothing new.

**Tests first** (`RandomEvent.test.tsx`):
- a common event (scripted with no `eventRarity`, and with `common`) renders no tag: the bar holds the heading alone.
- a rare event renders, in the dialog's bar, a gem with `data-kb-rarity="rare"`, `data-kb-gem="★"` and
  `aria-hidden="true"`, beside the text "Rare event". The dialog's accessible name is still "SOMETHING HAPPENED!";
  "Rare event" is read as the bar's text after it, never by color or glyph alone.
- a legendary line-only event shows "Legendary event", and the found-item sentence is absent (no item), as now.
- a rare event giving common gear shows both "Rare event" and "Common gear, now in your wardrobe."

**The code.** Pass the tag as `Overlay`'s existing `aside` prop (`engine/ui/glass/Overlay.tsx`, "Set in the bar after
the title"), as `<p className="kb-event-rarity" data-kb-rarity={r}><span className="kb-gem" aria-hidden="true"
data-kb-rarity={r} data-kb-gem={gemOf(r)} />{rarityName(r)} event</p>`, only when `event.eventRarity !== 'common'`.
In `events.css`, `.kb-event-rarity` pushes to the bar's end (`margin-left: auto`) and sets the color per rarity, and
the gem takes the same color through `--kb-gem-color`. The header comment of `RandomEvent.tsx` and `events.css` says
what the tag is and why it is in the bar.

`.kb-gem` and its rarity colors live in `vending.css` today, and the dialog does not load it. Move the rule block
(`.kb-gem`, `.kb-gem::before`, the three rarity colors, the forced-colors outline) unchanged to
`engine/ui/glass/gem.css`, imported by each component that draws a gem (`PackOdds.tsx`, `Wardrobe.tsx`,
`RandomEvent.tsx`). Its comment is carried with it. Vending and the wardrobe must look exactly as before: their board
tests and stories are the proof.

**Stories.** `RandomEvent.stories.tsx` gains `RareGear` (the cap under a rare event) and `LegendaryLine` (a line
alone, legendary). Check both at 1440 wide and at a phone's width (`e2e` runs the stories at both): at a phone's
width the tag wraps under the title rather than squeezing it, and nothing scrolls sideways. If the bar does not wrap,
give `.kb-event-rarity` the wrapping it needs inside the bar, not a second layout.

## Review focus

- Event rows written before the migration take `rarity` `common`. Check that this is true of them: every event before
  it was rolled from lines with no rarity.
- The roll's `random()` order changes (event rarity and line now come before the item). Any seeded SQL test that read
  the old order moves; check that each moved assertion moved for that reason and no other.
- A database migrated but not yet re-seeded has no `eventRarity` in its `cosmetics` row and no line rarities: the
  coalesce must roll it exactly as before. A tuned `cosmetics` row gets `eventRarity` from `jsonb_fill` at the next
  seed; check that the fill reaches the nested `events` object.
- Every way a card or gear piece reaches a player (pack pull, fixed pack, starting pack, machine slot, event with no
  item, admin grant) either leaves out an `eventOnly` item or is the admin's grant. Check that none was missed,
  including the fake.
- `event_pool` is read twice per roll (rarity, then line). At a busy instance its cost is in the instance's lines and
  items, never in its accounts or events; check that it reads no per-account table.
- The tag is the glass's copy: plain, true, and never in character.
