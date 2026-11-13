/**
 * End to end: a hidden post's words reach no non-author at any depth of quoting ("A quote past the cap is cut, never text", docs/plans/2026-11-13-quote-cut-plan.md; #567), against
 * the real migrations on the scratch database and the conceal job's own core (supabase/functions/conceal/core.ts) with the engine's real concealQuotes.
 *
 * An admin hides a post. Then, for each depth, a post quotes it with the quote nested that deep (every depth is written from the parser's MAX_DEPTH, never as a number, so the file follows
 * the cap): `depth` real quotes of a visible post around the quote of the hidden one, and the shape where the first MAX_DEPTH levels are [b] and the quote of the hidden post is the next tag.
 * The conceal job runs. A non-author then reads every response that carries a post's words as whole JSON text, and none holds the hidden words: acts_public (both payload columns), the
 * rows post_search keeps and search_posts returns, record_page and profile_page (which return acts_public's rows), play_moment (a card played on the quoting post), and thread_page. Each reader is also shown to carry the
 * quoting author's own words, so an empty response cannot pass. The hidden post's author
 * still reads their own words (my_hidden_version), and the quoting post's Act still holds the body as its author wrote it.
 *
 * Posts are written with `tests.post`, which does not apply the instance's postMaxLength (20,000 characters in Divided World, instances/divided-world/settings.ts); a pyramid 200 deep is about
 * 10,500 characters, so every depth fits the limit a player is held to. Run by tools/test-sql.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { psqlDb, sql, scratchSeed } from './psql-db.ts';
import { instance } from '../../functions/_shared/instance.ts';
import { MAX_DEPTH } from '../../../engine/bbcode/parse.ts';
import { runConceal, type ConcealDb, type ConcealRow } from '../../functions/conceal/core.ts';

const json = <T = Record<string, any>>(text: string): T => JSON.parse(text) as T;
const one = (query: string, vars: Record<string, string> = {}) => sql(query, vars);
/* Both marker words end in q: post_search keeps stems (a final s or e is cut), so a word the stemmer leaves alone is the same text in the tsvector and in the checks. */
const WORDS = 'zqxjkvdeepwordsq';
/** The quoting author's own words, after every closer: a reader that carries the post's words must show this one, so an empty response cannot pass for a clean one. */
const OWN = 'zqxcyownvoiceq';
const HIDDEN_ORIGINAL = `The post that goes too far, ${WORDS}.`;

interface Shape { readonly label: string; readonly body: (hidden: string, shown: string) => string }
const pyramid = (around: number, label: string): Shape => ({
  label,
  body: (hidden, shown) => `${`[quote=${shown}]`.repeat(around)}[quote=${hidden}]${WORDS}[/quote]${'[/quote]'.repeat(around)} I answer that, ${OWN}.`,
});
const SHAPES: Shape[] = [
  pyramid(0, 'depth 1'),
  pyramid(MAX_DEPTH - 1, 'depth MAX_DEPTH'),
  pyramid(MAX_DEPTH, 'depth MAX_DEPTH + 1'),
  pyramid(MAX_DEPTH + 7, 'depth MAX_DEPTH + 8'),
  pyramid(199, 'depth 200'),
  { label: 'MAX_DEPTH levels of [b], then the quote', body: (hidden) => `${'[b]'.repeat(MAX_DEPTH)}[quote=${hidden}]${WORDS}[/quote]${'[/b]'.repeat(MAX_DEPTH)} I answer that, ${OWN}.` },
];

test('a hidden post\'s words are in no response a non-author reads, at any depth of quoting', async () => {
  const service = psqlDb();
  await service.rpc('seed_instance', { payload: scratchSeed(instance) });
  const ids = json<Record<string, string>>(one(`select jsonb_build_object('admin', tests.account('e2e-qc-admin'), 'author', tests.account('e2e-qc-author'), 'quoter', tests.account('e2e-qc-quoter'), 'reader', tests.account('e2e-qc-reader'))::text`));
  const { admin, author, quoter, reader } = ids as { admin: string; author: string; quoter: string; reader: string };
  sql(`insert into admins (account) values ('${admin}')`);
  const ada = one(`select tests.character('${author}', 'Quote Cap Ada')`);
  const cy = one(`select tests.character('${quoter}', 'Quote Cap Cy')`);
  const rae = one(`select tests.character('${reader}', 'Quote Cap Rae')`);
  // An open board of its own choosing: the files before this one may have merged General away (0021-a-season-of-fangame.ts), where tests.thread would write.
  const thread = one(`insert into threads (board, title) select b.id, 'A quote past the cap' from boards_now b where b.merged_into is null and not b.closed and not b.is_system order by b.slug limit 1 returning id`);
  const opener = one(`select tests.post('${rae}', '${thread}', 'A visible post.', now() - interval '3 hours')`);
  const post = one(`select tests.post('${ada}', '${thread}', :'body', now() - interval '2 hours')`, { body: HIDDEN_ORIGINAL });
  const asAdmin = psqlDb(admin);
  const asAuthor = psqlDb(author);
  const asReader = psqlDb(reader);
  await asAdmin.rpc('decide', { account: null, version_act: post, outcome: 'hideUntilEdited', until: null, note: 'Mind the person.' });

  // one card kind to play on each quoting post, whose moment (play_moment) carries the post's words
  sql(`insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts) values ('qchook', 'Qc Hook', 'salty', 'uncommon', 'cast', null, '{post}', null) on conflict (key) do nothing`);

  // the quoting posts, one per shape, and a play on each
  const quoting: { shape: Shape; act: string; play: string }[] = [];
  for (const [i, shape] of SHAPES.entries()) {
    const act = one(`select tests.post('${cy}', '${thread}', :'body', now() - interval '${100 - i} minutes')`, { body: shape.body(post, opener) });
    sql(`insert into card_ledger (account, card, kind, price) values ('${author}', 'qchook', 'bought', 0)`);
    const play = one(`select (play_card('${author}', 'qchook', '${ada}', '${act}', '{}', 0, '') ->> 'id')`);
    assert.match(play, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, `play_card gave no Act for ${shape.label}`);
    quoting.push({ shape, act, play });
  }
  const ours = new Set(quoting.map((q) => q.act));

  // the conceal job, with the engine's real concealQuotes, over these Acts
  const conceal: ConcealDb = {
    /* conceal_due returns a table, which the psql adapter's one-value rpc cannot wrap, so it is read as the service role would read it. */
    async due(most) { return json<ConcealRow[]>(sql(`select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.conceal_due(500) x`)).filter((r) => ours.has(r.act)).slice(0, most); },
    async record(act, hidden, body) { await service.rpc('record_layer', { act, hidden: [...hidden], body }); },
  };
  const outcome = await runConceal({ db: conceal, most: 50 });
  assert.deepEqual([outcome.status, outcome.due, outcome.recorded, outcome.failed], ['done', SHAPES.length, SHAPES.length, 0]);

  // every response that carries a post's words, as the non-author reads it, whole, per quoting post. Each reader that should carry a quoting post's words is also asked for the quoting author's
  // own words (OWN, written after every closer), so a reader that answered with nothing, or with another post, cannot pass for a clean one.
  const publicRow = (act: string) => sql(`select to_jsonb(a)::text from acts_public a where a.id = '${act}'`);
  // search_posts takes a jsonb cursor, which the psql adapter would pass as a JSON null and the function refuses, so it is called as the reader would, with SQL's own null
  const searchFor = (q: string): { id: string; text: string }[] => {
    const found = json<{ results?: Record<string, any>[] } | Record<string, any>[]>(sql(`set role authenticated;
      select set_config('request.jwt.claims', :'claims', false) \\g /dev/null
      select public.search_posts(q => :'q', author => null, board => null, from_at => null, to_at => null, titles_only => false, sort => 'newest', after => null, per_page => 50)::text;`, { claims: JSON.stringify({ sub: reader, role: 'authenticated' }), q }));
    const rows = Array.isArray(found) ? found : (found.results ?? []);
    return rows.map((r) => ({ id: String(r.act ?? r.id ?? ''), text: JSON.stringify(r) }));
  };
  const byOwn = searchFor(OWN);
  const byHidden = searchFor(WORDS);
  const page = JSON.stringify(await asReader.rpc('thread_page', { in_thread: thread, in_page: 1, in_seq: null, per_page: 100, effect_cards: [] }));
  const leaks: string[] = [];
  const read = (what: string, text: string, label: string) => {
    if (!text.includes(OWN)) leaks.push(`${what} (${label}) does not carry the post: it has no ${OWN}`);
    if (text.includes(WORDS)) leaks.push(`${what} (${label})`);
  };
  for (const q of quoting) {
    const label = q.shape.label;
    read('acts_public', publicRow(q.act), label);
    read('post_search', sql(`select coalesce(p.words::text, '') from post_search p where p.act = '${q.act}'`), label);
    read('record_page', JSON.stringify(await asReader.rpc('record_page', { in_character: cy, in_kind: 'post', in_page: 1 })), label);
    const found = byOwn.find((r) => r.id === q.act);
    read('search_posts', found?.text ?? '', label);
    if (byHidden.some((r) => r.id === q.act)) leaks.push(`search_posts for the hidden words finds the quoting post (${label})`);
  }
  // play_moment: whether it carries the quoting post's own words at all is read once, so a clean answer from it is known to be a reading and not an empty response
  const moments = await Promise.all(quoting.map(async (q) => JSON.stringify(await asReader.rpc('play_moment', { play: q.play }))));
  for (const [i, text] of moments.entries()) if (text.includes(WORDS)) leaks.push(`play_moment (${(quoting[i] as { shape: Shape }).shape.label})`);
  assert.ok(moments.every((m) => m.includes(OWN)), `play_moment carries no quoting post's words, so it is no reader of them: ${moments[0]}`);
  // the pages that carry acts_public's rows hold none of the words at all, and hold each quoting post
  if (page.includes(WORDS)) leaks.push('thread_page');
  if (!quoting.every((q) => page.includes(q.act))) leaks.push('thread_page does not carry every quoting post, so it is no reading of them');
  const profile = JSON.stringify(await asReader.rpc('profile_page', { in_character: cy }));
  if (profile.includes(WORDS)) leaks.push('profile_page');
  assert.deepEqual(leaks, [], `the hidden words reached a non-author through: ${leaks.join('; ')}`);

  // the hidden post's author still reads their own words, and no one else does
  assert.deepEqual(await asAuthor.rpc('my_hidden_version', { act: post }), { status: 'hiddenUntilEdited', version: post, words: HIDDEN_ORIGINAL });
  assert.equal(await asReader.rpc('my_hidden_version', { act: post }), null);
  // the quoting posts' Acts are as their authors wrote them: the layer is over the words, never in place of them
  for (const q of quoting) assert.equal(sql(`select a.payload ->> 'body' from acts a where a.id = '${q.act}'`, {}), q.shape.body(post, opener));
});
