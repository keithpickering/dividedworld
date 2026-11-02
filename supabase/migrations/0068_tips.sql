-- The tips' state on the account (the onboarding plan's Task 3; the onboarding design's section 7): when the player saw the welcome, whether
-- the tips are on, and which tips they have seen, kept on the account beside the cards met so each shows once, on any device. All three
-- are the caller's own account_preferences row (0019's policy): read by its own account alone, never broadcast, and an answer depends on
-- the caller's own row alone, never on another account or on whether a key was new. Five functions change them; the rest of the row is
-- changed by the functions it always was. Ways out: skip_tips is undone by restore_tips and replay_tour (Settings, Task 9); the seen set
-- is emptied by restore_tips, and the tour's keys alone by replay_tour; welcomed_at is a fact and has no way back, because the welcome
-- shows once and its words live on in the guide.

-- A tip is named as a card is: lowercase words joined by hyphens, at most 40 characters, and at most 64 are kept.
create function tip_keys_ok(keys text[]) returns boolean
language sql immutable set search_path = pg_temp as $$
  select keys is not null and cardinality(keys) <= 64
    and not exists (select 1 from unnest(keys) k where k is null or k !~ '^[a-z][a-z0-9-]{0,39}$')
$$;

alter table account_preferences
  add column welcomed_at timestamptz,
  add column tips text not null default 'on' check (tips in ('on', 'off')),
  add column tips_seen text[] not null default '{}' check (tip_keys_ok(tips_seen));

-- The whole preferences, as every function that answers them shows them (0064's shape, with the three more keys). One place, so the
-- answers cannot drift apart. Not callable by the API roles; the functions below run it as their owner.
create function preferences_answer(kept account_preferences) returns jsonb
language sql stable set search_path = pg_temp as $$
  select jsonb_build_object('theme', kept.theme, 'postbit', kept.postbit, 'motion', kept.motion,
    'smoke', kept.smoke, 'contrast', kept.contrast, 'text_size', kept.text_size, 'cards_met', to_jsonb(kept.cards_met),
    'alerts_seen_at', kept.alerts_seen_at, 'settlement_seen', kept.settlement_seen, 'toasts', to_jsonb(kept.toasts),
    'welcomed_at', kept.welcomed_at, 'tips', kept.tips, 'tips_seen', to_jsonb(kept.tips_seen))
$$;
revoke execute on function preferences_answer(account_preferences), tip_keys_ok(text[]) from public, anon, authenticated;

-- set_preferences (0064), the same signature, grants and rules, answering the three more keys.
create or replace function set_preferences(theme text default null, postbit text default null, motion text default null,
  smoke text default null, contrast text default null, text_size integer default null,
  toasts text[] default null, toasts_default boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  kept account_preferences%rowtype;
  known text[] := array['quote', 'cardOnYours', 'trapStruck', 'trapSprang', 'hint', 'ruling', 'settlement', 'followed', 'update', 'seasonNews'];
  bad text;
  once text[];
begin
  if theme is not null and theme !~ '^[a-z][a-z0-9-]{0,39}$' then raise exception 'a theme is named in lowercase words joined by hyphens' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if postbit is not null and postbit not in ('side', 'stacked') then raise exception 'the postbit is side or stacked' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if motion is not null and motion not in ('system', 'reduce', 'full') then raise exception 'motion follows the system, or is reduced or full' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if smoke is not null and smoke not in ('full', 'low', 'off') then raise exception 'the smoke is full, low or off' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if contrast is not null and contrast not in ('standard', 'high') then raise exception 'contrast is standard or high' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if text_size is not null and text_size not in (100, 125, 150, 200) then raise exception 'text size is 100, 125, 150 or 200 percent' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if toasts is not null and coalesce(toasts_default, false) then raise exception 'the toasts are chosen or put back to the defaults, not both' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if toasts is not null then
    select string_agg(coalesce(k, '(blank)'), ', ' order by first) into bad from (select k, min(n) as first from unnest(toasts) with ordinality t(k, n) where k is null or not k = any (known) group by k) u;
    if bad is not null then raise exception 'not a kind of alert: %', bad using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    -- Repaired, not refused: the same kind named twice is the kind once, in the order it was first named.
    select coalesce(array_agg(k order by first), '{}') into once from (select k, min(n) as first from unnest(toasts) with ordinality t(k, n) group by k) d;
  end if;
  insert into account_preferences as p (account, theme, postbit, motion, smoke, contrast, text_size, toasts)
  values (caller, coalesce(theme, 'system'), coalesce(postbit, 'side'), coalesce(motion, 'system'),
    coalesce(smoke, 'full'), coalesce(contrast, 'standard'), coalesce(text_size, 100), once)
  on conflict (account) do update set theme = coalesce(set_preferences.theme, p.theme), postbit = coalesce(set_preferences.postbit, p.postbit),
    motion = coalesce(set_preferences.motion, p.motion), smoke = coalesce(set_preferences.smoke, p.smoke),
    contrast = coalesce(set_preferences.contrast, p.contrast), text_size = coalesce(set_preferences.text_size, p.text_size),
    toasts = case when coalesce(set_preferences.toasts_default, false) then null when set_preferences.toasts is not null then once else p.toasts end
  returning * into kept;
  return preferences_answer(kept);
end $$;

-- meet_card (0064), answering the three more keys.
create or replace function meet_card(card text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  kept account_preferences%rowtype;
begin
  if card is null or card !~ '^[a-z][a-z0-9-]{0,39}$' then raise exception 'a card is named in lowercase words joined by hyphens' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  insert into account_preferences (account) values (caller) on conflict (account) do nothing;
  select * into kept from account_preferences where account = caller for update;
  if not card = any (kept.cards_met) and cardinality(kept.cards_met) >= 64 then raise exception 'at most 64 cards are kept as met' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  update account_preferences set cards_met = case when card = any (cards_met) then cards_met else cards_met || card end
  where account = caller returning * into kept;
  return preferences_answer(kept);
end $$;

-- The welcome is seen once: a second call leaves the first time.
create function see_welcome() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  kept account_preferences%rowtype;
begin
  insert into account_preferences as p (account, welcomed_at) values (caller, now())
  on conflict (account) do update set welcomed_at = coalesce(p.welcomed_at, excluded.welcomed_at)
  returning * into kept;
  return preferences_answer(kept);
end $$;

-- A tip is seen once, however often this is called; the answer has the same shape whether or not the key was new.
create function see_tip(key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  kept account_preferences%rowtype;
begin
  if key is null or key !~ '^[a-z][a-z0-9-]{0,39}$' then raise exception 'a tip is named in lowercase words joined by hyphens' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  insert into account_preferences (account) values (caller) on conflict (account) do nothing;
  select * into kept from account_preferences where account = caller for update;
  if not key = any (kept.tips_seen) and cardinality(kept.tips_seen) >= 64 then raise exception 'at most 64 tips are kept as seen' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  update account_preferences set tips_seen = case when key = any (tips_seen) then tips_seen else tips_seen || key end
  where account = caller returning * into kept;
  return preferences_answer(kept);
end $$;

-- "Skip tips": the tips go quiet; what was seen is kept, so turning them on again does not repeat them.
create function skip_tips() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  kept account_preferences%rowtype;
begin
  insert into account_preferences as p (account, tips) values (caller, 'off')
  on conflict (account) do update set tips = 'off'
  returning * into kept;
  return preferences_answer(kept);
end $$;

-- "Show tips again": tips on, and every tip and every card callout shows afresh. The welcome stays seen.
create function restore_tips() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  kept account_preferences%rowtype;
begin
  insert into account_preferences as p (account) values (caller)
  on conflict (account) do update set tips = 'on', tips_seen = '{}', cards_met = '{}'
  returning * into kept;
  return preferences_answer(kept);
end $$;

-- "Replay the tour": the tour's tips show again and tips are on; every other tip stays as it was.
create function replay_tour() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  kept account_preferences%rowtype;
begin
  insert into account_preferences as p (account) values (caller)
  on conflict (account) do update set tips = 'on',
    tips_seen = coalesce((select array_agg(k order by n) from unnest(p.tips_seen) with ordinality t(k, n) where k <> all (array['tour-plate', 'tour-orbs', 'tour-hand'])), '{}')
  returning * into kept;
  return preferences_answer(kept);
end $$;

-- forget_cards_met (0064) stays for Settings' row until the tips' Settings row replaces it (Task 9), as the same thing as restore_tips.
create or replace function forget_cards_met() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return restore_tips();
end $$;

revoke execute on function see_welcome(), see_tip(text), skip_tips(), restore_tips(), replay_tour() from public, anon;
grant execute on function see_welcome(), see_tip(text), skip_tips(), restore_tips(), replay_tour() to authenticated;
