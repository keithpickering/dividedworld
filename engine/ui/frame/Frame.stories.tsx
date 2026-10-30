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
export const SignedOut: Story = { parameters: { world: () => {} } };
export const NoCharacterYet: Story = {
  parameters: { world: ((fake) => { fake.signInAs(fake.seed.account('new-player')); }) satisfies World },
};
