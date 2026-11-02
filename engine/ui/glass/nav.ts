/**
 * Where the glass's menu bar goes (the glass plan, section 7, board 02; the alerts plan, Task 9): after Back to the board, Alerts, the
 * Vending Machine, My characters, Season (Rankings grown into the season page), My log, Updates and Settings, in that order, as the
 * alerts boards draw it.
 */
export interface GlassNav {
  /** The player's Alerts: what happened to their characters, and what is new in the game. */
  readonly alerts: string;
  readonly characters: string;
  /** The season page: Rankings and News. `/rankings` and `/standings` open it. */
  readonly season: string;
  readonly log: string;
  readonly settings: string;
  readonly vending: string;
  /** The developer persona's Updates page. */
  readonly updates: string;
  /** The admin queue, whose tab only an admin sees. */
  readonly admin: string;
}

export const GLASS_NAV: GlassNav = {
  alerts: '/alerts',
  vending: '/vending',
  characters: '/characters',
  season: '/season',
  log: '/log',
  settings: '/settings',
  updates: '/updates',
  admin: '/admin/queue',
};
