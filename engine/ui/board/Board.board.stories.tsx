/**
 * A board's thread list, drawn as a story against board 02 of the board look design (`docs/research/2026-11-06-board-look/02-board.html`,
 * 1440 by 1000): the banner and the boards' bar, the crumb, the board's name and words, Start a thread, the list with its pinned group, its
 * four folders and the key under it, Users browsing this board, and the footer. The world is the board's: Spritey's pinned thread, a new
 * thread of Mrs. Hooligan's, a long thread that is new and hot, and a quiet one that has been read (e2e/boards/2026-11-06-board-look/02-board.ts
 * compares it). The backend's clock stands at Oct 29, so the threads' times are dated in the week before it, where the board draws Oct 5 and 6:
 * a folder is hot on replies this week, which a thread dated Oct 6 cannot have on Oct 29. The reader's clock is the real one, so a time reads
 * "9 days ago" for a while and then a date; the manifest names no time.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Frame } from '../frame/Frame.tsx';
import { LoadedBoard } from '../loaded.tsx';
import type { World } from '../story.tsx';

const HOUR = 3_600_000;
const OCT = (day: number, hour = 12) => Date.UTC(2026, 9, day, hour);

const world: World = (fake, instance) => {
  const [first, second] = instance.classes;
  const me = fake.seed.account('story-player', { seasoned: true });
  const other = fake.seed.account('story-other');
  const hooligan = fake.seed.character(me, 'Mrs. Hooligan', (second ?? first)!.key, { at: OCT(1) });
  const pipewrench = fake.seed.character(me, 'Pipewrench', first!.key, { at: OCT(1) });
  const spritey = fake.seed.character(other, 'Spritey', first!.key, { at: OCT(1) });
  const gloomba = fake.seed.character(other, 'Gloomba', (second ?? first)!.key, { at: OCT(1) });
  const general = instance.boards.find((b) => !b.system)!.slug;

  /* The pinned thread: 45 replies, the last Gloomba's, hot; the Main Event that pins it ends a day from the real time, which the board reads a play's end against. */
  const pinned = fake.seed.thread(general, spritey, 'who keeps splatting my posts', 'Again.', { at: OCT(24) });
  for (let i = 1; i <= 45; i++) fake.seed.post(pinned.thread, i % 2 ? gloomba : spritey, `Reply ${i}`, { at: OCT(26) + i * HOUR });
  fake.seed.views(pinned.thread, 12);
  fake.seed.reach(spritey, 'thread', pinned.thread, 'main-event', { ends: Math.max(fake.clock.now(), Date.now()) + 24 * HOUR });

  /* The long one: 169 replies, the last Pipewrench's, the latest a few hours before the clock's week turns, so it is hot. */
  const long = fake.seed.thread(general, spritey, 'The long one', 'Where to begin.', { at: OCT(20) });
  for (let i = 1; i <= 169; i++) fake.seed.post(long.thread, i === 169 ? pipewrench : spritey, `Reply ${i}`, { at: OCT(21, 11) + i * HOUR });
  fake.seed.views(long.thread, 4);

  /* A quiet thread, read to its last post. */
  const quiet = fake.seed.thread(general, spritey, 'Who keeps reacting with a thumbs up?', 'Asking for a friend.', { at: OCT(20, 8) });
  fake.seed.post(quiet.thread, hooligan, 'Not me.', { at: OCT(20, 9) });
  fake.seed.post(quiet.thread, spritey, 'Sure.', { at: OCT(20, 10) });
  fake.seed.post(quiet.thread, hooligan, 'Truly.', { at: OCT(20, 11) });
  fake.seed.views(quiet.thread, 3);

  /* The newest, with no replies: new, and not hot. */
  fake.seed.thread(general, hooligan, 'Rate my avatar', 'Be kind.', { at: OCT(28, 18) });

  fake.seed.settle({ at: OCT(28), wallet: { [me]: 240 } });
  fake.signInAs(me);
  void (async () => {
    await fake.markRead(pinned.thread, 46, null);
    await fake.markRead(quiet.thread, 4, null);
    const board = await fake.board(general);
    if (board) await fake.here({ kind: 'board', board: board.id }, hooligan);
  })().catch(() => {});
};

function BoardStory() {
  return <Frame><LoadedBoard slug="general" /></Frame>;
}

const meta: Meta<typeof BoardStory> = {
  title: 'Boards/02 Board',
  component: BoardStory,
  parameters: { world, path: '/b/general', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof BoardStory>;

/** General's thread list on the Main board's layout, at 1440 wide. */
export const Board: Story = {};
