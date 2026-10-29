# Two worlds: plan

Record, written 2026-10-29. The plan for `docs/plans/2026-10-29-two-worlds-design.md`. Most of that design is built by
the screens' own plans, which carry it as amendment blocks: `docs/plans/2026-10-29-screens-web-plan.md` (the glass's
tokens and interface, its guards, the pause menu, Rankings, and settings) and
`docs/plans/2026-10-29-screens-cards-plan.md` (the Vending Machine, the hand, the play form and the cards' controls in
the glass). This plan is the one change the design makes to the engine's database: the three preferences the glass's
settings save. It starts from main as it stands (migrations up to `0029_reveal_rolls_over.sql`) and is merged before the
web plan's Task 11, which shows the settings. A build session carries it out, tests first, each red run recorded
(`.claude/skills/build-session/SKILL.md`).

## The layers

All of it is engine. The three preferences are KayfaBB's, because the engine owns the two worlds and their player
options (design, section 6); an instance sets no default for them and adds no other.

## Tasks

### Task 1. Smoke, contrast and text size as preferences

- New migration `supabase/migrations/0030_glass_preferences.sql`. On `account_preferences` (from `0019_profiles.sql`),
  three columns with defaults, so a row already held keeps its meaning:
  - `smoke text not null default 'full' check (smoke in ('full', 'low', 'off'))`: how much cloud stands behind the
    glass;
  - `contrast text not null default 'standard' check (contrast in ('standard', 'high'))`: high puts solid ground under
    every line of glass text, at 7:1;
  - `text_size smallint not null default 100 check (text_size in (100, 125, 150, 200))`: a percentage for the board
    and the glass together.
- `set_preferences` is dropped and made again with the three as further parameters, each `default null` and kept by
  `coalesce` as the three before them are: `set_preferences(theme text, postbit text, motion text, smoke text, contrast
  text, text_size integer)`. Its refusals, in the plain words of the others, with `hint = 'kayfabb.refusal'` and
  `errcode = '22023'`: "the smoke is full, low or off"; "contrast is standard or high"; "text size is 100, 125, 150 or
  200 percent". It returns all six. A call naming only the first three, as the web plan's Task 11 would before this
  task, still works.
- Grants as `0019_profiles.sql` gives the old signature: revoked from `public` and `anon`, executed by `authenticated`.
- `supabase/tests/0005-default-deny.sql`: the function list names the new signature,
  `set_preferences(text,text,text,text,text,integer)`, in place of the old one, so a migration that forgets the revoke
  is caught as before.
- `supabase/tests/e2e/0003-export.ts`: the seeded preferences row sets the three away from their defaults (`'low'`,
  `'high'`, `150`), so the round trip proves they are carried. The export reads every column of the table already;
  this makes the row prove it.
- **Tests first,** in a new `supabase/tests/0033-glass-preferences.sql`, run red against main before the migration:
  - an account's first call with only `smoke => 'off'` keeps the other five at their defaults and reads back as it was
    set;
  - a later call naming only `text_size => 200` keeps `smoke` at `'off'`;
  - each refusal by its words: `smoke => 'thick'`, `contrast => 'max'`, `text_size => 175`;
  - the three-argument call of `supabase/tests/0025-profiles.sql` still sets theme, postbit and motion and leaves the
    new three at their defaults;
  - a second account reads no row of the first's, and `anon` cannot call the function.

## Ways out of the states this adds

| State | Its way out |
|---|---|
| Smoke off, high contrast, or text at 200% | Settings, where each is changed back; each is the player's own and changes nothing for anyone else |

## What could vary with a private fact, and how it does not

- The three preferences are the player's own row, read only by that player (`0019_profiles.sql`'s policy), never
  broadcast and never shown to another player. A preference changes how the player's own screen looks, never what the
  server answers anyone.

## Review focus

- That an account whose row predates the migration reads the defaults, and that the export of an instance made before
  this migration imports into one made after it.
- That the old three-argument signature is gone from the grants, not left callable beside the new one.
