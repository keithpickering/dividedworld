Record, written 2026-11-22.

# The staff's threads follow the system board: design

A design session for issue #983, with the owner. Its plan is
`docs/plans/2026-11-22-system-threads-follow-the-flag-plan.md`. It closes the gap that the Strategy Guide's new
"## The staff" section exposed on the test instance (#976, merged in #974): "The staff have a board of their own, Staff
Announcements" was untrue there.

## 1. What happens today

The instance places three kinds of thread on its system board (the board with `is_system`, `system_board()` in
`0013_system_board.sql`):

- **The announcements thread.** `seed_instance` (latest `0406_seed_board_order.sql`) opens it once, on `system_board()`,
  and records it in the setting `systemAnnouncements`. A landed move, a move's end and the Bosses' farewells and
  arrivals are posted there, and board cards are played in it.
- **The Updates thread.** The seed opens it once, beside the developer, and records it in `updatesThread`. Thread lists
  never show it; the seed netted it out of the board's thread count by hand.
- **Each season's Turns thread.** Opened on `system_board()` the first time a season needs it (latest `0100_announce.sql`)
  and recorded in `seasons.turns_thread`.

Once made, none of them moves. A thread's board is derived already: `thread_place()` and `thread_places_computed()`
(latest `0323_moved_in_goes_back.sql`) compute it from where the thread was opened (`origin_board`) and the lasting
moves in force, and `rebuild_thread_places()` (latest `0339_thread_places_at_scale.sql`) writes `threads.board` where
the two differ. When an instance's content makes another board the system board, the seed moves the flag, and the
three kinds of thread stay on a board that is now ordinary.

On dw.gripe, "Announcements From The System", "Updates" and "Season 1: Who Turned" sit on `the-system`, an ordinary board
since Staff Announcements took the flag. Players can post in them, since `not_the_systems(board)` refuses posting only
on the system board, and every staff line of the 2026-11-22 handover went there.

## 2. Decided: the staff's threads follow the flag

**Rule.** A thread the instance places on the system board lives on the system board, wherever it was opened. The
instance-placed threads are the one `systemAnnouncements` names, the one `updatesThread` names, and every season's
`turns_thread`, past seasons included.

Alternatives weighed with the owner, on how they get there:

- **Derived, by a rule in the placement (chosen).** `thread_place()` and `thread_places_computed()` place an
  instance-placed thread at `system_board()` before any move is read, and the seed rebuilds those threads' places
  after it moves the flag. One continuous thread, with its whole history. No Act is written and no stub left, because a
  thread's board is derived already ("Append-only"). Any later change of system board, back or elsewhere, is handled
  by the same rule.
- **A new thread, with the old one kept.** The seed opens fresh threads on the new system board and repoints the
  settings. History splits in two, and the old Updates thread, which lists hide only while a setting names it, would
  start showing in lists.
- **A `moveThread` Act with a "Moved:" stub.** The most visible, but someone has to author the Act. The move machinery
  has no seed-authored or developer-authored move, and a Boss's move is a model's decision.

And on which threads (the owner): all instance-placed threads, every season's Turns thread included, rather than only
the settings' threads or only the open season's. Past seasons' records stay with the staff's.

What follows from it:

- **The rule wins over a move.** A `moveThread` naming an instance-placed thread places nothing. The meeting's offer and
  repair of a `moveThread` (latest `0403_departed_personas.sql`) refuse one, if they do not already.
- **Posting follows the board.** Back on the system board, the threads refuse a player's post again through
  `not_the_systems`. The staff, the Turns machinery and board cards write there as they always have.
- **The counts.** `board_thread_counts` never counts a thread on the system board (the insert trigger, latest
  `0339`), and `rebuild_thread_places` leaves system boards out of its deltas. But threads made before 0339 were counted,
  and the Updates thread was netted by hand. So when the flag moves, the seed sets both boards' counts (the one that
  lost the flag and the one that took it) from their rows, after the rebuild, by the same rule thread lists use.
- **Idempotence.** A reseed with no change of flag rebuilds nothing and writes nothing.

## 3. Out of scope, filed

- **The old board itself.** A board the content drops stays an open, ordinary board. On dw.gripe, `the-system` keeps
  "Regular forum now" after this change. That is #985, filed the same day: the board counterpart of #938's personas.
- **The rest of the guide's "The System" wording.** That is the Gabe's voice plan's guide rewrite
  (`docs/plans/2026-11-21-gabes-voice-plan.md`, Tasks 4 to 7).

## 4. Layers, masks, ways out, scale

- **Layers.** All engine: SQL and the seed. No instance file changes.
- **Masks.** A thread's board is public. Nothing here reads who owns a character, a class or who reacted.
- **Ways out.** No state is added. A thread placed on the system board leaves it when the flag does.
- **Scale.** `system_threads()` is a set of one thread per season plus two, read by an index. The rebuild after a flag
  change touches only those threads, through `rebuild_thread_places`' short-list path; the recount reads two boards'
  threads once, on the rare seed that moves the flag. The set-based placement gains one anti-join on a small set.

## 5. On dw.gripe

The first release after the build moves "Announcements From The System", "Updates" and "Season 1: Who Turned" to Staff
Announcements, refuses players' posts in them again, and sets both boards' thread counts. Staff Announcements then holds
what the guide says it does.
