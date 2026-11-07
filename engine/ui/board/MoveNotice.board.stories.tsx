/**
 * A move in force on its board, drawn as a story against board 11 of the board look design (`docs/research/2026-11-06-board-look/11-move-notice.html`,
 * 1440 by 1000; its phone is the first screen of `15-phone.html`): the Boss's announcement as a table under the board's description, the glass label on
 * its corner, then Start a thread and the board's one thread (e2e/boards/2026-11-06-board-look/11-move-notice.ts compares it). The world is the move
 * world's (engine/ui/board/move-world.ts), with the board's Pipewrench browsing.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useKayfa } from '../context.tsx';
import { Frame } from '../frame/Frame.tsx';
import { LoadedBoard } from '../loaded.tsx';
import type { World } from '../story.tsx';
import { seedMoves } from './move-world.ts';

const world: World = (fake, instance) => {
  const w = seedMoves(fake, instance);
  fake.seed.character(w.me, 'Mrs. Hooligan', instance.classes[0]!.key);
  void (async () => {
    const board = await fake.board(w.general);
    if (board) await fake.here({ kind: 'board', board: board.id }, w.pipewrench);
  })().catch(() => {});
};

function NoticeStory() {
  const { instance } = useKayfa();
  return <Frame><LoadedBoard slug={instance.boards.find((b) => !b.system)!.slug} /></Frame>;
}

const meta: Meta<typeof NoticeStory> = {
  title: 'Boards/11 Move notice',
  component: NoticeStory,
  parameters: { world, path: '/', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof NoticeStory>;

/** The Boss's announcement on the board it renamed. */
export const MoveNotice: Story = {};
