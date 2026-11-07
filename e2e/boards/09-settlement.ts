/**
 * Board 09, the Settlement board (docs/research/2026-10-29-two-worlds/09-settlement.html, 1440 by
 * 960): the settlement's summary on the player's first load after the Oct 30 settlement, Pipewrench's
 * tab (the fixture's 09-settlement moment). No menu bar: a screen of results whose ways out are Open
 * my log, Back to the board and Esc (the glass plan, section 9, choice 8). The glass plan's section 7
 * lists what is compared; the reason lines as the notes below say.
 *
 * Where the build departs from the board, by a decision:
 *  - The tabs are buttons, not links: which character is shown is the page's own state, never in an
 *    address (engine/ui/log/Settlement.tsx).
 *  - Every figure after the 21:52 play is 1.00 more: a card is paid for once at the machine (#78; the
 *    glass plan's section 2.1 amendment), so the wallet went from 4.37 to 4.72.
 *  - Each reason is in the instance's words (`reasonWords`), the log's own (the web plan's Task 8:
 *    "each line equal to the log's line for the same reason"), where the board wrote its own
 *    sentences; and "Stole thunder" is on Gloomba's #46, not Spritey's #41 (the glass plan's section
 *    3). Their words differ, so each line's text is compared by height.
 *  - The board's "Every Act behind these lines is in your log" link is not built: Open my log is the
 *    one way into the log, and it opens the log on this settlement, open.
 *  - Three colors the board drew have no token in the glass's closed list (the glass plan, section 4), so those
 *    landmarks' type is not compared: the change's green (the build's gain is the log's neon text, as board 12
 *    draws a gain), the new rank's pale gold (the build's is the ready text), and FACE's #9fdcff (the build's is
 *    the class's own large color, #8fd6ff, the near value the plan made one).
 *  - The heading, the settled line and the tabs are a PageHead (engine/ui/glass/PageHead.tsx; the glass polish plan, Task 4): the settled line is the
 *    eyebrow, over the heading, in the page head's neon where the board draws amber, and the tabs, GlassButtons, stand under the heading, not on the
 *    board's top row. So the heading stands 21px higher, the wallet, rank and Turn columns about 58px lower, and the ways out 47px closer under the Turn card and 14px
 *    shorter than the board draws them (each is held to the board's place plus its shift), the heading's type is not compared (its letter-spacing is
 *    the page head's, 1px; its box is the page head's line-height 1, where the calm it stood in had 1.15, so the columns stand 18px higher than they did), the settled line and the tabs are compared by words and role alone, and the ways out's Back is the glass's primary button.
 *  - The reason lines are one line each in the build where the board's sentences take two: the first is
 *    compared by position, and the two under it, which stand higher for it, by their words and type alone.
 *  - The big figures are set with room in their own boxes, so the words lie inside the calm they stand in (the rendered measurement
 *    holds it), which moves the figures a few pixels; they are compared by position or height where it shows. The heading stands on the
 *    bare smoke, as every page's does (the settlement recipe's cyan layer is 0.30 for it, the board's 0.40).
 */
import type { BoardManifest } from '../board-match.ts';

const manifest: BoardManifest = {
  board: '09-settlement',
  size: { width: 1440, height: 960 },
  build: { moment: '09-settlement' },
  landmarks: [
    { id: 'when', role: 'text', name: 'Settled Oct 30 · 08:17 UTC', box: 'none', type: false },
    { id: 'tabs', role: 'navigation', name: 'Your characters', box: 'none', type: false },
    { id: 'tab-pipewrench', role: 'link', buildRole: 'button', name: 'Pipewrench', within: 'tabs', box: 'none' },
    { id: 'tab-hooligan', role: 'link', buildRole: 'button', name: 'Mrs. Hooligan', within: 'tabs', box: 'none' },
    { id: 'tab-spritey', role: 'link', buildRole: 'button', name: 'Spritey', within: 'tabs', box: 'none' },
    { id: 'title', role: 'heading', name: 'While you were away', box: 'position', buildShift: { y: -21 }, type: false },

    { id: 'wallet', role: 'region', name: 'Wallet', type: false, box: 'position', buildShift: { y: 58 } },
    /* The board's img is the column's 640px row; the build's is the orbs' own, so its place is compared. */
    { id: 'orbs', role: 'img', name: 'Wallet now 3.72 of 6.00', buildName: 'Wallet now 4.72 of 6.00', within: 'wallet', type: false, box: 'position', buildShift: { y: 58 } },
    { id: 'was', role: 'text', name: '3.37 →', buildName: '4.37 →', within: 'wallet', box: 'position', buildShift: { y: 58 } },
    { id: 'now', role: 'text', name: '3.72', buildName: '4.72', within: 'wallet', box: 'position', buildShift: { y: 58 } },
    { id: 'change', role: 'text', name: '+0.35', within: 'wallet', box: 'position', type: false, buildShift: { y: 58 } },
    { id: 'why', role: 'heading', name: 'Why, in plain words · scored as a Heel', within: 'wallet', box: 'position', buildShift: { y: 58 } },
    {
      id: 'line-heat', role: 'text', within: 'wallet', box: 'position', buildShift: { y: 58 },
      name: 'Drew heat: 6 heat reactions on 2 posts. The live estimate said up to +0.30; the shared vote and halving made it +0.20.',
      buildName: 'Drew heat: excited, negative reactions to the character\'s posts and cards',
    },
    {
      id: 'line-thunder', role: 'text', within: 'wallet', box: 'none',
      name: 'Stole thunder: your Whoops! on Spritey\'s post #41 drew more reactions than the post.',
      buildName: 'Stole the thunder: a Salty card the character played on another\'s post drew more votes than the post this window',
    },
    {
      id: 'line-shrug', role: 'text', within: 'wallet', box: 'none',
      name: 'The polite shrug: 1 calm reaction on your post #43.',
      buildName: 'Shrugged off: calm, positive reactions to the character\'s posts and cards',
    },

    { id: 'rank', role: 'region', name: 'Rank up', type: false, buildShift: { y: 58 } },
    { id: 'rank-label', role: 'text', name: 'New rank', within: 'rank', buildShift: { y: 58 } },
    { id: 'rank-was', role: 'text', name: 'Enhancement Talent', within: 'rank', buildShift: { y: 58 } },
    { id: 'rank-now', role: 'text', name: 'Midcarder', within: 'rank', type: false, buildShift: { y: 58 } },
    { id: 'rank-pips', role: 'img', name: 'Rank: 3 of 6 pips', within: 'rank', type: false, buildShift: { y: 58 } },
    { id: 'rank-words', role: 'text', name: 'Season standing 2.95 → 3.30. Every post of Pipewrench\'s now shows the new rank.', within: 'rank', buildShift: { y: 58 } },

    /* The Turn's sentence names the settlement's day (below), a line longer than the board's: the card is compared by position. */
    { id: 'turn', role: 'region', name: 'Turn', type: false, box: 'position', buildShift: { y: 58 } },
    { id: 'turn-was', role: 'text', name: 'Heel', within: 'turn', buildShift: { y: 58 } },
    { id: 'turn-now', role: 'text', name: 'Face', within: 'turn', type: false, buildShift: { y: 58 } },
    {
      id: 'turn-words', role: 'text', within: 'turn', box: 'position', buildShift: { y: 58 },
      name: 'Pipewrench\'s Turn took effect. From today it scores as a Face. The System announced it, with the old class, in Season 1: Who Turned.',
      /* The summary opens on a later load too, and by its address, where "today" would be false: the settlement's own day is always true. */
      buildName: 'Pipewrench\'s Turn took effect. From the Oct 30 settlement it scores as a Face. The System announced it, with the old class, in Season 1: Who Turned.',
    },

    /*
     * The two links are GlassButtons (docs/plans/2026-11-04-glass-polish-design.md, section 2): 48px of Barlow Condensed at the body's 21px, where
     * the board draws Anton at 26px, so each is a little narrower and "Back to the board" stands further left. Compared by y and height, and the
     * type (the parts' own) not at all. They flow under the Turn card, whose sentence one browser's text metrics wrap to two lines and another's to
     * three, so their y is the gap under the card (`originEdge: 'bottom'`), never a place on the page: 40px in the build, where the board, which pins
     * them to the screen's foot, leaves 87px. "Back to the board" is the glass's primary, not the board's yellow, which no other button uses.
     */
    { id: 'log', role: 'link', name: 'Open my log', box: 'height', origin: 'turn', originEdge: 'bottom', buildShift: { y: -47, height: -14 } },
    { id: 'back', role: 'link', name: 'Back to the board', box: 'height', origin: 'turn', originEdge: 'bottom', buildShift: { y: -47, height: -14 }, type: false },
  ],
};

export default manifest;
