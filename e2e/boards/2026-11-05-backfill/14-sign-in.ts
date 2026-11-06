/**
 * Board 14, Sign in (docs/research/2026-11-05-backfill/14-sign-in.html, 1440 by 1000): signed out, as the story
 * `Boards/00 Sign in` (engine/ui/account/SignIn.board.stories.tsx) draws it. The backfill design's section 2 and the plan's Task 6 list what is
 * compared: the menu bar, the heading, the form in its 680px column (the lead, the field, Send a code), and the aside in the right column
 * ("New here?" with Register as a secondary button, "Stuck?" with Reach a person).
 *
 * Departures by the glass polish (docs/plans/2026-11-04-glass-polish-design.md, section 2), as boards 11 and 02-alerts hold them: the page head
 * (engine/ui/glass/PageHead.tsx) leaves 36px under the title where the board leaves 66, so everything under the title stands 40px higher than the
 * board draws it (`UP`); and the buttons are GlassButtons, 48px tall where the board's are 54 (so what follows a button stands 6px higher still),
 * at the glass's own width, so a button is compared by its y and height and its type, not its width. Back, in a bar that holds it alone, is the
 * glass's own width, so it is compared by its y and height too.
 */
import type { BoardManifest, Landmark } from '../../board-match.ts';

/** Under the title, the page head's 36px where the board draws 66. */
const UP = { y: -40 } as const;
/** A GlassButton, 48px where the board's `.btn` is 54. */
const BUTTON = { y: -40, height: -6 } as const;
/** What follows a button in the aside: the button's 6px shorter again. */
const AFTER = { y: -46 } as const;

const manifest: BoardManifest = {
  board: '2026-11-05-backfill/14-sign-in',
  size: { width: 1440, height: 1000 },
  build: { story: 'boards-00-sign-in--sign-in' },
  landmarks: [
    { id: 'menu', role: 'navigation', name: 'Menu', type: false },
    { id: 'menu-back', role: 'link', name: 'ESC BACK TO THE BOARD', buildName: 'Back to the board', within: 'menu', box: 'height' },
    { id: 'title', role: 'heading', name: 'Sign in' },
    { id: 'form', role: 'form', name: 'Sign in', type: false, box: 'across' },
    { id: 'lead', role: 'text', name: 'No password. We email you a code and a link; either one signs you in.', buildShift: UP },
    { id: 'email-label', role: 'text', name: 'EMAIL ADDRESS', buildShift: UP },
    { id: 'email', role: 'textbox', name: 'EMAIL ADDRESS', type: false, buildShift: UP },
    { id: 'send', role: 'button', name: 'SEND A CODE', box: 'height', buildShift: BUTTON },
    { id: 'aside', role: 'complementary', name: 'Other ways in', type: false, box: 'across' },
    { id: 'new-heading', role: 'heading', name: 'NEW HERE?', within: 'aside', buildShift: UP },
    { id: 'new-text', role: 'text', name: 'Registering takes an invite from someone who plays. The same email code signs you in after.', within: 'aside', buildShift: UP },
    { id: 'register', role: 'link', name: 'REGISTER', within: 'aside', box: 'height', buildShift: BUTTON },
    { id: 'stuck-heading', role: 'heading', name: 'STUCK?', within: 'aside', buildShift: AFTER },
    { id: 'stuck-text', role: 'text', name: 'No code arrived, or the link has expired. The admins can help.', within: 'aside', buildShift: AFTER },
    { id: 'reach', role: 'link', name: 'Reach a person', within: 'aside', buildShift: AFTER },
  ],
};

export default manifest;

/*
 * Board 18, the door on a phone (docs/research/2026-11-05-backfill/18-door-phone.html): four phone screens at 390 by 844 side by side on one page,
 * Sign in, Register, Reach a person and the front door's HUD. A phone board has one parent and is compared at 390 by 844 (e2e/boards.spec.ts), so
 * this export is the whole board: Sign in is its own side, and the other three are further sides (`also`), each its own story against the same page.
 * The board page is opened at 390 wide, with its four screens at x = 20, 430, 840 and 1250; each landmark of a screen is found as that screen's
 * nth (`nth`, where the build has one of each) and measured from that screen's menu bar (or, for the HUD, from its own corner: `origin`), so a
 * screen's place on the page is never compared.
 *
 * What the phone board draws that the build does not follow, by decision:
 *  - The board is drawn in the desktop's sizes (buttons and the Sign in 21px, labels 24px, the lead 20px, the HUD's prompt 28px); the build sets a phone
 *    in the glass's phone tokens (17px, 20px and 20px, the HUD's prompt 20px: engine/ui/glass/tokens.css), which the glass polish (design section 7)
 *    and the owner's phone sizes fixed. So no type on this board is compared (`type: false`), and a part's box is compared by its place, its x and y,
 *    with the shift the smaller type and the build's fuller words make (`buildShift`, in px, from what the first run measured).
 *  - The board's words are shorter on the phone (Register's aside is the one sentence "Registering takes an invite from someone who plays."; the
 *    invite note is "Your invite link filled this in."), and its Register screen has no "Stuck?" and no Reach a person, only a "Sign in" link
 *    under the form. The build says the 1440 board's words on both and gives Register the same aside, so the parts it adds stand lower than the
 *    board's: the aside's Reach a person link is 138px lower, the check and Send a code on Register 80 and 120.
 *  - The board's Reach a person labels are `div`s, not headings, and its Sign in field's label is not tied to the field, so a label is found by its
 *    words and the field is not found by its name.
 * What is held: that each screen's parts are there, in the board's order, in the board's column (x and the 358px width, `across`), at the shifts above.
 */
const PHONE = '2026-11-05-backfill/18-door-phone';

/** The menu bar of the screen that is the board page's `nth` (the front door has none), and Back in it, as the phone's bar draws them. */
const bar = (nth: number): Landmark[] => [
  { id: 'menu', role: 'navigation', name: 'Menu', nth, buildNth: 0, type: false, box: 'size' },
  { id: 'menu-back', role: 'link', name: '‹ BACK TO THE BOARD', buildName: 'Back to the board', within: 'menu', origin: 'menu', box: 'height', type: false },
];

/** A part held by its place, x and y, measured from its screen's origin, shifted by what the phone's type and the build's words make. */
const at = (id: string, role: string, name: string, shift: { x?: number; y?: number } = {}, more: Partial<Landmark> = {}): Landmark => ({
  id, role, name, origin: 'menu', box: 'position', type: false, buildShift: shift, ...more,
});

export const phone: BoardManifest = {
  board: PHONE,
  size: { width: 390, height: 844 },
  build: { story: 'boards-00-sign-in--sign-in-phone' },
  landmarks: [
    ...bar(0),
    at('title', 'heading', 'Sign in'),
    at('lead', 'text', 'No password. We email you a code and a link; either one signs you in.', { y: 9 }),
    at('email-label', 'text', 'EMAIL ADDRESS', { y: 0 }, { nth: 0 }),
    at('send', 'button', 'SEND A CODE', { y: -6 }, { nth: 0 }),
    at('new-heading', 'heading', 'NEW HERE?', { y: -10 }),
    at('new-text', 'text', 'Registering takes an invite from someone who plays.', { y: -14 }, { buildName: 'Registering takes an invite from someone who plays. The same email code signs you in after.' }),
    at('register', 'link', 'REGISTER', { y: -27 }),
    /* The board has no "Stuck?" block on this screen; the build's last paragraph before Reach a person stands in the board's last (Register's lead), so that Reach a person is held from where the paragraph ends. */
    at('stuck-end', 'text', 'Registering takes an invite from someone who plays.', {}, { buildName: 'No code arrived, or the link has expired. The admins can help.', box: 'none' }),
    at('reach', 'link', 'Reach a person', { y: -73 }, { nth: 0, origin: 'stuck-end', originEdge: 'bottom' }),
  ],
  also: [
    {
      name: 'Register',
      build: { story: 'boards-00-sign-in--register-phone' },
      landmarks: [
        ...bar(1),
        at('title', 'heading', 'Register'),
        at('lead', 'text', 'No password. We email you a code and a link; either one makes your account.', { y: 9 }),
        at('email-label', 'text', 'EMAIL ADDRESS', { y: 4 }, { nth: 1, buildNth: 0 }),
        at('invite-label', 'text', 'INVITE', { y: -8 }),
        /* The invite's note is one line on one machine and two on another (its words fill the 358px column), so what follows it is held from where it ends. */
        at('invite-note', 'text', 'Your invite link filled this in.', {}, { buildName: 'Registration is by invite for now. Your invite link filled this in.', box: 'none' }),
        at('ack', 'text', 'I am 18 or older.', { y: 12 }, { origin: 'invite-note', originEdge: 'bottom' }),
        at('send', 'button', 'SEND A CODE', { y: 51.5 }, { nth: 1, buildNth: 0, origin: 'invite-note', originEdge: 'bottom' }),
      ],
    },
    {
      name: 'Reach a person',
      build: { story: 'boards-00-reach-a-person--contact-phone' },
      landmarks: [
        ...bar(2),
        at('title', 'heading', 'Reach a person'),
        at('discord-label', 'text', 'DISCORD', { y: -45 }),
        at('discord', 'link', 'OPEN THE DISCORD', { y: -45 }),
        at('email-label', 'text', 'EMAIL', { y: -62 }),
        at('email', 'link', 'admin@example.test', { y: -62 }),
      ],
    },
    {
      name: 'The front door',
      build: { story: 'boards-00-front-door--front-door-phone' },
      landmarks: [
        /* The phone's HUD is the build's own height (173px) where the board draws 237, and the board's screen stands at x = 1250 on its page: only its parts are compared, from its corner. */
        { id: 'hud', role: 'region', name: 'Game HUD', type: false, box: 'none' },
        at('prompt', 'heading', 'WHO WILL YOU PLAY AS?', { x: -14 }, { within: 'hud', origin: 'hud' }),
        at('register', 'link', 'REGISTER WITH AN INVITE', { y: -32 }, { within: 'hud', origin: 'hud' }),
        at('no-invite', 'text', 'No invite? Ask someone who plays.', { y: -57 }, { within: 'hud', origin: 'hud' }),
        at('sign-in', 'link', 'SIGN IN', { x: 15, y: -52 }, { within: 'hud', origin: 'hud' }),
      ],
    },
  ],
};
