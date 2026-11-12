# Laugh Track's reading band, its sound and the cards' forms: design

Record, written 2026-11-12. A design session with the owner, started from the owner's first cast of Laugh Track on the
deployed instance: three cues covering 14 places, of which 2 could be made to fire. It changes parts of
`docs/plans/2026-11-11-laugh-track-design.md` (cited as LT §N): when a place fires (LT §6), how the audience's sounds
start, end and are leveled (LT §3 and §7), and the look of a card's settings in the play form (LT §6, "Its look"). The
plan is `docs/plans/2026-11-12-laugh-track-band-plan.md`. The mock the owner approved is
`docs/research/2026-11-12-card-forms/01-laugh-track-form.png`, made by `mock.cjs` beside it.

## 0. What was found

- **Firing.** A place fired only when a row of its words straddled a reading line with no thickness, 40% down the
  reading space, for 0.4 seconds without a break (`instances/divided-world/ui/laugh-track/watch.ts`, `tick`). A row of
  text is about 15px tall and a wheel notch about 100px, so a pause lands a given row on the line about one time in
  seven, and a steady scroll faster than about 40px a second never rests long enough. The owner's post and cues, seeded
  into the e2e build and read by a wheel notch every 0.7 seconds from the top to the foot, fired 1 of 14 at 1280 by 800
  and at 1920 by 1080, and 3 of 14 at 390 by 844. All 14 places could reach the line. The pointer never fired a place;
  it only swelled the murmur.
- **Each place is its own.** Eleven "Mario"s are eleven places, each fired and underlined alone. That stays.
- **Levels.** The three loops measure -36.5 to -38.5 LUFS and the nine takes -11.7 to -22.3 LUFS, and the murmur is
  then capped at 35% of a hit (`laughTrack.murmurMost`), another 9 dB down. The takes differ from each other by 10 LU.
- **Clicks.** Several takes begin mid-waveform. A first fire fades in over the fade (250ms); a replay passes no fade,
  so it starts at full level and cuts the take before it dead (`Effect.tsx`, `replay`; `engine/ui/audio/mixer.ts`,
  `play`). A bus's volume is set as a step (`setBus`).
- **The cut back to the chatter.** Some takes end while still audible, and the frame after a fire makes a fresh murmur
  that is back at its level within about 150ms, under the take, so when the take stops the chatter is simply there.
- **The form.** A selection in the copy of the post's words fills the row whose field last had focus, and "Add a cue"
  does not move focus, so a selection made after adding a row overwrites row 1
  (`instances/divided-world/ui/laugh-track/ConfigForm.tsx`, `lastFocused`). The form names the board's font and styles
  none of its controls, though the play form it sits in is a glass overlay. LT §6 asked for Verdana; that was the wrong
  world. Autocorrect's and You Were Saying?'s forms have unstyled controls too; the other five cards' forms already use
  glass pickers.

## 1. A place fires in a reading band

Decided: **a band, not a line.** Weighed: the band with a pointer's hover or a tap firing a place as well (an unmarked
phrase that answers a hover lets a reader sweep the mouse to find the cues, which telegraphs the joke); the line kept
and made a few rows thick (about half the cues fire on an ordinary read).

- **The band** is centered on the reading line (`laughTrack.line`, 40% down the space above the HUD) and is
  `laughTrack.band` percent of that space tall: 34 by default, so about 200px, or 13 rows, on a 1280 by 800 window.
  A place is in the band when the middle of any of its boxes is.
- **Earning.** A place earns its cue once it has been in the band for the dwell (`laughTrack.dwellMs`, 400ms), added
  up across pauses. A place that leaves the reach (it is no longer near the viewport) loses what it had added.
- **A fling** fires nothing because it earns nothing: 200px crossed in under 0.4 seconds is faster than about 500px a
  second. Time is added a frame at a time and a frame adds at most 100ms, so a tab that slept does not earn.
- **The pointer** still only swells the murmur.

## 2. Earned places fire in reading order, spaced

Decided: **one at a time, in the order of the text, each with airtime.** Weighed: every earned place firing at once,
the takes layered like a crowd (several voices where the page has one, and the caption bar would show only the last);
only the place nearest the line firing (a dense paragraph still leaves most of its cues unfired).

- **The order** is the order of the page: an earlier post before a later one, and within a post the order of its
  words.
- **Airtime.** After a place fires, the next waits `laughTrack.airMs` (1200ms) and then cross-fades over it. A
  paragraph of five cheers is five cheers, about six seconds of them.
- **Waiting, and its way out.** An earned place waits its turn. If it leaves the band while it waits, it still fires
  when its turn comes within `laughTrack.holdMs` (4000ms) of leaving. After that it is unearned again, as if never
  read, and reading it again earns it again. Nothing is stuck: a waiting place fires or lapses by itself within a
  stated time, and a lapsed one is earned the way any place is.
- **After it fires** nothing changes from LT §6: the dotted underline, the button on its first piece, the replay.
- **The Lens** still says "N of M cues heard".

## 3. The audience's sound

- **Every voice starts and ends on a ramp.** The engine's mixer fades every voice in, and out when it is stopped or
  replaced, over at least 8ms, and a bus's volume moves to its new level over a few milliseconds. This is the engine's,
  for every sound an instance supplies.
- **A take tails off.** A play may ask for a tail (`tailMs`): the voice fades to nothing over the last of the file.
  Laugh Track asks for the fade (`laughTrack.fadeMs`, 250ms) on every take.
- **A replay cross-fades** as a first fire does: the same fade in, over the take before it.
- **The murmur waits for the take.** While a take sounds the murmur is held at nothing; it comes back over the take's
  tail, so the hit hands back to the chatter. The watcher learns the take's length from the play's own answer; a play
  that did not sound (sound off, locked) holds the murmur for the airtime.

## 4. Levels are measured, and held by the build

Decided: **a gain for each sound, from a measurement written beside its credit.** Weighed: the owner re-rendering
every file into a loudness window that the build measures (a decoder in the build, and a re-render for every
replacement); the owner leveling by ear with nothing checking (the next file drifts again).

- **`sounds.json`** gains three fields for each file: `lufs` (integrated loudness), `peak` (true peak, dBFS) and
  `sha256` (of the file's bytes).
- **`tools/measure-sounds.mjs`** writes them, with ffmpeg. It is a tool a person or a session runs after adding or
  replacing a file, not a build step; the build needs no decoder.
- **`tools/check-sounds.mjs`** refuses an entry with no measurement, a measurement that is not a number, and a
  `sha256` that is not the file's, so a replaced file cannot keep the old file's numbers.
- **Playing.** The engine's `SoundSlot` gains `gain`, a multiplier the mixer applies to the voice. Divided World works
  each one out from the manifest: up or down to -18 LUFS, and never so far up that the peak passes -1 dBFS. Loops and
  takes are then level with each other, and `laughTrack.murmurMost` alone says how far under a hit the murmur is.

## 5. A card's settings wear the glass

The play form is a glass overlay; a card's settings inside it are the glass's too. Decided: **the engine gains the
pieces and the three unstyled forms move onto them.** The session first counted eight forms; five (Whoops!, Card
Collector, Mooch, 4D Chess, Off Day) already wear the glass and are left alone. Weighed: Laugh Track's alone, the
other two in a later plan; a design of its own.

- **The pieces** (engine, `engine/ui/cards/config/`), each the play form's own look and nothing new: a labeled text
  field with its hint and its refusal; a choice among a few options as the play form's segmented radios; a range; a
  hint line; and the post's words to select from, the cut panel the face-down conditions already draw
  (`engine/ui/cards/SetConditions.tsx`), lifted so both use one.
- **Laugh Track** (the mock): the post's words in the cut panel; each cue a "Cue N" label with a quiet Remove beside
  it, the phrase field, Laugh, Cheer and Boo as a segmented choice, and its hint; "Add a cue" as a small secondary
  button beside the total. The face-down note is cue 1's hint.
- **Autocorrect:** two fields and the hint. **You Were Saying?:** the range, its words and price, and the hint.
- **A selection never overwrites.** Words selected in the post fill the first cue with an empty phrase. With none
  empty and fewer than five cues, a cue is added and filled. With five filled, nothing is filled and the form says so
  ("All five cues are filled. Clear one to pick another phrase."). "Add a cue" moves focus to the new cue's phrase.

Not in this design: a select-to-fill block for Autocorrect; any mark on an unfired phrase.

## 6. The rules

- **The masks.** Everything here runs on a reader's own screen from the play's public cues and the reader's own
  scroll. No response, payload, event or timing is added, and none is computed from who owns, wrote or cast anything.
- **The layers.** The mixer's ramps, tail and gain, and the form pieces, are engine and name no card. The band, the
  queue, the card's numbers, the manifest's gains and the three forms' content are Divided World's. `SoundSlot.gain`
  is the interface that carries an instance's leveling into the engine.
- **Accessibility.** The forum's own paths are untouched. The form's controls are native (text fields, radios, a
  range, buttons), labeled, and reached by keyboard; typing a phrase stays a full path. With sound off places fire and
  are captioned alike.
- **Scale.** The watcher stays one observer and one frame loop for the page. Earned places are the few in the band,
  sorted only when one is about to fire.
- **Acts.** Nothing saved changes: a play's config, the seed and the takes are as they were. The card's three new
  numbers are screen settings with defaults, so an instance that has set none reads the defaults.

## 7. Open

- Whether 34%, 1200ms and 4000ms are right is for the owner's ear once it is built; all three are settings.
- The murmur's share of a hit (`laughTrack.murmurMost`, 35) was chosen against files 20 dB apart. With the levels
  held it may want lowering; the owner tunes it.
