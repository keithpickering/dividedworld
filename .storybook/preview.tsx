/**
 * Storybook's composition root: the engine's base stylesheet and an instance's house theme, as
 * web/ loads them. Stories in engine/ui/ never import an instance; this file hands them one.
 */
import type { Preview } from '@storybook/react-vite';
import '../engine/ui/base.css';
import '../instances/divided-world/ui/theme.css';

const preview: Preview = {
  parameters: { a11y: { test: 'error' } },
};

export default preview;
