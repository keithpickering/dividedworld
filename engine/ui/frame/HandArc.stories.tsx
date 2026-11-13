/**
 * The hand arc on the Main board, open, for the owner's review at 1440 by 900 (docs/plans/2026-11-12-hand-arc-design.md; no board draws it, so it is a
 * story first). Three hands: three kinds, and every kind the instance has with one to three copies each (the instance's own cards, so the engine names
 * none; the number held cycles 1, 2, 3 down the instance's order), each with its armed twin, where one card stands lifted. Arming closes the arc, so the
 * armed stories arm the card as the Armed story does and then press the hand button, which is the player's own way to the same screen. Each story
 * opens the hand in its `play` function.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { userEvent, within } from 'storybook/test';
import type { World } from '../story.tsx';
import { useKayfa } from '../context.tsx';
import { usePlay } from '../cards/play.tsx';
import { Frame } from './Frame.tsx';

/** A signed-in player holding `kinds` of the instance's cards (all of them where `kinds` is null), one to three copies each. */
const hand = (kinds: number | null): World => (fake, instance) => {
  const [a, b] = instance.classes;
  const me = fake.seed.account('story-player', { seasoned: true });
  fake.seed.character(me, 'Pipewrench', a!.key);
  fake.seed.character(me, 'Mrs. Hooligan', (b ?? a)!.key);
  fake.seed.settle({ wallet: { [me]: 240 } });
  const held: Record<string, number> = {};
  instance.cards.slice(0, kinds ?? instance.cards.length).forEach((c, i) => { held[c.key] = (i % 3) + 1; });
  fake.seed.cards(me, held);
  fake.signInAs(me);
};

/** Arms the instance's `nth` card, as pressing it in the hand does. */
function Arm({ nth }: { readonly nth: number | null }) {
  const { instance } = useKayfa();
  const play = usePlay();
  const key = nth === null ? null : instance.cards[Math.min(nth, instance.cards.length - 1)]?.key ?? null;
  useEffect(() => {
    if (!play || key === null) return;
    play.arm(key);
    // Armed once, as the player's press does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

function HandArc({ armed }: { readonly armed: number | null }) {
  return <Frame><Arm nth={armed} /><p /></Frame>;
}

const open = async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  await userEvent.click(await within(canvasElement).findByRole('button', { name: /^Hand, \d+ postcards?/ }));
};

const meta: Meta<typeof HandArc> = {
  title: 'Frame/Hand arc',
  component: HandArc,
  args: { armed: null },
  parameters: { path: '/b/general', layout: 'fullscreen' },
  globals: { viewport: { value: 'glassMain1440', isRotated: false } },
  play: open,
};
export default meta;

type Story = StoryObj<typeof HandArc>;

/** Three kinds, one to three copies each, the hand open. */
export const ThreeKinds: Story = { parameters: { world: hand(3) } };
/** Every kind the instance has, the hand open. */
export const EveryKind: Story = { parameters: { world: hand(null) } };
/** Three kinds with the second armed: the arc open again, the armed card standing lifted. */
export const ThreeKindsArmed: Story = { args: { armed: 1 }, parameters: { world: hand(3) } };
/** Every kind with one armed: the arc open again, the armed card standing lifted. */
export const EveryKindArmed: Story = { args: { armed: 1 }, parameters: { world: hand(null) } };
