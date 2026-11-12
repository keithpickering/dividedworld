# Laugh Track's reading band, its sound and the cards' forms: plan

Record, written 2026-11-12. Carries out `docs/plans/2026-11-12-laugh-track-band-design.md` (its sections are cited as
§N), task by task.

Every task is test first: the test named, its red run recorded, then the code, then the green run. No task touches SQL
or a deployed service. Tasks 1 and 7 are engine; the rest are Divided World's. One interface is added, the engine's
`SoundSlot.gain` (Task 1), which carries an instance's leveling into the mixer. One check is changed
(`tools/check-sounds.mjs`, Task 2), and its poisons are named there. No state a player, a character or a post can be
put in is added; a cued place that waits its turn is a reader's own screen state and fires or lapses by itself (§2).
No response, payload, Realtime event or timing is added, and nothing here reads who owns, wrote or cast anything (§6).

The form is the glass's world (`docs/plans/2026-10-29-two-worlds-design.md`), out of character and plain. Its look is
the mock the owner approved, `docs/research/2026-11-12-card-forms/01-laugh-track-form.png` (right-hand side), made by
`docs/research/2026-11-12-card-forms/mock.cjs`: every piece is one the play form already draws.

The order: 1 and 2 (sound), 3 to 6 (the band), 7 to 9 (the forms). 1 and 2 do not depend on each other; 5 needs 1, 3
and 4; 6 needs 5; 8 and 9 need 7.

## Task 1. The mixer: ramps on every voice, a tail, a gain for each sound (engine)

Model: sonnet

**Files:** `engine/ui/audio/mixer.ts`, `engine/ui/audio/types.ts`, `engine/ui/audio/sound.ts`,
`engine/ui/audio/mixer.test.ts`, `engine/ui/audio/sound.test.tsx`. Read `engine/ui/audio/test-sound.ts` (the fake
context the tests drive).

**Tests first** (`mixer.test.ts`, new cases after 13; adjust 4, 5 and 8 where they assert a step that becomes a ramp):
14. A play in no group starts its voice at 0 and ramps to its level over `EDGE_MS` (8ms); it never sets a non-zero
    level at the start time.
15. A play with `fadeMs: 0` in a group ramps in over `EDGE_MS`, and the voice it replaces ramps out over `EDGE_MS`,
    not at once.
16. A play with `tailMs: 250` of a 2-second buffer schedules its level at 1.75s and 0 at 2s. A `tailMs` longer than
    the buffer starts the tail at 0. A tail under `EDGE_MS`, or none, still ramps out over the last `EDGE_MS`.
17. A voice replaced during its tail has the tail's ramp cancelled before its fade-out (as case 8 does for a fade-in).
18. A slot with `gain: 0.5` ramps to 0.5, and its loop's `setGain(0.4)` targets 0.2. A slot with `gain: 4` and
    `setGain(1)` targets 4: the clamp is on the caller's 0 to 1, before the slot's gain multiplies it.
19. `setBus` on a bus whose node exists moves its gain with `setTargetAtTime`, never by setting `value`; the first
    `busNode` still sets `value`.
20. A slot with no `gain` behaves as `gain: 1`. A `gain` that is not a finite number above 0 is read as 1.

`sound.test.tsx`: `useSound().play(key, { group, fadeMs, tailMs })` hands `tailMs` to the mixer.

Run `npx vitest run engine/ui/audio` and record the red run.

**Code.**
- `types.ts`: `SoundSlot` gains `readonly gain?: number`, documented: "A multiplier on the sound's own level (1 when
  absent), by which an instance levels its files against each other."
- `mixer.ts`: `export const EDGE_MS = 8`. `Mixer.play`'s options gain `tailMs?: number`. `start` takes the slot's
  level (`gainOf(slot)`) and always ramps from 0 to it over `max(fadeInMs, EDGE_MS)`; for a play it then schedules the
  tail: `setValueAtTime(level, end - tail)` and `linearRampToValueAtTime(0, end)`, where `end` is the start time plus
  `buffer.duration` and `tail` is `min(max(tailMs ?? 0, EDGE_MS), buffer.duration * 1000)` in seconds. A loop gets no
  tail and still starts at 0. `fadeOut` uses `max(fadeMs, EDGE_MS)`. The loop's `setGain` targets
  `clamp(g, 0, 1) * gainOf(slot)`. `setBus` uses `cancelScheduledValues`, `setValueAtTime(node.gain.value, now)` and
  `setTargetAtTime(level, now, 0.015)` when a context is live, and sets `value` when none is.
- `sound.ts`: `SoundPlay.play`'s options gain `tailMs`, passed through.

## Task 2. Levels in the manifest, held by the check (tools, Divided World)

Model: sonnet

**Files:** `tools/check-sounds.mjs`, `tools/test-sounds.mjs`, `tools/measure-sounds.mjs` (new),
`instances/divided-world/ui/sounds/sounds.json`, `instances/divided-world/ui/sounds.ts`,
`instances/divided-world/ui/sounds.test.ts` (new).

**Tests first.**

`tools/test-sounds.mjs`, new poisons over scratch folders, each driving `soundsFaults` red with a fault that names the
file and the field:
1. an entry with no `lufs`;
2. an entry whose `peak` is a string;
3. an entry whose `lufs` is above 0, or is not finite;
4. an entry whose `sha256` is not the SHA-256 of the file's bytes (the file replaced, the numbers kept): the fault
   says "run node tools/measure-sounds.mjs";
5. an entry with no `sha256`.
A folder whose entries carry all three, true to their files, passes.

`sounds.test.ts` (node's runner, as `instances/divided-world/settings.test.ts` is run by `npm run test:engine`):
6. `gainOf({ lufs: -38, peak: -24 })` is 10 (20 dB up to -18); `gainOf({ lufs: -12, peak: -1 })` is about 0.501;
   `gainOf({ lufs: -30, peak: -4 })` is capped by the peak at about 1.413 (3 dB, to -1 dBFS), not 3.98.
7. Every slot of `sounds` has a finite `gain` above 0, and every file in `sounds.json` is a slot's.

Run `node tools/test-sounds.mjs` and `npm run test:engine`; record the red runs.

**Code.**
- `tools/measure-sounds.mjs [--root <directory>]`: for every `instances/*/ui/sounds/` folder, for every entry, runs
  `ffmpeg -hide_banner -nostats -i <file> -af ebur128=peak=true -f null -`, reads the summary's `I:` (LUFS) and
  `Peak:` (dBFS), and writes `lufs` and `peak` (one decimal) and `sha256` (hex, of the file's bytes) into the entry,
  keeping every other field and the file's order and formatting (two-space JSON, a final newline). It says which
  entries changed. With no ffmpeg on the path it says so and exits 1, changing nothing. Its header says it is a tool
  run by hand after a sound is added or replaced, outside the build. It is neither a `check-` nor a `test-` file, so
  `tools/build.mjs` lists it nowhere.
- `tools/check-sounds.mjs`: rules 8 (every entry's `lufs` and `peak` are finite numbers, `lufs` at most 0) and 9
  (every entry's `sha256` is its file's), added to the header's list and to `soundsFaults`. The file's bytes are
  hashed with `node:crypto`; nothing is decoded.
- Run `node tools/measure-sounds.mjs` and commit the manifest it writes.
- `sounds.ts`: imports `./sounds/sounds.json`; `export const TARGET_LUFS = -18`, `export const CEILING_DBFS = -1`,
  `export function gainOf(m: { lufs: number; peak: number }): number` (`10 ** (min(TARGET_LUFS - lufs,
  CEILING_DBFS - peak) / 20)`), and `slot(...)` takes the file's name and sets `gain` from its entry, throwing at
  module load for a file with no entry (the check holds that there is one).

## Task 3. The band's arithmetic (Divided World)

Model: sonnet

**Files:** `instances/divided-world/ui/laugh-track/line.ts`, `instances/divided-world/ui/laugh-track/line.test.ts`.

**Tests first** (new cases):
1. `bandOf(800, 189, 40, 34)` is the stretch from `244.4 - 103.87` to `244.4 + 103.87` (the reading space is 611;
   the band is 34% of it, centered on the line).
2. A band that would pass the top of the window or the HUD's top is cut to the reading space.
3. `inBand` is true when the middle of any box is inside the band, false for a box that only overlaps its edge with
   its middle outside, and false for no boxes.
4. `distance(rects, band)` is 0 for a place in the band, else the gap from its nearest box's middle to the band's
   nearer edge; the pointer still counts double and only brings a place nearer.
5. `murmurGain` is unchanged.

**Code.** `export interface Band { readonly top: number; readonly bottom: number }`; `bandOf(viewportHeight,
hudHeight, linePercent, bandPercent)`; `inBand(rects, band)`; `distance(rects, band, pointer?)` takes the band in
place of the line. `readingLine` stays. The header says the band replaced the line's rest (§1).

## Task 4. The watcher: earning, the queue, the lapse, the held murmur (Divided World)

Model: sonnet

**Files:** `instances/divided-world/ui/laugh-track/watch.ts`, `instances/divided-world/ui/laugh-track/watch.test.ts`.
The header's account of frames and of the one loop is rewritten to match.

`Screen` gains `band` (percent), `airMs` and `holdMs`. `PlaceSpec.fire` returns
`void | Promise<{ lengthMs: number } | null>`. `PlaceSpec` gains nothing else: the order of two places is the order
of their first pieces in the document (`compareDocumentPosition`), read only when one is about to fire.

**Tests first.** Replace "a place resting on the line for the dwell fires once", "a place flung past the line fires
nothing" and "a place that leaves the line and comes back starts its dwell again" with:
1. A place anywhere in the band for the dwell fires once; one outside the band, however long, does not.
2. Dwell adds up: 250ms in the band, a frame out of it (still near), 200ms in it again, fires.
3. A place that leaves the reach (the observer says it no longer intersects) starts from nothing when it returns.
4. A fling: a place in the band for 200ms in all fires nothing.
5. One frame adds at most 100ms: a 5-second gap between two frames with the place in the band adds 100ms.
6. Three places earned in one frame fire in document order, the second `airMs` after the first and the third `airMs`
   after the second, whatever order they registered in.
7. An earned place that leaves the band while it waits fires when its turn comes inside `holdMs`; one whose turn has
   not come by `holdMs` after it left is unearned, does not fire, and fires after it has dwelt in the band again.
8. An earned place that stays in the band waits as long as its turn takes: `holdMs` counts only from leaving.
9. Frames run while a place adds dwell or waits its turn, and stop when none does (extends "frames run while the page
   scrolls or a place waits out its dwell").
10. After a fire whose `fire()` resolves `{ lengthMs: 2000 }` with `fadeMs: 250`, no loop is made and none is raised
    until 1750ms after the fire, then the nearest unfired place's is made and raised; with `fire()` resolving null or
    returning nothing the murmur is held for `airMs`.
11. A second fire during the hold moves the hold to the second take's own end.
12. Places on two posts queue in page order, the earlier post's first.

Keep, adjusted to the band where they name the line: the murmur cases, the busy page (1,200 places: one observer,
three listeners, no frame while still), the unregister and counter cases, Game sounds toggled, the resize.

Run `npm run test:engine` (or the file with node's runner, as the suite runs it) and record the red run.

**Code, `tick(now)`.**
- `band = bandOf(window.innerHeight, hudHeight(), screen.line, screen.band)`; `dt = min(now - last, 100)` where
  `last` is the previous frame's time (0 dt on the first frame after a still page).
- For each near, unfired place: measure; if not earned and `inBand`, `place.dwelt += dt`, and at
  `dwelt >= dwellMs` it is earned (`place.earned = true`, `place.leftAt = null`); if earned, `leftAt` is null while
  in the band and the frame's time when it first is not; an earned place with `now - leftAt > holdMs` is unearned
  (`earned = false`, `dwelt = 0`).
- An earned place the observer drops from `near` keeps its place in the queue: `earnedPlaces` is a set of its own,
  and such a place's `leftAt` is set when it is dropped. An unearned place dropped from `near` has `dwelt = 0`.
- If `earnedPlaces` is not empty and `now >= nextAt`: sort it by document order, fire the first (the existing fire
  path: `fired`, `unfired--`, unobserve), set `nextAt = now + airMs` and `quietUntil = now + airMs`, and when its
  `fire()` resolves `{ lengthMs }` set `quietUntil = firedAt + max(lengthMs - fadeMs, 0)` if this is still the last
  fire. `hush(fadeMs)` as today.
- The murmur: while `now < quietUntil` no loop is made and a live one's gain is 0; otherwise as today, over
  `distance(rects, band, pointer)`, among unfired places that are not earned.
- `wake()` again while any place is adding dwell, any is earned, or `now < quietUntil` with an unfired place near.
- `stop()` clears `earnedPlaces`, `nextAt`, `quietUntil` and `last`. `__inspect` reports `earned`.

## Task 5. The card's numbers and the effect's plays (Divided World)

Model: sonnet

**Files:** `instances/divided-world/cards/laugh-track.ts`, `instances/divided-world/cards/laugh-track.test.ts`,
`instances/divided-world/settings.ts`, `instances/divided-world/settings.test.ts`,
`instances/divided-world/ui/laugh-track/Effect.tsx`, `instances/divided-world/ui/laugh-track/Effect.test.tsx`,
`instances/divided-world/ui/laugh-track/LaughTrack.board.stories.tsx`.

**Tests first.**
1. `laugh-track.test.ts`: `screenReads` holds `laughTrack.band` (whole, 5 to 90), `laughTrack.airMs` (whole, 0 to
   5000) and `laughTrack.holdMs` (whole, 0 to 20000).
2. `settings.test.ts`: the instance's `cardSettings` carry `laughTrack.band: 34`, `laughTrack.airMs: 1200` and
   `laughTrack.holdMs: 4000`, inside those bounds.
3. `Effect.test.tsx`: a fire plays its take with `{ group: 'audience', fadeMs: 250, tailMs: 250 }`; a replay (hover,
   focus, press, Enter, Space) plays with the same three; the registration's `fire` returns the play's promise; the
   registration's `screen` carries `band`, `airMs` and `holdMs`, from the settings and from `DEFAULTS` when unset.

**Code.** `screenReads` gains the three keys, and the comment above it names them. `settings.ts` `cardSettings` gains
the three defaults. `Effect.tsx`: `DEFAULTS` gains `band: 34, airMs: 1200, holdMs: 4000`; `screen` reads them;
`replay(spot)` always passes `{ fadeMs: screen.fadeMs, tailMs: screen.fadeMs }` and returns the play's promise;
`fire(spot)` returns it; the header's account of when a place fires is rewritten (§1, §2). The story's `toTheLine`
comment says the line's middle is inside the band.

## Task 6. A reader, in a browser (e2e)

Model: sonnet

**Files:** `e2e/laugh-track.spec.ts`.

**Tests first** (they are the task; record the red run against the build before Tasks 3 to 5, by checking out the
spec alone, or say in the PR why that was not possible):
1. **A reader hears the post.** The app seeded with a five-post thread whose last post is three long paragraphs with
   the cues "fan game" (boo), "forums" (laugh) and "Mario" (cheer). The spec carries its own text of the shape the
   owner's cast had: three paragraphs of about 900 characters each, with 14 cued places, several on one row and five
   in one paragraph. At 1280 by 800, a wheel notch of 100px every 700ms from
   the top to the foot, then a wait of the queue's length: every place that the page's scroll can bring into the band
   has fired, and at least 12 of 14.
2. **In order, spaced.** Recording each fire's time and place through a `MutationObserver` on `.dw-lt-fired`: the
   fires are in the order of the text, and no two are closer than 1100ms.
3. **A fling still fires nothing** (the existing `fling`, kept): none fired, and at least one step saw a cue in the
   band.
4. **A phone**: the same reader at 390 by 844 fires at least 12 of 14.
The existing tests that use `toTheLine` stay: a place put on the line is in the band.

## Task 7. The play form's pieces for a card's settings (engine)

Model: sonnet

**Files (new):** `engine/ui/cards/config/ConfigField.tsx`, `ConfigChoice.tsx`, `ConfigRange.tsx`, `ConfigHint.tsx`,
`PostWords.tsx`, `config.css`, `config.test.tsx`, `Config.board.stories.tsx`. **Changed:**
`engine/ui/cards/SetConditions.tsx`, `engine/ui/cards/play.css`, `engine/ui/cards/setform.test.tsx` and
`engine/ui/cards/conditions.test.tsx` where they reach the post's words. Read `engine/ui/cards/PlayForm.tsx` and
`engine/ui/glass/Button.tsx`.

Each piece draws classes the play form already styles; `config.css` holds only what is new (the cue head's row, the
range). No color or font family is written outside the glass's tokens (`tools/check-ui-tokens.mjs`).

**Tests first** (`config.test.tsx`):
1. `ConfigField`: a `label` for its `input.kb-play-input`; `hint` is a `p.kb-play-fine` the input is described by;
   `why` (a refusal) is a `p.kb-play-why` with `role="status"` and sets `aria-invalid` on the input; `action` (a
   node) is drawn on the label's line; the input takes `maxLength`, `value`, `onChange`, `onFocus` and a `ref`.
2. `ConfigChoice`: a `fieldset` whose `legend` is its label (visually hidden when `hideLegend`), native radios in
   `label.kb-play-choice-opt`, the checked one's `span` the play form's filled half; arrow keys move among them (the
   browser's own); `onChoose(value)`.
3. `ConfigRange`: a labeled `input[type=range]` with `aria-valuetext`, at least 24px tall.
4. `ConfigHint`: a `p.kb-play-fine`, with `role="status"` when `live`.
5. `PostWords`: draws `words` in `div.kb-play-post` inside `div.kb-play-post-frame.kb-glass-cut-panel`, in the tab
   order, named "The post's words"; a selection wholly inside it calls `onSelect(text)`; one that crosses its edge
   calls `onSpill(true)` and never `onSelect`; one elsewhere calls neither; a collapsed selection calls neither; a
   selection left standing while focus is in a field, a radio or a button of `within` (a ref to the form) calls
   neither (the stale-selection guard Laugh Track's form has today).
6. `SetConditions` still fills its passage from a selection and still says the spill line (its existing tests, green
   over `PostWords`).

**Code.** `PostWords` takes `{ words, onSelect, onSpill?, within? }` and owns the `selectionchange` listener now in
`SetConditions` (lines 120 to 137) with the guard from Laugh Track's `ConfigForm` (`read`). `SetConditions` renders
`PostWords` and keeps `passageOf`. The board story shows the five pieces on the `play` smoke at 420px.

## Task 8. Laugh Track's form (Divided World)

Model: sonnet

**Files:** `instances/divided-world/ui/laugh-track/ConfigForm.tsx`, `ConfigForm.test.tsx`, `laugh-track.css`
(the `.dw-lt-form*` rules go; what stays is the effect's).

**Tests first.** Replace "selecting words in the copy fills the row that last had focus", "after a removal a selection
fills the row focus moved to" and "a selection outside the copy fills nothing; one inside fills the focused row" with:
1. A selection fills the first cue whose phrase is empty, whichever field last had focus.
2. With cue 1 typed and no other cue, a selection adds cue 2 and fills it; cue 1 keeps its words.
3. With five cues filled, a selection changes nothing and the form says "All five cues are filled. Clear one to pick
   another phrase." in the total's live region; the line goes when a cue is cleared or removed.
4. "Add a cue" moves focus to the new cue's phrase.
5. The form's markup: the legend "Your audience's cues"; the hint "Select words in the post below with a pointer or by
   touch, or type them. A selection fills the first empty cue."; `PostWords`; for each cue a `ConfigField` labeled
   "Cue N" with "Remove" (a quiet small `GlassButton`, named "Remove cue N") on its line when there is more than one
   cue, and a `ConfigChoice` named "Sound for cue N" with Laugh, Cheer and Boo; cue 1's hint ends "A face-down Laugh
   Track waits for this phrase."; "Add a cue" is a small secondary `GlassButton` beside the total.
6. No element of the form has a class starting `dw-lt-form`, and the form sets no `font-family`.
Keep: the counts, "one place says place", the rules' bounds in the rules' words, opening with a config, the removals'
focus, the stale selection, whole words (`wholeWords`).

**Code.** `lastFocused` and the form's own `selectionchange` listener go. `fill(phrase)`: the first row with an empty
trimmed phrase, else a new row when `rows.length < CUES.most`, else `setFull(true)`. `refocus` also serves the added
row. The sound's `ConfigChoice` replaces the `select`.

## Task 9. Autocorrect's and You Were Saying?'s forms (Divided World)

Model: sonnet

**Files:** `instances/divided-world/cards/autocorrect/ConfigForm.tsx`, `ConfigForm.test.tsx`, `autocorrect.css` (the
`.dw-ac-form*` rules go); `instances/divided-world/cards/you-were-saying/ConfigForm.tsx`, its test beside it,
`you-were-saying.css` (the `.dw-ywsf-form`, `-label` and `-fine` rules go; `-length` stays for the words and price
line).

**Tests first.**
1. Autocorrect: two `ConfigField`s, "Phrase to cover" and "Cover it with", and a live `ConfigHint` with the count;
   no class starting `dw-ac-form`. The existing behavior cases stay green.
2. You Were Saying?: a `ConfigRange` labeled "How much it writes" with the same `aria-valuetext`, the words and price
   line, and a `ConfigHint`; no `dw-ywsf-form`, `dw-ywsf-label` or `dw-ywsf-fine` class. The existing cases stay
   green.

**Then, for Tasks 7 to 9 together:** run the board match (`e2e/board-snapshot.spec.ts` and the boards under
`e2e/boards/`) and the accessibility sweeps (`web/a11y.test.tsx`, `e2e/a11y.spec.ts`). A board that shows one of the
three forms changes by design; its new picture is put in the PR beside the old for the owner, and no other board
moves.

## Review focus

- **The queue under a reader who does not behave:** a place earned on a post that then unmounts (a page turned, a
  card caught) while it waits; a place refreshed (`off.refresh`) while earned; two posts' places earned in one frame.
  None may fire after its registration is gone, and none may hold the queue.
- **Frames on a still page:** with a place earned or the murmur held, frames run; once the queue is empty and the
  hold is past, a still page asks for none. A page of forty posts of thirty places still costs one observer and one
  loop of frames.
- **The murmur's hold and a take that never answers:** a play whose promise resolves late, or null, leaves the murmur
  held for the airtime and no longer.
- **The tail and a replaced voice:** a voice replaced during its tail, or stopped by its bus going off, ends once and
  disconnects; no source is stopped twice.
- **A slot's gain above 1** with the bus at full volume: the capped peak keeps the sum of one take and one murmur
  under clipping; nothing else sums voices on the game bus today.
- **The manifest's numbers against the files:** the hash holds a replaced file; a file re-encoded to the same sound
  hashes differently and asks for a new measurement, which is the intent.
- **The forms at 200% text and on a phone:** the segmented choice and the cue's head line wrap and never clip; a
  five-cue form scrolls inside the dialog and "Add a cue" is gone at five.
- **The masks:** nothing in the watcher, the effect or the forms reads `reader.author`, `reader.caster` or any
  account; the existing test that holds this for the effect still passes.
