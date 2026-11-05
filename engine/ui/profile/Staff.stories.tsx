/**
 * A staff character's profile (the system plan, Task 12; mock-s2-director-profile.html C): the Boss with its ADMINISTRATOR badge, its
 * title, the table it wrote about itself and its signature, and its moderation log beside it, newest first. A Mod Bot is the same
 * screen with MODERATOR and an empty log.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { seedMoves } from '../board/move-world.ts';
import { ProfileScreen } from './Profile.tsx';
import type { World } from '../story.tsx';
import { LoadedProfile } from '../loaded.tsx';

const meta: Meta<typeof ProfileScreen> = { title: 'Profile/Staff', component: ProfileScreen };
export default meta;

type Story = StoryObj<typeof ProfileScreen>;

const as = (who: 'director' | 'bot'): World => (fake, instance) => {
  const w = seedMoves(fake, instance);
  window.history.replaceState(null, '', `/c/${w[who]}`);
};

/** The id the world made: story worlds run before the render, and the route is set to it. */
function Here() {
  return <LoadedProfile id={window.location.pathname.split('/').pop() ?? ''} />;
}

export const Boss: Story = { render: () => <Here />, parameters: { world: as('director') } };
export const ModBot: Story = { render: () => <Here />, parameters: { world: as('bot') } };
