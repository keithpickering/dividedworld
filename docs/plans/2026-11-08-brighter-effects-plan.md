# Brighter effects: plan

Record, written 2026-11-08. Carries out `docs/plans/2026-11-08-brighter-effects-design.md`. Every task goes test first:
write the failing test, show its red run, then write the code. During a task, run only the tests for the changed code
(`npm run test:sql` with the one file, or `npx vitest run <file>`). Run `npm run build` once after the last task. Tasks
1 to 4 are engine; task 5 is Divided World's; task 6 is both.

## Task 1. The preference, stored and read

Model: sonnet.

Files: a new `supabase/migrations/0145_brighter_effects.sql` (the next free number; take the next one if a merge has used
it), a new `supabase/tests/0147-brighter-effects.sql` (the same rule), `supabase/tests/0039-glass-preferences.sql`,
`supabase/tests/e2e/0003-export.ts`, `engine/ui/data/api.ts`, `engine/ui/data/fake.ts`, `web/src/data/supabase.ts`.

- The migration follows `0098_tilt_preference.sql`'s shape, and its header says so and names the design:
  - `alter table account_preferences add column effects text not null default 'standard' check (effects in
    ('standard', 'bright'))`.
  - `preferences_answer` made again from 0115's body with `'effects', kept.effects` after `tilt`.
  - `set_preferences` dropped and made again from 0118's body with `effects text default null` after `tilt`, refused
    with `'effects are standard or bright'` (hint `kayfabb.refusal`, errcode `22023`), inserted with
    `coalesce(effects, 'standard')`, updated with `coalesce(set_preferences.effects, p.effects)`; the grants restated
    for the new signature.
  - `boot()` replaced in place from 0143's body with `a.effects` after `a.tilt`; grants restated as 0143 states them.
- SQL test, red first: a new account reads `effects: standard`; `set_preferences(effects => 'bright')` answers and
  stores `bright` and leaves every other choice as it was; `'loud'` is refused with the message; another account cannot
  read the row; `boot()` carries it. `0039-glass-preferences.sql`'s expected answers gain `"effects": "standard"`.
- `0003-export.ts`: the inserted row sets `effects` to `'bright'`, so the round trip proves the column travels.
- `api.ts`: `Preferences.effects: 'standard' | 'bright'`, `DEFAULT_PREFERENCES.effects = 'standard'` (it is in
  `PreferencesPatch` by the type). `fake.ts` refuses anything else with the SQL's words, as it does `tilt`.
  `supabase.ts`: read `effects` where `tilt` is read (both the row read and the select list near line 1730) and send it
  where `tilt` is sent.

## Task 2. The row and the mark on the root

Model: sonnet.

Files: `engine/ui/account/appearanceRows.tsx`, `engine/ui/account/Settings.tsx`, `engine/ui/welcome/Welcome.tsx`,
`engine/ui/appearance.ts`, and their tests (`engine/ui/account/Settings.test.tsx`, `engine/ui/welcome/Welcome.test.tsx`,
`engine/ui/appearance.test.tsx`).

- `appearanceRows.tsx`: `EFFECTS: Option<Preferences['effects']>[] = [{ value: 'standard', label: 'Off' }, { value:
  'bright', label: 'On' }]` and `EffectsRow({ value, onChange, level })`, a `Choice` with the legend `Brighter effects`
  and the sentence `Let card effects on posts use their full colors, even below the usual contrast standard. Some posts
  may be harder to read.` Exactly these strings; the owner approved them.
- `Settings.tsx`: `<EffectsRow>` after `<TextSizeRow>` in Accessibility, saving `{ effects }`. `Welcome.tsx`: after
  its `<TextSizeRow level={4}>`, with `level={4}`.
- `appearance.ts`: `AppearancePreference.effects?: 'standard' | 'bright'`; `applyAppearance` marks
  `data-kb-effects="bright"` on the root when bright and removes it otherwise, as it does `data-kb-contrast`. Follow
  where `contrast` is carried from the account's preferences to `applyAppearance` and carry `effects` the same way.
- Tests, red first: each screen draws the row with the copy and saves the choice; the mark is on the root only while
  the account's choice is bright, and goes when the account signs out.

## Task 3. A bright band

Model: sonnet.

Files: `engine/ui/shine/band.ts`, `engine/ui/shine/band.test.ts`, `engine/ui/shine/foil.ts`,
`engine/ui/shine/foil.test.ts`, and each caller that reads a board from a band's bounds.

- `Band` becomes `{ lo, hi, board: 'light' | 'dark', bright: boolean }`. `bandOf(tokens)` sets `board` from which
  branch it takes, and `bright: false`. A new `brightBand(board)` returns `{ lo: 0, hi: 1, board, bright: true }`.
- `bandFor(el)` reads `data-kb-effects` on `document.documentElement`: when `bright`, it returns
  `brightBand(bandOf(...).board)`; the cache key gains the mark. Its doc comment names the design.
- `clampInto(c, band)` returns `c` untouched when `band.bright`.
- Every test of the board by bounds becomes a read of `band.board`: `foil.ts` (`dark: band.hi < 0.5` near line 322;
  the starbursts' `band.hi < 1` near line 474 stays, since a bright band reaches 1 and the stars then show on both
  boards), and `flakes.ts`'s `band.lo === 0` and `band.hi >= 1` (task 4 owns those).
- Tests, red first: a bright band is 0 to 1 and keeps its board; `bandFor` follows the mark and the cache does not hand
  a standard band to a bright page or the other way; `clampInto` leaves a bright band's color alone; the foil at each
  grade under a bright band on the dark board draws colors past 0.048, and on the light board colors under 0.59. The
  readable-band check over the foil still runs and passes for every standard band; its self-test (a palette and a clamp
  that let a bright stripe through) still drives it red.

## Task 4. Glitter in full color

Model: sonnet.

Files: `engine/ui/shine/flakes.ts`, `engine/ui/shine/flakes.test.ts`, `engine/ui/shine/flakes.glint.test.ts`.

- Each place that reads the board from the band reads `band.board` (`flakeColour`, `drawFlares`, `drawLit`'s flare test,
  `drawBurst`, the puff, `sampleCling`'s inks, near lines 354, 448, 526, 728, 762, 788 and 1139).
- Under a bright band: a flake's color is its ink at `BRIGHT_FLOOR.dark = 0.5` (dark board) or `BRIGHT_FLOOR.light =
  0.85` (light board, mixed toward white by the rest) when unlit, rising to its full ink when lit, never clamped. Name
  the two floors as exported constants beside `DARK_FLOOR`. A flake lit past `GLINT_MIN` glints on both boards, with
  `glintOf` as today, and under reduced motion as well. Burst, puff, loose glitter and cling take the same free colors.
- `glintsAreFew` and `sampleFlakes` stay as they are for standard bands; the glint test asserts they are not applied to
  bright ones.
- Tests, red first: under a bright band an unlit dark-board flake is its ink at 0.5 and an unlit light-board one at
  0.85; a lit flake is past the standard band; a flake past `GLINT_MIN` glints on the light board, and under reduced
  motion on either; every assertion `flakes.glint.test.ts` makes today about standard bands still holds.

## Task 5. Divided World's bright looks

Model: sonnet.

Files: `instances/divided-world/ui/feelin-fab/Effect.tsx`, `instances/divided-world/ui/feelin-fab/fab.css`,
`instances/divided-world/ui/feelin-fab/Effect.test.tsx`, `instances/divided-world/ui/glitter-bomb/Effect.tsx`,
`instances/divided-world/ui/glitter-bomb/glitter.css`, `instances/divided-world/ui/glitter-bomb/Effect.test.tsx`,
`engine/ui/cards/body.ts`, `engine/ui/thread/thread.css`, `engine/ui/tokens.css`.

- Engine, the bright ink: `body.ts` gains `markBrightInk(body: HTMLElement | null, on: boolean)`, which sets or removes
  `data-kb-bright-ink` on the body. `tokens.css` keeps the board's inks on the root as `--kb-board-fg`,
  `--kb-board-link`, `--kb-board-link-visited` and `--kb-board-muted` (each `var()` of its token, resolved on the root).
  `thread.css`: on `.kb-act-main[data-kb-bright-ink]`, the four post inks are `var(--kb-bright-ink)`, a quote's border is
  that color, and the text shadow is the outline in `var(--kb-bright-outline)` (`-1px -1px 0`, `1px -1px 0`, `-1px 1px
  0`, `1px 1px 0`, `0 0 3px`). Anything inside with its own ground (`.kb-tally`, the ORIGIN box, `[data-kb-over-ink]`)
  takes the four inks back from the `--kb-board-*` copies and drops the shadow. Comment it with the design's section 1.
- Feelin' Fab: `FAB_BRIGHT = ['#ff1f2d', '#ff8a00', '#ffe600', '#19d43c', '#1a8cff', '#9a2bff']` beside `FAB_STOPS`;
  the palette key is `band.bright ? 'bright' : band.board` (in `post` and in `paint`, replacing `band.hi < 0.5`), and
  the foil's spec takes that palette. When the band is bright and the post paints its body, the effect calls
  `markBrightInk(body, true)`, and false when it is not, on unmount, and when the band turns standard. `fab.css` sets
  `--kb-bright-ink: #ffffff` and `--kb-bright-outline: #000000` on `.dw-fab`, and on its host's words where it paints only
  the host (not a body) applies the same ink and outline itself. The read of the band again on a root change watches
  `data-kb-effects` beside `data-kb-mode`.
- Glitter Bomb: watches `data-kb-effects` beside `data-kb-mode` likewise. `glitter.css`: under
  `:root[data-kb-effects="bright"]`, `.dw-glitter-words` takes the firmer halo (`0 0 1px`, `0 0 2px`, `0 0 3px`, `0 0
  6px`, `0 0 10px`, each in `var(--kb-bg)`).
- Tests, red first: with the mark on the root, Feelin' Fab's foil is drawn from `FAB_BRIGHT` on both boards and its body
  carries `data-kb-bright-ink`; with it off, from `FAB_STOPS` as today and no mark; the mark goes when the post
  unmounts and when the setting turns off while mounted. Glitter Bomb draws with a bright band when marked and redraws
  when the mark changes. Whoops! is untouched: its tests pass unchanged.

## Task 6. Records and the bench

Model: inline.

Files: `docs/plans/2026-11-06-shine-design.md`.

- Under section 5's amendment, add one paragraph: "**Amended 2026-11-08: Brighter effects** (the owner,
  `docs/plans/2026-11-08-brighter-effects-design.md`). A reader who turns on Brighter effects sees Feelin' Fab and
  Glitter Bomb drawn free of the band; for everyone else, everything above holds."
- Run `npm run build` and show it green.

## Review focus

- A cached band or foil from before the setting changed: a post mounted while standard, then switched to bright (or
  back), must not keep the other mode's palette, band or body mark, in the worker as on the page.
- The bright ink reaching text with its own ground: a reaction chip, the ORIGIN box or a lifted control drawn white on
  a light chip.
- A standard band changed by the refactor: any reader of `band.lo === 0` or `band.hi < 0.5` missed, so a board is
  misread with the setting off.
- The flakes' base cache (`baseKey`) keyed only on bounds: a standard and a bright band of the same board must not share
  a base.
- Cost on a busy page: a bright page must draw no more often than a standard one.
