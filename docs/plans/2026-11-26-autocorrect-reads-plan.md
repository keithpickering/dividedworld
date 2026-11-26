# How The System reads a post wearing Autocorrect: plan

Record, written 2026-11-26. The plan for `docs/plans/2026-11-26-autocorrect-reads-design.md`. One build session
builds it in one PR from `main`, after the design's PR is merged. No migration: nothing here touches SQL or a deployed
database.

Every task is test first: name the test, record its red run, then write the code. This plan adds no `check-*.mjs`; the
boundary check (the engine never imports an instance) stays green, and Task 2's engine tests use a card defined in the
test, never Autocorrect.

**The layers.** Tasks 1 to 3 are the engine's: the parser's text spans, the `covers` interface and applying it, and
the wiring of every renderer that shows a post's words. Task 4 is Divided World's: Autocorrect's `covers` and its tuned
`seen` sentence.

## The words this plan uses

- A post's **visible text** is `visibleWalk(parse(body)).text` (`engine/bbcode/visible.ts`), the text Autocorrect's
  matcher reads and the board's strips lie over.
- A **cover** is `{ from, to, words }`: a stretch of the visible text (`from` inclusive, `to` exclusive, in its own
  offsets) and the words read over it.
- A play is **in place** while its card's `covers` returns covers for it.

## Task 1. Text spans from the parser (engine)

Model: sonnet

**Files:** `engine/bbcode/parse.ts`, `engine/bbcode/parse.test.ts`.

- `parse(input, spans?, forged?, texts?)`: a fourth optional out-parameter, `texts: Map<BbNode, TextSpan>`, with
  `TextSpan = { from: number; to: number }`, filled for each `text` node of the returned tree, keyed by node identity
  as `visibleWalk`'s `offsets` are, with where its text lies in the input, by the offsets the parser itself worked at,
  as `spans` is for quotes. A node is recorded only where `input.slice(from, to) === node.text`; a node merged from
  pieces that are not one contiguous slice (`pushText`), or whose text the parser built rather than copied, is left
  out. Passing `texts` changes nothing about the tree, and the parse's cost stays linear.
- Export the `TextSpan` type beside `QuoteSpan`.
- Tests first: for every input of the parser's existing tests and the unquoted corpus
  (`engine/bbcode/unquoted-corpus.test.ts`), every recorded span's slice equals its node's text, and the tree with
  `texts` deep-equals the tree without it. Named cases: plain text; text inside bold, color and a list item; text either
  side of a real quote; a tag past `MAX_DEPTH` read as text; an unclosed tag read as text; text before and after a bare
  address (an `autolink` node is not a `text` node and records nothing). Coverage: for plain prose with simple
  formatting, every text node is recorded (assert the count).

## Task 2. The `covers` interface and applying it (engine)

Model: sonnet

**Files:** `engine/rules/cards.ts`, `engine/rules/cards.test.ts`; new `engine/system/cover.ts` and
`engine/system/cover.test.ts`.

- In `engine/rules/cards.ts`, beside `SeenPlay` and `seen`:

  ```ts
  /** What a card's `covers` reads: one play's public configuration and state, and the post's visible text. */
  export interface CoverPlay { readonly config: unknown; readonly state: unknown; readonly text: string }
  /** A stretch of a post's visible text, [from, to), and the words a reader sees over it. */
  export interface Cover { readonly from: number; readonly to: number; readonly words: string }
  ```

  and on `CardRules` an optional `covers?: (p: CoverPlay) => readonly Cover[] | null`, documented as: the stretches of
  the post's visible text this play covers with other words, as every reader of the board sees them before touching
  the play, read by a model in place of the words under them (the post's own words stay the post's, and its `seen`
  line still says what lies over them); null or empty for none. Pure, never a private fact.
- `engine/system/cover.ts`: `coveredBody(body: string, plays: readonly ReadPlay[], covers: (card: string | null, p: CoverPlay) => readonly Cover[] | null): string`.
  - Returns `body` unchanged, without parsing, when no play's `covers` gives a cover (ask each play first with the
    visible text; parse only once a card has `covers`). Parse once with `texts`, walk once with `visibleWalk`.
  - Plays are taken in the order given (the order `post_extras` returns them, by `created_at` then `id`, oldest first, which is the
    board's stacking order). A cover is dropped where it is out of bounds (`from < 0`, `to > text.length`, `from >= to`) or its words are
    not a string. Of two overlapping covers, the later play's is kept and the earlier one is dropped whole (the board
    shows the later strip on top); covers of the same play never overlap (the matcher's occurrences do not), and if
    they do, the first is kept.
  - Each kept cover is written into the source: for each text node whose visible stretch
    (`offsets.get(node)` to that plus its length) meets the cover, the met part of the node's source slice is replaced,
    the first met node taking `words` and every later one taking nothing; tags between them stay as written. A cover
    that meets any text node with no recorded span is skipped whole. Edits are applied from the end of the input back,
    so offsets hold.
  - Tests first, with a card defined in the test (its `covers` replaces a fixed word): plain text; a cover inside
    `[b]...[/b]`; a cover crossing `[b]warp[/b] pipe` (reads `[b]haunted toilet[/b]`); a cover beside a real quote
    leaves the quote as written; two plays with overlapping covers (the later wins, the earlier is dropped whole); two
    plays that do not overlap (both in place); a play whose card has no `covers` and a play with a null card leave the
    body exactly as given (no parse: assert by identity of the returned string); an out-of-bounds cover is dropped; a
    cover meeting a text node with no span is skipped (build one with a stubbed `texts` or an input from Task 1's
    unrecorded cases).

## Task 3. Every renderer reads the covered words (engine and the Edge Functions)

Model: sonnet

**Files:** `engine/system/read.ts`, `engine/system/read.test.ts`, `engine/system/judgment.ts` (`patrolPostLines`),
`engine/system/judgment.test.ts`, `engine/system/digest.ts` (`DigestWords`, `renderDigest`),
`engine/system/digest.test.ts`, `supabase/functions/_shared/pool-read.ts` (`ReadContext`, `readingOf`) and its test,
`supabase/functions/meet/core.ts` (the `renderDigest` words, beside `seen` at its line 350 as this is written), and the
tests beside each.

- `ReadOptions` gains `covers?: (card: string | null, p: CoverPlay) => readonly Cover[] | null`; absent means none.
- `readThread`: each candidate's body is `coveredBody(c.body, c.plays, …)` before `markWith`, for the marked and the
  third-person bodies alike, so the size a post counts (`size`) is the covered body's. `originBlock`: the origin post's
  body likewise, with its own plays. A rewound post covers the version it shows (`body` is that version's).
- `patrolPostLines` (`engine/system/judgment.ts`): the sample post's body likewise, so `patrolShown` counts it.
- `renderDigest`: `DigestWords` gains `covers`; an excerpt whose `extras` carry plays (`digest.excerpts`, the standouts'
  `r.text`, a conversation's exchange texts) is covered before `excerpt()` cuts it. A request's body carries no plays
  and is unchanged.
- `ReadContext.cards` picks `covers` too; `readingOf` passes `covers: (card, p) => (card === null ? null : byKey.get(card)?.covers?.(p) ?? null)`;
  `meet/core.ts` passes the same for the digest.
- Tests first: in `read.test.ts`, a candidate with a test card's covering play reads its covered words in `readLines`
  and its play line under them, and a post quoting it still gets its quote marker only where the quote matches the
  quoted post's own words (unchanged rule: a quote holds the words as they were written); the origin's post is covered;
  sizes count the covered body. In `judgment.test.ts`, a patrol sample post is covered. In `digest.test.ts`, an excerpt
  with a covering play is covered and a request body is not. In
  `supabase/functions/_shared/pool-read.test.ts`, `readingOf` reaches a
  card's `covers` by key and gives null for an unknown card.

## Task 4. Autocorrect's covers and its line (instance)

Model: sonnet

**Files:** `instances/divided-world/cards/autocorrect.ts`, `instances/divided-world/cards/autocorrect.test.ts`.

- `covers: (p)`: null unless the configuration holds a string `phrase` and `replacement` and the state holds no saved
  peel. A state holds a saved peel when `peeled` is a non-empty list, `stuck` is an object with any key, or `clean` is
  true; an absent or non-object state holds none. Otherwise every `occurrences(p.text, phrase)` as
  `{ from, to, words: replacement }`.
- `seen`: when the tape is untouched (the same test: no saved peel), the sentence gains, after the time,
  ` The post above reads as the tape shows it; the marker words are ${who}'s.`, and with no caster named
  (`p.by` null or blank) ` The post above reads as the tape shows it; the marker words are not the post's own.` The
  peeled sentences are unchanged. Update the header comment: a staff read reads untouched tape as the board shows it
  (this design), and the existing test at `autocorrect.test.ts` line 233 as this is written, which expects the old
  untouched sentence, takes the new one.
- Tests first:
  - `covers` returns the same stretches, in the same order, as `stripsOf(text, [{ id, phrase, replacement }])`
    (`instances/divided-world/cards/autocorrect/tape.ts`) for a set of texts (once, twice, in any case, across
    formatting's visible text, none): the read lays the board's strips.
  - `covers` is null for `{ peeled: [0] }`, for a `stuck` save, for `clean: true`, and for a configuration with no
    phrase; it covers for an absent state and for `{ peeled: [] }`.
  - Through `coveredBody` with Autocorrect's `covers` (an instance test may import the engine): "Is the warp pipe
    broken?" taped "warp pipe" → "haunted toilet" reads "Is the haunted toilet broken?"; the same post with
    `{ peeled: [0] }` reads as written.
  - The `seen` sentences: untouched with a caster, untouched with none, peeled (unchanged), and every Divided World
    card that reaches a post still has a `seen` (the existing test in `cards.test.ts`).

## Review focus

- A text node the parser does not record leaves a cover unapplied while the line says the post "reads as the tape
  shows it": confirm the unrecorded cases are corners no ordinary post reaches, by the corpus count in Task 1.
- The order of plays `post_extras` returns must be the board's stacking order (`stripsOf`'s `z`), or the read and the
  board disagree on which of two overlapping strips is on top.
- A rewound post: confirm the board lays Autocorrect's strips over the version a rewind shows, as the read now does.
- A quote of a taped post: the quoted words are the post's own words, so a reply quoting it is marked only where the
  quote matches them; a covered body must never feed `sourceOf` for a quote comparison.
- Every staff duty that reads a post (the chatter's turns and picks, filings, reports, appeals, the patrol, the digest,
  and the written quiz once it reads through `readOf`) goes through one of the three renderers: no prompt assembles a
  post's body another way.
- The read stays computed from public inputs only: the post's public body and the play's public configuration and
  state, nothing about who cast it beyond the name the board shows.
