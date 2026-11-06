/**
 * Board 16, Reach a person (docs/research/2026-11-05-backfill/16-contact.html, 1440 by 1000): signed out, as the story `Boards/00 Reach a person`
 * (engine/ui/contact/Contact.board.stories.tsx) draws it, with the board's two ways set: Discord and an email address. Compared: the menu bar, the
 * heading, the lead, and each way as a row in the Settings idiom, its label in the label column and its link in the other ("Open the Discord"
 * as a secondary button, the address as the link itself).
 *
 * Departures by the glass polish, as board 14 holds them (14-sign-in.ts): everything under the title stands 40px higher, and the button is a
 * GlassButton, 48px tall where the board's is 54 (compared by its y and height and its type), so the row under it is 6px shorter and the email
 * row's rule and words stand 6px higher still. The board's section ("Ways to reach the admins") is not a named region in the build.
 */
import type { BoardManifest } from '../../board-match.ts';

const UP = { y: -40 } as const;
const BUTTON = { y: -40, height: -6 } as const;
const AFTER = { y: -46 } as const;

const manifest: BoardManifest = {
  board: '2026-11-05-backfill/16-contact',
  size: { width: 1440, height: 1000 },
  build: { story: 'boards-00-reach-a-person--contact' },
  landmarks: [
    { id: 'menu', role: 'navigation', name: 'Menu', type: false },
    { id: 'menu-back', role: 'link', name: 'ESC BACK TO THE BOARD', buildName: 'Back to the board', within: 'menu', box: 'height' },
    { id: 'title', role: 'heading', name: 'Reach a person' },
    { id: 'lead', role: 'text', name: 'The admins run this instance. Write to them if something looks broken, if you\'re stuck with no way out, or about anything that isn\'t part of the game.', buildShift: UP },
    /* The label column is 10px wider in the build (240px to the board's 230, as board 11 holds it), and its box runs the row's height: only its place is compared. */
    { id: 'discord-label', role: 'heading', name: 'DISCORD', box: 'position', buildShift: UP },
    { id: 'discord', role: 'link', name: 'OPEN THE DISCORD', box: 'height', buildShift: BUTTON },
    { id: 'email-label', role: 'heading', name: 'EMAIL', box: 'position', buildShift: AFTER },
    { id: 'email', role: 'link', name: 'admin@example.test', buildShift: AFTER },
  ],
};

export default manifest;
