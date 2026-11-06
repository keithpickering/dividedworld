/**
 * Board 35, the HUD past its cap (docs/research/2026-11-05-backfill/35-hud-cap.html, 1440 by 230): the signed-in HUD alone, its wallet full and its estimate
 * wholly past the cap, as the story `Boards/00 HUD past the cap` (engine/ui/frame/Hud.board.stories.tsx) draws it. The backfill design's section 7 and the
 * plan's Task 11 list what is compared: the Aura notch, which says the figure once ("+0.85 EST. PAST THE CAP", not "+0.85 EST." beside "+0.85 past the cap")
 * and the way out under it, the orbs' own words ("Spend some before the settlement, or it won't fit."). The mask plate, the clock, Menu and the hand are
 * the signed-in HUD's own and are held by boards 01-main and 02-phone.
 *
 * The board draws the HUD 210px tall, docked at the window's foot, where the build's is the signed-in HUD's own height: every part is compared from the HUD's
 * own top-left corner (`origin`). The phone's drawing (board 36's third screen) is this module's `phone` side.
 */
import type { BoardManifest } from '../../board-match.ts';

const manifest: BoardManifest = {
  board: '2026-11-05-backfill/35-hud-cap',
  size: { width: 1440, height: 230 },
  build: { story: 'boards-00-hud-past-the-cap--past-the-cap' },
  landmarks: [
    { id: 'hud', role: 'region', name: 'Game HUD', type: false, box: 'across' },
    { id: 'aura', role: 'text', name: 'AURA', within: 'hud', origin: 'hud', box: 'position', type: false },
    { id: 'figure-cap', role: 'text', name: '/ 6.00', within: 'hud', origin: 'hud', box: 'position', type: false, buildShift: { x: -16 } },
    { id: 'over', role: 'text', name: '+0.85 EST. PAST THE CAP', buildName: '+0.85 est. past the cap', within: 'hud', origin: 'hud', box: 'position', type: false, buildShift: { y: 16 } },
    { id: 'way', role: 'text', name: "Spend some before the settlement, or it won't fit.", within: 'hud', origin: 'hud', box: 'position', type: false },
  ],
};

export default manifest;
