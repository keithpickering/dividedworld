/**
 * The poll's editor under the reply box (docs/plans/2026-11-20-polls-plan.md, Task 6), on the board's own white page: the reply box with a poll being written, which the story gets as a kept
 * draft (the box reads its draft before its first frame, as it does after a reload), and the same with the first Send's problem shown under the field it names. The cards are not involved.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { draftKey, writeDraft } from '../composer/draft.ts';
import { useKayfa } from '../context.tsx';
import { LoadedThread } from '../loaded.tsx';
import type { World } from '../story.tsx';

const TITLE = 'Reply here';
let kept: { account: string; thread: string } | null = null;

function ReplyWithPoll() {
  const { api } = useKayfa();
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      for (const board of await api.boards()) {
        const found = (await api.threads(board.id, { offset: 0, limit: 50 })).threads.find((t) => t.title === TITLE);
        if (found) {
          if (kept) writeDraft(draftKey(kept.account, found.id), { text: 'Settle this.', as: null, poll: { question: 'Best kart in the series?', options: ['Pipe Frame', 'Badwagon', ''], pick: 1, secret: false, lasts: { unit: 'day', count: 3 } } });
          setId(found.id);
          return;
        }
      }
    })();
  }, [api]);
  return id ? <LoadedThread thread={id} /> : <div aria-busy="true" />;
}

const meta: Meta<typeof ReplyWithPoll> = { title: 'Boards/29 Poll draft', component: ReplyWithPoll };
export default meta;
type Story = StoryObj<typeof ReplyWithPoll>;

const world: World = (fake, instance) => {
  const me = fake.seed.account('story-player');
  fake.seed.character(me, 'Pipewrench', instance.classes[0]!.key);
  const other = fake.seed.character(fake.seed.account('story-other'), 'Spritey', instance.classes[0]!.key);
  const general = instance.boards.find((b) => !b.system)!.slug;
  fake.seed.thread(general, other, TITLE, 'A post to answer.');
  kept = { account: me, thread: '' };
  fake.signInAs(me);
};

/** A poll being written under the reply: the question, three option rows (one still empty), how many a voter may pick, secret ballots, how long it stays open, and Remove poll. */
export const WithPoll: Story = { parameters: { world } };
