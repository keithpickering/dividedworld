Record, written 2026-11-26.

Amended 2026-11-26 with the owner, after it merged and before it was built: a ban's and a group move's appeal rulings
post, and each season has a Banlist thread (design, section 8). The rule, Tasks 1 to 3, a new Task 5 (Divided World's
words) and the review focus are changed to match; the build is now Task 6.

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

**The rule, whole.** Four outcomes post as a staff character, each where its story is, quoting what it answers:

- a visit **filed**: at once, in `file_visit`, the line the filing call wrote, else the `visitFiled` stock line;
- a visit **talked down** (a quiz answered right, a bribe paid, a distraction): the talk-down records the concession as
  owed; the next staff run writes it from the thread and the facts of the talk-down, and posts it; past
  `concessionWriteMinutes` the tick posts a line from the persona's `concessions`;
- an appeal **ruled on**: at once, in `close_appeal`, the ruling's line, else the stock appeal line, by the hearer. An
  infraction's in the punished post's thread, quoting the post; a group move's in the move Act's thread, quoting the
  move, when that thread is a staff thread; a ban's in its season's Banlist, quoting the ban's entry (quoting nothing
  where the entry was refused), when the ban owes an entry (a ban from before this change does not, and its ruling
  posts nothing). A ruling that ends its move owes no end line when it posted;
- a **ban** (a full warn bar, written only by `infract`): `infract` records its entry as owed by the Mod whose
  infraction filled the bar; the next staff run writes the persona's line from the thread of the post that tipped
  the bar and posts the entry in the season's Banlist, the code line (`copy.banlistEntry` filled from the ban) and
  then the line; past `owedLines.graceMinutes` the tick posts it with a `banEntry` stock line, and a ruling on the ban
  posts it from stock first if it is still owed. The Banlist (`copy.banlistThreadTitle`) is opened by its season's
  first entry.

The post's body is the line, at most `min(postMaxLength, 2000)` characters (a ban's entry: its code line, a blank line
and a persona line of at most 280, within `postMaxLength`). One outcome post per outcome, best effort: a refused post
leaves the outcome standing and is recorded for an admin. An outcome post with a visit carries the visit's mark, and
the Lens's row for the outcome is that post; a ban's entry and a ban's or a move's ruling have no visit and no mark.

**The layers.** Engine, all of it, with the Banlist's words carried in by interfaces the engine already has: `Copy`
gains two optional strings (`banlistThreadTitle`, `banlistEntry`), and `STOCK_LINE_KEYS` gains `banEntry`, so every
persona's `stockLines` and the instance's own set carry one (the engine never names Divided World's words). Divided
World supplies them (Task 5); its personas' `visitFiled`, appeal stock lines and `concessions` stay the fallbacks.

**The masks.** Every call reads only what readers see: the thread as `judgedRead` returns it, public Acts, the staff
character's own memory and career. A post names a character, never an account. When a post lands depends on the
outcome and the staff run's clock; whether it lands depends only on the Mod's character and the thread. The refusal
record (`outcome_posts.error`) has no client grant and reaches no page. The new public read returns only public post
ids for a public visit. A ban's entry names the banned character from `characters`, its days from the ban (the
character's own ladder of public bans), its rule from `punishment_words`, and links a public post; nothing in it, or
in when it posts, reads an owner. `bans_owed` has no client grant.

**States.** None a player can be put in. An owed concession is not shown, and it ends by itself, as a post, within
`concessionWriteMinutes` and a tick. An owed ban entry is not shown, and ends by itself within `owedLines.graceMinutes`
and a tick, or at the ban's ruling. The Banlist is read-only to players, as the system board is (`not_the_systems`).

**Scale.** The design, section 11.

**Outcomes already held.** No post is made for an outcome that ended before the migration (design, section 9). The
migration copies each `visit_concession_posts` row into `outcome_posts`. A visit open at the migration and talked down
after it owes a concession like any other; its #1191 `visit_concessions` row is not read. A ban written before the
migration owes no entry (no `bans_owed` row is made for it), and a ruling on it after the migration posts nothing. A
move landed before the migration and ruled on after it posts its ruling in its thread when that is a staff thread
(since `0437_move_threads.sql`); a move in the old announcements thread posts nothing.

## Task 1. The database: outcome posts, the owed concession and ban entry, the Banlist, the page

Model: sonnet

**Files:** the new migration; `supabase/tests/NNNN-outcome-posts.sql` and `supabase/tests/NNNN-outcome-posts-race.sql`
(new); `supabase/tests/0005-default-deny.sql`, `supabase/tests/0305-veil-sweep.sql`, `tools/check-web-reads.mjs`,
`supabase/tests/e2e/0003-export.ts` (lists); the `0449-concession-post*.sql` tests where they assert what this
replaces; the `0439-minutes.sql` test where it asserts the instance's thread set (`instance_thread_rows`).

- **`outcome_posts`**: `about_act uuid primary key references acts (id)` (a `visit_end` or an `appeal_ruling`),
  `kind text not null check (kind in ('filed', 'intercepted', 'ruling', 'banned', 'ban_ruling', 'move_ruling'))`
  (`about_act` a `visit_end`, an `appeal_ruling`, or for `banned` the `ban` Act), `visit_act uuid references acts
  (id)` (the visit the outcome belongs to; for an infraction's ruling, its infraction's `visit_act`, null when it has
  none; null for the three new kinds, which carry no mark), `source text not
  null check (source in ('model', 'stock'))`, `post_act uuid references acts (id)`, `error text`, `at timestamptz not
  null default now()`; exactly one of `post_act` and `error` (as `visit_concession_posts`). RLS on, every grant revoked;
  append-only by update, delete and truncate triggers, as `visit_concession_posts` (0449). Indexes on `post_act` and
  `visit_act`. Its primary key is the one-post guard.
- **`concessions_owed`**: `visit_act uuid primary key references acts (id)`, `end_act uuid not null references acts
  (id)`, `interceptor uuid not null references characters (id)`, `how text not null check (how in ('answered', 'paid',
  'distracted'))`, `intercept_act uuid references acts (id)` (the `intercept` Act, or the distraction's cast), `at
  timestamptz not null default now()`. Same grants and triggers. Owed and unpaid: a row with no `outcome_posts` row for
  its `end_act`; an index on `at`.
- **`bans_owed`**: `ban_act uuid primary key references acts (id)` (the `ban`), `staff text not null references
  characters (staff)` (the infraction's `staff`, the Mod whose filing or ruling filled the bar), `season integer not
  null` (the ban's `season`), `at timestamptz not null default now()`. Same grants and triggers. Owed and unpaid: a row
  with no `outcome_posts` row for its `ban_act`; an index on `at`. The rest (the character, the days, the infraction,
  the post) is read from the ban, which never changes. Listed in `0005-default-deny.sql` and the export's `HELD` beside
  `outcome_posts` and `concessions_owed`.
- **`seasons.banlist_thread uuid references threads (id)`**, and **`banlist_thread(in_season bigint)`**, internal,
  written as `meetings_thread` (`0439_minutes.sql`): the season's row locked `for no key update`, its thread returned
  where it has one, else a thread opened on `system_board()` titled `copy_of('banlistThreadTitle', number)`, recorded
  and returned. **`instance_thread_rows()`** (`0437_move_threads.sql`) also takes each season's `banlist_thread`, so the
  Banlist follows the system board's flag as the Roster Report and Staff Meetings threads do.
- **`ban_entry_head(ban uuid)`**, internal: `copy.banlistEntry` with `{character}` (the banned character's name),
  `{days}` (the ban's `days`), `{rule}` (`punishment_words` of its `infraction_act`) and `{post}` (the address of the
  post that tipped the bar, the infraction's `about_act`: `/t/<thread>#post-<seq>`, as `engine/ui/thread/pages.ts`
  reads an address) filled, in `fill_tokens`. Null where the copy has no `banlistEntry`.
- **`post_ban_entry(ban uuid, line text, source text)`** (service only): returns early when `outcome_posts` holds the
  ban; when the copy has no `banlistThreadTitle` or `banlistEntry`, records the error and returns. Else the body is
  the head, a blank line, then `line` (the model's, `source` `model`), or for `stock` a line from
  `stock_lines('banEntry', staff)` with `{mod}` and `{banned}` and the Mod's pronoun tokens filled (the head alone where
  the persona and the instance have none), cut to `postMaxLength`; then `post_outcome(ban, 'banned', null, staff, null,
  null, body, source, season)`. Returns whether it posted, or that one was there already.
- **`post_outcome(about, kind, visit, staff_key, thread, target, body, source, season default null)`**, internal (no
  role has execute): returns early when `outcome_posts` holds `about`; else, inside its own `begin … exception`, takes
  `banlist_thread(season)` where `thread` is null and `season` is given (so a refused first entry takes the thread it
  opened back with it), `write_staff_act(staff_key, 'post', thread, target, jsonb_build_object('body', left(body,
  post_max)))`, `post_max` the instance's `postMaxLength`, and records the post or the error. It never raises. #1191's
  `post_concession` body is its model, with the concession's `{who}` fill moved to the caller.
- **`infract`** (`0361_discipline_cards.sql`): where it writes a `ban`, it inserts the `bans_owed` row (the ban, its
  `staff` argument, `season_no`) in the same statement block. It is the one writer of a ban, so `file_visit`'s and
  `close_appeal`'s bans both owe their entries from here. Everything else as 0361 wrote it.
- **`file_visit`** (`0423_rulings_alerts.sql`): after `end_visit`, calls `post_outcome(end, 'filed', …, said,
  source)`, `source` `model` when `line` was given. The target is the visited post.
- **`close_appeal`** (`0423_rulings_alerts.sql`): the line is cut to 2000 characters (was 280), as a sentence cut cannot be
  done in SQL: the staff function has already cut it (Task 2), and this cut only guards. After the ruling Act, by the
  punishment's kind:
  - an **infraction**: `post_outcome(ruling, 'ruling', infraction's visit_act, hearer, the infraction's thread, its
    `about_act`, line, source)`;
  - a **move**: when the move Act's thread is `staff_placed`, `post_outcome(ruling, 'move_ruling', null, hearer,
    pun.thread, pun.id, line, source)`; where this posted, the `say_move_end` call that follows an overturn or a
    reduction already past is not made (the ruling says the end), and where it was refused or not made, it is made as
    now;
  - a **ban** with a `bans_owed` row: first `post_ban_entry(ban, null, 'stock')` (it returns early where the entry
    posted), then `post_outcome(ruling, 'ban_ruling', null, hearer, null, the entry's `post_act` (null where it was
    refused), line, source, the ban's season)`. A ban with no row (from before this change) posts nothing.
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
  is dropped (`visit_concessions` stays, as written). One more step after it: for each `bans_owed` row with no outcome
  post past `owed_grace_minutes()` (`owedLines.graceMinutes`), oldest first, at most `demandChecksPerTick` a tick (the
  owed lines' grace bound), `post_ban_entry(ban, null, 'stock')`, counted as `banEntriesLapsed`, whatever
  `systemEnabled` says.
- **`pending_ban_entries(most)`** (new, service only): owed rows with no outcome post within `owed_grace_minutes()` of
  `at`, oldest first, at most `most`, each with the ban, its Mod's staff key, the banned character's name, the days, the
  rule's words, the season, and the post that tipped the bar (its id, thread and board), for the staff run's read.
- **`standing_order_line_calls_today()`** (`0445_persona_lines.sql`) also counts the duty `banEntry`, and
  **`staff_call_records`**' duty check (latest `0449_concession_post.sql`) takes `banEntry`.
- **`thread_page`** (latest `0438_board_cards_on_their_board.sql`): `vis` also takes the visits whose outcome post is on
  the page (`outcome_posts.post_act in` the page's posts, by its index), and each visit's JSON gains `answers`, the ids
  of its outcome posts on the page.
- **`visit_outcome_posts(visit)`** (new public read, replacing `visit_concession_post`, which is dropped): `[{kind,
  about, post}]` for the visit's outcome posts that are public posts; plpgsql with `plan_cache_mode =
  force_generic_plan` and `jit = off` (`0320-client-reads-plan-once.sql`), granted to players and visitors, listed in
  0005, 0305 and `ALLOWED_RPCS`.
- **Carried over:** each `visit_concession_posts` row into `outcome_posts` (`about_act` its visit's `visit_end`, `kind`
  `intercepted`). No `bans_owed` row for a ban already written.
- **Tests first:** a filed visit posts its line quoting the visited post, one post, in the Mod's character; with no line,
  the stock; a benched Mod's filing ends the visit and records the error with no post. An infraction's ruling posts
  quoting the punished post; a ban's ruling posts nothing. A talk-down owes one row and posts nothing; the staff write
  posts with `{who}` filled; a second write posts nothing; past the window the tick posts the stock; a late model write
  after the stock posts nothing. A wrong answer owes nothing. `thread_page` puts a visit on a page that holds only its
  outcome post, with `answers`; `visit_outcome_posts` returns only public posts. The carried rows. A group move's
  ruling posts in the move's thread quoting the move, and its overturn owes no end line; with the ruling refused (the
  hearer benched), the end line is owed; a move in a thread that is not a staff thread posts nothing. A filing that
  fills the bar owes one `bans_owed` row and posts nothing at once; `post_ban_entry` with a model line posts the head
  and the line in the season's Banlist as the Mod, the head's character, days, rule and link the ban's, and opens the
  thread once with the copy's title; the season's second ban posts in the same thread; a ban of the next season opens
  that season's; past the grace the tick posts the stock entry; a late model write after it posts nothing. An
  `increased` ruling that bans owes an entry. A ruling on a ban whose entry is owed posts the stock entry, then the
  ruling quoting it as the hearer; on a ban whose entry was refused, the ruling quotes nothing; on a ban from before
  the migration, nothing. With no `banlistThreadTitle` in the copy, a ban records the error, opens no thread, and still
  bans. A refused first entry leaves no thread. The Banlist is in `instance_thread_rows()` and moves with the flag. The
  export round-trips the three tables (`HELD`) and `seasons.banlist_thread`.
- **Race file:** two staff runs writing one owed concession; a model write racing the tick's stock; one cast ending two
  visits; `close_appeal` twice on one appeal; two staff runs writing one ban's entry; a ban's model entry racing
  `close_appeal`'s stock entry for it; two first bans of a season, in two transactions, opening one Banlist.

## Task 2. The engine: the concession from the thread, the ban's line, and posts for bounds

Model: sonnet

**Files:** `engine/system/concession.ts` and `engine/system/banlist.ts` (new) and their tests; `engine/system/quiz.ts`,
`engine/system/judgment.ts`, `engine/system/duties.ts`, `engine/system/stock.ts`, `engine/rules/types.ts`,
`engine/rules/instance.ts` and their tests.

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
- **`duties.ts`**: the `concession` comment says it is written after the talk-down. `DUTIES` gains `banEntry`
  (`{ mode: 'chat', tier: 'light' }`, as `filing`; a persona on the old voice is asked in raw completion).
- **`engine/system/banlist.ts`**: `banEntryPrompt(input)` built as `concessionPrompt` is, the shared read (`modPrompt`
  with no moves; `threadLines` with the post that tipped the bar as the judged one), then the ban's facts: the banned
  character's name, the days, the rule's words, the season. It asks for one short line in the persona's voice, at
  most 280 characters, said under a code line that already states the ban (so it need not repeat the days or the
  rule, and must not give others), quoting nothing the thread does not show. `banEntryCompletion` is the old voice's
  document, built with `fitThreadPrompt` as `concessionCompletion`, `stop: ['\n']`. `repairBanLine`: one line
  (whitespace collapsed, as `repairLandingLine` does), a stray `{token}` stripped of its braces (recorded, as
  `repairLandingLine` does) except `{banned}`, cut
  at a sentence to 280 (recorded), never rejected for length; blank or not text is none, and the stock follows. Its
  output is only ever the second line: the code line is the database's (`ban_entry_head`).
- **`stock.ts`**: `STOCK_LINE_KEYS` gains `banEntry`, `STOCK_LINE_TOKENS.banEntry` `['mod', 'banned']` (`{banned}` a
  name only, as `{appellant}`). It is not an `OWED_KEYS` key: it is paid through `bans_owed`, not `lines_owed`.
- **`types.ts`** and **`instance.ts`**: `Copy` gains `banlistThreadTitle?: string` (with `{season}`) and
  `banlistEntry?: string` (`{character}`, `{days}`, `{rule}`, `{post}`). `instanceProblems` takes both or neither, holds
  the title to `{season}` as `meetingsThreadTitle` is, and requires `{post}` once inside a `[url=…]` and only the four
  tokens in the entry. The seed writes them into the `copy` setting as it does the rest of `Copy` (the build confirms).
- **`judgment.ts`**: `appealPrompt` says where the ruling's post goes, by the punishment: a reply in the post's thread
  (an infraction), a reply to the move in its thread (a move), or a reply to the ban's entry in the season's Banlist (a
  ban). What the call reads is as today.
- **Tests first:** the concession prompt carries the thread, the interceptor and each `how`'s facts, and never a quiz
  brief or an owner; a 2,400-character concession or filing is cut at a sentence; line breaks survive; `{who}` is never
  split; the quiz schema has no concession; the old-voice document holds the thread and ends at the Mod's name. The
  ban prompt carries the thread, the banned character, the days and the rule, and never an owner or another of the
  player's characters; a 400-character ban line is cut at a sentence to 280 and a two-line one is one line; a
  `{days}` token is stripped of its braces and recorded; `instanceProblems` refuses a title with no `{season}`, an entry
  with no `{post}` or an unknown token, and one of the pair without the other; every persona's `stockLines` needs a
  `banEntry` (the type does).

## Task 3. The staff run: concessions after the talk-down, ban entries after the ban

Model: sonnet

**Files:** `supabase/functions/staff/concession.ts`, `quiz.ts`, `core.ts`, `appeal.ts`, `handler.ts` and their tests;
`supabase/functions/staff/banlist.ts` (new) and its test.

- **`runConcessions`**: reads `pending_concessions`, budgets by `concession_calls_today` against `concessionsPerDay`
  as now, reads the thread with `judgedRead` (the visited post as judged) and the Mod with `learnMod`, calls (chat at
  `maxTokens: CHATTER_TOKENS`; old voice as chatter's, `OLD_VOICE_POST_TOKENS`), repairs, `post_visit_concession`, and
  `record_staff_call` (duty `concession`, trims named). A rejected concession posts nothing; the tick's stock follows.
- **`runQuizzes`**: writes the question only; `callConcession` and `write_visit_concession` leave it.
- **`runFilings`** (`core.ts`): chat `maxTokens` stays 1,000; the old voice's cap rises from `OLD_VOICE_LINE_TOKENS` to
  the chatter's `OLD_VOICE_POST_TOKENS` and its `maxChars` to the post bound.
- **`appeal.ts`**: `maxTokens` 600 → `CHATTER_TOKENS`; the repaired line passes to `close_appeal` as now, for every
  punishment's kind (the database decides where it posts).
- **`runBanEntries`** (`banlist.ts`, new): reads `pending_ban_entries(owedLines.perRun)`, budgets by
  `standing_order_line_calls_today` against `owedLines.perDay` (shared with the owed lines: a ban's entry is a line owed
  for an act that has happened; no setting is added), reads the thread of the post that tipped the bar with
  `judgedRead` (that post as judged) and the Mod with `learnMod`, calls (duty `banEntry`; chat at `maxTokens:
  CHATTER_TOKENS`, old voice by completion at `OLD_VOICE_LINE_TOKENS`, exported from `core.ts`), repairs (`repairBanLine`),
  `post_ban_entry(ban, line, 'model')`, and `record_staff_call` (duty `banEntry`, cause the ban, trims named). A Mod
  not on the roster, a spent day, a failed call, a rejected or blank answer: `post_ban_entry(ban, null, 'stock')` at
  once, as the owed lines pay stock (so a ban's entry waits the grace only for a run that never came). With The System
  off, nothing is done; the tick's stock follows. A transport or ledger failure stops the run (`stopsTheRun`); a
  database error on one entry is recorded and the run goes on.
- **`handler.ts`**: `runBanEntries` runs after `runFilings` (a filing that bans in this run owes its entry by then) and
  before the patrols, on its own terms: its failure costs the filings nothing. `WRITES` takes `post_ban_entry`.
- **Tests first:** a talk-down's concession call reads the thread and the facts; over budget, no call; a rejected
  answer posts nothing and records the predicate; an old-voice Mod writes by completion; the quiz call no longer asks
  for a concession. A ban's entry call reads the thread and the ban's facts and posts through `post_ban_entry`; over
  `owedLines.perDay` (counting the owed lines' calls), no call and the stock; a rejected answer pays the stock and
  records the predicate; an old-voice Mod writes by completion. The run order (`handler.test.ts`) is the old one with
  the ban entries after the filings.

## Task 4. The marks and the Lens: one Act, reachable from both

The amendment changes nothing here: a ban's entry and a ban's or a move's ruling have no `visit_act`, so neither
`thread_page`'s `answers` nor `visit_outcome_posts` returns them, and they carry no mark. The kinds below stay the
three a visit has. The fake (`engine/ui/data/fake.ts`) posts no Banlist; the database's tests (Task 1) hold it.

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

## Task 5. Divided World's words for the Banlist

Model: sonnet

**Files:** `instances/divided-world/index.ts` (its `copy`); `instances/divided-world/system/lines.ts`;
`instances/divided-world/system/personas/ontopic.ts`, `fangame.ts` and `quality-control.ts`;
`instances/divided-world/system/system.test.ts`.

- **The copy**: `banlistThreadTitle: 'Season {season}: Banlist'`, beside `rosterThreadTitle` and `meetingsThreadTitle`;
  `banlistEntry: 'Banned: {character}, {days} days, {rule}. [url={post}]The post that did it.[/url]'`. Board words, in
  character, but every fact in them is a token the code fills, so the line states the ban truly.
- **The stock lines**: each persona's `stockLines.banEntry`, three to six lines in its own register (as its `visitFiled`
  and `concessions`), each at most 280 characters, using only `{mod}` (and its pronoun forms) and `{banned}`, saying
  nothing of the days or the rule, which the code line says above it; and three in the instance's own set
  (`lines.ts`), the last resort, repeating no persona's. They are marked DRAFT for the owner's approval in the review,
  as the concessions were.
- **Tests first** (`system.test.ts`): the copy equals the three titles and the entry; every persona has `banEntry`
  lines, each within 280 characters and using no token but `{mod}`, its forms and `{banned}`; no persona's line repeats
  the instance's; `instanceProblems` is empty for Divided World.

## Task 6. The build

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
  outputs stay inside the duties' token caps. The ban entries share `owedLines.perDay` with the owed lines: a run of
  bans takes from the moves' end lines, which then post from stock; nothing is unbounded.
- The ban never fails with its entry: `infract`'s `bans_owed` insert is inside the filing's and the ruling's
  transaction, and a refused entry (the Mod benched, no Banlist copy) leaves the ban, its alert and the ruling standing.
- One entry per ban and one Banlist per season: two runs, the tick and `close_appeal` racing on one ban; two first
  bans of a season; a ban between seasons (it counts in the latest season's ladder and posts in that season's Banlist).
- A mask through the Banlist: its days come from the character's ladder, never the player's; nothing about when or
  whether an entry posts turns on who plays the banned character; a player with several banned masks sees nothing tie
  their entries.
- A quoted move: a ruling's post quotes a `move` Act, which no post has quoted before; the quote, its trap springing
  and the No quote check (`write_staff_act`) behave as on a post, and the screens draw the quote.
- A ruling that ends its move posts once: the end line is not owed beside a posted ruling, and is owed when it was
  refused.
