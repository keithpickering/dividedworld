# The season's end and the announcements: design

Record, written 2026-11-06. Issue #278, designed with the owner. The plan is `docs/plans/2026-11-06-season-end-plan.md`.

## 0. The question

The owner, in the board look design session (`docs/plans/2026-11-06-board-look-design.md`, on its branch when this was
written): "I'm not sure the whole reveal thread is needed anymore since we decided to make class reveals optional at any
time. This would just be an announcement of information that is already available, and it also encroaches a bit on the
'forum aware of kayfabe' point that we touched on." The owner chose to weigh the settlement's tally in the same design.

What the code held when this was written (main, 5e4d23b):

- `reveal_season` (latest in `supabase/migrations/0073_core_loop_answers.sql:298`) writes, at a season's end, a thread
  on the staff's board: a header Act (`kind = 'reveal'`, no character) and one Act per character with its name, place,
  standing and `shown` (what its player made public in the season). Season › News reads the header and the top three
  (`0063_season_news.sql`, `season_news`); the profile record's Seasons rows read the per-character Acts
  (`0096_profile_record_pages.sql`; `engine/ui/profile/record.ts`, `seasonRow`). The thread is unlisted (0063).
- That thread is the only place a past season's full final standings are shown. Rankings shows the current season only
  (`engine/ui/rankings/Rankings.tsx`), and News links "All N characters and their standings" to the thread
  (`engine/ui/season/Season.tsx:97`).
- `post_tally` (`0024_debuts.sql:29`), called by `masks_change` (latest `0074_settle_claim.sql:78`) and `announce_drop`
  (`0028_loud_classes.sql:50`), writes The System's tally in the season's Turns thread: the announced debuts and Turns
  by name, in parts of 100. A debut with its class, or a Turn naming the class it Turns to, also writes the character's
  own `unmask` Act right after its tally part (`write_unmask`, `0027_unmask.sql:68`). `turns_announced` reads the
  tallies (latest `0073:284`), so the tally is how an announced Turn becomes public, not a restatement.
- The outgoing Boss's farewell and the new Boss's arrival are already ordinary posts in the announcements thread,
  written at the handover (`hand_over`, `0082_offices.sql:308`).

## 1. The season's results leave the board

**Decided (the owner chose the recommendation):** a season's end writes no posts. Its results are a record that is not a
post, read in the glass. The board marks a season's end with what it already has: the outgoing Boss's farewell and the
new Boss's arrival. Nothing new is posted for it.

Weighed: keeping the thread as the Boss's farewell over the engine's list (the board look design's section 7.2, which
this replaces for the reveal); a farewell post that links to the glass's standings (a mechanic's pointer on the board,
which the alerts design's line, "the board never names a mechanic", refuses).

Lost, and accepted: reacting to, quoting and spinning from one character's line of the results. The Boss's farewell is
still a post, and is reacted to and spun as any.

## 2. The results are a snapshot

**Decided (the owner chose the recommendation):** a new insert-only table, `season_results`: one row per character per
finished season, written in the transaction that ends the season. It freezes the season as it ended: the character's
name at the time, its place, its standing, and `shown` (the reveals and announced Turns its player made public in the
season, exactly what the reveal Acts carry today). A trigger refuses update, delete and truncate, enabled always, as the
acts table's guard is. The import tool only inserts, so the guard does not trip it. `seasons.results_at` records when
the results landed: the settlement transaction's `now()`, as `news_landed` dates today.

Weighed: a live view over `standings`, `class_reveals` and `turns_announced` (nothing written, but `standings.name`
follows renames (0030), and anything that later moved a closed season's Aura would quietly reorder its final places);
the same reveal Acts in a thread no screen opens (a post pretending not to be one, which every thread reader would have
to keep excluding).

**Old reveals.** The reveal Acts already written are never edited (CLAUDE.md, "Append-only"). Their threads stay, reached
by an old link, and still draw (`RevealPost`). The migration copies their facts into `season_results`, with
`results_at` from their `news_landed` row (or the header's `created_at` where it has none). On an empty database it
copies nothing, so a fresh instance's export holds no rows the migrations made (`supabase/tests/e2e/0003-export.ts`).

**Copy.** `revealTitle` and `revealBody` leave the engine's `Copy` interface (`engine/rules/types.ts:494`), its check
(`engine/rules/instance.ts:275`), `settings_copy_complete` (0007) and Divided World's copy.

## 3. Past seasons are read on Rankings

**Decided (the owner chose the recommendation):** Season › Rankings gains a season choice (this season, then each
finished season, newest first), carried in its URL as `?season=N`. A finished season shows its frozen final table: 50
rows to a page, in the results' order, each row with its place, name, standing, rank, and what its player made public
(the last class it revealed in the season and whether a Turn was announced after, as Season News reads it today,
`Season.tsx:65`). Your own characters are marked as today. A link to a character's result (from News, or from the
record's Seasons rows) opens that season at the page holding its row and highlights the row (`&character=<id>`).

Weighed: a third tab, Past seasons (two places that look alike); a page per season reached only by link (nobody can
browse back through the seasons).

The world: the glass (`docs/plans/2026-10-29-two-worlds-design.md`). The choice is the glass's own select, in the same
row as the page head, plain and never in character. Its label is "Season", and its options read "Season 4 (now)", then
"Season 3", "Season 2" and so on. A finished season's table head reads "Season 3 · Final standings · Ended Oct 30". It
uses only the glass's components (`GlassButton`, the Rankings table), so no new look is designed.

News's results item keeps its words, and its link "All N characters and their standings" goes to
`/season?tab=rankings&season=N`. The record's Seasons rows keep "Season N reveal: finished #P" as "Season N: finished
#P" and link to that season's row.

## 4. An announcement is the character's own Act

**Decided (the owner chose the recommendation, and then "one Act (just a 'louder' Turn)"):** the tally goes. Each
announced debut or Turn writes one Act of a new kind, `announce`, which belongs to the character. It is written in the
season's thread when the change takes effect (at the settlement, or at once for a drop) and says everything its player
chose to make public:

| What the player chose | The line on the board |
|---|---|
| Debut, announced | Spritey debuts. |
| Debut, announced with its class | Spritey debuts as a Heel. |
| Turn, announced | Spritey has Turned. |
| Turn, naming the class it leaves | Spritey has Turned, leaving Heel. |
| Turn, naming the class it Turns to | Spritey has Turned to Face. |
| Turn, naming both | Spritey has Turned from Heel to Face. |

The payload is `{ what: 'debut' | 'turn', was?: <class key>, class?: <class key> }`. Where it names `class`, the class
the character holds from that moment, the Act is that class's verified reveal: `class_reveals` reads it (`via` is the
`what`), the guard that an unmask names the class its character holds checks it too (`0092_card_end.sql:93`), and no
separate `unmask` is written. Its reactions are scored for the character, and it counts in the halving as an unmask does
(`engine/rules/types.ts`, `ActKind`; `engine/rules/settle.ts`). It can be quoted and spun. `turns_announced` reads the
`announce` Acts whose `what` is `turn`, with the old tallies beside them, never edited.

Weighed: the board look design's Boss-signed tally (a list kept by the machine on the board); the glass only (an
announced Turn naming no class would have no presence on the board); two Acts, "Spritey debuts" then "Spritey revealed:
Heel" (one event as two posts, its reactions split).

The owner, on in-thread Turns: "You raise a good point that they are queued. In that case the thread still serves a
purpose, so no change needed." The queue stands. A Turn still lands at the settlement and can be withdrawn until then.
**Instant Turns at a cost** ("giving up the day's earned Aura so far") are #280.

**Order.** Within one landing the Acts are written debuts first, then Turns, each in order of character name and id, as
`masks_change` orders them today, and never by account.

**A retired character.** An announcement owed across a gap to a character that has retired since is not written. A
retired character makes no Act (`0092_card_end.sql:90`), and the log already says that the character retired. Today
the tally names it. That is the one announcement that goes quiet, and its player retired the character.

## 5. The thread is the Promos

**Decided:** the season's thread is listed again on the staff's board (the owner: "in-universe it is like the characters
hyping themselves up so I think it's fine outside the glass in a thread"). Its title is Divided World's
"Season {season}: Promos" (the owner chose it over "Entrances & Turns"), and the engine's key `turnsThreadTitle` becomes
`announcementsThreadTitle`. Only The System writes in it, on each character's behalf. A reply is a spin, as on the rest
of the staff's board.

Season News keeps one item per landing (a settlement or a drop), as a tally was one item. It lists the first 20 names
and a count, and links to the first Act of the landing. Old tallies' items read as before.

## 6. What the rules ask

- **Ways out:** the design adds no state a player, a character or a post can be put in.
- **The masks:** a results row carries what the reveal Acts carry today, and who plays whom is in none of it. An
  `announce` Act carries the character and what its player chose to make public, at the moment the change took effect.
  That is the same timing as the tally it replaces: a scheduled one lands at the window's end, and a drop lands at once.
  Rankings marks the caller's own characters from `myCharacters`, as today. A link with `&character=` names a public
  character. Nothing reads who plays a character.
- **The layers:** all of this is engine. Divided World gives the thread's title, and drops two copy strings.
- **Append-only:** no Act is edited. The old reveal and tally Acts stay as written and are still read.
- **Portable:** `season_results` is a public table and is exported and imported with the rest. The round-trip test
  covers it.
- **At a busy instance:** a season's end writes one row per character (as many rows as the reveal Acts it replaces,
  with no thread and no broadcast per row). A results page reads 50 rows by an index on `(season, place)`. A landing
  with many debuts writes one Act each, where a tally wrote one per 100, and each one broadcasts on its thread. News
  reads at most 20 names per item.

## 7. What it changes in other designs

- The board look design's section 7.2 (the season's Boss signs the reveal and the tallies) and its boards `12-reveal` and
  `13-tally` fall away. The staff's board holds the Boss's posts and the characters' Promos.
- The class reveal design's section 2 ("The tally still names the class") now reads: the announcement names it.
- The alerts design's section 7 (the reveal and Turns threads unlisted): the Promos thread is listed again. Old reveal
  threads stay unlisted.

## 8. Open

Nothing is open. #280 holds instant Turns.
