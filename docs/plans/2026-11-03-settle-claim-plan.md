# The settle run's claim, held until its window is applied: plan

Record, written 2026-11-03. The plan for `docs/plans/2026-11-03-settle-claim-design.md`. One build session builds it in
one PR from `main`, after the design's PR is merged. The build PR says `Closes #177`. It ticks #179's second and fourth
follow-ups and links the PR from them, and #179 stays open for its other follow-ups.

Every task is test first: name the test, record its red run, then write the code. No `check-*.mjs` is added.

**One migration.** It takes the next free number in `supabase/migrations/` as `NNNN_settle_claim.sql`. Its SQL test
takes the next free number in `supabase/tests/` as `NNNN-settle-claim.sql`, and runs against Postgres on localhost.
Each function the migration replaces is copied from its latest definition: `unmask` and `masks_change` from
`0072_core_loop_answers.sql`, `turn` from `0028_loud_classes.sql`, `my_characters` from `0041_presence.sql`. Before
copying, the build looks for a later definition with `grep -l "function <name>\|view <name>" supabase/migrations/*.sql`.
Everything a copied function does that this plan does not name stays as written.

**The boundary check holds.** Nothing here names an instance.

## Task 1. The claim holds until its window is applied (SQL, settle function)

**Files:** the migration; `supabase/functions/settle/core.ts` (`runSettlement`); tests `supabase/tests/NNNN-settle-claim.sql`,
`supabase/functions/settle/core.test.ts`, `supabase/tests/e2e/0009-unmask-racing-the-tally.ts`; the claim and privilege
blocks of `supabase/tests/0076-core-loop-answers.sql`; the claim row in `supabase/tests/e2e/0003-export.ts`.

**Change:**
- `delete from settlement_claims`. A claim is a run's clock, never an Act, and no instance is deployed. Then
  `alter table settlement_claims add column window_start timestamptz not null`, plus a check that
  `window_end > window_start`.
- `drop function claim_settlement_window(timestamptz)`. Create `claim_settlement_window(window_start timestamptz,
  window_end timestamptz)`, which upserts on `window_end` and sets `window_start` and `claimed_at = now()`. It is
  service only, with the same revokes and grant as 0072's.
- An `after insert on settlements` row trigger deletes `settlement_claims where window_start < new.ends_at`: the claims
  this settlement voids, deleted in `apply_settlement`'s transaction. A trigger, so `apply_settlement` is not copied.
- `unmask` (from 0072): the claim's condition becomes `k.window_end > p.asked_at and k.window_end <= now() and not
  exists (select 1 from settlements s where s.ends_at > k.window_start)`, and the five-minute condition is gone. Both
  refusals raise `this character''s Turn takes effect at the settlement now due; reveal once it has run, or withdraw
  the Turn`, with the same hint and errcode. The header comment says how the claim ends now, and its ways out.
- `core.ts`: `db.rpc('claim_settlement_window', { window_start: window.start, window_end: window.end })`. The comment
  above it says the claim holds until applied, and why a clock cannot (#179).

**Tests first:**
- SQL, the defect. A first-of-season window ended an hour ago. Its claim is six minutes old, and the window is
  unsettled. The reveal is refused, in the new words. Red on main: main lets it through.
- SQL: the known-end refusal says the new words.
- SQL: a claim on a window that ends after `now()` refuses nothing.
- SQL: a stale claim, start S and end E2, stops refusing once a settlement from S to E1 (E1 < E2) is written, and the
  trigger has deleted it.
- SQL: a claim on a window that ends before the Turn was asked refuses nothing. This case is carried from 0076.
- SQL: claiming twice keeps one row and updates `window_start`.
- SQL: `settlement_claims` is unreadable to `authenticated` and `anon`. The two-argument function is executable by
  `service_role` alone. The one-argument function is gone (`to_regprocedure('claim_settlement_window(timestamptz)') is
  null`).
- 0076: delete its claim block and its claims-privilege block, since they test the clock this change removes. Their
  cases now live in the new file. Show 0076 still passing after the deletion.
- `core.test.ts`: the fake db sees `claim_settlement_window` with `window_start` and `window_end` before
  `settlement_input`, for each window. Red on main: it sends no `window_start`.
- e2e 0009: the refusal's words. Red on main.
- e2e 0003 (export): the claim row it inserts gains `window_start`, so the round trip still covers every column.

## Task 2. A Turn never takes effect behind a reveal (SQL)

**Files:** the migration; tests `supabase/tests/NNNN-settle-claim.sql` and `supabase/tests/e2e/0009-unmask-racing-the-tally.ts`;
`supabase/tests/e2e/0003-export.ts`.

**Change:**
- `alter table pending_turns add column due_at timestamptz` and `alter table class_history add column due_at
  timestamptz`, both nullable. Existing rows keep null, which means the Turn was never passed over.
- `masks_change` (from 0072). `masks_turns` gains `due_at`. After the lock it already takes, the insert into
  `masks_turns` adds `and not exists (select 1 from acts a where a.kind = 'unmask' and a.character = p.character and
  a.created_at >= window_end)`, a probe of `acts_unmask`, and carries `p.due_at`. The Turns it passes over get
  `update pending_turns set due_at = coalesce(due_at, window_end) where asked_at < window_end and character not in
  (select character from masks_turns)`. The insert into `class_history` writes `due_at`. A comment says why the
  backstop exists (the round trip before the claim, design section 3) and why the lock orders it.
- `turn` (from 0028): its `on conflict` update also sets `due_at = null`, since a changed Turn is a new ask.
- `my_characters` (from 0041): `h` also selects `x.due_at`, and the view gains `h.due_at as class_due_at` as its last
  column, since `create or replace view` can only add columns at the end. The grants are as 0041 left them.

**Tests first:**
- SQL. A Turn is asked, its window ends, and the character reveals at `window_end + 1 minute` (`write_unmask`, as a
  first-of-season window allows). The window is applied. The character's class is unchanged, the Turn still waits,
  and `due_at = window_end`. No tally names it. Red on main: main applies the Turn.
- SQL: at the next window the Turn lands. `class_history.due_at` and `my_characters.class_due_at` are the first window's
  end, and an announced Turn's tally is at the second window's end.
- SQL: passed over twice, `due_at` keeps the first end.
- SQL: a reveal dated before the window's end leaves the Turn to land at it, with `due_at` null.
- SQL: changing a passed-over Turn clears `due_at`. Withdrawing it removes the row.
- SQL: a debut's or a Turn's own reveal, written by `masks_change` at this window's end, does not hold back another
  Turn applied in the same settlement. A character that debuts with its class and has a waiting Turn is the case.
- e2e 0009: a reveal committed after the window's end and before the settlement, with no claim (the round trip), makes
  the Turn wait. The reveal names the old class, true on its date, and the next settlement lands the Turn. Red on main.
- e2e 0003: the waiting Turn it inserts gets a `due_at`, and a passed-over Turn's `class_history` row carries one, so
  the round trip covers both columns.

## Task 3. The log says the Turn waited (engine, web)

**Files:** `engine/ui/data/api.ts` (`MyCharacter`), `engine/ui/data/fake.ts` (its `settle` seed, `myCharacters`,
`CharRec`'s history), `web/src/data/supabase.ts` (`myCharacters`), `engine/ui/log/lines.ts` (`TurnTaken`,
`turnsTaken`, `logRows`); tests `engine/ui/log/lines.test.tsx` ('a Turn that took effect'), `web/src/data/supabase.test.tsx`
and the fake's own tests.

**Change:**
- `MyCharacter` gains `readonly classDueAt: string | null`, documented as the settlement end the latest Turn was due
  at, where a reveal made it wait.
- `supabase.ts` maps `class_due_at`.
- The fake's history entries gain `dueAt`. Its `settle` mirrors the backstop: a character with an unmask Act dated at
  or after `at` keeps its pending Turn, with `dueAt` set once. `myCharacters` returns `classDueAt`.
- `TurnTaken` gains `dueAt: string | null`. The "Turn took effect" row's details add `It was due at the settlement of
  ${utcDay(dueAt)} and waited for this one: ${name} revealed after that window had ended.`, using the day formatter the
  settlement row already uses.

**Tests first:**
- `lines.test.tsx`: a character whose `classSince` is a settlement and whose `classDueAt` is the one before it gets the
  sentence, with the right day. One with `classDueAt` null does not. Red on main.
- `supabase.test.tsx`: a `my_characters` row with `class_due_at` gives `classDueAt`. Red when the mapping line is
  removed (#179's first follow-up is about wirings no test held).
- The fake: `settle` after a reveal dated after `at` keeps the Turn. The next `settle` lands it with `classDueAt`.

## Review focus

- What the migration does to the rows an instance already holds: the claims are deleted, and `due_at` is null on every
  existing Turn. Confirm that neither changes a settlement already applied, or the export of one.
- A run that dies with its claim in place on a first-of-season window. Confirm the refusal lifts when the next run
  applies that window, and that nothing else is waiting on the claim.
- Two runs with different `until`s on one first-of-season window, applied in either order. Confirm the loser's claim
  is deleted by the winner's settlement and refuses nothing afterward.
- The lock order between `unmask()` and `masks_change`. Under READ COMMITTED, confirm a reveal that commits while
  `masks_change` waits on the character's row is seen by the backstop's statement, and that a reveal waiting on
  `masks_change` names the new class.
- The backstop's probe at a busy instance's scale: one `acts_unmask` lookup per waiting Turn per settlement.
- The masks: confirm `class_due_at` reaches no view, payload or Realtime event but `my_characters`, and that a
  passed-over Turn's tally carries nothing that marks it as late.
