# Four costs at a busy instance's scale: plan

Record, written 2026-11-03. The plan for `docs/plans/2026-11-03-cost-at-scale-design.md`. One build session builds it in
one PR from `main`, after the design's PR is merged. The build PR ticks #149's F3 and F4, #118's F5, and #136's F1, F2,
F3 and F5, and links the PR from each. All three issues stay open for their other follow-ups.

Every task is test first: name the test, record its red run, then write the code. No `check-*.mjs` is added.

**Migrations.** Tasks 2, 3 and 4 each add one migration, numbered with the next free number in
`supabase/migrations/` when the task starts. Their SQL tests take the next free numbers in `supabase/tests/`, and every
test runs against Postgres on localhost. A function or view a migration replaces is copied from its latest definition.
Before copying, the build finds that definition with
`grep -l "function <name>\|view <name>" supabase/migrations/*.sql`. Everything a copied function does that this plan
does not name stays as written.

**The boundary check holds.** Nothing here names an instance.

## Task 1. Everyone's events are read back over the spread (UI, SQL)

**Files:** `engine/ui/alerts/useAlertFeed.ts`; `engine/ui/data/api.ts` (`KayfaApi.settlementMoved`); `engine/ui/data/fake.ts`;
`web/src/data/supabase.ts`; the Task 1 part of Task 2's migration (`my_settlement_moved`); tests
`engine/ui/alerts/Toasts.test.tsx`, `engine/ui/data/fake.test.tsx`, `web/src/data/supabase.test.tsx`, and Task 2's SQL
test file.

**Change:**
- SQL: `my_settlement_moved(settlement bigint) returns table (count integer, applied_at timestamptz)` is a `stable
  security definer` function over `ledger l join settlements s` where `l.account = signed_in_account() and
  l.settlement = $1`. It returns no row when there are none. Revoke from `public, anon`, grant to `authenticated`. Its
  header gives the cost (one `ledger_account` range, one `settlements` key read) and the masks (section 5).
- `KayfaApi.settlementMoved(id: string): Promise<{ readonly count: number; readonly at: string } | null>`, documented
  like `alertsUnread`, rejecting when it cannot be read. The fake answers from its ledger. Supabase calls the RPC.
- `useAlertFeed`: rename `SETTLED_SPREAD_MS` to `REACH_SPREAD_MS` and update every importer. `heard` takes the kind of
  path it came by. An account alert calls `countSoon()` as today. A `news` or `settled` arrival calls `spreadSoon()`,
  which schedules one timer at `Math.random() * REACH_SPREAD_MS` unless one is pending. A `settled` id is added to a
  pending set. When the timer fires, it calls `count()` once, then `api.settlementMoved(id)` for each pending id, and
  toasts each non-null answer as `settlement|<id>`, as today. Nothing calls `api.alerts()`. Rewrite the header's last
  paragraph to say which events spread and why.

**Tests first** (fake timers):
- A `news` arrival, then three more and a `settled` within 1ms, make exactly one `alertsUnread` call, at a moment in
  `[0, REACH_SPREAD_MS)`, and none at 250ms. Red on main: main reads at 250ms.
- A `settled` for a settlement that moved two of the account's characters toasts once with count 2 and calls `alerts()`
  zero times. Red on main.
- A `settled` that moved none toasts nothing.
- An account-channel alert still reads the count at 250ms (carried, kept green).
- The news toast shows before the spread read fires.
- A teardown before the spread fires makes no call (no leak across an account change).
- fake and supabase adapter: `settlementMoved` answers the caller's count and null for a stranger's settlement or an
  unknown id.
- SQL (Task 2's file): `my_settlement_moved` answers the caller's count; another account gets no row for the same id;
  `anon` cannot execute it.

## Task 2. Followed threads are ranked before they are counted (SQL)

**Files:** migration `NNNN_followed_ranked.sql` (with `my_settlement_moved` from Task 1); the scale block of
`supabase/tests/0064-follows.sql`; new test `NNNN-followed-ranked.sql` for Task 1's function.

**Change:** `create or replace view my_followed_threads`, copied from `0059_follows.sql`:
- `followed` is unchanged.
- `ranked` holds the followed threads joined to `threads` and `reading` with the same `next_seq` skip and unfollow
  filter. A `cross join lateral` takes the newest qualifying post (`kind = 'post'`, past the place, owner distinct from
  `auth.uid()`, `order by a.seq desc limit 1`) as `newest_at`, then `order by newest_at desc limit 50`.
- The outer select runs 0059's bounded count (`limit 100`) only for `ranked`'s rows, and orders by `newest_at desc`.
- The same columns, in the same order. The header's cost paragraph is rewritten, and it says what `newest_at` is now
  (design, section 2).

**Tests first:**
- `0064-follows.sql`'s scale block: add a shape of 300 followed threads with 120 unread posts each by others. Measure
  the view's buffers with the `buffers_of` pattern from `0058-progress-scale.sql` (one unmeasured run first). Raise
  above a bound the build sets between its measurements of main and of the new view, with the numbers in the test's
  comment. Red on main, which is the poison: today's view.
- The plan check stays: no `Seq Scan`, `acts_thread_openers`, `acts_thread_seq_key`.
- The existing cases stay green: the count, newest first, 50 of 500, a read thread drops out, another account sees
  nothing, the own-run thread.
- A thread whose newest post is the caller's own ranks by the newest post *by another*.

## Task 3. Every setting is held where it is written (SQL, rules)

**Files:** migration `NNNN_settings_held.sql`; new test `supabase/tests/NNNN-settings-held.sql`; new test
`engine/rules/settings-held.test.ts`.

**Change:**
- `settings_held()` is a `before insert or update on settings` row trigger. It has one branch for each key in
  `SETTINGS` (`engine/rules/instance.ts`) that no existing trigger holds. The keys held today are `editGrace`,
  `presenceWindow`, the spans, `inviteLifetime`, `setLasts`, `invitesPerPlayer`, the three crons, `systemEnabled`,
  `reachRarity`, `reachLasts` and `economy`. The build confirms that list with
  `grep -n "new.key" supabase/migrations/*.sql`. Each branch mirrors its TS rule's bounds exactly and raises
  `'<key> is <the TS rule's words>'` with errcode `23514`, so the database names the predicate that failed.
- The migration ends by running every existing row through the hold (`update settings set value = value`). That way a
  row that already breaks a rule fails the migration, naming its key.

**Tests first:**
- `NNNN-settings-held.sql` opens with two `values` lists, written one row per line so the TS test can parse them:
  `poisons(key, value)` and `goods(key, value)`. `poisons` has a value at each edge each TS rule names (below a floor,
  above a ceiling, a fraction where a whole is wanted, the wrong type, a missing field). `goods` has the default from
  `engine/ui/test-world.tsx` for each key. For each poison, an update is refused with `23514`. For each good, the update
  is accepted. `presencePollSeconds = 5` and `presenceNames = 0` are named cases, the issue's own. Red on main for
  every key without a hold.
- `settings-held.test.ts` reads that file, as `engine/rules/alerts.test.ts` reads its migration. The keys of `poisons`
  and of `goods` are each exactly `SETTINGS`'s keys. `settingsProblems` refuses each poison (a valid settings with that
  key replaced) and accepts each good. Drive it red twice: once by deleting a key's rows from the SQL list, and once by
  adding a poison that the TS rule accepts.

## Task 4. A reply passes each card back once, under one lock order (SQL, log)

**Files:** migration `NNNN_reply_passes.sql`; `supabase/migrations/0054_card_plays.sql`'s lock paragraph (described, not
edited: the new migration's header restates the order and names 0054's as replaced); `engine/ui/log/lines.ts` (around
the Set line, ~366) and its log reads; `engine/ui/data/api.ts` and `fake.ts`, for `passedAt` on the setter's own
face-down; tests `supabase/tests/0059-card-plays.sql` (race block), a new `NNNN-reply-passes.sql`,
`supabase/tests/e2e/0003-export.ts`, `engine/ui/log/lines.test.ts`, and the fake's tests.

**Change:**
- `face_down_reply (play uuid primary key references face_down (play), thread uuid not null references threads (id),
  passed_by uuid references acts (id), passed_at timestamptz, check ((passed_by is null) = (passed_at is null)))`, with
  `create index face_down_reply_waiting on face_down_reply (thread) where passed_by is null`. RLS on, revoke all from
  `public, anon, authenticated`. A trigger refuses any update but null→set of `passed_by`/`passed_at`, and refuses
  delete.
- Backfill one row per existing `face_down`. `passed_by` is the first post in the thread after the set Act by a
  character other than the back's post's author, else null.
- `set_card` (latest definition) inserts the `face_down_reply` row beside `face_down`.
- `post()` (from `0058_alerts.sql`), in this order, before the insert:
  1. Lock `face_down` for the quoted post's live back, plus the waiting `face_down_reply` rows for the thread whose
     post's character is not `through`, together with their `face_down` rows, in `play` order.
  2. `insert … on conflict do nothing`, then lock the `character_post_counts` rows of `through` and of each locked
     back's setter, in character-id order.
  3. Insert the post.
  4. Run the quote's `spring_traps` as today.
  5. Stamp every locked waiting row `passed_by = written, passed_at = now()`.
  6. If nothing sprang, call `spring_traps('reply', …)` over the locked backs, newest post first, until one springs.
- `play_card` (latest definition): lock the target's live `face_down` row, then the caster's and its setter's count
  rows in id order, before its card Act insert.
- `react` adds no counted Act before its spring and keeps its order. Its header says so.
- `my_face_down` gains `passed_at` from `face_down_reply`, as its last column.
- The log (`lines.ts`): a set whose card has no trap says "It ends by itself" (#136 F3). A reply trap with `passed_at`
  before its end and no spring gets a line: "A reply passed it by on <post> without springing it; it ends by itself
  <date>." The exact words are the build's, plain and true, and approved in review.

**Tests first:**
- Race (`0059-card-plays.sql`, a `tests.race_*` block on committed rows). A quoting post and a cast by the same player
  on one trapped post both land, with no 40P01. Also a post and a strike whose setter is the poster. Red on main, which
  is the poison: today's statement order.
- Two reply traps on posts 5 and 8, and post 9 by another character: 8 springs, both rows are passed by 9, and post 10
  springs nothing. Red on main: main springs 5 on post 10.
- A Bluff, a quote trap and a reply trap are each passed by the first post by another character, and the reads and
  writes are the same for each (`pg_stat_get_xact_tuples_*` deltas equal across the three).
- A post by the back's own author passes nothing.
- A quote trap that has been passed still springs on a later quote.
- Scale: a thread with 200 live backs that were passed long ago. A new post reads at most the waiting rows (a tuples
  delta bound). Red on main.
- Export (`0003-export.ts`): the cast gains a `set_card` and a caught `play_card`, so `face_down` and `face_down_reply`
  each hold a row that round-trips (#136 F1).
- Log: the Bluff wording, and the passed line, each with a test. Red on main.

## Review focus

- Acts an instance already holds: the backfill's `passed_by` for backs set before this change, and whether a held reply
  trap that today would still spring now cannot.
- A busy thread: does any statement in `post()` still read every live back in the thread (Task 4's scale test)?
- The lock order across `post`, `play_card`, `react` and `spring_traps`: a pair the race block does not drive.
- A mask slipping: any read, write or lock in the reply path whose count differs with the hidden card.
- `my_followed_threads` at 300 threads: whether the per-thread probe is still the cost, and whether the numbers in
  the test's comment hold.
- The settings holds drifting from `SETTINGS` in a way the parity test cannot see (a rule whose edge the poisons do not
  name).
- The spread read: whether a client that hears `settled` and then navigates reads twice in a way that matters at N
  clients.
