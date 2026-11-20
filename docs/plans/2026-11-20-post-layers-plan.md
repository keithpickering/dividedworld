Record, written 2026-11-20.

# Post layers: the plan

Carries out `docs/plans/2026-11-20-post-layers-design.md` (issue #871). Seven tasks, in order, each test first with its red
run. One migration (`0379_post_layers.sql`) adds an index and two read functions and redefines `thread_page`. Engine only:
no instance interface changes. Tasks 1 and 2 are the server, 3 the data layer, 4 to 6 the screens, 7 the story.

The rule every task uses, the design's §1. For each post:
- **In force:** a `card` Act targeting it at post reach (`coalesce(payload ->> 'reach', 'post') = 'post'`), not caught
  (`not payload ? 'caught'`), not `card_ended(id)`, not `payload ->> 'instant' = 'true'`, its `payload ->> 'ends'` null or
  after `now()`. This is `place_cast`'s stack predicate (supabase/migrations/0374_cards_on_a_spun_thread.sql, its step 4)
  plus `instant`. A `set` Act on it whose `face_down` row has `ends_at > now()` and no `take_back` or `spring` naming it.
- **History:** every other `card` Act at post reach, and every `set` that sprang (with its `spring`). A back that ran out
  or was taken back unsprung is drawn nowhere (`shownPlays`, engine/ui/cards/plays.ts) and is neither sent nor counted.
- **Kind:** `payload ->> 'card'` for a card; null for a set (the client's `CARD_BACK`). Never a back's private card.
- **Stand-ins:** for each kind, the play with the greatest `drawn` (sum of its `reaction_tallies.count` plus the count of
  `threads` whose `origin_act_id` is it), ties to the newest (`created_at desc, id desc`); and the newest play.
- **Counts:** for each kind, `all` (every play of it, history and in force) and `took` (those not refunded:
  no `card_write_refunds` row).
- **Riders:** the `card_end`, `spring` and `take_back` Acts naming any play sent, so the store marks it as it does today.

## Task 1. `post_layers` and `kind_plays`, in SQL

Model: sonnet

- **Migration** `supabase/migrations/0379_post_layers.sql`:
  - Index `acts_plays_by_kind on acts (target_act_id, (payload ->> 'card'), created_at desc, id desc) where kind in ('card', 'set')
    and coalesce(payload ->> 'reach', 'post') = 'post'`. Its header says what it serves: the stand-ins, the counts and a
    Who page, each a range of one post's history.
  - `post_layers(posts uuid[]) returns jsonb`, `stable`, `security definer`, `search_path = public, pg_temp`, reading
    `acts_public` (so concealment holds as in `thread_page`). Set-based over `posts`, never a loop. It returns
    `{ "plays": [Act…, then riders], "counts": [{ "post", "card" (null for a back), "all", "took" }] }`, plays ordered
    by `created_at, id`, each play once even when it is both in force and a stand-in. At most 200 posts a call; more is
    refused with a plain error, as `effects_above` refuses.
  - `kind_plays(post uuid, card text, before_at timestamptz, before_id uuid, size integer) returns jsonb`: the post's
    history plays of that kind (card null for backs) strictly before (`before_at`, `before_id`), newest first, `size`
    clamped to 1..50; with their riders, `tallies` and `mine` (the caller's own reactions, as `thread_page`'s
    `mine`), `spun` (as `thread_page`'s), `cast` (as the origin's `cast`), and `next`: the (`at`, `id`) of the last
    play when more are left, else null. Plays in force are not returned (the page holds them).
  - Grants as 0375's: revoke from public, anon, authenticated, service_role; grant to authenticated, service_role.
- **Tests first**, `supabase/tests/0379-post-layers.sql` (red: the functions do not exist):
  - A post with three kinds: one with 12 plays over time (two still up), one wholly over, one with a back. Asserts the
    in-force set exactly, each kind's two stand-ins (give the third-oldest play the most reactions; give two plays equal
    draw to check the tie goes to the newer), `all` and `took` (one refunded play).
  - An admin's end: the ended play is not in force, appears as a stand-in when newest, with its `card_end` rider.
  - A caught play counts in history, not in force.
  - The back: a live back's set is in force with kind null; a back that sprang is history, its spring rides; a back that
    ran out unsprung is absent and uncounted. The `counts` row of a back has `card` null, never the back's card (the masks).
  - Two posts in one call return each post's rows and no cross-talk.
  - 5,000 plays of one kind on one post, a few still up: the in-force set, both stand-ins and the counts are right.
  - `kind_plays`: three pages of 20 over 45 ended plays come back newest first, disjoint, then `next` null; in-force plays
    never appear; `size` 0 and 500 are clamped; a second caller sees the same plays and only their own `mine`.
- **Tests first**, `supabase/tests/0380-post-layers-bounded.sql`, in 0036's form (`pg_temp.plan_of`, sequential scans
  off): the plans of `post_layers` and `kind_plays` over a seeded post name no `Seq Scan on acts`. **Poison:** drop
  `acts_plays_by_kind` and the older layer indexes inside the test's transaction and show the same check reports the scan.
- Add `kind_plays(uuid,text,timestamp with time zone,uuid,integer)` and `post_layers(uuid[])` to `callable` in
  `supabase/tests/0005-default-deny.sql`.

## Task 2. `thread_page` reads through `post_layers`

Model: sonnet

- In the same migration, redefine `thread_page` from 0375's text (supabase/migrations/0375_spun_thread_reads.sql):
  - `on_posts` and `ends_on_posts` are replaced by one call `post_layers(array(select id from posts))`. The page's
    `plays` is its `plays`. A new key `counts` is its `counts`.
  - The origin's `o_plays`, `o_shown` and `o_ends` are replaced by `post_layers(array[o.id])`. The origin's `plays` is
    its `plays`, `counts` is added, and `more` is removed.
  - `ids` (what `tallies`, `mine` and `spun` are read for) takes every play `post_layers` returned, stand-ins included.
  - Nothing else in the function changes. Diff the new text against 0375's in the PR description.
- **Tests:** rewrite the assertions that pin the cap, saying in each why (the cap is gone, #871):
  `supabase/tests/0096-thread-page.sql` (its "only the first eight" block, about lines 54-80 and 176-180, becomes: the ten
  layers are all sent while in force), `supabase/tests/0371-thread-page-origin.sql` (lines 9, 156, 159, 217-228, 246:
  `more` is gone, `counts` is checked), `supabase/tests/0372-origin-scale.sql` (lines 3-27, 122-133: 400 plays on the
  origin send the in-force plays and stand-ins, and its index-row bound becomes 0380's plan check). Red first: the new
  assertions fail against 0375's function.
- Add a block to 0096: a post with 30 plays, 2 in force, returns those 2, its stand-ins and its counts; the page's
  `tallies` covers the stand-ins.

## Task 3. The data layer: one read on each side

Model: sonnet

- **`engine/ui/data/api.ts`:**
  - `export interface KindCount { readonly post: Id; readonly card: string | null; readonly all: number; readonly took: number }`.
  - `export interface PostLayers { readonly plays: readonly Act[]; readonly counts: readonly KindCount[] }`.
  - `export interface KindPage { readonly plays: readonly Act[]; readonly tallies: Readonly<Record<Id, Tally>>; readonly mine: readonly MyReaction[]; readonly spun: readonly ThreadSummary[]; readonly cast: readonly Character[]; readonly next: { readonly at: string; readonly id: Id } | null }`.
  - On `KayfaApi`: `postLayers(posts: readonly Id[]): Promise<PostLayers>` and
    `kindPlays(post: Id, card: string | null, before: { readonly at: string; readonly id: Id } | null, size: number): Promise<KindPage>`.
    `cardsOn` and `cardsOnMany` are removed.
  - `ThreadPage.counts: readonly KindCount[]`, `PageOrigin.counts: readonly KindCount[]`, and `PageOrigin.more` removed.
- **`engine/ui/data/fake.ts`:** one `layersOf(posts: readonly Id[], at: number)` in `core` implementing the rule, called
  by `postLayers`, by `threadPage` (for the page's posts, replacing line ~4204, and for the origin, replacing
  `cardsOn(id, 21)` and its slice) and nowhere else; one `kindPage(...)` for `kindPlays`. Remove `cardsOn`,
  `cardsOnMany` and the `PLAYS_PER_POST` import. Refusals and limits as Task 1's.
- **`web/src/data/supabase.ts`:** `postLayers` calls `rpc('post_layers', { posts })` in chunks of 200 (`chunks`), merged;
  `kindPlays` calls `rpc('kind_plays', …)`. `threadPage` parses `counts` and the origin's `counts`, drops `more`, and
  puts the stand-ins in `asked` (line ~1871). Remove `cardsOn`, `cardsOnMany` and `LAYER_KINDS` if nothing else reads it.
- **`tools/check-web-reads.mjs`:** add `post_layers` and `kind_plays` to `ALLOWED_RPCS` with a reason comment each.
- **Tests first:**
  - `engine/ui/data/fake.test.tsx`: the same cases as 0379 (in-force set, stand-ins, tie, counts, refunded, admin end,
    back with null kind, sprung back, unsprung back absent, two posts, `kindPlays` paging and `next`). Red: no methods.
    Replace the `cardsOnMany` cap test (about lines 1156-1166) and the card_end test (about 2841-2847) with `postLayers` cases.
  - `web/src/data/supabase.test.tsx`: `postLayers` chunks 450 posts into three calls and merges; `kindPlays` maps
    its answer; `threadPage` maps `counts` and the origin's `counts`. Update the origin fixtures (about lines 2990-3014).
  - Callers of `cardsOnMany`/`cardsOn` in tests move to `postLayers`: `engine/ui/cards/tails.test.tsx`,
    `engine/ui/cards/drive.test.tsx`, and the spies in `engine/ui/thread/Thread.test.tsx` (about lines 220, 433, 616).

## Task 4. The store holds counts, and the re-reads use the one read

Model: sonnet

- **`engine/ui/cards/plays.ts`:**
  - `PostPlays.counts: ReadonlyMap<string, { readonly all: number; readonly took: number }>`, keyed by kind (`CARD_BACK` for a
    null card). `Plays.setCounts(counts: readonly KindCount[]): void` sets them per post and wakes those posts.
  - `add`: a play not already held raises its kind's `all` by one (and `took`, as it took) on its post; one already held
    does not. A late `untaken` for a held play lowers `took`. A kind with no server count yet counts its held plays.
  - `hydrate` takes `counts` and calls `setCounts`.
  - Remove `PLAYS_PER_POST` and the unused `readPlays`, and say in `livePlays`' doc nothing about a cap.
- **`engine/ui/thread/Thread.tsx` `absorb`:** passes `page.counts` to `hydrate`, and the origin's to its store.
- **`engine/ui/spin/Origin.tsx`:** `takeInOrigin` takes every play the page sent (no `CARDS_SHOWN` slice) and the origin's
  counts. `useOrigin` drops `more`. The "More than 20 cards" note goes. The box's Lens pages like any other (Task 5).
- **Re-reads:** `Effects.tsx` (about line 107), `lines.tsx` (about line 93) and `PlayForm.tsx` (about line 274) call
  `api.postLayers([post])` and take its plays and counts into the store.
- **Tests first:**
  - `engine/ui/cards/plays.test.tsx`: counts set by `setCounts`; a live new play raises `all`; a repeated one does not; a
    late untaken lowers `took`.
  - `engine/ui/spin/Spin.test.tsx`: the "More than 20 cards" cases (about lines 248-260, 554-558, 658, 701-708) become: 30
    plays on the origin, the box's mark counts 30 from the origin's counts, and no note.
  - `engine/ui/cards/tails.test.tsx` and `engine/ui/thread/Thread.test.tsx`: the re-reads call `postLayers` with one post.

## Task 5. The mark and the Lens count from the store, and Who pages

Model: sonnet

- **`engine/ui/cards/Marks.tsx` `Mark`:** `counted` is `here.counts.get(kind)?.took` where the store has it, falling back
  to today's `plays.filter((p) => !p.untaken).length || plays.length`. `Mark` reads the post's counts through
  `usePlays(store, post)`, as `useResolvedView` already does.
- **`engine/ui/cards/Lens.tsx`:**
  - `Who`'s fold summary (about line 604) counts the kind's `all` from the store, not `plays.length`. Its names are the
    held plays' casters, as now.
  - Under the rows, while `all` is more than the rows held, `Who` shows a `GlassButton` "Show older plays (N more)",
    N being `all` minus the rows held. Pressing it calls `api.kindPlays(post, card, cursor, 20)`, then
    `ensurePeople`/the cast, `store.add(page.plays)`, `tallies.merge` and `mine.merge` for each, and `spunLoader.seed` per
    play, as `readVisit` (engine/ui/cards/Visit.tsx, about line 157) merges a tab's read. The cursor is the answer's `next`.
    While a read is out the button is `aria-busy` and pressing it again does nothing. When it fails, the button reads
    "Couldn't load older plays. Try again" and the rows stay.
  - Row order: the rows held before any page, in today's order (`rowPlays`, about line 822); then each page's rows in
    the order it came (newest first), after them. A page's rows are not re-sorted into billing order, so the list never
    moves under the reader. Paged rows are kept in a `Who` state list of ids, cleared when the Lens closes.
  - Focus: after a page lands, focus moves to the first new row's caster name, so a keyboard reader continues where the
    list grew. With none left, the button is gone and focus is on the last new row.
  - The masks: a back's kind is paged as `card` null. Its rows name no card, as today.
- **Tests first** in `engine/ui/cards/lens.test.tsx` (a fake world with a post of 45 ended Sugar Coats and 2 in force,
  built with `seed.card` and `ends`):
  - The mark says 47 plays. The Who fold says "47 plays". Two rows show, then "Show older plays (45 more)".
  - Pressing it shows 20 more, newest first, after the two. The button says 25 more. Focus is on the first new row.
  - Three presses empty it. The button is gone. No row repeats.
  - A failed read (the fake's `kindPlays` made to reject) keeps the rows and says "Couldn't load older plays. Try again".
  - A reaction on a paged row reaches the tally store, as a held row's does.
  - Red: no button, and the mark says the held count.

## Task 6. Copy and the guide

Model: inline

- `engine/ui/copy-words.ts` and the glass words test: add "Show older plays", "Couldn't load older plays. Try again" if
  the repository keeps its glass strings there (check `copy-words.test.ts`). They are out of character, plain.
- Grep `docs/` for current documents naming `PLAYS_PER_POST`, `cardsOnMany`, `CARDS_SHOWN` or "More than 20 cards" and
  correct each current one. A record is left as written.

## Task 7. The famous-post story reads like a deployed instance

Model: haiku

- `engine/ui/cards/FamousPost.board.stories.tsx`: drop the seven padding replies added to beat the fake's page-wide cap
  (keep the first seven), and rewrite the header's paragraph on what the fake reads: it now reads what the database
  reads. Put Stick Around and Below the Fold back only if #872 is fixed; otherwise leave the header's note.
- Add `LensBusiestOlder` and its `Phone` twin: Sugar Coat's Who unfolded and "Show older plays" pressed once.
- Check: `npx vitest run web/a11y.test.tsx -t "famous"` passes; the PR carries screenshots of `Strip`, `LensBusiest` and
  `LensBusiestOlder` at 1440 and 390.

## Review focus

- What the change does to posts an instance already holds: a post with more than eight plays in its history shows plays
  it never showed before, the ones in force among them. Check a post whose stand-in is an ended play an admin ended.
- The cost on a busy instance: `post_layers` reads each page post's whole play history through an index. Check 0380's
  plans cover the stand-in pick, the counts and the riders, and that `kind_plays` is a range on the new index. Write the
  local time of a 5,000-play post in the PR.
- Billing parity: billing over in-force plus stand-ins must order kinds as billing over the whole history would. Check a
  case where the most-drawn play is over and a newer one is in force.
- Live arrivals: a play that arrives while the page is open raises its kind's count once. Check a re-read that brings the
  same play after it arrived live does not count it twice.
- The masks: a back's count and its Who page never carry its card. The `drawn` pick reads only public sums.
- `thread_page`'s redefinition changes only the plays and the origin. Diff it against 0375's text.
- The fake and SQL agree: the same cases are in 0379 and `fake.test.tsx`. Check no case is in one and not the other.
