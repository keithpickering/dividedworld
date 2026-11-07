/**
 * The float's placement (Float.tsx), with stubbed rects: docked at the right from the page's top to 16px above the HUD (board 28), as
 * wide as `dockWidth` says, or the narrow width's sheet on the HUD, as wide as the window; the page scrolled for a sheet on open and when
 * the sheet's size changes, never on every scroll; no placement from an anchor that has left the page, nor when nothing it depends on has moved.
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { KayfaProvider, type Kayfa } from '../context.tsx';
import { testGlass } from '../test-world.tsx';
import { DOCK_INSET, dockWidth, Float, placeFloat } from './Float.tsx';
import { PROBE_ATTRIBUTE } from './viewport.ts';

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
  test('docked at the right, 16px from the top and 16px above the HUD, whatever the post and the anchor', () => {
    const s = stage();
    const out = placeFloat(s.wrap, s.box, s.anchor, false);
    expect(out.at).toBe('dock');
    expect([s.wrap.style.top, s.wrap.style.right]).toEqual([`${DOCK_INSET}px`, `${DOCK_INSET}px`]);
    /* The window is 1000 wide and 800 high, the HUD's top is 700: the panel is as tall as the room between. */
    expect(s.box.style.height).toBe(`${700 - 2 * DOCK_INSET}px`);
    expect(s.wrap.style.width).toBe(`${dockWidth(1000)}px`);
    /* An anchor low on the page does not move it. */
    holder.innerHTML = '';
    const low = stage({ anchor: { top: 620, left: 300, right: 330, bottom: 650 } });
    placeFloat(low.wrap, low.box, low.anchor, false);
    expect([low.wrap.style.top, low.box.style.height]).toEqual([`${DOCK_INSET}px`, `${700 - 2 * DOCK_INSET}px`]);
  });

  test('without a HUD it is docked to the window\'s foot', () => {
    const s = stage({ hud: false });
    placeFloat(s.wrap, s.box, s.anchor, false);
    expect(s.box.style.height).toBe(`${800 - 2 * DOCK_INSET}px`);
  });

  test('its width is 460px at 1440, never under 360, and never wider than the window less its two insets', () => {
    expect(dockWidth(1440)).toBe(460);
    expect(dockWidth(1920)).toBe(460);
    expect(dockWidth(834)).toBe(360);
    expect(dockWidth(1100)).toBe(360);
    expect(dockWidth(1300)).toBe(416);
    const s = stage();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 390 });
    placeFloat(s.wrap, s.box, s.anchor, false);
    expect(s.wrap.style.maxWidth).toBe(`${390 - 2 * DOCK_INSET}px`);
    delete (document.documentElement as unknown as Record<string, unknown>).clientWidth;
  });

  test('a sheet on the HUD\'s top edge, as wide as the window (no max-width of the float\'s own), and without a HUD on the window\'s foot', () => {
    const s = stage();
    const out = placeFloat(s.wrap, s.box, s.anchor, true);
    expect(out.at).toBe('sheet');
    expect([s.wrap.style.left, s.wrap.style.right, s.wrap.style.bottom, s.wrap.style.maxWidth]).toEqual(['0px', '0px', '100px', 'none']);
    document.querySelector('.kb-hud')!.remove();
    placeFloat(s.wrap, s.box, s.anchor, true);
    expect(s.wrap.style.bottom).toBe('0px');
  });

  test('says how far the page must scroll to bring the anchor above a sheet, and none for an anchor already above it', () => {
    const low = stage({ anchor: { top: 620, left: 300, right: 330, bottom: 650 } });
    const sheetTop = 700 - 300;
    expect(placeFloat(low.wrap, low.box, low.anchor, true).over).toBe(650 - (sheetTop - 8));
    holder.innerHTML = '';
    const high = stage();
    expect(placeFloat(high.wrap, high.box, high.anchor, true).over).toBeLessThanOrEqual(0);
  });
});

describe('the room it takes from the page', () => {
  test('a dock takes its width and both gaps from the right, a sheet its height from the foot', () => {
    const d = stage();
    expect(placeFloat(d.wrap, d.box, d.anchor, false).room).toEqual({ right: dockWidth(1000) + 2 * DOCK_INSET, bottom: 0 });
    holder.innerHTML = '';
    const s = stage();
    /* The window is 800 high, the sheet stands from 400 (the HUD's top 700 less its 300) to the HUD. */
    expect(placeFloat(s.wrap, s.box, s.anchor, true).room).toEqual({ right: 0, bottom: 800 - 400 });
  });

  test('a sheet brings the whole post above it where the post fits there, and only the mark where it does not', () => {
    const fits = stage({ anchor: { top: 300, left: 300, right: 330, bottom: 330 } });
    expect(placeFloat(fits.wrap, fits.box, fits.anchor, true, fits.post).over).toBe(400 - (400 - 8));
    holder.innerHTML = '';
    const tall = stage({ anchor: { top: 300, left: 300, right: 330, bottom: 330 }, post: { top: 80, left: 100, right: 400, bottom: 900 } });
    expect(placeFloat(tall.wrap, tall.box, tall.anchor, true, tall.post).over).toBe(330 - (400 - 8));
  });

  test('is said on the root element while the float is open, and taken back when it closes', () => {
    const s = stage();
    const view = mount(s, false);
    const root = document.documentElement;
    expect(root.getAttribute('data-kb-float')).toBe('dock');
    expect(root.style.getPropertyValue('--kb-float-right')).toBe(`${dockWidth(1000) + 2 * DOCK_INSET}px`);
    expect(root.style.getPropertyValue('--kb-float-bottom')).toBe('0px');
    view.unmount();
    expect(root.getAttribute('data-kb-float')).toBeNull();
    expect(root.style.getPropertyValue('--kb-float-right')).toBe('');
  });

  test('a dock that moved the post out of the window scrolls it back in once, and not again for a placement that moves nothing', async () => {
    const scroll = vi.fn();
    window.scrollBy = scroll as unknown as typeof window.scrollBy;
    /* The page narrowed under the dock and the post stands 56px below the line 16px above the HUD (700 - 16 = 684). */
    const s = stage({ post: { top: 500, left: 100, right: 400, bottom: 740 } });
    mount(s, false, undefined, s.post);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenLastCalledWith(0, 740 - 684);
    window.dispatchEvent(new Event('resize'));
    await frame();
    expect(scroll).toHaveBeenCalledTimes(1);
  });
});

const kayfa = { api: {}, instance: {}, ui: { glass: testGlass }, settings: {} } as unknown as Kayfa;
const frame = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });

function mount(s: ReturnType<typeof stage>, sheet: boolean, anchorRef?: { current: HTMLElement | null }, keep?: HTMLElement) {
  return render(
    <KayfaProvider value={kayfa}>
      <Float label="Lens" surface="effect" anchor={anchorRef ?? { current: s.anchor }} keep={keep ? () => keep : undefined} sheet={sheet} onClose={() => {}}>
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

  test('a phone\'s address bar turning neither resizes a sheet nor scrolls the page: its room is the large viewport\'s', async () => {
    const scroll = vi.fn();
    window.scrollBy = scroll as unknown as typeof window.scrollBy;
    /* The large viewport is 856 high; the bar shows, so the window is 800 and the HUD (100 high) stands from 700. */
    const real = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return this.hasAttribute(PROBE_ATTRIBUTE) ? new DOMRect(0, 0, 0, 856) : real.call(this);
    });
    /* What the Lens holds is taller than its room, so the sheet is as tall as the room: 55% of the large viewport above the HUD. */
    height = 600;
    const s = stage({ anchor: { top: 620, left: 300, right: 330, bottom: 650 } });
    mount(s, true);
    const room = Math.floor((856 - 100 - 4) * 0.55);
    const wrap = document.querySelector<HTMLElement>('.kb-float')!;
    const box = wrap.firstElementChild as HTMLElement;
    expect(box.style.maxHeight).toBe(`${room}px`);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(document.documentElement.style.getPropertyValue('--kb-float-bottom')).toBe(`${100 + room}px`);
    /* The bar hides: the window is 856, and the HUD, the anchor and the post move down with the window's foot and top. */
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 856 });
    document.querySelector<HTMLElement>('.kb-hud')!.getBoundingClientRect = rectOf({ top: 756, left: 0, right: 1000, bottom: 856 });
    s.anchor.getBoundingClientRect = rectOf({ top: 620, left: 300, right: 330, bottom: 650 });
    window.dispatchEvent(new Event('resize'));
    await frame();
    expect(box.style.maxHeight).toBe(`${room}px`);
    expect(document.documentElement.style.getPropertyValue('--kb-float-bottom')).toBe(`${100 + room}px`);
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  test('a sheet is never taller than the room the window shows above the HUD', () => {
    /* A large viewport far past the window (a reading the window cannot show): the sheet still stops 4px under the window's top. */
    const real = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return this.hasAttribute(PROBE_ATTRIBUTE) ? new DOMRect(0, 0, 0, 2000) : real.call(this);
    });
    height = 1200;
    const s = stage();
    placeFloat(s.wrap, s.box, s.anchor, true);
    expect(s.box.style.maxHeight).toBe(`${700 - 4}px`);
  });

  test('nothing moved, nothing is placed: a scroll with the anchor and the float where they were leaves the placement alone', async () => {
    const s = stage();
    const view = mount(s, false);
    const wrap = view.container.ownerDocument.querySelector<HTMLElement>('.kb-float')!;
    wrap.style.top = '1px';
    window.dispatchEvent(new Event('scroll'));
    await frame();
    expect(wrap.style.top).toBe('1px');
    /* The HUD's top moved (a HUD that grows): the dock is as tall as the new room. */
    document.querySelector<HTMLElement>('.kb-hud')!.getBoundingClientRect = rectOf({ top: 600, left: 0, right: 1000, bottom: 800 });
    window.dispatchEvent(new Event('scroll'));
    await frame();
    expect(wrap.style.top).toBe(`${DOCK_INSET}px`);
    expect(view.container.ownerDocument.querySelector<HTMLElement>('.kb-float-box')!.style.height).toBe(`${600 - 2 * DOCK_INSET}px`);
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
    expect(wrap.style.top).toBe(`${DOCK_INSET}px`);
  });
});

describe('Esc', () => {
  test('is not the float\'s while the tree it opened from is leaving (inert, held for an exit)', async () => {
    const s = stage();
    const onClose = vi.fn();
    render(
      <KayfaProvider value={kayfa}>
        <Float label="Lens" surface="effect" anchor={{ current: s.anchor }} sheet={false} onClose={onClose}><button type="button">x</button></Float>
      </KayfaProvider>,
    );
    await frame();
    s.anchor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    s.anchor.setAttribute('inert', '');
    s.anchor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
