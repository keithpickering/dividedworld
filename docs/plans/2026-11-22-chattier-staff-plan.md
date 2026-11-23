Record, written 2026-11-22.

# Chattier staff: plan

Carries out `docs/plans/2026-11-22-chattier-staff-design.md`. One PR from `main`.

Every task goes test first: write the failing test, record its red run, then the code. During a task, run only the
tests for the changed code: `npm run test:sql` for the SQL (it replays every migration into a scratch database on the
local Postgres `DATABASE_URL` names), `node --experimental-strip-types --test <file>` for the engine's tests,
`deno test` as the repository runs it for `supabase/functions/`, `npx vitest run <file>` for the screens and the fake.
Run `npm run typecheck` and `npm run build` once after the last task, with the tail in the PR. No deployed database,
bucket or connector is touched.

The migration is one file, `supabase/migrations/NNNN_chattier_staff.sql`, NNNN the next free number on `main` when the
build starts (0415 once built, after main reached 0413 and #1013 took 0414; 0407 when this plan was written). Each function or view it rewrites is copied from its **latest**
definition, which the build confirms before copying (`grep -l "function <name>(" supabase/migrations/*.sql | tail -1`,
and the latest `create or replace view` for a view); the latest named below is as of this plan, and a later migration
on `main` wins. Each rewrite opens with the house comment "`<name>` (`<latest>`), <what changes>. Everything else as
`<latest>` wrote it."

**The words.** A **round** is one run of the chatter function, every 15 minutes. A **session** is a persona's visit,
drawn for a UTC day. A **waiting reply** is a public post by a non-staff character whose target is a persona's post,
younger than `pool.turns.waitHours`, answered by no turn. A **turn** is a persona's post in a session that answers a
thread's waiting replies. A **pick** is the daily pick's choice, kept until its persona's session.

**The layers.** Engine: everything below except Task 1's instance values. Instance: `instances/divided-world/settings.ts`
(the numbers); no persona gets `habits` in this PR (the design's Open).

**The masks.** Waiting replies, turns, the ceiling, the digest's conversations and staff presence read public posts by
characters, public reaction totals and staff facts. Nothing added reads who owns a character, a class or who reacted.
Task 4's tests hold that no new function reads `characters.account`, `reactions.reactor_account` or a class column.

**States.** None for a player, a character or a post (the design's "Ways out").

**Acts and rows already held.** No Act changes. `pool_spends` keeps its rows and its shape. Posts already carrying a
`pool` marker are read as today.

## Task 1. Settings, types and the instance's numbers

Model: sonnet

**Files:** `engine/rules/types.ts` (`PoolSettings`, `Persona`, `Settings`), `engine/rules/instance.ts` (`poolRule`,
the `digestConversations` rule beside `digestExcerpts`), `instances/divided-world/settings.ts`, the new migration's
settings section, `engine/rules/settings-held.test.ts`, `supabase/tests/0079-settings-held.sql`.

- `PoolSettings` gains:
  - `sessions: { perDay: number; minutes: { least: number; most: number }; waking: { from: number; to: number } }`:
    the defaults a persona without habits takes. `perDay` a whole number 0 to 8; minutes whole, 10 to 180, least at most
    most; `waking.from` and `waking.to` whole UTC hours 0 to 23, the span wrapping past midnight when `to < from`.
  - `turns: { waitHours: number; perThread: number; perSession: number; perDay: number }`: whole numbers, `waitHours`
    1 to 168, `perThread` 1 to 6, `perSession` at least `perThread` and at most 12, `perDay` 0 to 500.
  - `chatterCron`'s doc comment becomes "when a round runs".
- `Settings` gains `digestConversations` (whole, 0 to `DIGEST_MOST.conversations`, which Task 6 adds as 12).
- `Persona` gains optional `habits?: { perDay?: number; minutes?: { least: number; most: number }; hours?: readonly number[] }`
  (hours: whole UTC hours it favors; a field left out takes `pool.sessions`'s). The seed and the roster check
  (`engine/rules/instance.ts`, the roster's rule) hold the same bounds as `pool.sessions` and refuse a persona whose
  `hours` is empty or repeats an hour.
- `setting_pool` (latest `0085_staff_notes.sql`) takes the two new fields with the same bounds, and the settings-held
  tests keep the TypeScript and SQL rules one list, as they do now.
- Divided World: `sessions: { perDay: 3, minutes: { least: 20, most: 60 }, waking: { from: 13, to: 5 } }`,
  `turns: { waitHours: 48, perThread: 2, perSession: 4, perDay: 60 }`, `chatterCron: '*/15 * * * *'`,
  `digestConversations: 6`, each with a comment naming the design.
- The new fields reach a database's `pool` row the way earlier added settings fields did (the build finds how the
  latest migration that added a field to a settings object filled existing rows, and follows it), and
  `schedule_chatter` (0089) reschedules from the row as today.

**Tests first:** each bound refused one past its edge in both rule sets (the poisons: `perSession` below `perThread`,
`waking.from` 24, `hours: []`, `hours: [3, 3]`, `digestConversations` 13), and Divided World's settings accepted.

## Task 2. Sessions: the draw

Model: sonnet

**Files:** `engine/system/sessions.ts` (new), `engine/system/sessions.test.ts` (new).

`drawSessions(persona: Persona, day: string, pool: PoolSettings, rng: () => number): { start: number; end: number }[]`,
pure. The rng is `seededRng(\`kayfabb-sessions:${day}:${persona.key}\`)` (export a `sessionRng(day, key)` beside
`dayRng` in `engine/system/pool.ts`).

- `perDay` sessions (the persona's, else the pool's), each a length drawn whole in minutes from `minutes`, rounded up to
  a multiple of 15 so a session holds whole rounds, never less than 15.
- Each start is on a 15-minute boundary inside the day, inside the favored hours (`hours`, else the waking span), drawn
  with the rng; sessions never overlap and never cross midnight (a session drawn to cross is cut at 24:00). Where the
  hours cannot hold them all, fewer are drawn; the count drawn is what the function returns, and the caller records
  nothing more.
- Sorted by start.

**Tests first:** the same day and persona draw the same; another day draws differently; no overlap over 1,000 seeded
days; every start inside the favored hours and on the grid; the waking span wrapping past midnight; `perDay: 0` draws
none; a persona's `hours` overriding the waking span.

## Task 3. Turns: what a round answers

Model: sonnet

**Files:** `engine/system/turns.ts` (new), `engine/system/turns.test.ts` (new).

Pure functions over what the round reads (Task 4's shapes):

- `roundShare(spentToday: number, perDay: number, slot: number, cronMinutes: number): number`: what is left of the day
  over the rounds left in it (the slot's round counted), rounded up, never below 0. `cronMinutes` is 15 for
  `*/15 * * * *`; Task 7 derives it from the cron's minute field and treats anything it cannot read as 15.
- `planTurns(open: readonly OpenThread[], sessions: readonly AwakeSession[], share: number, turns: PoolSettings['turns']): PlannedTurn[]`.
  `OpenThread` is a persona, a thread, its waiting replies (act ids, newest last, each with its author), and the heat of
  the persona's turns in that thread (the public reaction total on them). `AwakeSession` is a persona, its session id
  and the turns it has spent in the session in all and per thread. A `PlannedTurn` is a persona, a session, a thread, the
  reply it quotes (the newest waiting) and every reply it answers.
  - Only personas with an awake session; at most one turn per persona per thread per round; at most `perThread` per
    thread and `perSession` in all for the session; at most `share` in all.
  - Ranked by heat, then by the number of waiting replies, then by the oldest waiting reply's age; a seeded tie-break
    from the slot (`seededRng(\`kayfabb-turns:${slot}\`)`) in code-unit order, as `pick` does.

**Tests first:** the share's arithmetic at the day's first and last round and with the day spent; one turn per thread
per round; the per-thread and per-session caps against turns already spent in the session; the hotter thread first
under a share of one; a persona not awake gets nothing; the same inputs plan the same.

## Task 4. The database: sessions, kept picks, turns and the round's reads

Model: sonnet

**Files:** the new migration; `supabase/tests/NNNN-chattier-staff.sql` (new).

**Tables**, each append-only by a trigger as `pool_spends` is (`0089_pool_spends.sql`), none readable by a client, the
service role reaching them through the functions below:

- `staff_sessions (id bigint identity primary key, day date, staff text references characters (staff), starts_at timestamptz, ends_at timestamptz, unique (day, staff, starts_at), check (ends_at > starts_at))`, with an index on `(ends_at, starts_at)`.
- `pool_kept_picks (id bigint identity primary key, day date, staff text references characters (staff), pick jsonb, at timestamptz default now(), unique (day, staff))`: the day's pick, kept for its session. Written is known by its `pool_spends` row, so nothing here is updated.
- `pool_turns (id bigint identity primary key, day date, staff text references characters (staff), session bigint references staff_sessions (id), thread uuid references threads (id), post_act uuid unique references acts (id), quoting uuid references acts (id), at timestamptz default now())`, index `(day)`, `(session, thread)`.
- `pool_answered (reply uuid primary key references acts (id), turn bigint references pool_turns (id))`: each waiting reply a turn answered, so a reply is answered once.
- `staff_points (id bigint identity primary key, meeting bigint references meetings (id), staff text references characters (staff), line text check (char_length(line) between 1 and 200), at timestamptz default now(), unique (meeting, staff))`, index `(staff, id desc)`, as `staff_orders` is (`0103_orders.sql`).

**Functions** (security definer, `search_path` set, executable by the service role only, as the pool's are):

- `claim_pool_round(slot timestamptz, lease interval default interval '10 minutes') returns uuid`: as `claim_pool_run`
  (0089), keyed by the slot, so two rounds of one slot never both run. Its own claims table, append-only.
- `write_sessions(on_day date, rows jsonb) returns integer`: inserts the day's sessions, ignoring a row already there
  (`on conflict do nothing`), and answers how many the day holds. Refuses a staff key that is not a posting persona.
- `sessions_awake(at timestamptz) returns jsonb`: the sessions open at `at` (`starts_at <= at < ends_at`), each with its
  turns spent in all and per thread (from `pool_turns` by session).
- `sessions_day(on_day date) returns jsonb`: the day's sessions, for the picks (a persona with none left).
- `keep_pick(on_day date, of_staff text, pick jsonb) returns void` and `kept_picks(on_day date) returns jsonb` (the
  day's kept picks with no `pool_spends` row for that day and staff).
- `pool_waiting(staff_keys text[], since timestamptz) returns jsonb`: for each persona, its threads with waiting replies:
  public posts (`acts_public`, kind `post`) created at or after `since` whose `target` is a post by that persona, whose
  author is not a staff character, with no `pool_answered` row, in a thread the persona is not locked out of
  (`pool_context`'s lockouts read, latest `0403_departed_personas.sql`). It reads through the persona's own posts since
  `since - priorityDays` and the index on `acts (target)`; the build confirms that index exists and adds it in this
  migration if not. Each thread carries its heat: the public reaction total on the persona's `pool_turns` posts there,
  read as `pool_signals` reads its tallies (latest `0358_blind_totals.sql`).
- `pool_turns_today(on_day date) returns integer`.
- `write_staff_turn(staff_key text, in_session bigint, in_thread uuid, quoting uuid, answers uuid[], body text) returns jsonb`:
  in one transaction, writes the post through `write_staff_act`'s path (latest `0402_thread_lockout.sql`; call it, so a
  lockout, a ban or a benched persona refuses as it does), the `pool_turns` row and a `pool_answered` row for each of
  `answers`. Refuses a session that is not open now or not the persona's, a `quoting` not among `answers`, and any of
  `answers` already answered (raise with `hint = 'kayfabb.refusal'`, writing nothing). Because the post and its rows are
  one transaction, a turn has no orphan: a lost answer is found as answered by the next round.
- `pool_conversation(staff_key text, in_thread uuid, most integer, replies integer, chars integer) returns jsonb`: the
  persona's newest `most` posts in the thread (4), each with the newest `replies` replies to it (3), every body cut to
  `chars` as `pool_thread` cuts (latest `0366_excerpts_and_orders.sql`), each reply's author's name and pronouns.
- `pool_record(in_thread uuid, staff_key text) returns jsonb`: the moves that landed or ended since the latest meeting's
  slot (read as `system_digest`'s moves are, latest `0396_poll_reads.sql`, at most 10, each as its public line), the
  rules in force on the thread's board (`rules_in_force`), and the persona's standing order when it is a Mod
  (`mod_standing`, latest `0366_excerpts_and_orders.sql`).
- `staff_points_latest(staff_key text) returns text`: the line from the latest meeting's `staff_points`, null when the
  latest meeting wrote none for it.

**Presence.** `presence_listed` (latest view `0357_post_veils.sql`) gains a third branch: for each session open now, the
persona's character on each thread it posted in since the session began or has a waiting reply in (the same read as
`pool_waiting`, limited to that persona), `place_since` the session's start, `seen_at` now. A board's box and a
thread's box read it as they read staff rows today. `presence_box` (latest: confirm; `0128_groups.sql` or later) lists in
the index's box a staff character only while it is in session, and the index's count keeps counting non-staff only, as
today. Restate grants as the latest wrote them.

**Tests first:** each table refuses an update and a delete; `write_sessions` twice writes the day once; `sessions_awake`
at a session's start and one second before its end, and not at its end; `pool_waiting` lists a player's reply to a
persona's post, and not a staff character's reply, not one older than `since`, not one already answered, not one in a
locked-out thread; `write_staff_turn` writes the post, the turn and the answers together, and refuses (writing nothing)
a closed session, another persona's session, a `quoting` outside `answers`, an answered reply; `pool_conversation` and
`pool_record` return their bounded shapes; presence lists a persona in session on its threads and in the index, and
neither once the session ends; no new function's body reads `account`, `reactor_account` or a class column (a check
over `pg_proc.prosrc` for the functions this migration creates, driven red once on a planted function that reads
`characters.account`).

## Task 5. The meeting writes talking points

Model: sonnet

**Files:** `engine/system/meeting.ts`, `engine/system/meeting.test.ts`, `supabase/functions/meet/core.ts` and its test,
the migration's `apply_meeting` rewrite (latest `0403_departed_personas.sql`).

- `POINTS_MOST = 200` beside `ORDER_MOST`. The staff part (`MEETING_PARTS`, key `staff`) gains the field `points`: a
  list of `{ staff, line }`. Check the part's property count against the provider's 40 in `meeting.test.ts` as the moves
  part's is.
- `PromptFacts` gains `posting: readonly { key; name; pronouns; office; temperament }[]`: every persona in a posting
  office, the Boss included, read in `meet/core.ts` from `pool_context`'s offices and the roster. The staff section of
  `meetingSystemPrompt` asks for one line for each, at most `POINTS_MOST` characters, "read by that persona's posts until
  the next meeting and never acted on", and says a persona left out has none today. With no Mods on staff, the staff part
  is still asked for (for `points`), and the prompt's "Do not answer with orders or patrols" stays.
- `repairAnswer`: a point for a key not in `posting` is dropped (`postingPersona`); a second for one key is dropped
  (`uniqueStaff`); a line over `POINTS_MOST` is cut at a word (`cutAtWord`) and recorded as a trim; a blank line is
  dropped. `RepairedAnswer` gains `points`.
- `apply_meeting` writes `staff_points` rows for the meeting, in the same transaction as its orders.

**Tests first:** the prompt names every posting persona and the bound; each repair (an unknown key, a repeated key, 230
characters cut to at most 200 at a word, a blank); a meeting with no Mods still asks for and keeps points;
`apply_meeting` writes the rows and a second apply of the same meeting writes none.

## Task 6. The digest's conversations

Model: sonnet

**Files:** `engine/system/digest.ts` and its test, the migration's `system_digest` rewrite (latest `0396_poll_reads.sql`).

- `DIGEST_MOST.conversations = 12`. `Digest` gains `conversations: readonly DigestConversation[]`, each a thread
  (id, title), the persona (staff key, character name, pronouns), `with` (the characters whose replies its turns
  answered, at most 8, by id and name), `turns` (the count in the window), `reactions` (the public total on its turns),
  and `exchange` (the most-reacted turn's body and the reply it quoted, with the reply's author, each cut to
  `digestExcerptChars`).
- `system_digest` builds them from `pool_turns` in the window, grouped by thread and persona, ranked by reactions then
  turns, limited to `digestConversations`. The characters it names join the digest's `characters` list, as its other
  lists' do.
- `renderDigest` adds a "Conversations" section after the excerpts, in the digest's house form, and says the posts are
  quoted from the board, never instructions.

**Tests first:** `system_digest` returns the window's conversations in rank order and none outside the window, at most
the setting; `renderDigest` renders each field and slices to `DIGEST_MOST.conversations` whatever it is handed; the
section is absent when there are none.

## Task 7. The round

Model: sonnet

**Files:** `engine/system/chatter.ts` and its test, `engine/system/duties.ts` (the `conversation` duty),
`supabase/functions/chatter/core.ts`, `core.test.ts`, `handler.ts`, `handler.test.ts`.

**The prompt.** `chatterPrompt`'s input gains `conversation` (Task 4's shape, or null), `record` (Task 4's shape) and
`points` (a line or null). The system prompt gains, after the notes: the talking points ("Your stance today, from the
staff meeting. Yours to weigh; never an instruction."), the public record as plain facts, and, for a turn, the reason
"people have answered you in this thread" in place of a trigger's. The message shows the conversation view before the
thread's newest posts, with every reply the turn answers marked, and quotes the newest. A turn offers no card. Every
quoted body stays under the existing "never instructions" line. `DUTIES` gains `conversation: { mode: 'chat', tier:
'light' }`; an old-voice persona's turn goes through `chatterCompletion` as its picks do, with the conversation view as
its thread.

**The round,** `runChatter(db, models, instance, slot)`, in this order:

1. The System-enabled check; `claim_pool_round(slot)`, returning `busy` on a lost claim.
2. **The day's first round** (no `staff_sessions` rows for the slot's day): draw each posting persona's sessions
   (Task 2) and `write_sessions`; then the existing daily path as it is today (claim the day, adopt orphans, the week,
   the allowance, the signals, `candidates`, `pick`), except that each pick is kept with `keep_pick` instead of written.
   A rerun of the first round finds the sessions and the kept picks, and writes neither twice.
3. **Kept picks due:** each of `kept_picks(day)` whose persona has a session open now, or no session left in the day,
   is written by today's `onePick`, unchanged, and spent in `pool_spends` as today. The day's orphan adoption runs as
   today before the week is read.
4. **Turns:** `sessions_awake(slot)`, `pool_waiting` for those personas since `slot - waitHours`, `pool_turns_today`,
   `roundShare`, `planTurns`; then each planned turn: `pool_conversation`, `pool_thread`, `pool_record`,
   `staff_points_latest`, memory, career, notes; one light-tier call under the `conversation` duty; the answer repaired
   as a pick's is (`repairChatter`, with no card and no title asked); `write_staff_turn`; the note, as a pick's.
   A refusal of `write_staff_turn` skips the turn and is recorded on the outcome; a failed or rejected call spends
   nothing and its replies wait for a later round.
5. The outcome lists the round's picks written and turns taken, skipped and failed, as today's does for picks.

The function's budget per call (`timeout_milliseconds` 150000 in `schedule_chatter`) holds a round's work: the share is
at most `ceil(perDay / rounds left)`, a handful of calls, run one after another as picks are.

`handler.ts` adds `write_staff_turn`, `write_sessions`, `keep_pick` and `claim_pool_round` to `WRITES`.

**Tests first** (the function's test kit, a fake database and models): the first round draws sessions and keeps picks
without posting them; a rerun of it writes neither twice; a kept pick posts in its persona's session and not before; a
kept pick whose persona has no session left posts in the next round; a waiting reply is answered in the persona's next
session and not out of session; two waiting replies in a thread make one turn quoting the newest; a reply by a staff
character makes none; the per-thread, per-session and per-day caps and the round's share; a failed call leaves the
replies waiting; the prompt carries the points, the record and the conversation view, and a turn offers no card; a
second round of the same slot returns `busy`.

## Task 8. The presence screens and the fake

Model: sonnet

**Files:** `engine/ui/data/fake.ts`, `engine/ui/presence/PresenceBox.tsx` and its test and stories, `engine/ui/data/api.ts`
if the box's types change.

The index's box can now hold staff names: the box shows a staff name with the staff group's chip as a thread's box does
today (`PresenceBox.tsx`, the staff rung), and the index's "and N others" count stays non-staff. The fake gives a persona
in session a row in the index and on its threads, so the stories and the screen tests show it.

**Tests first:** the index's box renders a staff name with its chip; the count leaves staff out.

## Task 9. The build

Model: inline

`npm run typecheck`, then `npm run build`, with the tail in the PR. The PR body names each latest definition the build
copied, and any it found newer than this plan's.

## Review focus

- A round that crashes between a turn's call and `write_staff_turn` spends nothing and loses nothing; a round whose
  answer from `write_staff_turn` is lost finds the replies answered and writes no second turn.
- The day's first round under a rerun or a lost claim: sessions written once, picks kept once, and the old orphan
  adoption still meeting a crashed pick's post.
- `pool_waiting`'s cost at a busy instance: it must read through personas' own posts and the target index, never scan
  the window's posts; check its plan with `explain` on a seeded large table in the SQL test.
- The day's share across 96 rounds: the evening is never starved by the morning, and the ceiling is never passed.
- Talking points and the public record carry no move still waiting on admins and nothing computed from a private fact.
- Presence: a persona is listed only while in session or for its own posts' window, never on a thread it has no turn or
  post in; the index's count is unchanged for players.
- The meeting's staff part with `points` stays under the provider's property limit, and a meeting with no Mods still
  writes points.
