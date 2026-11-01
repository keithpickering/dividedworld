import type { Meta, StoryObj } from '@storybook/react-vite';
import type { World } from '../story.tsx';
import { PresenceBox } from './PresenceBox.tsx';

/* Every story is the index's place, so the world needs no thread's id; a thread's and a board's box look the same. */
const meta: Meta<typeof PresenceBox> = {
  title: 'Presence/PresenceBox',
  component: PresenceBox,
  args: { place: { kind: 'index' }, heading: 'Users browsing this thread' },
};
export default meta;

type Story = StoryObj<typeof PresenceBox>;

const NAMES = ['Pipewrench', 'Mrs. Hooligan', 'Captain Gravy', 'Tuna Can', 'Lord Fungus', 'Bartleby', 'Wario Jr.', 'The Accountant',
  'Hot Mustard', 'Ghost of 2004', 'Snacks', 'Monty', 'Ribbit', 'Dr. Couch', 'Hall Pass', 'Sprocket', 'Lint', 'Gumbo', 'Ollie'];

/** The player, playing Spritey, and `others` of the names browsing before them; Spritey hidden when asked. */
const browsing = (others: number, hidden = false): World => (fake, instance) => {
  const cls = instance.classes[0]!.key;
  for (const name of NAMES.slice(0, others)) {
    const account = fake.seed.account(`story-${name.toLowerCase().replace(/\W/gu, '')}`);
    const c = fake.seed.character(account, name, cls);
    fake.signInAs(account);
    void fake.here({ kind: 'index' }, c);
    fake.clock.advance(1000);
  }
  const me = fake.seed.account('story-player');
  const spritey = fake.seed.character(me, 'Spritey', cls);
  fake.signInAs(me);
  if (hidden) void fake.setPresenceHidden(spritey, true);
};

export const YourMaskAlone: Story = { parameters: { world: browsing(0), path: '/' } };
export const ThreeNames: Story = { parameters: { world: browsing(2), path: '/' } };
export const PastTheCap: Story = { parameters: { world: browsing(19), path: '/' } };
export const YourMaskHidden: Story = { parameters: { world: browsing(2, true), path: '/' } };
export const WhoIsOnline: Story = {
  args: { heading: 'Who is online', note: 'Characters active in the past 5 minutes' },
  parameters: { world: browsing(4), path: '/' },
};
