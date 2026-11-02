# Alerts, Updates and the season page: plan

Record, written 2026-11-02. Carries out `docs/plans/2026-11-02-alerts-design.md` (its sections are cited as §N). The
boards are `docs/research/2026-11-02-alerts/`; a glass screen matches its board, and where a board and the design
disagree, the design wins on what is decided and the board on how it looks. Closes #81, and #140's F2, its target-line
item and its live-feed item. #140's other items are not in this plan.

Every task is test first: the test named, its red run recorded, then the code, then the green run. No task adds a
check (`tools/check-*.mjs`), so no poison is planted for one; each SQL task's red run is its own assertion file failing
before its migration exists. Migrations are numbered from `0056`, SQL assertion files from `0061`
(`tools/test-sql.mjs`). Each task is engine unless it says instance.

## Task 1. The log names a play's place (#140 F2; §9)

**Layer:** engine (SQL and `engine/ui/log/`).

**Migration `0056_plays_on_mine.sql`:**
- Re-define the view `my_posts_played_on` (current in `0055_card_reach.sql:559`) so it no longer filters to
  `reach = 'post'`. It becomes the plays on anything of the caller's: a post one of their characters wrote, one of their
  characters (`play_reach.character`), or a thread one of their characters started (`play_reach.thread`, the thread's
  seq-1 Act's author). Each row gains `reach` and its target's public name as of the play (from the play's payload, or
  the target's row at the play's time). A play by one of the caller's own characters is left out, as the log already
  leaves it out for posts.
- Board plays have no owner and are not rows here.

**`engine/ui/log/lines.ts`:**
- `actLink` (line 121) and the played, caught, wardEnded and setEnded rows (`cardRows`, line 298; `setEndRows`, line
  412) name a play's target by its reach, read from `play.payload.reach` and `payload.character|thread|board`, as
  §9's table words them. A post target keeps today's words.
- The `onMine` row (line 384) gains the character and thread reaches' words: "Glitter Bomb was played on Gloomba",
  "Main Event was played on 'Thwomp appreciation'".
- `PlayOnMine` (`engine/ui/data/api.ts:593`) gains `reach` and `targetName`; `web/src/data/supabase.ts:916` reads them;
  `engine/ui/data/fake.ts` serves them.

**Tests first:**
- `engine/ui/log/lines.test.tsx`: a character play's caster rows ("You played Glitter Bomb on Gloomba", "Glitter Bomb on
  Gloomba ended"); a board play's ("on the Hobbies board"); a thread play's; the target's player's rows for a character
  and a thread play; no row names a caster. Red today: the words say "post".
- `supabase/tests/0061-plays-on-mine.sql`: a character play and a thread play are rows for the target's player and
  carry their reach and name; a board play is no one's row; the caller's own masks' plays are not rows; another
  account reads none of them.

## Task 2. The account's two marks (§4)

**Layer:** engine.

**Migration `0057_account_marks.sql`:** `account_preferences` (`0019_profiles.sql:22`) gains `alerts_seen_at
timestamptz` and `settlement_seen timestamptz`. Two functions, each the caller's own and only ever moving forward:
`see_alerts(at timestamptz)` and `see_settlement(ends_at timestamptz)`. They are preferences, not Acts; nothing here
touches an Act.

**Code:** `engine/ui/log/Settlement.tsx` reads and writes the account's mark in place of `kb-settled-seen:<account>`
(`seenKey`, line 41); the device key is no longer read or written. `Preferences` (`api.ts:490`) carries both marks;
`KayfaApi` gains `seeAlerts(at)` and `seeSettlement(endsAt)`, in `supabase.ts` and `fake.ts`.

**Tests first:**
- `engine/ui/log/Settlement.test.tsx`: the summary seen on one device is not shown on a second (two players sharing a
  fake account). Red today: the mark is per device.
- `supabase/tests/0062-account-marks.sql`: each mark only moves forward; another account can neither read nor move it.

## Task 3. Alerts written with their Acts (§2, §10, §11)

**Layer:** engine (SQL, `engine/rules/alerts.ts`).

**`engine/rules/alerts.ts`** (pure): `AlertKind`, the catalog's keys: `quote`, `cardOnYours`, `trapStruck`,
`trapSprang`, `settlement`, `hint`, `followed`, `update`, `seasonNews`, and `ruling` with a sub-key each ruling's build
adds. Which kinds are written (stored), which are derived when read, and which every player gets.

**Migration `0058_alerts.sql`:**
- `alerts(id bigint identity, account uuid not null references accounts, kind text not null, sub text, act uuid not
  null references acts, character uuid references characters, at timestamptz not null default now())`, insert-only,
  indexed on `(account, at desc)` and `(act)`. Row-level security: select `account = auth.uid()`. No grant of insert,
  update or delete to any API role, and no publication (`supabase/tests/0014-realtime.sql` already fails on a table
  with an account column in one). It holds no content: each row points at the public Act it is about.
- `write_alert(owner_of_character uuid, kind text, sub text, about uuid)`, called inside the writers, writes one row for
  the character's owner, none for a staff character or a character the acting account owns. It also queues one
  broadcast on `account:<owner>` (`broadcast_later`, `0007_seasons.sql:113`) carrying the alert's public projection.
- The writers that call it:
  - `post` (current `0054_card_plays.sql:586`): when `quoting` is set, `quote` for the quoted Act's author.
  - `play_card` (current `0055_card_reach.sql:213`): `cardOnYours` for the target post's author, the target character,
    or the target thread's starter; none for a board.
  - `spring_traps` (as current): `trapStruck` for the struck post's author, `trapSprang` for the setter.
- The settlement is not written: it is derived when read (Task 5), one per settlement whose rows touch the caller's
  characters.

**Tests first:** `supabase/tests/0063-alerts.sql`:
- A quote, a card on a post, on a character and on a thread, a trap struck and a trap sprung each write one row for the
  right account and queue one `account:` broadcast.
- A board play writes none; a play on a staff character writes none; a play by the caller's own other mask writes none.
- The caster's answer from `post` and `play_card` is the same projection, field for field, whether the target's
  character is owned by another account, by a staff row or by the caster; and it never contains the alert.
- Another account reads no row; no API role can insert, update or delete one.

## Task 4. Follows (§4)

**Layer:** engine.

**Migration `0059_follows.sql`:**
- `thread_follows(account uuid, thread uuid, follow boolean not null, at timestamptz, primary key (account, thread))`,
  the caller's choice over the default; row-level security on the caller's own rows. A preference, not an Act.
- `follow_thread(in_thread uuid, on_ boolean)`.
- The view `my_followed_threads`: the threads the caller follows (the threads a character of theirs started, unless
  unfollowed, plus the ones they chose), with the count of posts past their `reading.furthest_seq`
  (`0018_reading.sql:16`) by characters they do not own, and the newest such post's time; only threads with a count
  above nought; at most 50, newest first.

**Code:** `KayfaApi.follow(thread, on)` and `followed()`; a Follow and Unfollow control on the thread page, in the glass
(the thread page's own control strip), and Unfollow on the Alerts row (Task 9).

**Tests first:** `supabase/tests/0064-follows.sql`: a thread started is followed by default; unfollowed, it is not;
followed by choice, it is; reading a thread to its end clears it; posts by the caller's own other masks are not
counted; another account reads none. A query plan check that `my_followed_threads` for an account with 500 followed
threads reads by index, as `0060-card-reach.sql` checks its reads.

## Task 5. The Alerts read and the count (§4, §11)

**Layer:** engine.

**Migration `0060_alerts_read.sql`:**
- `my_alerts(before timestamptz default null, most int default 30)`: the union, newest first, of the caller's written
  alerts (Task 3), their followed threads with new posts (Task 4), the settlements that touched their characters, and
  every player's news: updates (Task 7) and season news (Task 8). Each row: `kind`, `sub`, `act`, `character`, `at`,
  and the public words' inputs (the target's public name, a count).
- `my_alerts_unread()`: how many of the above are newer than `alerts_seen_at`, read with a bound of 10 (shown "9+").

**Code:** `KayfaApi.alerts(before?)`, `alertsUnread()`; types `Alert` and `AlertKind` (from `engine/rules/alerts.ts`).

**Tests first:** `supabase/tests/0065-alerts-read.sql`: each source appears once with its kind; the count moves when
`see_alerts` moves; a followed thread read to its end leaves the list; the count stops at its bound; a plan check that
the read is index ranges at an instance seeded with 10,000 alerts for one account and 100,000 for others.

## Task 6. The private channel, and plays beyond a post live (§8, #140's live item)

**Layer:** engine (SQL, `supabase/functions/`, `web/src/data/`).

**Migration `0061_account_channel.sql`:** a second policy on `realtime.messages` (beside `0008_realtime.sql`'s):
select where `realtime.topic() = 'account:' || auth.uid()`; and the topic `reach`, which every signed-in player hears.

**`supabase/functions/act/`:**
- After every write, whether or not it queued anything, the function drains `due_broadcasts` (`0007_seasons.sql:120`)
  and sends them, after the answer (`EdgeRuntime.waitUntil`, `act/index.ts`), so the answer and its timing never
  differ with what was queued. Drained rows are marked with `broadcasts_sent`.
- `BROADCASTS.play_card` (`act/core.ts`) also sends a play beyond a post as `effect` on `reach`, the public projection
  only, so a page showing that character, or a board's banner, hears it.

**Code:** `KayfaApi.subscribeAccount(listener: { onAlert })` and `subscribeReach(listener: { onPlay })`, in
`web/src/data/supabase.ts` (beside `subscribeThread`, line 1008) and `fake.ts`. The thread page and the board banner
subscribe to `reach` and keep a play whose target they show.

**Tests first:**
- `supabase/functions/act/core.test.ts`: the answer to a quoting post is sent before the drain starts, and it is the
  same whether the drain finds an alert or nothing.
- `supabase/tests/0066-account-channel.sql`: a listener for another account's topic is refused; one's own is allowed.
- `engine/ui/thread/` and `engine/ui/board/` tests: a character play arriving on `reach` draws on a page showing the
  character in another thread; a board play draws on the board's banner.

## Task 7. Updates (§3, §6)

**Layer:** engine, and instance for the persona.

**Migration `0062_updates.sql`:**
- `characters.staff_kind` allows `'developer'` (`0043_staff.sql`). `seed_instance` (current `0055_card_reach.sql:814`)
  seeds the developer from the seed's `developer` entry (name, avatar), and opens the updates thread on The System's
  board, recorded in the setting `updatesThread`, as it opens the announcements thread (`systemAnnouncements`).
- Act kind `update`, written only by `post_update(title text, body text, changes jsonb)`, callable by an admin
  (`is_admin`), as the developer character. Its payload: title, body, changes (a list of `{ label, text }`).
- `thread_list` (`0030_screens_reads.sql:161`) never lists the updates thread. `updates(before, most)` reads it.
- Reactions to an update pay no one: `is_staff_side` (`0043_staff.sql:181`) already counts a staff Act; the test holds
  it for the developer kind.

**Code:**
- `engine/ui/updates/Updates.tsx`, `updates.css`, `Updates.test.tsx`, `Updates.board.stories.tsx`: the page as board
  `03-updates.html` draws it. React reacts as the HUD's character; Spin a thread uses the existing spin flow with the
  update as the origin.
- An admin's Write an update form in `engine/ui/admin/`.
- `GLASS_NAV.updates = '/updates'` (`engine/ui/glass/nav.ts`); the route in `web/src/App.tsx`.
- **Instance:** `instances/divided-world/` seeds the developer as Gabe, with its avatar and the tagline "Made this.
  Sorry."; the engine's default seed names it "The developers".

**Tests first:**
- `supabase/tests/0067-updates.sql`: only an admin can post an update; it is an Act of kind `update` by the developer;
  the board never lists its thread; reactions to it are in no settlement's input; a spin from it opens a board thread.
- `engine/ui/updates/Updates.test.tsx`: the page renders the persona, headline, prose and changes list; React and Spin
  work; the reaction chips are glass.

## Task 8. The season page (§7)

**Layer:** engine.

**Migration `0063_season_news.sql`:**
- `season_news(before, most)`: newest first, the reveal's header Act (with the top three and their classes), each
  tally's debuts and Turns, and the Boss's arrival and departure (from `staff_changes` and `season_handovers`,
  `0051_succession.sql:386`), each with its Act to link.
- `thread_list` no longer lists the season reveal threads and the Turns threads on The System's board; a link to one
  still opens it. No Act is edited.

**Code:**
- `engine/ui/season/Season.tsx` with tabs Rankings (today's `RankingsScreen`, `engine/ui/rankings/Rankings.tsx:151`,
  unchanged inside) and News, as board `04-season-news.html` draws it.
- `GLASS_NAV.season = '/season'`; `/rankings` and `/standings` go to it (`?tab=rankings`).
- `engine/ui/standings/` is removed, and every link to `/standings` (profiles, the index) goes to the season page.
- The menu's Rankings tab becomes Season (`engine/ui/glass/MenuBar.tsx:39`).

**Tests first:**
- `supabase/tests/0068-season-news.sql`: each news kind appears once, from the Acts already written; the reveal and
  Turns threads are not in The System's board's list and still open by id; the player's own characters are not marked
  by the server (the client marks them, as Rankings does).
- `engine/ui/season/Season.test.tsx`: both tabs; the player's own characters marked "yours" in the results.

## Task 9. The Alerts page and the menu (§4)

**Layer:** engine, and instance for words.

**Code:**
- `engine/ui/alerts/Alerts.tsx`, `alerts.css`, `Alerts.test.tsx`, `Alerts.board.stories.tsx`: as board `02-alerts.html`
  draws it: filters (All and each character), the "new since you last looked" divider at `alerts_seen_at`, then
  Earlier; each row an icon in its kind's ink, the line, its link or way out, the character, the time. Cards on one
  target among the new rows are batched into one row ("Glitter Bomb and 2 more on your post"). Opening the page calls
  `seeAlerts` with the newest row's time.
- `engine/ui/alerts/words.ts`: each kind's line and detail from the row, in the engine's plain words, with the
  instance's words where the instance names a thing (hints, the season's copy).
- The menu: Alerts after Back, Season in Rankings' place, Updates before Settings (`MenuBar.tsx:39`, `nav.ts`); the
  route in `web/src/App.tsx`.

**Tests first:** `engine/ui/alerts/Alerts.test.tsx`: the divider sits at the mark; each kind renders its words and its
link; cards batch per target; a filter shows one character's; opening moves the mark; nothing names a caster or a
reactor.

## Task 10. The HUD's Alerts button and the toasts (§8)

**Layer:** engine, and instance for the toast defaults.

**Code:**
- `engine/ui/frame/Hud.tsx`: an Alerts link with the bell and the count (`alertsUnread`, refreshed on each page read
  and on each `onAlert`), on the desk layout above Hand beside the clock, on the phone a bell between Posting as and
  Menu (board `01-board-toasts.html`, `05-phone.html`). On the phone, Menu shortens to its glyph if the row would cut
  the character's name.
- `engine/ui/alerts/Toasts.tsx`: the column, at most three, then "+N more"; Motion (`motion/react`) for the slide and
  fade; about six seconds each, paused while hovered or focused; a polite live region; reduced motion appears and
  leaves without moving. While the hand is open, toasts wait.
- Only the kinds the player keeps on (Task 11) toast; every alert still counts.

**Tests first:** `engine/ui/alerts/Toasts.test.tsx`: three show and the rest fold into "+N more"; a hovered toast
stays; dismiss removes it; reduced motion renders no transform; nothing toasts while the hand is open, and it rises
when the hand closes; a kind turned off does not toast but counts. `engine/ui/frame/Frame.test.tsx`: the count and its
bound.

## Task 11. Settings › Notifications (§8)

**Layer:** engine, and instance for the defaults.

**Migration `0064_toast_kinds.sql`:** `account_preferences.toasts text[]`, null meaning the instance's defaults;
`set_preferences` (current `0040_cards_met.sql:18`) takes it.

**Code:** `engine/ui/account/Settings.tsx` gains the Notifications section (`Section`, line 52; `SECTIONS`, line 53),
one switch per alert kind, in plain words. **Instance:** the defaults (§8) in `instances/divided-world/settings.ts`.

**Tests first:** `engine/ui/account/Settings.test.tsx`: the section lists each kind with its default; a change saves
and is read back.

## Task 12. Hints (§5)

**Layer:** engine (`engine/rules/hints.ts`, SQL, `act/core.ts`), and instance for thresholds and words.

**`engine/rules/hints.ts`** (pure): `hintFor(window: QuadrantCounts, settings: HintSettings, card?: { cardCount,
postCount })` returns at most one pattern: `leading:<quadrant>`, `divisive` or `thunder`, or none. `HintSettings`
(`least`, `share`, `split`, `window`) joins `Settings` (`engine/rules/types.ts:45`).

**Migration `0065_hints.sql`:** `hints_fired(act uuid, pattern text, primary key (act, pattern))`;
`fire_hint(about uuid, pattern text)`, service only, inserting once and, on the first insert, calling `write_alert`
for the Act's author with kind `hint`. `act_window_counts(about uuid, since timestamptz)`: the public per-quadrant
counts in the window.

**`supabase/functions/act/core.ts`:** after `react` and `play_card`, read the window's counts for the Act reacted to
(and, for a card, the post it is on), run `hintFor`, and call `fire_hint` when it names a pattern, all after the answer,
in the drain of Task 6.

**Instance:** the thresholds in `instances/divided-world/settings.ts`; each pattern's words in its UI copy
("Your post is picking up heat", and the rest).

**Tests first:**
- `engine/rules/hints.test.ts`: each pattern at and below its threshold; leading against divisive when both could
  apply (divisive wins); thunder only for a card.
- `supabase/tests/0069-hints.sql`: a pattern fires once per Act; it goes to the author's account and to no other; a
  staff Act's author gets none.

## Task 13. The rule and the boards

**Layer:** documents and e2e.

- The e2e board checks (`e2e/boards/`, as the glass-to-the-boards plan holds a build to a board) gain the Alerts,
  Updates and Season News pages and the HUD with toasts, against this design's boards.
- The two-worlds design is a record and is not edited; this design says what it revises.

## Review focus

- **The masks:** any path where an alert's existence, its content, the caster's answer or its timing differs with who
  owns the target, including the local runtime with no `EdgeRuntime`, where the act function awaits its sends.
- **Acts already written:** the reveal and tally threads leaving The System's board's list, the reveal's Acts read by
  the season page, and `my_posts_played_on`'s new rows over plays made before this change.
- **A busy instance:** `my_alerts` and `my_alerts_unread` on every HUD load, `my_followed_threads` for a player who
  follows hundreds of threads, and the drain after every write.
- **A second run or a retry:** a write sent again after a timeout writing its alert twice; a hint firing twice.
- **The developer persona** reaching anything a model writes, or any plain screen.
