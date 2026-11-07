/** A theme stylesheet imported as `x.css?preview` is its preview, read from the file at build time (tools/theme-preview.mjs). */
declare module '*.css?preview' {
  import type { ThemePreview } from './types.ts';
  const preview: { readonly light?: ThemePreview; readonly dark?: ThemePreview };
  export default preview;
}
