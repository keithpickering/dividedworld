# The season's end and the announcements: plan

Record, written 2026-11-06. The plan for `docs/plans/2026-11-06-season-end-design.md` (#278). One build session builds
it in one PR from `main`. Every task is test first: name the test, record its red run, then write the code. Two
migrations (Tasks 1 and 2). The plan adds no check, so no poison is owed. It changes two existing checks' lists (Task 4),
and their self-tests run unchanged. Everything is engine except Task 3's two lines of Divided World copy.

Line numbers are main's at 5e4d23b. Where a migration "redefines" a function, it copies the latest definition named
here and changes only what the task says, with a header comment naming the migration it replaces, as the migrations do
today.

## Task 1: season_results (SQL)

Model: sonnet

Files: `supabase/migrations/0098_season_results.sql`, `supabase/tests/0100-season-results.sql`,
`supabase/tests/setup/fixtures.sql` (the copy row, line 37). Read first: `0073_core_loop_answers.sql:298-361`
(`reveal_season`), `0063_season_news.sql` (whole), `0096_profile_record_pages.sql` (whole), `0007_seasons.sql:52-82`
(`copy_of`, `settings_copy_complete`, `settings_copy_kept`), `0090_handover_todos.sql:21-30` (an always-enabled guard),
`0030_screens_reads.sql:371-...` (`standings_page`, `standing_place`, which the new reads mirror).

- `create table season_results (season bigint not null references seasons (id), character uuid not null references
  characters (id), name text not null, place integer not null check (place >= 1), standing integer not null, shown jsonb
  not null default '[]' check (jsonb_typeof(shown) = 'array'), primary key (season, character))`, index
  `season_results_by_place (season, place, name, character)`, index `season_results_by_character (character, season
  desc)`. A `before update or delete` row trigger and a `before truncate` statement trigger refuse, each named and
  `enable always`, as 0090's are. `grant select on season_results to authenticated`; no write grant.
- `alter table seasons add column results_at timestamptz`.
- **Backfill:** for every season with `reveal_act`, insert one row per per-character reveal Act in its thread (`name`,
  `place`, `standing`, `shown` from the payload; `shown` is `'[]'` where the payload has none, as in seasons revealed
  before 0029), and set `results_at` from its `news_landed` row, else the header's `created_at`. On an empty database
  this inserts nothing.
- **`reveal_season`** redefined: everything as 0073 wrote it except the thread. No `threads` insert, no reveal Acts, no
  broadcasts of them. It inserts into `season_results` with the same select the per-character Acts used (lines 341-355,
  same order, same `rank()`), sets `results_at = now()`, and leaves `reveal_act` null. It returns `{ season, results:
  <count> }`. `apply_settlement` reads only `revealed -> 'season'` (0073:544), so it is not redefined. Check that in the
  test.
- **News.** `season_news` redefined: its `results` CTE reads `seasons` where `results_at` is set (in `results_at`
  order, with the same paging floor), `count` is the season's row count and `detail.top` is its first three rows by place.
  `act`, `thread` and `seq` are null for a results item. `news_landed`'s results rows are deleted: the backfill moved
  their dates to `results_at`. They are an index, not Acts. Its kind check narrows to `('tally', 'announcements')`,
  Task 2's kind, added here so the check changes once. `alerts_news_unread` redefined to count seasons with `results_at`
  after the mark beside the `news_landed` rows. `reveal_season` broadcasts `reach`/`news` `{ kind: 'seasonNews', sub:
  'results', season }` with `broadcast_later`, where `news_announce` broadcast it before. `news_announce`'s `reveal`
  branch and the trigger's `'reveal'` are dropped.
- **Reads:**
  - `finished_seasons()`: rows of `{ number, starts_at, ends_at, results_at, characters }`, newest first, at most 200.
  - `results_page(in_season integer, page integer)`: 50 rows by place, then name, then id. Each row has `{ character,
    name, place, standing, shown }`.
  - `result_place(in_season integer, in_character uuid)`: the row's index in that order, or null.

  Each is `begin atomic`, stable, security invoker, reading `season_results` and `seasons` through a public view
  `seasons_finished` (`select number, starts_at, ends_at, results_at from seasons where results_at is not null`, granted
  to authenticated), executable by authenticated and not by anon.
- `profile_page` and `record_page` redefined: `seasons` reads `season_results` joined to `seasons_finished`, by
  character, newest first, at most 50, as `{ season: number, place, standing, at: results_at }`.
- **Copy.** `settings_copy_complete` redefined to require `announcementsThreadTitle` alone. The settings row's copy
  loses `revealTitle` and `revealBody`, and `turnsThreadTitle` is renamed `announcementsThreadTitle`. Do it in one
  `update` after the redefinition, so `settings_copy_kept` sees a complete copy. `copy_of('turnsThreadTitle')` has one
  caller (`post_tally`), and Task 2 replaces it.
- `seasons_net_threads` redefined: it unlists only a `reveal_act`'s thread. The Promos (`turns_thread`) are listed again:
  delete each season's `turns_thread` from `unlisted_threads`, and `backfill_unlisted_threads` drops its `turns_thread`
  arm.

Tests first (`0100-season-results.sql`), each a `do` block that raises on failure:
- A season's end writes one `season_results` row per debuted non-staff character, in standing order, with names as they
  stood. A rename afterwards leaves them. No thread is opened and no `reveal` Act written. `results_at` is set.
- `shown` carries a reveal made in the season and an announced Turn's `was`, and nothing from a silent Turn (as
  0013-seasons.sql:161 holds for the Acts).
- Update, delete and truncate of `season_results` are refused, by the guard's name.
- The backfill: a hand-made reveal thread (as 0098-profile-record-pages.sql:49 makes one) comes back as rows with its
  landed date.
- `season_news` gives the results item with its count and top three, and `act` null. `alerts_news_unread` counts it once
  after the mark.
- `results_page` pages at 50. `result_place` gives a character's index. Both refuse anon.
- `profile_page` and `record_page` give `seasons` from the table.
- The copy check refuses a copy without `announcementsThreadTitle`. This rewrites 0013-seasons.sql:192-198 for the new
  key.
- The existing tests that read the reveal thread move to the table: 0013-seasons.sql:127-161 and 183, 0017-masks.sql:414-441,
  0056-succession.sql:440 and 453 (`results_at is not null` for `reveal_act is not null`), 0068-season-news.sql:153-167.
  0035-reveal-index.sql stays: the index still serves old reveal Acts.
- e2e: `supabase/tests/e2e/0001-settlement.ts:109,190`, `0010-reveal-across-0029.ts` (the old Acts still read),
  `0013-handover.ts:97` and `0015-a-day-of-the-staff.ts:80` read the results table where they read the thread.
  `0003-export.ts` gains a `season_results` row in its round trip and asserts the guard is still `enable always` after
  import. `0016-screen-reads.ts` passes once Task 4 lists the new reads.

## Task 2: the announce Act (SQL)

Model: sonnet

Files: `supabase/migrations/0099_announce.sql`, `supabase/tests/0101-announce.sql`. Read first:
`0074_settle_claim.sql:78-158` (`masks_change`), `0028_loud_classes.sql:50-69` (`announce_drop`), `0024_debuts.sql:29-48`
(`post_tally`), `0027_unmask.sql:68-78,105-126` (`write_unmask`, `class_reveals`), `0073:284-295` (`turns_announced`),
`0092_card_end.sql:26-29,80-100` (constraints, the Act guard), `0063_season_news.sql:171-302`, as Task 1 left it.

- `acts_kind_check` gains `'announce'`. `acts_character_null` is unchanged: an announce has a character. `acts_check1`
  (latest 0062:52) gains `'announce'` among the kinds with no target.
- The Act guard (0092's, redefined): `if new.kind in ('unmask', 'announce') and new.payload ? 'class' and (new.payload
  ->> 'class') is distinct from class_now(...)` raises as for an unmask. An announce's `what` must be `debut` or `turn`,
  and a `debut` carries no `was`, `23514`.
- `promos_thread(in_season bigint) returns uuid`: the season's `turns_thread`, opened on `system_board()` with
  `copy_of('announcementsThreadTitle', number)` where null, broadcast on `board:<id>` as `post_tally` did. It takes
  `post_tally`'s lines 37-42.
- `write_announce(of_character uuid, in_thread uuid, what text, was text, cls text, at timestamptz) returns jsonb`:
  inserts the Act and returns `act_projection`.
- **`masks_change`** redefined: everything as 0074 wrote it up to `masks_named`, which is unchanged except that
  `unmasks` is dropped. Then, if any row is named: `promos_thread(in_season)`, and for each row in `n` order whose
  character is not retired, one `write_announce` and its `broadcast_later('thread:'…)`. A debut carries `class` where
  `with_class`. A Turn carries `was` where `show_from` and `class` where `show_to`. No parts, no tally, no
  `write_unmask`. It returns the first announce's id, or null. `apply_settlement`'s `'tally'` key then carries that id;
  the key keeps its name, so `supabase/functions/settle/core.ts` is unchanged. Check it reads only the id.
- **`announce_drop`** redefined: in season, one `write_announce(dropped, promos_thread(...), 'debut', null, <class where
  with_class>, at)`, returned as `{ act, thread }`, where `thread` is the projection when the thread was just opened.
  Between seasons it is unchanged. `supabase/functions/act/core.ts`, `announcement()` (66-70), broadcasts the thread
  then the Act, and drops its `unmask` arm. That is in Task 3.
- `post_tally` is dropped. Nothing calls it after this.
- `class_reveals` redefined: the `unmask` Acts, union the `announce` Acts with a `class` (`via` = `what`). It keeps its
  columns.
- `turns_announced` redefined: the old tallies' rows as 0073 reads them, union the `announce` Acts whose `what` is
  `turn` (`act`, `character`, `at`, `was`). An index `acts_announce_character on acts (character, created_at) where kind =
  'announce'` serves both.
- **News.** `news_announce` gains a branch: on an `announce` insert, if no `news_landed` row of kind `announcements`
  exists for an Act in the same thread at the same `created_at`, it inserts one for this Act and broadcasts `{ kind:
  'seasonNews', sub: 'tally', act }` as a tally did. The trigger's `when` gains `'announce'`. `season_news`'s `tallies`
  CTE keeps the old tallies and adds the `announcements` rows: `count` is the landing's Acts, and `detail` is `{ debuts,
  turns }` with at most 20 entries in all, each `{ character, name, class?, was? }` (the shape `TallyName` reads today).
- `settlement_input` and `estimate_input` (0092) read an announce as any character's Act. Check that nothing filters
  `kind = 'unmask'` there. `masks_change`'s backstop (`not exists ... kind = 'unmask' ... created_at >= window_end`)
  stays on `unmask`: an announce at this window's end is this function's own, and a player's reveal is always an unmask.

Tests first (`0101-announce.sql`):
- A settlement with an announced debut, a debut with its class, a silent debut, and the four kinds of announced Turn and
  a silent one writes exactly six announce Acts. They are in the season's thread, in name order (debuts first), each its
  character's, with the payloads of the design's table, and no tally and no unmask.
- A debut with its class and a Turn naming the class it Turns to appear in `class_reveals` with `via` `debut` and `turn`.
  The others do not. `turns_announced` holds the four Turns with `was` where named, and still holds an old tally's
  Turn.
- An announce naming a class the character does not hold is refused. A `debut` with `was` is refused.
- A drop announced with its class writes one announce, at once, which opens the thread when it is the season's first.
- A retired character owed an announcement across a gap gets none, and the settlement still runs.
- 156 debuts at one settlement write 156 Acts and one `news_landed` row. `season_news` gives that item a count of 156
  and 20 names.
- The Promos thread is in `thread_list`, and an old season's reveal thread is not.
- The existing tally tests move to announce Acts: 0017-masks.sql:84,150; 0020-system-board.sql:48-51,67 (a spin from an
  announce); 0022-system-reactions.sql:30-38,52 (reacting to an announce scores for its character, so it moves out of
  `systemActs`); 0031-debuts.sql:306-318,393-405 and 254,282; 0032-unmask.sql:125,166-175 (the hand-made tally stays,
  as an old Act); 0068-season-news.sql:87-111; 0076-core-loop-answers.sql:206; 0077-settle-claim.sql:219-261;
  0098-profile-record-pages.sql:47-127. 0003, 0013, 0014, 0021, 0026, 0034 and 0093 name tallies in passing: grep each for
  `tally` and move what reads a new one.

## Task 3: the engine's rules, the copy and the edge functions

Model: sonnet

Files: `engine/rules/types.ts` (`ActKind` at 233 and its doc, `BoardSeed` doc at 237, `Copy` at 494-501),
`engine/rules/instance.ts:275-279`, `engine/rules/settle.ts` (around 396, the comment and any kind list),
`instances/divided-world/index.ts:14-25`, `supabase/functions/act/core.ts:66-70,98,107-108`,
`supabase/functions/_shared/seed.ts:20`, `supabase/functions/_shared/settings.ts:19`, and the fixtures that list the copy:
`engine/rules/instance.test.ts:104,336-337`, `actions.test.ts:19`, `settle.test.ts:43`, `settle.scale.test.ts:28`,
`engine/ui/test-world.tsx:33`, `engine/ui/data/fake.test.tsx:30`, `supabase/functions/settle/core.test.ts:138,224-232`.

- `ActKind` gains `'announce'`: "a character's announced debut or Turn, written by The System on its behalf at the
  moment it takes effect (supabase/migrations/0099_announce.sql): an Act of its character like an unmask, whose
  reactions are scored and which counts in the halving, and no post."
- `Copy` is `{ announcementsThreadTitle: string }`, still requiring `{season}`. Divided World's is `'Season {season}:
  Promos'`. Its board comment for `the-system` reads "Only the staff and The System post here: the Boss's arrivals and
  farewells, the characters' Promos." Leave the board's description and name to the board look design, which renames
  them.
- `announcement()` in `act/core.ts` broadcasts the thread, when opened, then the Act. It has no `unmask` arm.

Tests first:
- `settle.test.ts`: "an announce is an Act of its character like an unmask: its reactions are scored" (beside 810's
  reveal test). A reaction to an announce moves its character's Aura and is not a System Act's reaction (334 stays, on
  an old tally).
- `instance.test.ts`: a copy without `announcementsThreadTitle`, or without `{season}` in it, is refused, and an old
  `revealTitle` key is refused as unknown, if the validator refuses unknown keys (check `instance.ts`; if it doesn't,
  skip this one).
- `act/core.test.ts:159-170`: a drop's announcement broadcasts the thread, then the announce.
- `settle/core.test.ts:219`: the missing-copy case names `announcementsThreadTitle`.

## Task 4: the data layer

Model: sonnet

Files: `engine/ui/data/api.ts`, `web/src/data/supabase.ts`, `engine/ui/data/fake.ts`, `tools/check-web-reads.mjs`, and
their tests (`web/src/data/supabase.test.tsx`, `engine/ui/data/fake.test.tsx`).

- `api.ts`:
  - `ActKind` (164) gains `'announce'`.
  - New `SeasonFinished { number; startsAt; endsAt; resultsAt; characters }` and `SeasonResultRow { character; name;
    place; standing; shown: SeasonShown[] }`, using `SeasonShown` at 792.
  - New methods `finishedSeasons(): Promise<SeasonFinished[]>`, `resultsPage(season: number, page: number):
    Promise<SeasonResultRow[]>` and `resultPlace(season: number, character: Id): Promise<number | null>`.
  - `SeasonNewsItem` (822-835): `act`, `thread` and `seq` become nullable for `results`, and the doc says so.
  - `ProfilePage.seasons` and `RecordPage.seasons` (1158, 1170) become `SeasonRecordRow[]` = `{ season: number; place:
    number; standing: number; at: string }`.
  - `characterReveals` (1305) goes: its only readers were those two types.
- `supabase.ts`: the three rpcs. `toSeasonNews` (162-175) takes the null link. `profilePage` and `recordPage`
  (1173-1199) map `seasons` to the new row, and `recordPage`'s offset (1194) counts them as before. `characterReveals`
  (1003-1006) goes.
- `fake.ts`:
  - A season end writes results rows in memory (the fake never ran a reveal; seeds get `seed.seasonResults(number,
    rows)`).
  - `newsItems` (722-748): results come from those rows, and announcements come from announce Acts grouped by thread
    and instant, at most 20 names.
  - `seed.announce(character, what, { was, class })` writes an announce in the season's Promos thread. `seed.announceTurn`
    (2434) writes one.
  - `turnsAnnounced` (1795) and `classReveals` read announce Acts beside the old.
  - `listed` (642) lists the Promos thread.
  - The three new methods.
  - `systemAct`'s default kind (2224) stays `tally`, for old Acts.
- `check-web-reads.mjs`: `ALLOWED_RPCS` gains `finished_seasons`, `results_page` and `result_place`. `ALLOWED_READS`
  gains `season_results` and `seasons_finished` (for the `*_page` functions' dependency check in e2e 0016), under the
  public heading: "a finished season's frozen results; who plays whom is in none of it".

Tests first: `fake.test.tsx` for each new method and for the news items, beside 1259-1267 (which `characterReveals`
leaves) and 2129; `supabase.test.tsx` for the rpc names and mapping, at 253-265, 333-343 (gone) and 1923.

## Task 5: the screens

Model: sonnet

Files: `engine/ui/rankings/Rankings.tsx`, `engine/ui/season/Season.tsx`, `engine/ui/profile/record.ts`,
`engine/ui/profile/Record.tsx:26-43,70`, `engine/ui/profile/Profile.tsx:62`, `engine/ui/thread/lines.tsx`,
`engine/ui/thread/Post.tsx:60-68`, `engine/ui/spin/Origin.tsx:186-187`, `engine/ui/alerts/words.ts:215`,
`engine/ui/cards/plays.ts` (check its `unmask` handling and treat `announce` the same), and their tests
(`Rankings.test.tsx`, `Season.test.tsx`, `Record.test.tsx`, `Profile.test.tsx`, `Thread.test.tsx`, `lines.test.tsx`).

- **Rankings.** `RankingsScreen` takes `season?: number` and `character?: Id` from the Season page's URL. With no season,
  or the current one, it is as today. With a finished season it reads `resultsPage` (and `resultPlace` for `character`,
  to choose the page) and draws the same table. It is headed "Season N · Final standings · Ended <date>". The class
  column is what was made public (the `Season.tsx:65` logic, moved to `engine/ui/reveal/statements.ts` and shared), and
  the highlighted row has `data-kb-highlight` and `aria-current="true"`. The season choice is a labeled glass `<select>`
  ("Season"; "Season 4 (now)", then each finished season), which navigates with `replace` to `seasonAt('rankings',
  1, n)`. `seasonAt` and `rankingsAt` (`Season.tsx:35-36`) gain `season` and `character`.
- **Season News.** The results item's link (97) goes to `seasonAt('rankings', 1, item.season)`. An announcements item
  draws as a tally item does (179-184). A results item with a null `act` builds no post link (141).
- **Record.** `seasonRow` takes a `SeasonRecordRow`: "Season N: finished #P", linking to `seasonAt('rankings', 1, N,
  character)`. Record.tsx's copy at 70 reads "The latest {SEASONS_SHOWN} seasons." `turnLinksFrom` (71-78) is unchanged:
  `turns_announced.act` is now the announce Act itself.
- **The board line.** `AnnounceLine` in `lines.tsx`, beside `UnmaskLine` (73), says the design's section 4 table, with
  class names through the instance's `classes`. `Post.tsx` draws an `announce` as an `unmask` is drawn, a character's
  Act with its postbit and reactions. `Origin.tsx` draws it as the origin of a spin.
- **Alerts.** `words.ts:215`'s "New debuts and Turns are in" stays for both kinds.

Tests first:
- `Rankings.test.tsx`: a finished season's page of 50, the head's words, the select's label and options and its
  navigation, a highlighted row on the second page, and your own characters marked.
- `Season.test.tsx:161,179-181,249-255`: the link is `/season?tab=rankings&season=1`, and an announcements item lists
  its names.
- `lines.test.tsx`: each of the six lines.
- `Thread.test.tsx`: an announce is reacted to and spun from.
- `Record.test.tsx:70,127,161` and `Profile.test.tsx:182,217`: the new rows and the call list without
  `characterReveals`.
- The a11y specs that visit `/season?tab=rankings` (`e2e/a11y.spec.ts:46,105`) add `&season=1`.

## Task 6: stories and boards

Model: sonnet

Files: `engine/ui/season/Season.board.stories.tsx:37-45`, `engine/ui/rankings/Rankings.board.stories.tsx`,
`engine/ui/reveal/Reveal.stories.tsx`, `e2e/boards/04-season-news.ts`, `e2e/boards/13-rankings.ts`, new
`e2e/boards/14-promos.ts`, `e2e/glass-screens.ts:48-49`.

- Season News's story seeds results rows and an announcements landing, not a reveal thread.
- Rankings gains `FinishedSeason` and `FinishedSeasonPhone` stories (390 by 844), with a highlighted row.
- A Promos thread story (in `engine/ui/thread/`) shows the six lines with reactions, at 1440 and 390, shot by
  `14-promos.ts` as the other boards are.
- `Reveal.stories.tsx` keeps drawing an old reveal post and tally, titled "old Acts", since the screen still draws them.
- Regenerate the boards' screenshots and attach them to the PR for the owner.

## Task 7: the documents

Model: inline

Files: `docs/plans/port-manifest.md` (only if it names `post_tally` or the reveal thread; check), the screen docs
(`engine/ui/screen-docs.ts`, if it describes the reveal thread or the tally), and any current document that names
`post_tally`, `characterReveals`, `revealTitle` or `turnsThreadTitle`. `npm run build:ci` fails on a dead reference in a
current document, so run it. Records are left as written.

## Review focus

- What the migrations do to an instance that already holds reveal threads and tallies. The backfill copies the right
  rows and dates, old Acts still draw, and old tallies still feed `turns_announced` and News, with nothing edited.
- A Turn, a debut and a drop landing at the same instant in the same thread: the News grouping by `(thread,
  created_at)` would merge them. Check this can't happen (`now()` against a window's end), or that merging is harmless.
- A settlement retried after a crash. `masks_change` must not write a character's announce twice. The pending rows it
  deletes are the guard; confirm it as the tally was confirmed (0077-settle-claim.sql).
- The order of announce Acts in a landing, which must never be by account or creation order across players, since that
  could hint at who made them together.
- A busy landing (hundreds of debuts): an Act and a broadcast each, against a tally per 100. Check the settlement's
  run time in `settle.scale.test.ts`'s terms.
- `season_results` under the import. The guard is `enable always` and fires on update, delete and truncate only, so the
  import's inserts under `session_replication_role = replica` pass. Prove it in e2e 0003, not by reading.
- Reactions on an announce scored for its character: a player whose own debut is reacted to gains Aura, and the settlement
  reads it as it reads a reveal's. Check that no class's rule counts an announce as a post.
