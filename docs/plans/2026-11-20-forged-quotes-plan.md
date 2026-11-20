# Forged quotes: plan

Record, written 2026-11-20. The plan for `docs/plans/2026-11-20-forged-quotes-design.md` (#403). One build session builds
it in one PR from `main`, after the design's PR is merged, and that PR says `Closes #403`.

Every task is test first: name the test, record its red run, then write the code. The checks this plan extends (the
generated-SQL pair `tools/bbcode-plain.mjs`, `check-bbcode-plain.mjs`, `test-bbcode-plain.mjs`) are driven red again on
a poisoned line of the new kind.

**Migrations.** One migration, `NNNN_forged_quotes.sql`, taking the next free number in `supabase/migrations/` (0379 as
this is written), written section by section, one task at a time. Its SQL tests take the next free numbers in
`supabase/tests/` (0379 on). Each function it replaces is copied from its latest definition, found with
`grep -il "function <name>" supabase/migrations/*.sql | tail -1` before copying. As this is written: `bbcode_walk` and
`bbcode_plain` (0350, 0316), `post` (0142), `start_thread` (0326), `spin` (0357), `write_staff_act` (0316),
`acts_quote_guard` (0316), `hidden_refs` (0340), `spring_facts` (0374) and every other function Task 2 finds calling
`bbcode_walk` or `bbcode_plain` on an Act's body. Everything a copied function does that this plan does not name stays as
written, the lock order included (0075's header). A task that finds a function taking a later lock before an earlier
one stops and asks before widening the change.

**The layers.** Everything here is the engine's. Divided World changes nothing; the boundary check holds.

**Measured while planning** (Postgres on localhost, one run each, a 20,000-character haystack): `strpos` of a
near-miss needle of 5,000 to 10,000 characters in a run of one letter, 29 to 91 ms; the same shapes with runs capped at
eight characters, and periodic shapes (`ab…`, `aaaaaaaab…`, `abcdefgh…`), 0.6 to 3.5 ms.

## The words this plan uses

- A **real quote** is `[quote=<uuid>]` as the parser reads it. Its **text** is what a reader sees inside it (design,
  section 2), normalized; split at each cut, it is a list of **pieces**.
- A **version** of a post is the post's own Act or one of its edits. Its **source** is the same walk over its whole
  body, normalized, stored in `quote_sources`.
- A post is **forged** in an Act when some real quote of it in the Act's body has a text whose pieces do not all stand,
  in order, in the source of one eligible version (written before the Act, not hidden at the Act's writing). The
  Act's **verdict** is its payload's `forged`: the forged posts, sorted, each once, absent when none.

## Task 1. The quote's text and a version's source, in two languages (engine, SQL, tools)

Model: sonnet

**Files:** a new `engine/bbcode/quoted.ts` and `quoted.test.ts`; `engine/bbcode/plain.fixtures.ts`, `plain.test.ts`;
`tools/bbcode-plain.mjs`, `tools/check-bbcode-plain.mjs`, `tools/test-bbcode-plain.mjs`; the regenerated
`supabase/tests/0117-bbcode-plain.sql`; the migration (`quote_norm`, and `bbcode_walk` gaining two outputs).

- `quoteNorm(s)`: Unicode NFC; every run of whitespace (`\s`, with U+3000 and the separators `visibleWalk` puts) as one
  space; a run of more than eight of one code point as eight; trimmed; then one leading `...`+ or `…` and one trailing
  one removed with the space beside each, and trimmed again. Code-point safe.
- `quoteWords(nodes)`: the walk of design section 2, with its own stack as `visibleWalk` is: text, `noparse`, autolinks,
  a `url`'s words, `code`'s text, list items (each item starting a line), spoiler titles and bodies, and every real
  quote's and counterfeit's children; block edges (a quote, code, a list item, a spoiler, an alignment, a marquee, `hr`)
  and an image or a video stand as one separator. A `cut` stands as a **cut mark**, which `quoteNorm` never touches and
  `quotePieces` splits on (a code point the walk never emits from text, e.g. U+0000 after stripping it from text).
- `quoteHeld(nodes): Map<string, string[][]>`: for each Act quoted by a real quote at any depth (not a cut's Acts, which
  are not shown), the pieces of each of its quotes, in the order their openers stand. `quoteSource(nodes)`: the
  normalized `quoteWords` of the whole body with cut marks kept as separators.
- `holds(source, pieces)`: every piece, in order, found in `source` at or after the end of the one before; an empty
  piece list or all-empty pieces hold.
- SQL: `quote_norm(t)` as `quoteNorm` (`normalize(t, NFC)`, `regexp_replace` passes; the run cap as
  `regexp_replace(t, '(.)\1{8,}', '\1\1\1\1\1\1\1\1', 'g')`). `bbcode_walk(body text, quoted uuid, forged uuid[] default
  '{}')` (the third argument is Task 2's) returns two more columns: `held jsonb`, an object from each quoted Act id to
  an array of quotes, each an array of pieces, and `source text`. They come out of the same pass: a real quote's frame
  keeps a second buffer of its words for `held` (nested quotes' words included), so the walk stays one pass, linear.
  Drop and recreate `bbcode_walk` with the new signature and restate its grants; `bbcode_plain` stays its wrapper.
- Each fixture in `plain.fixtures.ts` may name `held` and `source`; `plain.test.ts` holds `quoteHeld(parse(body))` and
  `quoteSource(parse(body))` to them, and `tools/bbcode-plain.mjs` asserts `bbcode_walk`'s columns the same way. New
  fixtures: a plain quote; formatting, a link, code, `[noparse]`, a list and a spoiler inside one; a quote nested in a
  quote (the outer's text holds the inner's words; both Acts in `held`); two quotes of one Act; an unclosed quote; a
  counterfeit (not in `held`); a quote in code (not in `held`); a quote holding a cut (`MAX_DEPTH + 2` deep, written from
  the constant: two pieces); leading and trailing ellipses, a middle one kept; spacing and line breaks; NFC
  (decomposed é); a run of twelve letters; whitespace of other scripts (U+3000); an empty quote.

**Tests first:** `quoted.test.ts` over `quoteNorm` and `holds` (in order, overlapping pieces refused, empty pieces);
the fixtures in both languages. **Red:** `quoted.ts` and the columns do not exist. Drive `check-bbcode-plain.mjs` red
once on a poisoned `held` line of the regenerated file. The scale test `supabase/tests/0118-bbcode-plain-scale.sql`
still passes unchanged.

## Task 2. A forged quote reads as a counterfeit, in both languages (engine, SQL)

Model: sonnet

**Files:** `engine/bbcode/parse.ts`, `visible.ts`, `conceal.ts` (header only) and their tests;
`engine/bbcode/plain.fixtures.ts`; the regenerated `0117-bbcode-plain.sql`; `unquoted-corpus.test.ts` and
`supabase/tests/data/unquoted-corpus.json` if their shapes change; the migration (`bbcode_walk`'s `forged`, a helper
`act_forged(payload jsonb) returns uuid[]`, and every caller).

- `parse(input, spans?, forged?: ReadonlySet<string>)`: a real-quote opener whose Act is in `forged` opens a
  `counterfeit` frame. `BbNode`'s counterfeit gains `act: string | null` (the post it falsely names; null for one
  written as a counterfeit). It records no `QuoteSpan`, so `concealQuotes` never empties it. Past the cap it is text, as
  any counterfeit. `visibleText`, `excerptText` and `quotedActs` need no change of their own: they already treat a
  counterfeit as the post's own words.
- SQL: `bbcode_walk(body, quoted, forged)`: a real-quote opener whose Act is in `forged` walks as a counterfeit (its
  words in `plain` and `unquoted`, not in `quotes`, `excerpt` or `held`). `bbcode_plain(body text, forged uuid[] default
  '{}')`. `act_forged(p)`: `p->'forged'` as `uuid[]`, `'{}'` when absent.
- Every reader of an Act's words passes that Act's verdict. Find them with
  `grep -n "bbcode_walk(\|bbcode_plain(" supabase/migrations/*.sql`, take each function's latest definition, and pass
  `act_forged(<the payload the body came from>)`: as this is written `spring_facts` (0374), the passage checks in
  `set_card`/`place_set` (0374), `acts_quote_guard` (Task 4), `own_words` and `rule_breaks` (0340), the search
  triggers and `search_words` (0117 and its successors), and the views of 0368 that call `bbcode_plain` on
  `current_payload`. A body that is a draft (`quote_check`) passes its computed list.
- Fixtures gain `forged`: a forged quote's words in `plain`/visible text and not in `excerpt`; a forged quote beside an
  authentic one of another post; a forged quote of a hidden post (its words survive `concealQuotes`); a forged quote
  nested inside an authentic one.

**Tests first:** `parse.test.ts` (a forged id gives a counterfeit with `act`, no span); `conceal.test.ts` (a forged quote
of a hidden id keeps its words); the fixtures in both languages. **Red:** `parse` ignores a third argument; `bbcode_walk`
has no `forged`. Drive `check-bbcode-plain.mjs` red once on a poisoned `forged` line.

## Task 3. The verdict: sources, the trigger and `quote_check` (SQL)

Model: sonnet

**Files:** the migration; new SQL tests `NNNN-forged-quotes.sql` and `NNNN-forged-quotes-scale.sql`.

- `quote_sources (act uuid primary key references acts, source text not null, digest text not null)`, insert-only by the
  repository's append-only trigger pair (as `quote_refs`, 0340), read by no client role. An AFTER INSERT trigger on acts
  of kind post, spin and edit with a text body writes the row from `bbcode_walk(body, null, act_forged(payload))`'s
  `source` and its `md5`. Backfill the Acts already written (a source is not an Act's content; the verdict is not
  backfilled).
- `quote_forged(body text, at timestamptz) returns uuid[]`: one `bbcode_walk(body, null)`; for each Act in `held`, its
  eligible versions (the Act if it is a post or spin, and its edits: `acts_edits`, written at or before `at`, each
  `version_hidden` false), their sources newest first, distinct by `digest`; the Act is forged unless every quote's
  pieces `holds` in one source (a PL/pgSQL `quote_holds(source, pieces jsonb)` with `strpos` on `substr` from the last
  end). No version, forged. Sorted, distinct. Security definer, `search_path` pinned ending in `pg_temp`, no client
  grant.
- `acts_forged_quotes()`, BEFORE INSERT on acts for kinds post, spin and edit (its name sorts before
  `acts_quote_guard`, so it fires first): `new.payload := (new.payload - 'forged') || ` the verdict when not empty; for
  kind post, `new.target_act_id := null` when it is in the verdict. An ordinary trigger (not `always`), so a restore
  keeps what was written.
- `quote_check(body text) returns uuid[]`: `within('body', body, 'postMaxLength')`, then `quote_forged(body, now())`.
  Granted to `authenticated`. Reads nothing about the caller.
- Tests: an authentic whole-body quote; a highlight-shaped one (plain words across formatting and a nested quote); a
  word changed; punctuation changed; case changed; a middle ellipsis; leading and trailing ellipses; a quote of the
  original after an edit (authentic); a quote of a version written after the Act (forged, by `at`); a quote matching
  only a hidden version (forged, and the same answer from `quote_check` for the hidden post's author and for anyone);
  an id that is no Act; a card Act's id; an empty quote; two quotes of one post, one doctored (forged); a cut quote
  (pieces); a client payload carrying `forged` is overwritten; a post whose target is forged is written with none; an
  edit's verdict is its own and the post's current payload carries it; Acts already written are untouched.
- Scale (`NNNN-forged-quotes-scale.sql`, the cap and sizes written once at the top): a 20,000-character body quoting one
  post that has 20 distinct 20,000-character versions in each hostile shape (a run of one letter, `ab…`,
  `aaaaaaaab…`, `abcdefgh…`), each quote a near-miss: `quote_forged` under 250 ms per shape; and 300 quotes of 300
  posts, each with 3 versions: under 250 ms. A shape that misses its budget stops the task: report the measurement to
  the owner, who chooses the search (design, section 12).

**Tests first:** the tests above. **Red:** none of the functions exist; record the run.

## Task 4. The writers and the guards (SQL)

Model: sonnet

**Files:** the migration; new SQL test `NNNN-forged-quotes-writers.sql`; the existing tests of `post`, No-quote and
conceal that the change touches.

- `post` and `write_staff_act`: after the insert, read `target_act_id` from the written row and spring the back and
  write the `quote` alert only when it is not null (the locks taken before the insert stay; a back locked and not met is
  left as 0142 leaves one). `post`, `start_thread` and `spin`: after `write_framed`, a `write_forged_framed(written,
  acting)` writes a `framed` alert to the author (`acts.character`) of each forged post that is a debuted character,
  with the `framing` ids counted together toward the existing at most 5, each character once. Edits and pool posts
  write none.
- `acts_quote_guard`: the quotes it lists leave out `act_forged(new.payload)`, for the post's target and for the body's
  quotes alike.
- `hidden_refs(v)`: leaves out the Act's forged posts, so no conceal request or layer covers a forged quote.
- Tests: a doctored quote of a trapped post springs nothing and writes no `quote` alert, and writes a `framed` alert to
  its author; the honest quote of the same post springs it; a doctored quote of a post under No-quote is written and an
  honest one refused; a doctored quote of a post with a hidden version is served as written to a non-author (no layer,
  no `concealing`), an honest one is concealed as before; a doctored quote of one's own other mask writes nothing and the
  answer is the same as for another's (compare the two projections); a Mod Bot pool post with a doctored quote is
  written with no target and no alert; `framed` alerts stay at most 5 with `framing` and forged together.

**Tests first:** the tests above. **Red:** today the doctored quote springs the back and writes `quote`.

## Task 5. The screens draw the verdict (engine, the board)

Model: sonnet

**Files:** `engine/ui/bbcode/render.tsx` (`BbCode` gains `forged?: readonly string[]`; the `counterfeit` case passes
`act` to the head), `engine/ui/thread/lines.tsx` (`QuoteOf`'s counterfeit gains `act`; `CounterfeitHead` with an `act`
draws `useKnownAct(act)`'s character as a `Byline` with `link={false}`, and "Someone" when there is none), every
`<BbCode` that draws an Act's words (`grep -rn "<BbCode" engine instances`: as this is written `thread/Post.tsx`,
`thread/lines.tsx` (History, each version its own payload's `forged`), `spin/Origin.tsx`, `profile/`, `postbit/`,
`reveal/Reveal.tsx`, `board/MoveNotice.tsx`, and the instance effects that draw a post's body), the instance and engine
readers of a post's visible text that call `parse` (`grep -rn "parse(" engine/rules instances --include=*.ts*`: pass the
Act's `forged`), `engine/ui/data/api.ts` (`Payload.forged?: readonly string[]`), `engine/ui/data/fake.ts` (the fake
backend works out the verdict with Task 1's TypeScript on post, spin and edit, drops the target and writes `framed` as
Task 4 does).

- Tests first, each red: `render.test.tsx`: a real quote whose Act is in `forged` draws `data-kb-counterfeit`, no link
  in its head and the author's name as text; `engine/ui/thread/lines.test.tsx` and the thread tests beside it, through the fake backend: a doctored quote
  shows the counterfeit head, an honest one the real head; History draws each version with its own verdict; under a
  live veil the head names the stand-in; an Autocorrect play on a phrase inside a doctored quote lands and draws
  (instance test beside `autocorrect/Effect.test.tsx`), and inside an honest quote does not.
- A property test (`engine/bbcode/quoted.test.ts` or beside `SelectionQuote`'s tests): for random posts built from the
  fixtures' pieces, the Quote button's text (`quoteText`) is never forged, and a highlight of any run of a post's shown
  words drawn by the real renderer (outside a shut spoiler, with no layer over it) is never forged.

## Task 6. The preview says so first (engine, the board)

Model: sonnet

**Files:** `engine/ui/composer/Editor.tsx` (or `Composer.tsx`, whichever holds the preview and the cut notice),
`engine/ui/data/api.ts` (`quoteCheck(body): Promise<readonly string[]>`), the Supabase adapter beside the other RPCs,
`engine/ui/data/fake.ts`, the composer's tests.

- While the draft holds a real quote (`quotedActs(parse(draft))` not empty), 600 ms after it last changed, the composer
  calls `quoteCheck` (one in flight; a stale answer dropped). The preview passes the answer as `forged`. While it is not
  empty, the line "A quote here isn't in the post it names, so it will show as a counterfeit." shows by the draft in a
  polite live region, styled as the cut notice; it goes when the answer is empty or the draft holds no real quote. A
  failed call shows nothing and refuses nothing. Posting is never refused.
- Tests first, each red: a doctored quote shows the line and a shaky preview; fixing it clears both; no call is made for
  a draft with no real quote; a stale answer never overwrites a newer one.

## Task 7. The export and the masks, end to end (e2e)

Model: haiku

**Files:** `supabase/tests/e2e/0003-export.ts`; a new e2e file after the last number in `supabase/tests/e2e/`.

- The export round trip holds an Act with a `forged` payload and its `quote_sources` rows.
- The masks: a hidden post's words quoted exactly by a non-author through `quote_check` and through `post` come back
  forged, and the same for the hidden post's own author; the two answers and their projections are equal.

**Tests first:** both. **Red:** before Task 3 nothing writes `forged`.

## Last. The full build, the pictures and the final review

`npm run typecheck` and `npm run build:ci` green; screenshots (board world, light and dark) of a thread with an honest
and a doctored quote of one post side by side in separate posts, and of the composer's preview line, attached to the PR
with the line's words for the owner to approve. The final reviewer reads the Review focus below.

## Ways out of the states this touches

No state is added. A counterfeit is its author's own words; an edit that quotes honestly has its own verdict. Nothing
waits on a job.

## The masks

- `quote_forged` and `quote_check` compare only versions not hidden at that moment, and read nothing about the caller
  or about who owns a character; the answer is the same for every caller (Tasks 3 and 7).
- The head of a doctored quote shows the quoted post's projected author, the stand-in under a veil (Task 5).
- The `framed` alert goes through `write_alert`, which skips the acting account's own masks the same way it does today,
  and nothing about it is in the answer (Task 4).
- `quote_sources` is read by no client role.

## Review focus

- **The two parsers agree** on `held`, `source` and `forged` at every depth, in and out of code, `[noparse]`, spoilers,
  counterfeits, cuts and unclosed tags, and on normalization (NFC, other scripts' whitespace, the run cap, ellipses).
- **Honest quotes never shake:** the Quote button's text and a highlight of shown words, through the real renderer,
  in the property test and by hand on nested quotes, lists, code and spoilers.
- **Every reader passes the verdict:** no `bbcode_walk`/`bbcode_plain` call on an Act's body and no `<BbCode` of an
  Act's words is left without its `forged`; a miss would draw a doctored quote as real, or keep its words out of
  Autocorrect.
- **The target dropped in the trigger:** `post` and `write_staff_act` take locks for a back before the insert and may
  then not meet it; check nothing waits on or misreads a lock taken and not used, and that the lock order stands.
- **Cost:** the scale test's budgets, and the cost of `quote_sources` and its backfill at a busy instance (one walk per
  version, once).
- **Acts already written** have no `forged` and read as before; nothing updates an Act.
