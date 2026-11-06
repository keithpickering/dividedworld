/**
 * Board 33, Settings › Account (docs/research/2026-11-05-backfill/33-settings-account.html, 1440 by 1000) with two invites made, one open and one used, as
 * the story `Boards/00 Settings account` (engine/ui/account/Settings.board.stories.tsx) draws it. The backfill design's section 7 and the plan's Task 11 list
 * what is compared: the heading and the section rail with Reach a person under it, ruled off (it was stranded at the page's foot-left); the section's
 * heading and lead; the Sign-in address row; the Invites row, each invite a row of its own (which one it is, its state and when, and Reissue while it is unused)
 * with Make an invite after the list; and Sign out.
 *
 * Every part of the section is compared from the section heading's own corner (`origin`), and the rail's from the rail's: the page head
 * (engine/ui/glass/PageHead.tsx) leaves 36px under the title where the board leaves 66, so the rail and the section stand 40px higher than the board
 * draws them, which no part is held to by its page place. What follows the invites' sentence (it runs to two lines on the board and the build may set it in
 * two or three) is held from where the sentence ends (`originEdge: 'bottom'`).
 *
 * Departures by decision:
 *  - The board draws each invite with a code ("ab12cd34") and "USED · Nov 2". The build never has a code to show: the server gives a code once, when the
 *    invite is made or reissued (engine/ui/account/Invites.tsx), so a row names the invite by its number among the player's own, oldest first ("Invite 2"; never the global id), and a used invite keeps the date it was
 *    made, which is all the account holds of it. The board's text is found as the build's by `buildName`.
 *  - The buttons are GlassButtons, 48px tall where the board's `.btn` is 52 to 54 (and Reissue 44), at the glass's own width, so each is compared by its y and
 *    height and its type.
 *
 * Phone: this module also exports `phone`, board 36 (docs/research/2026-11-05-backfill/36-account-phone.html), the account at 390 by 844 beside two more
 * screens. The card info sheet (its second screen) waits for the card template plan (docs/plans/2026-11-05-card-template-plan.md), whose Postcard face it
 * draws, and is not compared here: board 34 is in PENDING for the same reason. The third screen is the HUD past its cap, a further side.
 */
import type { BoardManifest, Landmark } from '../../board-match.ts';

/** A GlassButton, 48px tall where the board's `.btn` is 54. */
const BUTTON = { height: -6 } as const;

const manifest: BoardManifest = {
  board: '2026-11-05-backfill/33-settings-account',
  size: { width: 1440, height: 1000 },
  build: { story: 'boards-00-settings-account--account' },
  landmarks: [
    { id: 'menu', role: 'navigation', name: 'Menu', type: false },
    { id: 'menu-back', role: 'link', name: 'ESC BACK TO THE BOARD', buildName: 'Back to the board', within: 'menu', box: 'height' },
    { id: 'title', role: 'heading', name: 'SETTINGS', nth: 0 },

    /* The rail: the sections, then Reach a person under them, ruled off. */
    { id: 'sections', role: 'navigation', name: 'Settings sections', box: 'across', type: false },
    { id: 'section-account', role: 'link', name: 'ACCOUNT', within: 'sections', origin: 'sections', box: 'height', type: false, buildShift: BUTTON },
    { id: 'section-accessibility', role: 'link', name: 'ACCESSIBILITY', within: 'sections', origin: 'sections', box: 'height', type: false, buildShift: { y: -6, height: -6 } },
    { id: 'section-notifications', role: 'link', name: 'NOTIFICATIONS', within: 'sections', origin: 'sections', box: 'height', type: false, buildShift: { y: -12, height: -6 } },
    { id: 'reach', role: 'link', name: 'Reach a person', origin: 'sections', box: 'position', buildShift: { y: -18 } },

    { id: 'account', role: 'heading', name: 'ACCOUNT', box: 'across' },
    { id: 'lead', role: 'text', name: 'Out of character: what you sign in with, and who you bring in.', origin: 'account' },

    { id: 'address-label', role: 'heading', name: 'SIGN-IN ADDRESS', origin: 'account', box: 'position' },
    { id: 'address', role: 'text', name: 'demo-player@example.test', origin: 'account', box: 'position', buildSize: 24 },
    { id: 'address-note', role: 'text', name: 'The address the code and the link come to. It is not shown to anyone else.', origin: 'account', box: 'position' },

    { id: 'invites-label', role: 'heading', name: 'INVITES', origin: 'account', box: 'position' },
    {
      id: 'invites-count', role: 'text', origin: 'account', box: 'position',
      name: 'You hold 1 of 3 open invites. An invite is one use, and expires 7 days after it is made or reissued. One used or expired frees one.',
    },
    ...invite('open', 'ab12cd34', 'Invite 2', 'OPEN · expires Nov 12', 'OPEN', 'Open'),
    { id: 'open-reissue', role: 'button', name: 'REISSUE', buildName: 'Reissue invite 2', origin: 'invites-count', originEdge: 'bottom', box: 'height', buildSize: 20 },
    ...invite('used', '9f3k2m7q', 'Invite 1', 'USED · Nov 2', 'USED', 'Used', 'USED · made Nov 2'),
    { id: 'make', role: 'button', name: 'MAKE AN INVITE', origin: 'invites-count', originEdge: 'bottom', box: 'height', buildShift: BUTTON },

    { id: 'sign-out-label', role: 'heading', name: 'SIGN OUT', origin: 'invites-count', originEdge: 'bottom', box: 'position' },
    { id: 'sign-out', role: 'button', name: 'SIGN OUT', origin: 'invites-count', originEdge: 'bottom', box: 'height', buildShift: BUTTON },
    { id: 'sign-out-note', role: 'text', name: 'Ends this session on this device. Your characters and settings stay with your account.', origin: 'invites-count', originEdge: 'bottom', box: 'position' },
  ],
};

/** One invite's row: what names it, its state in bold, and its state line (the state and its when, as one phrase). Held from where the count's sentence ends. */
function invite(id: string, code: string, buildCode: string, when: string, state: string, buildState: string, buildWhen = when): Landmark[] {
  return [
    { id: `${id}-code`, role: 'text', name: code, buildName: buildCode, origin: 'invites-count', originEdge: 'bottom', box: 'position', type: false },
    { id: `${id}-state`, role: 'text', name: state, buildName: buildState, origin: 'invites-count', originEdge: 'bottom', box: 'position', type: false },
    { id: `${id}-line`, role: 'text', name: when, buildName: buildWhen, origin: 'invites-count', originEdge: 'bottom', box: 'position', type: false },
  ];
}

export default manifest;

/*
 * Board 36's first screen, Account on a phone (docs/research/2026-11-05-backfill/36-account-phone.html): three phone screens at 390 by 844 side by side on one
 * page, at x = 20, 430 and 840: Account, the card info as a sheet (not built yet; see the header) and the HUD past its cap. As board 18 is held, each screen
 * is found as that screen's own and measured from its own corner (`origin`), so a screen's place on the page is never compared.
 *
 * The board draws only the Invites row under the heading; the build holds the page's other rows too (the sign-in address first), so what follows the heading
 * stands lower by the row that precedes it. The board is drawn in the desktop's sizes and the build in the phone tokens (17px and 20px), so no type is compared
 * (`type: false`) and a part is held by its place, with the shift the first run measured. The board's invite row puts the code and its state on one line and
 * Reissue under it; the build's list row does the same (engine/ui/account/account.css).
 */
const PHONE = '2026-11-05-backfill/36-account-phone';

const at = (id: string, role: string, name: string, shift: { x?: number; y?: number } = {}, more: Partial<Landmark> = {}): Landmark => ({
  id, role, name, origin: 'menu', box: 'position', type: false, buildShift: shift, ...more,
});

export const phone: BoardManifest = {
  board: PHONE,
  size: { width: 390, height: 844 },
  build: { story: 'boards-00-settings-account--account-phone' },
  landmarks: [
    /* The signed-in menu holds every tab, wrapped to two rows (127px) where the board draws Back alone (71px): its place is not compared, only Back's from its corner. */
    { id: 'menu', role: 'navigation', name: 'Menu', nth: 0, buildNth: 0, type: false, box: 'none' },
    { id: 'menu-back', role: 'link', name: '‹ BACK TO THE BOARD', buildName: 'Back to the board', within: 'menu', origin: 'menu', box: 'height', type: false },
    /* The page's heading and rail stand above the section in the build and the board draws neither: the section is held from its own heading, whose place is not. */
    at('account', 'heading', 'ACCOUNT', {}, { box: 'none' }),
    /* What the Invites row stands under is the board's heading and, in the build, the last paragraph before it (the Sign-in address's sentence, which wraps in two lines on one machine and three on another, as the lead above it does), so the row is held from that paragraph's bottom edge. */
    at('above', 'text', 'ACCOUNT', {}, { buildName: 'The address the code and the link come to. It is not shown to anyone else.', box: 'none' }),
    at('invites-label', 'text', 'INVITES', { y: 10 }, { buildName: 'Invites', origin: 'above', originEdge: 'bottom' }),
    {
      id: 'invites-count', role: 'text', origin: 'above', originEdge: 'bottom', box: 'position', type: false, buildShift: { y: 22 },
      name: 'You hold 1 of 3 open invites. One use each; 7 days.',
      buildName: 'You hold 1 of 3 open invites. An invite is one use, and expires 7 days after it is made or reissued. One used or expired frees one.',
    },
    /* The board's code ("ab12cd34", 8 spaced characters) is wider than the build's "Invite 2", so the state beside it stands 19px and 25px further left; and the build's Reissue (48px on the phone's controls, the board's 44) makes the open row 11px taller, so what follows it stands that much lower (the shifts below are added to the board's places). */
    ...phoneInvite('open', 'ab12cd34', 'Invite 2', 'OPEN', 'Open', 'OPEN · expires Nov 12', 'OPEN · expires Nov 12', { x: -19, y: 0 }),
    { id: 'open-reissue', role: 'button', name: 'REISSUE', buildName: 'Reissue invite 2', origin: 'invites-count', originEdge: 'bottom', box: 'position', type: false },
    ...phoneInvite('used', '9f3k2m7q', 'Invite 1', 'USED', 'Used', 'USED · Nov 2', 'USED · made Nov 2', { x: -25, y: 11 }),
    { id: 'make', role: 'button', name: 'MAKE AN INVITE', origin: 'invites-count', originEdge: 'bottom', box: 'position', type: false, buildShift: { y: 15 } },
  ],
  also: [
    {
      name: 'The HUD past its cap',
      build: { story: 'boards-00-hud-past-the-cap--past-the-cap-phone' },
      landmarks: [
        /* The board's screen stands at x = 840 on its page and the build's HUD is its own height: only its parts are compared, from its corner. */
        { id: 'hud', role: 'region', name: 'Game HUD', type: false, box: 'none' },
        /* The build's phone HUD has the mask's rows above the orbs where the board draws the plate and the hand; the Aura notch stands 23px lower, and is held by board 02-phone. */
        at('figure', 'text', '6.00', { y: 23 }, { within: 'hud', origin: 'hud' }),
        at('over', 'text', '+0.85 est. past the cap.', { y: 23 }, { within: 'hud', origin: 'hud', buildName: '+0.85 est. past the cap' }),
        /* The board's one line is a paragraph with the figure bold in it; the build's is the note holding both (no full stop after the figure). */
        at('note', 'text', "+0.85 est. past the cap. Spend some before the settlement, or it won't fit.", { y: 23 }, { within: 'hud', origin: 'hud', buildName: "+0.85 est. past the cap Spend some before the settlement, or it won't fit." }),
      ],
    },
  ],
};

function phoneInvite(id: string, code: string, buildCode: string, state: string, buildState: string, when: string, buildWhen: string, shift: { x: number; y: number }): Landmark[] {
  const from = { origin: 'invites-count', originEdge: 'bottom', box: 'position', type: false } as const;
  return [
    { id: `${id}-code`, role: 'text', name: code, buildName: buildCode, ...from, buildShift: { y: shift.y } },
    { id: `${id}-state`, role: 'text', name: state, buildName: buildState, ...from, buildShift: shift },
    { id: `${id}-line`, role: 'text', name: when, buildName: buildWhen, ...from, buildShift: shift },
  ];
}
