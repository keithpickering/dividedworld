import type { Meta, StoryObj } from '@storybook/react-vite';
import type { World } from '../story.tsx';
import { StandingsScreen } from './Standings.tsx';

const meta: Meta<typeof StandingsScreen> = { title: 'Standings/Standings', component: StandingsScreen };
export default meta;

type Story = StoryObj<typeof StandingsScreen>;

const full: World = (fake, instance) => {
  const cls = instance.classes[0]!.key;
  const me = fake.seed.account('story-player');
  const other = fake.seed.account('story-other');
  const a = fake.seed.character(other, 'Spritey', cls);
  const b = fake.seed.character(me, 'Pipewrench', cls);
  const c = fake.seed.character(other, 'Mrs. Hooligan', cls);
  fake.seed.settle({ standings: { [a]: 350, [b]: 120, [c]: 120 } });
  fake.signInAs(me);
};

export const Season: Story = { parameters: { world: full, path: '/standings' } };
export const NoOneYet: Story = { parameters: { world: ((fake) => { fake.signInAs(fake.seed.account('story-player')); }) satisfies World, path: '/standings' } };
