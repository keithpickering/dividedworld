-- A bar changes nothing the others can see of the account's characters (the conduct plan, Task 4; the design's rule that a response never
-- proves a private fact): characters_public, presence_listed, standings, current_standings and character_profiles give the same rows for a
-- suspended or banned account's characters as they did before, read as another player where a player may read them and, for the two a player reads only through the screens' functions, as the harness.
--
-- Left out of the comparison: presence_listed's place_since, online_since and seen_at, which are activity (when the character last moved or
-- was seen) and move with the clock whether or not anything was decided; nothing else is excluded.
--
-- The poison, driven red once: a trigger that marks the character in characters_public when its account is suspended (here, a rename)
-- must be caught by the same check, which is run over it in the second half of this file.

-- The rows the four relations show for one character, as one value, with the activity columns left out.
create function tests.quiet_snapshot(ch uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'characters_public', (select coalesce(jsonb_agg(to_jsonb(c) order by c.id::text), '[]') from characters_public c where c.id = ch),
    'standings', (select coalesce(jsonb_agg(to_jsonb(s) order by s.season), '[]') from standings s where s."character" = ch),
    'current_standings', (select coalesce(jsonb_agg(to_jsonb(s)), '[]') from current_standings s where s."character" = ch))
$$;
grant execute on function tests.quiet_snapshot(uuid) to authenticated;

-- The two relations a player reads only through the screens' functions, which read them as their owner: read directly, as the harness.
create function tests.quiet_internal(ch uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'presence_listed', (select coalesce(jsonb_agg(to_jsonb(p) - 'place_since' - 'online_since' - 'seen_at' order by p.id::text), '[]') from presence_listed p where p.id = ch),
    'character_profiles', (select coalesce(jsonb_agg(to_jsonb(r)), '[]') from character_profiles r where r."character" = ch))
$$;

-- The snapshot as another player and as the harness, together.
create function tests.quiet_both(ch uuid, viewer uuid) returns jsonb language plpgsql as $$
declare as_viewer jsonb; as_harness jsonb;
begin
  as_harness := tests.quiet_snapshot(ch) || tests.quiet_internal(ch);
  perform tests.become(viewer);
  as_viewer := tests.quiet_snapshot(ch);
  perform tests.unbecome();
  return jsonb_build_object('viewer', as_viewer, 'harness', as_harness);
end $$;

do $$
declare
  admin_a uuid := tests.account('admin-a');
  suspended uuid := tests.account('suspended');
  banned uuid := tests.account('banned');
  viewer uuid := tests.account('viewer');
  ch_s uuid := tests.character(suspended, 'Sue');
  ch_b uuid := tests.character(banned, 'Ben');
  ch_v uuid := tests.character(viewer, 'Vic');
  th uuid := tests.thread('Quiet');
  before_s jsonb; before_b jsonb; after_s jsonb; after_b jsonb;
begin
  insert into admins (account) values (admin_a);
  insert into presence (character, place_kind, place, board, place_since, online_since, seen_at)
    select c, 'thread', th, (select board from threads where id = th), now(), now(), now() from unnest(array[ch_s, ch_b]) c;
  insert into character_profiles ("character", title, signature) values (ch_s, 'Sue''s title', 'sig'), (ch_b, 'Ben''s title', 'sig');

  before_s := tests.quiet_both(ch_s, viewer);
  before_b := tests.quiet_both(ch_b, viewer);
  -- The check has something to compare: the character is in each relation it can be.
  if jsonb_array_length(before_s -> 'viewer' -> 'characters_public') is distinct from 1
     or jsonb_array_length(before_s -> 'harness' -> 'presence_listed') is distinct from 1
     or jsonb_array_length(before_s -> 'harness' -> 'character_profiles') is distinct from 1
     or jsonb_array_length(before_s -> 'viewer' -> 'standings') is distinct from 1 then
    raise exception 'the snapshot is missing a relation''s row, so the comparison would be empty: %', before_s;
  end if;

  insert into conduct_decisions (account, admin, outcome, until, note) values (suspended, admin_a, 'suspend', now() + interval '3 days', 'quiet');
  insert into conduct_decisions (account, admin, outcome, note) values (banned, admin_a, 'ban', 'quiet');
  if account_bar(suspended) ->> 'kind' is distinct from 'suspended' or account_bar(banned) ->> 'kind' is distinct from 'banned' then
    raise exception 'the bars were not set';
  end if;
  after_s := tests.quiet_both(ch_s, viewer);
  after_b := tests.quiet_both(ch_b, viewer);
  if after_s is distinct from before_s then raise exception 'a suspension changed what the relations show of its characters: % then %', before_s, after_s; end if;
  if after_b is distinct from before_b then raise exception 'a ban changed what the relations show of its characters: % then %', before_b, after_b; end if;

  -- The poison: a decision that marks the character, which the same comparison must catch.
  create function tests.mark_suspended() returns trigger language plpgsql as $f$
  begin
    update characters set name = name || ' (suspended)' where owner = new.account;
    return new;
  end $f$;
  create trigger conduct_decisions_poison after insert on conduct_decisions for each row when (new.outcome = 'suspend') execute function tests.mark_suspended();
  before_s := tests.quiet_both(ch_v, admin_a);
  insert into conduct_decisions (account, admin, outcome, until, note) values (viewer, admin_a, 'suspend', now() + interval '3 days', 'poisoned');
  after_s := tests.quiet_both(ch_v, admin_a);
  if after_s is not distinct from before_s then raise exception 'the poisoned suspension (it renames the character) was not caught by the comparison'; end if;
end $$;
