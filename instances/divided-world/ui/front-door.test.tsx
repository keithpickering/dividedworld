/** The real front door on the real instance: Below the Fold on #9 folds the row as a thread's post does, with the bar the engine draws. */
import { within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { FrontDoor } from '../../../engine/ui/front-door/FrontDoor.tsx';
import { KayfaProvider, useKayfa } from '../../../engine/ui/context.tsx';
import { renderInWorld } from '../../../engine/ui/test-world.tsx';
import { instance } from '../index.ts';
import { cardsUi } from './cards.ts';
import { instanceUi } from './index.ts';

/** The engine's frame, given the instance's own rules, cards, front door and settings. */
function RealDoor() {
  const k = useKayfa();
  return <KayfaProvider value={{ ...k, instance, ui: { ...k.ui, cards: cardsUi, frontDoor: instanceUi.frontDoor, avatars: instanceUi.avatars } }}><FrontDoor /></KayfaProvider>;
}

describe('the Divided World front door', () => {
  test('post #9 wears Below the Fold as a bar over its row, not as a bar in its words', () => {
    renderInWorld(<RealDoor />, { cards: cardsUi, instance });
    const post = document.getElementById('front-door-post-9')!;
    expect(post).toHaveAttribute('data-kb-fold', 'folded');
    const bar = post.querySelector('.kb-fold-bar') as HTMLElement;
    expect(within(bar).getByRole('button', { name: /^Show post #9/u })).toHaveAttribute('aria-expanded', 'false');
    expect(post.querySelector('.dw-fold-bar')).toBeNull();
  });
});
