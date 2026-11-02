/**
 * Where the glass's menu bar goes (the glass plan, section 7, board 02): My characters, Rankings,
 * My log and Settings, in that order after Back to the board. Updates (the alerts plan, Task 7) has its address here and joins the menu's order with the menu's own task. The Vending Machine is the bar's first
 * page after Back, as the boards draw it.
 */
export interface GlassNav {
  readonly characters: string;
  readonly rankings: string;
  readonly log: string;
  readonly settings: string;
  readonly vending: string;
  /** The developer persona's Updates page. */
  readonly updates: string;
  /** The admin queue, whose tab only an admin sees. */
  readonly admin: string;
}

export const GLASS_NAV: GlassNav = {
  vending: '/vending',
  characters: '/characters',
  rankings: '/rankings',
  log: '/log',
  settings: '/settings',
  updates: '/updates',
  admin: '/admin/queue',
};
