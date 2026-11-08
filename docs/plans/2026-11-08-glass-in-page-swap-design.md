# Glass in-page swap: design

Record, written 2026-11-08. World: the glass. All of it is engine; no instance file changes.

## 1. What the owner saw

After the glass load merged (`docs/plans/2026-11-07-glass-load-design.md`, section 5), switching between Settings
sections is disorienting: the H1 "Settings" does not change, yet it blurs out and back in with the rest of the page.

## 2. Root cause

`Page` (`engine/ui/glass/Page.tsx`) keys its one `AnimatePresence` child by a count of screens, and that count goes up
whenever the router's key changes (`resolved`). A route's key names its document, so a Settings section
(`settingsKey`, `engine/ui/glass-docs.ts`), a Season tab, season, character or Rankings page (`seasonKey`), and an
opened update (`updatesKey`) each have their own key. Each of these presses therefore replays the whole screen's
transition (motion.ts `screen`), heading and in-page navigation included, plus the entrance stagger (`enterScreen`),
the scroll to the top, and focus moving to `main`. That last part breaks what `Settings.tsx`'s header promises: "the
page does not move its focus from the link the player chose".

The glass-load design was right that such a press is a load that spins its control and that the new content enters.
The bug is in what enters: the screen, when it should be the body that changed.

## 3. Decided

**A screen is a path; a change of key within a path is the body's** (the owner chose this for every glass page, not
only Settings). Two paths that share a key are one screen, as now: My characters and Edit profile.

- `Page`'s screen count goes up only when the path changes (keeping the shared-key rule). The path change keeps
  what it does today: the screen transition, the stagger, the scroll to the top, and focus on `main`.
- A change of key within one path leaves the screen mounted. Its head (`PageHead`, with the Season tabs inside it)
  and its in-page navigation (the Settings rail, the Updates archive) stay still and simply re-render: the current
  button lights, and Season's title says the new season's number.
- The part that changed is a **screen body**, a new shared glass part. A screen wraps its changing part in it. The
  body is keyed by the router's key, so the old body leaves and the new one enters in the same way the roster's
  panel swaps characters today (`Characters.tsx`, motion.ts `swap`). The direction comes from the body's place in the
  in-page order. The new body's panels and rows then get the entrance stagger, with the head left out.
- **Axis follows the navigation.** For a vertical navigation (the Settings rail, the Updates archive) the body moves
  vertically (`swap`). For a horizontal one (the Season tabs) it moves sideways (`screen`). A key change whose place
  is the same, such as a Rankings page or a different season in the same tab, keeps the last direction, as `Page`
  does for a move within one tab.
- **Focus stays on the control that was pressed.** It never moves to `main`. The window scrolls only when the body's
  top is above it, and then just far enough to bring that top into view under the menu bar. Back and Forward keep
  the browser's scroll, as they do now.
- **Off** (reduced motion, or the player's Off): the body swaps at once with no stagger, as every preset already
  returns `{}`.
- The "Screen loaded" status still speaks after a load lands. It belongs to the navigation, not to the transition.

## 4. Alternatives weighed

- *Settings only*: rejected. Season tabs and Updates would keep replaying their headings for the same reason.
- *No swap, stagger only*: rejected. Without an exit, the old body would vanish on the frame the new one mounts.
- *Animate the screen but exclude the head*: rejected. The head and the body are siblings inside one keyed
  element, and an exit cannot leave part of itself behind.

## 5. Rules

- Ways out: no state is added. The masks: no response, payload or timing is added; this is presentation only.
- Accessibility: focus stays on the pressed control, as the rule for the forum itself asks. `aria-current` and
  `aria-selected` move in the same render as the key. The exiting body is `inert` and `aria-hidden` (`Leaving`).
- Layers: engine only (`engine/ui/glass/`, and the three screens that use the part).

## 6. Open

Nothing.
