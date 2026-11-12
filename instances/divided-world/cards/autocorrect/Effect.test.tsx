/**
 * Autocorrect's effect (docs/plans/2026-11-11-autocorrect-tape-plan.md, Task 6): the tape laid over every occurrence of each play's
 * phrase. The words stay in the line under it, with an anchor at each taped strip's start and the room after it; a layer over the
 * post draws the pieces. jsdom has no layout, so a stand-in lays every segment, room and Range out on one line at ten pixels a
 * letter and eight a break-space, a canvas ruler reads half an em a letter, and a size tag's class doubles the size it reads.
 * The hands (Task 7) are driven here by a held key on the anchor and by pointer events on a piece, with fake timers: the animation
 * frame loop ticks the state machine with the frame's time, so a hold is as long as the time that passes.
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { viewProblems } from '../../../../engine/ui/cards/lens-words.ts';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useState } from 'react';
import type { Act, EffectState } from '../../../../engine/ui/data/api.ts';
import type { CardPlay, CardView, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { BbCode } from '../../../../engine/ui/bbcode/render.tsx';
import * as loop from '../../../../engine/ui/shine/loop.ts';
import { probe } from '../../../../engine/ui/shine/loop.ts';
import css from './autocorrect.css?raw';
import { piecesOf } from './tape.ts';
import { renderInWorld } from '../../../../engine/ui/test-world.tsx';
import { AutocorrectEffect, LENS } from './Effect.tsx';
import { readRange } from '../../../../engine/ui/thread/SelectionQuote.tsx';
import { NO_INK } from '../../../../engine/ui/cards/claims.ts';

/* The board's tokens are not in jsdom: the residue's band is a light board's. */
vi.mock('../../../../engine/ui/shine/band.ts', async (original) => ({
  ...(await original<typeof import('../../../../engine/ui/shine/band.ts')>()),
  bandFor: () => ({ lo: 0.55, hi: 1, board: 'light', bright: false }),
}));

/* The shine loop as it is, with its registrations counted: a peel in hand must not register the residue host again. */
vi.mock('../../../../engine/ui/shine/loop.ts', async (original) => {
  const real = await original<typeof import('../../../../engine/ui/shine/loop.ts')>();
  return { ...real, register: vi.fn(real.register), unregister: vi.fn(real.unregister) };
});
const registrations = { register: vi.mocked(loop.register), unregister: vi.mocked(loop.unregister) };

/* The tape's model as it is, with the strip-wide work counted: a peel in hand must not redo it for every strip on the post. */
vi.mock('./tape.ts', async (original) => {
  const real = await original<typeof import('./tape.ts')>();
  return { ...real, piecesOf: vi.fn(real.piecesOf) };
});
const pieceWork = vi.mocked(piecesOf);

const QUOTE = '[quote=0f8fad5b-d9cb-469f-a165-70867728950e]Mario in a quote[/quote]';
const postOf = (body: string) => ({ id: 'post-1', character: 'author', kind: 'post', thread: 't', payload: { body }, currentPayload: { body }, targetActId: null, seq: 3, createdAt: '2026-11-03T10:00:00.000Z', editedAt: null, shownEditedAt: null }) as unknown as Act;
const playOf = (n: number, phrase: string, replacement: string): CardPlay => ({ id: `k${n}`, card: 'autocorrect', layer: n, caster: `c${n}`, message: '', config: { phrase, replacement }, playedAt: `2026-11-03T10:0${n}:00.000Z`, post: 'post-1' });
const ok = async (play: string) => ({ ok: true as const, value: { play, savedAt: '2026-11-03T11:00:00.000Z' } });
const savedOf = (state: unknown): EffectState => ({ state, savedAt: '2026-11-03T10:30:00.000Z', savedBy: 'author' }) as unknown as EffectState;

interface Options { readonly body?: string; readonly plays?: CardPlay[]; readonly states?: Record<string, EffectState>; readonly author?: boolean; readonly save?: EffectProps['save']; readonly still?: boolean }

function mount(o: Options = {}) {
  const save = vi.fn(o.save ?? (ok as unknown as EffectProps['save']));
  const views: (CardView | null)[] = [];
  let setBody: (b: string) => void = () => {};
  let setStates: (s: Record<string, EffectState>) => void = () => {};
  let bump: () => void = () => {};
  function Host() {
    const [body, set] = useState(o.body ?? 'Mario and mario, MARIO! ' + QUOTE);
    const [held, setHeld] = useState(o.states ?? {});
    const [, setN] = useState(0);
    setBody = set;
    setStates = setHeld;
    bump = () => setN((n) => n + 1);
    return (
      <AutocorrectEffect
        post={postOf(body)} plays={o.plays ?? [playOf(1, 'mario', 'Luigi')]} states={held} released={new Set()} written={new Map()} reader={{ author: o.author ?? false, caster: false }}
        place="thread" reach="post" still={o.still ?? false} save={save} release={async (play) => ({ ok: true, value: { play, releasedAt: '' } })} show={(v) => { views.push(v); }} met={() => {}}
        ink={NO_INK} holdScreen={() => {}} marks={null} nameOf={() => 'Spritey'} give={async () => ({ ok: false, error: 'no' })} moreGifts={async () => {}} wallet={null}
      >
        <BbCode text={body} />
      </AutocorrectEffect>
    );
  }
  const world = renderInWorld(<Host />);
  return { ...world, save, views, edit: (b: string) => act(() => setBody(b)), setStates: (st: Record<string, EffectState>) => act(() => setStates(st)), rerender: () => act(() => bump()) };
}
const anchors = () => [...document.querySelectorAll<HTMLElement>('[data-kb-ac-anchor]')];
const buttons = () => anchors().filter((a) => a.tagName === 'BUTTON');
const rooms = () => [...document.querySelectorAll<HTMLElement>('.dw-ac-room')];
const pieces = () => [...document.querySelectorAll<HTMLElement>('[data-kb-ac-piece]')];
/* The card's defaults (the test world sets none): the pick, then the pace. */
const PICK = 450;
const PACE = 90;
const wide = (el: HTMLElement) => Number.parseFloat(el.style.width);
const pass = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });
/** A key goes down on an anchor and is held for `ms`; it stays down until `letGo`. */
const hold = async (el: HTMLElement, ms: number) => { fireEvent.keyDown(el, { key: 'Enter' }); await pass(ms); };
const letGo = (el: HTMLElement | undefined) => { if (el) fireEvent.keyUp(el, { key: 'Enter' }); };
/** How long it takes the key to peel a piece `w` pixels wide: the pick, then the pace, and a few frames' grace. */
const through = (w: number) => PICK + (w / PACE) * 1000 + 80;
const stuckOnPage = () => pieces().map((p) => p.getAttribute('data-kb-ac-stuck'));
const last = (m: ReturnType<typeof mount>) => m.views.filter(Boolean).at(-1)!;

/* The stand-in layout: every segment, room and Range on one line. */
const rectOf = (el: Element) => {
  const host = el.closest('.dw-ac')!;
  let left = 0;
  for (const e of host.querySelectorAll('[data-kb-ac-seg], .dw-ac-room')) {
    const width = (e.textContent ?? '').length * (e.classList.contains('dw-ac-room') ? 8 : 10);
    if (e === el) return { left, right: left + width, top: 0, bottom: 20, width, height: 20, x: left, y: 0, toJSON: () => ({}) };
    left += width;
  }
  return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
};
const sizeOf = (el: Element) => { for (let e: Element | null = el; e; e = e.parentElement) { const n = /kb-bb-size-(\d)/u.exec(e.className)?.[1]; if (n) return 16 * 2; } return 16; };
/* A phone's narrow column: when set, every room breaks onto a second line. */
let phone: number | null = null;
let measures: ReturnType<typeof vi.spyOn>;
let resizes: { cb: () => void; watching: Set<Element> }[] = [];
class FakeResize {
  readonly entry = { cb: undefined as unknown as () => void, watching: new Set<Element>() };
  constructor(cb: () => void) { this.entry.cb = cb; resizes.push(this.entry); }
  observe(el: Element) { this.entry.watching.add(el); }
  unobserve(el: Element) { this.entry.watching.delete(el); }
  disconnect() { this.entry.watching.clear(); }
}
const resize = () => act(() => { for (const r of resizes) r.cb(); });

beforeEach(() => {
  pieceWork.mockClear();
  registrations.register.mockClear();
  registrations.unregister.mockClear();
  phone = null;
  document.documentElement.removeAttribute('data-kb-motion');
  resizes = [];
  vi.stubGlobal('ResizeObserver', FakeResize);
  const ctx: Record<string | symbol, unknown> = {
    font: '',
    measureText(text: string) { return { width: text.length * 0.5 * Number(/(\d+(?:\.\d+)?)px/u.exec(String(ctx.font))?.[1] ?? 16) }; },
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
  };
  const canvas = new Proxy(ctx, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => canvas) as never);
  measures = vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) { return (this.hasAttribute('data-kb-ac-seg') ? [rectOf(this)] : []) as unknown as DOMRectList; });
  (Range.prototype as unknown as { getClientRects: () => unknown[] }).getClientRects = function (this: Range) {
    return [...document.querySelectorAll('[data-kb-ac-seg], .dw-ac-room')].filter((e) => this.intersectsNode(e)).map((e) => {
      const r = rectOf(e);
      return phone !== null && e.classList.contains('dw-ac-room') ? { ...r, left: 0, right: r.width, top: 20, bottom: 40, y: 20 } : r;
    });
  };
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({ x: 0, y: 0, left: 0, top: 0, right: 300, bottom: 60, width: 300, height: 60, toJSON: () => ({}) }));
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation(((el: Element, pseudo?: string | null) => {
    const s = real(el, pseudo);
    return { fontSize: `${sizeOf(el)}px`, fontStyle: 'normal', fontWeight: '400', fontFamily: 'serif', getPropertyValue: (k: string) => s.getPropertyValue(k) };
  }) as never);
});
afterEach(() => {
  vi.useRealTimers();
  probe.reset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
  document.documentElement.removeAttribute('data-kb-motion');
});

describe('Autocorrect: the anchors', () => {
  test('every occurrence gets one anchor, named for the role, and none is inside a quote', () => {
    mount();
    expect(buttons()).toHaveLength(3);
    for (const a of buttons()) {
      expect(a).toHaveAccessibleName('Autocorrected text: “Luigi”. Hold Enter or Space to lift it and read under it');
      expect(a).toHaveAttribute('data-kb-quotable', 'shown');
      expect(a.closest('blockquote')).toBeNull();
    }
    expect(document.querySelector('blockquote')).toHaveTextContent('Mario in a quote');
    expect(document.querySelector('blockquote [data-kb-ac-anchor], blockquote [data-kb-ac-seg]')).toBeNull();
    /* The words under the tape are hidden from a screen reader as from the eye. */
    for (const w of document.querySelectorAll('[data-kb-ac-seg]')) {
      expect(w).toHaveAttribute('aria-hidden', 'true');
      expect(w).toHaveAttribute('data-kb-quotable', 'hidden');
    }
  });

  test('the author\'s anchor says it peels for good', () => {
    mount({ author: true });
    expect(buttons()[0]).toHaveAccessibleName('Autocorrected text: “Luigi”. Hold Enter or Space to peel it off for good');
  });

  test('where two plays overlap, only the top strip\'s anchor is in the tab order, and the next once the top is peeled', () => {
    const body = 'The big cats at the zoo are the best cats. I love cats, and big cats most of all.';
    const plays = [playOf(1, 'big cats', 'tiny dogs'), playOf(2, 'cats', 'kittens')];
    const first = () => anchors().filter((a) => a.getAttribute('aria-label')?.includes('“tiny dogs”') || a.getAttribute('aria-label')?.includes('“kittens”'));
    const m = mount({ body, plays });
    const tabs = (name: string) => buttons().filter((a) => a.getAttribute('aria-label')?.includes(`“${name}”`)).map((a) => a.tabIndex);
    expect(first()).toHaveLength(6);
    expect(tabs('kittens')).toEqual([0, 0, 0, 0]);
    expect(tabs('tiny dogs')).toEqual([-1, -1]);
    m.unmount();
    mount({ body, plays, states: { k2: savedOf({ peeled: [0] }) } });
    /* The first "cats" (inside the first "big cats") is peeled: that big cats strip is exposed now. */
    expect(buttons().filter((a) => a.getAttribute('aria-label')?.includes('“tiny dogs”')).map((a) => a.tabIndex)).toEqual([0, -1]);
  });

  test('the author holding Enter for the pick and the pull peels a strip; held for half of that, one stretch is saved with a peel line at the right share and kind 1', async () => {
    vi.useFakeTimers();
    const m = mount({ author: true, body: 'Mario' });
    const w = wide(pieces()[0]!);
    expect(w).toBeGreaterThan(50);
    await hold(buttons()[0]!, through(w));
    expect(buttons()).toHaveLength(0);
    expect(pieces()).toHaveLength(0);
    await pass(500);
    expect(m.save).toHaveBeenCalledWith('k1', { peeled: [0], clean: true });
    m.unmount();

    const half = mount({ author: true, body: 'Mario' });
    await hold(buttons()[0]!, PICK + (w / 2 / PACE) * 1000);
    letGo(buttons()[0]!);
    await pass(500);
    expect(half.save).toHaveBeenCalledTimes(1);
    const [, state] = half.save.mock.calls[0]! as unknown as [string, { peeled: number[]; stuck: Record<string, [number, number, number][]> }];
    expect(state.peeled).toEqual([]);
    expect(state.stuck['0']).toHaveLength(1);
    const [from, to, edges] = state.stuck['0']![0]!;
    expect(from).toBeCloseTo(0.5, 1);
    expect([to, edges]).toEqual([1, 3]);
    /* The roll waits at the peel line, and what is peeled shows its residue. */
    expect(document.querySelector('[data-kb-ac-roll="waiting"]')).not.toBeNull();
    expect(document.querySelector('.dw-ac-residue')).not.toBeNull();
  });

  test('a key let go before the pick is up keeps the strip; the pick is the same cost as a hand\'s', async () => {
    vi.useFakeTimers();
    const m = mount({ author: true, body: 'Mario' });
    await hold(buttons()[0]!, PICK - 100);
    letGo(buttons()[0]!);
    await pass(2000);
    expect(buttons()).toHaveLength(1);
    expect(stuckOnPage()).toEqual([`0.0-${wide(pieces()[0]!).toFixed(1)}`]);
    expect(m.save).not.toHaveBeenCalled();
  });

  test('a reader\'s held key peeks and lays down, and saves nothing', async () => {
    vi.useFakeTimers();
    const m = mount({ body: 'Mario' });
    await hold(buttons()[0]!, 300);
    expect(document.querySelector('.dw-ac-flap')).not.toBeNull();
    letGo(buttons()[0]!);
    await pass(5000);
    expect(document.querySelector('.dw-ac-flap')).toBeNull();
    expect(buttons()).toHaveLength(1);
    expect(m.save).not.toHaveBeenCalled();
  });

  test('Space held peels as Enter does', async () => {
    vi.useFakeTimers();
    const m = mount({ author: true, body: 'Mario' });
    fireEvent.keyDown(buttons()[0]!, { key: ' ' });
    await pass(through(wide(pieces()[0]!)));
    expect(buttons()).toHaveLength(0);
    await pass(500);
    expect(m.save).toHaveBeenCalledTimes(1);
  });

  test('letting go of another key does not end a hold', async () => {
    vi.useFakeTimers();
    mount({ author: true, body: 'Mario' });
    const w = wide(pieces()[0]!);
    fireEvent.keyDown(buttons()[0]!, { key: 'Enter' });
    await pass(300);
    fireEvent.keyUp(buttons()[0]!, { key: 'Shift' });
    await pass(through(w) - 300);
    expect(buttons()).toHaveLength(0);
  });

  test('strips follow the phrase through an edit: one edited away goes, one added comes', () => {
    const m = mount({ body: 'Mario and Mario' });
    expect(buttons()).toHaveLength(2);
    m.edit('Mario and Luigi');
    expect(buttons()).toHaveLength(1);
    m.edit('Mario, Mario and Mario');
    expect(buttons()).toHaveLength(3);
  });
});

describe('Autocorrect: the room', () => {
  test('a replacement wider than its words puts break-spaces right after the words, inside their formatting; a narrower one puts none', () => {
    mount({ body: '[b]Mar[/b]io', plays: [playOf(1, 'mario', 'Luigi')] });
    /* "Mario" is 50px; "Luigi" at 21.2px is 53px, with 5.6px of padding each side: 14px more, two spaces of 8px. */
    expect(rooms()).toHaveLength(1);
    expect(rooms()[0]!.textContent).toBe('  ');
    expect(rooms()[0]!.previousElementSibling).toHaveTextContent('io');
    expect(rooms()[0]!.parentElement?.tagName).toBe('DIV');
    document.body.innerHTML = '';
    mount({ body: 'Mario', plays: [playOf(1, 'mario', 'Wo')] });
    expect(rooms()).toHaveLength(0);
  });

  test('the room sits inside the formatting that ends the strip', () => {
    mount({ body: '[b]Mario[/b] ok', plays: [playOf(1, 'mario', 'Luigi')] });
    expect(rooms()[0]!.parentElement?.tagName).toBe('STRONG');
  });

  test('a break-space is measured in the size of the formatting the room sits in', () => {
    mount({ body: 'Mario and [size=5]Mario[/size]', plays: [playOf(1, 'mario', 'Luigi')] });
    /* The big Mario's space is twice as wide: one of 16px where the plain one needs two of 8px. */
    expect(rooms().map((r) => r.textContent!.length)).toEqual([2, 1]);
  });

  test('the next load: with strip 0 saved as peeled it has no room and no anchor, and its words are quotable', () => {
    mount({ body: 'Mario and Mario', states: { k1: savedOf({ peeled: [0] }) } });
    expect(rooms()).toHaveLength(1);
    expect(buttons()).toHaveLength(1);
    const seg = document.querySelector('[data-kb-ac-seg]')!;
    expect(seg).toHaveTextContent('Mario');
    expect(seg).not.toHaveAttribute('aria-hidden');
    expect(seg).not.toHaveAttribute('data-kb-quotable');
  });
});

describe('Autocorrect: the layout at a busy post\'s scale', () => {
  /* The work of one layout pass, counted where a per-strip pass over all strips shows: attribute reads on elements, elements returned by
   * the host's queries, ids split by the segment map's walk, and the boxes asked for. Linear work quadruples from 40 to 160, quadratic work sixteen-folds. */
  const workOf = (n: number) => {
    document.body.innerHTML = '';
    mount({ body: 'mario '.repeat(n), plays: [playOf(1, 'mario', 'Luigi')] });
    expect(document.querySelectorAll('[data-kb-ac-anchor]').length).toBeGreaterThanOrEqual(n);
    let work = 0;
    const dataset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'dataset')!;
    Object.defineProperty(HTMLElement.prototype, 'dataset', { configurable: true, get(this: HTMLElement) { work++; return dataset.get!.call(this); } });
    const realAll = Element.prototype.querySelectorAll;
    const realOne = Element.prototype.querySelector;
    const all = vi.spyOn(Element.prototype, 'querySelectorAll').mockImplementation(function (this: Element, sel: string) {
      const found = realAll.call(this, sel);
      /* The stand-in layout's own scan (rectOf) is not the card's. */
      if (sel !== '[data-kb-ac-seg], .dw-ac-room') work += found.length + 1;
      return found;
    });
    const one = vi.spyOn(Element.prototype, 'querySelector').mockImplementation(function (this: Element, sel: string) { work += 1; return realOne.call(this, sel); });
    const realSplit = String.prototype.split;
    String.prototype.split = function (this: string, sep: never, lim?: number) { if (sep === '-') work++; return realSplit.call(this, sep, lim); } as never;
    try { resize(); } finally {
      String.prototype.split = realSplit;
      Object.defineProperty(HTMLElement.prototype, 'dataset', dataset);
      all.mockRestore();
      one.mockRestore();
    }
    return { work };
  };

  test('one layout pass does linear work in the strips: 160 occurrences cost under six times what 40 do', () => {
    const small = workOf(40);
    const big = workOf(160);
    expect(small.work).toBeGreaterThan(0);
    expect(big.work / small.work).toBeLessThan(6);
  }, 60_000);
});

describe('Autocorrect: the tape', () => {
  test('each live strip is drawn as a piece over the post, with its paper drawn and the writing on it', () => {
    mount({ body: 'Mario', plays: [playOf(1, 'mario', 'Luigi')] });
    expect(pieces()).toHaveLength(1);
    const piece = pieces()[0]!;
    expect(piece.closest('.dw-ac-tape')).toHaveAttribute('aria-hidden', 'true');
    expect(piece.querySelector('canvas')).not.toBeNull();
    expect(piece.querySelector('.dw-ac-ink')).toHaveTextContent('Luigi');
    expect(piece).toHaveAttribute('data-kb-ac-drawn');
    expect(Number(piece.style.zIndex)).toBe(1);
  });

  test('a peeled strip has no piece, and the residue canvas is there under the others', () => {
    mount({ body: 'Mario and Mario', states: { k1: savedOf({ peeled: [0] }) } });
    expect(pieces()).toHaveLength(1);
    expect(document.querySelector('.dw-ac-residue')).not.toBeNull();
  });

  test('a half-peeled strip keeps its tape only where it is stuck, and residue where it was peeled', () => {
    mount({ body: 'Mario', states: { k1: savedOf({ peeled: [], stuck: { 0: [[0.5, 1, 3]] } }) } });
    expect(pieces()).toHaveLength(1);
    const body = pieces()[0]!.querySelector<HTMLElement>('.dw-ac-body')!;
    expect(body.style.maskImage || body.getAttribute('style')).toMatch(/linear-gradient/u);
    /* The roll waits at the saved peel line, and it is not inside the masked body. */
    expect(document.querySelector('[data-kb-ac-roll="waiting"]')?.closest('.dw-ac-body')).toBeNull();
    expect(document.querySelector('.dw-ac-residue')).not.toBeNull();
  });

  test('the anchor\'s focus draws the ring around its pieces', () => {
    mount({ body: 'Mario' });
    expect(pieces()[0]).not.toHaveAttribute('data-kb-focus');
    act(() => { buttons()[0]!.focus(); });
    expect(pieces()[0]).toHaveAttribute('data-kb-focus', 'true');
    act(() => { buttons()[0]!.blur(); });
    expect(pieces()[0]).not.toHaveAttribute('data-kb-focus');
  });

  test('a play\'s moment (still) draws the pieces but no pressable anchor, and nothing is saved', async () => {
    vi.useFakeTimers();
    const m = mount({ author: true, still: true });
    expect(pieces()).toHaveLength(3);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(anchors()).toHaveLength(3);
    for (const a of anchors()) { expect(a).toHaveAttribute('data-kb-quotable', 'shown'); expect(a).not.toHaveAttribute('tabindex'); }
    expect(resizes.every((r) => r.watching.size === 0)).toBe(true);
    expect(probe.running()).toBe(false);
    expect(m.save).not.toHaveBeenCalled();
  });

  test('measuring runs on mount and on a resize of the post, and never on a pointer move', () => {
    mount({ body: 'Mario and Mario' });
    const onMount = measures.mock.calls.length;
    expect(onMount).toBeGreaterThan(0);
    const post = document.querySelector('.dw-ac')!;
    fireEvent.pointerMove(post, { clientX: 5, clientY: 5, pointerId: 1 });
    fireEvent.pointerDown(post, { clientX: 5, clientY: 5, pointerId: 1 });
    fireEvent.pointerUp(post, { clientX: 50, clientY: 5, pointerId: 1 });
    expect(measures.mock.calls.length).toBe(onMount);
    resize();
    expect(measures.mock.calls.length).toBeGreaterThan(onMount);
  });

  test('the Lens\'s residue rides the loop as one quiet host: nothing is registered with no residue', () => {
    mount({ body: 'Mario' });
    expect(document.querySelector('.dw-ac-residue')).toBeNull();
    expect(probe.running()).toBe(false);
  });
});

describe('Autocorrect: saving the author\'s peel', () => {
  test('the author\'s peel is saved by place, and the last one says clean', async () => {
    vi.useFakeTimers();
    const m = mount({ author: true, states: { k1: savedOf({ peeled: [0, 2] }) } });
    expect(buttons()).toHaveLength(1);
    await hold(buttons()[0]!, through(wide(pieces()[0]!)));
    await pass(500);
    expect(m.save).toHaveBeenCalledWith('k1', { peeled: [0, 1, 2], clean: true });
  });

  test('a saved stuck stretch of a strip still half peeled is sent back as it was', async () => {
    vi.useFakeTimers();
    const m = mount({ author: true, states: { k1: savedOf({ peeled: [0], stuck: { 1: [[0.5, 1, 3]] } }) } });
    const two = buttons().find((b) => b.getAttribute('data-kb-ac-anchor') === 'k1:2')!;
    await hold(two, through(wide(pieces().find((p) => p.getAttribute('data-kb-ac-piece') === 'k1:2')!)));
    await pass(500);
    expect(m.save).toHaveBeenCalledWith('k1', { peeled: [0, 2], stuck: { 1: [[0.5, 1, 3]] } });
  });

  test('the author\'s changes go in one save, one at a time, each later one after the last is answered', async () => {
    vi.useFakeTimers();
    let answer: (v: Awaited<ReturnType<EffectProps['save']>>) => void = () => {};
    const save = vi.fn(() => new Promise<Awaited<ReturnType<EffectProps['save']>>>((r) => { answer = r; }));
    mount({ author: true, save: save as unknown as EffectProps['save'] });
    await hold(buttons()[0]!, through(wide(pieces()[0]!)));
    await pass(500);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith('k1', { peeled: [0] });
    await hold(buttons()[0]!, through(wide(pieces()[0]!)));
    await pass(500);
    expect(save).toHaveBeenCalledTimes(1);
    await hold(buttons()[0]!, through(wide(pieces()[0]!)));
    await act(async () => { answer({ ok: true, value: { play: 'k1', savedAt: '' } }); });
    await pass(500);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('k1', { peeled: [0, 1, 2], clean: true });
  });

  test('a half peel is saved too, and the next change after it carries both', async () => {
    vi.useFakeTimers();
    const m = mount({ author: true, body: 'Mario and Mario' });
    await hold(buttons()[0]!, PICK + 500);
    letGo(buttons()[0]!);
    await pass(500);
    expect(m.save).toHaveBeenCalledTimes(1);
    const first = m.save.mock.calls[0]![1] as { peeled: number[]; stuck: Record<string, unknown> };
    expect(first.peeled).toEqual([]);
    expect(Object.keys(first.stuck)).toEqual(['0']);
    await hold(buttons()[1]!, through(wide(pieces()[1]!)));
    letGo(buttons()[1]!);
    await pass(500);
    const second = m.save.mock.calls[1]![1] as { peeled: number[]; stuck: Record<string, unknown> };
    expect(second.peeled).toEqual([1]);
    expect(second.stuck['0']).toEqual(first.stuck['0']);
  });

  test('an author\'s peel made just before leaving the post is still saved', async () => {
    vi.useFakeTimers();
    const m = mount({ author: true, body: 'Mario' });
    await hold(buttons()[0]!, through(wide(pieces()[0]!)));
    expect(m.save).not.toHaveBeenCalled();
    m.unmount();
    expect(m.save).toHaveBeenCalledWith('k1', { peeled: [0], clean: true });
  });

  test('peeling the focused strip keeps the reader\'s place: focus goes to the next exposed strip, or to the post, and the peel is said', async () => {
    vi.useFakeTimers();
    mount({ body: 'Mario and Mario', author: true });
    buttons()[0]!.focus();
    await hold(buttons()[0]!, through(wide(pieces()[0]!)));
    letGo(buttons()[0]!);
    expect(document.activeElement).toBe(buttons()[0]);
    expect(buttons()[0]).toHaveAttribute('data-kb-ac-anchor', 'k1:1');
    expect(screen.getAllByRole('status').at(-1)).toHaveTextContent('Peeled. Under it: “Mario”.');
    await hold(buttons()[0]!, through(wide(pieces()[0]!)));
    expect(buttons()).toHaveLength(0);
    expect(document.activeElement).toBe(document.querySelector('[data-kb-autocorrect]'));
  });

  test('a save that got no answer is sent again, later; one the card refuses is said, and only the change it carried comes back', async () => {
    vi.useFakeTimers();
    const answers = [{ ok: false, error: 'lost', uncertain: true }, { ok: true, value: { play: 'k1', savedAt: '' } }];
    const save = vi.fn(async () => answers.shift()!);
    mount({ author: true, body: 'Mario', save: save as unknown as EffectProps['save'] });
    await hold(buttons()[0]!, through(wide(pieces()[0]!)));
    await pass(500);
    expect(save).toHaveBeenCalledTimes(1);
    await pass(2000);
    expect(save).toHaveBeenCalledTimes(2);

    const refused = vi.fn(async () => ({ ok: false as const, error: 'a share is from 0 to 1' }));
    document.body.innerHTML = '';
    mount({ author: true, save: refused as unknown as EffectProps['save'] });
    const only = buttons()[0]!;
    await hold(only, through(wide(pieces()[0]!)));
    letGo(only);
    expect(buttons()).toHaveLength(2);
    await pass(500);
    expect(refused).toHaveBeenCalledTimes(1);
    expect(buttons()).toHaveLength(3);
    expect(screen.getAllByRole('status').at(-1)).toHaveTextContent('a share is from 0 to 1');
  });

  test('a refusal puts back only what it carried: a strip changed since keeps its own change for the next save', async () => {
    vi.useFakeTimers();
    let answer: (v: Awaited<ReturnType<EffectProps['save']>>) => void = () => {};
    const save = vi.fn(() => new Promise<Awaited<ReturnType<EffectProps['save']>>>((r) => { answer = r; }));
    mount({ author: true, body: 'Mario and Mario', save: save as unknown as EffectProps['save'] });
    const first = buttons()[0]!;
    await hold(first, through(wide(pieces()[0]!)));
    letGo(first);
    await pass(500);
    expect(save).toHaveBeenCalledTimes(1);
    const second = buttons()[0]!;
    await hold(second, through(wide(pieces()[0]!)));
    letGo(second);
    expect(buttons()).toHaveLength(0);
    await act(async () => { answer({ ok: false, error: 'refused' }); });
    expect(buttons()).toHaveLength(1);
    expect(buttons()[0]).toHaveAttribute('data-kb-ac-anchor', 'k1:0');
  });
});

describe('Autocorrect: the hands on a piece', () => {
  const down = (el: Element, x: number, id = 1) => fireEvent.pointerDown(el, { clientX: x, clientY: 5, pointerId: id, pointerType: 'mouse', button: 0, isPrimary: true });
  const move = (el: Element, x: number, id = 1) => fireEvent.pointerMove(el, { clientX: x, clientY: 5, pointerId: id, pointerType: 'mouse' });
  const up = (el: Element, id = 1) => fireEvent.pointerUp(el, { pointerId: id, pointerType: 'mouse' });

  test('a reader\'s peek folds a flap in perspective from the end, lays down after its stay, and saves nothing', async () => {
    vi.useFakeTimers();
    const m = mount({ body: 'Mario' });
    const piece = pieces()[0]!;
    down(piece, 2);
    move(piece, 40);
    await pass(40);
    const flap = document.querySelector<HTMLElement>('.dw-ac-flap')!;
    expect(flap).not.toBeNull();
    expect(flap.style.transform).toMatch(/^perspective\(\d+px\) rotateY\(-?[\d.]+deg\)$/u);
    expect(flap.style.transformOrigin).toBe('right center');
    expect(Number.parseFloat(flap.style.width)).toBeGreaterThan(30);
    /* The words under the lifted part show: it is no longer stuck. */
    expect(stuckOnPage()[0]).toMatch(/^0\.0-/u);
    up(piece);
    await pass(200);
    expect(document.querySelector('.dw-ac-flap')).not.toBeNull();
    await pass(2000);
    expect(document.querySelector('.dw-ac-flap')).toBeNull();
    expect(m.save).not.toHaveBeenCalled();
    await pass(2000);
    expect(m.save).not.toHaveBeenCalled();
  });

  test('a reader pressing a piece again before it is down picks the peek up where it is', async () => {
    vi.useFakeTimers();
    mount({ body: 'Mario' });
    const piece = pieces()[0]!;
    down(piece, 2);
    move(piece, 30);
    await pass(40);
    up(piece);
    await pass(320);
    const before = Number.parseFloat(document.querySelector<HTMLElement>('.dw-ac-flap')!.style.width);
    expect(before).toBeLessThan(28);
    expect(before).toBeGreaterThan(15);
    down(piece, 5, 2);
    move(piece, 25, 2);
    await pass(40);
    expect(Number.parseFloat(document.querySelector<HTMLElement>('.dw-ac-flap')!.style.width)).toBeCloseTo(before + 20, 0);
  });

  test('the author picks an end with the pointer and pulls the tape off at the pace, the roll waiting where it is let go', async () => {
    vi.useFakeTimers();
    const m = mount({ author: true, body: 'Mario' });
    const piece = pieces()[0]!;
    const w = wide(piece);
    down(piece, 3);
    await pass(PICK - 100);
    expect(document.querySelector('.dw-ac-corner')).not.toBeNull();
    expect(stuckOnPage()).toEqual([`0.0-${w.toFixed(1)}`]);
    await pass(200);
    expect(document.querySelector('.dw-ac-corner')).toBeNull();
    /* A hand a little ahead of the line takes the tape at the pace: about 90px in a second would be the whole piece, so go half a second. */
    for (let i = 0; i < 30; i++) { move(piece, Math.min(w - 3, Number.parseFloat(stuckOnPage()[0]!.split('-')[0]!) + 12)); await pass(16); }
    up(piece);
    const lo = Number.parseFloat(stuckOnPage()[0]!.split('-')[0]!);
    expect(lo).toBeGreaterThan(20);
    expect(lo).toBeLessThan(60);
    expect(document.querySelector('[data-kb-ac-roll="waiting"]')).not.toBeNull();
    await pass(500);
    expect(m.save).toHaveBeenCalledTimes(1);
    expect((m.save.mock.calls[0]![1] as { stuck: Record<string, [number, number, number][]> }).stuck['0']![0]![2]).toBe(3);
  });

  test('a press away from an end does nothing', async () => {
    vi.useFakeTimers();
    const m = mount({ author: true, body: 'Mario', plays: [playOf(1, 'mario', 'Mr. Mario Mario')] });
    const piece = pieces()[0]!;
    const w = wide(piece);
    expect(w).toBeGreaterThan(80);
    down(piece, w / 2);
    await pass(2000);
    expect(document.querySelector('.dw-ac-corner')).toBeNull();
    expect(stuckOnPage()).toEqual([`0.0-${w.toFixed(1)}`]);
    expect(m.save).not.toHaveBeenCalled();
  });

  test('pressing a covered strip says another strip is over it, and moves nothing', async () => {
    vi.useFakeTimers();
    const m = mount({ author: true, body: 'Mario Kart', plays: [playOf(1, 'mario kart', 'Wii Sports'), playOf(2, 'mario', 'Luigi')] });
    const under = pieces().find((p) => p.getAttribute('data-kb-ac-piece') === 'k1:0')!;
    const before = stuckOnPage();
    down(under, 3);
    await pass(2000);
    expect(screen.getAllByRole('status').at(-1)).toHaveTextContent('Another strip is stuck over this one. That one comes off first.');
    expect(stuckOnPage()).toEqual(before);
    expect(document.querySelector('.dw-ac-corner')).toBeNull();
    expect(m.save).not.toHaveBeenCalled();
    up(under);
  });

  test('a reader\'s peek on a stack lifts the strip beneath on the same pull', async () => {
    vi.useFakeTimers();
    mount({ body: 'Mario Kart', plays: [playOf(1, 'mario kart', 'Wii Sports'), playOf(2, 'mario', 'Luigi')] });
    const top = pieces().find((p) => p.getAttribute('data-kb-ac-piece') === 'k2:0')!;
    down(top, 2);
    move(top, wide(top) + 40);
    await pass(40);
    const lifted = pieces().filter((p) => p.querySelector('.dw-ac-flap'));
    expect(lifted.map((p) => p.getAttribute('data-kb-ac-piece')).sort()).toEqual(['k1:0', 'k2:0']);
    up(top);
  });

  test('a strip torn by a hand too far ahead needs a new pick at the torn end', async () => {
    vi.useFakeTimers();
    const m = mount({ author: true, body: 'Mario', plays: [playOf(1, 'mario', 'Mr. Mario Mario')] });
    const piece = pieces()[0]!;
    const w = wide(piece);
    down(piece, 3);
    await pass(PICK + 20);
    move(piece, w - 4);
    await pass(100);
    expect(piece.querySelector('.dw-ac-body')).toHaveAttribute('data-tension');
    await pass(3000);
    const torn = Number.parseFloat(stuckOnPage()[0]!.split('-')[0]!);
    expect(torn).toBeGreaterThan(0);
    expect(document.querySelector('[data-kb-ac-roll]')).toBeNull();
    expect(piece.querySelector<HTMLElement>('.dw-ac-body')!.style.clipPath).toMatch(/^path\(/u);
    up(piece);
    await pass(500);
    expect((m.save.mock.calls[0]![1] as { stuck: Record<string, [number, number, number][]> }).stuck['0']![0]![2]).toBe(6);
    /* The same hold again, with no new pick, goes nowhere; a new pick carries on. */
    const after = stuckOnPage()[0];
    down(piece, torn + 3, 2);
    await pass(200);
    move(piece, torn + 20, 2);
    await pass(200);
    expect(stuckOnPage()[0]).toBe(after);
    await pass(PICK);
    for (let i = 0; i < 10; i++) { move(piece, Number.parseFloat(stuckOnPage()[0]!.split('-')[0]!) + 12, 2); await pass(16); }
    expect(Number.parseFloat(stuckOnPage()[0]!.split('-')[0]!)).toBeGreaterThan(torn + 5);
    up(piece, 2);
  });

  const rafSteps = () => vi.spyOn(globalThis, 'requestAnimationFrame');
  const stepsOf = (spy: ReturnType<typeof rafSteps>) => spy.mock.calls.filter(([cb]) => (cb as { name?: string }).name === 'step').length;

  test('a finished piece unmounts under a held pointer: the hand lets go, the next press works, and the loop stops', async () => {
    vi.useFakeTimers();
    phone = 40;
    mount({ author: true, body: 'Mario' });
    expect(pieces()).toHaveLength(2);
    const first = pieces()[0]!;
    down(first, 3);
    await pass(PICK + 20);
    for (let i = 0; i < 60; i++) { move(first, Math.min(49, 12 + i * 1.44)); await pass(16); }
    expect(pieces()).toHaveLength(1);
    const spy = rafSteps();
    await pass(600);
    expect(stepsOf(spy)).toBe(0);
    /* The line break left a peel line, where no pick is needed: the press is taken at once (not prevented-not, i.e. prevented). */
    expect(down(pieces()[0]!, 3, 2)).toBe(false);
    await pass(200);
    expect(stepsOf(spy)).toBeGreaterThan(0);
  });

  test('a pointerup or pointercancel anywhere in the window lets a held hand go', async () => {
    vi.useFakeTimers();
    mount({ author: true, body: 'Mario' });
    const piece = pieces()[0]!;
    down(piece, 3);
    await pass(200);
    expect(document.querySelector('.dw-ac-corner')).not.toBeNull();
    fireEvent.pointerUp(window, { pointerId: 1 });
    await pass(50);
    expect(document.querySelector('.dw-ac-corner')).toBeNull();
    down(piece, 3, 2);
    await pass(200);
    expect(document.querySelector('.dw-ac-corner')).not.toBeNull();
    fireEvent.pointerCancel(window, { pointerId: 2 });
    await pass(50);
    expect(document.querySelector('.dw-ac-corner')).toBeNull();
  });

  test('the window stops listening once the held hand is let go', async () => {
    vi.useFakeTimers();
    mount({ author: true, body: 'Mario' });
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    down(pieces()[0]!, 3);
    await pass(200);
    const ups = added.mock.calls.filter(([t]) => t === 'pointerup').length;
    expect(ups).toBe(1);
    fireEvent.pointerUp(window, { pointerId: 1 });
    await pass(50);
    expect(removed.mock.calls.filter(([t]) => t === 'pointerup' || t === 'pointercancel').length).toBe(2);
  });

  test('a peek held still lets the loop rest, and a move wakes it', async () => {
    vi.useFakeTimers();
    mount({ body: 'Mario' });
    const piece = pieces()[0]!;
    down(piece, 2);
    move(piece, 30);
    await pass(100);
    const spy = rafSteps();
    await pass(500);
    expect(stepsOf(spy)).toBe(0);
    move(piece, 40);
    await pass(40);
    expect(stepsOf(spy)).toBeGreaterThan(0);
    expect(Number.parseFloat(document.querySelector<HTMLElement>('.dw-ac-flap')!.style.width)).toBeCloseTo(40, 0);
  });

  test('pointer events land only on the tape still stuck and the grip at its ends: the peeled part leaves the post\'s link alone', () => {
    mount({ body: 'Mario [url=https://x.example]a link[/url] now', plays: [playOf(1, 'mario', 'Luigi')], states: { k1: savedOf({ peeled: [], stuck: { 0: [[0.5, 1, 3]] } }) } });
    const piece = pieces()[0]!;
    const w = wide(piece);
    expect(css).not.toMatch(/\.dw-ac-piece\[data-kb-ac-hand\]\s*\{[^}]*pointer-events:\s*auto/u);
    expect(css).toMatch(/\.dw-ac-hit\s*\{[^}]*pointer-events:\s*auto/u);
    const hits = [...piece.querySelectorAll<HTMLElement>('.dw-ac-hit')];
    expect(hits).toHaveLength(1);
    const left = Number.parseFloat(hits[0]!.style.left), right = left + Number.parseFloat(hits[0]!.style.width);
    expect(left).toBeGreaterThan(5);
    expect(left).toBeLessThanOrEqual(w / 2);
    expect(left).toBeGreaterThanOrEqual(w / 2 - 20);
    expect(right).toBeCloseTo(w, 0);
    const link = document.querySelector('a')!;
    expect(fireEvent.click(link)).toBe(true);
  });

  test('a press that is not taken (covered, or not at an end) is not prevented, and a covered one still says its line', async () => {
    vi.useFakeTimers();
    mount({ author: true, body: 'Mario Kart', plays: [playOf(1, 'mario kart', 'Wii Sports'), playOf(2, 'mario', 'Luigi')] });
    const under = pieces().find((p) => p.getAttribute('data-kb-ac-piece') === 'k1:0')!;
    expect(down(under, 3)).toBe(true);
    expect(screen.getAllByRole('status').at(-1)).toHaveTextContent('Another strip is stuck over this one. That one comes off first.');
    up(under);
    document.body.innerHTML = '';
    mount({ author: true, body: 'Mario', plays: [playOf(1, 'mario', 'Mr. Mario Mario')] });
    const wideOne = pieces()[0]!;
    expect(down(wideOne, wide(wideOne) / 2, 2)).toBe(true);
    expect(down(wideOne, 3, 3)).toBe(false);
  });

  test('a peel in hand redoes only the strip in hand, not every strip on the post, and the Lens is not told every frame', async () => {
    vi.useFakeTimers();
    const m = mount({ author: true, body: Array.from({ length: 50 }, () => 'Mario').join(' ') });
    expect(pieces()).toHaveLength(50);
    const told = m.views.length;
    pieceWork.mockClear();
    const spy = rafSteps();
    await hold(buttons()[0]!, PICK + 900);
    const frames = stepsOf(spy);
    expect(frames).toBeGreaterThan(40);
    expect(pieceWork.mock.calls.length / frames).toBeLessThan(3);
    expect(m.views.length - told).toBeLessThan(5);
    letGo(buttons()[0]!);
    await pass(100);
    expect(last(m).progress).toBeGreaterThan(0);
  });

  test('a saved stuck state from a desktop width loads at a phone width with the same shares stuck', () => {
    const body = 'Mario';
    const states = { k1: savedOf({ peeled: [], stuck: { 0: [[0.25, 0.9, 4]] } }) };
    const share = () => {
      const widths = pieces().map(wide);
      const stuck = pieces().flatMap((p) => (p.getAttribute('data-kb-ac-stuck') ?? '').split(',').filter(Boolean).map((r) => r.split('-').map(Number) as [number, number]));
      return { total: widths.reduce((a, b) => a + b, 0), stuck: stuck.reduce((a, [lo, hi]) => a + hi - lo, 0), lines: widths.length };
    };
    const desk = mount({ body, states });
    const d = share();
    desk.unmount();
    document.body.innerHTML = '';
    phone = 40;
    try {
      mount({ body, states });
      const p = share();
      expect(d.lines).toBe(1);
      expect(p.lines).toBe(2);
      expect(d.stuck / d.total).toBeCloseTo(0.65, 2);
      expect(p.stuck / p.total).toBeCloseTo(0.65, 2);
    } finally {
      phone = null;
    }
  });

  test('the pieces take no selection, no long-press menu, and leave the vertical pan to the page', () => {
    expect(css).toMatch(/\.dw-ac-hit\s*\{[^}]*touch-action:\s*pan-y/u);
    expect(css).toMatch(/\.dw-ac-hit\s*\{[^}]*user-select:\s*none/u);
    expect(css).toMatch(/\.dw-ac-hit\s*\{[^}]*-webkit-touch-callout:\s*none/u);
  });

  test('a peel in hand redraws only its own pieces: the residue host is registered once and no film is built again', async () => {
    vi.useFakeTimers();
    /* A film is a canvas made in `buildFilm`; the stack says which. */
    let built = 0;
    const real = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string, o?: ElementCreationOptions) => { if (tag === 'canvas' && /buildFilm/u.test(new Error().stack ?? '')) built++; return real(tag, o); }) as never);
    mount({ author: true, body: 'Mario and Mario', states: { k1: savedOf({ peeled: [0] }) } });
    const registered = registrations.register.mock.calls.length;
    const left = registrations.unregister.mock.calls.length;
    expect(registered).toBeGreaterThan(0);
    const base = built;
    await hold(buttons()[0]!, PICK + 400);
    letGo(buttons()[0]!);
    await pass(1000);
    const mid = built;
    expect(mid).toBeGreaterThan(base);
    /* The roll waits at the peel line, so the same strip peels again with no pick: more of it is peeled, and nothing is made again. */
    const before = stuckOnPage()[0];
    await hold(buttons()[0]!, 500);
    await pass(500);
    expect(stuckOnPage()[0]).not.toBe(before);
    expect(registrations.register.mock.calls.length).toBe(registered);
    expect(registrations.unregister.mock.calls.length).toBe(left);
    /* The films of both strips were built once each: no more however many frames went by. */
    expect(built).toBe(mid);
    letGo(buttons()[0]!);
  });
});

describe('Autocorrect: the Lens', () => {
  test('for a reader it says how many strips are peeled, with the reader\'s ends and no edge', () => {
    const m = mount({ states: { k1: savedOf({ peeled: [1] }) } });
    const view = last(m);
    expect(view.state).toBe('3 strips, 1 peeled');
    expect(view.ends).toBe(LENS.readerEnds);
    expect(view.ends).toBe('Lift a strip by one end to read under it; it lays back down. Only the post\'s author can peel strips off for good.');
    expect(view.progress).toBeNull();
    expect(view.yours).toBe(true);
    expect(view.notes.k1).toBe('“mario” → “Luigi”, 3 places');
    expect(viewProblems(view, { holds: false, covers: false })).toEqual([]);
  });

  test('for the author with a half peel saved it says so, with the author\'s ends and the share peeled', () => {
    const m = mount({ author: true, states: { k1: savedOf({ peeled: [1], stuck: { 0: [[0.5, 1, 1]] } }) } });
    const view = last(m);
    expect(view.state).toBe('3 strips, 1 peeled, 1 started');
    expect(view.ends).toBe('Peel a strip off for good: hold one end until it lifts, then pull slowly. Pull too fast and it tears.');
    expect(view.progress).toBeCloseTo((1 + 0.5 + 0) / 3);
    expect(viewProblems(view, { holds: false, covers: false })).toEqual([]);
  });

  test('a stacked play adds its layer to its note, and a post without the phrase says so', () => {
    const m = mount({ body: 'a big cats day', plays: [playOf(1, 'big cats', 'tiny dogs'), playOf(2, 'cats', 'kittens')] });
    expect(last(m).notes).toEqual({ k1: '“big cats” → “tiny dogs”, 1 place, layer 1 of 2', k2: '“cats” → “kittens”, 1 place, layer 2 of 2' });
    const none = mount({ body: 'nothing here' });
    expect(last(none).state).toBe('Phrase not in this version');
  });
});

describe('Autocorrect: review fixes', () => {
  test('plays on disjoint phrases get no layer note', () => {
    const m = mount({ body: 'Mario met Zelda', plays: [playOf(1, 'mario', 'Luigi'), playOf(2, 'zelda', 'Link')] });
    expect(last(m).notes.k1).not.toMatch(/layer/u);
    expect(last(m).notes.k2).not.toMatch(/layer/u);
  });

  test('the author\'s progress is the share of all strips\' length peeled, not of their count', () => {
    const m = mount({ author: true, body: 'Mario met Princess Peach', plays: [playOf(1, 'mario', 'Luigi'), playOf(2, 'princess peach', 'Toad')], states: { k1: savedOf({ peeled: [0] }) } });
    expect(last(m).progress).toBeCloseTo(5 / 19);
    const half = mount({ author: true, body: 'Mario met Princess Peach', plays: [playOf(1, 'mario', 'Luigi'), playOf(2, 'princess peach', 'Toad')], states: { k2: savedOf({ peeled: [], stuck: { 0: [[0.5, 1, 1]] } }) } });
    expect(last(half).progress).toBeCloseTo(7 / 19);
  });

  test('a buried strip\'s anchor is hidden from a quote until it is exposed', () => {
    mount({ body: 'Mario Kart', plays: [playOf(1, 'mario kart', 'Wii Sports'), playOf(2, 'mario', 'Luigi')] });
    const marks = Object.fromEntries(anchors().map((a) => [a.getAttribute('data-kb-ac-anchor'), a.getAttribute('data-kb-quotable')]));
    expect(marks).toEqual({ 'k1:0': 'hidden', 'k2:0': 'shown' });
    const article = document.createElement('article');
    article.className = 'kb-act';
    article.dataset.kbSeq = '3';
    article.append(...document.body.children);
    document.body.append(article);
    const body = article.querySelector('.kb-bb')!;
    const r = document.createRange();
    r.setStart(body, 0);
    r.setEnd(body, body.childNodes.length);
    expect(readRange(r)?.text).toBe('Luigi');
  });

  test('a residue host that leaves view releases its pixels, and draws fresh on return', () => {
    const watched: { cb: IntersectionObserverCallback; seen: Set<Element> }[] = [];
    vi.stubGlobal('IntersectionObserver', class {
      readonly e = { cb: undefined as unknown as IntersectionObserverCallback, seen: new Set<Element>() };
      constructor(cb: IntersectionObserverCallback) { this.e.cb = cb; watched.push(this.e); }
      observe(el: Element) { this.e.seen.add(el); }
      unobserve(el: Element) { this.e.seen.delete(el); }
      disconnect() { this.e.seen.clear(); }
      takeRecords() { return []; }
    });
    const see = (el: Element, isIntersecting: boolean) => act(() => { for (const o of watched) if (o.seen.has(el)) o.cb([{ target: el, isIntersecting } as IntersectionObserverEntry], o as unknown as IntersectionObserver); });
    mount({ body: 'Mario', states: { k1: savedOf({ peeled: [0] }) } });
    const cv = document.querySelector<HTMLCanvasElement>('.dw-ac-residue')!;
    expect(cv.width).toBeGreaterThan(0);
    see(cv, true);
    see(cv, false);
    expect([cv.width, cv.height]).toEqual([0, 0]);
  });

  test('a new array of equal plays does not measure again', () => {
    const m = mount({ body: 'Mario and Mario' });
    const n = measures.mock.calls.length;
    m.rerender();
    expect(measures.mock.calls.length).toBe(n);
  });

  test('a peel that landed in the saved state is no longer on its way: a later state without it brings the strip back', async () => {
    vi.useFakeTimers();
    const m = mount({ author: true, body: 'Mario and Mario' });
    await hold(buttons()[0]!, 700);
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(buttons()).toHaveLength(1);
    m.setStates({ k1: savedOf({ peeled: [0] }) });
    m.setStates({ k1: savedOf({ peeled: [] }) });
    expect(buttons()).toHaveLength(2);
  });

  test('a play\'s moment measures once more when fonts are ready, with no observer', async () => {
    vi.stubGlobal('document', document);
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load: () => Promise.resolve([]), ready: Promise.resolve() } });
    try {
      mount({ body: 'Mario', still: true });
      const n = measures.mock.calls.length;
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(measures.mock.calls.length).toBeGreaterThan(n);
      expect(resizes.every((r) => r.watching.size === 0)).toBe(true);
    } finally {
      delete (document as unknown as { fonts?: unknown }).fonts;
    }
  });
});

describe('Autocorrect and highlight-to-quote', () => {
  /** What selecting the whole post body would quote, with the render's container moved into the article a body lives in. */
  function quoted() {
    const article = document.createElement('article');
    article.className = 'kb-act';
    article.dataset.kbSeq = '3';
    article.append(...document.body.children);
    document.body.append(article);
    const body = article.querySelector('.kb-bb')!;
    const r = document.createRange();
    r.setStart(body, 0);
    r.setEnd(body, body.childNodes.length);
    return readRange(r)?.text;
  }

  test('a quote holds the replacement a taped strip shows, never the words under it, and never the room', () => {
    mount({ body: 'I said MARIO today' });
    expect(rooms()).toHaveLength(1);
    expect(quoted()).toBe('I said Luigi today');
  });

  test('a long replacement quotes whole', () => {
    mount({ body: 'I said MARIO today', plays: [playOf(1, 'mario', 'a replacement of more than twenty-eight characters')] });
    expect(quoted()).toBe('I said a replacement of more than twenty-eight characters today');
  });

  test('a peeled strip quotes the author\'s words again', () => {
    mount({ body: 'I said MARIO today', states: { k1: savedOf({ peeled: [0] }) } });
    expect(quoted()).toBe('I said MARIO today');
  });
});
