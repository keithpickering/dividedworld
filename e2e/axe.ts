import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';

/**
 * axe-core in the page, for the specs that read it (e2e/a11y.spec.ts, e2e/sound-settings.spec.ts). It lives here and not in a spec because a spec
 * that imports another spec runs all of its tests too. The caller sets `test.use({ bypassCSP: true })`: the site's policy (e2e/csp.spec.ts holds it)
 * would block the injected script and style.
 */
const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

interface Found { readonly id: string; readonly impact: string | null; readonly nodes: readonly { readonly target: unknown; readonly html: string }[] }

export async function pageViolations(page: Page): Promise<string[]> {
  /* Each smoke layer is a full-rect div with a translucent background color, and its shape is only a mask-image, which axe
     cannot see: it reads the layer as a solid fill under the text and fails contrast the player never sees (the old SVG smoke
     was an unknown background to it). Only the layers' container is hidden. Text over the smoke is held by
     tools/check-glass-contrast.mjs (every recipe's layers at full noise against every text token) and e2e/glass-text.spec.ts
     (the rendered text, measured). */
  await page.addStyleTag({ content: '.kb-smoke-layers { display: none !important; }' });
  await page.addScriptTag({ path: axePath });
  const found = await page.evaluate(async (tags) => {
    const axe = (window as unknown as { axe: { run(c: unknown, o: unknown): Promise<{ violations: Found[] }> } }).axe;
    return (await axe.run(document, { runOnly: { type: 'tag', values: tags } })).violations;
  }, TAGS);
  /* The page's own scroll is the viewport's, which every browser scrolls from the keyboard: base.css keeps the body's scrollbar on so screens do not jump,
     and axe reads that body as a scrollable region with nothing focusable in it on a screen that has no control (a sheet of cards). Only the body or
     the root itself is let go; a scroller inside the page that no key reaches is still found. */
  const kept = found.map((v) => v.id === 'scrollable-region-focusable'
    ? { ...v, nodes: v.nodes.filter((n) => !(Array.isArray(n.target) && n.target.length === 1 && (n.target[0] === 'body' || n.target[0] === 'html'))) }
    : v).filter((v) => v.nodes.length > 0);
  return kept.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 12).map((n) => `${JSON.stringify(n.target)} ${n.html.slice(0, 100)}`).join(' | ')}`);
}
