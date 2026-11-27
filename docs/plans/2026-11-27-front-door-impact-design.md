Record, written 2026-11-27.

# Front door: maximizing landing impact (design)

The owner's notes on the front door (`docs/plans/2026-11-05-front-door-design.md`,
`docs/plans/2026-11-07-front-door-play-design.md`):

> Are game sounds turned off in the Front Door on purpose? Steel Chair being a bit jarring could actually work in our
> favor for this landing page, I feel. Not sure how this works on mobile where a gesture is likely required to enable
> sounds (this sometimes doesn't work even on the actual board with sounds enabled).
>
> Similarly, the Fab rainbows are dull, because this front door script doesn't use Brighter Effects. I'd say it's
> forgivable to enable that for the front door just so people really get the full impact, considering the content is
> just a means to an end.

**What the session found.** Neither setting is off by a front-door decision. A visitor has no account, so nothing turns
them on: `web/src/App.tsx`'s `Appearance` puts `DEFAULT_PREFERENCES` on the page when signed out. That means
`gameSound: 'off'` (the mixer's game bus starts off, `engine/ui/audio/mixer.ts`) and `effects: 'standard'` (no
`data-kb-effects` on the root, `engine/ui/appearance.ts`). Both defaults were chosen for the board, by
`docs/plans/2026-11-11-laugh-track-design.md` (section 4) and `docs/plans/2026-11-08-brighter-effects-design.md`
(section 1). Neither design weighed the front door.

On a phone there were three more causes:

- A sound asked for before the unlock is skipped, never queued (the laugh-track design, section 1), and scrolling does
  not unlock audio. Steel Chair throws when its post scrolls into view, so the first throw a visitor reaches is silent
  unless they have already tapped, clicked or pressed a key.
- **Issue #1235.** `createSound`'s `onGesture` (`engine/ui/audio/sound.ts`) ignores every gesture while one unlock is
  out. A `resume()` the browser refuses (the gesture was not a user activation) stays pending, per the Web Audio spec,
  so the gate never opens and the page stays silent until a reload. This is the board's "sometimes doesn't work".
- An iPhone on silent mutes Web Audio.

**World.** The board. The one control this adds is the board's own kind: a plain bordered button in the front door's
top row.

## 1. Decided

**Sound is on at the front door, with a toggle that is also the unlock** (the owner chose this over sound on with no
control, and over a toggle that starts off). A board-style button, **Sound: on** / **Sound: off** (`aria-pressed`),
sits in the top row beside the label "Sample thread · made up". It starts on. Pressing it is a gesture, so it unlocks
audio. It is also a visitor's only mute, since a visitor has no Settings. It is held in memory: a reload brings it
back on, as a reload brings back the thread. It shows only where a staged play's card names sounds (`CardUi.sounds`),
so an instance whose front door makes no sound draws no button. Captions show whether it is on or off, as on the
board. Steel Chair still makes no sound under reduced motion, as its card says.

**Bright effects are on at the front door, unless the device asks for more contrast** (the owner's words: "Bright by
default with the prefers-contrast check is acceptable"). The door puts bright effects on the page while it is
mounted. Under `(prefers-contrast: more)` or `(forced-colors: active)` it puts standard instead, and it follows a
change to either while the door is open. This is written into the rule it bends (section 3).

**The unlock is fixed in this plan, as its first task, and the PR closes #1235** (the owner chose this over a separate
plan, since a landing page that is silent on phones has lost its impact).
- Nothing gates a gesture. Until the page is unlocked, each gesture calls the mixer's unlock, which calls `resume()`
  synchronously inside the gesture. The page counts as unlocked once a `resume()` resolves or the context reads
  `running`, whichever comes first.
- `click` and `pointerup` join the unlock gestures. After a touch, browsers grant user activation on these, not on
  `pointerdown`.

**A phone on silent stays silent** (the owner chose this over `'playback'` everywhere, and over `'playback'` on the
front door alone, because `'playback'` pauses whatever the person is listening to). Where `navigator.audioSession`
exists, its type is set to `'ambient'`, so the game's sounds mix over the person's music. The Game sounds row in
Settings › Accessibility gains a sentence: "A phone set to silent keeps them silent."

**A visitor layer, so no screen's cleanup can undo the account's settings.** `sound.ts` gains `stageSound` and
`appearance.ts` gains `stageEffects`. Each holds an override beside the account's preference and returns its release.
While an override is held it wins; once it is released the last preference applied stands again. The order of the
door's mount, the door's unmount and the account's preferences arriving after a sign-in therefore cannot leave the
wrong value on the page.

Weighed: the door setting `data-kb-effects` and calling `setSoundPreference` itself, and putting the defaults back on
unmount. After a sign-in the door can unmount after the account's preferences have landed, and its put-back would
then wipe out a player's own Brighter effects or Game sounds.

## 2. The layers

All of it is engine code: `engine/ui/audio/`, `engine/ui/appearance.ts`, `engine/ui/front-door/`. The engine names no
card. The button is drawn when a staged play's card has `CardUi.sounds`, which the instance already supplies. The
button's words are the engine's plain control words and are not the persona's.

## 3. The rules this touches

- **An accessible path costs what the obstacle costs.** Bright effects fall below the reading standard, and a visitor
  has no Settings to opt out. The owner's answer is written into the rule's prose and into its record
  (`docs/working-rules/an-accessible-path-costs-what-the-obstacle-costs.md`). Because the PR changes CLAUDE.md, it
  waits on the owner.
- **A response never proves a private fact.** The door still calls no API method. The toggle and the device queries
  are local to the page.
- **No player is ever stuck.** Nothing new holds a visitor. Sound that is on can be turned off with the toggle, and a
  reload resets it. A locked page now unlocks on the next real gesture (#1235).
- **The fiction may lie; the log never does.** The toggle and the Settings sentence say plainly what they do.

## Open

None.
