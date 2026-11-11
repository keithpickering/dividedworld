import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderOutboxRow } from './conduct.ts';
import { conduct, mailTheme } from '../instance.ts';

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

test('the database\'s paths become addresses on the site and a section key becomes its title', () => {
  const key = conduct.sections[0]!.key;
  const facts = { post: '/t/abc?page=2#post-31', thread: '/t/abc', section: key, note: 'a note', conduct: '/conduct' };
  const r = renderOutboxRow({ template: 'nudge', facts });
  assert.ok(r.text.includes(`${mailTheme.site}/t/abc?page=2#post-31`), r.text);
  assert.ok(r.text.includes(`${mailTheme.site}/conduct`), r.text);
  assert.ok(r.text.includes(conduct.sections[0]!.title), 'the section is named by its title');
  assert.ok(!r.text.includes(`: ${key}\n`), 'and not by its key');
  const gone = renderOutboxRow({ template: 'nudge', facts: { ...facts, section: 'no-such-key' } });
  assert.ok(gone.text.includes('no-such-key'), 'a key the code no longer holds stays as written');
});
