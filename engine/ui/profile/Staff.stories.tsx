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

/** A Mod Bot's log with the requests it ruled on: one granted, one refused, one passed to the Boss and waiting, one the meeting granted and one that lapsed. */
const withRequests: World = (fake, instance) => {
  const w = seedMoves(fake, instance);
  const { seed } = fake;
  const asker = seed.character(seed.account('story-asker'), 'Pipe Dreamer', instance.classes[0]!.key);
  const board = instance.boards.find((b) => !b.system)!.slug;
  const { thread } = seed.thread(board, asker, 'Best Mario game', 'Which one is it, really?');
  const day = 86_400_000;
  const ask = (at: number) => seed.post(thread, asker, 'Could this thread be moved?', { at });
  seed.staffRequest('hall-monitor', ask(Date.now() - 6 * day), { ruling: 'fulfill', at: Date.now() - 6 * day });
  seed.staffRequest('hall-monitor', ask(Date.now() - 5 * day), { ruling: 'reject', at: Date.now() - 5 * day });
  seed.staffRequest('hall-monitor', ask(Date.now() - 4 * day), { ruling: 'confer', ruled: 'fulfill', at: Date.now() - 4 * day });
  seed.staffRequest('hall-monitor', ask(Date.now() - 3 * day), { ruling: 'confer', lapsed: true, at: Date.now() - 3 * day });
  seed.staffRequest('hall-monitor', ask(Date.now() - day), { ruling: 'confer', at: Date.now() - day });
  window.history.replaceState(null, '', `/c/${w.bot}`);
};
export const ModBotRequests: Story = { render: () => <Here />, parameters: { world: withRequests } };
