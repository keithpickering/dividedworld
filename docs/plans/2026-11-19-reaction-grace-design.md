Record, written 2026-11-19.

# A reaction waits five seconds before it is sent: design

A design session with the owner, which started from the owner's ask: "a reaction undo timer, a few seconds before the
endpoint is actually called, and an info tooltip 'Reactions can't be taken back' if another attempt is made." Its plan
is `docs/plans/2026-11-19-reaction-grace-plan.md`. A search of the issues found none on undoing a reaction.

## 0. Where it starts

- **A press sends at once.** A reaction tile in the row, and a kind chosen in the picker, both call `send` from
  `useReactionSend` (`engine/ui/reactions/send.ts`), which calls `api.react` straight away. One send is in flight per
  Act. A second press while it is in flight answers `'busy'` and is dropped.
- **No reaction can be taken back.** The API has no unreact (`docs/plans/2026-11-06-meta-acts-design.md`, section 6).
  Settlement relies on this (`docs/plans/2026-11-16-settlement-design.md`, section 1). This design keeps it so: a
  reaction can be called back only before it is sent.
- **Your own kind does nothing.** In the row its tile is `aria-disabled`, and its name says "including yours". In the
  picker it is `disabled` and outlined. Nothing tells a player why a second press does nothing.
- **The stamp** (`engine/ui/reactions/reactions.css`) plays on the presser's screen when the server answers `'sent'`.
- **The player's own reactions** are held per page in a `Mine` store (`engine/ui/reactions/mine.ts`), created by the
  thread, the board, the Updates page and the front door. It is shared by every row that shows the same Act (the
  thread's row and the Lens's).

## 1. Where the grace lives

**Decided: on the presser's screen alone.**
- A press holds the reaction as pending on the screen, and `api.react` is called only when 5 seconds have passed.
- No Act exists until the send, so "Append-only" holds untouched. Nothing about a pending reaction leaves the device.

Weighed and rejected:
- **A pending row on the server**, sent at once and made real after 5 seconds, with undo deleting it. It survives a
  closed tab, but it adds a state, a job and a table, and it is a deletion one step from an Act.
- **Both**: the most code for the least gain.

## 2. Undo is the same press again

**Decided: press the pending tile again, within 5 seconds.**
- The pending tile wears a ring in its quadrant's class color, which drains over the 5 seconds.
- The tile's name is "Laughing, sending in 5 seconds as Mrs. Hooligan. Press again to undo." A polite status says
  "Reacting with Laughing as Mrs. Hooligan in 5 seconds" at the press, and "Laughing undone" at an undo. The status
  that says it landed ("Reacted with Laughing as Mrs. Hooligan") is today's, said at the send.
- 5 seconds is an engine constant (`REACTION_GRACE_MS`), not an instance setting. It is part of how the row behaves,
  not one of the game's rules.

Weighed and rejected:
- **An Undo chip at the end of the row**: more discoverable, but it is a second control that moves the row about.
- **3 seconds**: snappier, but too little time to notice a wrong mask.

## 3. What the press shows, and when the stamp plays

**Decided by the owner: the stamp plays at the send, and the press itself still shows.**
- **At the press:**
  - The tile gives under the press, as today, and the emoji pops.
  - The count shows one more, in a pending style.
  - The ring starts to drain.
  - A kind that had no chip gets one at once, in the pending style.
- **At the send:** when the server answers `'sent'`, the stamp plays as it does today. The stamp now means "done, no
  going back", which is what the tooltip in section 7 then says.
- **Reduced motion** (the Motion setting Off, or the device's): the ring does not drain. The tile shows the seconds left
  as text ("5", "4", …), and the window is still 5 seconds ("An accessible path costs what the obstacle costs").

Weighed and rejected: **the stamp at the press.** It looks final before it is, and an undo would have to take it back.

## 4. Several at once, and the cap

**Decided:**
- **A pending kind counts as yours on screen.** It counts toward the cap, and toward the one-of-each-kind rule.
- **Each pending kind has its own timer.** Their sends queue, one at a time, on the Act's one lock. A send that comes
  due while another is in flight waits for it, and is not dropped as `'busy'`.
- **A press that goes past the cap is refused on screen**, as today. With one kind already sent, two pending and a cap
  of 3, the row says the cap is reached. Undoing one of the pending frees its place.

## 5. Leaving, a mask switch, and a refusal

**Decided:**
- **Leaving the thread in the app** sends every pending reaction at once.
  - The row that pressed it sends it as it unmounts.
  - The reaction had its own grace; leaving ends the grace early, and does not end the reaction.
- **Closing or hiding the tab** (`pagehide`) sends every pending reaction at once, with a keepalive request, so it can
  outlive the page.
  - A killed tab or a lost network can still lose one. That is accepted: the next load shows what landed.
  - Weighed and rejected: **dropping** what is pending (a player who reacts and quickly moves on loses it without
    knowing), and **a prompt before leaving** (a dialog for a 5-second window).
- **A mask switch** in the HUD during the grace sends the reaction on time, as the mask it was pressed as. The pending
  tile's name said so.
  - Weighed and rejected: **cancelling** (it drops a reaction meant for the other mask whenever a player switches for
    another reason), and **sending at once** (it ends the undo window early for no gain).
- **A refusal at the send** takes the pending look away, and puts the server's words in a `role="alert"` note under the
  row. Today a refused tile press opens the picker with the refusal. A picker opening 5 seconds after the player moved
  on would be jarring, so a refusal at the end of a grace does not open it. A refusal the picker gets while it is open
  is shown in it, as today, but with the grace no send happens while the picker is open.

## 6. The staged page

**Decided:** the front door's sample thread (`engine/ui/staged.ts`) has the same 5-second grace, with its pending look
and undo. The front door is where a visitor first learns the row, so it teaches the row as it is. Nothing is sent from
it, as today.

## 7. "Reactions can't be taken back"

**Decided: a glass tooltip, on a press of your own sent kind, in the row and in the picker.**
- Pressing your own sent tile in the row, or your own kind in the picker, shows a small glass tooltip by it: an ⓘ and
  "Reactions can't be taken back."
  - In the picker, your own kinds go from `disabled` to `aria-disabled`, so they can be pressed and reached by the arrow
    keys. A kind that is unavailable only because the cap is reached stays `disabled`, as today.
- It shows for about 3 seconds, or until the tile loses focus or Esc is pressed. A polite status speaks it.
- **Hover alone shows nothing.**
- **The tile's name** gains ", can't be taken back": "Laughing, 3, including yours, can't be taken back."
- **A pending tile is not "your own sent kind"**: pressing it is undo, and shows no tooltip.
- **The words** are glass copy, plain and true ("The fiction may lie; the log never does"). They describe the game and
  never bluff.
- **The tooltip is new to the glass.** None exists yet: the onboarding tips (`engine/ui/tips/`) are a tour, not a
  tooltip. A `Tooltip` goes into `engine/ui/glass/`, so later screens can use it.

Weighed and rejected:
- **The row alone**: the picker is where a second try at the same kind is most likely.
- **On hover too**: it pops up on every pass of the mouse over your own reactions.

## 8. The rules it is held to

- **Append-only.** Untouched: no Act exists until the send.
- **A response never proves a private fact.**
  - Nothing new is sent, answered or broadcast.
  - The reaction's own time on the server moves later by 5 seconds for everyone alike, or less when a player leaves.
    When a reaction lands is a timing of public play, and is not computed from who owns what.
  - A pending reaction is on the presser's screen alone. The tally other players see moves only at the send.
- **Settlement** counts a reaction by when it landed, as today. A reaction pressed in the last 5 seconds of a window
  lands in the next one. This is the same for every player, and is accepted.
- **No player is ever stuck.** Each state this adds ends by itself:
  - a pending reaction, within 5 seconds, or at once by a press, by leaving or by closing the tab;
  - the tooltip, within about 3 seconds, or by blur or Esc;
  - the refusal note, at the next press on the row, or by leaving.
- **The layers.** All of it is engine. It names no instance, no reaction key and no class. Its tests use the fake
  world's kinds.
- **Screens.** The row and the picker are the glass (`docs/plans/2026-10-29-two-worlds-design.md`). The ring, the
  pending style and the tooltip use the glass's tokens and the quadrant's class color, as the stamp does.

## 9. Open

- None the owner left open. Whether 5 seconds is right is answered by play. The constant is one line.
