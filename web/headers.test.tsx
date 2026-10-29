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
