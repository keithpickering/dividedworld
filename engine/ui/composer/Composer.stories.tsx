import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { World } from '../story.tsx';
import { ThreadScreen } from '../thread/Thread.tsx';

function ShortThread() {
  const { api } = useKayfa();
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      for (const board of await api.boards()) {
        const found = (await api.threads(board.id, { offset: 0, limit: 50 })).threads.find((t) => t.title === 'Reply here');
        if (found) { setId(found.id); return; }
      }
    })();
  }, [api]);
  return id ? <ThreadScreen thread={id} /> : <div aria-busy="true" />;
}

const meta: Meta<typeof ShortThread> = { title: 'Composer/Quick reply', component: ShortThread };
export default meta;
type Story = StoryObj<typeof ShortThread>;

const world: World = (fake, instance) => {
  const me = fake.seed.account('story-player');
  const mine = fake.seed.character(me, 'Pipewrench', instance.classes[0]!.key);
  fake.seed.character(me, 'Mrs. Hooligan', (instance.classes[1] ?? instance.classes[0]!).key);
  const other = fake.seed.character(fake.seed.account('story-other'), 'Spritey', instance.classes[0]!.key);
  const general = instance.boards.find((b) => !b.system)!.slug;
  const t = fake.seed.thread(general, other, 'Reply here', 'A post to answer, or to spin a thread from.');
  fake.seed.post(t.thread, mine, 'My own post, which I can edit.');
  fake.signInAs(me);
};

/** The reply box at the foot, with its toolbar and preview toggle. */
export const QuickReply: Story = { parameters: { world } };
