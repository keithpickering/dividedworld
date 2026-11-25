/**
 * An instance that already holds a catalog keeps every card's price when the machine arrives (the booster packs plan, Task 2): migrating
 * across supabase/migrations/0139_machine.sql writes a slot for each card in `card_kinds`, ordered by key, on sale, at the price its economy
 * setting held; takes the price keys out of the economy row and leaves the numbers the cards read; drops the column, the check and the trigger
 * that priced a card; and leaves a hand as it was. Every card is put on sale at its old price, and an admin hides any the instance's catalog hides (Main Event) on the machine's page; the Booster's slot is added by the next seed, at the end of the grid after the cards, and the seed changes no slot. On a
 * database of its own, made here beside the scratch one tools/test-sql.mjs made, from the migrations before 0139.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { databaseBefore } from './psql-db.ts';

const psqlOn = (url: string, text: string) =>
  execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-qtAX', url, '-f', '-'], { input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

test('every card gets a slot at its old price, the economy loses its price keys and keeps the rest, and a hand is as it was', () => {
  // A database as the migrations before 0139 left it, from the runner's snapshot of its replay; only the migrations from 0139 on are applied here.
  const old = databaseBefore('0139', 'machine');
  assert.equal(old.crossing, '0139_machine.sql', 'the migration this holds is there');
  const db = new URL(old.url);
  try {
    // Before: three cards planted out of key order, each priced by the economy, one reading a number of its own, a class's number beside them,
    // and a player holding two of one card, one bought and one played.
    psqlOn(db.toString(), `
      insert into settings (key, value) values ('economy', '{"zz-a.price": 150, "zz-b.price": 25, "zz-c.price": 20, "zz-b.perLength": 3, "alpha.weight": 7}');
      insert into card_kinds (key, name, alignment, price_setting, reads, rarity) values
        ('zz-c', 'Cee', 'sweet', 'zz-c.price', '{}', 'common'),
        ('zz-a', 'Ay', 'salty', 'zz-a.price', '{}', 'uncommon'),
        ('zz-b', 'Bee', 'sweet', 'zz-b.price', '{zz-b.perLength}', 'common');
      insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a1', 'machine-ann@test.invalid');
      insert into accounts (id) values ('00000000-0000-4000-8000-0000000000a1');
      insert into card_ledger (account, card, kind, price) values
        ('00000000-0000-4000-8000-0000000000a1', 'zz-a', 'bought', 150), ('00000000-0000-4000-8000-0000000000a1', 'zz-a', 'bought', 150), ('00000000-0000-4000-8000-0000000000a1', 'zz-b', 'bought', 25);`);
    const hand = `select string_agg(card || ':' || kind || ':' || price, ',' order by id) from card_ledger`;
    const handBefore = psqlOn(db.toString(), hand);

    for (const m of old.remaining) psqlOn(db.toString(), m);

    assert.equal(psqlOn(db.toString(), `select string_agg(position || ':' || coalesce(card, pack) || ':' || availability || ':' || price, ',' order by position) from machine_slots`),
      '1:zz-a:onSale:150,2:zz-b:onSale:25,3:zz-c:onSale:20', 'a slot for each card, ordered by key, on sale, at its old price, none lost or doubled');
    assert.equal(psqlOn(db.toString(), `select value::text from settings where key = 'economy'`).replaceAll(' ', ''), '{"alpha.weight":7,"zz-b.perLength":3}',
      'the price keys are out of the economy and the numbers a card reads, and a class\'s, are in');
    assert.equal(psqlOn(db.toString(), `select count(*) from information_schema.columns where table_name = 'card_kinds' and column_name = 'price_setting'`), '0', 'a card no longer names its price');
    assert.equal(psqlOn(db.toString(), `select to_regproc('price_holds') is null and to_regproc('card_kinds_priced') is null`), 't', 'the check that priced a card is gone');
    assert.equal(psqlOn(db.toString(), `select count(*) from pg_trigger where tgname = 'card_kinds_priced'`), '0');
    assert.equal(psqlOn(db.toString(), hand), handBefore, 'the ledger is as it was');
    assert.equal(psqlOn(db.toString(), `select card_held('00000000-0000-4000-8000-0000000000a1', 'zz-a') || ',' || card_held('00000000-0000-4000-8000-0000000000a1', 'zz-b')`), '2,1');

    // The next seed adds the Booster's slot at the end and leaves the three alone, whatever price it names for them.
    psqlOn(db.toString(), `
      select seed_instance(jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
        'packs', jsonb_build_array(jsonb_build_object('key', 'zz-pack', 'pulls', jsonb_build_array(jsonb_build_object('weights', jsonb_build_object('common', 1))), 'leaves', '[]'::jsonb)),
        'machine', jsonb_build_array(
          jsonb_build_object('pack', 'zz-pack', 'availability', 'onSale', 'price', 300),
          jsonb_build_object('card', 'zz-a', 'availability', 'hidden', 'price', 999))));`);
    assert.equal(psqlOn(db.toString(), `select string_agg(position || ':' || coalesce(card, pack) || ':' || availability || ':' || price, ',' order by position) from machine_slots`),
      '1:zz-a:onSale:150,2:zz-b:onSale:25,3:zz-c:onSale:20,4:zz-pack:onSale:300', 'the pack is added at the end; no slot already there is touched');
  } finally {
    old.drop();
  }
});
