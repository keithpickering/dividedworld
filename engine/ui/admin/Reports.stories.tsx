/**
 * The reports screen (the conduct plan, Task 7), a glass page under the pause menu: open reports with the outcome form, the edits to look at again, and
 * mail that failed, with the notice for mail waiting on an admin address. "As a player" is the same address for someone who is not an admin.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Page } from '../glass/Page.tsx';
import type { World } from '../story.tsx';
import { LoadedReports } from '../loaded.tsx';

const meta: Meta<typeof LoadedReports> = { title: 'Admin/Reports', component: LoadedReports };
export default meta;

type Story = StoryObj<typeof LoadedReports>;

const seed = (as: 'admin' | 'player'): World => (fake, instance) => {
  const cls = instance.classes[0]!.key;
  const board = instance.boards.find((b) => !b.system)!.slug;
  const admin = fake.seed.account('reports-admin', { admin: true });
  const author = fake.seed.account('reports-author');
  const player = fake.seed.account('reports-player');
  const ada = fake.seed.character(author, 'Ada', cls);
  const t = fake.seed.thread(board, ada, 'A thread', 'Opening words.');
  const post = fake.seed.post(t.thread, ada, 'Words that were reported.');
  const section = 'person';
  fake.seed.conductReport({ version: post, section, note: 'This was cruel.' });
  fake.seed.conductDecision({ account: author, outcome: 'nudge', note: 'Easy now.' });
  fake.seed.conductReview({ post, words: 'Better words.' });
  fake.seed.failedMail({ account: author, template: 'suspended', kind: 'failed', error: 'the provider timed out' });
  fake.seed.mailWaiting(2);
  fake.signInAs(as === 'admin' ? admin : player);
};

function InPage() {
  return <Page surface="settings"><LoadedReports /></Page>;
}

export const Admin: Story = { render: () => <InPage />, parameters: { world: seed('admin'), path: '/admin/reports' } };
export const AsAPlayer: Story = { render: () => <InPage />, parameters: { world: seed('player'), path: '/admin/reports' } };
