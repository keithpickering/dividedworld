import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signIn, signUp } from './auth.ts';
import { renderHtml, renderText } from './render.ts';
import type { MailTheme } from './types.ts';

const theme: MailTheme = {
  name: 'Fixture Forum',
  site: 'https://example.test',
  assets: { smoke: 'https://example.test/s.jpg', cutPanel: 'https://example.test/p.png', cutButton: 'https://example.test/b.png', coin: 'https://example.test/c.png' },
  fonts: [],
  stacks: { display: 'Impact, sans-serif', body: 'Arial, sans-serif' },
  colors: { ground: '#000010', field: '#101020', text: '#e0e0e0', text2: '#c0c0c0', hi: '#ffffff', pale: '#ddddff', neon: '#00ff88', neonText: '#00ee77', violet: '#9966ff', ink: '#001008' },
};
const LINK = '{{ .RedirectTo }}#token_hash={{ .TokenHash }}';
const parts = { code: '{{ .Token }}', link: LINK };
const slots = ['{{ .Token }}', '{{ .RedirectTo }}', '{{ .TokenHash }}'];

test('sign-in words', () => {
  const m = signIn(theme, parts);
  assert.equal(m.subject, 'Your Fixture Forum sign-in code');
  assert.equal(m.preheader, 'Your code is {{ .Token }}.');
  assert.deepEqual(m.blocks, [
    { type: 'heading', text: 'Sign in to Fixture Forum' },
    { type: 'paragraph', text: 'Type this code where you asked for it, or use the button: it opens Fixture Forum, where one more press signs you in.' },
    { type: 'code', label: 'Your code', code: '{{ .Token }}' },
    { type: 'button', label: 'Sign in', href: LINK },
    { type: 'note', text: 'If you did not ask to sign in, you can ignore this email: nobody can sign in without the code or the link.' },
  ]);
});

test('sign-up words', () => {
  const m = signUp(theme, parts);
  assert.equal(m.subject, 'Your Fixture Forum sign-up code');
  assert.equal(m.preheader, 'Your code is {{ .Token }}.');
  assert.deepEqual(m.blocks, [
    { type: 'heading', text: 'Finish signing up for Fixture Forum' },
    { type: 'paragraph', text: 'Type this code where you asked for it, or use the button: it opens Fixture Forum, where one more press finishes signing you up.' },
    { type: 'code', label: 'Your code', code: '{{ .Token }}' },
    { type: 'button', label: 'Finish signing up', href: LINK },
    { type: 'note', text: 'If you did not ask to sign up, you can ignore this email: nothing is made without the code or the link.' },
  ]);
});

test('the name slot takes the theme name', () => {
  const other = { ...theme, name: 'Other Place' };
  assert.match(JSON.stringify(signIn(other, parts)), /Sign in to Other Place/);
  assert.match(JSON.stringify(signUp(other, parts)), /Finish signing up for Other Place/);
  assert.doesNotMatch(JSON.stringify(signUp(other, parts)), /Fixture/);
});

test('a code of {{ .Token }} survives rendering unchanged', () => {
  for (const m of [signIn(theme, parts), signUp(theme, parts)]) {
    const html = renderHtml(theme, m, { slots });
    assert.ok(html.includes('{{ .Token }}'));
    assert.ok(html.includes(`href="${LINK}"`));
    assert.ok(renderText(m).includes('{{ .Token }}'));
  }
});
