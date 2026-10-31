-- The cards a player has met. The marks-and-the-lens plan, Task 7.
--
-- The first mark of a card kind a player has never seen on a page shows a small callout that
-- says what the card is. Which kinds have been met is kept on the account, beside its other
-- preferences, so the callout shows once, on any device. It is read only by its own account
-- (0019's policy) and never broadcast: it changes what the player's own screen shows, never
-- what the server answers anyone, and an answer depends on the caller's own row alone, never
-- on another account or on whether the key was new. Its ways out: the callout's "Got it", or
-- the card's first use, meets it; Settings' "Show card tips again" (forget_cards_met) forgets
-- them all.

alter table account_preferences
  add column cards_met text[] not null default '{}' check (cardinality(cards_met) <= 64);

-- set_preferences (0033) answered the row without the set, so a screen taking its answer as the
-- whole preferences would show no card met. It is made again with the same signature, grants and
-- rules, answering the whole row; the set itself is changed by meet_card and forget_cards_met alone.
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
    'smoke', kept.smoke, 'contrast', kept.contrast, 'text_size', kept.text_size, 'cards_met', to_jsonb(kept.cards_met));
end $$;

-- Adds one key, once, and answers the account's preferences in set_preferences' shape plus the
-- set. The upsert makes the row a first meeting needs; a key held is left as it is.
create function meet_card(card text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  kept account_preferences%rowtype;
begin
  if card is null or card !~ '^[a-z][a-z0-9-]{0,39}$' then raise exception 'a card is named in lowercase words joined by hyphens' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  select * into kept from account_preferences where account = caller;
  if found and not card = any (kept.cards_met) and cardinality(kept.cards_met) >= 64 then raise exception 'at most 64 cards are kept as met' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  insert into account_preferences as p (account, cards_met) values (caller, array[card])
  on conflict (account) do update set cards_met = case when card = any (p.cards_met) then p.cards_met else p.cards_met || card end
  returning * into kept;
  return jsonb_build_object('theme', kept.theme, 'postbit', kept.postbit, 'motion', kept.motion,
    'smoke', kept.smoke, 'contrast', kept.contrast, 'text_size', kept.text_size, 'cards_met', to_jsonb(kept.cards_met));
end $$;

create function forget_cards_met() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  kept account_preferences%rowtype;
begin
  insert into account_preferences as p (account) values (caller)
  on conflict (account) do update set cards_met = '{}'
  returning * into kept;
  return jsonb_build_object('theme', kept.theme, 'postbit', kept.postbit, 'motion', kept.motion,
    'smoke', kept.smoke, 'contrast', kept.contrast, 'text_size', kept.text_size, 'cards_met', to_jsonb(kept.cards_met));
end $$;

revoke execute on function meet_card(text), forget_cards_met() from public, anon;
grant execute on function meet_card(text), forget_cards_met() to authenticated;
