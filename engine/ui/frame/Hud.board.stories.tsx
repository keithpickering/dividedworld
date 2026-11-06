/**
 * The HUD with a full wallet and an estimate past the cap, drawn as stories against the backfill boards
 * `docs/research/2026-11-05-backfill/35-hud-cap.html` (1440 by 230, the HUD alone) and `36-account-phone.html` (its third screen, 390 by 844): the
 * signed-in HUD docked under an empty page, the wallet at its cap and the player's estimate wholly past it, so the Aura notch says the figure once
 * and the way out under it (engine/ui/orbs/Orbs.tsx). The player is seasoned, so no tip stands over the notch.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { World } from '../story.tsx';
import { Frame } from './Frame.tsx';

/** The ordinary player, with the wallet full: the seed's estimate (+0.85) then lies wholly past the cap. */
const full: World = (fake, instance) => {
  const [a, b] = instance.classes;
  const me = fake.seed.account('story-player', { seasoned: true });
  fake.seed.character(me, 'Mrs. Hooligan', (b ?? a)!.key);
  fake.seed.character(me, 'Pipewrench', a!.key);
  fake.seed.settle({ wallet: { [me]: instance.settings.walletCap } });
  fake.seed.cards(me, { [instance.cards[0]?.key ?? 'card']: 3 });
  fake.seed.estimate(me, { entries: [{ character: 'x', reason: `${a!.key}.story`, amount: 85 }] });
  fake.signInAs(me);
};

function HudStory() {
  return <Frame><p /></Frame>;
}

const meta: Meta<typeof HudStory> = {
  title: 'Boards/00 HUD past the cap',
  component: HudStory,
  parameters: { world: full, path: '/b/general', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof HudStory>;

/** The HUD on the Main board's layout, at 1440 wide. */
export const PastTheCap: Story = {};
/** The same HUD on the Phone board's layout, at 390 by 844. */
export const PastTheCapPhone: Story = {
  name: 'Past the cap, phone 390 × 844',
  globals: { viewport: { value: 'glassPhone390', isRotated: false } },
};
