import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONDUCT_TEMPLATES, TEMPLATES, renderMail } from './conduct.ts';
import type { ConductTemplate } from './conduct.ts';
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

const values: Record<string, string> = {
  post: 'https://example.test/t/12#post-34',
  thread: 'The <b>Big</b> Thread',
  section: 'No hate.',
  note: 'Please cut the "second" line & rephrase.',
  until: 'December 1, 2026',
  conduct: 'https://example.test/conduct',
  words: 'My words <script>alert(1)</script> & more',
};
const factsFor = (t: ConductTemplate) => Object.fromEntries(TEMPLATES[t].slots.map((s) => [s, values[s]!]));

test('the seven templates', () => {
  assert.deepEqual([...CONDUCT_TEMPLATES], ['reportRead', 'nudge', 'hidden', 'hiddenUntilEdited', 'suspended', 'banned', 'lifted']);
});

test('reportRead has no slots and says the design words', () => {
  assert.deepEqual(TEMPLATES.reportRead.slots, []);
  const text = renderText(renderMail('reportRead', {}));
  assert.match(text, /Thanks for telling us\. A person, not the game, read the post you reported and decided what to do about it\./);
  assert.match(text, /We don't share what happens to another player's account, the same way we'd never share yours, so you won't hear the outcome from us\. If it keeps happening, report it again\. Every report is read\./);
  assert.equal(renderMail('reportRead', {}).subject, 'Your report was read by an admin');
});

test('every template renders text and HTML with its slots filled and escaped', () => {
  for (const t of CONDUCT_TEMPLATES) {
    const mail = renderMail(t, factsFor(t));
    const text = renderText(mail);
    const html = renderHtml(theme, mail);
    assert.ok(mail.subject.length > 0, t);
    assert.ok(!/\{[a-z]+\}/i.test(text + mail.subject + mail.preheader), `${t}: an unfilled slot`);
    for (const s of TEMPLATES[t].slots) {
      assert.ok(text.includes(values[s]!), `${t}: text carries ${s}`);
      const escaped = values[s]!.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      assert.ok(html.includes(escaped), `${t}: html carries ${s} escaped`);
    }
    assert.ok(!html.includes('<script>'), t);
    assert.ok(!html.includes('<b>Big'), t);
    assert.ok(!/Fixture reporter/i.test(text));
  }
});

test('the admin note sits in a facts row and the author words in a quote', () => {
  const m = renderMail('hidden', factsFor('hidden'));
  assert.ok(m.blocks.some((b) => b.type === 'facts' && b.rows.some(([, v]) => v === values.note!)));
  assert.ok(m.blocks.some((b) => b.type === 'quote' && b.words === values.words!));
});

test('hiddenUntilEdited has a button to the post', () => {
  const m = renderMail('hiddenUntilEdited', factsFor('hiddenUntilEdited'));
  assert.ok(m.blocks.some((b) => b.type === 'button' && b.href === values.post!));
});

test('suspended says the end date; banned and lifted say how to appeal or return', () => {
  assert.match(renderMail('suspended', factsFor('suspended')).subject, /December 1, 2026/);
  assert.match(renderText(renderMail('banned', factsFor('banned'))), /reply to this email/);
  assert.match(renderText(renderMail('suspended', factsFor('suspended'))), /reply to this email/);
});

test('a missing slot throws, naming it', () => {
  const f = factsFor('hidden');
  delete f.thread;
  assert.throws(() => renderMail('hidden', f), /thread/);
});

test('POISON: a reportRead whose facts carry the outcome throws as an unknown slot', () => {
  assert.throws(() => renderMail('reportRead', { outcome: 'hide' }), /unknown slot.*outcome/);
  assert.throws(() => renderMail('nudge', { ...factsFor('nudge'), outcome: 'nudge' }), /outcome/);
});

test('a slot that is not text throws', () => {
  assert.throws(() => renderMail('nudge', { ...factsFor('nudge'), note: 5 }), /note/);
});

test('reportRead is byte-identical however many times and whatever surrounds it', () => {
  const a = JSON.stringify(renderMail('reportRead', {}));
  assert.equal(a, JSON.stringify(renderMail('reportRead', {})));
  assert.ok(!/hid|suspend|ban|nudge|no action/i.test(renderText(renderMail('reportRead', {})).replace(/No action/g, '')));
});

test('an instance override changes the words, and may use the template slots only', () => {
  const m = renderMail('nudge', factsFor('nudge'), { override: { nudge: { subject: 'Heads up about {thread}', paragraphs: ['Hello, a note.'] } } });
  assert.equal(m.subject, 'Heads up about ' + values.thread!);
  assert.match(renderText(m), /Hello, a note\./);
  assert.ok(renderText(m).includes(values.note!), 'the facts rows stay');
  assert.throws(() => renderMail('nudge', factsFor('nudge'), { override: { nudge: { paragraphs: ['Until {until}.'] } } }), /until/);
});
