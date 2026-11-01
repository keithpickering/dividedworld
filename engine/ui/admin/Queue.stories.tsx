/**
 * The admin queue (the system plan, Task 12; mock-s3-admin-queue.html B), a glass page under the pause menu: moves waiting to land
 * (with HOLD), moves in force (with REVERSE), and the ended group, folded. Signed in as an admin; "As a player" is the same address
 * for someone who is not one. The clock is the in-memory world's, so "IN 17 HOURS" reads the same each time.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { seedMoves } from '../board/move-world.ts';
import { Page } from '../glass/Page.tsx';
import type { World } from '../story.tsx';
import { QueueScreen } from './Queue.tsx';

const meta: Meta<typeof QueueScreen> = { title: 'Admin/Queue', component: QueueScreen };
export default meta;

type Story = StoryObj<typeof QueueScreen>;

/** The in-memory world's clock is fixed at the start of its season (engine/ui/data/fake.ts), so the countdown is read against it. */
const START = Date.UTC(2026, 9, 29, 12);

const admin: World = (fake, instance) => { seedMoves(fake, instance, { signIn: 'admin' }); };
const player: World = (fake, instance) => { seedMoves(fake, instance, { signIn: 'player' }); };

function InPage() {
  return <Page surface="settings"><QueueScreen now={START} /></Page>;
}

export const Admin: Story = { render: () => <InPage />, parameters: { world: admin, path: '/admin/queue' } };
export const AsAPlayer: Story = { render: () => <InPage />, parameters: { world: player, path: '/admin/queue' } };
