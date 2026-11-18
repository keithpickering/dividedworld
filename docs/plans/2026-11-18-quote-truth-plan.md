Record, written 2026-11-18.

# A real quote holds words its post had: plan

Carries out `docs/plans/2026-11-18-quote-truth-design.md`. One PR from `main`.

Every task goes test first: write the failing test, record its red run, then the code. During a task, run only the
tests for the changed code (`npm run test:sql`, `node --experimental-strip-types --test <file>`,
`npx vitest run <file>`). Run `npm run typecheck` and `npm run build` once after the last task, with the tail in the
PR. No deployed database, bucket or connector is touched; SQL is tested against Postgres on localhost.

**One migration**, the next free number at build time, named `quote_truth`, with SQL test files of the same number.
Every function it changes is written whole with `create or replace` from its latest definition and keeps its
signature, security, search_path and grants. Line numbers are as the tree stood at `9d854c0`.

**The rule, whole.** A real quote (`[quote=<Act id>]`) is kept when its own-level visible words are empty, or are
one unbroken passage of a version of that post or spin the writer can read. Otherwise its opener is rewritten to
`[quote user=<shown author's character id>]`, or to `[quote]` where no one is shown or the id names no readable
post. A quote the parser cut for depth is left as it is.

**The layers.** All of it is the engine's.

**The masks.** The check reads `acts_public` (the post, its edits, its shown author) and nothing an owner could be
read from. A veiled author is never written into a body. A hidden version is not matched. Review the timing: the
work done must not differ between a hidden version that would have matched and one that would not.

**States.** None added.

**Scale.** One linear walk of the body, and one read of each quoted post's versions. Task 2 measures the worst
case and sets a bound if one is needed.

## Task 1. The matcher for long text

Model: sonnet

**Files:** `engine/bbcode/phrase.ts` and its test; a new `engine/bbcode/passage.fixtures.ts`; a generator and its
check beside `tools/phrase-sql.mjs` and `tools/check-phrase-sql.mjs` (a `check-*.mjs` travels with its
`test-*.mjs`, and the step is added once, in `STEPS` in `tools/build.mjs`); the migration; a generated SQL test.

- SQL `passage_in(plain text, words text) returns boolean`, `immutable`: true when `words`, through `phrase_norm`
  and the fold (`phrase_fold`, `0142_face_down_moves.sql` line 191) with breaks as single spaces, is a substring of
  `plain` treated the same, at word boundaries on both ends; true when `words` has no letter or digit only if it is
  empty after the fold (an empty quote). No pattern is compiled from `words`.
- TS `passageIn(plain, words)` in `phrase.ts`, the same answer.
- The fixtures: trimming to a passage (true); a changed word, an added word, a dropped middle word, reordered
  words, two passages joined (all false); punctuation, case and spacing differences (true); a passage that starts
  or ends inside a word (false); a passage running across a line break (true); an empty quote (true).

**Tests first.** The fixtures through both sides. A scale test in the shape of `supabase/tests/0144-phrase-scale.sql`:
a 20,000-character passage in a 20,000-character plain, linear and under a bound the test states. The generated
file's check is driven red once by a hand-edited fixture, and the red run recorded.

## Task 2. The check, in SQL

Model: sonnet

**Files:** the migration; the SQL test file; `engine/bbcode/plain.fixtures.ts` and `tools/bbcode-plain.mjs` if
`bbcode_walk` gains a column (its generated test is `supabase/tests/0117-bbcode-plain.sql`).

- **Each quote's own words.** `bbcode_walk` (`0350_quote_cut.sql`, line 35) gives an excerpt for one named Act,
  joined across its quotes. The check needs, for every real quote at every depth that is not cut: where its opener
  starts and ends in the body, the Act it names, and its own-level visible words (nested real quotes and links as
  one separator, as the excerpt has them). Add this as one more output of the same single pass, or as a sibling
  function sharing its frames; do not walk the body once per quote.
- **`quote_truth(body text) returns table (body text, first_quote uuid, framed uuid[])`**, `stable`,
  `security definer`, not executable by `anon` or `authenticated`:
  - For each such quote, read the named Act's versions from `acts_public` once per distinct Act: a `post` or `spin`
    row and its `edit` rows, leaving out any whose body a reader is not shown (`shown_payload` nulls it; see
    `0340_conduct.sql` line 415 and `acts_public` in `0371_veil_cover.sql` line 124). Each version through
    `bbcode_plain`.
  - A quote is kept when `passage_in(version, words)` holds for some version.
  - Otherwise its opener is replaced, from the last quote to the first so earlier offsets hold, with
    `[quote user=<id>]` where `<id>` is `shown_author` of the Act when that is a debuted character, else `[quote]`.
  - `first_quote` is the Act of the first real quote left at the top level; `framed` the distinct characters
    written into openers, at most 5.
  - A body with no real quote returns as it came, having read no Act.
- **The bound.** Measure a 20,000-character body of the most real quotes that fit, each naming a post with 50
  edits of 20,000 characters. If it is over 50 ms, read each Act's original and its latest 20 edits, state that in
  the function's header and in the PR, and hold it with a test. Record the measurement in the PR either way.

**Tests first.** Real: a trimmed passage; a passage only an earlier version held; a whole-post quote of a post that
holds its own real quote; an empty quote; a cut quote. Counterfeit: invented words; a passage with a word changed;
two passages joined; words from the tape (not in any version); a quote of an id that is a card Act; a quote of a
post whose matching version an admin hid; a nested forged quote inside a real one (the inner alone is rewritten).
A veiled author's forged quote names the stand-in, and the true author's id is nowhere in the returned body. The
same body through `quote_truth` twice is unchanged the second time.

## Task 3. Every write passes through it

Model: sonnet

**Files:** the migration; the SQL test file; `supabase/tests/0120-framed.sql`, `0146-quote-springs.sql` and
`0162-no-quote.sql` where they send a forged quote today.

- **One trigger,** `before insert on acts` for kinds `post`, `spin` and `edit`, that sets `new.payload`'s `body`
  to `quote_truth`'s. Triggers on one table fire in name order: name it so it fires before `acts_quote_guard`
  (`0316_card_notes_part_4.sql` line 557), `acts_quote_refs` (`0340_conduct.sql` line 363), `acts_search` and
  `acts_edit_conceal`, and hold the order with a test (a forged quote of a post under No quote is saved, as a
  counterfeit, and writes no `quote_refs` row). This covers `start_thread`, `spin_written` (and `apologize`),
  `write_reply`, `edit_post`, `write_staff_act`, `write_staff_thread` and a direct call alike.
- **`post`** (`0142_face_down_moves.sql`, line 629): the `quoting` argument stays in the signature and is no
  longer believed. The function calls `quote_truth` itself, inserts the returned body with `target_act_id` its
  `first_quote`, and uses that for the No quote lock, `spring_traps('quote', …)` and the `quote` alert. The trigger
  then finds nothing to rewrite.
- **The framed alert.** `post`, `start_thread`, `spin_written` and `write_reply` pass `write_framed`
  (`0118_bbcode_tags.sql`, line 819) the stored body and the client's `framing` joined with `quote_truth`'s
  `framed`. `write_framed` still alerts only a debuted character whose `user=<id>` is in the body, and still at
  most 5. `edit_post` sends none, as today.
- **`write_staff_act`** (`0316`, line 603) keeps the target it is given.

**Tests first.** For each write path, a forged quote is stored as a counterfeit and a true one as typed. `post`
with a `quoting` the body does not quote springs no trap and alerts no one; with a forged quote of a trapped post
the same; with a true quote it springs as today. A "quotes this passage" back is not sprung by a forged quote
holding the passage, and is by a true one. Words inside a forged quote are in `own_words` and are read by
`rule_breaks` (a forged quote in all capitals breaks "no all caps"). The named author gets one `framed` alert; an
edit that adds a forgery gets none.

## Task 4. The preview, the fake, and the selection

Model: sonnet

**Files:** `engine/bbcode/` (a new `truth.ts` and its test, on `parse.ts`'s `QuoteSpan`, lines 443 to 453, and
`visible.ts`); `engine/ui/composer/Editor.tsx` (the preview, lines 231 to 241), `Composer.tsx` (`firstQuote`, line
54), `text.ts` (`framedIn`, line 80); `engine/ui/thread/locate.tsx` (`actLoader`, line 88) or a loader beside it;
`engine/ui/data/api.ts` (`history`, line 2610) and `fake.ts` (`post` near line 1429, `writeFramed` near 1395, and
its other writes); `engine/ui/thread/SelectionQuote.tsx` (`shownWords`, line 53); their tests and the composer's
stories.

- `quoteTruth(body, versionsOf)` in TypeScript, the twin of `quote_truth`: the same body out for the same body
  and versions in. Shared cases live in one fixtures file that both a TS test and a generated SQL test read, as
  Task 1's do.
- The preview loads the versions of each post the draft quotes (the post and its edits, as the history panel
  reads them) and draws the draft through `quoteTruth`. While versions load, a quote is drawn as it will be if it
  passes; the preview is the board world and adds no words of its own.
- The fake backend rewrites as the server does, so stories and screen tests show the saved form.
- `shownWords` skips the body of a nested quote (`.kb-quote`), so a selection gives the post's own-level words.

This changes no screen's layout. The wobble, the head and the alert are the counterfeit's, already designed
(`docs/plans/2026-11-07-bbcode-tags-design.md`, section 1).

**Tests first.** The shared cases through `quoteTruth`. A preview of a forged quote draws a counterfeit of the
author; of a true one, a real quote. A selection across a nested quote leaves its words out, and the quote it
makes passes the check. The fake's `post` stores the rewritten body.

## Task 5. The issue

Model: inline

`Closes #403` in the PR's description, which also says what the design accepted: posts saved before this are not
re-checked.

## Review focus

- A path that stores a post body and does not meet the trigger: any kind other than `post`, `spin` and `edit`
  that the renderer draws through BBCode (an `update`, a card's message, a description).
- The rewrite growing a body past `postMaxLength`: 5 characters for each rewritten opener, after `within` has
  passed it.
- The masks: a veiled author's id in a stored body, in `framed`, or in an alert; and whether the time `quote_truth`
  takes differs with the words of a hidden version.
- The quoted post edited between the preview and the save: the preview said real and the save says counterfeit, or
  the reverse. It should be rare and it is honest either way; confirm the screen shows the saved form at once.
- The cost of the check on the worst body, and the bound Task 2 set, against a busy instance.
- A post that quotes itself in an edit, and a quote of a post in a thread the trigger's read could lock against
  (`lock_for_quote`): no deadlock with `post`'s own locks.
- Two saves of one draft (a retry): the second stores the same body and alerts no one twice.
- The export and import round trip: an import inserts Acts whose bodies were already checked; the trigger must
  leave them as they are, including a quote that was real when saved and whose post has since had the matching
  version hidden.
