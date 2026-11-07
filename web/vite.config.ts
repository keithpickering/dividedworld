/**
 * The web app: the composition root where the engine's screens (engine/ui/) and an instance's
 * look and words (instances/<name>/ui/) meet. Its root is web/; the files it imports from the
 * engine and the instance sit above it, so the dev server may read the repository's root.
 *
 * An instance's `ui/public/` is the site's root: Vite's publicDir, copied as it is to the root of
 * web/dist/, so Divided World's favicon.ico and apple-touch-icon.png are served at /favicon.ico and
 * /apple-touch-icon.png (docs/plans/2026-11-02-favicon-design.md §5). The icons' sources sit beside
 * it in `ui/icon/`, which is not served.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { themePreviewPlugin } from '../tools/theme-preview.mjs';
import { fileURLToPath } from 'node:url';
import { SECURITY_HEADERS } from './headers.ts';

const repo = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: fileURLToPath(new URL('../instances/divided-world/ui/public', import.meta.url)),
  plugins: [themePreviewPlugin(), react()],
  server: { fs: { allow: [repo] } },
  /* `vite preview` answers with the headers the site is served with (headers.ts), so the e2e run is under the real policy. */
  preview: { headers: { ...SECURITY_HEADERS } },
  build: { outDir: 'dist', emptyOutDir: true },
});
