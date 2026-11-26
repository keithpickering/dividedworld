/**
 * The jobs admin page drawn as a story against the job health design's sketch (`docs/plans/2026-11-20-job-health-design.md`, section 7), in the glass's page
 * shell as the route /admin/jobs puts it (web/src/App.tsx), signed in as an admin, with conceal stopped.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Page } from '../glass/Page.tsx';
import { JobsScreen } from './Jobs.tsx';
import { jobsWorld } from './jobs-world.ts';

function JobsStory() {
  return <Page surface="settings"><JobsScreen /></Page>;
}

const meta: Meta<typeof JobsStory> = {
  title: 'Boards/00 Admin jobs',
  component: JobsStory,
  parameters: { world: jobsWorld('admin', true), path: '/admin/jobs', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof JobsStory>;

/** The page on the Main board's layout, at 1440 wide. */
export const AdminJobs: Story = {};
/** The same page on the phone's layout. */
export const AdminJobsPhone: Story = {
  name: 'Admin jobs, phone 390 × 844',
  globals: { viewport: { value: 'glassPhone390', isRotated: false } },
};
