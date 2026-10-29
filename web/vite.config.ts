/**
 * The web app: the composition root where the engine's screens (engine/ui/) and an instance's
 * look and words (instances/<name>/ui/) meet. Its root is web/; the files it imports from the
 * engine and the instance sit above it, so the dev server may read the repository's root.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { SECURITY_HEADERS } from './headers.ts';

const repo = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: { fs: { allow: [repo] } },
  /* `vite preview` answers with the headers the site is served with (headers.ts), so the e2e run is under the real policy. */
  preview: { headers: { ...SECURITY_HEADERS } },
  build: { outDir: 'dist', emptyOutDir: true },
});
