-- The account's two marks (supabase/migrations/0057_account_marks.sql): when Alerts was last
-- opened and the end of the last settlement whose summary was seen. Each only moves forward (an
-- older time is a no-op, not an error), a time past the server's clock is taken as now, and an
-- account reads and moves its own alone. The alerts plan, Task 2.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('mark-ann');
  bob uuid := tests.account('mark-bob');
  t0 timestamptz := now() - interval '3 days';
  said jsonb;
begin
  perform tests.become(ann);
  -- An account that has never set either mark has none (everything is new), and no row yet.
  if exists (select 1 from account_preferences) then raise exception 'a row was made before any call'; end if;

  -- A first call makes the row and sets the mark, leaving the other mark and the preferences alone.
  said := see_alerts(t0);
  if (said ->> 'seen')::timestamptz is distinct from t0 then raise exception 'see_alerts answers the mark: %', said; end if;
  if (select (alerts_seen_at, settlement_seen, theme) from account_preferences) is distinct from (t0, null::timestamptz, 'default'::text) then
    raise exception 'a first see_alerts sets that mark alone';
  end if;
  -- Later moves it forward.
  said := see_alerts(t0 + interval '1 day');
  if (said ->> 'seen')::timestamptz is distinct from t0 + interval '1 day' then raise exception 'a later time moves alerts_seen_at forward: %', said; end if;
  -- Earlier, and the same time, are no-ops that answer the mark as it stands.
  said := see_alerts(t0);
  if (said ->> 'seen')::timestamptz is distinct from t0 + interval '1 day' then raise exception 'an older time moved alerts_seen_at back: %', said; end if;
  said := see_alerts(t0 + interval '1 day');
  if (said ->> 'seen')::timestamptz is distinct from t0 + interval '1 day' then raise exception 'the same time changed alerts_seen_at: %', said; end if;
  -- A time past the server's clock is taken as now, so the mark is never parked ahead of every alert to come.
  said := see_alerts(now() + interval '10 years');
  if (said ->> 'seen')::timestamptz is distinct from now() then raise exception 'a future time is taken as now: %', said; end if;

  -- The settlement's mark, on the row that exists, the same way and independent of the first.
  said := see_settlement(t0);
  if (said ->> 'seen')::timestamptz is distinct from t0 then raise exception 'see_settlement answers the mark: %', said; end if;
  said := see_settlement(t0 - interval '1 day');
  if (said ->> 'seen')::timestamptz is distinct from t0 then raise exception 'an older settlement moved settlement_seen back: %', said; end if;
  said := see_settlement(t0 + interval '2 hours');
  if (said ->> 'seen')::timestamptz is distinct from t0 + interval '2 hours' then raise exception 'a later settlement moves settlement_seen forward: %', said; end if;
  if (select alerts_seen_at from account_preferences) is distinct from now() then raise exception 'the settlement call moved the alerts mark'; end if;

  -- The set_preferences call keeps both marks, as it keeps what it leaves out.
  perform set_preferences(theme => 'dark');
  if (select (alerts_seen_at, settlement_seen, theme) from account_preferences) is distinct from (now(), t0 + interval '2 hours', 'dark'::text) then
    raise exception 'set_preferences changed a mark';
  end if;

  -- The three functions that answer the whole preferences carry the marks, so a screen taking their answer
  -- as the preferences reports what the account holds, not null.
  said := set_preferences(smoke => 'low');
  if (said ->> 'alerts_seen_at')::timestamptz is distinct from now() or (said ->> 'settlement_seen')::timestamptz is distinct from t0 + interval '2 hours' then
    raise exception 'set_preferences answered without the marks: %', said;
  end if;
  said := meet_card('whoops');
  if (said ->> 'alerts_seen_at')::timestamptz is distinct from now() or (said ->> 'settlement_seen')::timestamptz is distinct from t0 + interval '2 hours' then
    raise exception 'meet_card answered without the marks: %', said;
  end if;
  said := restore_tips();
  if (said ->> 'alerts_seen_at')::timestamptz is distinct from now() or (said ->> 'settlement_seen')::timestamptz is distinct from t0 + interval '2 hours' then
    raise exception 'restore_tips answered without the marks: %', said;
  end if;

  -- A mark is a time.
  if pg_temp.refusal($q$select see_alerts(null)$q$) is distinct from 'a mark is a time' then raise exception 'a null alerts mark'; end if;
  if pg_temp.refusal($q$select see_settlement(null)$q$) is distinct from 'a mark is a time' then raise exception 'a null settlement mark'; end if;
  perform tests.unbecome();

  -- Another account reads neither mark, and its own calls move only its own.
  perform tests.become(bob);
  if exists (select 1 from account_preferences) then raise exception 'another account read a row of the first''s'; end if;
  said := see_alerts(t0 - interval '1 day');
  if (said ->> 'seen')::timestamptz is distinct from t0 - interval '1 day' then raise exception 'a second account starts from nothing, not from the first''s mark: %', said; end if;
  said := see_settlement(t0 - interval '5 days');
  if (said ->> 'seen')::timestamptz is distinct from t0 - interval '5 days' then raise exception 'a second account''s settlement mark starts from nothing: %', said; end if;
  if (select count(*) from account_preferences) is distinct from 1 then raise exception 'an account reads its own row alone'; end if;
  perform tests.unbecome();
  if (select (alerts_seen_at, settlement_seen) from account_preferences where account = ann)
     is distinct from (now(), t0 + interval '2 hours') then
    raise exception 'another account''s call moved the first''s marks';
  end if;

  -- A visitor cannot call either: refused by the grant.
  perform tests.become_anon();
  if pg_temp.refusal($q$select see_alerts(now())$q$) is distinct from 'permission denied for function see_alerts' then raise exception 'a visitor could call see_alerts'; end if;
  if pg_temp.refusal($q$select see_settlement(now())$q$) is distinct from 'permission denied for function see_settlement' then raise exception 'a visitor could call see_settlement'; end if;
  perform tests.unbecome();
end $$;
