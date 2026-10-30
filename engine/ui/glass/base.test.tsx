/**
 * The glass's shapes (docs/plans/2026-10-30-glass-to-the-boards-plan.md, section 5), pinned in the
 * stylesheet. jsdom paints no clip-path, so these read base.css as text: the shape tokens, each cut
 * class's polygon, the HUD tab's four points, and the upright inner element. What a shape looks
 * like is the boards' comparison (Part 2); what its name and geometry are is this file's.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'base.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The declarations of the one rule whose selector is exactly `selector`, whitespace squashed. */
function rule(selector: string): string {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1]!.split(',').map(squash).includes(selector)) out.push(squash(m[2]!));
  }
  if (out.length === 0) throw new Error(`base.css has no rule for ${selector}`);
  return out.join(' ');
}
const decl = (selector: string, prop: string): string | undefined =>
  rule(selector).split(';').map((d) => d.trim()).find((d) => d.startsWith(`${prop}:`))?.slice(prop.length + 1).trim();

describe('the shape tokens', () => {
  it.each([
    ['--kb-glass-skew', '-10deg'], ['--kb-glass-skew-tag', '-12deg'],
    ['--kb-glass-chamfer-1', '16px'], ['--kb-glass-chamfer-2', '20px'], ['--kb-glass-chamfer-3', '24px'],
    ['--kb-glass-chamfer-4', '34px'], ['--kb-glass-chamfer-5', '40px'],
  ])('%s is %s', (name, value) => {
    expect(decl(':root', name)).toBe(value);
  });
});

describe('the cuts', () => {
  const c = 'var(--kb-cut)';
  const ci = 'var(--kb-cut-in)';
  const poly = (...pts: string[]) => `polygon(${pts.join(', ')})`;
  const outer = {
    'kb-glass-cut-panel': poly('0 0', `calc(100% - ${c}) 0`, `100% ${c}`, '100% 100%', '0 100%'),
    'kb-glass-cut-dialog': poly('0 0', `calc(100% - ${c}) 0`, `100% ${c}`, '100% 100%', `${c} 100%`, `0 calc(100% - ${c})`),
    'kb-glass-cut-button': poly('0 0', '100% 0', `100% calc(100% - ${c})`, `calc(100% - ${c}) 100%`, '0 100%'),
  } as const;
  const inner = {
    'kb-glass-cut-panel': poly('0 0', `calc(100% - ${ci}) 0`, `100% ${ci}`, '100% 100%', '0 100%'),
    'kb-glass-cut-dialog': poly('0 0', `calc(100% - ${ci}) 0`, `100% ${ci}`, '100% 100%', `${ci} 100%`, `0 calc(100% - ${ci})`),
    'kb-glass-cut-button': poly('0 0', '100% 0', `100% calc(100% - ${ci})`, `calc(100% - ${ci}) 100%`, '0 100%'),
  } as const;

  for (const cls of Object.keys(outer) as (keyof typeof outer)[]) {
    it(`.${cls} cuts only its own corners`, () => {
      expect(decl(`.${cls}`, 'clip-path')).toBe(outer[cls]);
    });
    it(`.${cls} draws its border on the cut: an inner element one border in, cut by the same polygon`, () => {
      expect(decl(`.${cls}::after`, 'clip-path')).toBe(inner[cls]);
      expect(decl(`.${cls}::after`, 'inset')).toBe('var(--kb-border)');
    });
  }

  it('a cut is the third chamfer step unless the component sets another, and the inner cut allows for the border', () => {
    expect(decl('.kb-glass-cut-panel', '--kb-cut')).toBe('var(--kb-glass-chamfer-3)');
    expect(decl('.kb-glass-cut-panel', '--kb-cut-in')).toBe('calc(var(--kb-cut) - var(--kb-border) * 0.5858)');
  });

  it('the old ad hoc shapes are gone', () => {
    expect(css).not.toMatch(/kb-glass-chamfer\b(?!-)/);
    expect(css).not.toMatch(/\.kb-glass-tab\b/);
  });
});

describe('the HUD tab', () => {
  it('is the plan\'s polygon, its four points set by the aura block\'s position', () => {
    expect(decl('.kb-glass-hud-tab', 'clip-path')).toBe(
      'polygon(0 24px, var(--tab-a) 24px, var(--tab-b) 0, var(--tab-c) 0, var(--tab-d) 24px, 100% 24px, 100% 100%, 0 100%)',
    );
  });

  it('draws the seam twice: the neon glow under a blur, then the pale core', () => {
    expect(decl('.kb-glass-seam-glow', 'stroke')).toBe('var(--kb-glass-neon)');
    expect(decl('.kb-glass-seam-glow', 'stroke-width')).toBe('6');
    expect(decl('.kb-glass-seam-glow', 'opacity')).toBe('0.7');
    expect(decl('.kb-glass-seam-glow', 'filter')).toBe('blur(4px)');
    expect(decl('.kb-glass-seam-core', 'stroke')).toBe('var(--kb-glass-pale)');
    expect(decl('.kb-glass-seam-core', 'stroke-width')).toBe('1.5');
  });
});

describe('the smoke\'s drift', () => {
  const strip = '.kb-smoke-strip[data-kb-drift]';
  it('moves only the drifting strip, on its own layer', () => {
    expect(decl(strip, 'will-change')).toBe('transform');
    expect(decl(strip, 'animation')).toMatch(/^kb-smoke-drift var\(--kb-smoke-seconds\)/);
  });
  it('stops under the device\'s reduced motion unless the player chose full, and under the player\'s reduce', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*:root:not\(\[data-kb-motion='full'\]\) \.kb-smoke-strip\[data-kb-drift\] \{ animation: none; \}/);
    expect(rule(`:root[data-kb-motion='reduce'] ${strip}`)).toBe('animation: none;');
  });
});

describe('the skew', () => {
  it('skews buttons, tabs and plates by the skew token, and tags by the tag token', () => {
    expect(decl('.kb-glass-skew', 'transform')).toBe('skewX(var(--kb-glass-skew))');
    expect(decl('.kb-glass-skew-tag', 'transform')).toBe('skewX(var(--kb-glass-skew-tag))');
  });

  it('sets the text inside upright by the opposite skew on an inner element', () => {
    expect(decl('.kb-glass-skew > .kb-glass-upright', 'transform')).toBe('skewX(calc(var(--kb-glass-skew) * -1))');
    expect(decl('.kb-glass-skew-tag > .kb-glass-upright', 'transform')).toBe('skewX(calc(var(--kb-glass-skew-tag) * -1))');
  });
});
