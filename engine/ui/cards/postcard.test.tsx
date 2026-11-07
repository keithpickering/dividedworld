/**
 * The card face and the card back in the frame (docs/plans/2026-11-05-card-template-plan.md, Task 6): every size is the one card, scaled,
 * drawn from `templateVars`; a smaller size drops pieces and never reshapes the art; the back is the same frame with nothing of any card.
 * The stylesheet is read as text (as engine/ui/glass/board.test.tsx reads one), because jsdom lays nothing out.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, waitFor } from '@testing-library/react';
import { composeStories, setProjectAnnotations } from '@storybook/react-vite';
import { describe, expect, test } from 'vitest';
import * as preview from '../../../.storybook/preview.tsx';
import * as handBoard from './Hand.board.stories.tsx';
import type { CardRules } from '../../rules/cards.ts';
import type { Settings } from '../../rules/types.ts';
import { faceOf, type CardFace } from './faces.ts';
import { Postcard, PostcardBack } from './Postcard.tsx';
import { SIZES, templateVars, type PostcardSize } from './template.ts';
import type { CardUi } from './types.ts';

setProjectAnnotations(preview as never);

const css = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'postcard.css'), 'utf8');
const sizes = Object.keys(SIZES) as PostcardSize[];

const ok = { ok: true as const, value: undefined };
const settings = { economy: { 'b.price': 250 } } as unknown as Settings;
const rules: CardRules = { key: 'b', name: 'B card', alignment: 'salty', rarity: 'rare', priceKey: 'b.price', stack: 3, playPrice: () => 0, canApply: () => ok, validateConfig: (c) => ({ ok: true, value: c }) };
const ui = (art: Partial<CardUi['art']>): CardUi => ({ key: 'b', art: { color: '#f0f', ink: '#000', canvas: '/b.svg', mark: '/b-mark.svg', credit: 'Divided World', tagline: 'A short line.', ...art }, summary: 'One sentence of rules.', describe: () => 'In full.' });
const face = (art: Partial<CardUi['art']> = {}): CardFace => faceOf(rules, ui(art), settings);
const shown = (size: PostcardSize, f: CardFace = face()) => render(<Postcard face={f} size={size} />).container.querySelector<HTMLElement>('.kb-postcard')!;
const has = (card: HTMLElement, selector: string) => card.querySelector(selector) !== null;

describe('the frame at every size', () => {
  test('sets --kb-pc-w to the size\'s width, and nothing on the card\'s own style is in container units', () => {
    for (const size of sizes) {
      const card = shown(size);
      expect(card.style.getPropertyValue('--kb-pc-w'), size).toBe(`${SIZES[size]}px`);
      for (const [name, value] of Object.entries(templateVars(size))) expect(card.style.getPropertyValue(name), name).toBe(value);
      expect(card.getAttribute('style'), size).not.toContain('cqw');
      expect(card.getAttribute('data-size')).toBe(size);
      document.body.innerHTML = '';
    }
  });

  test('no rule on the card\'s own box uses cqw, which measures the page there', () => {
    const rules = [...css.replace(/\/\*[\s\S]*?\*\//gu, '').matchAll(/([^{}]+)\{([^{}]*)\}/gu)].map((m) => ({ selector: m[1]!.trim(), body: m[2]! }));
    const own = rules.filter((r) => r.selector.split(',').every((s) => /^(?:button)?\.kb-postcard(?:\[[^\]]*\])*$/u.test(s.trim())));
    expect(own.length).toBeGreaterThan(3);
    for (const r of own) expect(r.body, r.selector).not.toContain('cqw');
    expect(css).toMatch(/\.kb-postcard\s*\{[^}]*width:\s*var\(--kb-pc-w\)/u);
    expect(css).toMatch(/\.kb-postcard\s*\{[^}]*aspect-ratio:\s*2\s*\/\s*3/u);
    expect(css).toMatch(/\.kb-postcard\s*\{[^}]*border-radius:\s*var\(--kb-pc-radius\)/u);
  });
});

describe('what each size holds', () => {
  test('the slot draws the name and the gem and no tag, play, plate text, price or foot', () => {
    const card = shown('slot');
    expect(card.querySelector('.kb-postcard-name')?.textContent).toBe('B card');
    expect(has(card, '.kb-postcard-gem')).toBe(true);
    for (const part of ['tag', 'play', 'line', 'price', 'foot']) expect(has(card, `.kb-postcard-${part}`), part).toBe(false);
  });

  test('the phone adds the tag and the play', () => {
    const card = shown('phone');
    expect(card.querySelector('.kb-postcard-tag')?.textContent).toBe('Salty');
    expect(card.querySelector('.kb-postcard-play')?.textContent).toBe('Cast');
    for (const part of ['line', 'price', 'foot']) expect(has(card, `.kb-postcard-${part}`), part).toBe(false);
  });

  test('the fan adds the tagline and no price or foot', () => {
    const card = shown('fan');
    expect(card.querySelector('.kb-postcard-line')?.textContent).toBe('A short line.');
    for (const part of ['price', 'foot']) expect(has(card, `.kb-postcard-${part}`), part).toBe(false);
  });

  test('the sheet adds the summary, the price and the foot, which says the credit', () => {
    const card = shown('sheet');
    expect(card.querySelector('.kb-postcard-line')?.textContent).toBe('One sentence of rules.');
    expect(card.querySelector('.kb-postcard-price')?.textContent).toBe('2.50');
    const foot = card.querySelector('.kb-postcard-foot')!.textContent!;
    expect(foot).toContain('Postcard · Stacks 3 deep');
    expect(foot).toContain('Art · Divided World');
  });

  test('a face with no credit draws no credit, and a card that stacks once says one per post', () => {
    const card = shown('sheet', faceOf({ ...rules, stack: 1 }, ui({ credit: undefined }), settings));
    expect(card.querySelector('.kb-postcard-foot')!.textContent).toContain('Postcard · One per post');
    expect(card.querySelector('.kb-postcard-foot')!.textContent).not.toContain('Art');
  });

  test('every word is real text in the label\'s order, and aria-hidden', () => {
    const card = shown('sheet');
    const words = [...card.querySelectorAll(':scope > span')].filter((e) => e.textContent?.trim());
    for (const w of words) expect(w.getAttribute('aria-hidden'), w.className).toBe('true');
    const text = card.textContent!;
    expect(text.indexOf('B card')).toBeLessThan(text.indexOf('Salty'));
    expect(text.indexOf('Salty')).toBeLessThan(text.indexOf('Cast'));
  });
});

describe('the canvas', () => {
  test('a face with no canvas draws no img', () => {
    const card = shown('sheet', faceOf(rules, undefined, settings));
    expect(card.querySelector('img')).toBeNull();
    expect(has(card, '.kb-postcard-canvas')).toBe(true);
  });

  test('a face with a canvas draws it as an empty-alt img inside the canvas element', () => {
    const card = shown('sheet');
    const img = card.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('/b.svg');
    expect(img.getAttribute('alt')).toBe('');
    expect(img.closest('.kb-postcard-canvas')).not.toBeNull();
    expect(img.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('the back', () => {
  test('holds no card\'s key, color or name, at any size', () => {
    for (const size of sizes) {
      const { container, unmount } = render(<PostcardBack size={size} />);
      const back = container.firstElementChild as HTMLElement;
      expect(back, size).not.toBeNull();
      expect(back.hasAttribute('data-kb-card')).toBe(false);
      expect(back.textContent).toBe('');
      expect(back.getAttribute('style')).not.toMatch(/kb-card-color|kb-card-ink/u);
      expect(back.style.getPropertyValue('--kb-pc-w')).toBe(`${SIZES[size]}px`);
      expect(back.hasAttribute('data-hit')).toBe(false);
      unmount();
    }
  });

  test('a hit sets data-hit, and the caller names it', () => {
    const { container } = render(<PostcardBack size="fan" hit aria-label="A face-down postcard" />);
    const back = container.firstElementChild!;
    expect(back.hasAttribute('data-hit')).toBe(true);
    expect(back.getAttribute('aria-label')).toBe('A face-down postcard');
  });

  test('is drawn in the glass\'s text and field, and gold on a hit', () => {
    expect(css).toMatch(/\.kb-postcard-back\s*\{[^}]*--kb-card-color:\s*var\(--kb-glass-text-hi\)/u);
    expect(css).toMatch(/\.kb-postcard-back\s+\.kb-postcard-canvas[^{]*\{[^}]*var\(--kb-glass-field\)/u);
    expect(css).toMatch(/\.kb-postcard-back\[data-hit\][^{]*\{[^}]*var\(--kb-glass-ready\)/u);
  });
});

describe('the stylesheet', () => {
  test('draws the text plate\'s edge as a ::before ring cut with polygon(evenodd, …)', () => {
    const ring = /\.kb-postcard-line::before\s*\{([^}]*)\}/u.exec(css);
    expect(ring, 'a ::before rule on the text plate').not.toBeNull();
    expect(ring![1]).toContain('polygon(evenodd');
  });

  test('the plates\' backgrounds are single tokens, with no gradient', () => {
    const plate = (selector: string) => new RegExp(`${selector.replace(/[.]/gu, '\\.')}\\s*\\{([^}]*)\\}`, 'u').exec(css)?.[1] ?? '';
    expect(plate('.kb-postcard-plate')).toMatch(/background:\s*var\(--kb-glass-panel\);/u);
    expect(plate('.kb-postcard-line')).toMatch(/background:\s*var\(--kb-glass-panel-soft\);/u);
    expect(plate('.kb-postcard-plate') + plate('.kb-postcard-line')).not.toContain('gradient');
  });
});

describe('the hand\'s sheet story', () => {
  test('its description ends "Art by Divided World."', async () => {
    const Sheet = (composeStories(handBoard as never) as Record<string, React.ComponentType>)['Sheet']!;
    const { container } = render(<Sheet />);
    await waitFor(() => expect(container.querySelector('.kb-postcard')).not.toBeNull());
    const says = [...container.querySelectorAll('.kb-visually-hidden[id^="kb-hand-board-says-"]')];
    expect(says.length).toBeGreaterThan(0);
    for (const s of says) expect(s.textContent, s.id).toMatch(/Art by Divided World\.$/u);
  });
});
