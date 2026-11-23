Record, written 2026-11-23.

# The crowd floor: plan

Carries out `docs/plans/2026-11-23-crowd-floor-design.md`. One PR from `main`.

**Migrations.** Each migration here copies a function it replaces from the newest migration that defines it (`grep -ln
"function public.settings_held" supabase/migrations/*.sql | tail -1`, and so for `screen_settings`), never from a file
named here, and takes the next free migration number at build time (0413 as this is written).

Every task goes test first: write the failing test, record its red run, then the code. During a task, run only the
tests for the changed code (`node --experimental-strip-types --test <file>` for the rules' tests, `npx vitest run
<file>` for the screens', `npm run test:sql` for the migrations). Run `npm run typecheck` and `npm run build` once
after the last task, with the tail in the PR. No deployed database, bucket or connector is touched; SQL is tested
against Postgres on localhost.

**The layers.** Tasks 1 to 3 are the engine's and name no instance; the engine's tests use its own neutral test
classes. Task 4 is Divided World's (`instances/divided-world/`).

**The masks.** The floor is read from a character's received votes and its class, in settlement and in the owner's own
estimate, which already run the same `settle` code. It is shown only as standings and the owner's log and estimate
already show class pay. No public read, Realtime event, refusal or timing changes (design, section 6).

**States.** None added.

**Scale.** One pass over each stretch's `received` lines with a set lookup per line (design, section 8).

## Task 1. The setting

Model: sonnet

**Files:** `engine/rules/types.ts` (`Settings`), `engine/rules/instance.ts` (`SETTINGS`, beside `crowdPayEach`),
`instances/divided-world/settings.ts` (`defaults`), `engine/ui/data/api.ts` (`ScreenSettings`),
`engine/ui/guide/markdown.ts` (`KINDS`), `engine/ui/data/fake.ts` and `engine/ui/test-world.tsx` (their settings
lists), `web/src/data/settings.ts`, a new migration (`settings_held`'s clause and `screen_settings`' key list),
`supabase/tests/0079-settings-held.sql`, `supabase/tests/setup/fixtures.sql`, and every other list of every setting
(`grep -rln crowdPayMost --exclude-dir=node_modules --exclude-dir=docs .` names them; `npm run typecheck` names the
rest).

- `Settings` gains:
  ```ts
  /** What a vote on the character's own Act pays it when its class neither pays nor charges that vote (the crowd floor), in hundredths; 0 switches it off. */
  readonly crowdFloor: Hundredths;
  ```
- The rule: a whole number at least 0, `'a whole number of hundredths, at least 0'`, as `crowdPayEach`'s. The
  migration's `settings_held` holds the same in the same words; `screen_settings` exposes the key, so the guide can say
  it.
- Divided World's default, with its reason: `crowdFloor: 2` ("a fifth of a vote, as crowd pay pays for giving: a
  reaction a class neither pays nor charges still helps the character it lands on"). The engine's test settings
  (`engine/ui/test-world.tsx`, and the rules' own test instance) set 2 as well, so the floor is exercised; Task 2's
  existing-test fallout is fixed there.
- `KINDS`: `crowdFloor: 'aura'`.

**Tests first:** the settings-held test pair goes red once the key is in `Settings` with no SQL rows for it; add to
`supabase/tests/0079-settings-held.sql` the poisons (`crowdFloor` −1 and 1.5) and the good (2). A guide test that
`{{setting:crowdFloor}}` says "0.02".

## Task 2. The rule in `settle`

Model: sonnet

**Files:** `engine/rules/types.ts` (`ClassRules`), `engine/rules/settle.ts` (the per-character stretch loop, around
`classOf.get(stretch.class)!.earn(...)`, and the boost, perk and cushion passes after it; the file's header comment),
`engine/rules/settle.test.ts`, and any settle test whose expected ledger the floor now changes.

- `ClassRules` gains:
  ```ts
  /** Which of the character's received votes the crowd floor may pay, when the class neither paid nor charged them; every one when absent. */
  floorOn?(reaction: ReceivedReaction): boolean;
  ```
- In each stretch, after the class's earnings are pushed: build the set of keys `act|quadrant|at|kind` of the
  earnings that carry `votes` (paid or charged, whatever the sign). For each line of `classInput.received` whose key is
  not in the set and that `floorOn` accepts (absent: all), push `tidy(settings.crowdFloor * r.votes)` where non-zero,
  as a contribution with no class, reason `crowd.floor`, and the line's `act`, `quadrant`, `at`, `kind` and `votes`.
  `settings.crowdFloor` 0 pushes nothing and builds no set.
- The floor lines are held apart from `own` (the slice the boost, the reveal perk and the cushion read) and pushed
  after those three passes, so none of them reads a floor line. The loop's `if (!cushionsOn.size) continue;` returns
  early today; restructure it so the floor's push is reached on every path.
- The header comment gains a bullet for the crowd floor, in the style of crowd pay's, citing the design.

**Tests first**, in `engine/rules/settle.test.ts`, with a test class that pays one quadrant and charges another:
- A whole vote in each of the four quadrants on the character's post: the paid and charged ones get no floor; the two
  others get 2 each, as `crowd.floor` with no class and the vote's Act, quadrant, time, kind and votes.
- One player's three reactions on one Act (a third of a vote each, one in a neutral quadrant): the floor is
  `tidy(2 / 3)`, never 2.
- The halving: the character's second Act, a neutral whole vote from the same player, pays 1.
- A moved vote: window one, a neutral vote pays 2; window two, the player adds a reaction in the paid quadrant, and
  the neutral line's negative half pays −1.
- `floorOn` returning false for posts: no floor on a post, the floor on a card.
- A class rule paid on a room's shape (an earning with no `votes`) does not shield the votes it read.
- `crowdFloor: 0`: no `crowd.floor` line anywhere.
- An earn boost up on the character in a neutral quadrant, the reveal perk current and a cushion up: none of them
  adds to or reads a floor line. A flat earn on a neutral quadrant pays on top of the floor.
- A staff post's and a System Act's reactions pay no floor.
- `estimateForOwner` shows the owner's floor for the open window.

## Task 3. The log and the database take the class-less reason

Model: sonnet

**Files:** `engine/ui/log/lines.ts` (`scoredAs`), its test, and the latest `apply_settlement` (read only, unless the
test below fails).

- `scoredAs` skips `crowd.floor`, as it skips a card's payout, so a character's floor lines do not unset the class its
  class lines name. While here, check whether `reveal.perk` lines already unset it (its prefix is no class's and is not
  skipped); if they do, skip `reveal` too and add the test (CLAUDE.md, "Tidying").
- Confirm `apply_settlement` writes a class-less ledger entry with a new reason, as it writes `reveal.perk`. If it
  checks reasons against a list, add `crowd.floor` in a migration.

**Tests first:** `scoredAs` of a Face's `face.cheered` line and a `crowd.floor` line is `face`. A SQL test (in the
settlement's existing test file) that a settlement carrying a `crowd.floor` entry adds it to the character's standing
and writes it to the ledger with no class.

## Task 4. Divided World: the Lurker, the words, the guide

Model: sonnet

**Files:** `instances/divided-world/classes/lurker.ts`, `instances/divided-world/classes/classes.test.ts`,
`instances/divided-world/ui/index.ts` (the reason words, beside `reveal.perk`) and its test,
`instances/divided-world/guide/strategy-guide.md` (Aura, after the crowd pay paragraph).

- The Lurker gains `floorOn: (r) => r.actKind === 'card'`, with a comment giving the design's reason (section 3: the
  floor on its posts would outpay the over-posting charge at any crowd).
- The reason words: `'crowd.floor': 'A crowd noticed: a reaction the character\'s class neither pays nor charges'`. Its
  negative line (a moved vote) has words of its own, as `card.boost`'s does: `'A crowd noticed: taken back, for a
  vote that moved to a quadrant the class pays or charges'`.
- The guide, after **Crowd pay**: "**The crowd floor.** Being reacted to helps too. A reaction your character's class
  neither pays nor charges still earns it {{setting:crowdFloor}} Aura a vote at the settlement, so there's no such
  thing as a wasted reaction. The Lurker is the exception: reactions to its posts earn it nothing, as ever." The
  owner approves these words in review.

**Tests first:** per class, a whole vote in each quadrant on the character's post through `settle` with Divided World's
instance: the floor lands on exactly the quadrants in the design's section 2 table (Face and Jabroni:
excited-negative and calm-positive; Heel and Technician: excited-positive and bored-negative; Tweener: hype and heat;
Lurker: none, on a post or a card). The words test: both lines' words, and that every settlement reason has words.

## Review focus

- Settled windows already on record: the floor applies from the first settlement after the merge; nothing re-settles
  an earlier window, and a moved vote whose first half settled with no floor must not take back a floor never paid
  (check what `received` hands a later window for a vote paid before the setting existed).
- A class whose per-vote earning omits `kind` or `at` would leave its weakness votes unshielded and pay them the floor:
  check every class's per-vote earnings carry all four key parts, and say so in `floorOn`'s or `ClassRules`' comment.
- Thick Skin's cushion and Evergreen's bonus each read votes the floor must not double: confirm with the Technician's
  Evergreen (two earnings on one vote, one key) and a cushioned weakness vote.
- The card economy's income moves about +12% (design, Open); the PR says so for the season review.
