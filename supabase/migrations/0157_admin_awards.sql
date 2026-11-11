-- The trophies admin page's two reads (the cosmetics plan, Task 11), an admin's alone.
--
-- admin_awards: the page's lists in one read. `kinds` is every trophy kind there is, for the page's choice of what to award, with whether it is a belt and whether an admin made
-- it. `awards` is the recent awards, newest first, `most` of them (default 20, at least 1 and at most 100) after the cursor (`before`, `before_id`: the last award's at and id),
-- as {awards, kinds, more}. An award that was taken back is listed as taken back, so a reversal leaves the list's rows where they were and says what happened; the reversing
-- admin's account is never read here. `by` is trophy_given_by's plain words, as the character's own page says them (never which admin).
--
-- admin_character_named: the character an admin means by its name, as the name is kept (name_key folds case and lookalikes, so "pipewrench" finds "Pipewrench"), or null for
-- none. A staff character is never found, since it is never given a trophy, and a character that has not debuted is, since an admin may know it by name. Only its id and
-- name are answered, never who plays it. Both are the admin page's reads and nothing else's.

create function admin_awards(before timestamptz default null, most integer default 20, before_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  size integer := least(greatest(coalesce(most, 20), 1), 100);
begin
  perform only_admins('reads the trophies given');
  return (
    with page as (
      select a.id, a.at, row_number() over (order by a.at desc, a.id desc) as n from trophy_awards a
      where before is null or a.at < before or (before_id is not null and a.at = before and a.id < before_id)
      order by a.at desc, a.id desc
      limit size + 1
    )
    select jsonb_build_object(
      'awards', coalesce((select jsonb_agg(jsonb_build_object('award', a.id, 'trophy', a.trophy, 'name', k.name, 'art', k.art, 'belt', k.belt, 'character', a.character, 'to', c.name,
                            'by', trophy_given_by(a), 'at', a.at, 'line', a.line,
                            'reversed', exists (select 1 from trophy_reversals r where r.award = a.id)) order by p.n)
                          from page p join trophy_awards a on a.id = p.id join trophy_kinds k on k.key = a.trophy join characters c on c.id = a.character where p.n <= size), '[]'::jsonb),
      'kinds', coalesce((select jsonb_agg(jsonb_build_object('key', k.key, 'name', k.name, 'belt', k.belt, 'made', k.made_by is not null, 'art', k.art) order by k.name, k.key) from trophy_kinds k), '[]'::jsonb),
      'more', exists (select 1 from page p where p.n > size)));
end $$;
revoke execute on function admin_awards(timestamptz, integer, uuid) from public, anon;
grant execute on function admin_awards(timestamptz, integer, uuid) to authenticated;

create function admin_character_named(of_name text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform only_admins('looks a character up by name');
  return (select jsonb_build_object('id', c.id, 'name', c.name) from characters c where c.name_key = name_skeleton(btrim(coalesce(of_name, ''))) and c.staff is null);
end $$;
revoke execute on function admin_character_named(text) from public, anon;
grant execute on function admin_character_named(text) to authenticated;
