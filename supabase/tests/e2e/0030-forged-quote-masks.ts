/**
 * End to end: a quote of a hidden post's exact words is forged for every caller, whoever asks ("Forged quotes", docs/plans/2026-11-20-forged-quotes-plan.md, Task 7 and
 * "The masks"), against the real migrations on the scratch database and the Edge Function's own action core (supabase/functions/act/core.ts).
 *
 * An admin hides a post until it is edited. Its words are then quoted exactly, in a draft and in a post:
 *   1. quote_check, as a non-author and as the hidden post's own author (a different mask of the same account), and as a reader, all answer the same list: the post.
 *   2. The non-author's post and the author's second mask's post, both written through the action with the quote button's `quote`, carry the verdict as their payload's `forged`,
 *      and no target: the trigger drops a doctored quote's target, so the post quotes nothing.
 *   3. A third account reads both posts as the public projection (acts_public) and sees the same shape: the same `forged`, a null target, and the same counterfeit body.
 *
 * Only public facts are read here: the answer to a quote of a hidden post never depends on who asks or who owns a character, and nothing in this file reads an owner
 * to decide anything. Run by tools/test-sql.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { psqlDb, sql, scratchSeed } from './psql-db.ts';
import { runAction } from '../../functions/act/core.ts';
import { instance } from '../../functions/_shared/instance.ts';

const json = <T = Record<string, any>>(text: string): T => JSON.parse(text) as T;
/** The hidden post's words, with no bbcode of their own, so a quote of them is exact. */
const WORDS = 'The words hidden here, zqxjkvdeepwordsq.';
/** The quoting mask's own words, written after the closer. */
const OWN = 'zqxcyownvoiceq';
const quoteOf = (post: string) => `[quote=${post}]${WORDS}[/quote] Counterfeit, ${OWN}.`;

/** An Act as a reader who is not its author sees it: the public projection, as its own JSON. */
const projection = (reader: string, act: string) => json<Record<string, any>>(sql(`set role authenticated;
  select set_config('request.jwt.claims', :'claims', false) \\g /dev/null
  select to_jsonb(a)::text from acts_public a where a.id = :'act';`, { claims: JSON.stringify({ sub: reader, role: 'authenticated' }), act }));

test('a quote of a hidden post\'s exact words is forged for a non-author and for its own author alike, and the two written posts read alike', async () => {
  const service = psqlDb();
  await service.rpc('seed_instance', { payload: scratchSeed(instance) });
  const ids = json<Record<string, string>>(sql(`select jsonb_build_object('admin', tests.account('e2e-forged-admin'), 'author', tests.account('e2e-forged-author'), 'quoter', tests.account('e2e-forged-quoter'), 'reader', tests.account('e2e-forged-reader'))::text`));
  const { admin, author, quoter, reader } = ids as { admin: string; author: string; quoter: string; reader: string };
  sql(`insert into admins (account) values ('${admin}')`);
  const ada = sql(`select tests.character('${author}', 'Forged Ada')`);
  // The author's second mask: a different character of the same account, which posts the quote of its own post.
  const ada2 = sql(`select tests.character('${author}', 'Forged Ada Two')`);
  const cy = sql(`select tests.character('${quoter}', 'Forged Cy')`);
  // An open board of its own choosing, as the files before this one choose theirs (General may be merged away by an earlier file).
  const thread = sql(`insert into threads (board, title) select b.id, 'Forged quotes, behind a mask' from boards_now b where b.merged_into is null and not b.closed and not b.is_system order by b.slug limit 1 returning id`);
  const hidden = sql(`select tests.post('${ada}', '${thread}', :'body', now() - interval '2 hours')`, { body: WORDS });

  const body = quoteOf(hidden);
  // Before the hide, the very same quote is honest: the post is forged because it is hidden, and for no other reason.
  assert.deepEqual(await psqlDb(quoter).rpc<string[]>('quote_check', { body }), [], 'a quote of the words of a post that is not hidden is not forged');

  // The hide comes after the post is written, and before any quote of its words: a quote written now is judged against a version an admin has hidden.
  await psqlDb(admin).rpc('decide', { account: null, version_act: hidden, outcome: 'hideUntilEdited', until: null, note: 'Hidden for the quote.' });

  const asQuoter = psqlDb(quoter);
  const asAuthor = psqlDb(author);
  const asReader = psqlDb(reader);

  // The composer's preview: the same answer to a non-author, to the hidden post's own author and to a reader, since it reads nothing about the caller.
  const checkedByQuoter = await asQuoter.rpc<string[]>('quote_check', { body });
  const checkedByAuthor = await asAuthor.rpc<string[]>('quote_check', { body });
  const checkedByReader = await asReader.rpc<string[]>('quote_check', { body });
  assert.deepEqual(checkedByQuoter, [hidden], 'a non-author\'s preview of an exact quote of the hidden words is forged');
  assert.deepEqual(checkedByAuthor, checkedByQuoter, 'the author\'s preview equals the non-author\'s');
  assert.deepEqual(checkedByReader, checkedByQuoter, 'a reader\'s preview equals the non-author\'s');

  // The posts themselves, through the action a player sends: the non-author's, then the author's second mask's. The quote button names the quoted post as `quote`.
  const byQuoter = await runAction({ player: asQuoter, service }, instance, { action: 'post', thread, character: cy, body, quote: hidden });
  assert.equal(byQuoter.status, 200, JSON.stringify(byQuoter));
  const byAuthor = await runAction({ player: asAuthor, service }, instance, { action: 'post', thread, character: ada2, body, quote: hidden });
  assert.equal(byAuthor.status, 200, JSON.stringify(byAuthor));
  const quoterAct = (byQuoter.body as { id: string }).id;
  const authorAct = (byAuthor.body as { id: string }).id;

  // The two answers are equal once more, now that both posts are written: the verdict in each Act is the answer the preview gave.
  const seenByQuoter = projection(reader, quoterAct);
  const seenByAuthor = projection(reader, authorAct);
  assert.deepEqual(seenByQuoter.payload?.forged, [hidden], 'the non-author\'s post carries the verdict: the hidden post is forged');
  assert.deepEqual(seenByAuthor.payload?.forged, seenByQuoter.payload?.forged, 'the author\'s second mask\'s post carries the same verdict');
  // A doctored quote quotes no post: the trigger drops the target, so both posts have none.
  assert.equal(seenByQuoter.target_act_id, null, 'the non-author\'s post has no target');
  assert.equal(seenByAuthor.target_act_id, null, 'the author\'s post has no target');
  // The projections are equal but for what must differ between two posts: their own id, the mask that wrote each, and when each was written (created_at, seq).
  const alike = (p: Record<string, any>) => { const { id, character, created_at, seq, ...rest } = p; return rest; };
  assert.deepEqual(alike(seenByAuthor), alike(seenByQuoter), 'the two projections are equal but for id, character, created_at and seq');
  assert.equal(seenByQuoter.payload?.body, body, 'the non-author\'s counterfeit body is the words as written');
  assert.equal(seenByAuthor.payload?.body, seenByQuoter.payload?.body, 'the two counterfeit bodies are the same');
  assert.equal(seenByAuthor.current_payload?.body, seenByQuoter.current_payload?.body, 'the two current bodies are the same');
  assert.equal(seenByQuoter.kind, 'post');
  assert.equal(seenByAuthor.kind, 'post');
});
