Record, written 2026-11-21.

# The Turn cooldown is never shorter than a settlement window: plan

Carries out issue #931, the owner's decision of 2026-11-21: the settings check refuses a `turnCooldown` shorter than
`settlementLength`, so a character can never Turn twice within one settlement window (which makes #929 impossible on
every instance). One PR from `main`. No instance is deployed, so nothing is migrated; an instance's settings are held
from the next write of either row.

## How two spans compare

A span is a whole count of `day`, `week` or `month`. The cooldown covers the window when, for any Turn at time `t` in a
window that opens at `o` (so `t >= o`), `t + cooldown` is at or past `o + window`. The check is:

- **Both in months:** the cooldown's count is at least the window's. Month addition is monotone (Postgres clamps a day
  past a month's end to its last day, which keeps order), so `t + M months >= o + M months >= o + N months` whenever
  `M >= N`. This is exact: a 1-month cooldown with a 1-month window is allowed.
- **Otherwise, in days:** a day is 1 and a week 7 on either side; a month counts as **28 days in the cooldown** (its
  shortest) and **31 days in the window** (its longest). The cooldown's days must be at least the window's. This is
  the bound that holds for every month: a 30-day cooldown with a 1-month window is refused (a 31-day month would let a
  character Turn twice), and a 1-month cooldown with a 4-week window is allowed (28 >= 28).

Windows open at the previous window's close and close at `opens + span_interval(settlementLength)`, cut short by a
season's end (`scored_as_window`, `supabase/migrations/0151_card_payouts.sql`); the cooldown is
`last_turn + span_interval(turnCooldown)` (`0074_settle_claim.sql`). A window cut short by a season only makes the
check safer.

## Task 1: the TypeScript check

Model: inline

File: `engine/rules/instance.ts` (`settingsProblems`), test in `engine/rules/instance.test.ts`.

1. Test first: `settingsProblems` with `settlementLength` 1 week and `turnCooldown` 6 days is refused with
   `setting "turnCooldown" is …; it must be a span no shorter than settlementLength …`; 1-month cooldown with 30-day
   window refused (28 < 30) and with a 29-day window refused; 30-day cooldown with 1-month window refused; 1-month cooldown with 4-week window allowed; 1-month
   cooldown with 1-month window allowed; 1-month cooldown with 2-month window refused; the defaults (a 30-day cooldown, a
   1-day window) pass, and `settingsProblems` of the whole test settings is empty. Red run:
   the refusals are missing.
2. Code: a pure `cooldownCoversWindow(cooldown, window)` beside `settingsProblems`, applied only when both rows are
   spans (a row that is not a span is its own refusal), and the sentence above. Green run.
3. Poison: the comparison with the 28/31 asymmetry removed (a month as 30 days on both sides) turns the
   30-day-cooldown/1-month-window case green; recorded in the PR.

## Task 2: the SQL check

Model: inline

File: a new migration (`0399_turn_cooldown_floor.sql`, renumbered above `main`'s highest when `main` is merged),
redefining `settings_held` copied whole from its latest definition on `main` (today
`supabase/migrations/0395_polls.sql`), adding a pure `turn_cooldown_covers(cooldown jsonb, win jsonb)` with the same
comparison. Test in a new `supabase/tests/0399-turn-cooldown-floor.sql`.

1. Test first: writing `turnCooldown` shorter than the stored `settlementLength` is refused with 23514 and
   `turnCooldown is a span no shorter than settlementLength …`; writing `settlementLength` longer than the stored
   `turnCooldown` is refused with `settlementLength is a span no longer than turnCooldown …`; the same unit cases as
   Task 1 on both sides; the fixtures' values pass. Red run: no refusal.
2. Code: in `settings_held`, beside the poll pair, whichever of the two rows is written is held against the other as it
   stands, only when the other row is a span (as the poll pair does). Green run.
3. Poison: the clause that checks the `settlementLength` side removed, so only one of the two writes is held; the test
   goes red on that side. Recorded in the PR.

**Changed after the final review (F-1).** Holding each write against the other row as it stands refuses a reseed from
one good pair to another: `seed_instance` (0397) writes `turnCooldown` before `settlementLength`, so 60 days against 45
reseeded to 7 against 1 passes through 7 against 45. So `settings_held` is left as 0395 wrote it, and the pair is held
by a deferred constraint trigger, `settings_turn_cooldown_floor`, which reads both rows as they stand when the
transaction that wrote either one ends (a pair with a row missing holds nothing). The test adds the reseed, taken, and a
pair still refused at the transaction's end, refused; its poison is the trigger made `initially immediate`.
`supabase/tests/0079-settings-held.sql` makes the check immediate before it alters the table, since a table with
trigger events still pending is not altered.

## Review focus

- The comparison is the same on both sides (TS and SQL), case for case.
- A seed or fixture that writes the rows in either order is not refused on a valid pair.
