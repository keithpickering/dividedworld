/**
 * Heads Will Roll's effect (docs/plans/2026-11-27-season-two-cards-plan.md, Task 7; design sections 1.3 and 2): the post's live reaction tiles are round heads that the orbit
 * (orbit.ts) moves each frame, every head a real button in mass order, with the React head last. The deck is faked, so a test sees each press and each picker call; the frames
 * and the observers are faked and flushed by hand, and jsdom has no layout, so the host's box is the one `getBoundingClientRect` is told.
 */
import { useMemo, useState } from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Act } from '../../../../engine/ui/data/api.ts';
import type { CardView, EffectProps } from '../../../../engine/ui/cards/types.ts';
import type { Chip, ReactionDeck } from '../../../../engine/ui/reactions/deck.ts';
import { viewProblems } from '../../../../engine/ui/cards/lens-words.ts';
import { NO_INK } from '../../../../engine/ui/cards/claims.ts';
import { renderInWorld } from '../../../../engine/ui/test-world.tsx';
import { reelSeconds } from './orbit.ts';

/* The orbit is the real one; its steps are counted. */
const steps = vi.hoisted(() => ({ n: 0, project: 0, setHeads: 0, setSettings: 0, orbit: null as null | { bodies: () => readonly { id: string; size: number; sun: string | null; pace: number }[] } }));
vi.mock('./orbit.ts', async (original) => {
  const actual = await original<typeof import('./orbit.ts')>();
  return {
    ...actual,
    createOrbit: (...args: Parameters<typeof actual.createOrbit>) => {
      const orbit = actual.createOrbit(...args);
      steps.orbit = orbit;
      return { ...orbit, step: (dt: number) => { steps.n++; orbit.step(dt); }, project: () => { steps.project++; return orbit.project(); }, setHeads: (h: Parameters<typeof orbit.setHeads>[0]) => { steps.setHeads++; orbit.setHeads(h); }, setSettings: (x: Parameters<typeof orbit.setSettings>[0]) => { steps.setSettings++; orbit.setSettings(x); } };
    },
  };
});
import { HeadsWillRollEffect } from './Effect.tsx';

const post = { id: 'post-1', character: 'author', kind: 'post', thread: 't', payload: { body: 'Hello.' }, currentPayload: { body: 'Hello.' }, targetActId: null, seq: 1, createdAt: '2026-11-27T10:00:00.000Z', editedAt: null, shownEditedAt: null } as unknown as Act;
const chip = (key: string, emoji: string, count: number, extra: Partial<Chip> = {}): Chip => ({ key, name: key, emoji, quadrant: null, count, open: true, pending: null, local: false, ...extra });
/* Three kinds: the heaviest first is "fire" (6), then the Overreaction "wow" (2 x 2 = 4 by default), then "tea" (1). */
const CHIPS = [chip('tea', 'T', 1), chip('wow', 'W', 2, { local: true }), chip('fire', 'F', 6)];

interface DeckOptions { readonly chips?: readonly Chip[]; readonly canReact?: boolean; readonly own?: string[]; readonly refusal?: string | null }
function deckOf(o: DeckOptions = {}) {
  const press = vi.fn((_kind: string) => 'held' as const);
  const open = vi.fn();
  const deck: ReactionDeck = {
    chips: o.chips ?? CHIPS, own: (o.own ?? []).map((kind) => ({ act: `a-${kind}`, kind, character: 'c1' })), pending: [], canReact: o.canReact ?? true, press, undo: () => {},
    refusal: o.refusal ?? null, landed: null, picker: { isOpen: false, open, close: () => {} },
  };
  return { deck, press, open };
}

const propsOf = (deck: ReactionDeck | undefined, views: (CardView | null)[], still = false, covered = false): EffectProps => ({
  post, plays: [], states: {}, released: new Set<string>(), written: new Map(), reader: { author: false, caster: false }, place: 'thread', reach: 'post', still, moment: null,
  show: (v: CardView | null) => { views.push(v); }, met: () => {}, ink: NO_INK, holdScreen: () => {}, marks: null, save: async () => ({ ok: false as const, error: 'no' }), release: async () => ({ ok: false as const, error: 'no' }),
  nameOf: () => 'Spritey', give: async () => ({ ok: false as const, error: 'no' }), moreGifts: async () => {}, wallet: null, covered,
  ...(deck ? { reactions: deck } : {}),
  children: <p>Hello.</p>,
}) as unknown as EffectProps;

/* A fake rAF flushed by hand, a fake IntersectionObserver the test drives, and a 300 x 200 box. */
let queue = new Map<number, FrameRequestCallback>();
let nextId = 1;
const flush = (t: number) => { const run = [...queue.values()]; queue.clear(); for (const cb of run) cb(t); };
let observers: { cb: IntersectionObserverCallback; seen: Set<Element> }[] = [];
class FakeObserver {
  readonly entry = { cb: undefined as unknown as IntersectionObserverCallback, seen: new Set<Element>() };
  constructor(cb: IntersectionObserverCallback) { this.entry.cb = cb; observers.push(this.entry); }
  observe(el: Element) { this.entry.seen.add(el); }
  unobserve(el: Element) { this.entry.seen.delete(el); }
  disconnect() { this.entry.seen.clear(); }
  takeRecords() { return []; }
}
const see = (isIntersecting: boolean) => act(() => { for (const o of observers) for (const el of o.seen) o.cb([{ target: el, isIntersecting } as IntersectionObserverEntry], o as unknown as IntersectionObserver); });

function mount(deck: ReactionDeck | undefined, o: { still?: boolean; covered?: boolean } = {}) {
  const views: (CardView | null)[] = [];
  const world = renderInWorld(<HeadsWillRollEffect {...propsOf(deck, views, o.still ?? false, o.covered ?? false)} />);
  return { ...world, views };
}
const heads = () => screen.queryAllByRole('button');
const labels = () => heads().map((b) => b.getAttribute('aria-label'));

beforeEach(() => {
  queue = new Map(); nextId = 1; observers = []; steps.n = 0; steps.project = 0; steps.setHeads = 0; steps.setSettings = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { const id = nextId++; queue.set(id, cb); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { queue.delete(id); });
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({ x: 0, y: 0, left: 0, top: 0, right: 300, bottom: 200, width: 300, height: 200, toJSON: () => ({}) }));
  document.documentElement.setAttribute('data-kb-motion', 'full');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Heads Will Roll: the heads', () => {
  test('three kinds make three heads in mass order, with the React head last', () => {
    mount(deckOf().deck);
    expect(labels()).toEqual([
      'F 6, press to catch',
      'W 2, press to catch, an Overreaction',
      'T 1, press to catch',
      'React, press to pick a new reaction',
    ]);
  });

  test("a kind the reader sent says it is theirs, and a pending one says how to undo it", () => {
    mount(deckOf({ own: ['fire'], chips: [chip('fire', 'F', 6), chip('tea', 'T', 1, { pending: { kind: 'tea', until: 0 } as never })] }).deck);
    expect(labels().slice(0, 2)).toEqual(['F 6, press to catch, yours', 'T 1, press to catch, counting soon, press to undo']);
  });

  test('a new kind joins at a count of one, whatever its chip says', () => {
    mount(deckOf({ chips: [chip('fire', 'F', 6), chip('new', 'N', 0)] }).deck);
    expect(labels()[1]).toBe('N 1, press to catch');
  });

  test('a pointer press catches the head at once, once', () => {
    const { deck, press } = deckOf();
    mount(deck);
    fireEvent.pointerDown(heads()[0]!, { button: 0, pointerType: 'mouse' });
    fireEvent.click(heads()[0]!);
    expect(press).toHaveBeenCalledTimes(1);
    expect(press).toHaveBeenCalledWith('fire');
  });

  test('Enter starts a reel-in and the reaction lands after the computed time', () => {
    const { deck, press } = deckOf();
    const m = mount(deck);
    const seconds = reelSeconds(0, { reelBase: 0.8, reelPerSpeed: 0.12 });
    act(() => { fireEvent.keyDown(heads()[1]!, { key: 'Enter' }); });
    expect(press).not.toHaveBeenCalled();
    expect(document.querySelector('.dw-hwr-reel')).not.toBeNull();
    expect(lastView(m).state).toBe('Reeling in a head');
    act(() => { vi.advanceTimersByTime(seconds * 1000 - 1); });
    expect(press).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(2); });
    expect(press).toHaveBeenCalledTimes(1);
    expect(press).toHaveBeenCalledWith('wow');
    expect(document.querySelector('.dw-hwr-reel')).toBeNull();
  });

  test('Space reels in too, and a second Enter cancels it', () => {
    const { deck, press } = deckOf();
    mount(deck);
    act(() => { fireEvent.keyDown(heads()[0]!, { key: ' ' }); });
    expect(document.querySelector('.dw-hwr-reel')).not.toBeNull();
    act(() => { fireEvent.keyDown(heads()[0]!, { key: 'Enter' }); });
    expect(document.querySelector('.dw-hwr-reel')).toBeNull();
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(press).not.toHaveBeenCalled();
  });

  test('a press the browser reports only as a click (an assistive switch) reels in as a key does', () => {
    const { deck, press } = deckOf();
    mount(deck);
    act(() => { fireEvent.click(heads()[0]!); });
    expect(press).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(press).toHaveBeenCalledWith('fire');
  });

  test('under still the heads stand still and a pointer press reels in too, for the time the moving head would take', () => {
    const { deck, press } = deckOf();
    mount(deck, { still: true });
    see(true);
    expect(queue.size).toBe(0);
    const bodies = steps.orbit!.bodies();
    const secondsOf = (id: string) => {
      const b = bodies.find((x) => x.id === id)!;
      return reelSeconds(b.pace / b.size, { reelBase: 0.8, reelPerSpeed: 0.12 });
    };
    const sunId = bodies.find((b) => b.sun === null && b.id !== 'react')!.id;
    const satId = bodies.find((b) => b.sun !== null && b.id !== 'react')!.id;
    for (const id of [sunId, satId]) {
      const button = document.querySelector<HTMLElement>(`[data-head="${id}"]`)!;
      const key = id.slice(2);
      press.mockClear();
      fireEvent.pointerDown(button, { button: 0, pointerType: 'mouse' });
      fireEvent.click(button);
      const ms = secondsOf(id) * 1000;
      expect(ms).toBeGreaterThan(800);
      act(() => { vi.advanceTimersByTime(ms - 2); });
      expect(press).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(4); });
      expect(press).toHaveBeenCalledWith(key);
    }
    expect(steps.n).toBe(0);
  });

  test('a press that left without a click does not swallow a switch click that follows', () => {
    const { deck, press } = deckOf();
    mount(deck);
    fireEvent.pointerDown(heads()[0]!, { button: 0, pointerType: 'touch' });
    expect(press).toHaveBeenCalledTimes(1);
    fireEvent.pointerCancel(heads()[0]!);
    act(() => { fireEvent.click(heads()[0]!); });
    expect(document.querySelector('.dw-hwr-reel')).not.toBeNull();
  });

  test('a real touch tap (down, up, leave, click) catches a moving head exactly once', () => {
    const { deck, press } = deckOf();
    mount(deck);
    const h = heads()[0]!;
    fireEvent.pointerDown(h, { button: 0, pointerType: 'touch' });
    fireEvent.pointerUp(h, { button: 0, pointerType: 'touch' });
    fireEvent.pointerLeave(h, { pointerType: 'touch' });
    fireEvent.click(h);
    expect(press).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.dw-hwr-reel')).toBeNull();
  });

  test('a real touch tap under still starts one reel that lands once and is not cancelled by its click', () => {
    const { deck, press } = deckOf();
    mount(deck, { still: true });
    see(true);
    const h = heads()[0]!;
    fireEvent.pointerDown(h, { button: 0, pointerType: 'touch' });
    fireEvent.pointerUp(h, { button: 0, pointerType: 'touch' });
    fireEvent.pointerLeave(h, { pointerType: 'touch' });
    fireEvent.click(h);
    expect(document.querySelector('.dw-hwr-reel')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(press).toHaveBeenCalledTimes(1);
  });

  test('a press dragged off before release, with no click, does not swallow a later switch click', () => {
    const { deck } = deckOf();
    mount(deck);
    const h = heads()[0]!;
    fireEvent.pointerDown(h, { button: 0, pointerType: 'mouse' });
    fireEvent.pointerLeave(h, { pointerType: 'mouse' });
    act(() => { fireEvent.click(h); });
    expect(document.querySelector('.dw-hwr-reel')).not.toBeNull();
  });

  test('the React head opens the picker with only the new kinds, and a press on it needs no reel', () => {
    const { deck, open, press } = deckOf();
    mount(deck);
    const react = heads().at(-1)!;
    fireEvent.pointerDown(react, { button: 0, pointerType: 'mouse' });
    fireEvent.click(react);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(react, true);
    expect(press).not.toHaveBeenCalled();
  });

  test("on the author's own screen the heads are plain: no React head, no button, no press", () => {
    const { deck, press, open } = deckOf({ canReact: false });
    mount(deck);
    expect(heads()).toHaveLength(0);
    const plain = screen.getAllByRole('img');
    expect(plain.map((p) => p.getAttribute('aria-label'))).toEqual(['F 6', 'W 2, an Overreaction', 'T 1']);
    fireEvent.pointerDown(plain[0]!, { button: 0 });
    fireEvent.click(plain[0]!);
    expect(press).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  test('a refusal from the server is said in a status line', () => {
    mount(deckOf({ refusal: 'You have used all your reactions.' }).deck);
    expect(screen.getByRole('status').textContent).toContain('You have used all your reactions.');
  });

  test("the post's words are drawn, and a post without a deck (a moment, History) has words and no heads", () => {
    mount(undefined);
    expect(screen.getByText('Hello.')).toBeTruthy();
    expect(heads()).toHaveLength(0);
  });

  test('met is said once the post is in view on a live post, and never in a moment', () => {
    for (const [moment, said] of [[null, 1], [{ at: 1 }, 0]] as const) {
      const met = vi.fn();
      const props = { ...propsOf(deckOf().deck, []), met, moment } as EffectProps;
      const { unmount } = renderInWorld(<HeadsWillRollEffect {...props} />);
      see(true);
      expect(met).toHaveBeenCalledTimes(said);
      unmount();
    }
  });

  test('its Lens view is a short status that says how the reel-in works by key', () => {
    const m = mount(deckOf().deck);
    const view = lastView(m);
    expect(viewProblems(view, { holds: false, covers: false })).toEqual([]);
    expect(view.report).toMatch(/Enter or Space/);
    expect(view.report).toMatch(/again to cancel/);
  });
});

const lastView = (m: { views: (CardView | null)[] }) => m.views.filter(Boolean).at(-1)!;

describe('Heads Will Roll: what it costs', () => {
  test('an off-screen effect does not step, and one on screen steps each frame until it is covered or gone', () => {
    const m = mount(deckOf().deck);
    expect(queue.size).toBe(0);
    flush(16); flush(32);
    expect(steps.n).toBe(0);
    see(true);
    expect(queue.size).toBe(1);
    flush(16); flush(32); flush(48);
    expect(steps.n).toBe(3);
    see(false);
    expect(queue.size).toBe(0);
    flush(64);
    expect(steps.n).toBe(3);
    m.unmount();
  });

  test('a covered post does not step either', () => {
    mount(deckOf().deck, { covered: true });
    see(true);
    flush(16);
    expect(steps.n).toBe(0);
  });

  test('the loop is cancelled when the post goes', () => {
    const m = mount(deckOf().deck);
    see(true);
    expect(queue.size).toBe(1);
    m.unmount();
    expect(queue.size).toBe(0);
  });

  test("a head is moved by transform alone: a frame writes no left, top or font size", () => {
    mount(deckOf().deck);
    see(true);
    const before = heads().map((b) => [b.style.left, b.style.top, b.style.fontSize]);
    flush(16); flush(32);
    expect(heads().map((b) => [b.style.left, b.style.top, b.style.fontSize])).toEqual(before);
    expect(heads()[0]!.style.transform).toMatch(/translate/);
  });
});

/* A host whose chips and cover the test changes, so a reorder, a vanished kind and a cover are each a rerender of the same effect. */
function mountLive(first: readonly Chip[]) {
  const press = vi.fn((_kind: string) => 'held' as const);
  let setChips: (c: readonly Chip[]) => void = () => {};
  let setCovered: (c: boolean) => void = () => {};
  const views: (CardView | null)[] = [];
  function Host() {
    const [chips, c] = useState(first);
    const [covered, k] = useState(false);
    setChips = c; setCovered = k;
    const deck = useMemo(() => ({ ...deckOf({ chips }).deck, press }), [chips]);
    return <HeadsWillRollEffect {...propsOf(deck, views, false, covered)} />;
  }
  const world = renderInWorld(<Host />);
  return { ...world, press, chips: (c: readonly Chip[]) => act(() => setChips(c)), cover: (c: boolean) => act(() => setCovered(c)) };
}
const reelFirst = () => act(() => { fireEvent.keyDown(heads()[0]!, { key: 'Enter' }); });

describe('Heads Will Roll: the render order', () => {
  test("a mixed deck (an Overreaction kind and the React head) is drawn in the order the orbit projects", () => {
    const chips = [chip('a', 'A', 3), chip('b', 'B', 2, { local: true }), chip('c', 'C', 7), chip('d', 'D', 4, { local: true }), chip('e', 'E', 1)];
    mount(deckOf({ chips }).deck);
    const projected = steps.orbit!.bodies().map((b) => b.id);
    expect(heads().map((b) => b.getAttribute('data-head'))).toEqual(projected);
    expect(projected.at(-1)).toBe('react');
  });
});

describe('Heads Will Roll: what lets a reel go, and where focus stays', () => {
  test('unmounting clears the reel timer', () => {
    const m = mountLive(CHIPS);
    reelFirst();
    m.unmount();
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(m.press).not.toHaveBeenCalled();
  });

  test("a reel on a kind that left the post is let go", () => {
    const m = mountLive(CHIPS);
    reelFirst();
    m.chips(CHIPS.filter((c) => c.key !== 'fire'));
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(m.press).not.toHaveBeenCalled();
    expect(document.querySelector('.dw-hwr-reel')).toBeNull();
  });

  test('a cover over the post lets a reel go, and going off screen does not', () => {
    const m = mountLive(CHIPS);
    see(true);
    reelFirst();
    see(false);
    expect(document.querySelector('.dw-hwr-reel')).not.toBeNull();
    m.cover(true);
    expect(document.querySelector('.dw-hwr-reel')).toBeNull();
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(m.press).not.toHaveBeenCalled();
  });

  test('a head that has focus keeps it when a change of counts reorders the heads', () => {
    /* A browser drops focus from a node that is moved; jsdom keeps it, so the move is made to drop it here. */
    const insert = Node.prototype.insertBefore;
    let blurred = 0;
    vi.spyOn(Node.prototype, 'insertBefore').mockImplementation(function <T extends Node>(this: Node, node: T, ref: Node | null): T {
      if (node instanceof HTMLElement && node === document.activeElement) { blurred++; node.blur(); }
      return insert.call(this, node, ref) as T;
    });
    const m = mountLive(CHIPS);
    const fire = heads().find((b) => b.getAttribute('data-head') === 'k:fire')!;
    act(() => { fire.focus(); });
    expect(document.activeElement).toBe(fire);
    /* tea overtakes fire: the heads' order changes, and fire's node is the one that moves. */
    m.chips([chip('tea', 'T', 9), chip('wow', 'W', 2, { local: true }), chip('fire', 'F', 6)]);
    const order = heads().map((b) => b.getAttribute('data-head'));
    expect(order[0]).toBe('k:tea');
    expect(blurred, 'the reorder moved the focused head').toBeGreaterThan(0);
    expect(document.activeElement).toBe(heads().find((b) => b.getAttribute('data-head') === 'k:fire'));
  });

  test("the orbit is given the heads and settings by an effect, not by every render", () => {
    const m = mountLive(CHIPS);
    const before = [steps.setHeads, steps.setSettings];
    m.cover(true);
    m.cover(false);
    expect([steps.setHeads, steps.setSettings]).toEqual(before);
  });

  test('a press during a step reads the step\'s projection, and sorts nothing again', () => {
    mount(deckOf().deck);
    see(true);
    flush(16); flush(32);
    const n = steps.project;
    act(() => { fireEvent.keyDown(heads()[0]!, { key: 'Enter' }); });
    expect(steps.project).toBe(n);
  });

  test("the reel bar is inside the head's foot, never under it where the box's border would clip it", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const css = fs.readFileSync(path.join(here, 'heads-will-roll.css'), 'utf8');
    const rule = css.match(/\.dw-hwr-reel \{[^}]*\}/)![0];
    expect(rule).toMatch(/bottom:\s*\d+%/);
    expect(rule).not.toMatch(/top:\s*calc\(100%/);
  });
});

describe('Heads Will Roll: where it fills', () => {
  const rectOf = (w: number, h: number, left = 0, top = 0) => ({ x: left, y: top, left, top, right: left + w, bottom: top + h, width: w, height: h, toJSON: () => ({}) });
  const OUTER = { w: 900, h: 700 }, AREA = { w: 600, h: 300 };
  const places = (cls: string) => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.classList.contains('kb-act-main')) return rectOf(OUTER.w, OUTER.h);
      if (this.classList.contains('kb-origin-area')) return rectOf(AREA.w, AREA.h, 10, 40);
      return rectOf(300, 120, 20, 60);
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('kb-act-main') ? OUTER.w : this.classList.contains('kb-origin-area') ? AREA.w : 0; });
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('kb-act-main') ? OUTER.h : this.classList.contains('kb-origin-area') ? AREA.h : 0; });
    return cls;
  };
  const boxes = () => ['.dw-hwr-ground', '.dw-hwr-heads'].map((q) => { const el = document.querySelector<HTMLElement>(q)!; return [el.style.left, el.style.top, el.style.width, el.style.height]; });

  test("in a thread the ground and the heads' layer are the post body's box, border to border", () => {
    places('kb-act-main');
    renderInWorld(<div className="kb-act-main" data-kb-content-area><HeadsWillRollEffect {...propsOf(deckOf().deck, [])} /></div>);
    expect(boxes()).toEqual([['-20px', '-60px', '900px', '700px'], ['-20px', '-60px', '900px', '700px']]);
    expect(document.querySelector('[data-kb-hwr]')!.hasAttribute('data-kb-bleed')).toBe(true);
  });

  test("in the ORIGIN box they are the box's area, not the opening post's body around it", () => {
    places('kb-origin-area');
    renderInWorld(<div className="kb-act-main" data-kb-content-area><div className="kb-origin-area" data-kb-content-area><HeadsWillRollEffect {...propsOf(deckOf().deck, [])} place="origin" /></div></div>);
    expect(boxes()).toEqual([['-10px', '-20px', '600px', '300px'], ['-10px', '-20px', '600px', '300px']]);
  });
});
