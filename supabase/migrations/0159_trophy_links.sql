-- Where a trophy came from, and how each reign of a belt began (the cosmetics plan, Task 10).
--
-- trophy_item (0154) also names the move an award came from, for a Boss's award and a met demand's: its Act, its thread and its number there, which is all the address of a
-- post needs, read from acts_public (a move is a public Act) and nothing else of the Act. A season's award keeps naming its season's number, an admin's names nothing. It
-- also says whether the character's posts show the award (`shown`, from trophies_shown: public, since a post shows it).
--
-- belt_lineage (0154) says how each reign began in the words trophy_item uses for who gave ("Name, the Boss", "an admin"; never which admin), and is paged as trophies_of is:
-- newest reign first, `most` of them (default 20, at least 1 and at most 100) after the cursor (`before`, `before_id`: the last reign's began and award), as {reigns, more}. A
-- reign's end is the next standing award of the kind, one probe of trophy_awards_by_trophy for each reign on the page, so a belt passed many times costs a page, not its history.

-- Who gave an award in plain words, one place for trophy_item and belt_lineage.
create function trophy_given_by(a trophy_awards) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case a.by when 'season' then 'the season' when 'demand' then 'a met demand' when 'admin' then 'an admin'
           else coalesce((select c.name || ', the Boss' from acts x join characters c on c.id = x.character where x.id = a.act), 'the Boss') end
$$;
revoke execute on function trophy_given_by(trophy_awards) from public, anon, authenticated;

create or replace function trophy_item(a trophy_awards) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('award', a.id, 'trophy', a.trophy, 'name', k.name, 'line', coalesce(a.line, k.line), 'art', k.art, 'belt', k.belt, 'at', a.at,
    'by', trophy_given_by(a),
    'season', (select s.number from seasons s where s.id = a.season),
    'move', (select jsonb_build_object('act', x.id, 'thread', x.thread, 'seq', x.seq) from acts_public x where x.id = a.act and x.kind = 'move'),
    'shown', exists (select 1 from trophies_shown s where s.award = a.id),
    'held', case when k.belt then a.id = (select x.id from trophy_awards x where x.trophy = a.trophy
                                            and not exists (select 1 from trophy_reversals r where r.award = x.id)
                                          order by x.at desc, x.id desc limit 1) end)
  from trophy_kinds k where k.key = a.trophy
$$;

drop function belt_lineage(text);
create function belt_lineage(trophy_key text, before timestamptz default null, most integer default 20, before_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  is_belt boolean;
  size integer := least(greatest(coalesce(most, 20), 1), 100);
begin
  select k.belt into is_belt from trophy_kinds k where k.key = trophy_key;
  if is_belt is null then raise exception 'there is no trophy "%"', trophy_key using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if not is_belt then raise exception '"%" is not a belt', trophy_key using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  return (
    with page as (
      select a.id, row_number() over (order by a.at desc, a.id desc) as n from trophy_awards a
      where a.trophy = trophy_key
        and (before is null or a.at < before or (before_id is not null and a.at = before and a.id < before_id))
        and not exists (select 1 from trophy_reversals r where r.award = a.id)
      order by a.at desc, a.id desc
      limit size + 1
    )
    select jsonb_build_object(
      'reigns', coalesce((select jsonb_agg(jsonb_build_object('award', a.id, 'character', a.character, 'name', c.name, 'began', a.at, 'by', trophy_given_by(a),
                            'ended', (select x.at from trophy_awards x where x.trophy = trophy_key and (x.at, x.id) > (a.at, a.id)
                                        and not exists (select 1 from trophy_reversals r where r.award = x.id) order by x.at, x.id limit 1)) order by p.n)
                          from page p join trophy_awards a on a.id = p.id join characters c on c.id = a.character where p.n <= size), '[]'::jsonb),
      'more', exists (select 1 from page p where p.n > size)));
end $$;
revoke execute on function belt_lineage(text, timestamptz, integer, uuid) from public, anon;
grant execute on function belt_lineage(text, timestamptz, integer, uuid) to authenticated;
