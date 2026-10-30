/**
 * Board 01, the Main board (docs/research/2026-10-29-two-worlds/01-main.html): page 3 of "who keeps
 * splatting my posts" as the player sees it at 21:47 on Oct 29, the HUD on Pipewrench. The glass
 * plan's section 7 lists what is compared; section 3 says where the build departs from the board
 * by a decision, and each departure is named where it sets a `buildName` or a box mode.
 *
 * The hand is the cards part's (the glass build plan, Part 3): the board draws three postcards fanned
 * through the HUD's seam, so the build is pressed on the hand button before it is read, which opens
 * the hand ("Hand, 3 postcards, open"; the board's button is unopened, the cards standing as the
 * armed card leaves them). The board's second card is the armed one; arming is cards Task 3's, so the
 * build's second Whoops! stands in the hand unarmed and the board's third, the one plain Whoops!,
 * is the build's second.
 *
 * Left out until the part that builds them (the glass build plan, Part 3, the cards):
 *  - the armed card's tag and place, "Play Whoops! here" on #42 (cards Task 3);
 *  - the splat itself on #41, which is pixels (the board's is a drawing in the same ink, the build's a
 *    seeded one: e2e/whoops.spec.ts reads it). "Hold to scrub" on #41 is compared, and #41 carries its
 *    tag (cards Task 3) and its hint line as the board draws them (cards Task 5).
 * Left out because the fixture cannot hold it: the "3 new posts" bar, which is the thread's answer
 * to posts that arrive while the reader is higher up, and a seeded page has nothing arriving.
 * Not compared: the post counts and the avatars (the fixture's numbers and the board's placeholders),
 * and "React" and "1 of 3 left" on #41 and #42, which are the player's own characters' posts
 * (section 3, the first departure).
 *
 * The thread's type and the postbit are the board's: the two-worlds design decides Verdana and bold
 * Courier New in black and white, and the board how they look (docs/research/2026-10-29-two-worlds/
 * README.md), so the build sets 12px Verdana words, an 18px Courier New title, bold Verdana names
 * with the rank under them, and a 10px post line in the muted ink (engine/ui/tokens.css).
 */
import type { BoardManifest, Landmark } from '../board-match.ts';

/** A post's article, its author link, its rank and its permalink, found inside the article. */
function post(n: number, index: number, author: string, pips: number, rank: string, box: Landmark['box']): Landmark[] {
  const id = `post-${n}`;
  return [
    /* The board's articles have no name, so it picks by place; the build names each by its number and author. */
    { id, role: 'article', name: '', nth: index, buildName: `Post ${n} by ${author}`, buildNth: 0, box },
    { id: `${id}-author`, role: 'link', name: author, within: id, box },
    /* The rank's name is the postbit's (web Task 5), which says the rank's title where the board says pips. */
    { id: `${id}-rank`, role: 'img', name: `Rank: ${pips} of 6 pips`, buildName: `Rank ${pips} of 6: ${rank}`, within: id, box, type: false },
    { id: `${id}-permalink`, role: 'link', name: `#${n}`, buildName: `Permalink to post #${n}`, within: id, box },
  ];
}

const manifest: BoardManifest = {
  board: '01-main',
  size: { width: 1440, height: 1120 },
  build: { moment: '01-main' },
  press: [{ role: 'button', name: 'Hand, 3 postcards' }],
  landmarks: [
    /* The banner: Index and the instance's boards. The board's Search is not built (section 3). */
    { id: 'nav', role: 'navigation', name: 'Main' },
    { id: 'nav-index', role: 'link', name: 'Index', within: 'nav', box: 'position' },
    { id: 'nav-general', role: 'link', name: 'General', within: 'nav', box: 'position' },
    { id: 'nav-system', role: 'link', name: 'The System', within: 'nav', box: 'position' },

    /*
     * The breadcrumb over the thread's head, by its type: the board's words lead from the instance
     * through the board, and the build's crumb is Index and the title (Thread.tsx).
     */
    { id: 'crumb', role: 'text', name: 'Divided World » General » who keeps splatting my posts', buildName: 'Index › who keeps splatting my posts', box: 'none' },

    /* The thread's head: its type only (section 7). */
    { id: 'title', role: 'heading', name: 'who keeps splatting my posts', box: 'none' },
    { id: 'page-1', role: 'link', name: '1', buildName: 'Page 1', box: 'none' },
    { id: 'jump', role: 'link', name: 'Jump to latest', box: 'none' },

    /*
     * The posts, by position and type. A card play takes no number and shows as its tag on its post
     * (cards Task 3), so the page holds #41 to #46 and nothing else. #41 is splatted (cards Task 5): the
     * board draws its splat in a 150px frame and the card's fixed layout is the board's 12px type in a
     * 360px column, never scaled up (#76), so #42 and #43 start where the board's do, or as near as 1x allows.
     *
     * Tried in full and by position (#76). Neither holds, for two reasons the build cannot close:
     * the board lays #41's body out across its whole 1000px-wide column (three lines in a 150px
     * frame) where the card's column is 360px, so #41 is 26px taller than the board's and #42 starts
     * 26px lower (y 455 against 429); and #43 starts 66px higher (598 against 664) because #42's own
     * post is 92px shorter (143 against 235: the board's has a 160px avatar slot under the postbit,
     * which the build has no portrait to fill, web Task 5), which is nothing of Whoops!'s. x, width
     * and x of every landmark inside the article match, and only y and heights differ. They stay compared by type.
     */
    ...post(41, 0, 'Spritey', 4, 'Main Eventer', 'position'),
    ...post(42, 1, 'Mrs. Hooligan', 3, 'Midcarder', 'none'),
    ...post(43, 2, 'Pipewrench', 2, 'Enhancement Talent', 'none'),
    /*
     * Whoops!'s keyboard path, a piece of glass in the hint line under the splat; the board calls it
     * "Scrub with the keyboard". Found by its name and kind: where it lies follows #41's frame (above)
     * down the page and the build's content column across it (its author column is narrower than the
     * board's), and its type is the glass's, in the card's tag's family, not the 2003 button's. Tried by position
     * (#76): it is 53px left of the board's (x 613 against 667) and 10px lower (y 367 against 356),
     * 170 by 32 where the board's is 148 by 17. The board's is the 2003 inline button set in a
     * sentence, the build's is the glass button, larger, in the hint line.
     */
    { id: 'post-41-scrub', role: 'button', name: 'Scrub with the keyboard', buildName: 'Hold to scrub', within: 'post-41', box: 'none', type: false },

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
    { id: 'card-stick', role: 'button', name: 'Stick Around, Sweet postcard', type: false },
    { id: 'card-whoops', role: 'button', name: 'Whoops!, Salty postcard', buildNth: 1, type: false },
  ],
};

export default manifest;
