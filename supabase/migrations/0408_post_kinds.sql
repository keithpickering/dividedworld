-- post_kinds: how many plays a post has had of each kind, and how many took; and the draw kept on play_post (docs/plans/2026-11-21-post-plays-plan.md, Task 2; design docs/plans/2026-11-21-post-plays-design.md, sections 1 and 2).
-- The count is the one the page's stack reads for a kind spent or full: a play counts where it is a card, or a back (kind '') that sprang; a back that ran out or was taken back unsprung is never counted. `took` counts those that took (no refund).
-- Like play_post it is kept, not trusted: play_post_drift() names every row that differs from the count of play_post, and every kind that should have a row and has none.
--
--   1. post_kinds            the table: (post, kind) with plays and took, took <= plays. Row-level security on, nothing granted to an API role.
--   2. play_post_move        moves a kind's counts by the difference between a play's old row and its new one. A second identical refresh moves nothing, in any order of refund, end and spring.
--   3. refresh_play_post     0407's, whole, with the counts (play_post_move) after its upsert and after a row's delete.
--   4. the draw              a trigger on reaction_tallies adds a tally's change to its play's `drawn`, and one on threads adds a spun thread; an Act that is no play updates nothing; neither reads `reactions` (who reacted stays private).
--                            react is the one writer of reaction_tallies and only adds, and threads are only inserted with their origin (spin); the triggers also take a count that falls and an origin set later by update, as a signed difference.
--   5. the backfill
--   6. play_post_drift       0407's, whole, with the two cases for the counts.
--
-- Ways out: nothing here is a state a player is in; the counts follow play_post, which follows the Acts.
-- Masks: a count of plays by kind and by took is a public fact of public Acts; `drawn` sums public tallies and spun threads, never who reacted.
-- Cost at a busy instance's scale: a play's insert and each end moves at most two rows of post_kinds (one at a post's kind); a reaction updates one play_post row by its primary key.

-- ---- 1. post_kinds ----

create table post_kinds (
  post uuid not null references acts (id),
  kind text not null,
  plays integer not null check (plays >= 0),
  took integer not null check (took >= 0 and took <= plays),
  primary key (post, kind)
);
alter table post_kinds enable row level security;
revoke all on post_kinds from public, anon, authenticated, service_role;

-- ---- 2. play_post_move ----

-- What a row counts: one play if it is a card (a kind), or a back that sprang; one took if it took. Null for no row counts nothing.
create function play_post_counts(r play_post) returns table (plays integer, took integer)
language sql immutable set search_path = public, pg_temp as $$
  select case when coalesce(r.kind <> '' or r.sprung, false) then 1 else 0 end,
         case when coalesce(r.kind <> '' or r.sprung, false) and coalesce(r.took, false) then 1 else 0 end
$$;
revoke execute on function play_post_counts(play_post) from public, anon, authenticated, service_role;

-- Moves the kinds' counts by what the new row counts less what the old one did. A play whose post or kind changed moves the old one's out of its key and the new one's into its own.
create function play_post_move(was play_post, now_row play_post) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  po integer; tk_o integer; pn integer; tk_n integer;
begin
  select c.plays, c.took into po, tk_o from play_post_counts(was) c;
  select c.plays, c.took into pn, tk_n from play_post_counts(now_row) c;
  if was.post is not distinct from now_row.post and was.kind is not distinct from now_row.kind then
    perform play_post_add(now_row.post, now_row.kind, pn - po, tk_n - tk_o);
  else
    if was.post is not null then perform play_post_add(was.post, was.kind, -po, -tk_o); end if;
    if now_row.post is not null then perform play_post_add(now_row.post, now_row.kind, pn, tk_n); end if;
  end if;
end $$;
revoke execute on function play_post_move(play_post, play_post) from public, anon, authenticated, service_role;

-- Adds signed counts to a (post, kind). A difference of zero writes nothing. A row is made only by a rise (a play counted), never by a fall; a row that reaches zero plays is deleted, so no row says zero.
create function play_post_add(p uuid, k text, dplays integer, dtook integer) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p is null or (dplays = 0 and dtook = 0) then return; end if;
  if dplays > 0 then
    insert into post_kinds (post, kind, plays, took) values (p, k, dplays, greatest(dtook, 0))
    on conflict (post, kind) do update set plays = post_kinds.plays + dplays, took = post_kinds.took + dtook;
  else
    update post_kinds set plays = plays + dplays, took = took + dtook where post = p and kind = k;
  end if;
  delete from post_kinds where post = p and kind = k and plays = 0 and took = 0;
end $$;
revoke execute on function play_post_add(uuid, text, integer, integer) from public, anon, authenticated, service_role;

-- ---- 3. refresh_play_post, with the counts ----

-- Writes play_row's answer for a play (a null answer is no row), and, for a play of a drive card, the same for each of the drive's other plays: their close moved with this one. `mates` is false for those calls.
create or replace function refresh_play_post(play uuid, mates boolean default true) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r play_post;
  was play_post;
  mate uuid;
  dkey text;
begin
  if play is null then return; end if;
  -- A play of a drive first takes one lock for the whole drive (its post, card and drive id, as play_row and the mates loop key it), so every refresh of one drive is in turn and the per-play locks taken inside never cross: an admin's end of A and a refund of B reach their mates in the same order.
  select format('play_drive:%s|%s|%s', a.target_act_id, a.payload ->> 'card', coalesce(a.payload ->> 'drive', a.id::text)) into dkey
  from acts a join card_kinds ck on ck.key = a.payload ->> 'card'
  where a.id = refresh_play_post.play and a.kind = 'card' and a.target_act_id is not null and ck.drive is not null and coalesce(a.payload ->> 'reach', 'post') = 'post' and not (a.payload ? 'caught');
  if dkey is not null then perform pg_advisory_xact_lock(hashtextextended(dkey, 0)); end if;
  -- Two refreshes of one play at once would each move the counts by the same difference: one at a time.
  perform pg_advisory_xact_lock(hashtextextended('play_post:' || play::text, 0));
  select * into was from play_post p where p.play = refresh_play_post.play;
  r := play_row(play);
  if r.play is null then
    delete from play_post p where p.play = refresh_play_post.play;
    perform play_post_move(was, null::play_post);
    return;
  end if;
  insert into play_post (play, post, kind, reach, played_at, ends_at, over_at, took, sprung, drawn, lock_until)
  values (r.play, r.post, r.kind, r.reach, r.played_at, r.ends_at, r.over_at, r.took, r.sprung, r.drawn, r.lock_until)
  on conflict on constraint play_post_pkey do update set post = excluded.post, kind = excluded.kind, reach = excluded.reach, played_at = excluded.played_at, ends_at = excluded.ends_at,
    over_at = excluded.over_at, took = excluded.took, sprung = excluded.sprung, drawn = excluded.drawn, lock_until = excluded.lock_until;
  perform play_post_move(was, r);
  if mates and r.reach = 'post' and exists (select 1 from card_kinds ck where ck.key = r.kind and ck.drive is not null) then
    -- Each mate is refreshed under the drive's lock taken above, so the per-play locks here are never waited on in two orders.
    for mate in
      select k.id from acts k
      where k.kind = 'card' and k.target_act_id = r.post and k.payload ->> 'card' = r.kind and k.id <> r.play and not (k.payload ? 'caught')
        and coalesce(k.payload ->> 'reach', 'post') = 'post'
        and coalesce(k.payload ->> 'drive', k.id::text) = (select coalesce(m.payload ->> 'drive', m.id::text) from acts m where m.id = r.play)
    loop
      perform refresh_play_post(mate, false);
    end loop;
  end if;
end $$;
revoke execute on function refresh_play_post(uuid, boolean) from public, anon, authenticated, service_role;

-- ---- 4. the draw ----

-- A tally's change is its play's change of `drawn`. A tally on an Act that is no play updates no row (play_post's primary key).
create function play_post_draw_tally() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare d integer;
begin
  if tg_op = 'INSERT' then d := new.count; else d := new.count - old.count; end if;
  -- The lock refresh_play_post holds while it reads play_row and writes `drawn`: a reaction that committed between its read and its write would be lost.
  if d <> 0 then
    perform pg_advisory_xact_lock(hashtextextended('play_post:' || new.act::text, 0));
    update play_post set drawn = drawn + d where play = new.act;
  end if;
  return null;
end $$;
revoke execute on function play_post_draw_tally() from public, anon, authenticated, service_role;
create trigger play_post_draw_tally_insert after insert on reaction_tallies for each row execute function play_post_draw_tally();
create trigger play_post_draw_tally_update after update of count on reaction_tallies for each row when (old.count is distinct from new.count) execute function play_post_draw_tally();

-- A thread spun from a play draws it by one. An origin set or changed by update is the same, signed.
create function play_post_draw_thread() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- The same lock as the tally's (refresh_play_post holds it).
  if tg_op = 'UPDATE' and old.origin_act_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('play_post:' || old.origin_act_id::text, 0));
    update play_post set drawn = drawn - 1 where play = old.origin_act_id;
  end if;
  if new.origin_act_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('play_post:' || new.origin_act_id::text, 0));
    update play_post set drawn = drawn + 1 where play = new.origin_act_id;
  end if;
  return null;
end $$;
revoke execute on function play_post_draw_thread() from public, anon, authenticated, service_role;
create trigger play_post_draw_thread_insert after insert on threads for each row when (new.origin_act_id is not null) execute function play_post_draw_thread();
create trigger play_post_draw_thread_update after update of origin_act_id on threads for each row when (old.origin_act_id is distinct from new.origin_act_id) execute function play_post_draw_thread();

-- ---- 5. the backfill ----

insert into post_kinds (post, kind, plays, took)
select p.post, p.kind, sum(c.plays), sum(c.took) from play_post p cross join lateral play_post_counts(p) c group by p.post, p.kind having sum(c.plays) > 0;

-- ---- 6. play_post_drift, with the counts ----

-- Every play whose kept row differs from play_row, every play on a post with no row, every row whose Act is no play; and every post_kinds row that differs from the count of play_post (a kind with no plays counted has no row, so a row of zero is named too), named by its post.
-- Empty when the triggers hold. The service role's alone: no client calls it.
create or replace function play_post_drift() returns table (play uuid, why text)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.play, case when (play_row(p.play)).play is null then 'a row for an Act that is no play' else 'the row differs from play_row' end
  from play_post p where p is distinct from play_row(p.play)
  union all
  select a.id, 'a play with no row'
  from acts a where a.kind in ('card', 'set') and a.target_act_id is not null and not exists (select 1 from play_post p where p.play = a.id)
  union all
  select coalesce(w.post, k.post), format('the counts of kind "%s" on this post are plays %s, took %s and should be plays %s, took %s', coalesce(w.kind, k.kind), coalesce(k.plays, 0), coalesce(k.took, 0), coalesce(w.plays, 0), coalesce(w.took, 0))
  from (select p.post, p.kind, sum(c.plays)::integer as plays, sum(c.took)::integer as took from play_post p cross join lateral play_post_counts(p) c group by p.post, p.kind having sum(c.plays) > 0) w
  full join post_kinds k on k.post = w.post and k.kind = w.kind
  where w.post is null or k.post is null or w.plays is distinct from k.plays or w.took is distinct from k.took
$$;
revoke execute on function play_post_drift() from public, anon, authenticated;
grant execute on function play_post_drift() to service_role;
