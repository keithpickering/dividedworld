/**
 * A staff character's profile, drawn as a story against board 14 of the board look design (`docs/research/2026-11-06-board-look/14-staff.html`, 1440 by
 * 1000; its phone is the second screen of `15-phone.html`): the Boss's "About" table (the badges, title, interests, favorite members, mood, career, posts
 * and joined as label rows, the signature and the plain note closing it) and its moderation log as one full-width table under it
 * (e2e/boards/2026-11-06-board-look/14-staff.ts compares it). The world is the move world's.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { seedMoves } from '../board/move-world.ts';
import { Frame } from '../frame/Frame.tsx';
import { LoadedProfile } from '../loaded.tsx';
import type { World } from '../story.tsx';

/** The id the world made: story worlds run before the render, and the route is set to it. */
const world: World = (fake, instance) => {
  const w = seedMoves(fake, instance);
  fake.seed.character(w.me, 'Mrs. Hooligan', instance.classes[0]!.key);
  window.history.replaceState(null, '', `/c/${w.director}`);
};

function StaffStory() {
  return <Frame><LoadedProfile id={window.location.pathname.split('/').pop() ?? ''} /></Frame>;
}

const meta: Meta<typeof StaffStory> = {
  title: 'Boards/14 Staff',
  component: StaffStory,
  parameters: { world, layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof StaffStory>;

/** The Director's profile on the Main board's layout. */
export const Staff: Story = {};
