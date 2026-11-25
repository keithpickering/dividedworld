# A spin picks its board: design

Record, written 2026-11-25. A design session with the owner. Its plan is `docs/plans/2026-11-25-spin-board-plan.md`.
Each section was decided one question at a time; where the owner chose the recommendation as put, the section says so.

## 0. The question

The owner: "Let's design the ability to select a Board when spinning a thread. Currently it goes into either the same
board as the original or General in the case of staff announcements."

What the code held when this was written (main at the start of the session):

- `spin_written` (latest `0395_polls.sql`) opens the thread on the origin's thread's board, or on `players_board()`
  (`0339_thread_places_at_scale.sql`: `first_open_board()`, the oldest open board, which is General) when the origin
  is on The System's board. A staff announcement is on The System's board, hence General.
- `spin` (latest `0357_post_veils.sql`) is acting, the post pressed held `for share`, `not_banned`, then
  `spin_written(..., check_bar => true, ...)`.
- `apologize` (`0130_bars_apologies.sql`, unchanged since) is `spin_written(in_move, through, title, body, false,
  framing)`: an apology is the spin of the move that bars the character, with the bar the one check skipped.
- `write_staff_spin` (`0420_hot_posts.sql`), a persona's spin from chatter (`supabase/functions/chatter/core.ts`),
  repeats the same board rule in its own body.
- `start_thread` (latest `0395_polls.sql`) is the one place a player names a board: it refuses a board that does not
  exist, The System's board (`not_the_systems`), a closed one (`lock_board_start`, `not_closed`; the trigger
  `threads_on_open_board`, `0339`, holds the same for every insert into `threads`) and a barred one (`not_barred`).
- The spin form (`engine/ui/spin/SpinForm.tsx`) has a title and an opening post. It is drawn under a post, a play, a
  poll, the ORIGIN box, the log, a staff profile and the barred note.

## 1. The form starts on today's board

**Decided** (the recommendation as put). The form's Board field starts on the board a spin lands on today: the
origin's own board, or the first open board when the origin is on The System's board. Spinning without touching it
writes what it writes now.

Weighed: no default, so that every spin is a deliberate pick (a step more on every spin, for a choice most spins do
not need); the board this character last used (convenient for a one-board player, but it moves between spins and
surprises).

Following from it: "today's board" becomes one function, `spin_board(origin)`, that the server's spin, the persona's
spin and the form's read all call, so the rule is written once (CLAUDE.md, "Two lists that must agree are one list").

## 2. The list is the open boards, and a barred one is shown barred

**Decided** (the recommendation as put). The list offers every open board that is not The System's, in the index's
order (`created_at`, `id`). A board this character is barred from stays in the list, disabled, and says until when, in
the words the server's refusal uses ("Off-Topic (barred until 2026-11-27 14:00 UTC)").

Weighed: only the boards the character may post on (shorter, but a board gone from the list for no stated reason
puzzles a player); every board, left to the server to refuse (offers choices that can never work).

Following from it:

- When today's board is one the character is barred from, the field starts with no board chosen and says so, plainly:
  "{character} is barred from posting on {board} until {time}. Pick another board." The Spin button waits for a
  choice. A spin there was refused before this design; now it has a way through.
- When every board is barred for the character, nothing is choosable; the note says so, and the ways out are the
  bars' own (each ends at its time, by an accepted apology, by an admin, or on appeal: `0130`'s header).
- The server checks a named board as `start_thread` does, whatever the form offered: it exists, it is not The
  System's, it is open, and (for a spin, not an apology) the character is not barred from it.

## 3. An apology picks its board too, any board

**Decided** (the recommendation as put). The apology form has the same Board field, and since an apology skips the
bar, every open board is choosable, the barred one included. Where an apology is made (on the very board it is
barred from, or in front of everyone on General) is the player's choice and part of the theatre. The judge reads it
wherever it lands; `rule_apology` posts its ruling in the apology's thread, wherever that is.

Weighed: no picker, as today (the one spin with no choice of place); only the barred board (a player who wants to
grovel in public cannot).

## 4. A persona's spin shares the rule; choosing is chatter's design

**Decided** (the recommendation as put). `write_staff_spin` takes the same optional board, with the same default
(`spin_board`) and the same checks a player's spin has, bars aside (a persona is not barred, as `write_staff_thread`
does not ask). Chatter keeps passing none. Whether the model chooses a board for a persona's spin, from a fixed list
the code checks (CLAUDE.md, "The System acts"), is chatter's own design, filed as #1110.

Weighed: the model picks now (pulls chatter's prompt, schema and repair into this design: scope drift); personas never
choose (the two spin rules drift apart).

## 5. A spin that crossed boards says so

**Decided** (the recommendation as put). Where a spun thread is on another board than the one being read, the lines
that link across name the board, and only then:

- A post's "↳ Spun into:" line: "Ref Bumps (on Off-Topic, 3 replies)".
- A spun thread's "spun from" phrase, drawn by `OriginLink` for both the ORIGIN box's head and a board's row, so the
  two cannot drift: "spun from post 41 in The Tea Thread on General". The board compared is the spun thread's own.

A spin from The System's board names it too ("on Staff Announcements"): today's General spins from an announcement
gain that line, which they lacked. A spin from an Update names no board, since its link leads to the Updates page and
not into a board.

Weighed: never naming the board (shorter, but a reader learns the conversation moved only by landing there); always
naming it (noise on the common case).

How it is carried: `thread_open`'s `origin_place` gains a key, `board`, the origin's thread's board id, read from the
join the view already makes (`ot`, the origin's thread). No column is added and no join, so the screen functions that
project `origin_place` carry it unchanged, and `thread_open`'s plan memory (watched by
`supabase/tests/e2e/0028-cold-read-budget.ts`) is not raised. The board's name is the client's, from the boards it
already holds (boot's `boards`, the hook `useBoards`, moved out of the search screen for this).

## 6. Layers, masks, ways out, scale

- **Layers.** All of it is engine: the SQL, `engine/rules/actions.ts`, the API and the form. No instance content is
  involved; board names come from the instance's data.
- **Masks.** The list, the default, a board's name and a character's bars are public (a bar is named by its move's
  Act). `spin_places` reads only those for the character the caller names, a character the caller acts through (it
  calls `acting`, as every write does), so it answers nothing about another player's masks. The refusals name only the
  character's own name, the board and the bar's end, as `not_barred` already does. Nothing here reads an owner, a class
  or a reaction, and no timing differs with who owns anything.
- **Ways out.** No state is added. A bar on today's board, which refused a spin before, now leaves the player a choice
  of other boards; a player barred everywhere keeps the bars' own ways out.
- **Scale.** The form's read is one call that lists the boards (dozens at most on a busy instance, a list the index
  already reads in full) and the character's bars once (`bars_of`, by the move index, `0138`). The spin itself adds a
  lookup of one board by slug. `origin_place` gains a value from a row the view already holds.
- **A bar is still a bar.** A post on a board the character is barred from can now be spun onto another board. That
  is posting elsewhere, which a bar never forbade (a post on any other board could always be spun); the barred board
  still takes nothing from the character.

## 7. Open

Nothing the owner left open. The persona's choice of board waits on chatter's design (section 4).
