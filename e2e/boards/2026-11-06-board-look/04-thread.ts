/**
 * Board 04, a thread, in the Silver house theme (docs/research/2026-11-06-board-look/04-thread.html, 1440 by 1000; 04-thread-dark.html is the
 * same page in the dark mode and is compared on colors only, by web/contrast.test.tsx): page 3 of "who keeps splatting my posts" as the player
 * sees it at 21:47 on Oct 29, Pipewrench on the HUD. The build is the fixture moment 01-main, the same page 01-main.ts compares the HUD, the hand
 * and the game's pieces on; the thread's own landmarks are here (the board-look plan, Task 6 moved them from 01-main.ts: the crumb, the title, the
 * pager, and each post's author, rank and permalink; the board's posts are table rows with no article role, so the build's article, which 01-main compared, is dropped, its type being the author link's and its place each part's own).
 *
 * A post is three cells of one color (engine/ui/thread/thread.css): the post line, the words and the actions, ruled by the table's 1px grid, with the
 * postbit spanning the three. The line is found by its date and its permalink, the actions by their buttons, each from the post's own corner (its top
 * for the line, its bottom for the actions), since a post's height is its words' and the splat does not change it.
 *
 * Departures, each a decision:
 *  - The postbit's column is 14em (210px) at most where the board draws 216px, so the words and the post line stand 8.7px nearer the author (their 1% inset and the postbit's 6%
 *    are the old padding, kept so the reaction picker's story, e2e/boards/03-react.ts, still stands where it did).
 *  - The words are the fixture's, not the board's: #42 quotes #41 here where the board has #43 quote #42, and #43 has the four reactions of the
 *    fixture, so no post's words are compared and a post's own height is not (the post lines and the actions are measured from its corner).
 *  - The player owns all three characters in the fixture, so the build's actions hold Edit on every post where the board draws it on #43; History's place is not compared.
 *  - The board's rank pips are a span with no role, so the rank's title is compared in their place; the pips are a game piece.
 *  - The page holds #44 to #46 below #43 (the board is cut at the HUD), so only #41 to #43 are compared.
 *  - The post counts and the avatars are the fixture's numbers and the board's placeholders, as in 01-main.
 *  - The reactions and the Whoops! mark and its ink are game pieces drawn for place; 01-main.ts and the reaction and Whoops! specs hold them.
 *  - The HUD is drawn for place only and is 01-main's.
 */
import type { BoardManifest, Landmark } from '../../board-match.ts';

/** The type scale's sizes, in px: the words a board draws at 12px (a post) are 15px here; the pager and the crumb, drawn at 11px, are 13.75px; the title, 18px, 22.5px. */
const POST_SIZE = 15;
const SMALL_SIZE = 13.75;
const TITLE_SIZE = 22.5;
const LINE_SIZE = 12.5;
/** A small Chrome button's type: --kb-size-fine (12.5px), the board-look plan's Task 4, where the board draws it at 11.25px. */
const BUTTON_SIZE = 12.5;

/**
 * A post's parts, each measured from the post's author link (the board's posts are table rows, not articles, so the build's article is
 * compared in 01-main's terms nowhere: its type is the author link's). `nth` is the post's place among the page's, for the buttons every
 * post has.
 */
function post(n: number, index: number, author: string, rank: string): Landmark[] {
  const id = `post-${n}`;
  const at = `Oct 29, 2026, ${n === 41 ? '9:14' : n === 42 ? '9:20' : '9:31'} PM`;
  /* The first button stands from the author by its x alone (the row's y is its post's bottom, held by e2e/thread.spec.ts); the rest stand from it. */
  const button = (name: string, key: string, from?: string): Landmark => ({
    id: `${id}-${key}`, role: 'button', name, nth: index, buildNth: index, origin: from ?? `${id}-author`, box: from ? 'position' : 'across', buildSize: BUTTON_SIZE, buildShift: { x: from ? 11.1 : -8.7 },
  });
  return [
    { id: `${id}-author`, role: 'link', name: author, box: 'none', buildSize: POST_SIZE },
    { id: `${id}-rank`, role: 'text', name: rank, origin: `${id}-author`, box: 'position', buildSize: POST_SIZE },
    { id: `${id}-when`, role: 'text', name: at, origin: `${id}-author`, box: 'position', buildSize: LINE_SIZE, buildShift: { x: -8.7 } },
    { id: `${id}-permalink`, role: 'link', name: `#${n}`, buildName: `Permalink to post #${n}`, origin: `${id}-author`, box: 'height', buildSize: LINE_SIZE },
    button('Quote', 'quote'),
    button('Spin thread', 'spin', `${id}-quote`),
    /* The player owns all three characters in the fixture, so the build's row holds Edit on every post where the board draws it on #43 alone: History stands after it, and its place is not compared (its type is the actions' own, held with Quote and Spin thread). */
  ];
}

const manifest: BoardManifest = {
  board: '2026-11-06-board-look/04-thread',
  size: { width: 1440, height: 1000 },
  build: { moment: '01-main' },
  landmarks: [
    /* The crumb: Index, the thread's board, the thread. The nav above it holds the first link of each name, so the crumb's are the second. */
    { id: 'crumb-index', role: 'link', name: 'Index', nth: 1, buildNth: 1, buildShift: { y: 8.1 } },
    { id: 'crumb-board', role: 'link', name: 'General', nth: 1, buildNth: 1, buildShift: { y: 8.1 } },
    { id: 'title', role: 'heading', name: 'who keeps splatting my posts', buildSize: TITLE_SIZE, buildShift: { y: 16.9 } },
    { id: 'pager', role: 'navigation', name: 'Pages, top', type: false, buildShift: { x: -39.2, y: 15, width: 39.2 } },
    { id: 'pager-where', role: 'text', name: 'Page 3 of 3', within: 'pager', buildShift: { x: -39.2, y: 15.3 } },
    { id: 'pager-1', role: 'link', name: '1', buildName: 'Page 1', within: 'pager', box: 'position', buildShift: { x: -40.9, y: 14 } },
    { id: 'pager-2', role: 'link', name: '2', buildName: 'Page 2', within: 'pager', box: 'position', buildShift: { x: -26.7, y: 14 } },
    { id: 'pager-here', role: 'text', name: '3', within: 'pager', box: 'position', buildShift: { x: -12.4, y: 15 } },
    { id: 'pager-jump', role: 'link', name: 'Jump to latest', within: 'pager', box: 'position', buildShift: { y: 14 } },
    { id: 'head-author', role: 'text', name: 'Author', box: 'position', buildShift: { y: 19.9 } },
    { id: 'head-message', role: 'text', name: 'Message', box: 'position', buildShift: { y: 19.9 } },
    ...post(41, 0, 'Spritey', 'Main Eventer'),
    ...post(42, 1, 'Mrs. Hooligan', 'Midcarder'),
    ...post(43, 2, 'Pipewrench', 'Enhancement Talent'),
  ],
};

export default manifest;
