/**
 * Board 30, My log before anything has settled (docs/research/2026-11-05-backfill/30-log-empty.html, 1440 by 1000): Mrs. Hooligan's tab, the table keeping its head
 * and one row saying when the next settlement is ("Nothing yet", the board's "Nothing has settled for Mrs. Hooligan yet. Its first settlement, in 7 h 42 min, is the first line
 * here." in the build's truer words: a settlement writes a line only for a character it scored, so "A line comes here when a settlement scores it; the next is in 7 h 42 min."). The build is the story `Boards/12 Log` > `Empty` (engine/ui/log/Log.board.stories.tsx): the 12-log moment's characters with every line taken away and the next
 * settlement 7 h 42 min from when the story is drawn. The page's own parts are held as board 12 holds them (e2e/boards/12-log.ts): the menu bar's tabs are the alerts design's.
 *
 * Departures by decision (board 12's, which this board's page shares): the page head is a PageHead standing 36px clear, so the lead stands 19px and the table 22px lower than the
 * board draws them (the lead is 680px wide where the board draws 760); the tabs are GlassButtons, buttons and not links, 48px tall where the board's are 54 (held by y and height). Here also: the row's When is the next
 * settlement's own time, which the story sets from when it is drawn, so its words are not compared, only its place; the dash in the Wallet column is the board's.
 */
import type { BoardManifest, Landmark } from '../../board-match.ts';

/** How much lower the page head's 36px clearance stands what is under the title than the board draws it (board 12's). */
const LEAD = { y: 19 } as const;
const TABLE = { y: 22 } as const;

/** The title, tabs, lead and table head both log boards share, shifted as board 12's are. */
export const logHead = (name: string, tabs: readonly string[]): Landmark[] => [
  { id: 'title', role: 'heading', name: 'My log' },
  { id: 'tabs', role: 'tablist', name: 'Characters', buildRole: 'navigation', buildName: 'Whose log', box: 'height', buildShift: { y: 1, height: -6 }, type: false },
  ...tabs.map((t): Landmark => ({ id: `tab-${t}`, role: 'tab', buildRole: 'button', name: t, within: 'tabs', box: 'height', buildShift: { y: 1, height: -6 }, type: false })),
  { id: 'lead', role: 'text', box: 'position', buildShift: LEAD, name: "Everything on this page is true. Each line names the Act that did it, what it changed and how much Aura moved. It never says who reacted, or any character's class but your own." },
  { id: 'table', role: 'table', name: `${name}'s log`, buildName: `${name}'s log, newest first`, type: false, box: 'position', buildShift: TABLE },
  { id: 'head-when', role: 'text', name: 'When (UTC)', within: 'table', box: 'position', type: false, buildShift: TABLE },
  { id: 'head-what', role: 'text', name: 'What', within: 'table', box: 'position', type: false, buildShift: TABLE },
  { id: 'head-details', role: 'text', name: 'Details', within: 'table', box: 'position', type: false, buildShift: TABLE },
  { id: 'head-aura', role: 'text', name: 'Aura', within: 'table', box: 'none', type: false },
  { id: 'head-wallet', role: 'text', name: 'Wallet', within: 'table', box: 'none', type: false },
];

const manifest: BoardManifest = {
  board: '2026-11-05-backfill/30-log-empty',
  size: { width: 1440, height: 1000 },
  build: { story: 'boards-12-log--empty' },
  landmarks: [
    ...logHead('Mrs. Hooligan', ['ALL', 'PIPEWRENCH', 'MRS. HOOLIGAN', 'SPRITEY'].map((t) => t)),
    { id: 'row-what', role: 'text', name: 'Nothing yet', within: 'table', box: 'position', type: false, buildShift: { y: -30.5 } },
    {
      id: 'row-details', role: 'text', within: 'table', box: 'position', type: false, buildShift: { y: -12 },
      name: 'Nothing has settled for Mrs. Hooligan yet. Its first settlement, in 7 h 42 min, is the first line here.',
      buildName: 'Nothing has settled for Mrs. Hooligan yet. A line comes here when a settlement scores it; the next is in 7 h 42 min.',
    },
    { id: 'row-wallet', role: 'text', name: '—', within: 'table', box: 'none', type: false },
    { id: 'foot', role: 'text', name: 'If a line here looks wrong, that is a bug and not the game. Tell an admin.', box: 'none', type: false },
  ],
};

export default manifest;
