# Cards on a spun thread: plan

Record, written 2026-11-16. Carries out `docs/plans/2026-11-16-cards-on-a-spun-thread-design.md` (its sections are
cited as §N), task by task. One PR from `main`.

**If main has moved.** Line numbers below are from `main` at `f08850ea`; the latest migration there is
`0373_play_landed_at.sql`. Find each place again by the quoted code, not the number, and take the next free migration
and test numbers if 0374 and 0375 are taken. A function's current body is its latest `create or replace` in
`supabase/migrations/`; the quickest way to read one is from a scratch database (`\sf place_cast`).

Every task goes test first: write the failing test, record its red run, then the code, then the green run. During a
task run only the tests for the changed code: `DATABASE_URL=postgres://postgres:pg@localhost:5432/postgres npm run
test:sql` for SQL (it replays every migration, so run it once per SQL task, in the background),
`node --experimental-strip-types --test <file>` for a `.test.ts`, `npx vitest run <file>` for a `.test.tsx`,
`npm run test:e2e -- <spec> --trace off` for a spec. Run `npm run typecheck` and `npm run build` once after the last
task. Postgres on localhost only; no deployed database, bucket or connector is touched.

**The layers (§8).** Tasks 1 to 6 and 8 are engine. Task 7's stories are Divided World's and its spec is the web app's.
No file under `engine/` names a Divided World key or class. No instance card changes.

**The one rule every task holds (§2, §3).** A spun thread's opening Act (a `spin` Act, always seq 1 of the thread it
opened) is a post for every card. In SQL that is `post_kind(kind)`; in TypeScript, `isPost(kind)`. After this plan no
code that decides, writes, reads or draws a card compares a target's kind with `'post'` by hand. The refusals keep
their words ("a card lands on a post", "a card is set face down on a post", "a card on a character is played from one
of its posts"): they are still said of an edit, a card Act or any other Act.

**The cases, named once.** Tasks 1, 2 and 5 each run the same cases, on the server and on the fake, so the two cannot
disagree again (§1). `S` is a spun thread whose opening post Ann's character wrote, with one reply by Bob's character.

| # | Play | Expected |
|---|---|---|
| C1 | a post card cast on S's opening post by Bob's character | lands |
| C2 | the same card cast there by Ann's character | lands (its stack allowing) |
| C3 | a post Gimmick used on the opening post by Ann's character | lands |
| C4 | the same Gimmick used there by Bob's character | refused, "… is used on your own post" |
| C5 | a card set face down on the opening post by Ann's character | lands; a quote of the opening post springs it |
| C6 | a set by Bob's character on Ann's opening post | refused, as on any post that is not the setter's |
| C7 | a reply-carrying card cast on the opening post | lands; the reply is drawn under the opening post while the play is in force |
| C8 | a character card cast on Ann's character from the opening post | lands |
| C9 | a character card on Bob's character from Ann's opening post | refused, "a card on a character is played from one of its posts" |
| C10 | a thread Gimmick used on S by Ann's character | lands |
| C11 | a thread Gimmick used on S by Bob's character | refused, "… is used on a thread your own character started" |
| C12 | a thread Move cast on S by Bob's character | lands |
| C13 | a thread Move set face down by Bob's character on his reply in S, then sprung by a quote | lands on S |
| C14 | a spin from a character card on Ann's character, pressed at S's opening post | lands, with its moment |
| C15 | any card on an `edit` Act, and on a `card` Act | refused, "a card lands on a post" (unchanged) |
| C16 | a second play of a stack-1 card on the opening post | refused, "this post already carries that card" |

## Task 1. The predicate and the writes (engine, SQL)

Model: sonnet

**Files.** New `supabase/migrations/0374_cards_on_a_spun_thread.sql`; new
`supabase/tests/0374-cards-on-a-spun-thread.sql`. Read `supabase/tests/0298-spin-at-post.sql` for the helpers a test
of spins and cards uses (`pg_temp.cards`, `pg_temp.hand`, `pg_temp.spun_at`, `pg_temp.refusal`) and
`supabase/tests/setup/fixtures.sql` for `tests.account`, `tests.character`, `tests.thread`, `tests.post`,
`tests.become`. The test's cards are the engine's test set (`blot`, `sweetie`) and kinds the file inserts for itself
(a use card on a post, a use card on a thread, a cast card on a thread, a cast card on a character, a set card, a card
that replies), never an instance's.

**Test first.** One `do` block per case C1 to C16, each asserting the play's Act (its `kind`, `target_act_id`, thread)
or the refusal's exact words and code. Add: for C10 and C12, that the `play_reach` row names the thread and the card
Act's `target_act_id` is the opening `spin` Act; for C5, that `face_down.post` is the opening Act and a `take_back` by
Ann's character lands; for C7, that `post_under` holds (parent = the opening Act, reply = the new post). Record the red
run: today C1 to C3 fail with "a card lands on a post" (22023), C10 and C12 with the same words and 23514, C8 with "a
card on a character is played from one of its posts".

**Then the migration.** Header comment in the house style: what was found (§1's table), and the rule.

1. `create function post_kind(kind text) returns boolean language sql immutable set search_path = public, pg_temp as
   $$ select kind in ('post', 'spin') $$;` with a comment saying what it means (§3) and that a `spin` Act is only ever a
   spun thread's opening Act. It is no client RPC: revoke execute from `public, anon, authenticated`, as
   `supabase/tests/0005-default-deny.sql` holds every new function to. If revoking stops a security-invoker caller,
   grant it where the caller runs and add it to that test's list with a reason; do not make it a definer.
2. `acts_well_formed`: the four tests `t.kind <> 'post'` for `new.kind` of `card`, `set`, `spring` and `take_back`
   become `not post_kind(t.kind)`. The `edit` test stays as it is: a spin is not edited (§10).
3. `place_cast`: `if target_kind is distinct from 'post'` becomes `if not coalesce(post_kind(target_kind), false)`;
   the two reads of `from_post` (`... and a.kind = 'post' for share` and the `acts_public` read after it) take
   `post_kind(a.kind)`.
4. `place_set`: the same change to its `target_kind` test.
5. `play_card`: the version lock (`where a.id = target and a.kind = 'post' for no key update`) and the reply-carrying
   card's thread read (`select a.thread into in_thread from acts a where a.id = target and a.kind = 'post'`) take
   `post_kind(a.kind)`.
6. `post_under_guard`: `a.kind = 'post'` in its count of parent and reply becomes `post_kind(a.kind)`.
7. `spring_facts`: `where a.thread = f.by_thread and a.seq = 1 and a.kind = 'post'` takes `post_kind(a.kind)`.
8. `spin_written`: in the pressed-post test, `p.kind = 'post'` becomes `post_kind(p.kind)`.

Each function is re-created whole from its current body with only these lines changed; say so in a comment above each
("everything else as NNNN wrote it"), as earlier migrations do. Re-state each function's grants.

**Poison.** After green, put `'post'` back alone in `post_kind` and run the file: every case but C15 and the refusals
must go red. Restore.

## Task 2. The reads (engine, SQL)

Model: sonnet

**Files.** New `supabase/migrations/0375_spun_thread_reads.sql`; new `supabase/tests/0375-spun-thread-reads.sql`.
Read `supabase/tests/0096-thread-page.sql`, `0371-thread-page-origin.sql` and `0372-origin-scale.sql` first: they hold
`thread_page`'s shape and its read budget.

**Test first.** On S with the plays of C1, C3, C5, C7, C8 and C10 landed, and one Whoops!-like play with a saved state:

- `thread_page(S, 1, …)` as a third reader: `plays` holds each play on the opening post; `faces` the face-down one (to
  its setter alone, as on any post); `states` the saved state; `under` the reply of C7 with `parent` the opening Act;
  `above` the character play of C8 and the thread play of C10; `veiled` an author veil cast on the opening post.
  Compare each with what the same plays give on a plain thread's first post in the same file: the two answers differ
  only in ids.
- `play_moment` of the play of C1 answers (today it raises "that is no play on a post"), and a thread spun from that
  play has `origin.moment` not null.
- `card_target_reach('character', <Ann's character>, <the opening Act>)` holds `above.thread` and `above.board`.
- As Ann: `my_cards_ended` shows an admin's end (`reverse_card`) of a play on her opening post as `onMine`;
  `my_posts_written_on` shows a written tail on it (insert the rows a writing card leaves, as the tests of 0149 do).
  As Bob: neither view shows them.
- An author veil on the opening post: `character_counts_shown` moves one spin, and no post, from Ann's character to
  the stand-in, and back when the veil ends.
- `claim_card_writes` for a writing play on Bob's reply in S: the `before` it answers holds the opening post's words.
- The read budget: `0372-origin-scale.sql`'s counts still hold; if this file's fixture is the larger page, assert here
  that `thread_page` on S executes no more reads than on a plain thread of the same size.

Record the red run.

**Then the migration.**

1. `thread_page`: `page_posts ... WHERE (a.kind = 'post')` becomes `WHERE post_kind(a.kind)`. Nothing else in it
   changes: `nested`, `posts`, `on_posts`, `played`, `veiled`, `above` and `kept` derive from `page_posts`. The `cut`
   list (`d.kind = 'post'`) stays: it is about replies cut from the page.
2. `play_moment`: `if on_post.kind is distinct from 'post'` becomes `if not coalesce(post_kind(on_post.kind), false)`.
   For a spin target the version is the spin's own id (`post_version`), and `act_projection` already answers a spin.
3. `card_target_reach`: in the character branch, `a.kind = 'post'` becomes `post_kind(a.kind)`.
4. Views `my_cards_ended` and `my_posts_written_on`: each `p.kind = 'post'` join becomes `post_kind(p.kind)`.
5. `character_veiled_counts` (0357): add a `spins` column, 1 where the veiled Act is a `spin` and 0 otherwise, and make
   `posts` 1 only where it is a `post`; carry `spins` through `character_count_moves` and into
   `character_counts_shown`'s `spins`. Read the three views and every reader of them first, and re-create whatever
   depends on them in dependency order.
6. `claim_card_writes`: in its `before` read, `n.kind = 'post'` becomes `post_kind(n.kind)`.

**Poison.** After green, restore `page_posts`' `a.kind = 'post'` alone: the `thread_page` assertions go red and name
the missing plays. Restore.

## Task 3. The rules (engine)

Model: sonnet

**Files.** `engine/rules/types.ts` (beside `ActKind`, line 413), `engine/rules/cards.ts`, `engine/rules/cards.test.ts`.

**Test first.** In `cards.test.ts`: the four tests that pin the refusal flip (`:81` and `:95`, `decideSet` on
`{ ...post, kind: 'spin' }`; `:160`, `landsOn` on a spin; `:258`, `decidePlay` on a spin): each now expects the play
to land, and each gains a twin on `kind: 'edit'` that keeps the old refusal and words. Add `isPost`: true for `post`
and `spin`, false for every other member of `ActKind` (loop the union's values so a kind added later is asked). Add
`decideUse` on a spin target. Red run recorded.

**Then.** `export const isPost = (kind: ActKind): boolean => kind === 'post' || kind === 'spin';` with a comment
carrying §3's meaning and naming `post_kind` as its SQL twin. `landsOn` (`:809`):
`if (target.reach === 'post' && !isPost(target.kind))`. `decideSet` (`:649`):
`if (target.reach !== 'post' || !isPost(target.kind))`. Update the comments on `CardTarget.kind` and on `landsOn`.

`engine/rules/settle.ts` is not touched (§1): its two `a.kind === 'post'` filters count a character's posts and a spun
thread's repliers, not card targets. Leave a one-line comment at each saying so, so the next reader does not widen
them.

## Task 4. The fake (engine)

Model: sonnet

**Files.** `engine/ui/data/fake.ts`, `engine/ui/data/fake.test.tsx`.

**Test first.** In `fake.test.tsx`, a `describe` "cards on a spun thread" running C1 to C16 through the fake's own
API, with the same expected words as Task 1's SQL file, plus: `threadPage` of S carries the plays on the opening post
in `plays`, the character and thread plays in `above`, and `kept` for a kept play; `playMoment` of the play of C1
answers; a spin pressed at the opening post (C14) lands. Red run recorded: C10 and C12 already pass in the fake (that
is the disagreement of §1); the rest fail.

**Then.** Each of these takes `isPost`:

- `playBeyond`, character branch (`:2313`, `:2315`): `from?.kind === 'post'` and `from.kind !== 'post'`.
- The pressed-post test of a spin (`:1484`): `post?.kind === 'post'`.
- `playMoment` (`:1621`): `post.kind !== 'post'`.
- The thread page's posts (`:4168`): `shownActs.filter((a) => a.kind === 'post')`, which feeds `cardsOnMany`,
  `effectsAbove` and `kept`.
- The veiled counts, wherever the fake moves a post count for an author veil: move a spin count for a veiled spin, as
  Task 2 does. Find it from `shownAuthor` and the profile counts (`:1000`).

Leave as they are, each with no change: edits and history (`:815`, `:827`, `:2487`, `:3702`, `:4340`), reports
(`:4325`), the quote alert (`:717`), the post counters. The post-reach cast, use and set paths have no kind test of
their own and follow Task 3.

## Task 5. One table of cases for both sides (engine)

Model: inline

Tasks 1 and 4 each wrote C1 to C16. Put the case numbers and the expected refusal words in a comment table at the head
of both test files, identical, and add to `supabase/tests/0374-cards-on-a-spun-thread.sql` and the fake's `describe`
the sentence: "the same cases as the other side's file; a case added to one is added to both." No new check script:
the words are asserted on each side, so a drift in either is a red test there.

## Task 6. The screens (engine)

Model: sonnet

**Files.** `engine/ui/cards/PlayActions.tsx`, `engine/ui/cards/PlayForm.tsx`, `engine/ui/thread/Post.tsx`,
`engine/ui/thread/Thread.tsx`; tests in `engine/ui/thread/Thread.test.tsx`, `engine/ui/spin/Spin.test.tsx` and
`engine/ui/cards/play.test.tsx`.

**Test first.** With the test world (`engine/ui/test-world.tsx`) and a spun thread:

- An armed post card draws its play mark on the opening post, named "Play <card> on post 1"; pressing it opens the form
  on the opening post; the play lands and its mark is in the opening post's strip, with its Lens.
- A Gimmick and a Set are offered on the opening post to its author's player alone, as on any post.
- An armed character card draws its mark on the opening post's postbit; an armed thread Gimmick draws its mark in the
  thread's head for the spinner and not for another character.
- The form keeps the opening post's live copy (a play landing while the form is open updates its stack words).
- The opening post's strip and the ORIGIN band's marks are separate: a play on the opening post is in the first and
  never the second, and a play on the quoted post the reverse.
- A visit on the opening post shows its tab (it had no strip to show it in before).
- Edit and History are still absent on the opening post.

Red run recorded.

**Then.**

- `PlayActions.tsx:32` (`useTarget`): `if (!isPost(act.kind) || act.seq === null) return null;`.
- `PlayForm.tsx:121` and `:128`: `a.kind === 'post'` becomes `isPost(a.kind)`.
- `Post.tsx:287`: `const marks = isPost(act.kind) ? <PostMarks … /> : null;`. `:298` and `:299`
  (`useReachShown(plays, act.kind === 'post' && …)` and `characterMarks`): `isPost(act.kind)`.
- `Thread.tsx:307`: `filter((a) => isPost(a.kind))`, so plays on the opening post are billed.
- Leave: `Post.tsx:180` (`mine`, the Edit button), `:193` and `:207` (History), `:285` (`reportTo`'s version), and
  `Thread.tsx:696` (the "New post" announcement). Each is about editing or about replies, not cards (§10).

The marks strip on the opening post sits where any post's does. Where it draws (§4) is already built: `Post.tsx`'s
`Body` draws `PostEffects place="thread"` for a spin, the body is the content area, and the ORIGIN box is lifted over
it. Change none of that.

## Task 7. The stories and the browser test (instance, end to end)

Model: sonnet

**Files.** `instances/divided-world/ui/OriginEffects.board.stories.tsx`, `e2e/origin-effects.spec.ts`; new
`e2e/spun-thread-cards.spec.ts` with a story of its own beside the others if none fits.

**Test first.** New spec, on a spun thread in the fake with Divided World's real cards:

1. Whoops! is armed, its play mark is on the opening post, it is played, and its ink fills the opening post's content
   area (`.kb-act-main`) border to border while the ORIGIN box stands above it (the box's rectangle is not inked and a
   press inside it is the box's). The wash control clears it: the way out, on the opening post.
2. Good Vibes is played from the thread's head by the spinner; its mark is beside the title.
3. Glitter Bomb is cast on the spinner from the opening post's postbit.
4. Reduced motion and keyboard: the play mark is reachable and named, and the form opens from it by keyboard.
5. The page has no horizontal scroll at phone width with the opening post's strip and the band's marks both drawn.

Red run recorded.

**Then.** In `OriginEffects.board.stories.tsx`, `Under` and `FabBright` stop sending live deliveries for the opening
post's plays (the `opening` callback, `:99-111`): seed them as plays with `fake.seed.card` and let the page carry them.
Remove the sentences saying the state is "not a state today's server produces (issue #739)" there and at
`e2e/origin-effects.spec.ts:20`. Cases 8 and 14 of that spec must stay green unchanged; if either needed the live
delivery's timing, say why in the PR rather than loosen the case.

## Task 8. Across the act function, the settlement and the export (engine, end to end)

Model: sonnet

**Files.** New `supabase/tests/e2e/0029-cards-on-a-spun-thread.ts`, modeled on
`supabase/tests/e2e/0027-hearts-falls-tattles.ts` (the act function's core over the scratch database, the engine's
test cards or the instance's real ones seeded as that file seeds them).

Through `supabase/functions/act/core.ts`: a spin; C1, C3, C5, C10 and C12 decided and played by the function's own
path (so `card_target_reach`, the rules and `play_card` are read where they meet); a skim card on the opening post and
reactions on it, then a settlement, asserting the skim is paid as on a plain post and the reactions on the opening post
still go to the spinner; an admin's `reverse_card` on a play there (a way out) and the caster's and the author's
`log_page` naming it at post #1; then the instance exported and imported again to the same forum
(`tools/export-instance.mjs`, `tools/import-instance.mjs`), plays on the opening post included. Nothing here needs a
code change if Tasks 1 to 3 are right; a red run here is a gap in them, fixed there.

## Task 9. The words that describe it, and the build

Model: inline

Search the current documents and the instance's committed copy (the Strategy Guide, the welcome page, the tips) for a
sentence saying a card cannot be played on a spun thread's opening post or that a spun thread takes no thread card;
correct any found, in American English. Records are left as written. Then `npm run typecheck` and `npm run build`,
tails in the PR, with the red and green runs of each task.

## Review focus

- **The two sides agree.** The fake and the SQL answer C1 to C16 in the same words; the reviewer runs one case of their
  own choosing on both.
- **Nothing still compares a card's target with `'post'`.** Grep the live function bodies and `engine/` for
  `kind = 'post'`, `kind <> 'post'`, `kind === 'post'` and `kind !== 'post'`, and account for each hit as not about a
  card's target. The sweeps behind §1 read the bodies as of `0373`; a function added since is not in them.
- **Ways out, on the opening post (§6).** Each was run there: a time up, a wash, a take-back, a spring, a reply
  returning to its place, a veil ending, an admin's end.
- **The masks (§7).** No refusal on the opening post differs with who owns the caster or the target; the Set and Use
  offers are decided on the reader's own screen; the veiled counts move for every veiled Act alike.
- **A veiled opening post.** An author veil there, with a thread Gimmick, a character card cast from it and a spin
  pressed at it: each answers as on a veiled first post of a plain thread.
- **`thread_page` at a busy instance's scale.** One more row in `page_posts` on page 1 of a spun thread and none
  elsewhere; the plan counts of `0372-origin-scale.sql` and `supabase/tests/e2e/0028-cold-read-budget.ts` hold.
- **What an instance already holds (§9).** The migrations write no row; an export from before imports unchanged.
- **Where it draws (§4).** By eye, in the browser: Whoops!, Hot Box, Feelin' Fab, Graffiti and Steel Chair on the
  opening post each fill its content area with the ORIGIN box standing above; the two strips of marks never share a
  frame.
- **The views' dependents.** `character_veiled_counts` gains a column; everything that reads it or the two views
  after it was re-created and still answers.
