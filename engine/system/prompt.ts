/**
 * A persona's system prompt, assembled for the office it holds (the FanGaME design, section 5). A persona writes only who it is
 * (`selfPrompt`) and, if it likes, a line for an office (`officeLines`); the instance writes what each office is (`offices`: a
 * premise and the answer rules). The engine sets the one in the frame of the other, so a persona never carries a premise that is
 * wrong for the office it holds now: a Boss benched to a member is told it holds no office, not that it is the Boss.
 *
 * Pure: nothing here calls a model, and the engine knows no instance.
 */
import type { Persona, SystemContent } from '../rules/types.ts';
import type { PostingOffice } from './pool.ts';

/** The office's premise, the persona's own words, its line for this office only (if it has one), then the office's answer rules, joined by blank lines. */
export function personaPrompt(system: Pick<SystemContent, 'offices'>, persona: Pick<Persona, 'selfPrompt' | 'officeLines'>, office: PostingOffice): string {
  const frame = system.offices[office];
  const line = persona.officeLines?.[office];
  return [frame.premise, persona.selfPrompt, ...(line !== undefined ? [line] : []), frame.answerRules].join('\n\n');
}
