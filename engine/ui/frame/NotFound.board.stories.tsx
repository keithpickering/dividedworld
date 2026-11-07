/**
 * The forum's Information box, drawn as stories against boards 16 and 18 of the board look design (`docs/research/2026-11-06-board-look/16-not-found.html`,
 * 1440 by 1000, asking for a thread that is not there; its phone is the first screen of `18-phone.html`, asking for a character): the frame around the box
 * (e2e/boards/2026-11-06-board-look/16-not-found.ts and 18-phone.ts compare them).
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Frame } from './Frame.tsx';
import { CannotFind } from './Unavailable.tsx';

function NotFoundStory({ address }: { readonly address: string }) {
  return <Frame><CannotFind address={address} /></Frame>;
}

const meta: Meta<typeof NotFoundStory> = {
  title: 'Boards/16 Not found',
  component: NotFoundStory,
  parameters: { path: '/', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof NotFoundStory>;

/** A thread nobody can open. */
export const NotFound: Story = { args: { address: '/t/00000000-0000-4000-8000-00000000dead' } };
/** A character nobody can open, the phone board's screen. */
export const NotFoundCharacter: Story = { args: { address: '/c/nobody' } };
