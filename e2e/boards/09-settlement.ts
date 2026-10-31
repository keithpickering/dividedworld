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
 *  - The reason lines are one line each in the build where the board's sentences take two: the first is
 *    compared by position, and the two under it, which stand higher for it, by their words and type alone.
 *  - The headings and big figures are set with room in their own boxes, so the words lie inside the
 *    calm the `calmAll` surface puts them in (the rendered measurement holds it), which moves the
 *    heading and the figures a few pixels; they are compared by position or height where it shows.
 */
import type { BoardManifest } from '../board-match.ts';

const manifest: BoardManifest = {
  board: '09-settlement',
  size: { width: 1440, height: 960 },
  build: { moment: '09-settlement' },
  landmarks: [
    { id: 'when', role: 'text', name: 'Settled Oct 30 · 08:17 UTC' },
    { id: 'tabs', role: 'navigation', name: 'Your characters', type: false },
    { id: 'tab-pipewrench', role: 'link', buildRole: 'button', name: 'Pipewrench', within: 'tabs' },
    { id: 'tab-hooligan', role: 'link', buildRole: 'button', name: 'Mrs. Hooligan', within: 'tabs' },
    { id: 'tab-spritey', role: 'link', buildRole: 'button', name: 'Spritey', within: 'tabs' },
    { id: 'title', role: 'heading', name: 'While you were away', box: 'position' },

    { id: 'wallet', role: 'region', name: 'Wallet', type: false, box: 'position' },
    /* The board's img is the column's 640px row; the build's is the orbs' own, so its place is compared. */
    { id: 'orbs', role: 'img', name: 'Wallet now 3.72 of 6.00', buildName: 'Wallet now 4.72 of 6.00', within: 'wallet', type: false, box: 'position' },
    { id: 'was', role: 'text', name: '3.37 →', buildName: '4.37 →', within: 'wallet', box: 'position' },
    { id: 'now', role: 'text', name: '3.72', buildName: '4.72', within: 'wallet', box: 'position' },
    { id: 'change', role: 'text', name: '+0.35', within: 'wallet', box: 'position', type: false },
    { id: 'why', role: 'heading', name: 'Why, in plain words · scored as a Heel', within: 'wallet', box: 'position' },
    {
      id: 'line-heat', role: 'text', within: 'wallet', box: 'position',
      name: 'Drew heat: 6 heat reactions on 2 posts. The live estimate said up to +0.30; the shared vote and halving made it +0.20.',
      buildName: 'Drew heat: excited, negative reactions to its posts and cards',
    },
    {
      id: 'line-thunder', role: 'text', within: 'wallet', box: 'none',
      name: 'Stole thunder: your Whoops! on Spritey\'s post #41 drew more reactions than the post.',
      buildName: 'Stole the thunder: its Salty card on another\'s post drew more than the post',
    },
    {
      id: 'line-shrug', role: 'text', within: 'wallet', box: 'none',
      name: 'The polite shrug: 1 calm reaction on your post #43.',
      buildName: 'Shrugged off: calm, positive reactions to its posts and cards',
    },

    { id: 'rank', role: 'region', name: 'Rank up', type: false },
    { id: 'rank-label', role: 'text', name: 'New rank', within: 'rank' },
    { id: 'rank-was', role: 'text', name: 'Enhancement Talent', within: 'rank' },
    { id: 'rank-now', role: 'text', name: 'Midcarder', within: 'rank', type: false },
    { id: 'rank-pips', role: 'img', name: 'Rank: 3 of 6 pips', within: 'rank', type: false },
    { id: 'rank-words', role: 'text', name: 'Season standing 2.95 → 3.30. Every post of Pipewrench\'s now shows the new rank.', within: 'rank' },

    /* The Turn's sentence names the settlement's day (below), a line longer than the board's: the card is compared by position. */
    { id: 'turn', role: 'region', name: 'Turn', type: false, box: 'position' },
    { id: 'turn-was', role: 'text', name: 'Heel', within: 'turn' },
    { id: 'turn-now', role: 'text', name: 'Face', within: 'turn', type: false },
    {
      id: 'turn-words', role: 'text', within: 'turn', box: 'position',
      name: 'Pipewrench\'s Turn took effect. From today it scores as a Face. The System announced it, with the old class, in Season 1: Who Turned.',
      /* The summary opens on a later load too, and by its address, where "today" would be false: the settlement's own day is always true. */
      buildName: 'Pipewrench\'s Turn took effect. From the Oct 30 settlement it scores as a Face. The System announced it, with the old class, in Season 1: Who Turned.',
    },

    { id: 'log', role: 'link', name: 'Open my log' },
    { id: 'back', role: 'link', name: 'Back to the board' },
  ],
};

export default manifest;
