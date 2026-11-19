/**
 * The glass tooltip (Tooltip.tsx), open on its control, so the a11y sweep reads it with its text, its ⓘ and the control's
 * `aria-describedby`.
 */
import { useRef } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { playerWorld } from '../story.tsx';
import { Page } from './Page.tsx';
import { Tooltip } from './Tooltip.tsx';

function Shown() {
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <Page surface="settings">
      <button ref={anchor} type="button" className="kb-glass-link">Laughing, 3, including yours</button>
      <Tooltip anchor={anchor} open onClose={() => {}}>Reactions can&apos;t be taken back.</Tooltip>
    </Page>
  );
}

const meta: Meta<typeof Shown> = {
  title: 'Boards/Glass tooltip',
  component: Shown,
  parameters: { world: playerWorld, path: '/t/3f2a9c1e', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof Shown>;

/** Open above its control: the glass's panel with the ⓘ and one plain sentence. */
export const Open: Story = {};
