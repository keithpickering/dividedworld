/**
 * The glass's shared parts: the page head (a title, an optional eyebrow, lead, actions and count)
 * and the skewed button with its row. A screen draws these and not its own copy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { luminance } from '../../../tools/check-glass-contrast.mjs';
import { renderInWorld } from '../test-world.tsx';
import { BORDER_RULES, borderContrast, tokenDefaults } from './border-contrast.ts';
import { ButtonRow, GlassButton } from './Button.tsx';
import { PageHead } from './PageHead.tsx';

const here = path.dirname(fileURLToPath(import.meta.url));
const sheet = (name: string) => fs.readFileSync(path.join(here, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the rules whose selector list contains exactly `selector`, whitespace squashed. */
function declsOf(css: string, selector: string): Record<string, string> {
  const squash = (x: string) => x.replace(/\s+/g, ' ').trim();
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!m[1]!.split(',').map(squash).includes(selector)) continue;
    for (const d of m[2]!.split(';')) {
      const i = d.indexOf(':');
      if (i > 0) out[d.slice(0, i).trim()] = squash(d.slice(i + 1));
    }
  }
  return out;
}

describe('PageHead', () => {
  test('is one h1, and the lead is a p after it', () => {
    const { container } = renderInWorld(<PageHead title="Rankings" lead="Who is up." eyebrow="Week 3" count="(2 of 3)" actions={<GlassButton>Go</GlassButton>} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const h1 = container.querySelector('h1')!;
    expect(h1).toHaveTextContent('Rankings');
    expect(h1).not.toHaveClass('kb-calm');
    expect(h1).toHaveClass('kb-glass-display');
    const lead = container.querySelector('p.kb-page-head-lead')!;
    expect(lead).toHaveClass('kb-calm');
    expect(lead).toHaveTextContent('Who is up.');
    expect(h1.compareDocumentPosition(lead) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument();
  });

  test('keeps the oversized display title, and a lead goes under it rather than shrink it', () => {
    const css = sheet('parts.css');
    expect(declsOf(css, '.kb-page-head-title')['font-size']).toBe('7rem');
    expect(declsOf(css, ".kb-page-head[data-kb-size='roster'] .kb-page-head-title")['font-size']).toBe('var(--kb-glass-size-display-xl)');
    expect(declsOf(css, ":where(:root[data-kb-layout='phone']) .kb-page-head-title")['font-size']).toBe('4rem');
    expect(declsOf(css, ".kb-page-head-title")['flex']).toBe('0 0 auto');
    const { container } = renderInWorld(<PageHead title="Your characters" size="roster" />);
    expect(container.querySelector('.kb-page-head')).toHaveAttribute('data-kb-size', 'roster');
  });

  test('the lead\'s and the eyebrow\'s feather is capped at the row gap, which is the title gap', () => {
    const css = sheet('parts.css');
    expect(declsOf(css, '.kb-page-head')['row-gap']).toBe('var(--kb-glass-title-gap)');
    expect(declsOf(css, '.kb-page-head-lead')['--kb-calm-feather']).toBe('min(var(--kb-glass-calm-feather), var(--kb-glass-title-gap))');
    expect(declsOf(css, '.kb-page-head-eyebrow')['--kb-calm-feather']).toBe('min(var(--kb-glass-calm-feather), var(--kb-glass-title-gap))');
    expect(declsOf(css, '.kb-page-head')['margin-bottom']).toBe('36px');
  });

  test('leaves out what it is not given', () => {
    const { container } = renderInWorld(<PageHead title="Log" />);
    expect(container.querySelector('p')).toBeNull();
    expect(container.querySelector('.kb-button-row')).toBeNull();
  });

  test('lays the lead under a title it would be narrower than 18em beside', () => {
    const css = sheet('parts.css');
    expect(css).toMatch(/\.kb-page-head-lead\s*\{[^}]*flex:\s*1 1 18em/);
    expect(css).toMatch(/\.kb-page-head-title\s*\{[^}]*flex:\s*0 0 auto[^}]*max-width:\s*100%/);
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
  test('wraps its controls between them; a label wraps inside its own control, never across two', () => {
    const { container } = renderInWorld(<ButtonRow align="end"><GlassButton>A</GlassButton><GlassButton>B</GlassButton></ButtonRow>);
    const row = container.querySelector('.kb-button-row')!;
    expect(row).toHaveAttribute('data-kb-align', 'end');
    expect(row.querySelectorAll('.kb-glass-button')).toHaveLength(2);
    const css = sheet('parts.css');
    expect(css).toMatch(/\.kb-button-row\s*\{[^}]*flex-wrap:\s*wrap[^}]*align-items:\s*stretch/);
    /* A label may wrap inside its own control (never held on one line), within the line it stands on. */
    expect(css).not.toMatch(/\.kb-glass-button\s*\{[^}]*white-space:\s*nowrap/);
    expect(css).toMatch(/\.kb-glass-button\s*\{[^}]*max-width:\s*100%/);
  });
});

/* ---- the border a button stands on the smoke with ---- */

/** The brightest smoke any surface draws, which a button (outside every calm) stands on. */
function worstSmoke(): number {
  const all = JSON.parse(fs.readFileSync(path.join(here, '..', '..', '..', 'e2e', 'glass-ceilings.json'), 'utf8')) as Record<string, { surfaces: Record<string, { worst: number; narrowWorst?: number }> }>;
  return Math.max(...Object.values(all).flatMap((i) => Object.values(i.surfaces).flatMap((x) => [x.worst, x.narrowWorst ?? 0])));
}

describe('a button\'s border on the brightest smoke', () => {
  test('reads the smoke the pages allow', () => {
    expect(worstSmoke()).toBeGreaterThan(0.2);
    expect(luminance('#ffffff')).toBe(1);
  });
  /* With the tokens' plain defaults; web/src/contrast.test.ts holds each instance's keys to the same. */
  for (const [name, sel] of BORDER_RULES) {
    test(`the ${name} border reaches 3:1 with the tokens' defaults`, () => {
      const css = sheet('parts.css');
      expect(borderContrast(css, sel, tokenDefaults(sheet('tokens.css')), worstSmoke())).toBeGreaterThanOrEqual(3);
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
