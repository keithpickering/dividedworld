/**
 * The glass's shared parts: the page head (a title, an optional eyebrow, lead, actions and count)
 * and the skewed button with its row. A screen draws these and not its own copy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
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
