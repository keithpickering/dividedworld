# Chunked id reads: design and plan

Record, written 2026-10-31. The design and plan for #104, made with the owner in the session that wrote
`docs/plans/2026-10-31-marks-and-the-lens-design.md`. The owner chose a plan of its own, so the data layer's fix neither
waits on nor rides with the marks build. One build session, one PR, which says `Closes #104`.

## Design

### Where it starts

`web/src/data/supabase.ts` reads by id with PostgREST's `in.(…)`, which puts every id in the request's address. Two of
those reads are chunked: `actsById` and `effectStates` go through `chunks()` at `ID_CHUNK = 100`, "so its address stays
short whoever asks". `supabase.test.tsx` holds them under 8,000 characters ("reads Acts and effect states by id in
chunks"). No other by-id read is chunked.

#97 put every play's id into the page's `tallies` and `myReactions` reads (`prepare`, `engine/ui/thread/Thread.tsx`).
#104 measured a 20-post Divided World page at 7,106 characters. `postsPerPage` is unbounded
(`engine/rules/instance.ts`), and `readGap` reads a whole gap of missed posts. A page of about 23 posts with plays, or a
60-post gap with 4 plays a post (about 11.8KB), goes over the bound. Then a player sees "The thread could not be
loaded", or the gap's posts stay missing until a reload.

### Decided

- **Every by-id read is chunked** (the owner chose this over chunking only the two reads #104 names). Every one of them
  takes a list a busy instance can grow: posts, plays, characters, threads, settlements. A read left unchunked "because
  today's list is short" is the failure #104 is. The reads, by function:
  - `characters` (the `characters_public` and `character_profiles` pair);
  - `spunFromMany` and `cardsOnMany` (ordered, limited);
  - `myReleases`;
  - `characterStats`;
  - `tallies`;
  - `viewCounts`;
  - `standingAmounts`;
  - `classReveals` and `turnsAnnounced` (ordered);
  - `myReactions`;
  - `reading`;
  - the log's `my_ledger_shares` read (ordered, paged by `every`).
- **An ordered or limited read gives the rows a single query would.** Each chunk is asked with the same filters and
  order, and with the whole `limit` (a chunk can hold every one of the top rows). The chunks' rows are merged and sorted
  by the read's own order, then by the row's id, so ties fall the same way on every screen. The result is cut to the
  limit. A paged read (`every`) pages within each chunk, then merges the same way.
- **A guard holds it** (the owner chose a new pair rather than growing `check-web-reads`, so each guard has one rule):
  `tools/check-id-reads.mjs` and `tools/test-id-reads.mjs`. It reads the TypeScript AST of `web/src/data/` (tracked,
  non-test files), as `check-web-reads.mjs` reads its tree. A `.in(column, list)` is clean when `list` is the parameter
  of the function passed to `.map` (or `.flatMap`) on a `chunks(…)` call. It is also clean when its column is in
  `BOUNDED_IN`, a frozen list of `{ column, bound }` with each bound stated. That list holds only `kind` ("the Act
  kinds, a fixed list in the rules"). Anything else fires with the file, line and column. Its poison is today's `tallies`.
- **Nothing a player sees changes**, and no fact moves: the same rows are read by the same views. The masks are not
  touched, and no migration is needed.

### A busy instance

The cost of a read now grows in requests of at most 100 ids, run in parallel (`Promise.all`), never in one address that
fails. A 20-post page with plays is two requests for its tallies where it was one. A 60-post gap is a handful. That is
what a busy instance pays, and it never fails on size.

## Plan

Every task is test first: the test named, its red run recorded, then the code. The guard's poison is planted and seen
red before the guard is trusted ("A guard that has never been red is not known to work").

### Task 1. Chunk every by-id read (web)

**Files:** `web/src/data/supabase.ts`; test `web/src/data/supabase.test.tsx`.

- Add `byChunks<T>(ids, read: (part) => Promise<T[]>): Promise<T[]>`, which runs `read` for each chunk in parallel and
  flattens the results. Add `merged(rows, order: (a, b) => number, limit?: number)`, which sorts by the read's order,
  then by id, and cuts to `limit`.
- Move every read listed in the design onto them. `spunFromMany`, `cardsOnMany`, `classReveals` and `turnsAnnounced`
  keep their `.order(…)` and `.limit(rowLimit(limit))` per chunk, and are merged in the same order. The ledger shares
  run `every` per chunk of settlement ids and merge by the read's five-key order.
- `characters`: chunk both of its reads, and join them as today.

Tests first:
- Extend the existing case ("reads Acts and effect states by id in chunks…") into one `it.each` over every chunked read,
  each given 450 ids. Each must make 5 requests, each under 8,000 characters, and read every id once.
- Run it before the change, and record the red for `tallies` and `myReactions` at least.
- `cardsOnMany` with 250 posts and `limit` 7: the answer is the 7 earliest rows across all chunks, in order, the same as
  the harness's single-query answer over the same rows.
- `spunFromMany` likewise.
- `classReveals`: rows with equal `at` across two chunks come back ordered by id.
- The ledger shares: 150 settlements, one with more than `ROW_CAP` rows, come back whole and in order.
- A failure in one chunk fails the read as a single request's failure would. It is not swallowed into a partial answer,
  because a missing chunk would show as zero reactions.

### Task 2. The guard: every by-id read is chunked (tools)

**Files:** `tools/check-id-reads.mjs` (new), `tools/test-id-reads.mjs` (new), `tools/build.mjs` (`STEPS`: the test,
then the check, immediately after `check-web-reads`).

- `readFaults(files: Record<path, text>)`, exported and pure, and `treeFiles()` from `git ls-files web/src/data`,
  without `*.test.*`, as `check-web-reads.mjs` does. Parse with `typescript`. For each call `X.in(col, list)` whose
  callee property is `in`:
  - Clean when `col` is a string literal in `BOUNDED_IN`.
  - Clean when `list` is an identifier that is the first parameter of an arrow or function expression passed as the
    first argument to `.map`/`.flatMap`, whose receiver is a call to `chunks` (or to `byChunks`, whose second argument
    is that function).
  - Anything else fires: `{ file, line, column }`. That includes an unreadable column (a variable), a spread
    (`[...ids]`), an array built in place, or a list passed through a variable first.
- The check prints each fault and exits 1, or prints "id-reads: N `.in()` reads in M files, each chunked or bounded".

Tests first (`test-id-reads.mjs`), each case red before the guard exists:
- **The poison:** main's `tallies` read verbatim (`.in('act', [...acts])`) fires, with its line.
- `.in('id', ids)` fires; `.in(col, part)` with `col` a variable fires.
- `chunks(ids).map((part) => client.from('x').select('*').in('id', part))` is clean, and so is `byChunks(ids, (part) =>
  …in('id', part))`.
- The same, but with the `.in` given `ids` in place of `part` inside the map, fires.
- A `part` from a `.map` on something other than `chunks` fires.
- `.in('kind', [...kinds])` is clean, because `kind` is in `BOUNDED_IN`.
- A test file is not read.
- The real tree reads clean, and the guard counted more than zero `.in()` calls, so a guard gone quiet over nothing fails
  here.

Run `node tools/test-build-steps.mjs` to show `STEPS` takes the pair, then `npm run build`.

### Last. The full build and the final review

`npm run build` green, with its output in the PR. The PR carries one measured address: a 23-post page with 8 plays a
post, read through the harness, in requests each under 8,000 characters.

## Ways out

Nothing here puts a player, a character or a post in a state. What it removes is a page that could not load, and a gap
that stayed missing until a reload.

## Review focus

- **A merged answer that differs from a single query's.** Look for an ordered and limited read that is cut per chunk
  but not overall, a tie order that differs from the old one in a way a screen depends on (the ORIGIN box's plays, the
  board's spun-thread lines), and a `limit` of 0 or 1.
- **A partial failure.** One chunk's error must fail the whole read, never return the other chunks' rows as the answer:
  a missing chunk of tallies reads as "no reactions", and a missing chunk of releases holds a reader again.
- **The guard's blind spots.** A list renamed through a variable before `.in`, a helper wrapping `.in`, or `.in` reached
  through `client['in']` or a cast. Each should fire or be named in the PR as out of scope.
- **Parallel requests at a busy instance.** A gap fill now makes several requests at once. Check that nothing upstream
  (the gap's backoff in `engine/ui/thread/`) counts them as separate failures, or retries one chunk into a loop.
