/**
 * Board 17, the front door (docs/research/2026-11-05-backfill/17-front-door.html, 1440 by 1000): the board world's sample thread above, which is #224's
 * and not compared here, and the signed-out HUD docked under it, as the story `Boards/00 Front door` (engine/ui/front-door/FrontDoor.board.stories.tsx)
 * draws it. Only the HUD is compared (the design's section 2): it is the signed-in HUD's own frame, so the door previews the game it opens onto: the
 * "?" in the mask panel with "Who will you play as?" and the pitch, the Aura notch with its six empty sockets and its line, and Sign in (secondary) and
 * Register with an invite (primary) as one row, "No invite? Ask someone who plays." under it. The sockets are decoration (`aria-hidden`), so they are
 * not landmarks.
 *
 * The board draws the HUD 190px tall, where the signed-in HUD's board (01-main) draws it 212, and docks it at the window's foot: its top is 22px
 * lower on the board than in the build, so the HUD is compared across, and every part from the HUD's own top-left corner (`origin`).
 *
 * Departures: the pitch is 20px where the board draws 19, which is under the glass's smallest size (its label step), so it is compared by its place
 * and its type is the build's by decision; the AURA label is the signed-in HUD's own (700, as board 01-main draws it) where this board draws 800,
 * and the line under it and the note stand on the line height the build gives its labels (29px to the board's 24), so their boxes are compared by
 * place; and Sign in and Register are GlassButtons, 48px tall where the board's are 54, at the glass's own width, so each is compared by its y and
 * height.
 *
 * Departures by the owner's copy (instances/divided-world/ui/front-door.ts, 2026-11-08): the prompt reads "Who will you play?" where the board draws "Who will you
 * play as?", and the pitch is the one line "Divided World: a kayfabe social deduction game disguised as a 2003 message board" where the board draws the mask line; each is found
 * by the build's words (`buildName`) and compared by place, as the pitch always was (the prompt's shorter words make it narrower).
 */
import type { BoardManifest } from '../../board-match.ts';

const manifest: BoardManifest = {
  board: '2026-11-05-backfill/17-front-door',
  size: { width: 1440, height: 1000 },
  build: { story: 'boards-00-front-door--front-door' },
  landmarks: [
    { id: 'hud', role: 'region', name: 'Game HUD', type: false, box: 'across' },
    { id: 'mark', role: 'text', name: '?', within: 'hud', origin: 'hud' },
    { id: 'prompt', role: 'heading', name: 'WHO WILL YOU PLAY AS?', buildName: 'WHO WILL YOU PLAY?', within: 'hud', origin: 'hud', box: 'position' },
    { id: 'pitch', role: 'text', name: 'A message board where everyone wears a mask, and everyone is someone you know.', buildName: 'Divided World: a kayfabe social deduction game disguised as a 2003 message board', within: 'hud', origin: 'hud', box: 'position', buildSize: 20 },
    { id: 'aura', role: 'text', name: 'AURA', within: 'hud', origin: 'hud', box: 'position', type: false },
    { id: 'notch-line', role: 'text', name: 'No mask, no Aura, no hand yet. Your first character fills them.', within: 'hud', origin: 'hud', box: 'position' },
    { id: 'sign-in', role: 'link', name: 'SIGN IN', within: 'hud', origin: 'hud', box: 'height', buildShift: { height: -6 } },
    { id: 'register', role: 'link', name: 'REGISTER WITH AN INVITE', within: 'hud', origin: 'hud', box: 'height', buildShift: { height: -6 } },
    { id: 'no-invite', role: 'text', name: 'No invite? Ask someone who plays.', within: 'hud', origin: 'hud', box: 'position' },
  ],
};

export default manifest;
