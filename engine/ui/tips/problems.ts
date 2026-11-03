/**
 * What an instance's UI must fill exactly, checked beside `instanceProblems` (engine/rules/instance.ts), which checks its
 * rules: `onboarding.tips` has every tip key the engine knows and none it does not, each with a title and a line, and the
 * welcome letter is text. Pure, so the self-test can plant each defect; the build runs it against the real instance
 * (instances/divided-world/ui/index.test.tsx).
 */
import type { InstanceUi } from '../types.ts';
import { TIP_KEYS } from './keys.ts';

export function instanceUiProblems(ui: Pick<InstanceUi, 'onboarding'>): string[] {
  const out: string[] = [];
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
