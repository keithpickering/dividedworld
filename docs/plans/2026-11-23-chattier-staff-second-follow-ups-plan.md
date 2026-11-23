Record, written 2026-11-23.

# Chattier staff, second follow-ups: plan

This plan closes #1021 and #1025, the questions and findings left by the chattier staff builds (#1000, #1023;
`docs/plans/2026-11-22-chattier-staff-design.md`, `docs/plans/2026-11-23-chattier-staff-follow-ups-plan.md`). The owner
answered #1021 in the build session (the answer is on the issue) and asked for #1025 as filed, with F3 decided: a
carried pick is held to its own day's allowance, in its own week.

It is one PR from `main`, and every task goes test first with a red run. There is one migration,
`supabase/migrations/NNNN_chattier_second_follow_ups.sql`, where NNNN is the next free number. A function it rewrites is
copied from its latest definition and opens with the house comment.

## Task 1. Carried picks: adopted, held to their own day, and tested (#1025 F1, F2, F3)

Model: sonnet

- F1: `pool_orphans` (latest `0317_surfaces.sql`) reads from the start of the week of `through` or from the day before
  `through`, whichever is earlier, so a Sunday pick's post whose spend failed is adopted on Monday before the carried
  read. A Monday test: a carried pick whose `record_pool_spend` fails once posts once, in SQL and in the chatter
  function's fake.
- F3: a carried pick is written only inside its own day's allowance: its day's spends (a card counting as a pick, as
  today) plus one stay within `allowance` for that day, computed from that day's week (`pool_week` of the day). The
  Monday exception to `carriedSpent` stays, because the carried pick is spent in last week, and the comment says so.
  Past its day's allowance, a carried pick is not written: it was never owed.
- F2: a test that goes red for each carried-pick branch in `supabase/functions/chatter/core.ts`: the Monday exception,
  the already-posted skip, the allowance hold, the zero-allowance gate, the card offer (a carried pick offers none) and
  the thread-start reset. Each is recorded with its poison.

## Task 2. A failed turn retries by why it failed, and the ceiling counts paid calls (#1021 F5)

Model: sonnet

- A table of failed turn attempts, append-only, with row-level security and service-only writes: the day, persona,
  session, thread, the replies it would have answered, its outcome (`refused`, `rejected` or `failed`) and whether it
  was paid. It is written by a security definer function the chatter function calls on every failed turn.
- How a failed turn is told apart, in `takeTurns`' one-turn path:
  - `refused`: the provider refused (`AnswerRejected` with predicate `refusal`). Its replies stop waiting at once.
  - `rejected`: any other `AnswerRejected` (not JSON, cut off, a bound `repairAnswer` cannot repair, `SchemaRefused`,
    `PromptTooLong`). A reply covered by two such attempts stops waiting.
  - `failed`: a transport failure that outlived the request's retries, or a database error. The replies keep waiting,
    as today.
  - A `kayfabb.refusal` from `write_staff_turn` stays a skip and writes no attempt.
- Paid: a call that got an answer (`refused`, `rejected` from the answer, or `failed` at `write_staff_turn` after an
  answer). `SchemaRefused`, `PromptTooLong` and a transport failure are not paid.
- "Stops waiting" holds wherever waiting is read: `pool_waiting_rows`, `pool_waiting_in_thread`,
  `pool_waiting_in_board` (so presence follows) and `write_staff_turn`'s check.
- `pool_turns_today` counts the day's turns plus its paid failed attempts.
- No fallback to the old voice for a refusal.

## Task 3. The day's turns accrue by time (#1021 F6)

Model: sonnet

`roundShare` in `engine/system/turns.ts`: rounds fall every `cronMinutes` from the start of the UTC day, round *k* of
*N* (both from the slot), and the day has earned `floor(perDay × (k+1) / N)` by round *k*. A round may plan what is
earned and unspent, never below 0. Tests: with demand in every round, the day's last round still has a turn; the day
never spends past `perDay`; a quiet morning's turns are there in the evening; a once-a-day cron's round has the day's
whole ceiling. Its callers and the header comment follow.

## Task 4. The fake's presence tests go red for the right reason (#1025 F4)

Model: sonnet

`engine/ui/presence/PresenceBox.test.tsx`: the 48-hour test's reply is newer than the post it quotes, and the test goes
red with the wait window removed from `engine/ui/data/fake.ts`. A new test: a persona out of session is not listed
where a reply waits, red with the in-session gate removed.

## Review focus

- A carried pick posts once, on its own day, inside that day's allowance, on a Monday as on a Thursday.
- A refused reply is never called for again, a rejected one at most twice, and the day's ceiling counts every paid call.
- No round spends turns the day has not yet earned, and no turn earned is lost before the day ends.
