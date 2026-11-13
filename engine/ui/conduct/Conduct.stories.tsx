/**
 * The code of conduct, at /conduct (the conduct plan's Task 1), for the owner to read in review and for the composition root's axe sweep
 * (web/a11y.test.tsx): the instance's own sections, signed out, as a player meets it before registering.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { LoadedConduct } from '../loaded.tsx';

const meta: Meta = { title: 'Conduct' };
export default meta;

export const Code: StoryObj = { render: () => <LoadedConduct />, parameters: { path: '/conduct' } };
