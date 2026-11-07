/**
 * Board 19, Welcome (docs/research/2026-11-05-backfill/19-welcome.html, 1440 by 1720): a signed-in player with no character, as the story
 * `Boards/01 Welcome` (engine/ui/welcome/Welcome.board.stories.tsx) draws it. Compared: the menu bar, the page title, the column that says what
 * happens next, the letter's post (the persona's name, its headline as the instance writes it, Anton, on one line: the case the letter is written
 * in, not capitals), Before you start with its three settings, and the two calls to action. The phone drawing of this page is board 22's.
 *
 * Departures, by the glass's own scale and frame (the glass polish, design section 7: every board size token at 1.25 times where it names one),
 * each held at what the first run measured so a shift that is wrong fails:
 *  - The letter's headline is 64px where the board draws 60 (the glass's `4rem`), and Before you start is the glass's display-m, 40px where the
 *    board draws 44; the prose is the glass's 22px body where the board draws 21, so its paragraphs run longer and the signature is 33px tall, not
 *    25, and everything under the prose stands 28px lower than the board draws it (`PROSE`). The signature's weight and color are the build's own
 *    (700 and the second text color, where the board draws 800 and the first), so its type is not compared.
 *  - The post's top padding is 36px where the board draws 40, and the byline and the headline stand 12 and 9px higher.
 *  - The calls to action are GlassButtons, 48px tall where the board's `.btn` is 54 (the same as boards 14 to 17), at the glass's own width, so
 *    each is compared by its y and height.
 *  - The settings' notes and the lede run the post's width where the board draws them 680px wide (compared by their places).
 *  - The Theme row is the board look's tiles (engine/ui/account/ThemePicker.tsx, the board look design's section 9: "the tiles alone" on this page) where the board
 *    draws three radios and a sentence: the sentence is not on this page (Settings › The board says it, held by board 19 of the board look), and the tile row is
 *    taller than the radios' row by the 79px every row under it stands lower (`TILES`).
 */
import type { BoardManifest } from '../../board-match.ts';

/** Under the prose: the glass's 22px body and its longer wrapping put everything below it 28px lower than the board draws it. */
const PROSE = { y: 28 } as const;
/** Under the theme row: the PROSE shift and the tile row's own height over the three radios' (79px, as the first run measured). */
const TILES = { y: 107.2 } as const;

const manifest: BoardManifest = {
  board: '2026-11-05-backfill/19-welcome',
  size: { width: 1440, height: 1720 },
  build: { story: 'boards-01-welcome--welcome' },
  landmarks: [
    { id: 'menu', role: 'navigation', name: 'Menu', type: false },
    { id: 'title', role: 'heading', name: 'WELCOME' },
    { id: 'rail', role: 'complementary', name: 'What happens next', type: false, box: 'across' },
    { id: 'rail-lede', role: 'text', name: 'You\'re in. One letter, three settings, then your first character.', buildSize: 21 },
    { id: 'by', role: 'text', name: 'GABE', nth: 0, box: 'position', buildShift: { y: -12 } },
    { id: 'headline', role: 'heading', name: 'After nine years of development', buildSize: 64, box: 'position', buildShift: { y: -9 } },
    { id: 'p1', role: 'text', name: '...hopefully it would have been worth the wait.', buildSize: 22, origin: 'headline', originEdge: 'bottom' },
    { id: 'p4', role: 'text', name: 'Go make somebody.', buildSize: 22, buildShift: { y: 12.3 }, origin: 'headline', originEdge: 'bottom' },
    { id: 'sig', role: 'text', name: 'Gabe', nth: 1, type: false, box: 'position', buildShift: { y: 14.7 }, origin: 'headline', originEdge: 'bottom' },
    { id: 'start', role: 'heading', name: 'BEFORE YOU START', buildSize: 40, buildShift: { y: 32 }, origin: 'headline', originEdge: 'bottom' },
    { id: 'start-lede', role: 'text', name: 'How the board and the glass look and move. None of it changes how the game plays.', box: 'position', buildShift: PROSE, origin: 'headline', originEdge: 'bottom' },
    { id: 'theme', role: 'heading', name: 'THEME', box: 'position', buildShift: PROSE, origin: 'headline', originEdge: 'bottom' },
    { id: 'motion', role: 'heading', name: 'MOTION', box: 'position', buildShift: TILES, origin: 'headline', originEdge: 'bottom' },
    { id: 'motion-note', role: 'text', name: 'Reduced stops the drifting smoke, the pulses and the orb shine. A card\'s effect stays: Stick Around still snaps you back, only instantly.', box: 'position', buildShift: TILES, origin: 'headline', originEdge: 'bottom' },
    { id: 'size', role: 'heading', name: 'TEXT SIZE', box: 'position', buildShift: TILES, origin: 'headline', originEdge: 'bottom' },
    { id: 'size-note', role: 'text', name: 'Applies to the board and the glass together. Past 150% the glass folds into one column, and nothing is cut off.', box: 'position', buildShift: TILES, origin: 'headline', originEdge: 'bottom' },
    { id: 'make', role: 'link', name: 'MAKE YOUR FIRST CHARACTER', box: 'height', buildShift: { ...TILES, height: -6 }, origin: 'headline', originEdge: 'bottom' },
    { id: 'read', role: 'link', name: 'READ THE STRATEGY GUIDE FIRST', box: 'height', buildShift: { ...TILES, height: -6 }, origin: 'headline', originEdge: 'bottom' },
  ],
};

export default manifest;

/*
 * Board 22, the onboarding on a phone (docs/research/2026-11-05-backfill/22-onboarding-phone.html): three phone screens at 390 by 844 side by side on
 * one page, as board 18 draws the door's: the welcome's Before you start, the guide, and the tour's second step. A phone board has one parent and is
 * compared at 390 by 844 (e2e/boards.spec.ts), so this export is the whole board: the welcome is its own side, the guide and the tour are further
 * sides (`also`), each its own story. The page is opened at 390 wide with its screens at x = 20, 430 and 840; each landmark is found as its screen's
 * nth and measured from a part of that screen (`origin`), so a screen's place on the page is never compared.
 *
 * Held by decision: the HUD (not compared here) wraps "Mrs. Hooligan" onto two lines on the phone where board 22 draws it on one (the plan's
 * "wraps or shrinks to fit before it truncates"; the phone's row cannot hold the whole name on one line beside the bell, Menu and Hand); the welcome's parts are compared from the Before you start heading (the board draws the page scrolled to it, the build from its
 * top), the options wrap one row more in the build's 326px column than the board's 358px, so the label stands 32px higher and the notes 32 and 19px
 * lower (`buildShift`, as the first run measured); the theme row is the tiles, three across (the board look's Task 16), five of them in two rows with Divided World's five themes (Task 17), so its sentence
 * is not on this page and Motion and Text size stand 53px and 41px lower than the board draws them; the guide is compared from its top (the build is one long article, the board draws Classes alone);
 * and the tour's tip stands 36px lower and 46px shorter than the board's (its docking above the build's own HUD, and its kicker and step on one line).
 */
const PHONE = '2026-11-05-backfill/22-onboarding-phone';

export const phone: BoardManifest = {
  board: PHONE,
  size: { width: 390, height: 844 },
  build: { story: 'boards-01-welcome--welcome-phone' },
  landmarks: [
    { id: 'menu', role: 'navigation', name: 'Menu', nth: 0, type: false, box: 'size' },
    { id: 'start', role: 'heading', name: 'BEFORE YOU START', buildSize: 26, box: 'none' },
    { id: 'theme', role: 'text', buildRole: 'heading', name: 'THEME', origin: 'start', box: 'position', type: false, buildShift: { y: -32 } },
    { id: 'motion', role: 'text', buildRole: 'heading', name: 'MOTION', origin: 'start', box: 'position', type: false, buildShift: { y: 53 } },
    { id: 'size', role: 'text', buildRole: 'heading', name: 'TEXT SIZE', origin: 'start', box: 'position', type: false, buildShift: { y: 40.8 } },
  ],
  also: [
    {
      name: 'The guide',
      build: { story: 'boards-02-guide--top-phone' },
      landmarks: [
        { id: 'menu', role: 'navigation', name: 'Menu', nth: 1, buildNth: 0, type: false, box: 'size' },
        { id: 'lede', role: 'text', name: 'How the game works, from the people who made it. The voice is Gabe\'s; every fact in it is true, and every number is today\'s.', origin: 'menu', box: 'position', type: false, buildShift: { y: 17 } },
        { id: 'contents', role: 'button', name: 'CONTENTS · CLASSES', buildName: 'Contents · Welcome letter', origin: 'lede', originEdge: 'bottom', box: 'position', type: false, buildShift: { y: 0 } },
      ],
    },
    {
      name: 'The tour, step 2',
      build: { story: 'boards-14-tips--tour-orbs-phone' },
      landmarks: [
        { id: 'tip', role: 'dialog', name: 'THESE ARE YOUR ORBS', type: false, buildShift: { x: -840, y: 36, height: -46 } },
      ],
    },
  ],
};
