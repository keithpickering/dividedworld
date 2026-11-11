import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderOutboxRow } from './conduct.ts';

test('an outbox row renders text and themed HTML for the deployed instance, with its override applied', () => {
  const r = renderOutboxRow({ template: 'reportRead', facts: {} });
  assert.equal(r.subject, 'Your report was read by an admin');
  assert.match(r.text, /Every report is read\./);
  assert.match(r.html, /<!doctype html>/);
  assert.match(r.html, /Divided World/);
});

test('a row whose facts the template refuses throws', () => {
  assert.throws(() => renderOutboxRow({ template: 'reportRead', facts: { outcome: 'hide' } }), /outcome/);
});
