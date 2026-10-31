/**
 * Board 11, the Settings board (docs/research/2026-10-29-two-worlds/11-settings.html, 1440 by 1360):
 * Settings › Accessibility as the player sees it at 08:30 on Oct 30, the app at the boards fixture's
 * `11-settings` moment. The glass plan's section 7 lists what is compared, in full: the menu bar, the
 * heading, `navigation "Settings sections"`, and Accessibility's heading, its sentence, each of the
 * radiogroups Motion, Smoke, Contrast, Text size and The board with its label, its choices and its
 * sentence, and "Changes save as you make them."
 *
 * Where the build differs by a decision:
 *  - the menu bar holds all six tabs (web Task 3; the glass plan, section 3), as the board draws them
 *    now (it draws Rankings and the Vending Machine too), each compared in full;
 *  - the sections' navigation holds Account and Accessibility (the glass plan, section 9, choice 3):
 *    the board's Notifications, Privacy and Export my data are not built;
 *  - "The board" is the radiogroup's name, as its row's label, where the board names it "Board colors";
 *    it offers Follow my device and the instance's own themes beside the board's two (section 9,
 *    choice 4), and a row of its own, Posts, follows it, where the board draws Read-outs, which is not
 *    built (web Task 11);
 *  - The board's sentence, with more than two choices, says "whichever you choose" for "either way"
 *    and "its colors" for "its two colors". (Motion's names Stick Around in the instance's own copy,
 *    `InstanceUi.copy.reducedMotionCard`, since the engine names no card, and reads as the board's.)
 *
 * Not compared: the smoke and its calms, which are the guards' (tools/check-glass-contrast.mjs and
 * e2e/glass-text.spec.ts). "Changes save as you make them." follows the build's own rows (Posts, and the card tips'
 * row) where the board's follows Read-outs, so it is held by its words and type, not its place.
 */
import type { BoardManifest, Landmark } from '../board-match.ts';

/** A row of choices: its label, its radiogroup, each choice's face by its words, and its sentence. */
function row(id: string, label: string, group: string, choices: readonly string[], sentence: string, buildGroup?: string, buildSentence?: string): Landmark[] {
  return [
    { id: `${id}-label`, role: 'heading', name: label },
    { id, role: 'radiogroup', name: group, ...(buildGroup ? { buildName: buildGroup } : {}), type: false },
    ...choices.map((c): Landmark => ({ id: `${id}-${c.toLowerCase().replace(/\W+/g, '-')}`, role: 'text', name: c, within: id })),
    /* A sentence the build words otherwise runs to its own length: its place and its type are compared. */
    { id: `${id}-sentence`, role: 'text', name: sentence, ...(buildSentence ? { buildName: buildSentence, box: 'position' as const } : {}) },
  ];
}

const manifest: BoardManifest = {
  board: '11-settings',
  size: { width: 1440, height: 1360 },
  build: { moment: '11-settings' },
  landmarks: [
    /*
     * The menu bar, Settings current, its tabs compared in full (the Vending Machine's joined the
     * bar with the cards, the glass build's Part 3).
     */
    { id: 'menu', role: 'navigation', name: 'Menu', type: false },
    { id: 'menu-back', role: 'link', name: 'ESC BACK TO THE BOARD', buildName: 'Back to the board', within: 'menu' },
    { id: 'menu-vending', role: 'link', name: 'Vending Machine', within: 'menu' },
    { id: 'menu-characters', role: 'link', name: 'My characters', within: 'menu' },
    { id: 'menu-rankings', role: 'link', name: 'Rankings', within: 'menu' },
    { id: 'menu-log', role: 'link', name: 'My log', within: 'menu' },
    { id: 'menu-settings', role: 'link', name: 'Settings', within: 'menu' },

    { id: 'title', role: 'heading', name: 'Settings', nth: 0 },

    /* The sections: Account and Accessibility, the board's first two, in their places. */
    { id: 'sections', role: 'navigation', name: 'Settings sections', box: 'position', type: false },
    { id: 'section-account', role: 'link', name: 'Account', within: 'sections' },
    { id: 'section-accessibility', role: 'link', name: 'Accessibility', within: 'sections' },

    { id: 'accessibility', role: 'heading', name: 'Accessibility' },
    { id: 'lead', role: 'text', name: 'These change how the board and the glass look, read and move. They never change how hard a card is to get through.' },

    ...row('motion', 'Motion', 'Motion', ['Follow my device', 'Reduced', 'Full'],
      'Reduced stops the drifting smoke, the pulses and the orb shine. A card\'s effect stays: Stick Around still snaps you back, only instantly.'),
    ...row('smoke', 'Smoke', 'Smoke', ['Full', 'Low', 'Off'], 'How much cloud sits behind the glass. Off leaves plain black. Text is readable at every setting.'),
    ...row('contrast', 'Contrast', 'Contrast', ['Standard', 'High'],
      'High puts solid black behind every line of text on the glass and lifts it all to at least 7:1. The smoke stays at the edges of the screen.'),
    ...row('text-size', 'Text size', 'Text size', ['100%', '125%', '150%', '200%'],
      'Applies to the board and the glass together. Past 150% the glass folds into one column, and nothing is cut off.'),
    /*
     * The board's two colors follow Follow my device in the build, so each stands one choice further
     * along (box `none`); the board draws Black on white chosen, where the fixture's player follows
     * the device, so its face is the neon fill on the board and the outline in the build (type not
     * compared). White on black is the outline on both, and its type is compared.
     */
    ...row('board', 'The board', 'Board colors', [],
      'The 2003 board stays 2003 either way. Only its two colors swap.', 'The board',
      'The 2003 board stays 2003 whichever you choose. Only its colors swap.'),
    { id: 'board-black-on-white', role: 'text', name: 'Black on white', within: 'board', box: 'none', type: false },
    { id: 'board-white-on-black', role: 'text', name: 'White on black', within: 'board', box: 'none' },

    /* The build's Accessibility sections carry a row the board does not (Cards, "Show card tips again", the callout's way back: marks-and-the-lens plan, Task 7), so this line stands 211px lower than the board's: held by its words and type alone. */
    { id: 'saves', role: 'text', name: 'Changes save as you make them.', box: 'none' },
  ],
};

export default manifest;
