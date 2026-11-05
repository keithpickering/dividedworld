import type { Meta, StoryObj } from '@storybook/react-vite';
import { Loading } from './Loading.tsx';

const meta: Meta<typeof Loading> = {
  title: 'Frame/Loading',
  component: Loading,
  args: { host: 'dw.gripe' },
};
export default meta;

type Story = StoryObj<typeof Loading>;

/* The meter at rest beside the host: an empty well, and the status silent. */
export const AtRest: Story = {};
