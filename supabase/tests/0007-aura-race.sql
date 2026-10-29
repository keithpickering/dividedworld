-- Two settlement runs at once write the window once (apply_settlement,
-- supabase/migrations/0003_aura.sql). In a file of its own: an earlier apply_settlement in the
-- same transaction would hold the settlement lock the two racing sessions wait on.
do $$
declare
  ann uuid := gen_random_uuid();
  a uuid := gen_random_uuid();
  said text[];
  call text;
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'twice@test.invalid');
    insert into accounts (id) values (%1$L);
    insert into characters (id, owner, name, debuted_at) values (%2$L, %1$L, 'Twice', now());
    insert into class_history (character, class_key) values (%2$L, 'alpha');
  $sql$, ann, a));
  call := format($sql$select apply_settlement('2027-01-01T00:00:00Z', '2027-01-02T00:00:00Z', %L)$sql$,
    jsonb_build_array(jsonb_build_object('player', ann, 'character', a, 'reason', 'alpha.cheered', 'amount', 40))::text);
  said := tests.race_service(call, call);
  if (select count(*) from settlements where starts_at = '2027-01-01T00:00:00Z') is distinct from 1 then raise exception 'two runs at once: % settlements (%)', (select count(*) from settlements where starts_at = '2027-01-01T00:00:00Z'), said; end if;
  if (select balance from wallets where account = ann) is distinct from 40 then raise exception 'two runs at once credited % (%)', (select balance from wallets where account = ann), said; end if;
  if said[1] is not null or said[2] is not null then raise exception 'one of two runs at once failed rather than finding the window settled: %', said; end if;
end $$;
