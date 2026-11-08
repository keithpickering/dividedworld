/**
 * The admin queue, drawn as stories against the backfill boards `docs/research/2026-11-05-backfill/37-admin-queue.html` (1440 wide) and the first
 * screen of `39-admin-phone.html` (390 by 844): the screen itself in the glass's page shell, as the route /admin/queue puts it (web/src/App.tsx),
 * signed in as an admin. The world is the mock's sample (engine/ui/board/move-world.ts): a move waiting and one in force, the clock the in-memory
 * world's, so the countdown reads the same each time.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { seedMoves } from '../board/move-world.ts';
import { Page } from '../glass/Page.tsx';
import type { World } from '../story.tsx';
import { LoadedQueue } from '../loaded.tsx';

/** The in-memory world's clock is fixed at the start of its season (engine/ui/data/fake.ts), so the countdown is read against it. */
const START = Date.UTC(2026, 9, 29, 12);

/** The moves' world, signed in as its admin. */
const queue: World = (fake, instance) => {
  seedMoves(fake, instance, { signIn: 'admin' });
  /* The two ways the board's contact form lists. */
  fake.seed.contact([
    { label: 'Discord', href: 'https://discord.example/users/admin' },
    { label: 'Email', href: 'mailto:admin@example.test' },
  ]);
};

function QueueStory() {
  return <Page surface="settings"><LoadedQueue now={START} /></Page>;
}

const meta: Meta<typeof QueueStory> = {
  title: 'Boards/00 Admin queue',
  component: QueueStory,
  parameters: { world: queue, path: '/admin/queue', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof QueueStory>;

/** The queue on the Main board's layout, at 1440 wide. */
export const AdminQueue: Story = {};
/** The same page on the Phone board's layout, at 390 by 844. */
export const AdminQueuePhone: Story = {
  name: 'Admin queue, phone 390 × 844',
  globals: { viewport: { value: 'glassPhone390', isRotated: false } },
};
