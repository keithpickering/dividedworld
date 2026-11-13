/**
 * The screens' unit tests: Vitest with jsdom, over the engine's screens, each instance's ui and
 * the web app. A screen's test is a `.test.tsx` file, whatever it holds, because `test:engine`
 * runs every `engine/**\/*.test.ts` under plain node, which has no DOM.
 */
import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { themePreviewPlugin } from './tools/theme-preview.mjs';

/**
 * The story sweep (web/a11y.test.tsx) is about a second of axe for each of several hundred stories, and a test file runs
 * on one worker. As one file it was 435 seconds on one CPU while every other file had finished on all of them in 225,
 * and the build was as long as that one file (issue #495). So the file runs once per part, each part a project of its
 * own and so a worker of its own, taking its share of the stories (web/a11y-share.ts). This number is the only place
 * the split is written; more parts cost each an import of every story (a few seconds), fewer leave a worker idle.
 */
const A11Y_PARTS = 8;
const A11Y_SWEEP = 'web/a11y.test.tsx';

/* Dates show in the reader's zone; a zone that is not UTC makes a local date and a UTC date differ, so a test cannot pass by luck of the machine. */
const env = { TZ: 'America/Los_Angeles' };

export default defineConfig({
  plugins: [themePreviewPlugin(), react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['web/test-setup.ts'],
    css: true,
    env,
    /* One bound for every test, sized for the build and not an idle machine: tools/build.mjs runs this suite beside the other steps on
       every worker it has, while Vitest starts its own workers, so a test of a second alone (an a11y story, a form clicked sixty times)
       can take several on a busy machine, and jsdom on Windows is slower again. Vitest's default of 5s failed them there, and a test that
       overruns keeps acting on the next test's screen and fails it too. A real hang still fails, after 30s. One bound here, never one
       a test at a time. */
    testTimeout: 30_000,
    /* Every project extends what is above. `screens` is every test file but the sweep; the rest are the sweep's parts
       (web/a11y-share.test.ts holds this list to one run of the sweep for each part). */
    projects: [
      {
        extends: true,
        test: {
          name: 'screens',
          include: ['engine/ui/**/*.test.tsx', 'instances/*/ui/**/*.test.tsx', 'instances/*/cards/**/*.test.tsx', 'web/**/*.test.tsx', 'web/**/*.test.ts', 'e2e/**/*.test.ts'],
          exclude: [...configDefaults.exclude, A11Y_SWEEP],
        },
      },
      ...Array.from({ length: A11Y_PARTS }, (_, i) => ({
        extends: true as const,
        test: {
          name: `a11y ${i + 1}/${A11Y_PARTS}`,
          include: [A11Y_SWEEP],
          env: { ...env, A11Y_PART: `${i + 1}/${A11Y_PARTS}` },
        },
      })),
    ],
  },
});
