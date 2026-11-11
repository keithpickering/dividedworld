/**
 * The card face and the card back in the frame (docs/plans/2026-11-05-card-template-plan.md, Task 6): every size is the one card, scaled,
 * drawn from `templateVars`; a smaller size drops pieces and never reshapes the art; the back is the same frame with nothing of any card.
 * The stylesheet is read as text (as engine/ui/glass/board.test.tsx reads one), because jsdom lays nothing out.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { CardRules } from '../../rules/cards.ts';
import type { Settings } from '../../rules/types.ts';
import { faceOf, type CardFace } from './faces.ts';
import { Postcard, PostcardBack } from './Postcard.tsx';
import { SIZES, templateVars, type PostcardSize } from './template.ts';
import type { CardUi } from './types.ts';

const css = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'postcard.css'), 'utf8');
const sizes = Object.keys(SIZES) as PostcardSize[];
/** The stylesheet's rules, once: selector to body, comments stripped (a repeated selector's bodies are joined). */
const styles = new Map<string, string>();
for (const m of css.replace(/\/\*[\s\S]*?\*\//gu, '').matchAll(/([^{}]+)\{([^{}]*)\}/gu)) styles.set(m[1]!.trim(), `${styles.get(m[1]!.trim()) ?? ''}${m[2]!}`);
const body = (selector: string) => styles.get(selector) ?? '';

const ok = { ok: true as const, value: undefined };
const settings = { economy: { 'b.price': 250 } } as unknown as Settings;
const rules: CardRules = { key: 'b', name: 'B card', alignment: 'salty', rarity: 'rare', stack: 3, playPrice: () => 0, canApply: () => ok, validateConfig: (c) => ({ ok: true, value: c }) };
const ui = (art: Partial<CardUi['art']>): CardUi => ({ key: 'b', art: { color: '#f0f', ink: '#000', canvas: '/b.svg', mark: '/b-mark.svg', credit: 'Divided World', tagline: 'A short line.', ...art }, summary: 'One sentence of rules.', describe: () => 'In full.' });
const face = (art: Partial<CardUi['art']> = {}): CardFace => faceOf(rules, ui(art), settings);
const shown = (size: PostcardSize, f: CardFace = face(), price?: number) => render(<Postcard face={f} size={size} price={price} />).container.querySelector<HTMLElement>('.kb-postcard')!;
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
    const own = [...styles].filter(([selector]) => selector.split(',').every((s) => /^(?:button)?\.kb-postcard(?:\[[^\]]*\])*$/u.test(s.trim())));
    expect(own.length).toBeGreaterThan(3);
    for (const [selector, rule] of own) expect(rule, selector).not.toContain('cqw');
    expect(body('.kb-postcard')).toMatch(/width:\s*var\(--kb-pc-w\)/u);
    expect(body('.kb-postcard')).toMatch(/aspect-ratio:\s*2\s*\/\s*3/u);
    expect(body('.kb-postcard')).toMatch(/border-radius:\s*var\(--kb-pc-radius\)/u);
  });

  test('the card is the container its pieces\' cqw measure', () => {
    expect(body('.kb-postcard')).toMatch(/container-type:\s*inline-size/u);
  });

  test('--kb-name-chars follows the face\'s name, and the name has a floor and never spills', () => {
    for (const name of ['Dud', 'Autocorrect']) {
      const card = shown('slot', { ...face(), name });
      expect(card.style.getPropertyValue('--kb-name-chars')).toBe(String(name.length));
      document.body.innerHTML = '';
    }
    expect(body('.kb-postcard-name')).toMatch(/font-size:\s*max\(7px,/u);
    expect(body('.kb-postcard-name')).toMatch(/overflow:\s*hidden/u);
    expect(body('.kb-postcard-name')).toMatch(/text-overflow:\s*ellipsis/u);
  });

  test('a long name breaks onto two lines at the slot and the phone only, still one name, sized by its longer line', () => {
    for (const size of ['slot', 'phone'] as const) {
      const card = shown(size, { ...face(), name: 'You Were Saying?' });
      expect(card.getAttribute('data-lines'), size).toBe('2');
      expect(card.style.getPropertyValue('--kb-name-chars'), size).toBe('8');
      const name = card.querySelector('.kb-postcard-name')!;
      expect([...name.querySelectorAll('.kb-postcard-name-line')].map((l) => l.textContent?.trim()), size).toEqual(['You Were', 'Saying?']);
      expect(name.textContent, size).toBe('You Were Saying?');
      expect(card.querySelector('.kb-postcard-plate')?.getAttribute('aria-hidden')).toBe('true');
      document.body.innerHTML = '';
    }
    for (const size of ['fan', 'sheet'] as const) {
      const card = shown(size, { ...face(), name: 'You Were Saying?' });
      expect(card.hasAttribute('data-lines'), size).toBe(false);
      expect(card.style.getPropertyValue('--kb-name-chars'), size).toBe('16');
      expect(card.querySelectorAll('.kb-postcard-name-line'), size).toHaveLength(0);
      document.body.innerHTML = '';
    }
  });

  test('the forced-colors edge: the card, its gem and the back each get an outline', () => {
    const forced = /@media \(forced-colors: active\)\s*\{([\s\S]*?)\n\}/u.exec(css)?.[1] ?? '';
    for (const sel of ['.kb-postcard', '.kb-postcard-gem', '.kb-postcard-back']) expect(forced, sel).toMatch(new RegExp(`${sel.replace(/\./gu, '\\.')}[^{]*\\{[^}]*outline:\\s*1px solid CanvasText`, 'u'));
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
    const card = shown('sheet', face(), 250);
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

  test('a sheet given no price draws none: a card in the hand is not for sale', () => {
    const card = shown('sheet');
    expect(has(card, '.kb-postcard-price')).toBe(false);
    expect(has(card, '.kb-postcard-foot')).toBe(true);
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

describe('the bottom border\'s row', () => {
  test('the foot and the price share one flex row, so the foot ends where the price begins at any price width', () => {
    const base = shown('sheet', face(), 250).querySelector('.kb-postcard-base')!;
    expect(base.querySelector(':scope > .kb-postcard-foot')).not.toBeNull();
    expect(base.querySelector(':scope > .kb-postcard-price')).not.toBeNull();
    expect(body('.kb-postcard-base')).toMatch(/display:\s*flex/u);
    expect(body('.kb-postcard-price')).toMatch(/flex:\s*none/u);
    expect(body('.kb-postcard-price')).not.toMatch(/position:\s*absolute/u);
    expect(body('.kb-postcard-foot')).toMatch(/min-width:\s*0/u);
    expect(body('.kb-postcard-foot')).not.toMatch(/position:\s*absolute/u);
    expect(body('.kb-postcard-foot')).toMatch(/clamp\(9px,/u);
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

  test('the canvas is decoded off the frame it is first drawn in: a raster canvas is 1080 by 1680 (specs/card-art.md)', () => {
    expect(shown('sheet').querySelector('img')!.getAttribute('decoding')).toBe('async');
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

  test('with a mark it draws one empty-alt, aria-hidden img inside the canvas, and still nothing of any card', () => {
    const { container } = render(<PostcardBack size="sheet" mark="/coin.svg" />);
    const back = container.firstElementChild as HTMLElement;
    const imgs = back.querySelectorAll('img');
    expect(imgs.length).toBe(1);
    expect(imgs[0]!.getAttribute('src')).toBe('/coin.svg');
    expect(imgs[0]!.getAttribute('alt')).toBe('');
    expect(imgs[0]!.getAttribute('aria-hidden')).toBe('true');
    expect(imgs[0]!.closest('.kb-postcard-canvas')).not.toBeNull();
    expect(back.hasAttribute('data-kb-card')).toBe(false);
    expect(back.textContent).toBe('');
    expect(back.getAttribute('style')).not.toMatch(/kb-card-color|kb-card-ink/u);
  });

  test('without a mark it draws no img', () => {
    expect(render(<PostcardBack size="sheet" />).container.querySelector('img')).toBeNull();
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

  const rule = (selector: string) => new RegExp(`${selector.replace(/[.[\]]/gu, '\\$&')}\\s*\\{([^}]*)\\}`, 'u').exec(css)?.[1] ?? '';

  test('is clouded: a gradient of tokens multiplied over the noise, with no crossed bands', () => {
    const canvas = rule('.kb-postcard-back .kb-postcard-canvas');
    expect(canvas).not.toMatch(/45deg/u);
    expect(canvas).toMatch(/background-blend-mode:\s*multiply/u);
    expect(canvas).toContain('var(--kb-back-tint)');
    // A doubled comma makes the whole background-image invalid, and the back draws as a flat field.
    expect(canvas).toMatch(/background-image:\s*var\(--kb-back-tint\),\s*url\("[^"]+"\),\s*url\("[^"]+"\);/u);
    expect(rule('.kb-postcard-back')).toMatch(/--kb-back-tint:\s*linear-gradient\([^;]*var\(--kb-glass-/u);
  });

  test('draws the mark two thirds of the card wide, glowing in the back\'s glow', () => {
    const emblem = rule('.kb-postcard-emblem');
    expect(emblem).toMatch(/width:\s*66cqw/u);
    expect(emblem).toMatch(/height:\s*66cqw/u);
    expect(emblem).toMatch(/box-shadow:[^;]*var\(--kb-back-glow\)/u);
  });

  test('lends its cloud to a post\'s face-down mark by the same rules, filling the whole tile', () => {
    expect(css).toMatch(/\.kb-mark\[data-kb-back='down'\]::before,\s*\.kb-postcard-back\s+\.kb-postcard-canvas\s*\{[^}]*background-image:\s*var\(--kb-back-tint\)/u);
    expect(css).toMatch(/\.kb-mark\[data-kb-back='down'\],\s*\.kb-postcard-back\s*\{[^}]*--kb-back-tint:/u);
    const marks = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'marks.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');
    const layer = /\.kb-mark\[data-kb-back='down'\]::before\s*\{([^}]*)\}/u.exec(marks)?.[1] ?? '';
    expect(layer).toMatch(/inset:\s*0/u);
    /* The mark may size the cloud, never paint one of its own. */
    expect(layer).not.toMatch(/background(-image|-color)?:/u);
    expect(layer).toMatch(/background-size:\s*100% 100%,\s*[\d.]+rem [\d.]+rem,\s*[\d.]+rem [\d.]+rem/u);
  });

  test('glows in the machine\'s gold on a hit', () => {
    expect(rule('.kb-postcard-back[data-hit]')).toMatch(/--kb-back-glow:\s*var\(--kb-glass-ready\)/u);
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

describe('the frame says how a card is played', () => {
  const played = (play: CardRules['play'], size: PostcardSize = 'fan') => shown(size, faceOf({ ...rules, play } as CardRules, ui({}), settings));

  test('the face carries its play, and a back carries none', () => {
    for (const play of ['cast', 'set', 'use'] as const) expect(played(play).getAttribute('data-kb-play'), play).toBe(play);
    document.body.innerHTML = '';
    expect(render(<PostcardBack size="fan" />).container.querySelector('[data-kb-play]')).toBeNull();
  });

  test('a Set has a folded corner, and no other play does', () => {
    expect(has(played('set'), '.kb-postcard-fold')).toBe(true);
    document.body.innerHTML = '';
    expect(has(played('cast'), '.kb-postcard-fold')).toBe(false);
    document.body.innerHTML = '';
    expect(has(played('use'), '.kb-postcard-fold')).toBe(false);
  });

  test('each type\'s frame is drawn, a Set\'s outside ring and a Use\'s dashed one, never under 1.5px', () => {
    /* A shadow keeps 1.5px at a pixel ratio of 1, where a border of that width is floored to 1px. */
    expect(body(".kb-postcard[data-kb-play='set']::before")).toMatch(/box-shadow:\s*0 0 0 (?:1\.5|[2-9])px var\(--kb-card-color\)/u);
    expect(/\[data-kb-play='set'\]::before\s*\{([^}]*)\}/u.exec(css.slice(0, css.indexOf('@media (forced-colors')))![1]).not.toMatch(/border:/u);
    expect(body(".kb-postcard[data-kb-play='use']::before")).toMatch(/border:\s*(?:1\.5|[2-9])px dashed var\(--kb-card-color\)/u);
    expect(body(".kb-postcard[data-kb-play='set']::before,\n.kb-postcard[data-kb-play='use']::before")).toMatch(/inset:\s*-/u);
    expect(body(".kb-postcard[data-kb-play='cast']::before")).toBe('');
    expect(body('.kb-postcard-fold')).toMatch(/left:\s*0/u);
    /* Above the canvas (z-index 0), which is later in the markup, and below the words; one flat fill. */
    expect(body('.kb-postcard-fold')).toMatch(/z-index:\s*1\b/u);
    expect(body('.kb-postcard-fold')).not.toContain('gradient');
    expect(body('.kb-postcard-fold')).toMatch(/background:\s*var\(--kb-card-color\)/u);
    expect(body('.kb-postcard-fold')).toMatch(/bottom:\s*0/u);
  });

  test('forced colors keep the lines, in the system\'s text color', () => {
    const forced = css.slice(css.indexOf('@media (forced-colors: active)'));
    expect(forced).toMatch(/data-kb-play='set'\]::before[^{]*\{[^}]*2px solid CanvasText/u);
    expect(forced).toMatch(/data-kb-play='use'\]::before[^{]*\{[^}]*CanvasText/u);
    expect(forced).toMatch(/\.kb-postcard-fold[^{]*\{[^}]*CanvasText/u);
  });
});
