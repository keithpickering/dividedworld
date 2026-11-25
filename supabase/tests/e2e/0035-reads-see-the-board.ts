/**
 * End to end: reads see the board (docs/plans/2026-11-25-reads-see-the-board-plan.md, Task 6), across the `chatter` Edge Function's own core (supabase/functions/chatter/core.ts), `pool_read`
 * (supabase/migrations/0426_reads_see_the_board.sql), the reader (engine/system/read.ts, extras.ts) and the prompt, against the real migrations on the scratch database, with the real model adapters over a fake `fetch`.
 *
 * The scene, with invented words: Spritey starts a thread with a post that carries a poll; Bystander splats that post with Whoops! (a card Act through the act function); Ann spins the post into a thread of
 * her own with an EMPTY opener; QC-1000 posts in the spun thread (the game's own staff move), and Spritey replies to it. A round runs with QC-1000 in session. The prompt the fake model received holds the
 * spun thread's origin line, the origin post (`[origin, post #1 in "..."]`) with its words, its poll (question, options, counts) and the splat line the Whoops! card's own `seen` writes, and then the
 * empty opener. Stepped over as in 0034: the pool's picks, the staff's session and the persona's office. Reads only the scratch database tools/test-sql.mjs made; run by tools/test-sql.mjs.
 * Like 0034 it commits what it sets, under keys of its own.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { psqlDb, sql, scratchSeed } from './psql-db.ts';
import { runChatter } from '../../functions/chatter/core.ts';
import { handleAction } from '../../functions/act/core.ts';
import { instance } from '../../functions/_shared/instance.ts';
import { models } from '../../functions/_shared/models/index.ts';
import { ledgerWriter } from '../../functions/_shared/models/ledger.ts';

const tiers = { strong: 'claude-opus-5-5', light: 'claude-haiku-5-5' };
const QC = instance.system.roster.find((p) => p.key === 'quality-control')!;
const ORIGIN_BODY = 'My Plumber Platformer hack has two world one endings. Which one should ship?';
const QUESTION = 'Which ending ships?';
const OPTIONS = ['The pipe ending', 'The castle ending', 'Both, hidden'];
const ASK = 'Is an empty opener a fair way to start this?';

test('a persona in session reads a spun thread\'s origin line, the origin post with its poll and its splat line, and the empty opener', async () => {
  const db = psqlDb();
  await db.rpc('seed_instance', { payload: scratchSeed(instance) });
  sql(`update settings set value = 'true' where key = 'systemEnabled'`);
  sql(`update settings set value = value || '{"weekly": 1, "threadsWeekly": 0}'::jsonb where key = 'pool'`);
  sql(`update characters set debuted_at = coalesce(debuted_at, now() - interval '30 days') where staff = '${QC.key}'`);
  if (sql(`select office from staff_office_now where staff = '${QC.key}'`) !== 'mod') sql(`insert into staff_offices (staff, office, cause) values ('${QC.key}', 'mod', 'seed')`);
  // A slot of its own, two minutes after 0034's: a round's claim is by slot and holds for ten minutes, so the same slot would be refused as busy.
  const today = sql(`select ((now() + interval '7 minutes') at time zone 'UTC')::date::text`);
  sql(`select write_sessions('${today}'::date, '[{"staff": "${QC.key}", "start": 0, "end": 1440}]')`);

  const tag = Date.now().toString(36);
  const player = (n: string) => {
    const account = sql(`with u as (insert into auth.users (email) values ('e2e-reads-${n}-${tag}@test.invalid') returning id) insert into accounts (id) select id from u returning id`);
    const character = sql(`with c as (insert into characters (owner, name, created_at, debuted_at) values ('${account}', 'Reads ${n} ${tag}', now() - interval '2 days', now() - interval '2 days') returning id),
      h as (insert into class_history (character, class_key, started_at) select id, 'face', now() - interval '2 days' from c returning 1) select id from c`);
    return { account, character };
  };
  const spritey = player('Spritey'); const bystander = player('Bystander'); const ann = player('Ann');
  sql(`insert into wallets (account, balance) values ('${bystander.account}', 100) on conflict (account) do update set balance = 100`);
  sql(`insert into card_ledger (account, card, kind, price) values ('${bystander.account}', 'whoops', 'bought', 0)`);
  sql(`insert into boards (slug, name, description) values ('reads-${tag}', 'Reads ${tag}', 'A board of its own for reads.')`);
  const act = async (who: { account: string }, body: Record<string, unknown>) => {
    const out = await handleAction({ dbs: { player: psqlDb(who.account), service: db }, instance, body, send: async () => undefined, drain: async () => undefined, after: () => undefined });
    assert.equal(out.status, 200, `${String(body.action)}: ${JSON.stringify(out.body)}`);
    return out.body as Record<string, any>;
  };

  // ---- The origin: a post with a poll, splatted. ----
  const started = await act(spritey, { action: 'startThread', board: `reads-${tag}`, character: spritey.character, title: 'Two endings', body: ORIGIN_BODY,
    poll: { question: QUESTION, options: OPTIONS, pick: 1, secret: false, lasts: '3 days' } });
  const originPost: string = started.act.id;
  await act(bystander, { action: 'playCard', card: 'whoops', character: bystander.character, target: originPost, config: { color: 'teal' }, message: '' });

  // ---- The spin, with an empty opener, and a staff post and a reply in it. ----
  const spun = await act(ann, { action: 'spin', origin: originPost, character: ann.character, title: 'Spun endings', body: '' });
  const opener: string = spun.act?.id ?? spun.id;
  const thread = sql(`select thread from acts where id = '${opener}'`);
  assert.equal(sql(`select payload ->> 'body' from acts where id = '${opener}'`), '', 'the opener is empty');
  const review = JSON.parse(sql(`select write_staff_act('${QC.key}', 'post', '${thread}', '${opener}', '${JSON.stringify({ body: 'Noted: the endings are the whole hack.' })}')`)).id as string;
  sql(`insert into acts (character, kind, thread, target_act_id, payload, created_at) values ('${spritey.character}', 'post', '${thread}', '${review}', '${JSON.stringify({ body: ASK })}', now() + interval '1 minute')`);
  sql(`insert into pool_spends (day, staff, trigger, post_act) values ('${today}'::date - 1, '${QC.key}', 'named', '${review}') on conflict do nothing`);

  const asked: { system: string; message: string }[] = [];
  const fake = (async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (!String(url).includes('anthropic')) return new Response(JSON.stringify({ choices: [{ text: ' ok.' }], usage: { prompt_tokens: 100, completion_tokens: 4 } }), { status: 200 });
    const system = typeof body.system === 'string' ? body.system : JSON.stringify(body.system ?? '');
    asked.push({ system, message: (body.messages ?? []).map((m: { content: unknown }) => String(m.content)).join('') });
    return new Response(JSON.stringify({ model: tiers.light, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ words: 'It is fair.' }) }], usage: { input_tokens: 1200, output_tokens: 60, service_tier: 'standard' } }), { status: 200 });
  }) as unknown as typeof fetch;
  const env = (name: string) => ({ ANTHROPIC_API_KEY: 'test-key', SYSTEM_COMPLETIONS_URL: 'https://completions.test' } as Record<string, string>)[name];
  const real = models(env, ledgerWriter(db), { tiers, oldVoice: { window: 1024, count: (t: string) => t.length }, fetch: fake });

  const slot = new Date(Math.floor(Date.now() / 60_000) * 60_000 + 7 * 60_000).toISOString();
  const out = await runChatter(db, real, instance, slot);
  assert.equal(out.status, 'ok', JSON.stringify(out));
  const mine = out.turns.find((t) => t.thread === thread);
  assert.ok(mine && mine.status === 'taken', `QC-1000 took a turn in the spun thread: ${JSON.stringify(out.turns)}`);
  assert.equal(asked.length, 1, 'one model call');
  const { message } = asked[0]!;
  console.log(`---- PROMPT (message) ----\n${message}\n---- END ----`);

  const origin = `(This thread was spun just now from Reads Spritey ${tag}'s post #1 in "Two endings", written just now.)`;
  const lines = message.split('\n');
  const at = (text: string) => lines.findIndex((l) => l.includes(text));
  assert.ok(message.includes(origin), 'the origin line names the post and its thread');
  const head = at('[origin, post #1 in "Two endings"]');
  const openerAt = at(`Reads Ann ${tag} (it/its) [post #1]`);
  assert.ok(at(origin) < head && head < openerAt, 'the origin line, the origin post, then the opener');
  const originText = lines.slice(head, openerAt).join('\n');
  assert.ok(originText.includes(ORIGIN_BODY), 'the origin post\'s words');
  assert.ok(originText.includes(`[poll on this post] "${QUESTION}" (pick one)`) && OPTIONS.every((o) => originText.includes(o)) && originText.includes('No one has voted.'), `the origin post's poll: ${originText}`);
  assert.ok(originText.includes(`Reads Bystander ${tag} covered this post in a big teal splat of goop, just now.`), `the origin post's splat line: ${originText}`);
  assert.ok(lines[openerAt + 1] === '' && lines[openerAt + 2]!.includes('[post #2]'), 'the opener is empty: its empty body, then the next post');
  assert.ok(message.includes(ASK), 'the reply is read');
});
