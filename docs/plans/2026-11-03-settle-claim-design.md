# The settle run's claim, held until its window is applied: design

Record, written 2026-11-03. Designed with the owner in a design session, from #179's second follow-up ("The settle run's
claim can expire before a busy window is applied"), with #177's question and #179's fourth follow-up ("A failed
overlapping run leaves a fresh claim") answered beside it. It builds on the core loop design's section 4
(`docs/plans/2026-11-03-core-loop-answers-design.md`, #22). The plan is `docs/plans/2026-11-03-settle-claim-plan.md`.

## The defect

A Turn takes effect at the end of the window it was asked in, and its settlement reaches that end only afterward. A
reveal made in between names the class the Turn replaces, dated after the instant the Turn replaced it, so the
settlement makes the reveal false on its own date (#22).

`unmask()` refuses in that gap in two ways (`supabase/migrations/0072_core_loop_answers.sql`):

- **The window's end is known in advance:** `next_settlement_at(asked_at) <= now()` while the Turn waits. This
  refusal has no clock. It lasts until the settlement applies the Turn, or until the player withdraws it.
- **The end is not known in advance** (a season's first window, and the window after a season's end): a row in
  `settlement_claims` that the run writes before it reads its input. It refuses while it is fresh, meaning under five
  minutes old, and while its window is unsettled.

`MOST_RUN_MS` (`supabase/functions/settle/core.ts`) is checked only between windows. On a busy instance, one window's
`settlement_input`, `settle()` and `apply_settlement` can together outlast the five minutes. A reveal made after that
names the replaced class: #22 again, at a busy instance's scale (CLAUDE.md, "Weigh a design at the scale of a busy
instance").

The root cause is the clock. Five minutes cannot tell a live run from a dead one, so no fixed length is long enough.

## 1. The claim holds until its window is applied

**Weighed.**
1. *No clock* (chosen). A claim refuses while its window has ended, its window covers the Turn
   (`window_end > asked_at`), and no settlement ends after the claim's start. The known-end refusal works the same
   way, so both refusals now end the same way.
2. *Refresh the claim before each step* (#179's proposal, extended to `settlement_input` as well as
   `apply_settlement`). Rejected: it narrows the gap but leaves it open. One step that takes longer than five minutes
   still lets a reveal through.
3. *Bound one window's work*, with a statement timeout on each of the run's requests and the Edge Function's wall
   clock under the claim's length. Rejected: the bound would rest on Supabase's and PostgREST's limits, which works
   against "Portable by construction", and a request whose client has gone can still run on in Postgres.

**Shape.** `settlement_claims` gains `window_start`. `claim_settlement_window(window_start, window_end)` replaces the
one-argument function, and the run sends both ends of the window it has chosen. "No settlement ends after the claim's
start" is one condition that covers two cases. It ends a claim once its own window is settled. It also voids a stale
claim, one written by an overlapping run whose window ended differently (#179's fourth follow-up), as soon as any
settlement past its start is written. A claim on a window that has not yet ended refuses nothing, so a run called by
hand with a future `until` blocks no reveal early. When a settlement is written, the claims it voids are deleted in
the same transaction, so the table holds only claims still waiting.

**The cost, accepted.** A run that dies on a first-of-season window leaves its claim. Reveals for Turns in that window
then wait for the next run to apply it, at the next firing of the instance's schedule. The player can withdraw the
Turn. This is how a known-end window has always behaved when its run dies.

## 2. Both refusals say one true sentence (#177)

**Weighed.**
1. *0027's words, plus the player's way out* (chosen), for both refusals: "this character's Turn takes effect at the
   settlement now due; reveal once it has run, or withdraw the Turn".
2. *0027's words alone.* Not taken: the refusal is where the player stands, and it should name their own way out.
3. *Two sentences* (#177's proposal). Rejected: once neither path has a clock, the two say nothing different that is
   true.

The words are out of character and plain (CLAUDE.md, "The fiction may lie; the log never does"). They are true however
long the wait lasts.

## 3. A Turn never takes effect behind a reveal (the backstop)

Even with the claim, the run claims its window only after it has asked for it. pg_cron's call, the Edge Function's
start and `next_settlement_window` all fall between the window's end (the cron's minute) and the claim. That is
usually seconds. The core loop design accepted this gap. The owner chose to close it.

**Weighed.**
1. *A backstop in the settlement* (chosen). In `masks_change`, a waiting Turn whose character has an unmask Act dated
   at or after the window's end does not take effect. It stays in `pending_turns` for the next window. This closes the
   defect however the timing falls, and with the claim in place it rarely fires.
2. *Leave the round trip, as decided.* Not taken.
3. *File it on its own.* Not taken: it is the same defect, and the fix is one condition beside the one this change
   touches.

**Order.** `unmask()` locks its character's row (`for no key update`) before it checks and writes. `masks_change` locks
the rows of characters with waiting Turns, in one order, before it reads them. A reveal therefore goes wholly before
the Turn takes effect or wholly after it. A reveal that goes before and is dated at or after the window's end makes the
Turn wait. One that goes after names the new class.

**Its record.** `pending_turns.due_at` is set to the window's end the first time a settlement passes over the Turn, and
kept if it is passed over again. Changing the Turn (`turn()`) is a new ask, so it clears `due_at`. When the Turn lands,
`class_history.due_at` carries the date. Neither is an Act: a Turn is private, and an Act is public.

## 4. The log says the Turn waited, and why

**Weighed.**
1. *Record it and say it* (chosen). `my_characters` exposes `class_due_at` for the caller's own characters. The log's
   "Turn took effect" row adds: "It was due at the settlement of <date> and waited for this one: <name> revealed after
   that window had ended."
2. *Say it only on the "Turn waiting" screen.* Rejected: once the Turn lands, the reason is gone, and the log is what
   lets a player step back and see the game.
3. *Say nothing extra.* Rejected: the row's date is true, but a Turn that came a window late with no reason given
   reads as the game cheating.

## Ways out

- **A reveal refused while a claim waits:** the run applies the window. A dead run's claim gives way when the next
  firing applies it, by itself. The player can withdraw the Turn on My characters at any time. This is the same as the
  known-end refusal.
- **A Turn passed over by the backstop:** it takes effect at the next settlement, by itself. The player can change or
  withdraw it while it waits, as with any waiting Turn.

## The masks

- The claim's refusal depends only on the caller's own character's own Turn and on the run's state. That a settlement
  is due or running is public, because when The System settles is the same for everyone.
- The backstop depends on the character's own reveal, which is public, and on its own Turn. A passed-over announced
  Turn's tally comes a settlement later. Nothing marks it as late, so it says nothing an observer could not already
  read from when the reveal was made. A silent Turn shows nothing either way.
- `pending_turns.due_at` and `class_history.due_at` are read only through `my_characters`, which the caller's own
  characters bound. No other view reads them.

## The layers

The claim, the refusal, the backstop and the record are engine SQL (`supabase/`) and the engine's settle function. The
log's sentence is in the engine's log words (`engine/ui/log/lines.ts`), beside its other plain sentences. No instance
content is touched, and no interface is added.

## Open

Nothing the owner was asked is open.
