/**
 * Board 31, My log with a settlement's posts open (docs/research/2026-11-05-backfill/31-log-open.html, 1440 by 1000): Pipewrench's tab, the latest settlement's breakdown
 * shown under its row, every nested amount (each reason's total and each post's share) in the Aura column with the Wallet column left empty there. The build is the story
 * `Boards/12 Log` > `Open` (engine/ui/log/Log.board.stories.tsx). The page's head is held as board 30 holds it (`logHead`): the PageHead's 36px clearance, the tabs as buttons.
 *
 * What this board is held for is the columns: a nested amount's x is held (`box: 'position'`), so one in the Wallet column fails. The board draws no line under its table, so none is compared. The first reason's total stands at the board's
 * Aura x and so does the first post's share. Departures by decision: the build's Aura column is the table's own 110px where the board's nested grid draws 120, so a nested amount and the kind beside it stand 9.3px (the column's difference, less the skew) right of the board's, which a shift holds, and the settlement's own row carries Hide posts under its sentence where the board's is the same, and its
 * words are the instance's reason words ("stole the thunder", "shrugged off"); the nested rows' heights are the glass's body line (1.5) and the board draws 1.3 to 1.5, so what
 * stands under the first reason is held from the settlement row's Hide posts button, which is itself found and not placed: it stands under the settlement's sentence, which a narrower
 * word spacing sets in one line more or less (e2e/boards-wrap.spec.ts).
 */
import type { BoardManifest } from '../../board-match.ts';
import { logHead } from './30-log-empty.ts';

const manifest: BoardManifest = {
  board: '2026-11-05-backfill/31-log-open',
  size: { width: 1440, height: 1000 },
  build: { story: 'boards-12-log--open' },
  landmarks: [
    ...logHead('Pipewrench', ['ALL', 'PIPEWRENCH', 'MRS. HOOLIGAN', 'SPRITEY']),
    { id: 'row-what', role: 'text', name: 'Settlement', within: 'table', box: 'position', type: false },
    { id: 'row-aura', role: 'text', name: '+0.35', within: 'table', box: 'none', type: false },
    { id: 'row-wallet', role: 'text', name: '4.72', within: 'table', box: 'position', type: false },
    { id: 'hide', role: 'button', name: 'HIDE POSTS', buildName: 'Hide posts', within: 'table', box: 'none', type: false },
    { id: 'reason-1', role: 'text', name: "Drew heat: excited, negative reactions to the character's posts and cards", within: 'table', origin: 'hide', originEdge: 'bottom', box: 'position', type: false },
    { id: 'reason-1-amount', role: 'text', name: '+0.20', within: 'table', origin: 'hide', originEdge: 'bottom', box: 'position', type: false, buildShift: { x: 9.3 } },
    { id: 'share-1', role: 'text', name: 'your post #43', within: 'table', origin: 'hide', originEdge: 'bottom', box: 'position', type: false },
    { id: 'share-1-kind', role: 'text', name: 'HEAT', within: 'table', origin: 'hide', originEdge: 'bottom', box: 'position', type: false, buildShift: { x: 9.3 } },
  ],
};

export default manifest;
