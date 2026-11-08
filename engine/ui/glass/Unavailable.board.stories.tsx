/**
 * The glass's two error screens in the glass page shell (the glass-load plan, Task 4): "This screen didn't load" with its
 * two controls, and "There's nothing here". The file is a board story so the a11y sweep (e2e/a11y.spec.ts) reads both.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { playerWorld } from '../story.tsx';
import { Page } from './Page.tsx';
import { GlassCannotDisplay, GlassCannotFind } from './Unavailable.tsx';

const meta: Meta<typeof GlassCannotDisplay> = {
  title: 'Boards/Glass unavailable',
  component: GlassCannotDisplay,
  parameters: { world: playerWorld, path: '/t/3f2a9c1e', layout: 'fullscreen' },
  args: { onRetry: () => {} },
  render: (args) => <Page surface="settings"><GlassCannotDisplay {...args} /></Page>,
};
export default meta;

type Story = StoryObj<typeof GlassCannotDisplay>;

/** The page did not load: Try again and Back to the board. */
export const Display: Story = {};

/** No screen answers to the address. */
export const Find: Story = {
  render: () => <Page surface="settings"><GlassCannotFind /></Page>,
};
