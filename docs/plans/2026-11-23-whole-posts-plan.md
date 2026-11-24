# Whole posts, read by relation, paced by characters: plan

Record, written 2026-11-23. The plan for `docs/plans/2026-11-23-whole-posts-design.md` (#1044). One build session builds
it in one PR from `main`, after the design's PR is merged, and that PR says `Closes #1044`.

Every task is test first: name the test, record its red run, then write the code. No check is added, so no poison pair
is needed; the boundary check (engine never imports an instance) must stay green.

**Migrations.** One migration, `NNNN_whole_posts.sql`, taking the next free number in `supabase/migrations/` (0420 as
this is written), written section by section, one task at a time. Its SQL test takes the matching number in
`supabase/tests/` (`NNNN-whole-posts.sql`). Each function it replaces is copied from its latest definition, found with
`grep -l "function <name>" supabase/migrations/*.sql | tail -1` before copying. As this is written: `setting_pool`
(0415), `record_pool_spend` (0089), `record_turn_attempt` (0419), `write_staff_turn` (0415), `pool_turns_today`
(0419). Everything a copied function does that this plan does not name stays as written, its lock order included.
Applying the migration to dw.gripe is the owner's go-ahead, never the build's.

**The layers.** Everything but setting values is the engine's. Divided World changes `instances/divided-world/settings.ts`
alone.

## The words this plan uses

- A **candidate** is one post `pool_read` returns: whole public body, its number in the thread (`seq`), author, the
  post it replies to (`target_act_id`), and the posts it really quotes (`quote_refs`).
- The **reader** is `readThread` (Task 1). Its **tiers** are the design's section 2: must, to it, opener, company,
  everyone else. Its **ceiling** is `pool.readMost` characters of post text, after quote markers.
- A turn or a pick's **size** is the length, in UTF-16 units (`String.length`), of its whole prompt: `system` plus the
  message for a chat call, the frame's `prompt` for the old voice.

## Task 1. The reader and the quote markers (engine)

Model: sonnet

**Files:** new `engine/system/read.ts` and `engine/system/read.test.ts`.

**What it holds:**

- `READ_WINDOW = 60` (the newest posts a read considers) and `READ_WORDS`, the design's section 4 sentence, verbatim:
  "Every post you are shown is whole. Where the game left posts out for space, a line says how many; it is not part of
  anyone's post, and your post never mentions it."
- `interface ReadCandidate { act; seq; at; author; name; pronouns: PronounSet | null; body; replyTo: string | null; quotes: readonly string[] }`.
- `interface ReadFocus { self: string | null /* the persona's character id */; must: readonly string[] /* answered replies or the judged post, oldest first */ }`.
- `markQuotes(body, byAct: Map<string, ReadCandidate>, self)`: parse the body with `parse` (`engine/bbcode/parse.ts`)
  and replace, at the spans the parser reports, each outermost real quote of a candidate in this thread whose
  normalized words (`quoteNorm` of `quoteWords` of its children, `engine/bbcode/quoted.ts`) equal the candidate's
  normalized source (`quoteSource` of its parsed body) with `[quoting <name>, post #<seq>]`, or `[quoting your post
  #<seq>]` when the author is `self`. A real quote whose contents are empty (concealed, `engine/bbcode/conceal.ts`) and
  whose post is not a candidate becomes `[quoting a hidden post]`. Every other quote (partial, forged, counterfeit,
  another thread's) is left exactly as written. Cut at the parser's spans, never re-serialized (as `concealQuotes` is).
- `readThread(cands, focus, readMost)` returns `{ posts: readonly ReadPost[]; omitted: number; answered: readonly string[] }`,
  where `ReadPost` is the candidate with its marked body and `marks: { you; answering; repliesToYou; quotesYou }`:
  1. Marked bodies for every candidate first; every size below is the marked body's length.
  2. The must tier: the judged post, or the newest answered reply, always; then each older answered reply, newest first,
     while the running total is within `readMost`; then the persona's own posts those replies answer, same rule.
     `answered` lists the answered replies taken.
  3. Tiers 2 to 5 as the design's section 2 defines them, each newest first; a post is taken when it fits what is left of
     `readMost`, else passed over for the next. A quoted candidate in this thread is ranked at the best tier of any post
     quoting it, if that is better than its own.
  4. `posts` in thread order (`seq`); `omitted` is the candidates not taken (the window and the opener only: candidates
     the SQL added for relation are counted too, so it is the honest count of what was left out).
- `readLines(read, names)` renders the posts for a prompt: one line block per post, `Name (pronouns) [post #seq] (you |
  answering | replies to you | quotes you)`, then the body, and in place of each run of left-out posts one line
  `(N earlier posts not shown)` or `(N posts not shown)`.

**Tests first** (`read.test.ts`), each red before the code:
- Spritey's thread as fixtures: the 312-character opener and the 813-character quoting reply. With `readMost` 2,000
  QC-1000's turn reads the opener whole, and the reply as `[quoting your post #3]` followed by the two questions.
- No body in `posts` differs from its marked source by a cut: every shown body is the whole marked body.
- A partial quote, a forged quote, a counterfeit and a quote of a post not a candidate stay byte for byte as written.
- A concealed quote of a hidden post reads `[quoting a hidden post]`.
- Tier order: with a ceiling that fits three posts, the three taken are the answered reply, a post that quotes the
  persona and the opener, over newer posts by strangers.
- Passing over: a 30,000-character stranger post does not stop two later short stranger posts being taken.
- The must tier: three answered replies of 20,000 characters with `readMost` 40,000 take the newest two; `answered`
  lists those two; a single answered reply of 50,000 is still taken whole.
- `omitted` and the `(N posts not shown)` line count exactly the candidates left out.
- Same inputs, same output (no randomness, no clock).

## Task 2. `pool_read`, the settings and the spends (SQL)

Model: sonnet

**Files:** the migration, sections 1 to 3; `supabase/tests/NNNN-whole-posts.sql`.

1. **`pool_read(in_thread uuid, staff_key text, named uuid[]) returns jsonb`**, `stable security definer`, owner
   `kayfabb_digest` and grants as `pool_thread` (0418) has them. It returns `{ title, self, posts }` where `self` is the
   persona's character id (null for an unknown key) and `posts` is the union, each once, of: the thread's first post; its
   newest 60 (`READ_WINDOW`, passed in as `window integer` so the engine owns the number); `named` (up to 50); the
   persona's newest 20 posts there and the newest 10 replies to each; and posts of this thread quoted (`quote_refs`) by
   any of those. Each with `act, seq, at, author, name, pronouns, body` (whole `current_payload ->> 'body'` from
   `acts_public`, as `pool_thread` reads it), `replyTo` (`target_act_id`) and `quotes` (from `quote_refs`, the quoted acts
   that are in this thread). Reads only `acts_public`, `characters_public`, `character_profiles`, `quote_refs` and
   `thread_list`.
2. **Settings.** `setting_pool` copied from 0415: `turns` loses `perDay`; the pool gains `charsPerDay` (whole, 0 to
   20,000,000) and `readMost` (whole, 1,000 to 200,000); the shape sentence says so. The stored `pool` row is rewritten in
   the migration: `perDay` removed from `turns`, `charsPerDay` set to `turns.perDay x 13,000` and `readMost` 40,000 where
   absent. (A setting row, not an Act: an UPDATE is allowed.)
3. **The spends.** `pool_spends`, `pool_turns` and `pool_attempts` each gain `chars integer not null default 0 check
   (chars >= 0)`. `record_pool_spend`, `write_staff_turn` and `record_turn_attempt` each gain a last parameter
   `in_chars integer` and write it (the old signatures dropped, grants moved). `pool_chars_today(on_day date) returns
   bigint`: the sum of `chars` over the day's `pool_spends`, `pool_turns` and paid `pool_attempts`. `pool_turns_today`
   stays for the log and tests that read it.

**Tests first** (SQL): `pool_read` on a 100-post thread returns the opener, the newest 60, a named older post, the
persona's old post and its replies, and a quoted older post; never a hidden post; bodies whole at 20,000 characters.
`setting_pool` refuses a `turns.perDay` and a missing `charsPerDay`. The rewrite turns `perDay 60` into `charsPerDay
780000`. `pool_chars_today` sums the three tables and ignores an unpaid attempt.

## Task 3. Settings in the engine and in Divided World (engine, instance)

Model: haiku

**Files:** `engine/rules/types.ts` (`PoolSettings`: drop `turns.perDay`, add `charsPerDay` and `readMost` with doc
comments from the design's section 5), `engine/rules/instance.ts` (`turnsHeld` loses `perDay`; `POOL_WHOLE` or its
neighbor checks the two new bounds as Task 2's SQL does; the shape sentence at line 165 matches the SQL's word for word),
`engine/rules/instance.test.ts`, `instances/divided-world/settings.ts` (`turns` loses `perDay: 60`; add `charsPerDay:
800_000` and `readMost: 40_000`, the comment saying they are drafts), and every fixture the type check then names.

**Tests first:** `instance.test.ts` refuses a pool with `turns.perDay`, and accepts the Divided World settings.

## Task 4. The chatter prompt reads through the reader (engine)

Model: sonnet

**Files:** `engine/system/chatter.ts`, `chatter.test.ts`.

- `ChatterInput` loses `thread`, `conversation` and `quoting` as separate views and takes `read: ThreadReadResult | null`
  (Task 1's output) and the title. `threadLines`, `conversationLines` and the "You are replying to" line go; the message
  is `readLines` under `Thread: "<title>"`, then "Write your post." A thread start (no thread yet) is unchanged.
- The system prompt shows `READ_WORDS` where it showed `EXCERPT_WORDS`, and only when a read is shown.
- `ChatterLimits` loses `excerptChars` and `threadPosts`, gains `readMost`.
- `chatterCompletion` (old voice) takes the read: `fitThreadPrompt` gets the posts in thread order, and drops whole posts
  lowest tier first (newest kept within a tier) until it fits, never the must tier's first post, never cutting a body.
  Add the tier to what it is handed so it can.

**Tests first:** a turn prompt for Spritey's thread contains both questions and no "…"; it contains `READ_WORDS` once and
no `EXCERPT_WORDS`; an old-voice frame over a window too small for all posts drops a stranger's post before the opener and
never the answered reply; the answered reply appears once in the message.

## Task 5. The judges read through the reader (engine)

Model: sonnet

**Files:** `engine/system/judgment.ts`, `judgment.test.ts`.

The report, appeal and patrol-inspection prompts (lines 415 to 447, 622 to 629, 750 to 765 as this is written) take the
read in place of `thread` and `post`: the judged post is the must tier and marked `(judged)` in place of `(answering)`, so
"The post reported, by …" names it by number and no longer repeats its body. `READ_WORDS` replaces `EXCERPT_WORDS` in
those three. The patrol's cross-board sample (line 874 on) keeps `excerpt` and `EXCERPT_WORDS`. The old-voice judgment
frame (`fitThreadPrompt`, line 473) drops by tier as Task 4's does.

**Tests first:** a report prompt on a 5,000-character post shows it whole; a patrol sample still ends a long post in "…"
with `EXCERPT_WORDS`.

## Task 6. Pacing by characters (engine)

Model: sonnet

**Files:** `engine/system/turns.ts`, `turns.test.ts`.

- `roundShare(spentToday, perDay, slot, cronMinutes)` is unchanged in shape; its callers pass characters. Its doc comment
  says so.
- `planTurns` loses `share`: it returns every turn the caps allow, in its ranked order. The round consumes them (Task 7).
- A new pure `takeWhile(planned, available)`: given each turn's size as it is learned, it says whether the next may start
  (`available > 0`), and the round subtracts each turn's size after it is charged, so a turn may overdraw.

**Tests first:** with 10,000 characters available, turns of 8,000, 8,000 and 2,000 take the first two (the second
overdraws to -6,000) and not the third; `planTurns` with no share returns every capped turn in ranked order (today's
ranking tests kept).

## Task 7. The Edge Functions use `pool_read` and charge characters

Model: sonnet

**Files:** `supabase/functions/chatter/core.ts`, `core.test.ts`; `supabase/functions/staff/core.ts`, `report.ts`,
`appeal.ts`, `patrol.ts` and their tests.

- Chatter turns (`takeTurns`, `oneTurn`): `spentToday` is `pool_chars_today`, `perDay` is `settings.pool.charsPerDay`.
  `oneTurn` replaces `threadReads`' `pool_conversation`, the `pool_thread` reads and the `missing` fetch with one
  `pool_read(thread, staff, planned.answers, READ_WINDOW)`, then `readThread`. `answers` becomes `read.answered`, and
  `quoting` the newest of them; replies not taken are simply not named and stay waiting. The prompt's size is counted
  before the call; `write_staff_turn` and `record_turn_attempt` are passed it (an unsent call passes nothing, as it spends
  nothing). The round stops starting turns once what is earned less what is charged is at or below zero.
- Chatter picks (`onePick`): the read is `pool_read` with `named` the pick's quoted post; `record_pool_spend` gets the
  size; a thread start's size is its prompt too.
- Staff (`threadFor`, `postFor` in `staff/core.ts`; `report.ts`, `appeal.ts`, a patrol inspection in `patrol.ts`):
  `pool_read` with `named` the judged post, `staff_key` the Mod's, then `readThread`. The patrol sample's own read is
  unchanged.
- `limitsOf` and the four `limits` objects drop `excerptChars` and `threadPosts`, add `readMost`.

**Tests first** (`core.test.ts`, with the fake Db): a turn whose waiting reply is 20,000 characters is taken whole and
charged its prompt's size; with two waiting replies over `readMost`, the turn names only the newest and the older stays
waiting; a round with 5,000 characters left takes one 12,000-character turn and no more; a report on a long post passes
it whole. This also settles #675's F2 (the `cut` pass-through had no test): `cut` is gone from these paths.

## Task 8. End to end, and the run

Model: sonnet

**Files:** a new `supabase/tests/e2e/NNNN-whole-posts.ts`, next free number.

On Postgres on localhost with the models faked: Spritey's thread written as on dw.gripe; a round runs; the prompt the fake
model received holds the opener whole, `[quoting your post #3]` and both of Spritey's questions, and no "…" from the
game; the day's `pool_chars_today` equals the prompt's length. Then `npm run typecheck` and `npm run build:ci`, the output
in the PR.

## Ways out of the states this touches

No state is added. A waiting reply the reader leaves out for space stays waiting, and is answered by a later turn or ages
out after `waitHours`, as every waiting reply does today.

## The masks

- `pool_read` reads only public views and `quote_refs` (which holds only quotes standing in public bodies). Its tiers
  use who replied to or quoted whom, which every reader of the thread sees.
- A day's pacing depends on the characters of prompts: public post lengths and the persona's own prompt. Nothing reads
  who owns a character, a class or who reacted.
- `[quoting a hidden post]` says only what the board already shows: that a hidden post was quoted.

## Review focus

- **The deployed `pool` row.** The migration rewrites a tuned row; check the rewrite on a row with every key an admin can
  set, and that `seed_setting` (0355) cannot put `turns.perDay` back.
- **A busy instance.** `pool_read` is bounded by constants (opener + 60 + 50 + 20 x 11 + one hop of quotes); check the
  one-hop quote join is bounded too, and that its plan uses `quote_refs_quoted` and the thread index, not a scan.
- **Overdraw.** A day's chars can end above `charsPerDay` by at most one turn's size per round in the worst case; check a
  round cannot start a second turn after the first overdraws.
- **Quote markers and the masks.** A marker must never name the author of a hidden or veiled post more plainly than the
  board does; check `markQuotes` against a quote of a post under an author veil (0357).
- **Answered replies left out.** A reply not taken stays waiting; check `write_staff_turn`'s "answers the replies waiting"
  check still passes with the shorter list, and no reply is marked answered that the model never read.
- **Prompt size counts.** The charged size must be the prompt actually sent (after scrubbing for the old voice); a
  mismatch silently mis-paces the day.
