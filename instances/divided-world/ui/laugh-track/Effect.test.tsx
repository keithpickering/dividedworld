/**
 * Laugh Track's effect (docs/plans/2026-11-12-laugh-track-point-plan.md, Task 4; the first plan is docs/plans/2026-11-11-laugh-track-plan.md, Task 13).
 * A reaction plays only by a gesture on a place (the design's section 1). The watcher is faked, so a test sees what each place registers and tells it
 * its nearness by hand, and `useSound` is faked, so a test sees what plays; a few tests run the real watcher over a fake observer and fake
 * frames (the mark, the loops the page makes, and that they stop when the post goes), and one runs the real `useSound` over a faked mixer
 * (a gesture with Game sounds off says its caption). jsdom has no layout: a test that needs a place on the line gives every piece a box there.
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
import { DEFAULTS, LaughTrackEffect, __resetPointer } from './Effect.tsx';
import { defaults as instanceDefaults } from '../../settings.ts';
import type { PlaceSpec } from './watch.ts';

type Off = { (): void; refresh: () => void; pin: (on: boolean) => void };
const hub = vi.hoisted(() => ({
  mode: 'fake' as 'fake' | 'real',
  specs: [] as unknown[],
  gone: new Set<unknown>(),
  forgets: 0,
  gameOn: false,
  offs: [] as unknown[],
  quiets: [] as unknown[][],
  sound: null as null | { play: (key: string, o?: unknown) => Promise<null>; loop: (key: string, o: unknown) => { setGain: (g: number) => void; stop: (f: number) => void }; caption: (key: string) => void },
}));

/* The watcher: faked, so a test sees each registration and tells a place its nearness by hand; or the real one, for the tests that run it. */
vi.mock('./watch.ts', async (original) => {
  const actual = await original<typeof import('./watch.ts')>();
  return {
    ...actual,
    forgetVoice: () => { hub.forgets++; actual.forgetVoice(); },
    quiet: (answer: unknown, fadeMs: number) => { if (hub.mode === 'real') (actual.quiet as (a: unknown, f: number) => void)(answer, fadeMs); else hub.quiets.push([answer, fadeMs]); },
    register: (spec: PlaceSpec) => {
      if (hub.mode === 'real') return actual.register(spec);
      hub.specs.push(spec);
      const off = Object.assign(vi.fn(() => { hub.gone.add(spec); }), { refresh: vi.fn(), pin: vi.fn() });
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
/** The first piece of each place: the buttons, in the page's order. */
const buttons = () => pieces().filter((p) => p.getAttribute('role') === 'button');
const lastView = (m: ReturnType<typeof mount>) => m.views.filter(Boolean).at(-1)!;
/** The places registered with the watcher and not let go. */
const live = () => (hub.specs as PlaceSpec[]).filter((s) => !hub.gone.has(s));
const spec = (i: number) => hub.specs[i] as PlaceSpec;
const off = (i: number) => hub.offs[i] as Off;
/** The take the seed picks for place `i` of the play `lt1` (design section 6): the same on every screen. */
const take = (sound: string, i: number, seed = 7, id = 'lt1') => `laugh-track.${sound}-${1 + Math.floor(seeded(`${id}:${seed}:${i}`)() * 3)}`;
const move = (target: Element, x: number, y: number, pointerType = 'mouse') => fireEvent.pointerMove(target, { clientX: x, clientY: y, pointerType });
const enter = (target: Element, x: number, y: number, pointerType = 'mouse') => fireEvent.pointerEnter(target, { clientX: x, clientY: y, pointerType });
const PLAYED = { group: 'audience', fadeMs: 250, tailMs: 250 };

const fakeSoundHub = () => {
  const handle = { setGain: vi.fn(), stop: vi.fn() };
  return { play: vi.fn(async () => null), loop: vi.fn(() => handle), caption: vi.fn(), handle };
};
let heard: ReturnType<typeof fakeSoundHub>;

beforeEach(() => {
  __resetPointer();
  hub.mode = 'fake'; hub.specs = []; hub.offs = []; hub.gone = new Set(); hub.forgets = 0; hub.gameOn = false; hub.quiets = [];
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
  test('each place is a button from the start: its first piece is named by its words and "Play the audience\'s reaction"', () => {
    mount({ body: BODY + QUOTE });
    expect(pieces().map((p) => [p.textContent, p.getAttribute('data-sound')])).toEqual([['Luigi', 'boo'], ['great', 'cheer'], ['Luigi', 'boo'], ['Mario is', 'laugh'], ['great', 'cheer']]);
    for (const p of pieces()) {
      expect(p).not.toHaveClass('dw-lt-fired');
      expect(p).toHaveAttribute('role', 'button');
      expect(p).toHaveAttribute('aria-label', `${p.textContent}. Play the audience's reaction`);
    }
    /* A quote's words are not in the visible text, so no place is drawn there. */
    expect(document.querySelector('blockquote .dw-lt-cue')).toBeNull();
    expect(live()).toHaveLength(5);
    expect(live().map((s) => s.kind)).toEqual(['boo', 'cheer', 'boo', 'laugh', 'cheer']);
  });

  test('a place that spans pieces has the button on its first piece alone', () => {
    mount({ body: 'Luigi is [b]great[/b] today and Luigi is [b]great[/b] again.', plays: [playOf([{ phrase: 'is great', sound: 'cheer' }])] });
    const spans = pieces();
    expect(spans.length).toBeGreaterThan(buttons().length);
    for (const p of spans) if (p.getAttribute('role') !== 'button') expect(p).not.toHaveAttribute('aria-label');
  });

  test('a cue whose phrase is no longer in the post draws no place and stays quiet', () => {
    const m = mount({ plays: [playOf([{ phrase: 'Wario', sound: 'boo' }, { phrase: 'Luigi', sound: 'boo' }])] });
    expect(pieces().map((p) => p.textContent)).toEqual(['Luigi', 'Luigi']);
    m.edit('Mario wins.');
    expect(pieces()).toHaveLength(0);
    expect(live()).toHaveLength(0);
    expect(lastView(m).state).toBe('No cues in this version');
  });

  test('a click plays the seeded take, marks the place heard, names it for a replay, focuses nothing and says the card is met once', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const m = mount();
    fireEvent.click(pieces()[0]!);
    expect(heard.play).toHaveBeenCalledTimes(1);
    expect(heard.play).toHaveBeenCalledWith(take('boo', 0), PLAYED);
    const [first, second] = pieces();
    expect(first).toHaveClass('dw-lt-fired');
    expect(first).toHaveAttribute('role', 'button');
    expect(first).toHaveAttribute('aria-label', `${first!.textContent}. Replay: the audience boos`);
    expect(first!.getAttribute('aria-label')!.startsWith(first!.textContent!)).toBe(true);
    expect(second).not.toHaveClass('dw-lt-fired');
    expect(pieces().filter((p) => p.getAttribute('data-sound') === 'boo')[1]).not.toHaveClass('dw-lt-fired');
    expect(document.activeElement).toBe(document.body);
    expect(m.met).toHaveBeenCalledTimes(1);
    fireEvent.click(pieces()[1]!);
    expect(m.met).toHaveBeenCalledTimes(1);
    expect(heard.play).toHaveBeenLastCalledWith(take('cheer', 1), PLAYED);
    expect(pieces()[1]).toHaveAttribute('aria-label', `${pieces()[1]!.textContent}. Replay: the audience cheers`);
    vi.setSystemTime(Date.now() + 1000);
    fireEvent.click(pieces()[3]!);
    expect(pieces()[3]).toHaveAttribute('aria-label', 'Mario is. Replay: the audience laughs');
  });

  test('the take comes from the play, its seed and the place, so two places of one cue may differ and every screen agrees', () => {
    mount();
    const picked = [0, 1, 2, 3, 4].map((i) => take(['boo', 'cheer', 'boo', 'laugh', 'cheer'][i]!, i));
    for (const p of pieces()) fireEvent.click(p);
    expect(heard.play.mock.calls.map((c) => (c as unknown[])[0])).toEqual(picked);
    expect(new Set(picked).size).toBeGreaterThan(1);
  });

  test('the underline is a text-decoration, so no word moves, and the effect adds no box of its own to a piece', () => {
    mount();
    fireEvent.click(pieces()[0]!);
    const p = pieces()[0]!;
    expect(p.tagName).toBe('SPAN');
    expect(p.parentElement!.textContent).toContain('Luigi is great.');
  });
});

describe('Laugh Track: the gestures', () => {
  test('a mouse that moves onto a place plays its take, marks it heard and says the card is met once', () => {
    const m = mount();
    const [p, q] = pieces();
    act(() => { move(document.body, 1, 1); });
    act(() => { enter(p!, 10, 10); });
    expect(heard.play).toHaveBeenCalledTimes(1);
    expect(heard.play).toHaveBeenCalledWith(take('boo', 0), PLAYED);
    expect(p).toHaveClass('dw-lt-fired');
    expect(m.met).toHaveBeenCalledTimes(1);
    act(() => { enter(q!, 40, 10); });
    expect(heard.play).toHaveBeenCalledTimes(2);
    expect(m.met).toHaveBeenCalledTimes(1);
  });

  test('a place that scrolls under a resting mouse does not fire; the next move over it does; a touch brushing it does not', () => {
    const m = mount();
    const [p] = pieces();
    act(() => { move(document.body, 5, 5); });
    act(() => { enter(p!, 5, 5); });
    expect(heard.play).not.toHaveBeenCalled();
    expect(p).not.toHaveClass('dw-lt-fired');
    act(() => { move(p!, 6, 6); });
    expect(heard.play).toHaveBeenCalledTimes(1);
    expect(m.met).toHaveBeenCalledTimes(1);
    const q = pieces()[1]!;
    act(() => { enter(q, 40, 40, 'touch'); });
    act(() => { move(q, 41, 41, 'touch'); });
    expect(heard.play).toHaveBeenCalledTimes(1);
    expect(q).not.toHaveClass('dw-lt-fired');
  });

  test('a mouse resting still over a place, moved by a hair of nothing, fires only once a place is left and entered again', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    mount();
    const [p] = pieces();
    act(() => { move(document.body, 1, 1); });
    act(() => { enter(p!, 10, 10); });
    expect(heard.play).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 1000);
    act(() => { move(p!, 11, 11); });
    expect(heard.play).toHaveBeenCalledTimes(1);
    act(() => { fireEvent.pointerLeave(p!, { pointerType: 'mouse' }); });
    act(() => { enter(p!, 12, 12); });
    expect(heard.play).toHaveBeenCalledTimes(2);
  });

  test('a mouse moving from one piece of a place into another piece of it is not a new entry; leaving the place and coming back is', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    mount({ body: 'Luigi is [b]great[/b] today.', plays: [playOf([{ phrase: 'is great', sound: 'cheer' }])] });
    const [a, b] = pieces();
    expect(a!.getAttribute('data-lt-place')).toBe(b!.getAttribute('data-lt-place'));
    act(() => { move(document.body, 1, 1); });
    act(() => { enter(a!, 10, 10); });
    expect(heard.play).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 1000);
    act(() => { fireEvent.pointerLeave(a!, { pointerType: 'mouse', relatedTarget: b }); enter(b!, 30, 10); move(b!, 40, 20); });
    expect(heard.play).toHaveBeenCalledTimes(1);
    act(() => { fireEvent.pointerLeave(b!, { pointerType: 'mouse', relatedTarget: document.body }); });
    vi.setSystemTime(Date.now() + 1000);
    act(() => { enter(a!, 60, 30); });
    expect(heard.play).toHaveBeenCalledTimes(2);
  });

  test('a tap or click fires, Enter and Space fire (default-prevented), and a second gesture inside 300ms does not play twice', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    mount();
    const [p, q, r] = pieces();
    /* A mouse press focuses a button and then clicks it: one take. */
    act(() => { enter(p!, 10, 10); p!.focus(); fireEvent.click(p!); });
    expect(heard.play).toHaveBeenCalledTimes(1);
    const again = (target: HTMLElement, gesture: () => void) => { vi.setSystemTime(Date.now() + 1000); heard.play.mockClear(); act(gesture); expect(heard.play).toHaveBeenCalledTimes(1); expect(heard.play).toHaveBeenCalledWith(expect.any(String), PLAYED); void target; };
    again(p!, () => { fireEvent.click(p!); });
    again(p!, () => { fireEvent.keyDown(p!, { key: 'Enter' }); });
    again(p!, () => { fireEvent.keyDown(p!, { key: ' ' }); });
    /* Enter and Space are default-prevented, so a Space does not scroll the page; other keys are not. */
    vi.setSystemTime(Date.now() + 1000);
    expect(fireEvent.keyDown(q!, { key: ' ' })).toBe(false);
    vi.setSystemTime(Date.now() + 1000);
    expect(fireEvent.keyDown(r!, { key: 'Enter' })).toBe(false);
    expect(fireEvent.keyDown(r!, { key: 'a' })).toBe(true);
  });

  test('nothing else fires: the registration has no fire, and nothing the watcher calls plays a take', () => {
    mount();
    for (const s of hub.specs as PlaceSpec[]) {
      expect(s).not.toHaveProperty('fire');
      s.near(1); s.near(0.4); s.near(0);
      s.voice(s.kind);
    }
    expect(heard.play).not.toHaveBeenCalled();
    for (const p of pieces()) expect(p).not.toHaveClass('dw-lt-fired');
  });

  test('a fire and a replay call quiet with the play\'s promise and the fade', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    mount();
    const [p] = pieces();
    fireEvent.click(p!);
    expect(hub.quiets).toHaveLength(1);
    expect(hub.quiets[0]![0]).toBe(heard.play.mock.results[0]!.value);
    expect(hub.quiets[0]![1]).toBe(250);
    vi.setSystemTime(Date.now() + 1000);
    fireEvent.click(p!);
    expect(hub.quiets).toHaveLength(2);
    expect(hub.quiets[1]![0]).toBe(heard.play.mock.results[1]!.value);
  });

  test('a gesture played inside the guard says nothing to the quiet either', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    mount();
    const [p] = pieces();
    fireEvent.click(p!);
    fireEvent.click(p!);
    expect(heard.play).toHaveBeenCalledTimes(1);
    expect(hub.quiets).toHaveLength(1);
  });
});

describe('Laugh Track: where the mouse last was (the design\'s section 1, "The mouse must move")', () => {
  test('a post mounted later knows where the mouse last was: its place entered there plays nothing, a move over it plays', () => {
    mount();
    act(() => { move(document.body, 10, 10); });
    mount();
    const b = pieces()[5];
    expect(pieces()).toHaveLength(10);
    act(() => { enter(b!, 10, 10); });
    expect(heard.play).not.toHaveBeenCalled();
    act(() => { move(b!, 11, 10); });
    expect(heard.play).toHaveBeenCalledTimes(1);
  });

  test('with no last position at all, an enter fires nothing and records where it was; a move there does nothing; a move elsewhere plays once', () => {
    mount();
    const [p] = pieces();
    act(() => { enter(p!, 50, 50); });
    expect(heard.play).not.toHaveBeenCalled();
    act(() => { move(p!, 50, 50); });
    expect(heard.play).not.toHaveBeenCalled();
    act(() => { move(p!, 51, 50); });
    expect(heard.play).toHaveBeenCalledTimes(1);
    act(() => { move(p!, 52, 50); });
    expect(heard.play).toHaveBeenCalledTimes(1);
  });

  test('with no last position at all and no enter seen, a move over a place fires nothing; the next move elsewhere plays once', () => {
    mount();
    const [p] = pieces();
    act(() => { move(p!, 50, 50); });
    expect(heard.play).not.toHaveBeenCalled();
    act(() => { move(p!, 50, 50); });
    expect(heard.play).not.toHaveBeenCalled();
    act(() => { move(p!, 51, 50); });
    expect(heard.play).toHaveBeenCalledTimes(1);
  });

  test('an enter that fires is not fired again by the same-position move that follows it', () => {
    mount();
    const [p] = pieces();
    act(() => { move(document.body, 1, 1); });
    act(() => { enter(p!, 20, 20); move(p!, 20, 20); });
    expect(heard.play).toHaveBeenCalledTimes(1);
  });

  test('one pointermove listener serves every post, and it is gone when the last post is', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const m = mount({ posts: 2 });
    expect(add.mock.calls.filter((c) => c[0] === 'pointermove')).toHaveLength(1);
    expect(remove.mock.calls.filter((c) => c[0] === 'pointermove')).toHaveLength(0);
    m.unmount();
    expect(remove.mock.calls.filter((c) => c[0] === 'pointermove')).toHaveLength(1);
  });

  test('a place whose pieces were removed under the mouse can be fired again by a fresh enter', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const m = mount();
    const [p] = pieces();
    act(() => { move(document.body, 1, 1); });
    act(() => { enter(p!, 10, 10); });
    expect(heard.play).toHaveBeenCalledTimes(1);
    /* The pieces go while the mouse is over them: no pointerleave comes. */
    m.edit('Mario wins.');
    expect(pieces()).toHaveLength(0);
    m.edit(BODY);
    vi.setSystemTime(Date.now() + 1000);
    act(() => { enter(pieces()[0]!, 30, 30); });
    expect(heard.play).toHaveBeenCalledTimes(2);
  });
});

describe('Laugh Track: the mark', () => {
  const near = (el: Element) => (el as HTMLElement).style.getPropertyValue('--dw-lt-near');

  test('near(0.5) sets --dw-lt-near to 0.5 on every piece of that place and on no other', () => {
    mount({ body: 'Luigi is [b]great[/b] today and Luigi is great.', plays: [playOf([{ phrase: 'is great', sound: 'cheer' }, { phrase: 'Luigi', sound: 'boo' }])] });
    const first = hub.specs.findIndex((s) => (s as PlaceSpec).kind === 'cheer');
    act(() => { spec(first).near(0.5); });
    const key = pieces().find((p) => p.getAttribute('data-sound') === 'cheer')!.getAttribute('data-lt-place')!;
    const mine = pieces().filter((p) => p.getAttribute('data-lt-place') === key);
    expect(mine.length).toBeGreaterThan(0);
    for (const p of mine) expect(near(p)).toBe('0.5');
    for (const p of pieces().filter((p) => p.getAttribute('data-lt-place') !== key)) expect(near(p)).toBe('');
  });

  test('the mark is scaled by laughTrack.markMost: at 40, near(0.5) is 0.2; at 0 it is 0', () => {
    mount({ cardSettings: { 'laughTrack.markMost': 40 } });
    act(() => { spec(0).near(0.5); });
    expect(near(pieces()[0]!)).toBe('0.2');
    cleanup();
    hub.specs = [];
    mount({ cardSettings: { 'laughTrack.markMost': 0 } });
    act(() => { spec(0).near(1); });
    expect(pieces()[0]!.style.getPropertyValue('--dw-lt-near')).toBe('');
    expect(pieces()[0]!.style.cssText).not.toContain('--dw-lt-near');
  });

  test('a nearness of 0 takes the property off the pieces, so the pointer cursor follows only a showing mark', () => {
    mount();
    act(() => { spec(0).near(0.5); });
    expect(pieces()[0]!.style.cssText).toContain('--dw-lt-near');
    act(() => { spec(0).near(0); });
    for (const p of pieces()) { expect(near(p)).toBe(''); expect(p.style.cssText).not.toContain('--dw-lt-near'); }
  });

  test('near on a place whose pieces were drawn again sets the new pieces', () => {
    mount();
    const old = pieces()[0]!;
    const fresh = old.cloneNode(true) as HTMLElement;
    old.replaceWith(fresh);
    act(() => { spec(0).near(0.7); });
    expect(near(fresh)).toBe('0.7');
  });

  test('no state is set for a nearness: telling a place its nearness draws nothing again', () => {
    mount();
    const before = pieces();
    act(() => { spec(0).near(0.3); spec(0).near(0.9); });
    expect(pieces().every((p, i) => p === before[i])).toBe(true);
  });

  test('a heard place wears the class that shows its mark at full, and the watcher is no longer told about it', () => {
    mount();
    fireEvent.click(pieces()[0]!);
    expect(pieces()[0]).toHaveClass('dw-lt-fired');
    expect(hub.gone.has(spec(0))).toBe(true);
    expect(live()).toHaveLength(4);
  });
});

describe('Laugh Track: one stop for a post', () => {
  const stops = () => buttons().map((b) => b.getAttribute('tabindex'));

  test('exactly one first piece has tabindex 0 and the rest -1', () => {
    mount();
    expect(buttons()).toHaveLength(5);
    expect(stops()).toEqual(['0', '-1', '-1', '-1', '-1']);
  });

  test('the arrows move among the post\'s places with no wrap, Home and End go to the first and last, and the focused place becomes the stop', () => {
    mount();
    const b = buttons();
    act(() => { b[0]!.focus(); });
    const key = (i: number, k: string) => act(() => { fireEvent.keyDown(buttons()[i]!, { key: k }); });
    key(0, 'ArrowRight'); expect(document.activeElement).toBe(b[1]);
    key(1, 'ArrowDown'); expect(document.activeElement).toBe(b[2]);
    key(2, 'ArrowLeft'); expect(document.activeElement).toBe(b[1]);
    key(1, 'ArrowUp'); expect(document.activeElement).toBe(b[0]);
    key(0, 'ArrowLeft'); expect(document.activeElement).toBe(b[0]);
    key(0, 'End'); expect(document.activeElement).toBe(b[4]);
    key(4, 'ArrowRight'); expect(document.activeElement).toBe(b[4]);
    key(4, 'ArrowDown'); expect(document.activeElement).toBe(b[4]);
    expect(stops()).toEqual(['-1', '-1', '-1', '-1', '0']);
    key(4, 'Home'); expect(document.activeElement).toBe(b[0]);
    expect(stops()).toEqual(['0', '-1', '-1', '-1', '-1']);
    /* Moving among places plays nothing. */
    expect(heard.play).not.toHaveBeenCalled();
  });

  test('a place removed while it was the stop hands the stop to the first place', () => {
    const m = mount();
    act(() => { buttons()[4]!.focus(); });
    act(() => { buttons()[4]!.blur(); });
    expect(stops()).toEqual(['-1', '-1', '-1', '-1', '0']);
    m.edit('Luigi is great. Luigi wins, and Mario is');
    expect(buttons()).toHaveLength(4);
    expect(stops()).toEqual(['0', '-1', '-1', '-1']);
  });

  test('a heard place stays a button and can be the stop', () => {
    mount();
    fireEvent.click(pieces()[0]!);
    act(() => { buttons()[2]!.focus(); });
    expect(stops()).toEqual(['-1', '-1', '0', '-1', '-1']);
  });
});

/* Decisions on the effect (issues #602, which replaced #576's, and #577): a Laugh Track never cues a link, and selecting to quote plays nothing. */
describe('Laugh Track: no cue is drawn inside a link (#602)', () => {
  /* Only an autolink's words are visible text (a [url]'s words are its target's name, engine/bbcode/visible.ts), and the matcher fuses punctuation between letters, so a cue lands in a link only as the whole bare address. */
  const URL = 'https://example.com/Luigi';
  const LINKED = `Visit ${URL} and Luigi is great.`;
  const LINK_CUES = [{ phrase: URL, sound: 'boo' }, { phrase: 'Luigi', sound: 'laugh' }];
  const anchor = () => document.querySelector<HTMLAnchorElement>('a')!;

  test('the address is drawn as plain link text: no cue inside the link, and its words are all there', () => {
    mount({ body: LINKED, plays: [playOf(LINK_CUES)] });
    expect(anchor().textContent).toBe(URL);
    expect(anchor().querySelector('.dw-lt-cue')).toBeNull();
    expect(anchor().querySelector('[data-lt-place]')).toBeNull();
    expect(pieces().map((p) => p.textContent)).toEqual(['Luigi']);
    expect(document.body.textContent).toContain(`Visit ${URL} and Luigi is great.`);
  });

  test('the other place is a button that plays on a click and Enter, and the Lens counts one', () => {
    const m = mount({ body: LINKED, plays: [playOf(LINK_CUES)] });
    expect(lastView(m).state).toBe('0 of 1 places heard');
    expect(buttons()).toHaveLength(1);
    expect(buttons()[0]!).toHaveAttribute('tabindex', '0');
    vi.useFakeTimers({ toFake: ['Date'] });
    fireEvent.click(buttons()[0]!);
    expect(heard.play).toHaveBeenCalledTimes(1);
    expect(lastView(m).state).toBe('1 of 1 places heard');
    vi.setSystemTime(Date.now() + 1000);
    fireEvent.keyDown(buttons()[0]!, { key: 'Enter' });
    expect(heard.play).toHaveBeenCalledTimes(2);
  });

  test('a phrase that starts outside the link and ends inside it draws nothing, and the words after the link still line up', () => {
    mount({ body: LINKED, plays: [playOf([{ phrase: `Visit ${URL}`, sound: 'boo' }, { phrase: 'great', sound: 'cheer' }])] });
    expect(pieces().map((p) => p.textContent)).toEqual(['great']);
    expect(anchor().querySelector('.dw-lt-cue')).toBeNull();
    expect(document.body.textContent).toContain(`Visit ${URL} and Luigi is great.`);
  });

  test('a post whose only place is in a link has no cue, no stop and says there are none', () => {
    const m = mount({ body: `See ${URL} here.`, plays: [playOf([{ phrase: URL, sound: 'boo' }])] });
    expect(pieces()).toHaveLength(0);
    expect(lastView(m).state).toBe('No cues in this version');
    expect(anchor().textContent).toBe(URL);
  });
});

describe('Laugh Track: a click plays only when the selection is collapsed (#577)', () => {
  test('a click that ends a text selection plays nothing and marks nothing', () => {
    mount();
    vi.stubGlobal('getSelection', () => ({ isCollapsed: false }));
    fireEvent.click(pieces()[0]!);
    expect(heard.play).not.toHaveBeenCalled();
    expect(pieces()[0]).not.toHaveClass('dw-lt-fired');
  });

  test('a real non-collapsed range over a cue\'s text also stops the click', () => {
    mount();
    const range = document.createRange();
    range.selectNodeContents(pieces()[0]!);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent.click(pieces()[0]!);
    expect(heard.play).not.toHaveBeenCalled();
    window.getSelection()!.removeAllRanges();
  });

  test('a collapsed or absent selection plays as before', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    mount();
    vi.stubGlobal('getSelection', () => ({ isCollapsed: true }));
    fireEvent.click(pieces()[0]!);
    expect(heard.play).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 1000);
    vi.stubGlobal('getSelection', () => null);
    fireEvent.click(pieces()[1]!);
    expect(heard.play).toHaveBeenCalledTimes(2);
  });

  test('Enter and Space play with a selection present', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    mount();
    vi.stubGlobal('getSelection', () => ({ isCollapsed: false }));
    fireEvent.keyDown(buttons()[0]!, { key: 'Enter' });
    expect(heard.play).toHaveBeenCalledTimes(1);
  });
});

describe('Laugh Track: focus pins', () => {
  test('focus on an unheard place pins it and blur lets it go, and focus plays no take', () => {
    mount();
    act(() => { buttons()[1]!.focus(); });
    expect(off(1).pin).toHaveBeenCalledWith(true);
    expect(off(0).pin).not.toHaveBeenCalled();
    act(() => { buttons()[1]!.blur(); });
    expect(off(1).pin).toHaveBeenLastCalledWith(false);
    expect(heard.play).not.toHaveBeenCalled();
    expect(hub.quiets).toHaveLength(0);
  });

  test('focus on a heard place plays nothing either', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    mount();
    fireEvent.click(pieces()[0]!);
    heard.play.mockClear();
    vi.setSystemTime(Date.now() + 1000);
    act(() => { buttons()[0]!.focus(); });
    act(() => { buttons()[0]!.blur(); });
    expect(heard.play).not.toHaveBeenCalled();
  });
});

describe('Laugh Track: the registration', () => {
  test('the screen carries line, reachRem, murmurMost and fadeMs from the instance\'s settings', () => {
    mount({ cardSettings: { 'laughTrack.line': 50, 'laughTrack.reachRem': 8, 'laughTrack.murmurMost': 20, 'laughTrack.fadeMs': 400 } });
    expect(spec(0).screen).toEqual({ line: 50, reachRem: 8, murmurMost: 20, fadeMs: 400 });
  });

  test('with no card settings the screen falls back to the defaults', () => {
    mount({ cardSettings: {} });
    expect(spec(0).screen).toEqual({ line: 40, reachRem: 12, murmurMost: 35, fadeMs: 250 });
  });

  test('the instance\'s card settings for every laughTrack screen key equal the effect\'s fallback defaults', () => {
    const held = instanceDefaults.cardSettings;
    expect(Object.keys(DEFAULTS).sort()).toEqual(['fadeMs', 'line', 'markMost', 'murmurMost', 'reachRem']);
    for (const [key, value] of Object.entries(DEFAULTS)) expect(held[`laughTrack.${key}`], key).toBe(value);
  });
});

describe('Laugh Track: the Lens', () => {
  test('the views are short plain statuses, hold no reader and carry one Game sounds toggle', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const m = mount();
    const v0 = lastView(m);
    expect(v0).toMatchObject({ state: '0 of 5 places heard', progress: 0, yours: false, notes: {} });
    expect(v0).not.toHaveProperty('ends');
    expect(v0.controls).toHaveLength(1);
    expect(v0.controls[0]).toMatchObject({ kind: 'toggle', label: 'Game sounds', on: false });
    fireEvent.click(pieces()[0]!); fireEvent.click(pieces()[1]!);
    expect(lastView(m)).toMatchObject({ state: '2 of 5 places heard', progress: 0.4 });
    for (const v of m.views.filter(Boolean)) expect(viewProblems(v!, { holds: false, covers: false })).toEqual([]);
  });

  test('one cue at one place is "0 of 1 places heard" and a view is cleared when the post goes', () => {
    const m = mount({ plays: [playOf([{ phrase: 'Mario is', sound: 'laugh' }])] });
    expect(lastView(m).state).toBe('0 of 1 places heard');
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
    const [p] = pieces();
    act(() => { enter(p!, 3, 3); p!.focus(); fireEvent.click(p!); fireEvent.keyDown(p!, { key: 'Enter' }); fireEvent.keyDown(p!, { key: 'ArrowRight' }); spec(0).near(0.5); });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('Laugh Track: a play\'s moment (still)', () => {
  test('nothing registers, plays or binds, no piece is focusable, and the Lens says how many places with no controls', () => {
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
    expect(hub.quiets).toHaveLength(0);
    expect(m.met).not.toHaveBeenCalled();
    expect(lastView(m)).toMatchObject({ state: '5 places', controls: [], yours: false, notes: {} });
    expect(lastView(m).progress).toBeNull();
    expect(viewProblems(lastView(m), { holds: false, covers: false })).toEqual([]);
  });

  test('a moment with one place says "1 place"', () => {
    const m = mount({ still: true, plays: [playOf([{ phrase: 'Mario is', sound: 'laugh' }])] });
    expect(lastView(m).state).toBe('1 place');
  });

  test('the ORIGIN box behaves as the thread does', () => {
    mount({ place: 'origin' });
    expect(live()).toHaveLength(5);
    fireEvent.click(pieces()[0]!);
    expect(pieces()[0]).toHaveClass('dw-lt-fired');
  });
});

describe('Laugh Track: with Game sounds off', () => {
  test('a gesture says its caption, through the real sound hook over a faked mixer', async () => {
    hub.sound = null;
    fakeSound();
    mount({ sounds: true });
    await act(async () => { fireEvent.click(pieces()[0]!); await Promise.resolve(); await Promise.resolve(); });
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

describe('Laugh Track: unmount', () => {
  test('the post going lets every registration go', () => {
    const m = mount();
    expect(live()).toHaveLength(5);
    m.unmount();
    expect(live()).toHaveLength(0);
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
  const LUIGI = { body: 'Luigi wins.', plays: [playOf([{ phrase: 'Luigi', sound: 'boo' }])] };

  test('a place resting on the line for five seconds plays no take: its mark is full and the titter\'s loop is raised, one loop however many posts there are; a click plays the take and holds the loop at nothing', async () => {
    const m = mount({ posts: 2, ...LUIGI });
    expect(FakeObserver.all).toHaveLength(1);
    see();
    let t = 0;
    for (let i = 0; i < 50; i++) { t += 100; await step(t); }
    expect(heard.play).not.toHaveBeenCalled();
    expect(pieces().map((p) => p.style.getPropertyValue('--dw-lt-near'))).toEqual(['1', '1']);
    expect(pieces().some((p) => p.classList.contains('dw-lt-fired'))).toBe(false);
    expect(heard.loop).toHaveBeenCalledTimes(1);
    expect(heard.loop).toHaveBeenCalledWith('laugh-track.grumble', { group: 'audience-build', id: 'laugh-track:boo' });
    expect(heard.handle.setGain).toHaveBeenLastCalledWith(0.35);
    expect(m.met).not.toHaveBeenCalled();
    act(() => { fireEvent.click(pieces()[0]!); });
    expect(heard.play).toHaveBeenCalledTimes(1);
    expect(heard.play).toHaveBeenCalledWith(take('boo', 0), PLAYED);
    expect(m.met).toHaveBeenCalledTimes(1);
    expect(heard.handle.setGain).toHaveBeenLastCalledWith(0);
    /* The other post's place is near and unheard: its murmur is held while the reaction sounds (the quiet keeps the clock of `performance.now()`, which the frames' own times follow in a browser) and returns after. */
    await step(performance.now() + 100);
    expect(heard.handle.setGain).toHaveBeenLastCalledWith(0);
    await step(performance.now() + 2000);
    expect(heard.handle.setGain).toHaveBeenLastCalledWith(0.35);
  });

  test('the post going stops its loops with the fade, so no held caption outlives it (#496)', async () => {
    const m = mount(LUIGI);
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
    mount(LUIGI);
    vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(() => [{ top: 5000, bottom: 5020, left: 0, right: 50 }] as unknown as DOMRectList);
    see();
    await step(1000);
    expect(heard.loop).not.toHaveBeenCalled();
    expect(heard.play).not.toHaveBeenCalled();
  });
});
