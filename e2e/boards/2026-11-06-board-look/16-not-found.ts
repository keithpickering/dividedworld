/**
 * Board 16, the Information box for an address no page answers to, in the Silver house theme (docs/research/2026-11-06-board-look/16-not-found.html, 1440 by 1000;
 * 16-not-found-dark.html is the same page in the dark mode and is compared on colors only; its theme token pairs are held by web/contrast.test.tsx): the forum's Information box, a light band
 * reading "Information", the message naming the thread that was asked for (the page's h1), "If you followed a link here, it may be mistyped or out of date.",
 * the whole sentence "Click here to return to the index" as the link, and the address in a foot cell, as the story `Boards/16 Not found`
 * (engine/ui/frame/NotFound.board.stories.tsx) draws them.
 */
import type { BoardManifest } from '../../board-match.ts';

const manifest: BoardManifest = {
  board: '2026-11-06-board-look/16-not-found',
  size: { width: 1440, height: 1000 },
  build: { story: 'boards-16-not-found--not-found' },
  landmarks: [
    { id: 'info', role: 'table', name: 'Information', type: false },
    { id: 'band', role: 'text', name: 'Information', nth: 1, buildNth: 0, within: 'info', origin: 'info', box: 'position' },
    { id: 'message', role: 'heading', name: 'The thread you requested does not exist.' },
    { id: 'hint', role: 'text', name: 'If you followed a link here, it may be mistyped or out of date.' },
    { id: 'way-out', role: 'link', name: 'Click here to return to the index' },
    { id: 'address', role: 'text', name: 'Address: /t/00000000-0000-4000-8000-00000000dead' },
  ],
};

export default manifest;
