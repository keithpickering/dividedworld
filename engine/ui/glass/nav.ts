/**
 * Where the glass's menu bar goes (the glass plan, section 7, board 02): My characters, Rankings,
 * My log and Settings, in that order after Back to the board. Rankings and My log have no screen of
 * their own until the glass build's Part 3, so both stand in on the standings, which carry the
 * rankings and the player's own Aura today. The Vending Machine joins the bar with its screen.
 */
export interface GlassNav {
  readonly characters: string;
  readonly rankings: string;
  readonly log: string;
  readonly settings: string;
  readonly vending?: string;
}

export const GLASS_NAV: GlassNav = {
  characters: '/characters',
  rankings: '/standings',
  log: '/standings',
  settings: '/settings',
};
