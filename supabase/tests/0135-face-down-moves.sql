-- Face-down Moves, the schema (supabase/migrations/0142_face_down_moves.sql): a back names the card its Trap Card waits for, or the
-- phrase its Move waits for, and only the setter reads either; a Gimmick's trap shape is a cast or a visit; a card a Trap Card took is
-- a `caught` row in the setter's card ledger; one function, card_held, is the hand. docs/plans/2026-11-07-face-down-moves-plan.md,
-- Task 3, and Task 6's springing from 'Springing (Task 6)' on; the design is docs/plans/2026-11-07-face-down-moves-design.md, sections 4, 5 and 9. The cards are the engine's test set,
-- never an instance's.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- ---- Springing (Task 6), races first, so the rows they commit wait on nothing this file has written and not committed ----
-- The Moves, the Gimmicks, the players and a pool persona the races share, committed. Moves are the engine's test cards (spx...), never an instance's.
do $$
begin
  perform tests.commit($sql$
    insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts) values
      ('spxwhoops', 'Spx Whoops', 'salty', 'common', 'cast', null, '{post}', null),
      ('spxbomb', 'Spx Bomb', 'salty', 'uncommon', 'cast', null, '{character}', interval '7 days'),
      ('spxthread', 'Spx Thread', 'salty', 'rare', 'cast', null, '{thread}', interval '1 day'),
      ('spxboard', 'Spx Board', 'salty', 'legendary', 'cast', null, '{board}', interval '1 day'),
      ('spxrare', 'Spx Rare', 'sweet', 'rare', 'cast', null, '{post}', null),
      ('spxauto', 'Spx Auto', 'salty', 'common', 'cast', null, '{post}', null),
      ('spxtrap', 'Spx Trap', 'salty', 'uncommon', 'set', '{"trigger": {"on": "cast"}}', '{post}', null),
      ('spxpass', 'Spx Pass', 'sweet', 'uncommon', 'set', '{"trigger": {"on": "visit"}}', '{post}', null),
      ('spxbluff', 'Spx Bluff', 'pepperoni', 'common', 'set', null, '{post}', null);
    insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts, ward) values
      ('spxward', 'Spx Ward', 'sweet', 'uncommon', 'use', null, '{post}', interval '7 days', true);
    insert into characters (id, name, staff, staff_kind, debuted_at) values ('00000000-0000-4000-8000-0000000fd001', 'Spx Race Mod', 'spx-race-mod', 'persona', now()) on conflict do nothing;
  $sql$);
end $$;

-- Two quotes at once on one backed post spring it once: the first lays the Move, the second finds the spring (acts_one_spring) and lands its post without one.
do $$
declare
  setter uuid := gen_random_uuid(); one uuid := gen_random_uuid(); two uuid := gen_random_uuid();
  s uuid := gen_random_uuid(); a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  t uuid := gen_random_uuid();
  x uuid;
  said text[];
  round integer;
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'sp-two-setter@test.invalid'), (%2$L, 'sp-two-one@test.invalid'), (%3$L, 'sp-two-two@test.invalid');
    insert into accounts (id) values (%1$L), (%2$L), (%3$L);
    insert into characters (id, owner, name, created_at, debuted_at) values (%4$L, %1$L, 'Sp Two Setter', now(), now()), (%5$L, %2$L, 'Sp Two One', now(), now()), (%6$L, %3$L, 'Sp Two Two', now(), now());
    insert into class_history (character, class_key, started_at) values (%4$L, 'alpha', now()), (%5$L, 'alpha', now()), (%6$L, 'alpha', now());
    insert into threads (id, board, title) select %7$L, b.id, 'Two quotes' from boards b where b.slug = 'general';
    insert into card_ledger (account, card, kind, price) select %1$L, 'spxwhoops', 'bought', 0 from generate_series(1, 12);
  $sql$, setter, one, two, s, a, b, t));
  for round in 1 .. 10 loop
    x := gen_random_uuid();
    perform tests.commit(format($sql$
      insert into acts (id, character, kind, thread, payload) values (%1$L, %2$L, 'post', %3$L, '{"body": "Backed."}');
      do $d$ begin perform set_card(%4$L, 'spxwhoops', %2$L, %1$L, '{}', 0); end $d$;
    $sql$, x, s, t, setter));
    said := tests.race_as(one, format('select post(%L, %L, %L, %L)', t, a, 'Quoting it.', x), two, format('select post(%L, %L, %L, %L)', t, b, 'Quoting it too.', x));
    if said[1] is not null or said[2] is not null then raise exception 'two quotes at once on one back, round %: %', round, said; end if;
    if (select count(*) from acts where kind = 'post' and target_act_id = x) is distinct from 2::bigint then raise exception 'two quotes at once, round %: a quote did not land', round; end if;
    if (select count(*) from acts where kind = 'spring' and target_act_id = x) is distinct from 1::bigint then raise exception 'two quotes at once, round %: the back sprang % times', round, (select count(*) from acts where kind = 'spring' and target_act_id = x); end if;
    if (select count(*) from acts where kind = 'card' and payload ->> 'card' = 'spxwhoops' and payload ? 'spring' and thread = t and target_act_id in (select id from acts where kind = 'post' and target_act_id = x)) is distinct from 1::bigint then
      raise exception 'two quotes at once, round %: the Move did not land exactly once', round;
    end if;
  end loop;
end $$;

-- A back that appears while a quote waits for the character and board rows is not sprung by that quote. lock_for_quote sees one live back on the quoted post and waits for the poster's
-- character row (step 2b); meanwhile that back springs and another is set on the post; the quote then finds the new back at step 3 with no 2b locks taken for it, so it does not hold it: it stays set.
do $$
declare
  setter uuid := gen_random_uuid(); quoter uuid := gen_random_uuid();
  s uuid := gen_random_uuid(); q uuid := gen_random_uuid(); q2 uuid := gen_random_uuid();
  t uuid := gen_random_uuid(); x uuid := gen_random_uuid(); waiting uuid := gen_random_uuid(); springing uuid := gen_random_uuid();
  held text; tries integer := 0;
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'sp-win-setter@test.invalid'), (%2$L, 'sp-win-quoter@test.invalid');
    insert into accounts (id) values (%1$L), (%2$L);
    insert into characters (id, owner, name, created_at, debuted_at) values (%3$L, %1$L, 'Sp Win Setter', now(), now()), (%4$L, %2$L, 'Sp Win Quoter', now(), now()), (%5$L, %2$L, 'Sp Win Quoter Two', now(), now());
    insert into class_history (character, class_key, started_at) values (%3$L, 'alpha', now()), (%4$L, 'alpha', now()), (%5$L, 'alpha', now());
    insert into threads (id, board, title) select %6$L, b.id, 'Window' from boards b where b.slug = 'general';
    insert into card_ledger (account, card, kind, price) select %1$L, 'spxwhoops', 'bought', 0 from generate_series(1, 3);
    insert into acts (id, character, kind, thread, payload) values (%7$L, %3$L, 'post', %6$L, '{"body": "Backed twice, in turn."}'), (%8$L, %4$L, 'post', %6$L, '{"body": "The quote that waits."}'), (%9$L, %5$L, 'post', %6$L, '{"body": "The quote that springs the first."}');
    do $d$ begin perform set_card(%1$L, 'spxwhoops', %3$L, %7$L, '{}', 0); end $d$;
  $sql$, setter, quoter, s, q, q2, t, x, waiting, springing));
  perform extensions.dblink_connect('win_h', current_setting('kayfabb.scratch_url'));
  perform extensions.dblink_connect('win_q', current_setting('kayfabb.scratch_url'));
  begin
    perform extensions.dblink_exec('win_h', 'begin');
    perform extensions.dblink_exec('win_h', format('do $h$ begin perform 1 from characters where id = %L for no key update; end $h$', q));
    perform extensions.dblink_send_query('win_q', format('select lock_for_quote(%L, %L, %L)::text', q, t, x));
    loop
      exit when exists (select 1 from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database() and pid <> pg_backend_pid());
      tries := tries + 1;
      if tries > 400 then raise exception 'lock_for_quote never waited for the character row'; end if;
      perform pg_sleep(0.025);
    end loop;
    -- While it waits: the first back springs (another character's quote), and a second back is set on the same post.
    perform tests.commit(format($sql$
      do $d$ begin
        perform spring_traps('quote', %1$L, %2$L);
        perform set_card(%3$L, 'spxwhoops', %4$L, %1$L, '{}', 0);
      end $d$;
    $sql$, x, springing, setter, s));
    perform extensions.dblink_exec('win_h', 'rollback');
    select r into held from extensions.dblink_get_result('win_q') as v(r text);
    perform * from extensions.dblink_get_result('win_q') as v(r text);
  exception when others then
    perform extensions.dblink_disconnect('win_h');
    perform extensions.dblink_disconnect('win_q');
    raise;
  end;
  perform extensions.dblink_disconnect('win_h');
  perform extensions.dblink_disconnect('win_q');
  if (select count(*) from face_down f where f.post = x) is distinct from 2::bigint then raise exception 'the second back was not set while the quote waited'; end if;
  if held is distinct from '{}' then raise exception 'a quote held a back it had not seen when it took its rows: %', held; end if;
end $$;

-- A quote that lands a Move on its own character, and a cast of the same card on that character at once: the character carries one, the quote is never refused, and nothing deadlocks.
-- The quote takes the character's row (step 2b) as play_card does, then its count row; the card's stack is read under it.
do $$
declare
  setter uuid := gen_random_uuid(); quoter uuid := gen_random_uuid(); caster uuid := gen_random_uuid();
  s uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  t uuid := gen_random_uuid();
  q uuid; qpost uuid; x uuid; qquote uuid;
  said text[];
  round integer;
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'sp-char-setter@test.invalid'), (%3$L, 'sp-char-caster@test.invalid');
    insert into accounts (id) values (%1$L), (%3$L);
    insert into characters (id, owner, name, created_at, debuted_at) values (%4$L, %1$L, 'Sp Char Setter', now(), now()), (%5$L, %3$L, 'Sp Char Caster', now(), now());
    insert into class_history (character, class_key, started_at) values (%4$L, 'alpha', now()), (%5$L, 'alpha', now());
    insert into threads (id, board, title) select %6$L, b.id, 'Character race' from boards b where b.slug = 'general';
    insert into card_ledger (account, card, kind, price) select %1$L, 'spxbomb', 'bought', 0 from generate_series(1, 12);
    insert into card_ledger (account, card, kind, price) select %3$L, 'spxbomb', 'bought', 0 from generate_series(1, 12);
  $sql$, setter, quoter, caster, s, c, t));
  for round in 1 .. 10 loop
    q := gen_random_uuid(); qpost := gen_random_uuid(); x := gen_random_uuid(); quoter := gen_random_uuid();
    perform tests.commit(format($sql$
      insert into auth.users (id, email) values (%5$L, 'sp-char-quoter-' || %6$s || '@test.invalid');
      insert into accounts (id) values (%5$L);
      insert into characters (id, owner, name, created_at, debuted_at) values (%1$L, %5$L, 'Sp Char Quoter ' || %6$s, now(), now());
      insert into class_history (character, class_key, started_at) values (%1$L, 'alpha', now());
      insert into acts (id, character, kind, thread, payload) values (%2$L, %1$L, 'post', %4$L, '{"body": "Soon to be bombed."}'), (%3$L, %7$L, 'post', %4$L, '{"body": "Backed."}');
      do $d$ begin perform set_card(%8$L, 'spxbomb', %7$L, %3$L, '{}', 0); end $d$;
    $sql$, q, qpost, x, t, quoter, round, s, setter));
    said := tests.race_as(quoter, format('select post(%L, %L, %L, %L)', t, q, 'Quoting it.', x),
                          null, format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', caster, 'spxbomb', c, q, '{}', '', 'character', qpost));
    if said[1] is not null then raise exception 'a quote that lands a Move was refused, round %: %', round, said[1]; end if;
    if said[2] is not null and said[2] not like '%already carries that card%' then raise exception 'a cast on a character a Move lands on, round %: %', round, said[2]; end if;
    if (select count(*) from acts where kind = 'card' and payload ->> 'card' = 'spxbomb' and payload ->> 'reach' = 'character' and payload ->> 'character' = q::text) is distinct from 1::bigint then
      raise exception 'a quote and a cast at once on one character, round %: the character carries % of a card that takes one', round,
        (select count(*) from acts where kind = 'card' and payload ->> 'card' = 'spxbomb' and payload ->> 'reach' = 'character' and payload ->> 'character' = q::text);
    end if;
    -- Whichever won, the other lost cleanly: a refused cast means the Move landed; a landed cast means the back is still set.
    if (said[2] is not null) is distinct from exists (select 1 from acts where kind = 'spring' and target_act_id = x) then
      raise exception 'a quote and a cast at once, round %: cast said %, back sprang %', round, said[2], exists (select 1 from acts where kind = 'spring' and target_act_id = x);
    end if;
  end loop;
end $$;

-- A pool post that quotes a Trap Card's post, and a player's cast of the card it names on the same post, at once: both land, nothing deadlocks. The pool post takes the back, the thread and the
-- count rows (the persona's and the setter's) before it writes; the cast takes the post, the back, then its own count row. (0075's race of a quote and a cast, run with a pool post.)
-- Before the block below that writes as the same persona in this file's own transaction, which would hold the persona's count row.
do $$
declare
  setter uuid := gen_random_uuid(); caster uuid := gen_random_uuid();
  s uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  t uuid := gen_random_uuid();
  x uuid;
  said text[];
  round integer;
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'sp-poolrace-setter@test.invalid'), (%2$L, 'sp-poolrace-caster@test.invalid');
    insert into accounts (id) values (%1$L), (%2$L);
    insert into characters (id, owner, name, created_at, debuted_at) values (%3$L, %1$L, 'Sp Poolrace Setter', now(), now()), (%4$L, %2$L, 'Sp Poolrace Caster', now(), now());
    insert into class_history (character, class_key, started_at) values (%3$L, 'alpha', now()), (%4$L, 'alpha', now());
    insert into threads (id, board, title) select %5$L, b.id, 'Pool race' from boards b where b.slug = 'general';
    insert into card_ledger (account, card, kind, price) select %1$L, 'spxtrap', 'bought', 0 from generate_series(1, 8);
    insert into card_ledger (account, card, kind, price) select %2$L, 'spxrare', 'bought', 0 from generate_series(1, 8);
  $sql$, setter, caster, s, c, t));
  for round in 1 .. 6 loop
    x := gen_random_uuid();
    perform tests.commit(format($sql$
      insert into acts (id, character, kind, thread, payload) values (%1$L, %2$L, 'post', %3$L, '{"body": "A Trap Card under this."}');
      do $d$ begin perform set_card(%4$L, 'spxtrap', %2$L, %1$L, '{"card": "spxrare"}', 0, 'spxrare'); end $d$;
    $sql$, x, s, t, setter));
    said := tests.race_service(format('select write_staff_act(%L, ''post'', %L, %L, ''{"body": "A pool post, quoting."}'')', 'spx-race-mod', t, x),
                               format('select play_card(%L, %L, %L, %L, %L, 0, %L)', caster, 'spxrare', c, x, '{}', ''));
    if said[1] is not null or said[2] is not null then raise exception 'a pool post and a cast on one trapped post, round %: %', round, said; end if;
    if (select count(*) from acts where kind = 'post' and target_act_id = x) is distinct from 1::bigint or (select count(*) from acts where kind = 'card' and target_act_id = x and payload ? 'caught') is distinct from 1::bigint then
      raise exception 'a pool post and a cast on one trapped post, round %: one did not land', round;
    end if;
  end loop;
end $$;

-- A pool post that quotes a trapped post takes the back's row before it writes (steps 3 to 5 ahead of its insert): while another session holds the back, it waits and has written no post;
-- once the back is free it lands, and the Move lands on the persona's post (#233).
do $$
declare
  setter uuid := gen_random_uuid(); s uuid := gen_random_uuid();
  t uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  why text;
  made jsonb;
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'sp-pool-setter@test.invalid');
    insert into accounts (id) values (%1$L);
    insert into characters (id, owner, name, created_at, debuted_at) values (%2$L, %1$L, 'Sp Pool Setter', now(), now());
    insert into class_history (character, class_key, started_at) values (%2$L, 'alpha', now());
    insert into threads (id, board, title) select %3$L, b.id, 'Pool post' from boards b where b.slug = 'general';
    insert into card_ledger (account, card, kind, price) values (%1$L, 'spxwhoops', 'bought', 0);
    insert into acts (id, character, kind, thread, payload) values (%4$L, %2$L, 'post', %3$L, '{"body": "Backed for a Mod Bot."}');
    do $d$ begin perform set_card(%1$L, 'spxwhoops', %2$L, %4$L, '{}', 0); end $d$;
  $sql$, setter, s, t, x));
  perform extensions.dblink_connect('sp_holder', current_setting('kayfabb.scratch_url'));
  begin
    perform extensions.dblink_exec('sp_holder', 'begin');
    perform extensions.dblink_exec('sp_holder', format('do $h$ begin perform 1 from face_down where post = %L for update; end $h$', x));
    perform set_config('lock_timeout', '300ms', true);
    begin
      perform write_staff_act('spx-race-mod', 'post', t, x, '{"body": "A pool post, quoting."}');
      why := null;
    exception when others then
      why := sqlerrm;
    end;
    perform set_config('lock_timeout', '30s', true);
    perform extensions.dblink_exec('sp_holder', 'rollback');
  exception when others then
    perform extensions.dblink_disconnect('sp_holder');
    raise;
  end;
  perform extensions.dblink_disconnect('sp_holder');
  if why is null or why not like '%lock timeout%' then raise exception 'a pool post did not wait for the back it quotes: %', why; end if;
  if exists (select 1 from acts where kind = 'post' and target_act_id = x) then raise exception 'a pool post wrote before it held the back'; end if;
  made := write_staff_act('spx-race-mod', 'post', t, x, '{"body": "A pool post, quoting."}');
  if made -> 'sprung' is null then raise exception 'a pool post quoting a trapped post did not spring it: %', made; end if;
  if (select count(*) from acts where kind = 'spring' and target_act_id = x) is distinct from 1::bigint then raise exception 'the back did not spring once'; end if;
  if not exists (select 1 from acts k where k.kind = 'card' and k.character = s and k.target_act_id = (made ->> 'id')::uuid and k.payload ->> 'card' = 'spxwhoops' and k.payload ->> 'spring' = (made -> 'sprung' ->> 'id')) then
    raise exception 'the Move did not land on the Mod Bot''s post: %', made;
  end if;
end $$;

-- What the racers' writes queued for these players is not left for the files after this one (an alert is a row beside the Act).
do $$
begin
  perform tests.commit($sql$
    delete from alerts where account in (select id from accounts where id in (select id from auth.users where email like 'sp-%@test.invalid'));
    delete from broadcasts_due where topic in (select 'account:' || id from auth.users where email like 'sp-%@test.invalid');
  $sql$);
end $$;

-- ---- A back names its catch or its phrase, never both; old rows hold neither ----
do $$
declare
  ann uuid := tests.account('fdm-ann');
  bob uuid := tests.account('fdm-bob');
  a uuid := tests.character(ann, 'Fdm Ann');
  t uuid := tests.thread('Face-down Moves');
  p1 uuid; p2 uuid; p3 uuid; p4 uuid;
  s1 uuid; s2 uuid; s3 uuid; s4 uuid;
  why text;
begin
  insert into card_kinds (key, name, alignment, rarity, play, trap) values
    ('fdmtrap', 'Fdm Trap', 'salty', 'uncommon', 'set', '{"trigger": {"on": "cast"}}'),
    ('fdmpass', 'Fdm Pass', 'sweet', 'uncommon', 'set', '{"trigger": {"on": "visit"}}'),
    ('fdmmove', 'Fdm Move', 'salty', 'common', 'cast', null),
    ('fdmcatch', 'Fdm Catch', 'salty', 'rare', 'cast', null);
  p1 := tests.post(a, t); p2 := tests.post(a, t); p3 := tests.post(a, t); p4 := tests.post(a, t);
  s1 := tests.act(a, 'set', t, '{}', p1); s2 := tests.act(a, 'set', t, '{}', p2); s3 := tests.act(a, 'set', t, '{}', p3); s4 := tests.act(a, 'set', t, '{}', p4);

  -- A Trap Card names its catch.
  insert into face_down (play, account, card, config, post, thread, round, ends_at, catches)
  values (s1, ann, 'fdmtrap', '{"card": "fdmcatch"}', p1, t, 1, now() + interval '7 days', 'fdmcatch');
  -- A Move holds a phrase.
  insert into face_down (play, account, card, config, post, thread, round, ends_at, phrase)
  values (s2, ann, 'fdmmove', '{"phrase": "hello"}', p2, t, 1, now() + interval '7 days', 'hello');
  -- A row holds neither, as every back set before this did.
  insert into face_down (play, account, card, post, thread, round, ends_at) values (s3, ann, 'fdmpass', p3, t, 1, now() + interval '7 days');

  -- Both is refused, by the table itself.
  why := pg_temp.refusal(format('insert into face_down (play, account, card, post, thread, round, ends_at, catches, phrase) values (%L, %L, %L, %L, %L, 1, now(), %L, %L)',
    s4, ann, 'fdmtrap', p4, t, 'fdmcatch', 'hello'));
  if why is null or why not like '%face_down_one_of%' then raise exception 'a back with a catch and a phrase was stored: %', why; end if;
  -- A catch is a card kind of the instance.
  why := pg_temp.refusal(format('insert into face_down (play, account, card, post, thread, round, ends_at, catches) values (%L, %L, %L, %L, %L, 1, now(), %L)',
    s4, ann, 'fdmtrap', p4, t, 'nosuchcard'));
  if why is null or why not like '%foreign key%' then raise exception 'a back named a card that is not one: %', why; end if;
  -- A phrase is not empty.
  why := pg_temp.refusal(format('insert into face_down (play, account, card, post, thread, round, ends_at, phrase) values (%L, %L, %L, %L, %L, 1, now(), %L)',
    s4, ann, 'fdmmove', p4, t, ''));
  if why is null or why not like '%face_down_phrase%' then raise exception 'an empty phrase was stored: %', why; end if;
  -- Nothing updates a row, so a catch is never added to a back after it is set.
  why := pg_temp.refusal(format('update face_down set catches = %L where play = %L', 'fdmcatch', s3));
  if why is null then raise exception 'a face_down row was updated'; end if;

  -- The setter alone reads the catch and the phrase.
  perform tests.become(ann);
  if (select catches from my_face_down where play = s1) is distinct from 'fdmcatch' then raise exception 'the setter reads the named catch'; end if;
  if (select phrase from my_face_down where play = s2) is distinct from 'hello' then raise exception 'the setter reads the phrase'; end if;
  if exists (select 1 from my_face_down where play = s3 and (catches is not null or phrase is not null)) then raise exception 'an old back holds neither'; end if;
  if (select catches from face_down where play = s1) is distinct from 'fdmcatch' then raise exception 'the setter reads their own face_down row'; end if;
  perform tests.unbecome();
  perform tests.become(bob);
  if exists (select 1 from my_face_down) or exists (select 1 from face_down) then raise exception 'another account reads a back, its catch or its phrase'; end if;
  perform tests.unbecome();
  perform tests.become_anon();
  why := pg_temp.refusal('select catches, phrase from my_face_down');
  if why is null or why not like 'permission denied%' then raise exception 'anon reads my_face_down: %', why; end if;
  why := pg_temp.refusal('select catches from face_down');
  if why is null or why not like 'permission denied%' then raise exception 'anon reads face_down: %', why; end if;
  perform tests.unbecome();
end $$;

-- ---- card_kinds' trap shape: a Gimmick springs on a cast or a visit ----
do $$
declare why text;
begin
  why := pg_temp.refusal($q$insert into card_kinds (key, name, alignment, rarity, play, trap) values ('fdmbad1', 'Bad', 'salty', 'common', 'set', '{"trigger": {"on": "reply"}}')$q$);
  if why is null or why not like '%card_kinds_trap_shape%' then raise exception 'a reply trigger was stored: %', why; end if;
  why := pg_temp.refusal($q$insert into card_kinds (key, name, alignment, rarity, play, trap) values ('fdmbad2', 'Bad', 'salty', 'common', 'set', '{"trigger": {"on": "quote"}}')$q$);
  if why is null or why not like '%card_kinds_trap_shape%' then raise exception 'a quote trigger was stored (a Move''s is the engine''s): %', why; end if;
  why := pg_temp.refusal($q$insert into card_kinds (key, name, alignment, rarity, play, trap) values ('fdmbad3', 'Bad', 'salty', 'common', 'set', '{"trigger": {"on": "reaction", "quadrant": "calmPositive"}}')$q$);
  if why is null or why not like '%card_kinds_trap_shape%' then raise exception 'a reaction trigger was stored: %', why; end if;
  why := pg_temp.refusal($q$insert into card_kinds (key, name, alignment, rarity, play, trap) values ('fdmbad4', 'Bad', 'salty', 'common', 'set', '{}')$q$);
  if why is null or why not like '%card_kinds_trap_shape%' then raise exception 'a trap with no trigger was stored: %', why; end if;
  why := pg_temp.refusal($q$insert into card_kinds (key, name, alignment, rarity, play, trap) values ('fdmbad5', 'Bad', 'salty', 'common', 'cast', '{"trigger": {"on": "cast"}}')$q$);
  if why is null then raise exception 'a Move with a trap was stored'; end if;

  -- The seed's check says the same, naming the card, in the engine's words (engine/rules/instance.ts).
  if card_kinds_problem('[{"key": "ok", "rarity": "common", "play": "set", "trap": {"trigger": {"on": "cast"}}},
                          {"key": "ok2", "rarity": "common", "play": "set", "trap": {"trigger": {"on": "visit"}}},
                          {"key": "ok3", "rarity": "common", "play": "cast"}]') is not null then
    raise exception 'a valid Gimmick was refused: %', card_kinds_problem('[{"key": "ok", "rarity": "common", "play": "set", "trap": {"trigger": {"on": "cast"}}}]');
  end if;
  why := card_kinds_problem('[{"key": "r", "rarity": "common", "play": "set", "trap": {"trigger": {"on": "reply"}}}]');
  if why is distinct from 'card "r" springs on "reply"; a Gimmick springs on cast or visit' then raise exception 'a reply trigger: %', why; end if;
  why := card_kinds_problem('[{"key": "n", "rarity": "common", "play": "set", "trap": {}}]');
  if why is distinct from 'card "n" springs on nothing; a Gimmick springs on cast or visit' then raise exception 'a trap with no trigger: %', why; end if;
  why := card_kinds_problem('[{"key": "e", "rarity": "common", "play": "set", "trap": {"trigger": {"on": 5}}}]');
  if why is distinct from 'card "e" springs on 5; a Gimmick springs on cast or visit' then raise exception 'a numeric trigger: %', why; end if;
  why := card_kinds_problem('[{"key": "t", "rarity": "common", "play": "set", "trap": {"trigger": {}}}]');
  if why is distinct from 'card "t" springs on nothing; a Gimmick springs on cast or visit' then raise exception 'a trigger with no on: %', why; end if;
  why := card_kinds_problem('[{"key": "m", "rarity": "common", "play": "cast", "trap": {"trigger": {"on": "cast"}}}]');
  if why is distinct from 'card "m" has a trap, and only a Gimmick does' then raise exception 'a Move with a trap: %', why; end if;
end $$;

-- ---- card_held: bought and caught, less played; one count for every reader of a hand ----
do $$
declare
  ann uuid := tests.account('fdm-held-ann');
  bob uuid := tests.account('fdm-held-bob');
  a uuid := tests.character(ann, 'Held Ann');
  t uuid := tests.thread('Held');
  p uuid := tests.post(a, t);
  the_set uuid := tests.act(a, 'set', t, '{}', p);
  spring uuid := tests.act(a, 'spring', t, jsonb_build_object('card', 'sweetie', 'trigger', 'cast', 'outcome', jsonb_build_object('do', 'nullify'), 'set', the_set), p);
  why text;
begin
  if card_held(ann, 'sweetie') is distinct from 0 then raise exception 'an empty hand holds %', card_held(ann, 'sweetie'); end if;
  insert into card_ledger (account, card, kind, price) select ann, 'sweetie', 'bought', 0 from generate_series(1, 2);
  -- A purchase from the card's slot (0139) reports the hand through the same count.
  insert into wallets (account, balance) values (ann, 500);
  if (buy_card(ann, (select s.id from machine_slots s where s.card = 'splat'), 100) ->> 'held')::integer is distinct from 1 then raise exception 'buy_card reports the hand'; end if;
  if card_held(ann, 'sweetie') is distinct from 2 then raise exception 'two bought hold %', card_held(ann, 'sweetie'); end if;
  insert into card_ledger (account, card, kind, act, price) values (ann, 'sweetie', 'caught', spring, 0);
  if card_held(ann, 'sweetie') is distinct from 3 then raise exception 'a caught card is a card held: %', card_held(ann, 'sweetie'); end if;
  insert into card_ledger (account, card, kind, act, price) values (ann, 'sweetie', 'played', tests.act(a, 'card', t, '{"card": "sweetie"}', p), 0);
  if card_held(ann, 'sweetie') is distinct from 2 then raise exception 'a played card is spent: %', card_held(ann, 'sweetie'); end if;
  insert into card_ledger (account, card, kind, price) values (bob, 'sweetie', 'bought', 0), (bob, 'sweetie', 'bought', 0), (bob, 'sweetie', 'bought', 0);
  if card_held(ann, 'blot') is distinct from 0 or card_held(bob, 'sweetie') is distinct from 3 then raise exception 'a hand is one account''s, one card''s'; end if;

  -- A caught row is the spring's, and costs nothing; a bought one is neither.
  why := pg_temp.refusal(format('insert into card_ledger (account, card, kind, price) values (%L, %L, %L, 0)', ann, 'sweetie', 'caught'));
  if why is null then raise exception 'a caught card with no spring was stored'; end if;
  why := pg_temp.refusal(format('insert into card_ledger (account, card, kind, act, price) values (%L, %L, %L, %L, 0)', ann, 'sweetie', 'bought', spring));
  if why is null then raise exception 'a bought card with an Act was stored'; end if;

  -- The player's own screens count it the same way, and the log shows the row.
  perform tests.become(ann);
  if (select held from my_cards where card = 'sweetie') is distinct from 2 then raise exception 'my_cards: %', (select jsonb_agg(m) from my_cards m); end if;
  if (select count(*) from my_card_ledger where kind = 'caught' and card = 'sweetie' and act = spring) is distinct from 1::bigint then raise exception 'my_card_ledger shows the caught row'; end if;
  if (select springs from my_card_ledger where kind = 'caught') is not null then raise exception 'a caught row is not a set'; end if;
  -- A player calling the count reads their own hand, and another account's as 0 (row security keeps them to their own rows), never its real count of 3.
  if card_held(ann, 'sweetie') is distinct from 2 then raise exception 'a player cannot count their own hand'; end if;
  if card_held(bob, 'sweetie') is distinct from 0 then raise exception 'a player counted another account''s hand, which holds 3'; end if;
  perform tests.unbecome();
  perform tests.become(ann);
  perform tests.unbecome();
  perform tests.become_anon();
  why := pg_temp.refusal(format('select card_held(%L, %L)', ann, 'sweetie'));
  if why is null or why not like 'permission denied%' then raise exception 'anon called card_held: %', why; end if;
  perform tests.unbecome();
  perform tests.become(bob);
  if (select held from my_cards where card = 'sweetie') is distinct from 3 or exists (select 1 from my_card_ledger where kind <> 'bought') then raise exception 'another account read a hand'; end if;
  perform tests.unbecome();
end $$;

-- ---- A hand of only a caught card can be played, and the spender counts the true hand whoever is signed in ----
do $$
declare
  carol uuid := tests.account('fdm-play-carol');
  dave uuid := tests.account('fdm-play-dave');
  c uuid := tests.character(carol, 'Play Carol');
  t uuid := tests.thread('Played');
  p uuid := tests.post(c, t);
  the_set uuid := tests.act(c, 'set', t, '{}', p);
  spring uuid := tests.act(c, 'spring', t, jsonb_build_object('card', 'sweetie', 'trigger', 'cast', 'outcome', jsonb_build_object('do', 'nullify'), 'set', the_set), p);
  q uuid := tests.post(c, t);
  played jsonb;
begin
  insert into card_ledger (account, card, kind, act, price) values (carol, 'sweetie', 'caught', spring, 0);
  insert into wallets (account, balance) values (carol, 100);
  -- The service role acts for Carol while the request's claims name Dave: the count is Carol's true hand, not what Dave could see.
  perform tests.become_service();
  perform set_config('request.jwt.claims', jsonb_build_object('sub', dave, 'role', 'service_role')::text, true);
  played := play_card(carol, 'sweetie', c, q, '{}', 0);
  if played is null then raise exception 'a caught card was not played'; end if;
  perform tests.unbecome();
  if card_held(carol, 'sweetie') is distinct from 0 then raise exception 'the caught card was spent once: %', card_held(carol, 'sweetie'); end if;
  if (select count(*) from card_ledger where account = carol and kind = 'played') is distinct from 1::bigint then raise exception 'the play was not recorded'; end if;
end $$;

-- ---- Setting a Move (Task 5): a Move or a Gimmick sets, a Use does not; a Trap Card stores its named catch, a Move its phrase ----
do $$
declare
  ann uuid := tests.account('fdm-set-ann');
  a uuid := tests.character(ann, 'Set Ann');
  t uuid := tests.thread('Setting');
  p1 uuid := tests.post(a, t); p2 uuid := tests.post(a, t); p3 uuid := tests.post(a, t); p4 uuid := tests.post(a, t); p5 uuid := tests.post(a, t); p6 uuid := tests.post(a, t); p7 uuid := tests.post(a, t); p8 uuid := tests.post(a, t);
  other uuid := tests.character(tests.account('fdm-set-bob'), 'Set Bob');
  q uuid := tests.post(other, t);
  placed jsonb;
  why text;
begin
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts) values
    ('fdsmove', 'Set Move', 'salty', 'common', 'cast', null, '{post}', null),
    ('fdsthread', 'Set Thread Move', 'salty', 'common', 'cast', null, '{thread}', '7 days'),
    ('fdsgimmick', 'Set Gimmick', 'pepperoni', 'common', 'set', null, '{post}', null),
    ('fdsuse', 'Set Use', 'sweet', 'common', 'use', null, '{post}', null),
    ('fdstrap', 'Set Trap', 'salty', 'uncommon', 'set', '{"trigger": {"on": "cast"}}', '{post}', null),
    ('fdsvisit', 'Set Visit', 'sweet', 'uncommon', 'set', '{"trigger": {"on": "visit"}}', '{post}', null);
  insert into card_ledger (account, card, kind, price) select ann, k, 'bought', 0 from unnest(array['fdsmove', 'fdsgimmick', 'fdsuse', 'fdstrap', 'fdsvisit']) k, generate_series(1, 4);

  -- A Move is set face down, as a Gimmick is; the back holds neither a catch nor a phrase unless it was given one.
  placed := set_card(ann, 'fdsmove', a, p1, '{}', 0);
  if placed ->> 'kind' is distinct from 'set' then raise exception 'a Move was not set: %', placed; end if;
  if exists (select 1 from face_down f where f.play = (placed ->> 'id')::uuid and (f.catches is not null or f.phrase is not null)) then raise exception 'a Move set with no phrase holds one'; end if;
  placed := set_card(ann, 'fdsgimmick', a, p2, '{}', 0);
  if placed ->> 'kind' is distinct from 'set' then raise exception 'a Gimmick was not set: %', placed; end if;
  if card_held(ann, 'fdsmove') is distinct from 3 or card_held(ann, 'fdsgimmick') is distinct from 3 then raise exception 'a set spends one card'; end if;

  -- A Move stores the phrase it waits for.
  placed := set_card(ann, 'fdsmove', a, p3, '{"phrase": "Heel"}', 0, null, 'heel');
  if (select phrase from face_down where play = (placed ->> 'id')::uuid) is distinct from 'heel' then raise exception 'the phrase was not stored'; end if;
  -- A Trap Card stores the card it names.
  placed := set_card(ann, 'fdstrap', a, p4, '{"card": "fdsmove"}', 0, 'fdsmove', null);
  if (select catches from face_down where play = (placed ->> 'id')::uuid) is distinct from 'fdsmove' then raise exception 'the named catch was not stored'; end if;
  -- A Gimmick that springs on a visit holds neither.
  placed := set_card(ann, 'fdsvisit', a, p5, '{}', 0);

  -- A Use is refused, in the engine's words, and nothing is spent.
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0)', ann, 'fdsuse', a, p6, '{}'));
  if why is distinct from 'Set Use is used on your own post' then raise exception 'a Use was set: %', why; end if;
  -- A catch is a cast Gimmick's alone, and names a card cast on a post.
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0, %L)', ann, 'fdsgimmick', a, p6, '{}', 'fdsmove'));
  if why is distinct from 'Set Gimmick catches no card' then raise exception 'a Bluff named a catch: %', why; end if;
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0, %L)', ann, 'fdsmove', a, p6, '{}', 'fdsmove'));
  if why is distinct from 'Set Move catches no card' then raise exception 'a Move named a catch: %', why; end if;
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0, %L)', ann, 'fdstrap', a, p6, '{}', 'fdsuse'));
  if why is distinct from 'Set Trap names a card that is cast on a post' then raise exception 'a Trap Card named a Use: %', why; end if;
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0, %L)', ann, 'fdstrap', a, p6, '{}', 'fdsgimmick'));
  if why is distinct from 'Set Trap names a card that is cast on a post' then raise exception 'a Trap Card named a Gimmick: %', why; end if;
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0, %L)', ann, 'fdstrap', a, p6, '{}', 'fdsthread'));
  if why is distinct from 'Set Trap names a card that is cast on a post' then raise exception 'a Trap Card named a card cast on a thread: %', why; end if;
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0, %L)', ann, 'fdstrap', a, p6, '{}', 'nosuchcard'));
  if why is distinct from 'Set Trap names a card that is cast on a post' then raise exception 'a Trap Card named no card: %', why; end if;
  -- A phrase is a Move's alone, and is not blank.
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0, null, %L)', ann, 'fdsgimmick', a, p6, '{}', 'heel'));
  if why is distinct from 'Set Gimmick waits for no phrase' then raise exception 'a Gimmick held a phrase: %', why; end if;
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0, null, %L)', ann, 'fdsmove', a, p6, '{}', '  '));
  if why is distinct from 'Set Move needs a phrase to wait for' then raise exception 'a blank phrase was stored: %', why; end if;
  if card_held(ann, 'fdsuse') is distinct from 4 or exists (select 1 from face_down where post = p6) then raise exception 'a refused set spent a card or left a back'; end if;
  -- It is still the setter's own post alone.
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0)', ann, 'fdsmove', a, q, '{}'));
  if why is null then raise exception 'a Move was set on another character''s post'; end if;
end $$;

-- ---- A persona's Set: Gimmicks only, a Trap Card names its catch ----
do $$
begin
  perform seed_instance(jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24, 'rosterRecentExcluded', 0, 'inheritanceGraceDays', 3,
      'seasonLength', jsonb_build_object('unit', 'day', 'count', 1),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('Landed: {move}.'),
        'bossFarewell', jsonb_build_array('Farewell from {boss}.'), 'bossArrival', jsonb_build_array('Hello from {boss}.'))),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'fdm-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'fdm-boss', 'name', 'Fdm Boss', 'title', 'Boss', 'signature', 'a'),
        jsonb_build_object('key', 'fdm-mod', 'name', 'Fdm Mod', 'title', 'Mod', 'signature', 'b')),
      'firstStaff', jsonb_build_array('fdm-mod'),
      'moves', jsonb_build_array(jsonb_build_object('key', 'nameSuccessor', 'structural', true)),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')))));
  insert into settings (key, value) values ('pool', '{"weekly": 20, "holdback": 0.2, "threadsWeekly": 1, "cardRarityMost": "uncommon", "priorityDays": 28, "notesRead": 12, "chatterThreadPosts": 8, "strengths": {"named": 5, "quoted": 5, "legacy": 5, "successorStumbles": 5, "oldFlame": 5, "homeTurf": 2, "seasonTurn": 2, "hotOnBeat": 2}, "chatterCron": "37 17 * * *"}') on conflict (key) do update set value = excluded.value;
  insert into card_kinds (key, name, alignment, rarity, play, trap) values
    ('fdpmove', 'Persona Move', 'salty', 'common', 'cast', null),
    ('fdptrap', 'Persona Trap', 'salty', 'common', 'set', '{"trigger": {"on": "cast"}}'),
    ('fdpvisit', 'Persona Visit', 'sweet', 'common', 'set', '{"trigger": {"on": "visit"}}');
end $$;
create function pg_temp.staff_post(k text, in_thread uuid, body text) returns uuid language sql as $$
  select (write_staff_act(k, 'post', in_thread, null, jsonb_build_object('body', body)) ->> 'id')::uuid
$$;
do $$
declare
  t uuid := tests.thread('Persona sets');
  p1 uuid := pg_temp.staff_post('fdm-mod', t, 'One.'); p2 uuid := pg_temp.staff_post('fdm-mod', t, 'Two.'); p3 uuid := pg_temp.staff_post('fdm-mod', t, 'Three.');
  placed jsonb;
  why text;
begin
  perform tests.become_service();
  placed := staff_set_card('fdm-mod', 'fdptrap', p1, '{"card": "fdpmove"}', 'fdpmove');
  if (select catches from face_down where play = (placed ->> 'id')::uuid) is distinct from 'fdpmove' then raise exception 'a persona''s Trap Card did not store its named catch'; end if;
  if (select account from face_down where play = (placed ->> 'id')::uuid) is not null then raise exception 'a persona''s back has an account'; end if;
  why := pg_temp.refusal(format('select staff_set_card(%L, %L, %L)', 'fdm-mod', 'fdpmove', p2));
  if why is distinct from 'Persona Move is not a Gimmick; a persona sets Gimmicks' then raise exception 'a persona set a Move: %', why; end if;
  why := pg_temp.refusal(format('select staff_set_card(%L, %L, %L)', 'fdm-mod', 'fdpvisit', p3));
  if why is distinct from 'Persona Visit waits for a Mod Bot''s visit; a persona sets none' then raise exception 'a persona set a visit Gimmick: %', why; end if;
  why := pg_temp.refusal(format('select staff_set_card(%L, %L, %L, %L, %L)', 'fdm-mod', 'fdptrap', p3, '{"card": "nosuch"}', 'nosuch'));
  if why is distinct from 'Persona Trap names a card that is cast on a post' then raise exception 'a persona''s Trap Card named no card: %', why; end if;
  perform tests.unbecome();
end $$;

-- ---------------------------------------------------------------------------------------------------- Springing (Task 6) ----
-- The cards are the committed ones above (spx...): Spx Whoops lands on a post, Spx Bomb on a character, Spx Thread on a thread, Spx Board on a board, Spx Auto waits for a phrase; Spx Trap is a Trap Card, Spx Pass a Hall Pass.

create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k
$$;
-- A player quotes through the real post(), as the account that owns the character.
create function pg_temp.quote(by_character uuid, in_thread uuid, body text, quoted uuid default null) returns jsonb language plpgsql as $$
declare made jsonb;
begin
  perform tests.become((select owner from characters where id = by_character));
  made := post(in_thread, by_character, body, quoted);
  perform tests.unbecome();
  return made;
end $$;
-- A player casts through the real play_card, as the service role acts for them.
create function pg_temp.cast(by_account uuid, card text, by_character uuid, target uuid, reach text default 'post', from_post uuid default null) returns jsonb language plpgsql as $$
declare made jsonb;
begin
  perform tests.become_service();
  made := play_card(by_account, card, by_character, target, '{}', 0, '', reach, from_post);
  perform tests.unbecome();
  return made;
end $$;
create function pg_temp.sprung_of(set_act uuid) returns uuid language sql as $$
  select s.id from acts s where s.kind = 'spring' and s.payload ->> 'set' = set_act::text
$$;

-- ---- A quote lands a set Move on the quoting post, its character, its thread and its board, by the card's first reach ----
do $$
declare
  ann uuid := tests.account('sp-ann'); bob uuid := tests.account('sp-bob');
  a1 uuid := tests.character(ann, 'Sp Ann One'); a2 uuid := tests.character(ann, 'Sp Ann Two'); a3 uuid := tests.character(ann, 'Sp Ann Three'); a4 uuid := tests.character(ann, 'Sp Ann Four');
  b uuid := tests.character(bob, 'Sp Bob');
  t uuid := tests.thread('Springing');
  p1 uuid := tests.post(a1, t, 'Whoops under this.'); p2 uuid := tests.post(a2, t, 'A bomb under this.');
  p3 uuid := tests.post(a3, t, 'A thread card under this.'); p4 uuid := tests.post(a4, t, 'A board card under this.');
  set1 uuid; set2 uuid; set3 uuid; set4 uuid;
  made jsonb; spring uuid; laid uuid;
  ann_alerts bigint;
begin
  perform pg_temp.hand(ann, 'spxwhoops', 'spxbomb', 'spxthread', 'spxboard');
  set1 := (set_card(ann, 'spxwhoops', a1, p1, '{}', 0) ->> 'id')::uuid;
  set2 := (set_card(ann, 'spxbomb', a2, p2, '{}', 0) ->> 'id')::uuid;
  set3 := (set_card(ann, 'spxthread', a3, p3, '{}', 0) ->> 'id')::uuid;
  set4 := (set_card(ann, 'spxboard', a4, p4, '{}', 0) ->> 'id')::uuid;

  -- Bob quotes the Whoops back: the card lands on his quoting post, through Ann's character, free and wordless, marked as sprung.
  made := pg_temp.quote(b, t, 'Quoting Ann.', p1);
  if made -> 'sprung' is null or made -> 'sprung' -> 'struck' is null then raise exception 'a quote did not report its spring and the card it landed: %', made; end if;
  spring := (made -> 'sprung' ->> 'id')::uuid;
  if (select s.payload from acts s where s.id = spring) is distinct from jsonb_build_object('card', 'spxwhoops', 'trigger', 'quote', 'did', 'landed', 'set', set1::text, 'by', (made ->> 'id')) then
    raise exception 'the spring says: %', (select s.payload from acts s where s.id = spring);
  end if;
  select k.id into laid from acts k where k.kind = 'card' and k.payload ->> 'spring' = spring::text;
  if laid is null then raise exception 'the quote landed no card'; end if;
  if (select (k.character, k.target_act_id, k.payload ->> 'card', k.payload ->> 'message', (k.payload ->> 'layer')::integer) from acts k where k.id = laid) is distinct from (a1, (made ->> 'id')::uuid, 'spxwhoops'::text, ''::text, 1) then
    raise exception 'the landed card is %', (select to_jsonb(k) from acts k where k.id = laid);
  end if;
  if (select k.payload ? 'caught' from acts k where k.id = laid) then raise exception 'a landed card is marked caught'; end if;
  if not exists (select 1 from alerts where account = bob and kind = 'trapStruck' and act = laid) then raise exception 'the struck quoter was not told'; end if;
  if not exists (select 1 from alerts where account = ann and kind = 'trapSprang' and act = spring) then raise exception 'the setter was not told'; end if;
  -- Nothing was paid or charged for the landing.
  if exists (select 1 from wallet_events where ref in (spring, laid)) or exists (select 1 from card_ledger where act in (spring, laid)) then raise exception 'a spring moved money or a hand'; end if;
  -- It springs once: another quote of the same post lands its post and no second card.
  made := pg_temp.quote(b, t, 'Quoting Ann again.', p1);
  if made -> 'sprung' is not null or (select count(*) from acts where kind = 'spring' and target_act_id = p1) is distinct from 1::bigint then raise exception 'a sprung back sprang again: %', made; end if;

  -- The Bomb back lands on the quoting post's character, hung on the quoting post, and holds its time.
  made := pg_temp.quote(b, t, 'Quoting the bomb.', p2);
  spring := (made -> 'sprung' ->> 'id')::uuid;
  select k.id into laid from acts k where k.kind = 'card' and k.payload ->> 'spring' = spring::text;
  if (select (k.character, k.target_act_id, k.payload ->> 'reach', k.payload ->> 'character') from acts k where k.id = laid) is distinct from (a2, (made ->> 'id')::uuid, 'character'::text, b::text) then
    raise exception 'the Bomb landed %', (select to_jsonb(k) from acts k where k.id = laid);
  end if;
  if not exists (select 1 from play_reach r where r.play = laid and r.character = b and r.ends_at > now() + interval '6 days') then raise exception 'the Bomb has no reach row'; end if;
  -- Bob's character now carries a Bomb: another Bomb back springs nothing there and stays set (the stack is one).
  declare p5 uuid := tests.post(a1, t, 'Another bomb under this.'); set5 uuid; begin
    perform pg_temp.hand(ann, 'spxbomb');
    set5 := (set_card(ann, 'spxbomb', a1, p5, '{}', 0) ->> 'id')::uuid;
    made := pg_temp.quote(b, t, 'Quoting a second bomb.', p5);
    if made -> 'sprung' is not null or pg_temp.sprung_of(set5) is not null then raise exception 'a Bomb landed on a character that carries one: %', made; end if;
    if not exists (select 1 from face_down f where f.play = set5 and f.ends_at > now()) then raise exception 'the back was lost'; end if;
    -- A different character quoting it takes the Bomb.
    made := pg_temp.quote(tests.character(bob, 'Sp Bob Two'), t, 'Quoting from another mask.', p5);
    if made -> 'sprung' is null then raise exception 'a Bomb did not land on a free character: %', made; end if;
  end;

  -- The Thread back lands on the thread's first post; one at a time while it lasts.
  made := pg_temp.quote(b, t, 'Quoting the thread card.', p3);
  spring := (made -> 'sprung' ->> 'id')::uuid;
  select k.id into laid from acts k where k.kind = 'card' and k.payload ->> 'spring' = spring::text;
  if (select (k.thread, k.payload ->> 'reach', k.payload ->> 'thread') from acts k where k.id = laid) is distinct from (t, 'thread'::text, t::text) or not exists (select 1 from play_reach r where r.play = laid and r.thread = t) then
    raise exception 'the thread card landed %', (select to_jsonb(k) from acts k where k.id = laid);
  end if;

  -- The Board back lands on the quoting thread's board, written in the announcements thread, and a board holds one live card.
  made := pg_temp.quote(b, t, 'Quoting the board card.', p4);
  spring := (made -> 'sprung' ->> 'id')::uuid;
  select k.id into laid from acts k where k.kind = 'card' and k.payload ->> 'spring' = spring::text;
  if (select (k.payload ->> 'reach', k.thread) from acts k where k.id = laid) is distinct from ('board'::text, (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements'))
     or not exists (select 1 from play_reach r where r.play = laid and r.board = (select board from threads where id = t)) then
    raise exception 'the board card landed %', (select to_jsonb(k) from acts k where k.id = laid);
  end if;
  declare p6 uuid := tests.post(a4, t, 'Another board card.'); set6 uuid; begin
    perform pg_temp.hand(ann, 'spxboard');
    set6 := (set_card(ann, 'spxboard', a4, p6, '{}', 0) ->> 'id')::uuid;
    made := pg_temp.quote(b, t, 'Quoting a second board card.', p6);
    if made -> 'sprung' is not null or pg_temp.sprung_of(set6) is not null then raise exception 'a second board card landed on a board that carries one: %', made; end if;
  end;
end $$;

-- ---- A Move that needs a phrase springs only on a quote with it, in the quoting post's own words ----
do $$
declare
  ann uuid := tests.account('sp-auto-ann'); bob uuid := tests.account('sp-auto-bob');
  a uuid := tests.character(ann, 'Sp Auto Ann'); b uuid := tests.character(bob, 'Sp Auto Bob');
  t uuid := tests.thread('Phrases');
  p uuid := tests.post(a, t, 'A post with a phrase under it.');
  the_set uuid;
  made jsonb;
begin
  perform pg_temp.hand(ann, 'spxauto');
  the_set := (set_card(ann, 'spxauto', a, p, '{}', 0, null, 'heel') ->> 'id')::uuid;
  made := pg_temp.quote(b, t, 'Nothing of the kind.', p);
  if made -> 'sprung' is not null or pg_temp.sprung_of(the_set) is not null then raise exception 'a quote without the phrase sprang the back: %', made; end if;
  -- The phrase in the quoted text, or inside a quote block, is not the quoting post's own.
  made := pg_temp.quote(b, t, '[quote=' || p || ']come to heel[/quote] Nope.', p);
  if made -> 'sprung' is not null then raise exception 'a phrase inside a quote block sprang the back'; end if;
  if not exists (select 1 from face_down f where f.play = the_set and f.ends_at > now()) then raise exception 'the back was lost'; end if;
  made := pg_temp.quote(b, t, 'Come to HEEL, please.', p);
  if made -> 'sprung' is null or pg_temp.sprung_of(the_set) is null then raise exception 'a quote with the phrase did not spring the back: %', made; end if;
  if (select count(*) from acts where kind = 'card' and payload ->> 'card' = 'spxauto' and payload ->> 'spring' is not null and target_act_id = (made ->> 'id')::uuid) is distinct from 1::bigint then raise exception 'the phrase back landed no card'; end if;
end $$;

-- ---- A Trap Card names its catch: that card, cast on its post, is caught and taken; any other passes over and the back stays set ----
do $$
declare
  ann uuid := tests.account('sp-trap-ann'); bob uuid := tests.account('sp-trap-bob');
  a uuid := tests.character(ann, 'Sp Trap Ann'); a2 uuid := tests.character(ann, 'Sp Trap Ann Two'); b uuid := tests.character(bob, 'Sp Trap Bob');
  t uuid := tests.thread('Catching');
  p uuid := tests.post(a, t, 'A trap under this.'); pr uuid := tests.post(a, t, 'A rare trap under this.');
  set1 uuid; set2 uuid; passed jsonb; caught jsonb; spring uuid;
  before_ann integer; before_bob integer;
begin
  perform pg_temp.hand(ann, 'spxtrap', 'spxtrap');
  perform pg_temp.hand(bob, 'spxwhoops', 'spxrare', 'spxwhoops', 'spxrare');
  set1 := (set_card(ann, 'spxtrap', a, p, '{"card": "spxwhoops"}', 0, 'spxwhoops') ->> 'id')::uuid;
  set2 := (set_card(ann, 'spxtrap', a, pr, '{"card": "spxrare"}', 0, 'spxrare') ->> 'id')::uuid;
  before_ann := card_held(ann, 'spxwhoops'); before_bob := card_held(bob, 'spxwhoops');
  -- Another card passes over it, lands as usual, and the back stays.
  passed := pg_temp.cast(bob, 'spxrare', b, p);
  if passed -> 'sprung' is not null or passed -> 'payload' ? 'caught' or pg_temp.sprung_of(set1) is not null then raise exception 'a card the trap did not name was caught: %', passed; end if;
  -- The named card is caught: its Act shows as caught and does nothing else, and its card is Ann's.
  caught := pg_temp.cast(bob, 'spxwhoops', b, p);
  spring := (caught -> 'sprung' ->> 'id')::uuid;
  if spring is null or (caught -> 'payload' ->> 'caught') is distinct from set1::text or caught -> 'payload' ? 'layer' then raise exception 'the named card was not caught: %', caught; end if;
  if (select s.payload from acts s where s.id = spring) is distinct from jsonb_build_object('card', 'spxtrap', 'trigger', 'cast', 'did', 'caught', 'set', set1::text, 'by', caught ->> 'id', 'caught', caught ->> 'id') then
    raise exception 'the catching spring says %', (select s.payload from acts s where s.id = spring);
  end if;
  if card_held(ann, 'spxwhoops') is distinct from before_ann + 1 then raise exception 'the setter did not take the caught card: % then %', before_ann, card_held(ann, 'spxwhoops'); end if;
  if card_held(bob, 'spxwhoops') is distinct from before_bob - 1 then raise exception 'the caster kept the caught card'; end if;
  if (select (l.account, l.card, l.kind, l.act, l.price) from card_ledger l where l.kind = 'caught' and l.act = spring) is distinct from (ann, 'spxwhoops'::text, 'caught'::text, spring, 0) then raise exception 'the setter''s ledger says %', (select jsonb_agg(l) from card_ledger l where l.act = spring); end if;
  if not exists (select 1 from card_ledger l where l.account = bob and l.kind = 'played' and l.act = (caught ->> 'id')::uuid) then raise exception 'the caster''s play row is gone'; end if;
  if exists (select 1 from wallet_events where ref = spring) then raise exception 'a catch paid out'; end if;
  if not exists (select 1 from alerts where account = bob and kind = 'trapStruck' and act = (caught ->> 'id')::uuid) then raise exception 'the caught caster was not told'; end if;
  if position(ann::text in caught::text) > 0 then raise exception 'the answer to the caster names the setter''s account: %', caught; end if;
  -- It is a finished back: the next cast of that card lands.
  if pg_temp.cast(bob, 'spxwhoops', b, p) -> 'sprung' is not null then raise exception 'a sprung Trap Card caught twice'; end if;
  -- A rare card is caught when it is named.
  caught := pg_temp.cast(bob, 'spxrare', b, pr);
  if caught -> 'sprung' is null or card_held(ann, 'spxrare') is distinct from 1 then raise exception 'a rare card was not caught when named: %', caught; end if;
end $$;

-- ---- Casting on one's own other mask's Trap Card gives the card back to the same account, and names no account ----
do $$
declare
  ann uuid := tests.account('sp-own-ann');
  a1 uuid := tests.character(ann, 'Sp Own One'); a2 uuid := tests.character(ann, 'Sp Own Two');
  t uuid := tests.thread('Own masks');
  p uuid := tests.post(a1, t, 'A trap under this.');
  caught jsonb;
begin
  perform pg_temp.hand(ann, 'spxtrap', 'spxwhoops');
  perform set_card(ann, 'spxtrap', a1, p, '{"card": "spxwhoops"}', 0, 'spxwhoops');
  caught := pg_temp.cast(ann, 'spxwhoops', a2, p);
  if caught -> 'sprung' is null then raise exception 'a cast on one''s own mask''s Trap Card was not caught: %', caught; end if;
  if card_held(ann, 'spxwhoops') is distinct from 1 then raise exception 'the card did not come back to the same account: %', card_held(ann, 'spxwhoops'); end if;
  if position(ann::text in caught::text) > 0 then raise exception 'the answer names an account: %', caught; end if;
  -- Nobody is told of their own trap catching their own card.
  if exists (select 1 from alerts where account = ann and kind in ('trapStruck', 'trapSprang')) then raise exception 'a player was alerted to their own masks'' trap'; end if;
end $$;

-- ---- A cast on a back that holds a Move, a reaction and a plain reply spring nothing ----
do $$
declare
  ann uuid := tests.account('sp-none-ann'); bob uuid := tests.account('sp-none-bob');
  a uuid := tests.character(ann, 'Sp None Ann'); b uuid := tests.character(bob, 'Sp None Bob');
  t uuid := tests.thread('Nothing springs');
  p uuid := tests.post(a, t, 'A Move under this.');
  the_set uuid; made jsonb;
begin
  perform pg_temp.hand(ann, 'spxwhoops');
  perform pg_temp.hand(bob, 'spxrare');
  the_set := (set_card(ann, 'spxwhoops', a, p, '{}', 0) ->> 'id')::uuid;
  made := pg_temp.cast(bob, 'spxrare', b, p);
  if made -> 'sprung' is not null or pg_temp.sprung_of(the_set) is not null then raise exception 'a cast sprang a Move: %', made; end if;
  perform tests.become(bob);
  made := react(p, b, 'up');
  perform tests.unbecome();
  if made ? 'sprung' or pg_temp.sprung_of(the_set) is not null then raise exception 'a reaction sprang a Move: %', made; end if;
  made := pg_temp.quote(b, t, 'A plain reply, quoting nothing.');
  if made ? 'sprung' or pg_temp.sprung_of(the_set) is not null then raise exception 'a plain reply sprang a Move: %', made; end if;
  made := pg_temp.quote(b, t, 'Quoting another post of the thread.', (made ->> 'id')::uuid);
  if made ? 'sprung' then raise exception 'a quote of another post sprang a Move: %', made; end if;
  if not exists (select 1 from face_down f where f.play = the_set and f.ends_at > now()) then raise exception 'the back did not stay set'; end if;
end $$;

-- ---- A staff cast that is named is copied to the setter; a Mod Bot's Trap Card spends the card it catches and gives nobody a copy ----
do $$
declare
  ann uuid := tests.account('sp-staff-ann'); bob uuid := tests.account('sp-staff-bob');
  a uuid := tests.character(ann, 'Sp Staff Ann'); b uuid := tests.character(bob, 'Sp Staff Bob');
  t uuid := tests.thread('Staff catches');
  p uuid := tests.post(a, t, 'A trap under this.');
  sp uuid := (write_staff_act('fdm-mod', 'post', t, null, '{"body": "A Mod Bot''s post to trap."}') ->> 'id')::uuid;
  staff_char uuid := (select id from characters where staff = 'fdm-mod');
  made jsonb; spring uuid; caught_before bigint;
begin
  perform pg_temp.hand(ann, 'spxtrap');
  perform pg_temp.hand(bob, 'spxwhoops');
  perform set_card(ann, 'spxtrap', a, p, '{"card": "spxwhoops"}', 0, 'spxwhoops');
  -- The persona casts the named card on Ann's post: caught, and Ann holds a new copy; the persona has no hand to take from or give to.
  perform tests.become_service();
  made := staff_play_card('fdm-mod', 'spxwhoops', p);
  perform tests.unbecome();
  spring := (made -> 'sprung' ->> 'id')::uuid;
  if spring is null or made -> 'payload' ->> 'caught' is null then raise exception 'a staff cast that was named was not caught: %', made; end if;
  if card_held(ann, 'spxwhoops') is distinct from 1 or (select count(*) from card_ledger where kind = 'caught' and act = spring and account = ann) is distinct from 1::bigint then raise exception 'the setter did not get a copy of a staff cast'; end if;
  if exists (select 1 from card_ledger where act = (made ->> 'id')::uuid) then raise exception 'a staff cast has a ledger row'; end if;

  -- A Mod Bot's Trap Card catches a player's card, and the card is spent: no copy for anyone.
  perform tests.become_service();
  perform staff_set_card('fdm-mod', 'spxtrap', sp, '{"card": "spxwhoops"}', 'spxwhoops');
  perform tests.unbecome();
  caught_before := (select count(*) from card_ledger where kind = 'caught');
  made := pg_temp.cast(bob, 'spxwhoops', b, sp);
  if made -> 'sprung' is null or made -> 'payload' ->> 'caught' is null then raise exception 'a player''s named card was not caught by a Mod Bot''s Trap Card: %', made; end if;
  if (select count(*) from card_ledger where kind = 'caught') is distinct from caught_before then raise exception 'a Mod Bot took a copy of the card it caught'; end if;
  if card_held(bob, 'spxwhoops') is distinct from 0 then raise exception 'the caught card was not spent'; end if;
  if (select s.character from acts s where s.id = (made -> 'sprung' ->> 'id')::uuid) is distinct from staff_char then raise exception 'the spring is not the persona''s'; end if;
end $$;

-- ---- A Mod Bot's quote springs a back like any quote (#233), and a Move landing on the persona is a card on staff ----
do $$
declare
  ann uuid := tests.account('sp-pool-ann');
  a uuid := tests.character(ann, 'Sp Pool Ann');
  t uuid := tests.thread('Pool quotes');
  p uuid := tests.post(a, t, 'A bomb under this.');
  staff_char uuid := (select id from characters where staff = 'fdm-mod');
  the_set uuid; made jsonb; laid uuid;
begin
  perform pg_temp.hand(ann, 'spxbomb');
  the_set := (set_card(ann, 'spxbomb', a, p, '{}', 0) ->> 'id')::uuid;
  made := write_staff_act('fdm-mod', 'post', t, p, '{"body": "A pool post quoting."}');
  if made -> 'sprung' is null or pg_temp.sprung_of(the_set) is null then raise exception 'a pool post did not spring the back it quotes: %', made; end if;
  select k.id into laid from acts k where k.kind = 'card' and k.payload ->> 'spring' = (made -> 'sprung' ->> 'id');
  if (select (k.character, k.payload ->> 'reach', k.payload ->> 'character') from acts k where k.id = laid) is distinct from (a, 'character'::text, staff_char::text) then
    raise exception 'the Bomb did not land on the persona: %', (select to_jsonb(k) from acts k where k.id = laid);
  end if;
  -- A pool post that quotes nothing, or a back that is not there, writes as it always did.
  made := write_staff_act('fdm-mod', 'post', t, null, '{"body": "No quote."}');
  if made ? 'sprung' then raise exception 'a pool post with no quote sprang something'; end if;
end $$;

-- ---- A Hall Pass springs on a visit and ends it ----
do $$
declare
  ann uuid := tests.account('sp-pass-ann');
  a uuid := tests.character(ann, 'Sp Pass Ann');
  t uuid := tests.thread('Hall pass');
  p uuid := tests.post(a, t, 'A pass under this.');
  staff_char uuid := (select id from characters where staff = 'fdm-mod');
  the_set uuid; v uuid; sprung jsonb;
begin
  perform pg_temp.hand(ann, 'spxpass');
  the_set := (set_card(ann, 'spxpass', a, p, '{}', 0) ->> 'id')::uuid;
  -- A quote does not spring it.
  if pg_temp.quote(tests.character(tests.account('sp-pass-bob'), 'Sp Pass Bob'), t, 'Quoting.', p) ? 'sprung' then raise exception 'a quote sprang a Hall Pass'; end if;
  perform set_config('kayfabb.staff_writer', 'on', true);
  v := tests.act(staff_char, 'visit', t, jsonb_build_object(
    'charges', jsonb_build_array(jsonb_build_object('rule_number', 1, 'board', (select board from threads where id = t), 'band', 'minor', 'cause', 'patrol', 'about_act', p::text)),
    'ends_at', now() + interval '1 hour', 'challenge', jsonb_build_object('kind', 'distraction'), 'line', 'Looking.'), p);
  perform set_config('kayfabb.staff_writer', '', true);
  sprung := spring_traps('visit', p, v);
  if sprung is null or sprung -> 'payload' ->> 'did' is distinct from 'ended' or sprung -> 'payload' ->> 'trigger' is distinct from 'visit' or sprung -> 'payload' ->> 'by' is distinct from v::text then raise exception 'a visit did not spring a Hall Pass: %', sprung; end if;
  if sprung ? 'struck' or exists (select 1 from acts k where k.kind = 'card' and k.payload ->> 'spring' is not null and k.thread = t) then raise exception 'a Hall Pass laid a card'; end if;
end $$;

-- ---- The spring Act's payload: the new shape and the old ones are accepted, nothing else ----
do $$
declare
  ann uuid := tests.account('sp-payload-ann');
  a uuid := tests.character(ann, 'Sp Payload Ann');
  t uuid := tests.thread('Payloads');
  p1 uuid := tests.post(a, t, 'One.'); p2 uuid := tests.post(a, t, 'Two.'); p3 uuid := tests.post(a, t, 'Three.'); p4 uuid := tests.post(a, t, 'Four.'); p5 uuid := tests.post(a, t, 'Five.');
  s1 uuid := tests.act(a, 'set', t, '{}', p1); s2 uuid := tests.act(a, 'set', t, '{}', p2); s3 uuid := tests.act(a, 'set', t, '{}', p3); s4 uuid := tests.act(a, 'set', t, '{}', p4); s5 uuid := tests.act(a, 'set', t, '{}', p5);
  why text;
begin
  -- A spring written before this: an outcome, no did.
  perform tests.act(a, 'spring', t, jsonb_build_object('card', 'spxtrap', 'trigger', 'reaction', 'outcome', jsonb_build_object('do', 'payout'), 'set', s1), p1);
  -- The new one: a did that agrees with its trigger.
  perform tests.act(a, 'spring', t, jsonb_build_object('card', 'spxwhoops', 'trigger', 'quote', 'did', 'landed', 'set', s2, 'by', p1), p2);
  perform tests.act(a, 'spring', t, jsonb_build_object('card', 'spxtrap', 'trigger', 'cast', 'did', 'caught', 'set', s3, 'by', p1, 'caught', p1), p3);
  -- A did that disagrees with its trigger, none at all, and both are refused.
  why := pg_temp.refusal(format('select tests.act(%L, ''spring'', %L, %L::jsonb, %L)', a, t, jsonb_build_object('card', 'spxwhoops', 'trigger', 'quote', 'did', 'caught', 'set', s4), p4));
  if why is null or why not like '%acts_spring_payload%' then raise exception 'a did that disagrees with its trigger was stored: %', why; end if;
  why := pg_temp.refusal(format('select tests.act(%L, ''spring'', %L, %L::jsonb, %L)', a, t, jsonb_build_object('card', 'spxwhoops', 'trigger', 'quote', 'set', s4), p4));
  if why is null or why not like '%acts_spring_payload%' then raise exception 'a spring that says nothing was stored: %', why; end if;
  why := pg_temp.refusal(format('select tests.act(%L, ''spring'', %L, %L::jsonb, %L)', a, t, jsonb_build_object('card', 'spxwhoops', 'trigger', 'quote', 'did', 'landed', 'outcome', jsonb_build_object('do', 'nullify'), 'set', s4), p4));
  if why is null or why not like '%acts_spring_payload%' then raise exception 'a spring with both shapes was stored: %', why; end if;
  why := pg_temp.refusal(format('select tests.act(%L, ''spring'', %L, %L::jsonb, %L)', a, t, jsonb_build_object('card', 'spxwhoops', 'trigger', 'quote', 'did', 'landed', 'set', s5, 'extra', 1), p5));
  if why is null or why not like '%acts_spring_payload%' then raise exception 'a spring with a key of its own was stored: %', why; end if;
end $$;

-- ---- The reply moment is gone, a Gimmick that waits for a cast names a card, and the setter's log says a Move set face down can spring ----
do $$
declare
  ann uuid := tests.account('sp-gone-ann');
  a uuid := tests.character(ann, 'Sp Gone Ann');
  t uuid := tests.thread('Gone');
  p1 uuid := tests.post(a, t, 'One.'); p2 uuid := tests.post(a, t, 'Two.'); p3 uuid := tests.post(a, t, 'Three.');
  s_move uuid; s_bluff uuid; why text;
begin
  if to_regclass('face_down_reply') is not null or to_regproc('face_down_reply_once') is not null or to_regproc('face_down_reply_backfill') is not null then raise exception 'face_down_reply is still there'; end if;
  perform pg_temp.hand(ann, 'spxwhoops', 'spxbluff', 'spxtrap');
  s_move := (set_card(ann, 'spxwhoops', a, p1, '{}', 0) ->> 'id')::uuid;
  s_bluff := (set_card(ann, 'spxbluff', a, p2, '{}', 0) ->> 'id')::uuid;
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0)', ann, 'spxtrap', a, p3, '{}'));
  if why is distinct from 'Spx Trap names no card to catch' then raise exception 'a Trap Card was set naming nothing: %', why; end if;
  perform tests.become(ann);
  if (select springs from my_card_ledger where act = s_move) is distinct from true then raise exception 'a Move set face down does not spring, the log says'; end if;
  if (select springs from my_card_ledger where act = s_bluff) is distinct from false then raise exception 'a Bluff set face down springs, the log says'; end if;
  if exists (select 1 from my_face_down where passed_at is not null) then raise exception 'a back was passed by a reply'; end if;
  perform tests.unbecome();
end $$;

-- ---- Every back costs the same reads before its decision: a Bluff, a Trap Card naming another card, a Move whose phrase is absent, a Move that cannot land, a retired setter's Move, and a back that springs ----
-- What a call reads from the tables spring_facts and spring_traps decide from, and their indexes: rows fetched and index entries returned in this transaction so far, as 0077-trap-locks.sql counts them.
create function pg_temp.reads() returns bigint[] language sql as $$
  select array_agg(x.n order by x.relname) from (
    select t.relname, sum(pg_stat_get_xact_tuples_fetched(o.oid) + pg_stat_get_xact_tuples_returned(o.oid))::bigint as n
    from pg_class t cross join lateral (select t.oid union all select i.indexrelid from pg_index i where i.indrelid = t.oid) o(oid)
    where t.relname in ('characters', 'card_kinds', 'acts', 'face_down', 'play_reach', 'threads', 'settings') and t.relnamespace = 'public'::regnamespace
    group by t.relname) x
$$;
-- A call's reads: for each table (with its indexes), in name order, what it read since `before`; compared as vectors, so a read moved from one table to another is a difference a sum would hide.
create function pg_temp.since(before bigint[]) returns text language sql as $$
  select array_agg(n.v - before[n.i] order by n.i)::text from unnest(pg_temp.reads()) with ordinality n(v, i)
$$;
do $$
declare
  ann uuid := tests.account('sp-even-ann'); bob uuid := tests.account('sp-even-bob');
  bluffer uuid := tests.character(ann, 'Even Bluffer'); trapper uuid := tests.character(ann, 'Even Trapper'); phrasey uuid := tests.character(ann, 'Even Phrasey');
  bomber uuid := tests.character(ann, 'Even Bomber'); retiree uuid := tests.character(ann, 'Even Retiree'); springer uuid := tests.character(ann, 'Even Springer');
  q uuid := tests.character(bob, 'Even Quoter');
  t uuid := tests.thread('Even work');
  p_bluff uuid := tests.post(bluffer, t, 'Bluffed.'); p_trap uuid := tests.post(trapper, t, 'Trapped.'); p_phrase uuid := tests.post(phrasey, t, 'Phrased.');
  p_bomb uuid := tests.post(bomber, t, 'Bombed.'); p_retired uuid := tests.post(retiree, t, 'Retired.'); p_spring uuid := tests.post(springer, t, 'Springing.');
  quoting uuid := tests.post(q, t, 'Quoting everything, and saying nothing of stripes.'); free uuid := tests.post(q, t, 'Quoting the last, unwarded.');
  s_bluff uuid; s_trap uuid; s_phrase uuid; s_bomb uuid; s_retired uuid; s_spring uuid;
  fd face_down; backs uuid[]; one uuid; n integer;
  before bigint[];
  facts_reads text[] := '{}'; full_reads text[] := '{}'; said jsonb;
  cast_reads text[] := '{}'; patterns text[] := '{}'; ghost uuid := gen_random_uuid();
begin
  -- The small tables (card_kinds, characters) are read in order by a sequential scan that stops at the first match, so the rows it reads say where a row sits in the table and not what the statement
  -- does; key lookups through the indexes read the same rows for every key, and are the statements being counted. (A busy instance's tables are read through them.)
  perform set_config('enable_seqscan', 'off', true);
  discard plans;
  perform pg_temp.hand(ann, 'spxbluff', 'spxtrap', 'spxauto', 'spxbomb', 'spxbomb', 'spxwhoops');
  s_bluff := (set_card(ann, 'spxbluff', bluffer, p_bluff, '{}', 0) ->> 'id')::uuid;
  s_trap := (set_card(ann, 'spxtrap', trapper, p_trap, '{"card": "spxrare"}', 0, 'spxrare') ->> 'id')::uuid;
  s_phrase := (set_card(ann, 'spxauto', phrasey, p_phrase, '{}', 0, null, 'zebra') ->> 'id')::uuid;
  s_bomb := (set_card(ann, 'spxbomb', bomber, p_bomb, '{}', 0) ->> 'id')::uuid;
  s_retired := (set_card(ann, 'spxbomb', retiree, p_retired, '{}', 0) ->> 'id')::uuid;
  s_spring := (set_card(ann, 'spxwhoops', springer, p_spring, '{}', 0) ->> 'id')::uuid;
  -- The quoting character already carries a Bomb, so the Bomb back cannot land; the retired setter cannot act.
  perform tests.act(bomber, 'card', t, jsonb_build_object('card', 'spxbomb', 'message', '', 'config', '{}', 'reach', 'character', 'character', q, 'ends', now() + interval '3 days', 'targetName', 'Even Quoter'), quoting);
  insert into play_reach (play, reach, character, ends_at) select a.id, 'character', q, now() + interval '3 days' from acts a where a.kind = 'card' and a.payload ->> 'card' = 'spxbomb' and a.payload ->> 'character' = q::text;
  update characters set retired_at = now() where id = retiree;
  -- Every setter's row has been rewritten once, as the retiree's was (a rewritten row is a longer chain to read, which says nothing of the statement).
  update characters set debuted_at = debuted_at where id in (bluffer, trapper, phrasey, bomber, springer);
  -- The quoting post is warded too: a Ward is read for every back, and the Whoops back (common) is turned away by it as a cast would be.
  perform tests.act(q, 'card', t, jsonb_build_object('card', 'spxward', 'layer', 1, 'message', '', 'config', '{}'::jsonb, 'ends', now() + interval '7 days'), quoting);

  backs := array[p_bluff, p_trap, p_phrase, p_bomb, p_retired, p_spring];
  -- Warm: each statement planned, so a call's reads are its execution's alone.
  for n in 1 .. 8 loop
    foreach one in array backs loop
      select * into fd from face_down f where f.post = one;
      perform spring_facts(fd, 'quote', quoting, null);
      perform spring_facts(fd, 'cast', ghost, 'spxrare');
    end loop;
  end loop;

  -- The reads of the decision's facts, for each back, in a quote and in a cast: the same for all six, the one that springs included.
  foreach one in array backs loop
    select * into fd from face_down f where f.post = one;
    before := pg_temp.reads(); perform spring_facts(fd, 'quote', quoting, null); facts_reads := facts_reads || pg_temp.since(before);
    before := pg_temp.reads(); perform spring_facts(fd, 'cast', ghost, 'spxrare'); cast_reads := cast_reads || pg_temp.since(before);
  end loop;
  if (select count(distinct r) from unnest(facts_reads) r) is distinct from 1::bigint then raise exception 'the backs make different reads before a quote''s decision: Bluff, Trap Card, phrase, Bomb, retired, springing = %', facts_reads; end if;
  if (select count(distinct r) from unnest(cast_reads) r) is distinct from 1::bigint then raise exception 'the backs make different reads before a cast''s decision: %', cast_reads; end if;
  if (select sum(v) from unnest(facts_reads[1]::bigint[]) v) < 8 then raise exception 'the reads were not counted (%)', facts_reads[1]; end if;
  -- The phrase's pattern is one fixed length for every back and its own for each (built around the back's id), a back with no phrase included.
  foreach one in array backs loop
    select * into fd from face_down f where f.post = one;
    patterns := patterns || phrase_pattern(fd.phrase, fd.play::text);
  end loop;
  -- Two backs holding the very same phrase still have patterns of their own, and of the same length.
  if phrase_pattern('heel', 'one') = phrase_pattern('heel', 'two') or length(phrase_pattern('heel', 'one')) is distinct from length(phrase_pattern('heel', 'two')) then raise exception 'two backs with one phrase share a pattern'; end if;
  if (select count(distinct length(x)) from unnest(patterns) x) is distinct from 1::bigint or (select count(distinct x) from unnest(patterns) x) is distinct from 6::bigint then
    raise exception 'the backs'' phrase patterns are not one length, each its own: %', (select array_agg(length(x)) from unnest(patterns) x);
  end if;

  -- The whole call: the five that do not spring answer null, write nothing and read alike; the sixth springs.
  for n in 1 .. 8 loop
    foreach one in array backs[1:5] loop perform spring_traps('quote', one, quoting); end loop;
  end loop;
  foreach one in array backs[1:5] loop
    before := pg_temp.reads(); said := spring_traps('quote', one, quoting); full_reads := full_reads || pg_temp.since(before);
    if said is not null then raise exception 'a back that cannot spring sprang: %', said; end if;
  end loop;
  if exists (select 1 from acts where kind = 'spring' and target_act_id = any (backs[1:5])) then raise exception 'a back that cannot spring wrote a spring: %', (select jsonb_agg(s.payload) from acts s where s.kind = 'spring' and s.target_act_id = any (backs[1:5])); end if;
  if (select count(distinct r) from unnest(full_reads) r) is distinct from 1::bigint then raise exception 'the backs that cannot spring read differently: Bluff, Trap Card, phrase absent, Bomb that cannot land, retired setter = %', full_reads; end if;
  if spring_traps('quote', p_spring, quoting) is not null then raise exception 'the last back sprang through a Ward'; end if;
  said := spring_traps('quote', p_spring, free);
  if said is null then raise exception 'the last back did not spring'; end if;
  perform set_config('enable_seqscan', 'on', true);
end $$;

-- ---- A Trap Card set before this named no card: it catches nothing and ends at its time; no row of it is edited ----
do $$
declare
  ann uuid := tests.account('sp-old-ann'); bob uuid := tests.account('sp-old-bob');
  a uuid := tests.character(ann, 'Sp Old Ann'); b uuid := tests.character(bob, 'Sp Old Bob');
  t uuid := tests.thread('Old backs');
  p uuid := tests.post(a, t, 'An old trap under this.');
  the_set uuid := tests.act(a, 'set', t, '{}', p);
  made jsonb; why text;
begin
  insert into face_down (play, account, card, post, thread, round, ends_at) values (the_set, ann, 'spxtrap', p, t, 1, now() + interval '7 days');
  perform pg_temp.hand(bob, 'spxrare', 'spxwhoops');
  made := pg_temp.cast(bob, 'spxrare', b, p);
  if made -> 'sprung' is not null or made -> 'payload' ? 'caught' then raise exception 'an old Trap Card naming no card caught a cast: %', made; end if;
  made := pg_temp.cast(bob, 'spxwhoops', b, p);
  if made -> 'sprung' is not null then raise exception 'an old Trap Card caught a second card: %', made; end if;
  if not exists (select 1 from face_down f where f.play = the_set and f.ends_at > now()) or pg_temp.sprung_of(the_set) is not null then raise exception 'the old back is not still set'; end if;
  why := pg_temp.refusal(format('update face_down set catches = %L where play = %L', 'spxrare', the_set));
  if why is null then raise exception 'a face_down row was edited'; end if;
end $$;

-- ---- A sprung Move does not land through a live Ward that would turn away a cast of the same card; the back stays set ----
do $$
declare
  ann uuid := tests.account('sp-ward-ann'); bob uuid := tests.account('sp-ward-bob');
  a uuid := tests.character(ann, 'Sp Ward Ann'); b uuid := tests.character(bob, 'Sp Ward Bob');
  t uuid := tests.thread('Wards');
  p uuid := tests.post(a, t, 'A Move under this.');
  warded uuid := tests.post(b, t, 'Warded quoting post.'); free uuid := tests.post(b, t, 'Unwarded quoting post.');
  the_set uuid;
begin
  perform pg_temp.hand(ann, 'spxwhoops'); perform pg_temp.hand(bob, 'spxward');
  the_set := (set_card(ann, 'spxwhoops', a, p, '{}', 0) ->> 'id')::uuid;
  perform pg_temp.cast(bob, 'spxward', b, warded);
  if spring_traps('quote', p, warded) is not null or pg_temp.sprung_of(the_set) is not null then raise exception 'a Move landed through a Ward that turns its card away'; end if;
  if not exists (select 1 from face_down f where f.play = the_set and f.ends_at > now()) then raise exception 'the back was lost'; end if;
  if spring_traps('quote', p, free) is null or pg_temp.sprung_of(the_set) is null then raise exception 'an unwarded quote did not land the Move'; end if;
end $$;

-- ---- The phrase is folded and matched by the same work for every back, a back with none included ----
do $$
declare
  fd face_down;
begin
  if phrase_probe('Come to HEEL, please.', 'heel', 'tok') is distinct from true then raise exception 'a phrase back did not match'; end if;
  if phrase_probe('Come to heel, please.', null, 'tok') is distinct from false or phrase_probe('Come to heel, please.', '', 'tok') is distinct from false then raise exception 'a back with no phrase matched'; end if;
  if phrase_probe('tok and tok', null, 'tok') is distinct from false then raise exception 'a no-phrase back matched its own token'; end if;
  if phrase_probe('a heeler', 'heel', 'tok') is distinct from phrase_in('a heeler', 'heel') or phrase_probe('--', '--', 'tok') is distinct from phrase_in('--', '--') or phrase_probe(null, 'heel', 'tok') is distinct from false then
    raise exception 'phrase_probe parts from phrase_in';
  end if;
end $$;

-- ---- What a spring puts out, and what it leaves, tells nothing private ----
do $$
declare
  ann uuid := tests.account('sp-pub-ann'); bob uuid := tests.account('sp-pub-bob');
  a uuid := tests.character(ann, 'Sp Pub Ann'); a2 uuid := tests.character(ann, 'Sp Pub Ann Two'); b uuid := tests.character(bob, 'Sp Pub Bob');
  t uuid := tests.thread('Public');
  p uuid := tests.post(a, t, 'A phrase and a seed under this.'); p2 uuid := tests.post(a2, t, 'A seeded Move under this.');
  made jsonb; made2 jsonb; spring jsonb; laid uuid; k text;
begin
  perform pg_temp.hand(ann, 'spxauto', 'blot');
  perform set_card(ann, 'spxauto', a, p, '{"ink": "plumsecret"}', 0, null, 'heel');
  perform set_card(ann, 'blot', a2, p2, '{"color": "red", "seed": 1}', 0);
  delete from broadcasts_due where topic like 'account:%';
  made := pg_temp.quote(b, t, 'Come to heel.', p);
  spring := made -> 'sprung';
  -- The projection that goes out is the spring's public one: its payload has the card, trigger, did, set and by, nothing else, and not the phrase or the card's settings.
  if (select array_agg(kk order by kk) from jsonb_object_keys(spring -> 'payload') kk) is distinct from array['by', 'card', 'did', 'set', 'trigger'] then raise exception 'the spring says more than it did: %', spring -> 'payload'; end if;
  if (spring - 'struck')::text like '%plumsecret%' or (spring - 'struck')::text like '%heel%' then raise exception 'the spring carries the phrase or the settings (the card it landed shows its settings, as a cast does): %', spring; end if;
  if (select count(*) from play_moments where play = (spring ->> 'id')::uuid) is distinct from 1::bigint then raise exception 'a spring takes no moment'; end if;
  -- The alerts it queued carry the public projection alone and name neither the quoter nor their account.
  if exists (select 1 from broadcasts_due where topic like 'account:%' and (payload::text like '%' || bob::text || '%' or payload::text like '%' || b::text || '%' and topic <> 'account:' || bob)) then raise exception 'an alert names the quoter or their account'; end if;
  if exists (select 1 from alerts where account = ann and (to_jsonb(alerts)::text like '%' || bob::text || '%' or to_jsonb(alerts)::text like '%' || b::text || '%')) then raise exception 'the setter''s alert names the quoter'; end if;
  for k in select distinct jsonb_object_keys(payload) from broadcasts_due where topic = 'account:' || ann loop
    if k not in ('id', 'kind', 'sub', 'act', 'character', 'at') then raise exception 'a broadcast carries %', k; end if;
  end loop;
  -- A seeded Move gets a fresh seed when it lands, and its config holds none.
  made2 := pg_temp.quote(b, t, 'Quoting the seeded one.', p2);
  select k.id into laid from acts k where k.kind = 'card' and k.payload ->> 'spring' = made2 -> 'sprung' ->> 'id';
  if jsonb_typeof((select payload -> 'seed' from acts where id = laid)) is distinct from 'number' or (select payload -> 'config' ? 'seed' from acts where id = laid) then raise exception 'the sprung seed: %', (select payload from acts where id = laid); end if;
  if (select payload -> 'config' ->> 'color' from acts where id = laid) is distinct from 'red' then raise exception 'the setter''s ink was lost'; end if;
end $$;

-- ---- "By any character": the setter's own mask quoting its own post springs it; a quote from another thread lands in the quoting post's thread and board and writes the spring in the back's; the setter's other mask quoting tells nobody ----
do $$
declare
  ann uuid := tests.account('sp-any-ann'); bob uuid := tests.account('sp-any-bob');
  a1 uuid := tests.character(ann, 'Sp Any One'); a2 uuid := tests.character(ann, 'Sp Any Two'); b uuid := tests.character(bob, 'Sp Any Bob');
  t1 uuid := tests.thread('Any one');
  other_board uuid; t2 uuid;
  p1 uuid := tests.post(a1, t1, 'My own, quoted by myself.'); p2 uuid := tests.post(a1, t1, 'Quoted by my other mask.');
  p3 uuid := tests.post(a1, t1, 'A thread card, quoted from afar.'); p4 uuid := tests.post(a1, t1, 'A board card, quoted from afar.');
  set1 uuid; set2 uuid; set3 uuid; set4 uuid; made jsonb; laid uuid;
begin
  insert into boards (slug, name) values ('sp-any-board', 'Sp Any Board') returning id into other_board;
  insert into threads (board, title) values (other_board, 'Elsewhere') returning id into t2;
  perform pg_temp.hand(ann, 'spxwhoops', 'spxwhoops', 'spxthread', 'spxboard');
  insert into settings (key, value) select 'systemAnnouncements', to_jsonb(tests.thread('Any announcements')::text) where not exists (select 1 from settings where key = 'systemAnnouncements');
  set1 := (set_card(ann, 'spxwhoops', a1, p1, '{}', 0) ->> 'id')::uuid;
  set2 := (set_card(ann, 'spxwhoops', a1, p2, '{}', 0) ->> 'id')::uuid;
  set3 := (set_card(ann, 'spxthread', a1, p3, '{}', 0) ->> 'id')::uuid;
  set4 := (set_card(ann, 'spxboard', a1, p4, '{}', 0) ->> 'id')::uuid;
  -- The very character that set it.
  made := pg_temp.quote(a1, t1, 'Quoting myself.', p1);
  if made -> 'sprung' is null or pg_temp.sprung_of(set1) is null then raise exception 'a character quoting its own post did not spring its back: %', made; end if;
  -- The setter's other mask: it springs, and the setter's account is told nothing.
  delete from alerts; delete from broadcasts_due where topic like 'account:%';
  made := pg_temp.quote(a2, t1, 'Quoting from my other mask.', p2);
  if made -> 'sprung' is null or pg_temp.sprung_of(set2) is null then raise exception 'the setter''s other mask did not spring the back: %', made; end if;
  if exists (select 1 from alerts where account = ann) or exists (select 1 from broadcasts_due where topic = 'account:' || ann) then raise exception 'the setter was alerted to their own masks'' doing'; end if;
  -- A quote from another thread: the spring is in the back's thread, a thread card lands in the quoting post's thread, a board card on its board.
  made := pg_temp.quote(b, t2, 'Quoting across threads.', p3);
  if (select thread from acts where id = (made -> 'sprung' ->> 'id')::uuid) is distinct from t1 then raise exception 'the spring is not in the back''s thread'; end if;
  select k.id into laid from acts k where k.kind = 'card' and k.payload ->> 'spring' = made -> 'sprung' ->> 'id';
  if not exists (select 1 from play_reach r where r.play = laid and r.thread = t2) or (select payload ->> 'thread' from acts where id = laid) is distinct from t2::text then raise exception 'the thread card did not land on the quoting post''s thread'; end if;
  made := pg_temp.quote(b, t2, 'Quoting the board card across threads.', p4);
  select k.id into laid from acts k where k.kind = 'card' and k.payload ->> 'spring' = made -> 'sprung' ->> 'id';
  if not exists (select 1 from play_reach r where r.play = laid and r.board = other_board) then raise exception 'the board card did not land on the quoting post''s board'; end if;
  if (select thread from acts where id = (made -> 'sprung' ->> 'id')::uuid) is distinct from t1 then raise exception 'the board spring is not in the back''s thread'; end if;
end $$;
