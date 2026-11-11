import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { CannotDisplay, CannotFind } from './Unavailable.tsx';

/* The error pages draw inside <main>, as a screen does; the story supplies it. */
const inMain = (Story: () => ReactNode) => <main><Story /></main>;

const displayMeta: Meta<typeof CannotDisplay> = {
  title: 'Frame/CannotDisplay',
  /* A path, so the preview gives the story its router and the instance (the pages and the meter read both). */
  parameters: { path: '/' },
  component: CannotDisplay,
  args: { kind: 'silent', address: 'dw.gripe/t/3f2a9c1e', onRetry: () => {} },
  decorators: [inMain],
};
export default displayMeta;

export const Display: StoryObj<typeof CannotDisplay> = {};
export const DisplayOffline: StoryObj<typeof CannotDisplay> = { args: { kind: 'offline' } };
export const DisplayServer: StoryObj<typeof CannotDisplay> = { args: { kind: 'server' } };
export const DisplayBroken: StoryObj<typeof CannotDisplay> = { args: { kind: 'broken' } };

export const Find: StoryObj<typeof CannotFind> = {
  render: () => inMain(() => <CannotFind address="dw.gripe/t/nothing-here" />),
};
