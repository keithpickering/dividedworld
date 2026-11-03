-- A post's text and version for a card's rules, and a play decided against an older version refused
-- (supabase/migrations/0070_autocorrect.sql). docs/plans/2026-11-03-autocorrect-plan.md, Task 2. The card is the
-- test set's, never an instance's.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- ---- The lock order: a play given a version takes the player's account before the post, as every play_card does (0058) ----
-- First, so the rows it commits wait on nothing this file has written and not committed. Deterministic, not a race: another
-- connection holds the account; a versioned play is started; once it waits, the post must still be free. Taken the other way
-- round (post, then account), a versioned play and an unversioned one by the same player (a character play from that post)
-- would each hold what the other waits for, and Postgres would kill one.
do $$
declare
  ann uuid := gen_random_uuid(); a uuid := gen_random_uuid(); th uuid := gen_random_uuid(); p uuid := gen_random_uuid();
  url text := current_setting('kayfabb.scratch_url');
  waiting integer; tries integer := 0; post_held boolean; said text;
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'lock-order@test.invalid');
    insert into accounts (id) values (%1$L);
    insert into characters (id, owner, name, created_at, debuted_at) values (%2$L, %1$L, 'Lock Order', now(), now());
    insert into class_history (character, class_key, started_at) values (%2$L, 'alpha', now());
    insert into threads (id, board, title) select %3$L, b.id, 'Lock order' from boards b where b.slug = 'general';
    insert into acts (id, character, kind, thread, payload) values (%4$L, %2$L, 'post', %3$L, '{"body": "lock cats"}');
    update settings set value = value || '{"lockstick.price": 100}' where key = 'economy';
    insert into card_kinds (key, name, alignment, price_setting, rarity) values ('lockstick', 'Lock Stick', 'pepperoni', 'lockstick.price', 'common');
    insert into card_ledger (account, card, kind, price) values (%1$L, 'lockstick', 'bought', 0);
  $sql$, ann, a, th, p));
  perform extensions.dblink_connect('holder', url);
  perform extensions.dblink_exec('holder', 'begin');
  perform * from extensions.dblink('holder', format('select 1 from accounts where id = %L for no key update', ann)) as t(x integer);
  perform extensions.dblink_connect('player', url);
  perform extensions.dblink_send_query('player', format('select tests.raced(null, %L)',
    format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, null, %L)', ann, 'lockstick', a, p, '{}', '', 'post', p)));
  loop
    select count(*) into waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%tests.raced%';
    exit when waiting >= 1;
    tries := tries + 1;
    if tries > 400 then raise exception 'the versioned play never came to wait'; end if;
    perform pg_sleep(0.025);
  end loop;
  -- The post is tried without waiting, in a block that rolls back, so the lock is let go again whatever it found.
  begin
    perform 1 from acts where id = p for no key update nowait;
    post_held := false;
    raise exception 'let go';
  exception when lock_not_available then post_held := true; when others then null;
  end;
  perform extensions.dblink_exec('holder', 'rollback');
  perform extensions.dblink_disconnect('holder');
  select r.said into said from extensions.dblink_get_result('player') as r(said text);
  perform * from extensions.dblink_get_result('player') as r(said text);
  perform extensions.dblink_disconnect('player');
  if post_held then raise exception 'a versioned play waiting on its account already holds the post: the lock order is post, then account'; end if;
  if said is not null then raise exception 'once the account is free the play lands, said %', said; end if;
end $$;

do $$
declare
  ann uuid := tests.account('ac-ann'); bob uuid := tests.account('ac-bob');
  a uuid := tests.character(ann, 'Autocorrect Ann'); b uuid := tests.character(bob, 'Autocorrect Bob');
  th uuid := tests.thread('Autocorrect thread');
  p uuid := tests.post(a, th, 'my cats are [b]great[/b]', now() - interval '1 hour');
  first_edit uuid; second_edit uuid;
  got jsonb;
  said text;
begin
  update settings set value = value || '{"stickers.price": 100}' where key = 'economy';
  insert into card_kinds (key, name, alignment, price_setting, rarity, stack) values ('stickers', 'Stickers', 'pepperoni', 'stickers.price', 'common', 3);
  insert into card_ledger (account, card, kind, price) select bob, 'stickers', 'bought', 0 from generate_series(1, 3);

  -- Before any edit, the version is the post itself, and the body is what it was written with.
  got := card_target(p);
  if got ->> 'version' is distinct from p::text then raise exception 'an unedited post''s version is its own id, got %', got ->> 'version'; end if;
  if got ->> 'body' is distinct from 'my cats are [b]great[/b]' then raise exception 'the body is the post''s words, got %', got ->> 'body'; end if;
  if (card_target_reach('post', p) ->> 'version') is distinct from p::text then raise exception 'card_target_reach passes the version through'; end if;

  -- After an edit, the version is the latest edit, and the body is its words.
  first_edit := tests.act(a, 'edit', th, '{"body": "my dogs are great"}', p, now() - interval '30 minutes');
  second_edit := tests.act(a, 'edit', th, '{"body": "my cats are fine"}', p, now() - interval '10 minutes');
  got := card_target(p);
  if got ->> 'version' is distinct from second_edit::text then raise exception 'the version is the latest edit, got % (first %)', got ->> 'version', first_edit; end if;
  if got ->> 'body' is distinct from 'my cats are fine' then raise exception 'the body is the latest edit''s, got %', got ->> 'body'; end if;

  -- A play decided against an older version is refused in plain words, and nothing is spent.
  said := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, null, %L)', bob, 'stickers', b, p, '{}', '', 'post', first_edit));
  if said is distinct from 'the post was edited; look again' then raise exception 'a stale version is refused, said %', said; end if;
  said := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, null, %L)', bob, 'stickers', b, p, '{}', '', 'post', p));
  if said is distinct from 'the post was edited; look again' then raise exception 'the post''s own id is stale once it is edited, said %', said; end if;
  if exists (select 1 from acts where kind = 'card' and target_act_id = p) then raise exception 'a refused play writes no Act'; end if;
  if (select count(*) from card_ledger where account = bob and kind = 'played') is distinct from 0 then raise exception 'a refused play spends no card'; end if;

  -- The current version lands, and so does a play given no version (every reach beyond a post, and every older caller).
  said := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, null, %L)', bob, 'stickers', b, p, '{}', '', 'post', second_edit));
  if said is not null then raise exception 'the current version lands, said %', said; end if;
  said := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L)', bob, 'stickers', b, p, '{}', '', 'post'));
  if said is not null then raise exception 'a play with no version lands as before, said %', said; end if;
  if (select count(*) from acts where kind = 'card' and target_act_id = p) is distinct from 2 then raise exception 'two plays landed'; end if;

  -- A version given with a reach beyond a post is not read: a character play from this post lands whatever version it names.
  insert into card_kinds (key, name, alignment, price_setting, rarity, reaches, lasts) values ('pinstick', 'Pin Stick', 'pepperoni', 'stickers.price', 'uncommon', '{character}', interval '1 day');
  insert into card_ledger (account, card, kind, price) values (bob, 'pinstick', 'bought', 0);
  said := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L, %L)', bob, 'pinstick', b, a, '{}', '', 'character', p, first_edit));
  if said is not null then raise exception 'a character play is not refused for a version, said %', said; end if;
  -- A target that is not a post is left to play_card's own refusal, whatever version is given.
  said := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, null, %L)', bob, 'stickers', b, first_edit, '{}', '', 'post', first_edit));
  if said is distinct from 'a card lands on a post' then raise exception 'an edit is no post to play on, said %', said; end if;
  -- A null version is no check: it lands as the nine-argument call does.
  said := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, null, null)', bob, 'stickers', b, p, '{}', '', 'post'));
  if said is not null then raise exception 'a null version is no check, said %', said; end if;

  -- Players cannot call the version-checking play_card themselves; only the service decides a play.
  perform tests.become(bob);
  said := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, null, %L)', bob, 'stickers', b, p, '{}', '', 'post', second_edit));
  perform tests.unbecome();
  if said is null or said not like 'permission denied%' then raise exception 'a player may not call play_card with a version, said %', said; end if;
  perform tests.become(bob);
  said := pg_temp.refusal(format('select post_version(%L)', p));
  perform tests.unbecome();
  if said is null or said not like 'permission denied%' then raise exception 'a player may not read post_version, said %', said; end if;
end $$;
