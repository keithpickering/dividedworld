-- Each settled entry's shares, written by the settlement beside its ledger rows and read by their
-- player alone (supabase/migrations/0034_ledger_shares.sql). The log shares plan, Task 2.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- ---- A window applied with shares writes them, read back by their player alone ----
do $$
declare
  ann uuid := tests.account('ls-ann');
  bob uuid := tests.account('ls-bob');
  a uuid := tests.character(ann, 'Ls Ann');
  b uuid := tests.character(bob, 'Ls Bob');
  t uuid := tests.thread();
  p1 uuid := tests.post(a, t, 'One.');
  p2 uuid := tests.post(a, t, 'Two.');
  q uuid := tests.post(b, t, 'Three.');
  w1 timestamptz := coalesce((select max(ends_at) from settlements), '2030-01-01T00:00:00Z');
  w2 timestamptz := w1 + interval '1 day';
  said jsonb;
  changed text;
  r record;
begin
  said := apply_settlement(w1, w2, jsonb_build_array(
      jsonb_build_object('player', ann, 'character', a, 'reason', 'alpha.cheered', 'amount', 20),
      jsonb_build_object('player', ann, 'character', a, 'reason', 'alpha.groaned', 'amount', -5),
      jsonb_build_object('player', bob, 'character', b, 'reason', 'alpha.cheered', 'amount', 7)),
    '{"alpha": 22}', '[]',
    jsonb_build_array(
      jsonb_build_object('character', a, 'reason', 'alpha.cheered', 'act', p1, 'quadrant', 'excitedPositive', 'amount', 13),
      jsonb_build_object('character', a, 'reason', 'alpha.cheered', 'act', p2, 'quadrant', 'excitedPositive', 'amount', 7),
      jsonb_build_object('character', a, 'reason', 'alpha.groaned', 'act', p1, 'quadrant', 'boredNegative', 'amount', -5),
      jsonb_build_object('character', b, 'reason', 'alpha.cheered', 'act', q, 'amount', 7)));
  if not (said ->> 'applied')::boolean then raise exception 'the window with shares should apply: %', said; end if;
  if (select count(*) from ledger_shares sh join ledger l on l.id = sh.ledger join settlements s on s.id = l.settlement where s.starts_at = w1) is distinct from 4::bigint then
    raise exception 'four shares were sent, % written', (select count(*) from ledger_shares);
  end if;

  perform tests.become(ann);
  if (select count(*) from my_ledger_shares) is distinct from 3::bigint then raise exception 'Ann reads her three shares, read %', (select count(*) from my_ledger_shares); end if;
  if (select sum(amount) from my_ledger_shares where reason = 'alpha.cheered') is distinct from 20::bigint
     or (select amount from my_ledger_shares where reason = 'alpha.groaned') is distinct from -5
     or (select (act, quadrant) from my_ledger_shares where reason = 'alpha.cheered' and amount = 13) is distinct from (p1, 'excitedPositive'::text)
     or exists (select 1 from my_ledger_shares where character <> a or settlement is distinct from (select id from settlements where starts_at = w1)) then
    raise exception 'Ann''s shares read back as sent: %', (select jsonb_agg(to_jsonb(x)) from my_ledger_shares x);
  end if;
  perform tests.unbecome();

  -- A second account reads its own share, and none of Ann's.
  perform tests.become(bob);
  select * into r from my_ledger_shares;
  if (select count(*) from my_ledger_shares) is distinct from 1::bigint or r.act is distinct from q or r.quadrant is not null or r.amount is distinct from 7 then
    raise exception 'Bob reads his one share, with no quadrant: %', to_jsonb(r);
  end if;
  perform tests.unbecome();

  -- The columns are exactly these: never the account, the share's id or the ledger row's.
  if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'my_ledger_shares')
       is distinct from array['settlement', 'character', 'reason', 'act', 'quadrant', 'amount'] then
    raise exception 'my_ledger_shares shows more or less than it should';
  end if;

  -- A retried window writes no share twice.
  said := apply_settlement(w1, w2, jsonb_build_array(jsonb_build_object('player', ann, 'character', a, 'reason', 'alpha.cheered', 'amount', 20)), '{}', '[]',
    jsonb_build_array(jsonb_build_object('character', a, 'reason', 'alpha.cheered', 'act', p1, 'quadrant', 'excitedPositive', 'amount', 20)));
  if (said ->> 'applied')::boolean then raise exception 'a window was applied twice'; end if;
  if (select count(*) from ledger_shares sh join ledger l on l.id = sh.ledger join settlements s on s.id = l.settlement where s.starts_at = w1) is distinct from 4::bigint then
    raise exception 'a retried window wrote a share';
  end if;

  -- Append-only: no update, delete or truncate.
  if coalesce(pg_temp.refusal('update ledger_shares set amount = 1'), '') not like 'a ledger row is never edited or removed%'
     or coalesce(pg_temp.refusal('delete from ledger_shares'), '') not like 'a ledger row is never edited or removed%'
     or coalesce(pg_temp.refusal('truncate ledger_shares'), '') not like 'a ledger row is never edited or removed%' then
    raise exception 'a share was changed: %, %, %', pg_temp.refusal('update ledger_shares set amount = 1'), pg_temp.refusal('delete from ledger_shares'), pg_temp.refusal('truncate ledger_shares');
  end if;
  -- Not even in replica mode, as a restore with triggers disabled runs.
  perform set_config('session_replication_role', 'replica', true);
  changed := coalesce(pg_temp.refusal('delete from ledger_shares'), '') || ' / ' || coalesce(pg_temp.refusal('truncate ledger_shares'), '');
  perform set_config('session_replication_role', 'origin', true);
  if changed not like 'a ledger row is never edited or removed% / a ledger row is never edited or removed%' then raise exception 'a share was changed in replica mode: %', changed; end if;
end $$;

-- ---- Each refusal, by its words, and nothing written ----
do $$
declare
  ann uuid := tests.account('lr-ann');
  a uuid := tests.character(ann, 'Lr Ann');
  t uuid := tests.thread();
  p uuid := tests.post(a, t, 'One.');
  w1 timestamptz := coalesce((select max(ends_at) from settlements), '2030-01-01T00:00:00Z');
  w2 timestamptz := w1 + interval '1 day';
  entries jsonb := jsonb_build_array(jsonb_build_object('player', ann, 'character', a, 'reason', 'alpha.cheered', 'amount', 10));
  share jsonb := jsonb_build_object('character', a, 'reason', 'alpha.cheered', 'act', p, 'quadrant', 'excitedPositive', 'amount', 10);
  c record;
  said text;
begin
  for c in select * from (values
    ('not a list', '{}'::jsonb, 'shares are a list'),
    ('no entry of this call', jsonb_build_array(share || jsonb_build_object('reason', 'alpha.groaned')), 'a share names no entry of this call'),
    ('another character', jsonb_build_array(share || jsonb_build_object('character', tests.character(ann, 'Lr Other'))), 'a share names no entry of this call'),
    ('no such Act', jsonb_build_array(share || jsonb_build_object('act', gen_random_uuid())), 'a share names an Act that does not exist'),
    ('not an Act''s id', jsonb_build_array(share || jsonb_build_object('act', 'p1')), 'a share names an Act that does not exist'),
    ('a fifth quadrant', jsonb_build_array(share || jsonb_build_object('quadrant', 'sideways')), 'a share''s quadrant is none of the four'),
    ('a fraction', jsonb_build_array(share || jsonb_build_object('amount', 9.5), share || jsonb_build_object('quadrant', 'calmPositive', 'amount', 0.5)), 'a share''s amount is whole hundredths, never 0'),
    ('a zero', jsonb_build_array(share, share || jsonb_build_object('quadrant', 'calmPositive', 'amount', 0)), 'a share''s amount is whole hundredths, never 0'),
    ('a string', jsonb_build_array(share || jsonb_build_object('amount', '10')), 'a share''s amount is whole hundredths, never 0'),
    ('one post twice', jsonb_build_array(share || jsonb_build_object('amount', 5), share || jsonb_build_object('amount', 5)), 'two shares name one entry''s Act and quadrant'),
    ('one post twice, in capitals', jsonb_build_array(share || jsonb_build_object('amount', 5), share || jsonb_build_object('act', upper(p::text), 'amount', 5)), 'two shares name one entry''s Act and quadrant'),
    ('not an object', jsonb_build_array(share, '"a share"'::jsonb), 'a share names no entry of this call'),
    ('short of the entry', jsonb_build_array(share || jsonb_build_object('amount', 9)), 'an entry''s shares add up to it'))
    as v(what, shares, words)
  loop
    said := pg_temp.refusal(format('select apply_settlement(%L, %L, %L, %L, %L, %L)', w1, w2, entries, '{}', '[]', c.shares));
    if said is null or said not like c.words || '%' then raise exception '% should be refused with "%", said %', c.what, c.words, coalesce(said, 'nothing'); end if;
  end loop;
  -- Two entries for one character and reason are refused by their words, not by the ledger's index.
  said := pg_temp.refusal(format('select apply_settlement(%L, %L, %L)', w1, w2, entries || entries));
  if said is null or said not like 'two entries name one character and reason%' then raise exception 'two entries for one reason should be refused by their words, said %', coalesce(said, 'nothing'); end if;
  if exists (select 1 from settlements where starts_at = w1) then raise exception 'a refused window was written'; end if;

  -- The refusals are invalid_parameter_value (22023).
  begin
    perform apply_settlement(w1, w2, entries, '{}', '[]', jsonb_build_array(share || jsonb_build_object('amount', 9)));
    raise exception 'a short share was applied';
  exception when invalid_parameter_value then null;
  end;

  -- A settlement applied without shares, as every one before 0034 was, still applies, and an entry with none is allowed beside one with them.
  if not (apply_settlement(w1, w2, entries) ->> 'applied')::boolean then raise exception 'a settlement without shares should apply'; end if;
  if exists (select 1 from ledger_shares sh join ledger l on l.id = sh.ledger where l.account = ann) then raise exception 'a share appeared from nowhere'; end if;
  if not (apply_settlement(w2, w2 + interval '1 day', entries || jsonb_build_array(jsonb_build_object('player', ann, 'character', a, 'reason', 'alpha.groaned', 'amount', -3)),
                           '{}', '[]', jsonb_build_array(share || jsonb_build_object('quadrant', null))) ->> 'applied')::boolean then
    raise exception 'an entry with no shares beside one with them should apply';
  end if;
  if (select quadrant from ledger_shares sh join ledger l on l.id = sh.ledger where l.account = ann) is not null then raise exception 'a share with a null quadrant is written with none'; end if;
end $$;

-- ---- The five-argument apply_settlement is gone, and the new one is the service role's alone ----
do $$
begin
  if to_regprocedure('apply_settlement(timestamptz, timestamptz, jsonb, jsonb, jsonb)') is not null then
    raise exception 'the five-argument apply_settlement still exists';
  end if;
  if to_regprocedure('apply_settlement(timestamptz, timestamptz, jsonb, jsonb, jsonb, jsonb)') is null then raise exception 'the six-argument apply_settlement is missing'; end if;
  if not has_function_privilege('service_role', 'apply_settlement(timestamptz, timestamptz, jsonb, jsonb, jsonb, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'apply_settlement(timestamptz, timestamptz, jsonb, jsonb, jsonb, jsonb)', 'execute')
     or has_function_privilege('anon', 'apply_settlement(timestamptz, timestamptz, jsonb, jsonb, jsonb, jsonb)', 'execute') then
    raise exception 'apply_settlement is the service role''s alone';
  end if;
  if has_table_privilege('authenticated', 'ledger_shares', 'select') or has_table_privilege('anon', 'ledger_shares', 'select') then
    raise exception 'ledger_shares is read through my_ledger_shares alone';
  end if;
end $$;

-- ---- A signed-out visitor reads nothing ----
do $$
begin
  perform tests.become_anon();
  if pg_temp.refusal('select * from my_ledger_shares') is distinct from 'permission denied for view my_ledger_shares' then
    raise exception 'my_ledger_shares was readable signed out: %', pg_temp.refusal('select * from my_ledger_shares');
  end if;
  perform tests.unbecome();
end $$;
