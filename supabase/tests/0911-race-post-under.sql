-- The concurrent cases of a card that replies (supabase/migrations/0410_post_under.sql, its header's lock order): two plays on one parent at once write one reply between them; a play
-- racing a quote of its parent, an edit of it and the spring of a Move set on it each finish, and a play whose card insert would hold the caster's count row before the thread's row
-- (the order a post() of the same character takes the other way round) is the one deadlock this migration could have made, held here deterministically. The rows are committed
-- (tests.commit), since a racer is a session of its own; every name is this file's (par...), so no other file reads them.

do $$
declare
  ann uuid := gen_random_uuid(); bob uuid := gen_random_uuid(); cal uuid := gen_random_uuid(); dee uuid := gen_random_uuid();
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid(); d uuid := gen_random_uuid();
  t uuid := gen_random_uuid(); p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); p3 uuid := gen_random_uuid(); p4 uuid := gen_random_uuid();
  said text[]; posts_before integer;
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'par-ann@test.invalid'), (%2$L, 'par-bob@test.invalid'), (%3$L, 'par-cal@test.invalid'), (%4$L, 'par-dee@test.invalid');
    insert into accounts (id) values (%1$L), (%2$L), (%3$L), (%4$L);
    insert into characters (id, owner, name, debuted_at) values (%5$L, %1$L, 'Par Ann', now()), (%6$L, %2$L, 'Par Bob', now()), (%7$L, %3$L, 'Par Cal', now()), (%8$L, %4$L, 'Par Dee', now());
    insert into class_history (character, class_key) values (%5$L, 'alpha'), (%6$L, 'alpha'), (%7$L, 'alpha'), (%8$L, 'alpha');
    insert into card_kinds (key, name, alignment, rarity, play, stack, reaches, replies) values ('parcut', 'Par Cut', 'pepperoni', 'rare', 'cast', 1, '{post}', true);
    insert into card_kinds (key, name, alignment, rarity, play, stack, reaches) values ('parmove', 'Par Move', 'pepperoni', 'common', 'cast', 1, '{post}');
    insert into threads (id, board, title) select %9$L, b.id, 'Par thread' from boards b where b.slug = 'general';
    insert into acts (id, character, kind, thread, payload) values (%10$L, %5$L, 'post', %9$L, '{"body": "one"}'), (%11$L, %5$L, 'post', %9$L, '{"body": "two"}'),
      (%12$L, %5$L, 'post', %9$L, '{"body": "three"}'), (%13$L, %5$L, 'post', %9$L, '{"body": "four"}');
    insert into wallets (account, balance) values (%2$L, 500), (%3$L, 500), (%1$L, 500);
    insert into card_ledger (account, card, kind, price) values (%2$L, 'parcut', 'bought', 0), (%2$L, 'parcut', 'bought', 0), (%2$L, 'parcut', 'bought', 0), (%2$L, 'parcut', 'bought', 0), (%3$L, 'parcut', 'bought', 0), (%1$L, 'parmove', 'bought', 0);
    do $e$ begin perform set_card(%1$L, 'parmove', %5$L, %13$L, '{"phrase": "par phrase"}', 0, null, 'par phrase'); end $e$;
  $sql$, ann, bob, cal, dee, a, b, c, d, t, p1, p2, p3, p4));
  select count(*) into posts_before from acts where thread = t and kind = 'post';

  -- Two cutters on one parent at once: one reply between them, and the other is refused by the stack in its words.
  said := tests.race_service(
    format('select play_card(%L, %L, %L, %L, %L, 0, %L, reply => %L)', bob, 'parcut', b, p1, '{}', '', 'Bob cuts.'),
    format('select play_card(%L, %L, %L, %L, %L, 0, %L, reply => %L)', cal, 'parcut', c, p1, '{}', '', 'Cal cuts.'));
  if (said[1] is null) = (said[2] is null) or coalesce(said[1], said[2]) is distinct from 'this post already carries that card' then raise exception 'two cutters on one parent: %', said; end if;
  if (select count(*) from post_under where parent = p1) is distinct from 1 or (select count(*) from acts where thread = t and kind = 'post') is distinct from posts_before + 1
     or (select count(*) from acts where kind = 'card' and target_act_id = p1 and payload ->> 'card' = 'parcut') is distinct from 1 then
    raise exception 'two cutters at once wrote % replies', (select count(*) from post_under where parent = p1);
  end if;

  -- A play racing a quote of its parent by another mask: the quote and the cut each finish, neither is the victim of a deadlock.
  said := tests.race_as(dee, format('select post(%L, %L, %L, %L)', t, d, 'Quoting two.', p2), null,
    format('select play_card(%L, %L, %L, %L, %L, 0, %L, reply => %L)', bob, 'parcut', b, p2, '{}', '', 'Bob cuts in.'));
  if said[1] is not null or said[2] is not null then raise exception 'a play racing a quote of its parent: %', said; end if;
  if (select count(*) from post_under where parent = p2) is distinct from 1 then raise exception 'the play beside a quote wrote its reply'; end if;

  -- A play racing an edit of its parent.
  said := tests.race_as(ann, format('select edit_post(%L, %L, %L)', p3, a, 'Three, edited.'), null,
    format('select play_card(%L, %L, %L, %L, %L, 0, %L, reply => %L)', bob, 'parcut', b, p3, '{}', '', 'Bob cuts on an edit.'));
  if said[1] is not null or said[2] is not null then raise exception 'a play racing an edit of its parent: %', said; end if;
  if (select count(*) from post_under where parent = p3) is distinct from 1 then raise exception 'the play beside an edit wrote its reply'; end if;

  -- A play racing the spring of a Move set on its parent: a quote with the phrase springs it while the play takes the parent's backs and the thread.
  said := tests.race_as(dee, format('select post(%L, %L, %L, %L)', t, d, 'Quoting four: par phrase.', p4), null,
    format('select play_card(%L, %L, %L, %L, %L, 0, %L, reply => %L)', bob, 'parcut', b, p4, '{}', '', 'Bob cuts a back.'));
  if said[1] is not null or said[2] is not null then raise exception 'a play racing a spring on its parent: %', said; end if;
  if (select count(*) from post_under where parent = p4) is distinct from 1 or (select count(*) from acts where kind = 'spring' and target_act_id = p4) is distinct from 1 then
    raise exception 'the play beside a spring wrote its reply, and the Move sprang once: % %', (select count(*) from post_under where parent = p4), (select count(*) from acts where kind = 'spring' and target_act_id = p4);
  end if;
end $$;

-- A play and a post of the same character at once, held deterministically. A post takes the thread's row (step 4) and then the poster's count row (step 5), and a play's card insert
-- also takes its caster's count row, so a play that inserted its card before it took the thread's row would hold 5 and wait for 4 while the post held 4 and waited for 5. Another
-- connection holds the thread's row as a post does; the play is started and must come to wait; the holder then takes the caster's count row and commits, and both must finish. With
-- the locks taken the other way round the play holds the count row while it waits, the holder's statement waits for it, and Postgres ends one of the two with a deadlock.
do $$
declare
  ann uuid := gen_random_uuid(); bob uuid := gen_random_uuid(); a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  t uuid := gen_random_uuid(); p uuid := gen_random_uuid(); p0 uuid := gen_random_uuid();
  url text := current_setting('kayfabb.scratch_url');
  waiting integer; tries integer := 0; said text;
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'par-hann@test.invalid'), (%2$L, 'par-hbob@test.invalid');
    insert into accounts (id) values (%1$L), (%2$L);
    insert into characters (id, owner, name, debuted_at) values (%3$L, %1$L, 'Par Hold Ann', now()), (%4$L, %2$L, 'Par Hold Bob', now());
    insert into class_history (character, class_key) values (%3$L, 'alpha'), (%4$L, 'alpha');
    insert into threads (id, board, title) select %5$L, b.id, 'Par hold thread' from boards b where b.slug = 'general';
    insert into acts (id, character, kind, thread, payload) values (%6$L, %3$L, 'post', %5$L, '{"body": "parent"}'), (%7$L, %4$L, 'post', %5$L, '{"body": "bob already posted"}');
    insert into wallets (account, balance) values (%2$L, 500);
    insert into card_ledger (account, card, kind, price) values (%2$L, 'parcut', 'bought', 0);
  $sql$, ann, bob, a, b, t, p, p0));

  perform extensions.dblink_connect('holder', url);
  perform extensions.dblink_exec('holder', 'begin');
  perform * from extensions.dblink('holder', format('select 1 from threads where id = %L for no key update', t)) as r(x integer);
  perform extensions.dblink_connect('player', url);
  perform extensions.dblink_send_query('player', format('select tests.raced(null, %L)',
    format('select play_card(%L, %L, %L, %L, %L, 0, %L, reply => %L)', bob, 'parcut', b, p, '{}', '', 'Bob cuts while Bob posts.')));
  loop
    select count(*) into waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%play_card%' and query like '%tests.raced%';
    exit when waiting >= 1;
    tries := tries + 1;
    if tries > 80 then
      perform extensions.dblink_exec('holder', 'rollback');
      raise exception 'a play on a post whose thread another post holds never waited: the play does not take the thread''s row';
    end if;
    perform pg_sleep(0.025);
  end loop;
  -- The holder is a post of the caster's own mask: step 5 after step 4. It must get the count row the play has not taken.
  perform * from extensions.dblink('holder', format('select 1 from character_post_counts where character = %L for update', b)) as r(x integer);
  perform extensions.dblink_exec('holder', 'commit');
  select r.said into said from extensions.dblink_get_result('player') as r(said text);
  perform * from extensions.dblink_get_result('player') as r(said text);
  perform extensions.dblink_disconnect('player');
  perform extensions.dblink_disconnect('holder');
  if said is not null then raise exception 'the play beside a post of the same mask said %', said; end if;
  if (select count(*) from post_under where parent = p) is distinct from 1 then raise exception 'the play wrote its reply once the post had gone'; end if;
end $$;
