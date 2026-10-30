-- The glass's preferences. The two-worlds plan, Task 1; the two-worlds design, section 6.
--
-- Three more of a player's own settings, beside the theme, postbit and motion of 0019: how much
-- cloud stands behind the glass, whether glass text sits on solid ground at 7:1, and the text's
-- size for the board and the glass together. They are KayfaBB's, since the engine owns the two
-- worlds; an instance sets no default for them. Each has a default, so a row already held keeps
-- its meaning, and each is read only by its own account (0019's policy), never broadcast: a
-- preference changes how the player's own screen looks, never what the server answers anyone.
-- Its way out is Settings, where each is changed back.

alter table account_preferences
  add column smoke text not null default 'full' check (smoke in ('full', 'low', 'off')),
  add column contrast text not null default 'standard' check (contrast in ('standard', 'high')),
  add column text_size smallint not null default 100 check (text_size in (100, 125, 150, 200));

-- set_preferences (0019), with the three further parameters. Dropped and made again rather than
-- overloaded, so the three-parameter signature is not left callable beside this one; a call
-- naming only the first three still works, since the rest default to null and are kept.
drop function set_preferences(text, text, text);

create function set_preferences(theme text default null, postbit text default null, motion text default null,
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
    'smoke', kept.smoke, 'contrast', kept.contrast, 'text_size', kept.text_size);
end $$;

revoke execute on function set_preferences(text, text, text, text, text, integer) from public, anon;
grant execute on function set_preferences(text, text, text, text, text, integer) to authenticated;
