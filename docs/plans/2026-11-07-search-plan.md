# Search: plan

Record, written 2026-11-07. Builds `docs/plans/2026-11-07-search-design.md`; the board is
`docs/research/2026-11-07-search/01-search.html`. Read the design whole before any task. Section numbers below are the
design's.

Numbers: the migration is `supabase/migrations/0101_search.sql` and its SQL tests `supabase/tests/0103-search.sql` and
`supabase/tests/0104-bbcode-plain.sql`, or the next free numbers when the build starts if another PR has taken them
(`tools/check-migration-versions.mjs` refuses a clash). Every test below is written first and seen red.

## Task 1: the plain words, one list in two languages

Model: sonnet

Design section 4.

Files:
- `engine/bbcode/plain.fixtures.ts` (new): an array of `{ name, body, plain }`, where `plain` is `visibleText(parse(body))`
  with each run of whitespace collapsed to one space and the ends trimmed. At least: plain text; each of bold, italic,
  underline, strike, color, size; a list; a quote (its words gone); a quote in a quote; code; a link with and without
  `=`; an image; an unclosed tag, an unknown tag, a stray closing tag and a tag past `MAX_DEPTH`, each as
  `engine/bbcode/parse.test.ts` says the parser reads it; non-Latin text; an empty body.
- `engine/bbcode/plain.test.ts` (new): each fixture's `plain` is `collapse(visibleText(parse(body)))`.
- `tools/bbcode-plain.mjs` (new): `sqlTests(fixtures)` makes the text of `supabase/tests/0104-bbcode-plain.sql`, one
  `do` block asserting `collapse(bbcode_plain(body)) = plain` for every fixture, the fixture's name in the raise; and
  run as a script, writes that file.
- `tools/check-bbcode-plain.mjs` (new): `plainFaults(fixturesText, sqlText)` returns the first line where the file
  differs from what `sqlTests` makes, as `foldFaults` does (`tools/check-name-folds.mjs`).
- `tools/test-bbcode-plain.mjs` (new). Poisons, each must fire: a fixture dropped from the SQL file; a fixture's
  `plain` changed in the SQL file only; a fixture added to the fixtures only; the SQL file edited by hand on a line
  that is not an assertion. The real pair stays clean.
- `tools/build.mjs`: `node tools/test-bbcode-plain.mjs` then `node tools/check-bbcode-plain.mjs` in `STEPS`, after the
  name folds' pair.
- `supabase/migrations/0101_search.sql` (new, begun here): `bbcode_plain(body text) returns text`, `immutable`,
  `parallel safe`, plpgsql, a tokenizer that keeps a stack as `visibleWalk` does (never recursion), the parser's tag
  names, its nesting cap and its reading of a malformed tag. Its header says it mirrors `engine/bbcode/visible.ts`
  and `engine/bbcode/parse.ts`, and which check holds it.

Tests first: `plain.test.ts` red on a missing fixtures file; `0104-bbcode-plain.sql` red before `bbcode_plain` exists;
`test-bbcode-plain.mjs` red before the check exists.

## Task 2: the index

Model: sonnet

Design sections 2, 3, 4 and 6.

Files:
- `supabase/migrations/0101_search.sql`, continued:
  - `create extension if not exists pg_trgm with schema extensions; create extension if not exists unaccent with schema
    extensions;` and `fold_text(t text) returns text`, `immutable`, `lower(extensions.unaccent('extensions.unaccent',
    t))`, the wrapper an index expression needs.
  - Two settings: `searchLanguage` (a text search configuration name that `pg_ts_config` holds) and `searchRankPool` (a
    whole number from 100 to 100,000), each a branch of `settings_held()` (`0077_settings_held.sql`) raising
    `'<key> is <the rule's words>'` with 23514, and each in the settings the screens read where `postsPerPage` is.
  - `post_search (act uuid primary key references acts (id), thread uuid not null, character uuid, created_at
    timestamptz not null, words tsvector not null)`, row level security on, readable by `authenticated` with `using
    (true)` as the Acts are; indexes: GIN on `words`; `(created_at desc, act desc)`; `(character, created_at desc)`;
    `(thread)`.
  - `search_words(body text, title text) returns tsvector`: `setweight(to_tsvector(lang, coalesce(title, '')), 'A') ||
    to_tsvector(lang, bbcode_plain(body))`, `lang` read from `searchLanguage`.
  - `acts_search()`, an `after insert` trigger on `acts`: for a `post` or `spin`, inserts the row (a thread's first
    post, seq 1, carries its thread's title at weight A, so titles and posts match in one index); for an `edit`, updates
    the edited post's `words` from the edit's body. Nothing else. It is a row beside the Act, never the Act.
  - The backfill: every `post` and `spin` in `acts_public`, by its `current_payload`.
  - The language's way to change: a `settings` trigger on `searchLanguage` that records a rebuild (a
    `search_rebuild (after_act uuid)` row), and a `pg_cron` job that rewrites `words` 5,000 rows a run in Act-id order
    until the rebuild row is done and deleted, scheduled as `0004_schedule.sql` schedules its jobs.
  - Trigram GIN indexes: `threads using gin (fold_text(title) gin_trgm_ops)`; `characters using gin (fold_text(name)
    gin_trgm_ops)`.
- `instances/divided-world/settings.ts`: `searchLanguage: 'english'`, `searchRankPool: 5000`, each with a comment
  saying why.
- `engine/rules/types.ts` (`Settings`) and `engine/rules/instance.ts` (`SETTINGS`, `settingsProblems`): the two keys
  and their rules, the words matching the SQL's.

Tests first, in `supabase/tests/0103-search.sql`: a post, a spin, a Mod Bot's post each get a row; a card play, a
tally, a reveal, an announce get none; an edit changes what the post matches and a second edit again; a quoted
post's words do not match the quoter; the backfill indexes a post written before the trigger (create the post with the
trigger disabled, then run the backfill's statement); `searchLanguage = 'simple'` then the rebuild job leaves no row
in the old language; each settings refusal names its key. In `engine/rules/instance.test.ts`: the two keys' rules.

## Task 3: the reads

Model: sonnet

Design sections 1, 5, 6, 7 and 9.

Files:
- `supabase/migrations/0101_search.sql`, continued. Every function `language sql stable security invoker`, granted to
  `authenticated` only, refusing out-of-range arguments through `screen_refusal()` (`0094_thread_page.sql`):
  - `search_posts(q text, author uuid, board uuid, from_at timestamptz, to_at timestamptz, titles_only boolean, sort
    text, after jsonb, per_page integer) returns jsonb`: `{ count, more, pooled, results: [{ act, thread, title, board,
    board_slug, board_name, seq, page, character, name, created_at, snippet, cards }], next }`.
    - Threads are those `thread_open` holds (unlisted included, Updates thread excluded; design section 1).
    - `q` through `websearch_to_tsquery(lang, q)`; `titles_only` matches only seq-1 rows' weight A
      (`ts_filter(words, '{a}')`) .
    - `sort`: `relevance` (the default with `q`), `newest` (the default without), `oldest`. Relevance takes the newest
      `searchRankPool` matches, ranks them by `ts_rank_cd`, and sets `pooled` when the pool was full.
    - `count` is the count of at most 1,001 matches; `more` is true past 1,000.
    - `after` and `next` are the keyset cursor: `{ rank, at, act }`; `per_page` 1 to 50, default 20.
    - `page` is the page of the thread the post is on, from `seq` and `postsPerPage`.
    - `snippet` is `ts_headline(lang, bbcode_plain(current body), query, 'StartSel=<<,StopSel=>>,MaxFragments=1,
      MaxWords=30,MinWords=12')`. The markers are plain characters the screen turns into elements; no HTML is built
      in SQL.
    - `cards`: the card keys of plays live on the post, at most 8, read as `thread_page` reads `on_posts`.
    - `name` from `characters_public`; `board_name` from `boards_now`.
  - `search_threads(…the same filters…, after jsonb, per_page integer) returns jsonb`: one row per thread, with its best
    snippet and `matches` (its matching posts, counted to 100, then "100+"), the same count and cursor rules.
  - `search_suggest(prefix text, kinds text[], board uuid, exclude_system boolean, most integer) returns jsonb`:
    `{ threads: [{ id, title, board, board_name }], characters: [{ id, name }], boards: [{ id, slug, name }] }`.
    - A prefix of 2 to 100 characters, matched by `fold_text(x) % fold_text(prefix)` or `fold_text(x) like
      fold_text(prefix) || '%'`, best `similarity` first, then newest.
    - Threads from `thread_open`; characters from `characters_public` joined to the trigram-indexed `characters` by a
      `security definer` helper, `suggest_characters(prefix, most)`, returning only `characters_public`'s id and name of
      debuted characters, since `characters` is owner-only (`0001_core.sql`).
    - An empty `prefix` with `kinds = '{threads}'` lists the newest threads (the Reveal field's empty state).
    - `most` 1 to 10 per kind.
- `tools/check-web-reads.mjs`: `search_posts`, `search_threads`, `search_suggest` in `ALLOWED_RPCS`.

Tests first, in `supabase/tests/0103-search.sql`: each filter alone and together; titles only; each sort; the cursor
walks a result set with no repeat and no gap; the count stops at 1,001; a pool of 3 (setting lowered) sets `pooled`; a
post in the Updates thread is never found and one in an unlisted thread is; `search_suggest` finds "Mario" from "mairo"
and from "MAR"; a character not yet debuted is never suggested and, given as `author`, finds nothing, the same answer as
a random uuid; every refusal. In `supabase/tests/e2e/0016-screen-reads.ts`: the three functions are security invoker
and write nothing, as it holds for the screen reads.

**The scale test**, in `supabase/tests/0103-search.sql`: 200,000 generated posts over 2,000 threads, a common word in
half of them and a rare word in ten. `explain (format json)` of `search_posts` for each word, each sort, and of
`search_suggest`, asserting no sequential scan on `post_search`, `acts`, `threads` or `characters`, and that a relevance
search's ranked rows are at most `searchRankPool`. A plan's shape, not a clock, so a loaded machine cannot trip it.

## Task 4: the data layer

Model: sonnet

Files:
- `engine/ui/data/api.ts`: types `SearchQuery`, `PostHit`, `ThreadHit`, `SearchPage<T>`, `Suggestions`; on
  `KayfaApi`, `searchPosts(q, after?)`, `searchThreads(q, after?)`, `suggest(prefix, opts)`.
- `web/src/data/supabase.ts`: each through its rpc, mapped to camelCase as `boardPage` is.
- `engine/ui/data/fake.ts`: the same over the fake's posts, with `visibleText` and a plain word match, so the demo,
  the stories and the UI tests search. It keeps the real one's count, pool and cursor rules on a small scale.
- `engine/ui/search/highlight.ts` (new): `snippetParts(snippet)` turns `<<…>>` into `{ text, hit }` parts; a stray or
  unclosed marker is text.

Tests first: `highlight.test.ts`, every marker case; `fake` tests that the fake honors each filter, the cursor and
the count cap.

## Task 5: the combobox

Model: sonnet

Design sections 7 and 8.

Files:
- `engine/ui/search/useSearchCombobox.ts` (new): the headless hook. Input value; open state; options in groups; the
  active option; a 150 ms debounce; at least 2 characters unless the source allows an empty query; a reply that comes
  after a newer keystroke is dropped; ArrowUp, ArrowDown, Home, End, Enter, Escape; `aria-activedescendant`; a polite
  live line ("5 suggestions", "No suggestions").
- `engine/ui/search/BoardCombobox.tsx` and `board-search.css` (new): the board skin, as the board draws it.
- `engine/ui/search/GlassCombobox.tsx` and `glass-search.css` (new): the glass skin, in `kb-glass-field` and the
  glass tokens.
- Every class is in `tools/check-css-classes.mjs`'s reach, every color a token (`tools/check-ui-tokens.mjs`).

Tests first, in `engine/ui/search/*.test.tsx`: each key; the debounce (fake timers); a late reply dropped; the ARIA
roles and properties; axe clean in each skin (`engine/ui/a11y.ts`).

## Task 6: the banner and the page

Model: sonnet

Design sections 5 and 7, and the board.

Files:
- `engine/ui/frame/Frame.tsx`: signed in, the banner holds `BoardCombobox` on the right where the host line stands,
  except on `/search`; the boards bar's last link is Search, with the board's magnifier icon, in the phone's Boards
  menu too.
- `engine/ui/search/SearchScreen.tsx` and `search.css` (new): the form and the results as the board draws them; the
  count line in each of its forms (exact, "More than 1,000", pooled); results as posts and as threads; the card marks
  drawn as `engine/ui/cards/marks.css` draws a card's mark; Previous, Next and the numbered pages; the empty result
  ("No posts match. Try fewer words, or another board."); a refusal said plainly.
- `engine/ui/search/query.ts` (new): the URL's fields to a `SearchQuery` and back, every field, unknown values
  dropped to their defaults.
- `web/src/App.tsx`: `/search` with a loader, as `/b/:slug` has one.
- `engine/ui/routes.tsx` and `engine/ui/screen-docs.ts` if the loader pattern needs them.

Tests first: `query.test.ts` round-trips every field; `SearchScreen.test.tsx` renders each count line, each result
kind, the card mark, the empty and the refused states, the matched words marked by an element and not color;
`Frame` tests: the box shows signed in and not on `/search`; the link shows signed in only.

## Task 7: the Reveal overlay's thread field

Model: sonnet

Design section 8.

Files:
- `engine/ui/characters/RevealOverlay.tsx`: the board `<select>`, the thread `<select>`, "Show older threads" and
  their state go; a `GlassCombobox` labelled Thread takes their place, its source `suggest(prefix, { kinds:
  ['threads'], excludeSystem: true, board })`, empty showing the newest threads; an optional board filter beside it,
  a `kb-glass-select` of the boards less The System's, "All boards" first. The chosen thread's title still feeds the
  preview and the submit.
- Its tests: the overlay's existing tests updated; a thread found by typing; the board filter narrows; The System's
  board's threads never offered.

## Task 8: the story and the shots

Model: sonnet

Files:
- `e2e/`: a Playwright story on the demo: type in the banner, arrow to a thread, Enter; search posts by phrase,
  filter by author, page forward and back; results as threads; reveal a class through the new field.
- Shots of the banner's suggest list and the results page at 1440 and 390, light and dark, beside the board, in
  `docs/research/2026-11-07-search/`, for the final review.

## Review focus

- The backfill and the trigger on an instance that already holds Acts: every post indexed once, an edit made during the
  migration not lost, and the export and import (`tools/export-instance.mjs`, `tools/import-instance.mjs`) round-trip
  `post_search` without the trigger writing a second row on import.
- `bbcode_plain` against the parser on malformed and deeply nested input: the fixtures cover what `parse.test.ts`
  covers, and the walk is bounded.
- The scale test's plans, and whether a relevance search with a board or author filter still stays inside the pool.
- The language rebuild: a search during a rebuild mixes two languages for a while; it returns fewer matches, never an
  error, and the job ends.
- The masks: `suggest_characters` is security definer over the owner-only `characters` table and must return nothing
  that `characters_public` does not show; no response, count or timing varies with who owns a character.
- The combobox's stale-reply drop, under a fast typist and a slow network.
