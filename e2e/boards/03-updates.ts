/**
 * Board 03, the Updates page (docs/research/2026-11-02-alerts/03-updates.html, 1440 by 1180): the newest update open, written as the instance's
 * developer persona, with the archive beside it (the alerts design, sections 3 and 6). The build side is its story,
 * engine/ui/updates/Updates.board.stories.tsx, opened through the end-to-end build's story route.
 *
 * Compared: the menu bar as the design revises it, the heading and the lead, the archive's four titles in order, the open update's byline,
 * title, time, its changes' head and the react and spin buttons. The persona's prose and its change list are the story's own words, not the
 * board's, so only their places are compared where the words are the same.
 */
import type { BoardManifest } from '../board-match.ts';

const manifest: BoardManifest = {
  board: '03-updates',
  size: { width: 1440, height: 1180 },
  build: { story: 'boards-03-updates--newest' },
  landmarks: [
    { id: 'menu', role: 'navigation', name: 'Menu', type: false },
    { id: 'menu-back', role: 'link', name: 'ESC BACK TO THE BOARD', buildName: 'Back to the board', within: 'menu' },
    { id: 'menu-alerts', role: 'link', name: 'Alerts', within: 'menu' },
    { id: 'menu-vending', role: 'link', name: 'Vending Machine', within: 'menu' },
    { id: 'menu-characters', role: 'link', name: 'My characters', within: 'menu' },
    { id: 'menu-season', role: 'link', name: 'Season', within: 'menu' },
    { id: 'menu-log', role: 'link', name: 'My log', within: 'menu' },
    { id: 'menu-updates', role: 'link', name: 'Updates', within: 'menu' },
    { id: 'menu-settings', role: 'link', name: 'Settings', within: 'menu' },

    { id: 'title', role: 'heading', name: 'Updates', type: false },
    { id: 'lead', role: 'text', name: 'What changed in the game, from the people who make it. The voice is Gabe\'s; every fact in it is true.' },

    /* The archive, newest first: its four titles and their days. */
    { id: 'archive', role: 'navigation', name: 'Earlier updates', buildName: 'All updates', type: false },
    { id: 'archive-1', role: 'link', name: 'Traps now bite board cards Nov 2', within: 'archive', type: false },
    { id: 'archive-2', role: 'link', name: 'Season 2 is open, and so is the Vending Machine\'s back panel Nov 1', within: 'archive', type: false },
    { id: 'archive-3', role: 'link', name: 'Whoops! washes 20% faster, because you asked nicely Oct 30', within: 'archive', type: false },
    { id: 'archive-4', role: 'link', name: 'Welcome to the playtest Oct 28', within: 'archive', type: false },

    /* The time's ink is the board's lilac #d9ceff, which is no token of the instance's; the build sets it in text-2, so only its box is compared. */
    /* The open update (the board's article has no name; the build names it by its headline): the persona's name, the headline and its time (the board's UTC, the build's with its zone said), the changes' head and the note. */
    { id: 'post', role: 'article', name: '', buildName: 'Traps now bite board cards', type: false, box: 'position' },
    { id: 'post-by', role: 'text', name: 'Gabe', within: 'post', nth: 1, buildNth: 0 },
    { id: 'post-title', role: 'heading', name: 'Traps now bite board cards', within: 'post' },
    { id: 'post-time', role: 'text', name: 'Nov 2 · 08:00 UTC', within: 'post', type: false },
    { id: 'post-changed', role: 'heading', name: 'What changed', within: 'post' },
    { id: 'post-note', role: 'text', name: 'Reactions here pay no one. A spun thread opens on the board with this update in its origin box.', within: 'post', box: 'position' },
  ],
};

export default manifest;
