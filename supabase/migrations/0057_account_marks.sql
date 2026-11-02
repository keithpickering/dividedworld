-- The account's two marks. The alerts plan, Task 2; the alerts design, section 4.
--
-- Two things a player has "seen" are kept on the account, so every device agrees: when they last
-- opened Alerts (the HUD's count is what arrived after it, and the page draws its "new since you
-- last looked" divider there), and the end of the last settlement whose summary they saw (until
-- now the device's alone, `kb-settled-seen:<account>`, which settled nothing for a second device).
--
-- They are preferences, as the theme is, in the row 0019 made and its policy reads: an account
-- reads its own row alone, and nothing here is an Act or touches one. A mark is a time and only
-- ever moves forward: a call with an older time leaves it as it is, no error, so two devices
-- calling late or out of order cannot bring an old alert back as new. A time later than the
-- server's clock is taken as now, so a wrong device clock cannot park a mark past every alert to
-- come (a state with no way out); a mark that is null has never been set, and everything is new.
-- Neither is broadcast or computed into any answer for another account ("A response never proves
-- a private fact"). Its way out is none needed: the next call moves it forward again.

alter table account_preferences
  add column alerts_seen_at timestamptz,
  add column settlement_seen timestamptz;

-- Both answer the mark as it now stands, as {"seen": time}. The row is made if the account has
-- none yet (meet_card's way, 0040) and the later of the two times is kept. The update runs only
-- when it moves the mark, so a no-op writes nothing.
create function see_alerts(at timestamptz) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  kept timestamptz;
begin
  if at is null then raise exception 'a mark is a time' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  insert into account_preferences as p (account, alerts_seen_at) values (caller, least(at, now()))
  on conflict (account) do update set alerts_seen_at = greatest(p.alerts_seen_at, excluded.alerts_seen_at)
    where p.alerts_seen_at is null or p.alerts_seen_at < excluded.alerts_seen_at;
  select alerts_seen_at into kept from account_preferences where account = caller;
  return jsonb_build_object('seen', kept);
end $$;

create function see_settlement(ends_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  kept timestamptz;
begin
  if ends_at is null then raise exception 'a mark is a time' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  insert into account_preferences as p (account, settlement_seen) values (caller, least(ends_at, now()))
  on conflict (account) do update set settlement_seen = greatest(p.settlement_seen, excluded.settlement_seen)
    where p.settlement_seen is null or p.settlement_seen < excluded.settlement_seen;
  select settlement_seen into kept from account_preferences where account = caller;
  return jsonb_build_object('seen', kept);
end $$;

revoke execute on function see_alerts(timestamptz), see_settlement(timestamptz) from public, anon;
grant execute on function see_alerts(timestamptz), see_settlement(timestamptz) to authenticated;
