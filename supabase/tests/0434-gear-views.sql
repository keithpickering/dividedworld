-- A worn piece's view (supabase/migrations/0434_gear_views.sql; the rendered gear plan, Task 2): set_outfit saves it, profile_cosmetics and profile_projection give it back,
-- a piece with none reads back null, a view that is not one of the five is refused in piece_problem's words, and the column's own check holds it too.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
declare hint text; msg text;
begin
  execute stmt;
  return null;
exception when others then
  get stacked diagnostics hint = pg_exception_hint;
  msg := sqlerrm;
  if hint is distinct from 'kayfabb.refusal' then return 'NOT A REFUSAL (' || coalesce(hint, 'no hint') || '): ' || msg; end if;
  return msg;
end $$;

create function pg_temp.error(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then return sqlerrm;
end $$;

select tests.unbecome();
insert into settings (key, value) values ('cosmetics', '{"gear": {"wornMost": 3, "reach": 0.4}, "trophies": {"shownMost": 3}, "events": {"windowMinutes": 15, "dayMost": 4, "outcomes": {"line": 70, "gear": 20, "card": 10}, "gearRarity": {"common": 80}, "cardRarity": {"common": 80}}}')
  on conflict (key) do update set value = excluded.value;
insert into gear_kinds (key, rarity) values ('gv-cap', 'common'), ('gv-scarf', 'common');

do $$
declare
  ann uuid := tests.account('gv-ann');
  a uuid := tests.character(ann, 'Gv Ann');
  said text; outfit jsonb; v text;
begin
  insert into gear_ledger (account, gear, kind) values (ann, 'gv-cap', 'granted'), (ann, 'gv-scarf', 'granted');
  insert into character_profiles (character) values (a);
  perform tests.become_service();
  perform set_outfit(ann, a, '[{"gear": "gv-cap", "x": 0.5, "y": 0.2, "w": 0.4, "turn": 0, "layer": 0, "view": "side-left"},
                               {"gear": "gv-scarf", "x": 0.5, "y": 0.7, "w": 0.4, "turn": 0, "layer": 1}]');
  if (select view from gear_worn where character = a and layer = 0) is distinct from 'side-left' then raise exception 'the view was not saved'; end if;
  if (select view from gear_worn where character = a and layer = 1) is not null then raise exception 'a piece with no view should keep none'; end if;
  outfit := profile_projection(a) -> 'outfit';
  if outfit #>> '{0,view}' is distinct from 'side-left' or outfit -> 1 -> 'view' is distinct from 'null'::jsonb then raise exception 'profile_projection: %', outfit; end if;
  perform tests.unbecome(); perform tests.become(ann);
  outfit := profile_cosmetics(a) -> 'outfit';
  if outfit #>> '{0,view}' is distinct from 'side-left' or outfit -> 1 -> 'view' is distinct from 'null'::jsonb then raise exception 'profile_cosmetics: %', outfit; end if;
  perform tests.unbecome(); perform tests.become_service();
  -- A JSON null is none, the same as a missing key.
  perform set_outfit(ann, a, '[{"gear": "gv-cap", "x": 0.5, "y": 0.2, "w": 0.4, "turn": 0, "layer": 0, "view": null}]');
  if (select view from gear_worn where character = a) is not null then raise exception 'a JSON null view should save as none'; end if;
  said := pg_temp.refusal(format($q$select set_outfit(%L, %L, '[{"gear": "gv-cap", "x": 0.5, "y": 0.2, "w": 0.4, "turn": 0, "layer": 0, "view": "back"}]')$q$, ann, a));
  if said is distinct from 'a piece''s view is side-left, three-quarter-left, front, three-quarter-right or side-right' then raise exception 'view back was not refused in words: %', said; end if;
  -- A view that is not a string is refused in the same words.
  said := pg_temp.refusal(format($q$select set_outfit(%L, %L, '[{"gear": "gv-cap", "x": 0.5, "y": 0.2, "w": 0.4, "turn": 0, "layer": 0, "view": 5}]')$q$, ann, a));
  if said is distinct from 'a piece''s view is side-left, three-quarter-left, front, three-quarter-right or side-right' then raise exception 'view 5 was not refused in words: %', said; end if;
  said := pg_temp.refusal(format($q$select set_outfit(%L, %L, '[{"gear": "gv-cap", "x": 0.5, "y": 0.2, "w": 0.4, "turn": 0, "layer": 0, "view": {}}]')$q$, ann, a));
  if said is distinct from 'a piece''s view is side-left, three-quarter-left, front, three-quarter-right or side-right' then raise exception 'view {} was not refused in words: %', said; end if;
  -- Each of the five names is accepted, so a typo in any one fails here.
  foreach v in array array['side-left', 'three-quarter-left', 'front', 'three-quarter-right', 'side-right'] loop
    perform set_outfit(ann, a, format('[{"gear": "gv-cap", "x": 0.5, "y": 0.2, "w": 0.4, "turn": 0, "layer": 0, "view": %s}]', to_jsonb(v))::jsonb);
    if (select view from gear_worn where character = a and layer = 0) is distinct from v then raise exception 'view % was not saved', v; end if;
  end loop;
  -- The turn is checked before the view, the view before the layer.
  said := pg_temp.refusal(format($q$select set_outfit(%L, %L, '[{"gear": "gv-cap", "x": 0.5, "y": 0.2, "w": 0.4, "turn": 999, "layer": 9, "view": "back"}]')$q$, ann, a));
  if said not like '%turn%' then raise exception 'the turn comes first: %', said; end if;
  said := pg_temp.refusal(format($q$select set_outfit(%L, %L, '[{"gear": "gv-cap", "x": 0.5, "y": 0.2, "w": 0.4, "turn": 0, "layer": 9, "view": "back"}]')$q$, ann, a));
  if said not like '%view%' then raise exception 'the view comes before the layer: %', said; end if;
  -- The column's own check.
  perform tests.unbecome();
  said := pg_temp.error(format($q$insert into gear_worn (character, layer, gear, x, y, w, turn, view) values (%L, 2, 'gv-scarf', 0.5, 0.5, 0.3, 0, 'back')$q$, a));
  if said is null or said not like '%check constraint%' then raise exception 'the column should refuse view back: %', said; end if;
end $$;
