Record, written 2026-11-23.

# Chattier staff follow-ups: plan

This plan builds the follow-ups in #1022, which come from the reviews of #1000
(`docs/plans/2026-11-22-chattier-staff-plan.md`). The owner asked for it directly ("implement your recommendations for
1022"), so the issue's list is the design. The questions in #1021 (F5 and F6) wait on the owner and are not built here.

It is one PR from `main`, and every task goes test first with a red run. There is one migration,
`supabase/migrations/NNNN_chattier_follow_ups.sql`, where NNNN is the next free number. A function it rewrites is copied
from its latest definition and opens with the house comment.

## Task 1. The database: a list of replies, and the guards proved red

Model: sonnet

- `pool_thread` (latest `0366_excerpts_and_orders.sql`) takes `also` as a list of replies, so a turn reads every older
  reply in one call. Its existing callers keep their behavior. The build checks every caller (the chatter and meet
  functions, and SQL).
- Tests that the final review found to be green under a poison (F1, F2), added to the `0415-chattier-*` tests or to a
  new file. Each must go red under the review's poison:
  - F1: `pool_conversation` names a veiled reply's author only as its veil.
  - F2: `pool_record` leaves out a move that landed or ended before the latest meeting's slot.
- A two-connection test of `write_staff_turn`, as an e2e file under `supabase/tests/e2e/` using the kit's race helper.
  Two calls answering the same reply at once write one turn, and the other is refused. It must go red with the
  per-persona lock and the `pool_answered` key both removed.

## Task 2. The round

Model: sonnet. Depends on Task 1's `pool_thread`.

- F4: a kept pick still unwritten when its day ends is written in the next round and spent on its own day. It is never
  lost. This includes an instance whose tuned `pool` row keeps a once-a-day `chatterCron`.
- F3: a test that drives the allowance check on writing kept picks red.
- `keepThePicks` never counts a persona twice: a persona whose kept pick has already posted is counted once.
- A turn reads its older replies in one `pool_thread` call.

## Task 3. The meeting's talking points leave out pending moves

Model: sonnet

F7: the talking-points instruction in `engine/system/meeting.ts` tells the model that points never mention a move it is
proposing or one still waiting on admins, so that they speak only of what has landed. A prompt test checks this.

## Task 4. The fake lists a persona where a reply waits

Model: sonnet

`engine/ui/data/fake.ts` lists a persona in session on a thread or board where a player's reply to its post is waiting,
as `presence_box` does. A test goes red without it.

## Task 5. A tuned pool row keeps its cron

Model: inline

The comment on `chatterCron` in `instances/divided-world/settings.ts` says that a tuned `pool` row keeps its own cron
(`seed_setting` fills only missing keys), so 15-minute rounds reach a tuned instance only after an admin edits it. With
Task 2's F4 fix, a once-a-day cron loses no pick.

## Review focus

- A carried-over pick is spent once, on its own day, and a rerun never writes it twice.
- `pool_thread`'s old one-reply callers are unchanged.
