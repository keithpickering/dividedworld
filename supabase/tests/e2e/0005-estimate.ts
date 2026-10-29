/**
 * End to end: a player's live estimate (engine/rules/settle.ts's estimateForOwner) read from
 * estimate_input() (supabase/migrations/0017_estimate.sql) is the same as one read from the whole
 * window's settlement_input() and filtered to the player, and the scoped input names nobody else.
 * The screens' engine plan, Task 5. Run by tools/test-sql.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { psqlDb, sql } from './psql-db.ts';
import { instanceSeed } from '../../functions/_shared/seed.ts';
import { instance } from '../../functions/_shared/instance.ts';
import { estimateForOwner } from '../../../engine/rules/settle.ts';
import type { SettlementInput } from '../../../engine/rules/types.ts';

test('the scoped estimate is the whole window\'s, filtered to the player, and names nobody else', async () => {
  const db = psqlDb();
  await db.rpc('seed_instance', { payload: instanceSeed(instance) });
  // The window opens where the history ends (earlier files commit settlements).
  const start = sql(`select to_jsonb(coalesce(max(ends_at), (select min(starts_at) from seasons)))#>>'{}' from settlements`);
  const at = (hours: number) => new Date(Date.parse(start) + hours * 3_600_000).toISOString();
  const ids = JSON.parse(sql(`
    with u as (insert into auth.users (email) values ('est-ann@test.invalid'), ('est-bob@test.invalid'), ('est-cat@test.invalid'), ('est-dee@test.invalid') returning id, email),
    a as (insert into accounts (id) select id from u returning id)
    select json_object_agg(split_part(email, '@', 1), id) from u`));
  const masks: [string, string, string][] = [
    ['est-ann', 'Est Face', 'face'], ['est-ann', 'Est Lurker', 'lurker'], ['est-bob', 'Est Heel', 'heel'], ['est-bob', 'Est Shadow', 'jabroni'], ['est-bob', 'Est Ghost', 'lurker'],
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
  let slot = 0;
  const react = (target: string, who: string, owner: string, kind: string, hours: number) => {
    slot += 1;
    sql(`insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values ('${target}', '${c[who]}', '${ids[owner]}', '${kind}', ${slot}, '${at(hours)}')`);
  };
  // On Ann's posts: Bob through two masks (one that never writes), Cat, Dee; Ann's own Lurker (dropped as her own), and an old post's.
  react(p, 'Est Heel', 'est-bob', 'fire', 5); react(p, 'Est Ghost', 'est-bob', 'tomato', 5.5); react(p, 'Est Cat', 'est-cat', 'fire', 6);
  react(p, 'Est Dee', 'est-dee', 'zzz', 6.5); react(p, 'Est Lurker', 'est-ann', 'fire', 7); react(old, 'Est Cat', 'est-cat', 'fire', 8);
  // On Bob's post: Ann's Lurker early, then a crowd, one of them before the window; and votes after Ann's card.
  react(q, 'Est Lurker', 'est-ann', 'fire', 1.6); react(q, 'Est Cat', 'est-cat', 'fire', 9); react(q, 'Est Dee', 'est-dee', 'fire', 9.5);
  react(q, 'Est Shadow', 'est-bob', 'fire', 10);
  // On Ann's card, and on the card Dee landed.
  react(card, 'Est Cat', 'est-cat', 'fire', 11); react(landed, 'Est Cat', 'est-cat', 'fire', 12);
  void spin;

  const until = at(24);
  const full = JSON.parse(sql(`select settlement_input('${start}', '${until}')`)) as SettlementInput;
  const scoped = JSON.parse(sql(`select estimate_input('${ids['est-ann']}', '${until}')`)) as SettlementInput & { player: string };
  const fromFull = estimateForOwner(full, instance, ids['est-ann']);
  const fromScoped = estimateForOwner(scoped, instance, scoped.player);
  assert.ok(fromFull.lines.length > 3, JSON.stringify(fromFull));
  assert.ok(fromFull.entries.some((e) => e.reason.startsWith('lurker.')), 'the Lurker\'s spun thread and call are estimated');
  assert.deepEqual(fromScoped, fromFull);

  // Nobody else is named: no other account, no mask that only reacted, no class but Ann's.
  const said = JSON.stringify(scoped);
  for (const who of ['est-bob', 'est-cat', 'est-dee']) assert.ok(!said.includes(ids[who]), `${who}'s account`);
  assert.ok(!said.includes(c['Est Ghost']), 'a mask that only reacted to Ann is named by a key made up for the request');
  const classes = scoped.characters.flatMap((x) => x.classes.map((k) => k.class));
  assert.deepEqual([...new Set(classes)].sort(), ['face', 'lurker'], 'only Ann\'s masks carry a class');
  // A second call names everyone under new keys.
  const again = JSON.parse(sql(`select estimate_input('${ids['est-ann']}', '${until}')`)) as SettlementInput & { player: string };
  const keys = (i: SettlementInput) => new Set(i.reactions.map((r) => r.player));
  assert.equal([...keys(again)].filter((k) => keys(scoped).has(k)).length, 0, 'no key is shared across two answers');
  assert.deepEqual(estimateForOwner(again, instance, again.player), fromScoped);
});
