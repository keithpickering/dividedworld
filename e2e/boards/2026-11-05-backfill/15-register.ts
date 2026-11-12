/**
 * Board 15, Register (docs/research/2026-11-05-backfill/15-register.html, 1440 by 1000): signed out, opened from an invite link so the invite is
 * filled in, as the story `Boards/00 Sign in`'s Register (engine/ui/account/SignIn.board.stories.tsx) draws it. What is compared is board 14's, and
 * the same departures hold (14-sign-in.ts: the page head's 40px, the GlassButtons' 48px), plus the invite field with its note, and the 18+ check
 * with its acknowledgement under it ("Already playing?" with Sign in in the aside).
 *
 * The check's line is set in the regular weight where the board draws 700 (the backfill design, section 2: "its line regular weight"), so its type is
 * not compared; the box, the 30px check and the note under it are.
 *
 * The build's second check, "I've read and agree to the code of conduct" (the conduct plan, Task 5), is a row the board does not draw under the 18+ check's note:
 * Send a code stands 74px lower under it (`SEND`).
 */
import type { BoardManifest } from '../../board-match.ts';

const UP = { y: -40 } as const;
const BUTTON = { y: -40, height: -6 } as const;
const AFTER = { y: -46 } as const;
/** The BUTTON shift and the conduct check's row (the conduct plan, Task 5), which the board does not draw: Send a code stands 74px lower. */
const SEND = { y: -40 + 74, height: -6 } as const;

const manifest: BoardManifest = {
  board: '2026-11-05-backfill/15-register',
  size: { width: 1440, height: 1000 },
  build: { story: 'boards-00-sign-in--register' },
  landmarks: [
    { id: 'menu', role: 'navigation', name: 'Menu', type: false },
    { id: 'menu-back', role: 'link', name: 'ESC BACK TO THE BOARD', buildName: 'Back to the board', within: 'menu', box: 'height' },
    { id: 'title', role: 'heading', name: 'Register' },
    { id: 'form', role: 'form', name: 'Register', type: false, box: 'across' },
    { id: 'lead', role: 'text', name: 'No password. We email you a code and a link; either one makes your account.', buildShift: UP },
    { id: 'email-label', role: 'text', name: 'EMAIL ADDRESS', buildShift: UP },
    { id: 'email', role: 'textbox', name: 'EMAIL ADDRESS', type: false, buildShift: UP },
    { id: 'invite-label', role: 'text', name: 'INVITE', buildShift: UP },
    { id: 'invite', role: 'textbox', name: 'INVITE', type: false, buildShift: UP },
    { id: 'invite-note', role: 'text', name: 'Registration is by invite for now. Your invite link filled this in.', buildShift: UP },
    { id: 'ack', role: 'checkbox', name: 'I am 18 or older.', type: false, buildShift: UP },
    { id: 'ack-line', role: 'text', name: 'I am 18 or older.', type: false, buildShift: UP },
    { id: 'ack-note', role: 'text', name: 'An acknowledgement, nothing legally binding.', buildShift: UP },
    { id: 'send', role: 'button', name: 'SEND A CODE', box: 'height', buildShift: SEND },
    { id: 'aside', role: 'complementary', name: 'Other ways in', type: false, box: 'across' },
    { id: 'back-heading', role: 'heading', name: 'ALREADY PLAYING?', within: 'aside', buildShift: UP },
    { id: 'back-text', role: 'text', name: 'Sign in with the email you registered.', within: 'aside', buildShift: UP },
    { id: 'sign-in', role: 'link', name: 'SIGN IN', within: 'aside', box: 'height', buildShift: BUTTON },
    { id: 'stuck-heading', role: 'heading', name: 'STUCK?', within: 'aside', buildShift: AFTER },
    { id: 'stuck-text', role: 'text', name: 'No code arrived, or the link has expired. The admins can help.', within: 'aside', buildShift: AFTER },
    { id: 'reach', role: 'link', name: 'Reach a person', within: 'aside', buildShift: AFTER },
  ],
};

export default manifest;
