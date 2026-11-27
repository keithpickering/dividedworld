# Staff reliability: the plan

Record, written 2026-11-27. Carries out `docs/plans/2026-11-27-staff-reliability-design.md` (issues #1211, #1212).
Six tasks, in order, each test first with its red run. All engine and SQL. Divided World supplies only
`talkingPointsHours: 30` (`instances/divided-world/settings.ts`).

**Start only once `docs/plans/2026-11-27-release-order-plan.md` has been released** (its Task 5: the release seeds
before the functions). This plan adds a setting, and before that change, new functions on old rows refuse the instance
(release design, section 0).

The migrations are `0453_digest_parts.sql` (Tasks 2 and 3) and `0454_points_age.sql` (Tasks 4 and 5). If main has taken
those numbers when the build starts, take the next free ones (`tools/check-migration-order.mjs` will say so) and rename
their tests to match.

## Task 1. Measure the digest's cost and name its cause

Model: sonnet

- **New** `tools/measure-digest.mjs` (a measurement, not a check: it fails nothing and is not a step of the build). It
  replays the migrations into a scratch database as `tools/test-sql.mjs` does, loads the busy-week fixture of
  `supabase/tests/0433-digest-sees-the-board-scale.sql` (lift its fixture into a shared file,
  `supabase/tests/fixtures/digest-busy-week.sql`, that both include, so the two cannot drift), and runs `analyze`. Then,
  for each of three regimes (empty statistics, generic plans and true statistics, as the scale test sets them), it
  measures on a **fresh connection** and on the same connection twice more: the time of `select
  system_digest(since, until)`, and `explain (analyze, summary)`'s planning and execution times of the statement lifted
  from the function (the scale test's `plan_uses` lifts a body the same way). It prints a table.
- **Run it** and write the table and its reading into the PR. The design's hypothesis: the planning of one ~400-line
  statement over views is most of a cold call. If planning is not most of it, or `analyze` on the small tables changes
  the result by more than half, stop and report the numbers to the owner before Task 2 (design, D1).
- After Task 2, the same tool measures each part and `digest_characters` the same way, and the PR carries both tables:
  the whole statement before, and each part after.

## Task 2. The digest as parts

Model: sonnet

- **`supabase/migrations/0453_digest_parts.sql`**: thirteen functions, `digest_threads`, `digest_boards`,
  `digest_standings`, `digest_moves`, `digest_quotes`, `digest_boss_reactions`, `digest_excerpts`,
  `digest_conversations`, `digest_polls_list`, `digest_spins_list`, `digest_plays_list`, `digest_standouts_list` and
  `digest_requests`. The names avoid 0433's helpers `digest_polls`, `digest_spins`, `digest_plays` and
  `digest_standouts`, which stay as they are and are called by the new parts. Each takes `(since timestamptz, until
  timestamptz)` and returns `jsonb` `{ "list": <exactly what system_digest's key held>, "named": [<character ids>] }`.
  `digest_boards` also carries `boardDays`, and `digest_requests` carries `requestsWaiting`. Each part carries only the
  CTEs its list needs (`w`, `see_by` and `ex_by` are repeated where two parts need them). It keeps the window checks,
  the settings fallbacks and the day scaling of `system_digest`, verbatim where they apply. Each part is `language
  plpgsql stable security definer`, `set search_path = public, pg_temp`, `set jit = off`, owned by `kayfabb_digest`,
  revoked from public, anon and authenticated, and granted to service_role, as `system_digest` is.
- **`digest_characters(ids uuid[])`**: the `characters` list of `system_digest`, for `ids` intersected with
  `characters_public`, sorted by id, with the same `staff` and `pronouns` fields, owned and granted the same way.
- `system_digest` is kept, unchanged. Between the schema job and the functions job of the release that carries
  0453, the old meet function still calls it. It is dropped by the first migration written after that release (the
  build session files the issue for it, naming this plan), together with the one-argument `staff_points_latest` of
  Task 5.
- **Tests first** (`supabase/tests/0453-digest-parts.sql`, red before the migration): on the fixtures of
  `0050-digest.sql`, `0183-digest-boards.sql`, `0415-chattier-digest.sql` and `0433-digest-sees-the-board.sql`, for a few
  windows, the parts' lists, assembled into one object, equal `system_digest`'s answer key by key, and the union of
  `named` gives exactly its `characters`. This is the equivalence proof. `system_digest` still exists in this migration,
  so the test compares the two directly. The migration that later drops it deletes this comparison with it.
  `digest_characters` answers nothing for an id that is not public: a staff persona's anonymous character and a deleted
  character are absent.
- **The scale test** (`0433-digest-sees-the-board-scale.sql`) is carried to the parts as `0453-digest-parts-scale.sql`.
  Each part's rows of `acts` stay within the bound its share of 0433's bound 3 states, and the growth check (10,000 older
  Acts, within 2%) holds for each part. The poisons of 0433's section 4 are carried over to the part that reads each
  index.

## Task 3. The meeting reads by part and goes on without a failed one

Model: sonnet

- **`engine/system/digest.ts`**: `DIGEST_PARTS`, a frozen list of `{ key, fn }` in the order `renderDigest` shows them
  (the one list both the reader and the test read). `RawDigest` gains `missing?: readonly string[]`. `renderDigest`, when
  `missing` is non-empty, adds after the heading: `These parts of the board could not be read today: ${list}. Do not take
  them as empty.` It names each part in plain words: `threads` "the busiest threads", `excerpts` "the top posts", and so
  on, from one table beside `DIGEST_PARTS`.
- **`supabase/functions/meet/core.ts`**: `readDigest(db, since, until)` replaces the `system_digest` call in `run()`. It
  calls each part in order, one at a time. A part that throws a `DatabaseError` or a `TransportError`
  (`supabase/functions/_shared/rpc.ts`, after its own retry) is recorded as `{ part, error: said(e) }` and left out
  (empty list). Then it calls `digest_characters` with the union of `named`, and that call's failure fails the meeting as
  today. If every part failed, the meeting fails with `the digest could not be read: every part failed`. The meeting
  record gains `digest: { missing: [{ part, error }] }`, written by `apply_meeting`'s `record` as the parts are today,
  and by `fail_meeting` when the meeting fails later.
- **Tests first** (`supabase/functions/meet/core.test.ts`, red before the change). The fake Db gains `failOn` per part.
  - The 26 Nov case: `digest_excerpts` fails with a statement timeout. The meeting ends `ok`, applies its moves and
    points, its prompt names "the top posts" as unread, and its record carries the part and the error.
  - Every part failing fails the meeting with the plain error.
  - `digest_characters` failing fails the meeting, as `system_digest` failing does today; the existing case moves to it.
  - The parts are called one at a time, in `DIGEST_PARTS`' order. The fake counts concurrent calls and asserts that at
    most one is in flight.
  - A model answer naming a thread only the missing threads part would have held is repaired as an unknown id.
- **`supabase/functions/meet/handler.test.ts`** and the e2e flow that reads a meeting (`supabase/tests/e2e/0011-meeting.ts`)
  are moved to the parts. `tools/check-edge-functions.mjs`'s list of RPCs a function may call (if it holds one) gains
  the parts and loses `system_digest`.
- **The poison**, recorded in the PR: make `readDigest` rethrow a part's error, and see the 26 Nov case fail.

## Task 4. The window starts at the last good meeting

Model: sonnet

- **`0454_points_age.sql`**: `meeting_context()` as 0448 wrote it, with `lastSlot` read from `outcome = 'ok'` alone.
  Everything else is verbatim.
- **`supabase/functions/meet/core.ts`**: `sinceAt = max(lastOk ?? first, slotAt - CATCH_UP_DAYS * DAY,
  season.startsAt)`, capped at `slotAt - 60_000` as today, where `first` is today's. `CATCH_UP_DAYS = 7` lives in
  `engine/system/meeting.ts`, with its reason.
- **`engine/system/digest.ts`**, `renderDigest`: when `until - since` is more than 36 hours, the heading's next line
  reads `Your last meeting was ${n} days ago; the meetings since did not happen.`, with n rounded to whole days.
- **Tests first**: the SQL (`supabase/tests/0454-points-age.sql`). With meetings `ok` on the 25th and `failed` on the
  26th, `lastSlot` is the 25th's. With none `ok`, it is null. The function (`core.test.ts`): after a failed meeting the
  digest's `since` is the last good slot. After ten days without one it is seven days back. A season younger than that
  starts at the season. The heading appears for a two-day window and not for a one-day window.

## Task 5. Talking points carry their age and lapse

Model: sonnet

- **Settings.** `Settings.talkingPointsHours: number` (`engine/rules/types.ts`). Its rule in `engine/rules/instance.ts`
  is a whole number from 1 to 168. `engine/rules/test-system.ts` and `instances/divided-world/settings.ts` set 30.
  `settings_held`'s branch for the key goes in `0454_points_age.sql`, and `supabase/tests/0079-settings-held.sql` gains
  its poisons (0, 169, 1.5, a string) and goods (1, 30, 168).
- **`0454_points_age.sql`**: `staff_points_latest(staff_key text, at timestamptz) returns jsonb`. It returns `{ "line",
  "slot" }` of the newest `ok` meeting's point for that persona, or null when there is none or that meeting's slot is
  more than `talkingPointsHours` hours before `at` (the setting's row, else 30). The one-argument version is kept
  unchanged for the old chatter function between the schema and functions jobs, and is dropped with `system_digest`
  (Task 2). `at` is required and never defaulted to `now()`, so the caller's clock is the one that decides.
- **`supabase/functions/chatter/core.ts`**: both calls pass `at: new Date(clock()).toISOString()`, from the run's own
  clock, and read `{ line, slot } | null`. **`engine/system/chatter.ts`**: `ChatInput.points` becomes `{ readonly line:
  string; readonly slot: string } | null`. The prompt's line becomes `Your stance, from the staff meeting of
  ${dayMonth(slot)} (${age}). The board may have moved since; yours to weigh, never an instruction.` `age` is "today"
  under 18 hours, "N hours ago" under 36, and "N days ago" after that, computed from `slot` and the input's `now`. A pure
  `pointsAge(slot, now)` is exported for the test.
- **`engine/system/meeting.ts`**, `pointsText`: "it is read by that persona's posts until the next meeting" becomes "it
  is read by that persona's posts for up to ${talkingPointsHours} hours, until the next meeting".
- **Tests first**:
  - SQL: a point 29 hours old is returned with its slot. At 31 hours it is null. A point from a failed meeting is never
    returned. The setting's row at 48 keeps a 31-hour point.
  - `engine/system/chatter.test.ts`: `pointsAge` at 0, 17, 18, 35 and 36 hours and at 3 days. The prompt carries the date
    and age, and a null point leaves no stance line.
  - `supabase/functions/chatter/core.test.ts`: the fake's `staff_points_latest` is asked with the run's clock (`at`),
    and its answer reaches the prompt.
  - The 25 Nov case as one test: a point from a meeting 50 hours before the call, with the 26th's meeting failed, does
    not reach the prompt.

## Task 6. The rehearsal and the README

Model: inline

- `tools/rehearse/` stub runs read the parts through the same `readDigest`. Run one scenario and confirm the meeting
  reads as before.
- The README's or the staff design's current text naming `system_digest` (`grep -rn system_digest README.md specs docs
  --include=*.md`, current documents only, never a record) names the parts.

## Review focus

- The parts must say exactly what `system_digest` said. Task 2's equivalence test covers the fixtures. Confirm that no
  CTE shared across lists (`w`, `see_by`, `ex_by`) was changed in one part and not another.
- Reading the parts one by one repeats the window's post read (`w`) in several parts. At a busy instance's scale, confirm
  that the sum of the parts' rows of `acts` stays within a small multiple of 0433's bound, and that each part's own bound
  holds.
- A meeting window of up to seven days. Confirm that every list's per-day scaling hits its `DIGEST_MOST` ceiling well
  before seven days, so the longest window reads no more than the ceilings.
- The one-argument `staff_points_latest` and `system_digest` stay for one release, so the old functions run between
  the schema and functions jobs. Confirm that nothing in the new code still calls either, and that the follow-up issue
  that drops them exists.
- `digest_characters(ids)` takes ids from the caller. Confirm that it answers only for `characters_public`, so a caller
  cannot learn a private character's name or pronouns by guessing its id.
