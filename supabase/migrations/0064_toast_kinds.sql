-- Which alert kinds toast (the alerts plan, Task 11; the alerts design, sections 8 and 12): the player's own choice, kept on the
-- account beside its other preferences. Null means the player never chose, so the instance's defaults hold (its `toastDefaults`
-- setting); an array, possibly empty, is exactly the kinds that toast. A kind that does not toast still counts and still has its row
-- in Alerts. The kinds are the engine's (engine/rules/alerts.ts), listed here as 0058's check lists them; a build test holds the two lists as one.

alter table account_preferences
  add column toasts text[]
    check (toasts is null or toasts <@ array['quote', 'cardOnYours', 'trapStruck', 'trapSprang', 'hint', 'ruling', 'settlement', 'followed', 'update', 'seasonNews']);

-- screen_settings (0041), with the instance's toast defaults beside what it already hands the screens.
create or replace view screen_settings as
  select coalesce(jsonb_object_agg(s.key, s.value), '{}'::jsonb)
         || jsonb_build_object('cardEconomy', (
              select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
              from settings x cross join lateral jsonb_each(x.value) e
              where x.key = 'economy' and jsonb_typeof(x.value) = 'object'
                and e.key in (select k.price_setting from card_kinds k union select unnest(k.reads) from card_kinds k))) as settings
  from settings s
  where s.key in ('postsPerPage', 'hotReplies', 'editGrace', 'reactionCap', 'charactersPerPlayer', 'invitesPerPlayer', 'inviteLifetime',
                  'turnCooldown', 'walletCap', 'postMaxLength', 'titleMaxLength', 'registrationMode', 'settlementLength', 'cardSettings',
                  'presencePollSeconds', 'presenceWindow', 'toastDefaults');

-- set_preferences (0057), with two further parameters: `toasts`, the kinds that toast, and `toasts_default`, which puts the choice back
-- to null (the instance's defaults), since an empty array is a choice of its own (nothing toasts). A kind named twice is kept once, in the
-- order first named; a kind the engine does not have, or a blank one, is refused naming it. Dropped and made again rather than
-- replaced, because a function with two more defaulted parameters beside the old one would make every call ambiguous (0033 did the same).
drop function set_preferences(text, text, text, text, text, integer);

create function set_preferences(theme text default null, postbit text default null, motion text default null,
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
  return jsonb_build_object('theme', kept.theme, 'postbit', kept.postbit, 'motion', kept.motion,
    'smoke', kept.smoke, 'contrast', kept.contrast, 'text_size', kept.text_size, 'cards_met', to_jsonb(kept.cards_met),
    'alerts_seen_at', kept.alerts_seen_at, 'settlement_seen', kept.settlement_seen, 'toasts', to_jsonb(kept.toasts));
end $$;

revoke execute on function set_preferences(text, text, text, text, text, integer, text[], boolean) from public, anon;
grant execute on function set_preferences(text, text, text, text, text, integer, text[], boolean) to authenticated;

-- meet_card and forget_cards_met (0057), each with the same signature, grants and rules, and the answer gaining the one key.
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
  return jsonb_build_object('theme', kept.theme, 'postbit', kept.postbit, 'motion', kept.motion,
    'smoke', kept.smoke, 'contrast', kept.contrast, 'text_size', kept.text_size, 'cards_met', to_jsonb(kept.cards_met),
    'alerts_seen_at', kept.alerts_seen_at, 'settlement_seen', kept.settlement_seen, 'toasts', to_jsonb(kept.toasts));
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
    'alerts_seen_at', kept.alerts_seen_at, 'settlement_seen', kept.settlement_seen, 'toasts', to_jsonb(kept.toasts));
end $$;
