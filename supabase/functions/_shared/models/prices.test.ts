import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRICES, price } from './prices.ts';

test('each provider\'s table says when it was verified', () => {
  assert.equal(PRICES.anthropic.verifiedOn, '2026-10-31');
  assert.match(PRICES.completions.verifiedOn, /^\d{4}-\d{2}-\d{2}$/);
});

test('a standard call is priced per million tokens from the usage block; microdollars are whole', () => {
  // Opus: 4.00 in, 20.00 out, 0.20 cache read, 5.00 / 8.00 cache write; a million tokens at $4 is 4,000,000 microdollars.
  assert.equal(price('anthropic', 'claude-opus-5-5', { inputTokens: 1_000_000, serviceTier: 'standard' }), 4_000_000);
  assert.equal(price('anthropic', 'claude-opus-5-5', { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 10_000, cacheWrite5mTokens: 2000, cacheWrite1hTokens: 1000, serviceTier: 'standard' }),
    4000 + 10_000 + 2000 + 10_000 + 8000);
  assert.equal(price('anthropic', 'claude-haiku-5-5', { inputTokens: 1000, outputTokens: 500, serviceTier: 'standard' }), 100 + 250);
  assert.equal(price('anthropic', 'claude-sonnet-5-5', { inputTokens: 3, serviceTier: 'standard' }), 6);
  assert.equal(price('anthropic', 'claude-haiku-5-5', { inputTokens: 1, serviceTier: 'standard' }), 1, 'a fraction of a microdollar rounds up, never down to a free call');
});

test('the batch tier is half of standard', () => {
  assert.equal(price('anthropic', 'claude-opus-5-5', { inputTokens: 1_000_000, serviceTier: 'batch' }), 2_000_000);
});

test('Haiku\'s long-context rates apply to a prompt over 100K tokens, cache included', () => {
  assert.equal(price('anthropic', 'claude-haiku-5-5', { inputTokens: 100_000, serviceTier: 'standard' }), 10_000);
  assert.equal(price('anthropic', 'claude-haiku-5-5', { inputTokens: 100_001, outputTokens: 1000, serviceTier: 'standard' }), 50_001 + 2500 + 0);
  assert.equal(price('anthropic', 'claude-haiku-5-5', { inputTokens: 1000, cacheReadTokens: 100_000, serviceTier: 'standard' }), 500 + 5000);
});

test('the tier the usage block reports is priced, from a table that has a row for it', () => {
  const table = { ...PRICES.anthropic, models: { 'claude-haiku-5-5': { tiers: {
    standard: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite5m: 0.125, cacheWrite1h: 0.2 },
    priority: { input: 0.2, output: 1, cacheRead: 0.02, cacheWrite5m: 0.25, cacheWrite1h: 0.4 },
  } } } };
  assert.equal(price('anthropic', 'claude-haiku-5-5', { inputTokens: 1000, outputTokens: 1000, serviceTier: 'priority' }, table), 200 + 1000);
  assert.equal(price('anthropic', 'claude-haiku-5-5', { inputTokens: 1000, outputTokens: 1000, serviceTier: 'standard' }, table), 100 + 500);
});

test('a model or a tier missing from the table throws and names it; so does a usage block with no tier', () => {
  assert.throws(() => price('anthropic', 'claude-mystery-9', { inputTokens: 1, serviceTier: 'standard' }), /claude-mystery-9/);
  assert.throws(() => price('anthropic', 'claude-opus-5-5', { inputTokens: 1, serviceTier: 'priority' }), /priority/);
  assert.throws(() => price('anthropic', 'claude-opus-5-5', { inputTokens: 1 }), /tier/);
  assert.throws(() => price('nobody', 'm', { inputTokens: 1, serviceTier: 'standard' }), /nobody/);
});

test('the self-hosted endpoint is priced at an explicit zero per GPU second, and still prices', () => {
  assert.equal(price('completions', 'self-hosted', { gpuSeconds: 12.5, serviceTier: 'self-hosted' }), 0);
  assert.equal(price('completions', 'self-hosted', { inputTokens: 10, outputTokens: 10, serviceTier: 'self-hosted' }), 0);
  assert.throws(() => price('completions', 'some-hosted-model', { gpuSeconds: 1, serviceTier: 'self-hosted' }), /some-hosted-model/);
  const paid = { provider: 'completions', verifiedOn: '2026-10-31', unit: 'perGpuSecond', models: { 'self-hosted': { tiers: { 'self-hosted': { perGpuSecond: 0.0004 } } } } };
  assert.equal(price('completions', 'self-hosted', { gpuSeconds: 10, serviceTier: 'self-hosted' }, paid as never), 4000);
});
