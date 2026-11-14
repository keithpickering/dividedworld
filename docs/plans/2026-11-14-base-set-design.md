Record, written 2026-11-14.

# The Base Set: the roadmap to 52 cards, and one card to a folder: design

A design session with the owner, which began from an appraisal of the card pool and a set of the owner's card ideas.
The pool, its gaps, every proposed card and the owner's direction on them are kept in one GitHub issue,
[keithpickering/dividedworld#683](https://github.com/keithpickering/dividedworld/issues/683) ("Game balance"), which
stays the living list; this design does not copy it. This design decides **how the Base Set gets built**: the order of
the work, how it is split into plans, and the change that lets card builds run side by side. Its plan is
`docs/plans/2026-11-14-card-seams-plan.md`, which carries out section 4 alone. Every other plan named here is written by
a design session of its own.

## Why

The owner: "Simultaneous builds must be able to avoid conflicts, otherwise they get trapped in endless delta reviews."
A build's final review is the last full read of its branch, and any commit after it, a fix or a merge of main, buys a
delta review and a full build (`.claude/skills/build-session/SKILL.md`, step 4). Seventeen new or reworked cards and
four kinds of engine work are planned. Built carelessly in parallel, every merge would conflict with the next.

Three places in this repository make parallel card work collide, and only the first is a conflict git can show:

1. **The instance's card lists.** `instances/divided-world/cards/index.ts` registers every card on one line;
   `instances/divided-world/ui/cards.ts` is one 757-line file of every card's art imports and screen entry;
   `instances/divided-world/machine.ts` is the Vending Machine's slot list; `instances/divided-world/cards/cards.test.ts`
   holds a one-line list of every card's key and price and every card's tests; `instances/divided-world/ui/index.test.tsx`
   holds a table of where each card lands when it is set face down. Every card build edits all five.
2. **SQL functions that every card feature replaces whole.** A migration redefines a function (`create or replace`).
   Two builds that each start from main's `place_cast`, in two migration files, show git no conflict at all: whichever
   file sorts later wins, and the other build's change is silently gone until CI on a main merge finds it. The
   functions a card feature reaches: `card_kinds_problem` and `seed_instance` (last in `0361_discipline_cards.sql`, and
   touched by every new card property), `place_cast` (0361), `spring_traps` and `lay_sprung`
   (`0357_post_veils.sql`), `settlement_input` and `estimate_input` (`0359_post_reactions.sql`).
3. **Migration numbers.** Two builds that each take the next free number fail `tools/check-migration-versions.mjs`,
   and the rename is a commit.

## 0. What the owner decided, and what was weighed

1. **The split: a small seams plan first, then the engine plans one at a time, with card builds in parallel.**
   Weighed: the same seams with the three engine plans built at once (each would have to own its files strictly:
   Time Machine's freeze moved into Plays, Ratio's mark into Settlement, and the shared lists such as log lines and
   copy would still collide); one large plan in one build (no collisions, but one enormous PR whose final review is
   where a review loop is likeliest).
2. **Because the engine plans run one at a time, the SQL needs no seams.** Each of the functions in "Why" (2) is touched
   by one build at a time. The builds that run in parallel are card builds, and those are instance work alone
   (section 3). So the seams plan opens only the instance's lists. Weighed and dropped: splitting `card_kinds_problem`
   into a function per effect kind, a table of allowed kinds that migrations insert into, and a `spec jsonb` column on
   `card_kinds` with generated columns so `seed_instance` never changes; each makes additions additive, and none is
   needed while the engine plans are serial.
3. **Migration numbers are not reserved.** Only one engine plan of this roadmap builds at a time and a card build adds no
   migration, so no two builds of the roadmap take numbers at once. Weighed: a block of numbers per plan, which collides
   with every unrelated build, since those take the next free number above the highest one merged.
4. **The Vending Machine's order is a rule, not a list.** The owner: "I've been configuring it with the Booster as item
   #1, followed by some common moves, reversals, and gimmicks. I haven't actually been listing uncommons or rarer in the
   machine, because it incentivizes buying a pack and makes the pulls more special … there will be a ton of items in
   the grid otherwise (and if it scrolls it stops looking like a vending machine)." Section 4.3 writes that down.
   Weighed: a shelf number in each card's file (hand order without a list, but two builds can take one number); one
   hand-ordered list kept in `machine.ts` (every new card appends to it, so parallel card builds conflict there).
5. **Uncommons and rarer are hidden, not left out.** A hidden slot is not drawn, so the grid stays small, and the Boss's
   machine moves can still bring one out, as Main Event is brought out today (`machine.ts`'s header). Weighed: leaving
   them out of the machine, which loses that event.
6. **The grid stays even, with the unfilled cells marked `?`, as now.** The owner asked; the machine already does it: two
   columns, the count rounded up to even, six at least (`slotsFor`, `engine/ui/vending/Vending.tsx`), and the "N slots
   empty" line. The Base Set's 16 commons and the Booster are 17 items: nine rows of two and one `?`, where today's seed
   draws 27 on sale in fourteen rows.
7. **This session writes the roadmap and the seams plan only.** Each engine plan gets its own design session, so each
   card's open questions get the owner's whole attention, and each plan is written against main as the plan before it
   left it. Weighed: writing all three engine plans now (written against code that will have moved by their build);
   the seams plan and the Settlement plan together.
8. **Hype-Up keeps its own plan** (`docs/plans/2026-11-13-hype-up-on-a-post-plan.md`) and builds first. Weighed:
   absorbing it into an engine plan, which rewrites a finished plan to save the one number the Settlement plan changes
   anyway (its "doubled" becomes the flat Earn's +1 vote per vote, with every other Earn card).

## 1. The order of the work

1. **Hype-Up** (`docs/plans/2026-11-13-hype-up-on-a-post-plan.md`), now.
2. **THIS** (`docs/plans/2026-11-13-this-plan.md`), after Hype-Up merges. Both plans edit `ui/cards.ts`,
   `cards/index.ts` and the card tests, so they build one after the other.
3. **The seams** (`docs/plans/2026-11-14-card-seams-plan.md`), after THIS merges. Hype-Up's and THIS's plans name the
   files the seams move; a build reads its plan alone, so those two build before the move and not after it.
4. **The engine plans, in this order**, each written by a design session of its own, which also designs the cards the
   plan unlocks and writes **one plan per card**:
   - **Settlement** (`engine/rules/settle.ts`, `settlement_input`, `estimate_input`): the flat Earn (a flat amount per
     vote beside the percentage `by`, which the engine keeps), converting Heat Magnet, Publicity Tour, Class Clown and
     Hype-Up to it; an Earn filtered by the kind of Act; halving a loss; the reveal perk (#683, "The reveal perk").
   - **Plays** (`place_cast`, `spring_traps`, `lay_sprung`): the refund outcome; getting past Wards and Reversals;
     ending a Gimmick; the thread lockout, a new state with its way out; and whatever Whoopee Cushion turns out to need
     beyond 4D Chess's pay outcome.
   - **The post and thread** (`thread_page`, the edit path, `thread_places`): rewinding and freezing a post, with its
     refusal of casts in `place_cast` (Plays has merged by then); a mark decided by outdrawing; bumping a thread.

   Each engine plan may build while the cards of the wave before it build (section 3).
5. **The card waves**, in section 2's table.

## 2. Slots and waves

After the seams, each shared list holds one card per line, sorted by key (section 4). Git conflicts when two branches
insert at one place, so two new cards conflict only when they fall between the same two existing keys: the same
**slot**. Every new key's slot, with THIS and the reworked Hype-Up already in the lists:

| Slot (between) | New cards |
|---|---|
| `card-collector` and `class-clown` | cheap-shot |
| `force-field` and `glitter-bomb` | front-row |
| `heat-magnet` and `hype-up` | hot-box |
| `hype-up` and `jimmy-wails` | interference |
| `jimmy-wails` and `last-word` | kick-me |
| `mooch` and `off-day` | necro-bump |
| `overreaction` and `publicity-tour` | pay-it-forward |
| `publicity-tour` and `stick-around` | ratio, required-reading, rope-break, so-very-happy, steel-chair |
| `super-happy-heart` and `take-the-fall` | sweet-heat |
| `tattle-tale` and `this` | thick-skin |
| `this` and `toll` | time-machine |
| `whodunnit` and `whoops` | whoopee-cushion |

**Two cards of one slot never build at once.** The second starts from main after the first merges. Keys are the issue's
working names; a design session that renames a card checks its slot again here.

| Wave | Starts after | Cards |
|---|---|---|
| 1 | the seams merge | Hot Box and Rope Break at once, then Steel Chair (Rope Break's slot) |
| 2 | Settlement merges | Sweet Heat, Front Row, Thick Skin, Required Reading (Required Reading waits for Steel Chair if it is still building) |
| 3 | Plays merges | Cheap Shot, Interference, Kick Me, Pay It Forward, Whoopee Cushion, SoVeryHappy (SoVeryHappy waits for Required Reading if it is still building) |
| 4 | the post and thread plan merges | Time Machine, Ratio, Necro Bump (Ratio waits for SoVeryHappy if it is still building) |

Wave 1's cards need no engine work (Rope Break is a Reversal on the engine's existing catch; Hot Box and Steel Chair are
instance effects on a post, the way Whoops! and Below the Fold are) and get a short design session of their own, since
Hot Box and Steel Chair are screens whose look is the owner's to settle.

Weighed: discovering cards from the filesystem, the one layout with no shared list at all. The screens could
(`import.meta.glob` under Vite), but the rules also run under plain node (`npm run test:engine`) and in the edge
functions, where it does not exist; a generated index committed to the repository conflicts as the hand-kept one does,
and one generated at build time and left out of git is a step every runner must remember. Planning around slots costs a
table.

## 3. The boundary between engine plans and card builds

- **A card build touches no engine file and adds no migration.** A card that turns out to need SQL or an engine change
  belongs to its engine plan; its build stops and asks the owner.
- **An engine plan adds no new card.** It may edit an existing card's files (Settlement turns Heat Magnet's earn flat).
  With one card to a folder, that collides only with a build of the same card, which the roadmap never runs beside it.
- **The layers** (CLAUDE.md, "KayfaBB never knows which instance it runs"): every engine plan names no card and no
  class, and every card build is Divided World's content plugged into the engine's interfaces (`CardRules`, `CardUi`).

## 4. One card to a folder (the seams plan)

What the seams plan builds. All of it is Divided World's; nothing in the engine changes, and no migration is added.

### 4.1 A card's own files

A card is its rules file and folders, as today, and nothing outside them names it except the one line of each list in
4.2:

- **Its rules**, `instances/divided-world/cards/<key>.ts` (and `cards/<key>/` where it has more), as today, now also
  exporting the card's **machine price**: `export const price: Hundredths`.
- **Its rules' tests**, `instances/divided-world/cards/<key>.test.ts`, taken out of `cards/cards.test.ts` with the
  helpers those tests share in `cards/test-kit.ts`. `cards/cards.test.ts` keeps only the tests about the whole pool.
- **Its screen entry**, `instances/divided-world/ui/cards/<key>/ui.ts`, exporting the card's `CardUi`, with its art
  imported from its own folder (`./art.webp?url`, `./mark.svg?url`, `./art.json`). The art folder already exists for
  every card, and `tools/check-card-art.mjs` reads only the art files in it ("any other file in a card's folder … is
  not read"). The words more than one card uses (`setMoveWords`, `spanWords`, `earnWords` and their kin) move to
  `instances/divided-world/ui/cards/words.ts`.
- **Its screen tests**, where it has any of its own, `instances/divided-world/ui/cards/<key>/ui.test.tsx`.

### 4.2 The lists that remain

Two lists remain, each **one card per line, sorted by key**, and a test holds each sorted (so a new line goes to its
slot, section 2):

- `instances/divided-world/cards/index.ts`: one import line and one list line per card, the list line pairing the
  rules with the price.
- `instances/divided-world/ui/cards.ts`: one import line and one list line per card.

A table test that listed every card by key becomes a rule over every card where the rule is what it was checking: the
face-down landing table in `ui/index.test.tsx` becomes "a cast card set face down lands on what its reach names on the
quoting post", computed from `reaches`.

### 4.3 The machine, by rule

`instances/divided-world/machine.ts` computes the slots from the cards and their prices:

1. **The Booster first**, on sale, at its price today (3.00).
2. **Every common, on sale**, the Moves (`cast`), then the Reversals (`set`), then the Gimmicks (`use`), each group by
   the card's name.
3. **Every uncommon, rare and legendary card, hidden**, by rarity (`RARITIES`' order), then by name.

The prices are today's, each now in its card's file. What changes for a player: the uncommons `machine.ts` puts on sale
today (Publicity Tour, Card Collector, Hall Pass, Force Field, Heat Magnet, Class Clown, Good Vibes, Glitter Bomb,
Mooch, Toll, 4D Chess, Jimmy Wails, Hype-Up until its rework makes it common, Last Word, Laugh Track, Blind Study, Happy
Heart, Take the Fall) start hidden, so the seeded grid is the Booster and the commons. An admin still sets any slot's
availability, and the seed still never touches a slot the database already holds (`seed_instance`, 0139's rule).

### 4.4 What it does to the rest of the game

- **The masks.** Nothing here adds a response, payload, event or timing; the machine's slots are public and computed
  from the instance's code alone.
- **Ways out.** No state is added.
- **A busy instance.** The machine is computed once when the instance module loads; its cost grows with the cards in
  the instance, never with players, threads or Acts.

## 5. Open

- **The Base Set's cards** are each open until their design session; #683 holds every open question raised so far.
- **Whoopee Cushion's engine need** is the Plays design session's to settle: whether 4D Chess's pay outcome, which pays
  on a named Move's votes in a quadrant, can pay on any common cast's votes as it stands.
- **The order of the shared lists' imports** within one card's line pair (rules import, then price) is the plan's; a
  card that needs a wrapper beside its rules (Card Collector's and 4D Chess's `staffOptions`, built in `index.ts` today)
  keeps that wrapper in `index.ts`, and the plan says how.
