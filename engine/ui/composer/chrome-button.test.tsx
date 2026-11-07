import { cleanup, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { openThread, replyBox, threadWorld } from './support.tsx';

/* The board-look plan's Task 4: the Chrome button, the board's one button (`.kb-button`) in two sizes. */
beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const base = readFileSync('engine/ui/base.css', 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');

describe('the Chrome button on a thread page', () => {
  test('a post\'s actions are small buttons, named in the copy\'s own case', async () => {
    const w = threadWorld(2);
    openThread(w);
    const post = await screen.findByRole('article', { name: /^Post 2 /u });
    for (const name of ['Quote', 'Spin thread', 'History']) {
      const b = within(post).getByRole('button', { name });
      expect(b, name).toHaveClass('kb-button');
      expect(b, name).toHaveAttribute('data-kb-size', 'small');
      expect(b, name).not.toHaveClass('kb-link-button');
    }
  });

  test('Send is the reply form\'s one primary button; Preview and Reveal are small and not primary', async () => {
    openThread(threadWorld(2));
    const form = (await replyBox()).closest('form')!;
    const primary = form.querySelectorAll('[data-kb-primary]');
    expect(primary).toHaveLength(1);
    expect(primary[0]).toBe(within(form).getByRole('button', { name: 'Send' }));
    for (const name of ['Preview', 'Reveal…']) expect(within(form).getByRole('button', { name })).toHaveAttribute('data-kb-size', 'small');
  });

  test('the formatting toolbar\'s buttons are small', async () => {
    openThread(threadWorld(2));
    const bar = within(await screen.findByRole('toolbar', { name: 'Formatting' }));
    for (const b of bar.getAllByRole('button')) expect(b).toHaveAttribute('data-kb-size', 'small');
  });
});

describe('.kb-button in base.css', () => {
  const rule = (sel: string) => new RegExp(`${sel.replace(/[.[\]()=*"']/gu, '\\$&')}\\s*\\{[^}]*\\}`, 'u').exec(base)?.[0] ?? '';

  test('reads the tokens: the face, the edge, the label with its glow, the case and the radius', () => {
    const r = rule('.kb-button');
    for (const t of ['--kb-button-bg', '--kb-button-edge', '--kb-button-fg', '--kb-button-fg-shadow', '--kb-button-case', '--kb-button-radius']) expect(r, t).toContain(t);
    expect(r).toMatch(/text-transform:\s*var\(--kb-button-case\)/u);
    expect(r).toMatch(/font:\s*bold/u);
  });

  test('a primary button takes the primary tokens; pressed is aria-expanded or aria-current, drawn with an inset shadow', () => {
    expect(rule('.kb-button[data-kb-primary]')).toMatch(/--kb-button-primary-bg[\s\S]*--kb-button-primary-fg|--kb-button-primary-fg[\s\S]*--kb-button-primary-bg/u);
    expect(base).toMatch(/\.kb-button\[aria-expanded='true'\][\s\S]*?\{[^}]*inset/u);
    expect(base).toMatch(/\.kb-button\[aria-current\][\s\S]*?\{[^}]*inset/u);
    expect(base).toMatch(/\.kb-button\[data-kb-size='small'\]/u);
  });

  test('the focus ring is the board\'s own', () => {
    expect(base).toMatch(/\.kb-button:focus-visible[\s\S]*?--kb-focus/u);
  });
});
