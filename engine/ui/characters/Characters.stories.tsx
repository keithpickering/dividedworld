import type { Meta, StoryObj } from '@storybook/react-vite';
import type { World } from '../story.tsx';
import { Characters } from './Characters.tsx';
import { NewCharacter } from './NewCharacter.tsx';

const meta: Meta<typeof Characters> = { title: 'Characters/My characters', component: Characters, parameters: { path: '/characters' } };
export default meta;
type Story = StoryObj<typeof Characters>;

const full: World = (fake, instance) => {
  const [a, b, c] = instance.classes;
  const me = fake.seed.account('story-player');
  const t0 = Date.parse('2026-10-01T12:00:00Z');
  const pipe = fake.seed.character(me, 'Pipewrench', a!.key, { at: t0 });
  const hoolie = fake.seed.character(me, 'Mrs. Hooligan', (b ?? a)!.key, { at: t0 });
  fake.seed.character(me, 'Spritey', (c ?? a)!.key, { debuted: false, loudness: 'announced' });
  fake.seed.settle({ at: t0 + 86_400_000, debut: false, standings: { [pipe]: 1420, [hoolie]: 685 } });
  fake.signInAs(me);
};

/** Three masks: one free to Turn, one waiting to debut. */
export const WithCharacters: Story = { parameters: { world: full } };

/** A Turn that is waiting, with Change and Withdraw. */
const pending: World = (fake, instance) => {
  full(fake, instance);
  const [, b] = instance.classes;
  void fake.myCharacters().then((mine) => fake.turn(mine.find((c) => c.name === 'Pipewrench')!.id, (b ?? instance.classes[0]!).key, 'announced', true, false));
};
export const PendingTurn: Story = { parameters: { world: pending } };

/** No characters yet. */
export const Empty: Story = {
  parameters: { world: ((fake) => { fake.signInAs(fake.seed.account('story-player')); }) satisfies World },
};

export const NewCharacterForm: StoryObj<typeof NewCharacter> = {
  render: () => <NewCharacter />,
  parameters: { path: '/characters/new', world: ((fake, instance) => { const me = fake.seed.account('story-player'); fake.seed.character(me, 'Pipewrench', instance.classes[0]!.key); fake.signInAs(me); }) satisfies World },
};
