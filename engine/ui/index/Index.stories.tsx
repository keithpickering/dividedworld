import type { Meta, StoryObj } from '@storybook/react-vite';
import type { World } from '../story.tsx';
import { IndexScreen } from './Index.tsx';

const meta: Meta<typeof IndexScreen> = { title: 'Index/Index', component: IndexScreen };
export default meta;

type Story = StoryObj<typeof IndexScreen>;

const T0 = Date.UTC(2026, 9, 20, 12);

const full: World = (fake, instance) => {
  const me = fake.seed.account('story-player');
  fake.seed.character(me, 'Pipewrench', instance.classes[0]!.key, { at: T0 });
  const spritey = fake.seed.character(fake.seed.account('story-other'), 'Spritey', instance.classes[0]!.key, { at: T0 });
  const general = instance.boards.find((b) => !b.system)!.slug;
  const system = instance.boards.find((b) => b.system)!.slug;
  for (let i = 0; i < 3; i++) fake.seed.thread(general, spritey, `A thread ${i + 1}`, 'Hello.', { at: T0 + i * 3_600_000 });
  fake.seed.thread(system, null, 'The Bulletin', 'Tonight.', { at: T0 + 86_400_000 });
  fake.signInAs(me);
};

export const Boards: Story = { parameters: { world: full, path: '/' } };
export const NoThreadsYet: Story = { parameters: { world: ((fake) => { fake.signInAs(fake.seed.account('story-player')); }) satisfies World, path: '/' } };
export const SignedOut: Story = { parameters: { world: (() => {}) satisfies World, path: '/' } };
