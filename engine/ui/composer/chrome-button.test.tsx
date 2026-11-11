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

  test('Send is the reply form\'s one primary button; Preview is small and not primary', async () => {
    openThread(threadWorld(2));
    const form = (await replyBox()).closest('form')!;
    const primary = form.querySelectorAll('[data-kb-primary]');
    expect(primary).toHaveLength(1);
    expect(primary[0]).toBe(within(form).getByRole('button', { name: 'Send' }));
    expect(within(form).getByRole('button', { name: 'Preview' })).toHaveAttribute('data-kb-size', 'small');
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
    expect(r).toMatch(/font:\s*var\(--kb-button-weight\)/u);
    for (const t of ['--kb-button-shadow', '--kb-button-tracking']) expect(r, t).toContain(t);
  });

  /* A rule whose selector list holds `sel` (as any member): its body. Anchored to the rule's braces, so deleting the rule empties it. */
  const block = (sel: string) => new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}[^{}]*\\{([^}]*)\\}`, 'u').exec(base)?.[1] ?? '';

  test('a primary button takes the primary tokens; pressed is aria-expanded, aria-pressed or aria-current, drawn with the pressed shadow and a dimmer face', () => {
    expect(rule('.kb-button[data-kb-primary]')).toMatch(/--kb-button-primary-bg[\s\S]*--kb-button-primary-fg|--kb-button-primary-fg[\s\S]*--kb-button-primary-bg/u);
    for (const sel of ["[aria-expanded='true']", "[aria-pressed='true']", "[aria-current]:not([aria-current='false'])"]) {
      const body = block(`.kb-button${sel}`);
      expect(body, sel).toMatch(/box-shadow:\s*var\(--kb-button-pressed-shadow\)/u);
      expect(body, sel).toMatch(/filter:\s*brightness\(var\(--kb-button-pressed-brightness\)\)/u);
    }
    expect(base).toMatch(/\.kb-button\[data-kb-size='small'\]/u);
  });

  test('the focus ring is the board\'s own', () => {
    expect(block('.kb-button:focus-visible')).toMatch(/outline:[^;]*var\(--kb-focus\)/u);
  });

  test('aria-disabled draws as :disabled does', () => {
    const body = block(".kb-button[aria-disabled='true']");
    for (const decl of [/color:\s*var\(--kb-muted\)/u, /background:\s*var\(--kb-button-bg\)/u, /border-color:\s*var\(--kb-muted\)/u, /box-shadow:\s*none/u]) expect(body).toMatch(decl);
    expect(base).toMatch(/\.kb-button:disabled,\s*\.kb-button\[aria-disabled='true'\]\s*\{/u);
  });

  test('a small button is at least 24px tall (WCAG 2.5.8), at the root size of 16px', () => {
    expect(block(".kb-button[data-kb-size='small']")).toMatch(/min-height:\s*1\.5rem/u);
  });
});

/* The board-look plan's Task 7: the reply box and New thread open under a light band, and draw their text box inset. */
const composer = readFileSync('engine/ui/composer/composer.css', 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');
const rules = (text: string, selector: string): string[] => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].filter((m) => m[1]!.split(',').map((x) => x.replace(/\s+/gu, ' ').trim()).includes(selector)).map((m) => m[2]!);

describe('the form look', () => {
  test('the reply box is a form under a head that reads the light band\'s tokens', async () => {
    openThread(threadWorld(2));
    const form = (await replyBox()).closest('form')!;
    expect(form).toHaveClass('kb-form');
    expect(within(form).getByRole('heading', { name: 'Reply' })).toHaveClass('kb-box-head');
    expect(rules(composer, '.kb-form > .kb-box-head').join(';')).toMatch(/background:\s*var\(--kb-bar-bg\)[^]*color:\s*var\(--kb-bar-fg\)[^]*text-shadow:\s*var\(--kb-bar-shadow\)/u);
  });
  test('the text boxes read the inset tokens', () => {
    const own = rules(composer, '.kb-form .kb-editor-box').join(';');
    expect(own).toMatch(/background:\s*var\(--kb-input-bg\)/u);
    expect(own).toMatch(/border-color:\s*var\(--kb-input-edge\)/u);
    expect(own).toMatch(/box-shadow:\s*var\(--kb-input-shadow\)/u);
    expect(rules(composer, '.kb-form .kb-input').join(';')).toMatch(/box-shadow:\s*var\(--kb-input-shadow\)/u);
  });
});
