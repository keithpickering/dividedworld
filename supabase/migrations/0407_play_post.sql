-- play_post: a row for each play on a post, kept from one definition (docs/plans/2026-11-21-post-plays-plan.md, Task 1; design docs/plans/2026-11-21-post-plays-design.md, sections 1 and 2).
-- A play is a `card` Act, or a `set` Act (a card face down), that targets a post. The row is the play's state, not the play: no Act is touched ("Append-only"). It holds the post, the kind (the card's key, or the empty string for a back, which never
-- names the card it hides), the reach, when it was played, its end by time (`ends_at`), the moment an event ended it (`over_at`), whether it took, whether a back sprang, how much it has drawn, and, for a back that sprang into a lockout, when
-- that lockout ends (`lock_until`). A play is in force while `over_at` is null and `ends_at` is null or ahead; a sprung back is over, and `lock_until` is only what the page reads to keep it up while its lockout is (it joins no stack, limit or count). The page's reads (Task 3) and the stack's up count are held to it by play_post_drift(), a check, never trusted.
--
--   1. play_post             the table: one row for each play. Row-level security on, nothing granted to an API role; it is read only through functions, as play_reach is.
--   2. play_row              the one definition: a play's row, computed from the Acts and the rows beside them. Null for an Act that is no play. The list of every way a play ends is in its header, beside the predicate it mirrors.
--   3. refresh_play_post     upserts play_row's answer (a null answer is no row), and a drive play's mates with it (their drive's close moved). Task 2 adds the counts to it.
--   4. the triggers          `after insert`, each naming the plays an insert touched and calling refresh_play_post; they hold no rule. On acts, face_down, card_write_refunds and play_reach. They catch write_staff_act's raw `card` Acts too,
--                            which play_reach misses.
--   5. the indexes, the backfill
--   6. play_post_drift       every kept row that differs from play_row, every play with no row and every row with no play; granted to service_role alone. A function, so an admin can ask a deployed instance.
--
-- Ways out: nothing here is a state a player is in; the row follows the Acts. A play ends by itself at its time, or by an event (play_row's list), and the row says so.
-- Masks: every column is a public fact of public Acts (a back's row names no card; `took` and `sprung` are public: the refund and the spring are public Acts or rows), and the table is read only through definer functions.
-- Cost at a busy instance's scale: each play, each end and each refund writes one more row; an acts insert of any other kind runs no trigger (a WHEN clause). A drive play's insert or end refreshes the play's drive mates, at most the drive's stack.
-- play_row's probes are each an index lookup (acts_pierce_by, acts_cut_play, the card_end and spring probes by target and `set`).

-- ---- 1. play_post ----

create table play_post (
  play uuid primary key references acts (id),
  post uuid not null references acts (id),
  -- The card's key, or the empty string for a back; it never holds a back's card.
  kind text not null,
  reach text not null,
  played_at timestamptz not null,
  ends_at timestamptz,
  over_at timestamptz,
  took boolean not null,
  sprung boolean not null,
  drawn integer not null default 0 check (drawn >= 0),
  -- A back that sprang into a lockout: the spring's `until` (the owner's answer to #993, option a: the page keeps it up while the lockout is live). Null for every other play. It is not `ends_at`: the back stays over.
  lock_until timestamptz
);
alter table play_post enable row level security;
revoke all on play_post from public, anon, authenticated, service_role;

-- The plays on a post that hold a place, by their time.
create index play_post_up on play_post (post, ends_at) where over_at is null;
-- The sprung backs whose lockout the page keeps up while it is live: a handful of rows, read by post.
create index play_post_lock on play_post (post, lock_until) where lock_until is not null;

-- ---- 2. play_row ----

-- A play's row, computed from the Acts and the rows beside them, or null for an Act that is not a `card` or `set` with a target. Its fields are play_post's columns in order, the last being `lock_until`: a back's spring's `until` when that spring
-- is a lockout (`did: lockedOut`) that no admin's `card_end` has ended (lockout_ends, 0402), else null. It ends nothing (the back is over at its spring); the page reads it to keep the back up while the lockout is live.
--
-- Every way a play ends, and the predicate it mirrors. A new ender's author adds its line here, its trigger line below and its case to supabase/tests/0407-play-post.sql, or play_post_drift() names the play.
--   by time          a card's `ends` (payload), or play_reach.ends_at for a card reaching beyond a post, which writes no `ends`; a back's face_down.ends_at; a drive play's drive close (below).   -> ends_at
--   caught           a card Act with `caught` in its payload never landed (place_cast; the stack's count leaves it out).                                                                   -> over_at = played_at
--   instant          a card Act with `instant` in its payload is over as it lands (a relief, an unban, a card that cuts; the stack's count leaves it out).                                             -> over_at = played_at
--   an admin's end   a `card_end` Act that targets it                                                                                           (card_ended, 0405_cut.sql).               -> over_at = its created_at
--   a refund         a card_write_refunds row                                                                                                   (card_ended).                             -> over_at = its `at`
--   a spent pierce   the next card Act of its caster whose payload `pierce.by` names it, landed or caught                                       (card_ended; acts_pierce_by).             -> over_at = that Act's created_at
--   a cut            a landed card Act whose payload `cut.play` names it, that no card_end targets                                              (card_ended; card_cut_at, acts_cut_play). -> over_at = card_cut_at(play)
--   a spring         a back: a `spring` Act whose payload `set` names it                                                                        (place_set's live-back test, 0402_thread_lockout.sql). -> over_at = its created_at, `sprung`
--   a take-back      a back: a `take_back` Act whose payload `set` names it                                                                    (place_set's live-back test).             -> over_at = its created_at
--   (a back's time passing is `ends_at`, never `over_at`: a back is live while face_down.ends_at is ahead and neither a spring nor a take-back names it.)
-- The earliest of those is `over_at`. A drive play (a card whose kind has a `drive`) is in force while its drive is open, the drive closing the card's `lasts` after the latest play of the drive that is not over (place_cast's open drive: drive_plays);
-- so its `ends_at` is the least of its own end and that close, and every play of a drive has the same close. The drive's plays are those of the post and card whose payload `drive` is the same (a play that opened it names itself).
-- A play over only by time past its own `ends` is still counted in the close here, as an ended one is never read at a stored time; place_cast's drive_plays leaves it out at the moment it is asked, and a drive card holds no `lasts` of its own.
create function play_row(play uuid) returns play_post
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id, a.target_act_id,
         case when a.kind = 'card' then coalesce(a.payload ->> 'card', '') else '' end,
         case when a.kind = 'card' then coalesce(a.payload ->> 'reach', 'post') else 'post' end,
         a.created_at,
         case when a.kind = 'set' then f.ends_at
              else least((a.payload ->> 'ends')::timestamptz, pr.ends_at,
                         case when ck.drive is not null and coalesce(a.payload ->> 'reach', 'post') = 'post' and not (a.payload ? 'caught') then
                           (select coalesce(max(k.created_at) filter (where not card_ended(k.id)), max(k.created_at)) from acts k
                            where k.kind = 'card' and k.target_act_id = a.target_act_id and k.payload ->> 'card' = a.payload ->> 'card' and not (k.payload ? 'caught')
                              and coalesce(k.payload ->> 'reach', 'post') = 'post' and coalesce(k.payload ->> 'drive', k.id::text) = coalesce(a.payload ->> 'drive', a.id::text))
                           + span_interval(ck.drive -> 'lasts') end) end,
         case when a.kind = 'set' then
                least((select min(s.created_at) from acts s where s.kind = 'spring' and (s.payload ->> 'set') = a.id::text),
                      (select min(tb.created_at) from acts tb where tb.kind = 'take_back' and (tb.payload ->> 'set') = a.id::text))
              else
                least(case when a.payload ? 'caught' or a.payload ? 'instant' then a.created_at end,
                      (select min(e.created_at) from acts e where e.kind = 'card_end' and e.target_act_id = a.id),
                      rf.at,
                      (select min(c.created_at) from acts c where c.kind = 'card' and c.payload ? 'pierce' and (c.payload #>> '{pierce,by}') = a.id::text),
                      card_cut_at(a.id)) end,
         rf.play is null,
         a.kind = 'set' and exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = a.id::text),
         coalesce((select sum(t.count) from reaction_tallies t where t.act = a.id), 0)::integer + (select count(*) from threads th where th.origin_act_id = a.id)::integer,
         case when a.kind = 'set' then (select min((s.payload ->> 'until')::timestamptz) from acts s where s.kind = 'spring' and (s.payload ->> 'set') = a.id::text and s.payload ->> 'did' = 'lockedOut'
                                                                   and not exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = s.id)) end
  from acts a
  left join face_down f on f.play = a.id and a.kind = 'set'
  left join play_reach pr on pr.play = a.id and a.kind = 'card'
  left join card_write_refunds rf on rf.play = a.id and a.kind = 'card'
  left join card_kinds ck on ck.key = a.payload ->> 'card' and a.kind = 'card'
  where a.id = play_row.play and a.kind in ('card', 'set') and a.target_act_id is not null
$$;
revoke execute on function play_row(uuid) from public, anon, authenticated, service_role;

-- ---- 3. refresh_play_post ----

-- Writes play_row's answer for a play (a null answer is no row), and, for a play of a drive card, the same for each of the drive's other plays: their close moved with this one. `mates` is false for those calls.
create function refresh_play_post(play uuid, mates boolean default true) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r play_post;
  mate uuid;
begin
  if play is null then return; end if;
  r := play_row(play);
  if r.play is null then
    delete from play_post p where p.play = refresh_play_post.play;
    return;
  end if;
  insert into play_post (play, post, kind, reach, played_at, ends_at, over_at, took, sprung, drawn, lock_until)
  values (r.play, r.post, r.kind, r.reach, r.played_at, r.ends_at, r.over_at, r.took, r.sprung, r.drawn, r.lock_until)
  on conflict on constraint play_post_pkey do update set post = excluded.post, kind = excluded.kind, reach = excluded.reach, played_at = excluded.played_at, ends_at = excluded.ends_at,
    over_at = excluded.over_at, took = excluded.took, sprung = excluded.sprung, drawn = excluded.drawn, lock_until = excluded.lock_until;
  if mates and r.reach = 'post' and exists (select 1 from card_kinds ck where ck.key = r.kind and ck.drive is not null) then
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

-- ---- 4. the triggers ----

-- On acts: each line names the plays the insert touched. A new ender adds its line here (and to play_row's header).
create function play_post_on_act() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.kind in ('card', 'set') then
    -- The play itself (a card whose kind has a drive also refreshes the drive's other plays, inside refresh_play_post).
    if new.target_act_id is not null then perform refresh_play_post(new.id); end if;
    -- The pierce this card spent.
    if new.kind = 'card' and new.payload ? 'pierce' then perform refresh_play_post((new.payload #>> '{pierce,by}')::uuid); end if;
    -- The Gimmick this card cut.
    if new.kind = 'card' and new.payload ? 'cut' then perform refresh_play_post((new.payload #>> '{cut,play}')::uuid); end if;
  elsif new.kind = 'card_end' then
    -- The play the admin ended, and what it cut: an admin's end of a cutting play brings the cut play back.
    perform refresh_play_post(new.target_act_id);
    -- A lockout's spring an admin ended: the back it names holds no lockout now (lock_until).
    perform refresh_play_post((t2.payload ->> 'set')::uuid) from acts t2 where t2.id = new.target_act_id and t2.kind = 'spring';
    perform refresh_play_post((t.payload #>> '{cut,play}')::uuid) from acts t where t.id = new.target_act_id and t.kind = 'card' and t.payload ? 'cut';
  else
    -- A spring and a take-back: the back they name.
    perform refresh_play_post((new.payload ->> 'set')::uuid);
  end if;
  return null;
end $$;
revoke execute on function play_post_on_act() from public, anon, authenticated, service_role;
create trigger play_post_on_act after insert on acts for each row when (new.kind in ('card', 'set', 'card_end', 'spring', 'take_back')) execute function play_post_on_act();

-- On face_down: place_set writes the Act, then this row, so the Act's own trigger ran before the back's time existed.
create function play_post_on_face_down() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform refresh_play_post(new.play);
  return null;
end $$;
revoke execute on function play_post_on_face_down() from public, anon, authenticated, service_role;
create trigger play_post_on_face_down after insert on face_down for each row execute function play_post_on_face_down();

-- On card_write_refunds: the play it ends.
create function play_post_on_refund() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform refresh_play_post(new.play);
  return null;
end $$;
revoke execute on function play_post_on_refund() from public, anon, authenticated, service_role;
create trigger play_post_on_refund after insert on card_write_refunds for each row execute function play_post_on_refund();

-- On play_reach: a card beyond a post writes no `ends` in its Act, and place_cast writes this row after the Act.
create function play_post_on_reach() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform refresh_play_post(new.play);
  return null;
end $$;
revoke execute on function play_post_on_reach() from public, anon, authenticated, service_role;
create trigger play_post_on_reach after insert on play_reach for each row execute function play_post_on_reach();

-- ---- 5. the backfill ----

insert into play_post select r.* from acts a cross join lateral play_row(a.id) r where a.kind in ('card', 'set') and a.target_act_id is not null;

-- ---- 6. play_post_drift ----

-- Every play whose kept row differs from play_row, every play on a post with no row, and every row whose Act is no play. Empty when the triggers hold. The service role's alone: no client calls it.
create function play_post_drift() returns table (play uuid, why text)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.play, case when (play_row(p.play)).play is null then 'a row for an Act that is no play' else 'the row differs from play_row' end
  from play_post p where p is distinct from play_row(p.play)
  union all
  select a.id, 'a play with no row'
  from acts a where a.kind in ('card', 'set') and a.target_act_id is not null and not exists (select 1 from play_post p where p.play = a.id)
$$;
revoke execute on function play_post_drift() from public, anon, authenticated;
grant execute on function play_post_drift() to service_role;
