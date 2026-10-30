/**
 * The glass page shell with its menu bar (the glass plan, section 8: the glass between the boards'
 * widths, and the menu bar on a phone). Signed in, the bar holds Back and the four pages, Settings
 * current; signed out, Back alone. Widen and narrow the canvas to see the bar become the phone's
 * below 900px.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { playerWorld } from '../story.tsx';
import { Page } from './Page.tsx';

const meta: Meta<typeof Page> = {
  title: 'Glass/Page',
  component: Page,
  args: {
    surface: 'settings',
    children: <><h1 className="kb-heading">Settings</h1><p>The page's own content, in the board's look until Part 2.</p></>,
  },
};
export default meta;

type Story = StoryObj<typeof Page>;

export const SignedIn: Story = { parameters: { world: playerWorld, path: '/settings' } };
export const SignedOut: Story = { args: { surface: 'account' }, parameters: { world: () => {}, path: '/sign-in' } };
