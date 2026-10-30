/**
 * Board 01, the Main board (docs/research/2026-10-29-two-worlds/01-main.html): page 3 of "who keeps
 * splatting my posts" as the player sees it at 21:47 on Oct 29, the HUD on Pipewrench. The glass
 * plan's section 7 lists what is compared; section 3 says where the build departs from the board
 * by a decision, and each departure is named where it sets a `buildName` or a box mode.
 *
 * Left out until the part that builds them (the glass build plan, Part 3, the cards):
 *  - the hand's fanned postcards, the armed card's tag, "Play Whoops! here" on #42 (cards Tasks 2 and 3);
 *  - "Hold to scrub" on #41, the splat it scrubs and the Whoops! tag over #41 (cards Task 5).
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
     * The posts, by position and type. #41's height on the board is its splat and the line under it
     * (cards Task 5, Part 3), so where #42 and #43 start waits on Part 3: they are compared by type
     * until then, and Part 3 turns them to `position`.
     */
    ...post(41, 0, 'Spritey', 4, 'Main Eventer', 'position'),
    ...post(42, 1, 'Mrs. Hooligan', 3, 'Midcarder', 'none'),
    ...post(43, 2, 'Pipewrench', 2, 'Enhancement Talent', 'none'),

    /*
     * The Game HUD. The thread below #46 is left out, and the plays' lines the fixture writes there
     * until cards Task 3 (section 3, the sixth departure) do not reach the HUD, which is docked at
     * the bottom of the window: it is compared in full. Part 3 keeps it so.
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
    { id: 'hud-menu', role: 'button', name: 'Menu', within: 'hud' },
    /* The Menu button's Esc key cap, a <kbd> with no role. The AURA label beside the orbs is not in section 7's list. */
    { id: 'hud-esc', role: 'text', name: 'ESC', within: 'hud' },
    { id: 'hud-hand', role: 'button', name: 'Hand, 3 postcards', within: 'hud' },
  ],
};

export default manifest;
