# A post's plays: the plan

Record, written 2026-11-21. Carries out `docs/plans/2026-11-21-post-plays-design.md` (#871, package 5 of #845, #86's last
item). It supersedes `docs/plans/2026-11-20-post-effects-plan.md` and `docs/plans/2026-11-20-post-layers-plan.md`; build
neither. Thirteen tasks, in order, each test first with its red run. Tasks 1 to 4 are the kept rows and the read, 5 to 7
the screens' read and the pager, 8 to 12 the limit, 13 the story.

**Before it starts.** This plan builds on the Who-rows plan (`docs/plans/2026-11-20-lens-who-rows-plan.md`, #873). If
`engine/ui/cards/plays.ts` has no `inForce` and `engine/ui/cards/Lens.tsx` no Ended group, stop and tell the owner: Task 7
has nowhere to stand.

**The code moves under this plan.** Line numbers below are as of `0400_pierce.sql` and commit d39e456.

- A migration is named `NNNN_<slug>.sql`, `NNNN` one above the highest number in `supabase/migrations/` on the day its
  task starts. Its SQL test is `supabase/tests/NNNN-<slug>.sql`.
- A function this plan redefines is copied whole from its latest definition with only the named change. Find it with
  `grep -liE "create (or replace )?function (public\.)?<name>\(" supabase/migrations/*.sql | tail -1`.
- **A way a play ends that this plan does not list.** If `card_ended`, `place_cast`'s stack count or `place_set`'s
  live-back test has changed since 0400 (the Buzzkill plan adds a cut), `play_row` follows the code as it stands, the new
  end gets its trigger line and its case in Task 1's test, and the task's report says so.

Engine or instance, by part: all engine but Task 9's card declarations and Divided World's `postEffects: 8`. Nothing in
the engine names a card, and the SQL knows no card's key.

**The words.** One refusal, from the rules and from the database alike, with the instance's number for `N`:

> this post already shows N effects, the most it takes. A slot opens when one ends, is ended by an admin, or its author clears it

Lowercase and with no closing period, as `landsOn`'s refusals are; `plainRefusal` (`engine/ui/cards/faces.ts:71`)
capitalizes it and adds the period. The engine holds it once, as `postFullWords(n)` in `engine/rules/cards.ts`.

## Task 1. `play_post`: a row for each play on a post, from one definition

Model: sonnet

One migration and its test.

- **The table.** `play_post (play uuid primary key references acts, post uuid not null references acts, kind text not
  null, reach text not null, played_at timestamptz not null, ends_at timestamptz, over_at timestamptz, took boolean not
  null, sprung boolean not null, drawn integer not null default 0 check (drawn >= 0))`.
  - `kind` is the card's key, or the empty string for a `set` (a back). It never holds a back's card.
  - `reach` is `coalesce(payload ->> 'reach', 'post')`; `post` for a set.
  - Row-level security on; nothing granted to `anon`, `authenticated` or `service_role`. It is read only through
    functions, as `play_reach` is.
- **`play_row(play uuid) returns play_post`**, `stable`, `security definer`, `search_path = public, pg_temp`. Null for an
  Act that is not a `card` or `set` with a `target_act_id`. Otherwise, from `acts` and the rows beside it:
  - `ends_at`: a card's `(payload ->> 'ends')::timestamptz`; a set's `face_down.ends_at`; for a card whose kind has a
    `drive`, the close of its drive: the latest `created_at` among `drive_plays(post, card)` with its `drive`, plus
    `span_interval(kind.drive -> 'lasts')`, as `place_cast` judges an open drive (`0400_pierce.sql:576-587`).
  - `over_at`: the earliest of: `played_at` where the payload has `caught` or `instant` is true; the `card_end` Act's
    `created_at`; the `card_write_refunds` row's time (read the table in `0149_card_writes.sql:121` for its column); the
    `created_at` of the cast whose `payload #>> '{pierce,by}'` names it; for a set, its `spring`'s and its `take_back`'s
    `created_at`. Null where none.
  - `took`: no `card_write_refunds` row. `sprung`: a set with a `spring` Act naming it.
  - `drawn`: `sum(reaction_tallies.count)` for the Act plus `count(*)` of `threads` whose `origin_act_id` is it.
  - A header comment lists each way a play ends beside the predicate it mirrors (`card_ended`, the live-back test at
    `0397_refund_outcome.sql:815-817`), so the next ender's author finds the list.
- **`refresh_play_post(play uuid)`**: upserts `play_row(play)`; a null answer is no row. Task 2 adds the counts to it.
- **The triggers**, `after insert`, each naming plays and calling `refresh_play_post`. They hold no rule.
  - On `acts`: a `card` or `set` with a target refreshes itself; a `card` whose payload has `pierce` also refreshes the
    play `pierce.by` names; a `card` whose kind has a `drive` also refreshes every play `drive_plays` gives for its post
    and card with its drive (their close moved); a `card_end` refreshes its target; a `spring` and a `take_back` refresh
    `(payload ->> 'set')::uuid`.
  - On `face_down`: refreshes its `play` (`place_set` writes the Act, then this row, so the Act's own trigger runs before
    the back's time exists).
  - On `card_write_refunds`: refreshes its `play`.
  - These catch `write_staff_act`'s raw `card` Acts too (`0393_forged_quotes.sql:1774`), which `play_reach` misses.
- **Indexes.** `play_post_up on play_post (post, ends_at) where over_at is null`. Task 3 adds the two it reads history by.
- **The backfill.** `insert into play_post select (play_row(a.id)).* from acts a where a.kind in ('card', 'set') and
  a.target_act_id is not null`, in the migration.
- **`play_post_drift() returns table (play uuid, why text)`**, `stable`, `security definer`, granted to `service_role`
  alone: every play whose kept row `is distinct from` `play_row`, every `card` or `set` Act on a post with no row, and
  every row whose Act is gone. Task 2 adds the counts.
- **Tests first** (red: no table):
  - A play ended in each way has the `over_at` or `ends_at` above, and `play_post_drift()` is empty after each: time; a
    caught cast; an instant (a heart); `reverse_card`; `refund_card_write`; a pierce play spent by its caster's next cast;
    a set sprung by a quote; `take_back`; a back whose time passes; a drive that a second play joins (both plays' `ends_at`
    move to the new close).
  - A character card's row is on the post it was played from, with its `reach`; a thread card's is on the first post.
  - A back's row has `kind = ''`, and no column of it holds the back's card.
  - A raw `card` Act through `write_staff_act` gets a row.
  - **Up is up.** For every card kind and post in the test's fixture, the `play_post` rows in force at post reach equal the
    plays `place_cast`'s count calls up (`0400_pierce.sql:570-574`, lifted into a `pg_temp` function with the drive
    adjustment). Red on a fixture row edited to disagree.
  - The backfill: truncate `play_post` inside the test, run the backfill's statement, and the rows equal the triggers'.
  - **Poison.** With the triggers disabled (`alter table acts disable trigger user`), write a `card_end`. `play_post_drift()`
    names the play. This is the check going red; the test fails if it does not.
- Add `play_post_drift()` to what `supabase/tests/0005-default-deny.sql` expects (not in `callable`: no client calls it).

## Task 2. Counts and draw

Model: sonnet

One migration and its test.

- **`post_kinds (post uuid not null references acts, kind text not null, plays integer not null check (plays >= 0), took
  integer not null check (took >= 0 and took <= plays), primary key (post, kind))`**. No grants.
  - A play counts where it is a `card`, or a `set` with `sprung` (a back that ran out or was taken back unsprung is
    never counted: design, section 1). `took` counts those with `took`.
- **`refresh_play_post`** now reads the row it replaces and moves the kind's `plays` and `took` by the difference between
  what the old row and the new row count (an insert on conflict that adds). A refund moves `took` down by one; a spring
  moves the back kind's `plays` up by one.
- **Draw.** A trigger on `reaction_tallies` (`after insert or update of count`): `update play_post set drawn = drawn +
  (new.count - coalesce(old.count, 0)) where play = new.act`. One on `threads` (`after insert`) where `origin_act_id is
  not null`: `drawn = drawn + 1` for that play. An Act that is no play updates nothing. Neither reads `reactions`.
- **`play_post_drift()`** gains: every `post_kinds` row that differs from the count of `play_post` by that rule, and every
  (post, kind) that should have a row and has none.
- **The backfill** of `post_kinds`, from `play_post`.
- **Tests first** (red: no table, `drawn` stays 0):
  - Twelve plays of one kind, one refunded: `plays` 12, `took` 11. A back that sprang counts 1 under `''`; one taken back
    and one that ran out count none.
  - Three reactions of two kinds to a play and two threads spun from it: `drawn` 5. A reaction to the post itself moves no
    row.
  - Drift is empty after each. **Poison:** a `reaction_tallies` row written with its trigger disabled is named by
    `play_post_drift()`; so is a `post_kinds` row edited by hand.

## Task 3. The read: `post_plays`, `kind_plays`, and `thread_page` through them

Model: sonnet

One migration and its tests.

- **Indexes**, each on rows where `kind <> '' or sprung`: `play_post_newest (post, kind, played_at desc, play desc)` and
  `play_post_drawn (post, kind, drawn desc, played_at desc, play desc)`.
- **`post_play_ids(posts uuid[]) returns table (post uuid, play uuid)`**, `stable`, `security definer`, no grants: for each
  post, distinct, the plays in force (`over_at is null and (ends_at is null or ends_at > now())`, by `play_post_up`), and
  for each of the post's `post_kinds` rows the first row of `play_post_newest` and of `play_post_drawn`. Set-based over
  `posts`, never a loop.
- **`post_plays(posts uuid[]) returns jsonb`**, `stable`, `security definer`, `search_path = public, pg_temp`, at most 200
  posts (more is refused plainly, as `effects_above` refuses): `{ "plays": [...], "counts": [...] }`.
  - `plays`: the Acts of `post_play_ids` from `acts_public` (never `acts`), in the shape `thread_page`'s `on_posts` gives
    (`0396_poll_reads.sql:359-401`), then their riders: each one's `card_end`, and each set's `spring` and `take_back`.
    Ordered by `created_at, id`, each once.
  - `counts`: `{ "post", "card" (null for the back kind), "all", "took" }` from `post_kinds`.
- **`kind_plays(post uuid, card text, before_at timestamptz, before_id uuid, size integer) returns jsonb`**: the post's
  plays of that kind (`card` null for backs) that are not in force, strictly before (`before_at`, `before_id`), newest
  first by `play_post_newest`, `size` clamped to 1..50; with their riders, `tallies` and `mine` (as `thread_page`'s, from
  `reaction_tallies` and `my_reactions`), `spun` (as `thread_page`'s), `cast` (the casters' heads, as the origin's `cast`),
  and `next`: the (`at`, `id`) of the last play when more are left, else null. Security invoker where it reads tallies,
  so the caller's policy applies; the build says in its report how it split definer and invoker.
- **`thread_page`** (latest `0396_poll_reads.sql:180`):
  - `on_posts` reads `acts_public` joined to `post_play_ids(array(select id from posts))`; the `n <= 8` goes.
    `ends_on_posts` carries the riders above. Everything that reads `on_posts` (`played` :493, `spent` :819, `surfaces`
    :824, and through `played`: `ids`, `who`, `wanted_plays`, `faces`) reads the new set unchanged.
  - `o_plays`, `o_shown` and `o_ends` (:530-547) read `post_play_ids(array[o.id])` and its riders. The origin's `more`
    (:861-862) goes.
  - The page gains `counts`, and the origin gains `counts`.
  - Nothing else changes. Diff the new text against 0396's in the PR description.
- Grants as 0396's for `thread_page`. `post_plays` and `kind_plays`: revoke from public, anon; grant to authenticated and
  service_role. Add `post_plays(uuid[])` and `kind_plays(uuid,text,timestampwithtimezone,uuid,integer)` to `callable` in
  `supabase/tests/0005-default-deny.sql` (:43), each with its reason comment.
- **Tests first**, the read (red: no functions):
  - A post with three kinds: one of 12 plays over time, two still up; one wholly over; one with backs. The in-force set
    exactly; each kind's two stand-ins (the third-oldest play given the most reactions; two plays of equal draw, the newer
    wins); the counts.
  - A cast with no end, played before 30 ended Uses, is on the page. Red against 0396's function.
  - A heart and a character card played from the post are in its plays; an ended one is there only as a stand-in.
  - An admin-ended play is not in force, is the stand-in when newest, and its `card_end` rides.
  - Backs: a live back is in force; of four sprung backs the newest and the most-drawn come with their springs; a back
    taken back is absent. No row or count names a back's card.
  - Two posts in one call: each post's rows and no cross-talk. 201 posts are refused.
  - `kind_plays`: three pages of 20 over 45 ended plays, newest first, disjoint, then `next` null; plays in force never
    appear; `size` 0 and 500 are clamped; a second caller sees the same plays and only their own `mine`; backs page with
    `card` null.
  - `thread_page`'s plays for a post equal `post_plays`'s, and its origin's likewise.
- **Tests first**, the bound, in `supabase/tests/0372-origin-scale.sql`'s form (`generic_plan`, rows read from the plan's
  nodes): one post with 5,000 plays of 6 kinds, 4 in force, among 12,000 other posts.
  - `post_play_ids` reads at most 4 + 2 × 6 + 8 rows of `play_post` and no row of `acts`; `thread_page` reads, for that
    post's plays, at most that many Acts plus their riders. No sequential scan of `play_post`, `post_kinds` or `acts`.
  - `kind_plays` reads at most `size` + the plays in force of the kind + 1 rows of `play_post`.
  - **Poison:** drop `play_post_drawn` inside the transaction; the same row bound goes red.
- **Tests that pin the caps are rewritten**, each saying why in a comment (the cap is gone, #871):
  - `supabase/tests/0096-thread-page.sql`: "only the first eight" (:54-80) becomes: all ten layers come while in force;
    the `card_end` block (:158-181) keeps its assertions on the riders.
  - `supabase/tests/0371-thread-page-origin.sql`: the key list (:156) drops `more` and gains `counts`; :159 and case 2
    (:209-228) assert the counts for 21 plays; :246.
  - `supabase/tests/0372-origin-scale.sql`: cases 1 and 2 (:96-133) assert the new row bound for 400 plays on the origin;
    the poll cases (:146-320) are left as they are.
  - Read `0146-card-writes.sql`, `0164-back-ends.sql`, `0294-thread-page-under.sql` and `0375-spun-thread-reads.sql`
    (:166-171), which compare `thread_page`'s `plays`, and correct any that assumed an ended play is on the page.
    `0116-search.sql`'s "at most 8" is the search's own cap and is left.

## Task 4. The drift check runs where a miss would show

Model: sonnet

- **`tools/test-sql.mjs`**: after the end-to-end files (:313-318), one step runs `select * from play_post_drift()` on the
  scratch database and fails, listing the rows, if any come back. `tools/test-sql-coverage.mjs` or the runner's own
  self-test (read which holds the runner's poisons) gains the poison: a step that writes a refund with the trigger
  disabled before that check, and the run is red.
- **`tools/import-instance.mjs`**: after the rows are in and the role is `origin` again (:144), it runs the drift check
  and refuses the import, naming the first rows, if any come back. The two tables are exported as every table is; nothing
  is added to `NOT_EXPORTED` (`tools/instance-files.mjs:308`).
- **`supabase/tests/e2e/0003-export.ts`**: the round trip holds `play_post` and `post_kinds` equal, and an export whose
  `play_post` file has one row removed is refused on import. Red before the check is in the import.
- **The rehearsal** (`tools/rehearse/run.ts`): where a run ends and still has its database, assert no drift. If a run
  keeps no database at its end, say so in the report and leave it.

## Task 5. The data layer: one read on each side

Model: sonnet

- **`engine/ui/data/api.ts`:**
  - `KindCount { readonly post: Id; readonly card: string | null; readonly all: number; readonly took: number }`.
  - `PostPlaysRead { readonly plays: readonly Act[]; readonly counts: readonly KindCount[] }`.
  - `KindPage { readonly plays: readonly Act[]; readonly tallies: Readonly<Record<Id, Tally>>; readonly mine: readonly
    MyReaction[]; readonly spun: readonly ThreadSummary[]; readonly cast: readonly Character[]; readonly next: { readonly
    at: string; readonly id: Id } | null }`.
  - On `KayfaApi`: `postPlays(posts: readonly Id[]): Promise<PostPlaysRead>` and `kindPlays(post: Id, card: string | null,
    before: { readonly at: string; readonly id: Id } | null, size: number): Promise<KindPage>`. `cardsOn` (:2839) and
    `cardsOnMany` (:2845) are removed.
  - `ThreadPage.plays` (:2470) is `readonly Act[]`; `ThreadPage.counts` and `PageOrigin.counts` are added;
    `PageOrigin.more` (:2440-2458) is removed, and the `plays` doc comment says what it holds now.
- **`engine/ui/data/fake.ts`:** one `postPlaysOf(posts, at)` in `core` implementing the design's section 1, called by
  `postPlays`, by the thread page (:4526) and by the origin (:4542-4552), and nowhere else; one `kindPage(...)` for
  `kindPlays`. `cardsOn` (:4272), `cardsOnMany` (:4065) and the `PLAYS_PER_POST` import (:42) go. `withEnds` (:1887) stays
  if `postPlaysOf` uses it for the riders.
- **`web/src/data/supabase.ts`:** `postPlays` calls `rpc('post_plays', { posts })` in chunks of 200, merged; `kindPlays`
  calls `rpc('kind_plays', …)`. `threadPage` (:1892-1938) maps `counts` and the origin's `counts`, drops `more`. `cardsOn`
  and `cardsOnMany` (:1555-1567), `LAYER_KINDS` (:79) and `endsOf` (:1189) go; `merged` (:105) stays.
- **`tools/check-web-reads.mjs`:** `post_plays` and `kind_plays` join `ALLOWED_RPCS` (:113), each with its reason line.
- **Every caller moves to `postPlays`**, taking `.plays`: the stories and tools (`engine/ui/cards/Marks.board.stories.tsx`
  :56, :81; `instances/divided-world/ui/whoops/Layers.board.stories.tsx:77` and `Lens.board.stories.tsx:79`;
  `instances/divided-world/ui/hype/stage-play.ts:154`; `tools/hype/shot-commentary-1.mjs:211` and `shot-commentary-2.mjs`
  :171) and the tests (`engine/ui/data/fake.test.tsx`; `web/src/data/supabase.test.tsx`; `web/src/App.test.tsx:701`;
  `web/src/data/fixtures/boards.test.ts`; `engine/ui/cards/tails.test.tsx`, `drive.test.tsx`, `play.test.tsx`,
  `marks.test.tsx`, `lens.test.tsx`; `engine/ui/thread/Thread.test.tsx`; `engine/ui/spin/Spin.test.tsx:985` and
  `poll-origin.test.tsx:179`; `instances/divided-world/ui/hype/Stage.test.tsx`; the six `ui.test.tsx` under
  `instances/divided-world/ui/cards/`). `grep -rn "cardsOn" --include=*.ts --include=*.tsx --include=*.mjs .` is empty
  when the task ends.
- **Tests first:**
  - `engine/ui/data/fake.test.tsx`: the cases of Task 3's read test, one for one, against the fake (the cap test at
    :1156-1167, the `card_end` test at :3033-3040 and the origin test at :3741-3760 become `postPlays` cases). Red: no
    methods.
  - `web/src/data/supabase.test.tsx`: `postPlays` chunks 450 posts into three calls and merges; `kindPlays` maps its
    answer; `threadPage` maps both `counts`; the origin fixtures (:3087-3122, :3142) lose `more`.

## Task 6. The store holds counts, and the re-reads use the one read

Model: sonnet

- **`engine/ui/cards/plays.ts`:**
  - `PostPlays.counts: ReadonlyMap<string, { readonly all: number; readonly took: number }>` (:297), keyed by kind, the
    back kind under `CARD_BACK`. `Plays.setCounts(counts: readonly KindCount[])` sets them by post and wakes those posts.
  - `add` (:458): a play not already held raises its kind's `all` (and `took`) on its post; one already held does not; a
    late `untaken` for a held play lowers `took`. A set raises the back kind's count only when its spring arrives. A kind
    with no count from the server counts its held plays.
  - `hydrate` (:702) takes `counts`. Its callers: `engine/ui/thread/Thread.tsx:274` and `engine/ui/board/Board.tsx:116`.
  - `PLAYS_PER_POST` (:24) goes. `readPlays` (:688) has a caller, so it stays, on `postPlays`:
    `instances/divided-world/ui/stick-around/Hold.board.stories.tsx:17`.
- **`engine/ui/thread/Thread.tsx` `absorb`** (:259): passes `page.counts` to `hydrate`, and the origin's to its store.
- **`engine/ui/spin/Origin.tsx`:** `takeInOrigin` (:67) takes every play the page sent and the origin's counts;
  `CARDS_SHOWN` (:57), `useOrigin`'s `more` (:96, :102), the note (:382-399) and `.kb-origin-note`
  (`engine/ui/spin/spin.css:110`) go.
- **The re-reads:** `engine/ui/cards/Effects.tsx:107`, `engine/ui/thread/lines.tsx:106` and
  `engine/ui/cards/PlayForm.tsx:278` call `api.postPlays([post])` and take its plays and counts into the store.
- **Tests first:**
  - `engine/ui/cards/plays.test.tsx`: `setCounts`; a new live play raises `all` once; a repeat does not; a late untaken
    lowers `took`; a set counts when it springs.
  - `engine/ui/spin/Spin.test.tsx`: the "More than 20 cards" cases (:228-260, :548-560, :704-711) become: 30 plays on the
    origin, the box's mark counts 30 from the origin's counts, and no note.
  - `engine/ui/cards/tails.test.tsx` and `engine/ui/thread/Thread.test.tsx` (:220, :433, :511, :616): the re-reads call
    `postPlays` with one post.

## Task 7. The mark and the Lens count from the store, and Ended pages

Model: sonnet

The Lens is the glass. Its words are plain and out of character, in the look the Who-rows design set.

- **`engine/ui/cards/Marks.tsx` `Mark`** (:97): `counted` (:117) is the kind's `took` from the store where it has one,
  else today's expression.
- **`engine/ui/cards/Lens.tsx`:**
  - `Who`'s fold summary and the Ended group's "Ended · N" read the kind's `all` from the store: N is `all` less the rows
    up now.
  - At the foot of the Ended group (the place the Who-rows plan's Task 2 marked), while `all` is more than the rows held:
    a `GlassButton` "Show older plays (N more)". A press calls `api.kindPlays(post, card, cursor, 20)` and takes the page
    in as `readVisit` takes a tab's read (`engine/ui/cards/Visit.tsx:157`): the cast into the thread's people,
    `store.add(page.plays)`, `tallies.merge` and `mine.add` for each, and `loader.seed` for each play's spun threads (as
    `Thread.tsx:326`). The cursor is the answer's `next`.
  - While a read is out the button is `aria-busy` and a second press does nothing. On failure it reads "Couldn't load
    older plays. Try again" and the rows stay.
  - Paged rows are `EndedRow`s after the rows held, in the order they came. They are kept in a `Who` state list of ids,
    cleared when the Lens closes, and are never re-sorted by billing.
  - Focus moves to the first new row's disclosure button. With none left the button is gone and focus is on the last new
    row.
  - **Backs.** A sprung back is a kind of its own on the screen (`isBack`). The tab of the newest sprung back the post
    holds carries the pager for the back kind (`card` null); a paged back is an `EndedRow` in that tab, named for the card
    it became from its spring rider. The most-drawn sprung back keeps its own mark and tab and has no pager.
- **Tests first** in `engine/ui/cards/lens.test.tsx` (a fake post of 45 ended Sugar Coats and 2 in force):
  - The mark says 47 plays. The fold says 47. Up now has two rows; "Ended · 45" holds what the page sent, then "Show older
    plays (N more)" with N the rest.
  - A press adds 20, newest first, after the rows held; N drops by 20; focus is on the first new row. Presses until none
    are left: the button is gone and no row repeats.
  - A failed read keeps the rows and says "Couldn't load older plays. Try again"; a press reads again.
  - A reaction on a paged row reaches the tally store.
  - Five sprung backs: two marks; the newest's tab pages the other three, each named for its card.
  - Red: no button, and the mark says the held count.
- The keyboard path and the labels are checked by `web/a11y.test.tsx` over Task 13's stories.

## Task 8. The rule: a setting, a declaration, a count

Model: sonnet

- **The setting.** `Settings.postEffects: number` (`engine/rules/types.ts`, beside `reactionCap` :165). Its bound in
  `SETTINGS` (`engine/rules/instance.ts:269`): whole, 1 to 16. Divided World sets 8
  (`instances/divided-world/settings.ts`). `tsc` finds every test literal that builds a full `Settings`.
- **The declaration.** On `CardRules` (`engine/rules/cards.ts:286`): `drawsEffect?: { readonly cleared?: (state: unknown)
  => boolean | { readonly version: string } }`, with a doc comment: the card draws an effect on the post it lands on and
  counts toward `postEffects` while its play is in force and not cleared; `{ version }` says it is cleared for that version
  of the post only. It is not `draws` (:362), which is what the server draws one of. `instanceProblems` (:545, in the card
  loop :559-562) refuses it on a card that reaches no post (`reachesOf`) and on a set card (`playOf(c) === 'set'`).
- **The view.** `CardEffect` (:82-98) gains `drawing?: true` and `cleared?: true`.
- **The count**, in `engine/rules/cards.ts`:
  - `effectsUp(target, effects, now)`: on a post target, the target's own effects (`reach` unset or `'post'`) that are
    live (`isLive` :170) and either `faceDown` or `drawing && !cleared`. 0 for any other reach.
  - `postFullWords(n)`.
  - `roomOnPost(rules, settings, target, effects, now): Verdict`: refuses with `postFullWords(settings.postEffects)` when
    the target is a post, the play would count (the card declares `drawsEffect`, or it is a Set) and `effectsUp >=
    settings.postEffects`.
  - Called after the card's own landing, so its refusal is said first: in `decided` after `rules.canApply` (:506-507),
    which serves `decidePlay` and `decideUse`; and in `decideSet` after its `canApply` (:680-681).
- **Tests first** in `engine/rules/cards.test.ts`: a post at the limit refuses a drawing cast, a drawing use and any set,
  in the words; one below takes each; a mark-only card lands on a full post; a cleared play, an ended one and an effect
  from above count none; a live back counts one; a target that is not a post is never refused by the count; the card's own
  stack refusal comes first. Red: the full post takes the play.
- **Tests first** in `engine/rules/instance.test.ts`: `postEffects` at 0, 17, 2.5 and missing are each named; `drawsEffect`
  on a character-only card and on a set card is named.

## Task 9. Which cards draw, held equal to the screens

Model: sonnet

- **The check.** `engine/ui/tips/problems.ts`: `instanceUiProblems` (:23) gains `drawsEffectProblems` in its card loop
  (:86-92), beside `drawnByProblems`. For a card that reaches a post: it has an `Effect`, or is the `drawnBy` of one,
  exactly when its rules declare `drawsEffect`; a mismatch is named either way.
- **Tests first** in `engine/ui/tips/problems.test.ts`: both poisons (an `Effect` with no declaration, a declaration with
  no `Effect`) and a post card with neither. Red on both before the check exists.
- **The instance.** `drawsEffect: {}` in `instances/divided-world/cards/<key>.ts` for below-the-fold, blind-study,
  feelin-fab, graffiti, hot-box, jimmy-wails, kick-me, laugh-track, steel-chair, stick-around, this and whodunnit. The
  check proves the list: the instance's `instanceUiProblems` test passes with it.
- **Cleared.** `whoops.ts` and `autocorrect.ts`: `cleared` is true where the state is an object whose `clean === true`.
  `you-were-saying.ts`: `cleared` is `{ version: state.cleared }` where the state's `cleared` is a non-empty string
  (:82-86), else false. Tests beside each card: the answers for a clean state, an unclean one, `{}`, `null` and a string.

## Task 10. The database holds the limit

Model: sonnet

One migration and its test.

- **`card_kinds.draws_effect boolean not null default false`**, as `adds_reaction` is (`0357_post_veils.sql:50`).
  `card_kinds_problem` (latest `0400_pierce.sql:28`) checks `drawsEffect` is a boolean where given. `seed_instance`
  (latest `0397_refund_outcome.sql:272`) writes it in the insert (:339) and the upsert's set list (:353). `instanceSeed`
  (`supabase/functions/_shared/seed.ts:80-101`) maps `drawsEffect: c.drawsEffect !== undefined`.
- **`effect_state.cleared boolean not null default false`** and **`effect_state.cleared_for uuid`**.
  - `save_effect_state` (latest `0149_card_writes.sql:502`) gains `cleared boolean` and `cleared_for uuid` as its last
    arguments and writes them in the insert and the conflict update. The old signature is dropped and the grants given
    again (`0357_post_veils.sql:766` narrowed the column grant: keep it).
  - The act function (`supabase/functions/act/core.ts:250-270`), after `validateState` and the hold: `cleared` is true
    where the card's `drawsEffect.cleared(state)` is `true` or a `{ version }`, and `cleared_for` is that version.
- **`postEffects` in SQL.** `settings_held()` (latest `0395_polls.sql:165`) bounds it: whole, 1 to 16.
- **`post_effects_up(post uuid) returns integer`**, `stable`, `security definer`: the post's `play_post` rows in force
  with `reach = 'post'` where the kind is the back (`kind = ''`) or its `card_kinds.draws_effect` is set and it is not
  cleared. Cleared is `effect_state.cleared` and (`cleared_for` is null or is the post's current version: the latest
  `edit` Act on the post by `acts_edits`, else the post). One probe of `play_post_up`.
- **`card_target`** (latest `0393_forged_quotes.sql:1909`) gives each live play `drawing: true` where its kind draws and
  `cleared: true` by the same test. `card_target_reach` (latest `0375_spun_thread_reads.sql:712`) passes them through.
- **`place_cast`** (latest `0400_pierce.sql:417`), post branch, after its stack refusals and under the lock it takes at
  :504: where the kind draws and `post_effects_up(target) >= setting('postEffects')::integer`, raise the words with `hint
  = 'kayfabb.refusal'`, `errcode = '23505'`. **`place_set`** (latest `0397_refund_outcome.sql:713`): the same after the
  live-back refusal (:815-817), under its lock (:805), for every set.
- **Surface cards.** `play_surface_card` and `staff_play_surface_card` (`0317_surfaces.sql:490`, :510): if either writes
  its card Act without `place_cast`, it makes the same check under its post lock. The report says which.
- **The spring.** `spring_facts` (latest `0393_forged_quotes.sql:1306`) gains `room boolean`: true unless the sprung
  card's kind draws and `post_effects_up(by_act) >= setting('postEffects')`. `spring_traps` (latest `0400_pierce.sql:331`)
  adds `and f.room` to the post reach's `lands` (:363-364). A Move with no room leaves its back set (:374).
- **Tests first** in the new SQL test, at `postEffects` 2 (red: no columns, no count):
  - Two drawing casts land; a third is refused in the words. A mark-only cast lands on the full post.
  - `cleared` saved true frees a slot and the third lands; saved false again leaves three in force and refuses a fourth.
  - `cleared_for` the post's version frees a slot; an edit of the post takes it back with no save.
  - A set on a full post is refused; a live back counts one; taken back, its slot is free.
  - `reverse_card` frees a slot; so does a play whose `ends` passes.
  - A Move whose quoting post is full does not spring and its back stays set.
  - `card_target` shows `drawing` and `cleared`.
  - Two casts raced for the last slot (`tests.race`): one lands.
- **Other tests first:**
  - `supabase/tests/0079-settings-held.sql` (:43-48, :946-947): `postEffects` at 0, 17 and 2.5 are poisons and 8 is good;
    `engine/rules/settings-held.test.ts` cross-checks them.
  - `engine/rules/cards.test.ts` reads this migration's file and asserts its raised text, with `%` replaced by a number,
    equals `postFullWords` of that number.
  - `supabase/functions/act/core.test.ts`: a Whoops! save of `{ strokes: [], clean: true }` calls `save_effect_state` with
    `cleared: true` and no `cleared_for`; a You Were Saying save passes its version.
  - `supabase/functions/_shared/seed.test.ts`: the payload carries `drawsEffect` for a declaring card.

## Task 11. The screens hold the limit

Model: sonnet

- **`engine/ui/cards/land.ts`:**
  - `effectsOf` (:29-35) gains the store's saved states and the post's current version, and gives `drawing` from the
    card's rules and `cleared` from `drawsEffect.cleared(state)` (a `{ version }` is cleared where it is the post's
    version), as `card_target` does. Its other caller is `engine/ui/thread/Post.tsx:158`.
  - `LandingContext` (:41-50) gains `postEffects: number`. `landingOn` (:84-106) passes `{ postEffects }` as the settings
    it gives `decideSet`, `decideUse` and `decidePlay` (today `{} as never`, :102-104). `waysOn` (:72-77) takes it too.
  - The callers (`engine/ui/cards/PlayForm.tsx:160-172`, `engine/ui/cards/PlayActions.tsx:66` and :164) pass
    `instance.settings.postEffects`, the store's states and the post's version.
- **The form.** A drawing card on a full post shows `plainRefusal(lands.why)` where a refusal shows today
  (`PlayForm.tsx:409` for a set, :424 for a cast). No new element.
- **The ghost mark.** Its refusal already hides it (`PlayActions.tsx:67`): a full post draws no drawing card's ghost mark
  and still draws a mark-only card's.
- **Tests first:** in the `land` tests (a new `engine/ui/cards/room.test.tsx`): a full post refuses a drawing card in the
  words and takes a mark-only card; a cleared Whoops! frees the slot on the screen as on the server; a You Were Saying
  cleared for an earlier version does not. Red: the form offers the card.

## Task 12. The Mod Bots offer only what can land

Model: sonnet

- **`supabase/functions/chatter/core.ts`:** where `offered` is built (:312-315), when a cast would quote a post
  (`quotedPost` :308), read `post_effects_up` for it once, with `postEffects` from the settings in hand; if the post is
  full, leave every drawing cast out. A Set lands on the persona's own new post and is offered as today. `decideOptions`
  (:502-524) is unchanged and still holds the limit if the post fills between the offer and the play.
- **Tests first** in `supabase/functions/chatter/core.test.ts`: with the quoted post full, no drawing card is offered and
  a mark-only card is; with room, both are. Red: the drawing card is offered.

## Task 13. The stories

Model: haiku

- `engine/ui/cards/FamousPost.board.stories.tsx`: drop the seven padding replies added to beat the fake's page-wide cap
  (keep the first seven) and replace the header's paragraph on what the fake reads (:8-11) with: "The fake reads what the
  database reads: the plays in force, each kind's newest and most-drawn play, and its count
  (docs/plans/2026-11-21-post-plays-design.md, section 1)."
- Add `LensBusiestOlder` and its `Phone` twin: Sugar Coat's Who unfolded and "Show older plays" pressed once.
- Add to `engine/ui/cards/Marks.board.stories.tsx` a `FullPost` story and its `Phone` twin: a post holding 8 drawing
  effects with the play form open on a drawing card, showing the refusal.
- The PR carries screenshots of each at 1440 and 390, and `npx vitest run web/a11y.test.tsx` passes.

## Review focus

- **Acts an instance already holds.** The backfill against plays that ended in every way, plays beyond a post carried on a
  post, backs of every fate, and drives closed long ago. A post with more than eight plays shows plays it never showed.
- **A missed writer.** Does any path write a play or an end that names no play to `refresh_play_post` (a new card, a
  reversal, `write_staff_act`, a job)? Does the drift check run where that path is exercised, and was it seen red?
- **Order inside one statement.** A cast that springs a back, a set whose `face_down` row follows its Act, a refund that
  lands after an admin's end: is each row right when the statement ends, and `took` never above `plays`?
- **A busy instance.** Is the page two probes a kind and one for plays in force, on a page of 20 to 50 posts? What does a
  reaction to a play cost now, and does the `play_post_drawn` index churn show on a play taking many reactions a second?
  Does the counter row on a famous post contend with `place_cast`'s lock?
- **A second run or a race.** Two casts for the last slot, a cast against a set, a spring against a cast. A reaction and a
  refund on one play at once. `refresh_play_post` called twice for one insert leaves the counts right.
- **The masks.** `play_post.kind` is empty for a back and no read names its card. `post_plays` and `kind_plays` read only
  `acts_public`. The post's own tally is in no `drawn` and no comparison on the server. The limit's refusal and its timing
  do not differ with what a back hides beyond the stack's own room test at a spring.
- **The screen and the server agree.** `effectsOf` and `card_target` give the same `drawing` and `cleared` for one post,
  You Were Saying after an edit included. The fake and the SQL hold the same cases, one for one.
- **Billing parity.** Billing over in force plus stand-ins orders kinds as billing over the whole history would. Check a
  kind whose most-drawn play is over while a newer one is in force, and a play past 200 spins.
- **Live arrivals.** A play heard live raises its kind's count once; a re-read that brings it again does not.
- **Settings tuned down.** A post above a lowered `postEffects` draws everything it holds and refuses new drawing plays.
