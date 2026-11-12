import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authTemplates } from './auth.ts';

const HREF = '{{ .RedirectTo }}#token_hash={{ .TokenHash }}';
const SLOTS = ['{{ .Token }}', '{{ .RedirectTo }}', '{{ .TokenHash }}'];

test('each template carries the three slots and no other {{', () => {
  const t = authTemplates();
  assert.deepEqual(t.map((x) => x.path), ['supabase/templates/sign-in.html', 'supabase/templates/sign-up.html']);
  for (const { path, html } of t) {
    for (const slot of SLOTS) assert.ok(html.includes(slot), `${path}: ${slot}`);
    assert.equal(SLOTS.reduce((s, slot) => s.replaceAll(slot, ''), html).includes('{{'), false, path);
  }
});

test('each button links to Auth\'s redirect with the hash in the fragment, never ConfirmationURL', () => {
  for (const { path, html } of authTemplates()) {
    const hrefs = [...html.matchAll(/<a [^>]*href="([^"]*)"/g)].map((m) => m[1]);
    assert.ok(hrefs.includes(HREF), `${path}: ${JSON.stringify(hrefs)}`);
    assert.equal(html.includes('{{ .ConfirmationURL }}'), false, path);
    assert.equal(html.includes('?token_hash'), false, path);
  }
});
