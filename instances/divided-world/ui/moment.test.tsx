/**
 * The moment contract (docs/plans/2026-11-16-playable-moments-design.md, sections 1, 2 and 10; engine/ui/cards/types.ts, `EffectProps.moment`): every card of the instance that
 * a moment draws (`playsInMoment`), and Glitter Bomb, which a moment draws only as a spin's own play, runs in a moment as it runs live and still saves, releases, gives, meets and
 * holds nothing, however a reader presses, drags and keys across it, even when `reader` says the reader is the post's author and its caster (the engine never says so in a
 * moment; this holds the effect to the contract without that help). A card added later that skips the contract fails here. Only a writing card reads `still`, which is History's
 * (`VersionEffects`): every other card draws the same markup with `still` true or false. A vitest file, since it draws the effects: cards.test.ts runs under node:test with no document.
 */
import { act, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { CardPlay, CardView, EffectProps } from '../../../engine/ui/cards/types.ts';
import { MomentEffects, playsInMoment } from '../../../engine/ui/cards/Effects.tsx';
import type { Act, PlayMoment } from '../../../engine/ui/data/api.ts';
import { renderInWorld } from '../../../engine/ui/test-world.tsx';
import { instance } from '../index.ts';
import { instanceUi } from './index.ts';
import { NO_INK } from '../../../engine/ui/cards/claims.ts';

/* A page with no board's tokens in jsdom has no band for glitter to be drawn in; the band is a fixed one, as the effect's own test gives it. */
vi.mock('../../../engine/ui/shine/band.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../engine/ui/shine/band.ts')>();
  return { ...real, bandFor: vi.fn(() => ({ lo: 0.59, hi: 1, board: 'light', bright: false })) };
});

const POST = { id: 'p1', character: 'c1', kind: 'post', thread: 't1', targetActId: null, seq: 1, createdAt: '2026-11-03T12:00:00.000Z', payload: { body: 'hi' }, currentPayload: { body: 'hi' }, editedAt: null, shownEditedAt: null } as Act;
const AT = Date.parse('2026-11-03T12:30:00.000Z');

beforeEach(() => {
  /* Every box has a size, so an effect that measures itself builds what it draws, and a drag lands on it. */
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 988 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 600 });
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as { clientWidth?: unknown }).clientWidth;
  delete (HTMLElement.prototype as { offsetHeight?: unknown }).offsetHeight;
});

/* Glitter Bomb lands beyond a post, so a moment draws it only as a spin's own play on a character; it keeps the contract too. */
const drawn = instanceUi.cards.filter((c) => c.Effect && (c.key === 'glitter-bomb' || playsInMoment(instance.cards.find((r) => r.key === c.key), c)));

test('the cards a moment draws are these, Stick Around, Graffiti and Jimmy Wails are not among them, and Glitter Bomb is held to the same contract', () => {
  expect(drawn.map((c) => c.key).sort()).toEqual(['autocorrect', 'below-the-fold', 'blind-study', 'feelin-fab', 'glitter-bomb', 'hot-box', 'laugh-track', 'steel-chair', 'this', 'whodunnit', 'whoops', 'you-were-saying']);
  for (const key of ['stick-around', 'graffiti', 'jimmy-wails']) expect(drawn.map((c) => c.key)).not.toContain(key);
});

/** Cards that draw nothing but the words in jsdom (no canvas context, no layout, no motion), listed by name so that a card drawing nothing never passes by accident. The two veils change nothing on the post's words in a moment (they only say their state to the Lens), so the contract test holds them to having said a view instead. */
const BARE: readonly string[] = ['whodunnit', 'blind-study'];
const WORDS = '<p>hi</p>';

test.each(drawn.map((c) => [c.key, c] as const))('%s, drawn in a moment, saves, releases, gives, meets and holds nothing, whatever is pressed, held, keyed, touched or chosen in its Lens', async (key, card) => {
  const plays: CardPlay[] = [1, 2].map((n) => ({ id: `${key}-${n}`, card: key, layer: n, caster: 'c2', message: '', config: { color: '#ffd93d', seed: n }, playedAt: `2026-11-03T12:0${n}:00.000Z`, post: POST.id, ends: n === 1 ? '2026-11-06T12:00:00.000Z' : '2099-01-01T00:00:00.000Z' }));
  const save = vi.fn(async (play: string) => ({ ok: true as const, value: { play, savedAt: '2026-11-03T13:00:00.000Z' } }));
  const release = vi.fn(async (play: string) => ({ ok: true as const, value: { play, releasedAt: '2026-11-03T13:00:00.000Z' } }));
  const give = vi.fn(async () => ({ ok: false as const, error: 'no' }));
  const met = vi.fn();
  const holdScreen = vi.fn();
  let view: CardView | null = null;
  const Effect = card.Effect!;
  /* The engine hands a moment's effect `{ author: false, caster: false }`; this holds the effect to the contract even when told otherwise. */
  const props: EffectProps = {
    post: POST, plays, states: {}, released: new Set(), written: new Map(), reader: { author: true, caster: true }, place: 'thread', reach: 'post', still: false, moment: { at: AT },
    show: (v) => { view = v; }, met, holdScreen, ink: NO_INK, marks: null, save, release, nameOf: () => 'Spritey', give, moreGifts: async () => {}, wallet: null, children: <p>hi</p>,
  };
  const { container, unmount } = renderInWorld(<Effect {...props} />, { settings: { cardSettings: { 'whoops.clean': 95 } } });
  const later = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  /* A card's effect loads on first use (`lazy`): it is awaited, or what is pressed below is the words alone. */
  await act(async () => { await vi.dynamicImportSettled(); await vi.advanceTimersByTimeAsync(100); });
  if (!BARE.includes(key)) expect(container.innerHTML, `${key} draws more than the words in jsdom (or is listed in BARE by name)`).not.toBe(WORDS);
  if (BARE.includes(key)) expect(view, `${key} is bare in jsdom, so it must at least have said a view to the Lens`).not.toBeNull();
  /* Every control the card's Lens reports, driven as the Lens drives it, read again after each pass since a control changes what is reported. */
  const drive = async () => {
    for (const c of [...((view as CardView | null)?.controls ?? [])]) {
      if (c.kind === 'hold') { await act(async () => { c.start(); }); await later(3_000); await act(async () => { c.stop(); }); }
      else if (c.kind === 'press') await act(async () => { c.run(); });
      else if (c.kind === 'toggle') { await act(async () => { c.set(!c.on); }); await act(async () => { c.set(c.on); }); }
      else if (c.kind === 'choose') for (const o of c.options) await act(async () => { c.choose(o.value); });
      await later(200);
    }
  };
  await drive();
  await drive();
  /* A press and a drag across every element, held 1.5 s of the clock before each release, and every key a hold or a scrub answers to; then a touch. */
  const KEYS = [' ', 'Backspace', 'Enter', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  for (const el of [...container.querySelectorAll<HTMLElement>('*')]) {
    await act(async () => {
      fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1, button: 0, pointerType: 'mouse' });
      await vi.advanceTimersByTimeAsync(1_500);
      for (let x = 100; x <= 700; x += 50) fireEvent.pointerMove(el, { clientX: x, clientY: 100 + x / 4, pointerId: 1, pointerType: 'mouse' });
      fireEvent.pointerUp(el, { clientX: 700, clientY: 275, pointerId: 1, pointerType: 'mouse' });
      for (const key of KEYS) {
        fireEvent.keyDown(el, { key });
        await vi.advanceTimersByTimeAsync(1_500);
        fireEvent.keyUp(el, { key });
      }
      const at = (x: number, y: number) => ({ touches: [{ identifier: 2, clientX: x, clientY: y, target: el }], changedTouches: [{ identifier: 2, clientX: x, clientY: y, target: el }] });
      fireEvent.pointerDown(el, { clientX: 150, clientY: 150, pointerId: 2, pointerType: 'touch', isPrimary: true });
      fireEvent.touchStart(el, at(150, 150));
      await vi.advanceTimersByTimeAsync(1_500);
      for (let x = 150; x <= 650; x += 100) { fireEvent.pointerMove(el, { clientX: x, clientY: 150 + x / 5, pointerId: 2, pointerType: 'touch', isPrimary: true }); fireEvent.touchMove(el, at(x, 150 + x / 5)); }
      fireEvent.touchEnd(el, { touches: [], changedTouches: [{ identifier: 2, clientX: 650, clientY: 280, target: el }] });
      fireEvent.pointerUp(el, { clientX: 650, clientY: 280, pointerId: 2, pointerType: 'touch', isPrimary: true });
    });
  }
  await drive();
  /* An awaited, debounced save is seen only after the timers run through async turns; and a flush on leave only after the effect is unmounted. */
  await later(10_000);
  const nothing = () => {
    expect(save).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(give).not.toHaveBeenCalled();
    expect(met).not.toHaveBeenCalled();
    expect(holdScreen.mock.calls.filter(([held]) => held === true)).toEqual([]);
  };
  nothing();
  unmount();
  await later(10_000);
  nothing();
});

/*
 * Only a writing card reads `still` (types.ts): it is History's, where a writing card's tail is drawn whole. Every other card draws the same markup with it true or false.
 * Jimmy Wails and Graffiti are left out by name (issue #774): their still code is unreachable until the read of the past is built, and it is plan 2's to replace.
 */
const WRITING = ['you-were-saying'];
const LEFT_OUT = ['jimmy-wails', 'graffiti'];
const unreactive = instanceUi.cards.filter((c) => c.Effect && !WRITING.includes(c.key) && !LEFT_OUT.includes(c.key));

test('the writing cards are the one left out of the still comparison, with the two that wait for issue #774', () => {
  expect(instance.cards.filter((r) => r.writes !== undefined).map((r) => r.key)).toEqual(WRITING);
  expect(unreactive.map((c) => c.key)).toEqual(expect.arrayContaining(['whoops', 'autocorrect', 'feelin-fab', 'this', 'hot-box', 'steel-chair', 'whodunnit', 'blind-study', 'below-the-fold', 'laugh-track', 'glitter-bomb', 'stick-around']));
});

test.each(unreactive.map((c) => [c.key, c] as const))('%s draws the same markup with still true and with still false', async (key, card) => {
  const plays: CardPlay[] = [{ id: `${key}-1`, card: key, layer: 1, caster: 'c2', message: '', config: { color: '#ffd93d', seed: 1 }, playedAt: '2026-11-03T12:01:00.000Z', post: POST.id, ends: '2099-01-01T00:00:00.000Z' }];
  const Effect = card.Effect!;
  const draw = async (still: boolean) => {
    const props: EffectProps = {
      post: POST, plays, states: {}, released: new Set(), written: new Map(), reader: { author: false, caster: false }, place: 'thread', reach: 'post', still, moment: null,
      show: () => {}, met: () => {}, holdScreen: () => {}, ink: NO_INK, marks: null, save: async () => ({ ok: false, error: 'no' }), release: async () => ({ ok: false, error: 'no' }), nameOf: () => 'Spritey', give: async () => ({ ok: false, error: 'no' }), moreGifts: async () => {}, wallet: null, children: <p>hi</p>,
    };
    const { container, unmount } = renderInWorld(<Effect {...props} />);
    await act(async () => { await vi.dynamicImportSettled(); await vi.advanceTimersByTimeAsync(5_000); });
    /* React's generated ids count up across roots; they are no part of what is drawn. */
    const html = container.innerHTML.replace(/(?:_r_|:r)[0-9a-z]+[_:]/gu, 'ID');
    unmount();
    return html;
  };
  const [still, live] = [await draw(true), await draw(false)];
  expect(still).toBe(live);
  if (!BARE.includes(key)) expect(live, `${key} draws more than the words in jsdom (or is listed in BARE by name)`).not.toBe(WORDS);
});

/* A play in a moment was up at the moment's time (the engine drops one whose end is not after it), so a veil whose end is behind the clock is still up: no wore-off line, no "name is back", no "totals are showing". */
test.each(['whodunnit', 'blind-study'])('%s, in a moment with an end behind the clock, is drawn as it was up', async (key) => {
  const card = instanceUi.cards.find((c) => c.key === key)!;
  const Effect = card.Effect!;
  const shown: string[] = [];
  const props: EffectProps = {
    post: POST, plays: [{ id: `${key}-1`, card: key, layer: 1, caster: 'c2', message: '', config: {}, playedAt: '2026-11-03T12:00:00.000Z', post: POST.id, ends: '2026-11-06T12:00:00.000Z' }], states: {}, released: new Set(), written: new Map(), reader: { author: false, caster: false }, place: 'thread', reach: 'post', still: false, moment: { at: AT },
    show: (view) => { if (view) shown.push(view.state); }, met: () => {}, ink: NO_INK, holdScreen: () => {}, marks: null, save: async () => ({ ok: false, error: 'no' }), release: async () => ({ ok: false, error: 'no' }), nameOf: () => 'Spritey', give: async () => ({ ok: false, error: 'no' }), moreGifts: async () => {}, wallet: null, children: <p>hi</p>,
  };
  vi.setSystemTime(Date.parse('2026-11-12T12:00:00.000Z'));
  const { container } = renderInWorld(<Effect {...props} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(container.textContent).not.toContain('all along');
  await vi.waitFor(() => expect(shown.length).toBeGreaterThan(0));
  expect(shown.at(-1)).toBe(key === 'whodunnit' ? 'Author hidden from everyone' : 'Totals hidden from you');
});

test('Glitter Bomb drawn from a spin\'s moment is the live effect: it is watched for its place in view, to join the shine loop and arm its burst', async () => {
  const spunAt = '2026-11-03T12:30:00.000Z';
  const origin: Act = {
    id: 'g1', character: 'c2', kind: 'card', thread: 't1', targetActId: POST.id, seq: null, createdAt: '2026-11-03T12:10:00.000Z',
    payload: { card: 'glitter-bomb', message: '', config: { seed: 7 }, layer: 1, reach: 'character', character: 'c1', ends: '2026-11-10T12:10:00.000Z' },
    currentPayload: {}, editedAt: null, shownEditedAt: null,
  };
  const moment: PlayMoment = { version: POST, layers: [{ act: origin, state: null }], above: [], recorded: true, at: spunAt };
  /* The glitter is in view the moment it is watched, as a post on screen is, and what is watched is kept. */
  const watched: Element[] = [];
  vi.stubGlobal('IntersectionObserver', class { constructor(private readonly cb: IntersectionObserverCallback) {} observe(el: Element) { watched.push(el); this.cb([{ target: el, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry], this as unknown as IntersectionObserver); } unobserve() {} disconnect() {} takeRecords() { return []; } });
  const { container } = renderInWorld(
    <MomentEffects moment={moment} place="origin" nameOf={() => 'Spritey'} onView={() => {}}><p>hi</p></MomentEffects>,
    { instance, cards: instanceUi.cards },
  );
  /* The effect loads on first use: the words stand until it lands. */
  await act(async () => { await vi.dynamicImportSettled(); await vi.advanceTimersByTimeAsync(500); });
  const box = container.querySelector('[data-kb-glitter]') as HTMLElement;
  expect(box).not.toBeNull();
  expect(box.querySelectorAll('canvas')).toHaveLength(3);
  expect(container.querySelectorAll('[data-kb-glitter]')).toHaveLength(1);
  /* A live glitter is watched for its place in view, to join the loop and to arm its burst. */
  expect(watched.length).toBeGreaterThan(0);
});
