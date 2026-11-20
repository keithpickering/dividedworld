-- Sealed packs and the welcome gift (supabase/migrations/0377_sealed_packs.sql; docs/plans/2026-11-18-starter-pack-plan.md, Task 2; the design's sections 4, 5 and 8).
--
-- A fixed pack kind (cards in order, no pulls); a pack row that is sealed until open_pack writes its opening and its six pulled rows; a welcome pack given once per account
-- by create_character and by each seed's backfill; and no read the client can make that returns a sealed pack's cards.
--
-- The races run first and commit what they need (so no later statement of this file touches a row they wrote), and clean up the setting they wrote before the file's
-- own transaction touches it: a committed row this transaction later updates would be a lock the committing session waits on. What a race leaves (accounts, welcome packs) is
-- append-only and committed; the scratch database is dropped at the end of the run.

create function pg_temp.boom(p integer) returns boolean language plpgsql immutable cost 0.00001 as $$
begin
  if p = 300 then raise exception 'boom on %', p; end if;
  return true;
end $$;

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

-- ---- 1. Two sessions at once ----
do $$
declare
  kind_cards text[] := array['sweetie', 'splat', 'blot', 'blot', 'splat', 'sweetie'];
  said text[];
  who uuid;
  mine uuid;
  p uuid;
  rounds integer := 8;
begin
  perform tests.commit(format($sql$
    insert into pack_kinds (key, pulls, leaves, contents) values ('ws-race', null, '{}', %L);
    insert into settings (key, value) values ('startingPack', '"ws-race"') on conflict (key) do update set value = excluded.value;
  $sql$, kind_cards));

  -- A character made twice at once by one account (two tabs) grants one welcome pack.
  for i in 1..rounds loop
    who := gen_random_uuid();
    perform tests.commit(format($sql$
      insert into auth.users (id, email) values (%1$L, %2$L);
      insert into accounts (id, created_at) values (%1$L, '2000-01-01T00:00:00Z');
    $sql$, who, 'ws-race-' || i || '@test.invalid'));
    said := tests.race(who, format('select create_character(%L, ''alpha'')', 'Ws Racer A ' || i), who, format('select create_character(%L, ''alpha'')', 'Ws Racer B ' || i));
    if said[1] is not null or said[2] is not null then raise exception 'round %: both characters should be made: %', i, said; end if;
    if (select count(*) from characters where owner = who) is distinct from 2 then raise exception 'round %: two characters', i; end if;
    if (select count(*) from packs where account = who and source = 'welcome') is distinct from 1 then
      raise exception 'round %: two characters made at once wrote % welcome packs', i, (select count(*) from packs where account = who and source = 'welcome');
    end if;
  end loop;

  -- A sealed pack opened twice at once opens once: one opening, six pulled rows, one session refused.
  for i in 1..rounds loop
    who := gen_random_uuid();
    p := gen_random_uuid();
    perform tests.commit(format($sql$
      insert into auth.users (id, email) values (%1$L, %2$L);
      insert into accounts (id, created_at) values (%1$L, '2000-01-01T00:00:00Z');
      insert into packs (id, account, pack, price, contents, source) values (%3$L, %1$L, 'ws-race', 0, %4$L, 'welcome');
    $sql$, who, 'ws-open-' || i || '@test.invalid', p, kind_cards));
    said := tests.race(who, format('select open_pack(%L)', p), who, format('select open_pack(%L)', p));
    if (said[1] is null) = (said[2] is null) then raise exception 'round %: exactly one of two opens should be refused: %', i, said; end if;
    if (select count(*) from pack_openings where pack = p) is distinct from 1 then raise exception 'round %: % openings', i, (select count(*) from pack_openings where pack = p); end if;
    if (select count(*) from card_ledger where pack = p and kind = 'pulled') is distinct from 6 then
      raise exception 'round %: % pulled rows after two opens at once', i, (select count(*) from card_ledger where pack = p and kind = 'pulled');
    end if;
  end loop;

  -- The race's setting goes before this file's own transaction touches the row.
  perform tests.commit($sql$ delete from settings where key = 'startingPack'; $sql$);
end $$;

-- ---- 2. A fixed pack kind: cards and no pulls, or pulls and no cards, never both and never neither ----
do $$
begin
  insert into pack_kinds (key, pulls, leaves, contents) values ('ws-starter', null, '{}', array['sweetie', 'splat', 'blot', 'blot', 'splat', 'sweetie']);
  insert into pack_kinds (key, pulls, leaves) values ('ws-pull', '[{"weights": {"common": 1}}]', '{}');
  if (select contents from pack_kinds where key = 'ws-starter') is distinct from array['sweetie', 'splat', 'blot', 'blot', 'splat', 'sweetie'] then raise exception 'a fixed kind holds its cards in order'; end if;
  if pg_temp.refusal($q$insert into pack_kinds (key, pulls, leaves, contents) values ('ws-both', '[{"weights": {"common": 1}}]', '{}', array['sweetie'])$q$) is null then raise exception 'a kind with pulls and contents was accepted'; end if;
  if pg_temp.refusal($q$insert into pack_kinds (key, pulls, leaves) values ('ws-neither', null, '{}')$q$) is null then raise exception 'a kind with neither pulls nor contents was accepted'; end if;
  if pg_temp.refusal($q$insert into pack_kinds (key, pulls, leaves, contents) values ('ws-empty', null, '{}', '{}')$q$) is null then raise exception 'a fixed kind with no cards was accepted'; end if;
  if pg_temp.refusal($q$insert into pack_kinds (key, pulls, leaves, contents) values ('ws-badpulls', '[]', '{}', null)$q$) is null then raise exception 'pack_pulls_problem stopped holding a non-null pulls'; end if;
  -- A seed writes one: the pull pack as it did, the fixed pack as its cards in order.
  perform seed_instance(jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'packs', jsonb_build_array(
      jsonb_build_object('key', 'ws-seeded-fixed', 'contents', jsonb_build_array('blot', 'sweetie')),
      jsonb_build_object('key', 'ws-seeded-pull', 'pulls', jsonb_build_array(jsonb_build_object('weights', jsonb_build_object('common', 1))), 'leaves', '[]'::jsonb))));
  if (select contents from pack_kinds where key = 'ws-seeded-fixed') is distinct from array['blot', 'sweetie'] or (select pulls from pack_kinds where key = 'ws-seeded-fixed') is not null then
    raise exception 'a seed did not write a fixed pack as its cards: %', (select to_jsonb(k) from pack_kinds k where key = 'ws-seeded-fixed');
  end if;
  if (select pulls from pack_kinds where key = 'ws-seeded-pull') is distinct from '[{"weights": {"common": 1}}]'::jsonb or (select contents from pack_kinds where key = 'ws-seeded-pull') is not null then
    raise exception 'a seed changed how a pull pack is written';
  end if;
  -- startingPack is held where it is written: a key or null, nothing else (supabase/tests/0079-settings-held.sql holds the whole list).
  if pg_temp.refusal($q$insert into settings (key, value) values ('startingPack', '5')$q$) is null then raise exception 'startingPack = 5 was accepted'; end if;
end $$;

-- ---- 3. The grant, the sealed state, opening ----
do $$
declare
  ann uuid := tests.account('ws-ann');
  bob uuid := tests.account('ws-bob');
  cat uuid := tests.account('ws-cat');
  hal uuid := tests.account('ws-hal');
  ivy uuid := tests.account('ws-ivy');
  made_a jsonb;
  made_b jsonb;
  made_c jsonb;
  pack_a uuid;
  opened jsonb;
  refused_foreign text;
  refused_missing text;
  seen jsonb;
begin
  -- The rows below are the code's, as a seed writes them (a row written any other way is marked tuned, an admin's, and a seed leaves it as it is).
  perform set_config('kayfabb.seeding', 'on', true);
  -- No setting at all, and a null one: no pack, and an answer of the same shape as with a grant.
  perform tests.become(bob);
  made_b := create_character('Ws Bob One', 'alpha');
  perform tests.unbecome();
  if exists (select 1 from packs where account = bob) then raise exception 'a pack was written with no startingPack set'; end if;
  insert into settings (key, value) values ('startingPack', 'null');
  perform tests.become(cat);
  made_c := create_character('Ws Cat One', 'alpha');
  perform tests.unbecome();
  if exists (select 1 from packs where account = cat) then raise exception 'a pack was written with startingPack null'; end if;
  -- A name that is no fixed pack grants nothing either: a pull pack, and a key no pack has.
  update settings set value = '"ws-pull"' where key = 'startingPack';
  perform tests.become(hal);
  perform create_character('Ws Hal One', 'alpha');
  perform tests.unbecome();
  update settings set value = '"ws-nothing"' where key = 'startingPack';
  perform tests.become(ivy);
  perform create_character('Ws Ivy One', 'alpha');
  perform tests.unbecome();
  if exists (select 1 from packs where account in (hal, ivy)) then raise exception 'a startingPack that is no fixed pack granted one'; end if;

  update settings set value = '"ws-starter"' where key = 'startingPack';
  -- The first character writes one sealed welcome pack, and the answer is the shape it has without one.
  perform tests.become(ann);
  made_a := create_character('Ws Ann One', 'alpha');
  perform tests.unbecome();
  if (select array_agg(k order by k) from jsonb_object_keys(made_a) k) is distinct from (select array_agg(k order by k) from jsonb_object_keys(made_b) k)
     or (select array_agg(k order by k) from jsonb_object_keys(made_a) k) is distinct from (select array_agg(k order by k) from jsonb_object_keys(made_c) k) then
    raise exception 'create_character answers a different shape with a grant: % vs %', made_a, made_b;
  end if;
  if (select count(*) from packs where account = ann) is distinct from 1 then raise exception 'the first character wrote % packs', (select count(*) from packs where account = ann); end if;
  select id into strict pack_a from packs where account = ann;
  if (select (source, pack, price, slot is null, odds is null, opened_at is null, contents)::text from packs where id = pack_a)
     is distinct from '(welcome,ws-starter,0,t,t,t,"{sweetie,splat,blot,blot,splat,sweetie}")' then
    raise exception 'the welcome pack row: %', (select to_jsonb(p) from packs p where id = pack_a);
  end if;
  -- A second character grants nothing more.
  perform tests.become(ann);
  perform create_character('Ws Ann Two', 'alpha');
  perform tests.unbecome();
  if (select count(*) from packs where account = ann) is distinct from 1 then raise exception 'a second character wrote a second pack'; end if;
  -- One welcome pack per account, held by an index: a second row is refused, and a bought pack beside it is not.
  if pg_temp.refusal(format($q$insert into packs (account, pack, price, contents, source) values (%L, 'ws-starter', 0, '{sweetie}', 'welcome')$q$, ann)) is null then raise exception 'a second welcome pack was accepted'; end if;
  if pg_temp.refusal(format($q$insert into packs (account, pack, price, contents, source) values (%L, 'ws-starter', 5, '{sweetie}', 'welcome')$q$, bob)) is null then raise exception 'a welcome pack with a price was accepted'; end if;
  if pg_temp.refusal(format($q$insert into packs (account, pack, price, contents, source) values (%L, 'ws-starter', 0, '{sweetie}', 'bought')$q$, bob)) is null then raise exception 'a free bought pack was accepted'; end if;
  if pg_temp.refusal(format($q$insert into packs (account, pack, price, contents, source) values (%L, 'ws-starter', 0, '{sweetie}', 'gift')$q$, bob)) is null then raise exception 'a pack of another source was accepted'; end if;

  -- While sealed: the owner reads the row through my_packs with no cards and no opening, and through nothing else.
  perform tests.become(ann);
  select to_jsonb(m) into seen from my_packs m where m.id = pack_a;
  if seen is null or seen -> 'contents' is distinct from 'null'::jsonb or seen -> 'opened_at' is distinct from 'null'::jsonb or seen ->> 'source' is distinct from 'welcome' or seen ->> 'pack' is distinct from 'ws-starter' then
    raise exception 'my_packs shows a sealed pack as: %', seen;
  end if;
  if pg_temp.refusal('select contents from packs') is null then raise exception 'the owner read packs.contents'; end if;
  if pg_temp.refusal('select id from packs') is null then raise exception 'the owner read packs'; end if;
  if pg_temp.refusal('select * from pack_openings') is null then raise exception 'the owner read pack_openings'; end if;
  if exists (select 1 from my_cards) or exists (select 1 from my_card_ledger) then raise exception 'a sealed pack''s cards are in the hand'; end if;
  -- The log's packs source holds the pack with no cards, and says where it came from.
  seen := log_page(null) -> 'sources' -> 'packs';
  if jsonb_array_length(seen) is distinct from 1 or seen -> 0 ->> 'source' is distinct from 'welcome' or seen -> 0 -> 'contents' is distinct from 'null'::jsonb then raise exception 'log_page''s packs while sealed: %', seen; end if;
  -- Nobody else sees it.
  perform tests.become(bob);
  if exists (select 1 from my_packs) then raise exception 'another player reads a pack'; end if;
  -- open_pack is the caller's own pack alone: another account's and one that does not exist are refused in the same words and with the same code.
  refused_foreign := pg_temp.refusal(format('select open_pack(%L)', pack_a));
  refused_missing := pg_temp.refusal(format('select open_pack(%L)', gen_random_uuid()));
  if refused_foreign is null or refused_foreign is distinct from refused_missing then raise exception 'open_pack told a foreign pack (%) from a missing one (%)', refused_foreign, refused_missing; end if;
  perform tests.unbecome();
  if exists (select 1 from pack_openings where pack = pack_a) then raise exception 'a refused open wrote an opening'; end if;
  if has_function_privilege('anon', 'open_pack(uuid)', 'execute') or not has_function_privilege('authenticated', 'open_pack(uuid)', 'execute') then raise exception 'open_pack is granted to authenticated alone'; end if;
  perform tests.become_anon();
  if pg_temp.refusal(format('select open_pack(%L)', pack_a)) is null then raise exception 'a visitor opened a pack'; end if;
  perform tests.unbecome();

  -- Opening: one opening, six pulled rows in contents order, and the hand counts them.
  perform tests.become(ann);
  opened := open_pack(pack_a);
  if opened ->> 'pack' is distinct from pack_a::text or opened ->> 'kind' is distinct from 'ws-starter'
     or (select array_agg(e.c order by e.i) from jsonb_array_elements_text(opened -> 'contents') with ordinality e(c, i)) is distinct from array['sweetie', 'splat', 'blot', 'blot', 'splat', 'sweetie'] then
    raise exception 'open_pack answered: %', opened;
  end if;
  if (select array_agg(card order by id) from card_ledger where pack = pack_a and kind = 'pulled') is distinct from array['sweetie', 'splat', 'blot', 'blot', 'splat', 'sweetie']
     or (select count(*) from card_ledger where pack = pack_a and kind = 'pulled' and price = 0 and account = ann and act is null) is distinct from 6 then
    raise exception 'six pulled rows, in order, priced 0: %', (select jsonb_agg(l order by id) from card_ledger l where pack = pack_a);
  end if;
  if (select held from my_cards where card = 'sweetie') is distinct from 2 or (select held from my_cards where card = 'splat') is distinct from 2 or (select held from my_cards where card = 'blot') is distinct from 2
     or card_held(ann, 'blot') is distinct from 2 then
    raise exception 'my_cards and card_held count the six cards: %', (select jsonb_agg(m) from my_cards m);
  end if;
  select to_jsonb(m) into seen from my_packs m where m.id = pack_a;
  if seen -> 'contents' is distinct from '["sweetie", "splat", "blot", "blot", "splat", "sweetie"]'::jsonb or seen ->> 'opened_at' is null then raise exception 'my_packs shows an opened pack as: %', seen; end if;
  -- A second open is refused, and writes nothing.
  if pg_temp.refusal(format('select open_pack(%L)', pack_a)) is null then raise exception 'a pack opened twice'; end if;
  -- Its own refusal is in other words than a foreign or missing pack's, which say nothing of who owns what.
  if pg_temp.refusal(format('select open_pack(%L)', pack_a)) is not distinct from refused_foreign then raise exception 'an opened pack and a foreign one are refused alike'; end if;
  perform tests.unbecome();
  if (select count(*) from card_ledger where pack = pack_a) is distinct from 6 or (select count(*) from pack_openings where pack = pack_a) is distinct from 1 then raise exception 'a second open wrote something'; end if;

  -- Append-only: neither table takes an update, a delete or a truncate.
  if pg_temp.refusal(format('update pack_openings set at = now() where pack = %L', pack_a)) is null then raise exception 'an opening was updated'; end if;
  if pg_temp.refusal(format('delete from pack_openings where pack = %L', pack_a)) is null then raise exception 'an opening was deleted'; end if;
  if pg_temp.refusal('truncate pack_openings') is null then raise exception 'openings were truncated'; end if;
  if pg_temp.refusal(format('update packs set contents = ''{blot}'' where id = %L', pack_a)) is null then raise exception 'a pack was updated'; end if;
  if pg_temp.refusal(format('update packs set opened_at = now() where id = %L', pack_a)) is null then raise exception 'a pack was opened by an update'; end if;
  if pg_temp.refusal(format('delete from packs where id = %L', pack_a)) is null then raise exception 'a pack was deleted'; end if;
  if pg_temp.refusal('truncate packs') is null then raise exception 'packs were truncated'; end if;
end $$;

-- ---- 4. Buying a pack is as it was, and a fixed pack sold in a slot is bought opened ----
do $$
declare
  dan uuid := tests.account('ws-dan');
  s_fixed uuid;
  s_pull uuid;
  bought jsonb;
  row_ packs;
begin
  insert into machine_slots (position, pack, availability, price) values (9770, 'ws-starter', 'onSale', 200) returning id into s_fixed;
  insert into machine_slots (position, pack, availability, price) values (9771, 'ws-pull', 'onSale', 300) returning id into s_pull;
  insert into wallets (account, balance) values (dan, 600);
  perform tests.become_service();
  bought := buy_pack(dan, s_fixed, 200);
  perform tests.unbecome();
  select * into row_ from packs where id = (bought ->> 'pack')::uuid;
  if row_.source is distinct from 'bought' or row_.price is distinct from 200 or row_.opened_at is null or row_.odds is not null or row_.slot is distinct from s_fixed
     or row_.contents is distinct from array['sweetie', 'splat', 'blot', 'blot', 'splat', 'sweetie'] then
    raise exception 'a bought fixed pack: %', to_jsonb(row_);
  end if;
  if (bought -> 'contents') is distinct from '["sweetie", "splat", "blot", "blot", "splat", "sweetie"]'::jsonb or (bought ->> 'balance')::integer is distinct from 400 then raise exception 'buy_pack answered: %', bought; end if;
  if (select array_agg(card order by id) from card_ledger where pack = row_.id and kind = 'pulled') is distinct from row_.contents then raise exception 'a bought fixed pack writes its contents as pulled rows'; end if;
  -- A pack bought has `opened_at` set and no opening row, and reads as opened, as every pack bought before 0377 does.
  if exists (select 1 from pack_openings where pack = row_.id) then raise exception 'a bought pack wrote an opening'; end if;
  perform tests.become(dan);
  if (select contents is not null and opened_at is not null and source = 'bought' from my_packs where id = row_.id) is not true then raise exception 'a bought pack reads as sealed: %', (select to_jsonb(m) from my_packs m where id = row_.id); end if;
  perform tests.unbecome();
  -- A pull pack is rolled, as before, and carries its odds.
  perform tests.become_service();
  bought := buy_pack(dan, s_pull, 300);
  perform tests.unbecome();
  select * into row_ from packs where id = (bought ->> 'pack')::uuid;
  -- Another account's rows are filtered before a caller's predicate runs on them: a predicate that errors on Dan's 3.00 pack errors for nobody else (my_packs is owner-run, so this is its barrier).
  perform tests.become(tests.account('ws-fred'));
  -- (a very cheap predicate, which the planner runs before any other qualifier it can)
  set local enable_indexscan = off; set local enable_bitmapscan = off;
  if pg_temp.refusal('select count(*) from my_packs where pg_temp.boom(price)') is not null then raise exception 'a predicate ran on another account''s pack: %', pg_temp.refusal('select count(*) from my_packs where pg_temp.boom(price)'); end if;
  reset enable_indexscan; reset enable_bitmapscan;
  perform tests.unbecome();
  if cardinality(row_.contents) is distinct from 1 or row_.odds is distinct from '[{"weights": {"common": 1}}]'::jsonb or row_.opened_at is null or row_.source is distinct from 'bought' then raise exception 'a bought pull pack: %', to_jsonb(row_); end if;
end $$;

-- ---- 5. The backfill: every account with a character and no welcome pack, once ----
do $$
declare
  eve uuid := tests.account('ws-eve');
  fay uuid := tests.account('ws-fay');
  gus uuid := tests.account('ws-gus');
  payload jsonb;
  before_n bigint;
  before_at timestamptz;
  ann_pack uuid;
begin
  perform tests.character(eve, 'Ws Eve');
  perform tests.character(gus, 'Ws Gus');
  select id into ann_pack from packs where account = (select id from auth.users where email = 'ws-ann@test.invalid') and source = 'welcome';
  payload := jsonb_build_object('settings', jsonb_build_object('startingPack', 'ws-starter'), 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'packs', jsonb_build_array(jsonb_build_object('key', 'ws-starter', 'contents', jsonb_build_array('sweetie', 'splat', 'blot', 'blot', 'splat', 'sweetie'))));
  perform seed_instance(payload);
  if (select count(*) from packs where account = eve and source = 'welcome' and opened_at is null and contents = array['sweetie', 'splat', 'blot', 'blot', 'splat', 'sweetie']) is distinct from 1 then
    raise exception 'an account with a character and no welcome pack got none from the seed';
  end if;
  if exists (select 1 from packs where account = fay) then raise exception 'an account with no character was given a welcome pack'; end if;
  if (select count(*) from packs where account = gus and source = 'welcome') is distinct from 1 then raise exception 'the second account with a character got none'; end if;
  if (select id from packs where account = (select id from auth.users where email = 'ws-ann@test.invalid') and source = 'welcome') is distinct from ann_pack then raise exception 'the seed gave an account a second welcome pack'; end if;
  -- Every account with a character holds exactly one, and no other holds one (but the accounts the open race gave a pack by hand).
  if exists (select 1 from accounts a where exists (select 1 from characters c where c.owner = a.id) and (select count(*) from packs p where p.account = a.id and p.source = 'welcome') is distinct from 1) then
    raise exception 'an account with a character does not hold exactly one welcome pack';
  end if;
  if exists (select 1 from packs p where p.source = 'welcome' and not exists (select 1 from characters c where c.owner = p.account)
               and p.account not in (select u.id from auth.users u where u.email like 'ws-open-%')) then raise exception 'a welcome pack for an account with no character'; end if;
  -- A second seed writes nothing.
  select count(*), max(bought_at) into before_n, before_at from packs;
  perform seed_instance(payload);
  if (select max(bought_at) from packs) is distinct from before_at then raise exception 'a second seed wrote a pack'; end if;
  if (select count(*) from packs) is distinct from before_n then raise exception 'a second seed wrote a pack'; end if;
  -- An instance that changes startingPack gives no second pack to an account that has one; a pull pack named gives none.
  perform seed_instance(jsonb_build_object('settings', jsonb_build_object('startingPack', 'ws-seeded-fixed'), 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'packs', jsonb_build_array(jsonb_build_object('key', 'ws-seeded-fixed', 'contents', jsonb_build_array('blot')))));
  if (select count(*) from packs) is distinct from before_n then raise exception 'a changed startingPack gave a second welcome pack'; end if;
  perform seed_instance(jsonb_build_object('settings', jsonb_build_object('startingPack', null), 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb, 'packs', '[]'::jsonb));
  if (select count(*) from packs) is distinct from before_n then raise exception 'a null startingPack wrote a pack'; end if;
  -- A null the code gives is a row holding a JSON null (an export carries it: supabase/tests/e2e/0003-export.ts).
  if (select value from settings where key = 'startingPack') is distinct from 'null'::jsonb then raise exception 'a seed did not write a null startingPack: %', (select value from settings where key = 'startingPack'); end if;
  -- A row an admin tuned stands on a seed, null or not.
  perform set_config('kayfabb.seeding', 'off', true);
  update settings set value = '"ws-starter"' where key = 'startingPack';
  perform set_config('kayfabb.seeding', 'on', true);
  if (select tuned_at from settings where key = 'startingPack') is null then raise exception 'a write outside a seed did not mark the row tuned'; end if;
  perform seed_instance(jsonb_build_object('settings', jsonb_build_object('startingPack', null), 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb, 'packs', '[]'::jsonb));
  if (select value from settings where key = 'startingPack') is distinct from '"ws-starter"'::jsonb then raise exception 'a seed overwrote a tuned startingPack: %', (select value from settings where key = 'startingPack'); end if;
  -- A late character of an account with no pack gets its pack from the seed after, not before the setting is on.
  perform tests.character(fay, 'Ws Fay');
  perform seed_instance(payload);
  if (select count(*) from packs where account = fay and source = 'welcome') is distinct from 1 then raise exception 'a character made later was not backfilled by the next seed'; end if;
end $$;

-- ---- 6. A card in a fixed pack on sale is offered (card_in_open_pack) ----
do $$
begin
  -- The fixed kind 'ws-starter' holds sweetie, splat and blot; a slot sells it. A card is offered only while a pack on sale can give it.
  insert into card_kinds (key, name, alignment, rarity) values ('ws-lone', 'Lone', 'sweet', 'legendary');
  insert into pack_kinds (key, pulls, leaves, contents) values ('ws-lonepack', null, '{}', array['ws-lone']);
  if card_in_open_pack('ws-lone') is distinct from false then raise exception 'a card in no pack on sale reads as offered'; end if;
  insert into machine_slots (position, pack, availability, price) values (9780, 'ws-lonepack', 'hidden', 100);
  if card_in_open_pack('ws-lone') is distinct from false then raise exception 'a fixed pack that is not on sale offered its card'; end if;
  update machine_slots set availability = 'onSale' where pack = 'ws-lonepack';
  if card_in_open_pack('ws-lone') is distinct from true then raise exception 'a card in a fixed pack on sale reads as not offered'; end if;
  if card_in_open_pack('ws-nothing-here') is distinct from false then raise exception 'a card in no pack reads as offered'; end if;
end $$;

-- ---- 7. A pulled row says which pack it came from (my_card_ledger: pack_kind and pack_source) ----
do $$
declare
  iva uuid := tests.account('ws-iva');
  jon uuid := tests.account('ws-jon');
  welcome uuid;
  rows_ jsonb;
begin
  insert into wallets (account, balance) values (iva, 300), (jon, 300);
  insert into card_ledger (account, card, kind, price) values (iva, 'sweetie', 'bought', 100);
  insert into packs (account, pack, price, contents, source) values (iva, 'ws-starter', 0, array['sweetie', 'splat'], 'welcome') returning id into welcome;
  insert into packs (account, pack, price, contents, source) values (jon, 'ws-starter', 0, array['blot'], 'welcome');
  perform tests.become(iva);
  perform open_pack(welcome);
  perform tests.unbecome();
  perform tests.become_service();
  perform buy_pack(iva, (select id from machine_slots where pack = 'ws-lonepack'), 100);
  perform buy_pack(jon, (select id from machine_slots where pack = 'ws-lonepack'), 100);
  perform tests.become(iva);
  select jsonb_agg(jsonb_build_array(card, kind, pack_kind, pack_source) order by at) into rows_ from my_card_ledger m;
  if (select count(*) from my_card_ledger where kind = 'pulled' and pack_kind = 'ws-starter' and pack_source = 'welcome') is distinct from 2
     or (select count(*) from my_card_ledger where kind = 'pulled' and pack_kind = 'ws-lonepack' and pack_source = 'bought') is distinct from 1
     or (select count(*) from my_card_ledger where kind <> 'pulled' and (pack_kind is not null or pack_source is not null)) is distinct from 0
     or (select count(*) from my_card_ledger) is distinct from 4 then
    raise exception 'my_card_ledger''s pulled rows: %', rows_;
  end if;
  -- The log's cards source carries both, for each row.
  if (select count(*) from jsonb_array_elements(log_page(null) -> 'sources' -> 'cards') c where c ->> 'pack_kind' = 'ws-starter' and c ->> 'pack_source' = 'welcome') is distinct from 2
     or (select count(*) from jsonb_array_elements(log_page(null) -> 'sources' -> 'cards') c where c ->> 'pack_kind' = 'ws-lonepack' and c ->> 'pack_source' = 'bought') is distinct from 1 then
    raise exception 'log_page''s cards: %', log_page(null) -> 'sources' -> 'cards';
  end if;
  -- Another account's pulled rows are not here.
  if exists (select 1 from my_card_ledger where card = 'blot') then raise exception 'another account''s pulled row shows'; end if;
  perform tests.unbecome();
end $$;
