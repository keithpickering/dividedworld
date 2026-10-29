/**
 * The accessibility check every story is held to (engine/ui/a11y.test.tsx) and its poisoned twin
 * (a11y.selftest.test.tsx) share this one function: axe-core with the WCAG 2.0, 2.1 and 2.2 A and
 * AA rules. jsdom has no layout and no painting, so axe's color-contrast rule cannot run here; the
 * colors are held by `contrast.ts` (the token pairs, in light and dark) and by the e2e pass in a
 * real browser (e2e/a11y.spec.ts), and the rule is switched off here rather than left to report
 * nothing.
 */
import axe from 'axe-core';

export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const;

export async function axeViolations(element: Element, options: { readonly contrast?: boolean } = {}): Promise<axe.Result[]> {
  const result = await axe.run(element, {
    runOnly: { type: 'tag', values: [...WCAG_TAGS] },
    rules: { 'color-contrast': { enabled: options.contrast === true } },
  });
  return result.violations;
}

/** A violation as one readable line, for an assertion message. */
export function describeViolations(violations: readonly axe.Result[]): string {
  return violations
    .map((v) => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.map((n) => `  ${n.target.join(' ')}  ${n.html.slice(0, 120)}`).join('\n')}`)
    .join('\n');
}
