# What the meeting and the patrol see of the board: plan

Record, written 2026-11-25. The plan for `docs/plans/2026-11-25-digest-sees-the-board-design.md`. One build session
builds it in one PR from `main`, **after** `docs/plans/2026-11-25-reads-see-the-board-plan.md` is built and merged: it
uses that plan's `post_extras` (SQL), `engine/system/extras.ts`, `engine/system/when.ts` and the cards' `seen`. Its PR
says `Closes #1071`.

Every task is test first: name the test, record its red run, then write the code. No check is added; the boundary
check stays green.

**Migrations.** One migration, `NNNN_digest_sees_the_board.sql`, taking the next free number in `supabase/migrations/`;
its SQL test takes the same number in `supabase/tests/`. Each function it replaces is copied from its latest
definition, found with `grep -l "function <name>" supabase/migrations/*.sql | tail -1` before copying. As this is
written: `system_digest` (0415), `patrol_sample` (0362), and the settings validator that holds `digestExcerpts`
(0415, the `when 'digestThreads'` branch). Everything a copied function does that this plan does not name stays as
written. Applying the migration to dw.gripe is the owner's go-ahead, never the build's.

**The layers.** Everything but setting values is the engine's. Divided World changes
`instances/divided-world/settings.ts` alone.

## Task 1. Settings (SQL, engine, instance)

Model: haiku

**Files:** the migration's settings section, `engine/rules/instance.ts`, `engine/system/digest.ts` (`DIGEST_MOST`),
`instances/divided-world/settings.ts`, the settings tests (`supabase/tests/0079-settings-held.sql` and the engine's).

- New settings, each a whole number with a ceiling in `DIGEST_MOST` that the validators in SQL and in the engine both
  hold: `digestPolls` (1 to 20, a day of window), `digestSpins` (1 to 20), `digestPlays` (1 to 20), `digestStandoutDays`
  (1 to 30, days). Divided World: 5, 5, 5, 7.
- `DIGEST_MOST` gains `polls: 20, spins: 20, plays: 20, standoutDays: 30, standouts: 3` (the names per category).
- The doc comments of `digestThreads`, `digestExcerpts` and `digestConversations` say they are per day of window, and
  that `digestExcerpts` caps the lists that are no window's flow unscaled (design, section 4).
- Tests first: each new setting refused below 1 and above its ceiling, in SQL and in the engine; an instance missing
  one refused as every missing setting is.

## Task 2. `system_digest` (SQL)

Model: sonnet

**Files:** the migration's `system_digest` section, its SQL test.

- **The window's days:** `days := greatest(1, ceil(extract(epoch from (until - since)) / 86400))`. `threads_cap`,
  the top posts' cap and the conversations' cap become `least(setting × days, ceiling)`. Every other use of
  `short_cap` stays unscaled.
- **Extras:** one call of `post_extras` (the reader's plan, Task 2) for every post the digest shows (the excerpts, both
  sides of each exchange, the Boss's reacted posts), each answer joined to its post as `extras`; and for each shown post
  that opens a spun thread, its `origin` as `pool_read` shapes it (`place`, `at`, `spunAt`, `moment`).
- **The Boss's reactions** gain `text` and `cut`: the post's body cut to `digestExcerptChars`, as the excerpts are.
- **`polls`:** the polls open at any time in the window, ordered by voters (from `poll_counts`) then newest, at most
  `least(digestPolls × days, 20)`, each `{ poll, post, thread, title, board, extras }` with the full poll from
  `post_extras`. A removed or replaced poll is not listed.
- **`spins`:** the threads created in the window with an origin, by replies then newest, at most
  `least(digestSpins × days, 20)`, each `{ thread, title, origin }`.
- **`plays`:** the plays played in the window, by `play_post.drawn` then newest, at most `least(digestPlays × days,
  20)`, each `{ play, card, at, by, config, state, post, thread, title, seq }` as `post_extras` shapes a play, read
  through `acts_public` (no unsprung set).
- **`standouts`:** for the span `until - digestStandoutDays`, for each category of the design's section 3, the top
  three characters that are not staff, each `{ character, count }`, read through `acts_public` (cards played: kinds
  `card` and `spring` with a character; received: plays whose target post's character is theirs; polls: `poll` Acts,
  not removals; ballots: `ballot` Acts with a character; spun: threads whose `origin_act_id` is an Act of theirs;
  exchanges: their posts answered by a persona's turn, read as 0415's conversations read them). The counts are in the
  SQL answer for the renderer and are never rendered.
- **Tests first:** a secret ballot never counts toward ballots or appears anywhere in `polls`; an unsprung face-down
  set is in neither `plays` nor the cards-played count, and is once it springs; a staff character never stands out;
  a two-day window doubles the top posts' cap and leaves moves' and quotes' caps alone; each list held to its ceiling.
  **Scale:** a stated row bound on a week of a busy instance (thousands of plays, polls with many voters), red with an
  index withheld, as `0410-post-plays-scale.sql` is.

## Task 3. The digest's renderer (engine)

Model: sonnet

**Files:** `engine/system/digest.ts`, `engine/system/digest.test.ts`.

- `Digest` gains `polls`, `spins`, `plays`, `standouts` and each shown post's `extras` and `origin`, typed from
  `engine/system/extras.ts`; `renderDigest` takes `now` (the meeting's slot) and the cards' `seen` (as the reader
  does), and a digest from an older database (no new fields) still renders.
- Each excerpt line, each exchange, and each of the Boss's reactions (now with its excerpt) is followed by its extras in
  short form: `pollShort`, each play's `seen` line, the origin line for a spun opener.
- New sections, after "Top posts": **Polls** (full form, `pollLines`), **Spins** (origin lines), **Cards on the
  board** (each `seen` line, then `on post #<seq> in "<title>"`), **Standouts** (the week, by category).
- **`standingWords(counts: readonly number[]): string`**, pure: from each count's share of the leader's, "by far"
  where the second is under half the first, "neck and neck" where two are within a tenth, "close behind" under a
  third apart, "behind" otherwise; the test holds that no digit ever appears in the Standouts section.
- Every new list is sliced to its ceiling and every free string clipped (`CLIPS`), and the bound test extends to the
  new sections at their ceilings.
- **Tests first:** each new section and its "none" line; an excerpt with a poll, two plays and an origin; the Boss's
  reaction with its excerpt; the standouts' words for every spread above; the over-long bound.

## Task 4. The patrol reads whole posts

Model: sonnet

**Files:** the migration's `patrol_sample` section, `engine/system/judgment.ts` (`PatrolSamplePost`, `patrolPrompt`,
the `excerptChars` limit), `supabase/functions/staff/patrol.ts`, their tests.

- `patrol_sample` returns, for each sampled post, its `post_extras` answer and, for a spun opener, its `origin`.
- `PatrolSamplePost` gains `extras` and `origin`. `patrolPrompt` shows each post whole with its extras (`extras.ts`),
  newest first: the newest always, each other while the patrol's posts stay within `readMost`; a post left out is not
  in `ctx.sample`, so a finding cannot name it. `EXCERPT_WORDS` leaves the patrol's prompt and `READ_WORDS` joins it.
  The patrol's line (`judgment.ts` near line 903) stops calling `excerpt`. `FilingInput.limits.excerptChars`
  (`judgment.ts:377`, which its comment says is the patrol's alone) goes, and `staff/patrol.ts` (near line 170) and
  `staff/core.ts` (near line 315) stop passing it; the build first checks that no other judge reads it.
- **Tests first:** a 2,000-character post is shown whole; a sample over `readMost` keeps the newest and drops what does
  not fit, and a finding naming a dropped post is dropped (`inSample`); a sampled post's poll and plays are in the
  prompt.

## Task 5. The meeting passes `now` and the cards

Model: inline

**Files:** `supabase/functions/meet/core.ts` (near line 226), its test.

The meeting passes its slot time and the instance's cards to `renderDigest`. Test: a stubbed digest with a poll in
`polls` renders "ends in" relative to the slot, not the clock.

## Task 6. End to end

Model: sonnet

Against Postgres on localhost: a week of seeded play (a few characters casting, voting on a public and a secret poll,
spinning threads, replying to a persona), then one meeting's digest rendered. Record the digest in the PR description,
and check by eye that no secret voter, no unsprung set and no number in Standouts appears.

## Ways out of the states this touches

No state is added. A patrol post left out for space is left alone, as a post not drawn is today.

## The masks

- Every count and list is read of public Acts through `acts_public`, `poll_counts`, `reaction_tallies` and `play_post`,
  the same for every reader: no secret ballot's voter, no unsprung set's caster, no reactor, no owner.
- Standouts' counts reach the renderer and stop there: the prompt says rank and spread in words.
- `system_digest` and `patrol_sample` stay owned by `kayfabb_digest`, which reads public relations alone.

## Review focus

- **Secret ballots and face-down sets in the standouts.** A grouped count by character over `acts_public` must not
  include a row whose character the projection nulls; check each category's query against a secret ballot and an
  unsprung set, and that a set counts only once it springs.
- **A busy week.** Standouts group a week of Acts by character for six categories; check each is one indexed read with
  a stated bound, not a scan of `acts`.
- **The meeting's size.** The digest grows by up to four sections; check the rendered bound at the ceilings against the
  meeting's three calls (each token is read three times on the strong tier), and that Divided World's values keep a
  day's digest near today's size plus the new sections.
- **Scaled caps.** Only the window's flows scale; check moves, quotes, standings and the Boss's reactions do not grow
  with a longer window.
- **The patrol's sample.** A finding may name only a post the Mod was shown; check the dropped-for-space posts leave
  `ctx.sample`, so no visit is sent on a post never read.
- **Older digests.** A digest from a database before this migration must still render (the meeting runs against what
  is deployed until the owner applies it).
