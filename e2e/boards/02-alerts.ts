/**
 * Board 02, the Alerts page (docs/research/2026-11-02-alerts/02-alerts.html, 1440 by 1560): the player's alerts in the pause menu, with the
 * filters by character, the two buttons under the lead, the divider "new since you last looked" at the account's mark, and Earlier under it
 * (the alerts design, section 4). The build side is its story, engine/ui/alerts/Alerts.board.stories.tsx, opened through the end-to-end
 * build's story route.
 *
 * Compared in full: the menu bar as the design revises it (Alerts after Back, Updates before Settings, Season for Rankings), the heading and
 * the filters, the lead and the two buttons, both dividers, and the rows the story and the board share by their lines. The board's rows
 * are the world the design drew (a warning's appeal, a Boss's arrival); the story seeds the kinds the build has words for, so a row only
 * the board draws is not compared, and the rows' own details are the words' tests' (engine/ui/alerts/words.test.tsx).
 *
 * Departure by the glass polish (docs/plans/2026-11-04-glass-polish-plan.md, Task 4): the heading is a PageHead (engine/ui/glass/PageHead.tsx), which
 * stands 36px clear of what follows (the lead and the dividers stand 15 to 18px lower than the board draws them), and the filters are GlassButtons in
 * a ButtonRow, 48px tall where the board's are 54, in the secondary kind's own color. The filters are
 * held to their y and height (the board's place plus the shift, 19px down and 6px shorter), not their x or width, and the buttons' type is not compared.
 */
import type { BoardManifest } from '../board-match.ts';

const manifest: BoardManifest = {
  board: '02-alerts',
  size: { width: 1440, height: 1560 },
  build: { story: 'boards-02-alerts--open' },
  landmarks: [
    /* The menu bar. The board writes the key cap into the Back link's name; the build hides it and names the link by its words (MenuBar.tsx). */
    { id: 'menu', role: 'navigation', name: 'Menu', type: false },
    { id: 'menu-back', role: 'link', name: 'ESC BACK TO THE BOARD', buildName: 'Back to the board', within: 'menu' },
    { id: 'menu-alerts', role: 'link', name: 'Alerts', within: 'menu' },
    { id: 'menu-vending', role: 'link', name: 'Vending Machine', within: 'menu' },
    { id: 'menu-characters', role: 'link', name: 'My characters', within: 'menu' },
    { id: 'menu-season', role: 'link', name: 'Season', within: 'menu' },
    { id: 'menu-log', role: 'link', name: 'My log', within: 'menu' },
    /*
     * The build's menu gains a Guide tab before Updates (the onboarding plan, Task 8; the Strategy Guide's page) that this board, drawn before the guide,
     * does not have. So Updates and Settings, which follow it, stand one tab's width further right than the board draws them: each is compared by its
     * y and height and its type, not its x and width. Every tab before the Guide is still held in full.
     */
    { id: 'menu-updates', role: 'link', name: 'Updates', within: 'menu', box: 'height' },
    { id: 'menu-settings', role: 'link', name: 'Settings', within: 'menu', box: 'height' },

    /* The heading, whose outline the board draws as a stroke with no fill, and the filters by character. */
    { id: 'title', role: 'heading', name: 'Alerts', type: false },
    { id: 'filters', role: 'navigation', name: 'Whose alerts', box: 'height', buildShift: { y: 19, height: -6 }, type: false },
    /* The filters are buttons that hold their state (aria-pressed), where the board draws links; the build lists the player's characters by name, not in the order they joined, so a character's place in the row is not compared. */
    { id: 'filter-all', role: 'link', name: 'All', buildRole: 'button', within: 'filters', box: 'height', buildShift: { y: 19, height: -6 } },
    { id: 'filter-pipewrench', role: 'link', name: 'Pipewrench', buildRole: 'button', within: 'filters', box: 'height', buildShift: { y: 19, height: -6 }, type: false },
    { id: 'filter-hooligan', role: 'link', name: 'Mrs. Hooligan', buildRole: 'button', within: 'filters', box: 'height', buildShift: { y: 19, height: -6 }, type: false },
    { id: 'filter-spritey', role: 'link', name: 'Spritey', buildRole: 'button', within: 'filters', box: 'height', buildShift: { y: 19, height: -6 }, type: false },

    /*
     * The lead. The board also draws two buttons beside it, "Threads you follow · 6" and "Alert settings", which neither the design nor the plan
     * decided and the build does not have; they are left out here until the part that builds them (the report of this task names the gap).
     */
    { id: 'lead', role: 'text', name: 'What happened to your characters, and what\'s new in the game. Every alert is true, and each one is also in your log or on the board. A thread drops off this list once you\'ve read it.', buildShift: { y: 15 } },

    /*
     * The rows. The hint's line and the update's line are the same words in the story and on the board; the lines sit in the row's own grid (the build's
     * line text starts after its new-row diamond, where the board's box is the whole column), so they are compared by type, not by box.
     */
    { id: 'row-heat', role: 'text', name: 'Your post is picking up heat', box: 'none' },
    { id: 'row-update', role: 'text', name: 'New update from Gabe: “Traps now bite board cards”', box: 'none' },

    /* The dividers. */
    /* Its ink: the board draws #ffd93d; the build sets body-sized text in the instance's lighter ready-text (#ffe27a, glass.json, tagged for body), so its color is not compared, its box is. Times are the reader's own, with the zone said (the board draws UTC with none), here and on each row. */
    { id: 'divider-new', role: 'heading', name: 'New since you last looked, Nov 2 · 08:52', buildName: 'New since you last looked, Nov 2 · 08:52 UTC', type: false, buildShift: { y: 18 } },
    { id: 'divider-earlier', role: 'heading', name: 'Earlier', box: 'none' },
  ],
};

export default manifest;
