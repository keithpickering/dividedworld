import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLACEHOLDER_KEY, rehearsalApiKey } from './key.ts';

test('a live mode takes the Anthropic key from the process environment when one is set', () => {
  for (const mode of ['record', 'fresh'] as const) {
    assert.equal(rehearsalApiKey(mode, { ANTHROPIC_API_KEY: 'sk-test' }), 'sk-test', mode);
  }
});

test('a live mode with no key in the environment sends the placeholder, for a proxy that holds the real one', () => {
  for (const mode of ['record', 'fresh'] as const) {
    assert.equal(rehearsalApiKey(mode, {}), PLACEHOLDER_KEY, mode);
    assert.equal(rehearsalApiKey(mode, { ANTHROPIC_API_KEY: '' }), PLACEHOLDER_KEY, `${mode}, empty`);
    assert.equal(rehearsalApiKey(mode, { ANTHROPIC_API_KEY: '  ' }), PLACEHOLDER_KEY, `${mode}, blank`);
  }
});

test('a mode that never goes live never reads the key, even when one is set', () => {
  for (const mode of ['stub', 'offline'] as const) {
    assert.equal(rehearsalApiKey(mode, { ANTHROPIC_API_KEY: 'sk-test' }), PLACEHOLDER_KEY, mode);
  }
});
