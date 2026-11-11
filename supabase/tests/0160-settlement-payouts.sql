-- What the settlement reads and records for the card payouts (supabase/migrations/0151_card_payouts.sql, Task 5; docs/plans/2026-11-11-card-notes-part-6-plan.md, Task 5).
-- settlement_input sends a skim play's quadrant and end, the skim plays made before the window and still up in it (with their posts), for each Act reacted to that is a card on a post its ride
-- springs, the ride gimmick plays up when it was cast, and its post, and `scoredAs` (scored_as_plays: the plays made in the last settled window, the earliest per character, not ended by an admin).
-- apply_settlement writes the same characters to scored_as, once. estimate_input sends the same for the caller alone: a bystander's input holds none of the plays' extra Acts, and no key in anyone's
-- input ties a reaction to an owner but the caller's own. my_scored_as and log_page read the caller's own characters' rows; the table and scored_as_plays are no API role's.
-- Dates are in the fixtures' first season (2000), so the windows are this file's own. The cards are this file's own (ts...).

create function pg_temp.coded(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

create function pg_temp.cards() returns void language plpgsql as $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts, skim, scores_as, gimmick, stack) values
    ('tssk', 'Ts Skim', 'salty', 'uncommon', 'cast', null, '{post}', interval '7 days', '{"share": 0.1}', false, null, 4),
    ('tsrg', 'Ts Toll', 'salty', 'uncommon', 'use', null, '{post}', interval '7 days', null, false, '{"kind": "ride", "share": 0.5}', 4),
    ('tscs', 'Ts Cast', 'salty', 'uncommon', 'cast', null, '{post}', null, null, false, null, 4),
    ('tsof', 'Ts Off', 'salty', 'uncommon', 'cast', null, '{character}', interval '2 days', null, true, null, 5)
  on conflict (key) do nothing;
end $$;

create function pg_temp.entry(input jsonb, id uuid) returns jsonb language sql as $$
  select e from jsonb_array_elements(input -> 'acts') e where e ->> 'id' = id::text
$$;
create function pg_temp.ms(t timestamptz) returns bigint language sql as $$ select (extract(epoch from t) * 1000)::bigint $$;

-- A scored-as play made at `at` on a character, as place_cast writes one.
create function pg_temp.named(by_character uuid, target uuid, thread uuid, post uuid, class text, at timestamptz) returns uuid language plpgsql as $$
begin
  return tests.act(by_character, 'card', thread, jsonb_build_object('card', 'tsof', 'message', '', 'config', jsonb_build_object('class', class), 'reach', 'character', 'character', target,
    'ends', at + interval '2 days', 'starts', at + interval '1 day', 'targetName', 'x'), post, at);
end $$;

create function pg_temp.scored(input jsonb) returns text language sql as $$
  select coalesce(string_agg(s ->> 'character' || ':' || (s ->> 'class') || ':' || (s ->> 'play'), ',' order by s ->> 'character'), '') from jsonb_array_elements(input -> 'scoredAs') s
$$;

select tests.unbecome();
do $$
declare
  ann uuid := tests.account('ts-ann'); bob uuid := tests.account('ts-bob'); cat uuid := tests.account('ts-cat'); dan uuid := tests.account('ts-dan'); eve uuid := tests.account('ts-eve');
  a uuid := tests.character(ann, 'Ts Ann'); a2 uuid := tests.character(ann, 'Ts Ann Two'); b uuid := tests.character(bob, 'Ts Bob'); c uuid := tests.character(cat, 'Ts Cat');
  c2 uuid := tests.character(cat, 'Ts Cat Two'); d uuid := tests.character(dan, 'Ts Dan'); d2 uuid := tests.character(dan, 'Ts Dan Two'); e uuid := tests.character(eve, 'Ts Eve');
  x uuid := tests.character(dan, 'Ts Xavier'); y uuid := tests.character(dan, 'Ts Yolanda'); z uuid := tests.character(dan, 'Ts Zed');
  s1 constant timestamptz := (select min(starts_at) from seasons);
  w0 timestamptz; w1 timestamptz; ls timestamptz;
  t uuid := tests.thread('Ts thread');
  p_old uuid; sk_up uuid; sk_old uuid; sk_adm uuid; sk_caught uuid; sk_in uuid; cast_old uuid; cast_quiet uuid; sset uuid; sset2 uuid; spr uuid; spr_quiet uuid;
  tl_up uuid; tl_over uuid; tl_after uuid;
  off_b uuid; off_x uuid; off_y uuid; off_z uuid; off_a1 uuid; off_a2 uuid;
  input jsonb; est jsonb; got jsonb; applied jsonb; r jsonb; n bigint; why text; lp jsonb;
begin
  perform pg_temp.cards();
  if not exists (select 1 from settlements) then
    perform set_config('role', 'service_role', true);
    perform apply_settlement(s1, s1 + interval '1 day', '[]');
    perform tests.unbecome();
  end if;
  w0 := (select max(ends_at) from settlements); w1 := w0 + interval '1 day';
  ls := (select starts_at from settlements where ends_at = w0);
  p_old := tests.post(a, t, 'Old post.', w0 - interval '20 hours');

  -- Skim plays: one made before the window and still up; one that ended before it; one an admin ended; one caught; one made inside the window.
  sk_up := tests.act(b, 'card', t, jsonb_build_object('card', 'tssk', 'message', '', 'config', '{"quadrant": "excitedPositive"}'::jsonb, 'layer', 1, 'ends', w0 + interval '2 days'), p_old, w0 - interval '10 hours');
  sk_old := tests.act(b, 'card', t, jsonb_build_object('card', 'tssk', 'message', '', 'config', '{"quadrant": "calmPositive"}'::jsonb, 'layer', 2, 'ends', w0 - interval '1 hour'), p_old, w0 - interval '15 hours');
  sk_adm := tests.act(b, 'card', t, jsonb_build_object('card', 'tssk', 'message', '', 'config', '{"quadrant": "boredNegative"}'::jsonb, 'layer', 3, 'ends', w0 + interval '2 days'), p_old, w0 - interval '9 hours');
  sk_caught := tests.act(b, 'card', t, jsonb_build_object('card', 'tssk', 'message', '', 'config', '{"quadrant": "excitedNegative"}'::jsonb, 'layer', 4, 'ends', w0 + interval '2 days', 'caught', gen_random_uuid()::text), p_old, w0 - interval '8 hours');
  sk_in := tests.act(c, 'card', t, jsonb_build_object('card', 'tssk', 'message', '', 'config', '{"quadrant": "calmPositive"}'::jsonb, 'layer', 5, 'ends', w0 + interval '8 days'), p_old, w0 + interval '2 hours');
  perform set_config('kayfabb.card_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload, created_at) values (null, 'card_end', t, sk_adm, '{"why": "reversed", "by": "admin"}', w0 - interval '5 hours');
  perform set_config('kayfabb.card_end_writer', '', true);

  -- A cast on Ann's post, reacted to in the window, whose ride spring (Ann's back) is from an earlier window; and a cast no one reacted to, with its spring.
  cast_old := tests.act(c, 'card', t, jsonb_build_object('card', 'tscs', 'message', '', 'config', '{}'::jsonb, 'layer', 1), p_old, w0 - interval '5 hours');
  cast_quiet := tests.act(c, 'card', t, jsonb_build_object('card', 'tscs', 'message', '', 'config', '{}'::jsonb, 'layer', 2), p_old, w0 - interval '4 hours');
  sset := tests.act(a, 'set', t, '{}', p_old, w0 - interval '6 hours');
  sset2 := tests.act(a, 'set', t, '{}', p_old, w0 - interval '6 hours 1 minute');
  spr := tests.act(a, 'spring', t, jsonb_build_object('card', 'tstrap', 'trigger', 'cast', 'did', 'rode', 'set', sset::text, 'by', cast_old::text, 'quadrant', 'calmPositive'), p_old, w0 - interval '5 hours');
  spr_quiet := tests.act(a, 'spring', t, jsonb_build_object('card', 'tstrap', 'trigger', 'cast', 'did', 'rode', 'set', sset2::text, 'by', cast_quiet::text, 'quadrant', 'calmPositive'), p_old, w0 - interval '4 hours');
  -- Tolls on the post: one up when the cast was made; one that ended before it; one played after it.
  tl_up := tests.act(a, 'card', t, jsonb_build_object('card', 'tsrg', 'message', '', 'config', '{}'::jsonb, 'layer', 1, 'ends', w0 + interval '2 days'), p_old, w0 - interval '7 hours');
  tl_over := tests.act(a, 'card', t, jsonb_build_object('card', 'tsrg', 'message', '', 'config', '{}'::jsonb, 'layer', 2, 'ends', w0 - interval '6 hours'), p_old, w0 - interval '12 hours');
  tl_after := tests.act(a, 'card', t, jsonb_build_object('card', 'tsrg', 'message', '', 'config', '{}'::jsonb, 'layer', 3, 'ends', w0 + interval '2 days'), p_old, w0 - interval '1 hour');
  -- Reactions to the cast in the window: two masks of one player, and Ann's own.
  insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values
    (cast_old, d, dan, 'up', 1, w0 + interval '3 hours'), (cast_old, d2, dan, 'wow', 2, w0 + interval '4 hours'), (cast_old, a, ann, 'calm', 1, w0 + interval '5 hours');

  -- Plays that name a class: the window before the one under settlement is [ls, w0).
  off_b := pg_temp.named(a, b, t, p_old, 'beta', w0 - interval '1 hour');
  off_x := pg_temp.named(a, x, t, p_old, 'beta', w0 - interval '2 hours');
  off_y := pg_temp.named(a, y, t, p_old, 'beta', w0 - interval '3 hours');
  off_z := pg_temp.named(a, z, t, p_old, 'beta', w0 + interval '1 hour');
  off_a1 := pg_temp.named(b, a2, t, p_old, 'beta', w0 - interval '5 hours');
  off_a2 := pg_temp.named(b, a2, t, p_old, 'alpha', w0 - interval '4 hours');
  perform pg_temp.named(a, c2, t, p_old, 'beta', ls - interval '1 hour');
  perform set_config('kayfabb.card_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload, created_at) values (null, 'card_end', t, off_x, '{"why": "reversed", "by": "admin"}', w0 + interval '2 hours');
  insert into acts (character, kind, thread, target_act_id, payload, created_at) values (null, 'card_end', t, off_y, '{"why": "reversed", "by": "admin"}', w1 + interval '2 hours');
  perform set_config('kayfabb.card_end_writer', '', true);

  input := settlement_input(w0, w1);

  -- The skim plays: the one still up is carried with its quadrant and end; the three that are not, are not; the one made inside the window carries both too.
  got := pg_temp.entry(input, sk_up);
  if got is null or got ->> 'quadrant' is distinct from 'excitedPositive' or (got ->> 'ends')::bigint is distinct from pg_temp.ms(w0 + interval '2 days') or got ->> 'target' is distinct from p_old::text then
    raise exception 'a skim play made before the window and still up is not carried with its quadrant, end and post: %', got;
  end if;
  if pg_temp.entry(input, p_old) is null then raise exception 'the post a carried skim play is on is not in the input'; end if;
  if pg_temp.entry(input, sk_old) is not null then raise exception 'a skim play that ended before the window was carried'; end if;
  if pg_temp.entry(input, sk_adm) is not null then raise exception 'a skim play an admin ended was carried'; end if;
  if pg_temp.entry(input, sk_caught) is not null then raise exception 'a caught skim play was carried'; end if;
  got := pg_temp.entry(input, sk_in);
  if got is null or got ->> 'quadrant' is distinct from 'calmPositive' or (got ->> 'ends')::bigint is distinct from pg_temp.ms(w0 + interval '8 days') then raise exception 'a skim play made in the window does not carry its quadrant and end: %', got; end if;

  -- The ride: the cast reacted to is carried with the spring from the earlier window, its quadrant and what sprang it, and the gimmick that was up when it was cast; not the quiet cast's spring, nor the other Tolls.
  got := pg_temp.entry(input, spr);
  if got is null or got ->> 'by' is distinct from cast_old::text or got ->> 'quadrant' is distinct from 'calmPositive' or got ->> 'character' is distinct from a::text then raise exception 'a ride spring of an earlier window is not carried with its cast, quadrant and setter: %', got; end if;
  if pg_temp.entry(input, cast_old) is null then raise exception 'the cast a ride spring rode is not in the input'; end if;
  if pg_temp.entry(input, spr_quiet) is not null or pg_temp.entry(input, cast_quiet) is not null then raise exception 'a ride spring is carried when its cast drew no reaction in the window'; end if;
  got := pg_temp.entry(input, tl_up);
  if got is null or (got ->> 'ends')::bigint is distinct from pg_temp.ms(w0 + interval '2 days') or got ->> 'target' is distinct from p_old::text then raise exception 'the ride gimmick up when the reacted cast was made is not carried with its end: %', got; end if;
  if pg_temp.entry(input, tl_over) is not null or pg_temp.entry(input, tl_after) is not null then raise exception 'a ride gimmick that was not up when the cast was made was carried'; end if;

  -- scoredAs: the play made in the window before, the earliest per character, and none ended by an admin before the window's end; no other. A named character is in `characters` only where it is there already.
  if pg_temp.scored(input) is distinct from (select string_agg(k, ',' order by split_part(k, ':', 1)) from unnest(array[
       b || ':beta:' || off_b, a2 || ':beta:' || off_a1, y || ':beta:' || off_y]::text[]) k) then
    raise exception 'scoredAs is not the plays of the window before, earliest per character, none ended before the window''s end: %', input -> 'scoredAs';
  end if;
  if exists (select 1 from jsonb_array_elements(input -> 'characters') ch where ch ->> 'id' in (a2::text, y::text, x::text)) then raise exception 'a character named only by scoredAs is in characters'; end if;
  if not exists (select 1 from jsonb_array_elements(input -> 'characters') ch where ch ->> 'id' = b::text) then raise exception 'a named character that acts is not in characters'; end if;

  -- estimate_input (read before the window is settled) for the caster, the author and a bystander.
  est := estimate_input(bob, w1);
  if est is null or (est ->> 'windowStart')::timestamptz is distinct from w0 then raise exception 'the estimate window is not the open one: %', est -> 'window'; end if;
  got := pg_temp.entry(est, sk_up);
  if got is null or got ->> 'quadrant' is distinct from 'excitedPositive' or (got ->> 'ends')::bigint is distinct from pg_temp.ms(w0 + interval '2 days') then raise exception 'the caster''s estimate does not carry her live skim play with its quadrant and end: %', got; end if;
  if pg_temp.entry(est, p_old) is null then raise exception 'the caster''s estimate does not carry the post of her skim play'; end if;
  if pg_temp.scored(est) is distinct from b || ':beta:' || off_b then raise exception 'the caster''s estimate names scoredAs for others'' characters, or not hers: %', est -> 'scoredAs'; end if;
  if pg_temp.entry(est, spr) is not null or pg_temp.entry(est, tl_up) is not null or pg_temp.entry(est, cast_old) is not null then raise exception 'the caster''s estimate holds the ride''s Acts, which are not hers'; end if;

  est := estimate_input(ann, w1);
  got := pg_temp.entry(est, spr);
  if got is null or got ->> 'by' is distinct from cast_old::text or got ->> 'quadrant' is distinct from 'calmPositive' then raise exception 'the author''s estimate does not carry her ride spring: %', got; end if;
  if pg_temp.entry(est, cast_old) is null or pg_temp.entry(est, p_old) is null then raise exception 'the author''s estimate does not carry the cast her ride spring rode and its post'; end if;
  got := pg_temp.entry(est, tl_up);
  if got is null or (got ->> 'ends')::bigint is distinct from pg_temp.ms(w0 + interval '2 days') then raise exception 'the author''s estimate does not carry her ride gimmick with its end: %', got; end if;
  if pg_temp.entry(est, spr_quiet) is not null or pg_temp.entry(est, cast_quiet) is not null then raise exception 'the author''s estimate carries a ride spring whose cast drew no reaction'; end if;
  if pg_temp.scored(est) is distinct from a2 || ':beta:' || off_a1 then raise exception 'the author''s estimate''s scoredAs is not her own mask''s: %', est -> 'scoredAs'; end if;
  -- Every reaction but the caller's own is keyed per mask: two masks of one player are two voters, and none is the caller's key.
  if (select count(*) from jsonb_array_elements(est -> 'reactions') rx where rx ->> 'act' = cast_old::text) is distinct from 3::bigint then raise exception 'the estimate does not read the cast''s reactions: %', est -> 'reactions'; end if;
  if (select count(distinct rx ->> 'player') from jsonb_array_elements(est -> 'reactions') rx where rx ->> 'act' = cast_old::text and rx ->> 'player' is distinct from est ->> 'player') is distinct from 2::bigint
     or (select count(*) from jsonb_array_elements(est -> 'reactions') rx where rx ->> 'act' = cast_old::text and rx ->> 'player' = est ->> 'player' and rx ->> 'character' = a::text) is distinct from 1::bigint then
    raise exception 'a key in the estimate ties two masks of one player together, or the caller''s own reaction is not hers: %', est -> 'reactions';
  end if;
  if (select count(distinct (ch ->> 'player')) from jsonb_array_elements(est -> 'characters') ch where ch ->> 'player' is distinct from est ->> 'player')
     is distinct from (select count(*) from jsonb_array_elements(est -> 'characters') ch where ch ->> 'player' is distinct from est ->> 'player') then raise exception 'two characters that are not the caller''s share a player key'; end if;

  est := estimate_input(eve, w1);
  if est is null then raise exception 'no estimate for the bystander'; end if;
  if pg_temp.entry(est, sk_up) is not null or pg_temp.entry(est, sk_in) is not null or pg_temp.entry(est, spr) is not null or pg_temp.entry(est, tl_up) is not null
     or pg_temp.entry(est, cast_old) is not null or pg_temp.entry(est, p_old) is not null or (est -> 'scoredAs') is distinct from '[]'::jsonb then
    raise exception 'a bystander''s estimate holds the plays'' Acts: %', est;
  end if;

  -- settlement_input and apply_settlement agree: the characters in scoredAs are the rows written, once; a retry writes none.
  perform set_config('role', 'service_role', true);
  applied := apply_settlement(w0, w1, '[]');
  perform tests.unbecome();
  if applied ->> 'applied' is distinct from 'true' then raise exception 'the window was not applied: %', applied; end if;
  if (select string_agg(character || ':' || class_key || ':' || play, ',' order by character::text) from scored_as where settlement = (applied ->> 'settlement')::bigint)
     is distinct from pg_temp.scored(input) then raise exception 'scored_as is not what settlement_input said: %', (select jsonb_agg(to_jsonb(s)) from scored_as s); end if;
  perform set_config('role', 'service_role', true);
  applied := apply_settlement(w0, w1, '[]');
  perform tests.unbecome();
  if applied ->> 'reason' is distinct from 'already settled' then raise exception 'a retry did not answer already settled: %', applied; end if;
  if (select count(*) from scored_as where settlement = (select id from settlements where ends_at = w1)) is distinct from 3::bigint then raise exception 'a retried window wrote scored_as again'; end if;
  -- Append-only, and no API role's.
  if pg_temp.coded($q$update scored_as set class_key = 'alpha'$q$) not like 'P0001%' then raise exception 'scored_as was edited'; end if;
  if pg_temp.coded($q$delete from scored_as$q$) not like 'P0001%' then raise exception 'scored_as was removed from'; end if;
  perform tests.become(bob);
  why := pg_temp.coded($q$select count(*) from scored_as$q$);
  if why is null or why not like '42501%' then raise exception 'an API role read scored_as: %', why; end if;
  why := pg_temp.coded($q$select * from scored_as_plays(now() - interval '1 day', now())$q$);
  if why is null or why not like '42501%' then raise exception 'an API role called scored_as_plays: %', why; end if;
  -- my_scored_as: the caller's own characters' rows alone, with the settlement's window and the play's card; log_page sends them as scoredAs.
  if (select count(*) from my_scored_as) is distinct from 1::bigint or not exists (select 1 from my_scored_as m where m.character = b and m.named_class = 'beta' and m.card = 'tsof' and m.play = off_b and m.ends_at = w1 and m.starts_at = w0) then
    raise exception 'my_scored_as is not Bob''s own row: %', (select jsonb_agg(to_jsonb(m)) from my_scored_as m);
  end if;
  lp := log_page(null);
  if jsonb_array_length(lp -> 'scoredAs') is distinct from 1 or lp -> 'scoredAs' -> 0 ->> 'character' is distinct from b::text or lp -> 'scoredAs' -> 0 ->> 'card' is distinct from 'tsof' or lp -> 'scoredAs' -> 0 ->> 'named_class' is distinct from 'beta' then
    raise exception 'log_page does not send Bob''s scoredAs row: %', lp -> 'scoredAs';
  end if;
  perform tests.become(eve);
  if (select count(*) from my_scored_as) is distinct from 0::bigint or jsonb_array_length(log_page(null) -> 'scoredAs') is distinct from 0 then raise exception 'a player with no rows reads some'; end if;
  perform tests.unbecome();

end $$;
