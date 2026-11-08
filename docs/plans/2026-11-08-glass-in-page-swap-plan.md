# Glass in-page swap: plan

Record, written 2026-11-08. Carries out `docs/plans/2026-11-08-glass-in-page-swap-design.md`. Every task goes test
first: write the failing test, show its red run, then write the code. During a task, run only the tests for the
changed code (`npx vitest run <file>`). Run `npm run build` once after the last task. All of it is engine.

## Task 1. `Page` counts screens by path, and publishes the key

Model: sonnet.

Files: `engine/ui/glass/Page.tsx`, `engine/ui/glass/Page.test.tsx` (or the nearest existing Page test).

- `now.n` goes up when the path changes, not on every change of the router's key. Keep the existing rules: a key two
  paths share is one screen, and the settling on first load is not a change. Write `now.path` next to `now.key`.
- Add a React context, `ScreenKeyContext` in a new `engine/ui/glass/ScreenBody.tsx`. It carries the resolved router
  key and the `popped` flag for the current screen. `Page` provides it around `children`.
- Tests first: on `/settings` then `/settings?section=board`, the `.kb-glass-screen` element is the same node (no
  second one marked `data-kb-exiting`), `main` does not take focus, and the window does not scroll to 0. On
  `/settings` then `/season`, the screen is replaced and `main` takes focus, as today. On `/characters` then
  `/characters/edit`, there is still one screen.

## Task 2. The screen body part

Model: sonnet.

Files: `engine/ui/glass/ScreenBody.tsx`, `engine/ui/glass/ScreenBody.test.tsx`, `engine/ui/glass/shell.css`,
`engine/ui/glass/enter.ts`.

- `ScreenBody({ at, axis, className, children, ...rest })`: `at` is the body's place in the in-page order, and
  `axis` is `'x' | 'y'`. Inside: `<AnimatePresence initial={false} custom={dir}>` with one
  `<Leaving key={screenKey} custom={dir} {...(axis === 'x' ? screen(feel) : swap(feel))}>`. The direction state works
  as `Page`'s does: when `at` changes, it is set from the sign of the change, and an equal `at` keeps it.
- The exiting body is laid over the entering one, as `.kb-roster-layout > .kb-roster-panel[data-kb-exiting]` is. Add
  `.kb-screen-body` (`position: relative` holder) and `.kb-screen-body > [data-kb-exiting]` (`position: absolute;
  inset: 0 0 auto; pointer-events: none`) to shell.css, and add the class to `tools/check-css-classes.mjs`'s known
  list if it needs one.
- On a key change (not on mount), a layout effect runs `enterScreen(feel, newBody)` on the entering body only. Check
  that `entrants` takes no head there (the body holds no `.kb-page-head`, so nothing needs to change). Then, unless
  `popped`: if the body's top is above `--kb-glass-menu-height`, scroll the window by that difference.
- Tests first: a key change renders two bodies while the exit runs, with the old one `inert`. Under Off, there is one
  body at once. Moving from `at` 0 to 2 gives a direction of +1, and from 2 to 1 gives -1. An equal `at` keeps the
  last direction. Focus stays on the button that was pressed.

## Task 3. Settings, Season and Updates wrap their bodies

Model: sonnet.

Files: `engine/ui/account/Settings.tsx`, `engine/ui/season/Season.tsx`, `engine/ui/updates/Updates.tsx`, and their
tests and board stories.

- Settings: `Frame` wraps `children` in `<ScreenBody at={SECTIONS index of section} axis="y">`. The signed-out frame
  wraps nothing.
- Season: the `role="tabpanel"` element stays put, so its `id` and `aria-labelledby` hold. Its contents are wrapped in
  `<ScreenBody at={TABS index of tab} axis="x">`.
- Updates: `.kb-updates-main` holds `<ScreenBody at={index of current in updates} axis="y">`, so newer updates are
  above the older ones, as in the archive.
- Tests first, one for each screen: a section, tab or update change keeps the same `h1` node and the same navigation
  node, and the pressed control keeps focus. Update `Settings.tsx`'s header comment to say that only the section
  enters.

## Task 4. End to end

Model: sonnet.

Files: the glass e2e spec that walks Settings (find it under `e2e/`).

- On the Smooth feel, press Settings › The board. Mid-transition, sample the `h1`'s computed `filter` and `opacity`:
  `none` and `1` the whole way. Afterwards, the focused element is The board's button.

## Review focus

- A body's exit holds the router's old view (`Leaving`'s `RouterHold`). Check that the Account section's invites, from
  its document, do not flash empty or show the new section's data while they leave.
- A Season tab press whose load fails: the head must not be left with the new tab lit over the old body.
- The scroll rule on a long Rankings page pressed at its foot: the new page's top comes into view, and the page does
  not jump to 0.
