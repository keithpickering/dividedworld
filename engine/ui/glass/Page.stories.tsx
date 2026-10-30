/**
 * The glass page shell with its menu bar (the glass plan, section 8: the glass between the boards'
 * widths, and the menu bar on a phone). Signed in, the bar holds Back and the four pages, Settings
 * current; signed out, Back alone. Widen and narrow the canvas to see the bar scale with the window
 * below 1440px and become the phone's below the width the HUD switches at (engine/ui/glass/board.ts).
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
/*
 * For the owner's review: the menu bar on a 390px phone, on Settings, whose tab sits past the strip's
 * right edge until the bar scrolls it into view as the page opens.
 */
export const PhoneMenuBar390: Story = {
  name: 'Phone menu bar, 390 × 844 (owner review)',
  parameters: { world: playerWorld, path: '/settings' },
  globals: { viewport: { value: 'glassPhone390', isRotated: false } },
};
export const SignedOut: Story = { args: { surface: 'account' }, parameters: { world: () => {}, path: '/sign-in' } };
