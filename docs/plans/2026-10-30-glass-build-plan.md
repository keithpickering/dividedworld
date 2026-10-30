# The glass, built: the build plan in parts

Record, written 2026-10-30. The order in which the glass is built onto main as PR #24 left it, one build session and
one PR per part. The specification stays where it is written: `docs/plans/2026-10-30-glass-to-the-boards-plan.md`
(the glass plan below: the board match, the fixture, the tokens, the shapes, the smoke's recipes and each board), the
glass amendments of `docs/plans/2026-10-29-screens-web-plan.md` and `docs/plans/2026-10-29-screens-cards-plan.md`, and
`docs/plans/2026-10-29-two-worlds-plan.md` for the one migration. Those plans were written before PR #24 merged, and
section 1 below is every place main differs from what they assumed; where they differ, this plan wins. Each part is
carried out by a build session (`.claude/skills/build-session/SKILL.md`), task by task, tests first, each red run
recorded, and the owner merges each PR.

## 1. What main is, against what the plans assumed

| The plans say | Main has, and this plan uses |
|---|---|
| The fake backend at `web/src/data/fake.ts` | `engine/ui/data/fake.ts` (`createFake`, and `Seed` for seeding); `web/src/data/backend.ts` loads it only in the e2e build |
| The fixture `web/src/data/fixtures/boards.ts` seeding the fake | The same path, seeding only through `fake.seed` (`Seed` in `engine/ui/data/fake.ts`); a part of the fixture `Seed` cannot express gets a new seed method, with a test in `engine/ui/data/fake.test.ts`, never a write into the fake's state from outside |
| A build in `--mode fake` | The existing `--mode e2e` build, which `playwright.config.ts` already serves; `backend.ts` reads `?fixture=boards&moment=<name>` in that branch only, and seeds the fixture in place of `seedDemo` when it is named |
| The e2e suite under `web/e2e/` | The root `e2e/` (`playwright.config.ts`'s `testDir`): `e2e/board-match.ts`, `e2e/board-match.test.ts`, `e2e/boards.spec.ts`, `e2e/boards/<NN>-<name>.ts`, `e2e/glass-text.spec.ts`; the report at `e2e/report/boards/`, gitignored, and uploaded by `.github/workflows/web.yml` |
| The self-test run by `npm run test:ui` under `web/**/*.test.ts` | `vitest.config.ts`'s include gains `e2e/**/*.test.ts`, and `playwright.config.ts` gains `testMatch: '**/*.spec.ts'`, so neither runner picks up the other's files |
| The production bundle asserted free of `KAYFA_FAKE_BACKEND` in web Task 0 | A new guard pair, `tools/check-web-bundle.mjs` and `tools/test-web-bundle.mjs`, in `STEPS` after `npm run build:web`; the marker string is a constant in `engine/ui/data/fake.ts` and in the fixture |
| Migration `0030_glass_preferences.sql`, test `0033-glass-preferences.sql` | `0033_glass_preferences.sql` and `0039-glass-preferences.sql`: main holds migrations to `0032_reveal_index.sql` and tests to `0038-standings-season.sql` |
| Rankings from `season_standings` | `KayfaApi.standingsPage` and `KayfaApi.classReveals`, the reads the standings screen already uses (`engine/ui/standings/`) |
| "No React on the player's own posts" (glass plan, web Task 6) | Built by #24; the React board's manifest only checks it |
| The banner's Sign out removed | Sign out stays on the account screens (`engine/ui/account/OpenAccount.tsx`, settings) and leaves the banner (`engine/ui/frame/Frame.tsx`) |
| Web Task 8 (the log, Settlement) and cards Task 6 (the log's card lines) built in turn | Both wait on issue #25's design of the log, which the owner has not yet made; boards 09 and 12 are pending until then (Part 4) |

The fonts are fetched once by the builder from the google/fonts repository on GitHub (Anton and Barlow Condensed,
SIL Open Font License), cut to the weights `glass.json` names, and committed with `OFL.txt` under
`instances/divided-world/ui/fonts/`. Nothing fetches them at build time.

## 2. The parts, and their order

| Part | What | Starts | Its PR is done when |
|---|---|---|---|
| A | The two-worlds migration (`docs/plans/2026-10-29-two-worlds-plan.md`, renumbered) | now | `npm run test:sql` and `build:ci` green |
| 1 | The board match, the glass's foundation, the frame; boards 01, 02 and 04 | now, beside A | boards 01, 02 and 04 green in `e2e/boards.spec.ts` |
| 2 | The glass pages: the picker, characters and the Turn, Rankings, the account and settings, the rendered measurement | after 1 and A merge | boards 03, 06, 10, 11 and Rankings' green; `e2e/glass-text.spec.ts` green |
| 3 | The cards plan's Tasks 1 to 5, in the glass | after 2 merges | boards 05, 07 and 08 green, and the hand and armed card in 01 and 02 |
| 4 | Web Task 8 and cards Task 6 | after issue #25's design is merged | boards 09 and 12 green |

Part A touches only `supabase/`, and Part 1 touches no file under it, so the two run at once. Part 2's settings
(board 11) need A's columns. Parts 1 to 3 are each one session because each one's tasks share the fixture and the
board match and would conflict with one another split across branches.

## 3. Part A: the glass preferences

`docs/plans/2026-10-29-two-worlds-plan.md`, Task 1, as written, with the migration
`supabase/migrations/0033_glass_preferences.sql` and the test `supabase/tests/0039-glass-preferences.sql`. Nothing
else in that plan changes. The build session reads `supabase/migrations/0019_profiles.sql` for the table, the policy
and the grants it extends, and checks that `supabase/tests/0005-default-deny.sql` and `supabase/tests/e2e/0003-export.ts`
are the files the plan names before editing them. The engine's `KayfaApi.setPreferences` is not changed here: Part 2
adds the three fields to it.

## 4. Part 1: the board match, the glass's foundation, and the frame

### Task 1.1. The board match and the bundle guard

- `vitest.config.ts` and `playwright.config.ts` as section 1 says, and `.gitignore` gains `e2e/report/`.
- `e2e/board-match.ts`: `compareBoard`, the snapshot and manifest types, as the glass plan's section 2.3 specifies.
  **Tests first,** `e2e/board-match.test.ts`, red before the comparator exists, with section 2.3's seven poisons.
- `e2e/boards.spec.ts`, as section 2.4 specifies, with one change: the spec's board list is the folder's list
  (`docs/research/2026-10-29-two-worlds/`), and a board with no manifest fails by name unless it is in the spec's
  `PENDING` map, which names each board not yet built and the part that builds it (in Part 1: 03 and 05 to 12; Part 4
  removes the last). A board in `PENDING` that has a manifest also fails, so the map cannot go
  stale. Both are asserted in `e2e/board-match.test.ts` against a list function the spec imports
  (`boardsToRun(folder, manifests, pending)`), red first.
- `.github/workflows/web.yml` uploads `e2e/report/boards/` as an artifact, on failure and on success.
- `tools/check-web-bundle.mjs` and `tools/test-web-bundle.mjs`, into `STEPS` after `npm run build:web`. The check reads
  every file the production build wrote to `web/dist/` and fails naming the file that carries `KAYFA_FAKE_BACKEND`.
  **Tests first:** the test builds nothing; it runs the check over a scratch folder. **Poisons:** a chunk holding the
  marker; the marker split across a chunk boundary is not a case (the check reads whole files); an empty `web/dist/`
  fails as "nothing built", so the check cannot pass on a build that never ran. Then, once, by hand and recorded in the
  PR: the real build red after importing `createFake` from `web/src/main.tsx`, and green when it is removed.

### Task 1.2. The fixture and its moments

- `web/src/data/fixtures/boards.ts`, as the glass plan's section 2.1 and section 3 specify, exporting
  `seedBoards(fake, moment)` and the moment names. A moment sets the fake's clock (`createFake`'s `now` option and
  `clock.advance`), the signed-in account (`signInAs`) and the route.
- `web/src/data/backend.ts` as section 1 says. An unknown moment name throws with the list of names, and the error
  shows on the app's error screen, never as a blank page.
- **Tests first,** `web/src/data/fixtures/boards.test.ts`: each moment loads; Pipewrench's wallet, hand and rank at
  each moment are the timeline's; the reader owns none of the Hold board's characters; the rival's Tea on #42 is the
  rival's own row. A test that changes the fixture's data for its own case copies the fixture and never edits it (the
  glass plan's review focus).

### Task 1.3. The glass's tokens, shapes, smoke, calm and fonts

The web plan's glass amendment to Task 1, with the glass plan's sections 4 (the closed token list), 5 (the shapes) and
6 (the smoke as a recipe per surface, `GlassSurface`, `calmAll`):

- `engine/ui/glass/tokens.css`, `engine/ui/glass/base.css`, `engine/ui/glass/calm.css`, `engine/ui/glass/Smoke.tsx`,
  `engine/ui/glass/types.ts` (`GlassTheme`, `GlassSurface`), exported from `engine/ui/index.ts`.
- `InstanceUi.glass: GlassTheme` in `engine/ui/types.ts`; `instances/divided-world/ui/glass.json` and the fonts, read
  into `instances/divided-world/ui/index.ts`. `instances/divided-world/ui/index.test.tsx` asserts the glass is
  present and every font file it names exists.
- `tools/check-ui-tokens.mjs` reads `engine/ui/glass/` as it reads the rest of `engine/ui/`.
- `tools/check-glass-contrast.mjs` and `tools/test-glass-contrast.mjs`, into `STEPS`, with the web plan's seven
  poisons and the glass plan's section 6 recipe poisons, red first. The ceilings it computes are written to a file
  under `e2e/` that Part 2's rendered measurement reads, and the guard fails if that file is stale against
  `glass.json`.
- **Tests first,** `engine/ui/glass/Smoke.test.tsx`: no smoke element under `off`; a third of each layer's opacity
  under `low`; still under reduced motion; the ground opaque before the smoke draws.

### Task 1.4. The frame: the menu bar, the page shell, the overlay, the HUD and the orbs

The web plan's glass amendment to Task 3, with its 2026-10-30 amendment, and the glass plan's section 8 (the HUD and
the menu bar between the boards' widths, the phone's menu bar):

- `engine/ui/glass/MenuBar.tsx`, `engine/ui/glass/Page.tsx` (the page shell: menu bar, smoke and content column),
  `engine/ui/glass/Overlay.tsx`, built on the focus holding and Esc of `engine/ui/modal.tsx` rather than beside it,
  so the board's dialogs and the glass's overlays keep one way out.
- `engine/ui/frame/Frame.tsx`: the banner holds the board's own navigation and sign-in when signed out, and no Sign
  out; on a phone its menu button reads Boards. Its tests in `engine/ui/frame/` change with it.
- `engine/ui/frame/Hud.tsx`: glass, docked at the bottom with the seam, with Menu beside the hand; the orbs
  (`engine/ui/orbs/`) in the glass's look.
- The routes in `web/src/App.tsx` that become glass pages are wrapped in `Page` here with their content unchanged:
  `/characters`, `/characters/new`, `/characters/edit`, `/invites`, `/settings`, `/sign-in`, `/register`. Rankings
  and the log get their routes in Parts 2 and 4; until then their menu bar entries link to the standings and are
  marked in the PR as standing in.
- Going back: Back and Esc restore the board's route and the post in view, as the amendment says.
- **Tests first:** the amendment's, in `engine/ui/frame/` and `engine/ui/glass/`, and a Playwright case in
  `e2e/focus.spec.ts` for Back and Esc returning to the same post.

### Task 1.5. Boards 01, 02 and 04

`e2e/boards/01-main.ts`, `e2e/boards/02-phone.ts`, `e2e/boards/04-orbs.ts` and the orbs' story
(`engine/ui/orbs/Orbs.board.stories.tsx`), as the glass plan's section 7 lists their landmarks, each taken out of
`PENDING`. The hand and the armed card in 01 and 02 are cards Task 2's and 3's: they are left out of these manifests
here, with a comment naming Part 3, and Part 3 adds them.

## 5. Part 2: the glass pages

### Task 2.1. The React picker (board 03)

The web plan's glass amendment to Task 6: the picker as a glass overlay through `Overlay`, the chips on a post staying
the board's. Its story `engine/ui/reactions/Picker.board.stories.tsx` and `e2e/boards/03-react.ts`.

### Task 2.2. My characters, New character, the Turn modal and the profile editor (boards 06 and 10)

The web plan's glass amendments to Task 9: `engine/ui/characters/` (with `TurnDialog.tsx` through `Overlay`) and
`engine/ui/profile-edit/` as glass, the class in its own color to its own player only, and the Turn modal from My
characters leaving the menu bar dimmed and inert. `e2e/boards/06-turn.ts` and `e2e/boards/10-roster.ts`.

### Task 2.3. Rankings (board 13)

A story first: `engine/ui/rankings/Rankings.board.stories.tsx`, shown to the owner on the PR before the screen is
wired, as the glass plan's section 8 says, because no board draws Rankings. Then `engine/ui/rankings/` and the route
`/rankings`, reading `standingsPage` and `classReveals` (section 1), with the web plan's Task 10 amendment's tests, and
the menu bar's entry pointed at it. Once the owner approves the story, the board is drawn from it as
`docs/research/2026-10-29-two-worlds/13-rankings.html` and compared by `e2e/boards/13-rankings.ts` like the others,
as the glass plan's section 8 says.

### Task 2.4. The account screens and settings (board 11)

The web plan's glass amendment to Task 11, after Part A merges: `KayfaApi.setPreferences` and its Supabase and fake
adapters gain `smoke`, `contrast` and `textSize`, the settings screen shows them, and high contrast and text size take
effect. `e2e/boards/11-settings.ts`.

### Task 2.5. The rendered measurement and axe over the boards' stories

The web plan's glass amendment to Task 12, at `e2e/glass-text.spec.ts`, reading the ceilings Task 1.3 wrote, with its
five poisons and the glass plan's section 6 per-recipe ceilings and `calmAll`. The axe case in `e2e/a11y.spec.ts`
runs over every `*.board.stories.tsx` story too.

## 6. Part 3: the cards

`docs/plans/2026-10-29-screens-cards-plan.md`, Tasks 1 to 5, with both its amendments: `engine/ui/cards/`, the
Vending Machine as a glass page under the menu bar (its route and menu bar entry), the hand drawer and the play form
through `Overlay`, Stick Around and Whoops! drawing the `effect` recipe. The manifests `e2e/boards/05-cards.ts`,
`07-vending.ts` and `08-hold.ts`, the hand's sheet story, and the hand and the armed card added to 01 and 02. Task 6
is Part 4's.

## 7. Part 4: the log

Waits on issue #25, whose design settles what the log is. Its plan then carries the web plan's Task 8 with its glass
amendment (the log, `engine/ui/log/Settlement.tsx`) and the cards plan's Task 6, and empties the board match's
`PENDING` map with boards 09 and 12.

## The layers

Engine: everything under `engine/ui/glass/`, the frame, the screens, `GlassTheme`, the guards, the board match, the
fixture's seed methods in `engine/ui/data/fake.ts`. Instance: `instances/divided-world/ui/glass.json` and the fonts,
reaching the engine through `InstanceUi.glass`. The fixture (`web/src/data/fixtures/boards.ts`) is the composition
root's, beside `web/src/demo.ts`, because it names Divided World's characters and classes; the engine's tests never
import it. The board match's manifests are Divided World's boards and live in the root `e2e/`, which already tests the
composed app.

## Ways out of the states this adds

This plan adds no state of its own. Each part's states are its source plan's, with the ways out those plans give, and
the one new to this plan's order is the menu bar's Rankings entry standing in for the standings until Part 2, which is
a link that works.

## What could vary with a private fact, and how it does not

As the glass plan's section of that name, with one addition: the fixture's moment parameter is read only in the
`--mode e2e` build's branch of `backend.ts`, and `tools/check-web-bundle.mjs` fails a production build that carries
the fake or the fixture.

## Review focus

- The `PENDING` map: a board left pending by a part that should have built it, or taken out with a manifest that
  compares nothing.
- The fixture's new seed methods: each adds a way for test data into the fake, and none should be reachable from the
  Supabase adapter or a production build.
- The glass pages wrapped in Part 1 with unchanged content: whether a screen built for the 2003 board reads at the
  glass's sizes and contrast before Part 2 restyles it, and whether Part 1's measurement is the board match alone.
- Part A's migration landing before Part 2: an export made under 0032 importing after 0033.
- The fonts as committed: the weights cut, the license beside them, and no build-time fetch.
