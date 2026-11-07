/**
 * Board 19, Settings › The board (docs/research/2026-11-06-board-look/19-theme-picker.html, 1440 by 1120) with the house theme chosen, as the story `Boards/19 Theme picker`
 * (engine/ui/account/ThemePicker.board.stories.tsx) draws it. The board look design's section 9 and the plan's Task 16 list what is compared: the heading and the
 * rail with the new section between Accessibility and Notifications; the Theme row (the chosen theme's miniature, one tile per theme with its modes, the sentence)
 * and the Mode row (Follow my device, Light, Dark, with the sentence).
 *
 * Every part of the section is compared from the section heading's own corner (`origin`), as board 33 is: the page head leaves 36px under the title where the
 * board leaves 66, so the rail and the section stand 40px higher than the board draws them.
 *
 * Departures by decision:
 *  - The board shows five themes; the instance offers House alone until Task 17, so the story adds four test themes of the boards' names and colors after it
 *    (the story's header). The tiles are compared by their names and modes, which are the stories'.
 *  - The miniature's sample text is plain (the authors are Ann, Bo and Cy where the board names the instance's characters), and it is decoration, so it is held
 *    by its banner, its bar and its button, not by the rows' words.
 *  - The buttons of the rail are GlassButtons, 48px tall where the board's `.btn` is 54, as board 33 holds them.
 *
 * Phone: board 21 is the picker at 390 by 844 (its own manifest); board 20 is this page with Hot Rod chosen.
 */
import type { BoardManifest, Landmark } from '../../board-match.ts';

/** A GlassButton, 48px tall where the board's `.btn` is 54. */
const BUTTON = { height: -6 } as const;

/** A part of the section, held from the section heading's corner. */
export const inSection = (id: string, role: string, name: string, more: Partial<Landmark> = {}): Landmark => ({ id, role, name, origin: 'board', box: 'position', type: false, ...more });

export const rail = (current: string): Landmark[] => [
  { id: 'menu', role: 'navigation', name: 'Menu', type: false },
  { id: 'menu-back', role: 'link', name: 'ESC BACK TO THE BOARD', buildName: 'Back to the board', within: 'menu', box: 'height' },
  { id: 'title', role: 'heading', name: 'SETTINGS', nth: 0 },
  { id: 'sections', role: 'navigation', name: 'Settings sections', box: 'across', type: false },
  { id: 'section-account', role: 'link', name: 'ACCOUNT', within: 'sections', origin: 'sections', box: 'height', type: false, buildShift: BUTTON },
  { id: 'section-accessibility', role: 'link', name: 'ACCESSIBILITY', within: 'sections', origin: 'sections', box: 'height', type: false, buildShift: { y: -6, height: -6 } },
  { id: 'section-board', role: 'link', name: current, within: 'sections', origin: 'sections', box: 'height', type: false, buildShift: { y: -12, height: -6 } },
  { id: 'section-notifications', role: 'link', name: 'NOTIFICATIONS', within: 'sections', origin: 'sections', box: 'height', type: false, buildShift: { y: -18, height: -6 } },
  { id: 'reach', role: 'link', name: 'Reach a person', origin: 'sections', box: 'position', buildShift: { y: -24 } },
];

/** The section's two rows, the Theme row's miniature and tiles by their words, and the Mode row's choices. */
export const rows = (note: { readonly name: string; readonly buildName?: string }, tileNames: readonly string[]): Landmark[] => [
  { id: 'board', role: 'heading', name: 'THE BOARD', box: 'across' },
  inSection('theme-label', 'heading', 'THEME'),
  inSection('preview-logo', 'text', 'DIVIDED WORLD'),
  inSection('preview-button', 'text', 'start a thread'),
  ...tileNames.map((n, i) => inSection(`tile-${i}`, 'text', n, { nth: 0 })),
  inSection('theme-note', 'text', 'Applies to the board at once, on every device you sign in on.'),
  inSection('mode-label', 'heading', 'MODE'),
  inSection('mode-device', 'text', 'FOLLOW MY DEVICE'),
  inSection('mode-light', 'text', 'LIGHT', { nth: 0 }),
  inSection('mode-dark', 'text', 'DARK', { nth: 0 }),
  inSection('mode-note', 'text', note.name, { buildName: note.buildName }),
];

const manifest: BoardManifest = {
  board: '2026-11-06-board-look/19-theme-picker',
  size: { width: 1440, height: 1120 },
  build: { story: 'boards-19-theme-picker--picker' },
  landmarks: [
    ...rail('THE BOARD'),
    ...rows({ name: 'The 2003 board stays 2003 whichever you choose. Only its look changes. The game’s own pieces (orbs, cards, reactions, marks) keep theirs.', buildName: 'The 2003 board stays 2003 whichever you choose. Only its look changes. The game\'s own pieces (orbs, cards, reactions, marks) keep theirs.' }, ['HOUSE', 'BLUE STEEL', 'MIDNIGHT', 'HOT ROD', 'FAN SITE']),
  ],
};

export default manifest;
