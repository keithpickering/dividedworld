# Divided World's reaction set: plan

Record, written 2026-11-05. The plan for `docs/plans/2026-11-05-reaction-set-design.md`. One build session builds it in
one PR from `main`. #216 tracks retiring a used kind, which this plan does not build and does not close.

Every task is test first: name the test, record its red run, then write the code. No `check-*.mjs` is added. The SQL runs
against Postgres on localhost (`npm run test:sql`).

**One migration and one SQL test file**, each taking the next free number when it is written: `NNNN_seed_reaction_kinds.sql`
in `supabase/migrations/` (0082 at the time of writing) and `NNNN-seed-reaction-kinds.sql` in `supabase/tests/` (0084).

## The set, exactly

In this order, which is the picker's order within each quadrant. A kept kind keeps its place, and a new kind takes the
place of the kind it replaces (design, section 1).

| Quadrant | Key | Emoji | Code points | Replaces |
|---|---|---|---|---|
| excitedPositive | `fire` | 🔥 | U+1F525 | (kept) |
| excitedPositive | `heart` | ❤️ | U+2764 U+FE0F | (kept) |
| excitedPositive | `laughing` | 😂 | U+1F602 | `raised-hands` |
| excitedPositive | `hundred-points` | 💯 | U+1F4AF | `star-struck` |
| excitedNegative | `tomato` | 🍅 | U+1F345 | (kept) |
| excitedNegative | `vomiting` | 🤮 | U+1F92E | `nauseated` |
| excitedNegative | `cursing` | 🤬 | U+1F92C | (kept) |
| excitedNegative | `thumbs-down` | 👎 | U+1F44E | (kept) |
| calmPositive | `thumbs-up` | 👍 | U+1F44D | `relieved` |
| calmPositive | `folded-hands` | 🙏 | U+1F64F | `tea` |
| calmPositive | `salute` | 🫡 | U+1FAE1 | `handshake` |
| calmPositive | `light-bulb` | 💡 | U+1F4A1 | `meditating` |
| boredNegative | `facepalm` | 🤦 | U+1F926 | `zzz` |
| boredNegative | `eye-roll` | 🙄 | U+1F644 | (kept) |
| boredNegative | `crickets` | 🦗 | U+1F997 | `trash` |
| boredNegative | `yawn` | 🥱 | U+1F971 | (kept) |

🤦 is the bare person-facepalming code point, with no gender sign and no zero-width joiner. 🫡 has no variation selector.

**The old-key mapping.** Wherever a Divided World test or fixture names a removed key, it takes the key in that key's
place: `raised-hands` → `laughing`, `star-struck` → `hundred-points`, `nauseated` → `vomiting`, `relieved` → `thumbs-up`,
`tea` → `folded-hands`, `handshake` → `salute`, `meditating` → `light-bulb`, `zzz` → `facepalm`, `trash` → `crickets`.
Each maps within its own quadrant, so no test's quadrant arithmetic changes.

**Not touched: the engine's own fixtures.** `engine/ui/test-world.tsx` and `engine/rules/test-system.ts` define their own
neutral kinds (`tea`, `zzz` and others). Those are not Divided World's, and every `engine/**` test and story that uses
them stays as it is. That includes `readable('raised-hands')` in `engine/ui/reactions/Reactions.test.tsx`, which tests a
string function.

## Task 1. The set (instance)

Model: inline

**Files:** `instances/divided-world/reactions.ts`; `instances/divided-world/reactions.test.ts` (new).

**Tests first,** in `reactions.test.ts` (Node's test runner, as `settings.test.ts` is; `npm run test:engine` picks it up
through `instances/**/*.test.ts`):
- **The set is exactly the table above.** Assert `reactions.map((r) => [r.key, r.emoji, r.quadrant])` deep-equals the
  16 rows, with each emoji written as its code points (`'\u{1F602}'`) so an editor cannot swap a look-alike.
- **Four per quadrant.**
- **No emoji repeats.**

Red against main: the first two fail. The header comment becomes: the set and why each was chosen are
`docs/plans/2026-11-05-reaction-set-design.md`, and the order within a quadrant is the picker's.

## Task 2. Old keys in Divided World's tests and fixtures

Model: haiku

Apply the old-key mapping above to these lines, and to no others:
- `instances/divided-world/classes/classes.test.ts`: `zzz`, `tea`, `relieved` (lines 216 to 600).
- `supabase/functions/settle/core.test.ts:24-25`: `tea`, `nauseated`.
- `supabase/tests/e2e/0001-settlement.ts:53,140`: `nauseated`.
- `supabase/tests/e2e/0005-estimate.ts:75`: `zzz`.
- `web/src/data/supabase.test.tsx:654,1618,1624`: `zzz`, `tea`. These are opaque strings in a mocked API, renamed so the
  file names Divided World's set.
- `web/src/data/fixtures/boards.ts:272-289`: `tea`, `nauseated`, `handshake`. The comment's "the rival's own Tea" becomes
  "the rival's own Folded hands".
- `web/src/data/fixtures/boards.test.ts:274-286`: `tea` becomes `folded-hands`, and the test names' "the Tea" become
  "the Folded hands".
- `engine/ui/reactions/Picker.board.stories.tsx:10`: comment only, "the rival's own Tea" becomes "the rival's own Folded
  hands". (The story reads the boards fixture, which is Divided World's.)
- `web/src/demo.ts:29,32`. This is the one exception to the mapping. The title becomes `'Who keeps reacting with a thumbs
  up?'`, the body becomes `'Every post I make, a single [b]👍[/b]. Show yourself.'`, and the kind becomes `'thumbs-up'`.

**Tests:** none new. This task is what turns Task 1's change green. Run `npm run test:engine` and `npm run test:ui`, and
record that both pass. Then `grep -rnE "'(raised-hands|star-struck|nauseated|relieved|tea|handshake|meditating|zzz|trash)'"`
over `instances web supabase` finds nothing.

## Task 3. The React board's manifest

Model: sonnet

**Files:** `e2e/boards/03-react.ts`.

The board (`docs/research/2026-10-29-two-worlds/03-react.html`) is a record and stays as drawn. The manifest names, slot
by slot, the build's kind in each board kind's place, as it already does for 😡 → 🤢 (#161).
- **`KINDS`:** the third element becomes `Vomiting` for `Angry`, `Laughing` for `Raised hands`, `Hundred points` for
  `Star-struck`, `Facepalm` for `Zzz`, `Crickets` for `Trash`, `Thumbs up` for `Relieved`, `Salute` for `Handshake` and
  `Light bulb` for `Meditating`. Kept kinds have no third element.
- **`kind-tea`:** `buildName` becomes `'Folded hands, Calm, your reaction'`. The `id` and the board's `name` stay.
- **The header comment:**
  - Its examples name the new keys: "the rival's own Tea is 'Folded hands, Calm, your reaction'", and "'hundred-points' is
    'Hundred points'".
  - The "fixture's handshake" chip becomes the "fixture's salute".
  - The `KINDS` comment says the instance's set since 2026-11-05 (the design) stands in the board's places.

**Test:** the 03-react board in `e2e/boards.spec.ts`, run as `npm run test:e2e` runs it. Record it red after Tasks 1 and 2
and before this task: the buttons' names differ. Then record it green.

## Task 4. The polite-shrugs hint

Model: inline

**Files:** `instances/divided-world/ui/hint-words.ts:20-21`. In both details, `a nod, a cup of tea.` becomes
`a thumbs up, a thank-you.` Nothing else in either string changes. No test names this string. The glass-text check
(`e2e/glass-text.spec.ts`) runs over it in the final build.

## Task 5. Partial seeds name no reactions

Model: haiku

This task comes before Task 6. On main's `seed_instance`, a payload with no `reactions` key writes nothing for reactions,
exactly as `'[]'` does, so the suite stays green. Task 6 then gives the key its new meaning without breaking it.

- **Delete `'reactions', '[]'::jsonb, ` from every `seed_instance` payload that has it:**
  - `supabase/tests/0012-cards.sql` (1), `0020-system-board.sql` (5), `0023-cards-screens.sql` (2),
    `0025-profiles.sql` (1), `0044-card-economy.sql` (1), `0048-staff.sql` (1), `0051-moves.sql` (1),
    `0052-meeting.sql` (2), `0053-tick.sql` (1), `0054-admin-queue.sql` (1), `0055-screens.sql` (1),
    `0056-succession.sql` (1), `0058-progress-scale.sql` (1), `0067-updates.sql` (7), `0068-season-news.sql` (1) and
    `0081-origin-place.sql` (1).
  - `supabase/tests/e2e/0003-export.ts:161` (1).
  - The counts are from `grep -c "'reactions', '\[\]'::jsonb"`, and after this task that grep finds nothing.
- **`supabase/tests/0009-schedule.sql`:** its payload's `reactions` lists the fixture's five kinds (from
  `supabase/tests/setup/fixtures.sql:39-41`, with the same keys, emoji and quadrants) and then `zap`. Its later
  assertions react with `boo`, which Task 6 would otherwise delete.
- **`supabase/tests/e2e/0003-export.ts:94-95`:** `'up'` becomes `'fire'`. The e2e files share one scratch database, and
  `e2e/0001` seeds Divided World's whole set first, which from Task 6 deletes the fixture's unused kinds.

**Test:** `npm run test:sql` passes, recorded.

## Task 6. Seeding treats the list as the whole set (migration)

Model: sonnet

**Files:** the migration and SQL test named above; `supabase/functions/_shared/seed.ts` (header comment only).

**The migration** opens with a header that says what changed and cites the design, section 3. It is
`create or replace function seed_instance(payload jsonb)`, copied whole from `supabase/migrations/0062_updates.sql`
(the latest definition), with one change. The single `insert into reaction_kinds … on conflict` statement becomes:

1. **When `payload ? 'reactions'`:**
   - **The used kinds the list drops.** Every `reaction_kinds` key that the list does not name, and that has a row in
     `reactions` or in `reaction_tallies`, is collected as `key (N reactions)`, ordered by key, where N counts its
     `reactions` rows.
   - **If there are any, the seed is refused,** with
     `raise exception 'the instance no longer lists reaction kinds that reactions use: %; a used kind is never removed (#216)', <the list> using errcode = '22023'`.
   - **Otherwise, the unused kinds the list drops are deleted.**
2. **The insert and its `on conflict`**, as 0062 wrote them. They run after step 1, so an emoji freed by a deleted kind
   can be taken by a new key.

The function keeps `security definer set search_path = public, pg_temp`. Its grants carry over: `create or replace`
keeps 0004's execute grant to `service_role` alone. The comment inside the function says why reaction kinds are the one
vocabulary removed (design, section 3).

**Tests first,** in the new SQL test file. Each sets up its own reactions with `tests.account`, `tests.character`,
`tests.thread` and `tests.post` (`supabase/tests/setup/fixtures.sql`). Refusals are caught with a `pg_temp.refusal`
helper, as in `0020-system-board.sql`. The fixture's kinds are `up`, `boo`, `calm`, `meh` and `wow`.
- **A dropped kind that nothing uses is deleted.** Seed `reactions` = `up`, `boo`, `calm`, `meh` and a new `zing`: `wow`
  is gone, the four and `zing` are present, and a second identical seed returns the same answer.
- **A dropped kind that a reaction uses stops the seed.** React with `wow` on a post (a `reactions` row and its
  `reaction_tallies` row), then seed a list without `wow` that adds `zing`. The refusal names `wow (1 reactions)` and
  `#216`. Afterwards `zing` is absent and `wow` is present, so nothing was written.
- **A tally alone counts as used.** A `reaction_tallies` row for `calm` with count 0 and no `reactions` row, then a seed
  without `calm`, is refused, naming `calm (0 reactions)`.
- **An emoji can move to a new key.** Seed a list in which `meh`'s 😑 is now `flat`, and `meh` is not named. `flat` holds
  😑, and `meh` is gone.
- **A payload with no `reactions` key leaves every kind,** including one no reaction uses.

**Poisons,** each run once and recorded red:
- The delete moved after the insert: "an emoji can move" fails on `reaction_kinds_emoji_key`.
- "Used" read from `reactions` alone: "a tally alone" passes the seed.
- `coalesce(payload -> 'reactions', '[]')` in place of the `?` test: "no key leaves every kind" deletes them.

Red against main, before the migration: the first four tests fail. The last passes on main, and the plan expects that.

**`seed.ts`:** its header comment says the reactions list is the instance's whole set, and that seeding deletes a kind the
instance dropped, or refuses when one is in use (the new migration).

## Last. The full build and the final review

`npm run typecheck` and `npm run build:ci`, with their output. Then a screenshot of the React picker
(`engine/ui/reactions/Picker.board.stories.tsx`, the 03-react moment) at deviceScaleFactor 2, for the owner's word on
the set as drawn.

## Ways out of the states this adds

- **A refused seed** is the only state added, and it is an operator's, not a player's. The way out is to put the kind
  back in the instance's list and seed again, or to use #216's retirement once that is designed. The error says both by
  naming the kind and #216.
- No state is added that a player, a character or a post can be put in.

## The masks

- `seed_instance` is executable by `service_role` alone (0004). Its refusal reads per-kind reaction counts, which
  `reaction_tallies` already shows to every player. It never reads `reactor_account` or `reactor_character`.
- No page, payload, Realtime event or timing is added.

## Review focus

- **The seed against a database that already holds reactions** (the shared e2e scratch database after `e2e/0001`, and any
  future instance). No path deletes a kind that a `reactions` or `reaction_tallies` row references. A refusal writes
  nothing, including the settings and cards earlier in the same seed.
- **Every remaining `seed_instance` caller sends the whole list or no `reactions` key.** A partial payload left with
  `'[]'` would delete every unused kind.
- **The picker and the guide's markers** (`engine/ui/reactions/Picker.tsx`, `engine/ui/guide/markers.tsx`) at four per
  quadrant: unchanged layout, and each new key reads well through `readable()`.
- **🫡 and 🦗 on a system font without them** draw as an empty box. The design accepted this; the screenshot shows how it
  looks.
