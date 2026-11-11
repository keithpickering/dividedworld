-- grant_aura (supabase/migrations/0146_aura_grant.sql; design docs/plans/2026-11-08-aura-grant-design.md, section 2):
-- an exact amount or a fill, through wallet_move, refused to every signed-in caller.

update settings set value = '1000' where key = 'walletCap';

-- ---- A fill from nothing reaches the cap, in one grant event ----
do $$
declare ann uuid := tests.account('g-fill'); r jsonb; ev record;
begin
  perform tests.become_service();
  r := grant_aura(ann);
  perform tests.unbecome();
  if r is distinct from '{"granted": 1000, "overflow": 0, "balance": 1000}'::jsonb then raise exception 'a fill from nothing returned %', r; end if;
  if (select balance from wallets where account = ann) is distinct from 1000 then raise exception 'the fill should reach the cap'; end if;
  if (select count(*) from wallet_events where account = ann) is distinct from 1 then raise exception 'a fill writes one event'; end if;
  select * into ev from wallet_events where account = ann;
  if ev.kind is distinct from 'grant' or ev.change is distinct from 1000 or ev.overflow is distinct from 0 or ev.settlement is not null or ev.ref is not null then
    raise exception 'the grant event is wrong: %', to_jsonb(ev);
  end if;
end $$;

-- ---- An amount under the headroom credits exactly that ----
do $$
declare ann uuid := tests.account('g-exact'); r jsonb;
begin
  perform tests.become_service();
  r := grant_aura(ann, 350);
  perform tests.unbecome();
  if r is distinct from '{"granted": 350, "overflow": 0, "balance": 350}'::jsonb then raise exception 'an exact grant returned %', r; end if;
  if (select balance from wallets where account = ann) is distinct from 350 then raise exception 'the balance should be 350'; end if;
end $$;

-- ---- An amount past the headroom stops at the cap and records the rest ----
do $$
declare ann uuid := tests.account('g-over'); r jsonb;
begin
  perform tests.become_service();
  perform grant_aura(ann, 900);
  r := grant_aura(ann, 300);
  perform tests.unbecome();
  if r is distinct from '{"granted": 100, "overflow": 200, "balance": 1000}'::jsonb then raise exception 'a grant past the cap returned %', r; end if;
  if (select overflow from wallet_events where account = ann order by id desc limit 1) is distinct from 200 then raise exception 'the event should record the overflow'; end if;
end $$;

-- ---- A full wallet takes nothing, and writes nothing ----
do $$
declare ann uuid := tests.account('g-full'); r jsonb;
begin
  perform tests.become_service();
  perform grant_aura(ann);
  r := grant_aura(ann);
  if r is distinct from '{"granted": 0, "overflow": 0, "balance": 1000}'::jsonb then raise exception 'a fill on a full wallet returned %', r; end if;
  r := grant_aura(ann, 50);
  perform tests.unbecome();
  if r is distinct from '{"granted": 0, "overflow": 50, "balance": 1000}'::jsonb then raise exception 'an amount on a full wallet returned %', r; end if;
  if (select count(*) from wallet_events where account = ann) is distinct from 1 then raise exception 'a grant that moves nothing writes no row'; end if;
end $$;

-- ---- A wallet above a lowered cap is left alone ----
do $$
declare ann uuid := tests.account('g-lowered'); r jsonb;
begin
  perform tests.become_service();
  perform grant_aura(ann);
  update settings set value = '600' where key = 'walletCap';
  r := grant_aura(ann, 100);
  perform tests.unbecome();
  update settings set value = '1000' where key = 'walletCap';
  if (r ->> 'granted')::integer is distinct from 0 then raise exception 'a wallet above the cap was granted %', r; end if;
  if (select balance from wallets where account = ann) is distinct from 1000 then raise exception 'the balance should be unchanged'; end if;
  if (select count(*) from wallet_events where account = ann) is distinct from 1 then raise exception 'no row for a grant that moved nothing'; end if;
end $$;

-- ---- Zero, a negative amount and an unknown account are refused, writing nothing ----
do $$
declare ann uuid := tests.account('g-refused'); code text;
begin
  perform tests.become_service();
  begin perform grant_aura(ann, 0); exception when others then code := sqlstate; end;
  if code is distinct from '22023' then raise exception 'zero was not refused: %', code; end if;
  code := null;
  begin perform grant_aura(ann, -5); exception when others then code := sqlstate; end;
  if code is distinct from '22023' then raise exception 'a negative amount was not refused: %', code; end if;
  code := null;
  begin perform grant_aura(gen_random_uuid(), 5); exception when others then code := sqlstate; end;
  if code is distinct from '22023' then raise exception 'an unknown account was not refused: %', code; end if;
  code := null;
  begin perform grant_aura(null, 5); exception when others then code := sqlstate; end;
  if code is distinct from '22023' then raise exception 'a null account was not refused: %', code; end if;
  perform tests.unbecome();
  if exists (select 1 from wallet_events where account = ann) or exists (select 1 from wallets where account = ann) then raise exception 'a refusal wrote something'; end if;
end $$;

-- ---- A fraction does not resolve ----
do $$
declare ann uuid := tests.account('g-fraction'); missing boolean := false;
begin
  perform tests.become_service();
  begin perform grant_aura(ann, 1.5);
  exception when undefined_function then missing := true; end;
  perform tests.unbecome();
  if not missing then raise exception 'a fractional amount should not resolve'; end if;
end $$;

-- ---- A signed-in caller, an admin included, is refused ----
do $$
declare ann uuid := tests.account('g-player'); boss uuid := tests.account('g-admin'); denied boolean;
begin
  insert into admins (account) values (boss);
  denied := false;
  perform tests.become(ann);
  begin perform grant_aura(ann, 100); exception when insufficient_privilege then denied := true; end;
  perform tests.unbecome();
  if not denied then raise exception 'a player should not call grant_aura'; end if;
  denied := false;
  perform tests.become(boss);
  begin perform grant_aura(boss); exception when insufficient_privilege then denied := true; end;
  perform tests.unbecome();
  if not denied then raise exception 'an admin should not call grant_aura'; end if;
  if exists (select 1 from wallet_events where account in (ann, boss)) then raise exception 'a refused call wrote something'; end if;
end $$;

-- ---- A wallet's history, settlements, purchases and grants, adds up to its balance ----
do $$
declare
  ann uuid := tests.account('g-sum');
  a uuid := tests.character(ann, 'Summed');
  w1 timestamptz := coalesce((select max(ends_at) from settlements), '2030-01-01T00:00:00Z');
  w2 timestamptz := w1 + interval '1 day';
  w3 timestamptz := w1 + interval '2 days';
begin
  perform apply_settlement(w1, w2, jsonb_build_array(jsonb_build_object('player', ann, 'character', a, 'reason', 'alpha.cheered', 'amount', 400)));
  perform tests.become_service();
  perform grant_aura(ann, 250);
  perform buy_card(ann, tests.slot('splat'), 100);
  perform grant_aura(ann);
  perform tests.unbecome();
  perform apply_settlement(w2, w3, jsonb_build_array(jsonb_build_object('player', ann, 'character', a, 'reason', 'alpha.groaned', 'amount', -300)));
  if (select count(*) from wallet_events where account = ann and kind = 'grant') is distinct from 2 then raise exception 'two grants expected'; end if;
  if (select sum(change) from wallet_events where account = ann) is distinct from (select balance from wallets where account = ann) then
    raise exception 'the wallet''s history does not add up to its balance';
  end if;
end $$;

-- ---- The kind check still refuses a made-up kind ----
do $$
declare ann uuid := tests.account('g-kind'); refused boolean := false;
begin
  insert into wallets (account) values (ann);
  begin
    insert into wallet_events (account, kind, change, overflow, floored, balance_after) values (ann, 'gift', 0, 0, 0, 0);
  exception when check_violation then refused := true; end;
  if not refused then raise exception 'a made-up kind was accepted'; end if;
end $$;
