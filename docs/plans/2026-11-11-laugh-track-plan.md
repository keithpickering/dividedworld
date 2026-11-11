# Laugh Track, and the sound it brings: plan

Record, written 2026-11-11. Carries out `docs/plans/2026-11-11-laugh-track-design.md`. Two parts, each its own PR from
`main`:

- **Part 1, the sound foundation** (Tasks 1 to 7): the engine's audio, its settings, the caption bar, the sounds
  interface and its check. It needs no recording, and it closes the foundation half of issue #240 (the PR says
  `Refs #240`, not `Closes`: the navigation click stays there).
- **Part 2, Laugh Track** (Tasks 8 to 14): starts only once the owner has committed the twelve recordings and their
  manifest to `main` (section "The sounds, for the owner" below). A card listed in the instance is in its booster
  packs at once, so the card is never listed before its sounds exist.

Every task goes test first: write the failing test, record its red run, then the code. During a task, run only the
tests for the changed code (`npm run test:sql` with the one file, or `npx vitest run <file>`). Run `npm run typecheck`
and `npm run build` once after each part's last task, with the tail in the PR. No deployed database, bucket or connector
is touched; SQL runs against Postgres on localhost.

**The layers.** `engine/ui/audio/` and the settings are engine and name no instance, no card and no sound; the engine
boundary check (`tools/check-engine-boundary.mjs`) holds throughout. Divided World's sounds, captions, manifest and
card are its own, carried in through `InstanceUi.sounds`, `CardRules` and `CardUi`.

**The worlds.** The settings rows and the caption bar are the glass (plain, never in character). Laugh Track's marks and
play form are the board (Verdana, the board's tokens, color only on the game's own pieces). The bench
(`docs/research/2026-11-11-laugh-track-bench/01-bench.html`) is the reference for how the bar, the underline and the
cue behavior look; where it and this plan disagree, this plan wins on what is decided and the bench on how it looks.

# Part 1. The sound foundation

## Task 1. The preferences, stored and read

Model: sonnet

**Files:** a new `supabase/migrations/0150_sound_preferences.sql` (the next free number; take the next if a merge has
used it), a new `supabase/tests/0156-sound-preferences.sql` (the same rule), `supabase/tests/0039-glass-preferences.sql`,
`supabase/tests/e2e/0003-export.ts`, `engine/ui/data/api.ts` (`Preferences`, `DEFAULT_PREFERENCES` at line 919),
`engine/ui/data/fake.ts`, `web/src/data/supabase.ts`.

The migration follows `0145_brighter_effects.sql`'s shape exactly, and its header says so and names the design:

- Four columns on `account_preferences`:
  - `game_sound text not null default 'off' check (game_sound in ('off', 'on'))`
  - `game_volume integer not null default 80 check (game_volume between 0 and 100 and game_volume % 5 = 0)`
  - `interface_sound` and `interface_volume`, the same.
- `preferences_answer` made again from 0145's body, with `'game_sound'`, `'game_volume'`, `'interface_sound'` and
  `'interface_volume'` after `'effects'`.
- `set_preferences` dropped (0145's signature) and made again from 0145's body, with four parameters after `effects`
  (`game_sound text default null, game_volume integer default null, interface_sound text default null,
  interface_volume integer default null`). Each is refused in plain words, with hint `kayfabb.refusal` and errcode
  `22023`:
  - `'game sounds are off or on'` and `'interface sounds are off or on'`;
  - `'a volume is 0 to 100, in steps of 5'`.
  - Each is inserted with its default by `coalesce`, and updated by `coalesce(set_preferences.x, p.x)`.
  - The grants are restated for the new signature.
- `boot()` replaced in place from 0145's body, with the four columns after `a.effects`. Its signature is unchanged.

SQL test, red first:

- a new account reads the four defaults;
- each setting is stored and answered, leaving every other choice as it was;
- `'loud'` and a volume of 7 and of 105 are each refused with their words;
- another account cannot read the row;
- `boot()` carries all four.
- `0039-glass-preferences.sql`'s expected answers gain the four defaults.
- `0003-export.ts`: the inserted row sets `game_sound` to `'on'` and `interface_volume` to `35`, so the round trip
  proves the columns travel.

**`api.ts`:**

- `Preferences` gains:
  - `gameSound: 'off' | 'on'`
  - `gameVolume: number`, with the doc comment "0 to 100 in steps of 5"
  - `interfaceSound: 'off' | 'on'`
  - `interfaceVolume: number`
- `DEFAULT_PREFERENCES` gains `gameSound: 'off', gameVolume: 80, interfaceSound: 'off', interfaceVolume: 80`.
- `fake.ts` refuses what the SQL refuses, in the SQL's words, as it does `effects`.
- `supabase.ts` reads and sends the four wherever it reads and sends `effects`.

## Task 2. The mixer

Model: sonnet

**Files:** new `engine/ui/audio/types.ts`, `engine/ui/audio/mixer.ts`, `engine/ui/audio/mixer.test.ts`;
`engine/ui/types.ts` (`InstanceUi` gains `sounds?: SoundsUi`).

**`types.ts`:**

```ts
/** Which of the account's two sound settings a sound answers to. */
export type SoundBus = 'game' | 'interface';
/** One sound an instance supplies (InstanceUi.sounds): a file the bundler resolved, its bus, and its caption, which the engine shows whenever it plays. */
export interface SoundSlot {
  readonly key: string;
  readonly src: string;
  readonly bus: SoundBus;
  /** What the caption bar says while it sounds, in sentence case ("The audience boos"); the bar draws it in capitals. Never empty. */
  readonly caption: string;
  /** A loop (a build-up) rather than a sound that ends. */
  readonly loop?: true;
  /** The caption's leading dot, any CSS color; none draws no dot. */
  readonly ink?: string;
}
export interface SoundsUi {
  readonly slots: readonly SoundSlot[];
  /** The sound a category's volume control plays when released, by key. */
  readonly preview?: Partial<Record<SoundBus, string>>;
}
```

**`mixer.ts`:** `createMixer(deps)`, written against injected parts so it runs under vitest with no browser:

```ts
interface MixerDeps {
  makeContext(): AudioContextLike; // the narrow slice of AudioContext the mixer uses, so a test's fake needs only that
  fetchBytes(src: string): Promise<ArrayBuffer>;
}
```

Its methods:

- `setBus(bus, { on, volume })`;
- `unlock()`, which makes the context on the first call and resumes it after;
- `suspend()` and `resume()`;
- `play(slot, { group?, fadeMs? })`, which returns `{ lengthMs } | null`;
- `loop(slot, { group? })`, which returns a `LoopHandle` with `setGain(g)` (0 to 1, smoothed by `setTargetAtTime`) and
  `stop(fadeMs)`.

The rules, each a test:

1. Before `unlock()`, `play` and `loop` return null and make no context: a skipped sound is never queued.
2. A bus that is off: `play` returns null and fetches nothing. A bus turned on later fetches on its first play.
3. A file is fetched and decoded once a page, however many times it plays; a failed fetch or decode returns null for
   that play and is tried again on the next. It never throws into the caller.
4. A bus's gain is its volume over 100. Its `on` false sets it to 0 and stops its loops.
5. A sound in a group fades the group's current sound out over `fadeMs` while it fades in. Sounds in different groups,
   or in none, overlap.
6. A loop at gain 0 keeps its source but is silent. `stop` fades and disconnects.
7. `suspend()` and `resume()` call the context's own.

`lengthMs` is the decoded buffer's duration. The caption layer (Task 3) reads it.

## Task 3. The caption bar

Model: sonnet

**Files:** new `engine/ui/audio/captions.ts`, `engine/ui/audio/captions.test.ts`, `engine/ui/audio/Captions.tsx`,
`engine/ui/audio/captions.css`, `engine/ui/audio/Captions.test.tsx`, `engine/ui/audio/Captions.board.stories.tsx`;
`engine/ui/frame/Hud.tsx` (mounted beside `<Toasts>` near line 565), `engine/ui/alerts/toasts.css` (line 13).

**`captions.ts`**, a store with no React:

- `say({ text, ink?, ms })` shows a caption for `ms`, replacing whatever is shown.
- `hold(id, { text, ink? })` and `release(id)` are for a loop's caption: a held caption shows while no `say` is
  showing, and the latest hold wins.
- `subscribe` and `current` complete the store.

Tests: replacement, expiry, a hold under a say and back after it, a release, and a hold released while a say shows.

**`Captions.tsx`** draws the store as the bench's look A:

- a fixed bar centered above the HUD's seam (`bottom: calc(var(--kb-hud-measured, 0px) + 10px)`), `width:
  max-content`, at most the page's width less 16px gutters;
- a slim chamfered tray of `--kb-glass-panel-strong` with a 1px edge of the glass's neon at 60% and its glow;
- inside it, the words in white monospace capitals (`text-transform: uppercase`; the stored words stay sentence case
  for a screen reader) on solid black, led by an 8px dot in the caption's ink where it has one;
- held captions in italic, as the bench draws its build-up.

It fades in and out over 150ms, and appears and goes with no motion under reduced motion. It lets every press through
(`pointer-events: none`).

It is **always in the page** with a polite live region (`role="status"`), visually hidden apart from the drawn bar,
as the toasts' announcer is. A `say` is announced; a hold is not, so a build-up does not chatter.

It measures itself and sets `--kb-captions-measured` on the root while a caption shows, cleared otherwise.
`toasts.css`'s `.kb-toasts` bottom becomes `calc(var(--kb-hud-measured, 0px) + var(--kb-captions-measured, 0px) +
16px)`, so toasts stand above a caption.

Its colors are glass tokens, apart from the caption's own black and white, which `tools/check-ui-tokens.mjs` must
allow. If it does not, add the two to the glass's tokens as `--kb-glass-caption-ground` and
`--kb-glass-caption-ink` in `instances/divided-world/ui/glass.json`, and in the engine's default glass if the engine
holds one.

Tests first: a `say` draws its words and the live region holds them; it goes after `ms`; the bar draws nothing with
nothing to say; `--kb-captions-measured` is set and cleared.

The board story shows a short caption, a long one at a phone's width, and a held one, on both boards.

## Task 4. Sound in the page

Model: sonnet

**Files:** new `engine/ui/audio/sound.ts`, `engine/ui/audio/sound.test.tsx`; `engine/ui/account/preferences.ts`
(line 122), `web/src/App.tsx` (lines 170 and 174).

`sound.ts` holds the page's one mixer and wires it, following `engine/ui/shine/tilt.ts`'s module shape:

- `setSoundPreference({ gameSound, gameVolume, interfaceSound, interfaceVolume })` sets the buses. It is called where
  `setTiltPreference` is: `preferences.ts` line 122, and `App.tsx` 174, with `DEFAULT_PREFERENCES`' values at 170.
- **The unlock.** The first `pointerdown`, `keydown` or `touchend` on the document calls `unlock()`, once, with
  listeners added on first use and removed after.
- `visibilitychange` suspends and resumes.
- `useSound()`, a hook reading `useKayfa().ui.sounds`, returns:
  - `play(key, opts?)`, which plays the slot through the mixer and **says its caption** for the sound's length.
    - With the sound skipped (locked, its bus off, a failed load), a game sound's caption is said all the same, for
      `CAPTION_MS` (2500).
    - An interface sound's caption is said only when it sounds; the design leaves this open until the first interface
      sound, and this is the behavior until then.
  - `loop(key, { group?, id })`, which returns a handle whose `setGain` also holds the slot's caption under `id` while
    the gain is above `HELD_FROM` (0.15), and releases it below.
  - `caption(key)`, which says a slot's caption without playing it.
  - A key the instance does not supply throws in development and does nothing in production.
- `useGameSound()` returns `{ on, set(on) }` through the same saver Settings uses (`usePreferenceSaves`,
  `preferences.ts` line 56), for a card's Lens toggle.

Tests first, with the mixer's deps faked: no context before a gesture; a game sound with its bus off says its caption
and fetches nothing; a gesture unlocks once; a hidden tab suspends; the preference reaches the buses; an unknown key
throws in development.

## Task 5. The settings rows

Model: sonnet

**Files:** `engine/ui/account/appearanceRows.tsx`, `engine/ui/account/Settings.tsx` (`SECTIONS` at line 86, a section
after Accessibility), `engine/ui/welcome/Welcome.tsx` (after `<EffectsRow>` at line 102), `engine/ui/account/account.css`,
and their tests (`engine/ui/account/Settings.test.tsx`, `engine/ui/welcome/Welcome.test.tsx`).

`appearanceRows.tsx` gains `SoundRow({ bus, value, volume, onChange, onVolume, level })`:

- a `Choice` of Off and On;
- while on, a labeled range input under it (0 to 100, step 5, its value said beside it as "80%"), saving on release
  (`change`, never `input`) and then playing the bus's preview where the instance names one (`useSound().play`).

The words, exactly, for the owner to approve in review:

- **Game sounds.** "Sounds that cards and other game effects make on the board. Every one is also shown as a caption
  at the bottom of the screen."
- **Interface sounds.** "Sounds the board itself makes, apart from the game." While `ui.sounds` holds no interface
  slot, it adds: "This forum has none yet."
- The range inputs are labeled "Game volume" and "Interface volume".

`Settings.tsx`: a **Sound** section (`{ key: 'sound', label: 'Sound' }`, after Accessibility) holding the two rows.
`Welcome.tsx`: the two rows after Brighter effects, at `level={4}`.

Tests first: each screen draws both rows with the words, saves each choice, shows a volume only while on, saves the
volume on release, and plays the preview on release where one is named and nothing where none is.

## Task 6. The sounds check

Model: sonnet

**Files:** new `tools/check-sounds.mjs`, `tools/test-sounds.mjs`; `tools/build.mjs` (`STEPS`: `test-sounds` then
`check-sounds`, after `check-card-art` at line 90); new `instances/divided-world/ui/sounds/sounds.json` holding `[]`.

The manifest is a list of `{ file, source, license, maker }`, every field a non-empty string, `file` a name in the
same folder. For every instance's `ui/sounds/` folder, `check-sounds.mjs` refuses, naming the file and the predicate:

1. a sound file (`.mp3`) with no manifest entry;
2. an entry with no file;
3. an entry with a blank or missing `source`, `license` or `maker`;
4. two entries for one file;
5. a file over 300 KB;
6. a file that is not an MP3 (it starts with neither `ID3` nor an MPEG frame sync, `0xFF` then a byte whose top three
   bits are set).

An empty manifest in an empty folder passes.

`test-sounds.mjs` builds each poison in a temporary folder, runs the check's function on it, and asserts each fails
with its own predicate; then a clean folder with one valid file (a few bytes starting `ID3`) passes. **Red first:**
the test runs before the check exists and fails; record it.

## Task 7. Part 1 in a browser, and the build

Model: sonnet

**Files:** new `e2e/sound-settings.spec.ts` and `e2e/captions.spec.ts`; `e2e/board-stories.test.ts` (the captions
story ids).

Tests first:

- on Settings › Sound, each row saves and reloads its choice, and the volume shows only while on;
- axe finds nothing on Settings › Sound and on the welcome page;
- the captions story's bar sits above the HUD, never covers it, and fits a phone's width;
- the live region holds the words.

Then `npm run typecheck` and `npm run build`, with the tail in the PR. The PR body says `Refs #240`.

# The sounds, for the owner

Before Part 2. Twelve files, MP3, mono, 44.1 kHz, about 128 kbps, each at most 300 KB, at even loudness (about -16
LUFS, so no take is louder than another). They go in `instances/divided-world/ui/sounds/`, each with its entry in
`sounds.json`:

- `source` names the tool and how the file was made;
- `license` states the terms that let it be redistributed in an open-source repository (the owner confirms their
  ElevenLabs plan allows that);
- `maker` names the owner or "Divided World".

The prompts are starting points: a studio audience in a 1990s multi-camera sitcom, a small warm room, no music, no
voices saying words.

| File | Length | Loops | Prompt |
|---|---|---|---|
| `laugh-1.mp3` | 2.5 s | no | A sitcom studio audience bursts into a big warm laugh that rolls and fades out |
| `laugh-2.mp3` | 2 s | no | A sitcom studio audience gives a short hearty laugh with a few claps, fading out |
| `laugh-3.mp3` | 3.5 s | no | A sitcom studio audience howls with laughter, a few people whooping, then settling |
| `cheer-1.mp3` | 3 s | no | A sitcom studio audience cheers and applauds wildly, whoops and whistles, fading out |
| `cheer-2.mp3` | 2.5 s | no | A sitcom studio audience goes "woooo" and claps for an entrance, fading out |
| `cheer-3.mp3` | 3 s | no | A sitcom studio audience erupts in applause and cheering, then fades |
| `boo-1.mp3` | 2.5 s | no | A sitcom studio audience boos a villain loudly, playful, fading out |
| `boo-2.mp3` | 2 s | no | A sitcom studio audience gives a long low "boooo", a few hisses, fading out |
| `boo-3.mp3` | 3 s | no | A sitcom studio audience boos and jeers, a couple of people shouting "boo", fading |
| `titter.mp3` | 5 s | yes | A sitcom studio audience murmuring with a few quiet titters and giggles building, seamless loop |
| `ooh.mp3` | 5 s | yes | A sitcom studio audience murmuring expectantly, a soft rising "ooooh", seamless loop |
| `grumble.mp3` | 5 s | yes | A sitcom studio audience grumbling and muttering disapprovingly, seamless loop |

A loop starts and ends at the same level with no breath or swell at its seam. Trim silence from the head of every hit,
so it lands on its cue.

# Part 2. Laugh Track

## Task 8. Divided World's sounds

Model: haiku

**Files:** `instances/divided-world/ui/sounds.ts` (new), `instances/divided-world/ui/index.ts` (`sounds`),
`instances/divided-world/ui/index.test.tsx`.

The twelve files are on `main` (the owner's). `sounds.ts` imports each file as a URL, as `ui/cards.ts` imports art,
and exports `sounds: SoundsUi`, with `preview: { game: 'laugh-track.laugh-1' }`. Every slot is on the `game` bus:

| Key | File | Caption | Ink | Loop |
|---|---|---|---|---|
| `laugh-track.laugh-1` to `-3` | `laugh-1.mp3` to `laugh-3.mp3` | `The audience laughs` | `var(--kb-pepperoni)` | |
| `laugh-track.cheer-1` to `-3` | `cheer-1.mp3` to `cheer-3.mp3` | `The audience cheers` | `var(--kb-sweet)` | |
| `laugh-track.boo-1` to `-3` | `boo-1.mp3` to `boo-3.mp3` | `The audience boos` | `var(--kb-salty)` | |
| `laugh-track.titter` | `titter.mp3` | `The audience titters` | `var(--kb-pepperoni)` | yes |
| `laugh-track.ooh` | `ooh.mp3` | `The audience goes “ooh”` | `var(--kb-sweet)` | yes |
| `laugh-track.grumble` | `grumble.mp3` | `A grumble rises` | `var(--kb-salty)` | yes |

Tests first, in `index.test.tsx`: every slot's file is in the folder's manifest, every caption is non-empty, the
preview names a slot, and every key is unique.

## Task 9. The rules

Model: sonnet

**Files:** new `instances/divided-world/cards/laugh-track.ts`; `instances/divided-world/cards/index.ts` (`listed` and
the header comment); `instances/divided-world/cards/cards.test.ts`; `instances/divided-world/settings.ts` (the economy
keys beside `autocorrect.*` at line 188, and `cardSettings` at line 161); `instances/divided-world/settings.test.ts` if
it lists keys.

```ts
export type Sound = 'laugh' | 'cheer' | 'boo';
export interface Cue { readonly phrase: string; readonly sound: Sound }
export type LaughTrackConfig = { readonly cues: readonly Cue[]; readonly seed?: number };
export const CUES = { most: 5 } as const;
export const PLACES = { most: 30 } as const;
```

- Key `laugh-track`, name "Laugh Track", `pepperoni`, `uncommon`, stack 1 (the default), `seeded: true`.
- `setPhrase: (c) => c.cues[0].phrase`.
- **`validateConfig`:**
  - `cues` is a list of 1 to `CUES.most`;
  - each phrase is checked with Autocorrect's bounds (`PHRASE` from `autocorrect.ts`, the same letters-or-digits count
    and one line), trimmed;
  - `sound` is one of the three;
  - two cues with the same words (`sameWords`, `engine/bbcode/phrase.ts`) are refused.
  - The refusals: "a cue is a phrase and Laugh, Cheer or Boo"; "a play holds 1 to 5 cues"; "two cues have the same
    phrase"; and Autocorrect's phrase words for a phrase.
- **`placesOf(text, cues)`** is exported. It returns every occurrence of each cue (`occurrences`, `engine/bbcode/phrase.ts`)
  in the order of the text, with its cue's index, and drops none. The screens use it too.
- **`canApply`:** `landsOn(laughTrack, ...)` first (stack 1). A configured cast then also checks:
  - each cue's phrase is in `target.text`, else ``refuse(`“${phrase}” is not in this post's own words`)``;
  - no two places overlap, else "two cues cover the same words";
  - the places number at most `PLACES.most`, else ``refuse(`these cues cover ${n} places in this post; a play covers at
    most 30`)``.
  - **One audience.** Before `landsOn`, where a live `laugh-track` effect is already on the target, the card refuses
    with its own words, `refuse('this post already has an audience')`, rather than `landsOn`'s "this post already
    carries that card".
- **`playPrice`:** `perPlace × max(0, places − freePlaces)`, at most `mostAdded`. A face (no config) asks `mostAdded`.
  The economy gains `'laughTrack.perPlace': 5`, `'laughTrack.freePlaces': 5` and `'laughTrack.mostAdded': 100`, and
  `reads` names them (each `whole: true`, `min: 0`, with `freePlaces` `min: 0` and `mostAdded` `min: 1`).
- **`screenReads`** and their `cardSettings`:

  | Key | Value | Bounds |
  |---|---|---|
  | `laughTrack.line` | 40, percent | 10 to 90 |
  | `laughTrack.dwellMs` | 400 | 0 to 2000 |
  | `laughTrack.reachRem` | 12 | 2 to 40 |
  | `laughTrack.murmurMost` | 35, percent of a hit | 0 to 100 |
  | `laughTrack.fadeMs` | 250 | 0 to 2000 |

- **`staffOptions`:**
  - prompt: "Choose up to five cues: each a phrase copied exactly from the post you are replying to (whole words, on
    one line, at least 4 letters or digits) and the audience's sound when a reader reaches it: laugh, cheer or boo.";
  - schema: `{ type: 'object', properties: { cues: { type: 'array', items: { type: 'object', properties: { phrase: {
    type: 'string' }, sound: { type: 'string', enum: ['laugh', 'cheer', 'boo'] } }, required: ['phrase', 'sound'],
    additionalProperties: false } } }, required: ['cues'], additionalProperties: false }`.
- No `staffConfigs`: as Autocorrect, a fallback cannot know the post.

Tests first, in `cards.test.ts` beside Autocorrect's:

- it lands with one cue and with five;
- each refusal above, with its words;
- a second play is refused with "this post already has an audience";
- the price at 5, 6 and 40 places' worth (capped);
- `setPhrase` is the first cue's;
- `castOnPost` holds;
- `decideSet` accepts it;
- `validateConfig` keeps the seed the server adds.

`instanceProblems` of the instance is empty.

## Task 10. A persona's options, repaired

Model: sonnet

**Files:** `engine/rules/cards.ts` (`CardRules.repairStaff`), `engine/rules/cards.test.ts`,
`supabase/functions/chatter/core.ts` (`decideOptions`, line 441, and its caller at line 374), its tests
(`supabase/functions/chatter/core.test.ts` or wherever `decideOptions` is tested), `instances/divided-world/cards/laugh-track.ts`.

The engine gains one optional member:

```ts
/**
 * A persona's options repaired against the post before they are decided (CLAUDE.md, "A validator tighter than the schema"): a card whose
 * options a model can overshoot (a list longer than its most, an entry that is not in the post) trims what it can and names each trim.
 * It never invents an option. A player's play is never repaired. Given the options unchecked and the post as the card's rules see it.
 */
repairStaff?(config: unknown, target: PostTarget): { readonly config: unknown; readonly trims: readonly { readonly path: string; readonly predicate: string; readonly before: number; readonly after: number }[] };
```

`decideOptions` calls it with the read target before `decidePlay` or `decideSet`, when the card has one. It hands back
the trims, and the caller pushes them onto the call's `trims` beside the options' own (line 379), so the ledger row
names them.

Laugh Track's repair, on `cues` only, in order:

1. Drop a cue that is not an object with a string phrase and a known sound (`cueShape`).
2. Drop a cue whose phrase is not in the post (`phraseNotInPost`).
3. Drop a cue that repeats an earlier one's words, or whose places overlap an earlier kept cue's (`overlapsEarlierCue`).
4. Keep the first five (`mostFiveCues`).
5. Drop cues from the end while the places pass thirty (`mostThirtyPlaces`).

Each drop is one trim: `path` `card.config.laugh-track.cues`, with its `before` and `after` counts. With none left it
returns the options unchanged, so the decision refuses in the card's own words and the fallback runs as it does today.

Tests first: the engine calls the hook and records its trims (a test card with a repair); Laugh Track's repair for each
predicate and for none; a persona's seven cues become five with one trim named.

## Task 11. The machine, the art and the card's words

Model: sonnet

**Files:** `instances/divided-world/machine.ts` (the last on-sale slot, before the hidden Main Event:
`{ item: { card: 'laugh-track' }, availability: 'onSale', price: 150 }`); new `instances/divided-world/ui/cards/laugh-track/`
(`art.webp`, `scene.py`, `mark.svg`, `art.json`); `instances/divided-world/ui/cards.ts`;
`instances/divided-world/ui/index.test.tsx` (the `lands` table near line 86 gains `'laugh-track': 'the quoting post'`);
the booster packs boards' manifests if a slot moves (see the Below the Fold plan's note: put the slot last among the
on-sale slots so none moves); `ui/hint-words.ts` and `ui/still.test.tsx` only if their tests name every card.

**Art**, exactly as `instances/divided-world/ui/cards/below-the-fold/` holds it:

- `art.webp` is the render `docs/research/2026-11-11-card-renders/laugh-track.png`, converted to lossy WebP at quality
  90, at most 400 KB.
- `scene.py` is `laugh-track.py` with the two lines the other scenes carry in place of its import-path line.
- `mark.svg` is a square silhouette of a lit LAUGH sign that reads at 18px.
- `art.json` carries the credit and license the other folders carry, word for word.

**The `CardUi` entry** (Effect and ConfigForm lazy, from Tasks 12 and 13):

- `art`: `color: '#d24a2c'`, `ink: '#1a0602'`, `tagline: 'Give a post a studio audience.'`
- `summary`: `'Cues a studio audience to laugh, cheer or boo at the words you choose, wherever they appear in a post.'`
- `status`: `'A studio audience on cue'`
- `hint`: `'A Laugh Track: the audience reacts when you reach certain words. Turn on Game sounds in Settings to hear it.'`
- `describe`:

  ```ts
  `A Pepperoni card, ${laughTrack.rarity}. You choose up to five phrases in a post and give each a sound: the audience laughs, cheers or boos. Wherever a phrase appears in the post's own words, the audience reacts as a reader reaches it, and builds up as they get close. Every reaction is also shown as a caption, so it works with sound off. One audience fits on a post. ${setMoveWords('the quoting post')} Set face down, it waits for a quote that says its first phrase. It costs more to play the more places its phrases cover.`
  ```

- `surcharge`: `` (s) => `Many places, +${s.economy['laughTrack.perPlace'] / 100} per place past ${s.economy['laughTrack.freePlaces']}` `` (in the form Autocorrect's line takes).
- `logPlay`: `() => 'It gave the post a studio audience.'`

Tests first: `node tools/check-card-art.mjs` is red with the folder missing a file, then green, with `art.webp`'s size
shown. `index.test.tsx` holds every string above, and that `describe` is true to the rules. Any test that counts the
machine's slots or the Booster's uncommons is updated with its red run.

## Task 12. The play form

Model: sonnet

**Files:** new `instances/divided-world/ui/laugh-track/ConfigForm.tsx`, `ConfigForm.test.tsx`, `laugh-track.css`.

The form follows `instances/divided-world/cards/autocorrect/ConfigForm.tsx`:

- a `fieldset` "Your audience's cues", and up to five rows;
- each row holds a phrase input (labeled "Phrase", `maxLength` `PHRASE.most`) and a `select` labeled "Sound" (Laugh,
  Cheer, Boo), and a remove button for every row but a lone one;
- an "Add a cue" button while fewer than five rows.
- Under each row, a status line counts its places through `placesOf`: "Cues N places in this post", or "Not in this
  post's own words".
- Under them, the play's total, "N places in all (at most 30)", and the first row is marked "A face-down Laugh Track
  waits for this phrase".

**Picking words.** Above the rows, a read-only copy of the post's visible text (the board's quote box style). Selecting
words there fills the phrase of the row that last had focus (the first row if none). The selection's text is trimmed to
whole words by the same matcher. The copy is a `blockquote` with `aria-label="The post's words, to select from"`, and
typing a phrase stays a full path for a keyboard.

Tests first: rows add up to five and remove; each row's count; the total; selecting text fills the focused row;
`onChange` gives `{ cues }` in the rules' shape.

## Task 13. The effect

Model: sonnet

**Files:** new `instances/divided-world/ui/laugh-track/Effect.tsx`, `Effect.test.tsx`, `watch.ts`, `watch.test.ts`,
`line.ts`, `line.test.ts`, `LaughTrack.board.stories.tsx`; `laugh-track.css`.

**`line.ts`**, pure, the bench's arithmetic over numbers:

- `readingLine(viewportHeight, hudHeight, percent)`;
- `distance(rects, lineY, pointer?)`, where a pointer's distance counts double, as the bench's does;
- `murmurGain(distance, reachPx, most)`, linear from `most` at the line to 0 at the reach.

**`watch.ts`**, one watcher for the page:

- Places register an element, a key and callbacks (`near(gain)`, `fire()`), and unregister on unmount.
- It holds one `IntersectionObserver` (root margin the reach) to know which places are near the viewport, one
  passive `scroll` listener and one `pointermove` listener (fine pointers only, `pointerType === 'mouse'`).
- It runs `requestAnimationFrame` frames only while the page scrolls, the pointer moves, or a place rests on the line
  waiting out its dwell. It never runs an interval.
- Each frame it measures only the near places. It fires one that has rested on the line for `dwellMs`, and gives each
  near unfired place's sound kind its gain. **The nearest place of each kind wins its kind's murmur.**
- The HUD's height is read from `--kb-hud-measured`.

**`Effect.tsx`** (`LaughTrackEffect`, an `EffectProps` component):

- It reads its one play's `config.cues` and `config.seed`, and the post's visible text.
- It finds the places with `placesOf`. A cue whose phrase is no longer in the post has none and stays quiet.
- It wraps `children` in a `TextLayer` of `wrap` runs, one for each place, with `z` 0. Each piece is a
  `span.dw-lt-cue` with `data-sound`. After the place fires it gets the class `dw-lt-fired` (the dotted underline in its
  flavor ink: `--kb-pepperoni`, `--kb-sweet`, `--kb-salty`), and its first piece gets `tabindex="0"`, `role="button"` and
  `aria-label` "Replay: the audience laughs" (or cheers, boos).
- The underline is `text-decoration`, so no word moves.
- **The take** for each place is `seeded(\`${play.id}:${seed}:${placeIndex}\`)`, from `instances/divided-world/ui/seeded.ts`,
  picking 1 to 3.
- **The murmurs.** It registers each place with the watcher. A place's `near(gain)` drives its kind's loop
  (`useSound().loop('laugh-track.titter' | 'ooh' | 'grumble', { group: 'audience-build', id: \`laugh-track:${kind}\` })`,
  gain × `murmurMost`).
- **A fire** plays the place's take (`play(key, { group: 'audience', fadeMs })`) and fades its kind's loop to 0 over
  `fadeMs`.
- **A replay** (hover with a fine pointer, focus, a press, Enter or Space) plays its take again.
- Fired places are the effect's own state, for this visit to this page: nothing is saved or sent.
- **`show`:**
  - `progress` is the share of the play's places fired;
  - `state` is "N of M cues heard" (at most 6 words);
  - there is no `ends`, since it holds no reader and covers nothing;
  - `yours` is false;
  - `controls` holds one `toggle`, labeled "Game sounds", from `useGameSound()`;
  - `notes` is empty.
  - It is cleared with `show(null)` on unmount.
- `met()` once, when the first place fires.
- **In a play's moment (`still`):** no place registers, nothing fires or plays, no handler is bound, no piece is
  focusable, and `show` gives "M cues" with no controls.
- In the ORIGIN box it behaves as in the thread.
- It reads neither `reader.author` nor `reader.caster`.

Tests first:

- `line.test.ts`: the line's place at 40% above a 76px HUD, distances with and without a pointer, the gain's ends and
  middle.
- `watch.test.ts`, with a fake observer and frames: a place resting for the dwell fires once; one flung past does not;
  the nearest of a kind wins its murmur; frames stop when nothing moves or waits.
- `Effect.test.tsx`, with the watcher's fire driven by hand and `useSound` faked:
  - each place is wrapped and unmarked before it fires;
  - a fire plays the seeded take, marks the place and focuses nothing;
  - a replay by focus, press and key plays again;
  - with Game sounds off, a fire says the caption (through the real `useSound` with its mixer faked);
  - a cue edited out of the post draws no place;
  - `show`'s views and the Lens word rules (`lens-words.ts`);
  - `still` binds nothing;
  - `show(null)` on unmount.

The board story is the bench's thread (a post with "Luigi" booed twice, a cheer and a laugh), on both boards, with a
play function that scrolls a place onto the line.

## Task 14. Part 2 in a browser, and the build

Model: sonnet

**Files:** new `e2e/laugh-track.spec.ts`; `e2e/board-stories.test.ts` (the new story ids); the a11y spec's story list
if it is a list.

Tests first, on the story:

- scrolling a place onto the line and holding fires it: its underline shows and the caption bar says "THE AUDIENCE
  BOOS";
- a fast scroll past fires nothing;
- Tab reaches a fired place and Enter replays it;
- axe finds nothing on both boards;
- at a phone's width the caption fits;
- with sound off nothing is fetched (no request for an `.mp3`).

Then `npm run typecheck`, `npm run build` and `npm run test:e2e`, with the tails in the PR.

# Ways out

- **A reader** turns Game sounds off in Settings, in the welcome step, or from the post's Lens; the captions stay. A
  reader who wants a cue again replays it.
- **The author** edits a phrase out of the post, and that cue goes quiet.
- **An admin** ends the play (`reverse_card`), and every cue goes.
- **A sound** that never loads leaves its caption, and nothing waits on it.
- No state added here holds a player, a character or a post.

# The masks

- Nothing about reading is sent: the watcher, the fired places and the murmurs live on the reader's screen alone.
  No request, Realtime event, saved state or timing depends on what a reader read.
- What sounds and what is captioned is computed from the play's public configuration (its cues and its seed) and the
  reader's own scroll and pointer. Nothing reads who owns, wrote or cast anything.
- The four settings are read by their own account alone, as `account_preferences` is.
- A persona's repaired options name trims of its own options on the call's record, which holds nothing private.

# Review focus

- **The autoplay unlock across browsers.** Safari unlocks only on certain gestures (`touchend`, not `touchstart`), and
  a context made before a gesture warns. Read it on iOS Safari and desktop Chrome: does the first gesture unlock it, and
  is nothing queued from before?
- **A busy page.** Forty posts with Laugh Track, thirty places each: is the watcher one observer and two listeners,
  with no frames while the page is still?
- **Overlapping cards on a post.** Laugh Track's wrap runs under Autocorrect's tape (a replace run) and over Whoops!'s
  ink: a taped-over phrase has no place drawn, and the underline must not show through the tape.
- **The caption bar and the toasts.** A caption and three toasts at once, on a phone, with the hand open: nothing
  covers the HUD or the hand, and nothing jumps.
- **A Mod Bot's repaired options.** Does the ledger row name each trim, and does a persona's seven-cue answer become a
  five-cue play rather than the fallback?
- **The export.** The four settings round-trip (Task 1's `0003-export.ts`), and an instance with no sounds (an empty
  `sounds`) still boots and draws Settings › Sound.
- **The words.** The settings copy (Task 5) and the card's words (Task 11) are the owner's to approve in review.
