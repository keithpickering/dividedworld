/**
 * Board 12, the Log board (docs/research/2026-10-29-two-worlds/12-log.html, 1440 by 1240): My log at
 * 08:30 on Oct 30, Pipewrench's tab (the fixture's 12-log moment). The glass plan's section 7 lists
 * what is compared: the menu bar with My log current, the heading, the tabs, the lead, the table's
 * heads and its first row, and the line under it.
 *
 * Where the build departs from the board, by a decision:
 *  - The tabs are buttons, not links: which tab is open is the page's own state and never in an
 *    address, which would say whose characters they are (engine/ui/log/Log.tsx).
 *  - The first row is the Oct 30 settlement's. Its details carry the instance's reason words ("stole
 *    the thunder", "shrugged off", where the board wrote "stole thunder" and "polite shrug") and a Show
 *    posts control where the board has "Act 2214": a settlement is no Act, and the control is the log
 *    shares design's (section 4), which makes the row taller, so its cells are compared by position.
 *    Its wallet is 4.72, not 3.72: a card is paid for once at the machine (#78; the glass plan's
 *    section 2.1 amendment moves every later figure by 1.00).
 *  - The board's eight rows are six in the build (the glass plan's section 3: no Stick Around lines),
 *    so the table is compared by position alone.
 *  - "Tell an admin" is plain words, not a link: no screen yet says how to reach an admin.
 */
import type { BoardManifest } from '../board-match.ts';

const manifest: BoardManifest = {
  board: '12-log',
  size: { width: 1440, height: 1240 },
  build: { moment: '12-log' },
  landmarks: [
    /* The menu bar, My log current; Back's name is its words alone in the build (MenuBar.tsx), as every glass board's manifest says. */
    { id: 'menu', role: 'navigation', name: 'Menu', type: false },
    { id: 'menu-back', role: 'link', name: 'ESC Back to the board', buildName: 'Back to the board', within: 'menu' },
    { id: 'menu-vending', role: 'link', name: 'Vending Machine', within: 'menu' },
    { id: 'menu-characters', role: 'link', name: 'My characters', within: 'menu' },
    { id: 'menu-rankings', role: 'link', name: 'Rankings', within: 'menu' },
    { id: 'menu-log', role: 'link', name: 'My log', within: 'menu' },
    { id: 'menu-settings', role: 'link', name: 'Settings', within: 'menu' },

    { id: 'title', role: 'heading', name: 'My log' },
    { id: 'tabs', role: 'navigation', name: 'Whose log', type: false },
    { id: 'tab-all', role: 'link', buildRole: 'button', name: 'All', within: 'tabs' },
    { id: 'tab-pipewrench', role: 'link', buildRole: 'button', name: 'Pipewrench', within: 'tabs' },
    { id: 'tab-hooligan', role: 'link', buildRole: 'button', name: 'Mrs. Hooligan', within: 'tabs' },
    { id: 'tab-spritey', role: 'link', buildRole: 'button', name: 'Spritey', within: 'tabs' },
    {
      id: 'lead', role: 'text',
      name: 'Everything on this page is true. Each line names the Act that did it, what it changed and how much Aura moved. It never says who reacted, or any character\'s class but your own.',
    },

    { id: 'table', role: 'table', name: 'Pipewrench\'s log, newest first', type: false, box: 'position' },
    { id: 'head-when', role: 'columnheader', name: 'When (UTC)', within: 'table' },
    { id: 'head-what', role: 'columnheader', name: 'What', within: 'table' },
    { id: 'head-details', role: 'columnheader', name: 'Details', within: 'table' },
    { id: 'head-aura', role: 'columnheader', name: 'Aura', within: 'table' },
    { id: 'head-wallet', role: 'columnheader', name: 'Wallet', within: 'table' },

    { id: 'row-when', role: 'cell', name: 'Oct 30 · 08:17', within: 'table', box: 'position' },
    { id: 'row-what', role: 'cell', name: 'Settlement', within: 'table', box: 'position' },
    {
      id: 'row-details', role: 'cell', within: 'table', box: 'position',
      name: 'Scored as a Heel for Oct 29: drew heat +0.20, stole thunder +0.20, polite shrug −0.05. Act 2214',
      buildName: 'Scored as a Heel for Oct 29: drew heat +0.20, stole the thunder +0.20, shrugged off −0.05. Show posts',
    },
    { id: 'row-aura', role: 'cell', name: '+0.35', within: 'table', box: 'position' },
    { id: 'row-wallet', role: 'cell', name: '3.72', buildName: '4.72', within: 'table', box: 'position' },

    /* Under the table, which holds fewer rows than the board's (above): its words and type are compared, and not where it falls. */
    { id: 'foot', role: 'text', name: 'If a line here looks wrong, that is a bug and not the game. Tell an admin.', box: 'none' },
  ],
};

export default manifest;
