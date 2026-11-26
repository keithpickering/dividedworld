-- Rendered gear, Task 2 (docs/plans/2026-11-23-rendered-gear-plan.md; the design's section 6): a worn piece may name which view of its item it shows.

-- Null is the item's default view; which views an item ships is the instance's art, not held here. The five names are written three times: engine/rules/cosmetics.ts GEAR_VIEWS,
-- this column's check and piece_problem's list below; engine/rules/gear-views-held.test.ts holds all three to one.
alter table gear_worn add column view text check (view in ('side-left', 'three-quarter-left', 'front', 'three-quarter-right', 'side-right'));
comment on column gear_worn.view is 'Which view of the item the piece shows; null is the item''s default. Which views an item ships is the instance''s art, not held here.';

-- piece_problem (0205), now also checking a present view, after the turn and before the layer, as engine/rules/cosmetics.ts pieceProblem does. Everything else as 0205 wrote it.
create or replace function piece_problem(p jsonb, wore integer) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  within boolean;
begin
  if jsonb_typeof(p) is distinct from 'object' then return 'a piece is an object giving its gear, x, y, w, turn and layer'; end if;
  if jsonb_typeof(p -> 'gear') is distinct from 'string' then return 'a piece names its gear'; end if;
  if not coalesce(jsonb_typeof(p -> 'x') = 'number' and (p ->> 'x')::numeric between 0 and 1, false) then return 'a piece''s x is outside the portrait'; end if;
  if not coalesce(jsonb_typeof(p -> 'y') = 'number' and (p ->> 'y')::numeric between 0 and 1, false) then return 'a piece''s y is outside the portrait'; end if;
  if not coalesce(jsonb_typeof(p -> 'w') = 'number' and (p ->> 'w')::numeric between 0.05 and 1.5, false) then return 'a piece''s width is from 0.05 to 1.5 of the portrait''s width'; end if;
  if not coalesce(jsonb_typeof(p -> 'turn') = 'number' and (p ->> 'turn')::numeric between -180 and 180, false) then return 'a piece''s turn is from -180 to 180 degrees'; end if;
  if p ? 'view' and jsonb_typeof(p -> 'view') <> 'null' and (jsonb_typeof(p -> 'view') <> 'string' or (p ->> 'view') not in ('side-left', 'three-quarter-left', 'front', 'three-quarter-right', 'side-right')) then
    return 'a piece''s view is side-left, three-quarter-left, front, three-quarter-right or side-right';
  end if;
  if not setting_whole(p -> 'layer', 0, wore - 1) then return format('a piece''s layer is a whole number below %s', wore); end if;
  return null;
end $$;
revoke execute on function piece_problem(jsonb, integer) from public, anon, authenticated;

-- set_outfit (0205), now also writing each piece's view (a JSON null and a missing key both give SQL null). Everything else as 0205 wrote it.
create or replace function set_outfit(who uuid, through uuid, pieces jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  most integer;
  p jsonb;
  why text;
  problems text[] := '{}';
  g record;
  free integer;
begin
  select (s.value #>> '{gear,wornMost}')::integer into most from settings s where s.key = 'cosmetics';
  if most is null then raise exception 'this instance has no gear settings' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  -- The row first, then who plays it: a retirement committing between the two would otherwise find a retired mask dressed.
  perform 1 from characters where id = through and owner = who for no key update;
  perform played_by(through, who);
  if jsonb_typeof(pieces) is distinct from 'array' then raise exception 'an outfit is a list of pieces' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if jsonb_array_length(pieces) > most then
    raise exception '% pieces are worn; at most %', jsonb_array_length(pieces), most using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  for p in select e from jsonb_array_elements(pieces) e loop
    why := piece_problem(p, most);
    if why is not null then raise exception '%', why using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    if not exists (select 1 from gear_kinds k where k.key = p ->> 'gear') then
      raise exception 'there is no gear "%"', p ->> 'gear' using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
  end loop;
  perform pg_advisory_xact_lock(hashtext('kayfabb.outfit'), hashtext(who::text));
  -- Layer collisions come before copy shortfalls, as outfitProblems lists them.
  for g in
    select pc ->> 'gear' as gear, (pc ->> 'layer')::integer as layer, row_number() over (partition by (pc ->> 'layer')::integer order by ord) as n,
           first_value(pc ->> 'gear') over (partition by (pc ->> 'layer')::integer order by ord) as first
    from jsonb_array_elements(pieces) with ordinality t(pc, ord) order by ord
  loop
    if g.n > 1 then problems := problems || format('"%s" shares layer %s with "%s"', g.gear, g.layer, g.first); end if;
  end loop;
  for g in
    select pc ->> 'gear' as gear, count(*)::integer as here from jsonb_array_elements(pieces) pc group by pc ->> 'gear' order by pc ->> 'gear'
  loop
    -- The account's own characters to their pieces (characters_owner, then gear_worn's primary key), once per gear.
    free := greatest(0, gear_held(who, g.gear) - (select count(*) from characters c join gear_worn w on w.character = c.id
                                                  where c.owner = who and c.id <> through and w.gear = g.gear));
    if g.here > free then
      problems := problems || format('"%s" is worn %s time%s here, and %s %s free', g.gear, g.here, case when g.here = 1 then '' else 's' end,
        free, case when free = 1 then 'copy is' else 'copies are' end);
    end if;
  end loop;
  if cardinality(problems) > 0 then
    raise exception '%', array_to_string(problems, '; ') using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- A data-modifying CTE would meet its own delete's row at the same key, so the two statements are the function's transaction.
  delete from gear_worn where character = through;
  insert into gear_worn (character, layer, gear, x, y, w, turn, view)
  select through, (pc ->> 'layer')::integer, pc ->> 'gear', (pc ->> 'x')::numeric, (pc ->> 'y')::numeric, (pc ->> 'w')::numeric, (pc ->> 'turn')::numeric, pc ->> 'view'
  from jsonb_array_elements(pieces) pc;
  return jsonb_build_object('worn', jsonb_array_length(pieces));
end $$;
revoke execute on function set_outfit(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function set_outfit(uuid, uuid, jsonb) to service_role;

-- profile_projection (0206), each outfit piece also carrying its view. Everything else as 0206 wrote it.
create or replace function profile_projection(of_character uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('character', p.character, 'title', p.title, 'signature', p.signature,
    'avatar_square', p.avatar_square, 'avatar_portrait', p.avatar_portrait, 'square_frame', p.square_frame, 'portrait_frame', p.portrait_frame,
    'pip_style', p.pip_style, 'pronouns', p.pronouns, 'portrait_tallness', p.portrait_tallness,
    'outfit', coalesce((select jsonb_agg(jsonb_build_object('gear', w.gear, 'x', w.x, 'y', w.y, 'w', w.w, 'turn', w.turn, 'view', w.view, 'layer', w.layer) order by w.layer)
                        from gear_worn w where w.character = p.character), '[]'::jsonb),
    'trophies', trophy_shelf(p.character))
  from character_profiles p where p.character = of_character
$$;

-- profile_cosmetics (0210), each outfit piece also carrying its view. Everything else as 0210 wrote it.
create or replace function profile_cosmetics(of_character uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select case when exists (select 1 from characters_public c where c.id = of_character)
                or exists (select 1 from characters c where c.id = of_character and c.owner = auth.uid()) then
    jsonb_build_object(
      'portrait_tallness', (select p.portrait_tallness from character_profiles p where p.character = of_character),
      'outfit', coalesce((select jsonb_agg(jsonb_build_object('gear', w.gear, 'x', w.x, 'y', w.y, 'w', w.w, 'turn', w.turn, 'view', w.view, 'layer', w.layer) order by w.layer)
                          from gear_worn w where w.character = of_character), '[]'::jsonb),
      'trophies', trophy_shelf(of_character))
  else jsonb_build_object('portrait_tallness', null, 'outfit', '[]'::jsonb, 'trophies', '[]'::jsonb) end
$$;
revoke execute on function profile_cosmetics(uuid) from public, anon;
grant execute on function profile_cosmetics(uuid) to authenticated;
