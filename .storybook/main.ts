/**
 * Storybook over the engine's screens. Stories live beside their components in engine/ui/; the
 * preview (.storybook/preview.tsx) is a composition root, like web/, and hands them an
 * instance's look and words.
 */
import type { StorybookConfig } from '@storybook/react-vite';
import { themePreviewPlugin } from '../tools/theme-preview.mjs';

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../engine/ui/**/*.stories.tsx', '../instances/*/ui/**/*.stories.tsx'],
  /* The instance's public files, so a story can load what the site serves at its root (the mail stories' images and fonts). */
  staticDirs: ['../instances/divided-world/ui/public'],
  addons: ['@storybook/addon-a11y'],
  /* A theme imported as `theme.css?preview` is its preview module (tools/theme-preview.mjs). */
  viteFinal: (config) => ({ ...config, plugins: [themePreviewPlugin(), ...(config.plugins ?? [])] }),
};

export default config;
