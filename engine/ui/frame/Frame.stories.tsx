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
/* For the owner's review: the docked HUD at 1024px, below the Main board's widths, where it is the Phone board's. */
export const DockedHud1024: Story = {
  name: 'Docked HUD at 1024px (owner review)',
  parameters: { world: playerWorld },
  globals: { viewport: { value: 'hudDocked1024', isRotated: false } },
};
export const SignedOut: Story = { parameters: { world: () => {} } };
export const NoCharacterYet: Story = {
  parameters: { world: ((fake) => { fake.signInAs(fake.seed.account('new-player')); }) satisfies World },
};
