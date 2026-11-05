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
 * Departures by the glass polish (docs/plans/2026-11-04-glass-polish-design.md, sections 2 and 4): the head is a PageHead (engine/ui/glass/PageHead.tsx), which
 * sets its lead on the title's baseline and leaves 36px under the head, so the lead stands 36px lower and everything under the head 37px lower than
 * the board draws it. The lead is not compared by place, and the roster and the panel by their size and the places of their parts from
 * their own corners.
 *
 * Section 4 (the roster is a carousel of tabs): the roster is one row, a tablist, and the selected panel is its tabpanel directly under
 * the row at the page's full width, where the board draws the grid of three beside a 500px panel. So the roster is compared by its x and width as
 * the three tabs (its row gap is the board's 20px), New character, which stands beside the tablist and not in it, by its size, and the
 * panel by nothing of its own: the labels keep their places from the panel's top-left, the parts whose width follows the panel (its head, the Was
 * line, the pip style: 1252px under the row, the board's 438px) are held by their y and height from that corner, and the cooldown, the Turn button
 * and the two links, whose widths follow the panel too and whose places already follow the Online status row, are held by their words.
 *
 * "Pipewrench's log" opens My log on Pipewrench's tab (the glass build's Part 4); its place follows the
 * panel's actions, where Reveal… sits beside Edit profile, so it is compared by size. Left out: Mrs. Hooligan's and Spritey's classes and
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
    { id: 'menu-back', role: 'link', name: 'ESC BACK TO THE BOARD', buildName: 'Back to the board', within: 'menu', box: 'height' },
    /*
     * REVISED by the alerts design (docs/plans/2026-11-02-alerts-design.md, sections 4, 6 and 7; the menu as docs/research/2026-11-02-alerts/02-alerts.html draws it):
     * the tabs are now Alerts, Vending Machine, My characters, Season, My log, Updates and Settings after Back, and Rankings is the Season
     * tab's page. This board is a record of the earlier menu and is not edited, so the build's tabs sit further right than this board
     * draws them (the new menu sets its tabs 16px padded and spaced 1.5px, with Back 8px further left, to hold eight): Back and each tab are compared by their y and height and their type, not their x and width. The Season tab is this board's Rankings. The new menu
     * is held in full by e2e/boards/02-alerts.ts.
     */
    { id: 'menu-vending', role: 'link', name: 'Vending Machine', within: 'menu', box: 'height' },
    { id: 'menu-characters', role: 'link', name: 'My characters', within: 'menu', box: 'height' },
    { id: 'menu-rankings', role: 'link', name: 'Rankings', buildName: 'Season', within: 'menu', box: 'height' },
    { id: 'menu-log', role: 'link', name: 'My log', within: 'menu', box: 'height' },
    { id: 'menu-settings', role: 'link', name: 'Settings', within: 'menu', box: 'height' },

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
      /* Its x and width follow the title's, which carries the count: the lead is held by its words and type. */
      box: 'none',
    },

    /* The roster, and Pipewrench's card: its name, its class in its color, its rank and its next Turn. */
    { id: 'roster', role: 'list', buildRole: 'tablist', name: 'Roster, 3 of 6 slots used', type: false, box: 'across' },
    { id: 'card-name', role: 'text', name: 'Pipewrench', within: 'roster', origin: 'roster' },
    { id: 'card-class', role: 'text', name: 'Face', within: 'roster', origin: 'roster' },
    { id: 'card-rank', role: 'text', name: 'Midcarder', within: 'roster', origin: 'roster' },
    { id: 'card-turn', role: 'text', name: 'Next Turn opens Nov 29', within: 'roster', origin: 'roster' },
    /*
     * Spritey's Turn, ready: the third card on both sides, in the order they joined. The fixture's
     * Mrs. Hooligan has never Turned, so the build's first "Turn ready" is hers and Spritey's the second.
     */
    { id: 'card-ready', role: 'text', name: 'Turn ready', within: 'roster', buildNth: 1, origin: 'roster' },
    /* Beside the tablist, the row's last card: a link is no tab. The board draws it in the grid's next row, so its size is held. */
    { id: 'new', role: 'link', name: 'New character', box: 'size' },

    /*
     * The selected panel, chamfer step 4. The build adds Online status under the pip style (the presence
     * plan, docs/plans/2026-10-31-presence-plan.md, Task 5), which the board predates: the panel grows by
     * that row and its line, so the panel is compared across, its parts from its corner, and what follows the row by size.
     */
    { id: 'panel', role: 'region', buildRole: 'tabpanel', name: 'Pipewrench', type: false, box: 'none' },
    { id: 'panel-selected', role: 'text', name: 'Selected', within: 'panel', origin: 'panel', box: 'height' },
    { id: 'panel-name', role: 'heading', name: 'Pipewrench', within: 'panel', origin: 'panel', box: 'height' },
    /* The class's "only you" tag follows it on the build's line (web Task 9), so the chip stands left of the board's: its size is compared. */
    { id: 'panel-class', role: 'text', name: 'Face', within: 'panel', box: 'size' },
    { id: 'panel-was-label', role: 'text', name: 'Was', within: 'panel', origin: 'panel' },
    { id: 'panel-was', role: 'text', name: 'Heel, announced publicly', within: 'panel', origin: 'panel', box: 'height' },
    { id: 'panel-rank-label', role: 'text', name: 'Rank', within: 'panel', origin: 'panel' },
    { id: 'panel-wallet-label', role: 'text', name: 'Wallet', within: 'panel', origin: 'panel' },
    { id: 'panel-posts-label', role: 'text', name: 'Posts', within: 'panel', origin: 'panel' },
    /* The pip style, the profile's own, chosen here. */
    { id: 'panel-pip', role: 'combobox', name: 'Pip style', within: 'panel', origin: 'panel', box: 'height' },
    /* The Turn that opens later, in the neon's text on a dashed edge; its name is the screen's own. */
    { id: 'panel-turn', role: 'button', name: 'TURN · OPENS NOV 29', buildName: 'Turn Pipewrench', within: 'panel', box: 'none' },
    { id: 'panel-cooldown', role: 'text', name: 'A character can Turn once every 30 days. Pipewrench last Turned at the Oct 30 settlement.', within: 'panel', box: 'none' },
    /* Two GlassButtons (48px; the board's are 56px), compared across. */
    { id: 'panel-avatar', role: 'link', name: 'Change avatar', buildName: 'Edit profile', within: 'panel', box: 'none' },
    { id: 'panel-log', role: 'link', name: 'Pipewrench\'s log', within: 'panel', box: 'none' },
    {
      id: 'panel-most', role: 'text', name: 'Six characters at most. To free a slot, ask an admin to retire one; every Act it made stays on the board.',
      buildName: '6 characters at most. To free a slot, ask an admin to retire one; every Act it made stays on the board.',
      /* Below the Online status row, so only found: its words are compared, and neither its place nor its size (the board's line is shorter). */
      within: 'panel', box: 'none',
    },
  ],
};

export default manifest;
