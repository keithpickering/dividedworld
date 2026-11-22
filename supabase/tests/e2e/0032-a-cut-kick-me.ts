/**
 * End to end: a Kick Me cut by a Buzzkill pays only the votes before the cut (the Buzzkill plan, Task 2, "Settlement"): the settlement's input sends the play's
 * `ends` as the cut's time (supabase/migrations/0405_cut.sql), and engine/rules/settle.ts pays a flat earn only inside [at, ends). A Kick Me used at t0, a negative vote at t1, the
 * cut at t2 and a negative vote at t3, in one window: the settled result pays the t1 vote's boost and not t3's. With the cut reversed by an admin before the window settles, both are paid.
 * The live estimate (estimate_input, estimateForOwner) agrees in both. Run by tools/test-sql.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { psqlDb, sql, scratchSeed } from './psql-db.ts';
import { instance } from '../../functions/_shared/instance.ts';
import { settle, estimateForOwner } from '../../../engine/rules/settle.ts';
import type { SettlementInput } from '../../../engine/rules/types.ts';

test('a cut Kick Me pays the vote before the cut and not the vote after it; reversed, it pays both', async () => {
  const db = psqlDb();
  await db.rpc('seed_instance', { payload: scratchSeed(instance) });
  const start = sql(`select to_jsonb(coalesce(max(ends_at), (select min(starts_at) from seasons)))#>>'{}' from settlements`);
  const at = (hours: number) => new Date(Date.parse(start) + hours * 3_600_000).toISOString();
  const ids = JSON.parse(sql(`
    with u as (insert into auth.users (email) values ('cut-ann@test.invalid'), ('cut-bob@test.invalid'), ('cut-bea@test.invalid'), ('cut-cat@test.invalid'), ('cut-dee@test.invalid') returning id, email),
    a as (insert into accounts (id) select id from u returning id)
    select json_object_agg(split_part(email, '@', 1), id) from u`));
  const names: [string, string, string][] = [['cut-ann', 'Cut Ann', 'face'], ['cut-bob', 'Cut Bob', 'heel'], ['cut-bea', 'Cut Bea', 'heel'], ['cut-cat', 'Cut Cat', 'face'], ['cut-dee', 'Cut Dee', 'lurker']];
  const c = JSON.parse(sql(`
    with c as (insert into characters (owner, name, created_at, debuted_at) values
      ${names.map(([who, name]) => `('${ids[who]}', '${name}', '${at(-48)}', '${at(-48)}')`).join(', ')} returning id, name),
    h as (insert into class_history (character, class_key, started_at)
      select c.id, m.class, '${at(-48)}' from c join (values ${names.map(([, name, cls]) => `('${name}', '${cls}')`).join(', ')}) m(name, class) on m.name = c.name returning 1)
    select json_object_agg(name, id) from c`));
  // A board of this file's own: the shared database holds boards earlier e2e files merged away, and a thread started on one is refused.
  sql(`insert into boards (slug, name, description) values ('cut-e2e', '000 Cut', 'Where the cut Kick Me is played.') on conflict (slug) do nothing`);
  const thread = sql(`insert into threads (board, title) select id, 'Cut settlement' from boards where slug = 'cut-e2e' returning id`);
  const act = (who: string, hours: number, kind: string, target: string | null, payload: object) =>
    sql(`insert into acts (character, kind, thread, target_act_id, payload, created_at) values ('${c[who]}', '${kind}', '${thread}', ${target === null ? 'null' : `'${target}'`}, '${JSON.stringify(payload).replaceAll("'", "''")}', '${at(hours)}') returning id`);
  let slot = 0;
  const vote = (target: string, who: string, owner: string, hours: number) => {
    slot += 1;
    sql(`insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values ('${target}', '${c[who]}', '${ids[owner]}', 'vomiting', ${slot}, '${at(hours)}')`);
  };
  // Two posts of two players, each with a Kick Me at t0 = 1h, a vote at t1 = 2h, the Buzzkill at t2 = 3h and a vote at t3 = 4h. The second Buzzkill is ended by an admin before the window settles.
  const rounds = (['Cut Bob', 'Cut Bea'] as const).map((owner, i) => {
    const post = act(owner, 0.5, 'post', null, { body: `A take ${i}.` });
    const kick = act(owner, 1, 'card', post, { card: 'kick-me', message: '', config: {}, layer: 1, ends: at(1 + 72) });
    vote(post, 'Cut Cat', 'cut-cat', 2);
    const cut = act('Cut Ann', 3, 'card', post, { card: 'buzzkill', message: '', config: { play: kick }, instant: true, cut: { play: kick, card: 'kick-me' } });
    vote(post, 'Cut Dee', 'cut-dee', 4);
    return { owner, post, kick, cut };
  });
  sql(`do $$ begin
    perform set_config('kayfabb.card_end_writer', 'on', true);
    insert into acts (character, kind, thread, target_act_id, payload) values (null, 'card_end', '${thread}', '${rounds[1]!.cut}', '{"why": "reversed", "by": "admin"}');
  end $$; select 1`);

  const until = at(24);
  const full = JSON.parse(sql(`select settlement_input('${start}', '${until}')`)) as SettlementInput;
  const boosts = (input: SettlementInput, who: string, kick: string) => {
    const result = settle(input, instance);
    return result.entries.filter((e) => e.character === c[who] && e.params?.card === 'kick-me' && e.reason.startsWith('card.')).map((e) => ({ reason: e.reason, amount: e.amount }));
  };
  const cutBoosts = boosts(full, 'Cut Bob', rounds[0]!.kick);
  const reversedBoosts = boosts(full, 'Cut Bea', rounds[1]!.kick);
  const sum = (xs: { amount: number }[]) => xs.reduce((n, x) => n + x.amount, 0);
  assert.ok(sum(reversedBoosts) > 0, `the reversed cut pays: ${JSON.stringify(reversedBoosts)}`);
  assert.equal(sum(cutBoosts) * 2, sum(reversedBoosts), `the cut Kick Me pays the t1 vote's boost and not the t3 vote's, and the reversed one pays both: ${JSON.stringify({ cutBoosts, reversedBoosts })}`);
  assert.ok(sum(cutBoosts) > 0, 'the vote before the cut is paid');

  // The live estimate agrees, for each owner.
  for (const [who, account, boostsOfWindow] of [['Cut Bob', 'cut-bob', cutBoosts], ['Cut Bea', 'cut-bea', reversedBoosts]] as const) {
    const scoped = JSON.parse(sql(`select estimate_input('${ids[account]}', '${until}')`)) as SettlementInput & { player: string };
    const estimated = estimateForOwner(scoped, instance, scoped.player).entries.filter((e) => e.character === c[who] && e.params?.card === 'kick-me' && e.reason.startsWith('card.'));
    assert.equal(sum(estimated), sum(boostsOfWindow), `${who}: the estimate pays what the settlement pays: ${JSON.stringify(estimated)}`);
  }
});
