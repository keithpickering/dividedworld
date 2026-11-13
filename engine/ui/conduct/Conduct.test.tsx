/**
 * The code of conduct at /conduct (docs/plans/2026-11-02-conduct-plan.md, Task 1): the instance's sections, each with an anchor equal to its
 * key, under a plain opening that says how the board's Report and Report to admins differ. Readable signed out.
 */
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { renderInWorld } from '../test-world.tsx';
import type { ConductUi } from '../types.ts';
import { Conduct } from './Conduct.tsx';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); });

const conduct: ConductUi = {
  version: 3,
  sections: [
    { key: 'person', title: 'The mask is fair game; the person isn\'t.', text: 'Roast a **character** all you like.' },
    { key: 'onBoard', title: 'Keep it on the board.', text: 'No threats.\n\nNothing that follows a player off the site.' },
  ],
};

describe('the code of conduct, at /conduct', () => {
  test('opens by naming both the board\'s Report and Report to admins', () => {
    renderInWorld(<Conduct />, { path: '/conduct', conduct });
    expect(screen.getByRole('heading', { level: 1, name: 'Code of conduct' })).toBeInTheDocument();
    const lead = document.querySelector('.kb-acct-lead') as HTMLElement;
    expect(lead.textContent).toContain('Report button');
    expect(lead.textContent).toContain('Report to admins');
  });

  test('a heading inside a section\'s text is drawn below the section\'s own h2', () => {
    renderInWorld(<Conduct />, { path: '/conduct', conduct: { version: 1, sections: [{ key: 'a', title: 'A.', text: '## Inside\n\nWords.' }] } });
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['A.']);
    expect(screen.getByRole('heading', { level: 3, name: 'Inside' })).toBeInTheDocument();
  });

  test('a script and a javascript: link in the text never reach the page as script or href', () => {
    renderInWorld(<Conduct />, { path: '/conduct', conduct: { version: 1, sections: [{ key: 'a', title: 'A.', text: '<script>window.__pwned = 1</script>\n\n[click](javascript:alert(1))' }] } });
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('a[href^="javascript:" i]')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  test('lists the instance\'s sections in order, each an h2 with an anchor equal to its key, its Markdown drawn', () => {
    renderInWorld(<Conduct />, { path: '/conduct', conduct });
    const heads = screen.getAllByRole('heading', { level: 2 });
    expect(heads.map((h) => h.textContent)).toEqual(['The mask is fair game; the person isn\'t.', 'Keep it on the board.']);
    for (const key of ['person', 'onBoard']) expect(document.getElementById(key)).not.toBeNull();
    const person = document.getElementById('person') as HTMLElement;
    expect(within(person).getByRole('heading', { level: 2 })).toBe(heads[0]);
    expect(within(person).getByText('character').tagName).toBe('STRONG');
    expect(within(document.getElementById('onBoard') as HTMLElement).getByText('Nothing that follows a player off the site.')).toBeInTheDocument();
  });
});
