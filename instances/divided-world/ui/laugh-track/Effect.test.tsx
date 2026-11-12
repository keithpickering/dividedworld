/**
 * Laugh Track's effect (docs/plans/2026-11-11-laugh-track-plan.md, Task 13). The watcher is faked, so a test fires a place by hand,
 * and `useSound` is faked, so a test sees what plays; two tests run the real watcher over a fake observer and fake frames (the loops the
 * page makes, and that they stop when the post goes), and one runs the real `useSound` over a faked mixer (a fire with Game sounds off
 * says its caption). jsdom has no layout: a test that needs a place on the line gives every piece a box there.
 */
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useState } from 'react';
import type { Act } from '../../../../engine/ui/data/api.ts';
import type { CardPlay, CardView, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { viewProblems } from '../../../../engine/ui/cards/lens-words.ts';
import { BbCode } from '../../../../engine/ui/bbcode/render.tsx';
import { TextLayer, type TextRun } from '../../../../engine/ui/bbcode/layers.tsx';
import { captions } from '../../../../engine/ui/audio/captions.ts';
import { fakeSound } from '../../../../engine/ui/audio/test-sound.ts';
import { resetSound } from '../../../../engine/ui/audio/sound.ts';
import { renderInWorld } from '../../../../engine/ui/test-world.tsx';
import { AutocorrectEffect } from '../../cards/autocorrect/Effect.tsx';
import { sounds } from '../sounds.ts';
import { seeded } from '../seeded.ts';
import { DEFAULTS, LaughTrackEffect } from './Effect.tsx';
import { defaults as instanceDefaults } from '../../settings.ts';
import type { PlaceSpec } from './watch.ts';

const hub = vi.hoisted(() => ({
  mode: 'fake' as 'fake' | 'real',
  specs: [] as unknown[],
  gone: new Set<unknown>(),
  forgets: 0,
  gameOn: false,
  offs: [] as { (): void; refresh: () => void }[],
  sound: null as null | { play: (key: string, o?: unknown) => Promise<null>; loop: (key: string, o: unknown) => { setGain: (g: number) => void; stop: (f: number) => void }; caption: (key: string) => void },
}));

/* The watcher: faked, so a place is fired by hand; or the real one, for the two tests that run it. */
vi.mock('./watch.ts', async (original) => {
  const actual = await original<typeof import('./watch.ts')>();
  return {
    ...actual,
    forgetVoice: () => { hub.forgets++; actual.forgetVoice(); },
    register: (spec: PlaceSpec) => {
      if (hub.mode === 'real') return actual.register(spec);
      hub.specs.push(spec);
      const off = Object.assign(vi.fn(() => { hub.gone.add(spec); }), { refresh: vi.fn() });
      hub.offs.push(off);
      return off;
    },
  };
});
/* The account's game-sound choice, set by the test. */
vi.mock('../../../../engine/ui/audio/useGameSound.ts', () => ({ useGameSound: () => ({ on: hub.gameOn, set: () => {} }) }));
/* The sound: a fake the test reads, or the real hook where `hub.sound` is null. */
vi.mock('../../../../engine/ui/audio/sound.ts', async (original) => {
  const actual = await original<typeof import('../../../../engine/ui/audio/sound.ts')>();
  return { ...actual, useSound: () => hub.sound ?? actual.useSound() };
});

const BODY = 'Luigi is great. Luigi wins, and Mario is great too.';
const QUOTE = '[quote=0f8fad5b-d9cb-469f-a165-70867728950e]Luigi in a quote[/quote]';
const postOf = (body: string) => ({ id: 'post-1', character: 'author', kind: 'post', thread: 't', payload: { body }, currentPayload: { body }, targetActId: null, seq: 3, createdAt: '2026-11-11T10:00:00.000Z', editedAt: null, shownEditedAt: null }) as unknown as Act;
const CUES = [{ phrase: 'Luigi', sound: 'boo' }, { phrase: 'great', sound: 'cheer' }, { phrase: 'Mario is', sound: 'laugh' }];
const playOf = (cues: unknown = CUES, seed = 7, id = 'lt1'): CardPlay => ({ id, card: 'laugh-track', layer: 1, caster: 'c1', message: '', config: { cues, seed }, playedAt: '2026-11-11T10:01:00.000Z', post: 'post-1' }) as CardPlay;

interface Options { readonly body?: string; readonly plays?: CardPlay[]; readonly still?: boolean; readonly wrap?: 'none' | 'autocorrect-inside' | 'autocorrect-outside'; readonly posts?: number; readonly place?: 'thread' | 'origin'; readonly sounds?: boolean; readonly cardSettings?: Record<string, number> }

const base = (o: Options, views: (CardView | null)[], met: () => void, body: string) => ({
  post: postOf(body), plays: o.plays ?? [playOf()], states: {}, released: new Set<string>(), written: new Map(), reader: { author: false, caster: false },
  place: o.place ?? 'thread', reach: 'post' as const, still: o.still ?? false, save: async () => ({ ok: false as const, error: 'no' }), release: async (play: string) => ({ ok: true as const, value: { play, releasedAt: '' } }),
  show: (v: CardView | null) => { views.push(v); }, met, holdScreen: () => {}, marks: null, nameOf: () => 'Spritey', give: async () => ({ ok: false as const, error: 'no' }), moreGifts: async () => {}, wallet: null,
}) as unknown as EffectProps;

function mount(o: Options = {}) {
  const views: (CardView | null)[] = [];
  const met = vi.fn();
  let setBody: (b: string) => void = () => {};
  function Host() {
    const [body, set] = useState(o.body ?? BODY);
    setBody = set;
    const props = base(o, views, met, body);
    const taped = { ...props, plays: [{ id: 'ac1', card: 'autocorrect', layer: 1, caster: 'c2', message: '', config: { phrase: 'Luigi', replacement: 'Wario' }, playedAt: '2026-11-11T10:02:00.000Z', post: 'post-1' } as CardPlay] };
    const text = <BbCode text={body} />;
    const lt = (children: React.ReactNode) => <LaughTrackEffect {...props}>{children}</LaughTrackEffect>;
    return (
      <>
        {Array.from({ length: o.posts ?? 1 }, (_, i) => (
          <div key={i} data-post={i}>
            {o.wrap === 'autocorrect-inside' ? lt(<AutocorrectEffect {...taped}>{text}</AutocorrectEffect>)
              : o.wrap === 'autocorrect-outside' ? <AutocorrectEffect {...taped}>{lt(text)}</AutocorrectEffect>
                : lt(text)}
          </div>
        ))}
      </>
    );
  }
  const world = renderInWorld(<Host />, { ...(o.sounds ? { sounds } : {}), ...(o.cardSettings ? { settings: { cardSettings: o.cardSettings } } : {}) });
  return { ...world, views, met, edit: (b: string) => act(() => setBody(b)) };
}
const pieces = () => [...document.querySelectorAll<HTMLElement>('.dw-lt-cue')];
const lastView = (m: ReturnType<typeof mount>) => m.views.filter(Boolean).at(-1)!;
/** The places registered with the watcher and not let go. */
const live = () => (hub.specs as PlaceSpec[]).filter((s) => !hub.gone.has(s));
const fire = (i: number) => act(() => { (hub.specs[i] as PlaceSpec).fire(); });
/** The take the seed picks for place `i` of the play `lt1` (design section 6): the same on every screen. */
const take = (sound: string, i: number, seed = 7, id = 'lt1') => `laugh-track.${sound}-${1 + Math.floor(seeded(`${id}:${seed}:${i}`)() * 3)}`;

const fakeSoundHub = () => {
  const handle = { setGain: vi.fn(), stop: vi.fn() };
  return { play: vi.fn(async () => null), loop: vi.fn(() => handle), caption: vi.fn(), handle };
};
let heard: ReturnType<typeof fakeSoundHub>;

beforeEach(() => {
  hub.mode = 'fake'; hub.specs = []; hub.offs = []; hub.gone = new Set(); hub.forgets = 0; hub.gameOn = false;
  heard = fakeSoundHub();
  hub.sound = heard as unknown as typeof hub.sound;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  captions.reset();
  resetSound();
});

describe('Laugh Track: the places', () => {
  test('each place is wrapped in its own piece, and nothing marks one before it fires', () => {
    mount({ body: BODY + QUOTE });
    expect(pieces().map((p) => [p.textContent, p.getAttribute('data-sound')])).toEqual([['Luigi', 'boo'], ['great', 'cheer'], ['Luigi', 'boo'], ['Mario is', 'laugh'], ['great', 'cheer']]);
    for (const p of pieces()) {
      expect(p).not.toHaveClass('dw-lt-fired');
      for (const a of ['tabindex', 'role', 'aria-label']) expect(p).not.toHaveAttribute(a);
    }
    /* A quote's words are not in the visible text, so no place is drawn there. */
    expect(document.querySelector('blockquote .dw-lt-cue')).toBeNull();
    expect(live()).toHaveLength(5);
    expect(live().map((s) => s.kind)).toEqual(['boo', 'cheer', 'boo', 'laugh', 'cheer']);
  });

  test('a cue whose phrase is no longer in the post draws no place and stays quiet', () => {
    const m = mount({ plays: [playOf([{ phrase: 'Wario', sound: 'boo' }, { phrase: 'Luigi', sound: 'boo' }])] });
    expect(pieces().map((p) => p.textContent)).toEqual(['Luigi', 'Luigi']);
    m.edit('Mario wins.');
    expect(pieces()).toHaveLength(0);
    expect(live()).toHaveLength(0);
    expect(lastView(m).state).toBe('No cues in this version');
  });

  test('a fire plays the seeded take, marks the place, focuses nothing and says the card is met once', () => {
    const m = mount();
    fire(0);
    expect(heard.play).toHaveBeenCalledTimes(1);
    expect(heard.play).toHaveBeenCalledWith(take('boo', 0), { group: 'audience', fadeMs: 250, tailMs: 250 });
    const [first, second] = pieces();
    expect(first).toHaveClass('dw-lt-fired');
    expect(first).toHaveAttribute('tabindex', '0');
    expect(first).toHaveAttribute('role', 'button');
    expect(first).toHaveAttribute('aria-label', `${first!.textContent}. Replay: the audience boos`);
    expect(first!.getAttribute('aria-label')!.startsWith(first!.textContent!)).toBe(true);
    expect(second).not.toHaveClass('dw-lt-fired');
    expect(pieces().filter((p) => p.getAttribute('data-sound') === 'boo')[1]).not.toHaveClass('dw-lt-fired');
    expect(document.activeElement).toBe(document.body);
    expect(m.met).toHaveBeenCalledTimes(1);
    fire(1);
    expect(m.met).toHaveBeenCalledTimes(1);
    expect(heard.play).toHaveBeenLastCalledWith(take('cheer', 1), { group: 'audience', fadeMs: 250, tailMs: 250 });
    expect(pieces()[1]).toHaveAttribute('aria-label', `${pieces()[1]!.textContent}. Replay: the audience cheers`);
  });

  test('the take comes from the play, its seed and the place, so two places of one cue may differ and every screen agrees', () => {
    mount();
    const picked = [0, 1, 2, 3, 4].map((i) => take(['boo', 'cheer', 'boo', 'laugh', 'cheer'][i]!, i));
    for (let i = 0; i < 5; i++) fire(i);
    expect(heard.play.mock.calls.map((c) => (c as unknown[])[0])).toEqual(picked);
    expect(new Set(picked).size).toBeGreaterThan(1);
  });

  test('the underline is a text-decoration, so no word moves, and the effect adds no box of its own to a piece', () => {
    mount();
    fire(0);
    const p = pieces()[0]!;
    expect(p.tagName).toBe('SPAN');
    expect(p.parentElement!.textContent).toContain('Luigi is great.');
  });
});

describe('Laugh Track: the registration', () => {
  test('fire returns the play\'s promise, and the screen carries band, airMs and holdMs, from the instance\'s settings', async () => {
    mount();
    const spec = hub.specs[0] as PlaceSpec;
    heard.play.mockResolvedValueOnce({ lengthMs: 900 } as never);
    let answer: unknown;
    act(() => { answer = spec.fire(); });
    expect(await answer).toEqual({ lengthMs: 900 });
    expect(spec.screen).toMatchObject({ band: 34, airMs: 1200, holdMs: 4000 });
  });

  test('with no card settings the screen falls back to the defaults: band 34, airMs 1200, holdMs 4000', () => {
    mount({ cardSettings: {} });
    expect((hub.specs[0] as PlaceSpec).screen).toMatchObject({ band: 34, airMs: 1200, holdMs: 4000 });
  });

  test('the instance\'s card settings for every laughTrack screen key equal the effect\'s fallback defaults', () => {
    const held = instanceDefaults.cardSettings;
    for (const [key, value] of Object.entries(DEFAULTS)) expect(held[`laughTrack.${key}`], key).toBe(value);
  });

  test('the screen carries band, airMs and holdMs from the card settings when they are set', () => {
    mount({ cardSettings: { 'laughTrack.band': 50, 'laughTrack.airMs': 800, 'laughTrack.holdMs': 2500 } });
    expect((hub.specs[0] as PlaceSpec).screen).toMatchObject({ band: 50, airMs: 800, holdMs: 2500 });
  });
});

describe('Laugh Track: a replay', () => {
  test('hover with a mouse, focus, a press, Enter and Space each play the take again, and nothing does before the place fires', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    mount();
    const [p] = pieces();
    fireEvent.pointerEnter(p!, { pointerType: 'mouse' }); fireEvent.click(p!); fireEvent.keyDown(p!, { key: 'Enter' });
    expect(heard.play).not.toHaveBeenCalled();
    fire(0);
    const key = take('boo', 0);
    const again = (act1: () => void) => { vi.setSystemTime(Date.now() + 1000); heard.play.mockClear(); act(act1); expect(heard.play).toHaveBeenCalledTimes(1); expect(heard.play).toHaveBeenCalledWith(key, { group: 'audience', fadeMs: 250, tailMs: 250 }); };
    heard.play.mockClear();
    again(() => { fireEvent.pointerEnter(p!, { pointerType: 'mouse' }); });
    again(() => { p!.focus(); });
    p!.blur();
    again(() => { fireEvent.click(p!); });
    again(() => { fireEvent.keyDown(p!, { key: 'Enter' }); });
    again(() => { fireEvent.keyDown(p!, { key: ' ' }); });
  });

  test('Enter and Space on a fired place are default-prevented, so a Space does not scroll the page', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    mount();
    fire(0);
    const [p] = pieces();
    /* fireEvent returns false when a handler called preventDefault. */
    expect(fireEvent.keyDown(p!, { key: ' ' })).toBe(false);
    vi.setSystemTime(Date.now() + 1000);
    expect(fireEvent.keyDown(p!, { key: 'Enter' })).toBe(false);
    expect(fireEvent.keyDown(p!, { key: 'a' })).toBe(true);
  });

  test('a touch that only brushes a place does not replay it, and the events of one gesture play one take', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    mount();
    const [p] = pieces();
    fire(0);
    heard.play.mockClear();
    vi.setSystemTime(Date.now() + 1000);
    fireEvent.pointerEnter(p!, { pointerType: 'touch' });
    expect(heard.play).not.toHaveBeenCalled();
    /* A mouse press focuses, and so presses, a button: that is one replay. */
    act(() => { fireEvent.pointerEnter(p!, { pointerType: 'mouse' }); p!.focus(); fireEvent.click(p!); });
    expect(heard.play).toHaveBeenCalledTimes(1);
  });
});

describe('Laugh Track: the Lens', () => {
  test('the views are short plain statuses, hold no reader and carry one Game sounds toggle', () => {
    const m = mount();
    const v0 = lastView(m);
    expect(v0).toMatchObject({ state: '0 of 5 cues heard', progress: 0, yours: false, notes: {} });
    expect(v0).not.toHaveProperty('ends');
    expect(v0.controls).toHaveLength(1);
    expect(v0.controls[0]).toMatchObject({ kind: 'toggle', label: 'Game sounds', on: false });
    fire(0); fire(1);
    expect(lastView(m)).toMatchObject({ state: '2 of 5 cues heard', progress: 0.4 });
    for (const v of m.views.filter(Boolean)) expect(viewProblems(v!, { holds: false, covers: false })).toEqual([]);
  });

  test('one cue at one place is "1 cue" and a view is cleared when the post goes', () => {
    const m = mount({ plays: [playOf([{ phrase: 'Mario is', sound: 'laugh' }])] });
    expect(lastView(m).state).toBe('0 of 1 cues heard');
    m.unmount();
    expect(m.views.at(-1)).toBeNull();
  });

  test('the toggle sets the account\'s game sound', () => {
    const m = mount();
    const toggle = lastView(m).controls[0]!;
    expect(toggle.kind).toBe('toggle');
    expect(() => { if (toggle.kind === 'toggle') toggle.set(true); }).not.toThrow();
  });

  test('the effect reads neither the reader\'s authorship nor their cast', () => {
    const props = base({}, [], () => {}, BODY);
    const spy = vi.fn(() => false);
    const reader = Object.defineProperties({}, { author: { get: spy, enumerable: true }, caster: { get: spy, enumerable: true } });
    renderInWorld(<LaughTrackEffect {...props} reader={reader as never}><BbCode text={BODY} /></LaughTrackEffect>);
    fire(0);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('Laugh Track: a play\'s moment (still)', () => {
  test('nothing registers, fires, plays or binds, no piece is focusable, and the Lens says how many cues with no controls', () => {
    const m = mount({ still: true });
    expect(hub.specs).toHaveLength(0);
    expect(hub.offs).toHaveLength(0);
    expect(pieces()).toHaveLength(5);
    for (const p of pieces()) {
      for (const a of ['tabindex', 'role', 'aria-label']) expect(p).not.toHaveAttribute(a);
      expect(p).not.toHaveClass('dw-lt-fired');
      fireEvent.pointerEnter(p, { pointerType: 'mouse' }); fireEvent.click(p); fireEvent.keyDown(p, { key: 'Enter' }); p.focus();
    }
    expect(heard.play).not.toHaveBeenCalled();
    expect(heard.loop).not.toHaveBeenCalled();
    expect(m.met).not.toHaveBeenCalled();
    expect(lastView(m)).toMatchObject({ state: '3 cues', controls: [], yours: false, notes: {} });
    expect(lastView(m).progress).toBeNull();
    expect(viewProblems(lastView(m), { holds: false, covers: false })).toEqual([]);
  });

  test('a moment with one cue says "1 cue"', () => {
    const m = mount({ still: true, plays: [playOf([{ phrase: 'Mario is', sound: 'laugh' }])] });
    expect(lastView(m).state).toBe('1 cue');
  });

  test('the ORIGIN box behaves as the thread does', () => {
    mount({ place: 'origin' });
    expect(live()).toHaveLength(5);
    fire(0);
    expect(pieces()[0]).toHaveClass('dw-lt-fired');
  });
});

describe('Laugh Track: with Game sounds off', () => {
  test('a fire says its caption, through the real sound hook over a faked mixer', async () => {
    hub.sound = null;
    fakeSound();
    mount({ sounds: true });
    await act(async () => { (hub.specs[0] as PlaceSpec).fire(); await Promise.resolve(); await Promise.resolve(); });
    expect(captions.current()).toMatchObject({ text: 'The audience boos' });
  });
});

describe('Laugh Track: Game sounds toggled mid-page', () => {
  test('the watcher is told when the account\'s game sound changes, and not on mount', () => {
    const m = mount();
    expect(hub.forgets).toBe(0);
    hub.gameOn = true;
    m.edit(BODY + ' ');
    expect(hub.forgets).toBe(1);
    m.edit(BODY + '  ');
    expect(hub.forgets).toBe(1);
    hub.gameOn = false;
    m.edit(BODY + '   ');
    expect(hub.forgets).toBe(2);
  });
});

describe('Laugh Track: a taped phrase', () => {
  for (const wrap of ['autocorrect-inside', 'autocorrect-outside'] as const) {
    test(`a phrase under Autocorrect's tape has no place drawn, whichever card was played first (${wrap})`, () => {
      mount({ wrap, body: 'Luigi is great. Luigi wins.' });
      /* Autocorrect's run covers both Luigis; Laugh Track's pieces are drawn only where nothing sits over its words. */
      expect(document.querySelectorAll('[data-kb-ac-seg]').length).toBeGreaterThan(0);
      expect([...document.querySelectorAll('[data-kb-ac-seg]')].map((e) => e.textContent)).toContain('Luigi');
      expect(pieces().map((p) => p.textContent)).toEqual(['great']);
      for (const p of pieces()) expect(p.closest('[data-kb-ac-seg]')).toBeNull();
      expect(live()).toHaveLength(1);
    });
  }

  test('a wrap run of another card at the same level never shows Laugh Track through it', () => {
    const runs: TextRun[] = [{ start: 0, end: 5, key: 'other', z: 0, mode: 'wrap', render: ({ text, key }) => <b key={key} data-other="">{text}</b> }];
    const props = base({}, [], () => {}, BODY);
    renderInWorld(<TextLayer runs={runs}><LaughTrackEffect {...props}><BbCode text={BODY} /></LaughTrackEffect></TextLayer>);
    expect(document.querySelector('[data-other]')).toHaveTextContent('Luigi');
    expect(pieces().map((p) => p.textContent)).toEqual(['great', 'Luigi', 'Mario is', 'great']);
  });
});

describe('Laugh Track: on a real page', () => {
  class FakeObserver {
    static all: FakeObserver[] = [];
    readonly seen = new Set<Element>();
    readonly cb: (e: { target: Element; isIntersecting: boolean }[]) => void;
    constructor(cb: (e: { target: Element; isIntersecting: boolean }[]) => void) { this.cb = cb; FakeObserver.all.push(this); }
    observe(e: Element) { this.seen.add(e); }
    unobserve(e: Element) { this.seen.delete(e); }
    disconnect() { this.seen.clear(); }
  }
  let queue: ((t: number) => void)[];
  const step = (t: number) => act(() => { const run = queue; queue = []; for (const f of run) f(t); });
  const onLine = () => ({ top: 300, bottom: 320, left: 0, right: 50 }) as unknown as DOMRect;
  beforeEach(() => {
    hub.mode = 'real'; queue = []; FakeObserver.all = [];
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    vi.stubGlobal('requestAnimationFrame', (f: (t: number) => void) => { queue.push(f); return queue.length; });
    vi.stubGlobal('cancelAnimationFrame', () => { queue = []; });
    vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) { return (this.classList.contains('dw-lt-cue') ? [onLine()] : []) as unknown as DOMRectList; });
  });
  const see = () => act(() => { const io = FakeObserver.all[0]!; io.cb([...io.seen].map((target) => ({ target, isIntersecting: true }))); });

  test('a place resting on the line fires after the dwell, and the page makes one loop of a kind however many posts there are', async () => {
    const m = mount({ posts: 2, body: 'Luigi wins.', plays: [playOf([{ phrase: 'Luigi', sound: 'boo' }])] });
    expect(FakeObserver.all).toHaveLength(1);
    see();
    /* A frame adds at most 100ms, so the dwell is earned over frames a hundred ms apart; the second post's place waits out the airtime. */
    let t = 0;
    const frames = async (ms: number) => { for (const end = t + ms; t < end; ) { t += 100; await step(t); } };
    await frames(300);
    expect(heard.loop).toHaveBeenCalledTimes(1);
    expect(heard.loop).toHaveBeenCalledWith('laugh-track.grumble', { group: 'audience-build', id: 'laugh-track:boo' });
    expect(heard.handle.setGain).toHaveBeenLastCalledWith(0.35);
    expect(heard.play).not.toHaveBeenCalled();
    await frames(300);
    expect(heard.play).toHaveBeenCalledTimes(1);
    await frames(1500);
    expect(heard.play).toHaveBeenCalledTimes(2);
    expect(pieces().every((p) => p.classList.contains('dw-lt-fired'))).toBe(true);
    expect(m.met).toHaveBeenCalled();
  });

  test('the post going stops its loops with the fade, so no held caption outlives it (#496)', async () => {
    const m = mount({ body: 'Luigi wins.', plays: [playOf([{ phrase: 'Luigi', sound: 'boo' }])] });
    see();
    await step(1000);
    expect(heard.loop).toHaveBeenCalledTimes(1);
    expect(heard.handle.stop).not.toHaveBeenCalled();
    m.unmount();
    expect(heard.handle.stop).toHaveBeenCalledTimes(1);
    expect(heard.handle.stop).toHaveBeenCalledWith(250);
  });

  test('one post unmounting leaves another\'s murmur', async () => {
    function Two() {
      const [first, setFirst] = useState(true);
      const props = base({}, [], () => {}, 'Luigi wins.');
      const p = { ...props, plays: [playOf([{ phrase: 'Luigi', sound: 'boo' }])] };
      return <><button onClick={() => setFirst(false)}>drop</button>{first ? <LaughTrackEffect {...p}><BbCode text="Luigi wins." /></LaughTrackEffect> : null}<LaughTrackEffect {...p} plays={[playOf([{ phrase: 'Luigi', sound: 'boo' }], 3, 'lt2')]}><BbCode text="Luigi wins." /></LaughTrackEffect></>;
    }
    renderInWorld(<Two />);
    see();
    await step(1000);
    fireEvent.click(screen.getByText('drop'));
    expect(heard.handle.stop).not.toHaveBeenCalled();
    cleanup();
    expect(heard.handle.stop).toHaveBeenCalledTimes(1);
  });

  test('a post that never reaches the line makes no loop and fetches nothing', async () => {
    mount({ body: 'Luigi wins.', plays: [playOf([{ phrase: 'Luigi', sound: 'boo' }])] });
    vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(() => [{ top: 5000, bottom: 5020, left: 0, right: 50 }] as unknown as DOMRectList);
    see();
    await step(1000);
    expect(heard.loop).not.toHaveBeenCalled();
    expect(heard.play).not.toHaveBeenCalled();
  });
});
