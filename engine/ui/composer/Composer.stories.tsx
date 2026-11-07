import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { World } from '../story.tsx';
import { ThreadScreen } from '../thread/Thread.tsx';
import { LoadedThread } from '../loaded.tsx';

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
  return id ? <LoadedThread thread={id} /> : <div aria-busy="true" />;
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

/**
 * Pipewrench barred from General by the Boss's move: the barred box where the reply box would be, with the way out. The same player's other mask, Mrs. Hooligan, posts freely
 * (swap in the HUD). `state` is where Pipewrench's apology stands.
 */
const barred = (state: 'none' | 'waiting' | 'rejected'): World => (fake, instance) => {
  const me = fake.seed.account('story-player');
  const mine = fake.seed.character(me, 'Pipewrench', instance.classes[0]!.key);
  fake.seed.character(me, 'Mrs. Hooligan', (instance.classes[1] ?? instance.classes[0]!).key);
  const other = fake.seed.character(fake.seed.account('story-other'), 'Spritey', instance.classes[0]!.key);
  const general = instance.boards.find((b) => !b.system)!.slug;
  fake.seed.thread(general, other, 'Reply here', 'A post to answer.');
  fake.seed.staff('story-boss', 'The Director', 'boss');
  const group = instance.groups.conferred.find((g) => g.tone === 'punishment')!.key;
  const move = fake.seed.groupMove('story-boss', { character: mine, group, board: general, at: Date.now() - 3_600_000, expiresAt: Date.now() + 3 * 86_400_000 });
  if (state === 'waiting') fake.seed.apology(mine, move, 'pending');
  if (state === 'rejected') fake.seed.apology(mine, move, 'rejected', { at: Date.now() - 3_600_000 });
  fake.signInAs(me);
};

export const BarredBox: Story = { parameters: { world: barred('none') } };
export const BarredApologyWaiting: Story = { parameters: { world: barred('waiting') } };
export const BarredApologyRejected: Story = { parameters: { world: barred('rejected') } };
