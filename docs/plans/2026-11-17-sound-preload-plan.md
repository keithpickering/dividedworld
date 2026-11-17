Record, written 2026-11-17.

# Sounds ready before they are needed: plan

Carries out `docs/plans/2026-11-17-sound-preload-design.md`. One PR from `main`.

Every task goes test first: write the failing test, record its red run, then the code. During a task run only the
tests for the changed code (`node --experimental-strip-types --test engine/ui/audio/mixer.test.ts` for the mixer,
`npx vitest run <file>` for the rest). Run `npm run typecheck` and `npm run build` once after the last task, with the
tail in the PR. No deployed database, bucket or connector is touched, and no migration is added.

**The layers.** Tasks 1 to 3 are engine code: they name no card, no sound key and no instance, and their tests use
made-up keys. Tasks 4 and 5 are Divided World's.

## Task 1. The mixer warms, and a play can be too late

Model: sonnet

**Files:** `engine/ui/audio/mixer.ts`, `engine/ui/audio/mixer.test.ts`.

What changes in `createMixer`:

- `MixerDeps` gains `now?: () => number`, a clock in milliseconds; absent, the mixer uses `() => performance.now()`.
- The one cache `buffers` (src to a decode promise) becomes two. `bytes` maps src to the fetch's promise
  (`Promise<ArrayBuffer | null>`), and needs no context. `buffers` maps src to the decode's promise and is filled
  only once a context exists. `decoded(c, src)` takes the bytes from `bytes`, fetching them if absent, then decodes.
  `decodeAudioData` detaches the `ArrayBuffer` it is given, so once a decode has started for a src, that src's
  `bytes` entry is deleted. A failure at either step deletes both entries for the src, as a failure deletes today's
  entry, so the next `warm` or `play` fetches again.
- A `warmed: Map<string, SoundSlot>` (by src) remembers every slot asked for.
- `warm(slots: readonly SoundSlot[]): void` is added to `Mixer`. For each slot, it records the slot in `warmed`. If
  the slot's bus is on, it fetches the bytes when `bytes` and `buffers` hold nothing for its src, and, if `ctx` is
  set, it calls `decoded(ctx, src)`. It returns nothing, catches everything, and makes no context.
- `setBus(bus, { on: true })` warms again every slot in `warmed` on that bus (the same step as `warm`).
- `unlock()`, once `ctx` is set, calls `decoded(ctx, src)` for every slot in `warmed` whose bus is on, without
  awaiting them (unlock resolves as soon as the context resumes, as today).
- `play(slot, { lateMs })`: the time of the call is taken from `now()` before `ready()`. After `ready()` resolves, if
  `lateMs` is a finite number and `now() - asked > lateMs`, the play resolves `null` and starts no source, and it
  neither replaces nor fades out its group's voice. Without `lateMs` nothing changes. `loop` takes no `lateMs`.
- The header comment says that a file is fetched and decoded once a page, either by a play or by `warm`. It says that
  `warm` fetches at once and decodes at the first unlock, that a bus that is off fetches nothing until it is turned
  on, and that `lateMs` drops a play rather than sounding it late.

Tests first, in `mixer.test.ts` (the fakes there already count fetches and decodes; give the deps a `now` the test
moves):

- `warm` before unlock fetches each src once and decodes nothing; `unlock` then decodes each warmed src once, and a
  `play` of a warmed src after that fetches and decodes nothing more.
- `warm` after unlock fetches and decodes at once.
- `warm` on an off bus fetches nothing; `setBus` on fetches it; `setBus` off and on again fetches nothing more.
- Two `warm`s of one src, or a `warm` and a `play` together, fetch once and decode once.
- A failed fetch through `warm` is forgotten: the next `play` fetches again and sounds.
- A failed decode deletes both entries for the src: the next `play` fetches again and decodes again.
- `warm` makes no context (the existing test 1's assertion, for `warm`).
- `lateMs`: a play whose decode resolves after the clock has moved past `lateMs` resolves `null`, starts no source,
  and leaves the group's current voice sounding (its gain gets no fade-out). One that resolves within `lateMs`
  sounds. One with no `lateMs` sounds however late it resolves.

## Task 2. The page warms, and `play` carries `lateMs`

Model: sonnet

**Files:** `engine/ui/audio/sound.ts`, `engine/ui/audio/sound.test.tsx`, `engine/ui/audio/test-sound.ts`.

- `realDeps` gains `now: () => performance.now()`.
- `SoundPlay.play`'s options gain `lateMs?: number`, passed to the mixer. A play the mixer answered `null` for
  lateness is captioned like any skipped game sound (the existing `else if (slot.bus === 'game')` branch); nothing
  new is needed there, and the comment above `play` says so.
- `export function useWarmSounds(keys: readonly string[] | undefined): void`. It reads `useKayfa().ui.sounds`,
  resolves the keys to slots (a key with no slot is skipped silently: `instanceUiProblems` holds that there is
  none), and in an effect calls `page.arm()` and `page.mixer.warm(slots)`. The effect's dependency is the keys
  joined, so a new array with the same keys does not warm again. It never throws, even in development.
- `fakeSound()` in `test-sound.ts` is unchanged except that its deps get a `now` (`() => 0`).

Tests first, in `sound.test.tsx`:

- `useWarmSounds(['a', 'b'])` on a page whose `ui.sounds` has `a`, `b` and `c`, with the game bus on, fetches `a`
  and `b` and not `c`, and makes no context before a gesture.
- An unknown key is skipped and does not throw in development.
- Rendering again with an equal but new array fetches nothing more.
- `play(key, { lateMs })` that the mixer answers late says the game caption for `CAPTION_MS`.

## Task 3. Cards name their sounds; the engine warms them and checks them

Model: sonnet

**Files:** `engine/ui/cards/types.ts` (`CardUi`), `engine/ui/cards/Effects.tsx` (`BoundEffect`),
`engine/ui/cards/Effects.test.tsx`, `engine/ui/tips/problems.ts` (`instanceUiProblems`),
`engine/ui/tips/problems.test.ts`, `engine/ui/account/appearanceRows.tsx` (`SoundRow`) and its test.

- `CardUi` gains, after `takeover`:
  `readonly sounds?: readonly string[];` with the comment "The keys of the instance's sounds (`InstanceUi.sounds`)
  this card's effect may play. The engine warms them when a post wearing the card is drawn, so they are ready
  before the effect asks (docs/plans/2026-11-17-sound-preload-design.md)."
- `BoundEffect` calls `useWarmSounds(useKayfa().ui.cards.find((c) => c.key === card)?.sounds)`, before its
  `Suspense`, so the sounds warm while the effect's code loads. It reads `ui` from `useKayfa()`, as `PostEffects` does.
- `instanceUiProblems`'s `ui` parameter takes `Partial<Pick<InstanceUi, 'themes' | 'sounds'>>`. For every card in
  `ui.cards` with `sounds`, each key that is not a slot's key in `ui.sounds?.slots` adds the problem
  `the card "<card key>" names the sound "<sound key>", which the instance's sounds do not have`. The header comment
  lists the new check.
- `SoundRow` calls `useWarmSounds(preview === undefined ? undefined : [preview])`.

Tests first:

- `problems.test.ts`: a card naming a sound the instance has passes; one naming a missing key gives exactly the
  problem above. This is the check's poison: the check removed, the second case is red.
- The effects test: a post with a card whose `sounds` are `['x.one']`, mounted with `fakeSound()` and the game bus
  on, fetches `x.one`'s src before the effect's lazy component resolves.
- The appearance-rows test: the game row with a preview fetches the preview's src on mount when the game bus is on.

## Task 4. Divided World names its cards' sounds

Model: haiku

**Files:** `instances/divided-world/ui/cards/steel-chair/ui.ts`, `instances/divided-world/ui/cards/laugh-track/ui.ts`,
`instances/divided-world/ui/index.test.tsx`.

- Steel Chair's `ui` gets `sounds: ['steel-chair.hit', 'steel-chair.settle-1', 'steel-chair.settle-2',
  'steel-chair.settle-3', 'steel-chair.settle-4'],`.
- Laugh Track's `ui` gets `sounds:` the twelve keys `laugh-track.laugh-1` to `-3`, `laugh-track.cheer-1` to `-3`,
  `laugh-track.boo-1` to `-3`, `laugh-track.titter`, `laugh-track.ooh`, `laugh-track.grumble`.
- `index.test.tsx` already runs `instanceUiProblems(instanceUi, instance)` against the whole instance UI, so the check
  reaches these lists with no change there. Add a test that each card's `sounds`
  list equals the keys its effect plays: for Steel Chair the five above, for Laugh Track the twelve. Write it red
  first, with the lists absent.

## Task 5. Steel Chair clangs on every run, and never late

Model: sonnet

**Files:** `instances/divided-world/ui/steel-chair/Effect.tsx`, `instances/divided-world/ui/steel-chair/Effect.test.tsx`,
`instances/divided-world/ui/cards/steel-chair/ui.ts`, `instances/divided-world/ui/index.test.tsx`.

- `Effect.tsx`: `startRun` sets `loud = !still && !reduced`. `Memory` loses `first`, along with its uses in
  `startRun` and `control.current.replay`. The two `play` calls in `onEvent` pass `lateMs: LATE_MS` beside `group`,
  where `export const LATE_MS = 120` is declared beside `SETTLE_SOUNDS` with the comment "How late a hit's or a
  settle's sound may start and still be heard as that hit's, in milliseconds; later, it is skipped and its caption
  shows (docs/plans/2026-11-17-sound-preload-design.md, 2.3)." The header comment's "Sound." paragraph says that
  every animated run sounds, whether it started from a scroll, from Throw again or from a new play landing, and
  that a reduced or still draw does not. It names the two limits that keep a thread from being a wall of clangs (the
  one group, and the 300 ms in view) and says that a sound later than `LATE_MS` is skipped. The comment above
  `memory` drops "whether the next run is the first, which alone has sound".
- `Effect.test.tsx`: the test "on the first run a hit and one settle sound play once per chair, in the group; a replay
  by scroll or by Throw again is silent" becomes "every run plays a hit and one settle sound per chair, in the group
  and with lateMs LATE_MS: the first, a replay by scroll and one by Throw again". Its two
  `expect(hub.sound.play).not.toHaveBeenCalled()` become the same counts as the first run. The test "after the last
  play ends and a new one lands, the new run is silent and the card is not met again" becomes "...the new run
  sounds and the card is not met again". The reduced-motion and `still` tests stay silent and unchanged. Red first:
  change the tests, run them red, then the effect.
- `ui.ts`'s `describe` replaces ", with Game sounds on, it clangs the first time." with ", and with Game sounds on
  it clangs each time, unless motion is reduced." So the sentence reads: "It plays again each time the post
  scrolls into view, somewhere else each time, and with Game sounds on it clangs each time, unless motion is
  reduced." Update the expected string in `index.test.tsx` (near the `chair.describe(instance.settings)` assertion)
  to match, red first.
- Note on #733: this closes its F4. Tick F4 there with a link to the PR once it merges.

## Screen check

In the e2e build, on a thread with a Steel Chair post and Game sounds on (the build session's own check, by ear
where it can; otherwise by the captions and the play calls):

- The first clang after a reload, with the network throttled to "Fast 3G" in Playwright's CDP session, is either on
  the hit or skipped with its caption showing; it never lands after the dent has settled.
- Scrolling the post out and back clangs again; "Throw again" clangs again.
- Under reduced motion nothing sounds.
- With Game sounds off, nothing under `/assets/` with an `.mp3` name is requested.

## Review focus

- A busy thread: a page with many Steel Chair and Laugh Track posts fetches each file once in all, not once per
  post; check that `warm` keys by src and that `BoundEffect`'s re-renders do not warm again.
- Laugh Track's twelve files (about 1.1 MB) now load on any page showing a Laugh Track post, for a reader with game
  sound on; confirm that is acceptable, or record it on the design's open question.
- `decodeAudioData` detaches its bytes: a decode that fails after a warm must leave nothing behind that a later play
  could hand a detached buffer to.
- A late play must not fade out its group's current voice: a skipped clang must not cut off the one still sounding.
- Every run sounding: a fast scroll through several chaired posts, each held about 300 ms, should give at most one
  clang at a time (the shared group), not a pile-up.
