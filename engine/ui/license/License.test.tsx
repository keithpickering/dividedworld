/**
 * The license and credits page at /license (docs/plans/2026-11-25-licensing-plan.md, Task 5): the engine's own notice, the instance's terms,
 * and the instance's credits, all from `InstanceUi.licensing`; readable signed out, and it makes no request.
 */
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { renderInWorld } from '../test-world.tsx';
import type { Licensing } from '../types.ts';
import { License, LicenseScreen } from './License.tsx';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); });

const licensing: Licensing = {
  source: 'https://example.com/the-source',
  terms: 'Everything here is offered under **either** of these.\n\n- [One](https://example.com/one)\n- [Two](https://example.com/two)',
  credits: [
    { work: 'Full work', maker: 'A. Maker', terms: 'CC BY 4.0', termsUrl: 'https://example.com/by', source: 'https://example.com/work', note: 'Cropped.' },
    { work: 'Bare work', maker: 'B. Maker', terms: 'Public domain' },
  ],
};

describe('the license and credits page, at /license', () => {
  test('is titled, and opens with the engine\'s notice, the GNU license link and the source link', () => {
    renderInWorld(<License />, { path: '/license', licensing });
    expect(screen.getByRole('heading', { level: 1, name: 'License & credits' })).toBeInTheDocument();
    const engine = document.getElementById('kayfabb') as HTMLElement;
    expect(within(engine).getByRole('heading', { level: 2, name: 'KayfaBB' })).toBeInTheDocument();
    expect(engine.textContent).toContain('KayfaBB is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.');
    expect(engine.textContent).toContain('WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.');
    expect(engine.textContent).toContain('Copyright (C) 2026 Keith Pickering and the KayfaBB contributors.');
    expect(within(engine).getByRole('link', { name: 'GNU Affero General Public License, version 3' })).toHaveAttribute('href', 'https://www.gnu.org/licenses/agpl-3.0.html');
    expect(within(engine).getByRole('link', { name: 'Get the source this site runs' })).toHaveAttribute('href', 'https://example.com/the-source');
  });

  test('draws the instance\'s terms as Markdown, under their own heading', () => {
    renderInWorld(<License />, { path: '/license', licensing });
    const site = document.getElementById('site') as HTMLElement;
    expect(within(site).getByRole('heading', { level: 2, name: 'This site' })).toBeInTheDocument();
    expect(within(site).getByText('either').tagName).toBe('STRONG');
    expect(within(site).getByRole('link', { name: 'Two' })).toHaveAttribute('href', 'https://example.com/two');
  });

  test('a script and a javascript: link in the terms never reach the page as script or href', () => {
    renderInWorld(<License />, { path: '/license', licensing: { ...licensing, terms: '<script>window.__pwned = 1</script>\n\n[click](javascript:alert(1))' } });
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('a[href^="javascript:" i]')).toBeNull();
  });

  test('lists each credit with its work, maker and terms, and the terms linked, the source and the note only where given', () => {
    renderInWorld(<License />, { path: '/license', licensing });
    const credits = document.getElementById('credits') as HTMLElement;
    expect(within(credits).getByRole('heading', { level: 2, name: 'Credits' })).toBeInTheDocument();
    const [full, bare] = within(credits).getAllByRole('listitem');
    expect(full?.textContent).toContain('Full work');
    expect(full?.textContent).toContain('by A. Maker');
    expect(within(full as HTMLElement).getByRole('link', { name: 'CC BY 4.0' })).toHaveAttribute('href', 'https://example.com/by');
    expect(within(full as HTMLElement).getByRole('link', { name: 'Source' })).toHaveAttribute('href', 'https://example.com/work');
    expect(full?.textContent).toContain('Cropped.');
    expect(bare?.textContent).toContain('Bare work');
    expect(bare?.textContent).toContain('by B. Maker');
    expect(bare?.textContent).toContain('Public domain');
    expect(within(bare as HTMLElement).queryAllByRole('link')).toEqual([]);
    expect(bare?.querySelector('.kb-license-note')).toBeNull();
  });

  test('with no credits there is no Credits section', () => {
    renderInWorld(<License />, { path: '/license', licensing: { ...licensing, credits: [] } });
    expect(document.getElementById('credits')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Credits' })).toBeNull();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['KayfaBB', 'This site']);
  });

  test('is the same page for a reader signed out, and reads nothing from the server', () => {
    const { fake } = renderInWorld(<LicenseScreen />, { path: '/license', licensing });
    expect(screen.getByRole('heading', { level: 1, name: 'License & credits' })).toBeInTheDocument();
    expect(fake).toBeDefined();
  });
});
