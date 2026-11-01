import type { Meta, StoryObj } from '@storybook/react-vite';
import { playerWorld, type World } from '../story.tsx';
import { Frame } from './Frame.tsx';

const meta: Meta<typeof Frame> = {
  title: 'Frame/Frame',
  component: Frame,
  args: {
    children: <p>A page.</p>,
  },
};
export default meta;

type Story = StoryObj<typeof Frame>;

export const SignedIn: Story = { parameters: { world: playerWorld } };
/*
 * For the owner's review: the HUD either side of the width where the Main board's layout becomes the
 * Phone board's, worked out from the instance's sizes (engine/ui/glass/board.ts; the viewports are
 * .storybook/preview.tsx's, 8px either side of it). Just above, the Main board's three groups drawn
 * at the window's scale; just below, the Phone board's HUD at the phone's sizes.
 */
export const DockedHudAboveSwitch: Story = {
  name: 'Docked HUD just above the switch: the Main board, scaled (owner review)',
  parameters: { world: playerWorld },
  globals: { viewport: { value: 'boardAboveSwitch', isRotated: false } },
};
export const DockedHudBelowSwitch: Story = {
  name: 'Docked HUD just below the switch: the Phone board (owner review)',
  parameters: { world: playerWorld },
  globals: { viewport: { value: 'boardBelowSwitch', isRotated: false } },
};
export const SignedOut: Story = { parameters: { world: () => {} } };
export const NoCharacterYet: Story = {
  parameters: { world: ((fake) => { fake.signInAs(fake.seed.account('new-player')); }) satisfies World },
};
/* The HUD's mask hidden from the online lists (My characters' switch): its mark beside the class, or beside the mask on the phone. */
const hiddenWorld: World = (fake, instance) => {
  playerWorld(fake, instance);
  void fake.myCharacters().then((mine) => { const first = mine[0]; if (first) void fake.setPresenceHidden(first.id, true); });
};
export const HiddenFromOnlineLists: Story = { parameters: { world: hiddenWorld } };
