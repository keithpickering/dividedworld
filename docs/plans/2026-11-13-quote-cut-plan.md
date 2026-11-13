Record, written 2026-11-13.

# A quote past the cap is cut, never text: plan

One follow-up from the conduct build (#428), from #567: "Hidden words survive in a quote pyramid deeper than the
parser's depth cap of 32." The owner's answer (2026-11-13, on #567): "32 is excessive and we can cut it off there or
earlier if it helps performance." No design session preceded this; the plan is the build session's, and what it
decided for the owner to confirm is under "Decisions". Four tasks, in order. One migration, on a placeholder number.

## What the code is now

- `engine/bbcode/parse.ts`: `MAX_DEPTH = 32` counts every tag kind that takes a frame. `openReal` makes an opener at
  `home.depth >= MAX_DEPTH` a literal frame: the opener, its contents and its closer are text. A real quote
  (`[quote=<uuid>]`) there records no `QuoteSpan`.
- `engine/bbcode/conceal.ts` cuts exactly the spans `parse` reports, so a hidden post's words quoted past the cap stay
  in the layer `acts_public` serves, and the renderer (`engine/ui/bbcode/render.tsx`) draws them as text.
- SQL has a port of the parser, `bbcode_walk(body, quoted)` (current definition `supabase/migrations/0340_conduct.sql`),
  with its own `max_depth constant int := 32`. Past it a real quote is a literal frame: its words are in `plain` (search,
  Says) and in `unquoted` (`own_words`, `rule_breaks`, `spring_facts`: the reads that judge the author's own words), and
  its Act is not in `quotes` (so `acts_quote_guard`, No-quote, does not see it).
- `quote_ids(body)` (0340) is a regex and already sees a quote at any depth, so the post has its `quote_refs` row, its
  conceal request and its layer; only the layer's content is wrong.
- `engine/bbcode/visible.ts` (`visibleText`, `excerptText`, `quotedActs`) reads the tree and inherits all of it.
- The composer's quote button (`engine/ui/composer/text.ts` `quoteText`) wraps the whole shown body, so each quote of a
  quote adds a level: a chain of replies reaches any cap in ordinary play.

## Measurements

Taken on this branch's base (`7897f9c6`), Node 22, Postgres on localhost, median of 21 runs. Bodies are 20,000
characters: a quote pyramid `d` deep, distinct ids, filler spread evenly.

| depth | `parse` ms | `concealQuotes` ms | `bbcode_walk` ms (cold connection) | render to string ms |
|---|---|---|---|---|
| 1 | 0.01 | 0.01 | 6.2 | 0.05 |
| 8 | 0.03 | 0.03 | 6.4 | 0.11 |
| 16 | 0.05 | 0.06 | 7.7 | 0.19 |
| 32 | 0.05 | 0.05 | 8.1 | 0.24 |
| 33 | 0.08 | 0.06 | 8.2 | |
| 64 | 0.10 | 0.10 | 10.6 | |
| 200 | 0.26 | 0.11 | 14.0 | |

- The hostile corpus (`supabase/tests/data/conduct-quote-corpus.json`, 86 cases): 1.75 ms for all of it. The shapes
  #428 measured (`[quote=p1]` + `'[quote=zz][b]'` repeated, 20,000 and 40,000 characters): 1 to 2 ms, the same within
  noise. A single hidden quote of 40,000 characters: under the timer.
- The cap's value: `parse.ts` copied with `MAX_DEPTH` at 8, 12, 16, 24 and 32, on a 64-deep pyramid, 6,666 `[b]` and
  the hostile shape, all 20,000 characters. The differences between caps are smaller than between two runs of one cap.
  A tag past the cap is still a token and a frame, so **no value of the cap is cheaper to parse or to conceal.**
- What depth does cost is the reader's screen. Each quote takes 2% of its parent's width on each side and a 2px border
  (`engine/ui/bbcode/bbcode.css`), so in the real post column (323px wide at a 360px viewport, 967px at 1280px) the
  innermost quote's width is:

| depth | 360px viewport | 1280px viewport |
|---|---|---|
| 8 | 219px | 684px |
| 12 | 179px | 573px |
| 16 | 144px | 480px |
| 24 | 90px | 332px |
| 32 | 51px | 226px |

  No depth overflows the page. At 32 on a phone the innermost quote is 51px wide, about six characters a line, and the
  post is 3,929px tall.

## Decisions

1. **A real quote past the cap is cut.** The parser reads it as a quote that is not shown: the tree gets one `cut` node
   where the outermost such quote stood, and nothing inside it (text, tags, more quotes) is drawn. A cut is a layer over
   the words: the Act keeps the body as written ("The System acts; it never destroys what a player wrote"), and it ends
   by the author's own act, an edit that nests less ("No player is ever stuck"). Nothing new is stored.
2. **Every real quote is read at any depth.** Inside a cut the parser still follows quotes (frames with no tree, on the
   explicit stack, so depth costs nothing and nothing recurses) and reports each one's `QuoteSpan`. "Empty exactly the
   quotes `parse.ts` reads" stays the rule, and now covers every depth: `concealQuotes` needs no change of its own. The
   `cut` node carries the Acts quoted inside it, so `quotedActs`, `bbcode_walk`'s `quotes` and No-quote see them.
3. **Only real quotes are cut.** A counterfeit quote and every other tag past the cap stay text, as now: they are the
   author's own words, shown and judged as such. A real quote inside one of them is past the cap too, and is cut.
4. **What every reader makes of a cut**: the renderer draws the note; `visibleText` and `plain` give a separator, as
   for any real quote; `excerptText` and `excerpt` give nothing for it (what is not shown is not excerpted);
   `unquoted` drops it, as for any real quote.
5. **The cap is 16, one number for every tag**, down from 32. The measurements say performance does not choose: no
   value is cheaper. Reading does: at 16 the innermost quote on a phone is 144px wide, at 32 it is 51px. A pyramid
   built for the joke still stands 16 high, and the 17th level says so plainly. One cap, not a second one for quotes:
   every reader then agrees on one number, and a post with 16 nested formatting tags is nobody's ordinary post. **For
   the owner to confirm in the PR** (the answer allowed "earlier if it helps performance"; this is earlier for the
   reader's sake). Going back to 32 is the constant in `parse.ts` and in the migration's `bbcode_walk`; the fixtures
   are written from the constant.
6. **The words a player reads** (engine copy, out of character, plain; for the owner to approve in the PR):
   - In a post, in place of the cut, inside a quote box whose head is the usual one for the quoted post (its
     `Post #N` link where the thread knows it): "Quotes nested this deep are not shown."
   - In the composer, while the draft holds a cut: "Some quotes in this post are nested too deep to show. A note will
     take their place."
7. **Layers already stored.** A layer made before this change may hold hidden words past the old cap. The migration
   asks for a new layer for every post that quotes a hidden post. The new `conceal` function must be deployed before
   the migration is applied, or the job remakes the old layer; the PR says so.

## Tasks

### Task 1: the proof, red

Model: sonnet

Write the tests that prove a hidden version's words are absent for a non-author at any depth, and record each one red
at depth cap + 1 on today's code. Every depth is written from `MAX_DEPTH`, never as a number, so the tests follow the
cap. Depths to cover: 1, `MAX_DEPTH`, `MAX_DEPTH + 1`, `MAX_DEPTH + 8`, 200; and the shape where the first
`MAX_DEPTH` levels are `[b]` and the quote of the hidden post is the next tag.

- `engine/bbcode/conceal.test.ts`: at each depth, a pyramid whose innermost quote is of the hidden id holds none of the
  hidden words after `concealQuotes`; a pyramid whose level `MAX_DEPTH + 1` quotes a visible post and whose level
  `MAX_DEPTH + 3` quotes the hidden one likewise. The leak property (2,000 random bodies) counts a leak wherever the
  words sit inside a quote of the hidden id outside `[code]`, `[noparse]` and `[ispoiler]`, at any depth: give the
  generator deep pyramids.
- `engine/ui/conduct/Hidden.test.tsx` (the fake backend and the real renderer): a non-author opens a thread where a
  post quotes a hidden post at each depth; the hidden words are nowhere in the document. Also with the layer not yet
  made by `concealQuotes` (the renderer alone, given the raw body): the words past the cap are not in the document.
- `supabase/tests/e2e/`, a new file after the last number, in the shape of `0021-a-report.ts`: a post quotes a hidden
  post at each depth; `runConceal` runs with the real `concealQuotes`; then, as a non-author, every response that
  carries a post's words (`acts_public` both payload columns, and each other reader of `public_payload`: `post_search`,
  `play_moment`, and any the implementer finds) is read whole as JSON text and does not contain the hidden words. The
  author still reads their own post's words from the Act.
- A new SQL test file after the last number: for a body with a real quote at `MAX_DEPTH + 1` (the cap written once at
  the file's top, beside a line that says it is `parse.ts`'s), `bbcode_walk`'s `plain` and `unquoted` do not hold the
  quoted words, `quotes` holds the id, `excerpt` for that id is empty; `own_words` and `rule_breaks` do not judge
  them; a post under No-quote that quotes past the cap is refused by `acts_quote_guard`.

Report each red run's failing assertion. The SQL and e2e files run only under
`DATABASE_URL=postgres://postgres:pg@localhost:5432/postgres npm run test:sql`.

### Task 2: the parser cuts

Model: sonnet

`engine/bbcode/parse.ts`, `visible.ts`, `conceal.ts` (its header only), their tests and fixtures.

- `BbNode` gains `{ type: 'cut'; acts: readonly string[] }`: the Acts of the real quotes cut there, the outermost
  first, in the order their openers stand.
- A real-quote opener at `home.depth >= MAX_DEPTH` opens a cut frame: not literal (its closer closes it, and it is
  closed by an outer closer or the end of input exactly as a quote is), carrying `quoteAct` and `contentFrom` so
  `finish` records its span. What is written inside it is not kept. A real-quote opener inside a cut frame opens
  another cut frame and adds its Act to the outermost one's `acts`; every other opener inside it is literal, as past
  the cap now. Only the outermost cut frame puts a node in the tree. `[code]`, `[noparse]`, `[ispoiler]` and a bad
  opener behave inside a cut exactly as outside, so a quote the parser does not read there is not a span.
- `MAX_DEPTH = 16`. The header comment and the constant's comment say what a real quote past it becomes.
- `visible.ts`: `visibleText` gives a cut the separator a real quote gives; `quotedActs` includes a cut's `acts`;
  `excerptText` takes nothing from a cut.
- Tests first, each red before the change: a pyramid of `MAX_DEPTH + 5` real quotes is `MAX_DEPTH` quotes and one
  `cut` with five Acts, and five spans past the cap; the tree is never deeper than now; 10,000 nested real quotes parse
  in time that grows with length alone (the existing megabyte shapes, with real quotes); counterfeits past the cap are
  text, and a real quote inside them is cut; the conceal property `parse(concealed)` equals the emptied tree still
  holds. `engine/bbcode/plain.fixtures.ts` "a real quote past MAX_DEPTH" now expects no quoted words and the id in
  `quotes`, and gains the cases Task 1's SQL file needs; regenerate `supabase/tests/0117-bbcode-plain.sql` with
  `node tools/bbcode-plain.mjs` (it is red in SQL until Task 3). `engine/bbcode/unquoted-corpus.test.ts` gains
  templates past the cap and `supabase/tests/data/unquoted-corpus.json` is regenerated.
  `supabase/tests/data/conduct-quote-corpus.json` gains past-cap cases (written for the cap of 16, with a test that
  fails if `MAX_DEPTH` changes without them).
- Task 1's `conceal.test.ts` cases go green here; its `Hidden.test.tsx` raw-body case goes green in Task 4.

### Task 3: SQL reads the same

Model: sonnet

A migration on the placeholder number `0344` (`0344_quote_cut.sql`); the merging session gives the real one.

- `bbcode_walk` redefined from 0340's, with `max_depth := 16` and: a real quote whose home is at the cap opens a frame
  as a real quote does (never the `keep` frame of the excerpt), its Act goes into `quotes`, and it is dropped from
  `unquoted`; inside it a real quote does the same and everything else is as past the cap now. Grants as 0340's.
- `conceal_request_hidden_quoters()`: for every post now hidden from quoting (`quote_hidden`), requests a layer for
  each post that quotes it, through `conceal_request_quoters`. Security as its neighbors in 0340 (`search_path`
  pinned, ending in `pg_temp`; no client grant). The migration calls it once.
- Tests: Task 1's SQL file and e2e file go green; `0117-bbcode-plain.sql` and `0165-conduct-model-reads.sql` (the
  regenerated corpus) go green; a test that `conceal_request_hidden_quoters()` writes a request for a post whose layer
  was recorded before, and that `conceal_due` then returns it; the benchmarks in `0168-conduct-concealing.sql` and
  `0118-bbcode-plain-scale.sql` still pass unchanged.
- Any comment in a current migration or document that says a quote past the cap is text is not edited where it is a
  record; `tools/` guards that name the cap follow the constant.

### Task 4: what a reader and an author see

Model: sonnet

- `engine/ui/bbcode/render.tsx`: a `cut` node is a `blockquote.kb-quote` with the usual head for `acts[0]` and, as its
  body, the note of Decision 6 in a `<p role="note">`. The note is a component beside `HiddenNote`
  (`engine/ui/conduct/Hidden.tsx`) or in the renderer's own folder, whichever the code around it suggests; styled as
  `HiddenNote` is, meeting contrast.
- The composer (`engine/ui/composer/Composer.tsx`): while `parse(draft)` holds a `cut` at any depth, the notice of
  Decision 6 shows by the draft, in a live region, and goes when the draft no longer holds one. Posting is not refused.
- `engine/ui/data/fake.ts` follows whatever Task 2 changed in what it calls.
- Tests first, each red: `engine/ui/bbcode/render.test.tsx`: `MAX_DEPTH + 3` nested real quotes draw `MAX_DEPTH`
  blockquotes and one note, and the words past the cap are not in the document; the composer shows and clears its
  notice; Task 1's `Hidden.test.tsx` cases are green.

## Review focus

- A quote the parser reports and a quote `bbcode_walk` reports are the same quotes, at every depth, in and out of
  `[code]`, `[noparse]`, `[ispoiler]`, counterfeits and unclosed tags.
- Nothing inside a cut reaches any output: the tree, `visibleText`, `plain`, `excerpt`, `unquoted`, the DOM.
- The parser stays one pass with no recursion and no quadratic input, with cut frames nested without bound.
- The words in Decision 6 are true in every case the note can show (a quoted id that is no Act's, a hidden post, a
  quote cut because of formatting tags and not a pyramid).
- The migration's request for new layers, on an instance with many hidden posts and many quoters.
