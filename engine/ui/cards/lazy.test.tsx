/**
 * An effect that loads on first use (`CardUi.Effect` as a `React.lazy` component): until it lands the post shows its words, and a
 * post with two such effects shows them before either has loaded. The cards are the engine's own test cards, never an instance's.
 */
import { act, render } from '@testing-library/react';
import { lazy, type ReactNode } from 'react';
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

const post = (key: string, name: string): CardRules => ({
  key, name, alignment: 'pepperoni', rarity: 'common', reaches: ['post'], priceKey: 'test.price', playPrice: () => 0, validateConfig: (c: unknown) => ok(c),
  canApply: (t, e, _config, now) => landsOn({ key, reaches: ['post'] }, t, e, now),
});
const instance: Instance = { ...testInstance, cards: [post('dab', 'Dab'), post('daub', 'Daub')] };

/** A lazy effect whose module is not loaded until `land()` is called. */
function deferred(key: string) {
  let land!: () => void;
  const gate = new Promise<void>((resolve) => { land = resolve; });
  const Effect = lazy(async () => {
    await gate;
    return { default: ({ children }: EffectProps) => <div data-kb-wrap={key}>{children}</div> };
  });
  return { Effect, land: () => act(async () => { land(); await gate; }) };
}

const at = '2026-10-29T12:00:00.000Z';
const play = (card: string): Act => ({
  id: `play-${card}`, character: 'c9', kind: 'card', thread: 't1', targetActId: 'p1', seq: null, createdAt: at,
  payload: { card, message: '', config: {}, layer: 1 }, currentPayload: {}, editedAt: null, shownEditedAt: null,
});
const words: Act = { id: 'p1', character: 'c1', kind: 'post', thread: 't1', targetActId: null, seq: 1, createdAt: at, payload: { body: 'hi' }, currentPayload: { body: 'hi' }, editedAt: null, shownEditedAt: null };
function draw(cards: CardUi[], played: string[]): ReactNode {
  const kayfa = { api: buildWorld({}, instance), instance, ui: { cards, glass: {} }, settings: {} } as unknown as Kayfa;
  const store = createPlays();
  store.add(played.map(play));
  return <KayfaProvider value={kayfa}><PlayerProvider api={kayfa.api}><PostEffects plays={store} post={words} place="thread" nameOf={() => 'x'}><span data-kb-words>hi</span></PostEffects></PlayerProvider></KayfaProvider>;
}
const ui = (key: string, Effect: CardUi['Effect']): CardUi => ({ key, art: { color: '#ffd23f', ink: '#1a1300', canvas: '', mark: '', credit: 'Test' }, describe: () => `${key}.`, Effect });

describe('an effect that loads on first use', () => {
  test('the post\'s words are on screen before it lands, and inside it after', async () => {
    const dab = deferred('dab');
    render(draw([ui('dab', dab.Effect)], ['dab']));
    expect(document.querySelector('[data-kb-words]')).not.toBeNull();
    expect(document.querySelector('[data-kb-wrap="dab"]')).toBeNull();
    await dab.land();
    expect(document.querySelector('[data-kb-wrap="dab"] [data-kb-words]')).not.toBeNull();
  });

  test('two on one post: the words are on screen before either lands, and inside both after', async () => {
    const dab = deferred('dab');
    const daub = deferred('daub');
    render(draw([ui('dab', dab.Effect), ui('daub', daub.Effect)], ['dab', 'daub']));
    expect(document.querySelector('[data-kb-words]')).not.toBeNull();
    await dab.land();
    expect(document.querySelector('[data-kb-words]')).not.toBeNull();
    await daub.land();
    expect(document.querySelector('[data-kb-wrap="daub"] [data-kb-wrap="dab"] [data-kb-words]')).not.toBeNull();
  });
});
