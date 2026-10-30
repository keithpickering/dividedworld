/**
 * The React board (docs/research/2026-10-29-two-worlds/03-react.html, 900 by 700) as a story: the
 * rival's view of Mrs. Hooligan's #42 on the boards fixture's `03-react` moment, the post as the
 * thread draws it on the board's own white page, so the board match (e2e/boards/03-react.ts) can
 * press its React and read the picker through the end-to-end build's story route
 * (`?fixture=boards&story=<id>`, web/src/data/fixtures/stories.tsx) beside the board. In Storybook
 * the play function presses React the same way.
 *
 * The rival is the viewer because the player owns Mrs. Hooligan, and a player's own posts carry no
 * React (the glass plan, section 3, item 1); the rival's own Tea is the outlined kind, and "2 of 3
 * left" is the rival's own count. The post is read the way the thread reads it (its Act, its
 * author's postbit, its tallies and the viewer's own reactions) and drawn by the thread's own
 * article, alone, at the board's place on the page.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useMemo, useState } from 'react';
import { userEvent, within } from 'storybook/test';
import { useKayfa } from '../context.tsx';
import type { Act, Id } from '../data/api.ts';
import type { PostbitPerson } from '../postbit/Postbit.tsx';
import { ActArticle, ThreadCtx, type ThreadContext } from '../thread/Post.tsx';
import { createTallies } from '../thread/tallies.ts';
import { createMine } from './mine.ts';
import './reactions-board.css';

interface OnePostProps {
  /** The thread's title, as the fixture names it. */
  readonly title: string;
  /** The post's number in the thread. */
  readonly seq: number;
}

interface Read { readonly context: ThreadContext; readonly act: Act; readonly person: PostbitPerson | undefined }

/** One post of a thread, read and drawn as the thread does, on the board's page. */
function OnePost({ title, seq }: OnePostProps) {
  const { api, settings } = useKayfa();
  const tallies = useMemo(() => createTallies(), []);
  const mine = useMemo(() => createMine(), []);
  const [read, setRead] = useState<Read | null>(null);
  useEffect(() => {
    void (async () => {
      let thread: Id | null = null;
      for (const board of await api.boards()) {
        thread = (await api.threads(board.id, { offset: 0, limit: 200 })).threads.find((t) => t.title === title)?.id ?? thread;
      }
      if (thread === null) return;
      const [summary, [act]] = await Promise.all([api.thread(thread), api.acts(thread, seq, seq)]);
      if (!summary || !act) return;
      const author = act.character;
      let person: PostbitPerson | undefined;
      if (author !== null) {
        const [[character], stats, standings] = await Promise.all([api.characters([author]), api.characterStats([author]), api.standingAmounts([author])]);
        if (character) person = { character, posts: stats[author]?.posts ?? 0, standing: standings[author] ?? null, revealed: null, turnedAt: null };
      }
      tallies.merge(act.id, (await api.tallies([act.id]))[act.id] ?? {});
      mine.merge(act.id, await api.myReactions([act.id]));
      setRead({
        act, person,
        context: { thread, perPage: settings.postsPerPage, summary, tallies, mine, observer: null, quote: null, changed: () => {} },
      });
    })();
  }, [api, settings, title, seq, tallies, mine]);
  if (!read) return <div className="kb-react-board" aria-busy="true" />;
  return (
    <div className="kb-react-board">
      <ThreadCtx.Provider value={read.context}>
        <ActArticle act={read.act} person={read.person} layout="side" slid={false} />
      </ThreadCtx.Provider>
    </div>
  );
}

const meta: Meta<typeof OnePost> = {
  title: 'Boards/03 React',
  component: OnePost,
  args: { title: 'who keeps splatting my posts', seq: 42 },
  parameters: { moment: '03-react', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof OnePost>;

/** The board at its own size, 900 by 700, with the picker open (the board match presses React itself). */
export const Board: Story = {
  play: async ({ canvasElement }) => { await userEvent.click(await within(canvasElement).findByRole('button', { name: 'React' })); },
};
