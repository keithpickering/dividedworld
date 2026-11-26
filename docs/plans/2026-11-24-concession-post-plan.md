Record, written 2026-11-24.

# A talked-down Mod posts its concession in the thread: plan

Carries out `docs/plans/2026-11-24-concession-post-design.md`. One PR from `main`, **built after the written-quiz plan**
(`docs/plans/2026-11-22-written-quiz-plan.md`, in PR #1002 when this was written) has merged and been built: this
plan extends what that one adds (`visit_quizzes`, `pending_quizzes`, `runQuizzes`, `quizPrompt`, `repairQuiz`, the
`quizQuestion` duty). A build session that finds it unbuilt stops and says so.

Every task goes test first: write the failing test, record its red run, then the code. During a task, run only the
tests for the changed code: `npm run test:sql` for the SQL (it replays every migration into a scratch database on the
local Postgres `DATABASE_URL` names), `node --experimental-strip-types --test <file>` for the engine's, the staff
function's and the instance's tests, `npx vitest run <file>` for the screens' and the fake's. Run `npm run typecheck`
and `npm run build` once after the last task, with the tail in the PR. No deployed database, bucket, connector or model
provider is touched; every model call in a test goes to a fake.

The migration is one file, `supabase/migrations/NNNN_concession_post.sql`, NNNN the next free number on `main` when the
build starts. Each function it rewrites is copied from its **latest** definition, which the build confirms before
copying (`grep -lE "function (public\.)?<name>\(" supabase/migrations/*.sql | tail -1`); the latest named below is as of
this plan, and the written-quiz migration or any later one wins. Each rewrite opens with "`<name>` (`<latest>`), <what
changes>. Everything else as `<latest>` wrote it."

**The rule, whole.** Each visit may have a written concession, kept unread in `visit_concessions`: written by its Mod's
opening call (a quiz Mod's `quizQuestion` call, or a `concession` call for every other Mod and for an old-voice
persona), or written empty (`none`) when the call fails, is rejected, is over its cap, the System is off, or its window
passed. When an interception succeeds, the visit ends as today, then the Mod's character posts in the visit's thread,
quoting the visited post: the written concession, else a line drawn from the persona's `concessions`, with `{who}`
filled by the interceptor's character's name. One concession post per visit, best effort, never failing the talk-down.

**The layers.** Engine: the duty, its prompt and repair, the tables, the post, the settings and their checks, the
staff run, the Lens's link. Instance: each Divided World persona's `concessions`.

**The masks.** The call reads only what every reader sees (the written-quiz plan's post read). The post names the
interceptor's character, which its own `intercept` Act already names publicly; it never reads an account. Whether a
post lands turns only on the Mod's character (benched, gone, locked out) and the visit, never on any owner. The
written concession is never sent to a page before it is posted.

**States.** None added. A visit with no concession row is not a state a player sees: its talk-down posts the stock.

**Scale.** The design, section 6.

**Visits already held.** A visit opened before the migration has no concession row. The migration writes a `none` row
for every visit, open or ended, so no staff run calls for an old visit and an open one talked down posts its stock.

## Task 1. The database: the concession kept, and posted at the talk-down

Model: sonnet

**Files:** the new migration; `supabase/tests/NNNN-concession-post.sql` (new).

- **`visit_concessions`**: `visit_act uuid primary key references acts (id)`, `source text not null check (source in
  ('model', 'none'))`, `body text` (`not null` and not blank exactly when `source = 'model'`; at most 280 characters),
  `why text` (the reason for a `none`), `at timestamptz not null default now()`. RLS on, every grant revoked from
  public, anon and authenticated; append-only by update, delete and truncate triggers enabled always, as
  `visit_quizzes` (the written-quiz migration) and `appeal_refunds` (`0109_appeals.sql`) are.
- **`visit_concession_posts`**: `visit_act uuid primary key references acts (id)`, `source text not null check
  (source in ('model', 'stock'))`, `post_act uuid references acts (id)` (null when the post was refused), `error
  text` (the refusal, when it was), `at`. Same grants and append-only triggers. Its primary key is the "one post per
  visit" guard. Only an admin reads it (no client role), as `visit_draw_failures` (`0105_visits.sql`).
- **`write_visit_concession(visit, source, body, why)`**, service only: inserts once; a second write returns the
  standing row and writes nothing. It writes nothing (returns `{written: false, ended: true}`) for a visit that has
  ended, so a late call is never posted and never kept.
- **`pending_concessions(most)`**, service only: open visits with no `visit_concessions` row whose challenge is not a
  quiz (a quiz visit's concession comes with its question, from `pending_quizzes`), started less than
  `modBots.concessionWriteMinutes` ago, oldest first, with what the call needs: the same columns `pending_quizzes`
  answers. Read by an index on open visits with no row (as the written-quiz plan's pending index; say which form).
- **The tick** (`system_tick`, latest: the written-quiz migration's): whatever the switch says, writes a `none` row
  (`why` `window`) for each open visit with no concession row whose start is past its window (`quizWriteMinutes` for a
  quiz visit, `concessionWriteMinutes` for any other). Where the written-quiz tick writes a quiz's bank row, it writes
  the `none` concession row in the same step. Best effort per visit, as that tick is.
- **`post_concession(visit, interceptor)`**, internal (no grant to any client role, executed only by the two callers
  below): reads the visit's Mod (the visit Act's character) and its `staff` key; the body is the `model` row's body,
  else a line of `staff_concessions` (below) for that key, drawn by `hashtextextended(visit::text, 0)` modulo the
  count; `{who}` replaced by the interceptor's `characters.name` (`replace`, so a name containing `{who}` is not
  filled again). It writes the post with `write_staff_act(key, 'post', thread, visited_post, {body})` inside a
  `begin ... exception when others` block, and records the outcome in `visit_concession_posts` either way (a refusal's
  message in `error`, `post_act` null, and a `raise warning`). A visit already in `visit_concession_posts` posts
  nothing. A Mod with no stock line and no written body posts nothing and records `error` `no concession`.
- **`staff_concessions(staff, idx, line)`**, seeded from each persona's `concessions` as `staff_quiz_questions` is
  from its questions (find the seeder: `supabase/functions/_shared/seed.ts`, and the SQL it calls). No client reads it.
- **`intercept`** (latest `0108_interception.sql`, or the written-quiz migration's, confirm): after a successful
  interception's `end_visit` answers `ended: true`, calls `post_concession(visit, through)`.
- **`distract_visits`** (latest `0108_interception.sql`, confirm): after each `end_visit` that answers `ended: true`,
  calls `post_concession(v.id, caster)`.
- **The settings:** `modBots` gains `concessionsPerDay` (a whole number, at least 0; 0 means the stock always) and
  `concessionWriteMinutes` (a whole number, at least 1). The SQL check of `modBots` (latest: the written-quiz
  migration's, confirm) learns both, in its `wholes`, `fields` and `shape`.
- **`concession_calls_today()`**, service only: the ledger's `concession` calls today, as `quiz_calls_today` counts.

**Tests first** (`supabase/tests/NNNN-concession-post.sql`):

1. A quiz visit with a `model` concession, answered right: the visit ends `intercepted`; one `post` Act by the Mod in
   the visit's thread, quoting the visited post, its body the concession with `{who}` the interceptor's name; one
   `visit_concession_posts` row `model` naming it.
2. A bribe visit with no concession row, paid: the post is a stock line of that persona's, `{who}` filled; the row says
   `stock`. The same visit id draws the same line on a second database (the hash).
3. A distraction (a card cast at thread reach): the same as 2 through `distract_visits`, by the caster's name.
4. A wrong quiz answer, a filing, a trap, a reversal and a drop each write no concession post.
5. `write_visit_concession` after the visit was talked down writes nothing; the thread holds one concession post.
6. A Mod's character locked out of the thread: the interception still succeeds and ends the visit, the tail and wallet
   are as today, no post is written, and the row holds the refusal. The same with the persona benched.
7. A name holding `{who}` is put in once.
8. `pending_concessions` answers a bribe visit 14 minutes old and not one 15 minutes old, nor any quiz visit; the
   tick, with the switch on and off, writes `none` past the window.
9. The backfill: a visit opened before the migration has a `none` row, open and ended alike; talked down, it posts its
   stock.
10. `visit_concessions`, `visit_concession_posts` and `staff_concessions` refuse an update and a delete and no client
    role can read them.
11. The `modBots` check refuses a missing or negative `concessionsPerDay` and a `concessionWriteMinutes` of 0, each
    naming the field.
12. A player's reply to the concession post is found waiting by `pool_waiting_in_thread` for that Mod (latest
    `0421_whole_posts.sql`, confirm), with nothing changed in it.

## Task 2. The engine: the duty, the prompts, the repair, the persona's lines

Model: sonnet

**Files:** `engine/system/duties.ts`, the file the written-quiz plan put `quizPrompt` and `repairQuiz` in (say which),
`engine/rules/types.ts`, `engine/rules/instance.ts`, `engine/rules/test-system.ts`, and their tests.

- **The duty:** `concession` joins `DUTIES`, with `DUTY_SPECS.concession = { mode: 'chat', tier: 'light' }`, assigned
  as the written-quiz plan assigned `quizQuestion` (the visit's own Mod). An old-voice persona's concession call uses
  the old voice's completion path under the same duty, as `filing` does (`filingCompletion` in
  `supabase/functions/staff/core.ts`'s imports): confirm whether `DUTY_SPECS` must say so and follow `filing`'s shape.
- **The persona type:** `Persona` gains `concessions: readonly string[]` (required, as every persona carries every
  field a Mod has). `instance.ts` checks it: 3 to 8 lines, each non-blank and at most `CONCESSION_MOST` (280)
  characters, no brace token but `{who}`, each message naming the persona.
- **`quizPrompt`** gains the concession in its task and schema: `{ question, choices, answer, concession }`, the
  concession described as what the Mod posts in the thread if someone talks it down, quoting the post, with `{who}`
  for whoever did, at most 280 characters, in its own voice.
- **`concessionPrompt(input)`**: `{ system, message, schema }` from the same input as `quizPrompt` (post as shown,
  author as shown, thread title, board, charge's rule words, the Mod's `selfPrompt`) plus how the Mod is talked down
  (paid, or distracted by a card), schema `{ concession: string }`. **`concessionCompletion(input)`** for the old
  voice, shaped as `filingCompletion`.
- **`repairConcession(raw)`**: `{ ok: true, body, trims }` or `{ ok: false, why }`. Trims: whitespace; cut to 280 at a
  word boundary where one is near; each `{token}` other than `{who}` loses its braces. Rejected: not a string, or
  blank after trims (`why` names the predicate).
- **`repairQuiz`** takes the concession apart from the question: the answer's `concession` is repaired by
  `repairConcession`, and a rejected or missing one rides out as `concession: null` with its predicate in `trims`; the
  question's own checks are unchanged, and a rejected question leaves a good concession standing.
- **Tests first:** each trim and rejection above, one case each; a quiz answer with a broken concession keeps its
  question and vice versa; the persona check refuses 2 lines, 9 lines, a blank line, a 281-character line and a
  `{name}` token; the prompts carry only the fields their input has.

## Task 3. The staff run writes the concessions

Model: sonnet

**Files:** `supabase/functions/staff/` (the file the written-quiz plan put `runQuizzes` in, or a new `concession.ts`
beside it; say which), `supabase/functions/staff/handler.ts`, and their tests.

- **`runQuizzes`** writes the concession its answer carries: after `write_visit_quiz`, `write_visit_concession(visit,
  'model', body)` when the repaired answer has one, else `'none'` with the predicate as `why`. Where it writes a bank
  question (budget spent, System off, Mod gone, a failure), it writes `none` with that reason. An old-voice quiz Mod
  makes its question on the chat call, as the written-quiz plan says, and its concession on a `concession`
  completion call, counted under `concessionsPerDay`.
- **`runConcessions(db, models, instance, slot)`**, called by the handler after `runQuizzes` and before `runFilings`:
  reads `pending_concessions(CONCESSIONS_PER_RUN)` (10) and `concession_calls_today()`, then for each, oldest first:
  the System off, the Mod gone from staff or the roster, or the cap spent writes `none` with the reason and makes no
  call; otherwise the post as readers see it (the same read `runQuizzes` uses), `concessionPrompt` (or
  `concessionCompletion` for the old voice), the call, `repairConcession`, and `model` or `none`. Every call lands in
  the ledger; each outcome is recorded with `record_staff_call` (`cause_act` the visit, duty `concession`, `record: {
  source, why?, trims, calls }`). A visit already ended or already written is skipped by what
  `write_visit_concession` answers.
- **Tests first** (the fake model and fake db the quiz tests use): a bribe visit gets a `model` row; a rejected answer
  a `none` row with the predicate; a spent cap and a switched-off System `none` rows with no call; a quiz answer's
  concession is written beside its question, and a broken one is `none` while the question is `model`; a post with a
  redaction reaches the concession prompt as readers see it.

## Task 4. The Lens links the post, the API and the fake

Model: sonnet

**Files:** `engine/ui/data/api.ts`, `web/src/data/supabase.ts`, `engine/ui/data/fake.ts`, `engine/ui/cards/visit.ts`,
`engine/ui/cards/Visit.tsx`, `engine/ui/cards/Visit.board.stories.tsx`, and their tests; the read that serves a
visit's "How it went" rows (find it from `engine/ui/cards/visit.ts`'s callers) and, if it is SQL, its latest
migration.

- The visit's end, when intercepted, carries the concession post's id if one was posted (from
  `visit_concession_posts.post_act`; never its `error` or `source`, which stay admin-only). The "Talked down" row
  links to that post ("{mod} posted a reply"), as other Lens rows link a post. With no post, the row is as today.
- The fake's interception writes a concession post in its thread the same way, from a seeded written concession or a
  seeded stock line.
- A story, `TalkedDownWithReply`.
- **Tests first:** the intercepted row renders the link when the id is present and no link when absent; the web
  client maps the field; the fake's interception adds one post to the thread quoting the visited post.

## Task 5. Divided World's concessions and settings

Model: sonnet

**Files:** every persona under `instances/divided-world/system/personas/` (`fangame.ts`, `ontopic.ts`,
`quality-control.ts` when this was written: confirm the roster), `instances/divided-world/settings.ts`,
`instances/divided-world/system/index.ts` (the `concession` duty's assignment), `instances/divided-world/system/system.test.ts`.

- Each persona gains `concessions`: five lines drafted from its `selfPrompt`, `temperament` and `persuadedBy`, each a
  grudging, in-character climb-down that reads well quoting the visited post, most using `{who}`. ONTOPIC 5.0 concedes
  on topicality, QC-1000 on craft, FanGaME on whether it is a fangame, each in its own register. Marked in a comment as
  drafts for the owner's approval.
- `settings.ts`: `concessionsPerDay: 60`, `concessionWriteMinutes: 15` in `modBots`.
- **Tests first:** every roster persona's `concessions` passes the instance check; the settings hold both values.

## Task 6. The build

Model: inline

`npm run typecheck`, `npm run build`, `npm run test:sql`, `npm run test:engine` and `npx vitest run engine/ui/cards`,
with the tails in the PR. The PR body lists the drafted concessions for the owner's approval.

## Review focus

- A written concession never reaches a page before it is posted: `visit_concessions` grants, every read that embeds a
  visit, the fake and the API types; `visit_concession_posts.error` never reaches one at all.
- One post per visit: a quiz answered right racing a distraction on the same visit, a talk-down racing a late
  `write_visit_concession`, and two interceptions in one statement.
- The talk-down never fails with the post: a refused `write_staff_act` (lockout, benched, a No quote on the visited
  post, a quote trap springing) inside `post_concession`'s exception block rolls back only the post, and the intercept
  Act, the visit's end, the tail and the wallet stand.
- What the concession post does to the chattier-staff turns: a reply to it waits for the Mod, and nothing counts the
  post as a turn or spends a turn bound.
- A cost that grows with a busy instance: `concessionsPerDay` bounds the new calls; a retried call is counted once.
- The backfill on an instance with visits open, and a talk-down on one right after the migration.
