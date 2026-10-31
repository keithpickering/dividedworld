/**
 * The engine's duties: the work The System does, each assigned to a member of staff. The engine
 * knows the duties and their mode and default tier; which staff member does one is the instance's
 * to say (design, section 14), so reassigning a duty to a Mod Bot later changes no duty's work.
 */
import type { Tier } from './model.ts';

export const DUTIES = ['meeting', 'standingOrderLine', 'microEvent', 'renameJudge', 'appeal'] as const;
export type Duty = (typeof DUTIES)[number];

export interface DutySpec {
  readonly mode: 'chat' | 'completion';
  readonly tier: Tier;
}

/** The meeting runs on the stronger tier; micro-events, the rename judge and appeals on the light one; a standing order's line is the old voice. */
export const DUTY_SPECS: Readonly<Record<Duty, DutySpec>> = {
  meeting: { mode: 'chat', tier: 'strong' },
  standingOrderLine: { mode: 'completion', tier: 'light' },
  microEvent: { mode: 'chat', tier: 'light' },
  renameJudge: { mode: 'chat', tier: 'light' },
  appeal: { mode: 'chat', tier: 'light' },
};

/** The part of an instance `staffFor` reads: the staff key assigned to each duty. */
export interface Staffed {
  readonly system?: { readonly duties?: Partial<Record<Duty, string>> };
}

/** The staff key an instance assigns a duty; an unassigned duty throws, naming it, rather than falling to a default nobody chose. */
export function staffFor(duty: Duty, instance: Staffed): string {
  const key = instance.system?.duties?.[duty];
  if (!key) throw new Error(`the instance assigns no staff member to the duty ${duty}`);
  return key;
}
