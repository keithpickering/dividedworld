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

-- The three functions that answer the whole preferences (set_preferences, meet_card and
-- forget_cards_met, 0040) now carry the two marks too, so a screen taking their answer as the
-- preferences reports what the account holds and not null. Each is made again with the same
-- signature, grants and rules as 0040 wrote it; only the answer gains two keys. (Grants stay: a
-- replaced function keeps them.)

create or replace function set_preferences(theme text default null, postbit text default null, motion text default null,
  smoke text default null, contrast text default null, text_size integer default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  kept account_preferences%rowtype;
begin
  if theme is not null and theme !~ '^[a-z][a-z0-9-]{0,39}$' then raise exception 'a theme is named in lowercase words joined by hyphens' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if postbit is not null and postbit not in ('side', 'stacked') then raise exception 'the postbit is side or stacked' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if motion is not null and motion not in ('system', 'reduce', 'full') then raise exception 'motion follows the system, or is reduced or full' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if smoke is not null and smoke not in ('full', 'low', 'off') then raise exception 'the smoke is full, low or off' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if contrast is not null and contrast not in ('standard', 'high') then raise exception 'contrast is standard or high' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if text_size is not null and text_size not in (100, 125, 150, 200) then raise exception 'text size is 100, 125, 150 or 200 percent' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  insert into account_preferences as p (account, theme, postbit, motion, smoke, contrast, text_size)
  values (caller, coalesce(theme, 'system'), coalesce(postbit, 'side'), coalesce(motion, 'system'),
    coalesce(smoke, 'full'), coalesce(contrast, 'standard'), coalesce(text_size, 100))
  on conflict (account) do update set theme = coalesce(set_preferences.theme, p.theme), postbit = coalesce(set_preferences.postbit, p.postbit),
    motion = coalesce(set_preferences.motion, p.motion), smoke = coalesce(set_preferences.smoke, p.smoke),
    contrast = coalesce(set_preferences.contrast, p.contrast), text_size = coalesce(set_preferences.text_size, p.text_size)
  returning * into kept;
  return jsonb_build_object('theme', kept.theme, 'postbit', kept.postbit, 'motion', kept.motion,
    'smoke', kept.smoke, 'contrast', kept.contrast, 'text_size', kept.text_size, 'cards_met', to_jsonb(kept.cards_met),
    'alerts_seen_at', kept.alerts_seen_at, 'settlement_seen', kept.settlement_seen);
end $$;

-- Adds one key, once, and answers the account's preferences in set_preferences' shape plus the
-- set. The upsert makes the row a first meeting needs; a key held is left as it is.
create or replace function meet_card(card text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  kept account_preferences%rowtype;
begin
  if card is null or card !~ '^[a-z][a-z0-9-]{0,39}$' then raise exception 'a card is named in lowercase words joined by hyphens' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  -- The row is made if it is not there and then locked, so two calls racing for the last place meet
  -- one after the other: the second sees 64 and is refused in the refusal's words, never by the
  -- column's check.
  insert into account_preferences (account) values (caller) on conflict (account) do nothing;
  select * into kept from account_preferences where account = caller for update;
  if not card = any (kept.cards_met) and cardinality(kept.cards_met) >= 64 then raise exception 'at most 64 cards are kept as met' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  update account_preferences set cards_met = case when card = any (cards_met) then cards_met else cards_met || card end
  where account = caller returning * into kept;
  return jsonb_build_object('theme', kept.theme, 'postbit', kept.postbit, 'motion', kept.motion,
    'smoke', kept.smoke, 'contrast', kept.contrast, 'text_size', kept.text_size, 'cards_met', to_jsonb(kept.cards_met),
    'alerts_seen_at', kept.alerts_seen_at, 'settlement_seen', kept.settlement_seen);
end $$;

create or replace function forget_cards_met() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  kept account_preferences%rowtype;
begin
  insert into account_preferences as p (account) values (caller)
  on conflict (account) do update set cards_met = '{}'
  returning * into kept;
  return jsonb_build_object('theme', kept.theme, 'postbit', kept.postbit, 'motion', kept.motion,
    'smoke', kept.smoke, 'contrast', kept.contrast, 'text_size', kept.text_size, 'cards_met', to_jsonb(kept.cards_met),
    'alerts_seen_at', kept.alerts_seen_at, 'settlement_seen', kept.settlement_seen);
end $$;

