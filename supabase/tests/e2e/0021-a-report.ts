/**
 * End to end: a report, from filing to a lift (the conduct plan, Task 9), against the real migrations on the scratch database, the mail sender's own core
 * (supabase/functions/mail/core.ts) over a fake mailer and a fake Supabase Auth admin, and the real mail templates.
 *
 * The flow, each step asserted through what a player or an admin reads (acts_public, my_hidden_version, admin_reports, my_bar, the outbox and the fakes):
 *   1. A player reports a post; the admin screen lists it with the words and never the reporter.
 *   2. An admin hides it until edited: its words are null for everyone, and its author alone reads them back.
 *   3. The author edits: the post is back, and the re-review list holds the edit.
 *   4. An admin hides the edit until edited again: the author reads the edit's words, and no one else does.
 *   5. The author edits once more: the edit waits (hidden, the author told so) until an admin approves it, and then it shows.
 *   6. A second report is decided with a suspension: the gate refuses the author's account (my_bar, played_by with the barred hint), the mail sender sends the suspended mail to the
 *      author and the reporter's reportRead to the reporter (the same bytes whatever was decided), and the fake Auth admin is told to ban the login until the date.
 *   7. An admin lifts it: the bar is gone, the next mail run clears the Auth ban and sends the lifted mail.
 *   8. A post quotes the reported one, whose first versions are hidden: the quoting post is withheld until the conceal job (its own core, with the engine's real concealQuotes) has run, and then
 *      reads with the quote emptied and its id kept; an unhide shows the words again with no job run.
 *
 * Stepped over, as the files before it step over theirs: a post's edits are written with `tests.act` (the action function is an Edge Function's, and this file is about the
 * conduct functions), dated after the decision they follow. Every account and post here is this file's own, and the outbox is read for them alone, since the files before
 * leave committed rows. Run by tools/test-sql.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { psqlDb, sql, scratchSeed } from './psql-db.ts';
import { instance } from '../../functions/_shared/instance.ts';
import { runMail, type AuthAdmin, type MailDb, type MailRow } from '../../functions/mail/core.ts';
import { renderOutboxRow } from '../../functions/_shared/mail/conduct.ts';
import { runConceal, type ConcealDb, type ConcealRow } from '../../functions/conceal/core.ts';

const json = <T = Record<string, any>>(text: string): T => JSON.parse(text) as T;
const one = (query: string) => sql(query);
const ADDRESS = 'admins@example.test';

test('a report is hidden until edited, edited, hidden again, edited and approved; a suspension bars the login and mails; a lift clears it', async () => {
  const service = psqlDb();
  await service.rpc('seed_instance', { payload: scratchSeed(instance) });
  sql(`update settings set value = jsonb_set(value, '{adminAddress}', '"${ADDRESS}"') where key = 'conduct'`);
  const ids = json<Record<string, string>>(sql(`select jsonb_build_object('admin', tests.account('e2e-report-admin'), 'author', tests.account('e2e-report-author'), 'reporter', tests.account('e2e-report-reporter'))::text`));
  const { admin, author, reporter } = ids as { admin: string; author: string; reporter: string };
  sql(`insert into admins (account) values ('${admin}')`);
  const ada = one(`select tests.character('${author}', 'Report Ada')`);
  const thread = one(`select tests.thread('A report, start to finish')`);
  const post = one(`select tests.post('${ada}', '${thread}', 'Words that go too far.', now() - interval '2 hours')`);
  const asAdmin = psqlDb(admin);
  const asAuthor = psqlDb(author);
  const asReporter = psqlDb(reporter);
  const mine = new Set([admin, author, reporter]);

  const shown = () => json<{ hidden: boolean; body: string | null; any_hidden: boolean }>(sql(`select jsonb_build_object('hidden', a.hidden, 'body', a.payload ->> 'body', 'any_hidden', a.any_hidden)::text from acts_public a where a.id = '${post}'`));
  const current = () => json<{ hidden: boolean; body: string | null }>(sql(`select jsonb_build_object('hidden', a.hidden, 'body', a.current_payload ->> 'body')::text from acts_public a where a.id = '${post}'`));
  const mineHidden = async (db = asAuthor) => db.rpc<{ status: string; version: string; words?: string } | null>('my_hidden_version', { act: post });
  const reports = async () => asAdmin.rpc<{ reports: any[]; reviews: any[]; moreReports: boolean; moreReviews: boolean }>('admin_reports', {});

  // ---- 1. A player reports the post ----
  assert.deepEqual(current(), { hidden: false, body: 'Words that go too far.' });
  const first = await asReporter.rpc<number>('report_post', { version_act: post, section: 'person', note: 'Went after the person, not the mask.' });
  assert.equal((await asReporter.rpc<{ open: number; most: number }>('my_open_reports', {})).open, 1);
  let screen = await reports();
  const listed = screen.reports.find((r) => r.id === first);
  assert.equal(listed?.words, 'Words that go too far.');
  assert.equal(listed?.author, author);
  assert.equal(JSON.stringify(screen).includes(reporter), false, 'the reporter reached the admin screen');

  // ---- 2. Hidden until edited: nobody reads the words but their author ----
  await asAdmin.rpc('decide_report', { report: first, outcomes: [{ outcome: 'hideUntilEdited', note: 'Mind the person.' }] });
  assert.deepEqual(current(), { hidden: true, body: null });
  assert.equal(shown().body, null);
  assert.deepEqual(await mineHidden(), { status: 'hiddenUntilEdited', version: post, words: 'Words that go too far.' });
  assert.equal(await mineHidden(asReporter), null, 'another player read the hidden words');
  assert.equal((await reports()).reports.some((r) => r.id === first), false, 'a decided report stays listed');

  // ---- 3. The author edits: the post is back, and the re-review list holds the edit ----
  const e1 = one(`select tests.act('${ada}', 'edit', '${thread}', '{"body": "Kinder words."}', '${post}', now() + interval '1 minute')`);
  assert.deepEqual(current(), { hidden: false, body: 'Kinder words.' });
  assert.equal(await mineHidden(), null);
  screen = await reports();
  assert.deepEqual(screen.reviews.map((r) => [r.versionAct, r.words]), [[e1, 'Kinder words.']]);

  // ---- 4. Hidden until edited again, on the edit ----
  await asAdmin.rpc('decide', { account: null, version_act: e1, outcome: 'hideUntilEdited', until: null, note: 'Not yet.' });
  assert.deepEqual(current(), { hidden: true, body: null });
  assert.equal((await reports()).reviews.length, 0, 'a version hidden again is still on the re-review list');
  assert.deepEqual(await mineHidden(), { status: 'hiddenUntilEdited', version: e1, words: 'Kinder words.' });
  assert.equal(await mineHidden(asReporter), null);

  // ---- 5. The author edits again: the edit waits for an admin, and shows once approved ----
  const e2 = one(`select tests.act('${ada}', 'edit', '${thread}', '{"body": "Kindest words."}', '${post}', now() + interval '2 minutes')`);
  assert.deepEqual(current(), { hidden: true, body: null });
  assert.deepEqual(await mineHidden(), { status: 'waiting', version: e2, words: 'Kindest words.' });
  assert.equal(await mineHidden(asReporter), null);
  await asAdmin.rpc('decide', { account: null, version_act: e2, outcome: 'approve', until: null, note: '' });
  assert.deepEqual(current(), { hidden: false, body: 'Kindest words.' });
  assert.equal(await mineHidden(), null);
  assert.equal((await reports()).reviews.length, 0);

  // ---- 6. A suspension: the gate, the mail and the Auth ban ----
  const second = await asReporter.rpc<number>('report_post', { version_act: post, section: 'stop', note: null });
  const until = new Date(Date.now() + 3 * 3_600_000).toISOString();
  await asAdmin.rpc('decide_report', { report: second, outcomes: [{ outcome: 'suspend', until, note: 'A few hours to cool off.' }] });
  const bar = await asAuthor.rpc<{ kind: string; until: string }>('my_bar', {});
  assert.equal(bar.kind, 'suspended');
  assert.equal(Date.parse(bar.until), Date.parse(until));
  assert.equal(await asReporter.rpc('my_bar', {}), null, 'the report\'s filer was barred');
  const refused = (() => { try { sql(`select played_by('${ada}', '${author}')`); return null; } catch (e) { return String((e as { stderr?: string }).stderr ?? e); } })();
  assert.ok(refused !== null && /this account is suspended/u.test(refused), `a suspended account played a mask: ${refused}`);
  assert.match(refused, /HINT:\s+kayfabb\.barred/u);

  const sent: { to: string; subject: string; text: string; key: string | undefined }[] = [];
  const bans: { call: 'set' | 'clear'; account: string; until?: string | null }[] = [];
  const auth: AuthAdmin = {
    async setBan(account, until) { bans.push({ call: 'set', account, until }); },
    async clearBan(account) { bans.push({ call: 'clear', account }); },
  };
  const db: MailDb = {
    /* mail_due returns a table, which the psql adapter's one-value rpc cannot wrap, so it is read as the service role would read it. */
    async due(most) { return json<MailRow[]>(sql(`select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.mail_due(500) x`)).filter((r) => mine.has(r.account)).slice(0, most); },
    async address(account) { return sql(`select email from auth.users where id = '${account}'`) || null; },
    async attempt(a) { await service.rpc('record_mail_attempt', { outbox: a.outbox, kind: a.kind, provider_id: a.providerId ?? null, error: a.error ?? null }); },
  };
  const run = () => runMail({
    db, auth, render: renderOutboxRow, replyTo: ADDRESS, most: 50,
    mailer: { async send(m) { sent.push({ to: m.to, subject: m.subject, text: m.text, key: m.idempotencyKey }); return { id: `e2e-${sent.length}` }; } },
  });
  const emailOf = (a: string) => sql(`select email from auth.users where id = '${a}'`);
  const templates = (account: string) => json<string[]>(sql(`select coalesce(jsonb_agg(o.template order by o.id), '[]') from mail_outbox o where o.account = '${account}'`));

  const outcome = await run();
  assert.equal(outcome.status, 'done');
  assert.equal(outcome.status === 'done' ? outcome.failed + outcome.refused : -1, 0, sql(`select string_agg(a.kind || ': ' || coalesce(a.error, ''), ' | ') from mail_attempts a join mail_outbox o on o.id = a.outbox where o.account in ('${author}', '${reporter}') and a.kind <> 'sent'`));
  assert.deepEqual(templates(author), ['hiddenUntilEdited', 'hiddenUntilEdited', 'suspended']);
  assert.deepEqual(templates(reporter), ['reportRead', 'reportRead']);
  assert.equal(sent.filter((m) => m.to === emailOf(author)).length, 3, 'the author is mailed each decision about them');
  assert.equal(sent.filter((m) => m.to === emailOf(reporter)).length, 2, 'the reporter is mailed that each report was read');
  assert.ok(sent.some((m) => m.to === emailOf(author) && /suspend/iu.test(m.subject + m.text)), 'the suspended mail went to the author');
  const read = sent.filter((m) => m.to === emailOf(reporter));
  assert.equal(new Set(read.map((m) => m.subject + m.text)).size, 1, 'the reporter\'s mail is the same whatever was decided');
  assert.equal(read.some((m) => /suspend|hide|hidden|ban/iu.test(m.text)), false, 'the reporter\'s mail says what was decided');
  assert.ok(sent.every((m) => /^kayfabb-mail-\d+$/u.test(m.key ?? '')));
  assert.deepEqual(bans.map((b) => [b.call, b.account]), [['set', author]]);
  assert.equal(Date.parse(bans[0]!.until!), Date.parse(until));
  assert.equal(json<number>(sql(`select count(*) from mail_attempts a join mail_outbox o on o.id = a.outbox where a.kind = 'sent' and o.account in ('${author}', '${reporter}')`)), 5);

  // ---- 7. A lift: the bar is gone, the Auth ban is cleared, the author is told ----
  await asAdmin.rpc('decide', { account: author, version_act: null, outcome: 'lift', until: null, note: '' });
  assert.equal(await asAuthor.rpc('my_bar', {}), null);
  sql(`select played_by('${ada}', '${author}')`);
  sent.length = 0;
  bans.length = 0;
  await run();
  assert.deepEqual(bans.map((b) => [b.call, b.account]), [['clear', author]]);
  assert.deepEqual(sent.map((m) => m.to), [emailOf(author)]);
  assert.ok(/lift|over|end/iu.test(sent[0]!.subject + sent[0]!.text));
  assert.deepEqual(templates(author).at(-1), 'lifted');
  // Nothing is due again: a second run sends nothing and bans nothing.
  sent.length = 0;
  bans.length = 0;
  await run();
  assert.deepEqual([sent.length, bans.length], [0, 0]);

  // ---- 8. A quote of a hidden post: withheld until the conceal job runs, then emptied ----
  const cy = one(`select tests.character('${reporter}', 'Report Cy')`);
  const quoting = one(`select tests.post('${cy}', '${thread}', '[quote=${post}]Kindest words.[/quote] I agree, and a [b]bold[/b] ending.', now() + interval '10 minutes')`);
  const quoted = () => json<{ body: string | null; concealing: boolean }>(sql(`select jsonb_build_object('body', a.current_payload ->> 'body', 'concealing', a.concealing)::text from acts_public a where a.id = '${quoting}'`));
  // The post's offending versions (the original of step 2 and the first edit of step 4) are still hidden, so a quote of it is withheld from the moment it is written.
  assert.deepEqual(quoted(), { body: null, concealing: true }, 'a quote of a hidden post is withheld until the job has run');
  const conceal: ConcealDb = {
    /* conceal_due returns a table, which the psql adapter's one-value rpc cannot wrap, so it is read as the service role would read it. */
    async due(most) { return json<ConcealRow[]>(sql(`select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.conceal_due(500) x`)).filter((r) => r.act === quoting).slice(0, most); },
    async record(act, hidden, body) { await service.rpc('record_layer', { act, hidden: [...hidden], body }); },
  };
  assert.deepEqual(await runConceal({ db: conceal, most: 50 }), { status: 'done', due: 1, recorded: 1, stale: 0, failed: 0 });
  assert.deepEqual(quoted(), { body: `[quote=${post}][/quote] I agree, and a [b]bold[/b] ending.`, concealing: false });
  assert.equal(JSON.stringify(sql(`select to_jsonb(a)::text from acts_public a where a.id = '${quoting}'`)).includes('Kindest words'), false, 'the quoted words reached the row');
  assert.deepEqual(await runConceal({ db: conceal, most: 50 }), { status: 'done', due: 0, recorded: 0, stale: 0, failed: 0 });
  // An unhide of the original keeps the first edit's hide, so the layer made for the same set still serves; the unhide that ends the last hidden version needs no job.
  await asAdmin.rpc('decide', { account: null, version_act: post, outcome: 'unhide', until: null, note: '' });
  assert.deepEqual(quoted(), { body: `[quote=${post}][/quote] I agree, and a [b]bold[/b] ending.`, concealing: false }, 'the first edit is still hidden, so the layer made for the same set still serves');
  await asAdmin.rpc('decide', { account: null, version_act: e1, outcome: 'unhide', until: null, note: '' });
  assert.deepEqual(quoted(), { body: `[quote=${post}]Kindest words.[/quote] I agree, and a [b]bold[/b] ending.`, concealing: false }, 'an unhide shows the words with no job run');
});
