/**
 * The still contract (docs/plans/2026-11-03-effect-history-plan.md, Task 7; engine/ui/cards/types.ts, `EffectProps.still`): every card
 * of the instance that a moment draws (`drawnInMoment`) and that has an effect is drawn under `still` without saving, releasing,
 * meeting or holding the screen, however a reader presses and drags across it. Today that is Whoops! and Feelin' Fab (and Glitter Bomb,
 * which lasts, though it lands beyond a post and so is named in a moment, never drawn); a card added later that skips the contract fails
 * here. A vitest file, since it draws the effects: cards.test.ts runs under node:test with no document.
 */
import { act, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { drawnInMoment } from '../../../engine/rules/cards.ts';
import type { CardPlay, EffectProps } from '../../../engine/ui/cards/types.ts';
import { MomentEffects } from '../../../engine/ui/cards/Effects.tsx';
import type { Act, PlayMoment } from '../../../engine/ui/data/api.ts';
import { renderInWorld } from '../../../engine/ui/test-world.tsx';
import { instance } from '../index.ts';
import { instanceUi } from './index.ts';
import { NO_INK } from '../../../engine/ui/cards/claims.ts';

const POST = { id: 'p1', character: 'c1', kind: 'post', thread: 't1', targetActId: null, seq: 1, createdAt: '2026-11-03T12:00:00.000Z', payload: { body: 'hi' }, currentPayload: { body: 'hi' }, editedAt: null, shownEditedAt: null } as Act;

beforeEach(() => {
  /* Every box has a size, so an effect that measures itself builds what it draws, and a drag lands on it. */
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 988 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 600 });
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  delete (HTMLElement.prototype as { clientWidth?: unknown }).clientWidth;
  delete (HTMLElement.prototype as { offsetHeight?: unknown }).offsetHeight;
});

/* Glitter Bomb lands beyond a post, so a moment names it and never draws it; if one is ever drawn (a post's own Effect, still), it keeps the contract too. */
const drawn = instanceUi.cards.filter((c) => c.Effect && (c.key === 'glitter-bomb' || drawnInMoment(instance.cards.find((r) => r.key === c.key)!)));

test('the instance has cards a moment draws, Whoops! and Feelin\' Fab among them, and Glitter Bomb is held to the same contract', () => {
  expect(drawn.map((c) => c.key)).toEqual(expect.arrayContaining(['whoops', 'feelin-fab', 'glitter-bomb']));
});

test.each(drawn.map((c) => [c.key, c] as const))('%s, drawn still, saves, releases, meets and holds nothing, whatever is pressed', (key, card) => {
  const plays: CardPlay[] = [1, 2].map((n) => ({ id: `${key}-${n}`, card: key, layer: n, caster: 'c2', message: '', config: { color: '#ffd93d', seed: n }, playedAt: `2026-11-03T12:0${n}:00.000Z`, post: POST.id }));
  const save = vi.fn(async (play: string) => ({ ok: true as const, value: { play, savedAt: '2026-11-03T13:00:00.000Z' } }));
  const release = vi.fn(async (play: string) => ({ ok: true as const, value: { play, releasedAt: '2026-11-03T13:00:00.000Z' } }));
  const met = vi.fn();
  const holdScreen = vi.fn();
  const Effect = card.Effect!;
  const props: EffectProps = {
    post: POST, plays, states: {}, released: new Set(), written: new Map(), reader: { author: true, caster: true }, place: 'thread', reach: 'post', still: true,
    show: () => {}, met, holdScreen, ink: NO_INK, marks: null, save, release, nameOf: () => 'Spritey', give: async () => ({ ok: false, error: 'no' }), moreGifts: async () => {}, wallet: null, children: <p>hi</p>,
  };
  const { container } = renderInWorld(<Effect {...props} />, { settings: { cardSettings: { 'whoops.clean': 95 } } });
  act(() => { vi.advanceTimersByTime(100); });
  /* A press and a drag across every element, and every key a hold or a scrub answers to. */
  for (const el of [...container.querySelectorAll<HTMLElement>('*')]) {
    act(() => {
      fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1, button: 0, pointerType: 'mouse' });
      for (let x = 100; x <= 700; x += 50) fireEvent.pointerMove(el, { clientX: x, clientY: 100 + x / 4, pointerId: 1, pointerType: 'mouse' });
      fireEvent.pointerUp(el, { clientX: 700, clientY: 275, pointerId: 1, pointerType: 'mouse' });
      fireEvent.keyDown(el, { key: ' ' });
      fireEvent.keyUp(el, { key: ' ' });
    });
  }
  act(() => { vi.advanceTimersByTime(10_000); });
  expect(save).not.toHaveBeenCalled();
  expect(release).not.toHaveBeenCalled();
  expect(met).not.toHaveBeenCalled();
  expect(holdScreen.mock.calls.filter(([held]) => held === true)).toEqual([]);
  /* Nothing is made inert, and nothing is lifted out of the post. */
  expect(container.querySelector('[inert]')).toBeNull();
});

test('Glitter Bomb drawn from a spin\'s moment is the still form: the flakes at rest, and no burst canvas sized', async () => {
  const spunAt = '2026-11-03T12:30:00.000Z';
  const origin: Act = {
    id: 'g1', character: 'c2', kind: 'card', thread: 't1', targetActId: POST.id, seq: null, createdAt: '2026-11-03T12:10:00.000Z',
    payload: { card: 'glitter-bomb', message: '', config: { seed: 7 }, layer: 1, reach: 'character', character: 'c1', ends: '2026-11-10T12:10:00.000Z' },
    currentPayload: {}, editedAt: null, shownEditedAt: null,
  };
  const moment: PlayMoment = { version: POST, layers: [{ act: origin, state: null }], above: [], recorded: true, at: spunAt };
  const { container } = renderInWorld(
    <MomentEffects moment={moment} place="origin" nameOf={() => 'Spritey'} onWords={() => {}}><p>hi</p></MomentEffects>,
    { instance, cards: instanceUi.cards },
  );
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  const box = container.querySelector('[data-kb-glitter]') as HTMLElement;
  expect(box).not.toBeNull();
  expect(box.querySelectorAll('canvas')).toHaveLength(3);
  expect((box.querySelector('canvas.dw-glitter-over') as HTMLCanvasElement).width).toBe(0);
  expect((box.querySelector('canvas.dw-glitter-under') as HTMLCanvasElement).width).toBeGreaterThan(0);
  expect(container.querySelectorAll('[data-kb-glitter]')).toHaveLength(1);
});
