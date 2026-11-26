/**
 * The engine's duties: the work The System does, each assigned to a member of staff. The engine
 * knows the duties and their mode and default tier; which staff member does one is the instance's
 * to say (design, section 14), so reassigning a duty to a Mod Bot later changes no duty's work.
 */
import type { DutyAssignee, SystemContent } from '../rules/types.ts';
import type { Tier } from './model.ts';

export const DUTIES = ['meeting', 'standingOrderLine', 'microEvent', 'renameJudge', 'appeal', 'chatter', 'filing', 'reportJudge', 'patrolJudge', 'apologyJudge', 'conversation', 'roster', 'quizQuestion'] as const;
export type Duty = (typeof DUTIES)[number];

export interface DutySpec {
  readonly mode: 'chat' | 'completion';
  readonly tier: Tier;
}

/** The meeting runs on the stronger tier; micro-events, the rename judge, appeals and the pool's chatter on the light one; an owed line is a chat call too (the old voice is asked in raw completion). */
export const DUTY_SPECS: Readonly<Record<Duty, DutySpec>> = {
  meeting: { mode: 'chat', tier: 'strong' },
  // An owed line (the persona-lines plan): a chat call, light tier. A persona on the old voice is asked in raw completion, as a filing is (`owedLineCompletion`).
  standingOrderLine: { mode: 'chat', tier: 'light' },
  microEvent: { mode: 'chat', tier: 'light' },
  renameJudge: { mode: 'chat', tier: 'light' },
  appeal: { mode: 'chat', tier: 'light' },
  // A pool post (the staff roster plan, Task 10): chat for a persona whose voice is `chat`, a raw completion for one whose voice is the old voice (which answers its words alone). Always the light tier.
  chatter: { mode: 'chat', tier: 'light' },
  // The Mod Bots' calls (the Mod Bots design, sections 6 to 8). A visit's filing line is a chat call for a persona on the chat voice and a raw completion for one on the old voice (its move,
  // where it has an allowance, is then a chat call); a report's verdict and a patrol's finding are chat calls. Always the light tier.
  filing: { mode: 'chat', tier: 'light' },
  reportJudge: { mode: 'chat', tier: 'light' },
  patrolJudge: { mode: 'chat', tier: 'light' },
  // An apology's verdict (member groups design): a chat call by the staff member who made the move. Always the light tier.
  apologyJudge: { mode: 'chat', tier: 'light' },
  // A persona's turn (the chattier staff design, section 3): a chat call for a persona on the chat voice and a raw completion for one on the old voice, answering the replies waiting on its posts.
  // A duty of its own, so the ledger prices a week of turns beside the pool's picks and the meeting. Always the light tier.
  conversation: { mode: 'chat', tier: 'light' },
  // The Roster Report's commentary (the staff-board threads plan, Task 7): one chat call a settlement, in the Boss's voice, given the day's public list and nothing else. Always the light tier.
  roster: { mode: 'chat', tier: 'light' },
  // A quiz visit's question (the written quiz design, section 3): one chat call a visit, by the visit's own Mod in its voice, given only what every reader sees. Always the light tier.
  quizQuestion: { mode: 'chat', tier: 'light' },
};

/**
 * The assignment an instance makes for a duty: `boss` (the season's Boss), `beat` (the bot on the board's beat),
 * `filer` (the bot that filed), or a staff key. Resolving it to a character is the caller's, who knows the season
 * and the board; this returns the instance's word as it stands. An unassigned duty throws, naming it, rather than
 * falling to a default nobody chose.
 */
export function staffFor(duty: Duty, instance: { readonly system?: Pick<SystemContent, 'duties'> }): DutyAssignee {
  const key = instance.system?.duties?.[duty];
  if (!key) throw new Error(`the instance assigns no staff member to the duty ${duty}`);
  return key;
}
