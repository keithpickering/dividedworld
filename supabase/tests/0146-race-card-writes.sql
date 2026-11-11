-- The concurrent cases of a card that writes (supabase/migrations/0148_card_writes.sql): a refund is paid once for a play however many
-- finishes and refunds land at once, and a job is claimed once however many claims land at once. The rows are committed (tests.commit),
-- since a racer is a session of its own; every name is this file's, so no other file reads them. In a file that sorts after
-- 0146-card-writes.sql, whose claims would otherwise take these jobs too.

do $$
declare
  ann uuid := gen_random_uuid(); bob uuid := gen_random_uuid();
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  t uuid := gen_random_uuid(); p uuid := gen_random_uuid();
  play1 uuid := gen_random_uuid(); play2 uuid := gen_random_uuid();
  p2 uuid := gen_random_uuid(); p3 uuid := gen_random_uuid(); play3 uuid := gen_random_uuid(); play4 uuid := gen_random_uuid();
  said text[];
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'cwr-ann@test.invalid'), (%2$L, 'cwr-bob@test.invalid');
    insert into accounts (id) values (%1$L), (%2$L);
    insert into characters (id, owner, name, debuted_at) values (%3$L, %1$L, 'Cwr Caster', now()), (%4$L, %2$L, 'Cwr Author', now());
    insert into class_history (character, class_key) values (%3$L, 'alpha'), (%4$L, 'alpha');
    insert into card_kinds (key, name, alignment, rarity, play, stack, writes) values ('cwr-scribe', 'Race Scribe', 'salty', 'uncommon', 'cast', 3, true);
    insert into threads (id, board, title) select %5$L, b.id, 'Race thread' from boards b where b.slug = 'general';
    insert into acts (id, character, kind, thread, payload) values (%6$L, %4$L, 'post', %5$L, '{"body": "a"}'), (%7$L, %4$L, 'post', %5$L, '{"body": "b"}'), (%8$L, %4$L, 'post', %5$L, '{"body": "c"}');
    insert into wallets (account, balance) values (%1$L, 500);
    insert into acts (id, character, kind, thread, payload, target_act_id) values
      (%9$L, %3$L, 'card', %5$L, '{"card": "cwr-scribe", "message": "", "config": {}, "layer": 1}', %6$L),
      (%10$L, %3$L, 'card', %5$L, '{"card": "cwr-scribe", "message": "", "config": {}, "layer": 1}', %7$L),
      (%11$L, %3$L, 'card', %5$L, '{"card": "cwr-scribe", "message": "", "config": {}, "layer": 1}', %8$L);
    -- The second play of p3 is later than the first, so the chain's order is not a tie of one transaction's clock.
    insert into acts (id, character, kind, thread, payload, target_act_id, created_at) values
      (%12$L, %3$L, 'card', %5$L, '{"card": "cwr-scribe", "message": "", "config": {}, "layer": 2}', %8$L, now() + interval '1 minute');
    insert into wallet_events (account, kind, change, balance_after, ref) values (%1$L, 'play', -40, 460, %9$L), (%1$L, 'play', -40, 420, %10$L);
    insert into card_ledger (account, card, kind, act, price) values (%1$L, 'cwr-scribe', 'played', %9$L, 40), (%1$L, 'cwr-scribe', 'played', %10$L, 40);
  $sql$, ann, bob, a, b, t, p, p2, p3, play1, play2, play3, play4));

  -- Two finishes of one failed version at once, and a finish and a refund at once: each play is paid back once.
  said := tests.race_service(format('select finish_card_write(%L, %L, null, %L, null)', play1, p, 'unreachable'), format('select finish_card_write(%L, %L, null, %L, null)', play1, p, 'unreachable'));
  if said[1] is not null or said[2] is not null then raise exception 'two finishes at once: %', said; end if;
  if (select count(*) from wallet_events w where w.kind = 'refund' and w.ref = play1) is distinct from 1 or (select count(*) from card_ledger l where l.kind = 'returned' and l.act = play1) is distinct from 1
     or (select count(*) from card_write_refunds r where r.play = play1) is distinct from 1 then
    raise exception 'two finishes at once paid % refund(s)', (select count(*) from wallet_events w where w.kind = 'refund' and w.ref = play1);
  end if;
  said := tests.race_service(format('select finish_card_write(%L, %L, null, %L, null)', play2, p2, 'unreachable'), format('select refund_card_write(%L)', play2));
  if said[1] is not null or said[2] is not null then raise exception 'a finish and a refund at once: %', said; end if;
  if (select count(*) from wallet_events w where w.kind = 'refund' and w.ref = play2) is distinct from 1 or (select count(*) from card_ledger l where l.kind = 'returned' and l.act = play2) is distinct from 1 then
    raise exception 'a finish and a refund at once paid % refund(s)', (select count(*) from wallet_events w where w.kind = 'refund' and w.ref = play2);
  end if;

  -- Two claims at once take each job once (the post p3 holds two plays, so its second waits behind its first).
  said := tests.race_service('select claim_card_writes(10)', 'select claim_card_writes(10)');
  if said[1] is not null or said[2] is not null then raise exception 'two claims at once: %', said; end if;
  if (select w.attempts from card_writes w where w.play = play3) is distinct from 1 or (select w.attempts from card_writes w where w.play = play4) is distinct from 0 then
    raise exception 'two claims at once took a job twice, or took one the chain holds: %', (select jsonb_agg(to_jsonb(w)) from card_writes w where w.post = p3);
  end if;
end $$;

-- A failing finish and an admin's end of the same play at once: reverse_card holds the play's Act row (for no key update) from its first read to its
-- commit, so refund_card_write must wait on that row, and once the end has landed it sees it and refunds nothing ("an admin-ended play gets no
-- refund"). Deterministic, not a race of two statements: another connection holds the row as reverse_card does, the refund is started, and
-- it must come to wait; the holder then writes the end and commits, and the refund must have moved nothing. Without the row lock the refund
-- never waits, pays, and the play ends up with both a card_end and a refund.
do $$
declare
  ann uuid := gen_random_uuid(); a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  t uuid := gen_random_uuid(); p uuid := gen_random_uuid(); play5 uuid := gen_random_uuid();
  url text := current_setting('kayfabb.scratch_url');
  waiting integer; tries integer := 0; said text; answered jsonb;
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'cwr-end@test.invalid');
    insert into accounts (id) values (%1$L);
    insert into characters (id, owner, name, debuted_at) values (%2$L, %1$L, 'Cwr End Caster', now()), (%3$L, %1$L, 'Cwr End Author', now());
    insert into class_history (character, class_key) values (%2$L, 'alpha'), (%3$L, 'alpha');
    insert into threads (id, board, title) select %4$L, b.id, 'Race end thread' from boards b where b.slug = 'general';
    insert into acts (id, character, kind, thread, payload) values (%5$L, %3$L, 'post', %4$L, '{"body": "a"}');
    insert into wallets (account, balance) values (%1$L, 500);
    insert into acts (id, character, kind, thread, payload, target_act_id) values
      (%6$L, %2$L, 'card', %4$L, '{"card": "cwr-scribe", "message": "", "config": {}, "layer": 1}', %5$L);
    insert into wallet_events (account, kind, change, balance_after, ref) values (%1$L, 'play', -40, 460, %6$L);
    insert into card_ledger (account, card, kind, act, price) values (%1$L, 'cwr-scribe', 'played', %6$L, 40);
  $sql$, ann, a, b, t, p, play5));

  perform extensions.dblink_connect('holder', url);
  perform extensions.dblink_exec('holder', 'begin');
  perform * from extensions.dblink('holder', format('select 1 from acts where id = %L and kind = %L for no key update', play5, 'card')) as r(x integer);
  perform extensions.dblink_connect('player', url);
  perform extensions.dblink_send_query('player', format('select tests.raced(null, %L)', format('select refund_card_write(%L)', play5)));
  loop
    select count(*) into waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%refund_card_write%' and query like '%tests.raced%';
    exit when waiting >= 1;
    tries := tries + 1;
    if tries > 80 then
      perform extensions.dblink_exec('holder', 'rollback');
      raise exception 'a refund of a play whose Act an admin holds never waited: the two do not exclude each other';
    end if;
    perform pg_sleep(0.025);
  end loop;
  perform extensions.dblink_exec('holder', format($e$
    select set_config('kayfabb.card_end_writer', 'on', true);
    insert into acts (character, kind, thread, target_act_id, payload) values (null, 'card_end', %L, %L, '{"why": "reversed", "by": "admin"}');
    commit
  $e$, t, play5));
  select r.said into said from extensions.dblink_get_result('player') as r(said text);
  perform * from extensions.dblink_get_result('player') as r(said text);
  perform extensions.dblink_disconnect('player');
  perform extensions.dblink_disconnect('holder');
  if said is not null then raise exception 'the refund after an admin''s end said %', said; end if;
  if exists (select 1 from wallet_events w where w.kind = 'refund' and w.ref = play5) or exists (select 1 from card_write_refunds r where r.play = play5)
     or exists (select 1 from card_ledger l where l.kind = 'returned' and l.act = play5) then
    raise exception 'an admin-ended play was refunded';
  end if;
end $$;
