/**
 * End to end: a player's live estimate (engine/rules/settle.ts's estimateForOwner) read from
 * estimate_input() (supabase/migrations/0017_estimate.sql) is the same as one read from the whole
 * window's settlement_input() and filtered to the player, and the scoped input names nobody else.
 * The screens' engine plan, Task 5. Run by tools/test-sql.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { psqlDb, sql, scratchSeed } from './psql-db.ts';
import { instance } from '../../functions/_shared/instance.ts';
import { estimateForOwner } from '../../../engine/rules/settle.ts';
import { runEstimate } from '../../functions/estimate/core.ts';
import type { Db } from '../../functions/_shared/rpc.ts';
import type { SettlementInput } from '../../../engine/rules/types.ts';

test('the scoped estimate is the whole window\'s, filtered to the player, and names nobody else', async () => {
  const db = psqlDb();
  await db.rpc('seed_instance', { payload: scratchSeed(instance) });
  // The window opens where the history ends (earlier files commit settlements).
  const start = sql(`select to_jsonb(coalesce(max(ends_at), (select min(starts_at) from seasons)))#>>'{}' from settlements`);
  const at = (hours: number) => new Date(Date.parse(start) + hours * 3_600_000).toISOString();
  const ids = JSON.parse(sql(`
    with u as (insert into auth.users (email) values ('est-ann@test.invalid'), ('est-bob@test.invalid'), ('est-cat@test.invalid'), ('est-dee@test.invalid') returning id, email),
    a as (insert into accounts (id) select id from u returning id)
    select json_object_agg(split_part(email, '@', 1), id) from u`));
  const masks: [string, string, string][] = [
    ['est-ann', 'Est Face', 'face'], ['est-ann', 'Est Lurker', 'lurker'], ['est-bob', 'Est Heel', 'heel'], ['est-bob', 'Est Shadow', 'jabroni'], ['est-bob', 'Est Ghost', 'lurker'], ['est-ann', 'Est Jab', 'jabroni'],
    ['est-cat', 'Est Cat', 'face'], ['est-dee', 'Est Dee', 'heel'],
  ];
  const c = JSON.parse(sql(`
    with c as (insert into characters (owner, name, created_at, debuted_at) values
      ${masks.map(([who, name]) => `('${ids[who]}', '${name}', '${at(-48)}', '${at(-48)}')`).join(', ')} returning id, name),
    h as (insert into class_history (character, class_key, started_at)
      select c.id, m.class, '${at(-48)}' from c join (values ${masks.map(([, name, cls]) => `('${name}', '${cls}')`).join(', ')}) m(name, class) on m.name = c.name returning 1)
    select json_object_agg(name, id) from c`));
  const thread = sql(`insert into threads (board, title) select id, 'Estimated' from boards where slug = 'general' returning id`);
  const act = (who: string, hours: number, kind = 'post', target = 'null', payload = '{"body": "x"}', inThread = thread) =>
    sql(`insert into acts (character, kind, thread, target_act_id, payload, created_at) values ('${c[who]}', '${kind}', '${inThread}', ${target === 'null' ? 'null' : `'${target}'`}, '${payload}', '${at(hours)}') returning id`);
  const old = act('Est Face', -30);
  const p = act('Est Face', 1);
  const q = act('Est Heel', 1.5);
  const card = act('Est Face', 2, 'card', q, '{"card": "stick-around", "config": {}}');
  const spunThread = sql(`insert into threads (board, title, origin_act_id) select id, 'Spun', '${q}' from boards where slug = 'general' returning id`);
  const spin = act('Est Lurker', 2.5, 'spin', q, '{"title": "Spun", "body": ""}', spunThread);
  act('Est Heel', 3, 'post', 'null', '{"body": "reply"}', spunThread);
  act('Est Shadow', 3.1, 'post', 'null', '{"body": "reply"}', spunThread);
  act('Est Cat', 3.2, 'post', 'null', '{"body": "reply"}', spunThread);
  const landed = act('Est Dee', 4, 'card', p, '{"card": "whoops", "config": {"color": "red"}}');
  // A salty card landed on Ann's Jabroni: the cards others played on her posts are read.
  const j = act('Est Jab', 1.2);
  act('Est Dee', 4.5, 'card', j, '{"card": "whoops", "config": {"color": "blue"}}');
  // Before the window: a post of Bob's, a sweet card of Ann's on it, and a thread Ann's Lurker spun
  // from it that gets its replies now. In the window Ann's Face plays a sweet card there too, so the
  // vote after it counts for the earlier one: Ann's earlier cards on a post are read, and so is a
  // spin's origin from before the window.
  const qold = act('Est Heel', -40);
  act('Est Lurker', -10, 'card', qold, '{"card": "stick-around", "config": {}, "layer": 1}');
  const late = act('Est Face', 2.2, 'card', qold, '{"card": "stick-around", "config": {}, "layer": 2}');
  const origin = act('Est Heel', -45);
  const oldThread = sql(`insert into threads (board, title, origin_act_id) select id, 'Spun before', '${origin}' from boards where slug = 'general' returning id`);
  act('Est Lurker', -20, 'spin', origin, '{"title": "Spun before", "body": ""}', oldThread);
  act('Est Heel', 3.3, 'post', 'null', '{"body": "reply"}', oldThread);
  act('Est Cat', 3.4, 'post', 'null', '{"body": "reply"}', oldThread);
  act('Est Dee', 3.5, 'post', 'null', '{"body": "reply"}', oldThread);
  // A post of Dee's that Ann's Lurker reacted to first, before a crowd: her reactions elsewhere are read.
  const r = act('Est Dee', 1.7);
  let slot = 0;
  const react = (target: string, who: string, owner: string, kind: string, hours: number) => {
    slot += 1;
    sql(`insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values ('${target}', '${c[who]}', '${ids[owner]}', '${kind}', ${slot}, '${at(hours)}')`);
  };
  // On Ann's posts: Bob through two masks (one that never writes), Cat, Dee; Ann's own Lurker (dropped as her own), and an old post's.
  react(p, 'Est Heel', 'est-bob', 'fire', 5); react(p, 'Est Ghost', 'est-bob', 'tomato', 5.5); react(p, 'Est Cat', 'est-cat', 'fire', 6);
  react(p, 'Est Dee', 'est-dee', 'facepalm', 6.5); react(p, 'Est Lurker', 'est-ann', 'fire', 7); react(old, 'Est Cat', 'est-cat', 'fire', 8);
  // On Bob's post: Ann's Lurker early, then a crowd, one of them before the window; and votes after Ann's card.
  react(q, 'Est Lurker', 'est-ann', 'fire', 1.6); react(q, 'Est Cat', 'est-cat', 'fire', 9); react(q, 'Est Dee', 'est-dee', 'fire', 9.5);
  react(q, 'Est Shadow', 'est-bob', 'fire', 10);
  // On Ann's card, and on the card Dee landed.
  react(card, 'Est Cat', 'est-cat', 'fire', 11); react(landed, 'Est Cat', 'est-cat', 'fire', 12);
  react(r, 'Est Lurker', 'est-ann', 'fire', 1.8); react(r, 'Est Cat', 'est-cat', 'fire', 2); react(r, 'Est Heel', 'est-bob', 'fire', 2.2); react(r, 'Est Shadow', 'est-bob', 'heart', 2.3);
  react(qold, 'Est Cat', 'est-cat', 'fire', 13);
  void spin; void late;

  const until = at(24);
  const full = JSON.parse(sql(`select settlement_input('${start}', '${until}')`)) as SettlementInput;
  const scoped = JSON.parse(sql(`select estimate_input('${ids['est-ann']}', '${until}')`)) as SettlementInput & { player: string };
  // The estimate leaves out only Ann's own reactions to her own masks, and counts every other as anyone's (the core loop design,
  // section 1): so the whole window's input is read in the estimate's shape, each reaction of another player's keyed by its mask,
  // which ties it to no author. Read as the settlement reads it, Bob's own Shadow on Bob's post is never counted.
  const asAnyone = (i: SettlementInput, caller: string): SettlementInput => {
    const others = i.reactions.filter((r) => r.player !== caller);
    return {
      ...i,
      characters: [...i.characters, ...[...new Set(others.map((r) => r.character))].map((m) => ({ id: `mask:${m}`, player: `mask:${m}`, classes: [] }))],
      reactions: i.reactions.map((r) => (r.player === caller ? r : { ...r, player: `mask:${r.character}`, character: `mask:${r.character}` })),
    };
  };
  const fromFull = estimateForOwner(asAnyone(full, ids['est-ann']), instance, ids['est-ann']);
  const fromScoped = estimateForOwner(scoped, instance, scoped.player);
  assert.ok(fromFull.lines.length > 3, JSON.stringify(fromFull));
  const settled = estimateForOwner(full, instance, ids['est-ann']);
  const lifted = (e: typeof fromFull) => e.lines.filter((l) => l.reason === 'face.liftedAPost' && l.act === card).reduce((n, l) => n + l.amount, 0);
  assert.equal(lifted(fromFull) - lifted(settled), 10, 'Bob\'s Shadow on Bob\'s post lifts Ann\'s card in the estimate, and is not counted as the settlement reads it');
  // Every read of estimate_input's has a reason behind it here, so dropping one changes the estimate.
  const reasons = fromFull.lines.map((l) => l.reason);
  for (const reason of ['lurker.calledIt', 'jabroni.soldTheL', 'face.liftedAPost']) assert.ok(reasons.includes(reason), `${reason} is estimated: ${JSON.stringify(reasons)}`);
  assert.equal(reasons.filter((x) => x === 'lurker.spunAThread').length, 2, 'both spun threads, the one spun before the window too');
  assert.ok(!fromFull.lines.some((l) => l.reason === 'face.liftedAPost' && l.act === late), 'the vote after two sweet cards counts for the earlier one');
  assert.deepEqual(fromScoped, fromFull);

  // Nobody else is named: no other account, no mask that only reacted, no class but Ann's.
  const said = JSON.stringify(scoped);
  for (const who of ['est-bob', 'est-cat', 'est-dee']) assert.ok(!said.includes(ids[who]), `${who}'s account`);
  assert.ok(!said.includes(c['Est Ghost']), 'a mask that only reacted to Ann is named by a key made up for the request');
  const classes = scoped.characters.flatMap((x) => x.classes.map((k) => k.class));
  assert.deepEqual([...new Set(classes)].sort(), ['face', 'jabroni', 'lurker'], 'only Ann\'s masks carry a class');
  // A second call names everyone under new keys.
  const again = JSON.parse(sql(`select estimate_input('${ids['est-ann']}', '${until}')`)) as SettlementInput & { player: string };
  const keys = (i: SettlementInput) => new Set(i.reactions.map((r) => r.player));
  assert.equal([...keys(again)].filter((k) => keys(scoped).has(k)).length, 0, 'no key is shared across two answers');
  assert.deepEqual(estimateForOwner(again, instance, again.player), fromScoped);
});

test('a reaction to another\'s card on a third player\'s post is estimated, through the estimate function (#137)', async () => {
  const db = psqlDb();
  await db.rpc('seed_instance', { payload: scratchSeed(instance) });
  // The window opens where the history ends, which an earlier file's settlement can put anywhere: the function's read of the
  // window is asked up to a day past it, as the first test asks it, and everything else is the function's own.
  const start = Date.parse(sql(`select to_jsonb(coalesce(max(ends_at), (select min(starts_at) from seasons)))#>>'{}' from settlements`));
  const at = (minutes: number) => new Date(start + minutes * 60_000).toISOString();
  const service: Db = { rpc: (fn, args) => db.rpc(fn, fn === 'estimate_input' ? { ...args, until: at(24 * 60) } : args) };
  const ids = JSON.parse(sql(`
    with u as (insert into auth.users (email) values ('est137-q@test.invalid'), ('est137-z@test.invalid'), ('est137-c@test.invalid'), ('est137-d@test.invalid'), ('est137-e@test.invalid') returning id, email),
    a as (insert into accounts (id) select id from u returning id)
    select json_object_agg(split_part(email, '@', 1), id) from u`));
  const c = JSON.parse(sql(`
    with c as (insert into characters (owner, name, created_at, debuted_at) values
      ('${ids['est137-q']}', 'Est137 Q', '${at(-48 * 60)}', '${at(-48 * 60)}'),
      ('${ids['est137-z']}', 'Est137 Z', '${at(-48 * 60)}', '${at(-48 * 60)}'),
      ('${ids['est137-c']}', 'Est137 C', '${at(-48 * 60)}', '${at(-48 * 60)}'),
      ('${ids['est137-d']}', 'Est137 D', '${at(-48 * 60)}', '${at(-48 * 60)}'),
      ('${ids['est137-e']}', 'Est137 E', '${at(-48 * 60)}', '${at(-48 * 60)}') returning id, name),
    h as (insert into class_history (character, class_key, started_at)
      select id, case when name = 'Est137 C' then 'lurker' else 'face' end, '${at(-48 * 60)}' from c returning 1)
    select json_object_agg(name, id) from c`));
  const thread = sql(`insert into threads (board, title) select id, 'Estimated 137' from boards where slug = 'general' returning id`);
  const zp = sql(`insert into acts (character, kind, thread, payload, created_at) values ('${c['Est137 Z']}', 'post', '${thread}', '{"body": "x"}', '${at(1)}') returning id`);
  const card = sql(`insert into acts (character, kind, thread, target_act_id, payload, created_at) values ('${c['Est137 Q']}', 'card', '${thread}', '${zp}', '{"card": "stick-around", "config": {}}', '${at(2)}') returning id`);
  // C, a Lurker, calls the card first; a crowd of three other players follows, so C's call is a line.
  const react = (who: string, minutes: number) => sql(`insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at)
    values ('${card}', '${c[`Est137 ${who}`]}', '${ids[`est137-${who.toLowerCase()}`]}', 'fire', 1, '${at(minutes)}')`);
  react('C', 3); react('Z', 4); react('D', 5); react('E', 6);

  const answer = await runEstimate({ player: psqlDb(ids['est137-c']), service }, instance);
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  const { lines } = answer.body as { lines: { act: string; reason: string }[] };
  assert.deepEqual(lines.map((l) => [l.reason, l.act]), [['lurker.calledIt', card]], 'C\'s call on the card is C\'s line');
});

test('a card an admin reversed before the estimate\'s end is not estimated, nor the votes on it; one reversed at that instant still is', async () => {
  const db = psqlDb();
  await db.rpc('seed_instance', { payload: scratchSeed(instance) });
  // The twin of 0001-settlement.ts's reversed-play cases (bot-card-options plan, Task 3), read through estimate_input.
  const start = sql(`select to_jsonb(coalesce(max(ends_at), (select min(starts_at) from seasons)))#>>'{}' from settlements`);
  const at = (hours: number) => new Date(Date.parse(start) + hours * 3_600_000).toISOString();
  const ids = JSON.parse(sql(`
    with u as (insert into auth.users (email) values ('est-rv-heel@test.invalid'), ('est-rv-f1@test.invalid'), ('est-rv-f2@test.invalid'), ('est-rv-au@test.invalid') returning id, email),
    a as (insert into accounts (id) select id from u returning id)
    select json_object_agg(split_part(email, '@', 1), id) from u`));
  const masks: [string, string, string][] = [
    ['est-rv-heel', 'Rv Gone', 'heel'], ['est-rv-heel', 'Rv Edge', 'heel'], ['est-rv-heel', 'Rv Kept', 'heel'],
    ['est-rv-f1', 'Rv F1', 'face'], ['est-rv-f2', 'Rv F2', 'face'], ['est-rv-au', 'Rv Author', 'face'],
  ];
  const c = JSON.parse(sql(`
    with c as (insert into characters (owner, name, created_at, debuted_at) values
      ${masks.map(([who, name]) => `('${ids[who]}', '${name}', '${at(-48)}', '${at(-48)}')`).join(', ')} returning id, name),
    h as (insert into class_history (character, class_key, started_at)
      select c.id, m.class, '${at(-48)}' from c join (values ${masks.map(([, name, cls]) => `('${name}', '${cls}')`).join(', ')}) m(name, class) on m.name = c.name returning 1)
    select json_object_agg(name, id) from c`));
  const thread = sql(`insert into threads (board, title) select id, 'Reversed estimate' from boards where slug = 'general' returning id`);
  const act = (who: string, hours: number, kind: string, target: string | null, payload: string) =>
    sql(`insert into acts (character, kind, thread, target_act_id, payload, created_at) values ('${c[who]}', '${kind}', '${thread}', ${target ? `'${target}'` : 'null'}, '${payload}', '${at(hours)}') returning id`);
  const plays: Record<string, string> = {};
  let slot = 0;
  for (const name of ['Rv Gone', 'Rv Edge', 'Rv Kept']) {
    const post = act('Rv Author', 1, 'post', null, '{"body": "A take."}');
    plays[name] = act(name, 2, 'card', post, '{"card": "whoops", "config": {"color": "red"}}');
    for (const [i, fan] of ['Rv F1', 'Rv F2'].entries()) {
      slot += 1;
      sql(`insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values ('${plays[name]}', '${c[fan]}', '${ids[i === 0 ? 'est-rv-f1' : 'est-rv-f2']}', 'tomato', ${slot}, '${at(3 + i)}')`);
    }
  }
  const reverse = (card: string, when: string) => sql(`select set_config('kayfabb.card_end_writer', 'on', false);
    insert into acts (character, kind, thread, target_act_id, payload, created_at) values (null, 'card_end', '${thread}', '${card}', '{"why": "reversed", "by": "admin"}', '${when}');
    select set_config('kayfabb.card_end_writer', '', false)`);
  reverse(plays['Rv Gone']!, at(10));
  const until = at(24);
  reverse(plays['Rv Edge']!, until);

  const scoped = JSON.parse(sql(`select estimate_input('${ids['est-rv-heel']}', '${until}')`)) as SettlementInput & { player: string };
  const named = new Set(scoped.acts.map((a) => a.id));
  assert.ok(!named.has(plays['Rv Gone']!), 'the reversed card is not in the input');
  assert.ok(!scoped.reactions.some((r) => r.act === plays['Rv Gone']!), 'nor are the votes on it');
  assert.ok(named.has(plays['Rv Edge']!) && named.has(plays['Rv Kept']!), 'a card reversed at the window\'s end, and a live one, are');
  const lines = estimateForOwner(scoped, instance, scoped.player).lines;
  const paid = (card: string) => lines.filter((l) => l.act === card).length;
  assert.equal(paid(plays['Rv Gone']!), 0, 'a reversed card draws nothing in the estimate');
  assert.ok(paid(plays['Rv Kept']!) > 0 || lines.some((l) => l.reason === 'heel.drewHeat'), `the control is estimated: ${JSON.stringify(lines)}`);
  assert.ok(lines.length > 0);
});
