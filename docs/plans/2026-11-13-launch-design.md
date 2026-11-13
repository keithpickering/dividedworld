# Launch: a new project on invite day, six starter boards, the first staff, and the final clock

Record, written 2026-11-13. A design session with the owner. The plan is `docs/plans/2026-11-13-launch-plan.md`.

## 1. What the live forum showed

The owner asked whether a meeting had happened on the live forum and what was blocking it. Read from the deployed
database on 2026-11-13 at 02:13 UTC:

- **One meeting, closed `off`.** The `kayfabb-meet` job runs daily at 09:23 UTC. Its only row (slot 2026-11-12 09:23)
  closed `off`, because `systemEnabled` is `false` (`instances/divided-world/settings.ts`), and no settings row
  overrides it. Turning the System on is the System plan's Task 13 (`docs/plans/2026-10-30-the-system-plan.md`), which
  had not been done.
- **Season 1's Boss is no longer on the roster.** The open season's Boss is `placeholder-hype-man`. The FanGaME plan
  moved that persona to the test fixtures, and the deployed roster is FanGaME and the placeholder Mod Bot. With the
  System switched on, the meeting would close `failed` with "the season's Boss is not in the instance's roster".
- **The placeholder Bosses are still characters.** Clerk-O-Tron, MEGA-MC 9000 and Sighbot were debuted when the
  project was first seeded, and none is retired. `boss_roster()` (`0082_offices.sql`) seats any unretired persona
  that is not benched, so either could take the seat after the first season.
- **The old board stayed.** The board look plan renamed the staff board to Staff Announcements (`announcements`) on
  the understanding that no instance was deployed. The live project was seeded before that change, so it holds the old
  `the-system` board, with the Updates thread, the announcements thread, season 1's Turns thread and a test thread. It
  also holds the new, empty Staff Announcements board.
- **The playtest clock.** The live functions run with `KAYFABB_PROFILE=playtest`: a three-week season and a seven-day
  Turn cooldown.

The project holds only the owner's tests: 2 accounts, 5 player characters, 91 Acts and 19 threads.

## 2. Decided: launch on a new project, seeded on invite day

**A new Supabase project is built for launch, and the current one stays behind as the test-era record.** The owner
wants a clean "day 1" when the invites go out. Every problem in section 1 is a fact about the test project's data, not
about the code, and a fresh project made from the repository has none of them.

- **Before invite day.** The new project is built by the README's first-deploy steps, with `KAYFABB_PROFILE` unset and
  no seed. On invite day the current project is exported with `tools/export-instance.mjs` and paused. The owner tries the site from a Netlify
  branch deploy whose variables point at the new project.
- **On invite day.** The owner seeds the new project, which opens season 1 at that minute (`seed_instance`, `insert into
  seasons ... now()`). Then the owner adds the Vault entries, points production's Netlify variables at the new
  project, opens the first admin account and sends the invites. Day 1 is the day of the seed, and the owner's own setup
  falls in its first hour.
- **The nightly Release must not seed the new project early.** The release-backend plan
  (`docs/plans/2026-11-12-release-backend-plan.md`) makes the Release push, deploy and seed the project its Environment's
  secrets name. Those secrets keep naming the test project until invite day, when they are pointed at the new one, so
  the export of the test project and its pause also fall on invite day.
- **The README** gains a section, "Relaunching on a new project", holding those steps in that order. They refer to the
  first-deploy steps rather than repeat them.

Alternatives weighed:

- **Patch the live project in place.** Migrations would move the old board's threads to General and merge the board
  away, retire the placeholder personas, re-seat season 1 with FanGaME and restart its clock. That is several one-off
  migrations for a database with nothing worth keeping, and they would leave test history in the forum. Rejected.
- **Reset the current project** (`supabase db reset --linked`). It would keep the URL, keys, Vault and Auth settings.
  But nobody has measured what a reset does to a hosted project's cron jobs, Vault, Auth users and Storage, and no
  session may try it on a deployed project, so the first attempt would be the real one. Rejected for the new project,
  whose path the README already holds and the owner has run once.
- **An admin opens the season.** The seed would open no season, and an admin button would start it. It would let the
  owner seed days early. It adds engine and SQL work and a new "no season open" state with its own way out, to save an
  hour of setup on one day. Rejected.

## 3. Decided: six starter boards, in this order

A generic forum from the 2000s, so that the Boss has ordinary boards to reshape over a season. FanGaME's arc splits
off World -1 and a fangame board, then moves threads and merges whole boards into World -1 (the FanGaME design).
Ordinary boards are what that arc consumes.

| Slug | Name | Description |
|---|---|---|
| `general` | General | Anything and everything. The staff are watching. (unchanged) |
| `video-games` | Video Games | Talk about the games you're playing. |
| `movies-tv` | Movies & TV | What you watched, what you're watching, and what you wish you hadn't. |
| `arts-crafts` | Arts & Crafts | Show off what you made: sprites, drawings, music, writing, anything. |
| `help` | Help | Stuck on something? Ask here. |
| `pointless-post-palace` | Pointless Post Palace | Post about nothing. The more pointless, the better. |
| `announcements` | Staff Announcements | Where the staff post. Reply by spinning a thread. (unchanged) |

The descriptions are drafts for the owner's approval in review.

**The board index shows them in this order.** `index_page()` (`0326_board_stubs.sql`) orders boards by `created_at`,
then `id`. `seed_instance` (`0332_arcs.sql`) inserts every board in one statement, at one `now()`, so the seeded
boards would show in the order of their random ids. The seed changes so that each board it inserts is created one
microsecond after the one before it, in the instance's order. A board the System creates later has its own, later
time and follows them, as it does today. A reseed inserts nothing that is already there, so it reorders nothing.

Weighed: a `position` column on boards, which an admin could change. Rejected for now: nothing in the design asks
an admin to reorder boards, and the System's boards already take their place by creation time.

## 4. Decided: the first staff

- **The roster, in order:** FanGaME, ONTOPIC 5.0, QC-1000. `seed_instance` keeps the roster's order as the setting
  `bossRoster` (`0051_succession.sql`), and `boss_roster()` lists it first.
- **FanGaME** is the first Boss, as before.
- **The two Mod Bots on staff from the start** (`firstStaff`) are ONTOPIC 5.0 and QC-1000.
- **The placeholder Hall Monitor leaves the roster.** Its file moves to `instances/divided-world/system/fixtures/`
  beside the placeholder Bosses, since `placeholderWorld()` and the staff tests still use it.
- **QC-1000** comes from PR #444's draft (`instances/divided-world/system/personas/mod-bots/quality-control.ts` on that
  branch), brought up to main's shape: the prompt goes in `selfPrompt`, built by `persona()` with one argument. His
  beats become `video-games` and `arts-crafts`, and the rest of the draft stands. The other seven drafts in #444 stay
  drafts.
- **ONTOPIC 5.0** is new, written from the owner's notes. She is a Yelp reviewer of forum posts. She rates every post
  from zero to five stars, shown as icons, in a review-shaped critique: pretentious but constructive, a compliment
  sandwich with acid in the middle, and nobody can tell if the acid is on purpose. She cares only whether a post is on
  topic, never about settling a quarrel, and is annoyed when asked to. She sees herself as a genius burdened by idiots
  who does her best to be polite, and she is always helping, though nobody is sure with what. She starts on the
  Pointless Post Palace, where a five-star post is a truly pointless one. Her pronouns are she/her. Every string in
  her file is a draft for the owner's approval in review, given in full in the plan's Task 3.
- **The Splitter** was weighed and set aside: her premise (a bot that carries out The Split) would clash with FanGaME's
  Split arc.

**#434 is answered: keep the code.** A successor may come from any office. When FanGaME's season ends and he has named
no one, the rotation passes over him (`rosterRecentExcluded`) and seats ONTOPIC 5.0, the next persona in
`bossRoster`. If she is excluded too, QC-1000 follows. The owner's words: the Mod Bots "can work the beat and take
over automatically after the arc if nothing else is planned by then". A season-two arc written later for ONTOPIC 5.0
plans what she does. Until then she runs as every persona does without an arc. Section 6 of the FanGaME design, which
said a one-Boss roster leaves the outgoing Boss in place, is a record and stays as written. This design corrects it.

## 5. Decided: the clock

| Setting | Was | Now | Why |
|---|---|---|---|
| `settlementCron` | `17 8 * * *` | `0 10 * * *` | Aura is settled overnight and waiting in the morning: 5am ET, 2am PT, 10am UK, 11am CET (an hour earlier in local time under daylight saving, since cron is UTC) |
| `meetingCron` | `23 9 * * *` | `0 11 * * *` | An hour after the settlement, as before, so the Boss's digest holds the newest standings and its moves are queued by breakfast in North America |
| `seasonLength` | 3 months (playtest: 3 weeks) | 3 months | The length the phases and FanGaME's arc were written for: a two-week honeymoon, about seven weeks of reign, a three-week meltdown |
| `turnCooldown` | 30 days (playtest: 7) | 21 days | About four Turns a season: rare enough to mean something, and a bad pick is not stuck for a month |
| `systemEnabled` | `false` | `true` | The System plan's Task 13. The screens that show a move's way out (its Task 12) are merged |

The owner asked for the settlement at a round time rather than the jittered minute it had. The jitter was there to keep
the hourly view count (`:41`) off the settlement's minute, and the new times stay clear of it.

**The playtest profile stays** (`playtestOverrides`, `KAYFABB_PROFILE=playtest`) for rehearsals and any test project.
The launch project runs without it.

**Every other timing keeps its current value**, listed here so that the owner can change any of them in the plan's
review: `chatterCron` 17:37 UTC; `settlementLength` 1 day; `setLasts` 7 days; `reachLasts` 7 days for a character, 3 for
a thread, 1 for a board; `inviteLifetime` 7 days; `editGrace` 2 minutes; the warn bar's decay 14 days and bans of 1, 3
and 7 days; `structuralHoldHours` 24; `inheritanceGraceDays` 3; `farewellWindowHours` 36; `movedStubDays` 7; phases
14-day honeymoon and 21-day meltdown; `moveExpiryMostDays` 42; apology every 24 hours; a Mod Bot's visits 2 to 12
hours (each persona narrows its own); the hint window 6 hours; presence 5 minutes.

## 6. Open

- **Where real site problems go.** The Help board is in the game: the Mod Bots patrol it like any other board, and what
  is posted there is in character. A player with a real problem (a bug, an account) needs a plain route out of the
  fiction ("The fiction may lie; the log never does"). Whether the admin contact page already serves, or Help needs a
  line pointing to it, is left for the owner.
- **ONTOPIC 5.0's season as Boss.** She has no arc. One is written before FanGaME's season ends, or she runs without
  one.
- **The test project after launch.** It is paused once exported. Whether to delete it is the owner's call later.

## 7. The masks, the layers, the ways out

- **The masks.** Nothing here adds a response, payload, event or timing. The board order is the instance's, and the
  roster is the instance's content.
- **The layers.** Engine: none. SQL: `seed_instance` gives the boards it seeds their order. Instance: the boards, the
  roster, two personas, and the settings. The runbook is the owner's (README).
- **Ways out.** No new state. The staff ONTOPIC 5.0 and QC-1000 join carry the ways out every Mod Bot's visits,
  filings and appeals already have (the Mod Bots design).
