Record, written 2026-11-27.

# Front door: maximizing landing impact (plan)

The design is `docs/plans/2026-11-27-front-door-impact-design.md`. Every task tests first and shows its red run. The
PR closes #1235. It changes CLAUDE.md (Task 5), so it waits for the owner to merge it.

## Task 1. The unlock keeps trying until it succeeds (#1235)

Model: sonnet

Files: `engine/ui/audio/sound.ts` (`createSound`, `GESTURES`, `realDeps.makeContext`), `engine/ui/audio/mixer.ts`
(`AudioContextLike`, `createMixer`'s `unlock`), `engine/ui/audio/sound.test.tsx`, `engine/ui/audio/mixer.test.ts`.

Tests first:
- `sound.test.tsx`: use a fake context whose first `resume()` never settles and whose second resolves. Fire one
  `pointerdown`, then one `click`, and expect the mixer to be unlocked (a `play` on an on bus sounds). Red today,
  because `unlocking` holds the second gesture back.
- `sound.test.tsx`: a fake context whose `resume()` never settles but whose `state` reads `'running'` after the call
  is unlocked after one gesture, and the gesture listeners are removed.
- `sound.test.tsx`: `click` and `pointerup` are among the unlock gestures. Each alone unlocks a fresh page.
- `mixer.test.ts`: two `unlock()` calls make one context and call `resume()` twice. The first `unlock()` resolves
  `true` once the second's `resume()` resolves.
- `sound.test.tsx`: where `navigator.audioSession` exists, making the context sets its `type` to `'ambient'`. Where
  it is absent, nothing throws.

Build:
- `AudioContextLike` gains an optional `readonly state?: string`.
- `unlock()` makes the context once and calls `resume()` synchronously. Before its first `await`, if `made.state ===
  'running'` it is unlocked. Otherwise it awaits the resume.
- Drop the `unlocking` gate in `onGesture`. Each gesture until the first success calls `mixer.unlock()`, and the first
  success removes the listeners. A second call while one is out is harmless, and the spec settles both pending
  promises together.
- `GESTURES` becomes `pointerdown`, `pointerup`, `click`, `keydown`, `touchend`.
- `realDeps.makeContext` sets `navigator.audioSession.type = 'ambient'` where `audioSession` exists, inside a
  try/catch, before making the context. Its header comment says why: `'playback'` would play through the silent
  switch but pause the person's music (the design, section 1).
- Rewrite the comment above `onGesture` to describe the new behavior.

## Task 2. The visitor layer

Model: sonnet

Files: `engine/ui/audio/sound.ts` (`createSound`, a new `stageSound`), `engine/ui/appearance.ts` (`applyAppearance`,
a new `stageEffects`), `engine/ui/audio/sound.test.tsx`, `engine/ui/appearance.test.tsx`.

Tests first:
- `sound.test.tsx`: `setSoundPreference` with game off, then `stageSound({ gameSound: 'on' })`. The game bus is on.
  After `setSoundPreference` with game off again it is still on while staged. After release it is off. With the order
  reversed (stage, release, then a preference with game on) it is on.
- `sound.test.tsx`: a release called twice, or after a newer stage, releases only its own stage. The newest stage
  held wins.
- `sound.test.tsx`: while staged, the volume is the last preference's `gameVolume`. The interface bus follows the
  preference alone.
- `appearance.test.tsx`: `stageEffects('bright')` marks `data-kb-effects="bright"` on the root. A later
  `applyAppearance` with `effects: 'standard'` keeps it while staged. Release puts back what the last
  `applyAppearance` asked for, bright or none. `stageEffects('standard')` over a preference of bright removes the
  mark while held.

Build:
- `createSound` keeps the last `SoundPreference` and a stack of stages. The game bus is set from the newest stage's
  `gameSound` when one is held, else from the preference, with the preference's volume. `stageSound` on the page's
  instance returns a release that removes only its own entry and sets the buses again.
- `appearance.ts` keeps the last effects asked for by `applyAppearance` and a stack of stages. `mark(root,
  'data-kb-effects', …)` reads the newest stage, else the preference. `stageEffects(value, doc = document)` returns
  its release.
- Each new export has a header comment that names the front door as its user and gives the reason for the layer: an
  unmount after a sign-in must not undo the account's settings.

## Task 3. The front door stages sound and bright effects, and draws the toggle

Model: sonnet

Files: `engine/ui/front-door/FrontDoor.tsx` (`FrontDoor`, a new `SoundToggle`), `engine/ui/front-door/front-door.css`,
`engine/ui/front-door/FrontDoor.test.tsx`, and the header comment of `FrontDoor.tsx`.

Tests first:
- Mounting the door with a staged play whose card has `sounds` turns the game bus on. Unmounting turns it back to the
  page's preference. Use `resetSound` with fake deps, as `sound.test.tsx` does.
- Mounting the door puts `data-kb-effects="bright"` on the root, and unmounting removes it. With `matchMedia`
  answering `(prefers-contrast: more)` or `(forced-colors: active)` it does not. A media `change` event while mounted
  moves it either way.
- The toggle is a button named "Game sounds" whose visible text reads "Sound: on", with `aria-pressed="true"`. Pressing
  it reads "Sound: off" with `aria-pressed="false"`, and the game bus is off. Pressing it again turns the bus back on.
- With no staged play whose card has `sounds`, there is no toggle, and the door still stages bright effects but not
  sound.
- The existing test that wraps every API method still shows no call, now including after a toggle press.

Build:
- `FrontDoor` computes `noisy` from `door.posts`' plays and `ui.cards`' `sounds`. One `useEffect` holds
  `stageSound({ gameSound: on && noisy ? 'on' : 'off' })` while mounted and re-stages when `on` changes. It releases
  on cleanup. `on` is `useState(true)`.
- One `useEffect` holds `stageEffects(highContrast ? 'standard' : 'bright')`, where `highContrast` is a
  `useSyncExternalStore` over `matchMedia('(prefers-contrast: more)')` and `matchMedia('(forced-colors: active)')`,
  modeled on `ThemePicker.tsx`'s `subscribeDevice`. Without `matchMedia` the door treats it as false.
- `SoundToggle`: `<button type="button" className="kb-button kb-front-door-sound" aria-pressed={on}
  aria-label="Game sounds">Sound: {on ? 'on' : 'off'}</button>`, drawn after the label in `.kb-front-door-top`.
  It is in the board's style. Use the board's existing button class if one exists, else a bordered Verdana button in
  `front-door.css` beside `.kb-front-door-label`. It has a visible focus ring. The press itself is the unlock
  gesture, so no other code is needed.
- `useWarmSounds` is already called by the card effects. Add nothing for it.
- Update the header comment of `FrontDoor.tsx`: the door stages bright effects and game sound for a visitor, with the
  toggle as the visitor's mute, citing the design.

## Task 4. Settings says a phone on silent stays silent

Model: inline

Files: `engine/ui/account/appearanceRows.tsx` (`SOUND_ROW.game.says`), and any test or welcome test that asserts the
sentence. Find them with a grep for `Every one is also shown as a caption`.

Test first: the Settings test asserts the new sentence. It is red until the copy changes.

Build: `says` becomes "Sounds that cards and other game effects make on the board. Every one is also shown as a
caption at the bottom of the screen. A phone set to silent keeps them silent."

## Task 5. The rule carries the owner's answer

Model: inline

Files: `CLAUDE.md` (the section "An accessible path costs what the obstacle costs"),
`docs/working-rules/an-accessible-path-costs-what-the-obstacle-costs.md`.

Build:
- In CLAUDE.md, append to the rule's prose paragraph: "The front door, shown to a visitor who has no settings yet,
  draws card effects at their full colors unless the device asks for more contrast: it demonstrates the game, and a
  reader who needs contrast gets it from their device's own setting."
- In the record, add a second incident in the file's form. In the front-door design session of 2026-11-27
  (`docs/plans/2026-11-27-front-door-impact-design.md`), Brighter effects, which falls below the contrast standard
  and is opt-in on the board, was proposed as the front door's default. The owner's words: "I'd say it's forgivable
  to enable that for the front door just so people really get the full impact, considering the content is just a
  means to an end", and "Bright by default with the prefers-contrast check is acceptable" (the owner, 2026-11-27).
- Run `node tools/check-working-rules.mjs` and show it passing.

## Task 6. Build and check

Model: inline

Run `npm run typecheck` and `npm run build:ci`, and show both passing. In a browser, load the front door signed out
(the `run` skill). Show a screenshot of Feelin' Fab's bright foil on #2 and the toggle in the top row. Show a second
screenshot under Playwright's `page.emulateMedia({ contrast: 'more' })`, where the foil is standard.

## Review focus

- A sign-in, a sign-out or a session change in another tab while the door is mounted. The account's own Brighter
  effects and Game sounds must stand once the door is gone, whichever order the unmount and the preference read take.
- The unlock on real browsers, which jsdom cannot show: iOS Safari (a tap after a scroll, the silent switch) and
  Android Chrome (a first touch that scrolls). The reviewer says whether this was tried on a device or only reasoned.
- Any shine or effect that reads `data-kb-effects` once and misses a late change. `band.ts` reads it per call. Feelin'
  Fab, Glitter Bomb and Autocorrect observe the root. Is anything drawn before the door's effect runs, and does
  it redraw afterwards?
- Whether the stage stacks can leak in a long session: every stage must be released by its cleanup, including under
  StrictMode's double effects.
