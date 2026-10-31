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
 *  - the splat itself on #41, which is pixels (the board's is a drawing in the same ink, the build's a
 *    seeded one: e2e/whoops.spec.ts reads it). "Hold to scrub" on #41 is found, and #41 carries its tag
 *    (cards Task 3, two lines and clear of the post's line: the owner's notes on #80) and its scrub
 *    sentence in a glass strip under the post (cards Task 5, the same notes).
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
  /*
   * The board is drawn at 1440 across the whole window; the build stands in the board's column, at most 960px wide and
   * centered (the owner: "we need a smaller max width for the 2003 board in general", the glass plan's section 8 amendment of
   * 2026-10-30). So a post's x and width differ by that word, and the landmarks inside it are compared as they sit in it
   * (from the post's own corner, `origin`) with the permalink, which the board sets at the right edge of a post a different
   * width, by its y and height. The post's own box is not compared: its body wraps in the narrower column (the build's #41 is
   * 342px tall to the board's 275), which is that word and no fault of the post's. Where `box` is 'none', no landmark in the
   * post is compared by place at all.
   */
  const placed = box === 'none' ? undefined : id;
  const inside = box === 'none' ? 'none' : 'position';
  return [
    { id, role: 'article', name: '', nth: index, buildName: `Post ${n} by ${author}`, buildNth: 0, box: 'none' },
    { id: `${id}-author`, role: 'link', name: author, within: id, origin: placed, box: inside },
    /* The rank's name is the postbit's (web Task 5), which says the rank's title where the board says pips. */
    { id: `${id}-rank`, role: 'img', name: `Rank: ${pips} of 6 pips`, buildName: `Rank ${pips} of 6: ${rank}`, within: id, origin: placed, box: inside, type: false },
    { id: `${id}-permalink`, role: 'link', name: `#${n}`, buildName: `Permalink to post #${n}`, within: id, box: box === 'none' ? 'none' : 'height' },
  ];
}

/*
 * The fanned cards' names in the build. The board names them "Stick Around, Sweet postcard", but the
 * Main hand's cards show their tagline too, and a button's name must hold the words it shows in order
 * (WCAG 2.5.3, cardLabel in engine/ui/cards/Postcard.tsx), so the build's name holds the tagline
 * between the tag and the word "postcard".
 */
const STICK = 'Stick Around, Sweet. Hold a reader on a post. postcard';
const WHOOPS = 'Whoops!, Salty. Splat a post in ink. postcard';

const manifest: BoardManifest = {
  board: '01-main',
  size: { width: 1440, height: 1120 },
  build: { moment: '01-main' },
  press: [{ role: 'button', name: 'Hand, 3 postcards' }, { role: 'button', name: WHOOPS }],
  landmarks: [
    /*
     * The banner: Index and the instance's boards. The board's Search is not built (section 3). The board draws its rows across
     * the 1440px window; the build's stand in the board's column, 960px wide and centered (the owner's word, above, on `post`).
     * So the links row is compared by its y and height, Index by its y and height too (its x is the column's edge), and the links
     * after it from Index, where they sit in the row.
     */
    { id: 'nav', role: 'navigation', name: 'Main', box: 'height' },
    { id: 'nav-index', role: 'link', name: 'Index', within: 'nav', box: 'height' },
    { id: 'nav-general', role: 'link', name: 'General', within: 'nav', origin: 'nav-index', box: 'position' },
    { id: 'nav-system', role: 'link', name: 'The System', within: 'nav', origin: 'nav-index', box: 'position' },

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
     * The posts. A card play takes no number and shows as its tag on its post (cards Task 3), so the page holds #41 to #46 and
     * nothing else. #41 is splatted (cards Task 5): its body is laid out at the width the post body has at the board's 960px,
     * so it breaks its lines as an unsplatted post does, and its splat covers the body edge to edge (the owner's word, the cards
     * plan's Task 5 amendment of 2026-10-30). The board is drawn across the 1440px window and the build stands in a 960px
     * column, so a post's x and width, and the heights of #41 (its words wrap more in the narrower column) are the owner's word
     * and not compared (see `post`); what is inside a post is compared from the post's own corner. #42 and #43 are compared by
     * type: #42's post is 92px shorter than the board's (the board's has a 160px avatar slot under the postbit, which the build
     * has no portrait to fill, web Task 5), which is nothing of Whoops!'s.
     */
    ...post(41, 0, 'Spritey', 4, 'Main Eventer', 'position'),
    ...post(42, 1, 'Mrs. Hooligan', 3, 'Midcarder', 'none'),
    ...post(43, 2, 'Pipewrench', 2, 'Enhancement Talent', 'none'),
    /*
     * The row of actions under each post. The board draws it bare, over the post's ink or ground, with "Play card" among Quote
     * and the rest; the build draws it on an opaque footer bar of its own, like the header bar, and without "Play card". Both
     * differ by the owner's word and neither is compared: "I think we will likely need to put Quote, Spin, Edit, etc on a
     * solid-color bar of their own, a footer bar similar to the header bar ... There's no way the current #000 text against
     * that magenta ink passes contrast, and that ink color is totally variable too." (the footer bar's amendment of 2026-10-31,
     * the screens-and-cards plan), and "why do we have "Play card" in this row at all anymore? It's a game act so it should be
     * Glass, right? ... Hand -> Select a card -> glass-styled button appears on each applicable post?" A card is played from
     * the hand and the armed card's tile alone. The bar adds its own height to every post, so a post's box is not compared
     * below its line either (as `post` says for its box).
     */
    /*
     * The armed card's button on #42. The board draws it as a link in the post's row of actions; the build draws a real
     * button (cards Task 3) and, by the owner's word on #80's shots ("we should try to find a way to make the play button
     * itself glass-styled"), a glass tile attached under the post, outside the 2003 row (the cards plan's Task 3 amendment of
     * 2026-10-30). So it differs from the board in kind and in place, and is found
     * by its name within the post and compared by neither its box nor its type.
     */
    { id: 'post-42-play', role: 'link', name: 'Play Whoops! here', buildName: 'Play Whoops! on post 42', buildRole: 'button', within: 'post-42', box: 'none', type: false },
    /*
     * Whoops!'s keyboard path. The board draws #41's scrub sentence, "Scrub with the keyboard" in the 2003 button, inside the
     * post's 2003 body; the build draws the sentence, "Hold to scrub" and the author's tools as one glass strip under the
     * post, outside its chrome, by the owner's word (#80's notes: "a description of a postcard effect is pure glass, only the
     * effect itself should be integrated with the game world's copy and styling", and game state "should not be in the 2003
     * chrome"; the cards plan's Task 5 amendment, the glass plan's section 7 amendment of 2026-10-30). That region differs
     * by that answer, so the button is found by its name and kind within the post and compared by neither box nor type.
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
    { id: 'card-stick', role: 'button', name: 'Stick Around, Sweet postcard', buildName: STICK, type: false },
    { id: 'card-whoops-armed', role: 'button', name: 'Whoops!, Salty postcard, armed: pick a post', buildName: `${WHOOPS}, armed: pick a post`, type: false },
    { id: 'card-whoops', role: 'button', name: 'Whoops!, Salty postcard', buildName: WHOOPS, type: false },
    /* The armed card's floating tag. */
    { id: 'armed-tag', role: 'text', name: 'Armed · pick a post' },
  ],
};

export default manifest;
