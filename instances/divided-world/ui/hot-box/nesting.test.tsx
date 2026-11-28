/**
 * Cards on cards (docs/plans/2026-11-15-hot-box-fog-plan.md, Task 6; design section 4.4; issue #721): Hot Box nested with the two cards whose
 * controls it could have fought, rendered through the engine's `Effects` with the instance's real cards and real plays in both orders.
 *
 *  1. Whoops! and Hot Box where the post has no row (Hot Box fills the row, so it is outermost whatever the play order): the smoke draws no button of its own, so there is nothing of Hot Box's for Whoops! to make
 *     inert; its way to read is the Lens's hold, which is in its view and sweeps.
 *  2. Below the Fold inside Hot Box (the fold played first): while smoked the fold's bar is inside the inert words and so is its own Lens press,
 *     which works; after a finished sweep the bar is live and a click on it works.
 *  3. While the words are inert nothing inside them is lifted above the fog (`data-kb-over-ink` computes a z-index of 0, under the fog's 1),
 *     and in the read window it is lifted again (2). The cascade is read from the real sheets (hot-box.css and the engine's thread.css).
 *
 * jsdom has no canvas, frames or layout, so each is stubbed as Effect.test.tsx stubs them; the pixels are the board match's and e2e/hot-box.spec.ts's.
 */
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { PlayProvider } from '../../../../engine/ui/cards/play.tsx';
import { PostEffects } from '../../../../engine/ui/cards/Effects.tsx';
import { createPlays, type Plays } from '../../../../engine/ui/cards/plays.ts';
import type { CardView, KitControl } from '../../../../engine/ui/cards/types.ts';
import type { Act } from '../../../../engine/ui/data/api.ts';
import { createFake } from '../../../../engine/ui/data/fake.ts';
import { renderIn } from '../../../../engine/ui/test-world.tsx';
import { instance } from '../../index.ts';
import { cardsUi } from '../cards.ts';
import { forgetScratch, resetFogLadder } from './Effect.tsx';
/*
 * The cards' effects are lazy (their `ui.ts`): a first draw imports the module, which takes real time, while `ready` waits in fake time
 * (50 turns of the timers, each flushing what is due). Imported here, every effect this file draws is in the module cache before a test
 * mounts, so its lazy import answers within a turn however loaded the run is; Hot Box's own module is imported above for its helpers.
 */
import '../../cards/whoops/Effect.tsx';
import '../below-the-fold/Effect.tsx';

/* The post's lines, as Hot Box reads them from Whoops!'s `readLines` (jsdom cannot measure a range): three lines of the box, so a sweep is 6 s. */
vi.mock('../../cards/whoops/lines.ts', () => ({
  readLines: () => [
    { top: 0.1, bottom: 0.2, text: 'First line of the post.' },
    { top: 0.4, bottom: 0.5, text: 'Second line.' },
    { top: 0.7, bottom: 0.8, text: 'Third line.' },
  ],
}));

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-15T12:00:00Z');
const iso = (t: number) => new Date(t).toISOString();
const SWEEP_MS = 3 * 2000;
const BOX = { left: 0, top: 100, width: 800, height: 600 };

const post: Act = { id: 'p1', character: 'c1', kind: 'post', thread: 't1', targetActId: null, seq: 1, createdAt: '2026-11-15T11:00:00Z', payload: { body: 'hi' }, currentPayload: { body: 'hi' }, editedAt: null, shownEditedAt: null } as unknown as Act;
/** A card play on the post, as the plays' read gives it: the n-th played, a second apart. */
const played = (card: string, n: number, config: Record<string, unknown>, extra: Record<string, unknown> = {}): Act => ({
  id: `play-${card}`, character: 'c9', kind: 'card', thread: 't1', targetActId: 'p1', seq: null, createdAt: iso(NOW + n * 1000),
  payload: { card, message: '', config, layer: n, ...extra }, currentPayload: {}, editedAt: null, shownEditedAt: null,
} as unknown as Act);
const HOT_BOX = (n: number) => played('hot-box', n, { color: 'teal' }, { ends: iso(NOW + 3 * DAY) });
const WHOOPS = (n: number) => played('whoops', n, { color: '#ff3d7f', seed: 7 });
const FOLD = (n: number) => played('below-the-fold', n, {});

/* ---------------------------------------------------------------------------------------------- the stubs ---- */

let frames = new Map<number, FrameRequestCallback>();
let frameId = 0;

function stubBrowser() {
  HTMLCanvasElement.prototype.getContext = (function () {
    const ctx = {
      fillStyle: '' as unknown, globalAlpha: 1, globalCompositeOperation: 'source-over', imageSmoothingEnabled: false, imageSmoothingQuality: 'low',
      setTransform: () => {}, save: () => {}, restore: () => {}, beginPath: () => {}, clip: () => {}, fill: () => {}, rect: () => {}, arc: () => {},
      clearRect: () => {}, drawImage: () => {}, fillRect: () => {},
      createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => {},
    };
    return ctx;
  }) as unknown as HTMLCanvasElement['getContext'];
  globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof IntersectionObserver;
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  window.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => { frames.set(++frameId, cb); return frameId; });
  window.cancelAnimationFrame = vi.fn((id: number) => { frames.delete(id); });
  window.matchMedia = vi.fn((query: string) => ({
    media: query, onchange: null, matches: false, dispatchEvent: () => true, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  const rect = (el: HTMLElement) => (el.classList.contains('kb-act-main') ? BOX : el.classList.contains('dw-hotbox-words') ? BOX : { left: 0, top: 0, width: 0, height: 0 });
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const r = rect(this);
    return { ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height, toJSON: () => r } as DOMRect;
  };
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get(this: HTMLElement) { return this.classList.contains('kb-act-main') ? BOX.width : 0; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get(this: HTMLElement) { return this.classList.contains('kb-act-main') ? BOX.height : 0; } });
}
const runFrame = () => { const due = [...frames.values()]; frames.clear(); for (const cb of due) cb(0); };
/** Lets `ms` pass in steps, a frame after each, as Effect.test.tsx's `pass` does. */
function pass(ms: number, step = 100) {
  for (let left = ms; left > 0; left -= step) act(() => { vi.advanceTimersByTime(Math.min(step, left)); runFrame(); });
}

/* ---------------------------------------------------------------------------------------------- the page ---- */

/** The sheets' own text: hot-box.css and the engine's thread.css, the two the stacking is decided in. */
const HOT_BOX_CSS = readFileSync('instances/divided-world/ui/hot-box/hot-box.css', 'utf8');
const THREAD_CSS = readFileSync('engine/ui/thread/thread.css', 'utf8');

/**
 * The thread's post as `Effects` draws it: the instance's real cards, the plays given in play order, the words inside the post's content area (`.kb-act-main`)
 * under the effects. Every effect is lazy, so a test awaits the page with `ready`.
 */
function mount(cards: readonly Act[]) {
  const plays: Plays = createPlays();
  plays.add(cards);
  const world = createFake({ instance, now: () => Date.now() });
  const page = (
    <PlayProvider>
      <div className="kb-act-main" data-kb-content-area>
        <PostEffects plays={plays} post={post} place="thread" nameOf={() => 'Spritey'}>
          <p>The words of the post. <a href="https://example.com/">A link</a></p>
        </PostEffects>
      </div>
    </PlayProvider>
  );
  const out = renderIn(world, page, { instance, cards: cardsUi });
  return { plays, ...out };
}
type Page = ReturnType<typeof mount>;

/** Waits for the lazy effects to land: the Hot Box element is drawn (and Below the Fold's bar, where it is asked for). */
async function ready(p: Page, until: string) {
  for (let i = 0; i < 50 && !p.container.querySelector(until); i++) await act(async () => { await vi.advanceTimersByTimeAsync(10); });
  expect(p.container.querySelector(until), `${until} never drew`).not.toBeNull();
}
const hot = (p: Page) => p.plays.view('p1', 'hot-box');
const fold = (p: Page) => p.plays.view('p1', 'below-the-fold');
const wave = (p: Page): Extract<KitControl, { kind: 'hold' }> => hot(p)!.controls[0] as Extract<KitControl, { kind: 'hold' }>;
const bar = (p: Page) => p.container.querySelector<HTMLButtonElement>('button.dw-fold-bar')!;
const words = (p: Page) => p.container.querySelector<HTMLElement>('.dw-hotbox-words')!;
/** Every button that stands inside an inert subtree. */
const buttonsUnderInert = (p: Page) => [...p.container.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.closest('[inert]') !== null);

beforeEach(() => {
  frames = new Map(); frameId = 0;
  forgetScratch(); resetFogLadder();
  /* The painter's cost is read from `performance.now`: here time stands still unless a test moves it, so how loaded the run is never steps a post down a rung. */
  vi.spyOn(performance, 'now').mockImplementation(() => 0);
  vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  stubBrowser();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (window as { matchMedia?: unknown }).matchMedia;
  delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  delete (HTMLElement.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
  delete (HTMLElement.prototype as { clientWidth?: unknown }).clientWidth;
  delete (HTMLElement.prototype as { clientHeight?: unknown }).clientHeight;
  document.head.querySelectorAll('style[data-nesting]').forEach((s) => s.remove());
});

/* ================================================================================================ the tests ==== */

describe('Whoops! and Hot Box where the post has no row (Hot Box fills the row, so it is outermost)', () => {
  test('the smoke draws no button for Whoops! to make inert: none in the smoke, none inert', async () => {
    const p = mount([HOT_BOX(1), WHOOPS(2)]);
    await ready(p, '.dw-hotbox [data-kb-whoops-layout]');
    /* The nesting is the one under test: a card that fills the row ranks outside the others (`InstanceUi.rowOrder`), and where there is no row it wraps them, so Whoops!'s layout stands inside the smoke. */
    expect(p.container.querySelectorAll('.dw-hotbox button')).toHaveLength(0);
    expect(words(p)).toHaveAttribute('inert');
    expect(buttonsUnderInert(p)).toHaveLength(0);
  });

  test('Hot Box\'s hold is in its Lens view and sweeps; held to the end, the post is waved', async () => {
    const p = mount([HOT_BOX(1), WHOOPS(2)]);
    await ready(p, '.dw-hotbox [data-kb-whoops-layout]');
    const view = hot(p) as CardView;
    expect(view.controls).toHaveLength(1);
    expect(view.controls[0]).toMatchObject({ kind: 'hold', label: 'Wave the smoke' });
    expect(view.state).toBe('Smoke over the words');
    act(() => { wave(p).start(); });
    expect(hot(p)!.state).toBe('Waving it away');
    pass(SWEEP_MS);
    expect(hot(p)).toMatchObject({ state: 'Waved clear for you', yours: false });
    expect(words(p)).not.toHaveAttribute('inert');
    act(() => { wave(p).stop(); });
  });
});

describe('Below the Fold inside Hot Box (the fold played first)', () => {
  test('smoked: the bar is inside the inert words, and the fold\'s own Lens press works', async () => {
    const p = mount([FOLD(1), HOT_BOX(2)]);
    await ready(p, 'button.dw-fold-bar');
    expect(words(p)).toContainElement(bar(p));
    expect(bar(p).closest('[inert]')).toBe(words(p));
    expect(bar(p)).toHaveAttribute('aria-expanded', 'false');
    const press = fold(p)!.controls[0] as Extract<KitControl, { kind: 'press' }>;
    expect(press).toMatchObject({ kind: 'press', label: 'Show post' });
    act(() => { press.run(); });
    expect(bar(p)).toHaveAttribute('aria-expanded', 'true');
    expect(fold(p)).toMatchObject({ state: 'Open for you' });
  });

  test('after a finished sweep the bar is not inert and a click on it works', async () => {
    const p = mount([FOLD(1), HOT_BOX(2)]);
    await ready(p, 'button.dw-fold-bar');
    act(() => { wave(p).start(); });
    pass(SWEEP_MS);
    expect(hot(p)!.state).toBe('Waved clear for you');
    expect(bar(p).closest('[inert]')).toBeNull();
    expect(bar(p)).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(bar(p));
    expect(bar(p)).toHaveAttribute('aria-expanded', 'true');
    act(() => { wave(p).stop(); });
  });
});

/*
 * Case 3 is computed here, from the real sheets: jsdom reads the cascade for these selectors (the `[inert]` attribute selector and the engine's
 * `data-kb-content-area` rule), so the fold's bar is asked for its `z-index` as a reader's browser would. Under smoke it is 0, under the fog's own 1;
 * in the read window the engine's lift (2) stands. What a browser paints of that is e2e/hot-box.spec.ts's.
 */
describe('nothing inside the smoked words is lifted above the fog', () => {
  /* The suite's css option has already put every imported sheet in the document (hot-box.css among them): they are taken out, so the cascade is these two sheets' alone and a copy changed here is the one read. */
  beforeEach(() => { document.head.querySelectorAll('style').forEach((s) => s.remove()); });
  const load = (css: string) => { const s = document.createElement('style'); s.setAttribute('data-nesting', ''); s.textContent = css; document.head.appendChild(s); };
  const z = (el: Element) => getComputedStyle(el).zIndex;

  test('the bar computes z-index 0 while the words are inert, and the engine\'s 2 in the read window', async () => {
    load(THREAD_CSS);
    load(HOT_BOX_CSS);
    const p = mount([FOLD(1), HOT_BOX(2)]);
    await ready(p, 'button.dw-fold-bar');
    expect(bar(p)).toHaveAttribute('data-kb-over-ink');
    expect(words(p)).toHaveAttribute('inert');
    expect(Number(z(bar(p)))).toBeLessThan(1);
    expect(z(bar(p))).toBe('0');
    act(() => { wave(p).start(); });
    pass(SWEEP_MS);
    expect(words(p)).not.toHaveAttribute('inert');
    expect(z(bar(p))).toBe('2');
    act(() => { wave(p).stop(); });
  });

  test('every lifted element inside inert words computes under the fog\'s z-index', async () => {
    load(THREAD_CSS);
    load(HOT_BOX_CSS);
    const p = mount([FOLD(1), HOT_BOX(2)]);
    await ready(p, 'button.dw-fold-bar');
    const lifted = [...words(p).querySelectorAll('[data-kb-over-ink]')];
    expect(lifted.length).toBeGreaterThan(0);
    for (const el of lifted) expect(Number(z(el))).toBeLessThan(1);
  });
});
