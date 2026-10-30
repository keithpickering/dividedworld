import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { ASSET_CACHE_CONTROL, SECURITY_HEADERS } from './headers.ts';

const toml = readFileSync(join(process.cwd(), 'netlify.toml'), 'utf8');
const block = (path: string): string => {
  const at = toml.indexOf(`for = "${path}"`);
  expect(at, `netlify.toml has no headers block for ${path}`).toBeGreaterThan(-1);
  const next = toml.indexOf('[[', at);
  return toml.slice(at, next < 0 ? undefined : next);
};

describe('netlify.toml and web/headers.ts are one list', () => {
  test.each(Object.entries(SECURITY_HEADERS))('%s is the same value in both', (name, value) => {
    expect(block('/*')).toContain(`${name} = ${JSON.stringify(value)}`);
  });

  test('built assets are cached as immutable', () => {
    expect(block('/assets/*')).toContain(`Cache-Control = ${JSON.stringify(ASSET_CACHE_CONTROL)}`);
  });

  test('the build needs no install step and no environment but the public pair', () => {
    expect(toml).toMatch(/command = "npm run build:web"/u);
    const code = toml.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    expect(code).not.toMatch(/SERVICE_ROLE|SECRET|API_KEY/iu);
  });
});

describe('the owner\'s choice, 2026-10-29: a post may show an image from any https host', () => {
  test('img-src allows https: (a poster\'s host can see who loads it; the owner chose old-forum [img])', () => {
    const img = (SECURITY_HEADERS['Content-Security-Policy'] ?? '').split(';').map((d) => d.trim()).find((d) => d.startsWith('img-src '));
    expect(img?.split(/\s+/u)).toContain('https:');
  });
  test('nothing else is opened: scripts, connections and frames stay as they were', () => {
    const csp = SECURITY_HEADERS['Content-Security-Policy'] ?? '';
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).toContain("connect-src 'self' https://*.supabase.co wss://*.supabase.co");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
