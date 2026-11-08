/**
 * The bright ink in the thread's stylesheet (docs/plans/2026-11-08-brighter-effects-design.md, section 1): on a body that carries
 * `data-kb-bright-ink`, the four post inks, a quote's border and the text shadow come from the instance's two custom properties; anything
 * with a ground of its own (the reaction chips, the ORIGIN box, whatever the engine lifts over a post's ink) takes the board's four
 * inks back from the root's copies and drops the shadow. The copies live on the root, where the tokens resolve, so the body's override
 * of --kb-fg and the rest cannot reach them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//gu, '');
const thread = strip(fs.readFileSync(path.resolve(here, 'thread.css'), 'utf8'));
const tokens = strip(fs.readFileSync(path.resolve(here, '../tokens.css'), 'utf8'));
/* The declaration block of the rule whose selector list is exactly `selector`, or ''. */
const rule = (css: string, selector: string) => {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) if (m[1]!.trim().replace(/\s+/gu, ' ') === selector) return m[2]!;
  return '';
};
const SHADOW = '-1px -1px 0 var(--kb-bright-outline), 1px -1px 0 var(--kb-bright-outline), -1px 1px 0 var(--kb-bright-outline), 1px 1px 0 var(--kb-bright-outline), 0 0 3px var(--kb-bright-outline)';

describe('the bright ink', () => {
  test('the root keeps the board\'s four inks as var() of their tokens', () => {
    const root = rule(tokens, ':root');
    for (const [copy, token] of [['fg', 'fg'], ['link', 'link'], ['link-visited', 'link-visited'], ['muted', 'muted']]) {
      expect(root).toContain(`--kb-board-${copy}: var(--kb-${token});`);
    }
  });

  test('on the marked body the four inks, the quote border and the text shadow are the instance\'s', () => {
    const body = rule(thread, '.kb-act-main[data-kb-bright-ink]').replace(/\s+/gu, ' ');
    for (const ink of ['fg', 'link', 'link-visited', 'muted']) expect(body).toContain(`--kb-${ink}: var(--kb-bright-ink);`);
    expect(body).toContain('color: var(--kb-bright-ink);');
    expect(body).toContain(`text-shadow: ${SHADOW};`);
    expect(rule(thread, '.kb-act-main[data-kb-bright-ink] .kb-quote')).toMatch(/border-color:\s*var\(--kb-bright-ink\)/u);
  });

  test('what has a ground of its own takes the board\'s inks back and drops the shadow', () => {
    const own = rule(thread, '.kb-act-main[data-kb-bright-ink] :is(.kb-tally, .kb-origin, [data-kb-over-ink])').replace(/\s+/gu, ' ');
    for (const ink of ['fg', 'link', 'link-visited', 'muted']) expect(own, ink).toContain(`--kb-${ink}: var(--kb-board-${ink});`);
    expect(own).toContain('color: var(--kb-board-fg);');
    expect(own).toMatch(/text-shadow:\s*none;/u);
    expect(rule(thread, '.kb-act-main[data-kb-bright-ink] :is(.kb-tally, .kb-origin, [data-kb-over-ink]) .kb-quote')).toMatch(/border-color:\s*var\(--kb-rule\)/u);
  });

  test('the selectors name classes that exist', () => {
    const origin = fs.readFileSync(path.resolve(here, '../spin/spin.css'), 'utf8');
    expect(origin).toContain('.kb-origin {');
    expect(thread).toContain('.kb-tally {');
    expect(fs.readFileSync(path.resolve(here, '../reactions/Reactions.tsx'), 'utf8')).toContain('data-kb-over-ink');
  });
});
