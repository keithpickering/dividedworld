-- The card catalog for the three card types (supabase/migrations/0146_card_types.sql; docs/plans/2026-11-11-card-types-design.md, sections 5 and 12; plan Task 3):
-- a use card (a Gimmick) holds a `gimmick` in place of `ward`, a Reversal's trap may hold a `match`, card_kinds_problem refuses each pairing instanceProblems
-- refuses that SQL can check, in the engine's words, and card_target and reach_effects carry the live Gimmick. The cards are this file's own, never an instance's.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- ---- The catalog holds a gimmick and no ward ----
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'card_kinds' and column_name = 'ward') then raise exception 'card_kinds still has a ward column'; end if;
  if not exists (select 1 from information_schema.columns where table_name = 'card_kinds' and column_name = 'gimmick' and data_type = 'jsonb') then raise exception 'card_kinds has no gimmick jsonb column'; end if;
end $$;

-- ---- card_kinds_problem: each poison is refused alone, in the engine's words, and clean cards pass ----
do $$
declare
  use_ok constant text := '"key": "ok", "rarity": "common", "play": "use", "lasts": {"unit": "day", "count": 7}, "gimmick": {"kind": "ward", "upTo": "common"}';
  why text;
begin
  -- Clean: a use card with a gimmick and a time up, a cast card, a set card with a trap (a named catch and a match alike).
  why := card_kinds_problem(('[{' || use_ok || '}, {"key": "c", "rarity": "common"}, {"key": "r", "rarity": "common", "play": "set", "trap": {"trigger": {"on": "cast"}}},'
    || '{"key": "m", "rarity": "common", "play": "set", "trap": {"trigger": {"on": "cast"}, "match": {"flavors": ["salty"]}}}]')::jsonb);
  if why is not null then raise exception 'clean cards were refused: %', why; end if;

  why := card_kinds_problem('[{"key": "poison", "rarity": "common", "play": "use", "lasts": {"unit": "day", "count": 7}}]');
  if why is distinct from 'card "poison" is a use card with no gimmick' then raise exception 'a use card with no gimmick: %', why; end if;

  why := card_kinds_problem('[{"key": "poison", "rarity": "common", "play": "cast", "gimmick": {"kind": "ward", "upTo": "common"}}]');
  if why is distinct from 'card "poison" has a gimmick, and only a use card has one' then raise exception 'a gimmick on a cast card: %', why; end if;

  why := card_kinds_problem('[{"key": "poison", "rarity": "common", "play": "set"}]');
  if why is distinct from 'card "poison" is a set card with no trap' then raise exception 'a set card with no trap: %', why; end if;

  why := card_kinds_problem('[{"key": "poison", "rarity": "common", "play": "use", "reaches": ["board"], "lasts": {"unit": "day", "count": 1}, "gimmick": {"kind": "ward", "upTo": "common"}}]');
  if why is distinct from 'card "poison" is a use card and reaches a board; a use card reaches a post, a character or a thread' then raise exception 'a use card reaching a board: %', why; end if;

  why := card_kinds_problem('[{"key": "poison", "rarity": "common", "play": "use", "gimmick": {"kind": "ward", "upTo": "common"}}]');
  if why is distinct from 'card "poison" is a use card with no time up (lasts); a use card ends at its time' then raise exception 'a use card with no lasts: %', why; end if;

  why := card_kinds_problem('[{"key": "poison", "rarity": "common", "play": "use", "lasts": {"unit": "day", "count": 7}, "gimmick": {"kind": "hex"}}]');
  if why is distinct from 'card "poison" has a gimmick of kind "hex"; a gimmick is ward, earn or price' then raise exception 'a gimmick of no kind: %', why; end if;

  why := card_kinds_problem('[{"key": "poison", "rarity": "common", "play": "use", "lasts": {"unit": "day", "count": 7}, "gimmick": "ward"}]');
  if why is distinct from 'card "poison" has a gimmick that is not an object' then raise exception 'a gimmick that is not an object: %', why; end if;

  why := card_kinds_problem('[{"key": "poison", "rarity": "common", "play": "cast", "trap": {"trigger": {"on": "cast"}}}]');
  if why is distinct from 'card "poison" has a trap, and only a set card has one' then raise exception 'a trap on a cast card: %', why; end if;

  why := card_kinds_problem('[{"key": "poison", "rarity": "common", "play": "set", "trap": {"trigger": {"on": "reply"}}}]');
  if why is distinct from 'card "poison" springs on "reply"; a set card springs on cast or visit' then raise exception 'a trap on a reply: %', why; end if;

  -- A JSON null trap is as absent as no key, so a set card seeded with trap: null has no trap. A JSON null gimmick is as the engine reads it: present, so not an object on a use card, and a gimmick on a card that is not one.
  why := card_kinds_problem('[{"key": "poison", "rarity": "common", "play": "set", "trap": null}]');
  if why is distinct from 'card "poison" is a set card with no trap' then raise exception 'a null trap: %', why; end if;
  why := card_kinds_problem('[{"key": "poison", "rarity": "common", "play": "use", "lasts": {"unit": "day", "count": 7}, "gimmick": null}]');
  if why is distinct from 'card "poison" has a gimmick that is not an object' then raise exception 'a null gimmick on a use card: %', why; end if;
  why := card_kinds_problem('[{"key": "poison", "rarity": "common", "play": "cast", "gimmick": null}]');
  if why is distinct from 'card "poison" has a gimmick, and only a use card has one' then raise exception 'a null gimmick on a cast card: %', why; end if;
end $$;

-- ---- seed_instance writes the gimmick and the trap's match, and refuses the poisons by name ----
do $$
declare
  why text;
  gim jsonb := '{"kind": "ward", "flavors": ["salty"]}';
begin
  perform seed_instance(jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', jsonb_build_array(
    jsonb_build_object('key', 'ct-sieve', 'name', 'Ct Sieve', 'alignment', 'sweet', 'rarity', 'common', 'play', 'use', 'gimmick', gim, 'lasts', '{"unit": "day", "count": 7}'::jsonb),
    jsonb_build_object('key', 'ct-rev', 'name', 'Ct Rev', 'alignment', 'salty', 'rarity', 'uncommon', 'play', 'set', 'trap', '{"trigger": {"on": "cast"}, "match": {"flavors": ["sweet"], "upTo": "uncommon"}}'::jsonb),
    jsonb_build_object('key', 'ct-move', 'name', 'Ct Move', 'alignment', 'salty', 'rarity', 'common'))));
  if (select gimmick from card_kinds where key = 'ct-sieve') is distinct from gim then raise exception 'the seed wrote the gimmick: %', (select gimmick from card_kinds where key = 'ct-sieve'); end if;
  if (select gimmick from card_kinds where key = 'ct-move') is not null or (select gimmick from card_kinds where key = 'ct-rev') is not null then raise exception 'a card but a use card has no gimmick'; end if;
  if (select trap #> '{match,upTo}' from card_kinds where key = 'ct-rev') is distinct from '"uncommon"'::jsonb or (select trap #> '{match,flavors}' from card_kinds where key = 'ct-rev') is distinct from '["sweet"]'::jsonb then
    raise exception 'the trap carries its match: %', (select trap from card_kinds where key = 'ct-rev');
  end if;
  -- Re-seeded without a gimmick (the card changed play), the row loses it: a use card's gimmick is the seed's, as its trap is.
  perform seed_instance(jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', jsonb_build_array(
    jsonb_build_object('key', 'ct-sieve', 'name', 'Ct Sieve', 'alignment', 'sweet', 'rarity', 'common'))));
  if (select gimmick from card_kinds where key = 'ct-sieve') is not null then raise exception 'a re-seed kept a gimmick the card no longer has'; end if;

  why := pg_temp.refusal($s$select seed_instance('{"settings": {}, "classes": [], "boards": [], "cards": [{"key": "ct-bad", "name": "Ct Bad", "alignment": "sweet", "rarity": "common", "play": "use", "lasts": {"unit": "day", "count": 7}}]}')$s$);
  if why is distinct from 'card "ct-bad" is a use card with no gimmick' then raise exception 'the seed refused a use card with no gimmick, said %', why; end if;
  why := pg_temp.refusal($s$select seed_instance('{"settings": {}, "classes": [], "boards": [], "cards": [{"key": "ct-bad", "name": "Ct Bad", "alignment": "sweet", "rarity": "common", "play": "set"}]}')$s$);
  if why is distinct from 'card "ct-bad" is a set card with no trap' then raise exception 'the seed refused a set card with no trap, said %', why; end if;
  why := pg_temp.refusal($s$select seed_instance('{"settings": {}, "classes": [], "boards": [], "cards": [{"key": "ct-bad", "name": "Ct Bad", "alignment": "sweet", "rarity": "common", "gimmick": {"kind": "ward", "upTo": "common"}}]}')$s$);
  if why is distinct from 'card "ct-bad" has a gimmick, and only a use card has one' then raise exception 'the seed refused a gimmick on a cast card, said %', why; end if;
end $$;

-- ---- card_target and reach_effects carry a live use card's gimmick, and no ward ----
do $$
declare
  ann uuid := tests.account('ct-ann');
  a uuid := tests.character(ann, 'Ct Ann');
  t uuid := tests.thread('Ct');
  p uuid := tests.post(a, t, 'Shielded.');
  q uuid := tests.post(a, t, 'Glinted.');
  gim jsonb := '{"kind": "ward", "upTo": "uncommon"}';
  played jsonb;
  eff jsonb;
begin
  insert into card_kinds (key, name, alignment, rarity, play, lasts, reaches, gimmick) values
    ('ct-shield', 'Ct Shield', 'sweet', 'uncommon', 'use', interval '7 days', '{post,character}', gim);
  insert into card_ledger (account, card, kind, price) values (ann, 'ct-shield', 'bought', 0), (ann, 'ct-shield', 'bought', 0);
  perform tests.become_service();
  played := play_card(ann, 'ct-shield', a, p, '{}', 0, '');
  eff := card_target(p) -> 'effects' -> 0;
  if eff -> 'gimmick' is distinct from gim then raise exception 'card_target carries the gimmick: %', card_target(p); end if;
  if eff ? 'ward' then raise exception 'card_target still carries a ward: %', eff; end if;
  played := play_card(ann, 'ct-shield', a, a, '{}', 0, '', 'character', q);
  eff := reach_effects('character', a) -> 0;
  if eff -> 'gimmick' is distinct from gim or eff ? 'ward' then raise exception 'reach_effects carries the gimmick: %', reach_effects('character', a); end if;
  perform tests.unbecome();
end $$;
