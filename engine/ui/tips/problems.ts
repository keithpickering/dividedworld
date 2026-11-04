/**
 * What an instance's UI must fill exactly, checked beside `instanceProblems` (engine/rules/instance.ts), which checks its
 * rules: `onboarding.tips` has every tip key the engine knows and none it does not, each with a title and a line, and the
 * welcome letter is text; `copy.marquees`, when given, is a non-empty list of names of 1 to 20 characters. Pure, so the self-test can plant each defect; the build runs it against the real instance
 * (instances/divided-world/ui/index.test.tsx).
 */
import type { InstanceUi } from '../types.ts';
import { TIP_KEYS } from './keys.ts';

/** The longest a marquee name may be: the sign's width at 390px. */
export const MARQUEE_MAX = 20;

export function instanceUiProblems(ui: Pick<InstanceUi, 'onboarding' | 'copy'>): string[] {
  const out: string[] = [];
  const marquees: unknown = ui.copy?.marquees;
  if (marquees !== undefined) {
    if (!Array.isArray(marquees) || marquees.length === 0) out.push('the copy has a marquees list with nothing in it');
    else {
      marquees.forEach((m: unknown, i) => {
        if (typeof m !== 'string' || m.trim() === '') out.push(`the marquee ${i + 1} is empty`);
        else if (m.length > MARQUEE_MAX) out.push(`the marquee "${m}" is ${m.length} characters, over the ${MARQUEE_MAX} the sign holds`);
      });
    }
  }
  const on = ui.onboarding;
  if (typeof on !== 'object' || on === null) return ['the instance UI has no onboarding'];
  const tips: Record<string, { title?: unknown; line?: unknown } | undefined> = on.tips ?? {};
  for (const key of TIP_KEYS) {
    const tip = tips[key];
    if (tip === undefined) out.push(`the onboarding has no tip "${key}"`);
    else {
      if (typeof tip.title !== 'string' || tip.title.trim() === '') out.push(`the tip "${key}" has no title`);
      if (typeof tip.line !== 'string' || tip.line.trim() === '') out.push(`the tip "${key}" has no line`);
    }
  }
  for (const key of Object.keys(tips)) if (!(TIP_KEYS as readonly string[]).includes(key)) out.push(`the onboarding has a tip "${key}", which is not one of the engine's tips`);
  if (typeof on.letter !== 'string' || on.letter.trim() === '') out.push('the onboarding has no letter');
  return out;
}
