import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { ThreadSummary } from '../data/api.ts';
import type { World } from '../story.tsx';
import { ThreadScreen } from '../thread/Thread.tsx';
import { SpinForm } from './SpinForm.tsx';

const TITLE = 'Where it began';

/** The thread with this title, once the world has it. */
function useThread(title: string): ThreadSummary | null {
  const { api } = useKayfa();
  const [found, setFound] = useState<ThreadSummary | null>(null);
  useEffect(() => {
    void (async () => {
      for (const board of await api.boards()) {
        const hit = (await api.threads(board.id, { offset: 0, limit: 50 })).threads.find((t) => t.title === title);
        if (hit) { setFound(hit); return; }
      }
    })();
  }, [api, title]);
  return found;
}

/** The thread spun from the first post of "Where it began", opened on its ORIGIN box. */
function SpunThread() {
  const spun = useThread('Spun from the start');
  return spun ? <ThreadScreen thread={spun.id} /> : <div aria-busy="true" />;
}

/** The first post's spin form, open under it. */
function OpenForm() {
  const first = useThread(TITLE);
  return first?.firstAct ? <SpinForm origin={first.firstAct} seq={1} onClose={() => undefined} /> : <div aria-busy="true" />;
}

const meta: Meta = { title: 'Spin/Spin' };
export default meta;

const world: World = (fake, instance) => {
  const me = fake.seed.account('story-player');
  const mine = fake.seed.character(me, 'Pipewrench', instance.classes[0]!.key);
  const other = fake.seed.character(fake.seed.account('story-other'), 'Spritey', (instance.classes[1] ?? instance.classes[0]!).key);
  const general = instance.boards.find((b) => !b.system)!.slug;
  const t = fake.seed.thread(general, other, TITLE, 'A post worth a thread of its own.');
  fake.seed.post(t.thread, mine, 'An answer.');
  /* The fake does its work before it answers, so the spun thread is there when the story reads. */
  void fake.spin(t.act, mine, 'Spun from the start', 'Carrying on over here.');
  fake.signInAs(me);
};

/** The small form under a post that starts a thread from it. */
export const SpinFormOpen: StoryObj = { render: () => <OpenForm />, parameters: { world } };

/** A spun thread, opening on its ORIGIN box: the Act it came from, live, with a link back. */
export const OriginBox: StoryObj = { render: () => <SpunThread />, parameters: { world } };
