import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authTemplates } from './auth.ts';

test('each template carries the two slots and no other {{', () => {
  const t = authTemplates();
  assert.deepEqual(t.map((x) => x.path), ['supabase/templates/sign-in.html', 'supabase/templates/sign-up.html']);
  for (const { path, html } of t) {
    assert.ok(html.includes('{{ .Token }}'), path);
    assert.ok(html.includes('{{ .ConfirmationURL }}'), path);
    assert.equal(html.replaceAll('{{ .Token }}', '').replaceAll('{{ .ConfirmationURL }}', '').includes('{{'), false, path);
  }
});
