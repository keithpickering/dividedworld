import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { useNavigate } from '../router.tsx';
import { Routes } from '../routes.tsx';
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

/* A route whose load never answers, so the click stays pending and the meter stays mid-load. */
const never = () => new Promise<unknown>(() => {});
function Opens() {
  const navigate = useNavigate();
  useEffect(() => { navigate('/t/3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b'); }, [navigate]);
  return null;
}

/* Mid-load: `Opening dw.gripe/t/3f2a9c1e…` and the well filling; the page shown stays on screen. */
export const MidLoad: Story = {
  render: (args) => (
    <>
      <Loading {...args} />
      <Routes routes={[
        { path: '/', render: () => <p>The old page stays on screen while the new one opens.</p> },
        { path: '/t/:id', load: never, render: () => <p>The new page.</p> },
      ]} />
      <Opens />
    </>
  ),
};
