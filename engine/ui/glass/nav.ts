/**
 * Where the glass's menu bar goes (the glass plan, section 7, board 02): My characters, Rankings,
 * My log and Settings, in that order after Back to the board. My log has no screen of its own until
 * the glass build's Part 4, so it stands in on the standings, which carry the player's own Aura
 * today. The Vending Machine is the bar's first page after Back, as the boards draw it.
 */
export interface GlassNav {
  readonly characters: string;
  readonly rankings: string;
  readonly log: string;
  readonly settings: string;
  readonly vending: string;
}

export const GLASS_NAV: GlassNav = {
  vending: '/vending',
  characters: '/characters',
  rankings: '/rankings',
  log: '/standings',
  settings: '/settings',
};
