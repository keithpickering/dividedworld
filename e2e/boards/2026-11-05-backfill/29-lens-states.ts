/**
 * Board 29, the Lens's two other states (docs/research/2026-11-05-backfill/29-lens-states.html, 1000 by 800): two panels alone on the board's ground, the Lens on
 * Stick Around (a reader held on the post) and the author's Lens on Whoops!, whose tools stand as one row with Hold to scrub under "Your tools, as the author". The
 * board draws them "at the size 28-lens.html docks them" (460 wide, 764 tall), so the build is opened at 1440 by 1000, where the dock is that size, and not at the
 * board's 1000 by 800 (a window that narrow docks a 360px panel, which is the dock's rule and not what the board draws). Each panel is compared from its own corner
 * only (`origin`): the board's two panels stand at x = 24 and 524 where the dock is at the window's right edge. The first build side is Stick Around's story, and the board's
 * first panel; the second is the author's Whoops! story, and the board's second. How the two boards divide the Lens is board 28's header.
 *
 * The departures are board 28's (its header): the panel 8px shorter, the headline a paragraph in the glass's type with the story's own percent, the Close 52px, type
 * not compared. The board's three tools wrap to two rows in its 460px panel (Write in ink alone on the second), where the plan sets them as one row, so
 * Write in ink is found but its place is not compared; and the author's panel's play (the board's plate has a note line and a wrapped name) is held by its buttons from the message's
 * bottom edge. Stick Around's story has Whoops! first and Stick Around second in billing, as the board's tabs have them.
 */
import type { BoardManifest } from '../../board-match.ts';
import { dialog, part } from './28-lens.ts';

const under = (of: string) => ({ origin: of, originEdge: 'bottom' }) as const;

const manifest: BoardManifest = {
  board: '2026-11-05-backfill/29-lens-states',
  size: { width: 1440, height: 1000 },
  build: { story: 'boards-01-lens--lens-stick-around-who' },
  landmarks: [
    dialog({ nth: 0, buildNth: 0 }),
    part('tab-whoops', 'tab', 'WHOOPS!', { box: 'position' }),
    part('tab-stick-around', 'tab', 'STICK AROUND', { box: 'position' }),
    part('close', 'button', 'Close', { box: 'position' }),
    part('headline', 'text', 'Holding you on this post', { box: 'position', buildShift: { y: -18.5 } }),
    part('ends', 'text', "Ends when you check the caster's sentence, scroll past either end of the post, or press Break free.", { box: 'position', buildShift: { y: -30 } }),
    part('fold', 'button', '1 play · Professor Hootenanny McGillicuddy III', { ...under('ends'), box: 'position', buildShift: { y: -14 } }),
    part('message', 'text', '“required reading”', { ...under('fold'), box: 'none' }),
    part('react', 'button', '+ REACT', { buildName: 'React', ...under('message'), box: 'position' }),
    part('spin', 'button', 'SPIN THREAD', { ...under('message'), box: 'position' }),
  ],
  also: [
    {
      name: "The author's Lens on Whoops!",
      build: { story: 'boards-01-lens--lens-author-whoops-who' },
      landmarks: [
        dialog({ nth: 1, buildNth: 0 }),
        part('tab-whoops', 'tab', 'WHOOPS!', { box: 'full' }),
        part('tab-stick-around', 'tab', 'STICK AROUND', { box: 'position' }),
        part('headline', 'text', '41% washed for you', { buildName: '32% washed for you', box: 'position', buildShift: { y: -18.5 } }),
        part('ends', 'text', 'Ends on your screen when you scrub every layer off. As its author, you can wash it for everyone.', { box: 'position', buildShift: { y: -30 } }),
        part('tools', 'text', 'YOUR TOOLS, AS THE AUTHOR', { buildName: 'Your tools, as the author', ...under('ends'), box: 'position' }),
        part('hold', 'button', 'HOLD TO SCRUB', { buildName: 'Hold to scrub', ...under('tools'), box: 'position' }),
        part('wash', 'button', 'WASH', { buildName: 'Wash', ...under('tools'), box: 'position' }),
        part('ink', 'button', 'WRITE IN INK', { buildName: 'Write in ink', ...under('tools'), box: 'none' }),
      ],
    },
  ],
};

export default manifest;
