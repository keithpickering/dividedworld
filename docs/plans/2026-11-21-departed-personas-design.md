Record, written 2026-11-21.

# A persona that leaves the roster leaves the staff: design

A design session for issue #938, with the owner. Its plan is `docs/plans/2026-11-21-departed-personas-plan.md`. The
owner wants it built before The System is switched on for Divided World's test instance (dw.gripe), and ahead of the
quiz redesign that the same conversation began.

## 1. What is stuck

An instance's roster lives in its content (`instances/divided-world/system/index.ts`, `roster`). The database learns it
from the seed: `seed_instance` (latest in `supabase/migrations/0397_refund_outcome.sql`) makes a staff character for each
persona whose key it has not seen, and does nothing to a persona the roster no longer lists. Divided World moved its three
placeholder Bosses out of the roster into test fixtures, and the deployed database still holds them as live staff:
debuted, not retired, not benched.

- `boss_roster()` (`0082_offices.sql`) reads the database's persona characters, with the `bossRoster` setting ordering
  them, so it still answers all five. The nomination, the rotation and `nameSuccessor` all draw from it.
- Season 1's Boss is `placeholder-hype-man`. `meet` refuses a Boss missing from the instance's roster
  (`supabase/functions/meet/core.ts`, "is not in the instance's roster"), so no meeting runs while the switch is on, and
  an appeal of a ban, heard by the Boss, fails too (`supabase/functions/staff/appeal.ts`).
- At the roll-over, the rotation can seat another departed persona, and the same failure starts over.
- Nothing leads out: no seed, screen or function retires a persona that left the roster or replaces a season's Boss.
  `set_office` refuses the Boss's office ("changes at the handover"), and no screen calls it.

## 2. Leaving the roster benches the persona (decided)

The seed's roster is the whole staff. A persona character in the database whose key the seed's roster does not list,
and that is not already benched by a seed, is **departing**: the seed writes it a `benched` office row, cause `seed`.

Alternatives weighed with the owner:

- **Benched by the seed (chosen).** It uses a state that already exists, with every road already shut to it:
  `write_staff_act` refuses a benched persona, `boss_roster()` leaves it out, and chatter, patrols and filings already
  skip a persona the roster lacks. Its character, profile, posts and history stay. The office log stays the one list of
  who holds what, so no second roster list is stored ("Two lists that must agree are one list").
- **A new `departed` office.** Clearer in the log, but a new state in every read of an office, for a difference the
  office row's cause already records.
- **Left a member.** A member with no persona file has no voice, so it would be silent anyway while still counted as a
  candidate where a read forgets to check the roster.

What follows from it:

- **Its way out.** A later seed that lists it again writes `member` (cause `seed`), or `mod` where the seed's
  `firstStaff` names it. That is the only door back: `set_office` refuses to move a persona whose latest office row is
  `benched` with cause `seed`, saying it left the instance's roster and a seed that lists it brings it back. An admin's
  own bench (cause `admin`) is unbenched by `set_office` as today.
- **A waiting persona** (never debuted) that leaves the roster is departing too. It never spoke, but it is a candidate:
  `boss_roster()` (as 0082 left it) keeps every persona whose office now is not `benched`, waiting ones included, since a
  handover debuts the Boss it seats. The seed writes it the same `benched` row, cause `seed`, and does not debut it;
  `staff_office_now` still shows it `waiting`, since an undebuted persona reads `waiting` whatever its rows say. So
  `boss_roster()` changes to leave out every persona whose latest office row is `benched`, whatever `staff_office_now`
  shows. A later seed that lists it again writes `member` (cause `seed`), which clears the bench and leaves it waiting.
- **The staff is never empty.** If no Mod stands once the departing are benched and the Boss is handed over (section 3),
  the seed hires each persona in `firstStaff` that is in the roster, not the season's Boss and not a Mod, as `mod`
  (cause `seed`). If that still leaves no Mod, the seed refuses (below).

## 3. A departing Boss hands over at once (decided)

When the open season's Boss is departing, the seed runs an **early handover** in the open season. In order: it benches
the other departing personas, so the succession cannot seat one; it hands over; then it benches the outgoing Boss.

Alternatives weighed with the owner:

- **Early handover (chosen).** The season goes on: its end date, standings, Aura and everything players hold are as they
  were. `hand_over` (latest in `0365_handover_withdraws.sql`) already does what a change of Boss needs: a standing
  nomination, else the rotation; the new Boss's bank from zero; the outgoing Boss's farewell (or the stock line) and the
  arrival line in the announcements; the outgoing Boss's waiting moves withdrawn; the season news and the admin's to-do.
  The new Boss reviews the board moves it inherits, as after a roll-over (`inheritance_due`, by `move_owner`).
- **End the season early.** The least new code (the reveal and the roll-over exist), but a change to an instance's
  content would cut the players' season short.
- **Refuse the seed.** Simple, but it forces the content to keep a persona it removed until the roll-over, and on
  dw.gripe it would run meetings as a test fixture for days.

What follows from it:

- **One handover row per handover.** `season_handovers` is keyed by season today, and about a dozen reads assume one row
  per season (the plan, Task 1, names each at its latest definition). It gains an `id` key; `season` is no longer
  unique; a new column `cause` says `rollover` or `departure`, and `how` keeps saying how the seat was filled
  (`nomination` or `rotation`), so the two facts stay apart. A read that means "the handover that opened this season"
  reads the season's `rollover` row; a read that means "how the sitting Boss came to sit" reads the season's latest.
  `handover_dismissals` is keyed by the handover's id, so each to-do is dismissed on its own, and
  `dismiss_handover_todo` takes the handover's id.
- **A departure never falls back.** A roll-over's `hand_over` leaves the outgoing Boss seated when neither the nomination
  nor the rotation can seat anyone. A departure refuses instead (below), since the outgoing Boss has no persona file.
- **The farewell before the bench.** The outgoing Boss's farewell is posted inside `hand_over`, before the seed benches
  it, since a benched persona writes nothing. Its farewell is the one it wrote at its last meeting where there is one
  (`say_farewell`), else the stock `bossFarewell` line.
- **The departing Boss's season.** For a roll-over the outgoing Boss served the season before the handover's; for a
  departure, the handover's own season. Every read that finds the outgoing Boss's handoff note and facts (the to-do,
  `predecessor_handoff`, the season news's `bossLeft`) reads that season, not "the season before".
- **The inheritance grace.** The tick ends an inherited board move `inheritanceGraceDays` after
  `greatest(landed_at, season_start)` (`system_tick`, latest in `0334_meeting_bundles.sql`). After a mid-season handover
  that is already past for any move older than the grace, so the new Boss's review would be pre-empted at the first
  tick. The clock counts from the latest handover's `landed_at` in the open season (the season's start where it has
  none), so a departure gives the new Boss the same grace a roll-over does.
- **When no Boss can take the chair.** If no persona in `boss_roster()` other than the outgoing one can be seated
  (after the other departing personas are benched), the seed refuses, writing nothing: "the open season's Boss <key>
  has left the roster, and no Boss in it can take the chair". The seed answers 422 with that reason and the release goes
  red until the instance's content names a Boss. `hand_over`'s own fallbacks (leaving the outgoing Boss seated) would
  otherwise leave a Boss with no persona file seated for the rest of the season, which is the dead end this design
  closes.

## 4. What players and admins see

- **In the fiction:** the outgoing Boss's farewell and the new Boss's arrival in the announcements, as at a roll-over.
  The departed Mods and members just go quiet. Nothing in character says why: the bluff is free to explain it.
- **The log and the glass speak plainly.** The admin queue's to-do for a departure reads "<Boss> takes over Season N
  from <outgoing>." with the facts line "<outgoing> left the instance's roster and is now benched.", then how the seat
  was filled, as for a roll-over (the plan, Task 3). The words are the plan's and the owner's to approve in review.
- **The season news** shows a departure's `bossLeft` and `bossArrived` in the season it happened.

## 5. Layers, masks, ways out, scale

- **Layers.** All engine: SQL, the seed's refusal mapping, the admin copy, the API types and the fake. No instance file
  changes; Divided World's roster already lacks the three fixtures.
- **Masks.** Personas have no owners. A handover, an office and the announcements are public already. Nothing here reads
  who owns a character, a class or who reacted.
- **Ways out.** Benched by the seed: a seed that lists it again. A departing Boss: the early handover, else the seed's
  refusal, which an operator answers in the instance's content. Nothing a player does can put anything in a new state.
- **Scale.** The seed's added work grows with the staff roster (a handful of personas), never with players, characters,
  threads or Acts. The reads that change keep their indexes; the to-do and news reads go from one row per season to one
  per handover, a few more rows per instance's lifetime.

## 6. On dw.gripe

The first release after the build benches `placeholder-clerk`, `placeholder-sighbot` and `placeholder-hype-man`, hands
season 1 from `placeholder-hype-man` to `fangame` (the rotation, as no nomination stands), and leaves `placeholder-monitor`
as the Mod. Then `systemEnabled` is switched on, and the first tick, staff run and meeting are watched.

## 7. Open

- Whether a departure should leave a public, plain mark beyond the announcements (a line on the departed persona's
  profile, say). Not needed to close #938; nothing in the rules asks for it.
- An admin screen for `set_office` does not exist. Out of scope here.
