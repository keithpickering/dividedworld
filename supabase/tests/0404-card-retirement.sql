-- Retiring a card (supabase/migrations/0404_card_retirement.sql; docs/plans/2026-11-20-card-retirement-plan.md, Task 2; design docs/plans/2026-11-20-card-retirement-design.md, sections 1 to 3, 5 and 8).
-- A card leaves in one of three ways, each said in the instance's code and written by seed_instance: out of print (`retired_at`; nothing gives a new copy, every copy stays playable and the date is kept while the
-- flag stays), renamed (`became`, `gone_at`; every copy an account holds, held or face down, moves to the new key) and withdrawn (`refund`, `gone_at`; every such copy is refunded once).
--   * The columns and their checks; the ledger's three kinds and the wallet's `withdrawal`; the shape guard (a key the payload lists in none of its lists, a gone key listed as a card).
--   * Out of print: the roll, draw_pool and the Random Event's card outcome never give it; a play of a held copy still lands; listing it again clears `retired_at` and the roll gives it again.
--   * Renamed and withdrawn: the counts per account (held plus live backs), card_held and my_card_ledger agreeing, a second seed writing nothing, a sealed pack opening as the new card or refunded.
--   * The machine: a slot of a retired, renamed or withdrawn card and of a retired pack kind is absent from machine_now (and so unsold, a flash sale or a Pull on it unshown), admin_machine says why.
--   * A back of a gone key never springs and take_back of it is refused in plain words; nothing here edits a row of card_ledger, face_down, packs or machine_slots.
--   * The race: the seed locks every account it will count before counting, the same row play_card and take_back take.
-- The cards (cr...), packs, accounts and slots are this file's own.

create function pg_temp.coded(stmt text) returns text language plpgsql as $$
declare hint text;
begin
  execute stmt;
  return null;
exception when others then
  get stacked diagnostics hint = pg_exception_hint;
  return sqlstate || ' ' || coalesce(hint, '-') || ' ' || sqlerrm;
end $$;

-- Whether a statement is let through, without keeping what it wrote: null where it ran, the refusal where it did not.
create function pg_temp.fits(stmt text) returns text language plpgsql as $$
declare hint text;
begin
  begin
    execute stmt;
    raise exception 'rolled back' using errcode = 'XX999';
  exception when sqlstate 'XX999' then
    return null;
  end;
exception when others then
  get stacked diagnostics hint = pg_exception_hint;
  return sqlstate || ' ' || coalesce(hint, '-') || ' ' || sqlerrm;
end $$;

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception '%', what; end if;
end $$;

-- A card of the payload: a plain one, or a Set card that catches a cast.
create function pg_temp.c(key text, name text, rarity text default 'common', play text default 'cast') returns jsonb language sql as $$
  select jsonb_build_object('key', key, 'name', name, 'alignment', 'salty', 'stack', case when play = 'set' then 1 else 3 end, 'seeded', false, 'rarity', rarity, 'play', play, 'reaches', '["post"]'::jsonb)
         || case when play = 'set' then jsonb_build_object('trap', '{"trigger": {"on": "cast"}}'::jsonb) else '{}'::jsonb end
$$;

-- Every card the database holds that has not gone, as the payload lists it (the seed refuses a key no list names, and the suite's earlier files leave cards of their own committed, so every column the seed writes is carried
-- as the row holds it), `retire` and `unretire` setting the flag.
create function pg_temp.listed(retire text[], unretire text[]) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('key', k.key, 'name', k.name, 'alignment', k.alignment, 'stack', k.stack, 'seeded', k.seeded, 'reads', to_jsonb(k.reads), 'rarity', k.rarity, 'play', k.play,
    'trap', k.trap, 'gimmick', k.gimmick, 'refunds', k.refunds, 'discipline', k.discipline,
    'lasts', case when k.lasts is null then null when extract(epoch from k.lasts)::bigint % 86400 = 0 then jsonb_build_object('unit', 'day', 'count', extract(epoch from k.lasts)::bigint / 86400)
                  else jsonb_build_object('unit', 'minute', 'count', extract(epoch from k.lasts)::bigint / 60) end,
    'reaches', to_jsonb(k.reaches), 'pins', case when k.pins then true end, 'writes', case when k.writes then true end, 'replies', case when k.replies then true end, 'keeps', case when k.keeps then true end, 'skim', k.skim, 'scoresAs', case when k.scores_as then true end, 'draws', to_jsonb(k.draws), 'drive', k.drive,
    'needsMessage', k.needs_message, 'veil', k.veil, 'addsReaction', case when k.adds_reaction then true end, 'surface', case when k.surface then true end,
    'retired', (k.retired_at is not null or k.key = any (retire)) and k.key <> all (unretire))) order by k.key), '[]'::jsonb)
  from card_kinds k where k.gone_at is null
$$;

-- The seed payload as the instance sends it: the cards the database holds that have not gone (less `drop_keys` and the keys `rename` and `withdraw` move), `extra` cards, the gone keys carried in their lists (less `omit`: a payload that does not list an old name)
-- plus the new entries, and every pack kind the database holds (or `packs`: the ones the payload lists).
create function pg_temp.pl(extra jsonb default '[]', retire text[] default '{}', unretire text[] default '{}', rename jsonb default '[]', withdraw jsonb default '[]', drop_keys text[] default '{}',
                           packs jsonb default null, machine jsonb default '[]', omit text[] default '{}') returns jsonb language plpgsql as $$
declare
  moved text[];
begin
  select coalesce(array_agg(e ->> 'key'), '{}') into moved from jsonb_array_elements(rename || withdraw) e;
  return jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb,
    'cards', (select coalesce(jsonb_agg(c), '[]'::jsonb) from jsonb_array_elements(pg_temp.listed(retire, unretire)) c where (c ->> 'key') <> all (moved || drop_keys)) || extra,
    'formerly', (select coalesce(jsonb_agg(jsonb_build_object('key', k.key, 'name', k.name, 'became', k.became)), '[]'::jsonb) from card_kinds k
                 where k.key <> all (omit) and k.became is not null and k.key not in (select e ->> 'key' from jsonb_array_elements(rename) e)) || rename,
    'withdrawn', (select coalesce(jsonb_agg(jsonb_build_object('key', k.key, 'name', k.name, 'refund', k.refund)), '[]'::jsonb) from card_kinds k
                  where k.key <> all (omit) and k.refund is not null and k.key not in (select e ->> 'key' from jsonb_array_elements(withdraw) e)) || withdraw,
    'packs', coalesce(packs, (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('key', p.key, 'pulls', p.pulls, 'leaves', to_jsonb(p.leaves), 'contents', to_jsonb(p.contents)))), '[]'::jsonb)
                              from pack_kinds p)),
    'machine', machine);
end $$;

-- plpgsql, not sql: a sql function's body is analyzed when it is created, which would hold a row lock on the ledger for this file's whole transaction and stall the races that run first.
create function pg_temp.hand(who uuid, key text, n integer) returns void language plpgsql as $$
begin
  insert into card_ledger (account, card, kind, price) select who, key, 'bought', 0 from generate_series(1, n);
end $$;

-- ---- Race first: a seed counts a key's copies only once it holds every account that has them ----
-- The race runs before this file's own transaction touches a row (a row it wrote and a session waits on would deadlock the two), and commits what it needs: an account holding 2 copies of a card
-- that a seed renames. Session A takes the account's row as play_card and take_back take it and, while the seed waits on it, a third copy arrives; the seed must count after the lock, so it moves
-- 3, never the 2 it could have counted before. What this leaves (an account, two cards, a gone key's rows) is append-only and committed; the scratch database is dropped at the end of the run.
do $$
declare
  r constant uuid := gen_random_uuid(); url text := current_setting('kayfabb.scratch_url'); waited integer := 0; max_waits constant integer := 300; blocked integer := 0; got bigint;
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'cr-race@test.invalid');
    insert into accounts (id, created_at) values (%1$L, '2000-01-01T00:00:00Z');
    insert into card_kinds (key, name, alignment, rarity, play, stack) values ('crrold', 'Crr Old', 'salty', 'common', 'cast', 3), ('crrnew', 'Crr New', 'salty', 'common', 'cast', 3);
    insert into card_ledger (account, card, kind, price) select %1$L, 'crrold', 'bought', 0 from generate_series(1, 2);
  $sql$, r));
  perform extensions.dblink_connect('cr_a', url);
  perform extensions.dblink_connect('cr_b', url);
  perform extensions.dblink_exec('cr_a', 'begin');
  perform * from extensions.dblink('cr_a', format('select 1 from accounts where id = %L for no key update', r)) as t(x integer);
  -- The waits for a condition give up at 30 s (300 looks of 0.1 s), as the other race tests do; they leave the moment it holds. Not the check below that a session does not finish, whose bound is the assertion.
  perform extensions.dblink_send_query('cr_b', 'select card_leaves(''crrold'', ''crrnew'', null)');
  while blocked = 0 and waited < max_waits loop
    perform pg_sleep(0.1); perform pg_stat_clear_snapshot();
    waited := waited + 1;
    select count(*) into blocked from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%card_leaves%' and pid <> pg_backend_pid();
  end loop;
  if blocked = 0 then raise exception 'the move did not wait for an account''s row that another session held: it counts before it locks'; end if;
  perform extensions.dblink_exec('cr_a', format('insert into card_ledger (account, card, kind, price) values (%L, ''crrold'', ''bought'', 0)', r));
  perform extensions.dblink_exec('cr_a', 'commit');
  select t.r into got from extensions.dblink_get_result('cr_b') as t(r bigint);
  perform extensions.dblink_disconnect('cr_a');
  perform extensions.dblink_disconnect('cr_b');
  if got is distinct from 3 then raise exception 'the move counted before it held the account: % copies moved, 3 held', got; end if;
  if card_held(r, 'crrold') <> 0 or card_held(r, 'crrnew') <> 3 then raise exception 'the race left % and % copies', card_held(r, 'crrold'), card_held(r, 'crrnew'); end if;
end $$;

-- A second account: a copy inserted by a session that is still in flight when a card leaves is counted (the seed waits for it), and one inserted after the seed took its table lock waits for it and is refused at its commit.
do $$
declare
  r constant uuid := gen_random_uuid(); url text := current_setting('kayfabb.scratch_url'); waited integer; max_waits constant integer := 300; blocked integer; got bigint; said text;
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'cr-race2@test.invalid');
    insert into accounts (id, created_at) values (%1$L, '2000-01-01T00:00:00Z');
    insert into card_kinds (key, name, alignment, rarity, play, stack) values ('crsold', 'Crs Old', 'salty', 'common', 'cast', 3), ('crsnew', 'Crs New', 'salty', 'common', 'cast', 3);
    insert into card_ledger (account, card, kind, price) select %1$L, 'crsold', 'bought', 0 from generate_series(1, 2);
  $sql$, r));
  perform extensions.dblink_connect('cr_s', url); perform extensions.dblink_connect('cr_b', url); perform extensions.dblink_connect('cr_s2', url);
  -- S buys a third copy and has not committed: it holds a row lock on the ledger. The move begins and must wait for it.
  perform extensions.dblink_exec('cr_s', 'begin');
  perform extensions.dblink_exec('cr_s', format('insert into card_ledger (account, card, kind, price) values (%L, ''crsold'', ''bought'', 0)', r));
  perform extensions.dblink_exec('cr_b', 'begin');
  perform extensions.dblink_send_query('cr_b', 'select card_leaves(''crsold'', ''crsnew'', null)');
  waited := 0; blocked := 0;
  while blocked = 0 and waited < max_waits loop
    perform pg_sleep(0.1); perform pg_stat_clear_snapshot(); waited := waited + 1;
    select count(*) into blocked from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%card_leaves%' and pid <> pg_backend_pid();
  end loop;
  if blocked = 0 then raise exception 'the move did not wait for an insert in flight: a copy bought as a card leaves is missed'; end if;
  perform extensions.dblink_exec('cr_s', 'commit');
  select t.r into got from extensions.dblink_get_result('cr_b') as t(r bigint);
  perform * from extensions.dblink_get_result('cr_b') as t(r bigint);
  if got is distinct from 3 then raise exception 'the move missed the copy that was in flight: % moved, 3 held', got; end if;
  -- B has not committed and holds the ledger: S2 buys a copy of the card that is leaving, and waits.
  perform extensions.dblink_exec('cr_s2', 'begin');
  perform extensions.dblink_send_query('cr_s2', format('insert into card_ledger (account, card, kind, price) values (%L, ''crsold'', ''bought'', 0)', r));
  waited := 0; blocked := 0;
  while blocked = 0 and waited < max_waits loop
    perform pg_sleep(0.1); perform pg_stat_clear_snapshot(); waited := waited + 1;
    select count(*) into blocked from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%insert into card_ledger%' and pid <> pg_backend_pid();
  end loop;
  if blocked = 0 then raise exception 'an insert into the ledger did not wait for the move''s table lock'; end if;
  perform extensions.dblink_exec('cr_b', 'commit');
  perform * from extensions.dblink_get_result('cr_s2') as t(x text);
  perform * from extensions.dblink_get_result('cr_s2') as t(x text);
  begin
    perform extensions.dblink_exec('cr_s2', 'commit');
    said := null;
  exception when others then
    said := sqlerrm;
  end;
  -- The moves are let in at commit where any other row for the gone card is not: a renamedOut or withdrawn row of it (a seed's, an opened pack's), and a row of the card it became.
  perform extensions.dblink_exec('cr_s', 'begin');
  perform extensions.dblink_exec('cr_s', format('insert into card_ledger (account, card, kind, price) values (%1$L, ''crsold'', ''renamedOut'', 0), (%1$L, ''crsold'', ''withdrawn'', 150), (%1$L, ''crsnew'', ''bought'', 0)', r));
  perform extensions.dblink_exec('cr_s', 'commit');
  if (select count(*) from card_ledger where account = r and card = 'crsold' and kind = 'renamedOut') is distinct from 4 or (select count(*) from card_ledger where account = r and card = 'crsold' and kind = 'withdrawn') is distinct from 1
     or (select count(*) from card_ledger where account = r and card = 'crsnew' and kind = 'bought') is distinct from 1 then raise exception 'a move of a gone card, or a row of the card it became, was refused at commit'; end if;
  perform extensions.dblink_disconnect('cr_s'); perform extensions.dblink_disconnect('cr_b'); perform extensions.dblink_disconnect('cr_s2');
  if said is null or said not like '%left the game%' then raise exception 'a copy bought after the card left was let in at commit: %', said; end if;
  if (select count(*) from card_ledger where account = r and card = 'crsold' and kind = 'bought') is distinct from 3 then raise exception 'the refused copy was kept'; end if;
  if card_held(r, 'crsold') <> -2 or card_held(r, 'crsnew') <> 4 then raise exception 'the race left % and % copies', card_held(r, 'crsold'), card_held(r, 'crsnew'); end if;
end $$;

-- A third account: a withdrawal's refund locks a wallet after the ledger's table lock, and a purchase (buy_card, buy_pack) locks the wallet first and inserts into the ledger after, taking no account row. S spends from the wallet
-- and has not inserted yet; the move starts and must not take the table lock before the wallet, or S's insert would wait for the table while the move waits for S's wallet: a deadlock one of them would be aborted for.
-- Either order is coherent, and neither may be a deadlock: here S's copy commits first and is counted and refunded.
do $$
declare
  r constant uuid := gen_random_uuid(); url text := current_setting('kayfabb.scratch_url'); waited integer; max_waits constant integer := 300; blocked integer; got bigint; err_s text; err_b text;
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'cr-race3@test.invalid');
    insert into accounts (id, created_at) values (%1$L, '2000-01-01T00:00:00Z');
    insert into wallets (account, balance) values (%1$L, 100);
    insert into card_kinds (key, name, alignment, rarity, play, stack) values ('crwold', 'Crw Old', 'salty', 'common', 'cast', 3);
    insert into card_ledger (account, card, kind, price) select %1$L, 'crwold', 'bought', 0 from generate_series(1, 2);
  $sql$, r));
  perform extensions.dblink_connect('cr_w', url); perform extensions.dblink_connect('cr_b', url);
  perform extensions.dblink_exec('cr_w', 'begin');
  perform * from extensions.dblink('cr_w', format('select wallet_spend(%L, 10, ''purchase'', null)', r)) as t(x integer);
  perform extensions.dblink_exec('cr_b', 'begin');
  perform extensions.dblink_send_query('cr_b', 'select card_leaves(''crwold'', null, 150)');
  waited := 0; blocked := 0;
  while blocked = 0 and waited < max_waits loop
    perform pg_sleep(0.1); perform pg_stat_clear_snapshot(); waited := waited + 1;
    select count(*) into blocked from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%card_leaves%' and pid <> pg_backend_pid();
  end loop;
  if blocked = 0 then raise exception 'the withdrawal did not wait for a wallet another session held'; end if;
  perform extensions.dblink_send_query('cr_w', format('insert into card_ledger (account, card, kind, price) values (%L, ''crwold'', ''bought'', 0)', r));
  waited := 0;
  while waited < 40 and extensions.dblink_is_busy('cr_w') = 1 and extensions.dblink_is_busy('cr_b') = 1 loop
    perform pg_sleep(0.1); waited := waited + 1;
  end loop;
  begin perform * from extensions.dblink_get_result('cr_w') as t(x text); perform * from extensions.dblink_get_result('cr_w') as t(x text); exception when others then err_s := sqlerrm; end;
  if err_s is null then
    begin perform extensions.dblink_exec('cr_w', 'commit'); exception when others then err_s := sqlerrm; end;
  end if;
  begin select t.r into got from extensions.dblink_get_result('cr_b') as t(r bigint); perform * from extensions.dblink_get_result('cr_b') as t(r bigint); exception when others then err_b := sqlerrm; end;
  if err_b is null then
    begin perform extensions.dblink_exec('cr_b', 'commit'); exception when others then err_b := sqlerrm; end;
  end if;
  begin perform extensions.dblink_exec('cr_w', 'rollback'); exception when others then null; end;
  begin perform extensions.dblink_exec('cr_b', 'rollback'); exception when others then null; end;
  perform extensions.dblink_disconnect('cr_w'); perform extensions.dblink_disconnect('cr_b');
  if err_s is not null or err_b is not null then raise exception 'the purchase and the withdrawal met: purchase says %, withdrawal says %', err_s, err_b; end if;
  if got is distinct from 3 then raise exception 'the withdrawal moved % copies, 3 held', got; end if;
  if (select balance from wallets where account = r) is distinct from 540 then raise exception 'the wallet should hold 100 - 10 + 3 x 150: %', (select balance from wallets where account = r); end if;
end $$;

select tests.unbecome();
create temp table w (name text primary key, id uuid not null);
grant select on w to public;

create function pg_temp.id(name text) returns uuid language sql as $$ select id from w where w.name = $1 $$;

-- The Random Event's setting with only the card outcome, drawing only legendary cards (the other fields are 0213's, as 0168 writes them).
create function pg_temp.events_on() returns void language plpgsql as $$
begin
  insert into settings (key, value) values ('cosmetics', jsonb_build_object('gear', jsonb_build_object('wornMost', 3, 'reach', 0.4), 'trophies', jsonb_build_object('shownMost', 3),
    'events', jsonb_build_object('windowMinutes', 1, 'dayMost', 1000, 'outcomes', '{"line": 1, "gear": 1, "card": 1000000000}'::jsonb, 'gearRarity', jsonb_build_object('common', 1),
      'cardRarity', jsonb_build_object('legendary', 1))))
  on conflict (key) do update set value = excluded.value;
  insert into event_lines (key, outcome, text) values ('cr-line-card', 'card', 'A card line.') on conflict (key) do nothing;
  insert into event_lines (key, outcome, text) values ('cr-line-line', 'line', 'A line.'), ('cr-line-gear', 'gear', 'A gear line.') on conflict (key) do nothing;
end $$;

-- A shim for the Boss's moves in force (machine_moves_open reads the Acts of landed moves, which this file does not need to write): one flash sale or Pull named by slot, so machine_now's own reading is what is under test.
create function pg_temp.moves(flash uuid, pull uuid) returns void language plpgsql as $$
begin
  execute format($v$create or replace view machine_moves_open as
    select m.slot, gen_random_uuid() as move_act, m.kind, now() as landed_at, now() + interval '1 day' as expires_at, null::numeric as percent, 24::numeric as hours, null::jsonb as demand, null::jsonb as progress
    from (values (%L::uuid, 'flashSale'::text), (%L::uuid, 'pullSlot'::text)) m(slot, kind) where m.slot is not null$v$, flash, pull);
end $$;


-- ---- 0. The world: cards, packs and slots, seeded once, every card in print ----
do $$
declare
  got jsonb;
begin
  got := seed_instance(pg_temp.pl(
    extra => jsonb_build_array(pg_temp.c('crhit', 'Cr Hit', 'legendary'), pg_temp.c('cralt', 'Cr Alt', 'legendary'), pg_temp.c('crcatch', 'Cr Catch'),
      pg_temp.c('crold', 'Cr Old', 'common', 'set'), pg_temp.c('crnew', 'Cr New', 'common', 'set'), pg_temp.c('crbye', 'Cr Bye', 'common', 'set'), pg_temp.c('crkeep', 'Cr Keep', 'common', 'set')),
    packs => jsonb_build_array(
      jsonb_build_object('key', 'cr-pull', 'pulls', jsonb_build_array(jsonb_build_object('weights', jsonb_build_object('legendary', 1))), 'leaves', '[]'::jsonb),
      jsonb_build_object('key', 'cr-fixed', 'contents', jsonb_build_array('crold', 'crbye', 'crkeep')),
      jsonb_build_object('key', 'cr-other', 'pulls', jsonb_build_array(jsonb_build_object('weights', jsonb_build_object('legendary', 1))), 'leaves', '[]'::jsonb)),
    machine => jsonb_build_array(
      jsonb_build_object('card', 'crhit', 'availability', 'onSale', 'price', 100), jsonb_build_object('card', 'crold', 'availability', 'onSale', 'price', 110),
      jsonb_build_object('card', 'crbye', 'availability', 'onSale', 'price', 120), jsonb_build_object('card', 'crkeep', 'availability', 'hidden', 'price', 130),
      jsonb_build_object('pack', 'cr-pull', 'availability', 'onSale', 'price', 140), jsonb_build_object('pack', 'cr-other', 'availability', 'onSale', 'price', 150))));
  perform pg_temp.expect(got ? 'retired' and got ? 'renamed' and got ? 'withdrawn', format('the seed answer lacks retired, renamed or withdrawn: %s', got));
  perform pg_temp.expect(got -> 'renamed' = '[]'::jsonb and got -> 'withdrawn' = '[]'::jsonb and got -> 'retired' = '[]'::jsonb, format('a first seed with nothing leaving reported leaving: %s', got));
  perform pg_temp.expect((select count(*) from card_kinds where key like 'cr%' and key !~ '^cr[rsw]') = 7, 'the seed wrote the cards');
end $$;

-- ---- 1. The columns and their checks ----
do $$
declare
  why text;
begin
  perform pg_temp.expect((select count(*) from information_schema.columns where table_name = 'card_kinds' and column_name in ('retired_at', 'gone_at', 'became', 'refund')) = 4, 'card_kinds lacks a column');
  perform pg_temp.expect(exists (select 1 from information_schema.columns where table_name = 'pack_kinds' and column_name = 'retired_at'), 'pack_kinds lacks retired_at');
  why := pg_temp.coded($q$update card_kinds set became = 'crnew' where key = 'crhit'$q$);
  perform pg_temp.expect(why like '23514%', format('a became with no gone_at was let in: %s', why));
  why := pg_temp.coded($q$update card_kinds set refund = 100 where key = 'crhit'$q$);
  perform pg_temp.expect(why like '23514%', format('a refund with no gone_at was let in: %s', why));
  why := pg_temp.coded($q$update card_kinds set gone_at = now() where key = 'crhit'$q$);
  perform pg_temp.expect(why like '23514%', format('a gone card with neither a became nor a refund was let in: %s', why));
  why := pg_temp.coded($q$update card_kinds set gone_at = now(), became = 'crnew', refund = 100 where key = 'crhit'$q$);
  perform pg_temp.expect(why like '23514%', format('a gone card that became a card and was refunded was let in: %s', why));
  why := pg_temp.coded($q$update card_kinds set gone_at = now(), refund = 0 where key = 'crhit'$q$);
  perform pg_temp.expect(why like '23514%', format('a refund of nothing was let in: %s', why));
  why := pg_temp.coded($q$update card_kinds set gone_at = now(), retired_at = now(), refund = 100 where key = 'crhit'$q$);
  perform pg_temp.expect(why like '23514%', format('a card both retired and gone was let in: %s', why));
  why := pg_temp.coded($q$update card_kinds set gone_at = now(), became = 'nosuchcard' where key = 'crhit'$q$);
  perform pg_temp.expect(why like '23503%', format('a became that names no card was let in: %s', why));
  -- The ledger's kinds and the wallet's: a row of each is let in where it is shaped right and refused where it is not (an Act on a kind that carries none, none on a kind that needs one, a refund of nothing).
  perform tests.account('cr-shape');
  why := pg_temp.fits(format($q$insert into card_ledger (account, card, kind, price) values (%L, 'crnew', 'renamedIn', 0)$q$, (select id from auth.users where email = 'cr-shape@test.invalid')));
  perform pg_temp.expect(why is null, format('a renamedIn with no Act was refused: %s', why));
  why := pg_temp.fits(format($q$insert into card_ledger (account, card, kind, price) values (%L, 'crold', 'renamedOut', 0)$q$, (select id from auth.users where email = 'cr-shape@test.invalid')));
  perform pg_temp.expect(why is null, format('a renamedOut with no Act was refused: %s', why));
  why := pg_temp.fits(format($q$insert into card_ledger (account, card, kind, price) values (%L, 'crbye', 'withdrawn', 150)$q$, (select id from auth.users where email = 'cr-shape@test.invalid')));
  perform pg_temp.expect(why is null, format('a withdrawn with a refund as its price was refused: %s', why));
  why := pg_temp.fits(format($q$insert into card_ledger (account, card, kind, price) values (%L, 'crbye', 'withdrawn', 0)$q$, (select id from auth.users where email = 'cr-shape@test.invalid')));
  perform pg_temp.expect(why like '23514%', format('a withdrawn that refunded nothing was let in: %s', why));
  why := pg_temp.fits(format($q$insert into card_ledger (account, card, kind, price) values (%L, 'crnew', 'renamedIn', 5)$q$, (select id from auth.users where email = 'cr-shape@test.invalid')));
  perform pg_temp.expect(why like '23514%', format('a renamedIn that cost something was let in: %s', why));
  perform pg_temp.expect(pg_temp.fits(format($q$insert into wallet_events (account, kind, change, balance_after) values (%L, 'withdrawal', 1, 1)$q$, (select id from auth.users where email = 'cr-shape@test.invalid'))) is null,
    'the wallet refused a withdrawal');
end $$;

-- ---- 2. Out of print: no roll gives it, a held copy still plays, listing it again brings it back ----
do $$
declare
  ann uuid := tests.account('cr-ann'); a uuid := tests.character(ann, 'Cr Ann'); bob uuid := tests.account('cr-bob'); b uuid := tests.character(bob, 'Cr Bob');
  evt uuid := tests.account('cr-evt'); e1 uuid := tests.character(evt, 'Cr Evt');
  t uuid := tests.thread('Cr outs'); bp uuid := tests.post(b, t, 'Bob''s post.');
  seen text[]; ev jsonb; drawn text[];
  weights constant jsonb := '[{"weights": {"legendary": 1}}]';
  -- Legendary cards the suite's earlier files left committed are out of this roll: the pack leaves out every card but this file's two.
  leaves constant text[] := array(select k.key from card_kinds k where k.key not in ('crhit', 'cralt'));
begin
  perform pg_temp.hand(ann, 'crhit', 2);
  -- Before: the roll gives both legendary cards, and the Random Event's card outcome both.
  perform setseed(0.42);
  select coalesce(array_agg(distinct x), '{}') into seen from (select unnest(roll_pack(weights, leaves)) x from generate_series(1, 60)) r;
  perform pg_temp.expect(seen = array['cralt', 'crhit'], format('the roll before the retirement gave %s', seen));
  perform pg_temp.expect(exists (select 1 from draw_pool('card', '{}', true) p where p.key = 'crhit'), 'draw_pool lacks a card in print');

  -- The Random Event's card outcome reads the same pool: while the card is in print it comes up (a control, over many draws: the suite's earlier files leave other legendary cards), and out of print it never does.
  perform tests.become_service();
  perform pg_temp.events_on();
  drawn := '{}';
  for i in 1..80 loop
    delete from random_event_rolls where account = evt;
    ev := random_event(evt, e1);
    perform tests.unbecome();
    perform pg_temp.expect(ev is not null and ev ->> 'outcome' = 'card', format('a card roll gave %s', ev));
    drawn := drawn || (ev ->> 'item');
    perform tests.become_service();
  end loop;
  perform tests.unbecome();
  perform pg_temp.expect('crhit' = any (drawn), 'the Random Event never gave a card in print, so its pool is not under test');
  ev := seed_instance(pg_temp.pl(retire => array['crhit']));
  perform pg_temp.expect(ev -> 'retired' = '["crhit"]'::jsonb, format('the answer names the card retired: %s', ev));
  perform pg_temp.expect((select retired_at from card_kinds where key = 'crhit') is not null, 'the seed stamped no retired_at');
  perform pg_temp.expect((select gone_at from card_kinds where key = 'crhit') is null, 'an out of print card is not gone');
  perform setseed(0.42);
  select coalesce(array_agg(distinct x), '{}') into seen from (select unnest(roll_pack(weights, leaves)) x from generate_series(1, 200)) r;
  perform pg_temp.expect(seen = array['cralt'], format('a roll gave a card out of print, or none: %s', seen));
  perform pg_temp.expect(not exists (select 1 from draw_pool('card', '{}', true) p where p.key = 'crhit'), 'draw_pool gives a card out of print');
  perform tests.become_service();
  perform pg_temp.events_on();
  drawn := '{}';
  for i in 1..80 loop
    delete from random_event_rolls where account = evt;
    ev := random_event(evt, e1);
    perform tests.unbecome();
    drawn := drawn || (ev ->> 'item');
    perform tests.become_service();
  end loop;
  perform tests.unbecome();
  perform pg_temp.expect(cardinality(drawn) = 80 and not ('crhit' = any (drawn)), format('a Random Event gave a card out of print: %s', drawn));

  -- The hand's copies stay playable: a play of a held one lands.
  perform pg_temp.expect(card_held(ann, 'crhit') = 2, 'a retired card''s held copies are counted');
  perform tests.become_service();
  ev := play_card(ann, 'crhit', a, bp, '{}', 0, '');
  perform tests.unbecome();
  perform pg_temp.expect(ev ->> 'id' is not null and card_held(ann, 'crhit') = 1, format('a card out of print could not be played: %s', ev));

  -- Seeding it retired again keeps the date it was stamped; listing it again clears it and the roll gives it again.
  update card_kinds set retired_at = '2020-01-01T00:00:00Z' where key = 'crhit';
  perform seed_instance(pg_temp.pl());
  perform pg_temp.expect((select retired_at from card_kinds where key = 'crhit') = '2020-01-01T00:00:00Z', 'a second seed of the flag moved its date');
  ev := seed_instance(pg_temp.pl(unretire => array['crhit']));
  perform pg_temp.expect((select retired_at from card_kinds where key = 'crhit') is null and ev -> 'retired' = '[]'::jsonb, 'listing the card again did not clear retired_at');
  perform setseed(0.42);
  select coalesce(array_agg(distinct x), '{}') into seen from (select unnest(roll_pack(weights, leaves)) x from generate_series(1, 60)) r;
  perform pg_temp.expect(seen = array['cralt', 'crhit'], format('the roll did not give the card in print again: %s', seen));
end $$;

-- ---- 3. The world of players: hands, and backs face down on the cards that will leave ----
do $$
declare
  rn1 uuid := tests.account('cr-rn1'); rn2 uuid := tests.account('cr-rn2'); ctl uuid := tests.account('cr-ctl'); wd1 uuid := tests.account('cr-wd1'); wd2 uuid := tests.account('cr-wd2');
  cc uuid := tests.account('cr-cc'); sp uuid := tests.account('cr-sp');
  c_rn1 uuid := tests.character(rn1, 'Cr Rn One'); c_rn2 uuid := tests.character(rn2, 'Cr Rn Two'); c_ctl uuid := tests.character(ctl, 'Cr Ctl'); c_wd1 uuid := tests.character(wd1, 'Cr Wd One');
  c_wd2 uuid := tests.character(wd2, 'Cr Wd Two'); c_cc uuid := tests.character(cc, 'Cr Caster'); c_sp uuid := tests.character(sp, 'Cr Sealed');
  t uuid := tests.thread('Cr backs');
  q1 uuid := tests.post(c_rn1, t, 'Rn one''s post.'); q2 uuid := tests.post(c_rn2, t, 'Rn two''s post.'); q3 uuid := tests.post(c_ctl, t, 'The control''s post.'); q4 uuid := tests.post(c_wd1, t, 'Wd one''s post.');
  b1 uuid; b2 uuid; b3 uuid; b4 uuid;
begin
  perform pg_temp.hand(rn1, 'crold', 3); perform pg_temp.hand(rn2, 'crold', 1); perform pg_temp.hand(ctl, 'crkeep', 1);
  perform pg_temp.hand(wd1, 'crbye', 3); perform pg_temp.hand(wd2, 'crbye', 2); perform pg_temp.hand(cc, 'crcatch', 6);
  perform tests.become_service();
  b1 := (set_card(rn1, 'crold', c_rn1, q1, '{}', 0, 'crcatch') ->> 'id')::uuid;
  b2 := (set_card(rn2, 'crold', c_rn2, q2, '{}', 0, 'crcatch') ->> 'id')::uuid;
  b3 := (set_card(ctl, 'crkeep', c_ctl, q3, '{}', 0, 'crcatch') ->> 'id')::uuid;
  b4 := (set_card(wd1, 'crbye', c_wd1, q4, '{}', 0, 'crcatch') ->> 'id')::uuid;
  perform tests.unbecome();
  -- rn2's back ends before the seed, unsprung and untaken: it counts back into the hand, as card_held has always counted it. The append-only trigger is lifted for this one statement and back at once.
  alter table face_down disable trigger face_down_no_update;
  update face_down set ends_at = now() - interval '1 second' where play = b2;
  alter table face_down enable always trigger face_down_no_update;
  insert into packs (account, pack, price, contents, source) values (sp, 'cr-fixed', 0, array['crold', 'crbye', 'crkeep'], 'welcome');
  insert into wallets (account, balance) values (wd2, 500);
  insert into w values ('rn1', rn1), ('rn2', rn2), ('ctl', ctl), ('wd1', wd1), ('wd2', wd2), ('cc', cc), ('sp', sp),
    ('c_rn1', c_rn1), ('c_rn2', c_rn2), ('c_ctl', c_ctl), ('c_wd1', c_wd1), ('c_cc', c_cc), ('c_sp', c_sp), ('t', t),
    ('q1', q1), ('q2', q2), ('q3', q3), ('q4', q4), ('b1', b1), ('b2', b2), ('b3', b3), ('b4', b4);
  perform pg_temp.expect(card_held(rn1, 'crold') = 2 and (select count(*) from face_down where account = rn1) = 1, format('rn1 should hold 2 and have a back: %s', card_held(rn1, 'crold')));
  perform pg_temp.expect(card_held(rn2, 'crold') = 1, format('rn2''s ended back should count back into the hand: %s', card_held(rn2, 'crold')));
  perform pg_temp.expect(card_held(wd1, 'crbye') = 2, 'wd1 holds 2');
end $$;

-- Snapshots of the rows no seed may edit, to compare after everything below ("Append-only"): every existing row of the four tables as it is now.
create temp table before_rows as
  select 'card_ledger' as t, md5(coalesce(string_agg(l::text, '|' order by l.id), '')) as h from card_ledger l
  union all select 'face_down', md5(coalesce(string_agg(row(f.play, f.account, f.card, f.config, f.post, f.thread, f.round, f.catches, f.phrase, f.passage, f.who)::text, '|' order by f.play), '')) from face_down f
  union all select 'packs', md5(coalesce(string_agg(p::text, '|' order by p.id), '')) from packs p
  union all select 'machine_slots', md5(coalesce(string_agg(s::text, '|' order by s.id), '')) from machine_slots s;
create temp table before_counts as select (select count(*) from card_ledger) as ledger, (select count(*) from face_down) as backs, (select count(*) from packs) as packs, (select count(*) from machine_slots) as slots, (select coalesce(max(id), 0) from card_ledger) as max_ledger;
grant select on before_rows, before_counts to public;

-- ---- 4. The shape guard: a key the payload lists nowhere is refused, naming it, and nothing is written ----
do $$
declare
  why text; ledger_before bigint := (select count(*) from card_ledger);
begin
  why := pg_temp.coded($q$select seed_instance(pg_temp.pl(drop_keys => array['cralt']))$q$);
  perform pg_temp.expect(why like '22023%' and why like '%cralt%', format('a seed that drops a card was not refused naming it: %s', why));
  why := pg_temp.coded($q$select seed_instance(pg_temp.pl(drop_keys => array['cralt', 'crcatch']))$q$);
  perform pg_temp.expect(why like '22023%' and why like '%cralt%' and why like '%crcatch%', format('a seed that drops two cards was not refused naming both: %s', why));
  perform pg_temp.expect(not exists (select 1 from card_kinds where gone_at is not null and key !~ '^cr[rsw]') and (select count(*) from card_ledger) = ledger_before, 'a refused seed wrote');
  -- The guard is for what a seed wrote: a card row put in directly (a test's, a hand's) is not the seed's to account for, and a seeded one dropped is.
  insert into card_kinds (key, name, alignment, rarity, play) values ('crdirect', 'Cr Direct', 'salty', 'common', 'cast');
  perform pg_temp.expect((select from_seed from card_kinds where key = 'cralt') and not (select from_seed from card_kinds where key = 'crdirect'), 'from_seed is true for a seeded card and false for one inserted directly');
  perform pg_temp.expect(pg_temp.coded($q$select seed_instance(pg_temp.pl(drop_keys => array['crdirect']))$q$) is null, 'a seed refused a row it never wrote');
  perform pg_temp.expect((select not from_seed from card_kinds where key = 'crdirect'), 'a seed marked a row it did not list');
  -- A key in more than one list is refused too, and a renaming into a card the seed does not list.
  why := pg_temp.coded($q$select seed_instance(pg_temp.pl(rename => '[{"key": "crold", "name": "Cr Old", "became": "crnew"}]', withdraw => '[{"key": "crold", "name": "Cr Old", "refund": 100}]'))$q$);
  perform pg_temp.expect(why like '22023%' and why like '%crold%', format('a key in two lists was not refused naming it: %s', why));
  why := pg_temp.coded($q$select seed_instance(pg_temp.pl(rename => '[{"key": "crold", "name": "Cr Old", "became": "crzzz"}]'))$q$);
  perform pg_temp.expect(why like '22023%' and why like '%crzzz%', format('a renaming into a card the seed does not list was not refused naming it: %s', why));
  why := pg_temp.coded($q$select seed_instance(pg_temp.pl(rename => '[{"key": "crkeep", "name": "Cr Keep", "became": "crkeep"}]'))$q$);
  perform pg_temp.expect(why like '22023%' and why like '%crkeep%', format('a card that became itself was not refused: %s', why));
end $$;

-- ---- 5. Renamed: every copy an account holds, held or face down, moves once ----
do $$
declare
  rn1 uuid := pg_temp.id('rn1'); rn2 uuid := pg_temp.id('rn2'); ctl uuid := pg_temp.id('ctl');
  b1 uuid := pg_temp.id('b1'); b2 uuid := pg_temp.id('b2');
  ev jsonb; ledger_n bigint; wallet_n bigint; kept_ctl integer;
begin
  kept_ctl := card_held(ctl, 'crkeep');
  ev := seed_instance(pg_temp.pl(rename => '[{"key": "crold", "name": "Cr Old", "became": "crnew"}]'));
  perform pg_temp.expect(ev -> 'renamed' = '[{"from": "crold", "to": "crnew", "copies": 4}]'::jsonb, format('the answer should total the copies moved, 3 and 1: %s', ev -> 'renamed'));
  perform pg_temp.expect(ev -> 'withdrawn' = '[]'::jsonb, 'a rename reported a withdrawal');
  perform pg_temp.expect((select gone_at is not null and became = 'crnew' and retired_at is null from card_kinds where key = 'crold'), 'the seed did not mark crold gone, became crnew');
  -- rn1: 2 held and 1 live back -> 3 rows each way; the back's renamedOut names its play, the held copies' name none.
  perform pg_temp.expect((select count(*) from card_ledger where account = rn1 and card = 'crold' and kind = 'renamedOut') = 3, 'rn1 should have 3 renamedOut rows');
  perform pg_temp.expect((select count(*) from card_ledger where account = rn1 and card = 'crold' and kind = 'renamedOut' and act is null) = 2, 'two of them are held copies, with no Act');
  perform pg_temp.expect((select array_agg(act) from card_ledger where account = rn1 and card = 'crold' and kind = 'renamedOut' and act is not null) = array[b1], 'the third names the back''s play');
  perform pg_temp.expect((select count(*) from card_ledger where account = rn1 and card = 'crnew' and kind = 'renamedIn' and act is null) = 3, 'rn1 should have 3 renamedIn rows');
  perform pg_temp.expect(card_held(rn1, 'crold') = 0 and card_held(rn1, 'crnew') = 3, format('rn1''s hand moved by %s and %s', card_held(rn1, 'crold'), card_held(rn1, 'crnew')));
  -- rn2's back had ended before the seed, so its copy was a held one: one row each way, none naming a play.
  perform pg_temp.expect((select count(*) from card_ledger where account = rn2 and kind = 'renamedOut' and act is null) = 1 and (select count(*) from card_ledger where account = rn2 and kind = 'renamedIn') = 1, 'rn2 should move one copy');
  perform pg_temp.expect(card_held(rn2, 'crold') = 0 and card_held(rn2, 'crnew') = 1, format('rn2''s ended back counted twice or not at all: %s and %s', card_held(rn2, 'crold'), card_held(rn2, 'crnew')));
  perform pg_temp.expect(card_held(ctl, 'crkeep') = kept_ctl, 'a card that did not leave moved');
  -- A second seed with the same payload writes nothing in the ledger or the wallet and reports nothing moved.
  ledger_n := (select count(*) from card_ledger); wallet_n := (select count(*) from wallet_events);
  ev := seed_instance(pg_temp.pl());
  perform pg_temp.expect(ev -> 'renamed' = '[]'::jsonb, format('a second seed reported a rename: %s', ev -> 'renamed'));
  perform pg_temp.expect((select count(*) from card_ledger) = ledger_n and (select count(*) from wallet_events) = wallet_n, 'a second seed of the same payload wrote rows');
  -- The player's own log: the new rows as they are. rn2's back ended before the seed: it came home (the synthesized `returned` row) and the rename then moved that copy.
  perform tests.become(rn2);
  perform pg_temp.expect((select count(*) from my_card_ledger where card = 'crold' and kind = 'returned') = 1 and (select count(*) from my_card_ledger where card = 'crold' and kind = 'renamedOut' and act is null) = 1,
    'a back that ended before the rename came home once and was moved once, and the log should show both');
  perform tests.unbecome();
  perform tests.become(rn1);
  perform pg_temp.expect((select count(*) from my_card_ledger where card = 'crold' and kind = 'renamedOut') = 3 and (select count(*) from my_card_ledger where card = 'crnew' and kind = 'renamedIn') = 3, 'my_card_ledger lacks the rename''s rows');
  perform pg_temp.expect((select count(*) from my_card_ledger where card = 'crold' and kind = 'renamedOut' and act = b1) = 1, 'the back''s row shows its play');
  perform pg_temp.expect((select held from my_cards where card = 'crold') = 0 and (select held from my_cards where card = 'crnew') = 3, 'my_cards disagrees with card_held');
  perform tests.unbecome();
  -- A key that left cannot be listed as a card again: it is refused, naming it.
  perform pg_temp.expect(pg_temp.coded(format($q$select seed_instance(jsonb_set(pg_temp.pl(), '{cards}', (pg_temp.pl() -> 'cards') || %L::jsonb))$q$, pg_temp.c('crold', 'Cr Old', 'common', 'set'))) like '22023%crold%',
    'a gone key listed as a card was not refused naming it');
end $$;

-- ---- 6. Withdrawn: every copy refunded once, one wallet move per account, the overflow recorded ----
do $$
declare
  wd1 uuid := pg_temp.id('wd1'); wd2 uuid := pg_temp.id('wd2'); b4 uuid := pg_temp.id('b4');
  ev jsonb; ledger_n bigint; wallet_n bigint;
begin
  ev := seed_instance(pg_temp.pl(withdraw => '[{"key": "crbye", "name": "Cr Bye", "refund": 150}]'));
  perform pg_temp.expect(ev -> 'withdrawn' = '[{"key": "crbye", "copies": 5, "refunded": 750}]'::jsonb, format('the answer should total 5 copies and 750 refunded: %s', ev -> 'withdrawn'));
  perform pg_temp.expect(ev -> 'renamed' = '[]'::jsonb, 'a withdrawal reported a rename');
  perform pg_temp.expect((select gone_at is not null and became is null and refund = 150 from card_kinds where key = 'crbye'), 'the seed did not mark crbye gone with its refund');
  -- wd1: 2 held and 1 live back -> 3 withdrawn rows at the refund, one of them naming the back's play, and one wallet event of 3 x 150.
  perform pg_temp.expect((select count(*) from card_ledger where account = wd1 and card = 'crbye' and kind = 'withdrawn' and price = 150) = 3, 'wd1 should have 3 withdrawn rows at 150');
  perform pg_temp.expect((select array_agg(act) from card_ledger where account = wd1 and kind = 'withdrawn' and act is not null) = array[b4], 'the back''s withdrawn row names its play');
  perform pg_temp.expect(card_held(wd1, 'crbye') = 0, format('wd1 still holds %s', card_held(wd1, 'crbye')));
  perform pg_temp.expect((select count(*) from wallet_events where account = wd1 and kind = 'withdrawal') = 1 and (select change from wallet_events where account = wd1 and kind = 'withdrawal') = 450, 'wd1 should have one withdrawal event of 450');
  perform pg_temp.expect((select balance from wallets where account = wd1) = 450, 'wd1''s wallet did not take 450');
  -- wd2 was 100 below the cap: 2 x 150 credits 100 and overflows 200, recorded as every credit records it.
  perform pg_temp.expect((select change = 100 and overflow = 200 and balance_after = 600 from wallet_events where account = wd2 and kind = 'withdrawal'), format('wd2''s overflow was not recorded: %s',
    (select to_jsonb(e) from wallet_events e where e.account = wd2 and e.kind = 'withdrawal')));
  -- A second seed writes nothing.
  ledger_n := (select count(*) from card_ledger); wallet_n := (select count(*) from wallet_events);
  ev := seed_instance(pg_temp.pl());
  perform pg_temp.expect(ev -> 'withdrawn' = '[]'::jsonb, 'a second seed reported a withdrawal');
  perform pg_temp.expect((select count(*) from card_ledger) = ledger_n and (select count(*) from wallet_events) = wallet_n, 'a second seed of the same payload wrote rows');
end $$;

-- ---- 7. A sealed pack that holds a gone key: the new card, or a refund at opening ----
do $$
declare
  sp uuid := pg_temp.id('sp'); pk uuid := (select id from packs where account = pg_temp.id('sp')); got jsonb;
begin
  perform tests.become(sp);
  got := open_pack(pk);
  perform tests.unbecome();
  perform pg_temp.expect(got -> 'contents' = '["crnew", "crbye", "crkeep"]'::jsonb, format('the opened pack should show the new card in place of the old: %s', got));
  perform pg_temp.expect(got -> 'refunds' = '[{"index": 1, "refund": 150}]'::jsonb, format('the opening should name the refunded card: %s', got));
  perform pg_temp.expect((select array_agg(card order by id) from card_ledger where account = sp and kind = 'pulled' and pack = pk) = array['crnew', 'crkeep'], 'the pulled rows should be the new card and the kept one');
  perform pg_temp.expect((select price = 150 and act is null from card_ledger where account = sp and kind = 'withdrawn' and pack = pk and card = 'crbye'), 'the withdrawn card should be a withdrawn row at its refund');
  perform pg_temp.expect(card_held(sp, 'crnew') = 1 and card_held(sp, 'crkeep') = 1 and card_held(sp, 'crbye') = 0 and card_held(sp, 'crold') = 0, 'the hand after the opening is wrong');
  perform pg_temp.expect((select count(*) from wallet_events where account = sp and kind = 'withdrawal') = 1 and (select change from wallet_events where account = sp and kind = 'withdrawal') = 150, 'the pack''s refund should be one withdrawal event');
  perform tests.become(sp);
  perform pg_temp.expect((select count(*) from my_card_ledger where kind = 'withdrawn' and card = 'crbye') = 1, 'the log lacks the opened pack''s refund');
  perform pg_temp.expect((select held from my_cards where card = 'crbye') = 0, 'my_cards counts a refunded copy');
  perform tests.unbecome();
end $$;

-- ---- 8. A back of a gone key never springs, take_back of it is refused in plain words, and its end adds no copy ----
do $$
declare
  rn1 uuid := pg_temp.id('rn1'); wd1 uuid := pg_temp.id('wd1'); ctl uuid := pg_temp.id('ctl'); cc uuid := pg_temp.id('cc');
  c_rn1 uuid := pg_temp.id('c_rn1'); c_wd1 uuid := pg_temp.id('c_wd1'); c_ctl uuid := pg_temp.id('c_ctl'); c_cc uuid := pg_temp.id('c_cc'); c_rn2 uuid := pg_temp.id('c_rn2');
  q1 uuid := pg_temp.id('q1'); q3 uuid := pg_temp.id('q3'); q4 uuid := pg_temp.id('q4'); b1 uuid := pg_temp.id('b1'); b3 uuid := pg_temp.id('b3'); b4 uuid := pg_temp.id('b4');
  got jsonb; why text; day text := to_char(now() at time zone 'UTC', 'FMMon FMDD, YYYY');
  ends1 text := to_char((select ends_at from face_down where play = pg_temp.id('b1')) at time zone 'UTC', 'FMMon FMDD, YYYY');
  ends4 text := to_char((select ends_at from face_down where play = pg_temp.id('b4')) at time zone 'UTC', 'FMMon FMDD, YYYY');
begin
  perform tests.become_service();
  -- The control: a cast meets a back of a card still in print and is caught. The same cast on a back of a renamed key, and of a withdrawn one, lands and springs nothing.
  got := play_card(cc, 'crcatch', c_cc, q3, '{}', 0, '');
  perform pg_temp.expect(got -> 'payload' ? 'caught' and exists (select 1 from acts where kind = 'spring' and payload ->> 'set' = b3::text), format('the control back did not catch: %s', got));
  got := play_card(cc, 'crcatch', c_cc, q1, '{}', 0, '');
  perform pg_temp.expect(not (got -> 'payload' ? 'caught') and not exists (select 1 from acts where kind = 'spring' and payload ->> 'set' = b1::text), format('a back of a renamed key sprang: %s', got));
  got := play_card(cc, 'crcatch', c_cc, q4, '{}', 0, '');
  perform pg_temp.expect(not (got -> 'payload' ? 'caught') and not exists (select 1 from acts where kind = 'spring' and payload ->> 'set' = b4::text), format('a back of a withdrawn key sprang: %s', got));
  -- take_back of such a back, by its own setter, is refused in the design's words, from card_kinds' names and the dates of gone_at and the back's end; the back stays.
  why := pg_temp.coded(format('select take_back(%L, %L, %L)', rn1, c_rn1, b1));
  perform pg_temp.expect(why = format('P0001 kayfabb.refusal Cr Old was renamed to Cr New on %s, and this copy is in your hand as one. Its back ends by itself on %s.', day, ends1), format('the renamed refusal read: %s', why));
  why := pg_temp.coded(format('select take_back(%L, %L, %L)', wd1, c_wd1, b4));
  perform pg_temp.expect(why = format('P0001 kayfabb.refusal Cr Bye was withdrawn on %s, and this copy was refunded then. Its back ends by itself on %s.', day, ends4), format('the withdrawn refusal read: %s', why));
  perform pg_temp.expect(not exists (select 1 from acts where kind = 'take_back' and payload ->> 'set' in (b1::text, b4::text)), 'a refused take_back wrote an Act');
  -- Anyone but the back's setter meets the words every refused take_back has always had, and learns nothing of the card.
  why := pg_temp.coded(format('select take_back(%L, %L, %L)', ctl, c_ctl, b1));
  perform pg_temp.expect(why = 'P0002 kayfabb.refusal there is no face-down card to take back there', format('another player''s take_back said: %s', why));
  perform pg_temp.expect(pg_temp.coded(format('select take_back(%L, %L, %L)', ctl, c_ctl, b3)) like 'P0002%', 'the control''s back was already caught');
  perform tests.unbecome();
  -- The back ends by itself and adds no copy to the old key, the new one or the wallet.
  alter table face_down disable trigger face_down_no_update;
  update face_down set ends_at = now() - interval '1 second' where play in (b1, b4);
  alter table face_down enable always trigger face_down_no_update;
  perform pg_temp.expect(card_held(rn1, 'crold') = 0 and card_held(rn1, 'crnew') = 3, format('an ended back of a renamed key changed a hand: %s, %s', card_held(rn1, 'crold'), card_held(rn1, 'crnew')));
  perform pg_temp.expect(card_held(wd1, 'crbye') = 0, 'an ended back of a withdrawn key came back into the hand');
  perform tests.become(rn1);
  perform pg_temp.expect((select count(*) from my_card_ledger where card = 'crold' and kind = 'returned') = 0, 'my_card_ledger showed a returned row for a back that was renamed');
  perform pg_temp.expect((select count(*) from my_card_ledger where card = 'crold' and kind = 'renamedOut' and act = b1) = 1 and (select count(*) from my_card_ledger where card = 'crold' and kind = 'renamedOut') = 3, 'my_card_ledger lacks the rename''s rows');
  perform pg_temp.expect((select held from my_cards where card = 'crold') = 0 and (select held from my_cards where card = 'crnew') = 3, 'my_cards disagrees with card_held');
  perform tests.unbecome();
  perform tests.become(wd1);
  perform pg_temp.expect((select count(*) from my_card_ledger where card = 'crbye' and kind = 'returned') = 0 and (select count(*) from my_card_ledger where card = 'crbye' and kind = 'withdrawn') = 3, 'my_card_ledger shows a refunded back wrongly');
  perform tests.unbecome();
end $$;

-- ---- 9. The machine: a slot of a card or pack that has left sells nothing and shows nothing ----
do $$
declare
  s_hit uuid := (select id from machine_slots where card = 'crhit'); s_old uuid := (select id from machine_slots where card = 'crold'); s_bye uuid := (select id from machine_slots where card = 'crbye');
  s_keep uuid := (select id from machine_slots where card = 'crkeep'); s_pull uuid := (select id from machine_slots where pack = 'cr-pull'); s_other uuid := (select id from machine_slots where pack = 'cr-other');
  buyer uuid := pg_temp.id('cc'); adm uuid := tests.account('cr-admin'); why text; shown jsonb; row_of jsonb;
begin
  perform pg_temp.expect(exists (select 1 from machine_now where slot = s_hit) and exists (select 1 from machine_now where slot = s_pull) and exists (select 1 from machine_now where slot = s_other), 'a slot in print is absent');
  -- A renamed card's slot and a withdrawn card's slot are gone from the machine, and every sale refuses them in the missing slot's words.
  perform pg_temp.expect(not exists (select 1 from machine_now where slot in (s_old, s_bye)), 'a slot of a gone card is shown');
  foreach why in array array[s_old::text, s_bye::text] loop
    perform pg_temp.expect(pg_temp.coded(format($q$select slot_for_sale(%L, 'card', 110)$q$, why)) = 'P0002 kayfabb.refusal the machine has no such slot', 'slot_for_sale did not refuse a gone slot as a missing one');
    perform pg_temp.expect(pg_temp.coded(format($q$select buy_card(%L, %L, 110)$q$, buyer, why)) = 'P0002 kayfabb.refusal the machine has no such slot', 'buy_card sold a gone slot, or said something else');
  end loop;
  -- Out of print: the slot goes while the flag stays, and comes back at its price and availability as they were when it is listed again.
  perform seed_instance(pg_temp.pl(retire => array['crhit']));
  perform pg_temp.expect(not exists (select 1 from machine_now where slot = s_hit), 'the slot of a card out of print is shown');
  perform pg_temp.expect(pg_temp.coded(format($q$select buy_card(%L, %L, 100)$q$, buyer, s_hit)) = 'P0002 kayfabb.refusal the machine has no such slot', 'buy_card sold a card out of print');
  perform pg_temp.expect((select price = 100 and availability = 'onSale' from machine_slots where id = s_hit), 'the seed edited the slot');
  perform seed_instance(pg_temp.pl(unretire => array['crhit']));
  perform pg_temp.expect((select price = 100 and availability = 'onSale' from machine_now where slot = s_hit), 'listing the card again did not bring its slot back as it was');
  -- A pack kind the payload stops listing is out of print: its slot goes, a purchase is refused alike, listing it again brings it back.
  perform seed_instance(pg_temp.pl(packs => (select jsonb_agg(p) from jsonb_array_elements(pg_temp.pl() -> 'packs') p where p ->> 'key' <> 'cr-other')));
  perform pg_temp.expect((select retired_at from pack_kinds where key = 'cr-other') is not null and (select retired_at from pack_kinds where key = 'cr-pull') is null, 'the seed did not retire exactly the pack it stopped listing');
  perform pg_temp.expect(not exists (select 1 from machine_now where slot = s_other) and exists (select 1 from machine_now where slot = s_pull), 'the slot of a retired pack kind is shown, or a listed one is not');
  perform pg_temp.expect(pg_temp.coded(format($q$select buy_pack(%L, %L, 150)$q$, buyer, s_other)) = 'P0002 kayfabb.refusal the machine has no such slot', 'buy_pack sold a retired pack kind');
  perform pg_temp.expect(not exists (select 1 from card_ledger where account = buyer and kind = 'pulled'), 'a refused pack purchase wrote');
  -- admin_machine says why, plainly.
  insert into admins (account) values (adm);
  perform tests.become(adm);
  shown := admin_machine();
  perform tests.unbecome();
  row_of := (select e from jsonb_array_elements(shown) e where e ->> 'slot' = s_other::text);
  perform pg_temp.expect(row_of -> 'retired' = 'true'::jsonb and not (row_of ? 'withdrawn'), format('a retired pack slot read: %s', row_of));
  row_of := (select e from jsonb_array_elements(shown) e where e ->> 'slot' = s_pull::text);
  perform pg_temp.expect(row_of -> 'retired' = 'false'::jsonb, format('a pack in print read: %s', row_of));
  row_of := (select e from jsonb_array_elements(shown) e where e ->> 'slot' = s_old::text);
  perform pg_temp.expect(row_of -> 'retired' = 'false'::jsonb and row_of -> 'became' = '"crnew"'::jsonb and row_of -> 'withdrawn' = 'false'::jsonb and row_of ->> 'availability' = 'onSale', format('a renamed card''s slot read: %s', row_of));
  row_of := (select e from jsonb_array_elements(shown) e where e ->> 'slot' = s_bye::text);
  perform pg_temp.expect(row_of -> 'retired' = 'false'::jsonb and row_of -> 'became' = 'null'::jsonb and row_of -> 'withdrawn' = 'true'::jsonb, format('a withdrawn card''s slot read: %s', row_of));
  row_of := (select e from jsonb_array_elements(shown) e where e ->> 'slot' = s_hit::text);
  perform pg_temp.expect(row_of -> 'retired' = 'false'::jsonb and row_of -> 'became' = 'null'::jsonb and row_of -> 'withdrawn' = 'false'::jsonb, format('a card in print read: %s', row_of));
  perform seed_instance(pg_temp.pl(retire => array['crhit']));
  perform tests.become(adm);
  row_of := (select e from jsonb_array_elements(admin_machine()) e where e ->> 'slot' = s_hit::text);
  perform tests.unbecome();
  perform pg_temp.expect(row_of -> 'retired' = 'true'::jsonb and row_of -> 'withdrawn' = 'false'::jsonb, format('a card out of print read: %s', row_of));
  perform seed_instance(pg_temp.pl(unretire => array['crhit']));
  perform seed_instance(pg_temp.pl());
  perform pg_temp.expect(exists (select 1 from machine_now where slot = s_other), 'listing the pack kind again did not bring its slot back');
  perform pg_temp.expect((select retired_at from pack_kinds where key = 'cr-other') is null, 'listing the pack kind again did not clear retired_at');

  -- A payload with no `packs` says nothing of pack kinds, and retires none (a payload that carries `withdrawn` but not `packs` is a partial one).
  perform seed_instance(pg_temp.pl() - 'packs');
  perform pg_temp.expect(not exists (select 1 from pack_kinds where retired_at is not null and key like 'cr-%'), 'a seed with no packs list retired a pack kind');

  -- A Pull open on a slot and a flash sale open on a hidden one: shown while the card is in print; neither shown nor sold once it has left.
  perform pg_temp.moves(s_keep, s_hit);
  perform pg_temp.expect((select availability from machine_now where slot = s_keep) = 'onSale' and (select availability from machine_now where slot = s_hit) = 'soldOut', 'the shim''s moves are not read by machine_now');
  perform seed_instance(pg_temp.pl(retire => array['crhit', 'crkeep']));
  perform pg_temp.expect(not exists (select 1 from machine_now where slot in (s_keep, s_hit)), 'a flash sale or a Pull shows a slot of a card out of print');
  perform pg_temp.expect(pg_temp.coded(format($q$select buy_card(%L, %L, 130)$q$, buyer, s_keep)) = 'P0002 kayfabb.refusal the machine has no such slot', 'a flash sale sold a card out of print');
  perform pg_temp.expect(pg_temp.coded(format($q$select slot_for_sale(%L, 'card', 100)$q$, s_hit)) = 'P0002 kayfabb.refusal the machine has no such slot', 'a Pull sold a card out of print');

  -- The Boss's meeting reads only slots that are in print: neither its machine list nor a move's own check finds a slot of a card out of print or gone (a slot machine_now hides), so no Pull or flash sale is queued on one.
  perform pg_temp.moves(null, null);
  perform pg_temp.expect(machine_move_problem('pullSlot', jsonb_build_object('slot', s_hit), '{}'::jsonb, now(), now() + interval '1 day', true) = 'the machine has no such slot', 'a Pull was let land on a slot of a card out of print');
  perform pg_temp.expect(machine_move_problem('flashSale', jsonb_build_object('slot', s_keep, 'hours', 24), null, now(), now() + interval '24 hours', true) = 'the machine has no such slot', 'a flash sale was let land on a slot of a card out of print');
  perform pg_temp.expect(machine_move_problem('repriceSlot', jsonb_build_object('slot', s_old, 'percent', 80), null, now(), now() + interval '1 day', true) = 'the machine has no such slot', 'a Reprice was let land on a slot of a card that left');
  perform pg_temp.expect(not exists (select 1 from jsonb_array_elements(meeting_context() -> 'machine') e where (e ->> 'id')::uuid in (s_hit, s_keep, s_old, s_bye)), 'the meeting''s machine lists a slot of a card out of print or gone');
  perform pg_temp.expect(exists (select 1 from jsonb_array_elements(meeting_context() -> 'machine') e where (e ->> 'id')::uuid = s_pull), 'the meeting''s machine lost a slot in print');
  perform seed_instance(pg_temp.pl(unretire => array['crhit', 'crkeep']));
  perform pg_temp.expect(machine_move_problem('pullSlot', jsonb_build_object('slot', s_hit), '{}'::jsonb, now(), now() + interval '1 day', true) is null, 'a Pull on a slot in print was refused');
  perform pg_temp.expect(machine_move_problem('flashSale', jsonb_build_object('slot', s_keep, 'hours', 24), null, now(), now() + interval '24 hours', true) is null, 'a flash sale on a hidden slot in print was refused');
  perform pg_temp.expect(exists (select 1 from jsonb_array_elements(meeting_context() -> 'machine') e where (e ->> 'id')::uuid = s_hit), 'the meeting''s machine lost a slot that is in print again');
end $$;

-- ---- 7c. A rename of a renamed card re-points the earlier rename: chains stay one link ----
-- A is renamed to B, then B to C. The second seed re-points A at C, no copy moves twice, and the same seed again writes nothing.
create function pg_temp.chain(a text, b text, c text) returns text language plpgsql as $$
declare
  u1 uuid := tests.account(a || '-u1'); u2 uuid := tests.account(a || '-u2'); ev jsonb; rows_before bigint; wallet_before bigint; why text;
  adm uuid := tests.account(a || '-adm'); slot_a uuid;
begin
  insert into admins (account) values (adm);
  perform seed_instance(pg_temp.pl(extra => jsonb_build_array(pg_temp.c(a, 'Name ' || a), pg_temp.c(b, 'Name ' || b))));
  perform pg_temp.hand(u1, a, 2); perform pg_temp.hand(u2, b, 1);
  insert into machine_slots (position, card, availability, price) values ((select max(position) + 1 from machine_slots), a, 'onSale', 100) returning id into slot_a;
  ev := seed_instance(pg_temp.pl(rename => jsonb_build_array(jsonb_build_object('key', a, 'name', 'Name ' || a, 'became', b))));
  perform pg_temp.expect(card_held(u1, b) = 2 and card_held(u2, b) = 1 and card_held(u1, a) = 0, 'the first rename did not move the copies');
  -- The second rename: the instance's payload lists the newest card with every old name.
  ev := seed_instance(pg_temp.pl(extra => jsonb_build_array(pg_temp.c(c, 'Name ' || c)),
    rename => jsonb_build_array(jsonb_build_object('key', a, 'name', 'Name ' || a, 'became', c), jsonb_build_object('key', b, 'name', 'Name ' || b, 'became', c))));
  perform pg_temp.expect(ev -> 'renamed' = jsonb_build_array(jsonb_build_object('from', b, 'to', c, 'copies', 3)), format('only the card that left this seed moves, 3 copies: %s', ev -> 'renamed'));
  perform pg_temp.expect((select became from card_kinds where key = a) = c and (select became from card_kinds where key = b) = c, format('the earlier rename was not re-pointed: a became %s', (select became from card_kinds where key = a)));
  perform pg_temp.expect(card_held(u1, c) = 2 and card_held(u2, c) = 1 and card_held(u1, a) = 0 and card_held(u1, b) = 0 and card_held(u2, b) = 0, 'the copies did not land on the newest card once');
  perform pg_temp.expect((select count(*) from card_ledger where card = c and kind = 'renamedIn') = 3 and (select count(*) from card_ledger where card = b and kind = 'renamedIn') = 2, 'a copy was moved in twice, or not at all');
  perform pg_temp.expect((select count(*) from card_ledger where card = a and kind = 'renamedOut') = 2 and (select count(*) from card_ledger where card = b and kind = 'renamedOut') = 3, 'a copy was moved out twice');
  perform tests.become(u1);
  perform pg_temp.expect((select held from my_cards where card = c) = 2 and coalesce((select held from my_cards where card = a), 0) = 0 and coalesce((select held from my_cards where card = b), 0) = 0, 'my_cards disagrees with card_held');
  perform tests.unbecome();
  -- What a caller sees: the admin machine's slot for the first name says what it became now (the newest card), which only the re-point makes so.
  perform tests.become(adm);
  perform pg_temp.expect((select e ->> 'became' from jsonb_array_elements(admin_machine()) e where e ->> 'slot' = slot_a::text) = c, 'the first name''s slot does not say it became the newest card');
  perform tests.unbecome();
  -- A payload that leaves out a name whose chain ends in a card it lists is refused, naming it: every old name is listed under the card that carries it, so history never says "a card".
  why := pg_temp.coded(format($q$select seed_instance(pg_temp.pl(omit => array[%L]))$q$, a));
  perform pg_temp.expect(why like '22023%' and why like '%' || a || '%', format('a payload that left out an old name of a listed card was not refused naming it: %s', why));
  -- The next seeds (the same payload) are accepted and write nothing.
  for i in 1..2 loop
    rows_before := (select count(*) from card_ledger); wallet_before := (select count(*) from wallet_events);
    ev := seed_instance(pg_temp.pl(rename => jsonb_build_array(jsonb_build_object('key', a, 'name', 'Name ' || a, 'became', c), jsonb_build_object('key', b, 'name', 'Name ' || b, 'became', c))));
    perform pg_temp.expect(ev -> 'renamed' = '[]'::jsonb and (select count(*) from card_ledger) = rows_before and (select count(*) from wallet_events) = wallet_before, format('seed %s after the chain wrote or moved something: %s', i + 2, ev -> 'renamed'));
  end loop;
  return 'ok';
end $$;

-- Listed under the newest card, as the instance's files do.
select pg_temp.chain('crea', 'creb', 'crec');

-- B withdrawn after A became B: A's copies were B's by then, so the refund is paid once, and the guard accepts A, which points at a withdrawn card.
do $$
declare
  u uuid := tests.account('crg-u'); ev jsonb; rows_before bigint; wallet_before bigint;
begin
  perform seed_instance(pg_temp.pl(extra => jsonb_build_array(pg_temp.c('crga', 'Name crga'), pg_temp.c('crgb', 'Name crgb'))));
  perform pg_temp.hand(u, 'crga', 2);
  perform seed_instance(pg_temp.pl(rename => '[{"key": "crga", "name": "Name crga", "became": "crgb"}]'));
  perform pg_temp.expect(card_held(u, 'crgb') = 2, 'the rename did not move the copies');
  ev := seed_instance(pg_temp.pl(withdraw => '[{"key": "crgb", "name": "Name crgb", "refund": 100}]'));
  perform pg_temp.expect(ev -> 'withdrawn' = '[{"key": "crgb", "copies": 2, "refunded": 200}]'::jsonb, format('the refund should be paid once, for 2 copies: %s', ev -> 'withdrawn'));
  perform pg_temp.expect((select count(*) from wallet_events where account = u and kind = 'withdrawal') = 1 and (select change from wallet_events where account = u and kind = 'withdrawal') = 200, 'the account should be refunded once, 200');
  perform pg_temp.expect(card_held(u, 'crga') = 0 and card_held(u, 'crgb') = 0, 'a refunded copy is still counted');
  perform pg_temp.expect((select became from card_kinds where key = 'crga') = 'crgb' and (select refund from card_kinds where key = 'crgb') = 100, 'A should still point at the withdrawn B');
  perform pg_temp.expect((select (n.key = 'crgb' and n.refund = 100) from card_now('crga') n), 'card_now should end A at the withdrawn card');
  -- Listed or not, the next seed is accepted and writes nothing.
  rows_before := (select count(*) from card_ledger); wallet_before := (select count(*) from wallet_events);
  perform seed_instance(pg_temp.pl());
  perform seed_instance(pg_temp.pl(omit => array['crga'], withdraw => '[{"key": "crgb", "name": "Name crgb", "refund": 100}]'));
  perform pg_temp.expect((select count(*) from card_ledger) = rows_before and (select count(*) from wallet_events) = wallet_before, 'a seed after the withdrawal wrote rows');
end $$;

-- ---- 7d. take_back of a back that was live across two renames, or across a rename and a withdrawal, says what is true now ----
do $$
declare
  u uuid := tests.account('crh-u'); ch uuid := tests.character(u, 'Crh Ch'); t uuid := tests.thread('Crh'); q1 uuid; q2 uuid; b1 uuid; b2 uuid; why text;
  day text := to_char(now() at time zone 'UTC', 'FMMon FMDD, YYYY');
begin
  q1 := tests.post(ch, t, 'First post.'); q2 := tests.post(ch, t, 'Second post.');
  perform seed_instance(pg_temp.pl(extra => jsonb_build_array(pg_temp.c('crha', 'Name crha', 'common', 'set'), pg_temp.c('crhb', 'Name crhb', 'common', 'set'), pg_temp.c('crhc', 'Name crhc', 'common', 'set'),
    pg_temp.c('crja', 'Name crja', 'common', 'set'), pg_temp.c('crjb', 'Name crjb', 'common', 'set'))));
  perform pg_temp.hand(u, 'crha', 1); perform pg_temp.hand(u, 'crja', 1);
  perform tests.become_service();
  b1 := (set_card(u, 'crha', ch, q1, '{}', 0, 'crcatch') ->> 'id')::uuid;
  b2 := (set_card(u, 'crja', ch, q2, '{}', 0, 'crcatch') ->> 'id')::uuid;
  perform tests.unbecome();
  -- crha becomes crhb, then crhb becomes crhc: the first date is not the date of the rename to crhc, so the words claim no date.
  perform seed_instance(pg_temp.pl(rename => '[{"key": "crha", "name": "Name crha", "became": "crhb"}]'));
  perform seed_instance(pg_temp.pl(rename => '[{"key": "crha", "name": "Name crha", "became": "crhc"}, {"key": "crhb", "name": "Name crhb", "became": "crhc"}]'));
  -- crja becomes crjb, then crjb is withdrawn: the copy was refunded, and is not in the hand.
  perform seed_instance(pg_temp.pl(rename => '[{"key": "crja", "name": "Name crja", "became": "crjb"}]'));
  perform seed_instance(pg_temp.pl(withdraw => '[{"key": "crjb", "name": "Name crjb", "refund": 100}]'));
  perform tests.become_service();
  why := pg_temp.coded(format('select take_back(%L, %L, %L)', u, ch, b1));
  perform pg_temp.expect(why = format('P0001 kayfabb.refusal Name crha is now Name crhc, and this copy is in your hand as one. Its back ends by itself on %s.', to_char((select ends_at from face_down where play = b1) at time zone 'UTC', 'FMMon FMDD, YYYY')), format('the renamed chain refusal read: %s', why));
  why := pg_temp.coded(format('select take_back(%L, %L, %L)', u, ch, b2));
  perform pg_temp.expect(why = format('P0001 kayfabb.refusal Name crjb was withdrawn on %s, and this copy was refunded then. Its back ends by itself on %s.', day, to_char((select ends_at from face_down where play = b2) at time zone 'UTC', 'FMMon FMDD, YYYY')), format('the withdrawn chain refusal read: %s', why));
  perform tests.unbecome();
end $$;

-- ---- 7b. card_now follows a rename chain to the card in print, and passes an unknown key through ----
do $$
declare
  cur record;
begin
  perform pg_temp.expect((select (n.key, n.refund) is not distinct from ('crnosuch', null::integer) from card_now('crnosuch') n), 'card_now dropped a key that is no card');
  insert into card_kinds (key, name, alignment, rarity, play) values ('crch10', 'Ch 10', 'salty', 'common', 'cast');
  for i in reverse 9..0 loop
    insert into card_kinds (key, name, alignment, rarity, play, gone_at, became) values ('crch' || i, 'Ch ' || i, 'salty', 'common', 'cast', now(), 'crch' || (i + 1));
  end loop;
  perform pg_temp.expect((select n.key from card_now('crch0') n) = 'crch10', 'card_now stopped short of the card in print on a long chain');
  insert into card_kinds (key, name, alignment, rarity, play, gone_at, refund) values ('crch11', 'Ch 11', 'salty', 'common', 'cast', now(), 90);
  perform pg_temp.expect((select n.key = 'crch11' and n.refund = 90 from card_now('crch11') n), 'card_now lost a withdrawn card''s refund');
end $$;

-- ---- 10. Nothing here edited a row, and the triggers are as they were ----
do $$
declare
  why text;
begin
  perform pg_temp.expect((select h from before_rows where t = 'card_ledger') = (select md5(coalesce(string_agg(l::text, '|' order by l.id), '')) from card_ledger l where l.id <= (select max_ledger from before_counts)),
    'a seed edited a row of the card ledger that was there before it');
  perform pg_temp.expect((select h from before_rows where t = 'face_down') = (select md5(coalesce(string_agg(row(f.play, f.account, f.card, f.config, f.post, f.thread, f.round, f.catches, f.phrase, f.passage, f.who)::text, '|' order by f.play), '')) from face_down f where f.account is distinct from (select id from auth.users where email = 'crh-u@test.invalid')),
    'a seed edited a back');
  perform pg_temp.expect((select h from before_rows where t = 'packs') = (select md5(coalesce(string_agg(p::text, '|' order by p.id), '')) from packs p), 'a seed edited a pack');
  perform pg_temp.expect((select h from before_rows where t = 'machine_slots') = (select md5(coalesce(string_agg(s::text, '|' order by s.id), '')) from machine_slots s where s.card is distinct from 'crea'), 'a seed edited a machine slot');
  why := pg_temp.coded($q$update card_ledger set price = price + 1$q$);
  perform pg_temp.expect(why is not null, 'card_ledger took an update');
  why := pg_temp.coded($q$delete from card_ledger$q$);
  perform pg_temp.expect(why is not null, 'card_ledger took a delete');
  why := pg_temp.coded($q$update face_down set catches = null$q$);
  perform pg_temp.expect(why is not null, 'face_down took an update');
  why := pg_temp.coded($q$delete from face_down$q$);
  perform pg_temp.expect(why is not null, 'face_down took a delete');
  why := pg_temp.coded($q$update packs set price = 0$q$);
  perform pg_temp.expect(why is not null, 'packs took an update');
  why := pg_temp.coded($q$delete from packs$q$);
  perform pg_temp.expect(why is not null, 'packs took a delete');
  perform pg_temp.expect((select count(*) from pg_trigger where tgrelid in ('card_ledger'::regclass, 'face_down'::regclass, 'packs'::regclass) and tgname in ('card_ledger_no_update', 'face_down_no_update', 'packs_no_update') and tgenabled = 'A') = 3,
    'a append-only trigger is not enabled as it was');
  perform pg_temp.expect(exists (select 1 from pg_indexes where tablename = 'card_ledger' and indexdef like '%(act)%' and indexdef like '%renamedOut%'), 'the probe''s index on card_ledger (act) is missing');
end $$;
