/**
 * Board 04, the Orbs board (docs/research/2026-10-29-two-worlds/04-orbs.html, 1440 by 900): the
 * orbs in every state, laid out as a specimen. The build side is its story,
 * engine/ui/orbs/Orbs.board.stories.tsx, opened through the end-to-end build's story route. The
 * glass plan's section 7 lists what is compared: each state's orb row by its name, in web Task 3's
 * wording (fill.ts's walletName, the HUD's own), and the legends' type: the heading and its
 * eyebrow, the anatomy's terms, the states' headings and the cascade's head, steps and link.
 *
 * Not compared: the orbs' pixels (each row's box is), the anatomy's big orb and the cascade's
 * frames, which the board draws with no role and the build keeps out of the reading order, and the
 * states' sentences, whose first text is each state's figure.
 */
import type { BoardManifest } from '../board-match.ts';

const manifest: BoardManifest = {
  board: '04-orbs',
  size: { width: 1440, height: 900 },
  build: { story: 'boards-04-orbs--board' },
  landmarks: [
    { id: 'eyebrow', role: 'text', name: 'The wallet · live' },
    /* Drawn in outline, a stroke with no fill: there is no opaque color to compare, so its box says its size. */
    { id: 'title', role: 'heading', name: 'Aura', type: false },

    /* The anatomy's terms and the first one's words; "Ghost" is the first of two (the term, then the state's heading). */
    { id: 'term-glass', role: 'text', name: 'Glass' },
    { id: 'term-glass-says', role: 'text', name: 'Empty orb, room left.' },
    { id: 'term-ghost', role: 'text', name: 'Ghost', nth: 0 },
    { id: 'term-pale', role: 'text', name: 'Pale band' },
    { id: 'term-solid', role: 'text', name: 'Solid' },

    /* The four states: each heading, and its orb row by its name. */
    { id: 'settled', role: 'heading', name: 'Settled' },
    { id: 'settled-orbs', role: 'img', name: '4.62 of 6.00 settled', buildName: 'Wallet 4.62 of 6 orbs', type: false },
    { id: 'ghost', role: 'heading', name: 'Ghost' },
    { id: 'ghost-orbs', role: 'img', name: '4.62 settled, about 0.30 more estimated', buildName: 'Wallet 4.62 of 6 orbs, 0.30 pending until the next settlement (estimate)', type: false },
    { id: 'drained', role: 'heading', name: 'Drained' },
    { id: 'drained-orbs', role: 'img', name: '4.62 settled, about 0.40 drained', buildName: 'Wallet 4.62 of 6 orbs, 0.40 to be lost at the next settlement (estimate)', type: false },
    { id: 'over', role: 'heading', name: 'Past the cap' },
    { id: 'over-orbs', role: 'img', name: '6.00 of 6.00, 0.40 past the cap', buildName: 'Wallet 6.00 of 6 orbs, 0.40 pending until the next settlement (estimate), 0.40 past the cap', type: false },

    /* The settlement cascade: its panel, its head and the four steps' captions, and the way to the log. */
    { id: 'cascade', role: 'region', name: 'The settlement cascade', type: false },
    { id: 'cascade-title', role: 'heading', name: 'The settlement', within: 'cascade' },
    { id: 'cascade-says', role: 'text', name: 'Daily at 08:17 UTC. Orb by orb, the ghost turns solid: a flash, then a shine.', within: 'cascade' },
    { id: 'step-1', role: 'text', name: '1 · Ghost waits', within: 'cascade' },
    { id: 'step-2', role: 'text', name: '2 · Flash', within: 'cascade' },
    { id: 'step-3', role: 'text', name: '3 · Shine', within: 'cascade' },
    { id: 'step-4', role: 'text', name: '4 · Settled', within: 'cascade' },
    { id: 'log', role: 'link', name: 'See what earned it in your log', within: 'cascade' },
  ],
};

export default manifest;
