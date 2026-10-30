import type { Meta, StoryObj } from '@storybook/react-vite';
import { Orbs } from './Orbs.tsx';

const meta: Meta<typeof Orbs> = {
  title: 'HUD/Orbs',
  component: Orbs,
  args: { cap: 600, pending: 0 },
};
export default meta;

type Story = StoryObj<typeof Orbs>;

export const Empty: Story = { args: { settled: 0 } };
export const Settled: Story = { args: { settled: 240 } };
export const Full: Story = { args: { settled: 600 } };
export const PendingGain: Story = { args: { settled: 240, pending: 85 } };
export const PendingLoss: Story = { args: { settled: 240, pending: -30 } };
export const PastTheCap: Story = { args: { settled: 500, pending: 140 } };
export const Cascade: Story = { args: { settled: 360, cascadeFrom: 140 } };
