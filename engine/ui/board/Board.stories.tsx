import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Fake } from '../data/fake.ts';
import type { Instance } from '../../rules/types.ts';
import type { World } from '../story.tsx';
import { BoardScreen } from './Board.tsx';

const meta: Meta<typeof BoardScreen> = { title: 'Board/Thread list', component: BoardScreen, args: { slug: 'general' } };
export default meta;

type Story = StoryObj<typeof BoardScreen>;

const T0 = Date.UTC(2026, 9, 20, 12);
const HOUR = 3_600_000;

const players = (fake: Fake, instance: Instance, withCharacter = true) => {
  const me = fake.seed.account('story-player');
  const mine = withCharacter ? fake.seed.character(me, 'Pipewrench', instance.classes[0]!.key, { at: T0 }) : null;
  const spritey = fake.seed.character(fake.seed.account('story-other'), 'Spritey', instance.classes[0]!.key, { at: T0 });
  const general = instance.boards.find((b) => !b.system)!.slug;
  fake.signInAs(me);
  return { mine, spritey, general, system: instance.boards.find((b) => b.system)!.slug };
};

const threads: World = (fake, instance) => {
  const w = players(fake, instance);
  const a = fake.seed.thread(w.general, w.spritey, 'The Crimson Incident', 'It began.', { at: T0 });
  for (let i = 0; i < 30; i++) fake.seed.post(a.thread, w.mine, `Reply ${i + 1}`, { at: T0 + (i + 1) * HOUR });
  void fake.markRead(a.thread, 12, null);
  const b = fake.seed.thread(w.general, w.mine, 'Sitcom Room discourse', 'Discuss.', { at: T0 + 2 * HOUR });
  for (let i = 0; i < 6; i++) fake.seed.post(b.thread, w.spritey, `Take ${i + 1}`, { at: T0 + 3 * HOUR + i * HOUR });
  fake.seed.views(b.thread, 44);
  fake.seed.thread(w.general, w.spritey, 'post your desk', 'Go.', { at: T0 + 4 * HOUR });
};

export const Threads: Story = { parameters: { world: threads, path: '/b/general' } };
export const Empty: Story = { parameters: { world: ((fake, instance) => { players(fake, instance); }) satisfies World, path: '/b/general' } };
export const NoCharacterYet: Story = { parameters: { world: ((fake, instance) => { players(fake, instance, false); }) satisfies World, path: '/b/general' } };
export const ManyThreadsPageTwo: Story = {
  parameters: {
    world: ((fake, instance) => {
      const w = players(fake, instance);
      for (let i = 0; i < 100; i++) fake.seed.thread(w.general, w.spritey, `Thread ${i + 1}`, 'x', { at: T0 + i * 60_000 });
    }) satisfies World,
    path: '/b/general?page=2',
  },
};
export const TheSystemsBoard: Story = {
  args: { slug: 'the-system' },
  parameters: {
    world: ((fake, instance) => {
      const w = players(fake, instance);
      fake.seed.thread(w.system, null, 'The Bulletin', 'Tonight.', { at: T0 });
    }) satisfies World,
    path: '/b/the-system',
  },
};
export const SignedOut: Story = { parameters: { world: (() => {}) satisfies World, path: '/b/general' } };
