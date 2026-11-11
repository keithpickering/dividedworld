-- The Boss's trophy award announces itself by name (the cosmetics plan, Task 5, a spec-review finding): system_line (0129), also filling a kind's derived `trophyName` and
-- `characterName` (engine/system/moves.ts AWARD_TROPHY), so `{move}` reads "the giving of the Pet trophy to Aw Ann". Everything else as 0129 wrote it.
create or replace function system_line(line_key text, move_kind text, params jsonb, staff_key text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  lines jsonb;
  words text;
  line text;
  boss_name text;
  boss_id uuid;
  board_name text := '';
  rule_words text := '';
  rule_board uuid;
  predicate_words text;
begin
  select s.value -> line_key into lines from settings s where s.key = 'systemLines';
  select s.value ->> move_kind into words from settings s where s.key = 'systemMoveWords';
  words := coalesce(words, 'a move');
  if jsonb_typeof(params) = 'object' then
    -- A kind that derives `groupName` gets the conferred group's name (its key where no row has it), for its words and for the line's `{move}`.
    if exists (select 1 from move_kinds k where k.key = move_kind and 'groupName' = any (k.derived)) then
      params := params || jsonb_build_object('groupName', coalesce((select g.name from group_kinds g where g.key = params ->> 'group'), params ->> 'group', ''));
    end if;
    -- A kind that derives `trophyName` and `characterName` (the Boss's trophy award) gets the trophy's name and the character's (the key, or nothing, where no row has it): both are public.
    if exists (select 1 from move_kinds k where k.key = move_kind and 'trophyName' = any (k.derived)) then
      params := params || jsonb_build_object(
        'trophyName', coalesce((select t.name from trophy_kinds t where t.key = params ->> 'trophy'), params ->> 'trophy', ''),
        'characterName', coalesce((select c.name from characters c where c.id = case when lower(params ->> 'character') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (params ->> 'character')::uuid end), ''));
    end if;
    words := fill_tokens(words, params);
    if lower(params ->> 'board') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      board_name := coalesce((select b.name from boards_now b where b.id = (params ->> 'board')::uuid), '');
    end if;
    if move_kind = 'setRule' then
      rule_board := case when lower(params ->> 'board') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (params ->> 'board')::uuid end;
      if rule_board is null then board_name := 'every board'; end if;
      select fill_tokens(x.plain, jsonb_build_object('param', coalesce(params #>> '{param}', ''))) into predicate_words from rule_predicates x where x.key = params ->> 'predicate';
      rule_words := case when rule_board is null then 'House Rule ' else 'Rule ' end
        || ((select count(*) from acts p where p.kind = 'move' and p.payload ->> 'kind' = 'setRule' and coalesce(p.payload #>> '{params,board}', '') = coalesce(rule_board::text, '')) + 1)::text
        || ': ' || coalesce(predicate_words, 'a rule');
    end if;
  end if;
  select c.name, c.id into boss_name, boss_id from characters c where c.staff = staff_key;
  if jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) > 0 and jsonb_typeof(lines -> 0) = 'string' then
    line := lines ->> floor(random() * jsonb_array_length(lines))::integer;
  else
    return words;
  end if;
  return fill_tokens(line, jsonb_build_object('boss', coalesce(boss_name, ''), 'board', board_name, 'move', words, 'rule', rule_words) || pronoun_tokens('boss', boss_id));
end $$;
