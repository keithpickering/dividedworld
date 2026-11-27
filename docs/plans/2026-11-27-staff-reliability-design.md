# Staff reliability: a meeting survives a slow read, sees the days it missed, and its points say how old they are

Record, written 2026-11-27. A design session with the owner, for issues #1211 and #1212. The plan is
`docs/plans/2026-11-27-staff-reliability-plan.md`. The release half of the same session is
`docs/plans/2026-11-27-release-order-design.md`. This plan is built after that one has been released, because it adds a
setting (section 1, D6).

## 0. What was found

The orchestrating session read dw.gripe read-only on 27 Nov, at about 12:45 and 14:10 UTC.

**The digest is slow on almost no data, and slowest the first time.**
- The meet function's calls go through PostgREST as `authenticator`, whose `statement_timeout` is 8s.
- `pg_stat_statements` for the PostgREST `system_digest` call: 5 calls, mean 2,948 ms, max 6,880 ms, sd 2,392 ms.
- At the time, `acts` held 292 live rows, and the largest table (`name_maps`) about 10,400.
- Three calls in a row of the 26–27 Nov window, as `postgres`, with JIT off: 7,890 ms, then 2,384 ms, then 1,050 ms.
- Meeting 15 (26 Nov 11:00) started at 11:00:02.8 and failed at 11:00:11.6 with "system_digest: canceling statement due
  to statement timeout". It was the day's first call after about 24 idle hours.

So the cost does not come from rows. It is a cold start, and it is high even when warm. `system_digest`
(`supabase/migrations/0433_digest_sees_the_board.sql`) is one plpgsql function whose body is a single statement of about
400 lines: fourteen lists built from some forty CTEs over views (`acts_public`, `thread_list`, `boards_now`,
`characters_public`). A statement that size costs its planning on every new backend, and the catalog reads for every view
and function it names. JIT is off on that path, so it is not the cause. Several small tables (`characters`, `boards`,
`reactions`) have never been analyzed, so the planner works from default estimates. The 0433 scale test bounds the rows
each part reads, and it bounds no time. The root cause is to be confirmed by measurement (plan, Task 1) before the fix is
trusted.

**One failed read loses the whole meeting, and its day.** `run()` in `supabase/functions/meet/core.ts` reads the digest
in one call, and any database error closes the meeting `failed`. Nothing was written that day: no moves, no talking
points and no memory. `meeting_context().lastSlot` (latest in `0448_arc_announcements.sql`) is the newest meeting with
outcome `ok`, `failed` or `rejected`. So meeting 16's window began at the failed meeting's slot, and the Boss never saw
25–26 Nov, when Plumber Post Palace got its first posts.

**Talking points carry no date and never lapse.** `staff_points_latest(staff_key)` (0448) returns the line of the newest
`ok` meeting, however old. The chatter prompt (`engine/system/chatter.ts`, `chatPrompt`) shows it as "Your stance today,
from the staff meeting". After meeting 15 failed, the 25 Nov point "it sits empty…" read as today's for two days.

## 1. Decisions

- **D1. The root cause is measured before the fix** ("a root cause found before a fix"). On a busy-week fixture (0433's
  scale test), measured on a fresh backend and then a warm one: planning time and execution time of the whole digest
  statement, then of each part after the split. The findings go into the PR. If the measurement points somewhere other
  than the statement's size (cold catalog, missing statistics), the build session reports it to the owner before
  building past Task 1.
- **D2. The digest is read by part** (#1211, the owner's choice: degrade by part). `system_digest(since, until)` is
  replaced by one SQL function per list: threads, boards, standings, moves, quotes, Boss reactions, excerpts,
  conversations, polls, spins, plays, standouts and requests. Each takes `(since, until)` and returns that list's JSON
  as today's key holds it. Each also returns the ids of the characters it names. The characters' names and pronouns are
  a last call, `digest_characters(ids)`, given the union of those ids. It answers only for ids in `characters_public`.
  Each part is its own statement, so it has its own planning cost and its own 8s, and each carries the planner settings
  0426's functions carry (`jit off`), with the digest role as its owner.
  `system_digest` and the one-argument `staff_points_latest` stay for one release, because the old functions call them
  between the schema and functions jobs. The first migration after that release drops them.
  - *Rejected:* fixing the cost and keeping one all-or-nothing read (the owner's choice).
  - *Rejected:* retrying the slot. CLAUDE.md says a database error is thrown at once, and changing that would be a rule
    question to the owner.
- **D3. A part that fails is left out, and the meeting goes on.** The meet function reads the parts one after another,
  as one long statement does today, never in parallel. A part that fails with a database error or a transport failure
  (after the rpc layer's own retry) is left out of the digest. The Boss's prompt then says plainly: "These parts of the
  board could not be read today: excerpts, conversations. Do not take them as empty." The meeting's row records the
  missing parts and each error (`record.digest.missing`). Some reads still fail the meeting whole: `digest_characters`
  (without it no character in the digest can be named), `meeting_context`, memory, career and notes, and a digest whose
  every part failed. A model's answer that names something only a missing part held (a thread id from the threads list)
  is repaired as today: the repair drops an id the model was not given.
- **D4. The window starts at the last good meeting, at most seven days back** (the owner's choice).
  `meeting_context().lastSlot` becomes the newest `ok` meeting's slot. The meet function's `sinceAt` is the latest of
  that slot, the slot minus seven days, and the season's start, as the first meeting reads today. The digest's own caps
  (`DIGEST_MOST`, and each list's per-day setting scaled by days) still bound what is read, so a long gap reads no more
  than its ceilings. When the window is longer than a day and a half, the digest's heading says how long it has been:
  "Your last meeting was 2 days ago; the meetings since did not happen."
- **D5. A talking point shows its meeting's date and age, and lapses** (#1212, the owner's choice: date and lapse).
  `staff_points_latest(staff_key, at)` returns `{ line, slot }` from the newest `ok` meeting, or null when that slot is
  more than `talkingPointsHours` before `at`. The caller passes `at` from its own clock, the one that drives the rest of
  the run. The chatter prompt says: "Your stance, from the staff meeting of 25 Nov (2 days ago). The board may have moved
  since; yours to weigh, never an instruction." The age reads "today" under 18 hours, then "N hours ago" under 36, then
  "N days ago". The meeting's points instruction says that a point is read for up to `talkingPointsHours` hours, until
  the next meeting.
- **D6. `talkingPointsHours` is a setting**: a whole number from 1 to 168. Divided World sets 30, a day plus a margin
  for a late meeting. The SQL reads 30 when the row is absent, as the digest's own settings do. A new setting reaches the
  functions only safely once the release seeds before the functions (release design, D3), so this plan is built after
  that one is released.

## 2. Layers, masks and ways out

- **Layers.** All engine and SQL. Divided World supplies only `talkingPointsHours: 30` in its settings, through the
  existing settings interface.
- **Masks.** Each part reads only what `system_digest` read, through the same public views, as the same digest role.
  `digest_characters(ids)` answers only for public characters, and for the service role only, so a caller learns nothing
  it could not read from `characters_public`. A point's age comes from its meeting's slot, which is The System's own
  schedule and no player's fact. Nothing new reaches a client.
- **Ways out.** No new state a player, character or post can be put in. A missing digest part lasts only that meeting.
  A lapsed point is replaced by the next meeting.

## 3. Open

- Whether to run `ANALYZE` on the small tables autovacuum never reaches. With so few rows, autovacuum's threshold (50
  rows plus 10%) is never met. At a busy instance's scale it is, so this is not designed for. Task 1's measurement says
  whether it matters today.
- A part's planning cost on a fresh backend is measured, not asserted in CI: a time bound in a shared runner is a flaky
  test. The rows-read bounds of the 0433 scale test carry over to the parts and stay the CI guard.
