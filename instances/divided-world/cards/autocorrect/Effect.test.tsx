/**
 * Autocorrect's effect (docs/plans/2026-11-11-autocorrect-tape-plan.md, Task 6): the tape laid over every occurrence of each play's
 * phrase. The words stay in the line under it, with an anchor at each taped strip's start and the room after it; a layer over the
 * post draws the pieces. jsdom has no layout, so a stand-in lays every segment, room and Range out on one line at ten pixels a
 * letter and eight a break-space, a canvas ruler reads half an em a letter, and a size tag's class doubles the size it reads.
 * The author's peel here is Task 6's placeholder (a key held on the anchor); the hands are Task 7's.
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { viewProblems } from '../../../../engine/ui/cards/lens-words.ts';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useState } from 'react';
import type { Act, EffectState } from '../../../../engine/ui/data/api.ts';
import type { CardPlay, CardView, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { BbCode } from '../../../../engine/ui/bbcode/render.tsx';
import { probe } from '../../../../engine/ui/shine/loop.ts';
import { renderInWorld } from '../../../../engine/ui/test-world.tsx';
import { AutocorrectEffect, LENS } from './Effect.tsx';
import { readRange } from '../../../../engine/ui/thread/SelectionQuote.tsx';

/* The board's tokens are not in jsdom: the residue's band is a light board's. */
vi.mock('../../../../engine/ui/shine/band.ts', async (original) => ({
  ...(await original<typeof import('../../../../engine/ui/shine/band.ts')>()),
  bandFor: () => ({ lo: 0.55, hi: 1, board: 'light', bright: false }),
}));

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
  function Host() {
    const [body, set] = useState(o.body ?? 'Mario and mario, MARIO! ' + QUOTE);
    setBody = set;
    return (
      <AutocorrectEffect
        post={postOf(body)} plays={o.plays ?? [playOf(1, 'mario', 'Luigi')]} states={o.states ?? {}} released={new Set()} reader={{ author: o.author ?? false, caster: false }}
        place="thread" reach="post" still={o.still ?? false} save={save} release={async (play) => ({ ok: true, value: { play, releasedAt: '' } })} show={(v) => { views.push(v); }} met={() => {}}
        holdScreen={() => {}} marks={null} nameOf={() => 'Spritey'}
      >
        <BbCode text={body} />
      </AutocorrectEffect>
    );
  }
  const world = renderInWorld(<Host />);
  return { ...world, save, views, edit: (b: string) => act(() => setBody(b)) };
}
const anchors = () => [...document.querySelectorAll<HTMLElement>('[data-kb-ac-anchor]')];
const buttons = () => anchors().filter((a) => a.tagName === 'BUTTON');
const rooms = () => [...document.querySelectorAll<HTMLElement>('.dw-ac-room')];
const pieces = () => [...document.querySelectorAll<HTMLElement>('[data-kb-ac-piece]')];
const hold = async (el: HTMLElement, ms: number) => { fireEvent.keyDown(el, { key: 'Enter' }); await act(async () => { vi.advanceTimersByTime(ms); }); };
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
    return [...document.querySelectorAll('[data-kb-ac-seg], .dw-ac-room')].filter((e) => this.intersectsNode(e)).map(rectOf);
  };
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

  test('a held key peels at the placeholder\'s time and not before; letting go early keeps the strip', async () => {
    vi.useFakeTimers();
    mount({ author: true });
    await hold(buttons()[0]!, 600);
    expect(buttons()).toHaveLength(3);
    fireEvent.keyUp(buttons()[0]!, { key: 'Enter' });
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(buttons()).toHaveLength(3);
    await hold(buttons()[0]!, 700);
    expect(buttons()).toHaveLength(2);
    expect([...document.querySelectorAll('[data-kb-ac-seg]')].filter((s) => !s.hasAttribute('aria-hidden')).map((s) => s.textContent)).toEqual(['Mario']);
  });

  test('a reader\'s hold peels nothing and saves nothing', async () => {
    vi.useFakeTimers();
    const m = mount();
    await hold(buttons()[0]!, 5000);
    expect(buttons()).toHaveLength(3);
    expect(m.save).not.toHaveBeenCalled();
  });

  test('Space held peels as Enter does', async () => {
    vi.useFakeTimers();
    mount({ author: true });
    fireEvent.keyDown(buttons()[0]!, { key: ' ' });
    await act(async () => { vi.advanceTimersByTime(700); });
    expect(buttons()).toHaveLength(2);
  });

  test('letting go of another key does not end a hold', async () => {
    vi.useFakeTimers();
    mount({ author: true });
    fireEvent.keyDown(buttons()[0]!, { key: 'Enter' });
    await act(async () => { vi.advanceTimersByTime(300); });
    fireEvent.keyUp(buttons()[0]!, { key: 'Shift' });
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(buttons()).toHaveLength(2);
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
    mount({ body: 'Mario', states: { k1: savedOf({ peeled: [], stuck: { 0: [[0.5, 1, 1]] } }) } });
    expect(pieces()).toHaveLength(1);
    expect(pieces()[0]!.style.maskImage || pieces()[0]!.getAttribute('style')).toMatch(/linear-gradient/u);
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
    await hold(buttons()[0]!, 700);
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(m.save).toHaveBeenCalledWith('k1', { peeled: [0, 1, 2], clean: true });
  });

  test('a saved stuck stretch of a strip still half peeled is sent back as it was', async () => {
    vi.useFakeTimers();
    const m = mount({ author: true, states: { k1: savedOf({ peeled: [0], stuck: { 1: [[0.5, 1, 1]] } }) } });
    await hold(buttons().find((b) => b.getAttribute('data-kb-ac-anchor') === 'k1:2')!, 700);
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(m.save).toHaveBeenCalledWith('k1', { peeled: [0, 2], stuck: { 1: [[0.5, 1, 1]] } });
  });

  test('the author\'s peels go in one save, one at a time, each later one after the last is answered', async () => {
    vi.useFakeTimers();
    let answer: (v: Awaited<ReturnType<EffectProps['save']>>) => void = () => {};
    const save = vi.fn(() => new Promise<Awaited<ReturnType<EffectProps['save']>>>((r) => { answer = r; }));
    mount({ author: true, save: save as unknown as EffectProps['save'] });
    fireEvent.keyDown(buttons()[0]!, { key: 'Enter' });
    fireEvent.keyDown(buttons()[1]!, { key: 'Enter' });
    await act(async () => { vi.advanceTimersByTime(700); });
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith('k1', { peeled: [0, 1] });
    await hold(buttons()[0]!, 700);
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => { answer({ ok: true, value: { play: 'k1', savedAt: '' } }); });
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('k1', { peeled: [0, 1, 2], clean: true });
  });

  test('an author\'s peel made just before leaving the post is still saved', async () => {
    vi.useFakeTimers();
    const m = mount({ author: true });
    await hold(buttons()[0]!, 700);
    expect(m.save).not.toHaveBeenCalled();
    m.unmount();
    expect(m.save).toHaveBeenCalledWith('k1', { peeled: [0] });
  });

  test('peeling the focused strip keeps the reader\'s place: focus goes to the next exposed strip, or to the post, and the peel is said', async () => {
    vi.useFakeTimers();
    mount({ body: 'Mario and Mario', author: true });
    buttons()[0]!.focus();
    await hold(buttons()[0]!, 700);
    expect(document.activeElement).toBe(buttons()[0]);
    expect(buttons()[0]).toHaveAttribute('data-kb-ac-anchor', 'k1:1');
    expect(screen.getAllByRole('status').at(-1)).toHaveTextContent('Peeled. Under it: “Mario”.');
    await hold(buttons()[0]!, 700);
    expect(buttons()).toHaveLength(0);
    expect(document.activeElement).toBe(document.querySelector('[data-kb-autocorrect]'));
  });

  test('a save that got no answer is sent again, later; one the card refuses is said, and the strip comes back', async () => {
    vi.useFakeTimers();
    const answers = [{ ok: false, error: 'lost', uncertain: true }, { ok: true, value: { play: 'k1', savedAt: '' } }];
    const save = vi.fn(async () => answers.shift()!);
    mount({ author: true, save: save as unknown as EffectProps['save'] });
    await hold(buttons()[0]!, 700);
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(save).toHaveBeenCalledTimes(2);

    const refused = vi.fn(async () => ({ ok: false as const, error: 'peeled is a list of places' }));
    document.body.innerHTML = '';
    mount({ author: true, save: refused as unknown as EffectProps['save'] });
    await hold(buttons()[0]!, 700);
    expect(buttons()).toHaveLength(2);
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(refused).toHaveBeenCalledTimes(1);
    expect(buttons()).toHaveLength(3);
    expect(screen.getAllByRole('status').at(-1)).toHaveTextContent('peeled is a list of places');
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
