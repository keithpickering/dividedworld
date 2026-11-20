Record, written 2026-11-20.

# Sounds that overlap, and captions that stack: plan

Carries out `docs/plans/2026-11-20-sound-stack-design.md`. One PR from `main`.

Every task goes test first: write the failing test, record its red run, then the code. During a task, run only the
tests for the changed code: `node --experimental-strip-types --test engine/ui/audio/mixer.test.ts` and
`node --experimental-strip-types --test engine/ui/audio/captions.test.ts` for the two node suites, and
`npx vitest run <file>` for the rest. Run `npm run typecheck` and `npm run build` once after the last task, with the
tail in the PR. No deployed database, bucket or connector is touched, and no migration is added. No check is added,
so there are no poisons to plant. Each new behavior's red run is its test failing against today's code.

**The layers.** Tasks 1 to 3 are engine code: they name no card, no sound key and no instance, and their tests use
made-up keys and words. Task 4 is Divided World's.

## Task 1. A group is a pool of voices, and a limiter guards the output

Model: sonnet

**Files:** `engine/ui/audio/mixer.ts`, `engine/ui/audio/mixer.test.ts`, `engine/ui/audio/sound.ts`,
`engine/ui/audio/sound.test.tsx`.

What changes in `createMixer` (design 2.1 and 2.2):

- `Mixer.play`'s options gain `voices?: number`. `const cap = Number.isFinite(o.voices) && o.voices >= 1 ? Math.floor(o.voices) : 1`.
- `groups` becomes `Map<string, Voice[]>`, where `Voice = { source: SourceLike; end(fadeMs: number): void }`, oldest
  first. In `play`, after the `lateMs` check and before `start`, while the group's list holds `cap` voices or more,
  shift the oldest and call its `end(fadeMs)`. The new voice is pushed at the end. Its `onended` removes that voice
  from the list by its `source` and deletes the map entry when the list is empty. A late play still returns before
  any of this, so it ends nothing.
- `loop`: a loop in a group ends every voice in the list (`end(0)`, as the one prior today) and the list becomes
  `[the loop]`. Its own `end` removes it from the list by source instead of the `groups.get(o.group)?.source === source`
  check. A loop's `end` called by a later play is the `'replaced'` stop, as today.
- **The limiter.** `AudioContextLike` gains an optional
  `createDynamicsCompressor?(): CompressorLike`, where `CompressorLike` is
  `{ threshold, knee, ratio, attack, release: { value: number }; connect(to: unknown): unknown; disconnect(): unknown }`.
  A module-level `export const LIMITER = { threshold: -1, knee: 0, ratio: 20, attack: 0.002, release: 0.1 } as const`.
  A new `output(c)` makes, once per context, the node that both buses connect to: a compressor with `LIMITER`'s
  values, connected to `c.destination`. Where `createDynamicsCompressor` is absent or throws, the output is
  `c.destination` itself. `busNode` connects to `output(c)` instead of `c.destination`.
- The header comment: replace "a sound in no group overlaps whatever else sounds" with a sentence that a group holds
  up to `voices` voices (1 when unnamed) and fades out its oldest to make room, and a sound in no group overlaps
  whatever else sounds. Add a sentence that the buses meet in a limiter before the speakers, so overlapping sounds
  press down instead of clipping, and that a sound at or under −1 dBFS passes it unchanged. Update the doc comment on
  `groups` to match.

Tests to write first, in `mixer.test.ts`'s `describe('mixer')`, numbered on from the last:

- `FakeContext` gains `compressors: FakeCompressor[]` and `createDynamicsCompressor()`, which records one whose five
  params are `{ value }` objects and whose `connect(to)` records `to`. `FakeGain.connect(to)` records `to` as `FakeSource`'s does.
  Add a `noCompressor` flag that deletes the method, and a `throwCompressor` flag that makes it throw.
- With `voices: 3`, three plays in group `g` start three sources and stop none (`stoppedAt` undefined on all three).
- With `voices: 3`, a fourth play stops the first source only, at `now + max(fadeMs, EDGE_MS)/1000` (reuse the existing
  fade-out assertions' shape), and the second and third are not stopped.
- With `voices: 3`, after the first source's `onended` fires, a fourth play stops nothing.
- `voices` of `NaN`, `0`, `-1` and `Infinity` each behave as 1 (the second play stops the first), and `2.7` behaves as 2.
- Three plays with `voices: 3`, then one with `voices: 1`, stop all three.
- A late play (`lateMs: 0` with the clock moved during the decode, as the existing late test does) into a full pool
  of `voices: 2` stops nothing.
- A loop into a group holding two plays stops both. A play with `voices: 2` after the loop leaves the loop sounding
  and stops nothing; a third play with `voices: 2` stops the loop, whose `onStop` is called with `'replaced'`.
- The existing group tests (one voice, `fadeMs` crossfade, the loop replaced by a play) pass unchanged. They are
  the proof that a group with no `voices` is today's group.
- On unlock and the first play, one compressor is made with `LIMITER`'s five values, it is connected to
  `ctx.destination`, and the bus gain is connected to it. A second play on the other bus makes no second compressor.
- With `noCompressor`, and again with `throwCompressor`, the bus gain is connected to `ctx.destination` and the play
  resolves `{ lengthMs }`.

The page's `play` carries `voices`: `SoundPlay.play`'s option type in `sound.ts` gains `voices?: number`, and its doc
comment says it is the group's cap. `play` already hands `opts` to `page.mixer.play` whole, so only the type changes.
Its test, written first in `sound.test.tsx` beside "play(key, { group, fadeMs, tailMs }) hands the tail to the
mixer": two plays of one slot in group `g` with `voices: 2` both sound (two sources started, neither stopped). It is
red before the mixer change.

## Task 2. The caption store holds lines, counts repeats and keeps the announcements

Model: sonnet

**Files:** `engine/ui/audio/captions.ts`, `engine/ui/audio/captions.test.ts`, `engine/ui/audio/sound.test.tsx` (its
uses of `captions.current()`), `web/src/demo.ts` (no change expected; confirm `say` still fits it).

The store's interface after the change (design 2.3 and 2.4):

```ts
export const CAPTIONS_SHOWN = 3;
export const QUIET_MS = 700;
export const SAID_MS = 2500;
export interface CaptionLine extends CaptionWords {
  /** Stable for the line's life, so the stack keys on it. */
  readonly id: number;
  readonly held: boolean;
  /** How many says this line has had; 1 for a held line. */
  readonly count: number;
}
export interface Announcement { readonly seq: number; readonly text: string }
export interface Captions {
  say(words: CaptionWords & { readonly ms: number }): void;
  hold(id: string, words: CaptionWords): void;
  release(id: string): void;
  reset(): void;
  subscribe(listener: () => void): () => void;
  /** The lines showing, oldest first; the same array until something changes. */
  lines(): readonly CaptionLine[];
  /** What the live region holds now, oldest first; the same array until something changes. */
  announcements(): readonly Announcement[];
}
```

- `current()` and the module's `current` export go. `Caption` goes, and `CaptionLine` takes its place.
- A said line keeps its `end` (the store's `Date.now()` plus `ms`, the later on a repeat) and one `setTimeout` to
  that end, cleared and set again on a repeat. Two says match when `text` and `ink` are both equal (`ink` absent on
  both counts as equal).
- Held lines are kept by words (text and ink), each with the set of hold ids on it. A map from hold id to its words
  lets a hold under the same id with new words leave the old line (which goes when its set is empty) and join the
  new one. A hold under the same id with the same words changes nothing and notifies no one.
- Lines are ordered by when they first showed, said and held together. A repeat or a hold joining an existing line
  does not move it.
- When a new said line would make the list longer than `CAPTIONS_SHOWN`, the oldest said line leaves first (its
  timer cleared, its leave counted as below). If none is said, the new line is added as one more.
- Announcements: a new said line pushes `{ seq, text }` at once. A repeat (re)starts that line's quiet timer of
  `QUIET_MS`. When the quiet timer fires, or when the line leaves (at its end, or pushed out by a newer line; `reset`
  is not a leave and announces nothing), and its count is above the count last announced, push
  `{ seq, text: `${text}, ${count} times` }` and record the count as announced. Every announcement has its own
  `setTimeout` of `SAID_MS` that removes it. Held lines push nothing.
- `reset()` clears lines, holds, announcements and every timer, then notifies.
- `lines()` and `announcements()` return a cached array, replaced only when something in it changes, so
  `useSyncExternalStore` sees a change only when there is one.
- The header comment says what the design says: lines, repeats counted, at most three, holds never pushed out, and
  the announcements. Every line still names its way out.

Tests to write first, in `captions.test.ts` (node's mock timers, as the file uses now; replace the tests of the
one-caption rule, which this design retires, and keep every test of a hold's and a say's own way out):

- One say shows one line with count 1 and `held: false`. The same words and ink said again give one line, count 2,
  same `id`.
- Same text with another ink gives two lines.
- Said for 1,000 ms, then at 500 ms said again for 200 ms: the line is still there at 999 ms and gone at 1,000 ms.
  Said again at 500 ms for 900 ms instead: there at 1,399 ms, gone at 1,400 ms.
- Order: say A, say B, say A again leaves `[A ×2, B]`.
- Four different says leave the last three, and the first is gone.
- Hold H, then three different says: H stays with the two newest says, since H counts toward the three. Three holds
  and then a say: four lines, all of them shown.
- Two hold ids with the same words make one held line. Releasing one keeps it, and releasing both removes it. A hold
  re-said with new words under the same id moves it, and the old line goes if no other id holds it.
- `lines()` returns the same array between two calls with nothing in between, and after a hold re-said with the same
  words under the same id.
- Announcements: a first say pushes its text. Three repeats within `QUIET_MS` of each other push one
  `"…, 4 times"` `QUIET_MS` after the last. A line that ends before its quiet timer fires pushes its total at the
  end. A line said once pushes nothing more when it ends. A hold pushes nothing. Each announcement is gone
  `SAID_MS` after it was pushed. Every `seq` differs.
- `reset()` empties both lists, pushes no announcement, and no timer fires after it (advance the clock well past
  every end and see no notify).

In `sound.test.tsx`, each `captions.current()` read becomes a read of `captions.lines()` (the text of the last line,
or of the one line). The tests' meaning stays: a play's caption shows for its length, a skipped game play's for
`CAPTION_MS`, a loop's while its gain is above `HELD_FROM`.

## Task 3. The caption stack on screen

Model: sonnet

**Files:** `engine/ui/audio/Captions.tsx`, `engine/ui/audio/captions.css`, `engine/ui/audio/Captions.test.tsx`,
`engine/ui/audio/Captions.board.stories.tsx`, `e2e/captions.spec.ts`.

What changes (design 2.5):

- `Captions` reads `store.lines()` and `store.announcements()` with `useSyncExternalStore`, and the feel with
  `useFeel(useKayfa().ui.glass.motion)` as `Toasts` does. `FADE_MS`, `shown`, `leaving`, the `said` state and its
  clear timers go. `SAID_MS` is now imported from `captions.ts`.
- The live region renders `announcements` as `<p key={seq}>{text}</p>`.
- The drawn stack is one `div.kb-captions` (`aria-hidden="true"`, the fixed and centered box, carrying
  `data-over-scrim` and `--kb-captions-lift`), always rendered while any line shows. Inside it is
  `<AnimatePresence initial={false}>` with a `Line` for each line, keyed by `id`. `Line` is a `motion.div
  className="kb-captions-bar" layout="position"` with `initial={{ opacity: 0, y: feel.distance }}`,
  `animate={{ opacity: 1, y: 0 }}`, `exit={{ opacity: 0, transition: { duration: feel.exit / 1000, ease: bezier(feel.ease) } }}`
  and `transition={{ duration: feel.enter / 1000, ease: bezier(feel.ease) }}`. When `feel` is null it is a plain
  `div` with the same class. It keeps `data-held`, the dot and the words, and when `count > 1` a
  `<span className="kb-captions-count kb-num">×{count}</span>` after the words.
- The layout effect measures `.kb-captions` instead of the bar and runs while `lines.length > 0`. `placeOver` takes the
  stack's rectangle, and the lift is set on `.kb-captions`. The AnimatePresence needs the container to stay mounted
  while the last line's exit plays, so keep `.kb-captions` mounted whenever the component is, and let the measure
  clear `--kb-captions-measured` when it holds no line (measure a zero height as cleared).
- `captions.css`: `.kb-captions` takes the bar's `position: fixed`, `left`, `bottom`, `z-index`, `max-width`,
  `transform` (with the lift), `pointer-events: none` and the over-scrim `z-index`. It is
  `display: flex; flex-direction: column; align-items: center; gap: 6px`. `.kb-captions-bar` keeps the tray (edge,
  panel, chamfer, glow, padding, `max-width: 100%`) and loses `position`, `left`, `bottom`, `transform` and
  `animation`. The `kb-captions-in` and `kb-captions-out` keyframes and the `[data-leaving]` rule go.
  `.kb-captions-count` is the caption's ink at 70% opacity with a 0.5em left margin. The header comment describes
  the stack.
- The component's header comment: a stack of up to three lines, newest nearest the HUD, moving as the toasts move, a
  plain element with the feel off, and the live region's two kinds of announcement.

Tests to write first, in `Captions.test.tsx` (keep its existing over-dialog tests, pointing their queries at
`.kb-captions`):

- Two different says draw two `.kb-captions-bar`, the first said first in document order.
- A say repeated draws one bar whose text ends `×2`, and a single say draws no `.kb-captions-count`.
- A held line's bar has `data-held="true"`, and a said line's has none.
- With `data-kb-motion="reduce"` on the root, a line's bar has no inline `transform` and is gone as soon as the store
  drops it. With `data-kb-motion="full"`, a new bar carries a transform while it enters (the Toasts tests'
  pattern at `engine/ui/alerts/Toasts.test.tsx:345-370`).
- The live region holds the store's announcements: a first say's text, and after three repeats and `QUIET_MS`, the
  total.
- `--kb-captions-measured` is set while lines show and cleared after the last one has gone.

Stories: add "Stacked captions, main" and "Stacked captions, phone 390", whose store holds a said line repeated
three times, a second said line, and a held line, for as long as the story is open.

`e2e/captions.spec.ts`: the existing tests keep reading `.kb-captions-bar` (each line is one). Add, at 390 × 844 and
1280 × 800: three different says through `__kbCaptions` stand as three bars, each inside the 16 px gutters, the
lowest above the HUD by at least the 10 px gap, and each above the next. Then a fourth say leaves three bars, the
first said gone.

## Task 4. Steel Chair's clangs overlap

Model: inline

**Files:** `instances/divided-world/ui/steel-chair/Effect.tsx`, `instances/divided-world/ui/steel-chair/Effect.test.tsx`.

- Beside `LATE_MS`, `export const VOICES = 6;` with the comment "How many of Steel Chair's sounds may sound at once
  on the page; a newer one fades out the oldest past this (docs/plans/2026-11-20-sound-stack-design.md, 2.6)."
- Both `play` calls in `onEvent` pass `{ group: GROUP, voices: VOICES, lateMs: LATE_MS }`.
- The header's "Sound." paragraph: the two limits that keep a thread from being a wall of clangs become the group's
  cap of `VOICES` sounds at once across the page, the limiter the engine puts on every sound, and the 300 ms a post
  must be in view.
- Tests first: every `toHaveBeenCalledWith('steel-chair.hit', { group: 'steel-chair', lateMs: LATE_MS })` gains
  `voices: VOICES` (near lines 1183, 1313 and 1377), and the two `.every(...)` checks near lines 1141 and 1182 also
  require `c[1].voices === VOICES`. Run them red, then change the effect.

## Screen check

In the e2e build, on a thread with a post holding three Steel Chair plays and Game sounds on (the build session's own
check, by the play calls and the captions, since it cannot listen):

- Spy on the page's `AudioContext.prototype.createBufferSource`: during one run, more than one source is started
  before the first has ended.
- The stack shows "A steel chair clangs ×3" and "A chair clatters to the floor ×3", or the second with a lower count
  while the run is still going, and both leave by themselves.
- With the Motion setting off, the lines appear and leave with no movement.
- A Laugh Track post still crossfades: one take at a time.
- Screenshots at 390 and 1280 wide of the stack with three lines and a toast above it, in the PR.

## Review focus

- Laugh Track must not change: `audience` and `audience-build` pass no `voices`, so each must still hold one voice.
  Confirm the existing group tests were not edited to pass.
- The limiter adds Chromium's lookahead (about 6 ms) to every sound on the page. Confirm nothing whose timing is
  tested assumes a sound starts at the call. And confirm a single sound passes it unchanged at bus volume 100,
  against the manifest's peaks.
- A busy page: a group's voice list must shrink as voices end. A source whose `onended` never fires would leak a
  voice and make the cap fade out live sounds early. Check every path that stops a source leaves through `onended`.
- The caption store's timers: one per said line and one per announcement, rescheduled on a repeat and never added.
  After a long session of chairs, nothing is left pending (`reset` and natural ends both clear).
- The toasts stand on `--kb-captions-measured`, so they jump when the stack grows. Check this under a pile of chairs
  on the phone board, and check the stack's lift over a dialog with three lines, where `placeOver` may find no room
  and leave it under the scrim.
- The live region under a pile: at most one announcement for each line's first appearance and one for each line's
  total. Read the region's DOM during the screen check.
- The masks: confirm nothing in the change reads a play's caster, a character's owner or a reaction, and that a
  caption's count comes only from the reader's own page.
