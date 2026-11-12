import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { callKey, canonicalJson } from './cassette.ts';
import type { ChatRequest, CompletionRequest } from '../system/model.ts';

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const chat: ChatRequest = {
  duty: 'meeting', tier: 'strong', system: 'You are the Boss.', messages: [{ role: 'user', content: 'Go.' }],
  schema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
  rules: { type: 'object', fields: { a: { type: 'string', maxLength: 5 } } }, maxTokens: 1000, staff: 'boss', meeting: 7,
};
const completion: CompletionRequest = { duty: 'chatter', prompt: 'Say.', temperature: 0.7, topP: 0.9, stop: ['\n'], maxTokens: 50, maxChars: 200, staff: 'mod', meeting: 3 };
const key = (r: ChatRequest = chat, model = 'm1') => callKey('chat', r, model, sha256);

test('the key is a hash, the same for the same request', () => {
  assert.match(key(), /^[0-9a-f]{64}$/);
  assert.equal(key(), key({ ...chat }));
});

test('changing any one field of a chat request, or the model, changes the key', () => {
  const changed: Partial<ChatRequest>[] = [
    { duty: 'chatter' }, { tier: 'light' }, { system: 'You are not.' }, { messages: [{ role: 'user', content: 'Stop.' }] },
    { messages: [{ role: 'assistant', content: 'Go.' }] }, { schema: { type: 'object' } },
    { rules: { type: 'object', fields: { a: { type: 'string', maxLength: 6 } } } }, { rules: undefined }, { maxTokens: 1001 }, { cachePrefix: true },
  ];
  const base = key();
  const seen = new Set([base]);
  for (const c of changed) {
    const k = key({ ...chat, ...c } as ChatRequest);
    assert.ok(!seen.has(k), `a change to ${JSON.stringify(c)} did not change the key`);
    seen.add(k);
  }
  assert.notEqual(key(chat, 'm2'), base);
});

test('changing any one field of a completion request changes the key; the kind is part of it', () => {
  const base = callKey('complete', completion, 'm', sha256);
  const changed: Partial<CompletionRequest>[] = [
    { duty: 'meeting' }, { prompt: 'Sing.' }, { temperature: 0.8 }, { topP: 0.8 }, { stop: [] }, { maxTokens: 51 }, { maxChars: 201 }, { maxChars: undefined },
  ];
  for (const c of changed) assert.notEqual(callKey('complete', { ...completion, ...c } as CompletionRequest, 'm', sha256), base, JSON.stringify(c));
  assert.notEqual(callKey('complete', completion, 'm2', sha256), base);
  assert.notEqual(callKey('chat', completion as unknown as ChatRequest, 'm', sha256), base);
});

test('the order of keys in the request does not change the key', () => {
  const shuffled = { maxTokens: 1000, rules: { fields: { a: { maxLength: 5, type: 'string' } }, type: 'object' }, schema: { required: ['a'], properties: { a: { type: 'string' } }, type: 'object' }, messages: [{ content: 'Go.', role: 'user' }], system: 'You are the Boss.', tier: 'strong', duty: 'meeting' } as ChatRequest;
  assert.equal(key(shuffled), key());
  assert.equal(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] }), '{"a":[{"c":2,"d":1}],"b":1}');
});

test('staff and meeting number rows, not content: they do not change the key', () => {
  assert.equal(key({ ...chat, staff: 'other', meeting: 99 }), key());
  const { staff: _s, meeting: _m, ...bare } = chat;
  assert.equal(key(bare as ChatRequest), key());
  assert.equal(callKey('complete', { ...completion, staff: 'x', meeting: 1 }, 'm', sha256), callKey('complete', completion, 'm', sha256));
});
