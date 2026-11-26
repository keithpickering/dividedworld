/**
 * The hand arc on the Main board, open, for the owner's review at 1440 by 900 (docs/plans/2026-11-12-hand-arc-design.md; no board draws it, so it is a
 * story first). Three hands: three kinds, and every kind the instance has with one to three copies each (the three-kind hand names its cards by key; the
 * every-kind hand follows the instance's pool, the number held cycling 1, 2, 3 down its order), each with its armed twin, where one card stands lifted. Arming closes the arc, so the
 * armed stories arm the card as the Armed story does and then press the hand button, which is the player's own way to the same screen. Each story
 * opens the hand in its `play` function.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { userEvent, within } from 'storybook/test';
import { cardOf, type World } from '../story.tsx';
import { useKayfa } from '../context.tsx';
import { usePlay } from '../cards/play.tsx';
import { usePlayer } from '../player.tsx';
import { Frame } from './Frame.tsx';

/** The cards of the three-kind hand, held one, two and three of in this order: three that differ in look, and no more to the story than that. */
const THREE_KINDS = ['4d-chess', 'autocorrect', 'below-the-fold'] as const;
/** The card the armed stories arm: any card stands lifted the same, and this one is armed by key. */
const ARMED = 'autocorrect';

/** A signed-in player holding the cards named by `keys`, one, two and three copies in that order, or every card of the instance where `keys` is null, one to three copies each down its list. */
const hand = (keys: readonly string[] | null): World => (fake, instance) => {
  const [a, b] = instance.classes;
  const me = fake.seed.account('story-player', { seasoned: true });
  fake.seed.character(me, 'Pipewrench', a!.key);
  fake.seed.character(me, 'Mrs. Hooligan', (b ?? a)!.key);
  fake.seed.settle({ wallet: { [me]: 240 } });
  const held: Record<string, number> = {};
  if (keys) keys.forEach((key, i) => { held[cardOf(instance.cards, key).key] = i + 1; });
  else instance.cards.forEach((c, i) => { held[c.key] = (i % 3) + 1; });
  fake.seed.cards(me, held);
  fake.signInAs(me);
};

/**
 * The same player, with a pack sealed in the hand: the instance's starting pack is granted when a character is made (`createCharacter`; the fake's seed makes
 * characters without it), so the one character is made that way, and the cards held are the three-kind hand's. Where the instance names no starting pack there is no
 * sealed pack and the story shows the cards alone.
 */
const sealedHand: World = (fake, instance) => {
  const [a] = instance.classes;
  const me = fake.seed.account('story-player', { seasoned: true });
  fake.signInAs(me);
  void fake.createCharacter('Pipewrench', a!.key);
  fake.seed.settle({ wallet: { [me]: 240 } });
  fake.seed.cards(me, Object.fromEntries(THREE_KINDS.map((key, i) => [cardOf(instance.cards, key).key, i + 1])));
};

/**
 * Arms the card of this key, as pressing it in the hand does. With `open` it also opens the hand once the card is armed (the phone's hand button puts an
 * armed card back, so a player's own press cannot reach an armed phone hand open; a story can). The play provider drops everything armed and opened in its
 * cleanup for the account that is leaving, so this acts once the account is signed in (`session.account`): React runs every cleanup of a commit before any of
 * its effects, so the arming done here in the commit that signs the account in is the one that stays.
 */
function Arm({ card, open = false }: { readonly card: string | null; readonly open?: boolean }) {
  const { instance } = useKayfa();
  const play = usePlay();
  const account = usePlayer().session.account;
  const key = card === null ? null : cardOf(instance.cards, card).key;
  useEffect(() => {
    if (!play || key === null || account === null) return;
    play.arm(key);
    if (open) play.setHandOpen(true);
    // Once for the signed-in account and its card, as a player's press does; `play` changes with every state it holds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, key, open]);
  return null;
}

function HandArc({ armed, opened = false }: { readonly armed: string | null; readonly opened?: boolean }) {
  return <Frame><Arm card={armed} open={opened} /><p /></Frame>;
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
export const ThreeKinds: Story = { parameters: { world: hand(THREE_KINDS) } };
/** Every kind the instance has, the hand open. */
export const EveryKind: Story = { parameters: { world: hand(null) } };
/** Three kinds with the second armed: the arc open again, the armed card standing lifted. */
export const ThreeKindsArmed: Story = { args: { armed: ARMED }, parameters: { world: hand(THREE_KINDS) } };
/** Every kind with one armed: the arc open again, the armed card standing lifted. */
export const EveryKindArmed: Story = { args: { armed: ARMED }, parameters: { world: hand(null) } };

/**
 * The phone's hand (docs/plans/2026-11-13-phone-hand-design.md): the sheet over the board at 390 by 844, the cards in one swiped row on an arc, the middle one
 * upright and lifted. The same three hands as above. The armed one has a card armed and the sheet open at once, which a player's own press cannot reach on a phone (the hand button
 * puts an armed card back), so the story's Arm sets both.
 */
const phone = { globals: { viewport: { value: 'glassPhone390', isRotated: false } }, play: open } as const;

/** The phone: three kinds, one to three copies each, the hand open on the first card. */
export const PhoneThreeKinds: Story = { ...phone, parameters: { world: hand(THREE_KINDS) } };
/** The phone: every kind the instance has, the hand open on the first card. */
export const PhoneEveryKind: Story = { ...phone, parameters: { world: hand(null) } };
/** The phone: every kind with the second armed, the hand open on the armed card. */
export const PhoneEveryKindArmed: Story = { ...phone, play: armedPhone, args: { armed: ARMED, opened: true }, parameters: { world: hand(null) } };

/** A pack sealed in the hand, first on the arc before the three kinds, the hand open; the Hand button carries its dot and says "1 sealed pack". */
export const SealedPack: Story = { parameters: { world: sealedHand } };
/** The phone: the sealed pack first in the row, the hand open on it. */
export const PhoneSealedPack: Story = { ...phone, parameters: { world: sealedHand } };
