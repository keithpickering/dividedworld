/**
 * The booster packs boards (docs/research/2026-11-07-booster-packs/, 01-machine, 02-reveal, 03-hit and the first three screens of 04-phone) as
 * stories, so the board match (e2e/boards/2026-11-07-booster-packs/) reads each through the end-to-end build's story route beside its board. Each is
 * the Vending Machine itself, in the glass's page shell, in the world the boards draw: a wallet of 5.62 and a hand of two, the Booster in A1, the first
 * card slot pulled by the Boss and the ninth marked up, the last card slot hidden. The reveal's screens are reached by the same presses a player makes
 * (select the Booster, Buy, turn cards), which the manifests list.
 *
 * What the story chooses, since the fake rolls with its own fixed generator: the answer the machine gives to a pack is set here, four commons and then
 * the first rare, so the hit is a rare as board 03 draws it; the cards are picked by rarity and place in the instance's order, never by name. The
 * hand holds what the fake rolled; only the story's answer says what was shown. Nothing here acts: it is a specimen for the board match and the
 * owner's review.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Page } from '../glass/Page.tsx';
import type { World } from '../story.tsx';
import { Vending } from './Vending.tsx';

/** The world of the boards: the machine as the instance seeds it, a wallet of 5.62, a hand of two, and two of the Boss's moves in force. */
const world: World = (fake, instance) => {
  const me = fake.seed.account('story-player');
  fake.seed.character(me, 'Pipewrench', instance.classes[0]!.key);
  fake.seed.wallet(me, 562);
  const [first, second] = instance.cards;
  if (first && second) fake.seed.cards(me, { [first.key]: 1, [second.key]: 1 });
  const slot = (place: number) => instance.machine[place]?.item;
  /* The second place is pulled (board 01's A2), the ninth marked up from its price to one and a half times it (E1). */
  const pulled = slot(1);
  if (pulled) {
    fake.seed.slot(pulled, {
      availability: 'soldOut',
      move: { kind: 'pullSlot', act: 'story-pull', ends: '2026-11-09T12:00:00Z', was: instance.machine[1]!.price, percent: null, hours: null, demand: { kind: 'distinctCharactersOnBoard', params: { board: 'general', count: 12 } }, progress: { done: 7, of: 12, met: false, checkedAt: '2026-11-07T10:00:00Z' } },
    });
  }
  const marked = slot(8);
  if (marked) {
    const was = instance.machine[8]!.price;
    fake.seed.slot(marked, {
      price: Math.round(was * 1.5),
      move: { kind: 'repriceSlot', act: 'story-markup', ends: '2026-11-08T20:00:00Z', was, percent: 150, hours: null, demand: { kind: 'postsOnBoard', params: { board: 'general', count: 20 } }, progress: { done: 4, of: 20, met: false, checkedAt: '2026-11-07T10:00:00Z' } },
    });
  }
  /* The pack's answer: four commons in the instance's order, then its first rare. */
  const commons = instance.cards.filter((c) => c.rarity === 'common').map((c) => c.key);
  const hit = instance.cards.find((c) => c.rarity === 'rare')?.key ?? instance.cards[instance.cards.length - 1]!.key;
  const shown = [0, 1, 2, 3].map((i) => commons[i % Math.max(1, commons.length)] ?? hit).concat(hit);
  const real = fake.buyPack.bind(fake);
  fake.buyPack = async (s) => {
    const answer = await real(s);
    return answer.ok ? { ...answer, value: { ...answer.value, contents: shown } } : answer;
  };
  fake.signInAs(me);
};

function MachinePage() {
  return <Page surface="vending"><Vending /></Page>;
}

const meta: Meta<typeof MachinePage> = {
  title: 'Boards/Booster packs',
  component: MachinePage,
  parameters: { world, path: '/vending', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof MachinePage>;

const phone = { viewport: { value: 'glassPhone390', isRotated: false } } as const;

/** The machine at 1440 wide, as board 01 draws it. The Booster is selected by a press, as a player does. */
export const Machine: Story = {};
/** The machine on the Phone board's layout, at 390 by 844 (board 04's first screen). */
export const MachinePhone: Story = { name: 'Machine, phone 390 × 844', globals: phone };
