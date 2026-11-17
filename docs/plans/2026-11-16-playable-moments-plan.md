Record, written 2026-11-16.

# Playable moments: plan

Carries out `docs/plans/2026-11-16-playable-moments-design.md` (issue #770). One PR from `main`. It is plan 1 of
two: plan 2 (issue #774) adds the read of the past that Graffiti and Jimmy Wails need. Read the design whole first;
section numbers below are its.

Every task goes test first: write the failing test, record its red run, then the code. During a task run only the
tests for the changed code (`npx vitest run <file>`, `npx playwright test <spec> --trace off`). Run `npm run
typecheck` and `npm run build` once after the last task, with the tail in the PR. No migration is added and no
deployed database, bucket or connector is touched. No build check (`tools/check-*.mjs`) is added, so there is no
poison to plant.

Line numbers are as read at `origin/main` 1a41d502 and say where to look, not what is there now.

**The layers.** Tasks 1 to 4 are the engine's and name no card. Tasks 5 to 12 are Divided World's. Task 13 is
both.

**The order holds every task green.** Task 1 changes what the engine hands an effect in a moment (`still: false`,
`moment: { at }`). Each card's own tests drive its `Effect` directly, so a card not yet converted keeps its green
tests until its own task rewrites them. Between Task 1 and a card's task that card misbehaves in a real moment (it
runs as live against today's clock); that is inside the PR and never on `main`.

**PR #771** (Steel Chair in the ORIGIN box) has a task that makes a still Steel Chair run watch its box. If its build
has merged, Task 10 removes that still run and its test with the rest of the still path. If it has not, say so in
this PR's body: that task of #771's plan has nothing left to fix.

**What stays as built:** what a moment records and reads (`play_moments`, `play_moment_layers`, `play_moment`,
`spin_moment`, `PlayMoment`); `momentParts`'s judging of liveness at the moment's time, its names for a back, a
caught play and a play an admin ended; one moment per page over a post, tied to its Lens; the ring and the tag over
a post (`useRing`); the ORIGIN box framing its moment with no ring; History's `VersionEffects`, which keeps
`StillEffect` and `still: true`.

## Task 1. The contract, and what a moment hands an effect

Model: sonnet

**Files:** `engine/ui/cards/types.ts`, `engine/ui/cards/Effects.tsx`, `engine/rules/cards.ts`,
`engine/rules/cards.test.ts`, `engine/ui/cards/moment.test.tsx`, `engine/ui/cards/Moment.tsx` (the `onWords`
plumbing only), `instances/divided-world/cards/this.test.ts` (its `drawnInMoment` assertion goes).

**`EffectProps.moment: { readonly at: number } | null`** (types.ts, beside `still`). Its doc comment says, in this
order: null on a live post; in a play's moment, the moment's time as an epoch, which is the clock the effect judges
everything by and which does not advance; the effect starts from `states`, `post` and `plays` as given and runs as
it runs live; `reader` is nobody; `save`, `release`, `give` and a surface's `draw` and `wash` refuse without
asking, `met` and `holdScreen` do nothing, `marks` is null, `fold`, `kept`, `drives` and `wallet` are absent or
null; nothing the reader does is saved or sent. Rewrite `still`'s comment: true only on a History version row
(`VersionEffects`), where a writing card draws its tail whole and takes no input; false in a moment and on every
live post.

**`playsInMoment(rules: CardRules | undefined, ui: CardUi | undefined): boolean`** in Effects.tsx, exported:
`ui?.Effect !== undefined && ui.takeover !== true && rules?.surface === undefined && rules?.drive === undefined`.
Its comment cites design section 5 and says the last two conditions go with issue #774. `momentParts` uses it in
place of `drawnInMoment` (:522). Delete `drawnInMoment` from `engine/rules/cards.ts` (:798) and its tests.

**`MomentEffect`** (new, beside `StillEffect`, which stays for `VersionEffects` alone). Props as `StillEffect`'s
plus `at: number`, `ink`, and `onView: (card: string, view: CardView | null) => void` in place of `onWords`. It
renders `<Effect … still={false} moment={at-object} … />` with:

- `save`, `release`, `give`, `moreGifts` and the surface as today's refusing ones (rename `stillSave` and the rest
  to `momentSave` and so on; `NOTHING_SAVED`'s text becomes `'nothing in a moment is saved'`);
- `met` and `holdScreen` doing nothing, `marks={null}`, `wallet={null}`;
- `show` bound to the card: it calls `onView(card, view)`, and its cleanup calls `onView(card, null)`;
- `useWarmSounds(ui.cards.find((c) => c.key === card)?.sounds)`, as `BoundEffect` (:437);
- the moment object memoized on `at`, so an effect may list it in its dependencies.

**`MomentEffects`** (:566): takes `onView` in place of `onWords`; computes `at` as `momentParts` does (:475-476;
lift that into one exported `momentTime(moment)` and use it in both); makes one ink registry for the moment
(`useMemo(createClaims, [])`) and hands each wrap `claims.at(…)` exactly as `PostEffects` does (:258), in place of
`NO_INK`; renders `MomentEffect`.

`BoundEffect` (:439) and `StillEffect` (:676) pass `moment={null}`.

**Tests first** (`moment.test.tsx`; the existing 'each drawn card is given still…' at :95 and 'a surface in a
moment' at :75 are rewritten, not deleted):

1. Each drawn card is given `still: false`, `moment.at` equal to the moment's time, its state as saved then, a
   `reader` who is nobody, and a `save`, a `release` and a `give` that refuse without calling the API.
2. A card with an effect whose rules save nothing, stack 1 and never end is drawn (it was named).
3. A takeover is named and never drawn, whatever its rules say.
4. A card whose rules have a `surface` is named, and one whose rules have a `drive` is named (it was neither drawn
   nor named).
5. Two drawn ink cards in one moment are given claims from one registry: the upper one's `topAt` answers true where
   it has claimed.
6. A drawn effect's `show` reaches `onView` with the whole view, controls included, and null when it unmounts.
7. `MomentEffect` warms the card's `sounds`.
8. `VersionEffects` still gives `still: true` and `moment: null` (`Effects.test.tsx` :232).

## Task 2. Reset, and one run of a moment

Model: sonnet

**Files:** `engine/ui/cards/Lens.tsx` (`LensStore`, `createLensStore`), `engine/ui/cards/Moment.tsx`
(`MomentFrame`, `MomentView`), `engine/ui/cards/moment.css`, `engine/ui/spin/Origin.tsx`, `engine/ui/spin/spin.css`,
`engine/ui/cards/moment.test.tsx`, `engine/ui/spin/Spin.test.tsx`.

- `LensStore` gains `run(key: Id): number` (0 until reset) and `reset(key: Id): void` (adds one and wakes). A moment
  is keyed as `useMomentRead` keys it: the play's id, or the spin's.
- `MomentView` reads `run` with `useSyncExternalStore` and renders `<MomentEffects key={run} …>`, so Reset remounts
  every effect in the moment from the moment's states. It also clears nothing else: the read is kept.
- `MomentFrame` over a post (`back` given): the tag reads `As it landed · Reset · Back to now`. Reset is a button
  like `.kb-moment-back` (class `kb-moment-reset`), before Back to now. The tag already wraps on a phone.
- In the ORIGIN box the head (Origin.tsx :266) reads `… · as it landed · ` then a `Reset` button, and the same after
  `as it was spun`. The button is drawn only where the box draws a moment (`cardPlay && (onCharacter ||
  !cardPlay.reach)`) and the moment is read and not null. It calls `lens.reset(key)` with the key Origin seeds
  (:192).
- After a press focus stays on the button, and a visually hidden `role="status"` in the frame says `As it landed
  again.` (set on each run above 0, so a second Reset is said again).
- Reset is drawn in both places whether or not anything was changed.

**Tests first:**

1. Over a post, Reset remounts the moment's effect (a fake effect counts its mounts) with the same states, keeps the
   moment shown, keeps focus on Reset, and says the status.
2. Back to now still returns focus as `backToNow` does.
3. In a play-spun ORIGIN box the head has Reset; pressing it remounts the box's effect. A box spun from a post has
   none. A box whose moment is null ("no moment to show") has none.
4. The moment is read once across two Resets (`api.playMoment` called once).

## Task 3. A moment's views reach the strip where it shows

Model: sonnet

**Files:** `engine/ui/cards/Moment.tsx` (`MomentView`), `engine/ui/cards/Effects.tsx` (`PostEffects` :267),
`engine/ui/spin/Origin.tsx`, `engine/ui/cards/Lens.tsx` (`LensProps`, `PlayRow`), `engine/ui/cards/Marks.tsx`
(`PostMarks`), `engine/ui/cards/lens.test.tsx`, `engine/ui/spin/Spin.test.tsx`.

- `MomentView` takes `onView: (card: string, view: CardView | null) => void` and passes it to `MomentEffects`. Its
  `said` state and `onWords` go (Task 4 removes the words they fed).
- **Over a post:** `PostEffects` passes `onView={(card, view) => plays.setView(post.id, card, view)}`. The live
  effects the moment replaces unmount and clear their views (`BoundEffect`'s cleanup, :433), and the moment's
  effects then say theirs. Test the order: after As it landed, the Lens of a drawn card shows the moment's view, and
  after Back to now the live effect's view is back. If React runs the cleanup after the moment's first `show`, the
  moment's view is lost: the test catches it, and the fix is for `MomentEffect` to say its last view again in a
  layout effect after mount.
- **In the ORIGIN box:** Origin passes `onView` writing to the box's store under the post the box's strip is keyed
  by (`cardPlay.post`, or `homeOf(cardPlay)` for a card on a character, as :199).
- **A mark per drawn card in the box** (design section 6). When the box's moment is read, Origin adds the Acts of
  the moment's drawn plays to the box's store (`plays.add`), so `PostMarks` shows a mark for each. Use
  `momentParts(...).drawn` to choose them, and add nothing for a moment that is null or not yet read.
- **Those other plays' rows** are drawn with what they have in the box: `LensProps` and `PostMarks` gain
  `then?: ReadonlySet<Id>`, the plays shown as they stood in a moment and not the box's own. A row in `then` draws
  its notes, its head, its message, and Go to post, and draws no `Reactions`, no Spin thread, no As it landed, no
  Take back and no End card. Origin passes every added play's id but the spun play's. The spun play's row is
  unchanged.
- A card on a character (`CharacterMoment`) gets the same `onView` and the same added marks; a play above the post
  says no view, as on a live post (`BoundEffect` :431).

**Tests first:**

1. Over a post with a moment shown, the open Lens's Act section shows the moment effect's controls, and pressing one
   calls the fake effect's handler.
2. After Back to now the Lens shows the live effect's view again.
3. A play-spun box whose moment draws two cards shows two marks. The spun play's Lens row has React and Spin thread;
   the other's has neither and has Go to post, and its Act section shows that effect's controls.
4. A box whose moment draws only the spun play shows one mark, as today.
5. Leaving the thread and coming back does not add the plays twice (the store keeps each Act by id).

## Task 4. What a moment says under its post

Model: sonnet

**Files:** `engine/ui/cards/Moment.tsx` (`MomentFrame`, `MomentView`), `engine/ui/cards/moment.css`,
`engine/ui/spin/Origin.tsx`, `engine/ui/spin/spin.css`, `engine/ui/cards/moment.test.tsx`,
`engine/ui/spin/Spin.test.tsx`, `e2e/moment.spec.ts`, `e2e/origin-effects.spec.ts`.

- `MomentFrame` loses `words`. Its list is, in this order: `own` ("Caught by …."), "Also on the post then: …",
  "What else was on the post then wasn't recorded.", and always, last, "Nothing you do here is saved." The last line
  is drawn only when the moment is read and not null.
- **Over a post** the list stays the glass panel at the frame's foot (`.kb-moment-list`).
- **In the ORIGIN box** the list leaves the content area. Origin draws an empty `div.kb-origin-foot` after
  `div.kb-origin-area`, inside `.kb-origin`, and hands its element to `MomentView` (`listInto?: HTMLElement |
  null`); `MomentFrame` portals the list into it when given. The foot is the board's small print on the box's own
  ground (move the `[data-kb-content] .kb-moment-list` rules of moment.css :156 to it; no dotted rule is needed
  outside the area). The foot is marked `data-kb-over-ink` as the box's other lifted parts are, and takes no room
  while it is empty.
- The frame's group label and the status lines ("Loading the moment…") are unchanged.

**Tests first:**

1. A read moment's list has no line for a drawn card, and ends "Nothing you do here is saved."
2. A moment that is loading, failed or null does not say it.
3. In the box the list is not inside `[data-kb-content-area]`, and it is inside `.kb-origin`.
4. `e2e/origin-effects.spec.ts`: with a Whoops! moment in the box, the area's bottom-left corner is solid ink (test 2
   holds this for a live box) and the list's box does not intersect the area's.
5. `e2e/moment.spec.ts`: its first test ("the tag and list cover no words outside the moment") still passes over a
   post.

## Task 5. Whoops!

Model: sonnet

**Files:** `instances/divided-world/cards/whoops/Effect.tsx`, `Effect.test.tsx` (`describe('in a moment, still')`,
:2045).

Every `still` gate goes; the effect no longer reads `still`. In a moment (`moment !== null`) it is the live effect
for a reader who is nobody: the scrub listeners are bound (:1300), the ink is claimed (:1032), the sweep runs
(:1400), the controls are the reader's (Hold to scrub; never the author's tool choice, which `reader.author` already
gates, :1531), a layer washed clean fades (:711), the words are inert while a line is covered (:1579), the readout
and the uncovered news are said (:1478, :1492). The view is the live view. `save` is never reached, because the
save queue is the author's (:1024).

**Tests first** (rewrite the still block as `describe('in a moment')`, driving the Effect with `still: false,
moment: { at }`, `reader` nobody, a spying `save`):

1. A layer saved 40% washed then starts 40% washed, and a scrub over it washes more, on this screen.
2. `save` is never called, whatever is scrubbed, and no stroke is queued.
3. The words are inert while a line is covered, and the view's controls hold Hold to scrub; holding it sweeps at
   `SWEEP_PX_S` and reads each uncovered line, as live.
4. With `reader` forced to `{ author: true }` and a moment, the author's tool choice is still absent and `save` is
   still never called: gate both on `moment === null` as well, since a moment's reader is nobody by the engine's word
   and the effect must not depend on it alone.
5. Remounted (Reset), it is 40% washed again.

## Task 6. Autocorrect

Model: sonnet

**Files:** `instances/divided-world/cards/autocorrect/Effect.tsx`, `Effect.test.tsx` (:442, :1012).

The `still` gates go (:221, :303, :317, :510, :962, :1078, :1090). In a moment every hand is a reader's peek: the
strip lifts and lays back, and is never saved. The anchors are buttons, the residue joins the shine loop, the size
observer is bound. The author's peel and the author's hold are gated on `moment === null` as well as on
`reader.author` (:577, :729).

**Tests first:** a strip peeled by the author then starts peeled; a reader's held Enter on a stuck strip's anchor
lifts it and it lays back; `save` is never called; with `reader.author` forced true and a moment, a peel still lays
back and nothing is saved; no "Stuck on for…" hold is shown.

## Task 7. You Were Saying?

Model: sonnet

**Files:** `instances/divided-world/cards/you-were-saying/Effect.tsx`, `Effect.test.tsx` (:544).

This effect keeps reading `still`, for History. Split the two: `still` (History) is as today. In a moment
(`moment !== null`, `still` false) it is the live effect for a reader who is nobody: the tail types in when the post
enters view, the erase works (pointer hold, Backspace hold, the toggle) and is local, and a play whose state says
cleared for this version draws no tail. A `waiting` tail is not drawn in a moment (design section 3). The author's
saved clear (:128) is gated on `moment === null` as well. The `show` call made only under `still` (:248) goes: the
frame no longer takes words, and History's sink does nothing.

**Tests first:** the still block is renamed for History and keeps its assertions but the `show` one; a new
`describe('in a moment')`: types in on view, erases locally, `save` never called (also with `reader.author` forced
true), a waiting tail draws nothing, a tail cleared then draws nothing.

## Task 8. Feelin' Fab, Glitter Bomb, THIS

Model: sonnet

**Files:** `instances/divided-world/ui/feelin-fab/Effect.tsx` and its test (:415, :489, :599, :904);
`instances/divided-world/ui/glitter-bomb/Effect.tsx` and its test (:286, :567, :586);
`instances/divided-world/ui/this/Effect.tsx` and its test (:225).

- **Feelin' Fab:** the still branch goes (:110, :205, :233, :243, :253). In a moment it is the live foil: the
  worker, the shine loop, the level by `plays.length`.
- **Glitter Bomb:** the still branch goes (:112, :117, :165, :229, :259, :287). In a moment it is the live effect:
  its burst when its origin has been mid-view, the pointer's pickup, the per-mount seed.
- **THIS:** `still` leaves its dependency list (:164). Nothing else changes.

None of the three reads `moment` at all. **Tests first:** each still test becomes a moment test asserting the live
form (Fab registers with the loop; Glitter's burst arms and its cling registers; THIS draws the same), and that
`save`, `release` and `met` given as spies are never called.

## Task 9. Hot Box

Model: sonnet

**Files:** `instances/divided-world/ui/hot-box/Effect.tsx`, `Effect.test.tsx` (`describe('a moment (still)')`,
:2004; also :1074, :1442, :1631).

- The clock: where the effect reads the time (`useAt`, :480; `strength(api.now(), playedAt, ends)`), a moment's is
  `moment.at`, fixed. So the standing play is chosen at the moment's time, and the strength is the strength then.
- Every other `still` gate goes (:524, :653-671, :691, :779, :787, :794, :873, :963, :981, :982, :990): the field,
  the drift, pointer clearing, the Lens hold "Wave the smoke", the way-line, the live region, the inert words.
- The waved window's focus hand-off (`markOf`, :946) finds the mark Task 3 gives the box; where it finds none it
  leaves focus where it is.

**Tests first:** a play whose `ends` is behind today's clock is drawn in a moment whose `at` is before it; its
strength is `strength(at, …)` and not full and not zero (pick `at` a day and a half in); advancing the fake clock
three days changes nothing; pointing clears smoke locally; the hold sweeps and opens the waved window; the words are
inert while smoked; `save`, `release` and `met` are never called.

## Task 10. Steel Chair

Model: sonnet

**Files:** `instances/divided-world/ui/steel-chair/Effect.tsx`, `Effect.test.tsx` (`describe('a moment
(still)')`, :1186), `instances/divided-world/ui/steel-chair/body.ts` (the comment on `settle`, :497).

- The plays: in a moment every play handed is drawn (:228-231); a live post keeps its clock.
- The still run goes (:555, :561-562, :608, :430, :554): in a moment the run is the live run. It arms when the post
  has been mid-view, uses a fresh seed, flies, shakes, sounds (`loud = !reduced`), and is cleared when the post
  leaves view. Throw again is in the view's controls (:653). `settle()` stays for reduced motion.
- If PR #771's build has merged, its still-run observers and their test go here too.

**Tests first:** a play whose `ends` is behind today's clock is thrown in a moment; the run waits for the post to
be in view; the hit sounds are asked of the mixer; under reduced motion it is settled at once and silent, as live;
Throw again throws again; `met` is never called.

## Task 11. Whodunnit? and Blind Study

Model: inline

**Files:** `instances/divided-world/ui/whodunnit/Effect.tsx` (:24, :32, :57),
`instances/divided-world/ui/blind-study/Effect.tsx` (:18, :38), and each one's test (`whodunnit` :142,
`blind-study` :75, :82).

In each, the time `over` is judged at is `moment?.at ?? useAt(...)`'s (call the hook always; choose after), and the
`still` gate on `over` goes. The `met` gate becomes `moment === null`. **Tests first:** with `ends` behind today's
clock and `moment.at` before it, no wore-off line and the state is "Author hidden from everyone" / "Totals hidden
from you"; with `moment: null` and the same clock, the wore-off line shows (the live case, already tested, stays).

## Task 12. Below the Fold and Laugh Track

Model: sonnet

**Files:** `instances/divided-world/ui/below-the-fold/Effect.tsx` and its test (:105);
`instances/divided-world/ui/laugh-track/Effect.tsx` and its test (`describe('Laugh Track: a play's moment
(still)')`, :674).

- **Below the Fold:** the `still` gates go (:34, :47, :57, :67). In a moment `fold` is absent, so it draws its own
  bar in the words; the post starts folded, the bar opens it and folds it again. `met` is the engine's no-op.
- **Laugh Track:** the `Moment` component (:111-124) and the branch that picks it (:327) go. In a moment it is
  `Live`: the cues are matched against the post as given (the moment's version), the murmur and the cues sound under
  Game sounds, the captions are said, and the keyboard path (the roving buttons) works.

**Tests first:** Below the Fold in a moment starts folded with an enabled bar; pressing it shows the words; pressing
again folds. Laugh Track in a moment registers its places, a press on a place asks the mixer for the cue, and the
view's controls hold Game sounds.

## Task 13. The contract held for every card, stories, and the prose

Model: sonnet

**Files:** `instances/divided-world/ui/still.test.tsx` (renamed `moment.test.tsx`),
`instances/divided-world/ui/OriginEffects.board.stories.tsx`, `instances/divided-world/ui/whoops/Lens.board.stories.tsx`,
`e2e/moment.spec.ts`, `e2e/origin-effects.spec.ts`, `e2e/spin-at-post.spec.ts`, the header comments of
`engine/ui/cards/Moment.tsx`, `engine/ui/cards/Effects.tsx` and `engine/ui/spin/Origin.tsx`, and
`instances/divided-world/cards/jimmy-wails/Effect.tsx` and `instances/divided-world/cards/graffiti/Effect.tsx`
(a comment each, no code).

- **The instance's contract test**, over every card of the instance that `playsInMoment`, plus Glitter Bomb (drawn
  only as a spin's own play). For each, rendered with `still: false`, `moment: { at }`, `reader` forced to
  `{ author: true, caster: true }` (the engine never gives that; the test holds the effect to the contract without
  it), spying `save`, `release`, `give`, `met` and `holdScreen`: press, drag and key every element as today's test
  does (:58-66), advance the timers, and assert none of the five was called with effect (`holdScreen(true)` never).
  The "nothing is inert" assertion goes: an obstacle makes the words inert in a moment as it does live.
- **The list it runs over is asserted:** it holds Whoops!, Autocorrect, You Were Saying?, Feelin' Fab, THIS, Hot
  Box, Steel Chair, Whodunnit?, Blind Study, Below the Fold and Laugh Track, and does not hold Stick Around,
  Graffiti or Jimmy Wails.
- **Only a writing card reads `still`:** for every other card with an effect, rendering with `still: true` and with
  `still: false` (both `moment: null`) gives the same markup after the timers settle. Jimmy Wails and Graffiti are
  left out by name with a comment citing issue #774: their still code is unreachable until then and is plan 2's to
  replace. Put that comment at the head of each one's still code too.
- **Stories.** `WhoopsLanded` and `GlitterSpun` (OriginEffects) and `WashedCleanAsItLanded` (whoops/Lens) now show
  playable moments. Add, in OriginEffects: a box spun from a Steel Chair play on a post with an older, part-washed
  Whoops! (two marks; the owner's case for section 6), and a Hot Box moment. Each at desktop and phone.
- **Specs.** `e2e/moment.spec.ts`: Reset is in the tag, and the tag still clears the marks on a phone. In
  `e2e/origin-effects.spec.ts`: scrubbing in the box's Whoops! moment washes ink, Reset brings it back, and no
  request is made between the two (assert on the page's requests); test 13 ("scrolled out of view, nothing is drawn
  for the box") holds for a moment's box. `e2e/spin-at-post.spec.ts`'s "still glitter in the box" assertion becomes
  the live glitter's.
- **Prose.** Rewrite the three header comments for what is now true, citing this design. Search the current
  documents (`README.md`, `specs/`, `CLAUDE.md` is not to be edited) for a sentence that says a moment is still, and
  correct any found; none was found on 2026-11-16.

## What follows

Issue #774: its design and plan, then its build, whose last step removes the `surface` and `drive` conditions from
`playsInMoment`, the two cards' still code, and the two names left out of Task 13's test.

## Review focus

- **A mask.** Every effect in a moment must take the reader's path whatever `reader` says: confirm no author or
  caster branch is reachable with `moment !== null` in Whoops!, Autocorrect and You Were Saying?, and that nothing
  in a moment differs for the post's author.
- **Nothing sent.** Confirm no request, Realtime message or stored preference follows any input in a moment, the
  sound toggle aside (Game sounds is the reader's own setting, and live it is saved wherever it is saved today; say
  in the PR which).
- **View order over a post.** The live effect's cleanup and the moment effect's first `show` race on one store key
  (Task 3). Confirm the Lens never shows an empty view after As it landed, Back to now, or Reset.
- **A second run.** Reset during a Steel Chair flight, a Whoops! sweep, a held Hot Box wave and a typing tail:
  nothing of the old run draws, sounds or keeps a timer after the remount.
- **A busy page.** A spun thread's first page with a heavy box (Whoops! at three layers over Feelin' Fab) under a
  heavy opening post: the box's canvases free out of view, and `e2e/origin-effects.spec.ts` 12 to 14 hold.
- **Acts an instance already holds.** A play from before snapshots (`recorded` false) draws the play alone, now
  playable; a moment whose version was edited since; a play ended by an admin since the moment (drawn in the moment,
  gone from the live post).
- **Sound on arrival.** A spun thread opened on a Steel Chair moment before any gesture: nothing throws an error,
  and the captions are right whether or not the mixer is unlocked.
- **A dead end.** Below the Fold in a moment can always be opened; a waiting tail never shows; no takeover is drawn.
