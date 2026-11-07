/**
 * The reveal's entrance on a phone (the design's amendment "The reveal's motion", item 7; booster packs plan, Task 10): the pack rises from its slot, tears and lets the
 * five out as on the 1440 (not drawn at all until the tear), and the deal stacks the five into the pile instead of a row. Motion's `animate` is stood in for by a recorder
 * that finishes at once, so the beats' order and targets are what is asserted, not their pixels.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CardRules } from '../../rules/cards.ts';
import { facesOf } from '../cards/faces.ts';
import type { CardUi } from '../cards/types.ts';
import { Layers } from '../glass/layer.tsx';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
import { PackOpening } from './PackOpening.tsx';

interface Call { readonly el: Element; readonly target: Record<string, unknown> }
const calls: Call[] = [];
vi.mock('motion/react', async (original) => {
  const actual = await original<typeof import('motion/react')>();
  return {
    ...actual,
    animate: (el: unknown, target: Record<string, unknown>) => {
      if (el instanceof Element) calls.push({ el, target });
      return Object.assign(Promise.resolve(), { stop() {}, complete() {}, cancel() {} });
    },
  };
});

const ok = { ok: true as const, value: undefined };
const rule = (key: string, name: string, rarity: CardRules['rarity']): CardRules => ({
  key, name, alignment: 'sweet', rarity, playPrice: () => 0, canApply: () => ok, validateConfig: (c) => ({ ok: true, value: c }),
});
const rules = [rule('stick', 'Stick Around', 'common'), rule('main', 'Main Event', 'rare')];
const art = { color: '#2ee6ff', ink: '#03141a', canvas: '', mark: '', credit: 'Test' };
const uis: CardUi[] = rules.map((r) => ({ key: r.key, art, describe: () => `${r.name} does a thing.` }));
const faces = facesOf(rules, uis, testInstance.settings);
const pulled = ['stick', 'stick', 'stick', 'stick', 'main'].map((k) => faces.find((f) => f.key === k)!);

/* The pile's place and a card's home (the hidden row's slot) as the layout would give them. */
const STAGE = { x: 57, y: 300, width: 276, height: 414 };
const HOME = { x: 120, y: 900, width: 150, height: 225 };
const box = (r: { x: number; y: number; width: number; height: number }) => ({ ...r, left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height, toJSON: () => ({}) });

beforeEach(() => {
  calls.length = 0;
  document.documentElement.setAttribute('data-kb-layout', 'phone');
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.matches('.kb-opening-stage')) return box(STAGE) as DOMRect;
    if (this.matches('[data-kb-pull]')) return box(HOME) as DOMRect;
    return box({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect;
  });
});
afterEach(() => {
  document.documentElement.removeAttribute('data-kb-layout');
  document.documentElement.removeAttribute('data-kb-motion');
  document.documentElement.removeAttribute('data-kb-motion-feel');
  vi.restoreAllMocks();
});

const open = () => renderIn(buildWorld(), <Layers><PackOpening name="Booster" art={{ color: '#ffd93d', ink: '#1a1403', canvas: '', mark: '' }} cards={pulled} note={null} onClose={vi.fn()} /></Layers>);
const pull = (el: Element) => Number((el.closest('[data-kb-pull]') ?? el).getAttribute('data-kb-pull'));
const onCard = (c: Call) => c.el.hasAttribute('data-kb-pull');

describe('the entrance on a phone', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-kb-motion', 'full');
    document.documentElement.setAttribute('data-kb-motion-feel', 'smooth');
  });

  test('no card is drawn before the tear, the five rise out fanned, and the deal stacks them into the pile', async () => {
    open();
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveAttribute('data-kb-stage', 'ready'), { timeout: 4000 });
    const tear = calls.findIndex((c) => c.el.classList.contains('kb-opening-pack-top') && Array.isArray(c.target['x']));
    expect(tear).toBeGreaterThan(-1);
    /* Shut and not drawn from the first frame, through the pack's rise; shown only as the tear starts. */
    const packCalls = calls.filter((c) => c.el.classList.contains('kb-opening-pack'));
    const rise = calls.indexOf(packCalls[1]!);
    const hidden = calls.slice(0, rise + 1).filter(onCard);
    expect(hidden.map((c) => pull(c.el))).toEqual([0, 1, 2, 3, 4]);
    expect(hidden.every((c) => c.target['opacity'] === 0)).toBe(true);
    const shown = calls.slice(0, tear).filter((c) => onCard(c) && c.target['opacity'] === 1);
    expect(shown.map((c) => pull(c.el))).toEqual([0, 1, 2, 3, 4]);
    expect(calls.indexOf(shown[0]!)).toBeGreaterThan(rise);
    const after = calls.slice(tear).filter(onCard);
    const fanned = after.filter((c) => typeof c.target['rotate'] === 'number' && c.target['rotate'] !== 0);
    expect(fanned.map((c) => pull(c.el))).toEqual([0, 1, 3, 4]);
    const dealt = after.filter((c) => c.target['rotate'] === 0 && c.target['scale'] !== 1 && !('opacity' in c.target));
    expect(dealt.map((c) => pull(c.el))).toEqual([0, 1, 2, 3, 4]);
    /* Into the pile: the stage's center from the card's home, grown to the sheet's width; not back to the row's slot (0, 0, 1). */
    for (const c of dealt) {
      expect(c.target['scale']).toBeCloseTo(STAGE.width / HOME.width, 5);
      expect(Number(c.target['x'])).toBeCloseTo(STAGE.x + STAGE.width / 2 - (HOME.x + HOME.width / 2) + (pull(c.el) - 2) * 2, 5);
      expect(Number(c.target['y'])).toBeCloseTo(STAGE.y + STAGE.height / 2 - (HOME.y + HOME.height / 2), 5);
    }
    /* The deal follows the fan. */
    expect(calls.indexOf(dealt[0]!)).toBeGreaterThan(calls.indexOf(fanned[fanned.length - 1]!));
  });

  test('under Off nothing is animated and the pile is there at once', () => {
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    open();
    expect(calls).toEqual([]);
    expect(screen.getByRole('dialog')).not.toHaveAttribute('data-kb-stage');
    expect(document.querySelector('.kb-opening-spot')).not.toBeNull();
  });
});

describe('the pile under a feel', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-kb-motion', 'full');
    document.documentElement.setAttribute('data-kb-motion-feel', 'smooth');
  });
  const counter = () => document.querySelector('.kb-opening-count')!;
  const ready = () => waitFor(() => expect(screen.getByRole('dialog')).toHaveAttribute('data-kb-stage', 'ready'), { timeout: 4000 });
  /** The card on top of the pile: the one standing in the spotlight. */
  const top = async (i: number) => {
    await waitFor(() => expect(document.querySelector(`.kb-opening-spot [data-kb-pull="${i}"]`)).not.toBeNull());
    return document.querySelector(`.kb-opening-spot [data-kb-pull="${i}"]`)!;
  };
  /** A finger on `el`: down, up, and the click the browser sends after it. */
  const tap = (el: Element, from = 100, to = 100) => {
    fireEvent.pointerDown(el, { clientX: from, buttons: 1 });
    fireEvent.pointerUp(el, { clientX: to });
    fireEvent.click(el, { detail: 1 });
  };

  test('a tap on the real button turns one card, not two; Enter on it turns one', async () => {
    open();
    await ready();
    const first = (await top(0)).querySelector('button')!;
    expect(first).toHaveAccessibleName('Turn card 1');
    tap(first);
    expect(counter()).toHaveTextContent('1 of 5 turned over');
  });

  test('Enter or Space on the real button (a click with no pointer) turns one card', async () => {
    open();
    await ready();
    fireEvent.click((await top(0)).querySelector('button')!, { detail: 0 });
    expect(counter()).toHaveTextContent('1 of 5 turned over');
  });

  test('a swipe on whatever card is on top turns one card, after each of the first four turns', async () => {
    open();
    await ready();
    for (let j = 1; j <= 5; j++) {
      /* Before the second turn the first card is still on top, turned; each turn after it sends that card off and lifts the next. */
      const card = await top(Math.max(0, j - 2));
      expect(card.closest('.kb-opening-stage')).not.toBeNull();
      tap(card, 300, j % 2 ? 400 : 200);
      expect(counter()).toHaveTextContent(j === 5 ? '5 of 5' : `${j} of 5 turned over`);
    }
  });

  test('a pointer cancelled mid-drag springs the card back and clears the drag; a move with no finger down does nothing', async () => {
    open();
    await ready();
    const card = await top(0);
    tap(card);
    expect(counter()).toHaveTextContent('1 of 5 turned over');
    const stage = document.querySelector('.kb-opening-stage')!;
    calls.length = 0;
    fireEvent.pointerMove(stage, { clientX: 50, buttons: 0 });
    expect(calls.filter((c) => 'x' in c.target)).toEqual([]);
    fireEvent.pointerDown(stage, { clientX: 300, buttons: 1 });
    fireEvent.pointerMove(stage, { clientX: 250, buttons: 1 });
    expect(calls.at(-1)?.target).toMatchObject({ x: -50 });
    fireEvent.pointerCancel(stage);
    expect(calls.at(-1)?.target).toMatchObject({ x: 0, rotate: 0 });
    /* The drag is gone: a later move does not follow, and a lone up turns nothing. */
    calls.length = 0;
    fireEvent.pointerMove(stage, { clientX: 100, buttons: 1 });
    fireEvent.pointerUp(stage, { clientX: 100 });
    expect(calls.filter((c) => 'x' in c.target)).toEqual([]);
    expect(counter()).toHaveTextContent('1 of 5 turned over');
  });
});
