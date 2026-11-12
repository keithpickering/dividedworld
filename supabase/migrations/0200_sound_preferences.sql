-- Sound preferences (docs/plans/2026-11-11-laugh-track-design.md, Task 1): whether the game's sounds and the interface's sounds play ('off' by default) and
-- how loud each is (0 to 100 in steps of 5, 80 by default), each the account's own, read by that account alone like the rest of account_preferences.
-- It follows 0145_brighter_effects.sql's shape: the four columns, preferences_answer with the keys after effects (0145's body), set_preferences dropped
-- and made again with the four parameters after effects (0145's body, because two signatures would make every call ambiguous) with the grants restated
-- for the new signature, and boot() (0145) replaced in place with the columns after effects; boot()'s signature is unchanged, so its grants stand.

alter table account_preferences
  add column game_sound text not null default 'off' check (game_sound in ('off', 'on')),
  add column game_volume integer not null default 80 check (game_volume between 0 and 100 and game_volume % 5 = 0),
  add column interface_sound text not null default 'off' check (interface_sound in ('off', 'on')),
  add column interface_volume integer not null default 80 check (interface_volume between 0 and 100 and interface_volume % 5 = 0);

create or replace function preferences_answer(kept account_preferences) returns jsonb
language sql stable set search_path = pg_temp as $$
  select jsonb_build_object('theme', kept.theme, 'postbit', kept.postbit, 'motion', kept.motion,
    'smoke', kept.smoke, 'contrast', kept.contrast, 'text_size', kept.text_size, 'tilt', kept.tilt, 'effects', kept.effects, 'game_sound', kept.game_sound, 'game_volume', kept.game_volume, 'interface_sound', kept.interface_sound, 'interface_volume', kept.interface_volume, 'mode', kept.mode, 'cards_met', to_jsonb(kept.cards_met),
    'alerts_seen_at', kept.alerts_seen_at, 'settlement_seen', kept.settlement_seen, 'toasts', to_jsonb(kept.toasts),
    'welcomed_at', kept.welcomed_at, 'tips', kept.tips, 'tips_seen', to_jsonb(kept.tips_seen))
$$;
revoke execute on function preferences_answer(account_preferences) from public, anon, authenticated;

drop function set_preferences(text, text, text, text, text, integer, text, text, text, text[], boolean);

create function set_preferences(theme text default null, postbit text default null, motion text default null,
  smoke text default null, contrast text default null, text_size integer default null, tilt text default null, effects text default null,
  game_sound text default null, game_volume integer default null, interface_sound text default null, interface_volume integer default null, mode text default null,
  toasts text[] default null, toasts_default boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  kept account_preferences%rowtype;
  known text[] := array['quote', 'cardOnYours', 'trapStruck', 'trapSprang', 'hint', 'ruling', 'settlement', 'followed', 'update', 'seasonNews', 'cardEnded', 'framed'];
  bad text;
  once text[];
begin
  if theme is not null and theme !~ '^[a-z][a-z0-9-]{0,39}$' then raise exception 'a theme is named in lowercase words joined by hyphens' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if postbit is not null and postbit not in ('side', 'stacked') then raise exception 'the postbit is side or stacked' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if motion is not null and motion not in ('system', 'reduce', 'full', 'snappy') then raise exception 'motion follows the system, or is off, smooth or snappy' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if smoke is not null and smoke not in ('full', 'low', 'off') then raise exception 'the smoke is full, low or off' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if contrast is not null and contrast not in ('standard', 'high') then raise exception 'contrast is standard or high' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if text_size is not null and text_size not in (100, 125, 150, 200) then raise exception 'text size is 100, 125, 150 or 200 percent' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if tilt is not null and tilt not in ('off', 'on') then raise exception 'tilt is off or on' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if effects is not null and effects not in ('standard', 'bright') then raise exception 'effects are standard or bright' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if game_sound is not null and game_sound not in ('off', 'on') then raise exception 'game sounds are off or on' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if interface_sound is not null and interface_sound not in ('off', 'on') then raise exception 'interface sounds are off or on' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if game_volume is not null and (game_volume not between 0 and 100 or game_volume % 5 <> 0) then raise exception 'a volume is 0 to 100, in steps of 5' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if interface_volume is not null and (interface_volume not between 0 and 100 or interface_volume % 5 <> 0) then raise exception 'a volume is 0 to 100, in steps of 5' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if mode is not null and mode not in ('system', 'light', 'dark') then raise exception 'the mode follows the device, or is light or dark' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if toasts is not null and coalesce(toasts_default, false) then raise exception 'the toasts are chosen or put back to the defaults, not both' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if toasts is not null then
    select string_agg(coalesce(k, '(blank)'), ', ' order by first) into bad from (select k, min(n) as first from unnest(toasts) with ordinality t(k, n) where k is null or not k = any (known) group by k) u;
    if bad is not null then raise exception 'not a kind of alert: %', bad using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    -- Repaired, not refused: the same kind named twice is the kind once, in the order it was first named.
    select coalesce(array_agg(k order by first), '{}') into once from (select k, min(n) as first from unnest(toasts) with ordinality t(k, n) group by k) d;
  end if;
  insert into account_preferences as p (account, theme, postbit, motion, smoke, contrast, text_size, tilt, effects, game_sound, game_volume, interface_sound, interface_volume, mode, toasts)
  values (caller, coalesce(theme, 'default'), coalesce(postbit, 'side'), coalesce(motion, 'system'),
    coalesce(smoke, 'full'), coalesce(contrast, 'standard'), coalesce(text_size, 100), coalesce(tilt, 'off'), coalesce(effects, 'standard'),
    coalesce(game_sound, 'off'), coalesce(game_volume, 80), coalesce(interface_sound, 'off'), coalesce(interface_volume, 80), coalesce(mode, 'system'), once)
  on conflict (account) do update set theme = coalesce(set_preferences.theme, p.theme), postbit = coalesce(set_preferences.postbit, p.postbit),
    motion = coalesce(set_preferences.motion, p.motion), smoke = coalesce(set_preferences.smoke, p.smoke),
    contrast = coalesce(set_preferences.contrast, p.contrast), text_size = coalesce(set_preferences.text_size, p.text_size),
    tilt = coalesce(set_preferences.tilt, p.tilt), effects = coalesce(set_preferences.effects, p.effects),
    game_sound = coalesce(set_preferences.game_sound, p.game_sound), game_volume = coalesce(set_preferences.game_volume, p.game_volume),
    interface_sound = coalesce(set_preferences.interface_sound, p.interface_sound), interface_volume = coalesce(set_preferences.interface_volume, p.interface_volume), mode = coalesce(set_preferences.mode, p.mode),
    toasts = case when coalesce(set_preferences.toasts_default, false) then null when set_preferences.toasts is not null then once else p.toasts end
  returning * into kept;
  return preferences_answer(kept);
end $$;

revoke execute on function set_preferences(text, text, text, text, text, integer, text, text, text, integer, text, integer, text, text[], boolean) from public, anon;
grant execute on function set_preferences(text, text, text, text, text, integer, text, text, text, integer, text, integer, text, text[], boolean) to authenticated;

create or replace function boot() returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  select jsonb_build_object(
    'settings', (select s.settings from screen_settings s limit 1),
    'account', (select to_jsonb(whoami())),
    'preferences', (select to_jsonb(p) from (
      select a.theme, a.postbit, a.motion, a.smoke, a.contrast, a.text_size, a.tilt, a.effects, a.game_sound, a.game_volume, a.interface_sound, a.interface_volume, a.mode, a.cards_met, a.alerts_seen_at, a.settlement_seen, a.toasts, a.welcomed_at, a.tips, a.tips_seen
      from account_preferences a limit 1) p),
    'characters', coalesce((select jsonb_agg(to_jsonb(c) order by c.name) from my_characters c), '[]'::jsonb),
    'faces', coalesce((
      select jsonb_agg(f.face order by f.name) from (
        select cp.name, to_jsonb(cp) || jsonb_build_object('profile', (
          select to_jsonb(p) from (
            select r.character, r.title, r.signature, r.avatar_square, r.avatar_portrait, r.square_frame, r.portrait_frame, r.pip_style, r.pronouns
            from character_profiles r where r.character = cp.id) p)) as face
        from characters_public cp where cp.id in (select m.id from my_characters m)) f), '[]'::jsonb),
    'wallet', (select to_jsonb(w) from (select mw.balance, mw.cap from my_wallet mw limit 1) w),
    'cards', coalesce((select jsonb_agg(to_jsonb(k) order by k.card) from (select mc.card, mc.held from my_cards mc) k), '[]'::jsonb),
    'boards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'slug', b.slug, 'name', b.name, 'description', b.description, 'is_system', b.is_system, 'move_act', b.move_act,
        'thread_count', coalesce(bc.threads, 0), 'last_at', l.last_at, 'last_character', l.last_character, 'last_thread', l.id, 'last_title', l.title) order by b.created_at, b.id)
      from boards_now b
      left join board_counts bc on bc.board = b.id
      left join lateral (select t.id, t.title, t.last_at, t.last_character from thread_list t where t.board = b.id order by t.last_at desc limit 1) l on true), '[]'::jsonb),
    'admin', coalesce(is_admin(), false),
    'unread', case when whoami() is null then 0 else my_alerts_unread() end,
    'nextSettlementAt', next_settlement_at(),
    'lastSettledAt', (select s.ends_at from settlements s order by s.ends_at desc limit 1),
    'newestSettlement', (select s.ends_at from settlements s where s.id = (select max(l.settlement) from my_ledger l))
  );
end;
