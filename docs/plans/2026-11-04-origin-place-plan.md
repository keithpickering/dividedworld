# A spun thread's origin, wherever it is: plan

Record, written 2026-11-04. The plan for `docs/plans/2026-11-04-origin-place-design.md`. One build session builds it in
one PR from `main`, after the design's PR is merged. No issue tracks it.

Every task is test first: name the test, record its red run, then write the code. No `check-*.mjs` is added.

**One migration.** It takes the next free number in `supabase/migrations/` as `NNNN_origin_place.sql`. Its SQL test
takes the next free number in `supabase/tests/` as `NNNN-origin-place.sql`. Both run against Postgres on localhost
(`npm run test:sql`).

## The place, exactly

The jsonb `origin_place` and the TypeScript type carry the same keys. In `engine/ui/data/api.ts`:

```ts
/** Where an Act a play landed on can be found. */
export type PlaceOn =
  | { readonly kind: 'post'; readonly thread: Id; readonly title: string; readonly seq: number }
  | { readonly kind: 'update'; readonly act: Id; readonly title: string }
  | { readonly kind: 'character'; readonly id: Id; readonly name: string | null }
  | { readonly kind: 'thread'; readonly id: Id; readonly title: string }
  | { readonly kind: 'board'; readonly slug: string; readonly name: string };

/** Where a spun thread's origin can be found: an Act with a place number, an update, or a play and where it landed. */
export type OriginPlace =
  | Extract<PlaceOn, { kind: 'post' | 'update' }>
  /* `card` is the card's key, null for a face-down set. `on` is null when the target cannot be placed. */
  | { readonly kind: 'play'; readonly card: string | null; readonly on: PlaceOn | null };
```

The rules, in order:
1. No origin Act: `null`.
2. `kind = 'update'`: `update`, with the Act and `payload ->> 'title'`.
3. `kind in ('card', 'set', 'spring')`: `play`. Its `card` is null for a `set`, and `payload ->> 'card'` otherwise.
   `on` is set as follows:
   - For a card with a `play_reach` row, use that row's one target: the `character` (`id`, and `name` from
     `characters_public`, null where it has none), the `thread` (`id`, `title`) or the `board` (`slug`, `name`).
   - Otherwise, where the target Act (`target_act_id`, for a post reach) is an update, `update`.
   - Otherwise, where the target Act has a `seq`, `post`, with the target's thread, its title and its `seq`.
   - Otherwise null.
   The kind is tested before the `seq`, so a legacy numbered card is a play.
4. Any other Act with a `seq`: `post`, with its thread, that thread's title and its `seq`.
5. Otherwise `null`.

The words and links are in the design's section 1.

## Task 1. The views carry the place (SQL)

Model: sonnet

**Files:** a new `supabase/migrations/NNNN_origin_place.sql`, and a new `supabase/tests/NNNN-origin-place.sql`. Update
the asserts in `supabase/tests/0034-thread-list.sql` (lines 91–93 read the old columns, and line 128 holds the column
list) and in `supabase/tests/0067-updates.sql` (line 432).

**Tests first** (`NNNN-origin-place.sql`). Each case spins a thread with `spin()` from the origin named and reads the
thread's row from both `thread_open` and `thread_list`:
- A post: `{"kind":"post","thread":…,"title":…,"seq":…}`.
- A face-up card on a post: `play`, with the card's key and `on` the post's `post` place.
- A face-down set on that post: `play`, with `"card": null`. Also assert that the jsonb holds no card key anywhere
  (`origin_place::text` does not contain the trap's key).
- A trap's spring: `play`, with the trap's card key.
- A play on a character, on a thread and on a board (each through `play_reach`): `on` is `character` with the
  character's name, `thread` with its title, and `board` with its slug and name.
- An update: `update`, with its headline. A thread spun from it is listed on the players' first board (0062), and its
  place is not `#N in Updates`.
- A legacy numbered card: stage a card Act holding a `seq` (insert it with `acts_take_seq` disabled inside the test,
  as an old database's row). Its place is `play`, not `post`.
- A thread not spun: `origin_place` is null.
- The column list of both views has `origin_place` and has no `origin_title` or `origin_seq`.
- The grants hold: `authenticated` reads both views, and `kayfabb_digest` reads `thread_list` (0045).

The red run: the views have no `origin_place`.

**Code.** The migration drops `thread_list`, then `thread_open`, and creates both again from their text in
`0063_season_news.sql`, with these changes:
- `origin_title` and `origin_seq` are gone. `origin_thread` stays (the ORIGIN box subscribes to it).
- `origin_place` is the last column, and it is built from left joins on primary keys:
  - `acts p` on `p.id = o.target_act_id`, only where `o.kind in ('card','set','spring')` and
    `coalesce(o.payload ->> 'reach', 'post') = 'post'`;
  - `threads pt` on `p.thread`;
  - `play_reach r` on `r.play = o.id`;
  - `characters_public rc`, `threads rt` and `boards rb` on the column `r` names.
  - Then one `case` that follows the rules above.
- Redo the grants: revoke all on both from `public, anon, authenticated`; grant select on `thread_open` to
  `authenticated`; grant select on `thread_list` to `authenticated, kayfabb_digest`.

No function of the database selects those two columns (only the views name them, as a search of `supabase/` shows), and
no view or `begin atomic` function depends on these views, so the drop needs no `cascade`. Use plain `drop view`, so a
dependency that does show up fails the migration and does not drop it silently. Write the header comment in the house
manner: what changed since 0063 and why, naming this design.

## Task 2. The type, the adapter and the fake (engine and web)

Model: sonnet

**Files:**
- `engine/ui/data/api.ts`: add the types above. In `ThreadSummary`, replace `originTitle` and `originSeq` with
  `readonly origin: OriginPlace | null`, and update the doc comment.
- `web/src/data/supabase.ts`: in `toThread`, read `origin_place` with a new `toPlace(raw: unknown): OriginPlace | null`.
  It checks every key's type, and a malformed or unknown shape reads as null. `toNewThread` sets `origin: null`.
- `engine/ui/data/fake.ts`: the summary builder (around line 478) works out the same place from the fake's records, by
  the same rules. It uses a play's `payload.reach` and `payload[reach]` where `play_reach` is used, characters' names,
  and boards' slugs and names.
- Tests: `web/src/data/supabase.test.tsx` (lines 178, 206 and 746), `engine/ui/data/fake.test.tsx` (lines 845–848 and
  2061), `engine/ui/spin/spun.test.tsx` (line 11) and `engine/ui/updates/Updates.test.tsx` (line 224).

**Tests first:**
- `supabase.test.tsx`: `toThread` reads each kind of place from a row. It reads a malformed `origin_place` (an unknown
  `kind`, a `seq` given as text, a `play` whose `on` is malformed) as null, or as `on: null` for the play.
- `fake.test.tsx`: the fake gives a spin from a post, a face-up card, a set, a spring, each beyond-post reach and an
  update the same place the SQL test asserts.

The red run: the types do not compile against the new tests, then the values differ.

## Task 3. `OriginLink`, drawn by the board and the box (engine)

Model: sonnet

**Files:**
- A new `engine/ui/spin/place.ts` with two pure functions, `placeWords(place, cardName)` and `placeHref(place, perPage)`.
  `cardName` is `(key: string) => string | undefined`. `placeHref` returns null where there is no link.
- A new `engine/ui/spin/OriginLink.tsx`: `OriginLink({ place, perPage })` reads `instance.cards` through `useKayfa()`.
  It renders a `Link` around the whole phrase, or the words alone where `placeHref` is null. With no place it renders
  "an Act".
- `engine/ui/board/Board.tsx`: `ThreadRow` drops its `spun` triple and draws `↳ spun from <OriginLink/>` whenever
  `t.originActId !== null`.
- `engine/ui/spin/Origin.tsx`: the head draws `Spun from <OriginLink/>`. `backHref` (the marks' `to` for a post origin)
  comes from `placeHref` when the place is a `post`, and is null otherwise. The `isUpdate` special case goes, since the
  place carries it. The "More than 20 cards" sentence uses the same `OriginLink`.
- `engine/ui/thread/Post.tsx` line 71 is unchanged.
- `engine/ui/spin/Spin.stories.tsx`: add a story for a thread spun from a card play on a post.

The words, exactly:
- Card words: `a face-down card` for a null card, the instance's name for the key, and `a card` for a key the instance
  does not have.
- Place words:
  - post: `#<seq> in <title>`;
  - update: `the update “<title>”`;
  - character: `<name>`, or `a character` with no name;
  - thread: `the thread <title>`;
  - board: `the board <name>`.
- A play reads `<card words> on <place words>`. A play whose `on` is null reads `<card words>` with no link.

The hrefs:
- post: `threadHref(thread, pageOf(seq, perPage), seq)`;
- update: `/updates?update=<encoded act>`;
- character: `/c/<encoded id>`;
- thread: `threadHref(id, 1)`;
- board: `/b/<encoded slug>`.

**Tests first:**
- `engine/ui/spin/place.test.ts`: a table with one row for each line of the design's section 1 table, giving its words
  and its href.
- `engine/ui/board/Board.test.tsx`: next to the test at line 108, a thread spun from a Whoops! play on a post shows
  "spun from Whoops! on #N in …", linked to that post. A thread spun from an update links to `/updates?update=…`.
- `engine/ui/spin/Spin.test.tsx`, or a new `Origin.test.tsx` beside it: the box's head for a card play reads "Spun from
  Whoops! on #N in …" with the link, and never "Spun from an Act". For an update it reads "Spun from the update “…”".

The red run: today's board row has no line for a card play, and the head reads "an Act".

## Review focus

- **Threads already spun.** Every spun thread that exists gets its place from the view, with nothing backfilled. Check
  that a legacy numbered card (0035's leftover, #86) reads as a play and never as `#N` pointing at a number no page draws.
- **The face-down set.** Read the view's `case` and `toPlace` to confirm that a set's place cannot carry a card key by any
  path, including a set whose spring has landed. The spring is its own Act, and a spin from the set still reads "a
  face-down card".
- **Cost of the view.** `thread_list` is read by the board, by `spunFromMany` and by the digest, moves and admin-queue
  functions. Check with `explain` that the added joins are primary-key probes, and that a board page's plan still uses
  the board and `last_at` index.
- **A target not yet public.** `characters_public` leaves out a character that has not debuted. Confirm that a name read
  as null renders "a character" and that no other column of the row reveals it.
- **The two drawers.** No code still draws a "spun from" link without `OriginLink`. Search for `#{` next to `in {` in
  `engine/ui`.
