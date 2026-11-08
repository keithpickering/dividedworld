/**
 * Board 04, the Season page's News tab (docs/research/2026-11-02-alerts/04-season-news.html, 1440 by 1500): Rankings grown into the season page, with
 * its News tab open (the alerts design, section 7). The build side is its story, engine/ui/season/Season.board.stories.tsx, opened through the
 * end-to-end build's story route. The Rankings tab under the same heading is two-worlds board 13 (e2e/boards/13-rankings.ts).
 *
 * Compared: the menu bar as the design revises it, the heading with its two tabs, the lead, and the feed's first items by their headings.
 * The story's world is its own (its Boss, its debut and its Turn are not the board's), so what only the board draws is not compared, and the
 * words the story shares with the board are compared by place and type.
 *
 * Departure by the glass polish (docs/plans/2026-11-04-glass-polish-plan.md, Task 4): the heading is a PageHead (engine/ui/glass/PageHead.tsx), which
 * stands 36px clear of what follows (the lead and the items stand 15px lower than the board draws them), and the tabs are GlassButtons, 48px tall where the
 * board's are 54. The tabs are held to their y and height (the board's place plus the shift, 19px down and 6px shorter), not their x or width.
 *
 * Departure by the pronouns plan (docs/plans/2026-11-07-pronouns-plan.md): the Turn item names the character where the board says "It is now a",
 * so its line wraps once more and the Boss's item under it stands a further 32px lower (47px in all).
 */
import type { BoardManifest } from '../board-match.ts';

const manifest: BoardManifest = {
  board: '04-season-news',
  size: { width: 1440, height: 1500 },
  build: { story: 'boards-04-season-news--news' },
  landmarks: [
    { id: 'menu', role: 'navigation', name: 'Menu', type: false },
    { id: 'menu-back', role: 'link', name: 'ESC BACK TO THE BOARD', buildName: 'Back to the board', within: 'menu' },
    /*
     * REVISED by the backfill boards (docs/plans/2026-11-05-backfill-boards-design.md section 8; docs/plans/2026-11-05-backfill-boards-plan.md Task 5): a bar
     * of more than five tabs steps its tabs down to 13px padding, as the backfill boards draw a player's eight (docs/research/2026-11-05-backfill/gen.mjs), so
     * these tabs are narrower and later than this board draws them: compared by their y and height and their type, not their x and width. Back is held in full.
     */
    { id: 'menu-alerts', role: 'link', name: 'Alerts', within: 'menu', box: 'height' },
    { id: 'menu-vending', role: 'link', name: 'Vending Machine', within: 'menu', box: 'height' },
    { id: 'menu-characters', role: 'link', name: 'My characters', within: 'menu', box: 'height' },
    { id: 'menu-season', role: 'link', name: 'Season', within: 'menu', box: 'height' },
    { id: 'menu-log', role: 'link', name: 'My log', within: 'menu', box: 'height' },
    /*
     * The build's menu gains a Guide tab before Updates (the onboarding plan, Task 8; the Strategy Guide's page) that this board, drawn before the guide,
     * does not have. So Updates and Settings, which follow it, stand one tab's width further right than the board draws them: each is compared by its
     * y and height and its type, not its x and width. Every tab before the Guide is still held in full.
     */
    { id: 'menu-updates', role: 'link', name: 'Updates', within: 'menu', box: 'height' },
    /* The board draws Settings twice at the end of its menu (a slip of the board's own); the first is compared. */
    { id: 'menu-settings', role: 'link', name: 'Settings', within: 'menu', nth: 0, box: 'height' },

    { id: 'title', role: 'heading', name: 'Season 2', type: false },
    /* The two tabs are a real tab list in the build (one selected, each controlling the panel), where the board draws a nav of two links. */
    { id: 'tabs', role: 'navigation', name: 'Season', buildRole: 'tablist', box: 'height', buildShift: { y: 19, height: -6 }, type: false },
    /* The idle tab's ink is the board's #e4def7 (text-2); the build sets it in text, which a glass text over bare smoke must be (e2e/glass-text.spec.ts), so its color is not compared. */
    { id: 'tab-rankings', role: 'link', name: 'Rankings', buildRole: 'tab', within: 'tabs', box: 'height', buildShift: { y: 19, height: -6 }, type: false },
    { id: 'tab-news', role: 'link', name: 'News', buildRole: 'tab', within: 'tabs', box: 'height', buildShift: { y: 19, height: -6 } },

    /* The build says when the season began, where the board counts its days ("Day 2 of 28", a season length no part of the design decided). */
    { id: 'lead', role: 'text', name: 'Day 2 of 28. The Boss this season is Mister Spreadsheet. Everything here is public: results, debuts, Turns, and the Boss coming and going.', buildName: 'Season 2 began Nov 1, 8:17 AM. The Boss this season is Mister Spreadsheet. Everything here is public: results, debuts, Turns, and the Boss coming and going.', buildShift: { y: 15 } },

    /* The feed, newest first: each item's heading. */
    { id: 'item-debut', role: 'heading', name: 'Thwompson debuted', buildShift: { y: 15 } },
    { id: 'item-turn', role: 'heading', name: 'Pipewrench turned', buildShift: { y: 15 } },
    { id: 'item-boss', role: 'heading', name: 'The Boss has arrived', buildName: 'Mister Spreadsheet has arrived', buildShift: { y: 47 } },
    /*
     * The board draws Season 1's results above the old Boss leaving; both happened at the same instant, and the build lists the leaving first (its
     * news query's order among equal times), so these two are found and compared by their type, not their places.
     */
    { id: 'item-results', role: 'heading', name: 'Season 1 results', box: 'none' },
    { id: 'item-left', role: 'heading', name: 'Lady Ledger has left', box: 'none' },
  ],
};

export default manifest;
