# The ORIGIN box arrives with the page: plan

Record, written 2026-11-14. Carries out `docs/plans/2026-11-14-origin-in-page-design.md` (its sections are cited as
§N), task by task.

Every task is test first: the test named, its red run recorded, then the code, then the green run. One migration is
added (Task 2), tested on Postgres on localhost; no task touches a deployed database or service. All of it is engine;
no instance content is involved. No state a player, a character or a post can be put in is added; two states of the
box's own read are removed (§5). What a response could prove is named in §6, and Task 1 holds it.

Numbers: the migration is `0372` and the SQL tests take the next free numbers under `supabase/tests/` when the build
starts; if main has moved, take the next free and say so in the PR. Tasks 1 and 2 are one commit (a migration and its
test travel together), as are 3 and 4, and 5 and 6.

## Task 1. The SQL test: `thread_page` carries the origin (§3, §4, §6)

Model: sonnet

A new file `supabase/tests/NNNN-thread-page-origin.sql`, in the manner of `supabase/tests/0096-thread-page.sql` and
`supabase/tests/0294-thread-page-under.sql` (accounts by `tests.account`, Acts by `tests.act`, cards of the file's
own in `card_kinds`, never an instance's). Read those two and `supabase/tests/0075-play-moments.sql` first. It
asserts, each with a message that names what failed:

1. **A thread spun from a post.** The origin post has 3 plays, one ended by an admin, one of a card named in
   `effect_cards` with a saved state (`effect_state`) and a release of the caller's, a reaction of the caller's and
   one of another character's on the origin and on one play, and a thread spun from one play.
   `thread_page(spun, 1, null, 20, array[...]) -> 'origin'` holds: `act` equal to the `acts_public` row's `to_jsonb`;
   `plays` the 3 plays oldest first then the one `card_end`; `more` false; `moment` and `at` null; `cast` one entry
   for the author and each caster, each with `character` and `profile` keys equal to what `people` gives the same
   character on a page that has them. The document's `tallies`, `mine`, `spun`, `states` and `releases` hold the
   origin's and its plays' rows; `people` does not hold a caster who wrote nothing on the page.
2. **More than the box lists.** An origin with 21 plays: `plays` holds 20 (and their ends), `more` is true.
3. **Not on another page, not on an unspun thread.** Page 2 of the spun thread, and page 1 of a thread with no origin:
   the document has no `origin` key.
4. **An origin that is not there.** A spun thread whose origin Act `acts_public` does not show (use whichever means
   the suite already has for that; if none exists, a thread whose `origin_act_id` names an id with no Act, written
   with the triggers off as `supabase/tests/0313-discipline-scale.sql` does): `origin.act` is null, `plays` empty, and
   the page is answered.
5. **A play on a post.** A thread spun from a card play on a post: `moment` equals `play_moment(play)`, and `at` is
   the post's thread and seq.
6. **A play on a character, spun at a post.** The place names the pressed post (`at`), as
   `supabase/migrations/0351_spin_at_post.sql` writes it: `moment` equals `spin_moment(first_act)`. The same play spun
   with no post named: `moment` equals `play_moment(play)`.
7. **A play that has no moment.** A thread spun from a thread-reach play and one from a board-reach play: the page is
   answered, `moment` is null, `at` is null. This is the poison for the raise: before Task 2's null-answering read
   exists, a naive call fails the page.
8. **A veiled origin.** The origin post under a live author veil: `origin.act.character` and the `cast` entry are the
   stand-in, and the author's own character appears nowhere in `origin` for another caller.
9. **The same for every caller.** `origin` is byte-equal for two callers who own different characters, one of them
   the origin's author's player; only `mine` and `releases` differ.

Red run: the file against main's schema; every assertion on `origin` fails. Record it.

## Task 2. The migration: `thread_page` gains `origin` (§3, §4)

Model: sonnet

`supabase/migrations/0372_origin_in_page.sql`. Read `thread_page` as
`supabase/migrations/0368_client_reads_plan_once.sql` leaves it (no later migration redefines it; check again before
writing) and the header conventions of `supabase/migrations/0371_veil_cover.sql`. The header says what was found, what
the masks are (§6) and that the return shape only gains a key.

- **`origin_moment(in_thread uuid) returns jsonb`**: `plpgsql`, stable, security invoker, `set search_path`,
  `set plan_cache_mode = force_generic_plan`, `set jit = off`, revoked from public and granted to no client role that
  `thread_page` does not need (it is a helper, never in `ALLOWED_RPCS`; add it to the helper list in
  `tools/check-web-reads.mjs` beside `visit_quiz` with its reason, and to the exemption or coverage list in
  `tools/test-sql.mjs` only if the coverage check asks for it). It reads the thread's `origin_act_id`, `first_act` and
  `origin_place`, decides as `Origin.tsx` decides today (a card, set or spring whose target is a post and whose reach
  is post or character has a moment; where the place's `at` is not null and the reach is character it is
  `spin_moment(first_act)`, else `play_moment(origin)`), and returns null for anything else. The decision is made by
  reading the Act, never by catching the refusal, so no subtransaction is opened; a `P0002` refusal that still
  arrives (a spin whose moment row is missing) is caught in one exception block and answered null, with a comment
  saying why.
- **`thread_page`**, `create or replace` with the same signature, settings and grants. New CTEs, each materialized and
  each keyed on `rng`'s `origin_act_id` only where the page's `page_acts` hold `rng.first_act`:
  - `o_act`: the origin's `acts_public` row.
  - `o_plays`: its layer Acts (the kinds `LAYER_KINDS` names in `web/src/data/supabase.ts`), ordered by `created_at`,
    `id`, limit 21; `o_shown` the first 20; `o_ends` the `card_end` Acts whose target is a card in `o_shown`.
  - `o_cast`: the distinct non-null characters of `o_act`, `o_shown`, and the `character` a character-reach origin's
    payload names.
  - `ids` gains `o_act.id` and `o_shown.id`; `wanted_plays` gains the `o_shown` whose card is in `effect_cards`. `who`
    is not touched.
  - The document gains `'origin'` through `jsonb_strip_nulls`-free concatenation: `|| case when <the page holds the
    first Act and the thread has an origin> then jsonb_build_object('origin', jsonb_build_object('act', ..., 'plays',
    ..., 'more', ..., 'moment', origin_moment(in_thread), 'at', ..., 'cast', ...)) else '{}'::jsonb end`, so a page
    without one has no key. `cast`'s `character` and `profile` objects are built by the same expressions `people`
    uses; lift those two into one place (a lateral or a helper) so the shape cannot drift, and say so in the header.
- Green run: Task 1's file, then the whole SQL suite (`node tools/test-sql.mjs`), which also holds the coverage
  assertion that every stable function in `ALLOWED_RPCS` was called.

## Task 3. The scale test (§6)

Model: sonnet

Extend the scale file that already reads `thread_page` at a busy instance's size (find it by
`grep -l thread_page supabase/tests/*scale*`; `supabase/tests/0313-discipline-scale.sql` is the pattern) or add
`supabase/tests/NNNN-origin-scale.sql` in its manner: a large instance (the fixture sizes those files use), a spun
thread whose origin holds several hundred plays in a thread of many thousand Acts. Assert from `explain (analyze,
format json)` of the generic plan, as those files do, that the origin's reads are index reads bounded by 21 plays and
not a scan of `acts`, and that a page of a thread with no origin executes none of the origin's nodes (never-executed
or zero loops). Poison: drop the limit in a scratch copy of the CTE and see the bound assertion fail; record the red
run.

## Task 4. The data layer: `ThreadPage.origin` (§4)

Model: sonnet

Tests first:
- `web/src/data/supabase.test.tsx`, beside "thread_page: sends the thread, page or seq and per page by name, and maps
  the document": a document with `origin` maps to `ThreadPage.origin` (Acts through `toAct`, the moment through the
  mapping `momentOf` uses, `cast` through `toCharacter`), `tallies` is asked for the origin's and its plays' ids, and a
  document without the key maps to `origin: null`.
- A fake test (where `engine/ui/data/fake.ts`'s `threadPage` is tested today; find it by `grep -rn "threadPage("
  engine/ui --include=*.test.*`): the fake's page 1 of a spun thread carries the same `origin` the old reads would
  have given (`core.act`, `core.cardsOn(origin, 21)`, `playMoment`/`spinMoment`, `core.characters`), page 2 and an
  unspun thread carry null.

Code:
- `engine/ui/data/api.ts`: `export interface PageOrigin { readonly act: Act | null; readonly plays: readonly Act[];
  readonly more: boolean; readonly moment: PlayMoment | null; readonly at: { readonly thread: Id; readonly seq: number }
  | null; readonly cast: readonly Character[] }` with a doc comment citing §4, and `readonly origin: PageOrigin | null`
  on `ThreadPage`.
- `web/src/data/supabase.ts`, `threadPage`: map `d['origin']`; extract the moment mapping out of `momentOf` so the RPC
  and the document share it; add the origin's ids to `asked`.
- `engine/ui/data/fake.ts`, `threadPage`: build `origin` where `shownActs` hold `summary.firstAct` and
  `summary.originActId` is not null; add its ids to `ids` and its effect plays to `wanted`.

## Task 5. The box's tests (§5)

Model: sonnet

In `engine/ui/spin/Spin.test.tsx` (the "ORIGIN" tests from `const origin = () => screen.findByRole('group', { name:
'Origin' })` on) and `engine/ui/thread/Thread.test.tsx`:

1. **No read after the page.** Spy on the fake's `act`, `cardsOn`, `tallies`, `myReactions`, `spunFromMany`,
   `spunFrom`, `effectStates`, `myReleases`, `characters`, `actsById`, `playMoment` and `spinMoment`; open a thread
   spun from a post with plays and one spun from a play on a character; when the box is drawn with its plays' tags and
   its moment, none was called. Red on main.
2. **Never "Loading the origin…".** The text is absent from the first frame the box exists in.
3. **Not there.** A page whose `origin.act` is null shows "The Act this thread was spun from is not there."
4. **Live.** An edit of the origin, a play on it and a tally heard on the origin thread's channel show in the box; the
   play's saved state is read once (`effectStates` called with that one id); a caster not in `cast` is named after one
   `characters` read.
5. **Read again.** A second `threadPage` answer for the same page with an edited origin and one more play: the box
   shows both, and a tag already drawn has not moved.
6. The existing tests that mock the box's reads (a failed `act`, "Try again") are removed with the states they test,
   each named in the commit message.

`e2e/origin-band.spec.ts` and `e2e/spin-at-post.spec.ts` must pass unchanged; add to `e2e/origin-band.spec.ts` one
assertion that after the `thread_page` response no request to `rest/v1` is made before the box's words are visible.

## Task 6. The box draws from the page (§5)

Model: sonnet

- `engine/ui/thread/context.ts`: `ThreadContext` gains `readonly origin?: PageOrigin | null`, the newest the pages
  read carried, with a comment that it is absent where a post is drawn outside the thread screen.
- `engine/ui/thread/Thread.tsx`, `absorb`: keep `page.origin` where the page has one (state the thread context is
  built from; a page without one leaves what is held), under the same ticket rule the function applies to `above`: an
  answer asked earlier than the one held is not taken. The origin's tallies, reactions and spins already arrive
  through `page.tallies`, `page.mine` and `page.spun` once Task 4 adds the ids; check that the loop over `ids` there
  covers them and extend it if it is built from the page's Acts alone.
- `engine/ui/cards/Lens.tsx`: `LensStore` gains `seedMoment(key: Id, moment: PlayMoment | null): void`, which keeps a
  moment as `readMoment` would and never replaces one already kept. `useMomentRead` then finds it kept and reads
  nothing.
- `engine/ui/spin/Origin.tsx`:
  - `useOrigin` takes the `PageOrigin` and no longer calls `api.act`, `api.cardsOn`, `api.tallies`,
    `api.myReactions`, `primeSpun` or `readEffects` for the first read. In an effect keyed on the origin object it
    sets the Act (`newer`), adds the shown plays and their ends to its store, sets `more`, and bills
    (`billPost(plays, origin, spun, ...)`) from the spun loader's `peek`, once per page read. The states and releases
    are in the thread's `plays` store only for posts of the page, so the box's own store is given them: pass the
    page's `states` and `releases` for the origin's plays through `PageOrigin` on the client side (the mapper in Task
    4 may attach them, or `absorb` may hydrate the box's store through a setter on the context; choose the one that
    keeps `ThreadPage` a plain mirror of the document, and say which in the PR).
  - `reading` is `'ready'` or `'gone'`; `'loading'`, `'failed'`, `retry` and their two paragraphs go.
  - The subscription stays as it is.
  - `useCast` starts from `origin.cast` and reads `api.characters` only for ids it does not hold.
  - `useLocated(cardPlay?.post)` is replaced by `origin.at`.
  - `CharacterMoment` and the play-on-a-post `MomentView` find their moment seeded: `Origin` calls `seedMoment` with
    the key `useMomentRead` uses (`spin ?? play.id`) before they render (in the same effect that takes the origin in,
    or a `useMemo` that runs before the children).
  - The file's header comment is rewritten to say the box arrives with the page.
- `tools/check-web-reads.mjs`: if `spin_moment` or `play_moment` are no longer called from the web for the box, they
  are still called by the Lens; leave `ALLOWED_RPCS` as it is and confirm by grep. Remove any API method from
  `KayfaApi`, the Supabase client and the fake only if nothing else calls it (`cardsOn` and `act` have other callers;
  check each).
- Green run: `npm run typecheck`, the unit suites, the two e2e specs, then `npm run build:ci`.

## Review focus

- A raise inside `thread_page`: any origin Act kind, reach or missing moment row that makes `origin_moment` raise
  fails the whole page, where today it failed only the box. Look for a kind the decision does not cover.
- Acts an instance already holds: spins made before `0351` (no `at` in the place), plays from before the moment
  snapshot (`play_moment`'s unrecorded path), a spun thread whose origin's thread was moved or merged, and an origin
  on the Updates thread.
- The mask on a veiled origin: `cast`, `moment.version` and `at` must name only what `acts_public` shows; compare
  against what the old client reads returned for a caller who is not the author's player.
- A page read again while the channel is live: an older `origin` must not overwrite an edit or a play heard since
  (the ticket rule), and billing must not move a tag already drawn.
- The plan of a page with no origin at a busy instance: the added CTEs must cost nothing there under the generic plan,
  which is made without the arguments' values.
- A page that holds the first Act other than page 1 (a `per_page` change, a first Act cut under a parent): the box and
  the document must agree on which page carries `origin`.
- The shapes of `cast` and `people` drifting apart after a later migration adds a profile field to one.
- Whether one request on the deployed instance is itself slow (design §7) is not settled by any test here.
