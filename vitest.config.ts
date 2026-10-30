/**
 * The screens' unit tests: Vitest with jsdom, over the engine's screens, each instance's ui and
 * the web app. A screen's test is a `.test.tsx` file, whatever it holds, because `test:engine`
 * runs every `engine/**\/*.test.ts` under plain node, which has no DOM.
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['engine/ui/**/*.test.tsx', 'instances/*/ui/**/*.test.tsx', 'web/**/*.test.tsx', 'e2e/**/*.test.ts'],
    setupFiles: ['web/test-setup.ts'],
    css: true,
    /* Dates show in the reader's zone; a zone that is not UTC makes a local date and a UTC date differ, so a test cannot pass by luck of the machine. */
    env: { TZ: 'America/Los_Angeles' },
  },
});
