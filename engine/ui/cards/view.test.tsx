/**
 * What a post's effects are given to say about themselves (`EffectProps.show`): bound to the post and card by
 * `PostEffects`, and cleared when the effect is gone.
 */
import { act, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, test } from 'vitest';
import type { Act } from '../data/api.ts';
import { buildWorld, renderIn } from '../test-world.tsx';
import { PostEffects } from './Effects.tsx';
import { createPlays } from './plays.ts';
import type { CardUi, CardView, EffectProps } from './types.ts';

const POST = '11111111-0000-4000-8000-000000000001';
const act0 = (over: Partial<Act> & { payload?: Record<string, unknown> }): Act => ({
  id: '22222222-0000-4000-8000-000000000001', character: '33333333-0000-4000-8000-000000000001', kind: 'card', thread: '44444444-0000-4000-8000-000000000001',
  targetActId: POST, seq: null, createdAt: '2026-10-29T21:16:00.000Z', payload: { card: 'alpha', layer: 1 }, currentPayload: {}, editedAt: null, shownEditedAt: null, ...over,
});
const post = act0({ id: POST, kind: 'post', targetActId: null, seq: 1, payload: {} });
const VIEW: CardView = { progress: 0.5, state: 'Half done', yours: true, controls: [], notes: {} };

/* An effect that says `view` once drawn, and whose `show` the test can reach. */
const ui = (key: string, view: CardView, seen: EffectProps['show'][] = []): CardUi => ({
  key, describe: () => key, art: { color: 'red', ink: 'white' },
  Effect: ({ show, children }) => {
    useEffect(() => { seen.push(show); show(view); }, [show]);
    return <div data-testid={key}>{children}</div>;
  },
});

function mount(cards: readonly CardUi[], keys: readonly string[]) {
  const plays = createPlays();
  plays.add(keys.map((card, i) => act0({ id: `22222222-0000-4000-8000-00000000000${i + 1}`, payload: { card, layer: 1 } })));
  const world = renderIn(buildWorld(), <PostEffects plays={plays} post={post} place="thread" nameOf={() => 'Someone'}><p>words</p></PostEffects>, { cards });
  return { plays, world };
}

describe('PostEffects gives each effect a show bound to its post and card', () => {
  test('what an effect shows is the store\'s view for that post and card, and another card\'s is its own', () => {
    const { plays } = mount([ui('alpha', VIEW), ui('beta', { ...VIEW, state: 'Other' })], ['alpha', 'beta']);
    expect(plays.view(POST, 'alpha')).toEqual(VIEW);
    expect(plays.view(POST, 'beta')?.state).toBe('Other');
    expect(plays.view('99999999-0000-4000-8000-000000000009', 'alpha')).toBeNull();
    expect(screen.getByText('words')).toBeInTheDocument();
  });

  test('show is the same function across draws, so an effect may list it in its dependencies', () => {
    const seen: EffectProps['show'][] = [];
    const { plays, world } = mount([ui('alpha', VIEW, seen)], ['alpha']);
    act(() => { plays.setBilling(POST, [...plays.billing(POST)]); });
    world.unmount();
    expect(new Set(seen).size).toBe(1);
  });

  test('unmounting an effect clears its view and no other card\'s', () => {
    const { plays, world } = mount([ui('alpha', VIEW), ui('beta', VIEW)], ['alpha', 'beta']);
    expect(plays.view(POST, 'alpha')).not.toBeNull();
    world.rerender(<></>);
    expect(plays.view(POST, 'alpha')).toBeNull();
    expect(plays.view(POST, 'beta')).toBeNull();
  });
});
