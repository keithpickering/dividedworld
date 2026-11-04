/**
 * The glass's shared parts: the page head (a title, an optional eyebrow, lead, actions and count)
 * and the skewed button with its row. A screen draws these and not its own copy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { contrastRatio, luminance, parseColor } from '../../../tools/check-glass-contrast.mjs';
import { renderInWorld } from '../test-world.tsx';
import { ButtonRow, GlassButton } from './Button.tsx';
import { PageHead } from './PageHead.tsx';

const here = path.dirname(fileURLToPath(import.meta.url));
const sheet = (name: string) => fs.readFileSync(path.join(here, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('PageHead', () => {
  test('is one h1, and the lead is a p after it', () => {
    const { container } = renderInWorld(<PageHead title="Rankings" lead="Who is up." eyebrow="Week 3" count="(2 of 3)" actions={<GlassButton>Go</GlassButton>} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const h1 = container.querySelector('h1')!;
    expect(h1).toHaveTextContent('Rankings');
    expect(h1).toHaveClass('kb-calm');
    const lead = container.querySelector('p.kb-page-head-lead')!;
    expect(lead).toHaveClass('kb-calm');
    expect(lead).toHaveTextContent('Who is up.');
    expect(h1.compareDocumentPosition(lead) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument();
  });

  test('leaves out what it is not given', () => {
    const { container } = renderInWorld(<PageHead title="Log" />);
    expect(container.querySelector('p')).toBeNull();
    expect(container.querySelector('.kb-button-row')).toBeNull();
  });

  test('lays the lead under a title it would be narrower than 18em beside', () => {
    const css = sheet('parts.css');
    expect(css).toMatch(/\.kb-page-head-lead\s*\{[^}]*flex:\s*1 1 18em/);
    expect(css).toMatch(/\.kb-page-head-title\s*\{[^}]*flex:\s*0 1 auto[^}]*min-width:\s*min\(100%, max-content\)/);
  });
});

describe('GlassButton', () => {
  test('is a button, or a link with `to`', () => {
    renderInWorld(<><GlassButton>Save</GlassButton><GlassButton to="/log">Open</GlassButton></>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button');
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/log');
  });

  test('says its kind and size, and holds the label in the upright span', () => {
    renderInWorld(<><GlassButton kind="primary" size="s">Do it</GlassButton><GlassButton>Plain</GlassButton></>);
    const b = screen.getByRole('button', { name: 'Do it' });
    expect(b).toHaveAttribute('data-kb-kind', 'primary');
    expect(b).toHaveAttribute('data-kb-size', 's');
    expect(b).toHaveClass('kb-glass-skew');
    expect(b.querySelector('.kb-glass-upright')).toHaveTextContent('Do it');
    const plain = screen.getByRole('button', { name: 'Plain' });
    expect(plain).toHaveAttribute('data-kb-kind', 'secondary');
    expect(plain).toHaveAttribute('data-kb-size', 'm');
  });

  test('passes button props through', () => {
    renderInWorld(<GlassButton disabled>Wait</GlassButton>);
    expect(screen.getByRole('button', { name: 'Wait' })).toBeDisabled();
  });

  test('takes its measure from the control tokens, the phone layout through a rule the root cannot outrank', () => {
    const css = sheet('parts.css');
    expect(css).toMatch(/--kb-glass-control-m-height/);
    expect(css).toMatch(/:where\(:root\[data-kb-layout='phone'\]\)\s*\.kb-glass-button/);
    const tokens = sheet('tokens.css');
    for (const s of ['m', 's']) for (const p of ['height', 'pad', 'size']) {
      expect(tokens).toContain(`--kb-glass-control-${s}-${p}:`);
      expect(tokens).toContain(`--kb-glass-control-${s}-${p}-phone:`);
    }
    expect(tokens).toContain('--kb-glass-control-spacing:');
  });
});

describe('ButtonRow', () => {
  test('wraps its controls between them, never inside one', () => {
    const { container } = renderInWorld(<ButtonRow align="end"><GlassButton>A</GlassButton><GlassButton>B</GlassButton></ButtonRow>);
    const row = container.querySelector('.kb-button-row')!;
    expect(row).toHaveAttribute('data-kb-align', 'end');
    expect(row.querySelectorAll('.kb-glass-button')).toHaveLength(2);
    const css = sheet('parts.css');
    expect(css).toMatch(/\.kb-button-row\s*\{[^}]*flex-wrap:\s*wrap[^}]*align-items:\s*stretch/);
    expect(css).toMatch(/\.kb-glass-button\s*\{[^}]*white-space:\s*nowrap/);
  });
});

/* ---- the border a button stands on the smoke with ---- */

/** The brightest smoke any surface of any instance draws, which a button (outside every calm) stands on. */
function worstSmoke(): number {
  const all = JSON.parse(fs.readFileSync(path.join(here, '..', '..', '..', 'e2e', 'glass-ceilings.json'), 'utf8')) as Record<string, { surfaces: Record<string, { worst: number; narrowWorst?: number }> }>;
  return Math.max(...Object.values(all).flatMap((i) => Object.values(i.surfaces).flatMap((x) => [x.worst, x.narrowWorst ?? 0])));
}
/** Every instance's standard key, with the tokens' plain defaults under it. */
function keys(): Record<string, string>[] {
  const defaults: Record<string, string> = {};
  for (const m of sheet('tokens.css').matchAll(/(--kb-glass-[\w-]+):\s*([^;]+);/g)) defaults[m[1]!] = m[2]!.trim();
  const dir = path.join(here, '..', '..', '..', 'instances');
  return fs.readdirSync(dir).flatMap((n) => {
    const f = path.join(dir, n, 'ui', 'glass.json');
    if (!fs.existsSync(f)) return [];
    const glass = JSON.parse(fs.readFileSync(f, 'utf8')) as { keys: Record<string, Record<string, { value: string }>> };
    return Object.values(glass.keys).map((k) => ({ ...defaults, ...Object.fromEntries(Object.entries(k).map(([a, b]) => [a, b.value])) }));
  });
}
/** A color value with its var()s and color-mix(in srgb, X N%, transparent) resolved to rgb and alpha. */
function resolve(value: string, vars: Record<string, string>): { r: number; g: number; b: number; a: number } {
  const v = value.replace(/var\((--[\w-]+)\)/g, (_, n: string) => vars[n] ?? 'NOPE').trim();
  const mix = /^color-mix\(in srgb,\s*(.+?)\s+([\d.]+)%,\s*transparent\)$/.exec(v);
  if (mix) { const c = resolve(mix[1]!, vars); return { ...c, a: c.a * Number(mix[2]) / 100 }; }
  const c = parseColor(v);
  if (!c) throw new Error(`cannot resolve ${v}`);
  return c;
}
/** The contrast of the border a rule draws, over smoke of the given luminance. */
function borderContrast(selector: RegExp, vars: Record<string, string>, smoke: number): number {
  const rule = new RegExp(`(?:^|\\n|,)\\s*${selector.source}\\s*\\{([^}]*)\\}`).exec(sheet('parts.css'));
  if (!rule) throw new Error(`no rule for ${selector}`);
  const decl = /border(?:-color)?:\s*(?:\d+px\s+\w+\s+)?([^;]+);/.exec(rule[1]!);
  if (!decl) throw new Error(`no border in ${selector}`);
  const c = resolve(decl[1]!, vars);
  /* The gray of that luminance (sRGB's inverse). */
  const lin = smoke <= 0.0031308 ? smoke * 12.92 : 1.055 * smoke ** (1 / 2.4) - 0.055;
  const g = 255 * lin;
  const mixed = [c.r, c.g, c.b].map((x) => x * c.a + g * (1 - c.a));
  return contrastRatio(mixed as never, [g, g, g] as never);
}

describe('a button\'s border on the brightest smoke', () => {
  test('reads the smoke the pages allow', () => {
    expect(worstSmoke()).toBeGreaterThan(0.2);
    expect(luminance('#ffffff')).toBe(1);
  });
  for (const [name, sel] of [['secondary', /\.kb-glass-button\[data-kb-kind='secondary'\]/], ['disabled', /\.kb-glass-button:disabled,\s*\.kb-glass-button\[aria-disabled='true'\]/]] as const) {
    test(`the ${name} border reaches 3:1 in every instance's key`, () => {
      const all = keys();
      expect(all.length).toBeGreaterThan(0);
      for (const vars of all) expect(borderContrast(sel, vars, worstSmoke())).toBeGreaterThanOrEqual(3);
    });
  }
});

describe('GlassButton as a link', () => {
  test('forwards anchor props to the anchor', () => {
    let clicked = 0;
    renderInWorld(<GlassButton to="/log" aria-label="Open the log" id="x" title="t" target="_blank" onClick={() => { clicked += 1; }}>Log</GlassButton>);
    const a = screen.getByRole('link', { name: 'Open the log' });
    expect(a).toHaveAttribute('id', 'x');
    expect(a).toHaveAttribute('title', 't');
    expect(a).toHaveAttribute('target', '_blank');
    fireEvent.click(a);
    expect(clicked).toBe(1);
  });

  for (const props of [{ disabled: true }, { 'aria-disabled': true }] as const) {
    test(`a link with ${Object.keys(props)[0]} has no href, is not focusable and does not navigate`, () => {
      let clicked = 0;
      renderInWorld(<GlassButton to="/log" {...props} onClick={() => { clicked += 1; }}>Log</GlassButton>);
      const a = screen.getByRole('link', { name: 'Log' });
      expect(a).not.toHaveAttribute('href');
      expect(a).not.toHaveAttribute('tabindex');
      /* An anchor with no href and no tabindex is outside the tab order. */
      expect(a.matches('a[href], [tabindex]')).toBe(false);
      expect(a).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(a);
      expect(clicked).toBe(0);
    });
  }
});
