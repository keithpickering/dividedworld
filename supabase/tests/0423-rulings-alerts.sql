-- Rulings and missing alerts (supabase/migrations/0423_rulings_alerts.sql; docs/plans/2026-11-23-rulings-and-missing-alerts-plan.md; its design is docs/plans/2026-11-23-rulings-and-missing-alerts-design.md).
-- Task 2 (section 1): the kinds `gift` and `conduct` are alert kinds and toast kinds; one that is neither is still refused.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('ra-ann');
  said jsonb;
begin
  insert into alerts (account, kind, sub, act) values (ann, 'gift', null, null);
  insert into alerts (account, kind, sub, act) values (ann, 'conduct', 'hide', null);
  if (select count(*) from alerts where account = ann and kind in ('gift', 'conduct')) <> 2 then raise exception 'a gift and a conduct alert are not both stored'; end if;
  if pg_temp.refusal(format('insert into alerts (account, kind, act) values (%L, %L, null)', ann, 'confetti')) is null then raise exception 'an alert of kind confetti was stored'; end if;

  perform tests.become(ann);
  said := set_preferences(toasts => array['gift', 'conduct']);
  if said -> 'toasts' is distinct from '["gift", "conduct"]'::jsonb then raise exception 'the toasts gift and conduct are not kept: %', said; end if;
  if pg_temp.refusal($q$select set_preferences(toasts => array['confetti'])$q$) is distinct from 'not a kind of alert: confetti' then raise exception 'a toast of kind confetti was accepted'; end if;
  perform tests.unbecome();

  -- The toastDefaults setting names them too.
  if pg_temp.refusal($q$insert into settings (key, value) values ('toastDefaults', '["gift", "conduct"]') on conflict (key) do update set value = excluded.value$q$) is not null then
    raise exception 'toastDefaults refused gift and conduct: %', pg_temp.refusal($q$insert into settings (key, value) values ('toastDefaults', '["gift", "conduct"]') on conflict (key) do update set value = excluded.value$q$);
  end if;
end $$;
