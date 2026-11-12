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
--
-- The awards that could not be given (0206's trophy_award_failures) get a way to be finished. An award given by hand through give_failed_award is a row of
-- trophy_failure_resolutions (append-only, one per failure and character, naming the award and the admin's account, which no client reads), so the failure's list says
-- which characters have had theirs: a second give is refused. trophy_award_failures is replaced by a paged read, {failures, more}, each failure's characters with `given`
-- and `open` (a character is still owed an award, or the characters cannot be read now). A resolution counts only while its award is not taken back: a reversed hand-given award is owed again and can be given again. The list puts the open failures first, and each group newest first. Its cursor is the last row's
-- at, id and open. An open failure costs nothing to place (no resolution row means open); only a failure an admin has begun to resolve reads its roster to be placed.

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

-- The characters an award that failed was for, each with the kind it gives: a met demand's contributors get the demand's kind, a season's places 1 to 3 the kind of
-- their place. Null where a demand cannot be read now (demand_contributors raised), so one failure never makes the admin's read of every other fail.
create function trophy_failure_roster(of_failure uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  f trophy_award_failures;
begin
  select * into f from trophy_award_failures x where x.id = of_failure;
  if not found then return null; end if;
  if f.move_act is not null then
    return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'trophy', (select k.key from trophy_kinds k where k.demand_met)) order by c.name)
                     from characters c where c.id = any (demand_contributors(f.move_act))), '[]'::jsonb);
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.character, 'name', r.name, 'place', r.place, 'trophy', (select k.key from trophy_kinds k where k.season_place = r.place))
                   order by r.place, r.name) from season_results r where r.season = f.season and r.place <= 3), '[]'::jsonb);
exception when others then
  return null;
end $$;
revoke execute on function trophy_failure_roster(uuid) from public, anon, authenticated;

-- An admin giving an award that failed, by hand: the failure's own kind to a character it was for, recorded in the same transaction. The failure's row is locked first, so
-- two admins giving the same award serialize and the second is refused.
create table trophy_failure_resolutions (
  failure uuid not null references trophy_award_failures (id),
  character uuid not null references characters (id),
  award uuid not null references trophy_awards (id),
  at timestamptz not null default now(),
  by uuid not null references accounts (id),
  primary key (award)
);
create index trophy_failure_resolutions_by_failure on trophy_failure_resolutions (failure, character);

-- Whether a failure's character has its award now: a resolution counts only while its award has not been taken back, so a reversed hand-given award is owed again.
create function trophy_failure_given(of_failure uuid, of_character uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from trophy_failure_resolutions r where r.failure = of_failure and r.character = of_character
                 and not exists (select 1 from trophy_reversals v where v.award = r.award));
$$;
revoke execute on function trophy_failure_given(uuid, uuid) from public, anon, authenticated;
create trigger trophy_failure_resolutions_no_update before update or delete on trophy_failure_resolutions for each row execute function ledger_append_only();
create trigger trophy_failure_resolutions_no_truncate before truncate on trophy_failure_resolutions for each statement execute function ledger_append_only();
alter table trophy_failure_resolutions enable always trigger trophy_failure_resolutions_no_update;
alter table trophy_failure_resolutions enable always trigger trophy_failure_resolutions_no_truncate;
alter table trophy_failure_resolutions enable row level security;
revoke all on trophy_failure_resolutions from public, anon, authenticated;

create function give_failed_award(failure uuid, of_character uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  roster jsonb;
  item jsonb;
  made jsonb;
begin
  perform only_admins('gives an award that could not be written');
  perform 1 from trophy_award_failures f where f.id = failure for update;
  if not found then raise exception 'there is no such failed award' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if trophy_failure_given(failure, of_character) then
    raise exception 'that award was already given to that character' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  roster := trophy_failure_roster(failure);
  if roster is null then raise exception 'the characters that award was for cannot be read now; give it from Award a trophy' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  select i into item from jsonb_array_elements(roster) i where i ->> 'id' = of_character::text;
  if item is null or item ->> 'trophy' is null then raise exception 'that character was not one the failed award was for' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  made := award_trophy(item ->> 'trophy', of_character);
  insert into trophy_failure_resolutions (failure, character, award, by) values (failure, of_character, (made ->> 'award')::uuid, signed_in_account());
  return made;
end $$;
revoke execute on function give_failed_award(uuid, uuid) from public, anon;
grant execute on function give_failed_award(uuid, uuid) to authenticated;

-- Whether a failure still owes an award: nothing resolved yet, or its characters cannot be read now, or one has not had theirs.
create function trophy_failure_open(of_failure uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  roster jsonb;
begin
  if not exists (select 1 from trophy_failure_resolutions r where r.failure = of_failure and not exists (select 1 from trophy_reversals v where v.award = r.award)) then return true; end if;
  roster := trophy_failure_roster(of_failure);
  if roster is null then return true; end if;
  return exists (select 1 from jsonb_array_elements(roster) i where not trophy_failure_given(of_failure, (i ->> 'id')::uuid));
end $$;
revoke execute on function trophy_failure_open(uuid) from public, anon, authenticated;

drop function trophy_award_failures();
drop function trophy_failure_characters(uuid);
create function trophy_award_failures(before timestamptz default null, most integer default 50, before_id uuid default null, before_open boolean default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  size integer := least(greatest(coalesce(most, 50), 1), 100);
begin
  perform only_admins('reads the trophies that could not be given');
  return (
    with ranked as (
      select f.id, f.at, o.open, row_number() over (order by o.open desc, f.at desc, f.id desc) as n
      from trophy_award_failures f, lateral (select trophy_failure_open(f.id) as open) o
    ), page as (
      select r.id, r.open, row_number() over (order by r.n) as n from ranked r
      where before is null or (not r.open and coalesce(before_open, false))
         or (r.open = coalesce(before_open, false) and (r.at < before or (r.at = before and before_id is not null and r.id < before_id)))
      order by r.n limit size + 1
    )
    select jsonb_build_object(
      'failures', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'move', f.move_act, 'season', (select s.number from seasons s where s.id = f.season), 'at', f.at, 'error', f.error,
        'trophy', case when f.move_act is not null then (select k.key from trophy_kinds k where k.demand_met) end, 'open', p.open,
        'characters', (select jsonb_agg((c - 'trophy') || jsonb_build_object('given', trophy_failure_given(f.id, (c ->> 'id')::uuid)) order by o.n)
                       from trophy_failure_roster(f.id) r, jsonb_array_elements(r) with ordinality o(c, n))) order by p.n)
        from page p join trophy_award_failures f on f.id = p.id where p.n <= size), '[]'::jsonb),
      'more', exists (select 1 from page p where p.n > size)));
end $$;
revoke execute on function trophy_award_failures(timestamptz, integer, uuid, boolean) from public, anon;
grant execute on function trophy_award_failures(timestamptz, integer, uuid, boolean) to authenticated;
