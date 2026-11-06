/**
 * Board 28, the Lens (docs/research/2026-11-05-backfill/28-lens.html, 1440 by 1000): the Lens on Whoops! over the Main board's thread, docked at the right from 16px
 * under the page's top to just above the HUD, 460px wide, its bar (the tabs and Close) standing still and its body scrolling under it with a fade at its foot, the
 * current tab filled in the card's ink and the others outlined, the tabs one row that scrolls with a fade where more wait, a play's actions as a two-by-two grid.
 * The thread and the HUD behind it are drawn for place only and are not compared. The build is the story `Boards/01 Lens` > `Five kinds`
 * (instances/divided-world/ui/whoops/Lens.board.stories.tsx): #41 with Whoops!, Force Field, Autocorrect, Glitter Bomb and Stick Around, the Lens opened on
 * Whoops! with Who unfolded, as a reader opens it; it opens on its own once the thread is read.
 *
 * How the boards 28 and 29 divide the Lens (the question the first phase left open): this board is the Lens as a reader meets it on a post, Whoops!'s tab, over the
 * page (so it is compared at its place on the page: the dock's right edge, top and width, and its parts from its own corner); board 29 draws two more states of the
 * same panel, Stick Around's and the author's Whoops!, alone on the board's ground (compared from each panel's own corner only). Five kinds are drawn here
 * because the tab strip is this board's, and the story that holds them is `Five kinds`.
 *
 * Every part is compared from the dialog's own top-left corner (`origin`), as the glass's dialogs' boards are. What wraps under another part's words is held from that
 * part's bottom edge (`originEdge`), so a machine that sets the same words in a line more or less does not move what stands under them.
 *
 * Departures by decision:
 *  - The panel is 756px tall where the board draws 764: the board's HUD stand-in is 196px high where the build's is 212, and the panel ends 16px above the HUD's top
 *    (plan Task 10), so it is 8px shorter at 1440 by 1000.
 *  - The board's headline is an h2 in the display face; the build's is the state's first line, a paragraph in the body face (Task 9's roles: the heading is what the card is
 *    doing to this reader now, in the glass's type). Both say a percent: the board's is 41% where the story's partly washed ink is 32% (and the top layer's 95%), so the
 *    words are the story's and the type is not compared.
 *  - The thread moves aside for the dock (the owner, 2026-11-06: "Dock, but move the post"): the page ends 492px from the window's right edge (the dock's 460px and its two 16px gaps), so
 *    at 1440 the post is 948px wide and not 1200. The panel's own parts are held from its corner and are not moved by it; what moved is the top layer's share washed, which is read off the ink's
 *    geometry (the splat covers the post's body, now narrower), so the story's note says 97% where it said 95% before the page moved.
 *  - The glass's type scale (the polish, design section 7) and its 44px tiles set the Lens's words a step off the board's 19 to 21px: type is not compared, only places.
 *  - The board's Close is a box with a cross in it, the build's is the frame's CloseCross (52px).
 *  - The tabs: the board's order (Whoops!, Stick Around, Glitter Bomb, Autocorrect, Force Field) is the build's billing order (most drawn first, then the newest), which
 *    the story plays so that it is the same.
 */
import type { BoardManifest, Landmark } from '../../board-match.ts';

/** A part of the Lens, held by its place from the dialog's corner. */
export const part = (id: string, role: string, name: string, more: Partial<Landmark> = {}): Landmark => ({ id, role, name, within: 'dialog', origin: 'dialog', box: 'position', type: false, ...more });

/** What stands under another part, held from that part's bottom edge. */
const under = (of: string) => ({ origin: of, originEdge: 'bottom' }) as const;

/** The Lens's dialog, as the board draws it docked (its own place on the page is held by the first board). */
export const dialog = (more: Partial<Landmark> = {}): Landmark => ({ id: 'dialog', role: 'dialog', name: 'Cards on this post', type: false, box: 'size', buildShift: { height: -8 }, ...more });

const manifest: BoardManifest = {
  board: '2026-11-05-backfill/28-lens',
  size: { width: 1440, height: 1000 },
  build: { story: 'boards-01-lens--five-kinds' },
  landmarks: [
    { ...dialog(), box: 'full' },
    part('tabs', 'tablist', '', { buildName: 'Card kinds', box: 'position' }),
    part('tab-whoops', 'tab', 'WHOOPS!', { box: 'full', within: 'tabs' }),
    part('tab-stick-around', 'tab', 'STICK AROUND', { box: 'position', within: 'tabs' }),
    part('close', 'button', 'Close', { box: 'position' }),
    part('headline', 'text', '41% washed for you', { buildName: '32% washed for you', box: 'position', buildShift: { y: -18.5 } }),
    part('ends', 'text', 'Ends on your screen when you scrub every layer off. The author can wash it for everyone.', { box: 'position', buildShift: { y: -30 } }),
    part('hold', 'button', 'HOLD TO SCRUB', { buildName: 'Hold to scrub', ...under('ends'), box: 'position' }),
    part('fold', 'button', '3 plays · Gloomba, Pipewrench, Mrs. Hooligan', { ...under('hold'), box: 'position', buildShift: { y: -14 } }),
    part('note', 'text', 'LAYER 3 OF 3, ON TOP · 41% WASHED', { buildName: 'Layer 3 of 3, on top · 97% washed', ...under('fold'), box: 'position', buildShift: { y: -13 } }),
    part('who', 'text', 'GLOOMBA', { ...under('note'), box: 'position' }),
    part('message', 'text', '“fine, I\'ll do it myself”', { buildName: '“fine, I\'ll do it myself”', ...under('who'), box: 'position' }),
    part('react', 'button', '+ REACT', { buildName: 'React', ...under('message'), box: 'position', buildShift: { y: -6 } }),
    part('spin', 'button', 'SPIN THREAD', { ...under('message'), box: 'position', buildShift: { y: -6 } }),
    part('landed', 'button', 'AS IT LANDED', { ...under('message'), box: 'position', buildShift: { y: -14 } }),
    part('go', 'button', 'GO TO POST', { buildRole: 'link', ...under('message'), box: 'position', buildShift: { y: -14 } }),
  ],
};

export default manifest;

/*
 * Board 32, the Lens and My log on a phone (docs/research/2026-11-05-backfill/32-lens-log-phone.html): three phone screens at 390 by 844 side by side on one page, as board 18 draws
 * the door's: the Lens as a sheet that ends on the HUD's top edge and scrolls inside, My log before anything has settled with its character tabs as one row that scrolls and the
 * current one in view, and a settlement's posts open with each post's kind beside its link. A phone board has one parent and is compared at 390 by 844 (e2e/boards.spec.ts), so this
 * export is the whole board: the Lens is its own side, the two log screens further sides (`also`), each its own story. The page is opened at 390 wide with its screens at
 * x = 20, 430 and 840; each screen's parts are held from a part of that screen (`origin`), so a screen's place on the page is never compared.
 *
 * By decision: the board is drawn in the desktop's sizes and the build sets a phone in the glass's phone tokens (as board 18's header says), so no phone type is compared and a part is
 * held by its place; the sheet's board has no role or name (its first screen is a `figure`), so its parts are found by their words and held from the WHOOPS! tab; the Lens's words
 * are the build's (the state "32% washed for you" where the board's older "3 layers · top: Gloomba's yellow, 41% washed"); the empty row's sentence is the one the desktop says, in the build's truer words
 * (the board's phone draws only its second half, which the build does not say, so the build's is found and not placed); the board's sheet is 420px tall, the build's 55% of the room above the HUD (the Float's SHEET_SHARE).
 * STICK AROUND stands 8px right of the board's (`x: 8`) because the WHOOPS! tab before it is set at the phone's 21px where the board draws
 * 19px, and a tab's place is held from the first tab's left edge, so it carries the first tab's width. The shift is CI's measure (8.5px; 7.8px
 * here, and it did not go red here). A tab held from the previous tab's right edge would carry no shift, but an `originEdge` acts on y only
 * today: that is a follow-up, not this board's.
 */
const PHONE = '2026-11-05-backfill/32-lens-log-phone';

const bar = (nth: number): Landmark[] => [
  { id: 'menu', role: 'navigation', name: 'Menu', nth, buildNth: 0, type: false, box: 'none' },
  { id: 'menu-back', role: 'link', name: '‹ BACK TO THE BOARD', buildName: 'Back to the board', within: 'menu', origin: 'menu', box: 'height', type: false },
];
const at = (id: string, role: string, name: string, shift: { x?: number; y?: number } = {}, more: Partial<Landmark> = {}): Landmark => ({
  id, role, name, origin: 'menu', box: 'position', type: false, buildShift: shift, ...more,
});
const sheet = (id: string, role: string, name: string, shift: { x?: number; y?: number } = {}, more: Partial<Landmark> = {}): Landmark => ({
  id, role, name, origin: 'tab', box: 'position', type: false, buildShift: shift, ...more,
});

export const phone: BoardManifest = {
  board: PHONE,
  size: { width: 390, height: 844 },
  build: { story: 'boards-01-lens--lens-whoops-phone' },
  landmarks: [
    { id: 'tab', role: 'text', name: 'WHOOPS!', box: 'none', type: false },
    sheet('tab-stick-around', 'text', 'STICK AROUND', { x: 8 }),
    sheet('headline', 'text', "3 layers · top: Gloomba's yellow, 41% washed", { x: -9, y: -8.5 }, { buildName: '32% washed for you' }),
    sheet('hold', 'text', 'HOLD TO SCRUB', { x: -11.2, y: -25 }, { buildName: 'Hold to scrub' }),
    sheet('fold', 'text', '⌄ 3 plays · Gloomba, Pipewrench, Mrs. Hooligan', {}, { box: 'none', buildName: '3 plays · Gloomba, Pipewrench, Mrs. Hooligan' }),
  ],
  also: [
    {
      name: 'My log, empty',
      build: { story: 'boards-12-log--empty-phone' },
      landmarks: [
        ...bar(0),
        at('title', 'heading', 'MY LOG', { y: 51 }, { buildName: 'My log' }),
        at('tab-all', 'tab', 'ALL', {}, { buildRole: 'button', box: 'none' }),
        at('tab-hooligan', 'tab', 'MRS. HOOLIGAN', {}, { buildRole: 'button', box: 'none' }),
        at('nothing', 'text', 'Nothing yet', {}, { box: 'none' }),
        at('first', 'text', 'Its first settlement, in 7 h 42 min, is the first line here.', {}, { box: 'none', buildName: 'Nothing has settled for Mrs. Hooligan yet. A line comes here when a settlement scores it; the next is in 7 h 42 min.' }),
      ],
    },
    {
      name: "My log, a settlement's posts open",
      build: { story: 'boards-12-log--open-phone' },
      landmarks: [
        ...bar(1),
        at('kind-1', 'text', 'HEAT', {}, { box: 'none' }),
        at('post-1', 'text', 'your post #43', {}, { nth: 0, box: 'none' }),
        at('amount-1', 'text', '+0.20', {}, { box: 'none' }),
      ],
    },
  ],
};
