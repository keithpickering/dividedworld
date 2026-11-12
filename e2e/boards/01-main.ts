/**
 * Board 01, the Main board (docs/research/2026-10-29-two-worlds/01-main.html): page 3 of "who keeps
 * splatting my posts" as the player sees it at 21:47 on Oct 29, the HUD on Pipewrench. The glass
 * plan's section 7 lists what is compared; section 3 says where the build departs from the board
 * by a decision, and each departure is named where it sets a `buildName` or a box mode.
 *
 * The hand is the cards part's (the glass build plan, Part 3), and the hand-arc design
 * (docs/plans/2026-11-12-hand-arc-design.md, section 5) is the departure: the board draws three postcards
 * fanned through the HUD's seam, the build an arc with one face per kind. So the build is pressed on the
 * hand button, then on Whoops! (which arms it and closes the arc), then on the hand button again, which
 * opens the arc with Whoops! armed and lifted ("Hand, 3 postcards, open"; the board's button is
 * unopened). The board's two Whoops! are the build's one, "2 in hand", and its armed one is compared by
 * its name only.
 *
 * Left out until the part that builds them (the glass build plan, Part 3, the cards):
 *  - the splat itself on #41, which is pixels (the board's is a drawing in the same ink, the build's a
 *    seeded one: e2e/whoops.spec.ts reads it). #41 carries its marks in its date row, and "Hold to scrub" is the Lens's, opened
 *    from the Whoops! mark (the marks-and-the-lens plan); neither the board nor this comparison draws them.
 * Left out because the fixture cannot hold it: the "3 new posts" bar, which is the thread's answer
 * to posts that arrive while the reader is higher up, and a seeded page has nothing arriving.
 * Not compared: the post counts and the avatars (the fixture's numbers and the board's placeholders),
 * and "React" and "1 of 3 left" on #41 and #42, which are the player's own characters' posts
 * (section 3, the first departure).
 *
 * The thread's type, its postbit, post line, crumb and pager moved to `2026-11-06-board-look/04-thread` and `05-reply` (the board-look plan, Task 6), which
 * hold the thread as the Silver board draws it, each with the shifts the larger type scale and the period table made. What this board still holds is the
 * game's: the HUD, the hand, the postcards, the armed tag and the armed card's button on #42. The boards' bar's links each carry their 16 by 14 icon in
 * the build (the board-look plan, Task 5), which this older board does not draw: the first link is 7px taller than the board's 13px line, and the next two stand 22px and 44px further from
 * it than before the icons (12.4 and 28.2 from the type scale alone, so 34.4 and 72.2 now): each link before them is 22px wider, its 16px
 * icon and its 6px gap, measured by hiding the icons and the gap on the same page.
 */
import type { BoardManifest } from '../board-match.ts';

/*
 * The fanned cards' names in the build. The board names them "Stick Around, Sweet postcard", but the
 * Main hand's cards show their tagline too, and a button's name must hold the words it shows in order
 * (WCAG 2.5.3, cardLabel in engine/ui/cards/Postcard.tsx), so the build's name holds the tagline
 * between the tag and the word "postcard".
 */
const STICK = 'Stick Around, Sweet, Move. Hold a reader on a post., common postcard';
const WHOOPS = 'Whoops!, Salty, Move. Splat a post in ink., common postcard';
/* The hand arc draws one face per kind, so the board's two Whoops! are the build's one, "2 in hand" (the hand-arc design, section 5). */
const WHOOPS_2 = `${WHOOPS}, 2 in hand`;
/* The card mechanic (docs/plans/2026-11-01-card-plays-plan.md, Task 7) adds each card's play and rarity to its name: a departure from the board. */

const manifest: BoardManifest = {
  board: '01-main',
  size: { width: 1440, height: 1120 },
  build: { moment: '01-main' },
  press: [{ role: 'button', name: 'Hand, 3 postcards' }, { role: 'button', name: WHOOPS_2 }, { role: 'button', name: 'Hand, 3 postcards' }],
  landmarks: [
    /*
     * The banner: Index and the instance's boards. The board's Search is not built (section 3). The board draws its rows across
     * the 1440px window; the build's stand in the board's column, 1200px wide and centered (the owner's word, above, on `post`).
     * So the links row is compared by its y and height, Index by its y and height too (its x is the column's edge), and the links
     * after it from Index, where they sit in the row.
     */
    /*
     * The boards' bar is the Silver house theme's (the board-look plan, Task 3): white words on a dark band under the banner's block, where the
     * black-and-white board draws black on white, so its type is not compared here (its color is the theme's, held by 01-index of
     * docs/research/2026-11-06-board-look/), and it stands 33px lower (the banner's top margin, its 16px padding, the 31px name and the
     * frame, 9.4px more in the bar's own height).
     */
    { id: 'nav', role: 'navigation', name: 'Main', box: 'height', type: false, buildShift: { y: 33, height: 9.4 } },
    { id: 'nav-index', role: 'link', name: 'Index', within: 'nav', box: 'height', type: false, buildShift: { y: 36, height: 7 } },
    { id: 'nav-general', role: 'link', name: 'General', within: 'nav', origin: 'nav-index', box: 'position', type: false, buildShift: { x: 34.4 } },
    { id: 'nav-system', role: 'link', name: 'The System', buildName: 'Staff Announcements', within: 'nav', origin: 'nav-index', box: 'position', type: false, buildShift: { x: 72.2 } },

    /*
     * The thread's own landmarks (the crumb, the title and its pager, and each post's author, rank, post line, permalink and actions) are
     * `2026-11-06-board-look/04-thread`'s and `05-reply`'s (the board-look plan, Task 6): the thread is drawn there as the Silver board draws it,
     * where this older black-and-white board's crumb, pager and postbit are not the build's look any more. What stays here is what a board of the
     * game's own pieces draws on that page: the HUD, the hand, the postcards and the armed card's button on a post.
     */
    /*
     * The armed card's button on #42. The board draws it as a link in the post's row of actions; the build draws a real
     * button (cards Task 3) and, by the owner's word on #80's shots ("we should try to find a way to make the play button
     * itself glass-styled"), a glass tile attached under the post, outside the 2003 row (the cards plan's Task 3 amendment of
     * 2026-10-30). So it differs from the board in kind and in place, and is found
     * by its name within the post and compared by neither its box nor its type.
     */
    { id: 'post-42-play', role: 'link', name: 'Play Whoops! here', buildName: 'Play Whoops! on post 42', buildRole: 'button', box: 'none', type: false },
    /*
     * Whoops!'s keyboard path. The board draws #41's scrub sentence, "Scrub with the keyboard" in the 2003 button, inside the
     * post's 2003 body. The build has no plate: "Hold to scrub" is a control of the Lens, which a mark on the post opens
     * (the marks-and-the-lens design, sections 1 and 2), and the board draws neither marks nor a Lens, so there is nothing to
     * find on the closed page. The Lens's own words and type are held by its stories (e2e/plays.spec.ts, e2e/glass-text.spec.ts).
     */

    /*
     * The Game HUD, docked at the bottom of the window, is compared in full. The thread below #46 is
     * left out: the board draws no pager there.
     */
    { id: 'hud', role: 'region', name: 'Game HUD', type: false },
    { id: 'hud-name', role: 'text', name: 'Pipewrench', within: 'hud' },
    { id: 'hud-class', role: 'text', name: 'Heel', within: 'hud' },
    { id: 'hud-secret', role: 'text', name: 'Only you see this', within: 'hud' },
    { id: 'hud-swap', role: 'combobox', name: 'Swap mask', within: 'hud' },
    /* The wallet's name is web Task 3's (section 3, the fifth departure). */
    { id: 'hud-orbs', role: 'img', name: 'Aura: 4.62 of 6.00 settled, about 0.30 more estimated', buildName: 'Wallet 4.62 of 6 orbs, 0.30 pending until the next settlement (estimate)', within: 'hud', type: false },
    { id: 'hud-estimate', role: 'text', name: '+0.30 est.', within: 'hud' },
    { id: 'hud-clock', role: 'text', name: 'Next settlement', within: 'hud', box: 'position' },
    /*
     * Menu's box, then its word and its Esc key cap each by its own type. The build hides the key cap
     * from the accessibility tree and takes the button's name from its word (engine/ui/frame/Hud.tsx),
     * where the board sets aria-label over a visible key cap, which axe's label-in-name rule refuses;
     * so the button's first text differs between the two, and its type is read from each part instead.
     */
    { id: 'hud-menu', role: 'button', name: 'Menu', within: 'hud', type: false },
    { id: 'hud-menu-word', role: 'text', name: 'Menu', within: 'hud-menu' },
    /* The Menu button's Esc key cap, a <kbd> with no role. The AURA label beside the orbs is not in section 7's list. */
    { id: 'hud-esc', role: 'text', name: 'ESC', within: 'hud' },
    { id: 'hud-hand', role: 'button', name: 'Hand, 3 postcards', buildName: 'Hand, 3 postcards, open', within: 'hud' },
    /* The fanned postcards at -11, -1 and 10 degrees: each a button by its name, compared by the turned card's bounds. */
    { id: 'card-stick', role: 'button', name: 'Stick Around, Sweet postcard', buildName: STICK, type: false },
    /*
     * The hand-arc design's section 5 departs from the board here. The board's middle card is armed and raised 48px in the open fan; the build arms
     * by closing the arc, so the match presses the hand button, Whoops! and the hand button again, and the armed card stands lifted (upright, higher
     * and larger) where the board draws it in the fan. So the armed card and its tag are found, and their boxes are not compared. The board's third
     * card, the plain Whoops!, is not drawn: the build has one face per kind, Whoops! with "2 in hand", so no `card-whoops` entry.
     */
    { id: 'card-whoops-armed', role: 'button', name: 'Whoops!, Salty postcard, armed: pick a post', buildName: `${WHOOPS_2}, armed: pick a post`, type: false, box: 'none' },
    /* The armed card's floating tag: the hand-arc design's section 5 departure, by its box. */
    { id: 'armed-tag', role: 'text', name: 'Armed · pick a post', box: 'none' },
  ],
};

export default manifest;
