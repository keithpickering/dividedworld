/**
 * End to end: You Were Saying? (the plan for the card that writes, Task 12), across the act function's own path (supabase/functions/act/core.ts:
 * the play, the edit, the author's clear, and the kick after each), the card-text worker (supabase/functions/write/core.ts), the real model
 * adapters over a fake `fetch` standing in for the instance's completion endpoint (the one fake the model tests and the other end-to-end days
 * use), and the real migrations (supabase/migrations/0146_card_writes.sql) on the scratch database.
 *
 * The run: a player casts the card on another's post; the kick writes the tail; the outbox holds a `card_text` event for the thread in words of
 * the play and the version alone; post_tails returns the text. The author edits: a regeneration is made for the new version, and History (the
 * post and its edits, as the client reads it) holds both tails, each beside its own version. The author's clear is saved through the action
 * and read back. On a second post a failing endpoint (a 500, retried on the request and then given up) finishes the first generation
 * `unreachable`: the play is refunded, the card is back in the caster's hand, the play reads `untaken`, and the author's own view says the
 * write is over. Last: the tokens the endpoint was asked for are the tokens each play's Act recorded, not the economy's today.
 *
 * Stepped over: the caster's wallet and hand (a purchase is another function's: card_ledger and wallets are written directly, as 0002 and
 * 0017 do), and the settle wait of a regeneration (`cardWriteSettleSeconds` is 0, as the SQL file sets it; its own waiting is that file's).
 * Every account, thread and post is this file's own and every assertion is about its ids, since the files before leave committed rows.
 * Reads only the scratch database tools/test-sql.mjs made (scratchUrl refuses any other); run by tools/test-sql.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { psqlDb, sql, scratchSeed } from './psql-db.ts';
import { handleAction } from '../../functions/act/core.ts';
import { runWrites } from '../../functions/write/core.ts';
import { instance } from '../../functions/_shared/instance.ts';
import { models } from '../../functions/_shared/models/index.ts';
import { ledgerWriter } from '../../functions/_shared/models/ledger.ts';

const json = <T = Record<string, any>>(text: string): T => JSON.parse(text) as T;
const rows = (query: string) => json<Record<string, any>[]>(sql(`select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (${query}) x`));

test('a cast is written, edited into a second tail, cleared by its author; a failing endpoint refunds a second play and returns its card', { timeout: 120_000 }, async () => {
  const service = psqlDb();
  await service.rpc('seed_instance', { payload: scratchSeed(instance) });
  sql(`update settings set value = 'true' where key = 'oldVoice'`);
  sql(`insert into settings (key, value) values ('cardWriteSettleSeconds', '0') on conflict (key) do update set value = '0'`);

  const make = (label: string, name: string) => {
    const account = sql(`with u as (insert into auth.users (email) values ('${label}@test.invalid') returning id) insert into accounts (id) select id from u returning id`);
    const character = sql(`with c as (insert into characters (owner, name, created_at, debuted_at) values ('${account}', '${name}', now() - interval '1 day', now() - interval '1 day') returning id)
      insert into class_history (character, class_key, started_at) select id, 'heel', now() - interval '1 day' from c returning character`);
    return { account, character };
  };
  const ann = make('e2e-tails-ann', 'Tails Caster');
  const bob = make('e2e-tails-bob', 'Tails Author');
  sql(`insert into wallets (account, balance) values ('${ann.account}', 500) on conflict (account) do update set balance = 500;
       insert into card_ledger (account, card, kind, price) values ('${ann.account}', 'you-were-saying', 'bought', 0), ('${ann.account}', 'you-were-saying', 'bought', 0)`);
  const wallet = () => Number(sql(`select balance from wallets where account = '${ann.account}'`));
  const held = () => Number(sql(`select card_held('${ann.account}', 'you-were-saying')`));

  // ---- The fake endpoint: every request is kept; the mode says how it answers. ----
  const asked: { max_tokens: number; prompt: string }[] = [];
  const endpoint: { mode: 'answer' | 'down'; says: string } = { mode: 'answer', says: ' and that is why the pineapple stays.' };
  const fake = (async (url: string, init?: RequestInit) => {
    assert.ok(String(url).startsWith('http://localhost:9/v1/completions'), `the card's call goes to the instance's completion endpoint: ${url}`);
    const body = JSON.parse(String(init?.body));
    asked.push({ max_tokens: body.max_tokens, prompt: body.prompt });
    if (endpoint.mode === 'down') return new Response('overloaded', { status: 500 });
    return new Response(JSON.stringify({ choices: [{ text: endpoint.says }], usage: { prompt_tokens: 40, completion_tokens: 8 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;
  const env = (name: string) => ({ SYSTEM_COMPLETIONS_URL: 'http://localhost:9' } as Record<string, string>)[name];
  const completions = models(env, ledgerWriter(service), { tiers: { strong: 'claude-opus-5-5', light: 'claude-haiku-5-5' }, fetch: fake, sleep: async () => {} });
  const tuned = { ...instance.settings, oldVoice: true };
  const ledgerBefore = Number(sql(`select coalesce(max(id), 0) from model_calls`));

  // ---- The act path as the edge wires it: the answer, then the outbox's drain and the kick, which this awaits. ----
  const afterwards: (() => Promise<void>)[] = [];
  const act = async (as: { account: string }, body: Record<string, unknown>) => {
    const out = await handleAction({
      dbs: { player: psqlDb(as.account), service }, instance, body, send: async () => undefined, drain: async () => undefined,
      after: (work) => { afterwards.push(work); },
      write: (post) => runWrites(service, completions, instance, tuned, 8, post),
    });
    while (afterwards.length) await afterwards.shift()!();
    return out;
  };

  const started = await act(bob, { action: 'startThread', board: 'general', character: bob.character, title: 'Hot take', body: 'Pineapple on pizza is' });
  assert.equal(started.status, 200, JSON.stringify(started));
  const { thread, act: opening } = started.body as { thread: { id: string }; act: { id: string } };
  const post = opening.id;

  // ---- 1. A cast: the tail is written, the thread is told, post_tails returns it. ----
  const cast = await act(ann, { action: 'playCard', card: 'you-were-saying', character: ann.character, target: post, config: { steps: 2 }, message: '' });
  assert.equal(cast.status, 200, JSON.stringify(cast));
  const play = (cast.body as { id: string }).id;
  assert.equal(wallet(), 450, 'two steps cost 2 x 25 on top of the card');
  assert.equal(held(), 1);
  const tails = () => rows(`select * from post_tails(array['${post}'::uuid])`);
  assert.deepEqual(tails().map((t) => ({ play: t.play, version: t.version, text: t.text, failed: t.failed, waiting: t.waiting })),
    [{ play, version: post, text: ' and that is why the pineapple stays.', failed: false, waiting: false }], 'post_tails returns the tail, beside the post\'s own version');
  const told = rows(`select topic, event, payload from broadcasts_due where topic = 'thread:${thread.id}' and event = 'card_text' order by id`);
  assert.deepEqual(told, [{ topic: `thread:${thread.id}`, event: 'card_text', payload: { play, version: post } }], 'the thread is told in words of the play and the version alone');
  assert.equal(sql(`select count(*) from card_writes where play = '${play}'`), '0', 'the job is done');

  // ---- 2. An edit: a new tail for the new version, and History holds both, each beside its own version. ----
  endpoint.says = ' that is the whole truth, friends.';
  const edited = await act(bob, { action: 'edit', post, character: bob.character, body: 'Pineapple on pizza is, frankly, a crime' });
  assert.equal(edited.status, 200, JSON.stringify(edited));
  const history = rows(`select id, kind, created_at from acts_public where id = '${post}' or (kind = 'edit' and target_act_id = '${post}') order by created_at`);
  assert.equal(history.length, 2, 'History is the post and its one edit');
  const [original, mended] = history.map((v) => v.id as string);
  assert.equal(original, post);
  const beside = new Map(tails().map((t) => [t.version as string, t.text as string]));
  assert.deepEqual([...beside.entries()], [[original, ' and that is why the pineapple stays.'], [mended, ' that is the whole truth, friends.']],
    'both tails are held, each beside the version it continues');
  assert.equal(asked.length, 2);
  assert.ok(asked[1]!.prompt.includes('frankly'), 'the regeneration continued the edited words');
  assert.equal(rows(`select 1 from broadcasts_due where topic = 'thread:${thread.id}' and event = 'card_text'`).length, 2, 'the second tail was announced too');

  // ---- 3. The author's clear is saved and read back; a reader's is not the author's to save. ----
  const cleared = await act(bob, { action: 'saveEffect', play, character: bob.character, state: { cleared: mended } });
  assert.equal(cleared.status, 200, JSON.stringify(cleared));
  assert.deepEqual(json(sql(`select state from effect_state where play = '${play}'`)), { cleared: mended }, 'the clear is saved against the version that was erased');
  const notAuthor = await act(ann, { action: 'saveEffect', play, character: ann.character, state: { cleared: original } });
  assert.ok(notAuthor.status >= 400 && notAuthor.status < 500, JSON.stringify(notAuthor));
  assert.deepEqual(json(sql(`select state from effect_state where play = '${play}'`)), { cleared: mended }, 'a refused save changes nothing');

  // ---- 4. A failing endpoint on a second play: refunded, the card back, the play untaken, the author's view says it is over. ----
  const second = await act(bob, { action: 'startThread', board: 'general', character: bob.character, title: 'Another take', body: 'Hot dogs are sandwiches because' });
  const post2 = (second.body as { act: { id: string } }).act.id;
  endpoint.mode = 'down';
  const walletBefore = wallet();
  const heldBefore = held();
  const failedCast = await act(ann, { action: 'playCard', card: 'you-were-saying', character: ann.character, target: post2, config: { steps: 1 }, message: '' });
  assert.equal(failedCast.status, 200, JSON.stringify(failedCast));
  const play2 = (failedCast.body as { id: string }).id;
  const downRequests = asked.slice(2);
  assert.equal(downRequests.length, 4, 'the request was tried again on itself, three times, and then given up');
  assert.equal(wallet(), walletBefore, 'the play\'s price is paid back');
  assert.equal(sql(`select amount from card_write_refunds where play = '${play2}'`), '25', 'what came back is what the play cost: one step, on a card already held');
  assert.equal(held(), heldBefore, 'the card is back in the caster\'s hand');
  assert.equal(sql(`select kind from card_ledger where act = '${play2}' and kind = 'returned'`), 'returned');
  assert.equal(sql(`select untaken from acts_public where id = '${play2}'`), 't', 'the play reads as one that did not take');
  assert.equal(sql(`select untaken from acts_public where id = '${play}'`), 'f', 'the first play took');
  assert.equal(sql(`select count(*) from card_writes where play = '${play2}'`), '0', 'no job is left to retry');
  assert.deepEqual(tails().length, 2, 'the first post\'s tails are as they were');
  const second2 = rows(`select * from post_tails(array['${post2}'::uuid])`);
  assert.deepEqual(second2.map((t) => ({ text: t.text, failed: t.failed })), [{ text: null, failed: true }], 'a failed row is kept, with no text and no predicate');
  const mine = json<Record<string, any>[]>(sql(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub": "${bob.account}", "role": "authenticated"}', false) \\g /dev/null
    select coalesce(jsonb_agg(to_jsonb(w) order by w.at), '[]') from my_posts_written_on w where w.play = '${play2}';`));
  assert.deepEqual(mine.map((w) => ({ play: w.play, failed: w.failed, opening: w.opening, over: w.over })), [{ play: play2, failed: true, opening: true, over: true }],
    'the author\'s view of the write says it failed and is over');
  const first = json<Record<string, any>[]>(sql(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub": "${bob.account}", "role": "authenticated"}', false) \\g /dev/null
    select coalesce(jsonb_agg(to_jsonb(w) order by w.at), '[]') from my_posts_written_on w where w.play = '${play}';`));
  assert.deepEqual(first.map((w) => ({ failed: w.failed, opening: w.opening, over: w.over })), [{ failed: false, opening: true, over: false }, { failed: false, opening: false, over: false }]);

  // ---- 5. What the endpoint was asked for is what each play's Act recorded. ----
  const recorded = (id: string) => Number(sql(`select payload ->> 'tokens' from acts where id = '${id}'`));
  assert.equal(recorded(play), 75, 'two steps: the base 25 and two of 25');
  assert.equal(recorded(play2), 50);
  assert.deepEqual(asked.map((r) => r.max_tokens), [recorded(play), recorded(play), ...downRequests.map(() => recorded(play2))],
    'the first play\'s two generations and the second\'s tries were each asked for their play\'s recorded length');
  // Every call landed in the ledger against its play, the failures too.
  assert.deepEqual(sql(`select string_agg(play::text, ',' order by id) from model_calls where id > ${ledgerBefore} and duty = 'cardText'`).split(','), [play, play, play2], 'one ledger row for each call (two answered, one given up), the retries counted on the call');
  assert.equal(sql(`select retries from model_calls where id > ${ledgerBefore} and duty = 'cardText' and outcome = 'failed'`), '3');
});
