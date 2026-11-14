# The veil's cover is stored: plan

Record, written 2026-11-14. Carries out `docs/plans/2026-11-14-veil-cover-design.md` (its sections are cited as §N),
task by task.

Every task is test first: the test named, its red run recorded, then the code, then the green run. One migration is
added (Task 2), tested on Postgres on localhost; no task touches a deployed database or service. All of it is engine;
no instance content is involved and no interface changes. No state a player, a character or a post can be put in is
added. What could be computed from a private fact is named in §6 (the trigger's extra work and the advisory lock, both
keyed on a character and never on who owns one), and Task 1 holds it.

Numbers: the migration is `0369` and the SQL test `0321`, the next free on main when this was written; if main has
taken them by the time the PR merges, take main's next numbers, as earlier PRs have.

The order: 1, then 2, then 3.

## Task 1. The test: the cover agrees with 0357's derivation (§5, §6)

Model: sonnet

**Files:** a new `supabase/tests/0321-veil-cover.sql`. Read first: `supabase/migrations/0357_post_veils.sql` (section
4, the view and its header; section 3, the tables), `supabase/tests/0304-post-veils.sql` (how a veil, a back, a spring
and a wall are made in a fixture, and `tests.race` in section 13), `supabase/tests/setup/fixtures.sql`.

**What:**
- The file defines `pg_temp.derived_character(a acts) returns uuid`, or a temp view, holding 0357's derivation as it
  stands today: the stand-in where the second select's `ok` holds, else `a.character`. Copy the two `ok` expressions
  from the view in `0357_post_veils.sql` (lines 705 to 748) and name them as that migration's; this is the record of
  what the cover must equal, kept in the test and in no view.
- `pg_temp.disagreeing() returns uuid[]`: the ids of every Act where `acts_public.character` is distinct from the
  derivation, read as the table's owner.
- **The fixture**, each case made twice, once with the Act written before the veil lands and once after, while it is
  up:
  1. the veiled post itself;
  2. its author's edit, set, take-back, use card and spring on it;
  3. its author's draw and wash on a wall whose card is on it, and another character's draw on the same wall (not
     covered);
  4. the card a back of the author's laid on a quote (a `post_veil_cards` row);
  5. the author's own quote of the post and a spin from it (not covered), and another character's card on it (not
     covered);
  6. two author veils on one post at once;
  7. a veil whose time has passed, and a veil an admin ended (`reverse_card`), each with an Act of the author's
     written after: shown under the true character;
  8. a totals veil (`veil = 'totals'`) alone on a post: nothing covered.
- **Assertions:** `disagreeing()` is empty after each step; `post_veil_cover` refuses an update, a delete and a
  truncate with 55000; no API role (`anon`, `authenticated`, `service_role`) has any privilege on it; every row's
  `play` is an author veil's.
- **The poison:** inside a savepoint, disable the trigger on `acts` that writes the cover
  (`alter table acts disable trigger …`), write an edit by the author on a post under a live veil, and require that
  `disagreeing()` names that edit; then roll back to the savepoint. A second poison the same way with the trigger on
  `post_veils` off and a veil cast on a post that already has an edit.
- **The race** (with `tests.race`, as 0304's section 13 does): a veil cast on a post and its author's `edit_post` of
  it, committed from two sessions at once, in both orders of arrival; after both, `disagreeing()` is empty and the
  edit has its cover row. And a second: two Acts by another character on the post while the veil's landing is held open
  do not wait on it (a `lock_timeout` on the racers that a wait would trip).
- **The cost of an insert:** with a thread of some hundreds of Acts and `analyze`, a reply by a character who is not
  the post's author reads `post_veils` not at all (count `pg_stat_xact_user_tables.idx_scan + seq_scan` on
  `post_veils` across the insert).
- **Red run first:** `npm run test:sql` before Task 2. The file fails at `post_veil_cover` not existing. Record it.

**Poison:** the two savepoint cases above; each must make `disagreeing()` non-empty, and the file raises if either
comes back empty.

## Task 2. The migration: `post_veil_cover`, its three triggers, the fill, and `acts_public` (§2, §4, §5)

Model: sonnet

**Files:** a new `supabase/migrations/0369_veil_cover.sql`. Read first: `supabase/migrations/0357_post_veils.sql`
(sections 3 and 4), `0359_post_reactions.sql` (`land_rows`, which writes `post_veils`), `0360_setting_thread.sql`
(`lay_sprung`, which writes `post_veil_cards`), and how `acts_count_character` and `acts_quote_refs` are written as
triggers on `acts`.

**What:**
- **The header** says what was found (§1, in three or four lines), what the table is, the four kinds of covered Act
  (§5), why live is still `post_veils_live` (§4), the advisory lock and what takes it, the masks (§6) and the way a
  veil ends (unchanged).
- **The table:** `post_veil_cover (act uuid not null references acts (id), play uuid not null references post_veils
  (play), primary key (act, play))`. Row level security on, every privilege revoked from `public`, `anon`,
  `authenticated` and `service_role`, and the append-only pair from `post_veils_append_only` (before update or delete
  for each row, before truncate for each statement, both `enable always`), as `post_veil_cards` has.
- **`veil_cover_lock(post uuid)`**: `pg_advisory_xact_lock` on a key made from the post's id and a constant that names
  this lock (two-argument form, the constant as the first). For no API role.
- **`post_veils_cover()`**, after insert on `post_veils` for each row, when `new.veil = 'author'`: takes
  `veil_cover_lock(new.post)`, then inserts `(act, new.play)` for the post, for every Act with
  `target_act_id = new.post and character = new.author and kind not in ('post', 'spin')`, for every draw or wash of
  `new.author` whose target is a card (`kind = 'card'`) that targets `new.post`, and for every `post_veil_cards` row of
  `(new.post, new.author)`; `on conflict do nothing`. Security definer, `search_path` set.
- **`acts_veil_cover()`**, after insert on `acts` for each row, when `new.target_act_id is not null and new.kind not in
  ('post', 'spin')`: finds the post the Act is on (its target; for a draw or a wash, the target's target where the
  target is a card) and that post's character, by key. Where that character is `new.character`: takes
  `veil_cover_lock(post)`, then inserts `(new.id, v.play)` for every `post_veils` row with `veil = 'author'`,
  `post = post`, `author = new.character` and `ends_at > now()` (the index `post_veils_post`); `on conflict do
  nothing`. Otherwise it returns having read no veil. Security definer, `search_path` set.
- **`post_veil_cards_cover()`**, after insert on `post_veil_cards` for each row: inserts `(new.card, v.play)` for every
  such veil on `(new.post, new.author)`. Security definer, `search_path` set.
- None of the three triggers is `enable always`: an import writes as a replica (`tools/import-instance.mjs`) and
  carries the rows.
- **The fill:** one insert of the same four kinds for every `post_veils` row with `veil = 'author'` and
  `ends_at > now()`; `on conflict do nothing`.
- **`acts_public`:** `create or replace view`, the same columns in the same order, the concealment over the union
  exactly as 0357 has it. The two selects under it become:
  - the first: `a.character`, `true as g`, `not exists (select 1 from post_veil_cover c join post_veils_live v on
    v.play = c.play and v.veil = 'author' where c.act = a.id) as ok`;
  - the second: the stand-in by the same subquery as today, `true as g`, and the same `exists` as `ok`.
  Each select still reads `acts` alone with no WHERE and no join of its own, so the union stays one appendrel. `g`
  stays a column so the outer `where u.g and u.ok` is unchanged.
- `acts_base`, `post_veils_live`, `post_veil_cards`, `land_rows`, `lay_sprung` and every page function are untouched.
- **Green run:** `npm run test:sql`, Task 1's file passing. Record the run.

**Measure and record in the PR** (on localhost; `discard plans` between calls, as the design did): thread_page's
planning time before and after the migration, and `explain (summary)` of
`select * from acts_public where thread = … and seq between 1 and 20` before and after. The design's figures on 17.11
were 230 ms to 130 ms and 8 ms to about 4 ms.

## Task 3. The suite follows the new view (§6)

Model: sonnet

**Files:** whichever of these the red run names: `supabase/tests/0304-post-veils.sql` (section 8's plan and buffer
assertions, and the column-for-column comparison with `acts_base`), `supabase/tests/0305-veil-sweep.sql` (its
completeness list of tables, views and functions), `supabase/tests/0075-play-moments.sql` and
`supabase/tests/0065-alerts-read.sql` (buffer counts that 0357 raised), `supabase/tests/0005-default-deny.sql`,
`supabase/tests/e2e/0003-export.ts` and `tools/instance-files.mjs` (the round trip, table by table), and
`supabase/tests/0320-client-reads-plan-once.sql` (expected unchanged).

**What:**
- Run the whole suite and the end-to-end files after Task 2. For each failure, read why before changing a number: a
  plan assertion that now reads a different index, or a buffer count that fell, is updated to what the new view does,
  with the comment beside it saying the cover is why; a failure that shows a row or a column differing is a defect in
  Task 2 and goes back to it.
- `0305-veil-sweep.sql`: add `post_veil_cover` to the list with its mark (read by no API role).
- The export round trip (`supabase/tests/e2e/0003-export.ts`) holds `post_veil_cover` like any table. If the fixture
  it exports holds no author veil, add one with an edit by its author, so the table is carried with rows.
- 0357's header says what the view costs is planning; do not edit that migration. `0369`'s header is where the new
  account lives.
- **Green run:** `npm run build` and `npm run test:sql`, whole. Record both.

## Review focus

- **Acts an instance already holds:** the fill covers every author veil whose time has not passed; a veil an admin
  ended and one whose time passed get no rows, and nothing reads them as live. Check a veil that is live on the
  deployed shape (cast before the migration, its author's edit before and after) reads the same before and after.
- **The race:** a veil landing and its author's Act on the post in two transactions. The advisory lock must be taken
  before each trigger's read, and no path may take the post's row lock after holding it (a deadlock Postgres would
  report, but a refusal a player would see). `take_back`, `place_set` and `place_cast` lock rows before their insert;
  check each against the trigger's lock.
- **The masks:** the trigger on `acts` must do the same reads for every character who is not the post's own, and
  nothing in it may read an owner. The lock must never make another character's Act on a veiled post wait.
- **Equivalence at the edges:** a second veil cast while a first is up; a veil cast on a post whose author's back has
  already sprung is refused by `land_refusal`, so `post_veil_cards` rows exist only for veils live at the spring; a draw
  on a wall whose card is on the post but whose drawer is not the author.
- **A busy instance:** every Act's insert gains a probe by key; the author's own gain a probe of `post_veils_post` and
  an advisory lock. Nothing reads all of `post_veils` or all of `acts`. The fill is one statement over the veils still
  in time.
- **Planning, the reason for the change:** `acts_public`'s two selects must stay one appendrel (0304's section 8 and
  0075 hold the shapes); a select that gains a WHERE or a join of its own is read whole when joined or ordered.
- **Import and export:** rows carried, no trigger fired on import, and the round trip the same.
