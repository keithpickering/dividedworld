/**
 * The browser's page for a load that failed, drawn as a story against board 17 of the board look design (`docs/research/2026-11-06-board-look/17-cannot-display.html`,
 * 1440 by 1000; its phone is the second screen of `18-phone.html`): the sheet inside the frame (e2e/boards/2026-11-06-board-look/17-cannot-display.ts compares it).
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Frame } from './Frame.tsx';
import { CannotDisplay } from './Unavailable.tsx';

function CannotDisplayStory() {
  return <Frame><CannotDisplay address="dw.gripe/t/3f2a9c1e" onRetry={() => {}} /></Frame>;
}

const meta: Meta<typeof CannotDisplayStory> = {
  title: 'Boards/17 Cannot display',
  component: CannotDisplayStory,
  parameters: { path: '/', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof CannotDisplayStory>;

/** A page that did not answer. */
export const CannotDisplayPage: Story = {};
