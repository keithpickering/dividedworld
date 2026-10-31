/**
 * The float's placement (Float.tsx), with stubbed rects: beside the post, under the anchor, or the narrow width's sheet on the
 * HUD; the page scrolled for a sheet on open and when the sheet's size changes, never on every scroll; no placement from an
 * anchor that has left the page, nor when nothing it depends on has moved.
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { KayfaProvider, type Kayfa } from '../context.tsx';
import { testGlass } from '../test-world.tsx';
import { Float, placeFloat } from './Float.tsx';

const rectOf = (r: { top: number; left: number; right: number; bottom: number }) => () => ({ ...r, x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => r }) as DOMRect;
let height = 300;
let holder: HTMLElement;
const originals = (['scrollHeight', 'clientHeight'] as const).map((k) => [Element.prototype, k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const)
  .concat([[HTMLElement.prototype as unknown as Element, 'offsetHeight' as never, Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')] as never]);

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  height = 300;
  holder = document.createElement('div');
  document.body.append(holder);
  Object.defineProperty(Element.prototype, 'scrollHeight', { configurable: true, get: () => height });
  /* The box's own height is the rect's, with no border to add to its content. */
  Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get: () => 300 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 300 });
});
afterEach(() => {
  holder.remove();
  for (const [proto, key, descriptor] of originals) { if (descriptor) Object.defineProperty(proto, key, descriptor); else delete (proto as unknown as Record<string, unknown>)[key]; }
  vi.restoreAllMocks();
});

function stage(over: { anchor?: { top: number; left: number; right: number; bottom: number }; post?: { top: number; left: number; right: number; bottom: number }; hud?: boolean } = {}) {
  const anchor = document.createElement('button');
  anchor.getBoundingClientRect = rectOf(over.anchor ?? { top: 100, left: 300, right: 330, bottom: 130 });
  const post = document.createElement('article');
  post.getBoundingClientRect = rectOf(over.post ?? { top: 80, left: 100, right: 400, bottom: 400 });
  holder.append(anchor, post);
  if (over.hud !== false) {
    const hud = document.createElement('div');
    hud.className = 'kb-hud';
    hud.getBoundingClientRect = rectOf({ top: 700, left: 0, right: 1000, bottom: 800 });
    holder.append(hud);
  }
  const wrap = document.createElement('div');
  const box = document.createElement('div');
  box.getBoundingClientRect = rectOf({ top: 0, left: 0, right: 420, bottom: 300 });
  wrap.append(box);
  holder.append(wrap);
  return { anchor, post, wrap, box };
}

describe('where the float stands', () => {
  test('beside the post when the window has its width and a gutter free there', () => {
    const s = stage();
    const out = placeFloat(s.wrap, s.box, s.anchor, s.post, false);
    expect(out.at).toBe('side');
    expect(s.wrap.style.left).toBe('412px');
    expect(s.wrap.style.top).toBe('100px');
  });

  test('under the anchor when there is no room beside the post', () => {
    const s = stage({ post: { top: 80, left: 100, right: 700, bottom: 400 } });
    const out = placeFloat(s.wrap, s.box, s.anchor, s.post, false);
    expect(out.at).toBe('under');
    expect(s.wrap.style.top).toBe('138px');
  });

  test('over the anchor when under it would run into the HUD', () => {
    const s = stage({ post: { top: 80, left: 100, right: 700, bottom: 400 }, anchor: { top: 600, left: 300, right: 330, bottom: 630 } });
    expect(placeFloat(s.wrap, s.box, s.anchor, s.post, false).at).toBe('above');
  });

  test('a sheet on the HUD\'s top edge, the window\'s width, and without a HUD on the window\'s foot', () => {
    const s = stage();
    const out = placeFloat(s.wrap, s.box, s.anchor, s.post, true);
    expect(out.at).toBe('sheet');
    expect([s.wrap.style.left, s.wrap.style.right, s.wrap.style.bottom]).toEqual(['0px', '0px', '100px']);
    document.querySelector('.kb-hud')!.remove();
    placeFloat(s.wrap, s.box, s.anchor, s.post, true);
    expect(s.wrap.style.bottom).toBe('0px');
  });

  test('says how far the page must scroll to bring the anchor above a sheet, and none for an anchor already above it', () => {
    const low = stage({ anchor: { top: 620, left: 300, right: 330, bottom: 650 } });
    const sheetTop = 700 - 300;
    expect(placeFloat(low.wrap, low.box, low.anchor, low.post, true).over).toBe(650 - (sheetTop - 8));
    holder.innerHTML = '';
    const high = stage();
    expect(placeFloat(high.wrap, high.box, high.anchor, high.post, true).over).toBeLessThanOrEqual(0);
  });
});

const kayfa = { api: {}, instance: {}, ui: { glass: testGlass }, settings: {} } as unknown as Kayfa;
const frame = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });

function mount(s: ReturnType<typeof stage>, sheet: boolean, anchorRef?: { current: HTMLElement | null }) {
  return render(
    <KayfaProvider value={kayfa}>
      <Float label="Lens" surface="effect" anchor={anchorRef ?? { current: s.anchor }} beside={{ current: s.post }} sheet={sheet} onClose={() => {}}>
        <button type="button">x</button>
      </Float>
    </KayfaProvider>,
  );
}

describe('placing again', () => {
  test('a sheet scrolls the page on open and when its size changes, and not on every scroll', async () => {
    const scroll = vi.fn();
    window.scrollBy = scroll as unknown as typeof window.scrollBy;
    const s = stage({ anchor: { top: 620, left: 300, right: 330, bottom: 650 } });
    mount(s, true);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenLastCalledWith(0, 650 - (400 - 8));
    /* A reader scrolling the page moves the anchor; the sheet stands where it is and the page is left to them. */
    s.anchor.getBoundingClientRect = rectOf({ top: 520, left: 300, right: 330, bottom: 550 });
    window.dispatchEvent(new Event('scroll'));
    await frame();
    s.anchor.getBoundingClientRect = rectOf({ top: 620, left: 300, right: 330, bottom: 650 });
    window.dispatchEvent(new Event('scroll'));
    await frame();
    expect(scroll).toHaveBeenCalledTimes(1);
    /* Its own size changed (a row unfolded): the page is scrolled for the new sheet. */
    height = 200;
    window.dispatchEvent(new Event('resize'));
    await frame();
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(scroll).toHaveBeenLastCalledWith(0, 650 - (500 - 8));
  });

  test('nothing moved, nothing is placed: a scroll with the anchor and the float where they were leaves the placement alone', async () => {
    const s = stage();
    const view = mount(s, false);
    const wrap = view.container.ownerDocument.querySelector<HTMLElement>('.kb-float')!;
    wrap.style.top = '1px';
    window.dispatchEvent(new Event('scroll'));
    await frame();
    expect(wrap.style.top).toBe('1px');
    s.anchor.getBoundingClientRect = rectOf({ top: 140, left: 300, right: 330, bottom: 170 });
    window.dispatchEvent(new Event('scroll'));
    await frame();
    expect(wrap.style.top).toBe('140px');
  });

  test('never from an anchor that has left the page', async () => {
    const s = stage();
    const target: { current: HTMLElement | null } = { current: s.anchor };
    const view = mount(s, false, target);
    const wrap = view.container.ownerDocument.querySelector<HTMLElement>('.kb-float')!;
    wrap.style.top = '1px';
    s.anchor.remove();
    s.anchor.getBoundingClientRect = rectOf({ top: 0, left: 0, right: 0, bottom: 0 });
    window.dispatchEvent(new Event('resize'));
    await frame();
    expect(wrap.style.top).toBe('1px');
    /* A live anchor in its place is placed from. */
    const mark = document.createElement('button');
    mark.getBoundingClientRect = rectOf({ top: 200, left: 300, right: 330, bottom: 230 });
    holder.append(mark);
    target.current = mark;
    window.dispatchEvent(new Event('resize'));
    await frame();
    expect(wrap.style.top).toBe('200px');
  });
});
