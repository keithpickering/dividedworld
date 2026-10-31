/**
 * Board 10, the Roster board (docs/research/2026-10-29-two-worlds/10-roster.html): My characters at
 * 08:30 on Oct 30, just after the settlement that took Pipewrench's Turn to Face, Pipewrench
 * selected. The glass plan's section 7 lists what is compared; where the build departs from the
 * board, the landmark says why where it sets a `buildName` or a box mode.
 *
 * Words the screen had before the glass and keeps (web Task 9's, which every glass amendment says
 * stand): its heading "Your characters (3 of 6)" for the board's MY CHARACTERS, its lead line, and
 * Edit profile for the board's Change avatar. The menu bar's tabs are compared in full: the
 * Vending Machine's joined it with the cards (the glass build plan, Part 3).
 *
 * Left out: "Pipewrench's log", whose page is Part 4's. Mrs. Hooligan's and Spritey's classes and
 * Turns are the fixture's, not the board's (the board's Mrs. Hooligan is a Jabroni in her cooldown;
 * the fixture's is a Face who has never Turned), so only Pipewrench's card and Spritey's Turn line
 * are compared.
 */
import type { BoardManifest } from '../board-match.ts';

const manifest: BoardManifest = {
  board: '10-roster',
  size: { width: 1440, height: 1160 },
  build: { moment: '10-roster' },
  landmarks: [
    /* The menu bar, My characters current. */
    { id: 'menu', role: 'navigation', name: 'Menu', type: false },
    /* The board writes the key cap into the link's name; the build hides it (MenuBar.tsx). */
    { id: 'menu-back', role: 'link', name: 'ESC BACK TO THE BOARD', buildName: 'Back to the board', within: 'menu' },
    { id: 'menu-vending', role: 'link', name: 'Vending Machine', within: 'menu' },
    { id: 'menu-characters', role: 'link', name: 'My characters', within: 'menu' },
    { id: 'menu-rankings', role: 'link', name: 'Rankings', within: 'menu' },
    { id: 'menu-log', role: 'link', name: 'My log', within: 'menu' },
    { id: 'menu-settings', role: 'link', name: 'Settings', within: 'menu' },

    /*
     * The head: the heading's words are the screen's own, and longer, so its box is compared by
     * position; the lead line beside it, its words the screen's too, is pushed right by the heading,
     * and its top and height, two lines at the heading's foot, are compared.
     */
    { id: 'title', role: 'heading', name: 'My characters', buildName: 'Your characters (3 of 6)', box: 'position' },
    {
      id: 'lead', role: 'text',
      name: 'Only you see this page. The classes here are never shown to anyone else unless you announce them.',
      buildName: 'This page is out of character and only you can see it. Classes are shown here and nowhere else unless you reveal them.',
      box: 'height',
    },

    /* The roster, and Pipewrench's card: its name, its class in its color, its rank and its next Turn. */
    { id: 'roster', role: 'list', name: 'Roster, 3 of 6 slots used', type: false },
    { id: 'card-name', role: 'text', name: 'Pipewrench', within: 'roster' },
    { id: 'card-class', role: 'text', name: 'Face', within: 'roster' },
    { id: 'card-rank', role: 'text', name: 'Midcarder', within: 'roster' },
    { id: 'card-turn', role: 'text', name: 'Next Turn opens Nov 29', within: 'roster' },
    /*
     * Spritey's Turn, ready: the third card on both sides, in the order they joined. The fixture's
     * Mrs. Hooligan has never Turned, so the build's first "Turn ready" is hers and Spritey's the second.
     */
    { id: 'card-ready', role: 'text', name: 'Turn ready', within: 'roster', buildNth: 1 },
    { id: 'new', role: 'link', name: 'New character', within: 'roster' },

    /* The selected panel, chamfer step 4. */
    { id: 'panel', role: 'region', name: 'Pipewrench', type: false },
    { id: 'panel-selected', role: 'text', name: 'Selected', within: 'panel' },
    { id: 'panel-name', role: 'heading', name: 'Pipewrench', within: 'panel' },
    /* The class's "only you" tag follows it on the build's line (web Task 9), so the chip stands left of the board's: its size is compared. */
    { id: 'panel-class', role: 'text', name: 'Face', within: 'panel', box: 'size' },
    { id: 'panel-was-label', role: 'text', name: 'Was', within: 'panel' },
    { id: 'panel-was', role: 'text', name: 'Heel, announced publicly', within: 'panel' },
    { id: 'panel-rank-label', role: 'text', name: 'Rank', within: 'panel' },
    { id: 'panel-wallet-label', role: 'text', name: 'Wallet', within: 'panel' },
    { id: 'panel-posts-label', role: 'text', name: 'Posts', within: 'panel' },
    /* The pip style, the profile's own, chosen here. */
    { id: 'panel-pip', role: 'combobox', name: 'Pip style', within: 'panel' },
    /* The Turn that opens later, in the neon's text on a dashed edge; its name is the screen's own. */
    { id: 'panel-turn', role: 'button', name: 'TURN · OPENS NOV 29', buildName: 'Turn Pipewrench', within: 'panel' },
    { id: 'panel-cooldown', role: 'text', name: 'A character can Turn once every 30 days. Pipewrench last Turned at the Oct 30 settlement.', within: 'panel' },
    { id: 'panel-avatar', role: 'link', name: 'Change avatar', buildName: 'Edit profile', within: 'panel' },
    {
      id: 'panel-most', role: 'text', name: 'Six characters at most. To free a slot, ask an admin to retire one; every Act it made stays on the board.',
      buildName: '6 characters at most. To free a slot, ask an admin to retire one; every Act it made stays on the board.',
      within: 'panel', box: 'position',
    },
  ],
};

export default manifest;
