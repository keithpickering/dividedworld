-- The draw and the drive (supabase/migrations/0150_drives.sql; docs/plans/2026-11-03-jimmy-wails-design.md, section 4; plan Task 2).
-- A card with `draws` gets a key drawn by the server at each play (`drawn`, never the caster's). A card with a `drive` has its plays on one post share a drive,
-- which closes `lasts` after its latest play; a drive holds at most `stack` plays, and a play after the close opens a new one. card_kinds_problem refuses a bad
-- `draws` or `drive` in instanceProblems's words, seed_instance writes both columns, and card_target gives each drive play its `drive` and `closes`.
-- The cards are this file's own (dv...), never an instance's.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

create function pg_temp.eco() returns void language sql as $$
  update settings set value = value || '{"dv.g1": 10, "dv.g2": 25, "dv.over": 25}'::jsonb where key = 'economy'
$$;

-- ---- two plays at once on a post with no open drive serialize on the post's lock: one opens the drive, the other joins it ----
-- Without the lock both read no open drive and each opens one of its own. Stack 2, so both fit in one drive. Two players, so no ledger or
-- character lock of a single caster serializes them: the post's row is the only thing they share. The racers are two sessions,
-- so everything they read is committed first (tests.commit), as 0077 does. It runs first: the file's own transaction holds locks (seed_instance's) that a committed insert would wait on.
do $$
declare
  ann uuid := gen_random_uuid(); a uuid := gen_random_uuid(); bob uuid := gen_random_uuid(); b uuid := gen_random_uuid(); t uuid := gen_random_uuid(); p uuid;
  said text[];
  drives text[];
  round integer;
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'dv-race@test.invalid'), (%4$L, 'dv-race2@test.invalid');
    insert into accounts (id) values (%1$L), (%4$L);
    insert into characters (id, owner, name, created_at, debuted_at) values (%2$L, %1$L, 'Dv Racer', now(), now()), (%5$L, %4$L, 'Dv Racer Two', now(), now());
    insert into class_history (character, class_key, started_at) values (%2$L, 'alpha', now()), (%5$L, 'alpha', now());
    insert into threads (id, board, title) select %3$L, b.id, 'Dv race' from boards b where b.slug = 'general';
    insert into card_kinds (key, name, alignment, rarity, play, stack, drive) values
      ('dv-race', 'Dv Race', 'sweet', 'uncommon', 'cast', 2, '{"lasts": {"unit": "hour", "count": 1}, "gifts": ["dv.g1"], "overhead": "dv.over"}');
    insert into card_ledger (account, card, kind, price) select x, 'dv-race', 'bought', 0 from unnest(array[%1$L::uuid, %4$L::uuid]) x, generate_series(1, 20);
  $sql$, ann, a, t, bob, b));
  for round in 1 .. 10 loop
    p := gen_random_uuid();
    perform tests.commit(format($sql$ insert into acts (id, character, kind, thread, payload) values (%L, %L, 'post', %L, '{"body": "Raced on."}') $sql$, p, a, t));
    said := tests.race_service(format('select play_card(%L, ''dv-race'', %L, %L, ''{}'', 0, ''one'')', ann, a, p),
                               format('select play_card(%L, ''dv-race'', %L, %L, ''{}'', 0, ''two'')', bob, b, p));
    if said[1] is not null or said[2] is not null then raise exception 'two plays of a drive card at once, round %: %', round, said; end if;
    select array_agg(k.payload ->> 'drive' order by k.created_at, k.id) into drives from acts k where k.kind = 'card' and k.target_act_id = p;
    if cardinality(drives) is distinct from 2 or drives[1] is distinct from drives[2]
       or (select count(*) from acts k where k.kind = 'card' and k.target_act_id = p and k.payload ->> 'drive' = k.id::text) is distinct from 1 then
      raise exception 'two plays at once, round %: both landed but did not share one drive opened by one of them: %', round, drives;
    end if;
  end loop;
end $$;

-- ---- gifts at once: two gifts from a wallet that holds one are one gift and one refusal; two players giving to each other's posts at once do not wait on each other ----
-- The giver's balance is read under the wallet's lock, so the second gift sees the first's debit; the wallets are locked in account order, so a crossing pair cannot deadlock (a lock wait that never ends would
-- fail at lock_timeout). Everything they read is committed first, on the card 'dv-race' above, and the economy it reads its gift and overhead from.
do $$
declare
  ann uuid := gen_random_uuid(); a uuid := gen_random_uuid(); bob uuid := gen_random_uuid(); b uuid := gen_random_uuid(); cas uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  t uuid := gen_random_uuid(); pa uuid := gen_random_uuid(); pb uuid := gen_random_uuid(); pc uuid := gen_random_uuid();
  da uuid; db uuid; dc uuid;
  said text[];
begin
  perform tests.commit(format($sql$
    update settings set value = value || '{"dv.g1": 10, "dv.over": 25}'::jsonb where key = 'economy';
    insert into auth.users (id, email) values (%1$L, 'dv-gift-race@test.invalid'), (%4$L, 'dv-gift-race2@test.invalid'), (%7$L, 'dv-gift-race3@test.invalid');
    insert into accounts (id) values (%1$L), (%4$L), (%7$L);
    insert into characters (id, owner, name, created_at, debuted_at) values (%2$L, %1$L, 'Dv Gift Racer', now(), now()), (%5$L, %4$L, 'Dv Gift Racer Two', now(), now()), (%8$L, %7$L, 'Dv Gift Caster', now(), now());
    insert into class_history (character, class_key, started_at) values (%2$L, 'alpha', now()), (%5$L, 'alpha', now()), (%8$L, 'alpha', now());
    insert into threads (id, board, title) select %3$L, b.id, 'Dv gift race' from boards b where b.slug = 'general';
    insert into acts (id, character, kind, thread, payload) values (%9$L, %2$L, 'post', %3$L, '{"body": "Ann''s post."}'), (%10$L, %5$L, 'post', %3$L, '{"body": "Bob''s post."}'), (%11$L, %5$L, 'post', %3$L, '{"body": "Bob''s other post."}');
    insert into wallets (account, balance) values (%1$L, 10), (%4$L, 100), (%7$L, 0) on conflict (account) do update set balance = excluded.balance;
    insert into card_ledger (account, card, kind, price) select %7$L, 'dv-race', 'bought', 0 from generate_series(1, 6);
  $sql$, ann, a, t, bob, b, null, cas, c, pa, pb, pc));
  said := tests.race_service(format('select play_card(%L, ''dv-race'', %L, %L, ''{}'', 0, '''')', cas, c, pa), format('select play_card(%L, ''dv-race'', %L, %L, ''{}'', 0, '''')', cas, c, pb));
  if said[1] is not null or said[2] is not null then raise exception 'the two drives were not opened: %', said; end if;
  said := tests.race_service(format('select play_card(%L, ''dv-race'', %L, %L, ''{}'', 0, '''')', cas, c, pc), 'select 1');
  if said[1] is not null then raise exception 'the third drive was not opened: %', said; end if;
  select k.id into da from acts k where k.kind = 'card' and k.target_act_id = pa;
  select k.id into db from acts k where k.kind = 'card' and k.target_act_id = pb;
  select k.id into dc from acts k where k.kind = 'card' and k.target_act_id = pc;
  -- Ann holds 0.10, and two gifts of 0.10 arrive at once, to two of Bob's drives: no post lock is shared, so the wallet's lock alone orders them.
  said := tests.race_service(format('select donate(%L, %L, %L, 10)', ann, a, db), format('select donate(%L, %L, %L, 10)', ann, a, dc));
  if (said[1] is null) = (said[2] is null) or coalesce(said[1], said[2]) not like '%your wallet holds less than that%' then raise exception 'one gift lands and one is refused for a short wallet: %', said; end if;
  if (select balance from wallets where account = ann) is distinct from 0 or (select count(*) from acts where kind = 'donation' and target_act_id in (db, dc)) is distinct from 1 then
    raise exception 'one gift of 0.10 from 0.10: % left, % gifts', (select balance from wallets where account = ann), (select count(*) from acts where kind = 'donation' and target_act_id in (db, dc));
  end if;
  -- Bob gives to Ann's drive while Ann gives to Bob's: each wallet is the other's giver and author.
  perform tests.commit(format($sql$ update wallets set balance = 100 where account in (%L, %L) $sql$, ann, bob));
  said := tests.race_service(format('select donate(%L, %L, %L, 10)', ann, a, db), format('select donate(%L, %L, %L, 10)', bob, b, da));
  if said[1] is not null or said[2] is not null then raise exception 'two gifts crossing each other''s wallets both land: %', said; end if;
  if (select balance from wallets where account = ann) is distinct from 100 - 10 + 7 or (select balance from wallets where account = bob) is distinct from 100 - 10 + 7 then
    raise exception 'each paid 0.10 and received 0.07: %, %', (select balance from wallets where account = ann), (select balance from wallets where account = bob);
  end if;
end $$;

-- ---- card_kinds_problem: each poison is refused alone, in instanceProblems's words, and clean cards pass ----
do $$
declare
  ok constant text := '"key": "k", "rarity": "common"';
  drv constant text := '{"lasts": {"unit": "day", "count": 7}, "gifts": ["dv.g1", "dv.g2"], "overhead": "dv.over"}';
  why text;
  n integer := 0;
  c record;
begin
  perform pg_temp.eco();
  why := card_kinds_problem(('[{' || ok || ', "draws": ["a", "b-2"], "drive": ' || drv || '}]')::jsonb);
  if why is not null then raise exception 'a clean draw and drive were refused: %', why; end if;
  why := card_kinds_problem(('[{' || ok || ', "drive": ' || replace(drv, '"day", "count": 7', '"day", "count": 30') || '}]')::jsonb);
  if why is not null then raise exception 'a drive of 30 days was refused: %', why; end if;

  for c in select * from (values
    ('"draws": []', 'card "k" draws nothing; a card with a draw lists at least one key, or leaves draws out'),
    ('"draws": ["a", "a"]', 'card "k" draws "a" twice'),
    ('"draws": ["Bad Key"]', 'card "k" draws "Bad Key"; a draw is lowercase letters, digits and hyphens, 1 to 40'),
    ('"draws": "a"', 'card "k" draws "a"; draws is a list of keys'),
    ('"draws": [7]', 'card "k" draws 7; a draw is lowercase letters, digits and hyphens, 1 to 40'),
    ('"drive": "weekly"', 'card "k" has a drive that is not an object of lasts, gifts and overhead'),
    ('"drive": null', 'card "k" has a drive that is not an object of lasts, gifts and overhead'),
    ('"drive": ' || replace(drv, '["dv.g1", "dv.g2"]', '["dv.g1", "dv.g1"]'), 'card "k" has a drive that lists gift "dv.g1" twice'),
    ('"drive": ' || replace(drv, '["dv.g1", "dv.g2"]', '[]'), 'card "k" has a drive with no gift amounts (gifts); a drive lists the economy keys of at least one'),
    ('"drive": ' || replace(drv, '["dv.g1", "dv.g2"]', '"dv.g1"'), 'card "k" has a drive with no gift amounts (gifts); a drive lists the economy keys of at least one'),
    ('"drive": ' || replace(drv, '"dv.g2"', '"dv.gone"'), 'card "k" has a drive gift "dv.gone", which is not a number the economy holds'),
    ('"drive": ' || replace(drv, '"dv.over"', '"dv.gone"'), 'card "k" has a drive overhead "dv.gone", which is not a number the economy holds'),
    ('"play": "use", "lasts": {"unit": "day", "count": 1}, "gimmick": {"kind": "ward", "upTo": "common"}, "drive": ' || drv, 'card "k" has a drive, and only a cast card does'),
    ('"reaches": ["post", "thread"], "drive": ' || drv, 'card "k" has a drive, and a drive card reaches a post alone'),
    ('"drive": ' || replace(drv, '"day"', '"minute"'), 'card "k" has a drive that lasts {"unit":"minute","count":7}; it must be a span: a unit of hour, day or week and a whole count from 1 to 1000'),
    ('"drive": ' || replace(drv, '"day", "count": 7', '"month", "count": 1'), 'card "k" has a drive that lasts {"unit":"month","count":1}; it must be a span: a unit of hour, day or week and a whole count from 1 to 1000'),
    ('"drive": ' || replace(drv, '"day", "count": 7', '"day", "count": 31'), 'card "k" has a drive that lasts 31 days, longer than the 30 days a drive may')
  ) v(frag, said) loop
    n := n + 1;
    why := card_kinds_problem(('[{' || ok || ', ' || c.frag || '}]')::jsonb);
    -- The reaches case is also card_reach_problem's to say in its own words about the cards it names, never this one's.
    if why is distinct from c.said then raise exception 'case %: % was said as %, not %', n, c.frag, why, c.said; end if;
  end loop;

  -- The economy's numbers: a gift of 0, 2.5 or over the wallet's cap (600) and an overhead of -1, 101 or 12.5.
  for c in select * from (values ('0'), ('-5'), ('2.5'), ('601')) v(g) loop
    update settings set value = value || jsonb_build_object('dv.g1', c.g::numeric) where key = 'economy';
    why := card_kinds_problem(('[{' || ok || ', "drive": ' || drv || '}]')::jsonb);
    if why is distinct from format('card "k" has a drive gift "dv.g1" of %s; a gift is a positive whole number of hundredths, at most the wallet''s cap (600)', c.g) then
      raise exception 'a gift of %: %', c.g, why;
    end if;
  end loop;
  update settings set value = value || '{"dv.g1": 10}' where key = 'economy';
  for c in select * from (values ('-1'), ('101'), ('12.5')) v(o) loop
    update settings set value = value || jsonb_build_object('dv.over', c.o::numeric) where key = 'economy';
    why := card_kinds_problem(('[{' || ok || ', "drive": ' || drv || '}]')::jsonb);
    if why is distinct from format('card "k" has a drive overhead of %s; it is a whole number from 0 to 100', c.o) then
      raise exception 'an overhead of %: %', c.o, why;
    end if;
  end loop;
  update settings set value = value || '{"dv.over": 25}' where key = 'economy';
end $$;

-- ---- seed_instance writes draws and drive, refuses the poisons in the same words, and clears them on a re-seed ----
do $$
declare
  why text;
  drv jsonb := '{"lasts": {"unit": "day", "count": 7}, "gifts": ["dv.g1", "dv.g2"], "overhead": "dv.over"}';
begin
  perform pg_temp.eco();
  perform seed_instance(jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', jsonb_build_array(
    jsonb_build_object('key', 'dv-seeded', 'name', 'Dv Seeded', 'alignment', 'sweet', 'rarity', 'common', 'draws', '["x", "y"]'::jsonb, 'drive', drv),
    jsonb_build_object('key', 'dv-plain-seeded', 'name', 'Dv Plain Seeded', 'alignment', 'sweet', 'rarity', 'common'))));
  if (select draws from card_kinds where key = 'dv-seeded') is distinct from '{x,y}'::text[] then raise exception 'the seed wrote draws: %', (select draws from card_kinds where key = 'dv-seeded'); end if;
  if (select drive from card_kinds where key = 'dv-seeded') is distinct from drv then raise exception 'the seed wrote drive: %', (select drive from card_kinds where key = 'dv-seeded'); end if;
  if (select draws from card_kinds where key = 'dv-plain-seeded') is not null or (select drive from card_kinds where key = 'dv-plain-seeded') is not null then raise exception 'a card with neither has neither'; end if;
  perform seed_instance(jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', jsonb_build_array(
    jsonb_build_object('key', 'dv-seeded', 'name', 'Dv Seeded', 'alignment', 'sweet', 'rarity', 'common'))));
  if (select draws from card_kinds where key = 'dv-seeded') is not null or (select drive from card_kinds where key = 'dv-seeded') is not null then raise exception 'a re-seed kept a draw or drive the card no longer has'; end if;

  why := pg_temp.refusal($s$select seed_instance('{"settings": {}, "classes": [], "boards": [], "cards": [{"key": "dv-bad", "name": "Dv Bad", "alignment": "sweet", "rarity": "common", "draws": []}]}')$s$);
  if why is distinct from '22023 card "dv-bad" draws nothing; a card with a draw lists at least one key, or leaves draws out' then raise exception 'the seed refused empty draws, said %', why; end if;
  why := pg_temp.refusal($s$select seed_instance('{"settings": {}, "classes": [], "boards": [], "cards": [{"key": "dv-bad", "name": "Dv Bad", "alignment": "sweet", "rarity": "common", "draws": ["a", "a"]}]}')$s$);
  if why is distinct from '22023 card "dv-bad" draws "a" twice' then raise exception 'the seed refused a repeated draw, said %', why; end if;
  why := pg_temp.refusal($s$select seed_instance('{"settings": {}, "classes": [], "boards": [], "cards": [{"key": "dv-bad", "name": "Dv Bad", "alignment": "sweet", "rarity": "common", "drive": {"lasts": {"unit": "day", "count": 31}, "gifts": ["dv.g1"], "overhead": "dv.over"}}]}')$s$);
  if why is distinct from '22023 card "dv-bad" has a drive that lasts 31 days, longer than the 30 days a drive may' then raise exception 'the seed refused a long drive, said %', why; end if;
  why := pg_temp.refusal($s$select seed_instance('{"settings": {}, "classes": [], "boards": [], "cards": [{"key": "dv-bad", "name": "Dv Bad", "alignment": "sweet", "rarity": "common", "drive": {"lasts": {"unit": "day", "count": 7}, "gifts": ["dv.nope"], "overhead": "dv.over"}}]}')$s$);
  if why is distinct from '22023 card "dv-bad" has a drive gift "dv.nope", which is not a number the economy holds' then raise exception 'the seed refused an unknown gift, said %', why; end if;
  if exists (select 1 from card_kinds where key = 'dv-bad') then raise exception 'a refused seed left its card'; end if;
end $$;

-- ---- the draw: one of the card's keys, drawn by the server; a config's `drawn` is dropped ----
do $$
declare
  ann uuid := tests.account('dv-ann');
  a uuid := tests.character(ann, 'Dv Ann');
  t uuid := tests.thread('Dv draws');
  played jsonb;
  seen text[] := '{}';
  p uuid;
  i integer;
begin
  insert into card_kinds (key, name, alignment, rarity, play, stack, draws) values ('dv-draw', 'Dv Draw', 'sweet', 'uncommon', 'cast', 100, '{plate-a,plate-b,plate-c}');
  insert into card_ledger (account, card, kind, price) select ann, 'dv-draw', 'bought', 0 from generate_series(1, 40);
  p := tests.post(a, t, 'Drawn on.');
  perform tests.become_service();
  for i in 1..40 loop
    played := play_card(ann, 'dv-draw', a, p, '{"drawn": "mine", "keep": 1}', 0, '');
    if played #>> '{payload,drawn}' is null or not (played #>> '{payload,drawn}') = any ('{plate-a,plate-b,plate-c}') then raise exception 'drawn is one of the card''s draws: %', played; end if;
    seen := seen || (played #>> '{payload,drawn}');
    if played #> '{payload,config}' ? 'drawn' then raise exception 'a drawn in the caster''s config is dropped: %', played; end if;
    if played #>> '{payload,config,keep}' is distinct from '1' then raise exception 'the rest of the config stays: %', played; end if;
  end loop;
  perform tests.unbecome();
  if (select count(distinct x) from unnest(seen) x) < 2 then raise exception 'the draw is random: forty plays drew %', seen; end if;
  -- A card with no draws has no drawn, and a config's `drawn` on it is left as the caster wrote it (it is only the draw's key that is the server's).
  insert into card_kinds (key, name, alignment, rarity, play) values ('dv-nodraw', 'Dv Nodraw', 'sweet', 'uncommon', 'cast');
  insert into card_ledger (account, card, kind, price) values (ann, 'dv-nodraw', 'bought', 0);
  perform tests.become_service();
  played := play_card(ann, 'dv-nodraw', a, p, '{}', 0, '');
  perform tests.unbecome();
  if played -> 'payload' ? 'drawn' then raise exception 'a card with no draws has no drawn: %', played; end if;
end $$;

-- ---- the drive: the first play opens it, the second and third join, the fourth is refused, a play after the close opens another ----
do $$
declare
  ann uuid := tests.account('dv-ann2');
  a uuid := tests.character(ann, 'Dv Ann Two');
  t uuid := tests.thread('Dv drives');
  p uuid := tests.post(a, t, 'Please give.');
  q uuid := tests.post(a, t, 'Please give, later.');
  r uuid := tests.post(a, t, 'A plain card here.');
  played jsonb;
  p1 uuid; p2 uuid; p3 uuid; old uuid; q1 uuid; q2 uuid;
  why text;
  eff jsonb;
  last_at timestamptz;
  drv constant jsonb := '{"lasts": {"unit": "hour", "count": 1}, "gifts": ["dv.g1"], "overhead": "dv.over"}';
begin
  perform pg_temp.eco();
  insert into card_kinds (key, name, alignment, rarity, play, stack, drive) values ('dv-appeal', 'Dv Appeal', 'sweet', 'uncommon', 'cast', 3, drv);
  insert into card_kinds (key, name, alignment, rarity, play, stack) values ('dv-twice', 'Dv Twice', 'sweet', 'uncommon', 'cast', 2);
  insert into card_ledger (account, card, kind, price) select ann, 'dv-appeal', 'bought', 0 from generate_series(1, 12);
  insert into card_ledger (account, card, kind, price) select ann, 'dv-twice', 'bought', 0 from generate_series(1, 4);
  perform tests.become_service();

  -- The first play opens a drive: its payload's drive is its own id.
  played := play_card(ann, 'dv-appeal', a, p, '{}', 0, 'one');
  p1 := (played ->> 'id')::uuid;
  if played #>> '{payload,drive}' is distinct from p1::text then raise exception 'the first play opens a drive of its own id: %', played; end if;
  -- The second and third join it.
  played := play_card(ann, 'dv-appeal', a, p, '{}', 0, 'two');
  p2 := (played ->> 'id')::uuid;
  if played #>> '{payload,drive}' is distinct from p1::text then raise exception 'the second play joins the open drive: %', played; end if;
  played := play_card(ann, 'dv-appeal', a, p, '{}', 0, 'three');
  p3 := (played ->> 'id')::uuid;
  if played #>> '{payload,drive}' is distinct from p1::text then raise exception 'the third play joins the open drive: %', played; end if;
  -- The fourth is refused, in the words, and costs nothing.
  why := pg_temp.refusal(format($s$select play_card(%L, 'dv-appeal', %L, %L, '{}', 0, 'four')$s$, ann, a, p));
  if why is distinct from '23505 this post''s drive already carries 3 appeals' then raise exception 'the fourth play was refused as %', why; end if;
  if (select count(*) from acts where kind = 'card' and target_act_id = p) is distinct from 3 then raise exception 'a refused play wrote an Act'; end if;
  if card_held(ann, 'dv-appeal') <> 9 then raise exception 'a refused play spent the card: %', card_held(ann, 'dv-appeal'); end if;
  -- The refusal carries the refusal hint.
  begin
    perform play_card(ann, 'dv-appeal', a, p, '{}', 0, 'four');
    raise exception 'the fourth play landed';
  exception when others then
    if sqlstate <> '23505' then raise; end if;
    get stacked diagnostics why = pg_exception_hint;
    if why is distinct from 'kayfabb.refusal' then raise exception 'the refusal hint was %', why; end if;
  end;

  -- card_target gives each drive play its drive and its close: the latest play's time plus the span.
  eff := card_target(p) -> 'effects';
  select max(created_at) into last_at from acts where kind = 'card' and target_act_id = p;
  if jsonb_array_length(eff) <> 3 or exists (select 1 from jsonb_array_elements(eff) e where e ->> 'drive' is distinct from p1::text) then raise exception 'each drive play carries its drive: %', eff; end if;
  if exists (select 1 from jsonb_array_elements(eff) e where (e ->> 'closes')::timestamptz is distinct from last_at + interval '1 hour') then raise exception 'each drive play carries the close: %, %', eff, last_at; end if;

  -- A play on a post with a plain card is unchanged: no drive, no closes, and its own stack of two.
  played := play_card(ann, 'dv-twice', a, r, '{}', 0, '');
  if played -> 'payload' ? 'drive' then raise exception 'a card with no drive has no drive in its payload: %', played; end if;
  perform play_card(ann, 'dv-twice', a, r, '{}', 0, '');
  why := pg_temp.refusal(format($s$select play_card(%L, 'dv-twice', %L, %L, '{}', 0, '')$s$, ann, a, r));
  if why is distinct from '23505 this post already carries 2 of that card, the most it takes' then raise exception 'a plain card''s stack is as it was, said %', why; end if;
  if exists (select 1 from jsonb_array_elements(card_target(r) -> 'effects') e where e ? 'drive' or e ? 'closes') then raise exception 'a plain card''s effect has no drive or closes: %', card_target(r); end if;
  perform tests.unbecome();

  -- A play after the close opens a new drive: a drive whose plays are all two hours old has closed (it lasts one hour), and is not counted against the stack.
  old := gen_random_uuid();
  insert into acts (id, character, kind, thread, target_act_id, payload, created_at) values
    (old, a, 'card', t, q, jsonb_build_object('card', 'dv-appeal', 'message', '', 'config', '{}'::jsonb, 'layer', 1, 'drive', old), now() - interval '2 hours'),
    (gen_random_uuid(), a, 'card', t, q, jsonb_build_object('card', 'dv-appeal', 'message', '', 'config', '{}'::jsonb, 'layer', 2, 'drive', old), now() - interval '2 hours' + interval '1 minute'),
    (gen_random_uuid(), a, 'card', t, q, jsonb_build_object('card', 'dv-appeal', 'message', '', 'config', '{}'::jsonb, 'layer', 3, 'drive', old), now() - interval '2 hours' + interval '2 minutes');
  eff := card_target(q) -> 'effects';
  if exists (select 1 from jsonb_array_elements(eff) e where (e ->> 'closes')::timestamptz > now()) then raise exception 'the old drive has closed: %', eff; end if;
  perform tests.become_service();
  played := play_card(ann, 'dv-appeal', a, q, '{}', 0, 'again');
  q1 := (played ->> 'id')::uuid;
  if played #>> '{payload,drive}' is distinct from q1::text then raise exception 'a play after the close opens a new drive: %', played; end if;
  if (played #>> '{payload,layer}')::integer <> 4 then raise exception 'the layer goes on from the last one taken: %', played; end if;
  played := play_card(ann, 'dv-appeal', a, q, '{}', 0, 'and again');
  q2 := (played ->> 'id')::uuid;
  if played #>> '{payload,drive}' is distinct from q1::text then raise exception 'the new drive takes the next play: %', played; end if;
  perform tests.unbecome();
  eff := card_target(q) -> 'effects';
  if (select count(distinct e ->> 'drive') from jsonb_array_elements(eff) e) is distinct from 2 then raise exception 'the post carries two drives: %', eff; end if;
  if (select count(*) from jsonb_array_elements(eff) e where e ->> 'drive' = old::text and (e ->> 'closes')::timestamptz <= now()) is distinct from 3 then raise exception 'the old drive closed: %', eff; end if;
  if (select count(*) from jsonb_array_elements(eff) e where e ->> 'drive' = q1::text and (e ->> 'closes')::timestamptz > now()) is distinct from 2 then raise exception 'the new drive is open: %', eff; end if;
end $$;

-- ---- the close moves back with each play ----
do $$
declare
  ann uuid := tests.account('dv-ann3');
  a uuid := tests.character(ann, 'Dv Ann Three');
  t uuid := tests.thread('Dv closes');
  p uuid := tests.post(a, t, 'A drive that is kept open.');
  first_id uuid := gen_random_uuid();
  played jsonb;
  c1 timestamptz;
  c2 timestamptz;
begin
  perform pg_temp.eco();
  insert into card_kinds (key, name, alignment, rarity, play, stack, drive) values
    ('dv-keep', 'Dv Keep', 'sweet', 'uncommon', 'cast', 3, '{"lasts": {"unit": "hour", "count": 1}, "gifts": ["dv.g1"], "overhead": "dv.over"}');
  insert into card_ledger (account, card, kind, price) values (ann, 'dv-keep', 'bought', 0);
  -- One play 50 minutes old: its drive closes in ten.
  insert into acts (id, character, kind, thread, target_act_id, payload, created_at)
  values (first_id, a, 'card', t, p, jsonb_build_object('card', 'dv-keep', 'message', '', 'config', '{}'::jsonb, 'layer', 1, 'drive', first_id), now() - interval '50 minutes');
  c1 := (select max((e ->> 'closes')::timestamptz) from jsonb_array_elements(card_target(p) -> 'effects') e);
  if c1 is distinct from now() + interval '10 minutes' then raise exception 'the drive closes an hour after its play: %', c1 - now(); end if;
  perform tests.become_service();
  played := play_card(ann, 'dv-keep', a, p, '{}', 0, '');
  perform tests.unbecome();
  if played #>> '{payload,drive}' is distinct from first_id::text then raise exception 'the play joined the open drive: %', played; end if;
  c2 := (select min((e ->> 'closes')::timestamptz) from jsonb_array_elements(card_target(p) -> 'effects') e);
  if c2 is distinct from now() + interval '1 hour' or (select count(distinct e ->> 'closes') from jsonb_array_elements(card_target(p) -> 'effects') e) is distinct from 1 then
    raise exception 'the close moved back an hour from the new play: %', card_target(p);
  end if;
end $$;

-- ================================================================================================================ gifts (plan Task 3) ====
-- A gift is a `donation` Act on a drive's opening play, written by donate: it moves Aura from the giver's wallet to the post's author's (less the overhead), takes no seq, and is left out of
-- every settlement set. Each block below makes its own people, and all share the card 'dv-gift' (a drive of up to three plays, one hour, gifts of 0.10 and 0.25 at 25% overhead).

create function pg_temp.refused(stmt text) returns text language plpgsql as $$
declare hint text;
begin
  execute stmt;
  return null;
exception when others then
  get stacked diagnostics hint = pg_exception_hint;
  return sqlstate || ' | ' || coalesce(hint, '-') || ' | ' || sqlerrm;
end $$;

create function pg_temp.wallet(acct uuid, bal integer) returns void language sql as $$
  insert into wallets (account, balance) values (acct, bal) on conflict (account) do update set balance = excluded.balance
$$;

-- A drive on a post: the caster plays 'dv-gift' on it, and its drive is the id of the play that comes back. The caster is a service call, as an Edge Function's.
create function pg_temp.open_drive(caster uuid, as_character uuid, post uuid) returns uuid language plpgsql as $$
declare played jsonb;
begin
  perform tests.become_service();
  played := play_card(caster, 'dv-gift', as_character, post, '{}', 0, 'Please give.');
  perform tests.unbecome();
  return (played ->> 'id')::uuid;
end $$;

-- What a gift's answer says with the identifiers that differ between two gifts left out: the shape and the money.
create function pg_temp.shape(answer jsonb) returns text language sql as $$
  select (answer #- '{gift,id}' #- '{gift,thread}' #- '{gift,target_act_id}' #- '{gift,created_at}' #- '{gift,character}')::text
$$;

-- ---- a gift moves the amount out and `arrives` in; 0.10 at 25% is 0.03 of overhead; the split reads the economy as it is now ----
do $$
declare
  gv uuid := tests.account('dg-giver');  gch uuid := tests.character(gv, 'Dg Giver');
  au uuid := tests.account('dg-author'); ach uuid := tests.character(au, 'Dg Author');
  cs uuid := tests.account('dg-caster'); cch uuid := tests.character(cs, 'Dg Caster');
  t uuid := tests.thread('Dg moves');
  p uuid := tests.post(ach, t, 'A post that wants a gift.');
  d uuid;
  answer jsonb;
  gift uuid;
  ev record;
begin
  perform pg_temp.eco();
  insert into card_kinds (key, name, alignment, rarity, play, stack, drive) values
    ('dv-gift', 'Dv Gift', 'sweet', 'uncommon', 'cast', 3, '{"lasts": {"unit": "hour", "count": 1}, "gifts": ["dv.g1", "dv.g2"], "overhead": "dv.over"}'),
    ('dv-plaingift', 'Dv Plain Gift', 'sweet', 'uncommon', 'cast', 3, null);
  insert into card_ledger (account, card, kind, price) select cs, 'dv-gift', 'bought', 0 from generate_series(1, 30);
  perform pg_temp.wallet(gv, 100);
  perform pg_temp.wallet(au, 50);
  d := pg_temp.open_drive(cs, cch, p);

  perform tests.become_service();
  answer := donate(gv, gch, d, 10);
  perform tests.unbecome();
  gift := (answer #>> '{gift,id}')::uuid;
  if (select kind from acts where id = gift) is distinct from 'donation' then raise exception 'a gift is a donation Act: %', answer; end if;
  if answer #> '{gift,payload}' is distinct from '{"amount": 10, "overhead": 3, "arrives": 7}'::jsonb then raise exception '0.10 at 25 percent is 0.03 of overhead and 0.07 arriving: %', answer; end if;
  if (answer #>> '{gift,character}')::uuid is distinct from gch or (answer #>> '{gift,target_act_id}')::uuid is distinct from d then raise exception 'the gift is the giver''s, on the drive: %', answer; end if;
  if (answer ->> 'balance')::integer is distinct from 90 then raise exception 'the answer carries the giver''s own balance after: %', answer; end if;
  if (select balance from wallets where account = gv) is distinct from 90 then raise exception 'the giver paid the amount: %', (select balance from wallets where account = gv); end if;
  if (select balance from wallets where account = au) is distinct from 57 then raise exception 'the author received what arrives: %', (select balance from wallets where account = au); end if;
  select * into ev from wallet_events where ref = gift and kind = 'gift_out';
  if ev.account is distinct from gv or ev.change is distinct from -10 or ev.balance_after is distinct from 90 or ev.overflow <> 0 then raise exception 'the giver''s event: %', ev; end if;
  select * into ev from wallet_events where ref = gift and kind = 'gift_in';
  if ev.account is distinct from au or ev.change is distinct from 7 or ev.balance_after is distinct from 57 or ev.overflow <> 0 then raise exception 'the author''s event: %', ev; end if;
  if (select count(*) from wallet_events where ref = gift) is distinct from 2 then raise exception 'a gift writes two wallet events, one for each side'; end if;
  -- The overhead is lost: nothing else holds it.
  if (select sum(balance) from wallets where account in (gv, au, cs)) is distinct from 147::bigint then raise exception 'what was kept is the overhead, and it is no wallet''s'; end if;

  -- 0.25 at 25 percent: ceil(6.25) = 7 of overhead, 18 arrives. The overhead is read from the economy now: at 10 percent, 0.25 keeps ceil(2.5) = 3.
  perform tests.become_service();
  answer := donate(gv, gch, d, 25);
  if answer #> '{gift,payload}' is distinct from '{"amount": 25, "overhead": 7, "arrives": 18}'::jsonb then raise exception '0.25 at 25 percent: %', answer; end if;
  update settings set value = value || '{"dv.over": 10}' where key = 'economy';
  answer := donate(gv, gch, d, 25);
  if answer #> '{gift,payload}' is distinct from '{"amount": 25, "overhead": 3, "arrives": 22}'::jsonb then raise exception 'the overhead is read when the gift is given: %', answer; end if;
  update settings set value = value || '{"dv.over": 25}' where key = 'economy';
  perform tests.unbecome();
  if (select balance from wallets where account = gv) is distinct from 40 then raise exception 'three gifts took 0.60: %', (select balance from wallets where account = gv); end if;

  -- The Act's text is a gift's alone: no account, no wallet.
  if (select payload::text from acts where id = gift) ~* (au::text || '|' || gv::text) then raise exception 'a gift names no account'; end if;
end $$;

-- ---- a full author wallet: the giver's answer is byte-identical to the same gift with room, and the author's event records the overflow ----
do $$
declare
  ga uuid := tests.account('df-giver-a'); gca uuid := tests.character(ga, 'Df Giver A');
  gb uuid := tests.account('df-giver-b'); gcb uuid := tests.character(gb, 'Df Giver B');
  aa uuid := tests.account('df-author-a'); aca uuid := tests.character(aa, 'Df Author A');
  ab uuid := tests.account('df-author-b'); acb uuid := tests.character(ab, 'Df Author B');
  cs uuid := tests.account('df-caster'); cch uuid := tests.character(cs, 'Df Caster');
  pa uuid := tests.post(aca, tests.thread('Df full'), 'A post, its author''s wallet full.');
  pb uuid := tests.post(acb, tests.thread('Df room'), 'A post, its author''s wallet with room.');
  da uuid; db uuid;
  ra jsonb; rb jsonb;
  ev record;
begin
  perform pg_temp.eco();
  insert into card_ledger (account, card, kind, price) select cs, 'dv-gift', 'bought', 0 from generate_series(1, 4);
  perform pg_temp.wallet(ga, 100); perform pg_temp.wallet(gb, 100);
  perform pg_temp.wallet(aa, 600); perform pg_temp.wallet(ab, 50);
  da := pg_temp.open_drive(cs, cch, pa);
  db := pg_temp.open_drive(cs, cch, pb);
  perform tests.become_service();
  ra := donate(ga, gca, da, 10);
  rb := donate(gb, gcb, db, 10);
  perform tests.unbecome();
  if pg_temp.shape(ra) is distinct from pg_temp.shape(rb) then raise exception 'the giver''s answer differs with the author''s wallet: % and %', ra, rb; end if;
  if ra::text ~* (aa::text || '|' || ab::text || '|' || 'overflow') then raise exception 'the answer carries something of the author: %', ra; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(ra) k) is distinct from array['balance', 'gift'] then raise exception 'the answer is the gift and the giver''s balance, nothing else: %', ra; end if;
  select * into ev from wallet_events where ref = (ra #>> '{gift,id}')::uuid and kind = 'gift_in';
  if ev.account is distinct from aa or ev.change is distinct from 0 or ev.overflow is distinct from 7 or ev.balance_after is distinct from 600 then raise exception 'the full wallet''s event records the overflow: %', ev; end if;
  select * into ev from wallet_events where ref = (rb #>> '{gift,id}')::uuid and kind = 'gift_in';
  if ev.account is distinct from ab or ev.change is distinct from 7 or ev.overflow is distinct from 0 then raise exception 'the wallet with room took it: %', ev; end if;
  if (select balance from wallets where account = ga) is distinct from 90 then raise exception 'the giver paid in full though the author''s wallet was full'; end if;
  -- The same Act in both: the public payload says what was sent, never what landed.
  if (ra #> '{gift,payload}') is distinct from (rb #> '{gift,payload}') then raise exception 'the Acts differ: % and %', ra, rb; end if;
end $$;

-- ---- a gift to one's own mask costs exactly the overhead ----
do $$
declare
  s uuid := tests.account('ds-self'); s1 uuid := tests.character(s, 'Ds Poster'); s2 uuid := tests.character(s, 'Ds Giver');
  cs uuid := tests.account('ds-caster'); cch uuid := tests.character(cs, 'Ds Caster');
  p uuid := tests.post(s1, tests.thread('Ds self'), 'My own post.');
  d uuid;
  r jsonb;
  g uuid;
begin
  perform pg_temp.eco();
  insert into card_ledger (account, card, kind, price) values (cs, 'dv-gift', 'bought', 0);
  perform pg_temp.wallet(s, 100);
  d := pg_temp.open_drive(cs, cch, p);
  perform tests.become_service();
  r := donate(s, s2, d, 10);
  perform tests.unbecome();
  g := (r #>> '{gift,id}')::uuid;
  if (select balance from wallets where account = s) is distinct from 97 then raise exception 'a gift to one''s own mask costs the overhead: %', (select balance from wallets where account = s); end if;
  if (r ->> 'balance')::integer is distinct from 97 then raise exception 'the answer is the wallet after both moves: %', r; end if;
  if (select array_agg(kind || ':' || change order by id) from wallet_events where ref = g) is distinct from array['gift_out:-10', 'gift_in:7'] then
    raise exception 'both moves land on the one wallet, out and then in: %', (select array_agg(kind || ':' || change order by id) from wallet_events where ref = g);
  end if;
  if (select array_agg(k order by k) from jsonb_object_keys(r) k) is distinct from array['balance', 'gift'] then raise exception 'the same shape as any gift: %', r; end if;
end $$;

-- ---- a gift on a staff post is all overhead, and no author's wallet is written ----
do $$
declare
  gv uuid := tests.account('dt-giver'); gch uuid := tests.character(gv, 'Dt Giver');
  cs uuid := tests.account('dt-caster'); cch uuid := tests.character(cs, 'Dt Caster');
  t uuid := tests.thread('Dt staff');
  boss uuid;
  decree uuid;
  d uuid;
  r jsonb;
  wallets_before integer;
begin
  perform pg_temp.eco();
  insert into card_ledger (account, card, kind, price) values (cs, 'dv-gift', 'bought', 0);
  insert into characters (name, staff, staff_kind, debuted_at) values ('Dt Boss', 'dt-boss', 'persona', now()) returning id into boss;
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, payload) values (boss, 'post', t, '{"body": "A decree."}') returning id into decree;
  perform set_config('kayfabb.staff_writer', '', true);
  perform pg_temp.wallet(gv, 100);
  d := pg_temp.open_drive(cs, cch, decree);
  select count(*) into wallets_before from wallets;
  perform tests.become_service();
  r := donate(gv, gch, d, 10);
  perform tests.unbecome();
  if r #> '{gift,payload}' is distinct from '{"amount": 10, "overhead": 10, "arrives": 0}'::jsonb then raise exception 'a staff post''s gift is all overhead: %', r; end if;
  if (r ->> 'balance')::integer is distinct from 90 then raise exception 'the giver paid the whole amount: %', r; end if;
  if (select count(*) from wallet_events where ref = (r #>> '{gift,id}')::uuid) is distinct from 1 then raise exception 'only the giver has a wallet event'; end if;
  if (select count(*) from wallets) is distinct from wallets_before then raise exception 'no wallet row was made for a staff post''s author'; end if;
end $$;

-- ---- each refusal in its words, with the refusal hint, and each writes nothing and costs nothing ----
do $$
declare
  gv uuid := tests.account('dr-giver'); gch uuid := tests.character(gv, 'Dr Giver');
  other uuid := tests.account('dr-other'); och uuid := tests.character(other, 'Dr Other');
  au uuid := tests.account('dr-author'); ach uuid := tests.character(au, 'Dr Author');
  cs uuid := tests.account('dr-caster'); cch uuid := tests.character(cs, 'Dr Caster');
  t uuid := tests.thread('Dr refusals');
  p uuid := tests.post(ach, t, 'A post to refuse on.');
  q uuid := tests.post(ach, t, 'A post with a closed drive.');
  r uuid := tests.post(ach, t, 'A post with a plain card.');
  d uuid; second uuid; old uuid; plain uuid;
  why text;
  gifts_before bigint;
  played jsonb;
begin
  perform pg_temp.eco();
  insert into card_ledger (account, card, kind, price) select cs, c, 'bought', 0 from unnest(array['dv-gift', 'dv-plaingift']) c, generate_series(1, 4);
  perform pg_temp.wallet(gv, 5);
  perform pg_temp.wallet(au, 20);
  d := pg_temp.open_drive(cs, cch, p);
  perform tests.become_service();
  played := play_card(cs, 'dv-gift', cch, p, '{}', 0, 'And again.');
  second := (played ->> 'id')::uuid;
  played := play_card(cs, 'dv-plaingift', cch, r, '{}', 0, '');
  plain := (played ->> 'id')::uuid;
  perform tests.unbecome();
  -- A drive that closed: all its plays two hours old, and it lasts one hour.
  old := gen_random_uuid();
  insert into acts (id, character, kind, thread, target_act_id, payload, created_at)
  values (old, cch, 'card', t, q, jsonb_build_object('card', 'dv-gift', 'message', '', 'config', '{}'::jsonb, 'layer', 1, 'drive', old), now() - interval '2 hours');
  select count(*) into gifts_before from acts where kind = 'donation';
  perform tests.become_service();

  -- A closed drive.
  why := pg_temp.refused(format('select donate(%L, %L, %L, 10)', gv, gch, old));
  if why is distinct from '55000 | kayfabb.refusal | this drive has ended' then raise exception 'a closed drive: %', why; end if;
  -- An amount the card does not offer: 0.11, nothing, nothing at all, and a negative one.
  foreach why in array array[format('select donate(%L, %L, %L, 11)', gv, gch, d), format('select donate(%L, %L, %L, 0)', gv, gch, d),
                             format('select donate(%L, %L, %L, null)', gv, gch, d), format('select donate(%L, %L, %L, -10)', gv, gch, d)] loop
    why := pg_temp.refused(why);
    if why is distinct from '22023 | kayfabb.refusal | a gift here is one of 0.10, 0.25' then raise exception 'an amount not offered: %', why; end if;
  end loop;
  -- An amount that was offered and is not now: the card lists the economy's keys, so a changed economy changes what is offered.
  update settings set value = value || '{"dv.g1": 12}' where key = 'economy';
  why := pg_temp.refused(format('select donate(%L, %L, %L, 10)', gv, gch, d));
  if why is distinct from '22023 | kayfabb.refusal | a gift here is one of 0.12, 0.25' then raise exception 'the offered amounts are read when the gift is given: %', why; end if;
  update settings set value = value || '{"dv.g1": 10}' where key = 'economy';
  -- A wallet short of the amount: 0.05 in it, 0.10 asked. Read from the giver's own wallet.
  why := pg_temp.refused(format('select donate(%L, %L, %L, 10)', gv, gch, d));
  if why is distinct from 'P0001 | kayfabb.refusal | your wallet holds less than that' then raise exception 'a short wallet: %', why; end if;
  -- A target that is not a drive: a post, a plain card's play, the second play of a drive (not its opening play), nothing, and a made-up id.
  foreach why in array array[p::text, plain::text, second::text, gen_random_uuid()::text, 'null'] loop
    why := pg_temp.refused(format('select donate(%L, %L, %s, 10)', gv, gch, case when why = 'null' then 'null' else quote_literal(why) end));
    if why is distinct from '22023 | kayfabb.refusal | that is not a drive' then raise exception 'a target that is not a drive: %', why; end if;
  end loop;
  -- Somebody else's character.
  why := pg_temp.refused(format('select donate(%L, %L, %L, 10)', gv, och, d));
  if why is distinct from '42501 | kayfabb.refusal | you do not play that character' then raise exception 'a character that is not yours: %', why; end if;
  perform tests.unbecome();

  if (select count(*) from acts where kind = 'donation') is distinct from gifts_before then raise exception 'a refused gift wrote an Act'; end if;
  if (select balance from wallets where account = gv) is distinct from 5 or (select balance from wallets where account = au) is distinct from 20 then raise exception 'a refused gift moved Aura'; end if;
  if exists (select 1 from wallet_events e where e.kind in ('gift_out', 'gift_in') and e.account in (gv, au)) then raise exception 'a refused gift wrote a wallet event'; end if;

  -- The Act is well formed on its own, whoever writes it: a payload that does not add up, a negative part, an extra key, and a target that is no drive's opening play are each refused at the table.
  foreach why in array array[
    format($i$insert into acts (character, kind, thread, target_act_id, payload) values (%L, 'donation', %L, %L, '{"amount": 10, "overhead": 3, "arrives": 6}')$i$, gch, t, d),
    format($i$insert into acts (character, kind, thread, target_act_id, payload) values (%L, 'donation', %L, %L, '{"amount": 10, "overhead": -3, "arrives": 13}')$i$, gch, t, d),
    format($i$insert into acts (character, kind, thread, target_act_id, payload) values (%L, 'donation', %L, %L, '{"amount": 0, "overhead": 0, "arrives": 0}')$i$, gch, t, d),
    format($i$insert into acts (character, kind, thread, target_act_id, payload) values (%L, 'donation', %L, %L, '{"amount": 10, "overhead": 3, "arrives": 7, "from": "x"}')$i$, gch, t, d),
    format($i$insert into acts (character, kind, thread, target_act_id, payload) values (%L, 'donation', %L, %L, '{"amount": 10.5, "overhead": 3, "arrives": 7.5}')$i$, gch, t, d),
    format($i$insert into acts (character, kind, thread, target_act_id, payload) values (%L, 'donation', %L, %L, '{"amount": "10", "overhead": 3, "arrives": 7}')$i$, gch, t, d),
    format($i$insert into acts (character, kind, thread, payload) values (%L, 'donation', %L, '{"amount": 10, "overhead": 3, "arrives": 7}')$i$, gch, t),
    format($i$insert into acts (character, kind, thread, target_act_id, payload) values (%L, 'donation', %L, %L, '{"amount": 10, "overhead": 3, "arrives": 7}')$i$, gch, t, p),
    format($i$insert into acts (character, kind, thread, target_act_id, payload) values (%L, 'donation', %L, %L, '{"amount": 10, "overhead": 3, "arrives": 7}')$i$, gch, t, second),
    format($i$insert into acts (character, kind, thread, target_act_id, payload) values (%L, 'donation', %L, %L, '{"amount": 10, "overhead": 3, "arrives": 7}')$i$, gch, t, plain)] loop
    if pg_temp.refused(why) is null then raise exception 'a malformed gift was written: %', why; end if;
  end loop;
  if (select count(*) from acts where kind = 'donation') is distinct from gifts_before then raise exception 'a malformed gift stayed'; end if;
end $$;

-- ---- a donation takes no seq, and leaves its thread's last_at, replies and next_seq alone ----
do $$
declare
  gv uuid := tests.account('dq-giver'); gch uuid := tests.character(gv, 'Dq Giver');
  au uuid := tests.account('dq-author'); ach uuid := tests.character(au, 'Dq Author');
  cs uuid := tests.account('dq-caster'); cch uuid := tests.character(cs, 'Dq Caster');
  t uuid := tests.thread('Dq seq');
  p uuid := tests.post(ach, t, 'A day-old post.', now() - interval '1 day');
  d uuid;
  r jsonb;
  before_row threads%rowtype;
  after_row threads%rowtype;
  pages_before jsonb;
  pages_after jsonb;
begin
  perform pg_temp.eco();
  insert into card_ledger (account, card, kind, price) values (cs, 'dv-gift', 'bought', 0);
  perform pg_temp.wallet(gv, 100);
  d := pg_temp.open_drive(cs, cch, p);
  select * into before_row from threads where id = t;
  -- The readers of a thread's Acts and of its numbers, as a signed-in player reads them: the thread's page, its board's page and the index, before and after a gift.
  perform tests.become(au);
  pages_before := jsonb_build_array(thread_page(t, 1, null, null, '{}'), board_page('general', 1, '{}'), index_page());
  perform tests.unbecome();
  perform tests.become_service();
  r := donate(gv, gch, d, 10);
  perform tests.unbecome();
  select * into after_row from threads where id = t;
  perform tests.become(au);
  pages_after := jsonb_build_array(thread_page(t, 1, null, null, '{}'), board_page('general', 1, '{}'), index_page());
  perform tests.unbecome();
  if pages_after is distinct from pages_before then raise exception 'a gift changed what a reader of the thread sees: % then %', pages_before, pages_after; end if;

  if (select seq from acts where id = (r #>> '{gift,id}')::uuid) is not null or r #> '{gift,seq}' <> 'null'::jsonb then raise exception 'a donation takes no seq: %', r; end if;
  if after_row.next_seq is distinct from before_row.next_seq or after_row.replies is distinct from before_row.replies or after_row.last_at is distinct from before_row.last_at then
    raise exception 'a donation moved its thread: % then %', before_row, after_row;
  end if;
  if after_row.last_at > now() - interval '12 hours' then raise exception 'the thread was bumped by a gift'; end if;
end $$;

-- ---- who may call donate: the service role alone; the reads: a signed-in player, not a visitor ----
do $$
declare
  ann uuid := tests.account('dp-ann'); a uuid := tests.character(ann, 'Dp Ann');
  why text;
begin
  if has_function_privilege('authenticated', 'donate(uuid, uuid, uuid, integer)', 'execute') or has_function_privilege('anon', 'donate(uuid, uuid, uuid, integer)', 'execute') then
    raise exception 'an API role can execute donate';
  end if;
  if not has_function_privilege('service_role', 'donate(uuid, uuid, uuid, integer)', 'execute') then raise exception 'the service role cannot execute donate'; end if;
  perform tests.become(ann);
  why := pg_temp.refused(format('select donate(%L, %L, %L, 10)', ann, a, gen_random_uuid()));
  perform tests.unbecome();
  if why is null or why not like '42501 %' then raise exception 'a signed-in player called donate: %', why; end if;
  perform tests.become_anon();
  why := pg_temp.refused('select drive_gifts(array[gen_random_uuid()])');
  perform tests.unbecome();
  if why is null or why not like '42501 %' then raise exception 'a visitor read a drive''s gifts: %', why; end if;
  if not has_function_privilege('authenticated', 'drive_gifts(uuid[])', 'execute') or not has_function_privilege('authenticated', 'drive_gifts_page(uuid, timestamptz)', 'execute') then
    raise exception 'a signed-in player cannot read the gifts';
  end if;
  if exists (select 1 from pg_indexes where indexname = 'acts_donations' and indexdef ~ '\(target_act_id, created_at\) WHERE \(kind = ''donation''::text\)') is not true then
    raise exception 'the donation index is missing or is not the partial index on the drive and the time';
  end if;
end $$;

-- ---- drive_gifts: a drive's total, count and latest 20; drive_gifts_page: the next 20; only public columns ----
do $$
declare
  gv uuid := tests.account('dd-giver'); gch uuid := tests.character(gv, 'Dd Giver');
  au uuid := tests.account('dd-author'); ach uuid := tests.character(au, 'Dd Author');
  cs uuid := tests.account('dd-caster'); cch uuid := tests.character(cs, 'Dd Caster');
  t uuid := tests.thread('Dd reads');
  p uuid := tests.post(ach, t, 'A busy drive.');
  q uuid := tests.post(ach, t, 'A quiet one.');
  d uuid; e uuid;
  got jsonb;
  page jsonb;
  oldest timestamptz;
begin
  perform pg_temp.eco();
  insert into card_ledger (account, card, kind, price) select cs, 'dv-gift', 'bought', 0 from generate_series(1, 2);
  d := pg_temp.open_drive(cs, cch, p);
  e := pg_temp.open_drive(cs, cch, q);
  -- Twenty-five gifts of 0.10 and one of 0.25, a minute apart, written as the table allows (the reads depend on nothing else).
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  select gch, 'donation', t, d, jsonb_build_object('amount', 10, 'overhead', 3, 'arrives', 7), now() - make_interval(mins => n) from generate_series(2, 26) n;
  insert into acts (character, kind, thread, target_act_id, payload, created_at) values (gch, 'donation', t, d, '{"amount": 25, "overhead": 7, "arrives": 18}', now() - interval '1 minute');
  perform tests.become(gv);
  got := drive_gifts(array[d, e, gen_random_uuid()]);
  if jsonb_array_length(got) is distinct from 3 then raise exception 'one row for each drive asked, in order: %', got; end if;
  if got #>> '{0,drive}' is distinct from d::text or (got #>> '{0,total}')::integer is distinct from 275 or (got #>> '{0,count}')::integer is distinct from 26 or jsonb_array_length(got #> '{0,gifts}') is distinct from 20 then
    raise exception 'a busy drive: its total 2.75, its count 26 and its latest 20: %', got #- '{0,gifts}';
  end if;
  if got #>> '{0,gifts,0,amount}' is distinct from '25' then raise exception 'the latest gift is first: %', got #> '{0,gifts,0}'; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(got #> '{0,gifts,0}') k) is distinct from array['amount', 'at', 'character', 'id'] then raise exception 'a gift row shows its giver, amount and time: %', got #> '{0,gifts,0}'; end if;
  if got #>> '{0,gifts,0,character}' is distinct from gch::text then raise exception 'the giver is the giving character: %', got #> '{0,gifts,0}'; end if;
  if got::text ~* 'arrives|overhead' then raise exception 'the wall shows only what was given: %', got; end if;
  if (got #>> '{1,total}')::integer is distinct from 0 or (got #>> '{1,count}')::integer is distinct from 0 or got #> '{1,gifts}' is distinct from '[]'::jsonb then raise exception 'a drive nobody gave to: %', got #> '{1}'; end if;
  if (got #>> '{2,count}')::integer is distinct from 0 then raise exception 'an id that is no drive has no gifts: %', got #> '{2}'; end if;
  -- The next 20: the six beyond the first twenty, older than the twentieth shown.
  oldest := (got #>> '{0,gifts,19,at}')::timestamptz;
  page := drive_gifts_page(d, oldest);
  if jsonb_array_length(page -> 'gifts') is distinct from 6 or (page ->> 'more')::boolean is distinct from false then raise exception 'the page after the first 20: %', page; end if;
  if (page #>> '{gifts,0,at}')::timestamptz >= oldest then raise exception 'the page is older than what was shown: %', page; end if;
  -- A page of 20 with more behind it says so.
  page := drive_gifts_page(d, now());
  if jsonb_array_length(page -> 'gifts') is distinct from 20 or (page ->> 'more')::boolean is distinct from true then raise exception 'a full page says more follows: %', page #- '{gifts}'; end if;
  perform tests.unbecome();
end $$;

-- ---- settlement: a window holding gifts is the window without them ----
do $$
declare
  gv uuid := tests.account('db-giver'); gch uuid := tests.character(gv, 'Db Giver');
  gw uuid := tests.account('db-giver2'); gch2 uuid := tests.character(gw, 'Db Giver Two');
  au uuid := tests.account('db-author'); ach uuid := tests.character(au, 'Db Author');
  cs uuid := tests.account('db-caster'); cch uuid := tests.character(cs, 'Db Caster');
  t uuid := tests.thread('Db settle');
  p uuid := tests.post(ach, t, 'A post in the window.');
  d uuid;
  w_from constant timestamptz := now() - interval '1 hour';
  w_to constant timestamptz := now() + interval '1 hour';
  without_gifts jsonb;
  with_gifts jsonb;
  est jsonb;
begin
  perform pg_temp.eco();
  insert into card_ledger (account, card, kind, price) values (cs, 'dv-gift', 'bought', 0);
  perform pg_temp.wallet(gv, 100); perform pg_temp.wallet(gw, 100);
  d := pg_temp.open_drive(cs, cch, p);
  without_gifts := settlement_input(w_from, w_to);
  if not exists (select 1 from jsonb_array_elements(without_gifts -> 'acts') x where x ->> 'id' = p::text) then raise exception 'the window holds the post: %', without_gifts; end if;
  perform tests.become_service();
  perform donate(gv, gch, d, 10);
  perform donate(gw, gch2, d, 25);
  perform donate(gv, gch, d, 25);
  perform tests.unbecome();
  with_gifts := settlement_input(w_from, w_to);
  if with_gifts is distinct from without_gifts then
    raise exception 'a window with gifts is not the window without them: % gifts in acts, characters % then %', (select count(*) from jsonb_array_elements(with_gifts -> 'acts') x where x ->> 'kind' = 'donation'),
      jsonb_array_length(without_gifts -> 'characters'), jsonb_array_length(with_gifts -> 'characters');
  end if;
  -- A reaction to a gift (react() does not yet refuse one) is no one's to settle either: it and the gift are left out, and the reactor's mask is not named for it.
  declare
    one uuid := (select a.id from acts a where a.kind = 'donation' and a.target_act_id = d and a.character = gch limit 1);
    reacted_to jsonb;
  begin
    reacted_to := settlement_input(w_from, w_to);
    insert into reactions (act, reactor_character, reactor_account, kind, slot) values (one, cch, cs, 'up', 1);
    if settlement_input(w_from, w_to) is distinct from reacted_to then raise exception 'a reaction to a gift reached the settlement''s input'; end if;
    if exists (select 1 from jsonb_array_elements(coalesce(estimate_input(gv, w_to) -> 'reactions', '[]')) x where x ->> 'act' = one::text) then raise exception 'a reaction to a gift reached the estimate'; end if;
  end;
  -- A thread spun from a post is read when it is active in the window, with its spin and each character's first post. A gift is no activity: a spun thread whose only Act in the window is a gift is not read.
  declare
    origin uuid := tests.post(ach, tests.thread('Db origin'), 'The post a thread was spun from.', now() - interval '3 days');
    spun uuid;
    sp uuid;
    opening uuid := gen_random_uuid();
    before_gift jsonb;
  begin
    insert into threads (board, title, origin_act_id) select board, 'Db spun', origin from threads where id = t returning id into spun;
    perform tests.act(cch, 'spin', spun, '{"title": "Db spun"}', origin, now() - interval '3 days');
    sp := tests.post(ach, spun, 'A post in the spun thread.', now() - interval '3 days');
    insert into acts (id, character, kind, thread, target_act_id, payload, created_at)
    values (opening, cch, 'card', spun, sp, jsonb_build_object('card', 'dv-gift', 'message', '', 'config', '{}'::jsonb, 'layer', 1, 'drive', opening), now() - interval '3 days');
    before_gift := settlement_input(w_from, w_to);
    insert into acts (character, kind, thread, target_act_id, payload) values (gch, 'donation', spun, opening, '{"amount": 10, "overhead": 3, "arrives": 7}');
    if settlement_input(w_from, w_to) is distinct from before_gift then raise exception 'a gift on a spun thread made the thread active in the window'; end if;
  end;
  -- The live estimate, which reads the caller's own Acts, leaves them out as well.
  est := estimate_input(gv, w_to);
  if exists (select 1 from jsonb_array_elements(coalesce(est -> 'acts', '[]')) x where x ->> 'kind' = 'donation') then raise exception 'the estimate holds a gift: %', est -> 'acts'; end if;
  est := estimate_input(au, w_to);
  if exists (select 1 from jsonb_array_elements(coalesce(est -> 'acts', '[]')) x where x ->> 'kind' = 'donation') then raise exception 'the author''s estimate holds a gift: %', est -> 'acts'; end if;
end $$;
