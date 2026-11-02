/**
 * Board 04, the Season page's News tab (docs/research/2026-11-02-alerts/04-season-news.html, 1440 by 1500): Rankings grown into the season page, with
 * its News tab open (the alerts design, section 7). The build side is its story, engine/ui/season/Season.board.stories.tsx, opened through the
 * end-to-end build's story route. The Rankings tab under the same heading is two-worlds board 13 (e2e/boards/13-rankings.ts).
 *
 * Compared: the menu bar as the design revises it, the heading with its two tabs, the lead, and the feed's first items by their headings.
 * The story's world is its own (its Boss, its debut and its Turn are not the board's), so what only the board draws is not compared, and the
 * words the story shares with the board are compared by place and type.
 */
import type { BoardManifest } from '../board-match.ts';

const manifest: BoardManifest = {
  board: '04-season-news',
  size: { width: 1440, height: 1500 },
  build: { story: 'boards-04-season-news--news' },
  landmarks: [
    { id: 'menu', role: 'navigation', name: 'Menu', type: false },
    { id: 'menu-back', role: 'link', name: 'ESC BACK TO THE BOARD', buildName: 'Back to the board', within: 'menu' },
    { id: 'menu-alerts', role: 'link', name: 'Alerts', within: 'menu' },
    { id: 'menu-vending', role: 'link', name: 'Vending Machine', within: 'menu' },
    { id: 'menu-characters', role: 'link', name: 'My characters', within: 'menu' },
    { id: 'menu-season', role: 'link', name: 'Season', within: 'menu' },
    { id: 'menu-log', role: 'link', name: 'My log', within: 'menu' },
    { id: 'menu-updates', role: 'link', name: 'Updates', within: 'menu' },
    /* The board draws Settings twice at the end of its menu (a slip of the board's own); the first is compared. */
    { id: 'menu-settings', role: 'link', name: 'Settings', within: 'menu', nth: 0 },

    { id: 'title', role: 'heading', name: 'Season 2', type: false },
    /* The two tabs are a real tab list in the build (one selected, each controlling the panel), where the board draws a nav of two links. */
    { id: 'tabs', role: 'navigation', name: 'Season', buildRole: 'tablist', type: false },
    /* The idle tab's ink is the board's #e4def7 (text-2); the build sets it in text, which a glass text over bare smoke must be (e2e/glass-text.spec.ts), so its color is not compared. */
    { id: 'tab-rankings', role: 'link', name: 'Rankings', buildRole: 'tab', within: 'tabs', type: false },
    { id: 'tab-news', role: 'link', name: 'News', buildRole: 'tab', within: 'tabs' },

    /* The build says when the season began, where the board counts its days ("Day 2 of 28", a season length no part of the design decided). */
    { id: 'lead', role: 'text', name: 'Day 2 of 28. The Boss this season is Mister Spreadsheet. Everything here is public: results, debuts, Turns, and the Boss coming and going.', buildName: 'Season 2 began Nov 1, 8:17 AM. The Boss this season is Mister Spreadsheet. Everything here is public: results, debuts, Turns, and the Boss coming and going.' },

    /* The feed, newest first: each item's heading. */
    { id: 'item-debut', role: 'heading', name: 'Thwompson debuted' },
    { id: 'item-turn', role: 'heading', name: 'Pipewrench turned' },
    { id: 'item-boss', role: 'heading', name: 'The Boss has arrived', buildName: 'Mister Spreadsheet has arrived' },
    /*
     * The board draws Season 1's results above the old Boss leaving; both happened at the same instant, and the build lists the leaving first (its
     * news query's order among equal times), so these two are found and compared by their type, not their places.
     */
    { id: 'item-results', role: 'heading', name: 'Season 1 results', box: 'none' },
    { id: 'item-left', role: 'heading', name: 'Lady Ledger has left', box: 'none' },
  ],
};

export default manifest;
