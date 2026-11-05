/**
 * End to end: a day of the staff (the staff roster plan, Task 12), across the season's handover, the `chatter` Edge Function's own core
 * (supabase/functions/chatter/core.ts) and the admin queue, against the real migrations on the scratch database, with the real model
 * adapters over a fake `fetch`. Posts name the Boss and quote a Mod Bot; the season is handed over (the Boss becomes a member, a waiting
 * persona debuts as Boss); the pool runs for the day. The ex-Boss answers the post that names it, quoting it, and its spend is a row of
 * `pool_spends`. The Mod Bot answers the post that quotes it with a Whoops! on that post, which a Trap Card its author set there catches
 * (the author is paid `trapSystem`); the ex-Boss's Whoops! on the other post lands and shows in that post's marks, where the screens read
 * them. Gabe's to-do is in the admin queue from the handover until an update is posted, and then it is gone. Run by tools/test-sql.mjs.
 *
 * Stepped over, as 0012 and 0013 step over theirs: the pool's numbers (a week of 700 and no thread starts, so the day's allowance has room for
 * every pick and its card, and every reply lands in the thread that set it off); the persona the rotation will choose is made to be waiting
 * (an earlier file may have debuted it); the Mod Bot is hired by the office log (append-only, written by the superuser as a seed row);
 * and a player's hand is a card-ledger row, as the SQL suite hands one, since the purchase is another Edge Function's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { psqlDb, sql, scratchSeed } from './psql-db.ts';
import { runChatter } from '../../functions/chatter/core.ts';
import { instance } from '../../functions/_shared/instance.ts';
import { models } from '../../functions/_shared/models/index.ts';
import { ledgerWriter } from '../../functions/_shared/models/ledger.ts';

const tiers = { strong: 'claude-opus-5-5', light: 'claude-haiku-5-5' };
const roster = instance.system.roster;
const OLD = instance.system.firstBoss;
const MOD = instance.system.firstStaff[0]!;
const persona = (key: string) => roster.find((p) => p.key === key)!;

test('the Boss is named and a mod quoted, the season is handed over, and the pool answers: replies, a caught Whoops!, a landed one, and the to-do', async () => {
  const db = psqlDb();
  await db.rpc('seed_instance', { payload: scratchSeed(instance) });
  sql(`update settings set value = 'true' where key = 'systemEnabled'`);
  sql(`update settings set value = value || '{"weekly": 700, "threadsWeekly": 0}'::jsonb where key = 'pool'`);
  assert.equal(sql(`select value ->> 'cardRarityMost' from settings where key = 'pool'`), 'common');

  // ---- The staff as this day starts: OLD is the open season's Boss, MOD is on staff, and the persona the rotation will choose is waiting. ----
  sql(`update seasons set boss = '${OLD}' where ends_at is null`);
  sql(`update characters set debuted_at = coalesce(debuted_at, now() - interval '30 days') where staff in ('${OLD}', '${MOD}')`);
  if (sql(`select office from staff_office_now where staff = '${MOD}'`) !== 'mod') sql(`insert into staff_offices (staff, office, cause) values ('${MOD}', 'mod', 'seed')`);
  const NEXT = sql(`select rotation_boss('${OLD}')`);
  assert.ok(NEXT && NEXT !== OLD && NEXT !== MOD, `the rotation names another persona: ${NEXT}`);
  sql(`update characters set debuted_at = null where staff = '${NEXT}'`);
  assert.equal(sql(`select office from staff_office_now where staff = '${NEXT}'`), 'waiting');

  // ---- A board and a thread of their own, so no other file's posts or beats are in the day's hot threads; two players with a mask each. ----
  sql(`insert into boards (slug, name, description) values ('staff-day', 'Staff Day Stage', 'Where the staff spends a day.') on conflict (slug) do nothing`);
  const board = sql(`select id from boards where slug = 'staff-day'`);
  const thread = sql(`insert into threads (board, title) values ('${board}', 'Who runs this place') returning id`);
  const names = ['Staffday Ann', 'Staffday Bo'] as const;
  const accounts: Record<string, string> = JSON.parse(sql(`
    with u as (insert into auth.users (email) values ${names.map((_, i) => `('e2e-staffday-${i}@test.invalid')`).join(', ')} returning id, email),
    a as (insert into accounts (id) select id from u returning id)
    select json_object_agg(email, id) from u`));
  const account = (n: string) => accounts[`e2e-staffday-${names.indexOf(n as (typeof names)[number])}@test.invalid`]!;
  const chars: Record<string, string> = JSON.parse(sql(`
    with c as (insert into characters (owner, name, created_at, debuted_at) values
      ${names.map((n) => `('${account(n)}', '${n}', now() - interval '1 day', now() - interval '1 day')`).join(', ')} returning id, name),
    h as (insert into class_history (character, class_key, started_at) select id, 'face', now() - interval '1 day' from c returning 1)
    select json_object_agg(name, id) from c`));
  const admin = sql(`with u as (insert into auth.users (email) values ('e2e-staffday-admin@test.invalid') returning id), a as (insert into accounts (id) select id from u returning id), m as (insert into admins (account) select id from a returning account) select account from m`);

  // ---- The posts: a Mod Bot speaks, Ann quotes it; Bo names the Boss. Ann lays a Trap Card on her post first, as she would on one she expects to be hit. ----
  const modPost = JSON.parse(sql(`select write_staff_act('${MOD}', 'post', '${thread}', null, '{"body": "Friendly reminder to keep it civil."}')`)).id as string;
  // The players' posts are dated inside the window the pool will read: the pool reads a day, and the files before this one left Acts of their own
  // in the last day (move ends, a handover), which would give the ex-Boss other reasons to post. So the day is the next one, and the posts are
  // written as the superuser does with a time of their own (what `post` writes, with a `created_at`).
  const postAt = (character: string, hoursAhead: number, body: string, quoting: string | null) =>
    sql(`insert into acts (character, kind, thread, target_act_id, payload, created_at) values ('${character}', 'post', '${thread}', ${quoting ? `'${quoting}'` : 'null'}, '${JSON.stringify({ body })}', now() + interval '${hoursAhead} hours') returning id`);
  const annPost = postAt(chars['Staffday Ann']!, 13, 'A reminder is a reminder, mod.', modPost);
  const bossName = persona(OLD).name;
  const boPostBody = `${bossName} would never have allowed this.`;
  const boPost = postAt(chars['Staffday Bo']!, 14, boPostBody, null);
  sql(`insert into card_ledger (account, card, kind, price) values ('${account('Staffday Ann')}', 'trap-card', 'bought', 0);
       insert into wallets (account, balance) values ('${account('Staffday Ann')}', 0) on conflict (account) do update set balance = 0;
       select set_card('${account('Staffday Ann')}', 'trap-card', '${chars['Staffday Ann']}', '${annPost}', '{}', 0);`);
  assert.equal(sql(`select count(*) from face_down where post = '${annPost}'`), '1', 'the trap is set face down on Ann\'s post');

  // ---- The season is handed over: OLD becomes a member, NEXT debuts as Boss. ----
  const before = sql(`select clock_timestamp()`);
  assert.equal(sql(`select reveal_season(starts_at + span_interval(setting('seasonLength'))) is not null from seasons where ends_at is null`), 't');
  assert.equal(sql(`select boss from seasons where ends_at is null`), NEXT, 'the waiting persona is the new Boss');
  assert.notEqual(sql(`select debuted_at from characters where staff = '${NEXT}'`), '', 'and it has debuted');
  assert.match(sql(`select office from staff_office_now where staff = '${OLD}'`), /^(member|mod)$/, 'the old Boss is off the Boss\'s seat');
  assert.equal(sql(`select office from staff_office_now where staff = '${NEXT}'`), 'boss');
  const season = sql(`select number from seasons where ends_at is null`);
  const todos = async () => (await psqlDb(admin).rpc<{ todos: { season: number }[] }>('admin_queue', {})).todos.filter((t) => String(t.season) === season);
  assert.equal((await todos()).length, 1, 'the handover left a to-do in the admin queue');

  // ---- The fake model: each persona answers in its own voice; the ex-Boss and the Mod Bot each play a Whoops! on the post they reply to. ----
  const promptsFor: Record<string, string> = {};
  const words: Record<string, string> = { [OLD]: 'I said it before the handover and I will say it after.', [MOD]: 'Friendly reminder: I noticed.' };
  const fake = (async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (!String(url).includes('anthropic')) return new Response(JSON.stringify({ choices: [{ text: ' ok.' }], usage: { prompt_tokens: 100, completion_tokens: 4 } }), { status: 200 });
    const text = JSON.stringify(body);
    const who = roster.find((p) => text.includes(JSON.stringify(p.persona).slice(1, -1)));
    const asked = String(body.messages?.[0]?.content ?? '');
    if (who) promptsFor[who.key] = asked;
    const reply: Record<string, unknown> = { words: words[who?.key ?? ''] ?? 'Noted.' };
    if (who && (who.key === OLD || who.key === MOD)) reply['card'] = { key: 'whoops', on: 'reply' };
    return new Response(JSON.stringify({ model: tiers.light, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(reply) }], usage: { input_tokens: 1200, output_tokens: 60, service_tier: 'standard' } }), { status: 200 });
  }) as unknown as typeof fetch;
  const env = (name: string) => ({ ANTHROPIC_API_KEY: 'test-key', SYSTEM_COMPLETIONS_URL: 'https://completions.test' } as Record<string, string>)[name];
  const real = models(env, ledgerWriter(db), { tiers, fetch: fake });

  // ---- The pool runs. ----
  const slot = new Date(Math.floor(Date.now() / 60_000) * 60_000 + 36 * 3_600_000).toISOString();
  const ran = await runChatter(db, real, instance, slot);
  assert.equal(ran.status, 'ok', JSON.stringify(ran));
  const day = ran.day;
  const picked = (key: string) => ran.picks.find((p) => p.staff === key);

  // The ex-Boss replied in the thread that named it, quoting the post that did, and the spend is recorded.
  const oldPick = picked(OLD);
  assert.ok(oldPick && oldPick.status === 'posted', `the ex-Boss posted: ${JSON.stringify(ran.picks)}`);
  assert.equal(oldPick.trigger, 'named');
  const reply = JSON.parse(sql(`select to_jsonb(a) from acts a where a.id = '${oldPick.post}'`));
  assert.equal(reply.thread, thread, 'in the thread that named it');
  assert.equal(reply.target_act_id, boPost, 'quoting the post that named it');
  assert.equal(reply.payload.body, words[OLD]);
  assert.equal(sql(`select c.staff from acts a join characters c on c.id = a.character where a.id = '${oldPick.post}'`), OLD);
  assert.match(promptsFor[OLD] ?? '', new RegExp(`You are replying to Staffday Bo: "${boPostBody.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), 'the model was shown the post it quotes');
  const spend = JSON.parse(sql(`select to_jsonb(s) from pool_spends s where s.staff = '${OLD}' and s.day = '${day}'`));
  assert.equal(spend.post_act, oldPick.post);
  assert.equal(spend.trigger, 'named');
  assert.equal(sql(`select count(*) from model_calls where duty = 'chatter' and staff = '${OLD}'`), '1', 'and the call is a ledger row');

  // The Mod Bot replied to Ann's post, which quotes it.
  const modPick = picked(MOD);
  assert.ok(modPick && modPick.status === 'posted', `the Mod Bot posted: ${JSON.stringify(ran.picks)}`);
  assert.equal(modPick.trigger, 'quoted');
  assert.equal(sql(`select target_act_id from acts where id = '${modPick.post}'`), annPost);

  // A staff Whoops! on Bo's post shows in that post's marks (the Acts the screens read above a post, acts_public with its target).
  assert.ok(oldPick.card, `the ex-Boss's Whoops! landed: ${JSON.stringify(oldPick)}`);
  const marks = (post: string) => JSON.parse(sql(`select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at), '[]') from acts_public a where a.kind = 'card' and a.target_act_id = '${post}'`)) as { id: string; payload: { card: string; caught?: string } }[];
  const boMarks = marks(boPost);
  assert.deepEqual(boMarks.map((m) => [m.id, m.payload.card, m.payload.caught ?? null]), [[oldPick.card, 'whoops', null]], 'a staff Whoops! shows in the post\'s marks, uncaught');

  // The Whoops! on Ann's post was caught by her Trap Card, which paid her the card's base price as trapSystem.
  assert.ok(modPick.card, `the Mod Bot's Whoops! was played: ${JSON.stringify(modPick)}`);
  const annMarks = marks(annPost);
  assert.equal(annMarks.length, 1);
  assert.equal(annMarks[0]!.id, modPick.card);
  assert.ok(annMarks[0]!.payload.caught, 'the play was caught');
  const base = Number(sql(`select value ->> 'whoops.price' from settings where key = 'economy'`));
  assert.equal(sql(`select string_agg(change::text, ',') from wallet_events where account = '${account('Staffday Ann')}' and kind = 'trapSystem'`), String(base), 'Ann was paid the base price, made new');
  assert.equal(sql(`select count(*) from wallet_events where account = '${account('Staffday Bo')}' and kind = 'trapSystem'`), '0', 'Bo\'s uncaught Whoops! paid nobody');
  assert.equal(sql(`select count(*) from wallet_events where kind = 'trap' and account = '${account('Staffday Ann')}'`), '0', 'and nothing was taken from a wallet');

  // The week's spend is recorded: a row for each pick, posts and cards counted.
  assert.equal(sql(`select count(*) from pool_spends where day = '${day}' and staff in ('${OLD}', '${MOD}')`), '2');
  assert.equal(sql(`select count(*) from pool_spends where day = '${day}' and card_act in ('${oldPick.card}', '${modPick.card}')`), '2');
  // And pool_week counts it as the run does: a spend with a card is two slots (a post and a card), so the day's two such spends are four.
  // Read from the next day, which leaves the day's own rows in `spent`; on a Sunday that is a new week and holds none of them.
  const nextDay = sql(`select ('${day}'::date + 1)::text`);
  const slots = Number(sql(`select count(*) + count(card_act) from pool_spends where day = '${day}'`));
  assert.ok(slots >= 4, `the day's spends with cards are at least four slots: ${slots}`);
  const sameWeek = sql(`select date_trunc('week', '${nextDay}'::date) <= '${day}'::date`) === 't';
  assert.equal(Number(sql(`select pool_week('${nextDay}'::date) ->> 'spent'`)), sameWeek ? Number(sql(`select coalesce(sum(1 + (card_act is not null)::int), 0) from pool_spends where day >= date_trunc('week', '${nextDay}'::date) and day < '${nextDay}'::date`)) : 0, 'pool_week spent counts a card as a second slot');
  if (sameWeek) assert.ok(Number(sql(`select pool_week('${nextDay}'::date) ->> 'spent'`)) >= 4, 'pool_week counts both spends with their cards, four slots at least');

  // A second run of the day, while the first's claim is young, is told so and writes nothing; the ex-Boss still posted once.
  const again = await runChatter(db, real, instance, new Date(Date.parse(slot) + 60_000).toISOString());
  assert.equal(again.status, 'busy', JSON.stringify(again));
  assert.equal(sql(`select count(*) from acts a join characters c on c.id = a.character where c.staff = '${OLD}' and a.kind = 'post' and a.created_at >= '${before}' and a.payload ->> 'pool' = '${day}'`), '1', 'the ex-Boss posted once');

  // ---- The to-do waits in the admin queue for the update, and goes when one is posted. ----
  assert.equal((await todos()).length, 1, 'the to-do is still there after the pool\'s day');
  const gabe = psqlDb(admin);
  await gabe.rpc('post_update', { title: 'Season ' + season + ' opens', body: 'A new Boss.', changes: [] });
  assert.equal((await todos()).length, 0, 'an update posted after the handover clears the to-do');
});
