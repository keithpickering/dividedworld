import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { CannotDisplay, CannotFind } from './Unavailable.tsx';

/* The error pages draw inside <main>, as a screen does; the story supplies it. */
const inMain = (Story: () => ReactNode) => <main><Story /></main>;

const displayMeta: Meta<typeof CannotDisplay> = {
  title: 'Frame/CannotDisplay',
  component: CannotDisplay,
  args: { address: 'dw.gripe/t/3f2a9c1e', onRetry: () => {} },
  decorators: [inMain],
};
export default displayMeta;

export const Display: StoryObj<typeof CannotDisplay> = {};

export const Find: StoryObj<typeof CannotFind> = {
  render: () => inMain(() => <CannotFind address="dw.gripe/t/nothing-here" />),
};
