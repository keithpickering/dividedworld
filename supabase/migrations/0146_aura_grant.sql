-- grant_aura: the owner's way to give a player Aura while the game is tested, from the SQL editor
-- (docs/plans/2026-11-08-aura-grant-design.md, section 2). An exact amount, or a fill to the
-- wallet's cap when no amount is given, credited through wallet_move so the cap clamps it and the
-- event records what did not fit. Service role only; no signed-in caller, admin included, reaches it.
-- A grant that would move nothing writes no row. The event's kind is 'grant', added to the check.

alter table wallet_events drop constraint wallet_events_kind_check;
alter table wallet_events add constraint wallet_events_kind_check check (kind in ('settlement', 'purchase', 'play', 'trap', 'trapSystem', 'report', 'refund', 'bribe', 'appeal', 'grant'));

create function grant_aura(account uuid, amount integer default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cap integer := (setting('walletCap'))::integer;
  was integer;
  now_is integer;
  ev record;
begin
  if grant_aura.account is null or not exists (select 1 from accounts a where a.id = grant_aura.account) then
    raise exception 'no account %', coalesce(grant_aura.account::text, 'null') using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if grant_aura.amount is not null and grant_aura.amount < 1 then
    raise exception 'a grant is at least 1 hundredth of Aura, not %', grant_aura.amount using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  insert into wallets (account) values (grant_aura.account) on conflict do nothing;
  select w.balance into was from wallets w where w.account = grant_aura.account for update;
  if was >= cap then
    return jsonb_build_object('granted', 0, 'overflow', coalesce(grant_aura.amount, 0), 'balance', was);
  end if;
  now_is := wallet_move(grant_aura.account, coalesce(grant_aura.amount, cap - was), 'grant', null, null);
  select e.change, e.overflow into ev from wallet_events e where e.account = grant_aura.account order by e.id desc limit 1;
  return jsonb_build_object('granted', ev.change, 'overflow', ev.overflow, 'balance', now_is);
end $$;

revoke execute on function grant_aura(uuid, integer) from public, anon, authenticated;
grant execute on function grant_aura(uuid, integer) to service_role;
