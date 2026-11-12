/**
 * Two cards holding ink on one post (`EffectProps.ink`): each claims a hit test with the post's registry, and `topAt` is true only for the
 * outermost claimant whose hit test is true at the point, so a press works the card whose ink it lands on and falls through where it does not.
 * The cards are the engine's own test cards, never an instance's.
 */
import { render } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { describe, expect, test } from 'vitest';
import { landsOn, ok, type CardRules } from '../../rules/cards.ts';
import type { Instance } from '../../rules/types.ts';
import { KayfaProvider, type Kayfa } from '../context.tsx';
import type { Act } from '../data/api.ts';
import { PlayerProvider } from '../player.tsx';
import { buildWorld, testInstance } from '../test-world.tsx';
import { createClaims } from './claims.ts';
import { PostEffects } from './Effects.tsx';
import { createPlays } from './plays.ts';
import type { CardUi, EffectProps } from './types.ts';

describe('the ink registry', () => {
  const inside = (x0: number, x1: number) => (x: number) => x >= x0 && x <= x1;
  const box = (x0: number, x1: number) => { const h = inside(x0, x1); return (x: number, y: number) => h(x) && y >= 0 && y <= 10; };

  test('the outer of two claimants is on top where both have ink', () => {
    const claims = createClaims();
    const inner = claims.at('inner', 0);
    const outer = claims.at('outer', 1);
    inner.claim(box(0, 100));
    outer.claim(box(20, 60));
    expect(outer.topAt(30, 5)).toBe(true);
    expect(inner.topAt(30, 5)).toBe(false);
  });

  test('the inner one is on top where the outer has no ink', () => {
    const claims = createClaims();
    const inner = claims.at('inner', 0);
    const outer = claims.at('outer', 1);
    inner.claim(box(0, 100));
    outer.claim(box(20, 60));
    expect(inner.topAt(80, 5)).toBe(true);
    expect(outer.topAt(80, 5)).toBe(false);
  });

  test('nobody is on top where no claimant has ink, and a claim given back is gone', () => {
    const claims = createClaims();
    const inner = claims.at('inner', 0);
    const outer = claims.at('outer', 1);
    inner.claim(box(0, 10));
    const release = outer.claim(box(0, 10));
    expect(outer.topAt(5, 5)).toBe(true);
    release();
    expect(outer.topAt(5, 5)).toBe(false);
    expect(inner.topAt(5, 5)).toBe(true);
    expect(inner.topAt(50, 5)).toBe(false);
  });

  test('the rank is read when asked: a card played later outside the first moves the order', () => {
    const claims = createClaims();
    const a = claims.at('a', 0);
    const b = claims.at('b', 1);
    a.claim(box(0, 10)); b.claim(box(0, 10));
    expect(b.topAt(5, 5)).toBe(true);
    claims.at('a', 2);
    expect(claims.at('a', 2)).toBe(a);
    expect(a.topAt(5, 5)).toBe(true);
    expect(b.topAt(5, 5)).toBe(false);
  });

  test('an effect that unmounts and mounts again under its key claims afresh, and what it gave back stays gone', () => {
    const claims = createClaims();
    const inner = claims.at('inner', 0);
    const first = claims.at('outer', 1);
    inner.claim(box(0, 100));
    const release = first.claim(box(20, 60));
    expect(first.topAt(30, 5)).toBe(true);
    release();
    release();
    expect(first.topAt(30, 5)).toBe(false);
    expect(inner.topAt(30, 5)).toBe(true);
    /* The same key again, as a remount draws it: the same face, a new claim over other ground. */
    const again = claims.at('outer', 1);
    expect(again).toBe(first);
    again.claim(box(70, 90));
    expect(again.topAt(80, 5)).toBe(true);
    expect(again.topAt(30, 5)).toBe(false);
    expect(inner.topAt(30, 5)).toBe(true);
    expect(inner.topAt(80, 5)).toBe(false);
  });

  test('two claims of one effect: the effect is on top where either has ink', () => {
    const claims = createClaims();
    const e = claims.at('e', 0);
    e.claim(box(0, 10)); e.claim(box(50, 60));
    expect(e.topAt(55, 5)).toBe(true);
    expect(e.topAt(30, 5)).toBe(false);
  });
});

describe('the registry on a post', () => {
  const rules = (key: string): CardRules => ({
    key, name: key, alignment: 'pepperoni', rarity: 'common', reaches: ['post'], playPrice: () => 0, validateConfig: (c: unknown) => ok(c),
    canApply: (t, e, _config, now) => landsOn({ key, reaches: ['post'] }, t, e, now),
  });
  const instance: Instance = { ...testInstance, cards: [rules('under'), rules('over')] };
  const at = '2026-10-29T12:00:00.000Z';
  /* Played in the order given: `layer` and the time order them. */
  const play = (card: string, n: number): Act => ({
    id: `play-${card}`, character: 'c9', kind: 'card', thread: 't1', targetActId: 'p1', seq: null, createdAt: `2026-10-29T12:00:0${n}.000Z`,
    payload: { card, message: '', config: {}, layer: n }, currentPayload: {}, editedAt: null, shownEditedAt: null,
  });
  const words: Act = { id: 'p1', character: 'c1', kind: 'post', thread: 't1', targetActId: null, seq: 1, createdAt: at, payload: { body: 'hi' }, currentPayload: { body: 'hi' }, editedAt: null, shownEditedAt: null };

  test('each effect of a post is given the one registry, its outer effect on top where it has ink', () => {
    const seen: Record<string, EffectProps['ink']> = {};
    const Holder = (key: string, x0: number, x1: number) => function Holder({ ink, children }: EffectProps): ReactNode {
      useEffect(() => ink.claim((x) => x >= x0 && x <= x1), [ink]);
      seen[key] = ink;
      return <div data-kb-wrap={key}>{children}</div>;
    };
    const ui = (key: string, Effect: CardUi['Effect']): CardUi => ({ key, art: { color: '#ffd23f', ink: '#1a1300', canvas: '', mark: '', credit: 'Test' }, describe: () => `${key}.`, Effect });
    const kayfa = { api: buildWorld({}, instance), instance, ui: { cards: [ui('under', Holder('under', 0, 100)), ui('over', Holder('over', 20, 60))], glass: {} }, settings: {} } as unknown as Kayfa;
    const store = createPlays();
    store.add([play('under', 1), play('over', 2)]);
    render(<KayfaProvider value={kayfa}><PlayerProvider api={kayfa.api}><PostEffects plays={store} post={words} place="thread" nameOf={() => 'x'}><span>hi</span></PostEffects></PlayerProvider></KayfaProvider>);
    expect(seen['over']!.topAt(30, 5)).toBe(true);
    expect(seen['under']!.topAt(30, 5)).toBe(false);
    expect(seen['under']!.topAt(80, 5)).toBe(true);
    expect(seen['over']!.topAt(80, 5)).toBe(false);
  });
});
