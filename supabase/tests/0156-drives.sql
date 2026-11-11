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
