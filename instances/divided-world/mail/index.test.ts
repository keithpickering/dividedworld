import { test } from 'node:test';
import assert from 'node:assert/strict';
import glass from '../ui/glass.json' with { type: 'json' };
import { mailTheme, readColor } from './index.ts';

const tokens = {
  ground: '--kb-glass-ground', field: '--kb-glass-field', text: '--kb-glass-text', text2: '--kb-glass-text-2',
  hi: '--kb-glass-text-hi', pale: '--kb-glass-pale', neon: '--kb-glass-neon', violet: '--kb-glass-violet',
  neonText: '--kb-glass-neon-text', ink: '--kb-glass-ink-neon',
} as const;

test('every color equals its token in glass.json', () => {
  const std = glass.keys.standard as Record<string, { value: string }>;
  for (const [k, token] of Object.entries(tokens)) {
    assert.equal((mailTheme.colors as Record<string, string>)[k], std[token]!.value, k);
  }
});

test('each asset and font URL is under site', () => {
  assert.equal(mailTheme.site, 'https://dw.gripe');
  assert.equal(mailTheme.name, 'Divided World');
  for (const u of [...Object.values(mailTheme.assets), ...mailTheme.fonts.map((f) => f.url)]) assert.ok(u.startsWith(mailTheme.site + '/'), u);
  assert.equal(mailTheme.fonts.length, 4);
});

test('a missing or non-hex token throws naming it', () => {
  assert.throws(() => readColor({}, '--kb-glass-ground'), /--kb-glass-ground/);
  assert.throws(() => readColor({ '--kb-glass-neon': { value: 'rgb(0,0,0)' } }, '--kb-glass-neon'), /--kb-glass-neon/);
  assert.throws(() => readColor({ '--kb-glass-neon': { value: '#fff' } }, '--kb-glass-neon'), /--kb-glass-neon/);
  assert.equal(readColor({ '--kb-glass-neon': { value: '#00ff88' } }, '--kb-glass-neon'), '#00ff88');
});
