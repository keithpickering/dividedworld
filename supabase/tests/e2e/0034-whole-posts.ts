/**
 * End to end: whole posts (docs/plans/2026-11-23-whole-posts-plan.md, Task 8; #1044), across the `chatter` Edge Function's own core (supabase/functions/chatter/core.ts), `pool_read` and `pool_chars_today`
 * (supabase/migrations/0421_whole_posts.sql), the reader (engine/system/read.ts) and the prompt (engine/system/chatter.ts), against the real migrations on the scratch database, with the real model adapters over a fake `fetch`.
 *
 * The scene is the one the design found on dw.gripe (section 0), with invented words: Spritey opens a thread with a post longer than the old 280-character excerpt; QC-1000 reviews it (post #3, after a
 * player's post #2); Spritey answers with a long reply that opens with a quote of QC-1000's whole post and then asks two questions. A round runs with QC-1000 in session. The prompt the fake model received
 * holds the opener whole, the quote as the marker `[quoting your post #3]` followed by both questions, and no "…" from the game; and the day's characters charged are the prompt's length.
 *
 * Stepped over: the pool's picks (`weekly` is 1 and no thread starts, so a pick is rare, and any it spends is counted among the prompts sent below), the staff's session (written by the superuser for the whole day, as 0033 writes one), and
 * the persona's office (hired by the office log, as 0015 hires its Mod Bot). Reads only the scratch database tools/test-sql.mjs made; run by tools/test-sql.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { psqlDb, sql, scratchSeed } from './psql-db.ts';
import { runChatter } from '../../functions/chatter/core.ts';
import { instance } from '../../functions/_shared/instance.ts';
import { models } from '../../functions/_shared/models/index.ts';
import { ledgerWriter } from '../../functions/_shared/models/ledger.ts';

const tiers = { strong: 'claude-opus-5-5', light: 'claude-haiku-5-5' };
const QC = instance.system.roster.find((p) => p.key === 'quality-control')!;

const OPENER = 'Welcome to my new Plumber Platformer hack, a love letter to the games that raised me. I spent three years on the level design, and every pipe and ledge has a reason to be where it is. '
  + 'World one is playable today. We need to talk about what makes a hack worth finishing, so give me honest grades.';
const QC_REVIEW = 'Review of the Plumber Platformer hack, world one. Level design: the pipes are placed with intent and the ledges teach the jump before they test it, which is the best thing a hack can do. '
  + 'Physics: the rebuilt engine is solid, though the slope friction in the third stage feels slick. Sound: the soundtrack is cohesive and never tiring. Presentation: the map screen is clear. '
  + 'Difficulty: the second half of world one spikes sharply, and a player who reaches the castle has been asked to master four new ideas in ten minutes. Grade: B-plus, with a clear path to an A. '
  + 'I will revisit this review after the second world ships, and I will hold the hack to the standard it set for itself here, no more and no less than that.';
const Q1 = 'Is the slope friction in stage three a bug, or did you mean it?';
const Q2 = 'And will the second world ease the difficulty spike before the castle?';

test('a persona in session reads the whole opener, its own quoted post as a marker and both questions, with no ellipsis from the game, and the day is charged the prompt\'s length', async () => {
  const db = psqlDb();
  await db.rpc('seed_instance', { payload: scratchSeed(instance) });
  sql(`update settings set value = 'true' where key = 'systemEnabled'`);
  sql(`update settings set value = value || '{"weekly": 1, "threadsWeekly": 0}'::jsonb where key = 'pool'`);

  // ---- QC-1000 is a posting persona with a session all day. ----
  sql(`update characters set debuted_at = coalesce(debuted_at, now() - interval '30 days') where staff = '${QC.key}'`);
  if (sql(`select office from staff_office_now where staff = '${QC.key}'`) !== 'mod') sql(`insert into staff_offices (staff, office, cause) values ('${QC.key}', 'mod', 'seed')`);
  const today = sql(`select ((now() + interval '5 minutes') at time zone 'UTC')::date::text`);
  sql(`select write_sessions('${today}'::date, '[{"staff": "${QC.key}", "start": 0, "end": 1440}]')`);

  // ---- The thread, as on dw.gripe: Spritey's opener (#1), another player (#2), QC-1000's review (#3), Spritey's long reply (#4). ----
  const tag = Date.now().toString(36);
  const board = sql(`insert into boards (slug, name, description) values ('whole-${tag}', 'Whole ${tag}', 'A board of its own for whole posts.') returning id`);
  const thread = sql(`insert into threads (board, title) values ('${board}', 'My Plumber Platformer hack') returning id`);
  const player = (n: string) => {
    const account = sql(`with u as (insert into auth.users (email) values ('e2e-whole-${n}-${tag}@test.invalid') returning id) insert into accounts (id) select id from u returning id`);
    return sql(`with c as (insert into characters (owner, name, created_at, debuted_at) values ('${account}', 'Whole ${n} ${tag}', now() - interval '2 days', now() - interval '2 days') returning id),
      h as (insert into class_history (character, class_key, started_at) select id, 'face', now() - interval '2 days' from c returning 1) select id from c`);
  };
  const spritey = player('Spritey');
  const bystander = player('Bystander');
  const at = (minutesAgo: number) => `now() - interval '${minutesAgo} minutes'`;
  const post = (character: string, body: string, minutesAgo: number, target: string | null = null) =>
    sql(`insert into acts (character, kind, thread, target_act_id, payload, created_at) values ('${character}', 'post', '${thread}', ${target ? `'${target}'` : 'null'}, '${JSON.stringify({ body }).replace(/'/g, "''")}', ${at(minutesAgo)}) returning id`);
  const opener = post(spritey, OPENER, 300);
  post(bystander, 'Congratulations on the release, I am downloading it now.', 240, opener);
  // A staff character posts only through the game's own move, which is dated now (an Act is never edited, so never back-dated); the reply after it is dated a minute ahead and the round's slot five.
  const review = JSON.parse(sql(`select write_staff_act('${QC.key}', 'post', '${thread}', '${opener}', '${JSON.stringify({ body: QC_REVIEW })}')`)).id as string;
  post(spritey, `[quote=${review}]${QC_REVIEW}[/quote]\n\n${Q1} ${Q2}`, -1, review);
  assert.equal(sql(`select seq from acts where id = '${review}'`), '3', 'QC-1000\'s review is post #3');
  assert.ok(OPENER.length > 280 && OPENER.length < 400, `the opener is longer than the old excerpt: ${OPENER.length}`);
  assert.ok(`[quote=${review}]${QC_REVIEW}[/quote]\n\n${Q1} ${Q2}`.length > 700, 'the reply is long, mostly a quote');

  // ---- The fake model keeps every prompt it receives. ----
  const asked: { system: string; message: string }[] = [];
  const fake = (async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (!String(url).includes('anthropic')) return new Response(JSON.stringify({ choices: [{ text: ' ok.' }], usage: { prompt_tokens: 100, completion_tokens: 4 } }), { status: 200 });
    const system = typeof body.system === 'string' ? body.system : JSON.stringify(body.system ?? '');
    asked.push({ system, message: String(body.messages?.[0]?.content ?? '') });
    const reply = { words: 'The slope is meant. The second world eases the spike.' };
    return new Response(JSON.stringify({ model: tiers.light, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(reply) }], usage: { input_tokens: 1200, output_tokens: 60, service_tier: 'standard' } }), { status: 200 });
  }) as unknown as typeof fetch;
  const env = (name: string) => ({ ANTHROPIC_API_KEY: 'test-key', SYSTEM_COMPLETIONS_URL: 'https://completions.test' } as Record<string, string>)[name];
  const real = models(env, ledgerWriter(db), { tiers, oldVoice: { window: 1024, count: (t: string) => t.length }, fetch: fake });

  // ---- A round runs. ----
  const chars = () => Number(sql(`select pool_chars_today('${today}'::date)`));
  const before = chars();
  const slot = new Date(Math.floor(Date.now() / 60_000) * 60_000 + 5 * 60_000).toISOString();
  const out = await runChatter(db, real, instance, slot);
  assert.equal(out.status, 'ok', JSON.stringify(out));
  assert.equal(out.day, today);
  const mine = out.turns.find((t) => t.thread === thread);
  assert.ok(mine && mine.status === 'taken', `QC-1000 took a turn in the thread: ${JSON.stringify(out.turns)}`);

  // ---- The prompt it was shown. ----
  const prompts = asked.filter((a) => a.message.includes('My Plumber Platformer hack') || a.message.includes(OPENER));
  assert.equal(prompts.length, 1, 'one call read this thread');
  const { system, message } = prompts[0]!;
  assert.ok(message.includes(OPENER), 'the opener is whole');
  assert.ok(message.includes('[quoting your post #3]'), 'the quote of its own post is the marker');
  assert.ok(message.includes(Q1) && message.includes(Q2), 'both of Spritey\'s questions are there');
  assert.ok(message.includes(`[quoting your post #3]\n\n${Q1} ${Q2}`), 'the reply reads as the marker and then its questions, not the 680 characters it quotes');
  assert.equal(message.split(QC_REVIEW).length - 1, 1, 'the review is read once, as post #3, and not again inside the reply');
  assert.ok(!(system + message).includes('…'), 'the game shortened nothing, so no "…" is in the prompt');

  // ---- The day is charged the prompt's length. ----
  assert.equal(Number(sql(`select chars from pool_turns where post_act = '${mine.post}'`)), system.length + message.length, 'the turn is charged its prompt\'s size');
  const charged = chars() - before;
  const sent = asked.reduce((n, a) => n + a.system.length + a.message.length, 0);
  assert.equal(charged, sent, 'the day is charged what the round sent, and no more');
});
