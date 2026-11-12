/**
 * How a post's effects nest (`PostEffects`): each card's wraps the ones played before it, so the latest is outermost, except a card with
 * `CardUi.beneath`, which nests innermost under every card without it, and a takeover, which is outermost. The cards are the engine's own
 * test cards, never an instance's.
 */
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, test } from 'vitest';
import { landsOn, ok, type CardRules } from '../../rules/cards.ts';
import type { Instance } from '../../rules/types.ts';
import { KayfaProvider, type Kayfa } from '../context.tsx';
import type { Act } from '../data/api.ts';
import { PlayerProvider } from '../player.tsx';
import { buildWorld, testInstance } from '../test-world.tsx';
import { PostEffects } from './Effects.tsx';
import { createPlays } from './plays.ts';
import type { CardUi, EffectProps } from './types.ts';

const rules = (key: string): CardRules => ({
  key, name: key, alignment: 'pepperoni', rarity: 'common', reaches: ['post'], playPrice: () => 0, validateConfig: (c: unknown) => ok(c),
  canApply: (t, e, _config, now) => landsOn({ key, reaches: ['post'] }, t, e, now),
});
const KEYS = ['one', 'two', 'three'];
const instance: Instance = { ...testInstance, cards: KEYS.map(rules) };
const at = '2026-10-29T12:00:00.000Z';
/** A play, its layer and time ordering it after the ones before in `played`. */
const play = (card: string, n: number): Act => ({
  id: `play-${card}`, character: 'c9', kind: 'card', thread: 't1', targetActId: 'p1', seq: null, createdAt: `2026-10-29T12:00:0${n}.000Z`,
  payload: { card, message: '', config: {}, layer: n }, currentPayload: {}, editedAt: null, shownEditedAt: null,
});
const words: Act = { id: 'p1', character: 'c1', kind: 'post', thread: 't1', targetActId: null, seq: 1, createdAt: at, payload: { body: 'hi' }, currentPayload: { body: 'hi' }, editedAt: null, shownEditedAt: null };
const wrap = (key: string) => ({ children }: EffectProps): ReactNode => <div data-kb-wrap={key}>{children}</div>;
const ui = (key: string, extra: Partial<CardUi> = {}): CardUi => ({ key, art: { color: '#ffd23f', ink: '#1a1300', canvas: '', mark: '', credit: 'Test' }, describe: () => `${key}.`, Effect: wrap(key), ...extra });

/** The cards' wraps from the outside in, as the page nests them. */
function nesting(cards: CardUi[], played: string[]): string[] {
  const kayfa = { api: buildWorld({}, instance), instance, ui: { cards, glass: {} }, settings: {} } as unknown as Kayfa;
  const store = createPlays();
  store.add(played.map((c, i) => play(c, i + 1)));
  const { container } = render(<KayfaProvider value={kayfa}><PlayerProvider api={kayfa.api}><PostEffects plays={store} post={words} place="thread" nameOf={() => 'x'}><span data-kb-words>hi</span></PostEffects></PlayerProvider></KayfaProvider>);
  const out: string[] = [];
  for (let el = container.querySelector('[data-kb-wrap]'); el; el = el.querySelector(':scope > [data-kb-wrap]')) out.push(el.getAttribute('data-kb-wrap')!);
  return out;
}

describe('how effects nest', () => {
  test('in play order, the latest outermost, where no card is beneath', () => {
    expect(nesting([ui('one'), ui('two')], ['one', 'two'])).toEqual(['two', 'one']);
  });

  test('a beneath card nests inside a later card without it', () => {
    expect(nesting([ui('one', { beneath: true }), ui('two')], ['one', 'two'])).toEqual(['two', 'one']);
  });

  test('a beneath card played last is still innermost', () => {
    expect(nesting([ui('one'), ui('two', { beneath: true })], ['one', 'two'])).toEqual(['one', 'two']);
  });

  test('among several beneath cards, play order holds, under every card without it', () => {
    expect(nesting([ui('one', { beneath: true }), ui('two'), ui('three', { beneath: true })], ['one', 'two', 'three'])).toEqual(['two', 'three', 'one']);
  });

  test('a takeover is outermost whatever else is beneath it', () => {
    expect(nesting([ui('one', { takeover: true }), ui('two', { beneath: true }), ui('three')], ['one', 'two', 'three'])).toEqual(['one', 'three', 'two']);
  });
});
