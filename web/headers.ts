/**
 * The response headers the site is served with, in one place. netlify.toml repeats these values
 * (a TOML file cannot import them) and web/headers.test.tsx fails if the two differ; vite.config.ts
 * serves them from `vite preview`, so the end-to-end run in e2e/ is the page under the same policy
 * Netlify applies. The Content-Security-Policy allows the page itself and the Supabase origin and
 * nothing else: connections and images to https://*.supabase.co (and wss for Realtime), and
 * 'wasm-unsafe-eval' in script-src for the WebAssembly WebP encoder the avatar fallback uses
 * (engine/ui/profile-edit/wasm-webp.ts). An instance on a Supabase custom domain adds that origin here.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' blob: data: https://*.supabase.co",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': CSP,
  'Referrer-Policy': 'strict-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

/** Built files carry a content hash in their names, so they never change under a name. */
export const ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';
