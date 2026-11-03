# Trap locks, even trap work, and seven true lines: plan

Record, written 2026-11-03. The plan for `docs/plans/2026-11-03-trap-locks-design.md`. One build session builds it in
one PR from `main`, after the design's PR is merged. The build PR says `Closes #136`. It ticks #171's first follow-up,
#149's F2, #118's F7 and #179's Lurker follow-up, and links the PR from each. Those four issues stay open for their
other follow-ups.

Every task is test first: name the test, record its red run, then write the code. No `check-*.mjs` is added.

**One migration.** It takes the next free number in `supabase/migrations/` as `NNNN_trap_locks.sql`. Its SQL test takes
the next free number in `supabase/tests/` as `NNNN-trap-locks.sql` and runs against Postgres on localhost. The settle
claim plan (`docs/plans/2026-11-03-settle-claim-plan.md`) also takes "the next free number". Whichever lands second
renumbers. Each function the migration replaces is copied from its latest definition: `post` and `spring_traps` from
`0058_alerts.sql`, and `my_card_ledger` from `0037_log_reads.sql`. Before copying, the build looks for a later
definition with `grep -l "function <name>\|view <name>" supabase/migrations/*.sql`. Everything a copied function does
that this plan does not name stays as written.

**The boundary check holds.** The engine names no card and no class. The Lurker's span reaches the instance through
`ClassLook.description`.

## Task 1. One lock order, and `post()` takes it (SQL; #136 F2, F5)

**Files:** the migration (`post`); the test `supabase/tests/NNNN-trap-locks.sql`.

**Before writing:** list every function in `supabase/migrations/` that inserts an Act of kind `post`, `spin` or `card`
(the counted kinds), or locks `face_down`, `character_post_counts` or `threads`. For each one, write in the migration
header which steps of the order it takes and in what order. A function that takes a later step before an earlier one is
a finding: stop and ask before widening the change.

**Tests first** (in the new file, each a committed race through `tests.race_service`, first in the file as 0059's race
block is, so its rows wait on nothing uncommitted):
- *A quote and a cast through one character on one trapped post both land.* Set a cast-trigger `nullify` trap on post X.
  Race `post(A, t, …, quoting => X)` against `play_card(owner(A), 'sweetie', A, X, …)`. Assert that both answers are
  null (no error), and that one post and one card Act exist. **Red:** today's `post()` gives 40P01 on at least one of
  20 tries; loop the race 20 times and fail on the first refusal.
- *Two strikes across two players' posts both land.* Player 1's S1 sets a reply-strike trap on X in thread t1. Player
  2's S2 sets a reply-strike trap on Y in thread t2. Race S2 replying in t1 against S1 replying in t2, 20 times. Assert
  that every write lands, along with both strikes on the first round. **Red:** a `post()` that locks the poster's count
  row alone (the issue's half fix) deadlocks here; drive it red with that variant before the full fix.
- *A sprung back is not locked.* With one sprung and one live back in a thread, a session holds the sprung back's
  `face_down` row `for update`, and a reply from another session lands without waiting (`lock_timeout = '200ms'`).
  **Red:** today's statement waits and times out.

**Change** (`post`):
1. The checks as today.
2. Lock the backs in one statement, `order by f.play for update`: live (`ends_at > now()`), on `quoting` or in
   `in_thread`, and with no `spring` naming their `play`. Collect each locked back's setter character
   (`acts.character` of `f.play`) into an array. `f.post <> written` goes, since the post is not written yet.
3. `perform 1 from threads where id = in_thread for no key update`.
4. `insert into character_post_counts (character) select c from unnest(setters || through) c order by c on conflict do
   nothing`, then `perform 1 from character_post_counts where character = any(...) order by character for update`.
   Every setter is included, whatever the card ("The masks").
5. Insert the post, then spring as today.

The migration header writes the order (design section 1) and the cost (one probe per live, unsprung back in the thread
and on the quoted post, plus one count row per distinct setter). `play_card` is not replaced. Its header comment in
0058 stays a record, and the new header says that it already keeps the order.

## Task 2. Even work behind a card back (SQL; #136 F4)

**Files:** the migration (`spring_traps`); the test file.

**Test first:** *a Bluff and a matching trap with a retired setter read the same rows before deciding.* In one
transaction for each case, call `spring_traps('reply', p, r)` on a post holding (a) a Bluff and (b) a reply-strike trap
whose setter is retired. Wrap each call in the deltas of `pg_stat_get_xact_tuples_fetched` and
`pg_stat_get_xact_tuples_returned` over `characters`, `card_kinds` and `acts` and their indexes, as #118's F6
describes. Assert that the deltas are equal. Add a third case: (c) a reply-strike trap whose target's stack is full,
against the Bluff. **Red:** today's function reads `characters` only for (b), and counts the stack only for (c).

**Change:** after the lock and the spring check, and before `springs`, always:
- read `setter_character`, then its `retired_at` and `debuted_at`, into locals;
- read `struck` by `kind_of.trap #>> '{outcome,card}'` (null for a Bluff or a non-strike trap);
- run the stack count on `by_act` for `struck.key`.

Then decide `springs`, then the retired check, then "can land" from the locals. Nothing after the decision changes.

## Task 3. A Bluff's set line (SQL, web, engine; #136 F3)

**Files:** the migration (`my_card_ledger`); `web/src/data/supabase.ts` (the `my_card_ledger` read and the row's type);
`engine/ui/data/api.ts` (the ledger entry gains `springs?: boolean`); `engine/ui/data/fake.ts` (it fills `springs` from
its card kinds); `engine/ui/log/lines.ts` (the `set` row); `engine/ui/log/lines.test.tsx`.

**Tests first:**
- `lines.test.tsx`: next to the Snare case at about line 128, a Bluff set reads "Bluff set face down on your post #3. It
  never springs, and ends by itself." The Snare case keeps its words. **Red:** today it says "It springs once".
- The SQL test: `my_card_ledger` gives `springs` true for a trap card's row, false for a Bluff's, and null for a row
  that is not a card set face down.

**Change:** `create or replace view my_card_ledger` with `l.card, l.kind, l.act, l.price, l.at` and then
`springs` (left join `card_kinds`, `k.trap is not null`, and only where the card's `play = 'set'`), with grants as
0037. `lines.ts` chooses the sentence by `e.springs === false`. A row that carries no `springs` keeps today's words.

## Task 4. Four instance and engine lines (#171 F1, #149 F2, #118 F7)

**Files and tests first:**
- `instances/divided-world/ui/cards.ts` `logSave`, with `instances/divided-world/ui/index.test.tsx` at about line 139:
  a clean save says "You peeled every strip it had then. An edit that brings the phrase back brings a strip with it."
  Add a lines test in `engine/ui/log/lines.test.tsx` where a clean save is followed by an edit, and assert that the
  saved row's words do not claim the post is uncovered (no "nothing now"). **Red:** the old words.
- `instances/divided-world/ui/hint-words.ts` thunder, with `instances/divided-world/settings.test.ts` at about line
  147: both lines say "lately", word for word as in design section 4. Add the issue's case to
  `supabase/functions/act/core.test.ts`: a post whose total reactions are higher than its card's, but whose window
  count is lower, fires thunder. This pins the behavior the words now describe. **Red:** the words test, on today's
  text.
- `engine/ui/characters/Characters.tsx` at about line 324, with `engine/ui/characters/Characters.test.tsx` at about line
  1010: the new sentence. **Red:** the test's new text against the old.

## Task 5. The Lurker reads its window (engine and instance; #179)

**Files:** `engine/ui/types.ts` (`ClassLook.description(economy, settlementLength: Span)`);
`engine/ui/characters/ClassCards.tsx` and `engine/ui/guide/markers.tsx` (they pass `settings.settlementLength`);
`instances/divided-world/ui/index.ts` (the Lurker's description and `lurker.postedTooMuch`); tests
`instances/divided-world/ui/index.test.tsx`, and the test that renders `ClassCards` (`engine/ui/characters/NewCharacter.test.tsx`
or `engine/ui/characters/Characters.test.tsx`; the build checks which one does) and `engine/ui/guide/Guide.test.tsx`.

**Tests first:**
- `index.test.tsx`: the Lurker's description with `{ unit: 'week', count: 1 }` says "in one settlement window (1
  week)", and with a day says "(1 day)". The reason says "a post past 2 in one settlement window". **Red:** "a day".
- The ClassCards test and `Guide.test.tsx`: rendered with a tuned `settlementLength`, the Lurker's words state that
  span. This covers the wiring that #179's first follow-up found untested for the economy. **Red:** a caller that does
  not pass the span.

**Change:** use `spanWords` from `engine/ui/characters/format.ts`, re-exported for instances if it is not already, or
the instance's own words over a `Span`. Other classes' descriptions ignore the new argument. `wordsRead`'s test holds
its economy keys as now. Add a note in `wordsRead`'s comment that the Lurker also reads `settlementLength`.

## Task 6. The export carries a set and a spring (e2e; #136 F1)

**Files:** `supabase/tests/e2e/0003-export.ts`.

**Test first:** in the cast, Ann buys and sets a cast-trigger `nullify` trap on `p` through `set_card`, and Bob casts
`sweetie` on `p` through `play_card`, which is caught. After the import, assert by the cast's own ids that its
`face_down` row, its `spring` Act and the caught `card` Act are carried across. That does not lean on 0059's committed
rows. **Red:** the new assertions, run before the cast lines are added.

## Review focus

- Every inserter of a counted Act, and every holder of `face_down`, `threads` or `character_post_counts`, takes the
  written order. One that does not reopens the deadlock where no race test looks.
- The locks in `post()` are chosen only from public facts. A filter on the card's kind anywhere in the lock statement
  is a mask slip.
- `spring_traps` still does the same work before its decision after any later edit. The read-count test is the guard,
  so check that its relations cover every table the function reads.
- A busy thread with many live backs: the lock statement and the setters' count rows grow with live, unsprung backs.
  Check that the plan's stated cost is what `explain` shows.
- A count row inserted by `post()` for a setter with no row yet is a row with zeros. Check that the screens read it as
  0, as they do a missing row, and that the export round trip still matches.
