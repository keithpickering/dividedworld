Record, written 2026-11-22.

# A Mod writes its quiz question for each visit: plan

Carries out `docs/plans/2026-11-22-written-quiz-design.md`. One PR from `main`.

Every task goes test first: write the failing test, record its red run, then the code. During a task, run only the
tests for the changed code: `npm run test:sql` for the SQL (it replays every migration into a scratch database on the
local Postgres `DATABASE_URL` names), `node --experimental-strip-types --test <file>` for the engine's, the staff
function's and the instance's tests, `npx vitest run <file>` for the screens' and the fake's. Run `npm run typecheck`
and `npm run build` once after the last task, with the tail in the PR. No deployed database, bucket, connector or model
provider is touched; every model call in a test goes to a fake.

The migration is one file, `supabase/migrations/NNNN_written_quiz.sql`, NNNN the next free number on `main` when the
build starts (0408 when this plan was written). Each function it rewrites is copied from its **latest** definition,
which the build confirms before copying (`grep -lE "function (public\.)?<name>\(" supabase/migrations/*.sql | tail -1`);
the latest named below is as of this plan, and a later migration on `main` wins. Each rewrite opens with
"`<name>` (`<latest>`), <what changes>. Everything else as `<latest>` wrote it."

**The rule, whole.** A quiz visit's question lives in a `visit_quizzes` row, written once: by the staff run from a
light-tier call in the Mod's voice (`model`), or from the persona's bank (`bank`) when the call fails, is rejected, the
day's `quizQuestionsPerDay` is spent, the System is off, or `quizWriteMinutes` has passed. Until the row exists the
quiz is pending, the page says so, and `intercept` refuses a quiz answer.

**The layers.** Engine: the duty, its prompt and repair, the table, the reads, the settings and their checks, the staff
run, the page's pending note, the fake. Instance: an optional `quizBrief` on each Divided World quiz persona.

**The masks.** The call reads only what every reader sees (the post as shown, the author as shown, the thread's title,
the charge). The pending note, question and choices are the same for every reader. Nothing reads who owns a character,
a class or who reacted.

**States.** One: a quiz pending. Its way out: the tick's bank fallback at `quizWriteMinutes` (Task 1), and every way a
visit already ends.

**Scale.** The design, section 4.

**Visits already held.** A quiz visit opened before the migration has no row. The migration writes each open quiz
visit's bank question into `visit_quizzes` (source `bank`) from its stored `question_index`, so none becomes pending.
Ended visits are given rows the same way, so `visit_quiz()` answers for them as before.

## Task 1. The database: the question kept with the visit

Model: sonnet

**Files:** the new migration; `supabase/tests/NNNN-written-quiz.sql` (new).

- **`visit_quizzes`**: `visit_act uuid primary key references acts (id)`, `source text not null check (source in
  ('model', 'bank'))`, `question text not null check (btrim(question) <> '')`, `choices jsonb not null` (an array of
  2 to 4 distinct strings), `answer text not null check (choices ? answer)`, `at timestamptz not null default now()`.
  RLS on, every grant revoked from public, anon and authenticated. Append-only: an update, delete or truncate trigger
  refuses, enabled always, as `appeal_refunds` (`0109_appeals.sql`) does.
- **Pending visits are found by an index:** a partial index or a `visits_open` column that lets the staff run and the
  tick read "open quiz visits with no row" in order of their start without reading every open visit. Choose one and
  say which in the PR.
- **`write_visit_quiz(visit, source, question, choices, answer)`**, service only: inserts the row once. A second
  write for the same visit returns the row that stands and writes nothing (a staff run and the tick can race). It
  refuses a visit that is not a quiz visit.
- **`bank_quiz_for(visit)`**, service only: the bank question for the visit, by its stored `question_index`, from
  `staff_quiz_questions`.
- **`pending_quizzes(most)`**, service only: the open quiz visits with no row, oldest first, with what the call needs
  (Task 3): the visit, its Mod's key, the post, the thread, the board and the charges.
- **The tick** (`system_tick`, latest `0403_departed_personas.sql`): whatever the switch says, writes the bank question
  for each pending quiz visit whose start is `modBots.quizWriteMinutes` or more in the past. Best effort per visit:
  one that fails is warned and left for the next tick.
- **`visit_quiz(visit)`** (latest `0368_client_reads_plan_once.sql`): reads `visit_quizzes` for the question and
  choices. A quiz visit with no row answers `{"pending": true}`. It never answers `answer` or `source`.
- **`intercept`** (latest `0108_interception.sql`, confirm): a quiz answer reads `visit_quizzes`. With no row it
  refuses `the question is still being written; try again in a few minutes` (`hint = 'kayfabb.refusal'`, `errcode =
  '55000'`) before anything is written, and the character's one try is not spent.
- **The migration's backfill:** a bank row for every quiz visit, open or ended, from its `question_index`.
- **The settings:** `modBots` gains `quizQuestionsPerDay` (a whole number, at least 0; 0 means the bank always) and
  `quizWriteMinutes` (a whole number, at least 1). The SQL check of `modBots` (latest `0362_patrol_weights.sql`,
  confirm) learns both, in its `wholes`, `fields` and `shape`.
- **`quiz_calls_today()`**, service only: the ledger's `quizQuestion` calls today, as `filing_calls_today` (`0106_mod_moves.sql`) counts the filing lines.

**Tests first** (`supabase/tests/NNNN-written-quiz.sql`):

1. A quiz visit opens with no row; `visit_quiz` answers `{"pending": true}`; `intercept` with a quiz answer is refused
   with the message, and no `intercept` Act, tail or wallet move is written; the same character can try again later.
2. `write_visit_quiz(..., 'model', ...)`: `visit_quiz` answers the question and choices and no `answer`; a right answer
   intercepts; a wrong one tails, as today.
3. A second `write_visit_quiz` for the same visit writes nothing and answers the first row.
4. The tick, with `quizWriteMinutes = 15`: a pending visit 14 minutes old stays pending; at 15 minutes the bank row is
   written, with the switch on and with it off.
5. A reseed that changes the persona's bank leaves a visit's row as it was.
6. The backfill: a quiz visit opened before the migration (made in the test the way 0108's tests make one) has a bank
   row after it, open and ended alike.
7. `visit_quizzes` refuses an update and a delete. No client role can read it.
8. The `modBots` check refuses a missing or negative `quizQuestionsPerDay` and a `quizWriteMinutes` of 0, each naming the field.

## Task 2. The engine: the duty, its prompt and its repair

Model: sonnet

**Files:** `engine/system/duties.ts`, `engine/system/judgment.ts` (or a new `engine/system/quiz.ts` beside it, if the
build finds judgment.ts the wrong home; say which), `engine/rules/types.ts`, `engine/rules/instance.ts`,
`engine/rules/test-system.ts`, and their tests.

- **The duty:** `quizQuestion` joins `DUTIES`, with `DUTY_SPECS.quizQuestion = { mode: 'chat', tier: 'light' }`. It
  is written by the visit's own Mod (the visit Act's character), whoever is on the board's beat now. The instance's
  `duties` map must name every duty, so `instances/divided-world/system/index.ts` gains `quizQuestion: 'filer'` if
  `filer` resolves to the Mod that made the act in question (as `appeal: 'filer'` does); confirm from `staffFor`'s
  callers, and if no assignee word means "the visit's Mod", add one and list it under `Plan gaps`.
- **The settings type:** `Settings['modBots']` gains `quizQuestionsPerDay` and `quizWriteMinutes`; the TypeScript
  check in `instance.ts` (`MOD_BOTS_WHOLE`, its `shape` sentence) learns both, worded as the SQL check is.
- **The persona type:** the quiz `Weakness` gains an optional `quizBrief: string` (at most 300 characters, checked in
  `instance.ts` with the persona's name in the message).
- **`quizPrompt(input)`**: `{ system, message, schema }`, as `filingPrompt` is. The system is the Mod's `selfPrompt`.
  The message gives the post as shown, its author as shown, the thread's title, the board's name and the charge's rule
  words (`ruleWords`), then the brief (`quizBrief`, else the persona's `tastes`) and the task: one multiple-choice
  question about this post and why it broke this rule, answerable by reading the post, judged by the Mod's own
  standard, with two to four short choices and the one the Mod thinks is right. The schema is `{ question: string,
  choices: string[], answer: string }`.
- **`repairQuiz(raw)`**: answers `{ ok: true, question, choices, answer, trims }` or `{ ok: false, why }`.
  - Trims: `question` cut to `QUIZ_QUESTION_MOST` (200) and each choice to `QUIZ_CHOICE_MOST` (80), at a word
    boundary where one is near; choices trimmed of whitespace; exact duplicates merged; a fifth and later choice dropped
    if the answer is still among the first four, else the extra choices other than the answer are dropped from the end.
    Each trim is named in `trims`.
  - Rejections, each naming its predicate: the shape is not an object of the three fields; the question is empty after
    trimming; fewer than two distinct choices remain; the answer is not one of the choices (compared after the same
    trim).
- **Tests first:** the prompt carries the post as given and never a field the input lacks; each trim and each rejection
  above, one case each; a well-formed answer passes unchanged with no trims.

## Task 3. The staff run writes the questions

Model: sonnet

**Files:** `supabase/functions/staff/core.ts` (or a new `supabase/functions/staff/quiz.ts` beside `patrol.ts`; say
which), `supabase/functions/staff/handler.ts`, and their tests.

- **`runQuizzes(db, models, instance, slot)`**, called by the handler before `runFilings` (a question is wanted
  sooner than a filing line): reads `pending_quizzes(QUIZZES_PER_RUN)` (QUIZZES_PER_RUN = 10) and
  `quiz_calls_today()`, then for each, oldest first:
  - If the System is off, the Mod is no longer a Mod or not in the roster, or the day's `quizQuestionsPerDay` is spent:
    write the bank question (`bank_quiz_for`, then `write_visit_quiz(..., 'bank', ...)`), with the reason on the
    record.
  - Otherwise: read the post as readers see it. `pool_thread` (latest `0366_excerpts_and_orders.sql`) reads
    `current_payload`; confirm whether that carries the layers a card puts over a post (a redaction, a splat, an
    autocorrect, a veil's stand-in author). If it does not, read through the projection the thread page uses, and list
    it under `Plan gaps`. Build the prompt (Task 2), call `models.complete` with duty `quizQuestion` on the light tier,
    and repair the answer. A repaired answer is written as `model`; a rejection, a failure or a transport error that
    survives the client's own retries is written as `bank`.
  - Every call lands in the ledger, and each visit's outcome is recorded with `record_staff_call` (`cause_act` the
    visit, duty `quizQuestion`, `record: { source, why?, trims, calls }`), as the filing run records its lines.
- A visit whose row another writer wrote first (the tick) is skipped: `write_visit_quiz` answers the standing row.
- **Tests first** (with the fake model and the fake db the filing tests use): a pending visit gets a `model` row from
  a good answer; a rejected answer gives a `bank` row with the predicate on the record; a spent budget and a System
  switched off give `bank` rows with no call made; a post with a redaction is sent to the model as readers see it, and
  the hidden words appear nowhere in the prompt; a veiled post's author is the stand-in in the prompt.

## Task 4. The page, the API, the fake

Model: sonnet

**Files:** `engine/ui/data/api.ts`, `web/src/data/supabase.ts`, `engine/ui/data/fake.ts`, `engine/ui/cards/visit.ts`,
`engine/ui/cards/Visit.tsx`, `engine/ui/cards/Visit.board.stories.tsx`, and their tests.

- `VisitChallenge`'s quiz case gains a pending form: `{ kind: 'quiz'; pending: true }` beside `{ kind: 'quiz';
  question; choices }`. The web client maps `{"pending": true}` to it.
- The Visit Lens shows a pending quiz as the Mod's words in the board's house style, one line, with no answers to
  press: "`{mod}` is writing a question. Check back in a few minutes." Bribe and distraction are unchanged. The words
  are the board's, in character, and are the owner's to approve in review.
- The fake seeds a quiz visit pending or written, and answers `intercept` on a pending one with the same refusal.
- A story, `QuizPending`, beside `Quiz`.
- **Tests first:** the pending Lens renders the line and no buttons; a written quiz renders as today; the web client
  maps both shapes.

## Task 5. Divided World's briefs

Model: sonnet

**Files:** the quiz personas' files under `instances/divided-world/system/personas/` (each whose `weakness.kind` is
`quiz`: confirm the list at build time), `instances/divided-world/settings.ts`, `instances/divided-world/system/index.ts`
(the duty's assignment), `instances/divided-world/system/system.test.ts`.

- Each quiz persona gains a `quizBrief` drafted from its own `temperament`, `tastes` and `persuadedBy`: ONTOPIC 5.0's
  asks whether the post belongs where it was posted, by her standard (on the Pointless Post Palace, pointlessness is the
  topic); QC-1000's asks about the post's craft; FanGaME's about whether it is a Mario fangame. Each is a draft for the
  owner, marked so in a comment, at most 300 characters.
- `settings.ts`: `quizQuestionsPerDay: 60`, `quizWriteMinutes: 15` in `modBots`.
- **Tests first:** every roster persona with a quiz weakness has a brief within its bound; the settings hold the two
  values.

## Task 6. The build

Model: inline

`npm run typecheck`, `npm run build`, `npm run test:sql`, `npm run test:engine` and `npx vitest run engine/ui/cards`,
with the tails in the PR. The PR body lists the briefs and the pending line for the owner's approval.

## Review focus

- The answer never reaches a page: `visit_quiz`, every read that embeds a visit, the fake and the API types.
- The model never sees a hidden word or a hidden author: the post read the staff run uses, against a redaction, a splat,
  an autocorrect and a veil.
- Pending always ends: the tick's fallback runs with the System off, with the Mod gone from staff, and when a staff run
  dies mid-call.
- A staff run and the tick writing the same visit's row at once: one row, and the run records the outcome it lost to.
- The day's count: a retried call is counted once, and a spent budget stops the calls, not the questions.
- The backfill on an instance with quiz visits already open, and `intercept` on one of them right after the migration.
- What a pending quiz does to a reader who opened the Lens before the question arrived: the page's next read shows the
  question, and nothing is answered against the wrong one.
