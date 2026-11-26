Record, written 2026-11-26.

# A Mod's outcome is a post in the thread: plan

Carries out `docs/plans/2026-11-26-outcome-posts-design.md`. One PR from `main`, built on #1191 (the concession post,
`supabase/migrations/0449_concession_post.sql`), which is merged.

Every task goes test first: write the failing test, record its red run, then the code. During a task, run only the
tests for the changed code: `npm run test:sql` for the SQL (it replays every migration into a scratch database on the
local Postgres `DATABASE_URL` names), `node --experimental-strip-types --test <file>` for the engine's, the staff
function's and the instance's tests, `npx vitest run <file>` for the screens' and the fake's. Run `npm run typecheck`
and `npm run build` once after the last task, with the tail in the PR. No deployed database, bucket, connector or model
provider is touched; every model call in a test goes to a fake.

The migration is one file, `supabase/migrations/NNNN_outcome_posts.sql`, NNNN the next free number on `main` when the
build starts. Each function it rewrites is copied from its **latest** definition, which the build confirms before
copying (`grep -lE "function (public\.)?<name> ?\(" supabase/migrations/*.sql | tail -1`, and for `thread_page` also
`grep -l "FUNCTION public.thread_page" supabase/migrations/*.sql | tail -1`, since its latest is written in that
form). The latest named below is as of this plan. Each rewrite opens with "`<name>` (`<latest>`), <what changes>.
Everything else as `<latest>` wrote it."

**The rule, whole.** Three outcomes post in the thread as the Mod's staff character, quoting the affected post:

- a visit **filed**: at once, in `file_visit`, the line the filing call wrote, else the `visitFiled` stock line;
- a visit **talked down** (a quiz answered right, a bribe paid, a distraction): the talk-down records the concession as
  owed; the next staff run writes it from the thread and the facts of the talk-down, and posts it; past
  `concessionWriteMinutes` the tick posts a line from the persona's `concessions`;
- an appeal **ruled on**, when its punishment is an infraction (it has a post): at once, in `close_appeal`, the
  ruling's line, else the stock appeal line. A ban's or a group move's ruling posts nothing, as today.

The post's body is the line, at most `min(postMaxLength, 2000)` characters. One outcome post per outcome, best effort:
a refused post leaves the outcome standing and is recorded for an admin. The outcome post carries the visit's mark,
and the Lens's row for the outcome is that post.

**The layers.** Engine, all of it. Divided World changes nothing: its personas' `visitFiled`, appeal stock lines and
`concessions` are the fallbacks.

**The masks.** Every call reads only what readers see: the thread as `judgedRead` returns it, public Acts, the staff
character's own memory and career. A post names a character, never an account. When a post lands depends on the
outcome and the staff run's clock; whether it lands depends only on the Mod's character and the thread. The refusal
record (`outcome_posts.error`) has no client grant and reaches no page. The new public read returns only public post
ids for a public visit.

**States.** None a player can be put in. An owed concession is not shown, and it ends by itself, as a post, within
`concessionWriteMinutes` and a tick.

**Scale.** The design, section 10.

**Outcomes already held.** No post is made for an outcome that ended before the migration (design, section 8). The
migration copies each `visit_concession_posts` row into `outcome_posts`. A visit open at the migration and talked down
after it owes a concession like any other; its #1191 `visit_concessions` row is not read.

## Task 1. The database: outcome posts, the owed concession, the page

Model: sonnet

**Files:** the new migration; `supabase/tests/NNNN-outcome-posts.sql` and `supabase/tests/NNNN-outcome-posts-race.sql`
(new); `supabase/tests/0005-default-deny.sql`, `supabase/tests/0305-veil-sweep.sql`, `tools/check-web-reads.mjs`,
`supabase/tests/e2e/0003-export.ts` (lists); the `0449-concession-post*.sql` tests where they assert what this
replaces.

- **`outcome_posts`**: `about_act uuid primary key references acts (id)` (a `visit_end` or an `appeal_ruling`),
  `kind text not null check (kind in ('filed', 'intercepted', 'ruling'))`, `visit_act uuid references acts (id)` (the
  visit the outcome belongs to; for a ruling, its infraction's `visit_act`, null when it has none), `source text not
  null check (source in ('model', 'stock'))`, `post_act uuid references acts (id)`, `error text`, `at timestamptz not
  null default now()`; exactly one of `post_act` and `error` (as `visit_concession_posts`). RLS on, every grant revoked;
  append-only by update, delete and truncate triggers, as `visit_concession_posts` (0449). Indexes on `post_act` and
  `visit_act`. Its primary key is the one-post guard.
- **`concessions_owed`**: `visit_act uuid primary key references acts (id)`, `end_act uuid not null references acts
  (id)`, `interceptor uuid not null references characters (id)`, `how text not null check (how in ('answered', 'paid',
  'distracted'))`, `intercept_act uuid references acts (id)` (the `intercept` Act, or the distraction's cast), `at
  timestamptz not null default now()`. Same grants and triggers. Owed and unpaid: a row with no `outcome_posts` row for
  its `end_act`; an index on `at`.
- **`post_outcome(about, kind, visit, staff_key, thread, target, body, source)`**, internal (no role has execute):
  returns early when `outcome_posts` holds `about`; else, inside its own `begin … exception`, `write_staff_act(staff_key,
  'post', thread, target, jsonb_build_object('body', left(body, post_max)))`, `post_max` the instance's `postMaxLength`,
  and records the post or the error. It never raises. #1191's `post_concession` body is its model, with the concession's
  `{who}` fill moved to the caller.
- **`file_visit`** (`0423_rulings_alerts.sql`): after `end_visit`, calls `post_outcome(end, 'filed', …, said,
  source)`, `source` `model` when `line` was given. The target is the visited post.
- **`close_appeal`** (`0423_rulings_alerts.sql`): the line is cut to 2000 characters (was 280), as a sentence cut cannot be
  done in SQL: the staff function has already cut it (Task 2), and this cut only guards. When the punishment is an
  infraction, after the ruling Act, calls `post_outcome(ruling, 'ruling', infraction's visit_act, hearer, the
  infraction's thread, its `about_act`, line, source)`.
- **`intercept`** and **`distract_visits`** (`0449_concession_post.sql`): where they call `post_concession`, they insert
  a `concessions_owed` row instead (the interceptor, `answered` for a quiz, `paid` for a bribe, `distracted` for a cast,
  the Act). `post_concession` is dropped.
- **`pending_concessions(most)`** (rewritten, service only): owed rows with no outcome post, within
  `concessionWriteMinutes` of `at`, oldest first, each with the visit, its Mod's staff key, the visited post, thread,
  board and charges, the interceptor's name, `how`, and for `answered` the quiz's question, choices and answer
  (`visit_quizzes`), for `paid` the price (`payload #>> '{challenge,price}'`), for `distracted` the card's key.
- **`post_visit_concession(visit, body)`** (new, service only): fills `{who}` with the interceptor's name and calls
  `post_outcome(end, 'intercepted', …, 'model')`. Returns whether it posted, or that one was there already.
- **`system_tick`** (`0449_concession_post.sql`): steps 7 and 8 (the `none` writes beside a banked question and past
  the window) are replaced by one step: for each owed row past `concessionWriteMinutes`, the stock line
  (`concession_line_index` over `staff_concessions`, `{who}` filled) through `post_outcome(…, 'stock')`, counted as
  `concessionsLapsed`. The `visits_open.concession_at` mark and its triggers are dropped, and `write_visit_concession`
  is dropped (`visit_concessions` stays, as written).
- **`thread_page`** (latest `0438_board_cards_on_their_board.sql`): `vis` also takes the visits whose outcome post is on
  the page (`outcome_posts.post_act in` the page's posts, by its index), and each visit's JSON gains `answers`, the ids
  of its outcome posts on the page.
- **`visit_outcome_posts(visit)`** (new public read, replacing `visit_concession_post`, which is dropped): `[{kind,
  about, post}]` for the visit's outcome posts that are public posts; plpgsql with `plan_cache_mode =
  force_generic_plan` and `jit = off` (`0320-client-reads-plan-once.sql`), granted to players and visitors, listed in
  0005, 0305 and `ALLOWED_RPCS`.
- **Carried over:** each `visit_concession_posts` row into `outcome_posts` (`about_act` its visit's `visit_end`, `kind`
  `intercepted`).
- **Tests first:** a filed visit posts its line quoting the visited post, one post, in the Mod's character; with no line,
  the stock; a benched Mod's filing ends the visit and records the error with no post. An infraction's ruling posts
  quoting the punished post; a ban's ruling posts nothing. A talk-down owes one row and posts nothing; the staff write
  posts with `{who}` filled; a second write posts nothing; past the window the tick posts the stock; a late model write
  after the stock posts nothing. A wrong answer owes nothing. `thread_page` puts a visit on a page that holds only its
  outcome post, with `answers`; `visit_outcome_posts` returns only public posts. The carried rows. The export round-trips
  both tables (`HELD`).
- **Race file:** two staff runs writing one owed concession; a model write racing the tick's stock; one cast ending two
  visits; `close_appeal` twice on one appeal.

## Task 2. The engine: the concession from the thread, and posts for bounds

Model: sonnet

**Files:** `engine/system/concession.ts` (new) and its test; `engine/system/quiz.ts`, `engine/system/judgment.ts`,
`engine/system/duties.ts` and their tests.

- **`engine/system/concession.ts`**: `concessionPrompt(input)` built as `filingPrompt` is (`judgment.ts`): `modPrompt`
  with no moves, the thread read (`threadLines`, the visited post as the judged one), and the facts: the interceptor's
  name, `how`, and the quiz's question, choices and answer, the price, or the card. It asks for a reply that concedes,
  in the persona's voice, sized to what happened, at most `min(postMaxLength, 2000)` characters, quoting nothing the
  thread does not show; it may name the interceptor or write `{who}`. `concessionCompletion` is the old voice's
  document, built with `fitThreadPrompt` as `filingCompletion`, one line, `stop: ['\n']`. `repairConcession` moves here
  from `quiz.ts`, its bound `min(postMaxLength, 2000)` with `cutAtSentence` (was 280 at a word), keeping the `{who}`
  normalization and the cut that never splits `{who}`.
- **`quiz.ts`**: `quizPrompt` loses `concessionAsk` and the `concession` field; `repairQuiz` loses the concession.
  `CONCESSION_MOST` (280) stays only as the stock lines' bound (`engine/rules/instance.ts`).
- **`judgment.ts`**: `repairFiling` and `repairLine` (the appeal's) keep line breaks (trimmed, not `oneLine`) and bound
  at `min(postMaxLength, 2000)`, `cutAtSentence`; `filingPrompt` and `appealPrompt` ask for a post replying in the
  thread, quoting the post, at that bound, where they asked for "one line of at most 280". `FILING_LINE_MOST` goes;
  the `mode: 'move'` filing's quote of the said line keeps its own clip at 280.
- **`duties.ts`**: the `concession` comment says it is written after the talk-down.
- **Tests first:** the concession prompt carries the thread, the interceptor and each `how`'s facts, and never a quiz
  brief or an owner; a 2,400-character concession or filing is cut at a sentence; line breaks survive; `{who}` is never
  split; the quiz schema has no concession; the old-voice document holds the thread and ends at the Mod's name.

## Task 3. The staff run: concessions after the talk-down

Model: sonnet

**Files:** `supabase/functions/staff/concession.ts`, `quiz.ts`, `core.ts`, `appeal.ts` and their tests.

- **`runConcessions`**: reads `pending_concessions`, budgets by `concession_calls_today` against `concessionsPerDay`
  as now, reads the thread with `judgedRead` (the visited post as judged) and the Mod with `learnMod`, calls (chat at
  `maxTokens: CHATTER_TOKENS`; old voice as chatter's, `OLD_VOICE_POST_TOKENS`), repairs, `post_visit_concession`, and
  `record_staff_call` (duty `concession`, trims named). A rejected concession posts nothing; the tick's stock follows.
- **`runQuizzes`**: writes the question only; `callConcession` and `write_visit_concession` leave it.
- **`runFilings`** (`core.ts`): chat `maxTokens` stays 1,000; the old voice's cap rises from `OLD_VOICE_LINE_TOKENS` to
  the chatter's `OLD_VOICE_POST_TOKENS` and its `maxChars` to the post bound.
- **`appeal.ts`**: `maxTokens` 600 → `CHATTER_TOKENS`; the repaired line passes to `close_appeal` as now.
- **Tests first:** a talk-down's concession call reads the thread and the facts; over budget, no call; a rejected
  answer posts nothing and records the predicate; an old-voice Mod writes by completion; the quiz call no longer asks
  for a concession; the run order (`handler.test.ts`) is unchanged.

## Task 4. The marks and the Lens: one Act, reachable from both

Model: sonnet

**Files:** `engine/ui/data/api.ts`; `web/src/data/supabase.ts` and its test; `engine/ui/data/fake.ts` and its test;
`engine/ui/thread/Thread.tsx`, `engine/ui/thread/Post.tsx`, `engine/ui/cards/Marks.tsx`, `engine/ui/cards/Visit.tsx`,
`engine/ui/cards/visit.ts`; `tools/check-visit-outcome-words.mjs` and `tools/test-visit-outcome-words.mjs`; the stories
and tests named below.

- **Types**: `Visit` gains `answers: readonly Id[]`; `VisitStory.concessionPost` becomes `outcomePosts: readonly { kind:
  'filed' | 'intercepted' | 'ruling'; about: Id; post: Act }[]`.
- **Reads**: `toVisit` reads `answers`; `visitStory` calls `visit_outcome_posts` for every ended visit (not only an
  intercepted one) and reads the posts from `acts_public`; a failed read leaves the list empty. The fake: `file`,
  `intercept` and the appeal ruling post as the database does, and `visitsOn` maps answering posts.
- **The second mark**: `Thread.tsx` keys a second map, answering post → visit, from `answers`; `Post.tsx` passes it to
  `PostMarks` with `on: 'answer'`, the visited post's author as `author`, and no `ViolationNotice`. `markLabel` takes
  `on: 'post' | 'answer'`; the answer's words are "…visit to the post this answers…". The visited post's mark stays
  first in the DOM.
- **`check-visit-outcome-words.mjs`**: reads both of `markLabel`'s maps and requires every `end_visit` outcome in each;
  poison in `test-visit-outcome-words.mjs`: an answer map missing `trapped`, and one with an extra key, each red.
- **The rows**: `Row` gains `post?: Act`; the filed, talked-down and ruling rows take their outcome post; a row with a
  post shows its opening words (`excerpt`, `engine/ui/profile/record.ts`), React and Spin thread on the post, and Go to
  post (`threadHref(thread, pageOf(seq, perPage), seq)`); a row without one shows its line and acts on its Act, as now.
  The #1191 "{mod} posted a reply" link goes. `readVisit` reads the posts' tallies.
- **Tests first**: `lens.test.tsx` (a filed row's React reacts to the post; Go to post's href; a refused post's row
  shows the line), `marks.test.tsx` and `visit.test.ts` (the answer label for each outcome), `fake.test.tsx` (each
  outcome posts once), `supabase.test.tsx` (`visit_outcome_posts` read for a filed visit), a thread test where the
  outcome post on page 2 carries the mark of a visit on page 1. Tests that find a mark by `/Opens the visit\.$/`
  (`forms.test.tsx`, `Spin.test.tsx`) find the visited post's.
- **Stories**: `Visit.board.stories.tsx`'s `talkedDownWithReply` posts a reply quoting the visited post and carrying the
  mark; add `filedWithReply`.

## Task 5. The build

Model: inline

`npm run typecheck`, `npm run build`, `npm run test:sql`, `npm run test:engine` and `npx vitest run engine/ui`, with the
tails in the PR.

## Review focus

- The outcome never fails with its post: a refused `write_staff_act` (benched, lockout, No quote, a quote trap springing)
  inside `post_outcome` rolls back only the post, in `file_visit`, `close_appeal` and the tick, and the punishment,
  the ruling's refund, the visit's end and the alert stand.
- One post per outcome: two staff runs, a model write racing the stock, `close_appeal` retried, and a cast ending two
  visits.
- `thread_page`'s cost: the added join from outcome posts to visits, against `e2e/0028-cold-read-budget.ts` and a
  thread with many visits; a visit shown on a page only through its outcome post.
- A mask through timing: nothing about when or whether an outcome post lands turns on who owns the interceptor, the
  appellant or the visited post; `outcome_posts.error` reaches no client.
- What an outcome post does to the chattier-staff turns: a reply to it waits for the Mod like any reply to a staff
  post, and nothing counts it as a turn.
- The carried #1191 rows and a visit open at the migration, talked down after it.
- The cost at a busy instance: `concessionsPerDay` bounds the concession calls, and the filing and appeal calls' larger
  outputs stay inside the duties' token caps.
