/**
 * The license and credits page, at /license (the licensing plan's Task 5), for the owner to read in review and for the composition root's axe
 * sweep (web/a11y.test.tsx): the instance's own terms and credits, signed out, as a visitor meets it from the footer.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { LoadedLicense } from '../loaded.tsx';

const meta: Meta = { title: 'License' };
export default meta;

export const Page: StoryObj = { render: () => <LoadedLicense />, parameters: { path: '/license' } };
