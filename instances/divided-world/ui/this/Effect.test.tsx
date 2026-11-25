/**
 * THIS's effect (docs/plans/2026-11-13-this-plan.md, Task 7): the phrase over a highlighter's swipe, the gap after its last word, the drawn note under it, and a
 * receipt at the foot of the words for a phrase edited out. jsdom has no layout, so the drawing's tests need none (the search and the arithmetic are place.test.ts's);
 * the measuring is driven once with stand-in boxes, to show that it writes each height and place once and that a second pass over its own result writes nothing.
 */
import { act, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useState, type ReactNode } from 'react';
import type { Act } from '../../../../engine/ui/data/api.ts';
import type { CardPlay, CardView, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { viewProblems } from '../../../../engine/ui/cards/lens-words.ts';
import { axeViolations } from '../../../../engine/ui/a11y.ts';
import { BbCode } from '../../../../engine/ui/bbcode/render.tsx';
import { NO_INK } from '../../../../engine/ui/cards/claims.ts';
import { renderInWorld } from '../../../../engine/ui/test-world.tsx';
import { AutocorrectEffect } from '../../cards/autocorrect/Effect.tsx';
import { LaughTrackEffect } from '../laugh-track/Effect.tsx';
import css from './this.css?raw';
import { layOut } from './place.ts';
import { ThisEffect } from './Effect.tsx';

/* The phrase searches, counted: they must run on a new body or new plays and on nothing else. */
const searches = vi.hoisted(() => ({ n: 0 }));
vi.mock('./place.ts', async (original) => {
  const real = await original<typeof import('./place.ts')>();
  return { ...real, placesOf: ((...a: Parameters<typeof real.placesOf>) => { searches.n++; return real.placesOf(...a); }) as typeof real.placesOf };
});
/* Laugh Track's watcher and sound are not under test here. */
vi.mock('../laugh-track/watch.ts', async (original) => ({ ...(await original<typeof import('../laugh-track/watch.ts')>()), register: () => Object.assign(() => {}, { refresh: () => {}, pin: () => {}, cover: () => {} }) }));
vi.mock('../../../../engine/ui/audio/useGameSound.ts', () => ({ useGameSound: () => ({ on: false, set: () => {} }) }));

const BODY = 'Okay, hot take time. People blame the engine because it is easier. I played forty entries. Stop asking for slopes. Done.';
const postOf = (body: string) => ({ id: 'post-1', character: 'author', kind: 'post', thread: 't', payload: { body }, currentPayload: { body }, targetActId: null, seq: 3, createdAt: '2026-11-13T10:00:00.000Z', editedAt: null, shownEditedAt: null }) as unknown as Act;
const playOf = (id: string, phrase: string, words = '', extra: Partial<CardPlay> = {}): CardPlay => ({ id, card: 'this', layer: 1, caster: 'c1', message: '', config: { phrase, words }, playedAt: '2026-11-13T10:01:00.000Z', post: 'post-1', ...extra }) as CardPlay;
const A = playOf('a', 'People blame the engine', 'finally somebody said it');

interface Options { readonly body?: string; readonly plays?: CardPlay[]; readonly moment?: { readonly at: number }; readonly spies?: { readonly save: ReturnType<typeof vi.fn>; readonly release: ReturnType<typeof vi.fn>; readonly met: ReturnType<typeof vi.fn> }; readonly other?: 'autocorrect' | 'laugh-track'; readonly order?: 'this-outer' | 'this-inner' }

let resizes: { cb: () => void; watching: Set<Element> }[] = [];
class FakeResize {
  readonly entry = { cb: undefined as unknown as () => void, watching: new Set<Element>() };
  constructor(cb: () => void) { this.entry.cb = cb; resizes.push(this.entry); }
  observe(el: Element) { this.entry.watching.add(el); }
  unobserve(el: Element) { this.entry.watching.delete(el); }
  disconnect() { this.entry.watching.clear(); }
}

beforeEach(() => {
  searches.n = 0;
  resizes = [];
  vi.stubGlobal('ResizeObserver', FakeResize);
  /* The observer's callback looks in the next frame (Effect.tsx); a test's frame is the call itself. */
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  /* Autocorrect draws its tape on canvases. */
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => null) as never);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const propsOf = (o: Options, body: string, views: (CardView | null)[], plays: CardPlay[]) => ({
  post: postOf(body), plays, states: {}, released: new Set<string>(), written: new Map(), reader: { author: false, caster: false }, place: 'thread' as const, reach: 'post' as const, still: false, moment: o.moment ?? null,
  save: (o.spies?.save as EffectProps['save'] | undefined) ?? (async () => ({ ok: false as const, error: 'no' })), release: (o.spies?.release as EffectProps['release'] | undefined) ?? (async (play: string) => ({ ok: true as const, value: { play, releasedAt: '' } })), show: (v: CardView | null) => { views.push(v); }, met: o.spies?.met ?? (() => {}),
  holdScreen: () => {}, ink: NO_INK, marks: null, nameOf: () => 'Spritey', give: async () => ({ ok: false as const, error: 'no' }), moreGifts: async () => {}, wallet: null,
}) as unknown as EffectProps;

function mount(o: Options = {}) {
  const views: (CardView | null)[] = [];
  let setBody: (b: string) => void = () => {};
  let setPlays: (p: CardPlay[]) => void = () => {};
  let bump: () => void = () => {};
  let setStill: (b: boolean) => void = () => {};
  function Host() {
    const [body, sb] = useState(o.body ?? BODY);
    const [plays, sp] = useState(o.plays ?? [A]);
    const [, setN] = useState(0);
    const [still, ss] = useState(false);
    setStill = ss; setBody = sb; setPlays = sp; bump = () => setN((n) => n + 1);
    const mine = (kids: ReactNode) => <ThisEffect {...propsOf(o, body, views, plays)} still={still}>{kids}</ThisEffect>;
    const text = <BbCode text={body} />;
    const other = (kids: ReactNode): ReactNode => {
      if (o.other === 'autocorrect') return <AutocorrectEffect {...propsOf(o, body, [], [{ id: 'ac1', card: 'autocorrect', layer: 1, caster: 'c2', message: '', config: { phrase: 'People blame the engine', replacement: 'Luigi' }, playedAt: '2026-11-13T10:02:00.000Z', post: 'post-1' } as CardPlay])}>{kids}</AutocorrectEffect>;
      if (o.other === 'laugh-track') return <LaughTrackEffect {...propsOf(o, body, [], [{ id: 'lt1', card: 'laugh-track', layer: 1, caster: 'c2', message: '', config: { cues: [{ phrase: 'People blame the engine', sound: 'boo' }], seed: 3 }, playedAt: '2026-11-13T10:02:00.000Z', post: 'post-1' } as CardPlay])}>{kids}</LaughTrackEffect>;
      return kids;
    };
    return o.order === 'this-inner' ? other(mine(text)) : mine(other(text));
  }
  const world = renderInWorld(<Host />);
  return { ...world, views, edit: (b: string) => act(() => setBody(b)), setPlays: (p: CardPlay[]) => act(() => setPlays(p)), rerender: () => act(() => bump()), flip: () => act(() => setStill(true)) };
}
const q = <T extends HTMLElement = HTMLElement>(s: string) => [...document.querySelectorAll<T>(s)];
const hl = () => q('.dw-this-hl');
const gaps = () => q('.dw-this-gap');
const notes = () => q('.dw-this-note');
const receipts = () => q('aside.dw-this-receipt');
const lastView = (m: ReturnType<typeof mount>) => m.views.filter(Boolean).at(-1)!;
/** The words of the post before `el`, from the start of its body. */
const before = (el: Element) => { const r = document.createRange(); r.setStart(document.querySelector('.kb-bb')!, 0); r.setEndBefore(el); return r.toString(); };

describe('THIS: a wedge', () => {
  test('the phrase is in the highlight, one gap follows its last word, the hidden line reads the note and one drawn note is hidden from a screen reader', () => {
    mount();
    expect(hl().map((e) => e.textContent).join('')).toBe('People blame the engine');
    expect(gaps()).toHaveLength(1);
    const gap = gaps()[0]!;
    expect(hl().at(-1)!.nextSibling).toBe(gap);
    expect(before(gap).endsWith('People blame the engine')).toBe(true);
    expect(gap).toHaveAttribute('data-kb-quotable', 'hidden');
    expect(gap).toHaveAttribute('data-dw-aside');
    expect(gap).toHaveTextContent('Note on these words: THIS finally somebody said it.');
    expect(notes()).toHaveLength(1);
    const note = notes()[0]!;
    expect(note).toHaveAttribute('aria-hidden', 'true');
    expect(note).toHaveAttribute('data-dw-aside');
    expect(note).toHaveTextContent('THIS finally somebody said it');
    /* Outside the words, a child of the wrapper, with no stacking of its own. */
    expect(note.closest('.kb-bb')).toBeNull();
    expect(note.parentElement).toHaveClass('dw-this');
    expect(note).not.toHaveAttribute('data-kb-over-ink');
    expect(receipts()).toHaveLength(0);
    expect(q('[role="note"]')).toHaveLength(0);
  });

  test('a bare THIS has no words, and BBCode in the words is shown as typed', () => {
    mount({ plays: [playOf('a', 'People blame the engine', '')] });
    expect(gaps()[0]).toHaveTextContent('Note on these words: THIS.');
    expect(notes()[0]).toHaveTextContent(/^THIS$/u);
    expect(q('.dw-this-words')).toHaveLength(0);
    cleanup();
    mount({ plays: [playOf('a', 'People blame the engine', '[b]hi[/b] [url=http://x.test]x[/url]')] });
    expect(notes()[0]).toHaveTextContent('THIS [b]hi[/b] [url=http://x.test]x[/url]');
    expect(notes()[0]!.querySelector('b, strong, a')).toBeNull();
    expect(gaps()[0]).toHaveTextContent('Note on these words: THIS [b]hi[/b] [url=http://x.test]x[/url].');
  });

  test('three plays, two on one phrase: three gaps, in play order', () => {
    const plays = [playOf('a', 'People blame the engine', 'one'), playOf('b', 'People blame the engine', 'two'), playOf('c', 'Stop asking for slopes', 'three')];
    mount({ plays });
    expect(gaps().map((g) => g.getAttribute('data-dw-this-gap'))).toEqual(['a', 'b', 'c']);
    expect(notes().map((n) => n.getAttribute('data-dw-this-note'))).toEqual(['a', 'b', 'c']);
    expect(gaps().map((g) => g.textContent)).toEqual(['Note on these words: THIS one.', 'Note on these words: THIS two.', 'Note on these words: THIS three.']);
  });

  test('the first of two places is the one pointed at', () => {
    mount({ body: 'Stop asking for slopes. Then stop asking for slopes again.', plays: [playOf('a', 'stop asking for slopes')] });
    expect(hl().map((e) => e.textContent)).toEqual(['Stop asking for slopes']);
    expect(gaps()).toHaveLength(1);
  });
});

describe('THIS: a receipt', () => {
  test('an edit that removes the phrase leaves a receipt in place of the wedge, and the wedge comes back when the phrase does', () => {
    const m = mount();
    m.edit('Okay, hot take time. People blame the motor because it is easier. Done.');
    expect(hl()).toHaveLength(0);
    expect(gaps()).toHaveLength(0);
    expect(notes()).toHaveLength(0);
    expect(receipts()).toHaveLength(1);
    const r = receipts()[0]!;
    expect(r).toHaveAttribute('role', 'note');
    expect(r).toHaveAttribute('data-dw-aside');
    expect(r).toHaveTextContent('THIS “People blame the engine” (edited out) finally somebody said it');
    expect(r.closest('.kb-bb')).toBeNull();
    expect(r.parentElement).toHaveClass('dw-this');
    m.edit('Okay. People blame the engine because it is easier.');
    expect(receipts()).toHaveLength(0);
    expect(hl().map((e) => e.textContent).join('')).toBe('People blame the engine');
    expect(gaps()).toHaveLength(1);
    expect(notes()).toHaveLength(1);
  });

  test('a play that was a receipt from the start draws one and no wedge (a set note on a quote that lacks the phrase)', () => {
    mount({ body: 'A quote with other words.' });
    expect(gaps()).toHaveLength(0);
    expect(receipts()).toHaveLength(1);
    expect(receipts()[0]).toHaveTextContent('THIS “People blame the engine” (edited out) finally somebody said it');
  });

  test('a bare receipt reads THIS, the phrase and "(edited out)"; receipts follow the words in play order', () => {
    mount({ body: 'Nothing of it.', plays: [playOf('a', 'People blame the engine', ''), playOf('b', 'Stop asking for slopes', 'yes')] });
    expect(receipts().map((r) => r.textContent)).toEqual(['THIS “People blame the engine” (edited out)', 'THIS “Stop asking for slopes” (edited out) yes']);
    expect(receipts()[0]!.previousElementSibling).toHaveClass('kb-bb');
  });
});

describe('THIS: with other cards on the phrase', () => {
  test.each(['this-outer', 'this-inner'] as const)('with Autocorrect over the phrase (%s): the tape\'s segments cover the words, no highlight is drawn there, and the gap is after the last word', (order) => {
    mount({ other: 'autocorrect', order });
    expect(q('[data-kb-ac-seg]').map((e) => e.textContent).join('')).toContain('People blame the engine');
    expect(hl()).toHaveLength(0);
    expect(gaps()).toHaveLength(1);
    /* Autocorrect's own room (spaces) may stand between the segment and the gap. */
    expect(before(gaps()[0]!).trimEnd().endsWith('People blame the engine')).toBe(true);
    expect(notes()).toHaveLength(1);
  });

  test.each(['this-outer', 'this-inner'] as const)('with a Laugh Track cue on the phrase (%s): the cue is drawn on the words and the gap after them', (order) => {
    mount({ other: 'laugh-track', order });
    expect(q('span.dw-lt-cue').map((e) => e.textContent).join('')).toBe('People blame the engine');
    expect(hl()).toHaveLength(0);
    expect(gaps()).toHaveLength(1);
    expect(before(gaps()[0]!).endsWith('People blame the engine')).toBe(true);
  });
});

describe('THIS: what the Lens is told', () => {
  test('show is given the count and a line for each play, naming no caster', () => {
    const plays = [A, playOf('b', 'Stop asking for slopes', ''), playOf('c', 'gone words here', 'x'), playOf('d', 'also gone phrase', '')];
    const m = mount({ plays });
    const view = lastView(m);
    expect(view.state).toBe('4 notes');
    expect(view.notes).toEqual({
      a: '“People blame the engine”: THIS finally somebody said it',
      b: '“Stop asking for slopes”: THIS, no words',
      c: '“gone words here” (edited out): THIS x',
      d: '“also gone phrase” (edited out): THIS, no words',
    });
    expect([view.progress, view.yours, view.controls, view.ends]).toEqual([null, false, [], undefined]);
    expect(viewProblems(view, { holds: false, covers: false })).toEqual([]);
    expect(JSON.stringify(view)).not.toMatch(/Spritey|c1/u);
  });

  test('one note is "1 note"', () => {
    expect(lastView(mount()).state).toBe('1 note');
  });
});

describe('THIS: a play\'s moment', () => {
  const press = (root: HTMLElement) => {
    for (const el of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
      fireEvent.pointerDown(el, { clientX: 10, clientY: 10, pointerId: 1, pointerType: 'mouse' });
      fireEvent.pointerMove(el, { clientX: 40, clientY: 20, pointerId: 1, pointerType: 'mouse' });
      fireEvent.pointerUp(el, { clientX: 40, clientY: 20, pointerId: 1, pointerType: 'mouse' });
      fireEvent.click(el);
      fireEvent.keyDown(el, { key: 'Enter' });
    }
  };
  test('it draws the same in a moment as live, only watches its own size, no press or key changes it or says anything new, and save, release and met are never called', () => {
    const live = mount();
    const liveHtml = document.body.innerHTML;
    expect(live.views.length).toBeGreaterThan(0);
    cleanup();
    resizes = [];
    const spies = { save: vi.fn(), release: vi.fn(), met: vi.fn() };
    const m = mount({ moment: { at: Date.parse('2026-11-13T10:30:00.000Z') }, spies });
    expect(document.body.innerHTML).toBe(liveHtml);
    /* It watches the wrapper's size (a moment can be drawn folded or hidden and shown later) and binds nothing a player can reach. */
    expect(resizes).toHaveLength(1);
    const said = m.views.length;
    const html = document.body.innerHTML;
    act(() => press(document.querySelector<HTMLElement>('.dw-this')!));
    expect(document.body.innerHTML).toBe(html);
    expect(m.views.length).toBe(said);
    expect(q('[tabindex], button, [role="button"]').filter((e) => e.closest('.dw-this'))).toHaveLength(0);
    expect(spies.save).not.toHaveBeenCalled();
    expect(spies.release).not.toHaveBeenCalled();
    expect(spies.met).not.toHaveBeenCalled();
  });

  test('a stale still flag changes nothing: flipping it on a mounted post draws the same and does not set the size watch up again', () => {
    const m = mount();
    const html = document.body.innerHTML;
    expect(resizes).toHaveLength(1);
    m.flip();
    expect(document.body.innerHTML).toBe(html);
    expect(resizes).toHaveLength(1);
    expect(resizes[0]!.watching.size).toBe(1);
  });

  test('the note takes no press: nothing on the live note changes or is said when it is pressed', () => {
    const m = mount();
    const said = m.views.length;
    const html = document.body.innerHTML;
    act(() => press(notes()[0]!));
    expect(document.body.innerHTML).toBe(html);
    expect(m.views.length).toBe(said);
  });
});

describe('THIS: plays that are not in force', () => {
  test('a face-down, caught, ended or untaken play draws nothing and says nothing', () => {
    const plays = [
      playOf('a', 'People blame the engine', '', { faceDown: true }), playOf('b', 'People blame the engine', '', { caught: 'x' }),
      playOf('c', 'People blame the engine', '', { reversed: true }), playOf('d', 'People blame the engine', '', { untaken: true }),
    ];
    const m = mount({ plays });
    expect(hl()).toHaveLength(0);
    expect(gaps()).toHaveLength(0);
    expect(notes()).toHaveLength(0);
    expect(receipts()).toHaveLength(0);
    expect(m.views.filter(Boolean)).toEqual([]);
  });

  test('a configuration with no phrase draws nothing', () => {
    mount({ plays: [{ ...A, config: { color: '#ffd93d', seed: 1 } }] });
    expect(gaps()).toHaveLength(0);
    expect(notes()).toHaveLength(0);
    expect(receipts()).toHaveLength(0);
  });
});

describe('THIS: a busy page', () => {
  test('the phrase search runs on a new body or new plays and on no other render', () => {
    const m = mount();
    expect(searches.n).toBe(1);
    m.rerender();
    m.rerender();
    expect(searches.n).toBe(1);
    /* A new array of equal plays is the same plays. */
    m.setPlays([{ ...A }]);
    expect(searches.n).toBe(1);
    m.edit(BODY + ' More.');
    expect(searches.n).toBe(2);
    m.setPlays([A, playOf('b', 'Stop asking for slopes')]);
    expect(searches.n).toBe(3);
  });
});

describe('THIS: the measuring', () => {
  /* Stand-in boxes: the wrapper is 300 wide, each gap sits on a line at the top its place says, the notes are 36 tall. */
  const tops = new Map<string, number>();
  /* Gaps with no boxes at all: inside a closed [spoiler], whose details has no rendered content. */
  const unrendered = new Set<string>();
  const box = (top: number, left: number, width: number, height: number) => ({ x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) });
  function stand() {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.classList.contains('dw-this')) return box(0, 0, 300, 500);
      if (this.classList.contains('dw-this-gap')) return box(tops.get(this.getAttribute('data-dw-this-gap')!) ?? 40, 150, 0, Number.parseFloat((this as HTMLElement).style.height) || 20);
      if (this.classList.contains('dw-this-note')) return box(0, 0, 300, 36);
      if (this.classList.contains('dw-this-word')) return box(0, 0, 60, 31);
      return box(0, 0, 0, 0);
    });
    vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
      if (this.classList.contains('dw-this-gap')) return (unrendered.has(this.getAttribute('data-dw-this-gap')!) ? [] : [{ left: 150, right: 150, top: 40, bottom: 60, width: 0, height: 20 }]) as unknown as DOMRectList;
      return (this.classList.contains('dw-this-hl') ? [{ left: 20, right: 150, top: 40, bottom: 60, width: 130, height: 20 }] : []) as unknown as DOMRectList;
    });
    vi.spyOn(window, 'getComputedStyle').mockImplementation((() => ({ lineHeight: '20px', fontSize: '16px', getPropertyValue: () => '' })) as never);
  }
  const resize = () => act(() => { for (const r of resizes) r.cb(); });

  test('each gap is given its height and each note its place and arrow once, from no .kb-act-main, and a pass over the result writes nothing', () => {
    tops.clear(); unrendered.clear(); tops.set('a', 40); tops.set('b', 40); tops.set('c', 140);
    stand();
    const plays = [playOf('a', 'People blame the engine', 'one'), playOf('b', 'People blame the engine', 'two'), playOf('c', 'Stop asking for slopes', 'three')];
    mount({ plays });
    expect(document.querySelector('.kb-act-main')).toBeNull();
    const word = { lineHeight: 20, noteHeight: 36, wordX: 33, piece: { left: 20, width: 130 } };
    const want = layOut([{ ...word, id: 'a', lineTop: 40 }, { ...word, id: 'b', lineTop: 40 }, { ...word, id: 'c', lineTop: 140 }], 300);
    const heights = gaps().map((g) => g.style.height);
    expect(heights).toEqual(want.map((l) => `${l.gapHeight}px`));
    expect(Number.parseFloat(heights[1]!)).toBeGreaterThan(Number.parseFloat(heights[0]!));
    expect(notes().map((n) => n.style.top)).toEqual(want.map((l) => `${l.noteTop}px`));
    expect(q('.dw-this-arrow path').map((p) => p.getAttribute('d'))).toEqual(want.map((l) => l.arrow));
    /* The observer watches the wrapper; its callback fires as the gaps make it taller, and again after, and writes nothing. */
    expect(resizes).toHaveLength(1);
    expect([...resizes[0]!.watching]).toEqual([document.querySelector('.dw-this')]);
    const seen = new MutationObserver(() => {});
    seen.observe(document.querySelector('.dw-this')!, { attributes: true, subtree: true });
    resize();
    resize();
    expect(seen.takeRecords()).toEqual([]);
    seen.disconnect();
  });

  const placed = () => notes().map((n) => n.hasAttribute('data-placed'));
  const one = (id: string) => notes().find((n) => n.getAttribute('data-dw-this-note') === id)!;

  test('a gap with no boxes (a closed spoiler) leaves its note unplaced and writes nothing; it is placed when the gap is rendered and a measure comes', () => {
    tops.clear(); unrendered.clear(); unrendered.add('a');
    stand();
    mount();
    expect(placed()).toEqual([false]);
    expect(gaps()[0]!.style.height).toBe('');
    expect(notes()[0]!.style.top).toBe('');
    expect(q('.dw-this-arrow path')[0]!.getAttribute('d')).toBe('');
    unrendered.clear();
    resize();
    expect(placed()).toEqual([true]);
    expect(gaps()[0]!.style.height).not.toBe('');
    expect(notes()[0]!.style.top).not.toBe('');
  });

  test('a gap whose boxes exist but are skipped (a shut [spoiler] content in a browser that keeps its boxes) is not placed: checkVisibility says it is not shown', () => {
    tops.clear(); unrendered.clear();
    stand();
    const skipped = new Set<string>(['a']);
    Object.defineProperty(Element.prototype, 'checkVisibility', { configurable: true, value(this: Element) { return !skipped.has(this.getAttribute('data-dw-this-gap') ?? ''); } });
    try {
      mount();
      expect(placed()).toEqual([false]);
      expect(gaps()[0]!.style.height).toBe('');
      skipped.clear();
      resize();
      expect(placed()).toEqual([true]);
      skipped.add('a');
      resize();
      expect(placed()).toEqual([false]);
    } finally { delete (Element.prototype as { checkVisibility?: unknown }).checkVisibility; }
  });

  test('a placed note whose gap loses its boxes (the spoiler is closed) is hidden again', () => {
    tops.clear(); unrendered.clear();
    stand();
    mount();
    expect(placed()).toEqual([true]);
    unrendered.add('a');
    resize();
    expect(placed()).toEqual([false]);
    unrendered.clear();
    resize();
    expect(placed()).toEqual([true]);
  });

  test('notes at one place with one gap unrendered: the other is laid out alone, and the unrendered one is skipped', () => {
    tops.clear(); unrendered.clear(); unrendered.add('a'); tops.set('b', 40);
    stand();
    mount({ plays: [playOf('a', 'People blame the engine', 'one'), playOf('b', 'People blame the engine', 'two')] });
    const word = { lineHeight: 20, noteHeight: 36, wordX: 33, piece: { left: 20, width: 130 } };
    const [want] = layOut([{ ...word, id: 'b', lineTop: 40 }], 300);
    expect(placed()).toEqual([false, true]);
    expect(gaps().map((g) => g.style.height)).toEqual(['', `${want!.gapHeight}px`]);
    expect(one('a').style.top).toBe('');
    expect(one('b').style.top).toBe(`${want!.noteTop}px`);
  });

  test('an [ispoiler] pressed open remounts the gap, and the new gap is measured in the same commit (no frame with the note over the next line)', () => {
    tops.clear(); unrendered.clear();
    stand();
    mount({ body: 'Okay. [ispoiler]People blame the engine[/ispoiler] and more words.' });
    const was = gaps()[0]!;
    expect(was.style.height).not.toBe('');
    expect(placed()).toEqual([true]);
    /* No resize is delivered: only the press. */
    act(() => { fireEvent.click(document.querySelector('button.kb-bb-ispoiler')!); });
    const now = gaps()[0]!;
    expect(now, 'the gap was remounted').not.toBe(was);
    expect(now.style.height, 'the remounted gap has its height again').toBe(was.style.height);
    expect(placed()).toEqual([true]);
  });

  test('the observer measures when the wrapper goes from no width to a width (a folded post unfolds)', () => {
    tops.clear(); unrendered.clear();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => box(0, 0, 0, 0));
    mount();
    expect(placed()).toEqual([false]);
    vi.restoreAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => null) as never);
    stand();
    resize();
    expect(placed()).toEqual([true]);
    expect(gaps()[0]!.style.height).not.toBe('');
  });

  test('a face that loads after the post is gone measures nothing and throws nothing', async () => {
    tops.clear(); unrendered.clear();
    stand();
    let loaded: () => void = () => {};
    const arrives = new Promise<void>((r) => { loaded = r; });
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load: () => arrives, ready: arrives } });
    try {
      mount();
      const rect = Element.prototype.getBoundingClientRect as unknown as ReturnType<typeof vi.fn>;
      cleanup();
      rect.mockClear();
      loaded();
      await act(async () => { await arrives; await Promise.resolve(); });
      expect(rect).not.toHaveBeenCalled();
    } finally {
      delete (document as { fonts?: unknown }).fonts;
    }
  });

  test('a wrapper with no width (folded, or not laid out) is not measured, and a new place is measured when it appears', () => {
    tops.clear();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => box(0, 0, 0, 0));
    const m = mount();
    expect(gaps()[0]!.style.height).toBe('');
    expect(notes()[0]!.style.top).toBe('');
    vi.restoreAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => null) as never);
    tops.set('b', 140);
    stand();
    m.setPlays([A, playOf('b', 'Stop asking for slopes', 'next')]);
    expect(gaps().map((g) => g.style.height)).toEqual(['86px', '86px']);
  });
});

describe('THIS: the look', () => {
  const rule = (selector: string) => new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\s*\\{([^}]*)\\}`, 'u').exec(css)?.[1] ?? '';
  test('the note has no z-index and sets no pointer-events, so ink above it takes the press as it does for the words', () => {
    expect(rule('.dw-this-note')).not.toBe('');
    expect(rule('.dw-this-note')).not.toMatch(/z-index|pointer-events/u);
    expect(css).not.toMatch(/data-kb-over-ink/u);
  });
  test('under bright ink the note and the receipt take the bright ink and its outline, and the swipe is not drawn', () => {
    expect(css).toMatch(/\[data-kb-content-area\]\[data-kb-bright-ink\] \.dw-this-hl \{\s*background: none;/u);
    expect(css).toMatch(/\[data-kb-content-area\]\[data-kb-bright-ink\] :is\(\.dw-this-note, \.dw-this-receipt\) \{[^}]*color: var\(--kb-bright-ink\)[^}]*var\(--kb-bright-outline\)/u);
  });
});

describe('THIS: a11y', () => {
  test('a wedge and a receipt have no axe violations', async () => {
    const wedge = mount();
    expect(await axeViolations(wedge.container)).toEqual([]);
    cleanup();
    const receipt = mount({ body: 'Nothing of it.' });
    expect(receipts()).toHaveLength(1);
    expect(await axeViolations(receipt.container)).toEqual([]);
  });
});
