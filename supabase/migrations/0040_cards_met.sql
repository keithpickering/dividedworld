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
