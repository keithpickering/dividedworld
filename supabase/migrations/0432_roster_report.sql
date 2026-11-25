-- The Roster Report (docs/plans/2026-11-24-staff-board-threads-plan.md, Task 7; the design, section 5).
--
-- The season's thread (seasons.turns_thread) takes the Boss's entries: at each settlement with something to report, one entry holding a list built by the code, exact, under a line of commentary. Each list shows its first 25 and counts the rest ("and N more"); a newcomer only counted is written down as seen all the same, so a crowd of new faces is never listed by name later.
-- The list is the public's: new faces (a character's first public Act, listed once in its life), Turns announced in the window, Turns taking effect at the settlement (announced ones only), and reveals.
--
--   roster_entries      one row for each settlement window that has been looked at (primary key window_end, a foreign key to settlements.ends_at): its season, when it was written, the posts it holds (acts[]) and a
--                       record (the commentary or why it has none, what the call trimmed, the Turns that took effect: `landed` (the first 20) and `landedCount`, and `skipped` where nothing was posted and why).
--   roster_seen         the characters an entry has listed, so that each is listed once in its life; its `act` is the Act that made it a newcomer.
--                       Both are insert-only (guards firing always, as handoffs' are), and no API role reads or writes either.
--   roster_landed       the Turns taking effect at a window, from class_history and the announcement each links, shown as that announcement shows them (the class only where it named one).
--   roster_newcomers    the characters an entry would list as new for a window: those with a public Act in the window (or whose author veil ended in it) and no roster_seen row. Not for a client.
--   roster_facts        the list for a window, for the service role: it reads acts_public, characters_public and class_history, never `acts` or `reactions` (the candidates roster_newcomers names are a superset it
--                       checks against acts_public). Each list holds at most 25 items (the same number as ITEMS_MOST in engine/system/roster.ts) and `more` counts the rest. Nothing in it is computed from a private fact:
--                       a reaction is no Act; a post under a live author veil shows the stand-in, so its author is not seen while the veil holds; a Turn's class is what its announcement names, never
--                       what class_history holds; a silent Turn (no announcement) is in no list.
--   write_roster_entry  the Boss's posts in the season's thread (promos_thread, as the settlement opened it), the newcomers written down as seen, the entry. It returns at once for a window that has an entry.
--                       With the System off, no Boss, a Boss benched or not yet debuted, a post past postMaxLength, no words for the thread's title or a Boss locked out of the thread, the entry is written with no posts and
--                       `skipped` says why, and the newcomers are not marked seen (they are listed at a later entry). Any other error (a deadlock, a lock timeout, a serialization failure) is raised, so the entry is not
--                       written and the window stays due: the settle run's DatabaseError path leaves it for the next run.
--   roster_due          the applied windows with no entry, oldest first: the open season's, and the last window of the season closed just before it (reveal_season closes the season in the settlement's own transaction).
--   news_announce       0100's, making no Season News item for an ahead announcement (a Turn announced at once is news when it takes effect, in the entry that names it).
--   news_landed.kind    gains `roster`: written by write_roster_entry when its window had Turns taking effect, on the entry's first post.
--   season_news         0429's, reading a `roster` landing as one item (kind `roster`): the first 20 Turns taking effect and a count, linked to the entry's first post. Old items read as before.
--   The changeover      (statements of the migration, run once) the windows already settled get an entry that says so (record.skipped), so only later windows are due; the characters that already have a public Act are written down as seen, so the first
--                       entry does not list the whole cast as new.
--
-- The cost at a busy instance: one entry for each settlement, and the work in it follows the window's activity and never the cast. The newcomers are the characters with an Act in the window, found by acts_created
-- (created_at), plus those whose author veil ended in it (post_veils_ends, acts_card_ends), less those with a roster_seen row: one probe of acts_public for each of those, through acts_character. A character that never
-- acts is never a candidate, so dormant characters cost nothing at any settlement. The window reaches back to the last entry that looked at newcomers (one written with posts, or with nothing to report, or the changeover's), so
-- a run of skipped entries (the System off) widens it by the activity of those windows only. The window's Turns and reveals are read through two partial indexes on created_at (announce Acts, unmask Acts) and one on
-- class_history.started_at. A report lists at most 25 of each list and counts the rest, so its size does not grow with a busy window either.

-- ---- the tables ----

create table roster_entries (
  window_end timestamptz primary key references settlements (ends_at),
  season bigint not null references seasons (id),
  posted_at timestamptz not null default now(),
  acts uuid[] not null default '{}',
  record jsonb not null default '{}' check (jsonb_typeof(record) = 'object')
);
create index roster_entries_first_post on roster_entries ((acts[1])) where cardinality(acts) > 0;
create table roster_seen (
  character uuid primary key references characters (id),
  window_end timestamptz not null,
  act uuid references acts (id)
);
alter table roster_entries enable row level security;
alter table roster_seen enable row level security;
revoke all on roster_entries, roster_seen from public, anon, authenticated, service_role;

create function roster_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  raise exception 'a roster entry is only ever added (%)', tg_op using errcode = '55000';
end $$;
revoke execute on function roster_guard() from public, anon, authenticated;
create trigger roster_entries_no_update before update on roster_entries for each row execute function roster_guard();
create trigger roster_entries_no_delete before delete on roster_entries for each row execute function roster_guard();
create trigger roster_entries_no_truncate before truncate on roster_entries for each statement execute function roster_guard();
create trigger roster_seen_no_update before update on roster_seen for each row execute function roster_guard();
create trigger roster_seen_no_delete before delete on roster_seen for each row execute function roster_guard();
create trigger roster_seen_no_truncate before truncate on roster_seen for each statement execute function roster_guard();
alter table roster_entries enable always trigger roster_entries_no_update;
alter table roster_entries enable always trigger roster_entries_no_delete;
alter table roster_entries enable always trigger roster_entries_no_truncate;
alter table roster_seen enable always trigger roster_seen_no_update;
alter table roster_seen enable always trigger roster_seen_no_delete;
alter table roster_seen enable always trigger roster_seen_no_truncate;

-- A window's Turns and reveals are read by time, as a window is: one partial index for each kind, and the landings of a window by the time they started.
create index acts_announces_at on acts (created_at) where kind = 'announce';
create index acts_unmasks_at on acts (created_at) where kind = 'unmask';
create index class_history_landed on class_history (started_at) where announce_act is not null;

alter table news_landed drop constraint news_landed_kind_check;
alter table news_landed add constraint news_landed_kind_check check (kind in ('tally', 'announcements', 'roster'));

-- ---- the changeover ----

-- Run once, as statements of this migration (the test copies them, as 0428's does). What a Roster Report would list as new is what the public has not yet seen: a character that has a public Act already was announced
-- by the old ways (its debut, or its first words). Written down as seen, at the last window settled (or now, where none was).
insert into roster_seen (character, window_end, act)
select p.id, coalesce((select max(s.ends_at) from settlements s), now()), f.id
from characters_public p
cross join lateral (select a.id from acts_public a where a."character" = p.id order by a.created_at, a.id limit 1) f
where p.staff is null
on conflict (character) do nothing;
-- The windows already settled have no entry to write now; the record says so, and only later windows are due.
insert into roster_entries (window_end, season, record)
select s.ends_at, s.season, jsonb_build_object('skipped', 'before the Roster Report')
from settlements s
on conflict (window_end) do nothing;

-- ---- the facts ----

-- The Turns taking effect at a window: the landings (class_history rows starting at the window's end) that link an announcement, each as that announcement shows it. A landing with no announcement (a silent
-- Turn, an old one) is none. The class and the old class are the announcement's, which holds a class only where the player named it: the class_history row's own is never read here. Not for a client.
create function roster_landed(in_end timestamptz) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(l.item order by l.at, l.seq, l.name), '[]'::jsonb)
  from (
    select x.created_at as at, x.seq, p.name,
           jsonb_build_object('character', h.character, 'name', p.name, 'act', x.id, 'thread', x.thread, 'seq', x.seq)
             || case when x.payload ->> 'was' is not null then jsonb_build_object('was', x.payload ->> 'was') else '{}'::jsonb end
             || case when x.payload ->> 'class' is not null then jsonb_build_object('class', x.payload ->> 'class') else '{}'::jsonb end as item
    from class_history h
    join acts_public x on x.id = h.announce_act
    join characters_public p on p.id = h.character
    where h.started_at = in_end and h.announce_act is not null and p.staff is null
  ) l
$$;
revoke execute on function roster_landed(timestamptz) from public, anon, authenticated, service_role;

-- The characters a window's entry would list as new, each with the Act that makes it so: a character with no roster_seen row and a public Act at or before the window's end. They are found from the window's activity and not by
-- probing every character: the candidates are the characters with an Act in (the last window an entry looked at newcomers in, this window's end], and the authors of posts whose author veil ended in it (a veil ending by
-- itself, by an admin's end or by a refunded write), since a post under a live veil shows the stand-in and its author appears when the veil ends, in the window the veil ended in. The candidates read `acts` and post_veils
-- only to name who to look at: each is then probed in acts_public (what the public reads now), so a post under a live veil makes no newcomer, and nothing here is any more than a superset checked against the public's view.
-- An entry that listed or found nothing to list is the last that "looked"; one that was skipped (the System off, a limit too small) leaves its newcomers for the next, and the changeover's entries count as looked, since
-- the changeover wrote the characters of before as seen. Not for a client.
create function roster_newcomers(in_end timestamptz)
returns table (who uuid, name text, act uuid, thread uuid, seq integer, at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  with floor_at as (
    select coalesce(max(e.window_end), '-infinity'::timestamptz) as at from roster_entries e
    where e.window_end < in_end and (not (e.record ? 'skipped') or e.record ->> 'skipped' = 'before the Roster Report')
  ),
  cand as (
    select a."character" as who from acts a, floor_at f where a.created_at > f.at and a.created_at <= in_end and a."character" is not null
    union
    select v.author from post_veils v, floor_at f where v.veil = 'author' and v.ends_at > f.at and v.ends_at <= in_end
    union
    select v.author from acts e join post_veils v on v.play = e.target_act_id, floor_at f
    where e.kind = 'card_end' and e.created_at > f.at and e.created_at <= in_end and v.veil = 'author'
    union
    select v.author from card_write_refunds r join post_veils v on v.play = r.play, floor_at f
    where r.at > f.at and r.at <= in_end and v.veil = 'author'
  )
  select p.id, p.name, f.id, f.thread, f.seq, f.created_at
  from cand c
  join characters_public p on p.id = c.who
  cross join lateral (
    select a.id, a.thread, a.seq, a.created_at from acts_public a
    where a."character" = p.id and a.created_at <= in_end
    order by a.created_at, a.id limit 1
  ) f
  where p.staff is null and not exists (select 1 from roster_seen r where r.character = p.id)
$$;
revoke execute on function roster_newcomers(timestamptz) from public, anon, authenticated, service_role;

-- The first `n` items of a list of items, and nothing else of it. Not for a client.
create function roster_head(items jsonb, n integer) returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x.e order by x.i), '[]'::jsonb) from jsonb_array_elements(items) with ordinality x(e, i) where x.i <= n
$$;
revoke execute on function roster_head(jsonb, integer) from public, anon, authenticated, service_role;

-- The list for one settlement window, from what the public reads. Each list holds at most 25 items (ITEMS_MOST, engine/system/roster.ts) and `more` says how many each holds beyond them. `newcomers` are not bounded by the window
-- itself: they are those roster_newcomers names (the characters with no roster_seen row seen since the last entry that looked). Each item names its character, the Act it links (`act`, with `thread` and `seq`) and, for a
-- Turn, `was` and `class` where the announcement named them.
create function roster_facts(window_end timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  w settlements%rowtype;
  most constant integer := 25;
  news jsonb;
  news_count integer;
  announced jsonb;
  landed jsonb;
  reveals jsonb;
begin
  select * into w from settlements s where s.ends_at = roster_facts.window_end;
  if w.id is null then raise exception 'there is no settlement ending at %', roster_facts.window_end using errcode = 'P0002'; end if;
  select coalesce(jsonb_agg(n.item order by n.at, n.seq, n.name) filter (where n.rn <= most), '[]'::jsonb), count(*)::integer into news, news_count
  from (
    select x.at, x.seq, x.name, jsonb_build_object('character', x.who, 'name', x.name, 'act', x.act, 'thread', x.thread, 'seq', x.seq) as item,
           row_number() over (order by x.at, x.seq, x.name) as rn
    from roster_newcomers(w.ends_at) x
  ) n;
  select coalesce(jsonb_agg(n.item order by n.at, n.seq, n.name), '[]'::jsonb) into announced
  from (
    select a.created_at as at, a.seq, p.name,
           jsonb_build_object('character', p.id, 'name', p.name, 'act', a.id, 'thread', a.thread, 'seq', a.seq)
             || case when a.payload ->> 'was' is not null then jsonb_build_object('was', a.payload ->> 'was') else '{}'::jsonb end
             || case when a.payload ->> 'class' is not null then jsonb_build_object('class', a.payload ->> 'class') else '{}'::jsonb end as item
    from acts_public a join characters_public p on p.id = a."character"
    where a.kind = 'announce' and a.payload ->> 'what' = 'turn' and a.payload ->> 'ahead' = 'true'
      and a.created_at > w.starts_at and a.created_at <= w.ends_at and p.staff is null
  ) n;
  landed := roster_landed(w.ends_at);
  select coalesce(jsonb_agg(n.item order by n.at, n.seq, n.name), '[]'::jsonb) into reveals
  from (
    select a.created_at as at, a.seq, p.name,
           jsonb_build_object('character', p.id, 'name', p.name, 'act', a.id, 'thread', a.thread, 'seq', a.seq)
             || case when a.payload ->> 'class' is not null then jsonb_build_object('class', a.payload ->> 'class') else '{}'::jsonb end as item
    from acts_public a join characters_public p on p.id = a."character"
    where a.kind = 'unmask' and a.created_at > w.starts_at and a.created_at <= w.ends_at and p.staff is null
  ) n;
  return jsonb_build_object(
    'window', jsonb_build_object('start', w.starts_at, 'end', w.ends_at),
    'season', (select s.number from seasons s where s.id = w.season),
    'newcomers', news,
    'announced', roster_head(announced, most),
    'landed', roster_head(landed, most),
    'reveals', roster_head(reveals, most),
    'more', jsonb_build_object('newcomers', greatest(0, news_count - most), 'announced', greatest(0, jsonb_array_length(announced) - most),
                               'landed', greatest(0, jsonb_array_length(landed) - most), 'reveals', greatest(0, jsonb_array_length(reveals) - most))
  );
end $$;
revoke execute on function roster_facts(timestamptz) from public, anon, authenticated;
grant execute on function roster_facts(timestamptz) to service_role;

-- The applied windows with no entry, oldest first: those of the open season, and the last window of the season closed just before it. apply_settlement records a season's last window under the closing season, and
-- reveal_season closes that season and opens the next in the same transaction, so by the time the Roster Report looks, that window is the closed season's. It is the one window of it that is due: a closed season ends
-- at its last window's end (the window that closes it), so `s.ends_at = c.ends_at` names it, and no older window of the closed season, nor any season before it, is ever due.
create function roster_due() returns setof timestamptz
language sql stable security definer set search_path = public, pg_temp as $$
  select s.ends_at from settlements s
  where (s.season = (select x.id from seasons x where x.ends_at is null order by x.starts_at desc limit 1)
         or s.season = (select c.id from seasons c where c.ends_at is not null and c.ends_at = (select x.starts_at from seasons x where x.ends_at is null order by x.starts_at desc limit 1)
                        and s.ends_at = c.ends_at))
    and not exists (select 1 from roster_entries e where e.window_end = s.ends_at)
  order by s.ends_at
$$;
revoke execute on function roster_due() from public, anon, authenticated;
grant execute on function roster_due() to service_role;

-- One entry. `bodies` are the Boss's posts, in order, each within postMaxLength (the engine split them to it); `newcomers` the characters the entry lists; `record` what the caller keeps (the commentary, or why there is
-- none, and what its call trimmed). Returns {written: false} for a window that has an entry already (it writes nothing again), else {written: true, posts, thread, skipped?}. The posts are the Boss's as of now; where it cannot post
-- (the System off, no Boss, benched, locked out, a missing thread title) the entry is written with none and `skipped` says why: a Roster Report that fails to post never fails the settlement it follows.
create function write_roster_entry(window_end timestamptz, newcomers uuid[], bodies text[], record jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  w settlements%rowtype;
  boss text := current_boss();
  enabled boolean := coalesce((select s.value = 'true'::jsonb from settings s where s.key = 'systemEnabled'), false);
  most integer := (select (s.value #>> '{}')::integer from settings s where s.key = 'postMaxLength');
  texts text[] := array(select btrim(b, E' \t\n\r\f\v') from unnest(coalesce(write_roster_entry.bodies, '{}')) b where btrim(coalesce(b, ''), E' \t\n\r\f\v') <> '');
  made uuid[] := '{}';
  skipped text;
  th uuid;
  opened boolean;
  body text;
  said jsonb;
  landed jsonb;
  rec jsonb := coalesce(write_roster_entry.record, '{}'::jsonb);
begin
  if jsonb_typeof(rec) is distinct from 'object' then raise exception 'a roster record is an object' using errcode = '22023'; end if;
  select * into w from settlements s where s.ends_at = write_roster_entry.window_end;
  if w.id is null then raise exception 'there is no settlement ending at %', write_roster_entry.window_end using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.roster.' || extract(epoch from write_roster_entry.window_end)::text, 0));
  if exists (select 1 from roster_entries e where e.window_end = write_roster_entry.window_end) then return jsonb_build_object('written', false); end if;

  if cardinality(texts) > 0 then
    -- What is known before posting is checked before it: each of these is a state the Boss or the instance is in, and the entry says so. A post past the limit would be refused by the insert's own check, so it is found here.
    if not enabled then skipped := 'the System is off';
    elsif boss is null then skipped := 'the season has no Boss';
    elsif (select o.office from staff_office_now o where o.staff = boss) in ('waiting', 'benched') then skipped := 'the Boss is ' || (select o.office from staff_office_now o where o.staff = boss) || ' and writes nothing';
    elsif most is not null and exists (select 1 from unnest(texts) b where char_length(b) > most) then skipped := format('a roster post is longer than postMaxLength %s', most);
    elsif (select s.turns_thread from seasons s where s.id = w.season) is null and coalesce(btrim((select s.value ->> 'announcementsThreadTitle' from settings s where s.key = 'copy')), '') = '' then
      skipped := 'the instance gives no words for copy.announcementsThreadTitle';
    else
      begin
        select p.in_thread, p.opened into th, opened from promos_thread(w.season) p;
        if opened then perform broadcast_later('board:' || (select t.board::text from threads t where t.id = th), 'thread', thread_projection(th)); end if;
        foreach body in array texts loop
          said := write_staff_act(boss, 'post', th, null, jsonb_build_object('body', body));
          made := made || (said ->> 'id')::uuid;
          perform broadcast_later('thread:' || th::text, 'act', said);
        end loop;
      exception when sqlstate '55000' or sqlstate 'P0002' then
        -- Only a refusal of the game's own is a skip (55000: the persona writes nothing, or is locked out of the thread; P0002: there is no staff member, or no words for the title): the block's own writes are rolled back,
        -- nothing of a half-posted entry stays, and the entry says why. Anything else (a deadlock 40P01, a lock timeout 55P03, a serialization failure 40001, a full disk) is not caught: it reaches the caller, the
        -- entry is not written, and the window stays due.
        made := '{}';
        skipped := left(sqlerrm, 300);
      end;
    end if;
  end if;

  landed := roster_landed(w.ends_at);
  rec := rec || jsonb_build_object('landedCount', jsonb_array_length(landed), 'landed', coalesce((select jsonb_agg(x.e order by x.i) from jsonb_array_elements(landed) with ordinality x(e, i) where x.i <= 20), '[]'::jsonb));
  if skipped is not null then rec := rec || jsonb_build_object('skipped', skipped); end if;
  insert into roster_entries (window_end, season, acts, record) values (w.ends_at, w.season, made, rec);
  if cardinality(made) > 0 then
    -- Every newcomer of the window is written down as seen, the 25 it listed and those it only counted ("and N more"): each is listed once in its life, and a backlog that is never listed would widen every later window.
    insert into roster_seen (character, window_end, act)
    select p.id, w.ends_at, (select a.id from acts_public a where a."character" = p.id order by a.created_at, a.id limit 1)
    from (select n from unnest(coalesce(write_roster_entry.newcomers, '{}')) n union select x.who from roster_newcomers(w.ends_at) x) l(n)
    join characters_public p on p.id = l.n and p.staff is null
    on conflict (character) do nothing;
    if jsonb_array_length(landed) > 0 then
      insert into news_landed (act, kind) values (made[1], 'roster');
      perform broadcast_later('reach', 'news', jsonb_build_object('kind', 'seasonNews', 'sub', 'tally', 'act', made[1], 'at', now()));
    end if;
  end if;
  return jsonb_build_object('written', true, 'posts', cardinality(made), 'thread', th) || case when skipped is not null then jsonb_build_object('skipped', skipped) else '{}'::jsonb end;
end $$;
revoke execute on function write_roster_entry(timestamptz, uuid[], text[], jsonb) from public, anon, authenticated;
grant execute on function write_roster_entry(timestamptz, uuid[], text[], jsonb) to service_role;

-- ---- the news ----

-- backfill_news_landed (0100), as news_announce lands: an ahead announcement is no landing. Everything else as 0100 wrote it.
create or replace function backfill_news_landed() returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into news_landed (act, kind, landed_at)
  select a.id, 'tally', a.created_at from acts a
  where a.kind = 'tally' and tally_names(a.payload) > 0
  on conflict (act) do nothing;
  insert into news_landed (act, kind, landed_at)
  select distinct on (a.thread, a.created_at) a.id, 'announcements', a.created_at from acts a
  where a.kind = 'announce' and coalesce(a.payload ->> 'ahead', '') <> 'true'
  order by a.thread, a.created_at, a.seq
  on conflict (act) do nothing
$$;
revoke execute on function backfill_news_landed() from public, anon, authenticated;

-- news_announce (0100), making no item for an ahead announcement: a Turn announced at once is news when it takes effect, in the Roster Report's entry that names it. Everything else as 0100 wrote it.
create or replace function news_announce() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_table_name = 'season_handovers' then
    if new.boss is not null and new.boss is distinct from new.outgoing and new.how in ('nomination', 'rotation') then
      -- The words the news reads are bossLeft (the one who goes, where there was one) and bossArrived (the one who comes), as season_news says them.
      if new.outgoing is not null then
        perform broadcast_later('reach', 'news', jsonb_build_object('kind', 'seasonNews', 'sub', 'bossLeft', 'act', null, 'at', new.landed_at));
      end if;
      perform broadcast_later('reach', 'news', jsonb_build_object('kind', 'seasonNews', 'sub', 'bossArrived', 'act', null, 'at', new.landed_at));
    end if;
  elsif new.kind = 'update' then
    perform broadcast_later('reach', 'news', jsonb_build_object('kind', 'update', 'sub', null, 'act', new.id, 'at', new.created_at));
  elsif new.kind = 'tally' then
    if tally_names(new.payload) > 0 then
      insert into news_landed (act, kind) values (new.id, 'tally');
      perform broadcast_later('reach', 'news', jsonb_build_object('kind', 'seasonNews', 'sub', 'tally', 'act', new.id, 'at', now()));
    end if;
  elsif new.kind = 'announce' and coalesce(new.payload ->> 'ahead', '') <> 'true' then
    -- news_landed carries no thread and no instant of the Acts (landed_at is its own), so no unique index can say "one landing per thread and
    -- instant". Two transactions landing Acts of one thread at one instant could each find none under read committed and each insert a row,
    -- splitting one landing into two News items. So the check is serialized: the lock is on the landing's (thread, instant), held to commit, and
    -- the second transaction's `exists` runs after the first has committed and sees its row. The instant is keyed as epoch microseconds, never
    -- as text, which would follow each session's TimeZone and give two sessions two locks for one landing.
    perform pg_advisory_xact_lock(hashtextextended(new.thread::text || '|' || (extract(epoch from new.created_at) * 1000000)::bigint::text, 0));
    if not exists (select 1 from acts x join news_landed n on n.act = x.id
                   where x.kind = 'announce' and x.thread = new.thread and x.created_at = new.created_at and n.kind = 'announcements') then
      insert into news_landed (act, kind) values (new.id, 'announcements');
      perform broadcast_later('reach', 'news', jsonb_build_object('kind', 'seasonNews', 'sub', 'tally', 'act', new.id, 'at', now()));
    end if;
  end if;
  return new;
end $$;

-- season_news (0429), reading a roster landing as one item: kind `roster`, the first 20 Turns taking effect (the entry's record) and their count, linked to the entry's first post. Everything else as 0429 wrote it.
create or replace function public.season_news(before timestamp with time zone DEFAULT NULL::timestamp with time zone, most integer DEFAULT 20)
 returns setof season_news_row
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return query
  with
  lim as (select coalesce($1, 'infinity'::timestamptz) as b, greatest(1, least(coalesce($2, 20), 50)) as k),
  ann as (select (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements') as thread),
  r_floor as (
    select coalesce((select s.results_at from seasons s where s.results_at is not null and s.results_at < (select b from lim)
                     order by s.results_at desc, s.number desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz) as at
  ),
  results as (
    select 'results'::text as kind, null::uuid as act, null::uuid as thread, null::integer as seq, s.results_at as at, s.number as season,
           null::text as name, null::text as quote, coalesce(s.results_count, 0) as count,
           jsonb_build_object('top', (
             select coalesce(jsonb_agg(jsonb_build_object('character', t.character, 'name', t.name, 'place', t.place, 'standing', t.standing, 'shown', t.shown)
                                       order by t.place, t.name, t.character), '[]'::jsonb)
             from (select r.* from season_results r where r.season = s.id and r.standing > 0 and r.place is not null order by r.standing desc, r.name, r.character limit 3) t)) as detail
    from seasons s
    where s.results_at is not null and s.results_at < (select b from lim) and s.results_at >= (select at from r_floor)
  ),
  t_floor as (
    select coalesce((select n.landed_at from news_landed n where n.kind in ('tally', 'announcements', 'roster') and n.landed_at < (select b from lim)
                     order by n.landed_at desc, n.act desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz) as at
  ),
  tallies as (
    select (case when n.kind = 'roster' then 'roster' else 'tally' end)::text as kind, a.id as act, a.thread, a.seq, n.landed_at as at,
           case when n.kind = 'tally' then (a.payload ->> 'season')::integer when n.kind = 'roster' then (select s.number from seasons s where s.id = re.season) else (select s.number from seasons s where s.turns_thread = a.thread) end as season,
           null::text as name, null::text as quote,
           case when n.kind = 'tally' then tally_names(a.payload)
                when n.kind = 'roster' then coalesce((re.record ->> 'landedCount')::integer, 0)
                else (select count(*) from acts x where x.kind = 'announce' and x.thread = a.thread and x.created_at = a.created_at)::integer end as count,
           case when n.kind = 'tally' then
             jsonb_build_object('debuts', case when jsonb_typeof(a.payload -> 'debuts') = 'array' then a.payload -> 'debuts' else '[]'::jsonb end,
                                'turns', case when jsonb_typeof(a.payload -> 'turns') = 'array' then a.payload -> 'turns' else '[]'::jsonb end)
           when n.kind = 'roster' then jsonb_build_object('turns', case when jsonb_typeof(re.record -> 'landed') = 'array' then re.record -> 'landed' else '[]'::jsonb end)
           else (
             select jsonb_build_object(
               'debuts', coalesce(jsonb_agg(f.entry order by f.seq) filter (where f.what = 'debut'), '[]'::jsonb),
               'turns', coalesce(jsonb_agg(f.entry order by f.seq) filter (where f.what = 'turn'), '[]'::jsonb))
             from (
               select x.seq, x.payload ->> 'what' as what,
                      jsonb_build_object('character', x.character, 'name', c.name)
                        || case when x.payload ? 'class' then jsonb_build_object('class', x.payload -> 'class') else '{}'::jsonb end
                        || case when x.payload ? 'was' then jsonb_build_object('was', x.payload -> 'was') else '{}'::jsonb end as entry
               from acts x join characters c on c.id = x.character
               where x.kind = 'announce' and x.thread = a.thread and x.created_at = a.created_at
               order by x.seq limit 20
             ) f) end as detail
    from news_landed n join acts a on a.id = n.act
    left join roster_entries re on n.kind = 'roster' and re.acts[1] = a.id
    where n.kind in ('tally', 'announcements', 'roster') and n.landed_at < (select b from lim) and n.landed_at >= (select at from t_floor)
  ),
  boss_all as materialized (
    select 'bossArrived'::text as kind, h.boss as who, h.landed_at as at, h.number as season, 'bossArrival'::text as line, h.thread as handover_thread from season_boss_changes h
    where h.landed_at < (select b from lim)
    union all
    select 'bossLeft', h.outgoing, h.landed_at, case when h.cause = 'departure' then h.number else h.number - 1 end, 'bossFarewell', h.thread from season_boss_changes h
    where h.outgoing is not null and h.landed_at < (select b from lim)
  ),
  boss_page as (
    select * from boss_all c
    where c.at >= coalesce((select c2.at from boss_all c2 order by c2.at desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz)
  ),
  bosses as (
    select c.kind, p.id as act, p.thread, p.seq, c.at, c.season, (select ch.name from characters ch where ch.staff = c.who) as name,
           left(p.body, 600) as quote, null::integer as count, null::jsonb as detail
    from boss_page c
    left join lateral (
      -- A handover with a thread of its own: the Boss's first post there, by the thread's (thread, seq) index. An older handover has none: the Boss's first post in the announcements thread at that instant, by created_at. Each branch is its own lateral so each keeps its own index; one OR across both made the planner give up the created_at probe.
      select a.id, a.thread, a.seq, public_payload(a.payload, version_hidden(a.id), a.id) ->> 'body' as body
      from characters ch join acts a on a.thread = c.handover_thread and a.character = ch.id
      where c.handover_thread is not null and ch.staff = c.who and a.kind = 'post'
        and exists (select 1 from settings s where s.key = 'systemLines' and jsonb_typeof(s.value -> c.line) = 'array' and jsonb_array_length(s.value -> c.line) > 0)
      order by a.seq limit 1
    ) ph on true
    left join lateral (
      select a.id, a.thread, a.seq, public_payload(a.payload, version_hidden(a.id), a.id) ->> 'body' as body
      from characters ch join acts a on a.character = ch.id
      where c.handover_thread is null and ch.staff = c.who and a.created_at = c.at and a.kind = 'post' and a.thread = (select thread from ann)
        and exists (select 1 from settings s where s.key = 'systemLines' and jsonb_typeof(s.value -> c.line) = 'array' and jsonb_array_length(s.value -> c.line) > 0)
      order by a.seq limit 1
    ) pa on true
    cross join lateral (select coalesce(ph.id, pa.id) as id, coalesce(ph.thread, pa.thread) as thread, coalesce(ph.seq, pa.seq) as seq, coalesce(ph.body, pa.body) as body) p
  ),
  merged as (
    select * from results union all select * from tallies union all select * from bosses
  )
  select m.kind, m.act, m.thread, m.seq, m.at, m.season, m.name, m.quote, m.count, m.detail
  from merged m
  where m.at >= coalesce((select m2.at from merged m2 order by m2.at desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz)
  order by m.at desc, m.kind, m.act nulls first;
end
$function$;