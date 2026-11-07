# Search: design

Record, written 2026-11-07. A design session with the owner, started from the owner's request: "Let's design Search.
There is no way to search for threads or posts. If we build it we can reuse it for the thread selects in the "Reveal"
modal and anywhere else they appear, currently plain old selects. Should be performant, scalable with thousands of
posts. Consider what else should be searchable - Acts? Forums? Need filters if so. Autocomplete/suggest might be nice."
Each question was put to the owner one at a time with alternatives and a recommendation, and the owner took the
recommendation each time. The board is `docs/research/2026-11-07-search/01-search.html`, approved by the owner ("Looks
great, approved"). The plan is `docs/plans/2026-11-07-search-plan.md`.

## 0. Where it starts

Read on main (cc2b6a3):

- **Nothing searches.** No `tsvector`, `pg_trgm`, `unaccent` or `ilike` anywhere; the migrations enable only `pg_cron`
  and `pg_net` (`0004_schedule.sql`). The two-worlds design left "Search" in the board's banner as a placeholder no
  design had decided (`docs/plans/2026-10-29-two-worlds-design.md`, its amendment of 2026-10-30), and the glass-to-the-
  boards plan records it as not built.
- **The one picker** of a board or a thread is the glass Reveal overlay (`engine/ui/characters/RevealOverlay.tsx`): a
  board `<select>` fed by `api.boards()` less The System's board, then a thread `<select>` fed by
  `api.threads(board, {offset, limit: 20})` with a "Show older threads" button. No screen picks a post.
- **Everything on the board is readable by every signed-in player**: the read policies on boards, threads and Acts are
  `using (true)` for `authenticated` (`0001_core.sql`), and `0060_alerts_read.sql` says so outright. `anon` reads no
  thread or Act. `thread_open` leaves out only the Updates thread; `thread_list` leaves out also the unlisted threads
  (the season's reveal and Turns threads, `0063_season_news.sql`), which stay readable by id.
- **A post's current words** are its latest edit's `payload.body`, else its own (`acts_public.current_payload`,
  `0022_edit_grace.sql`), raw BBCode. Every earlier version is public through History. Card layers (a Whoops! splat,
  Autocorrect's swaps) are drawn in the browser over the stored words and never change them.
- **BBCode becomes plain text only in TypeScript**: `visibleText` (`engine/bbcode/visible.ts`) keeps the words of bold,
  italic, underline, strike, color, size and list items, and leaves one `\n` and none of the words for a quote, code, a
  link or an image.
- **Acts are written by SQL functions** in at least ten migrations, by players and by Mod Bots.

## 1. What Search finds

**Decided:** threads and posts, with filters (the owner chose A). Free text matches thread titles and post bodies;
filters narrow by board, by author character and by a date range. Characters and boards are filters and suggestions,
never result kinds of their own.

- **Posts** are the Acts of kind `post` and `spin` (a spin carries a body and opens a thread). A `card` play, a
  `tally`, a `reveal` and an `announce` are not results: most have no words of their own, and a post carrying a card is
  served by the card's mark on its result (section 4). A "has a card on it" filter is a later post search, not a new
  result kind.
- **Threads** are matched by title.
- **Where:** every thread `thread_open` holds, so the unlisted threads too (a default the session took and the owner
  confirmed with the whole design): they are left off a board's list to keep it tidy, and a deliberate search should
  reach them. The Updates thread is the glass's, not the board's, and is left out. The System's board is a board; its
  Mod Bots' posts are play and are found.
- **Suggest** lists threads (by title), characters (debuted only, from `characters_public`) and boards (by the name
  `boards_now` shows now).

Weighed: B, Acts as results of their own, filterable by kind ("every Whoops! played on board X"), richer but mostly
results with no words; C, threads only, which serves the Reveal picker and misses what a forum's search is mostly for,
who said a thing.

## 2. The technique

**Decided:** Postgres full-text search for post bodies and titles, trigram matching for the suggest list (the owner
chose A).

- A post's plain words are held as a `tsvector` under a GIN index and asked with `websearch_to_tsquery`, so a quoted
  phrase, `-word` and `or` work as people type them on any search box.
- Thread titles and folded character names carry `pg_trgm` GIN indexes, so the suggest list matches a prefix or a
  typo ("mairo" finds "Mario") in milliseconds at millions of rows.
- Both are stock Postgres extensions (`pg_trgm`, `unaccent`), plain SQL, present on Supabase and self-hosted Supabase
  alike ("Portable by construction").
- The stemming language is an instance setting, `searchLanguage` (a Postgres text search configuration name;
  Divided World's is `english`), so the engine assumes no language.

Weighed: B, trigram for everything, which tolerates typos in bodies but ranks long bodies poorly, indexes several times
larger and has no phrase or exclusion; C, an external engine (Meilisearch, Typesense), the best fuzzy matching but a
second service to run, sync and back up, outside the instance's export, a vendor at the core.

## 3. Which words are indexed

**Decided:** only a post's current version; a result's snippet shows its stored words, no card layers drawn, and the
result carries the mark of each card on the post (the owner chose A).

- An edit replaces what the post matches, so a post stops matching a word its author took out, as a reader expects.
- A snippet can show words a splat covers on the post. That tells nobody anything the post's History does not already
  show anyone, so a splat stays a nuisance on the post, never a secret, and the result's mark and its link take the
  reader to the post with the splat in place.

Weighed: B, every version indexed ("what they said before the edit"), kept as a later filter, "include earlier
versions"; C, the words a reader sees with the layers applied, which would have the index follow every wash and every
card's end (`effect_state`), costly and fragile for no secret kept.

## 4. Where a post's plain words come from

**Decided:** a SQL `bbcode_plain(body)` that mirrors `visibleText`, and a trigger on `acts` that keeps a search row
for each post (the owner chose A).

- `post_search` holds one row per post or spin: the Act, its thread, its author character, its time and its
  `tsvector`. An `after insert` trigger on `acts` writes it for a post or a spin and replaces it for an edit (keyed by
  the edited post). It is a row of its own that points at its Act, never the Act ("Append-only"), the way
  `effect_state` is. No writer can forget it, a Mod Bot's post included, and a migration backfills every post already
  written.
- The board is not copied onto the row: a search joins `threads` for it, so nothing goes stale if a later design ever
  moves a thread.
- The two plain-text walks are one list held by a check ("Two lists that must agree are one list"): fixtures of BBCode
  and the plain words each should give are read by an engine test against `visibleText` and generated into an SQL test
  file against `bbcode_plain`; `tools/check-bbcode-plain.mjs` holds the generated file to be exactly what the generator
  makes from the fixtures, and `tools/test-bbcode-plain.mjs` drives it red, as `check-name-folds.mjs` holds the name
  folds. The two are compared after each collapses its whitespace, since a separator is only a word boundary to the
  index.

Weighed: B, each writer passing `visibleText`'s output in, which reuses the walk exactly but leans on ten write paths
remembering and backfills from a script outside the migrations; C, indexing raw BBCode, where `[color=red]` matches
"red" and a quoted post's words match the quoter.

## 5. The results page

**Decided:** one page, `/search`, with results as posts or as threads (the owner chose A), drawn as the board shows
it (the owner approved the board as drawn).

- **The form**, a 2003 panel ("Search the boards"): Keywords, Posted by (a character), Board, From and To, "Search in:
  titles and posts / titles only", "Show results as: posts / threads", Sort, and a line saying how a phrase, `-word` and
  `or` work. Every field is in the URL, so a search is a link anyone can share.
- **As posts**, 20 a page: each result names its thread, board and page in the thread, its author and its date, with a
  snippet whose matched words are bold in a dashed outline on the tag ground (not color alone), and the mark of each
  card live on the post. It links to `/t/<thread>?page=N#post-M`.
- **As threads**: each thread once, with its best snippet and how many of its posts match.
- **Titles only**: the post results are each thread's first post.

Weighed: B, posts only, where a word said fifty times in one thread buries the rest; C, threads only with posts nested,
where "everything this character said about X" across threads cannot be read in time order.

## 6. Order, counts and the cost of a busy instance

**Decided:** exact counts to 1,000, then "more than 1,000"; keyset paging (the owner chose A). Relevance ranks among the
newest 5,000 matches (the owner chose A).

- **Sort**: relevance when there are keywords, newest first when there are only filters; "Sort: relevance / newest /
  oldest" overrides either.
- **Count**: the count stops at 1,001 rows, so a broad word costs what a narrow one does.
- **Paging** is by a cursor over (rank or time, Act id), so page 40 costs what page 1 does. The page links show the
  numbered pages within the counted range, then Previous and Next.
- **Relevance at scale**: ranking reads and scores every match, which for a common word at a busy instance is
  seconds. So a relevance search takes the newest `searchRankPool` matches (5,000, an instance setting) and ranks those:
  a common word fills the pool quickly walking posts newest first, and a rare one is found through the index, so either
  way the work is bounded. Past the pool, the count line says so: "More than 5,000 posts match; ranked among the newest
  5,000. Sort by newest to see them all." Newest and oldest page by time and have no pool.

Weighed for counts: B, exact counts and numbered pages always, seconds for a broad query at a busy instance; C, no count
and only Next, cheapest, but people refine by how much is out there. Weighed for relevance: B, rank every match, exact
and slow for common words at millions; C, a BM25 extension (ParadeDB `pg_search`, RUM), fast at any size but not stock
Postgres nor reliably on Supabase.

## 7. Suggest

**Decided:** a search box in the board's banner with grouped suggestions (the owner chose A).

- From two characters typed and 150 ms after the last keystroke: up to five threads, three characters, three boards,
  under 2003 group heads. A thread or a board goes there; a character opens a search of their posts (their profile is a
  click from any result). The last row is always "Search posts for '…'", and Enter goes there.
- A full ARIA combobox: arrow keys, Home and End, Esc, a polite count of the suggestions, focus that stays in the box.
- The box takes the banner's right side, where the host line stands; on `/search` the box is hidden, since the page
  has its own keyword field, and the host line shows. A "Search" link stands at the right end of the boards bar on
  every page, and in the phone's Boards menu, where the banner holds no box; the `/search` keyword field suggests as the
  banner does.
- Signed out there is no box, no link and no `/search`: `anon` reads no thread.

Weighed: B, a "Search" link only, suggest on `/search`, the sparest banner but no jumping to a thread from anywhere; C,
threads only, which misses finding a character by a half-remembered name, a common need in a game of masks.

## 8. One combobox, two worlds

**Decided:** one headless engine combobox with a board skin and a glass skin; the Reveal overlay's two selects become
one thread field (the owner chose A).

- `SearchCombobox` holds the querying, the debounce, dropping a reply that comes after a newer keystroke, the keyboard
  and the ARIA. A skin draws it: the board skin for the banner and `/search`, the glass skin for the Reveal overlay and
  any later glass picker. A later post picker (a quote, a card aimed at a post elsewhere) is the same component with a
  posts source.
- **Reveal**: one "Thread" field. Empty, it lists the newest threads; typed into, it searches titles, each option naming
  its board. A board filter can narrow it, never a required first step. The System's board is left out, as today.

Weighed: B, keep the board select and replace only the thread select, a smaller change keeping a step most people do
not need; C, a separate glass picker, two keyboard and ARIA implementations to keep correct.

## 9. The rules

**The masks.** Every response Search adds is computed from public facts: a post's words, its author character, its
time, its thread and board, a thread's title, a debuted character's name, a board's name. No result, count, ordering,
refusal or timing reads an account, an owner or a class. Posted by takes a character, never a player. A name that is
not a debuted character finds nothing, the same as a name nobody holds, since both read `characters_public`. The
search functions are `security invoker` and read the same public projections the thread page reads.

**Ways out.** Search adds no state a player, a character or a post can be put in: it reads.

**The layers.** The engine holds all of it: the table, the trigger, `bbcode_plain`, the functions, the combobox and its
two skins, the banner box and the page. An instance supplies `searchLanguage` and `searchRankPool` through its settings
(`instances/divided-world/settings.ts`) and nothing else; the page's words are the engine's plain words, as the board's
other screens' are.

**The two worlds.** The banner box and `/search` are the board; the Reveal overlay's field is the glass.

**Accessibility.** Search is the forum itself, so it meets the usual standards: labels, keyboard, focus, contrast, and
matched words marked by more than color.

## Open

- A "has a card on it" filter, and an "include earlier versions" filter: both later post searches, named here so a
  later design starts from them.
- A Search page on the glass (searching the log, say) is not part of this design.
