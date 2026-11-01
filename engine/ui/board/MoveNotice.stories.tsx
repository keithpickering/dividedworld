/**
 * A move in force on the board it changed (the system plan, Task 12; mock-s1-move-notice.html C): the Boss's 2003 notice under the
 * board's description, with its top three reactions small, and on its corner the Act's long label in glass and the plain "WAY OUT"
 * segment, which opens the glass overlay (press it, or Enter or Space on it).
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useKayfa } from '../context.tsx';
import type { World } from '../story.tsx';
import { BoardScreen } from './Board.tsx';
import { seedMoves } from './move-world.ts';

const meta: Meta<typeof BoardScreen> = { title: 'Board/Move notice', component: BoardScreen };
export default meta;

type Story = StoryObj<typeof BoardScreen>;

const world: World = (fake, instance) => { seedMoves(fake, instance); };

/** The instance's first board, whatever it is called: the board the move renamed. */
function First() {
  const { instance } = useKayfa();
  return <BoardScreen slug={instance.boards.find((b) => !b.system)!.slug} />;
}

export const InForce: Story = { render: () => <First />, parameters: { world, path: '/b/general' } };
