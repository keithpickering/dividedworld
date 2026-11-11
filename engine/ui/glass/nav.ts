/**
 * Where the glass's menu bar goes (the glass plan, section 7, board 02; the alerts plan, Task 9): after Back to the board, Alerts, the
 * Vending Machine, My characters, Season (Rankings grown into the season page), My log, Guide, Updates and Settings, in that order, as the
 * alerts boards draw it.
 */
export interface GlassNav {
  /** The player's Alerts: what happened to their characters, and what is new in the game. */
  readonly alerts: string;
  readonly characters: string;
  /** The season page: Rankings and News. `/rankings` and `/standings` open it. */
  readonly season: string;
  readonly log: string;
  /** The Strategy Guide (the onboarding plan's Task 8); the welcome letter is its first section, so there is no Welcome tab. */
  readonly guide: string;
  readonly settings: string;
  readonly vending: string;
  /** The developer persona's Updates page. */
  readonly updates: string;
  /** The admin queue, whose tab only an admin sees. */
  readonly admin: string;
  /** The machine's admin page, reached from the queue by the admin pages' strip (engine/ui/admin/AdminPages.tsx). */
  readonly adminMachine: string;
  /** The dress-up page: the account's gear and one mask's outfit. No address names the mask. */
  readonly wardrobe: string;
}

export const GLASS_NAV: GlassNav = {
  alerts: '/alerts',
  vending: '/vending',
  characters: '/characters',
  season: '/season',
  log: '/log',
  guide: '/guide',
  settings: '/settings',
  updates: '/updates',
  admin: '/admin/queue',
  adminMachine: '/admin/machine',
  wardrobe: '/wardrobe',
};
