/**
 * Storybook over the engine's screens. Stories live beside their components in engine/ui/; the
 * preview (.storybook/preview.tsx) is a composition root, like web/, and hands them an
 * instance's look and words.
 */
import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../engine/ui/**/*.stories.tsx', '../instances/*/ui/**/*.stories.tsx'],
  addons: ['@storybook/addon-a11y'],
};

export default config;
