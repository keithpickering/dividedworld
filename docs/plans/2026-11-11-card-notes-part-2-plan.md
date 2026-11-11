# Line Cutter and Feelin' Glam: plan

Record, written 2026-11-11. The plan for Part 2 of `docs/plans/2026-11-11-card-notes-design.md` (its section 2, "Line
Cutter" and "Feelin' Glam"; its section 5 holds the owner's answers, and every rework stands), built by one build
session in one PR, from `main`. It leans on `docs/plans/2026-11-01-card-mechanic-design.md` section 7 (reach) and
`docs/plans/2026-11-11-card-types-design.md` (a Move is the engine's `cast`).

Every task is test first: the test named, its red run recorded, then the code. No `check-*.mjs` is added, so no new
check needs a poison; the checks that exist (`tools/check-engine-boundary.mjs`, `tools/check-card-art.mjs`,
`tools/check-migration-versions.mjs`, `tools/check-web-reads.mjs`) hold throughout. No deployed database, bucket or
connector is touched; SQL is tested against Postgres on localhost.

**Migrations.** The highest in `supabase/migrations/` on this date is `0149_card_writes.sql`, and the highest SQL test
is `supabase/tests/0155-back-live-readers.sql`. This plan adds two migrations, at the next free number and the one
after (0150 and 0151 on this date), with SQL tests at the next free test numbers. Sibling plans (Parts 3 to 6) are
being built at the same time and may take numbers first: take the next free ones when the task starts, and again
after any merge from `main` (`tools/check-migration-versions.mjs` refuses a shared version).

## What the cards are

| | Line Cutter | Feelin' Glam |
|---|---|---|
| Key | `line-cutter` | `feelin-glam` |
| Type | Move (engine `cast`), only ever cast face up | Move (engine `cast`) |
| Flavor, rarity | Pepperoni, rare | Sweet, rare |
| Reach | a post | a thread |
| Stack | 1 | 1 |
| Lasts | does not end | a week (`{ unit: 'day', count: 7 }`) |
| Play price | 0 | 0 |
| Machine | `{ item: { card: 'line-cutter' }, availability: 'hidden', price: 300 }` | `{ item: { card: 'feelin-glam' }, availability: 'hidden', price: 300 }` |
| Engine flag | `replies: true` (new) | `keeps: true` (new) |

Both slots go after Main Event's in `instances/divided-world/machine.ts` (line 25), hidden at 300 as Main Event is:
the one rare today is hidden and reaches players through the Booster's hit pull (`instances/divided-world/packs.ts`,
`{ uncommon: 75, rare: 25 }`), which picks evenly among the instance's rares, so the two new cards join that pull
with no change to `packs.ts`.

**Line Cutter.** The caster writes a reply in the play form. The play writes two Acts in one transaction: the card
Act on the parent post, and the reply, an ordinary `post` Act in the parent's thread that takes its own number (its
`seq`) as any post does. While the play is in force the reply is drawn under its parent, on the parent's page, and
its own number is left empty on the page that number falls on. An admin's end of the play drops the reply back to
its number. One fits under a post (stack 1), and a reply drawn under a post takes none under it.

**Feelin' Glam.** One play on a thread. While it is up, every post in the thread is drawn with one more Feelin' Fab
level. After its week, a post whose own date falls between the play's date and its end keeps that level; nothing is
written on any post. It scores once, as Main Event's play does today (its Act's reactions reach its caster; no
settlement code changes).

## The world of each screen piece

`docs/plans/2026-10-29-two-worlds-design.md`. The nested reply is a post, so it is in the board's world: the house
style, the board's ink and ground from `thread.css`'s tokens, with color only on the card's own piece (the rail down
the nested reply's left edge, in Pepperoni's color through `--kb-pepperoni`). Feelin' Glam's level is Feelin' Fab's
foil, already the board's. The reply editor in the play form, the Lens words, the refusals and the log lines are the
glass's: plain, out of character, never bluffing.

## The layers

- **Engine:** two rules flags on `CardRules` (`replies`, `keeps`); `post_under` and the read and write paths in SQL;
  the thread screen's nesting; the play form's reply editor; `CardUi.drawnBy`, which hands a card's plays to another
  card's effect. The engine names no card: SQL reads `card_kinds.replies` and `card_kinds.keeps`, seeded from the
  rules as `writes` and `pins` are (`supabase/functions/_shared/seed.ts` lines 47 to 50).
- **Instance:** the two cards' rules, their `CardUi` entries, art, machine slots, and `reachLasts.thread`.
  `feelin-glam`'s `CardUi` names `feelin-fab` in `drawnBy`: one instance card naming another, as Card Collector names
  the card it catches.

## Task 1. The rules: a card that carries a reply, a play a post keeps

Model: sonnet

**Files:** `engine/rules/cards.ts`, `engine/rules/cards.test.ts`, `engine/rules/instance.ts`,
`engine/rules/instance.test.ts`, `engine/rules/actions.ts`, `engine/rules/actions.test.ts`.

In `cards.ts`:

- `CardRules` (line 184) gains `readonly replies?: true` ("its cast carries a post of the caster's, written with the
  play and drawn under the target while the play is in force; a cast card that reaches a post alone, stack 1, cast
  face up and never set face down, never offered to a staff persona") and `readonly keeps?: true` ("a thread play of
  it stays on every post written in the thread while it was up, after its time; only a cast card whose one reach is a
  thread, with a time up").
- `CardTarget`'s post (line 28) gains `readonly under?: string`: the post this one is drawn under, where it is a
  reply carried by a play in force. `postTarget` (line 52) takes it as a fifth, optional argument.
- `decidePlay` (line 320), before the ward check: a `replies` card on a post target with `under` set is refused with
  `a reply drawn under a post takes no reply under it`.
- `decideSet` (line 362), beside the `writes` refusal at line 367: `` `${rules.name} carries a reply, so it is cast face up and never set face down` ``.
- `staffOffers` (line 524) answers false for a `replies` card.
- A new pure function, exported:

  ```ts
  /** Whether a play beyond a post falls on a post: it is up now, or its card keeps and the post was written while it was up. Dates only. */
  export function fallsOn(play: { readonly at: string; readonly ends?: string }, post: { readonly at: string }, keeps: boolean, now: Date = new Date()): boolean
  ```

  True when `ends` is undefined or after `now`; else true only when `keeps` and `play.at <= post.at < play.ends`. A
  date that is no time reads as not kept.

In `instance.ts`, beside the `writes` checks (lines 464 to 467) and the reach checks (lines 520 to 545):

- `replies` is `true` or left out; only a cast card; reaches a post alone; `stack` is 1 or left out; never with
  `writes`. Each fault in the words the neighbors use (`` `${who} replies ...` ``).
- `keeps` is `true` or left out; only a cast card whose `reaches` is exactly `['thread']` and that has `lasts`.

In `actions.ts`: `played` (line 119) reads the card's rules; for a `replies` card cast (never a Use) it adds
`reply: text(r, 'body', settings.postMaxLength)` and `...framing(r)` to the arguments, exactly as the `post` action
reads them (line 199). For any other card neither is read or sent.

Tests first:

- `cards.test.ts`, with a fixture beside `writer` (line 20), `const cutter: CardRules = { ...cast('cutter', 'rare'), replies: true }`:
  `decidePlay` lands it on a plain post and refuses it on a target with `under`, in the words above; `decideSet`
  refuses it in the words above; `staffOffers` is false; `castOnPost` is true (Card Collector may name it).
- `fallsOn`: a live play falls on a post of any date; an ended play with `keeps` falls on a post dated inside its
  window, at its first instant, and not at its end instant, before it or after it; an ended play without `keeps`
  falls on none; a play with no `ends` falls on all.
- `instance.test.ts`, with `withCards` (line 809): each fault above is reported and a well-formed card of each flag
  is not.
- `actions.test.ts`: `playCard` of a `replies` card with a body sends `reply` and `framing`; with no body it is
  refused on `body` in the post action's own words; a card without the flag sends neither though the request holds a
  body.

## Task 2. The first migration: the catalog, `post_under`, and the write

Model: sonnet

**Files:** `supabase/migrations/<next>_post_under.sql`, `supabase/tests/<next>-post-under.sql`,
`supabase/tests/<next>-race-post-under.sql`, `supabase/functions/_shared/seed.ts`,
`supabase/functions/_shared/seed.test.ts`, `supabase/tests/0005-default-deny.sql` (its table list, line 21),
`supabase/tests/e2e/0003-export.ts` (the fixture's list of tables that hold a row, lines 340 and 551).

The migration follows `0149_card_writes.sql`, which is its model throughout (a catalog flag, a guard trigger on
`face_down`, `play_card` dropped and created with one more argument). Its header says what it adds, its ways out,
its masks and its cost, as 0149's does.

1. **The catalog.** `alter table card_kinds add column replies boolean not null default false, add column keeps boolean not null default false`.
   `seed_instance` (0149, line 1021) is written again whole with these two columns set from the payload and the
   catalog checks of Task 1 mirrored where the SQL mirrors `instance.ts` today (0148, lines 60 to 76); everything
   else as 0149 wrote it. `seed.ts` sends `replies: c.replies === true, keeps: c.keeps === true`.
2. **`post_under`.** One row for each reply a play carried:

   ```sql
   create table post_under (
     play uuid primary key references acts (id),
     parent uuid not null references acts (id),
     reply uuid not null unique references acts (id),
     thread uuid not null references threads (id)
   );
   create index post_under_parent on post_under (parent);
   ```

   Insert only: an update, a delete and a truncate are refused by triggers, as `play_reach`'s are
   (`0055_card_reach.sql`, lines 186 to 201). Row level security on, `select` granted to `authenticated` with a
   policy `using (true)`, as `play_reach` has: every column is public. A row is **in force** while
   `not card_ended(play)` (0149, line 461); nothing in it ever changes, so the end is the play's `card_end` Act and
   no column.
3. **The guards**, as triggers, so every path is covered without being edited (0149's reason):
   - before insert on `post_under`: the parent is not itself the `reply` of a row in force, else
     `a reply drawn under a post takes no reply under it` (`kayfabb.refusal`, `23505`); parent and reply are `post`
     Acts of `thread`.
   - before insert on `face_down`: a card whose kind `replies` is refused, in `decideSet`'s words (beside
     `face_down_never_writes`, 0149).
   - before insert on `acts`, for `kind = 'card'`: a play of a kind that `replies` carries a uuid in
     `payload ->> 'reply'`, else `<name> is cast with its reply` (`22023`). This is what refuses a staff persona's
     play through `staff_play_card`, which passes no marker.
4. **`write_reply(through uuid, in_thread uuid, body text, framing uuid[], as_id uuid) returns uuid`**, security
   definer, revoked from every API role. It does what `post()` does for a post that quotes nothing
   (`0142_face_down_moves.sql`, line 629): `within('body', body, 'postMaxLength')`, `not_the_systems(board)`,
   `not_barred(through, board)`, the thread's row and the poster's count row locked in `post()`'s order
   (`lock_for_quote(through, in_thread, null)`), the insert of a `post` Act with `id = as_id` and no
   `target_act_id`, then `write_framed` and `draw_visits`. It writes no quote alert and springs nothing: the reply
   quotes nothing.
5. **`play_card`** (0149, line 790) is dropped and created with two more arguments,
   `reply text default null, framing uuid[] default '{}'`. Its change alone:
   - a kind that `replies` needs `reply` with a letter or digit in it, else `write the reply this card carries`
     (`22023`); any other kind is given `reply` null, else `only a card that carries a reply takes one`;
   - for a kind that `replies` it makes `reply_id := gen_random_uuid()` and passes `place_cast` the marker
     `{"reply": reply_id}` (merged with the tokens marker), so the card Act's payload names the reply. `place_cast`
     itself is not changed;
   - after `place_cast` answers, where the answer carries no `sprung` (the cast was not caught), it calls
     `write_reply(through, <the target's thread>, reply, framing, reply_id)` and inserts the `post_under` row;
   - its answer gains `under`: `{ "parent": target, "play": <the card Act's id>, "act": act_projection(reply_id) }`.
   - A caught cast writes no reply: the card Act is the finished, caught play it is today, its payload still names
     the reply id, and no post has that id.
   The revoke and the grant to `service_role` are stated for the new signature.
6. **`card_target`** (the latest definition, `0148_card_types.sql` line 1109) gains `'under'`: the parent, where the
   target is the `reply` of a row in force, else absent (`jsonb_strip_nulls` on that key alone).

Tests first, in `<next>-post-under.sql`, seeding its own kinds as `0151-gimmick-wards.sql` does:

- a play of a `replies` kind writes the card Act (payload `reply`), a `post` Act with that id, a seq of its own, the
  body given, no target, and one `post_under` row; the thread's `replies` count and `last_at` moved as for any post;
  the wallet, the hand and `card_ledger` moved once;
- refused, with nothing written and nothing spent (each asserted by row counts before and after): no reply; a reply
  of spaces; a reply over `postMaxLength`; a second play on the same parent (`this post already carries that card`);
  a play on a reply in force; a `reply` handed to a card that does not carry one; a banned or barred character; a
  thread on The System's board;
- after `reverse_card` of the play, a second play on the same parent lands, and a play on the old reply lands;
- a caught cast (a set card that names the kind) writes the caught card Act, no post and no `post_under` row;
- a ward that covers the kind refuses before anything is written;
- `set_card` of the kind is refused; `staff_play_card` of it is refused;
- `card_target` of a reply in force says `under`, of an ended one does not;
- `post_under` refuses update, delete and truncate; `anon` reads nothing.

In `<next>-race-post-under.sql`, after `0146-race-card-writes.sql`'s harness: two plays on one parent at once write
one reply between them; a play racing a `post()` that quotes the parent, and one racing an edit of the parent, each
finish without a deadlock.

`seed.test.ts`: the payload carries both flags. `0003-export.ts`: the fixture plays a `replies` kind so `post_under`
holds a row, and the table joins the list the comparison carries.

## Task 3. The second migration: the thread's page, and a kept play's end

Model: sonnet

**Files:** `supabase/migrations/<next>_thread_page_under.sql`, `supabase/tests/<next>-thread-page-under.sql`,
`supabase/tests/0096-thread-page.sql` and `supabase/tests/e2e/0016-screen-reads.ts` only where they compare the
document's keys.

`thread_page` (0149, line 150) is written again whole. Its change alone:

- `page_acts` leaves out an Act that is the `reply` of a `post_under` row in force (one probe of the unique index for
  each Act in the page's range).
- A new CTE `nested`: for the page's posts, the `post_under` rows in force by `parent` (the index
  `post_under_parent`), each with its reply read through `acts_public`. A reply takes none under it, so there is one
  level and at most one for each post.
- `posts` (the ids and authors the plays, visits, tallies, people and spun threads are read for) is the page's posts
  and the nested replies together, so a nested reply's marks, reactions, visit and author arrive with the page.
- A new CTE `kept`: plays at thread reach on this thread whose kind `keeps`, ended by time (`r.ends_at <= now()`), not
  `card_ended`, and whose window holds one of `posts`' dates (`k.created_at <= p.created_at and p.created_at < r.ends_at`),
  read through `play_reach_thread` (`(thread, ends_at)`, `0055_card_reach.sql` line 182) from the page's earliest
  post date on, at most 100, oldest first. Their casters join `who` and their ids join `ids`.
- The document gains three keys, each a public projection, the same for every caller:
  - `'under'`: `[{ parent, play, act }]`, `act` the reply as `acts` holds an Act;
  - `'cut'`: `[{ seq, parent_seq }]` for each number in the page's range whose Act is drawn under a post elsewhere;
  - `'kept'`: `[{ play, ends_at, act }]`, the shape of `'above'`.
- `in_seq` is not redirected: a page is still the range its number falls in, so the gap read
  (`engine/ui/thread/Thread.tsx`, `readGap`) keeps working, and the screen follows `cut` to the parent (Task 6).

`reverse_card` (0149, line 470) is written again with one change: the refusal `that card has already worn off` is
not raised for a play whose kind `keeps`, so an admin can end a kept level after its week. Everything else as 0149
wrote it. `effects_above` and `reach_effects` are not changed: an ended play prices, wards and blocks nothing.

Tests first, in `<next>-thread-page-under.sql`:

- a thread of 45 posts at 20 a page, with a reply (number 46) carried under post 3: page 1 holds 20 Acts, `under`
  names post 3 and the reply, and the reply's plays, tally and author are in the document; page 3 holds numbers 41 to
  45, not 46, and `cut` is `[{46, 3}]`; `thread_page(in_seq => 46)` answers page 3;
- after `reverse_card`, page 1's `under` is empty, page 3 holds 46 and `cut` is empty;
- a nested reply that carries a card of its own (a Feelin' Fab kind) has that play in `plays`;
- `kept`: a `keeps` kind played on the thread and then worn off, made the way `supabase/tests/0094-card-end.sql`
  makes its `worn_reach` play (`play_reach` refuses an update, so read how that test gets a play whose end has
  passed and do the same); a page with a post dated inside the window lists it; a page whose posts are
  all outside lists nothing; a live play is in `above` and not in `kept`; an admin-ended one is in neither;
- `reverse_card` ends a worn-off play of a `keeps` kind and still refuses a worn-off play of any other;
- the document is the same for two different callers (`0016-screen-reads.ts`'s way), and `explain` of the three new
  probes names their indexes (an `explain` read line by line, as `supabase/tests/0034-thread-list.sql` does).

## Task 4. The act function

Model: inline

**Files:** `supabase/functions/act/core.ts`, `supabase/functions/act/core.test.ts`.

- `runAction` (line 166): the target read passes `under` into `postTarget` (line 172).
- `BROADCASTS.play_card` (line 86): the card Act goes out as today with `under` taken off it (`without(a, 'under')`),
  and where the answer has `under`, one more message on the thread's topic:
  `{ topic: 'thread:<thread>', event: 'under', payload: { parent, play, act } }`. The reply is never sent as a plain
  `act` event, so no screen draws it at the thread's tail first.
- `REPEATABLE` is not changed: a play is sent once.

Tests first, in `core.test.ts`, beside the play tests: a play of a `replies` card sends `reply` and `framing` to
`play_card` and broadcasts the card Act and the `under` event, in that order, with no `act` event for the reply; a
caught play (an answer with `sprung` and no `under`) broadcasts as today; a play on a target read with `under` is
refused before `play_card` is called.

## Task 5. The data layer

Model: sonnet

**Files:** `engine/ui/data/api.ts`, `web/src/data/supabase.ts`, `web/src/data/supabase.test.tsx`,
`engine/ui/data/fake.ts`, `engine/ui/data/fake.test.tsx`.

- `api.ts`: `ThreadPage` (line 1684) gains `under: readonly { parent: Id; play: Id; act: Act }[]`,
  `cut: readonly { seq: number; parentSeq: number }[]` and `kept: readonly PlayAbove[]`. `playCard` (line 2226) gains
  a last optional argument `reply?: { readonly body: string; readonly framing?: readonly Id[] }`. `ThreadListener`
  gains `onUnder?(parent: Id, play: Id, act: Act): void`.
- `supabase.ts`: `threadPage` (line 1556) maps the three keys (absent reads as empty) and adds the nested replies'
  and kept plays' ids to `asked`; `playCard` (line 1338) sends `body` and `framing`; `subscribeThread` (line 1916)
  joins `under` and calls `onUnder`.
- `fake.ts`: the fake backend holds the same rules, so the engine's stories and tests see what the database does:
  `playCard` (line 1412) writes the reply and remembers it under its parent, with the refusals of Task 2 in the same
  words; a caught cast writes none; `threadPage` (line 2958) leaves the reply out of its number's page and answers
  `under`, `cut` and `kept`; an admin's end un-nests it; `subscribeThread` (line 3294) delivers `onUnder`; a
  `keeps` card's ended play is answered in `kept` and can be ended.

Tests first: `supabase.test.tsx` maps a document with the three keys and one without them; `fake.test.tsx` repeats
Task 2's and Task 3's cases against the fake (the 45-post thread, the end, the refusals' words, `kept`).

## Task 6. The thread screen draws a reply under its post

Model: sonnet

**Files:** `engine/ui/thread/feed.ts`, `feed.test.tsx`, `Thread.tsx`, `Thread.test.tsx`, `Post.tsx`, `thread.css`,
`context.ts`, `engine/ui/cards/land.ts` and its test.

- **The feed** (`feed.ts`). `Feed` gains `cut: ReadonlySet<number>`, the numbers drawn under a post elsewhere.
  `loaded` and `more` take the page's `cut`; a new action `{ type: 'cut'; seq: number }` adds one and
  `{ type: 'uncut'; act: Act }` removes its number and, where the number is inside the run shown, puts the Act in
  `shown`. `release` (the test `x.seq !== end + 1`) and `shownEnd` step over numbers in `cut`, so a cut number at
  the tail never holds back the posts after it, and `Thread.tsx`'s `gapStart` (line 513) never names one.
- **The nested replies** live beside the feed, never in it: `Thread.tsx` keeps a map from parent id to
  `{ play, act }`, filled by `absorb` (line 175) from `page.under`, by `onUnder`, and emptied for a play by its
  `card_end` (`onAct`, line 420, which already hands a `card_end` to the plays store): the reply then goes to the
  feed as `uncut`. `absorb` also hydrates `page.kept` into the plays store with `page.above`.
- **Drawing** (`Post.tsx`). `ActArticle` for a post draws its nested reply, when the map holds one, as a second
  `<article>` directly after the parent's, inside one wrapper, with `data-kb-under=""`: the same postbit, body,
  marks, reactions and controls as any post, indented under the parent with the rail. Its `id` is `post-<its own
  seq>` and its permalink is `threadHref(thread, pageOf(parent.seq, P), reply.seq)`. Above its date row, one plain
  line: `Cut in line under post <parent seq>`. Its heading for a screen reader is
  `Post <seq> by <name>, cut in under post <parent seq>`. It is offered Quote, Edit, Spin and cards as any post is;
  `land.ts` passes `under` to `postTarget` for it, so an armed `replies` card shows no ghost mark on it.
- **Reading.** The nested article carries no `data-kb-seq` for the read observer (`Thread.tsx`, line 255). Instead,
  when it is seen and its number is exactly one past what is read (`sent.current + 1`, stepping over `cut`
  numbers), that number is marked read. So a reply seen on page one never marks forty pages read, and a thread whose
  only unread number is a cut reply is read by seeing it.
- **Arriving at a cut number.** When the page read for an address holds the address's seq in `cut`, the screen reads
  the parent's page (`readPage({ seq: parentSeq })`) and scrolls to `#post-<seq>` there. One extra read, only for a
  link to a cut reply.
- **A page whose every number is cut** draws its pager and no post, without error.

Tests first:

- `feed.test.tsx`: a held 801 is released past a cut 800; `cut` arriving before and after the Acts around it; `uncut`
  inside the run shows the Act in order, and outside it changes only `cut`; `waitingPosts` never counts a cut number.
- `Thread.test.tsx`, on the fake: the 45-post thread draws the reply under post 3 with its line and heading, and not
  on page 3; a live `onUnder` nests a reply without it ever appearing at the tail; a live `card_end` drops it to its
  number when that page is shown; opening `?page=3#post-46` lands on page 1 with the reply focused; seeing the
  nested reply marks nothing read when the reader is behind it, and marks it when it is the next unread number;
  axe finds nothing on the nested post.

## Task 7. The cards' screens: the reply editor, a kept level, one card drawn by another

Model: sonnet

**Files:** `engine/ui/cards/PlayForm.tsx`, `play.test.tsx`, `forms.css`; `engine/ui/cards/types.ts`;
`engine/ui/cards/Effects.tsx` and a new `engine/ui/cards/kept.test.tsx`; `engine/ui/cards/plays.ts`, `plays.test.tsx`;
`engine/ui/cards/Marks.tsx`; `engine/ui/cards/lens-words.ts` (where `instanceUiProblems` lives) and
`lens-words.test.ts`; `engine/ui/test-world.tsx` (a `replies` card, a `keeps` card and a card drawn by another, for
these tests).

- **The play form.** For a card whose rules `replies`, `PlayForm` (line 64) draws the engine's `Editor`
  (`engine/ui/composer/Editor.tsx`, line 71) above the message, labeled `Your reply`, with the post's own length
  bound (`settings.postMaxLength`) and the note `Posted with the card, right under that post.` The play button is
  disabled while the reply holds no letter or digit. The face-down choice is not offered (line 133 already leaves it
  out for `writes`; the same test reads `replies`). `api.playCard` is given the body and the framing the editor
  holds. A refusal or a caught cast leaves the reply in the editor; a caught cast says, beside the existing caught
  words, `Your reply was not posted.`
- **`CardUi.drawnBy?: string`** (`types.ts`, line 235): "this card draws no effect of its own; its plays that fall
  on a post are handed to the named card's `Effect` on that post, after that card's own plays". `instanceUiProblems`
  refuses a `drawnBy` that names no card with an `Effect`, a card with both `drawnBy` and `Effect`, and a chain.
  `EffectProps.plays`' comment (line 135) says a lent play follows the card's own and carries its `reach`.
- **`PostEffects`** (`Effects.tsx`, lines 113 to 127). The thread layer's `acting` is no longer `livePlays` alone:
  it is the thread's plays, not reversed, for which `fallsOn(play, post, keeps, now)` holds (Task 1), `keeps` read
  from `instance.cards`. Then, before the wraps are ordered, each wrap whose card has `drawnBy` is taken out and its
  plays appended to the post layer's wrap of the named card, which is made (with no plays of its own, in the post
  layer's first place) where the post has none. The merged wrap is one `BoundEffect` with `reach: 'post'`. A post
  with two Feelin' Fabs under a live Glam therefore mounts one foil at level three, never two foils.
- **`markedPlays`** (`plays.ts`, line 99) takes the keys of the cards that keep and keeps an ended, unreversed play
  of one, so a thread head's mark for it stays on the pages that hold a post it falls on (those are the only ended
  plays a page is given). `Marks.tsx` (line 229) passes the keys. `nextEnd` is unchanged: the redraw at the end is
  what moves a post from "lit by a live play" to "kept or not".
- **The Lens's way out** for an ended play of a card that keeps, said by the engine where `defaultView`
  (`plays.ts`, line 183) says `Ends <date>` for a live one: `Ended <date>. Posts written while it was up keep it.`

Tests first:

- `play.test.tsx`: the editor shows only for a `replies` card; the button is disabled on an empty reply; the fake's
  `playCard` receives the body; no face-down choice; a refusal keeps the reply.
- `kept.test.tsx`: under a live `keeps` play every post is wrapped; after its end (fake timers past `ends`) only a
  post dated inside the window is; a reversed play wraps none; with `drawnBy`, a post with two plays of the named
  card and one lent play mounts one effect given three plays, a post with none of its own mounts one given the lent
  play alone, and nothing is mounted for the lending card itself.
- `plays.test.tsx`: `markedPlays` keeps an ended keeping play and drops an ended plain one.
- `lens-words.test.ts`: the three `drawnBy` faults; the ended words pass the Lens word rules.

## Task 8. Divided World's rules, settings and machine

Model: inline

**Files:** `instances/divided-world/cards/line-cutter.ts`, `feelin-glam.ts` (new), `cards/index.ts` (`listed` and the
header comment), `cards/cards.test.ts`, `settings.ts` (line 143), `settings.test.ts`, `machine.ts`.

```ts
export const lineCutter: CardRules<Record<string, never>> = {
  key: 'line-cutter',
  name: 'Line Cutter',
  alignment: 'pepperoni',
  rarity: 'rare',
  replies: true,
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(lineCutter, target, effects, now),
  validateConfig: () => ok({}),
};

export const feelinGlam: CardRules<Record<string, never>> = {
  key: 'feelin-glam',
  name: "Feelin' Glam",
  alignment: 'sweet',
  rarity: 'rare',
  reaches: ['thread'],
  lasts: { unit: 'day', count: 7 },
  keeps: true,
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(feelinGlam, target, effects, now),
  validateConfig: () => ok({}),
};
```

Each file's header comment says what the card does, which part is the screens' and which the database's, and names
the design. `settings.ts`: `reachLasts.thread` becomes `{ unit: 'day', count: 7 }`, and its comment says a thread's
effect lasts at most a week (Feelin' Glam; the owner's answer 5 in the card notes design). Good Vibes and Main Event
keep their own shorter times. The machine gains the two hidden slots after Main Event's.

Tests first, in `cards.test.ts` beside Feelin' Fab's and Main Event's: each lands on its reach and is refused on any
other in `landsOn`'s words; a second on the same target is refused; each costs nothing; `castOnPost(lineCutter)`
holds; `instanceProblems` of the whole instance is empty (red until `reachLasts.thread` is raised, which is the red
run for the setting). `settings.test.ts` and any test that counts the machine's slots or the Booster's rares are
updated with their red runs.

## Task 9. Divided World's faces, words and art

Model: sonnet

**Files:** `instances/divided-world/ui/cards.ts`, `ui/index.test.tsx` (the `lands` table, line 86, gains
`'feelin-glam': "the quoting post's thread"`; Line Cutter is asserted to hold no face-down sentence), 
`ui/cards/line-cutter/` and `ui/cards/feelin-glam/` (new), `ui/feelin-fab/Effect.test.tsx`,
`ui/feelin-fab/Fab.board.stories.tsx`, a new `engine/ui/thread/Under.board.stories.tsx`, `ui/hint-words.ts` and
`ui/still.test.tsx` only if their tests name every card.

**Art**, for each card, exactly as `instances/divided-world/ui/cards/below-the-fold/` holds it (commit `99441413`):

- `art.webp`: the render `docs/research/2026-11-11-card-renders/line-cutter.png` (or `feelin-glam.png`), already
  1080 by 1680, converted to lossy WebP at quality 90, at most 400 KB;
- `scene.py`: `line-cutter.py` (or `feelin-glam.py`) copied beside it, with the two lines the other cards' scenes
  carry in place of its import-path line: the parent folder on `sys.path` (`rig.py` is one folder up) and
  `sys.dont_write_bytecode = True`. The research folder is not changed;
- `mark.svg`: a square silhouette that reads at 18 px (Line Cutter: a pawn stepping into a row of three; Feelin'
  Glam: a mirror ball with two beams);
- `art.json`: the credit and license the other folders carry, word for word.

**The `CardUi` entries.** Line Cutter, after Below the Fold's, with no `Effect`:

- `art`: `color: '#d24a2c'`, `ink: '#1a0602'` (Pepperoni's, as Glitter Bomb's), `tagline: 'Reply right under a post.'`
- `summary`: `'Posts your reply right under a post, where it stays however long the thread grows.'`
- `status`: `'A reply cut in under it'`
- `hint`: `'A Line Cutter: the reply under this post was written later and cut in line.'`
- `describe`: `` `A Pepperoni card, ${lineCutter.rarity}. You write a reply with it, and the reply is drawn right under the post you play it on, on that post's page, however many replies come after. It is a post like any other: it keeps its own number, and it can be quoted, reacted to and played on. One fits under a post, and a reply that cut in takes none under it. It is only ever cast face up. If an admin ends the card, the reply drops back to its own place in the thread. It costs nothing more to play.` ``
- `logPlay`: `() => 'It put a reply right under the post.'`

Feelin' Glam, after Feelin' Fab's, with `drawnBy: 'feelin-fab'` and no `Effect`:

- `art`: `color: '#2ee6ff'`, `ink: '#03141a'` (Sweet's), `tagline: 'Give a whole thread a rainbow.'`
- `summary`: `` `Cast on a thread. Every post there gets one more level of Feelin' Fab's rainbow for ${spanWords(feelinGlam.lasts!)}, and posts written in that time keep it.` ``
- `status`: a function of the plays: `'One more rainbow level here'` while any is up, else `'Kept by posts from its week'`
- `hint`: `"A Feelin' Glam: every post in this thread glows one level more."`
- `describe`: `` `A Sweet card, ${feelinGlam.rarity}, cast on a thread from its title. For ${spanWords(feelinGlam.lasts!)}, every post in the thread is drawn with one more level of Feelin' Fab's rainbow, up to Feelin' Fab's three: two Feelin' Fabs and a Feelin' Glam make the full prism. It takes none of a post's three Feelin' Fab places. A post written in the thread during that time keeps its extra level for good; every other post loses it when the time is up. One fits on a thread at a time. ${setMoveWords("the quoting post's thread")} It costs nothing more to play.` ``

`FeelinFabEffect` (`ui/feelin-fab/Effect.tsx`) needs no change: its level is `Math.min(3, plays.length)` (line 100)
and its seed is the plays' ids (line 101), and the engine now hands it the lent plays.

Tests first: `node tools/check-card-art.mjs` red with each folder missing a file, then green, with each `art.webp`'s
size shown; `index.test.tsx` holds every string above and that each `describe` is true to the rules (the rarity, the
span); `Effect.test.tsx` gains "given two of its own plays and one lent thread play it draws level 3, and given one
lent play alone, level 1"; the Lens word rules pass for both cards. The stories: `Under.board.stories.tsx`, a thread
with a reply cut in under its second post, on the light board and the dark; `Fab.board.stories.tsx` gains a thread
under a live Feelin' Glam (a bare post at level 1, a post with two Fabs at level 3) and one after its week (a post
from the week lit, a later post bare).

## Task 10. In a browser, and the whole build

Model: sonnet

**Files:** `e2e/under.spec.ts` (new), `e2e/fab.spec.ts`, `e2e/board-stories.test.ts` (the new story ids), the a11y
spec's story list if it is a list.

Tests first: on the story, the nested reply sits directly after its parent, indented, with its line; Tab reaches its
controls in order after the parent's; axe finds nothing on both boards; at a phone's width the nested reply does not
overflow the page. On the Glam stories, one foil canvas is mounted for each lit post and none for a bare one, and
reduced motion holds the foil still.

Then `npm run typecheck` and `npm run build`, with the tail in the PR, and `npm run test:e2e`. The PR's body lists
the red runs, the two `art.webp` sizes, and this plan's "Decided in planning" under `Design questions`.

## Ways out

- **A reply drawn under a post** stays there until an admin ends the play (`reverse_card`), which drops it back to
  its own number. It is never a trap: it is read, quoted, reacted to, edited, spun and played on where it sits.
- **The parent's author** can turn a Line Cutter away beforehand with a ward that covers it (see "Decided in
  planning", the last line).
- **A refused play** (no reply, a second one, a reply's reply, a ward) is refused before anything is written; the
  caster keeps the card, the money and the words in the editor.
- **A caught cast** is a finished Act, as today; the reply was never posted and is still in the editor.
- **A number left empty** on its page is no state of a player, a character or a post.
- **Feelin' Glam, up:** ends by itself at its time, or by an admin's end.
- **A kept level:** decoration, with nothing to get out of; an admin can end the play at any time after its week,
  which takes the level off every post (Task 3's change to `reverse_card`).

## The masks

Every response, payload, event and timing this plan adds, and why none is computed from a private fact:

- `thread_page`'s `under`, `cut` and `kept`: from public Acts, `post_under`, `play_reach` and dates; the same
  document for every caller (Task 3's test).
- The refusals (a second cutter, a reply's reply, no reply, face down): from the target's public plays and the
  card's printed rules; the same for every caster, whoever owns the parent.
- `play_card` with a reply: one path whoever owns the parent, the caster's own mask included. The reply's alerts are
  `post()`'s own and the play's is `place_cast`'s, both queued and drained after the answer as today.
- The `under` event: two public projections and two ids.
- Reading: marked from the reader's own position.
- Feelin' Glam's level: the play's date and end against the post's date. `fallsOn` takes no character. The foil's
  seed is the post's and the plays' ids.
- `post_under` is readable by every signed-in player because all four columns are public facts of public Acts.

## A busy instance

- **A page's read** gains: one probe of `post_under`'s unique index for each Act in the range (at most 100); one
  probe of `post_under_parent` for the page's posts; one `card_ended` probe for each hit; and the kept read, a range
  scan of `play_reach_thread` from the page's earliest post date. A thread carries one Feelin' Glam at a time, each
  a week, so that scan meets at most about 52 rows for each year of thread after the page's first post, and returns
  at most 100.
- **A page's size:** at most one nested reply for each post, so at most twice `postsPerPage` posts, each with its
  plays and tallies under the bounds the page already has.
- **A play:** one more Act, one `post_under` row, and the locks `post()` takes.
- **Feelin' Glam on a five-thousand-post thread:** one Act and one `play_reach` row. Nothing is written for a post.
  The screen works out each drawn post's level from dates it already holds.
- **One foil for each lit post**, as Feelin' Fab has today (the page's one loop draws only the posts in view); a
  thread under a live Glam lights every post on the page, which is the case Feelin' Fab's loop was built for at
  forty posts a page.

## Decided in planning

- **The reply takes its own number at once, and that number is left empty while it is cut in.** The design says the
  reply is "an ordinary post Act" and that an end "drops it back to its place in time"; a number can only be taken at
  the write. A page is a range of numbers (`engine/ui/thread/pages.ts`), so this is what keeps "a page's length is
  still a page": at most a page of numbers, plus at most one nested reply under each.
- **Line Cutter is only cast face up**, as You Were Saying? is: its reply is written at the cast, on the post the
  caster chose.
- **A caught Line Cutter posts no reply.** The caster did not choose to post those words out of line; they stay in
  the editor.
- **The reply quotes nothing**, so it springs no face-down Move on the parent. It sits under the post it answers.
- **A Mod Bot never plays Line Cutter**: a persona's play has no reply to carry.
- **Line Cutter may be played on one's own post.** The same path for every owner, so nothing is learned from it.
- **Seeing a nested reply marks it read only when it is the next unread number**, so page one never marks a long
  thread read.
- **A link to a cut reply opens its number's page, then the screen goes to the parent's page.** The server's page
  stays a range of numbers, which the gap read depends on.
- **A Glam level takes none of a post's three Feelin' Fab places**; the drawn level stops at three.
- **A kept level is marked on the thread's head**, on the pages that hold a post it falls on, not on each post.
- **A kept level is drawn in the post's thread.** The ORIGIN box and other views of a post read no plays above it
  today (`readAbove` in `engine/ui/cards/plays.ts` has no caller), and that is not changed here.
- **An admin's end of a Glam takes its level off every post**, kept ones included, during the week or after.
- **Both cards are hidden at 300 in the machine**, as Main Event, the one rare today, is.
- **Feelin' Glam can be set face down** like any Move that reaches a thread (Main Event's words), landing on the
  quoting post's thread.
- **"The parent's author can ward the post"** is true of a ward that covers a rare Pepperoni card. Force Field
  (up to uncommon) does not; Sugar Coat (Part 4) will. No ward is added here.

## Review focus

- **The lock order of a play that also posts.** `play_card` holds the account and the parent's row, then takes the
  thread's and the count rows' locks `post()` takes first: against a quote of the parent, an edit, a spring and a
  second cutter, under the race test and by reading `0142_face_down_moves.sql`'s lock-order header.
- **A retry.** A play is sent once; a lost answer may have committed. Does a second press refuse cleanly (stack 1),
  and does the screen find the reply that did land?
- **Every reader of a thread in number order that is not `thread_page`:** search results, the profile's and the
  record's post lists, alerts, the log, the board index's last post, "first unread", the export. Each still shows the
  reply as a post with its number; does each link reach it through the `cut` hop?
- **The Mod Bots' rules that read a thread's order** (`rule_breaks`, a double post): a cut reply is judged at its
  number, not where it is drawn.
- **A thread's last page when its last numbers are all cut**, and "Jump to latest" there.
- **Acts an instance already holds:** `acts_public` gains no column and no Act is rewritten; `thread_page` is the
  one read whose document changes shape, and an older client reads the three new keys as absent.
- **A nested reply that wears cards:** Stick Around's takeover, a fold, Whoops!'s ink and an armed card's ghost on a
  post inside the nested wrapper.
- **The kept read on an old thread:** its cost on page one of a ten-year thread with a Glam every week, read with
  `explain analyze` on a seeded thread of that shape.
- **A kept level in a play's moment** (`still`) and in Feelin' Fab's own Lens words ("2 of 3 stacked" on a post
  drawn at three).
- **The clock.** A post's level changes at the play's end by the reader's clock; a reader whose clock is wrong sees
  it early or late until the next page read, which sends only what the server's clock says.
- **`reachLasts.thread` at a week** now bounds every thread card: is any other thread card's week a problem the
  three-day bound was holding back?
