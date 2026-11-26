/**
 * The jobs admin page (the job health plan, Task 6): an admin with every job running, an admin with conceal stopped (a request sent and never answered
 * well), and a player, who is told it is an admin's.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Page } from '../glass/Page.tsx';
import { jobsWorld } from './jobs-world.ts';
import { JobsScreen } from './Jobs.tsx';

const meta: Meta<typeof JobsScreen> = { title: 'Admin/Jobs', component: JobsScreen };
export default meta;

type Story = StoryObj<typeof JobsScreen>;

const inPage = { render: () => <Page surface="settings"><JobsScreen /></Page> };

export const AllRunning: Story = { ...inPage, parameters: { world: jobsWorld('admin', false), path: '/admin/jobs' } };
export const OneStopped: Story = { ...inPage, parameters: { world: jobsWorld('admin', true), path: '/admin/jobs' } };
export const AsAPlayer: Story = { ...inPage, parameters: { world: jobsWorld('player', false), path: '/admin/jobs' } };
