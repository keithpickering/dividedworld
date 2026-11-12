# Laugh Track: the reader points, the room stirs: plan

Record, written 2026-11-12. Carries out `docs/plans/2026-11-12-laugh-track-point-design.md` (its sections are cited as
§N), task by task.

Every task is test first: the test named, its red run recorded, then the code, then the green run. No task touches SQL
or a deployed service. Every task is Divided World's; the engine is not changed and no interface is added to it. No
check is added or changed. No state a player, a character or a post can be put in is added: a place's nearness and its
heard mark are a reader's own screen state for a visit (§6). No response, payload, Realtime event or timing is added,
and nothing here reads who owns, wrote or cast anything (§6).

The effect is the board's world: it draws inside a post, in the house style, with color only on the game's own piece
(the underline in the sound's ink, as a heard place has today). No screen or flow is added.

The order: 1, 2, 3, then 4 (needs 1 to 3), then 5 (needs 4). 1 and 3 do not depend on each other; 2 needs 1.

This plan removes the band, the queue and their tests, built by `docs/plans/2026-11-12-laugh-track-band-plan.md` Tasks
3 to 6. What that plan built in the mixer, the sound levels and the cards' forms stays.

## Task 1. Nearness, to the line (Divided World)

Model: sonnet

**Files:** `instances/divided-world/ui/laugh-track/line.ts`, `instances/divided-world/ui/laugh-track/line.test.ts`.

**Tests first** (replace the `bandOf`, `inBand` and band-distance cases; keep `readingLine`'s):
1. `distance(rects, lineY)` is 0 where the line is inside a box (its top at or above the line and its bottom at or
   below), else the gap from the line to the nearest box's nearer edge; no boxes is `Infinity`.
2. `distance(rects, lineY, pointer)`: the pointer's distance to the nearest box (0 inside it) counts double, and the
   smaller of the two wins; a pointer far away changes nothing.
3. `nearness(0, 192)` is 1; `nearness(96, 192)` is 0.5; `nearness(192, 192)` and anything past it is 0; a reach of 0 or
   less, or a distance that is not a number, is 0.
4. `murmurGain(d, reachPx, most)` is `most / 100` times `nearness(d, reachPx)` (its existing cases stay green).

**Code.** `distance(rects, lineY: number, pointer?)` takes the line in place of the band. `export function
nearness(distance: number, reachPx: number): number`. `murmurGain` is written over `nearness`. `Band`, `bandOf` and
`inBand` go. The header says the line is back and why (§2: the band was for dwelling).

## Task 2. The watcher: nearness, the one loop, the quiet (Divided World)

Model: sonnet

**Files:** `instances/divided-world/ui/laugh-track/watch.ts`, `instances/divided-world/ui/laugh-track/watch.test.ts`.
The header is rewritten: the watcher no longer fires anything.

**The interface.**
- `Screen` is `{ line, reachRem, murmurMost, fadeMs }` (percent, rem, percent, ms).
- `PlaceSpec` is `{ els(): ArrayLike<Element>; kind: string; screen: Screen; voice(kind): Voice; near(n: number): void }`.
  `near` is told the place's nearness, 0 to 1, when it changes. `fire` goes.
- `register(spec)` returns `Unregister = (() => void) & { refresh(): void; pin(on: boolean): void }`. A pinned place
  has nearness 1 wherever it is (§4: focus).
- `export function quiet(answer: void | Promise<{ lengthMs: number } | null>, fadeMs: number): void` holds the murmur at
  nothing: at once, for `QUIET_MS` (1200, a constant of the module, exported); and when `answer` resolves
  `{ lengthMs }`, a finite number above 0, until the moment it resolved plus `max(lengthMs - fadeMs, 0)` (§3). Only the
  last call's answer counts. An answer that rejects is reported once (`reportFailure`, as today) and changes nothing.
- `forgetVoice()` and `__inspect()` stay; `__inspect` reports `{ places, elements, near, pinned, murmuring, listening,
  quietUntil }`.

**Tests first.** Delete every case that exists only for the dwell, the queue, the hold or the band (the report of the
code read lists them: the dwell and fling cases, the queue's order, the hold and lapse, the take-length hold, airtime 0,
the non-finite `airMs` and `holdMs`, the stale answer, "dwell lost on redraw", "frames while dwell or queue"). Keep the
murmur, pointer and resource cases (the nearest place's loop, a change of kind, touch does nothing, the busy page of
1,200 places with one observer and three listeners, unregister, the counters, Game sounds, the resize), measured to the
line. New cases:
1. A place at the line is told `near(1)`; one half the reach from the line is told `near(0.5)`; one past the reach is
   told `near(0)` once and not again while it stays there.
2. `near` is called only when the number changed by at least 0.02 from the last one told, and always for a change to
   exactly 0 or 1.
3. The mouse over a place far from the line gives it nearness 1; at a quarter of the reach away, 0.5 (the pointer
   counts double); a touch pointer changes nothing.
4. A place the observer drops from the reach is told `near(0)`.
5. A pinned place is told `near(1)` and its loop is the one raised, at `murmurMost`, wherever it is on the page; unpinned
   it goes back to its measured nearness. A pinned place keeps frames running only while its nearness has not been
   told.
6. No amount of time at the line fires anything: the spec has no `fire`, and after 60 seconds of frames with a place at
   the line the only calls are `near` and the loop's `setGain`.
7. `quiet(undefined, 250)` holds the loop's gain at 0 for 1200ms and then raises it; `quiet(Promise.resolve({ lengthMs:
   3000 }), 250)` resolved 400ms after the call holds it until 400 + 2750ms after the call; a second `quiet` makes the
   first one's late answer count for nothing; `{ lengthMs: NaN }`, null and a rejection hold for 1200ms, and the
   rejection is reported once.
8. While quiet, places are still told their nearness (the mark does not wait for the sound).
9. Frames: a still page with no place near, nothing pinned and no quiet running asks for no frame; a quiet running
   with a place near keeps frames until it ends.
10. `refresh()` after a place's pieces were drawn again tells the new pieces' nearness on the next frame, even where
    the number did not change (the old elements' marks are gone with them).
11. After the last place is unregistered the loop is stopped and `quiet`'s state is cleared, so a later page starts
    clean.

**Code.** `tick(now)`: the line (`readingLine`), then for each near place `n = pinned ? 1 : nearness(distance(boxes,
line, pointer), reachRem * rem)`, told through `spec.near` by the rule of case 2; the best is the place with the
highest `murmurGain`; `murmur(best)` unless `now < quietUntil`, when a live loop's gain is 0. The dwell, `earnedPlaces`,
`nextAt`, `lastFire`, `holdOver`, `inPageOrder`, `unearn`, `settled`, `DEFAULT_AIR_MS` and `DEFAULT_HOLD_MS` go. The
observer's `rootMargin` stays the reach. `stop()` clears `quietUntil` and the pin set.

## Task 3. The card's numbers and its words (Divided World)

Model: sonnet

**Files:** `instances/divided-world/cards/laugh-track.ts`, `instances/divided-world/cards/laugh-track.test.ts`,
`instances/divided-world/settings.ts`, `instances/divided-world/settings.test.ts`,
`instances/divided-world/ui/cards.ts`, `instances/divided-world/ui/index.test.tsx`,
`instances/divided-world/cards/index.ts` (a comment).

**Tests first.**
1. `laugh-track.test.ts`: `screenReads` holds `laughTrack.line`, `laughTrack.reachRem`, `laughTrack.murmurMost`,
   `laughTrack.fadeMs` and `laughTrack.markMost` (whole, 0 to 100), and none of `laughTrack.dwellMs`,
   `laughTrack.band`, `laughTrack.airMs`, `laughTrack.holdMs`.
2. `settings.test.ts`: the instance's `cardSettings` carry `laughTrack.markMost: 100` and none of the four removed
   keys.
3. `index.test.tsx` (it pins the copy at about lines 284 and 295): the hint is "A Laugh Track: the audience stirs as you
   get close to certain words. Point at one, or tap it, to hear them react. Turn on Game sounds in Settings to hear
   it." The description holds "the audience stirs as a reader gets close and the phrase's underline fades in. Pointing
   at the phrase, tapping it, or pressing Enter on it plays the reaction." and no longer holds "reacts as a reader
   reaches it".

**Code.** `screenReads` and the comment above it; `settings.ts` `cardSettings` and its comment; in `ui/cards.ts` the
hint, the description's sentence, and the comment at about line 282; in `cards/laugh-track.ts` the staff prompt at about
line 171 says "the audience's sound when a reader points at it"; the comment in `cards/index.ts`. These strings are the
glass's copy: the owner approves them in the build's PR (CLAUDE.md, "The fiction may lie; the log never does").

## Task 4. The effect: a gesture fires, the mark fades in, one stop for a post (Divided World)

Model: sonnet

**Files:** `instances/divided-world/ui/laugh-track/Effect.tsx`, `instances/divided-world/ui/laugh-track/Effect.test.tsx`,
`instances/divided-world/ui/laugh-track/laugh-track.css`,
`instances/divided-world/ui/laugh-track/LaughTrack.board.stories.tsx`, `e2e/board-stories.test.ts` (the story ids).

**Tests first** (`Effect.test.tsx`; the watcher stays mocked through `hub`, which gains `near`, `pin` and `quiet`):
1. **Every place is a button from the start.** The first piece of each place has `role="button"`; unheard it is named
   "`<words>`. Play the audience's reaction", heard "`<words>`. Replay: the audience boos" (laughs, cheers).
2. **A mouse that moves onto a place fires it:** `pointerenter` with `pointerType: 'mouse'` at a position other than
   the last `pointermove`'s plays the take with `{ group: 'audience', fadeMs: 250, tailMs: 250 }`, marks the place
   heard, and calls `met` once for the post.
3. **A place that scrolls under a resting mouse does not fire:** a `pointerenter` at the last `pointermove`'s position
   plays nothing; the next `pointermove` over the place, at a new position, fires it. A `pointerenter` with
   `pointerType: 'touch'` plays nothing.
4. **A tap or click fires; Enter and Space fire** (with `preventDefault`); a second gesture inside 300ms does not play
   twice (the guard that is there).
5. **Nothing else fires:** the registration has no `fire`, and no call from the watcher plays a take.
6. **The quiet:** a fire or a replay calls `quiet` with the play's promise and the fade.
7. **The mark:** the registration's `near(0.5)` sets `--dw-lt-near` to `0.5` on every piece of that place and on no
   other; with `laughTrack.markMost: 40` it sets `0.2`; `near` on a place whose pieces were drawn again sets the new
   pieces'. A heard place's pieces carry `dw-lt-fired` and the property is not needed.
8. **One stop for a post:** of a post's places exactly one first piece has `tabIndex` 0 and the rest -1; ArrowRight and
   ArrowDown move focus to the next place's first piece, ArrowLeft and ArrowUp to the one before, Home and End to the
   first and last, with no wrap; the focused place becomes the stop. A place removed while it was the stop hands the
   stop to the first place.
9. **Focus pins:** focus on an unheard place calls its registration's `pin(true)`, blur `pin(false)`; focus plays no
   take. Focus on a heard place plays nothing either (a replay is a press, a click or the mouse).
10. **The registration** carries `screen` `{ line, reachRem, murmurMost, fadeMs }` from the settings, and from
    `DEFAULTS` with empty settings; `DEFAULTS` equals the instance's `cardSettings` for every `laughTrack.*` key
    (the test that is there, over the new keys).
11. Keep: the Lens ("N of M cues heard", the Game sounds toggle), the still moment, taped places, the masks (nothing
    reads `reader.author`, `reader.caster` or an account), unmount unregisters.
12. **On a real page** (the real watcher, the cases that are there rewritten): a place at the line for five seconds
    plays no take, its pieces' `--dw-lt-near` is 1 and the titter's loop is raised; a click on it plays the take and
    the loop's gain is 0 until the quiet ends.

**Code.**
- `DEFAULTS` is `{ line: 40, reachRem: 12, murmurMost: 35, fadeMs: 250, markMost: 100 }`.
- `pieceOf` renders every piece with `dw-lt-cue`, and for the first piece of a place `role`, `aria-label` and
  `tabIndex` (0 for the post's stop, else -1). Every piece of every place carries the handlers: `onPointerEnter` and
  `onPointerMove` (mouse only, by the rule of case 3: a ref holds the last `pointermove`'s client position, read from a
  `pointermove` listener on the document that the effect adds once and removes on unmount), `onPointerLeave` (the place
  may fire again on the next entry), `onClick`, `onKeyDown` (Enter, Space, and on the first piece the arrows, Home and
  End), and on the first piece `onFocus` and `onBlur`.
- `fire(spot)` is called by the gestures, never by the watcher: it marks the place heard, plays through `replay`, calls
  `quiet(promise, screen.fadeMs)` and `met()` once.
- `sync` registers each unheard place with `near: (n) => mark(spot.key, n)`, where `mark` writes `--dw-lt-near` (`n *
  markMost / 100`, to two decimals) on `root.querySelectorAll('[data-lt-place="…"]')`. No state is set and nothing
  re-renders for nearness.
- `laugh-track.css`: `.dw-lt-cue` has the dotted underline (`text-decoration: underline dotted 2px;
  text-underline-offset: 3px`) with `text-decoration-color: color-mix(in srgb, <the sound's ink> calc(var(--dw-lt-near,
  0) * 100%), transparent)`; `.dw-lt-fired` sets the ink at full; `cursor: pointer` on a piece whose mark is showing
  and on a heard one; `:focus-visible` on any place's first piece has the focus outline that a heard one has today.
- The stories: `OnTheLineMain` and `OnTheLinePhone` become `NearMain` and `NearPhone` (a cue brought to the line: its
  mark full, nothing heard), and `HeardMain` and `HeardPhone` are added (the cue then clicked). `e2e/board-stories.test.ts`
  lists the new ids in place of the old. The header says what the stories show.
- The header's account of when a place fires is rewritten (§1 to §4).

## Task 5. A reader, in a browser (e2e)

Model: sonnet

**Files:** `e2e/laugh-track.spec.ts`.

**Tests first** (they are the task; record the red run against the build before Tasks 1 to 4, by checking out the spec
alone in a worktree at the plan's commit). The spec keeps its long post of 14 cued places. `fling`, the band's
arithmetic, `readToTheFoot`'s queue wait and the block "a reader and the band" go; the tests that brought a cue
`toTheLine` to fire it now bring it to the line and click it.
1. **Reading fires nothing.** At 1280 by 800, a wheel notch of 100px every 300ms from the top of the long post to its
   foot, then two seconds: no place is heard (`.dw-lt-fired` matches nothing) and the Lens says "0 of 14 cues heard".
2. **The room stirs.** With the first cue brought to the line: its pieces' computed `--dw-lt-near` is at least 0.9, a
   cue more than the reach from the line has 0, and the caption bar holds the murmur's caption for that cue's sound
   ("A grumble rises" for a boo).
3. **Pointing plays the reaction.** Moving the mouse onto a cue (a real `page.mouse.move` from outside it) marks it
   heard, shows its caption ("The audience boos"), and the Lens says "1 of 14 cues heard". Moving onto a second cue
   marks that one too.
4. **Scrolling a cue under a resting mouse plays nothing**; the next mouse move over it does.
5. **A phone**: at 390 by 844 with touch, a tap on a cue marks it heard; a scroll by touch marks none.
6. **The keyboard**: from the control before the post, one Tab lands on the post's first cue (named "`<words>`. Play
   the audience's reaction"), ArrowRight moves to the second, Enter marks it heard, and one more Tab leaves the post's
   cues.
7. **axe** passes on the board story with a cue near and with a cue heard (the two checks that are there, on the new
   stories).

## Review focus

- **A scroll that fires after all:** browsers send a `pointerenter` when the page moves under a mouse at rest; the
  rule that the mouse must have moved has to hold in Chromium, Firefox and Safari's event orders (a `pointermove` with
  the same position sent after a scroll; a `pointerenter` before any `pointermove` on a fresh page, where there is no
  last position).
- **Marks written from outside React:** a re-render, a tape laid over a place, a post edited or a page turned draws
  pieces again; each must get its nearness back within a frame and none may keep a stale mark. A place heard and then
  drawn again keeps its full mark from the class.
- **Thirty buttons in a post's words:** how a screen reader reads a post whose phrases are buttons (the words are still
  read in order, each cue announced once), and that selecting and quoting a post's text with cued phrases still works
  with the handlers on them.
- **Frames on a still page:** with a place near and nothing changing, frames stop; a pinned place does not keep them
  running; the busy page (forty posts of thirty places) still costs one observer and one loop of frames, and a frame
  writes no style where no nearness changed.
- **The quiet and a reaction that never answers:** a play whose promise never settles holds the chitter for 1.2
  seconds and no longer; two reactions in quick succession leave the hold with the second.
- **The copy:** the hint and the description are true of what is built, in American English, and say nothing in
  character.
- **The masks:** nothing in the watcher or the effect reads `reader.author`, `reader.caster` or any account; the test
  that holds this for the effect still passes.
- **What is removed:** no code, test, story, setting or comment still speaks of the band, the dwell, the queue, the
  airtime or the hold as current; #563's two findings about them (the flaky fling test, the cold take's hold) are
  closed by their removal and by §3.
