/**
 * Board 21, the tour's tip (docs/research/2026-11-05-backfill/21-spotlight.html, 1440 by 1000): step 2 of the HUD tour, as the story
 * `Boards/14 Tips`, Tour orbs (engine/ui/tips/Tips.board.stories.tsx) draws it. Compared: the tip's dialog, its title and kicker, its words,
 * its step ("2 of 3") and its two buttons. The dim's blur, the tip's ground and violet edge and the arrow meeting the tip are what the board
 * match's boxes cannot see, and are held by e2e/onboarding-polish.spec.ts.
 *
 * Departures: the tip stands where its target puts it (26px above the HUD's orbs, which are where the build's HUD has them), 16px lower than the board
 * draws it, and is 14px shorter (its padding is 22px and 20px where the board draws 26 and 22, its title is the glass's 34px in the bright white, where the board draws 36 in the text color, so its type is not compared); the board's kicker
 * carries the step ("GABE · THE HUD, 2 OF 3") in the violet, where the build's says "Gabe" in the pale and puts "2 of 3" with its pips on the
 * buttons' row, so the kicker is compared by its place; the board's title is not a heading (the build's is); and the words and the buttons are the
 * glass's own weights and sizes (600 and 20px, where the board draws 500 and 21), so their type is not compared, and the buttons, 12px higher for the
 * tip's shorter body, by their y and height.
 *
 * The words are the owner's new Orbs tip (docs/plans/2026-11-21-gabes-voice-plan.md, Task 7), longer than the board's: the tip is 16.25px taller
 * than the board's (not 14px shorter) and stands 15px higher (not 16px lower), and the buttons stand 18.25px lower in it, and the words are compared by their place, being 27px taller (not 12px higher), each as the run
 * measured; the words are named by `buildName`, the whole paragraph as the build renders it.
 */
import type { BoardManifest } from '../../board-match.ts';

const manifest: BoardManifest = {
  board: '2026-11-05-backfill/21-spotlight',
  size: { width: 1440, height: 1000 },
  build: { story: 'boards-14-tips--tour-orbs' },
  landmarks: [
    { id: 'tip', role: 'dialog', name: 'THESE ARE YOUR ORBS', type: false, buildShift: { y: -15, height: 16.25 } },
    { id: 'title', role: 'text', buildRole: 'heading', name: 'THESE ARE YOUR ORBS', within: 'tip', origin: 'tip', box: 'position', type: false },
    { id: 'kicker', role: 'text', name: 'GABE · THE HUD, 2 OF 3', buildName: 'Gabe', within: 'tip', origin: 'tip', type: false, box: 'position' },
    { id: 'line', role: 'text', name: 'Reactions to your characters fill them at the settlement. Until then, hatched fill shows where you\'re headed. There is a most you can hold, so spend it.', buildName: 'Aura lands here at each settlement: from reactions to your characters, and from reacting to other players\' posts and cards. Until then, hatched fill shows where you\'re headed. There\'s a most you can hold, so spend it. I would.', within: 'tip', origin: 'tip', box: 'position', type: false },
    { id: 'skip', role: 'button', name: 'SKIP ALL TIPS', within: 'tip', origin: 'tip', box: 'height', type: false, buildShift: { y: 18.25 } },
    { id: 'got-it', role: 'button', name: 'GOT IT', within: 'tip', origin: 'tip', box: 'height', type: false, buildShift: { y: 18.25 } },
  ],
};

export default manifest;
