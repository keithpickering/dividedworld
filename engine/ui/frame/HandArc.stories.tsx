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
import { usePlayer } from '../player.tsx';
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

/**
 * Arms the instance's `nth` card, as pressing it in the hand does. With `open` it also opens the hand once the card is armed (the phone's hand button puts an
 * armed card back, so a player's own press cannot reach an armed phone hand open; a story can). The play provider drops everything armed and opened in its
 * cleanup for the account that is leaving, so this acts once the account is signed in (`session.account`): React runs every cleanup of a commit before any of
 * its effects, so the arming done here in the commit that signs the account in is the one that stays.
 */
function Arm({ nth, open = false }: { readonly nth: number | null; readonly open?: boolean }) {
  const { instance } = useKayfa();
  const play = usePlay();
  const account = usePlayer().session.account;
  const key = nth === null ? null : instance.cards[Math.min(nth, instance.cards.length - 1)]?.key ?? null;
  useEffect(() => {
    if (!play || key === null || account === null) return;
    play.arm(key);
    if (open) play.setHandOpen(true);
    // Once for the signed-in account and its card, as a player's press does; `play` changes with every state it holds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, key, open]);
  return null;
}

function HandArc({ armed, opened = false }: { readonly armed: number | null; readonly opened?: boolean }) {
  return <Frame><Arm nth={armed} open={opened} /><p /></Frame>;
}

const open = async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  await userEvent.click(await within(canvasElement).findByRole('button', { name: /^Hand, \d+ postcards?/ }));
};

/** The phone's armed hand opens itself (`Arm`'s `open`): the hand button reads "Armed · X" there and puts the card back. The play waits for the sheet. */
const armedPhone = async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  await within(canvasElement).findByRole('dialog', { name: 'Your hand' });
};

const meta: Meta<typeof HandArc> = {
  title: 'Frame/Hand arc',
  component: HandArc,
  args: { armed: null, opened: false },
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

/**
 * The phone's hand (docs/plans/2026-11-13-phone-hand-design.md): the sheet over the board at 390 by 844, the cards in one swiped row on an arc, the middle one
 * upright and lifted. The same three hands as above. The armed one has a card armed and the sheet open at once, which a player's own press cannot reach on a phone (the hand button
 * puts an armed card back), so the story's Arm sets both.
 */
const phone = { globals: { viewport: { value: 'glassPhone390', isRotated: false } }, play: open } as const;

/** The phone: three kinds, one to three copies each, the hand open on the first card. */
export const PhoneThreeKinds: Story = { ...phone, parameters: { world: hand(3) } };
/** The phone: every kind the instance has, the hand open on the first card. */
export const PhoneEveryKind: Story = { ...phone, parameters: { world: hand(null) } };
/** The phone: every kind with the second armed, the hand open on the armed card. */
export const PhoneEveryKindArmed: Story = { ...phone, play: armedPhone, args: { armed: 1, opened: true }, parameters: { world: hand(null) } };
