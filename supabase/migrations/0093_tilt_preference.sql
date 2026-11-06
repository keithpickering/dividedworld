-- The tilt preference (docs/plans/2026-11-06-shine-plan.md, Task 4): whether the glass tilts a card or avatar toward the pointer, 'off' by
-- default and the account's own, read by that account alone like the rest of account_preferences. set_preferences is dropped and made
-- again with `tilt` after text_size, as 0033 and 0064 did, because two signatures would make every call ambiguous; its body is 0092's
-- with the one new choice. preferences_answer gains the key, and the grants are restated.

alter table account_preferences add column tilt text not null default 'off' check (tilt in ('off', 'on'));

create or replace function preferences_answer(kept account_preferences) returns jsonb
language sql stable set search_path = pg_temp as $$
  select jsonb_build_object('theme', kept.theme, 'postbit', kept.postbit, 'motion', kept.motion,
    'smoke', kept.smoke, 'contrast', kept.contrast, 'text_size', kept.text_size, 'tilt', kept.tilt, 'cards_met', to_jsonb(kept.cards_met),
    'alerts_seen_at', kept.alerts_seen_at, 'settlement_seen', kept.settlement_seen, 'toasts', to_jsonb(kept.toasts),
    'welcomed_at', kept.welcomed_at, 'tips', kept.tips, 'tips_seen', to_jsonb(kept.tips_seen))
$$;
revoke execute on function preferences_answer(account_preferences) from public, anon, authenticated;

drop function set_preferences(text, text, text, text, text, integer, text[], boolean);

create function set_preferences(theme text default null, postbit text default null, motion text default null,
  smoke text default null, contrast text default null, text_size integer default null, tilt text default null,
  toasts text[] default null, toasts_default boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  kept account_preferences%rowtype;
  known text[] := array['quote', 'cardOnYours', 'trapStruck', 'trapSprang', 'hint', 'ruling', 'settlement', 'followed', 'update', 'seasonNews', 'cardEnded'];
  bad text;
  once text[];
begin
  if theme is not null and theme !~ '^[a-z][a-z0-9-]{0,39}$' then raise exception 'a theme is named in lowercase words joined by hyphens' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if postbit is not null and postbit not in ('side', 'stacked') then raise exception 'the postbit is side or stacked' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if motion is not null and motion not in ('system', 'reduce', 'full') then raise exception 'motion follows the system, or is reduced or full' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if smoke is not null and smoke not in ('full', 'low', 'off') then raise exception 'the smoke is full, low or off' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if contrast is not null and contrast not in ('standard', 'high') then raise exception 'contrast is standard or high' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if text_size is not null and text_size not in (100, 125, 150, 200) then raise exception 'text size is 100, 125, 150 or 200 percent' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if tilt is not null and tilt not in ('off', 'on') then raise exception 'tilt is off or on' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if toasts is not null and coalesce(toasts_default, false) then raise exception 'the toasts are chosen or put back to the defaults, not both' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if toasts is not null then
    select string_agg(coalesce(k, '(blank)'), ', ' order by first) into bad from (select k, min(n) as first from unnest(toasts) with ordinality t(k, n) where k is null or not k = any (known) group by k) u;
    if bad is not null then raise exception 'not a kind of alert: %', bad using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    -- Repaired, not refused: the same kind named twice is the kind once, in the order it was first named.
    select coalesce(array_agg(k order by first), '{}') into once from (select k, min(n) as first from unnest(toasts) with ordinality t(k, n) group by k) d;
  end if;
  insert into account_preferences as p (account, theme, postbit, motion, smoke, contrast, text_size, tilt, toasts)
  values (caller, coalesce(theme, 'system'), coalesce(postbit, 'side'), coalesce(motion, 'system'),
    coalesce(smoke, 'full'), coalesce(contrast, 'standard'), coalesce(text_size, 100), coalesce(tilt, 'off'), once)
  on conflict (account) do update set theme = coalesce(set_preferences.theme, p.theme), postbit = coalesce(set_preferences.postbit, p.postbit),
    motion = coalesce(set_preferences.motion, p.motion), smoke = coalesce(set_preferences.smoke, p.smoke),
    contrast = coalesce(set_preferences.contrast, p.contrast), text_size = coalesce(set_preferences.text_size, p.text_size),
    tilt = coalesce(set_preferences.tilt, p.tilt),
    toasts = case when coalesce(set_preferences.toasts_default, false) then null when set_preferences.toasts is not null then once else p.toasts end
  returning * into kept;
  return preferences_answer(kept);
end $$;

revoke execute on function set_preferences(text, text, text, text, text, integer, text, text[], boolean) from public, anon;
grant execute on function set_preferences(text, text, text, text, text, integer, text, text[], boolean) to authenticated;
