-- A persona that leaves the roster leaves the staff (docs/plans/2026-11-21-departed-personas-plan.md, Task 1; its design, section 3).
--
-- A departing Boss is handed over at once, in the open season, by the same `hand_over` a roll-over runs. So a season can hold two handovers, and `season_handovers` (one row per season since 0051) holds one row
-- per handover: it gains an `id` key, `season` is no longer unique, and `cause` says `rollover` or `departure` while `how` goes on saying how the seat was filled. A plain unique index keeps what the old key
-- kept, one roll-over per season. `handover_dismissals` is keyed by the handover's id, so each to-do is dismissed on its own.
--
-- Every row held keeps its meaning: each existing handover is a roll-over (the column's default), and each existing dismissal is carried to its season's only handover. The dismissals' append-only guard
-- (0090) refuses an update, so it is switched off for the one statement that fills the new column and is switched on again, firing always, at once; nothing else here edits or removes a dismissal.
--
-- Readers that take "the handover of a season" are rewritten below from their latest definitions: hand_over, say_farewell, predecessor_handoff, dismiss_handover_todo, admin_queue, season_news, pool_context, staff_career,
-- system_tick and reveal_season (its fallback row's `on conflict (season)` would no longer match the partial index). Read and left as they are, each key being a handover's own row or an instant and none the season alone:
-- news_announce and alerts_news_unread (a row per Boss-changing handover, as the view gives them), apply_meeting (its handoffs_latest read is of the season the Boss sits in, and handoffs stay keyed by season),
-- pool_signals (handovers by landed_at, ordered by landed_at and season) and handover_dismissals_append_only (it names the table in a message).
--
-- Ways out: nothing here holds a player. A departure that no Boss can take refuses (below) and writes nothing; the seed that asked answers it (Task 2).

-- ------------------------------------------------------------------------------------------------------ the tables ----

-- table part: begin
-- (tests/e2e/0031-handover-table-on-held-rows.ts runs the lines between these two markers on tables in the old shape, so what stands between them runs as written on rows already held.)
alter table season_handovers drop constraint season_handovers_pkey cascade;
alter table season_handovers add column id bigint generated always as identity;
alter table season_handovers add primary key (id);
alter table season_handovers add unique (id, season);
alter table season_handovers add column cause text not null default 'rollover' check (cause in ('rollover', 'departure'));
create index season_handovers_by_season on season_handovers (season, id);
create unique index season_handovers_one_rollover on season_handovers (season) where cause = 'rollover';

-- The digest role's columns (0088), `cause` added: a handover's public facts are who left, who came, how, why and when.
grant select (season, outgoing, boss, how, cause, landed_at, arrival_act) on season_handovers to kayfabb_digest;

-- A dismissal keeps its season (what the to-do was about) and names its handover; the key on both says the season is that handover's, so the two cannot disagree.
alter table handover_dismissals add column handover bigint;
alter table handover_dismissals disable trigger handover_dismissals_no_update;
update handover_dismissals d set handover = (select h.id from season_handovers h where h.season = d.season and h.cause = 'rollover');
alter table handover_dismissals enable always trigger handover_dismissals_no_update;
alter table handover_dismissals alter column handover set not null;
alter table handover_dismissals drop constraint handover_dismissals_pkey;
alter table handover_dismissals add primary key (handover);
alter table handover_dismissals add foreign key (handover, season) references season_handovers (id, season);
-- table part: end

-- A Boss changed at a handover: the Boss it ended with is not the one it began with, by nomination or rotation. One row per such handover, with its id and cause.
create or replace view season_boss_changes as
  select h.season, s.number, h.outgoing, h.boss, h.at, h.landed_at, h.id as handover, h.cause
  from season_handovers h join seasons s on s.id = h.season
  where h.boss is not null and h.boss is distinct from h.outgoing and h.how in ('nomination', 'rotation');

-- The words that stand: the latest row of each Boss in each season (0337_handoffs.sql, which kept one per season). A departure leaves two Bosses in a season, and the new one's meetings in the farewell window write
-- rows of their own, which must not stand for the departed Boss's, nor carry its farewell. Same columns, so the view is replaced in place.
create or replace view handoffs_latest as
  select distinct on (h.season, h.staff) h.id, h.season, h.staff, h.meeting, h.farewell, h.note, h.written_at
  from handoffs h order by h.season, h.staff, h.id desc;

-- ---------------------------------------------------------------------------------------------- the handover ----

-- say_farewell (0337_handoffs.sql), the season the Boss served named by the handover's kind: the new season itself for a departure (the Boss left in the season it served), the season before for a roll-over.
-- A third argument, false by default, so a roll-over's call is as it was. Everything else as 0337_handoffs.sql wrote it.
drop function say_farewell(text, bigint);
create function say_farewell(speaker text, new_season bigint, departure boolean default false) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ann uuid := (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements');
  words text;
  most integer := (select (s.value #>> '{}')::integer from settings s where s.key = 'postMaxLength');
begin
  if ann is null or speaker is null then return false; end if;
  select nullif(btrim(h.farewell, E' \t\n\r\f\v'), '') into words
  from handoffs_latest h
  where h.season = case when say_farewell.departure then say_farewell.new_season else (select max(p.id) from seasons p where p.id < say_farewell.new_season) end
    and h.staff = say_farewell.speaker;
  if words is null then return false; end if;
  if most is not null then words := left(words, most); end if;
  perform write_staff_act(speaker, 'post', ann, null, jsonb_build_object('body', words));
  return true;
exception when others then
  raise warning 'say_farewell: the farewell of % was not said: % (%)', speaker, sqlerrm, sqlstate;
  return false;
end $$;
revoke execute on function say_farewell(text, bigint, boolean) from public, anon, authenticated;
grant execute on function say_farewell(text, bigint, boolean) to service_role;

-- hand_over (0365_handover_withdraws.sql), a fourth argument, `departure` (false by default, so every roll-over's call is as it was): a departure is run in the open season, for a Boss that has left the roster. It raises,
-- before writing anything, where the chosen Boss would be none or the outgoing one (no fallback to `unchanged`), says the farewell of the season the Boss served, and writes its row with cause `departure`. A roll-over's row
-- is written with cause `rollover`. Everything else as 0365_handover_withdraws.sql wrote it.
drop function hand_over(bigint, text, timestamptz);

create function hand_over(new_season bigint, outgoing text, at timestamptz, departure boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  chosen text;
  how text;
  note text;
  open_nom record;
  arrival uuid;
begin
  begin
    chosen := nominated_boss(outgoing);
    if chosen is not null then how := 'nomination'; end if;
  exception when others then
    chosen := null;
    note := 'the nomination did not seat: ' || sqlerrm;
  end;
  if chosen is null then
    begin
      chosen := rotation_boss(outgoing);
      how := 'rotation';
    exception when others then
      chosen := outgoing;
      how := case when outgoing is null then 'none' else 'unchanged' end;
      note := coalesce(note || '; ', '') || 'the rotation did not choose: ' || sqlerrm;
    end;
  end if;
  -- A departure is the outgoing Boss leaving the roster: it refuses where no other Boss can take the chair, since the outgoing one has no persona file left to sit in it. Nothing has been written yet.
  if departure and (chosen is null or chosen is not distinct from outgoing) then
    raise exception 'the open season''s Boss % has left the roster, and no Boss in it can take the chair', outgoing using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  update seasons set boss = chosen where id = new_season;
  -- Every nomination in force is spent: it named the Boss of this handover, whoever was seated.
  for open_nom in
    select o.move_act from open_moves o join acts a on a.id = o.move_act where a.payload ->> 'kind' = 'nameSuccessor' order by o.landed_at, o.move_act
  loop
    begin
      perform end_move(open_nom.move_act, 'spent', 'handover');
    exception when others then
      note := coalesce(note || '; ', '') || 'a nomination was not spent: ' || sqlerrm;
    end;
  end loop;
  if chosen is not null and chosen is distinct from outgoing then
    begin
      insert into move_bank (staff, balance, as_of) values (chosen, 0, at)
      on conflict (staff) do update set balance = 0, as_of = excluded.as_of;
    exception when others then
      note := coalesce(note || '; ', '') || 'the bank was not started: ' || sqlerrm;
    end;
    -- The offices (0082): the arriving Boss debuts if it was waiting; the outgoing Boss becomes a member, or a Mod Bot where no persona
    -- is one now, since the staff is never empty. The Boss's own office is the season's and is never a row, so the two Bosses of this
    -- handover are left out of the count: the outgoing one's latest row may still read mod, from before it was seated; a retired mod is no mod either. Best effort, as the rest.
    begin
      perform pg_advisory_xact_lock(hashtext('kayfabb.offices'));
      update characters set debuted_at = at where staff = chosen and debuted_at is null;
      if outgoing is not null then
        insert into staff_offices (staff, office, cause, season)
        values (outgoing, case when exists (select 1 from staff_office_now o join characters c on c.staff = o.staff where o.office = 'mod' and o.staff is distinct from outgoing and o.staff is distinct from chosen and c.retired_at is null) then 'member' else 'mod' end, 'handover', new_season);
      end if;
    exception when others then
      note := coalesce(note || '; ', '') || 'the offices were not moved: ' || sqlerrm;
    end;
    -- The outgoing Boss's moves still waiting are withdrawn: their Boss has left the chair (the rehearsal patch design, section 6). A Mod's own moves are left alone. Refused for good,
    -- with the reason the admin queue shows; nothing is posted. Best effort, as the rest.
    begin
      update queued_moves set failed_at = at, failure = 'its Boss left the chair before it landed', refused_at = at
      where staff = outgoing and landed_act is null and held_at is null and refused_at is null;
    exception when others then
      note := coalesce(note || '; ', '') || 'the outgoing Boss''s waiting moves were not withdrawn: ' || sqlerrm;
    end;
    -- The Boss's own farewell, written at its last meeting (0337, above), in place of the stock line; the stock line stands where none was written or it could not be posted.
    if not say_farewell(outgoing, new_season, departure) then
      perform say_in_announcements(outgoing, 'bossFarewell');
    end if;
    arrival := say_in_announcements(chosen, 'bossArrival');
  end if;
  insert into season_handovers (season, outgoing, boss, how, note, at, arrival_act, cause)
  values (new_season, outgoing, chosen, how, left(note, 1000), at, arrival, case when departure then 'departure' else 'rollover' end);
  return jsonb_build_object('boss', chosen, 'how', how, 'note', note);
end $$;

revoke execute on function hand_over(bigint, text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function hand_over(bigint, text, timestamptz, boolean) to service_role;

-- predecessor_handoff (0337_handoffs.sql), reading the open season's latest Boss-changing handover (a departure's, where one was the latest): the outgoing Boss's season is the handover's own season for a departure and the
-- season before for a roll-over, and the window counts from that handover's `at`, as it did. Everything else as 0337_handoffs.sql wrote it.
create or replace function predecessor_handoff() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('staff', h.outgoing, 'season', p.number,
           'note', (select nullif(x.note, '') from handoffs_latest x where x.season = p.id and x.staff = h.outgoing),
           'facts', handoff_facts(p.id))
  from (select c.* from season_boss_changes c join seasons cur on cur.id = c.season and cur.ends_at is null order by c.landed_at desc, c.handover desc limit 1) h
  cross join lateral (
    select q.id, q.number from seasons q
    where q.id = case when h.cause = 'departure' then h.season else (select z.id from seasons z where z.id < h.season order by z.id desc limit 1) end) p
  where h.outgoing is not null and h.boss = current_boss()
    and h.at + coalesce((select (v.value #>> '{}')::integer from settings v where v.key = 'inheritanceGraceDays'), 3) * interval '1 day' > now()
$$;

-- An admin puts a to-do away without an update. The to-do is named by its handover's id (a season can hold two: a roll-over's and a departure's). A handover that did not change the Boss has no to-do and is refused in
-- words; a to-do already dismissed is answered and writes nothing. Answers the handover and the season's number.
drop function dismiss_handover_todo(integer);
create function dismiss_handover_todo(handover bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  change record;
begin
  perform only_admins('dismisses a to-do');
  select c.season, c.number into change from season_boss_changes c where c.handover = dismiss_handover_todo.handover;
  if change.season is null then
    raise exception 'there is no to-do for that handover: it did not change the Boss' using hint = 'kayfabb.refusal', errcode = 'P0002';
  end if;
  insert into handover_dismissals (season, handover, admin) values (change.season, dismiss_handover_todo.handover, auth.uid()) on conflict on constraint handover_dismissals_pkey do nothing;
  return jsonb_build_object('handover', dismiss_handover_todo.handover, 'season', change.number);
end $$;
revoke execute on function dismiss_handover_todo(bigint) from public, anon;
grant execute on function dismiss_handover_todo(bigint) to authenticated;

-- pool_context (0339_thread_places_at_scale.sql), the predecessor read from the open season's latest Boss-changing handover (a departure's, where one was the latest). Everything else as 0339_thread_places_at_scale.sql wrote it.
create or replace function pool_context() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'season', (select jsonb_build_object('startsAt', (extract(epoch from s.starts_at) * 1000)::bigint,
        'endsAt', (extract(epoch from coalesce(s.ends_at, s.starts_at + span_interval(setting('seasonLength')))) * 1000)::bigint)
      from seasons s where s.ends_at is null order by s.starts_at desc limit 1),
    'boss', current_boss(),
    'predecessor', (select h.outgoing from (select c.* from season_boss_changes c join seasons cur on cur.id = c.season and cur.ends_at is null order by c.landed_at desc, c.handover desc limit 1) h
                    where h.boss = current_boss()),
    'offices', coalesce((select jsonb_object_agg(o.staff, o.office) from staff_office_now o join characters c on c.staff = o.staff where c.staff_kind = 'persona'), '{}'::jsonb),
    'characters', coalesce((select jsonb_object_agg(c.staff, c.id) from characters c where c.staff is not null and c.staff_kind = 'persona'), '{}'::jsonb),
    'boards', coalesce((select jsonb_object_agg(b.id, b.slug) from boards b where not b.is_system and board_is_open(b.id)), '{}'::jsonb))
$$;

-- admin_queue (0337_handoffs.sql), each to-do now one handover's: it carries the handover's id and cause, is dismissed by that id, and finds the outgoing Boss's handoff note and facts for the season that
-- Boss served (the handover's own season for a departure, the season before for a roll-over). The plan and jit settings 0368 gave it are kept. Everything else as 0337_handoffs.sql wrote it.
create or replace function admin_queue() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp set plan_cache_mode = force_generic_plan set jit = off as $$
declare
  cap constant integer := 100;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  win constant timestamptz := now() - interval '30 days';
  waiting jsonb; waiting_more boolean;
  in_force jsonb; in_force_more boolean;
  staff_cards jsonb; staff_cards_more boolean;
  ended jsonb; ended_more boolean;
  roster jsonb;
  todos jsonb;
  latest_update timestamptz;
begin
  perform only_admins('reads the queue');

  -- The Bosses that can take a nomination's seat, by the roster's own rule and order (boss_roster): not retired, debuted.
  select coalesce(jsonb_agg(jsonb_build_object('staff', c.staff, 'name', c.name, 'pronouns', (select p.pronouns from character_profiles p where p.character = c.id)) order by r.ord), '[]'::jsonb) into roster
  from unnest(boss_roster()) with ordinality r(staff, ord) join characters c on c.staff = r.staff;

  select coalesce(jsonb_agg(x.j order by x.n) filter (where x.n <= cap), '[]'::jsonb), coalesce(bool_or(x.n > cap), false) into waiting, waiting_more from (
    select row_number() over (order by q.go_live_at, q.id) as n,
           jsonb_build_object('id', q.id, 'staff', q.staff, 'boss', (select c.name from characters c where c.staff = q.staff),
             'bossPronouns', (select p.pronouns from characters c join character_profiles p on p.character = c.id where c.staff = q.staff), 'kind', q.kind,
             'params', q.params, 'demand', q.demand, 'why', q.why, 'goLiveAt', q.go_live_at, 'expiresAt', q.expires_at, 'structural', q.structural,
             'failedAt', q.failed_at, 'failure', q.failure, 'replacedAt', q.replaced_at,
             'adminDescription', q.admin_description, 'bundle', q.bundle, 'role', q.role, 'bundleName', q.bundle_name,
             'waitsFor', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'role', d.role, 'kind', d.kind, 'name', d.params ->> 'name') order by d.id)
                                   from queued_moves d where d.id = any (coalesce(q.depends_on, '{}')) and d.landed_act is null and d.held_at is null and d.refused_at is null), '[]'::jsonb),
             'boardName', case when q.kind = 'renameBoard' and lower(q.params ->> 'board') ~ uuid_re
                               then (select b.name from boards_now b where b.id = (q.params ->> 'board')::uuid) end) as j
    from queued_moves q where q.landed_act is null and q.held_at is null and q.refused_at is null
    order by q.go_live_at, q.id limit cap + 1
  ) x;

  select coalesce(jsonb_agg(x.j order by x.n) filter (where x.n <= cap), '[]'::jsonb), coalesce(bool_or(x.n > cap), false) into in_force, in_force_more from (
    select row_number() over (order by a.created_at desc, a.id) as n,
           jsonb_build_object('act', a.id, 'id', q.id, 'staff', c.staff, 'boss', c.name, 'bossPronouns', (select p.pronouns from character_profiles p where p.character = c.id), 'kind', a.payload ->> 'kind', 'params', a.payload -> 'params',
             'demand', a.payload -> 'demand', 'why', q.why, 'landedAt', a.created_at, 'expiresAt', a.payload -> 'expires_at',
             'bundle', q.bundle, 'role', q.role, 'bundleName', q.bundle_name,
             'progress', case when o.progress is null then jsonb_build_object('checkedAt', null)
                              else o.progress || jsonb_build_object('checkedAt', o.checked_at) end) as j
    from open_moves o
    join acts a on a.id = o.move_act
    left join characters c on c.id = a.character
    left join queued_moves q on q.landed_act = a.id
    order by a.created_at desc, a.id limit cap + 1
  ) x;

  -- The Mod Bots' cards (Task 7): the face-up plays of staff characters in the last 30 days that are still in force: not caught, not worn
  -- off (by the play's own end or its reach's), not ended by an admin. A Set is a `set` Act, never a `card`, so a face-down card is not
  -- here until it springs; its strike is a `card` Act and is. Per staff character a probe of acts_card_plays (character, created_at desc)
  -- reads only that character's plays in the window, newest first and cut at cap + 1 inside the probe, so the cost is the staff roster
  -- times cap and never the history of Acts or the players' plays. The names are public ones (the card's, the persona's, the post
  -- author's or the target the play named); nothing private is read.
  select coalesce(jsonb_agg(x.j order by x.n) filter (where x.n <= cap), '[]'::jsonb), coalesce(bool_or(x.n > cap), false) into staff_cards, staff_cards_more from (
    select row_number() over (order by k.created_at desc, k.id) as n,
           jsonb_build_object('play', k.id, 'card', k.payload ->> 'card', 'cardName', (select ck.name from card_kinds ck where ck.key = k.payload ->> 'card'),
             'staff', c.staff, 'persona', c.name,
             'targetName', coalesce(k.payload ->> 'targetName', (select tc.name from acts pa join characters tc on tc.id = pa.character where pa.id = k.target_act_id)),
             'thread', k.thread, 'threadTitle', (select th.title from threads th where th.id = k.thread), 'at', k.created_at) as j
    from characters c
    cross join lateral (
      select p.* from acts p
      where p.character = c.id and p.kind = 'card' and p.created_at >= win
        and not (p.payload ? 'caught')
        and (p.payload ->> 'ends' is null or (p.payload ->> 'ends')::timestamptz > now())
        and not exists (select 1 from play_reach r where r.play = p.id and r.ends_at <= now())
        and not exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = p.id)
      order by p.created_at desc, p.id desc limit cap + 1
    ) k
    where c.staff is not null
    order by k.created_at desc, k.id limit cap + 1
  ) x;

  -- Ended and held, merged: each side cut at cap + 1 first, so the merge never reads more than 2 * (cap + 1) rows.
  select coalesce(jsonb_agg(x.j order by x.n) filter (where x.n <= cap), '[]'::jsonb), coalesce(bool_or(x.n > cap), false) into ended, ended_more from (
    select row_number() over (order by u.at desc, u.tie) as n, u.j from (
      (select e.created_at as at, e.id::text as tie,
              jsonb_build_object('how', e.payload ->> 'why', 'by', e.payload ->> 'by', 'at', e.created_at, 'act', a.id, 'id', q.id, 'staff', c.staff, 'boss', c.name, 'bossPronouns', (select p.pronouns from character_profiles p where p.character = c.id),
                'kind', a.payload ->> 'kind', 'params', a.payload -> 'params', 'demand', a.payload -> 'demand', 'why', q.why, 'landedAt', a.created_at,
                'bundle', q.bundle, 'role', q.role, 'bundleName', q.bundle_name) as j
       from acts e
       join acts a on a.id = e.target_act_id
       left join characters c on c.id = a.character
       left join queued_moves q on q.landed_act = a.id
       where e.kind = 'move_end' and e.created_at >= win
       order by e.created_at desc, e.id desc limit cap + 1)
      union all
      (select e.created_at, e.id::text,
              jsonb_build_object('how', 'reversed', 'by', 'admin', 'at', e.created_at, 'act', p.id, 'id', null, 'staff', c.staff, 'boss', c.name, 'bossPronouns', (select p.pronouns from character_profiles p where p.character = c.id),
                'kind', 'card', 'params', '{}'::jsonb, 'demand', null, 'why', null, 'landedAt', p.created_at,
                'card', coalesce((select ck.name from card_kinds ck where ck.key = p.payload ->> 'card'), p.payload ->> 'card'))
       from acts e
       join acts p on p.id = e.target_act_id
       left join characters c on c.id = p.character
       where e.kind = 'card_end' and e.created_at >= win
       order by e.created_at desc, e.id desc limit cap + 1)
      union all
      (select h.held_at, 'q' || h.id::text,
              jsonb_build_object('how', 'held', 'by', 'admin', 'at', h.held_at, 'act', null, 'id', h.id, 'staff', h.staff, 'boss', c.name, 'bossPronouns', (select p.pronouns from character_profiles p where p.character = c.id),
                'kind', h.kind, 'params', h.params, 'demand', h.demand, 'why', h.why, 'landedAt', null, 'bundle', h.bundle, 'role', h.role, 'bundleName', h.bundle_name)
       from queued_moves h
       left join characters c on c.staff = h.staff
       where h.held_at is not null and h.held_at >= win
       order by h.held_at desc, h.id desc limit cap + 1)
      union all
      (select h.refused_at, 'r' || h.id::text,
              jsonb_build_object('how', 'refused', 'by', 'tick', 'at', h.refused_at, 'act', null, 'id', h.id, 'staff', h.staff, 'boss', c.name, 'bossPronouns', (select p.pronouns from character_profiles p where p.character = c.id),
                'kind', h.kind, 'params', h.params, 'demand', h.demand, 'why', h.why, 'landedAt', null, 'reason', h.failure, 'bundle', h.bundle, 'role', h.role, 'bundleName', h.bundle_name)
       from queued_moves h
       left join characters c on c.staff = h.staff
       where h.refused_at is not null and h.held_at is null and h.refused_at >= win
       order by h.refused_at desc, h.id desc limit cap + 1)
    ) u order by u.at desc, u.tie limit cap + 1
  ) x;

  -- The to-dos (the staff roster design, section 11): each handover that changed the Boss, until an update is posted after it landed or an
  -- admin dismisses it. "An update after it" is one read of the newest update (the acts_updates index, 0062) against each handover's instant.
  -- A season can hold two (a roll-over's and a departure's), so a to-do is a handover's, named by its id, with its cause; the handoff is that of the season the outgoing Boss served.
  latest_update := (select a.created_at from acts a where a.kind = 'update' order by a.created_at desc, a.id desc limit 1);
  select coalesce(jsonb_agg(jsonb_build_object(
           'handover', t.handover, 'cause', t.cause,
           'season', t.number, 'boss', t.boss, 'bossName', bc.name, 'bossPronouns', (select p.pronouns from character_profiles p where p.character = bc.id),
           'bossWas', (select o.office from staff_offices o where o.staff = t.boss and o.at <= t.landed_at order by o.id desc limit 1),
           'outgoing', t.outgoing, 'outgoingName', oc.name, 'outgoingPronouns', (select p.pronouns from character_profiles p where p.character = oc.id), 'outgoingOffice', (select n.office from staff_office_now n where n.staff = t.outgoing),
           'how', h.how, 'landedAt', t.landed_at,
           -- The outgoing Boss's handoff (0337, above): its note, out of character and an admin's to read, and the facts the code computed for the season it ended (the handover's own season for a departure).
           'note', (select nullif(x.note, '') from handoffs_latest x where x.season = ps.id and x.staff = t.outgoing),
           'facts', handoff_facts(ps.id)) order by t.landed_at desc, t.handover desc), '[]'::jsonb) into todos
  from season_boss_changes t
  join season_handovers h on h.id = t.handover
  join characters bc on bc.staff = t.boss
  left join characters oc on oc.staff = t.outgoing
  cross join lateral (select case when t.cause = 'departure' then t.season else (select p.id from seasons p where p.id < t.season order by p.id desc limit 1) end as id) ps
  where ps.id is not null
    and (latest_update is null or latest_update <= t.landed_at)
    and not exists (select 1 from handover_dismissals d where d.handover = t.handover);

  return jsonb_build_object('cap', cap, 'waiting', waiting, 'inForce', in_force, 'staffCards', staff_cards, 'ended', ended, 'roster', roster, 'todos', todos,
    'more', jsonb_build_object('waiting', waiting_more, 'inForce', in_force_more, 'staffCards', staff_cards_more, 'ended', ended_more));
end $$;

-- season_news (0368_client_reads_plan_once.sql), a Boss who left by a departure left the season of the handover, not the season before it. Everything else as 0368_client_reads_plan_once.sql wrote it.
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
    select coalesce((select n.landed_at from news_landed n where n.kind in ('tally', 'announcements') and n.landed_at < (select b from lim)
                     order by n.landed_at desc, n.act desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz) as at
  ),
  tallies as (
    select 'tally'::text as kind, a.id as act, a.thread, a.seq, n.landed_at as at,
           case when n.kind = 'tally' then (a.payload ->> 'season')::integer else (select s.number from seasons s where s.turns_thread = a.thread) end as season,
           null::text as name, null::text as quote,
           case when n.kind = 'tally' then tally_names(a.payload)
                else (select count(*) from acts x where x.kind = 'announce' and x.thread = a.thread and x.created_at = a.created_at)::integer end as count,
           case when n.kind = 'tally' then
             jsonb_build_object('debuts', case when jsonb_typeof(a.payload -> 'debuts') = 'array' then a.payload -> 'debuts' else '[]'::jsonb end,
                                'turns', case when jsonb_typeof(a.payload -> 'turns') = 'array' then a.payload -> 'turns' else '[]'::jsonb end)
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
    where n.kind in ('tally', 'announcements') and n.landed_at < (select b from lim) and n.landed_at >= (select at from t_floor)
  ),
  boss_all as materialized (
    select 'bossArrived'::text as kind, h.boss as who, h.landed_at as at, h.number as season, 'bossArrival'::text as line from season_boss_changes h
    where h.landed_at < (select b from lim)
    union all
    select 'bossLeft', h.outgoing, h.landed_at, case when h.cause = 'departure' then h.number else h.number - 1 end, 'bossFarewell' from season_boss_changes h
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
      select a.id, a.thread, a.seq, public_payload(a.payload, version_hidden(a.id), a.id) ->> 'body' as body
      from characters ch join acts a on a.character = ch.id
      where ch.staff = c.who and a.created_at = c.at and a.kind = 'post' and a.thread = (select thread from ann)
        and exists (select 1 from settings s where s.key = 'systemLines' and jsonb_typeof(s.value -> c.line) = 'array' and jsonb_array_length(s.value -> c.line) > 0)
      order by a.seq limit 1
    ) p on true
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


-- staff_career (0368_client_reads_plan_once.sql), the Boss's terms read from the handovers: a season's opening Boss and each Boss a departure seated in it, each term its own entry, and a departure ends the office
-- the seated Boss held before it as a season's start does. Everything else as 0368_client_reads_plan_once.sql wrote it.
create or replace function public.staff_career(of_staff text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return (
  select jsonb_build_object(
    'led', coalesce((
      select jsonb_agg(jsonb_build_object('season', t.number, 'since', to_char((t.since) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'until', to_char((t.until) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'how', t.how) order by t.number, t.since, t.ord)
      from (
        -- The Boss the season opened with: the one the season's first departure took the chair from, else the season's Boss; it opened by the roll-over (the first season by the seed) and led until that departure, or the season's end.
        select s.number, s.starts_at as since, coalesce(d1.landed_at, s.ends_at) as until, case when s.number = (select min(number) from seasons) then 'seed' else h.how end as how, 0 as ord
        from seasons s
        left join season_handovers h on h.season = s.id and h.cause = 'rollover'
        left join lateral (select x.outgoing, x.landed_at from season_handovers x where x.season = s.id and x.cause = 'departure' order by x.landed_at, x.id limit 1) d1 on true
        where coalesce(d1.outgoing, s.boss) = of_staff
        union all
        -- Each Boss a departure seated: from the departure until the next one, or the season's end.
        select s.number, d.landed_at, coalesce(d.next_at, s.ends_at), d.how, 1
        from (select x.season, x.boss, x.how, x.landed_at, lead(x.landed_at) over (partition by x.season order by x.landed_at, x.id) as next_at
              from season_handovers x where x.cause = 'departure') d
        join seasons s on s.id = d.season
        where d.boss = of_staff
      ) t
      where exists (select 1 from characters c where c.staff = of_staff and c.staff_kind = 'persona')
    ), '[]'::jsonb),
    'offices', coalesce((
      select jsonb_agg(jsonb_build_object('office', o.office, 'since', to_char((o.at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'until', to_char((select min(t) from (values (o.next_at), ((
          select min(s.starts_at) from seasons s where s.boss = of_staff and s.starts_at > o.at)), ((
          select min(d.landed_at) from season_handovers d where d.cause = 'departure' and d.boss = of_staff and d.landed_at > o.at))) v(t)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'cause', o.cause) order by o.id)
      from (select r.id, r.office, r.at, r.cause, lead(r.at) over (order by r.id) as next_at from staff_offices r where r.staff = of_staff) o
    ), '[]'::jsonb))
  );
end
$function$;


-- reveal_season (0206_trophies.sql), its fallback handover row written as the roll-over's: season is no longer unique in season_handovers, one roll-over per season is (season_handovers_one_rollover), so the
-- conflict names that index. Everything else as 0206_trophies.sql wrote it.
create or replace function reveal_season(ended timestamptz) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s seasons%rowtype;
  new_season bigint;
  written integer;
begin
  select * into s from seasons where ends_at is null for no key update;
  if s.id is null or s.starts_at + span_interval(setting('seasonLength')) > ended then return null; end if;

  update seasons set ends_at = ended where id = s.id;
  insert into seasons (number, starts_at) values (s.number + 1, ended) returning id into new_season;
  begin
    perform hand_over(new_season, s.boss, ended);
  exception when others then
    raise warning 'reveal_season: the handover of season % failed: % (%)', s.number + 1, sqlerrm, sqlstate;
    -- The season keeps its outgoing Boss rather than none, where that much can still be done.
    begin
      update seasons set boss = s.boss where id = new_season and boss is null;
      insert into season_handovers (season, outgoing, boss, how, note, at, cause)
      values (new_season, s.boss, s.boss, case when s.boss is null then 'none' else 'unchanged' end, left('the handover failed: ' || sqlerrm, 1000), ended, 'rollover')
      on conflict (season) where cause = 'rollover' do nothing;
    exception when others then null;
    end;
  end;
  -- Each character in order of final standing, with its place and its standing, and only what its player made public in the season (`shown`): its
  -- reveals, and its announced Turns with the class each left where the Turn named it, in order. Read from class_reveals and turns_announced (0027),
  -- which read Acts alone, so no unrevealed class and no silent Turn is in it: they roll over into the next season, a clue rather than a stated fact
  -- (the class reveal design, section 5). A Turn that took effect at this very end is the next season's, as before. At one instant a Turn comes before
  -- the reveal it wrote (0028), as its tally stands before it in the thread. A character that debuts at this very settlement played no part in the
  -- season, and is the next one's.
  insert into season_results (season, character, name, place, standing, shown)
    select s.id, c.id, c.name, case when coalesce(st.amount, 0) > 0 then dense_rank() over (order by coalesce(st.amount, 0) desc) end, coalesce(st.amount, 0),
        coalesce((
          select jsonb_agg(x.entry order by x.at, x.after, x.act) from (
            select r.at, 1 as after, r.act, jsonb_build_object('kind', 'reveal', 'act', r.act, 'at', r.at, 'class', r.class, 'via', r.via) as entry
            from class_reveals r where r.character = c.id and r.at >= s.starts_at and r.at < ended
            union all
            select t.at, 0, t.act, jsonb_build_object('kind', 'turn', 'act', t.act, 'at', t.at)
              || case when t.was is null then '{}'::jsonb else jsonb_build_object('was', t.was) end
            from turns_announced t where t.character = c.id and t.at >= s.starts_at and t.at < ended
          ) x), '[]'::jsonb)
    from characters c left join standings st on st.character = c.id and st.season = s.id
    where c.debuted_at < ended and c.staff is null
    order by coalesce(st.amount, 0) desc, c.name, c.id;
  get diagnostics written = row_count;
  update seasons set results_at = now(), results_count = written where id = s.id;
  -- The season's places (0206): each character at place 1 to 3 gets the trophy the instance gives for that place. Places are season_results' own, dense (#453), so a tie shares
  -- one and the next mask takes the next place, as the table shows it: 100, 90, 90, 80 give a Champion, two Runner-Up and a Third. An unplaced row (#492) joins no kind:
  -- 500, 0, 0 give one Champion and nothing else. Staff are not in season_results, and the table refuses them besides. In the results' transaction, but a failure here does not end it.
  -- In a block of its own: the season ends whatever happens here. A failure is a warning and a row (trophy_award_failures) for an admin, who can give the places by hand.
  begin
    insert into trophy_awards (trophy, character, by, season)
    select k.key, r.character, 'season', s.id from season_results r join trophy_kinds k on k.season_place = r.place
    where r.season = s.id and r.place <= 3;
  exception when others then
    raise warning 'reveal_season: the places of season % were not given trophies: % (%)', s.number, sqlerrm, sqlstate;
    begin
      insert into trophy_award_failures (season, error) values (s.id, left(sqlerrm || ' (' || sqlstate || ')', 500))
      on conflict (season) do update set error = excluded.error, at = now();
    exception when others then null;
    end;
  end;
  perform broadcast_later('reach', 'news', jsonb_build_object('kind', 'seasonNews', 'sub', 'results', 'season', s.number, 'act', null, 'at', now()));
  return jsonb_build_object('season', s.number, 'results', written);
end $$;


-- system_tick (0334_meeting_bundles.sql), the grace for an inherited move counts from the instant the open season's Boss was seated: the latest Boss-changing handover's `at`, else the season's start. A departure
-- mid-season gives the new Boss the grace a roll-over does. Everything else as 0334_meeting_bundles.sql wrote it.
create or replace function system_tick() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  enabled boolean := coalesce((select s.value = 'true'::jsonb from settings s where s.key = 'systemEnabled'), false);
  ann uuid := (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements');
  check_every interval := make_interval(mins => coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'demandCheckMinutes'), 5));
  cap integer := coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'demandChecksPerTick'), 40);
  budget_ends timestamptz := clock_timestamp() + make_interval(secs => coalesce(nullif(current_setting('kayfabb.tick_budget_seconds', true), '')::numeric, 20));
  due record;
  inforce record;
  written uuid;
  why text;
  clash text;
  ended_by text;
  counted jsonb;
  expires timestamptz;
  did_end boolean;
  landed integer := 0;
  met integer := 0;
  expired integer := 0;
  failed integer := 0;
  unmet integer := 0;
  arcs integer := 0;
  awards_failed integer := 0;
  checked integer := 0;
  out_of_time boolean := false;
  superseded integer := 0;
  filed integer := 0;
  tries integer;
  late record;
  check_at timestamptz;
  filing_grace interval := make_interval(mins => coalesce((select (s.value #>> '{filingGraceMinutes}')::integer from settings s where s.key = 'modBots'), 10));
  boss text := current_boss();
  -- The instant the open season's Boss was seated: the latest Boss-changing handover of the open season (a departure's included), else the season's start.
  handed timestamptz := coalesce((select h.at from season_boss_changes h join seasons x on x.id = h.season and x.ends_at is null order by h.landed_at desc, h.handover desc limit 1),
                                  (select x.starts_at from seasons x where x.ends_at is null));
  grace interval := make_interval(days => coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'inheritanceGraceDays'), 3));
  first_before uuid;
  was record;
  dep record;
  lp jsonb;
  rk text;
  resolved uuid;
begin
  if not pg_try_advisory_xact_lock(hashtext('kayfabb.system_tick')) then return jsonb_build_object('skipped', true); end if;

  -- The one lock order (0339): the global place key before anything is written. A lasting move due to land, or one in force that this tick may end (an expiry, a demand met, a superseded one), writes places;
  -- a move landed before it writes an Act into the announcements thread, a row an admin's reversal (which takes the key and then writes its end into that thread) waits for, so the key cannot wait until the
  -- first lasting landing. The one key is held to the end of the tick; the tick's own rows are the only thing it waits for before it is taken.
  if exists (select 1 from queued_moves q join move_kinds k on k.key = q.kind
             where k.lasting and q.landed_act is null and q.held_at is null and q.refused_at is null and q.go_live_at <= now())
     or exists (select 1 from open_moves o join acts a on a.id = o.move_act join move_kinds k on k.key = a.payload ->> 'kind' where k.lasting) then
    perform lock_thread_places();
  end if;

  -- 1. Landing: only while The System is on, and only where there is a thread to say it in.
  if enabled and ann is not null then
    for due in
      select q.id, q.staff, q.kind, q.params, q.demand, q.expires_at, q.admin_description, q.bundle, q.depends_on from queued_moves q where q.landed_act is null and q.held_at is null and q.refused_at is null and q.go_live_at <= now() order by q.go_live_at, q.id for update skip locked
    loop
      -- A machine move is checked against the machine as it is now, so it waits for the machine's one lock (0141's admin functions take it to take a pack off sale or
      -- reorder), taken here and not inside the block below so that a timeout is not swallowed as a failed move. Without it a Pull landing as an admin took the last pack
      -- holding its card off sale could each miss the other and leave a Pull with no pack on sale. The tick holds only queued_moves rows (and Acts it inserts) when it
      -- waits here, and those functions never lock those rows, so there is no cycle. Taken only when a machine move is about to be checked, and held to the end of
      -- the tick, so the checks below read what the admin committed.
      if due.kind in ('pullSlot', 'repriceSlot', 'flashSale') then perform pg_advisory_xact_lock(hashtext('kayfabb.machine')); end if;
      begin
        -- A part of a bundle (0329) lands after the parts it builds on, and not before: one of them still waiting, and this one waits; one refused, and it is refused with it (nothing
        -- will ever make the board it names); one held (an admin's hold follows its dependents at once, so this only meets a row queued after the hold), and it is held with it. Then each
        -- role in its params is the board the part it names made, in the Act, so the Act says which board it moved to and the log can name it.
        lp := due.params;
        if due.depends_on is not null then
          select d.id, d.held_at, d.held_by, d.refused_at, d.role into dep from queued_moves d
          where d.id = any (due.depends_on) and d.landed_act is null order by (d.refused_at is not null) desc, (d.held_at is not null) desc, d.id limit 1;
          if found then
            if dep.refused_at is not null then
              update queued_moves set failed_at = now(), failure = left('that move cannot land: the move it builds on was refused', 500), refused_at = now() where id = due.id;
            elsif dep.held_at is not null then
              update queued_moves set held_at = dep.held_at, held_by = dep.held_by where id = due.id;
            end if;
            continue;
          end if;
        end if;
        for rk in select e.key from jsonb_each(lp) e where jsonb_typeof(e.value) = 'object' and e.value ? 'role' loop
          resolved := case when (lp -> rk) ? 'beat'
            then beat_role_board(meeting_season((select q.meeting from queued_moves q where q.id = due.id)), due.staff, lp #>> array[rk, 'beat'], lp #>> array[rk, 'role'])
            else role_board(due.bundle, lp #>> array[rk, 'role']) end;
          if resolved is null then exit; end if;
          lp := jsonb_set(lp, array[rk], to_jsonb(resolved::text));
        end loop;
        if resolved is null and exists (select 1 from jsonb_each(lp) e where jsonb_typeof(e.value) = 'object' and e.value ? 'role') then
          update queued_moves set failed_at = now(), failure = left('that move cannot land: a part it names made no board', 500), refused_at = now() where id = due.id;
          continue;
        end if;
        -- Two rules that conflict may have waited together; the one that lands second meets the first. It is refused for good, with the reason.
        if due.kind = 'setRule' then
          clash := rule_conflict(nullif(lp ->> 'board', '')::uuid, lp ->> 'predicate', nullif(lp -> 'param', 'null'::jsonb));
          if clash is not null then
            update queued_moves set failed_at = now(), failure = left('that rule would leave no post that follows the rules: ' || clash, 500), refused_at = now() where id = due.id;
            continue;
          end if;
        end if;
        -- The machine's moves are checked against the machine as it is now (0140): a slot an admin has since changed, a card no pack on sale can give, a pull too many.
        -- Refused for good with the reason, as a rule is, and never applied: it is no Act, so nothing was put on the machine and nothing needs reversing.
        if due.kind in ('pullSlot', 'repriceSlot', 'flashSale') then
          clash := machine_move_problem(due.kind, lp, due.demand, (select q.go_live_at from queued_moves q where q.id = due.id), due.expires_at, true);
          if clash is not null then
            update queued_moves set failed_at = now(), failure = left('that machine move cannot land: ' || clash, 500), refused_at = now() where id = due.id;
            continue;
          end if;
        end if;
        -- The three moves that build the board are checked against the boards and threads as they are now (0320), as a machine move is against the machine: state changes between
        -- the queue and the landing (a board closed, a thread gone, a merge that would now make a cycle). Refused for good, with the reason; it is no Act, so nothing needs reversing.
        if due.kind in ('createBoard', 'moveThread', 'mergeBoard') then
          -- The writers of a place wait for each other (0339): the global key (already held, taken before the loop; a second take costs nothing), and for a merge the key of the board it closes, which a
          -- thread insert on that board tries shared, so a thread started there is committed before the merge reads its threads, or is refused at once. Both are held to the end of the tick.
          perform lock_thread_places();
          if due.kind = 'mergeBoard' then perform lock_board_closing(safe_uuid(lp ->> 'board')); end if;
          clash := lasting_move_problem(due.kind, lp);
          if clash is not null then
            update queued_moves set failed_at = now(), failure = left('that move cannot land: ' || clash, 500), refused_at = now() where id = due.id;
            continue;
          end if;
          first_before := first_open_board();
        end if;
        -- The Boss's trophy (0208) is checked against the instance as it is now: a character that has since become staff or retired, a trophy it was given meanwhile, a belt it
        -- already holds. Refused for good with the reason, as the machine's moves are, and never applied: it is no Act, so no award was written and nothing needs reversing.
        if due.kind = 'awardTrophy' then
          clash := trophy_move_problem(due.params, due.demand);
          if clash is not null then
            update queued_moves set failed_at = now(), failure = left('that trophy cannot be given: ' || clash, 500), refused_at = now() where id = due.id;
            continue;
          end if;
        end if;
        written := (write_staff_act(due.staff, 'move', ann, null,
          jsonb_build_object('kind', due.kind, 'params', lp, 'body', system_line(case when due.kind = 'setRule' then 'ruleSet' else 'moveLanded' end, due.kind, lp, due.staff))
          || case when due.demand is not null then jsonb_build_object('demand', due.demand) else '{}'::jsonb end
          || case when due.expires_at is not null then jsonb_build_object('expires_at', due.expires_at) else '{}'::jsonb end) ->> 'id')::uuid;
        update queued_moves set landed_act = written where id = due.id;
        -- What it was built on, recorded now that it has landed: an admin's reversal of one of them follows it (reverse_move).
        if due.depends_on is not null then
          insert into move_dependencies (act, on_act) select written, d.landed_act from queued_moves d where d.id = any (due.depends_on) and d.landed_act is not null and d.landed_act <> written on conflict do nothing;
        end if;
        -- The award is the move's whole effect and outlasts it: written in this transaction, naming the move's Act, and the move ends at once (`spent`, as a nomination does). If
        -- either fails, the Act goes with them (this block's rollback) and the move is left due, with the failure recorded below.
        if due.kind = 'awardTrophy' then
          insert into trophy_awards (trophy, character, by, act) values (due.params ->> 'trophy', (due.params ->> 'character')::uuid, 'boss', written);
          perform end_move(written, 'spent', 'award');
        end if;
        if due.kind = 'renameBoard' and due.admin_description is not null then
          perform write_describe((lp ->> 'board')::uuid, due.admin_description, written);
        end if;
        -- A made board is a row (its slug from its name), pointing at the Act that made it; a moved thread ends the move of the same thread that was in force, as superseded; then the
        -- threads the move touched are rebuilt (lasting_rebuild), so the stored board follows the Acts.
        if due.kind = 'createBoard' then
          insert into boards (slug, name, description, created_by_act) values (board_slug_for(lp ->> 'name'), lp ->> 'name', coalesce(lp ->> 'description', ''), written);
        elsif due.kind = 'moveThread' then
          for was in
            select o.move_act from open_moves o join acts a on a.id = o.move_act
            where a.payload ->> 'kind' = 'moveThread' and lower(a.payload #>> '{params,thread}') = lower(lp ->> 'thread') and a.id <> written
            order by o.landed_at, o.move_act
          loop
            if (end_move(was.move_act, 'superseded', 'landing') ->> 'ended')::boolean then perform say_move_end(was.move_act, 'superseded'); end if;
          end loop;
        end if;
        if due.kind in ('createBoard', 'moveThread', 'mergeBoard') then perform lasting_rebuild(written, first_before); end if;
        landed := landed + 1;
      exception when others then
        failed := failed + 1;
        raise warning 'system_tick: queued move % did not land: % (%)', due.id, sqlerrm, sqlstate;
        -- Recorded on the row (the latest failure), so the admin queue can show it and an admin can hold the row. The row stays due.
        update queued_moves set failed_at = now(), failure = left(sqlerrm || ' (' || sqlstate || ')', 500) where id = due.id;
      end;
    end loop;
  end if;

  -- 1b. Arcs (0332): after landing, so a bundle that landed in this tick has unlocked what waited on it in the same one. Only while The System is on (a beat unlocks for a meeting). The pass reads the
  -- season's Boss alone and costs the same however many Acts there are; a failure of it is counted and warned about and never stops the rest of the tick.
  if enabled then
    begin
      lp := arc_pass();
      arcs := (lp ->> 'unlocked')::integer + (lp ->> 'lapsed')::integer;
    exception when others then
      failed := failed + 1;
      raise warning 'system_tick: the arc pass failed: % (%)', sqlerrm, sqlstate;
    end;
  end if;

  -- 2. Expiry: whatever the switch says, for every move in force, every tick. It is a comparison.
  for inforce in
    select o.move_act, a.character, a.thread, a.payload from open_moves o join acts a on a.id = o.move_act order by o.landed_at, o.move_act
  loop
    expires := move_expires_at(inforce.move_act);
    if expires is not null and expires <= now() then
      begin
        did_end := (end_move(inforce.move_act, 'expired', 'expiry') ->> 'ended')::boolean;
        if did_end then expired := expired + 1; perform say_move_end(inforce.move_act, 'expired'); end if;
      exception when others then
        failed := failed + 1;
        raise warning 'system_tick: move % did not end: % (%)', inforce.move_act, sqlerrm, sqlstate;
      end;
    end if;
  end loop;

  -- 2b. The handover's leftovers, whatever the switch says. A nomination in force whose Boss is not the season's is spent (a nomination that
  -- landed after the handover it was for); a move that shapes a board and is not the season's Boss's, still unaddressed `inheritanceGraceDays`
  -- after the handover that seated the Boss, the latest of the season's (a departure's included), or after it landed, if later, ends `superseded`: the new Boss's review never came, or never reached it. A move the
  -- Boss kept is its own (move_owner), so it never ends here. The read is of the moves in force, a handful of rows.
  if boss is not null then
    for inforce in
      select o.move_act, a.payload ->> 'kind' as kind, o.landed_at
      from open_moves o join acts a on a.id = o.move_act join move_kinds k on k.key = a.payload ->> 'kind' and (k.shapes_board or k.key = 'nameSuccessor') and not k.lasting
      where move_owner(o.move_act) is distinct from boss
      order by o.landed_at, o.move_act
    loop
      begin
        if inforce.kind = 'nameSuccessor' then
          perform end_move(inforce.move_act, 'spent', 'handover');
        elsif greatest(inforce.landed_at, handed) + grace <= now() then
          did_end := (end_move(inforce.move_act, 'superseded', 'inheritance') ->> 'ended')::boolean;
          if did_end then superseded := superseded + 1; perform say_move_end(inforce.move_act, 'superseded'); end if;
        end if;
      exception when others then
        failed := failed + 1;
        raise warning 'system_tick: inherited move % did not end: % (%)', inforce.move_act, sqlerrm, sqlstate;
      end;
    end loop;
  end if;

  -- 3. Demands: the moves least recently checked, at most `cap`, none checked within `check_every`, and none once the budget is spent.
  -- A move with no demand is never read. `checked_at` is set before the read, so a move whose progress errors takes its turn like the
  -- rest instead of holding the front of the line; the count it read is stored beside it (`open_moves.progress`, 0053).
  for inforce in
    select o.move_act, a.thread, a.payload from open_moves o join acts a on a.id = o.move_act where jsonb_typeof(a.payload -> 'demand') = 'object' and not (a.payload ->> 'kind' = 'conferGroup' and a.payload #> '{params,checkAt}' is not null) and (o.checked_at is null or o.checked_at <= now() - check_every) order by o.checked_at nulls first, o.move_act limit cap
  loop
    if clock_timestamp() > budget_ends then out_of_time := true; exit; end if;
    update open_moves set checked_at = now() where move_act = inforce.move_act;
    checked := checked + 1;
    did_end := false;
    counted := null;
    begin
      counted := demand_progress_or_error(inforce.move_act);
      if coalesce((counted ->> 'met')::boolean, false) then
        did_end := (end_move(inforce.move_act, 'met', 'demand') ->> 'ended')::boolean;
        if did_end then
          met := met + 1;
          -- The met demand's trophy to each character that made it (0206), in a block of its own: the move is ended whatever happens here. A failure is a warning, a row
          -- (trophy_award_failures) and a count in the tick's answer, and an admin can give the trophy by hand.
          begin
            perform award_demand_trophies(inforce.move_act);
          exception when others then
            awards_failed := awards_failed + 1;
            raise warning 'system_tick: the trophies for move % were not given: % (%)', inforce.move_act, sqlerrm, sqlstate;
            begin
              insert into trophy_award_failures (move_act, error) values (inforce.move_act, left(sqlerrm || ' (' || sqlstate || ')', 500))
              on conflict (move_act) do update set error = excluded.error, at = now();
            exception when others then null;
            end;
          end;
        end if;
      end if;
    exception when others then
      failed := failed + 1;
      did_end := false;
      raise warning 'system_tick: move % did not end: % (%)', inforce.move_act, sqlerrm, sqlstate;
    end;
    -- What it read is kept on the move's row (a move just ended has no row left, and the update finds none), outside the block above so
    -- that a failure in ending the move does not take the count with it. The board and the admin queue read this, not the evaluator.
    if counted is not null then update open_moves set progress = counted where move_act = inforce.move_act; end if;
    -- The Boss says it. The move is ended whether or not the line is posted.
    if did_end then perform say_move_end(inforce.move_act, 'met'); end if;
  end loop;

  -- 3b. Favors: a favor is a group conferred with a check (`params.checkAt`) and the demand it reads. It is not ended `met` by the pass above: a favor met is kept to its
  -- expiry. At its check, one whose demand is not met is stripped, `unmet`, and the Boss says so. A demand that cannot be evaluated (progress carries an `error`) is no evidence:
  -- the favor is left and read again at the next turn. The moves in force that carry a check are a handful; one past its check is read at most once in `demandCheckMinutes`, the
  -- least recently checked first, and none once the budget is spent. One already recorded met (open_moves.progress) is not read again: a demand only ever grows, and the favor
  -- is kept to its expiry.
  for inforce in
    select o.move_act, a.payload from open_moves o join acts a on a.id = o.move_act
    where a.payload ->> 'kind' = 'conferGroup' and a.payload #> '{params,checkAt}' is not null and (o.checked_at is null or o.checked_at <= now() - check_every)
      and coalesce((o.progress ->> 'met')::boolean, false) is not true
      -- Only a favor whose check has come (the case keeps a malformed time from being cast: the guard refuses one, and a move written any other way must not stop the tick).
      and case when a.payload #>> '{params,checkAt}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then (a.payload #>> '{params,checkAt}')::timestamptz end <= now()
    order by o.checked_at nulls first, o.move_act limit cap
  loop
    if clock_timestamp() > budget_ends then out_of_time := true; exit; end if;
    begin
      check_at := (inforce.payload #>> '{params,checkAt}')::timestamptz;
      if check_at <= now() then
        update open_moves set checked_at = now() where move_act = inforce.move_act;
        checked := checked + 1;
        counted := demand_progress_or_error(inforce.move_act);
        if not (counted ? 'error') then update open_moves set progress = counted where move_act = inforce.move_act; end if;
        if counted ? 'error' then
          failed := failed + 1;
          raise warning 'system_tick: favor % could not be read at its check: % ', inforce.move_act, counted ->> 'error';
        elsif not coalesce((counted ->> 'met')::boolean, false) then
          did_end := (end_move(inforce.move_act, 'unmet', 'check') ->> 'ended')::boolean;
          if did_end then unmet := unmet + 1; perform say_move_end(inforce.move_act, 'unmet'); end if;
        end if;
      end if;
    exception when others then
      failed := failed + 1;
      raise warning 'system_tick: favor % was not checked: % (%)', inforce.move_act, sqlerrm, sqlstate;
    end;
  end loop;

  -- 4. Visits: each open visit `filingGraceMinutes` past its end is filed with the stock line, so nothing waits on a model. Whatever the switch says: a
  -- visit that has started is filed even if The System is turned off, and even if its Mod has left the staff. By visits_open_due, oldest first, and none once
  -- the budget is spent, at most `demandChecksPerTick` (the tick's one count for work per run; visits have no setting of their own); one that has failed goes behind the
  -- rest, by its last failure; file_visit locks the visit, so the filing cron racing this files it once. One that fails is left for the next tick.
  for late in
    select o.visit_act from visits_open o where o.ends_at <= now() - filing_grace order by o.failed_at nulls first, o.ends_at, o.visit_act limit cap
  loop
    if clock_timestamp() > budget_ends then out_of_time := true; exit; end if;
    begin
      if (file_visit(late.visit_act, null) ->> 'filed')::boolean then filed := filed + 1; end if;
    exception when others then
      failed := failed + 1;
      raise warning 'system_tick: visit % did not file: % (%)', late.visit_act, sqlerrm, sqlstate;
      -- Recorded, and sent behind the others (the order above), so a visit that keeps failing never starves the rest.
      update visits_open set failed_at = now(), attempts = attempts + 1 where visit_act = late.visit_act returning attempts into tries;
      insert into visit_file_failures (visit_act, attempts, error) values (late.visit_act, coalesce(tries, 1), left(sqlerrm || ' (' || sqlstate || ')', 500))
      on conflict (visit_act) do update set attempts = excluded.attempts, error = excluded.error, at = now();
      -- The ceiling: a visit that cannot be filed after `visit_file_attempts_most` tries is dropped (ended `dropped`, no infraction), so it is never stuck for good.
      if coalesce(tries, 1) >= 10 then
        begin
          perform end_visit(late.visit_act, 'dropped', null, 'This visit could not be filed and was dropped.');
        exception when others then
          raise warning 'system_tick: visit % could not be dropped: % (%)', late.visit_act, sqlerrm, sqlstate;
        end;
      end if;
    end;
  end loop;

  return jsonb_build_object('landed', landed, 'met', met, 'expired', expired, 'superseded', superseded, 'unmet', unmet, 'failed', failed, 'checked', checked, 'visits', filed, 'beats', arcs, 'budget', out_of_time,
    'noThread', enabled and ann is null, 'awardsFailed', awards_failed);
end $$;


-- apply_meeting (0366_excerpts_and_orders.sql), what a meeting leaves out of its handoff stands as the same Boss's latest row had it: handoffs_latest is per Boss and season now, so a departure's new Boss does not
-- inherit the departed Boss's farewell or note. Everything else as 0366_excerpts_and_orders.sql wrote it.
create or replace function apply_meeting(meeting bigint, payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  boss text := payload ->> 'boss';
  bal numeric;
  bal2 numeric;
  cap numeric := (payload ->> 'bank_cap')::numeric;
  returned numeric := 0;
  spent integer;
  handed integer := 0;
  hold interval := ((setting('structuralHoldHours')) #>> '{}')::numeric * interval '1 hour';
  memory jsonb := payload -> 'memory';
  mv jsonb;
  inh jsonb;
  due record;
  kind_row move_kinds%rowtype;
  live timestamptz;
  kept integer := 0;
  ended_n integer := 0;
  skipped integer := 0;
  nominated boolean := false;
  act_id uuid;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  kept_moves jsonb := '[]';
  rules_skipped jsonb := '[]';
  machine_skipped jsonb := '[]';
  lasting_skipped jsonb := '[]';
  mlive timestamptz;
  mhours numeric;
  problem text;
  idx integer := 0;
  ord jsonb;
  planned jsonb := '[]';
  most integer;
  who text;
  bs uuid[];
  b text;
  bid uuid;
  claimed uuid[] := '{}';
  asked numeric;
  amount integer;
  line text;
  mod_memory jsonb;
  orders_skipped integer := 0;
  clamped integer := 0;
  trimmed integer := 0;
  planned_mods text[] := '{}';
  prev staff_orders%rowtype;
  at_order integer;
  room integer;
  check_at timestamptz;
  pat jsonb;
  pat_at timestamptz;
  pat_most integer;
  pat_n integer := 0;
  pat_skipped integer := 0;
  -- The season the meeting was held in, which is not the open one when the season turned between the meeting and this apply: the beat's events and the kinds it holds back are that season's.
  season_id bigint := coalesce(meeting_season(apply_meeting.meeting), (select x.id from seasons x where x.ends_at is null));
  held text[] := held_back_kinds(boss, coalesce(meeting_season(apply_meeting.meeting), (select x.id from seasons x where x.ends_at is null)));
  beats_played text[] := '{}';
  held_skipped jsonb := '[]';
  bundles_skipped jsonb := '[]';
  bnd jsonb;
  bpart jsonb;
  bidx integer := 0;
  bundle_id uuid;
  authored boolean;
  parts_n integer;
  charged integer;
  queued_n integer := 0;
  authored_most integer := coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'bundleAuthoredMostParts'), 8);
  composed_most integer := coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'bundleMostParts'), 4);
  hf_farewell text := nullif(btrim(coalesce(payload ->> 'farewell', ''), E' \t\n\r\f\v'), '');
  hf_note text := nullif(btrim(coalesce(payload ->> 'handoff', ''), E' \t\n\r\f\v'), '');
  hf_post_most integer := (select (s.value #>> '{}')::integer from settings s where s.key = 'postMaxLength');
  hf_trims jsonb := '[]';
  hf_skipped jsonb := '[]';
begin
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.meeting.' || apply_meeting.meeting, 0));
  if not exists (select 1 from meetings x where x.id = apply_meeting.meeting) then
    raise exception 'there is no meeting %', apply_meeting.meeting using errcode = '22023';
  end if;
  if exists (select 1 from meetings x where x.id = apply_meeting.meeting and x.finished_at is not null) then
    return jsonb_build_object('status', 'already applied', 'meeting', apply_meeting.meeting);
  end if;
  if boss is null or boss is distinct from current_boss() then
    raise exception 'a meeting is the open season''s Boss''s; % is not (%)', boss, current_boss() using errcode = '22023';
  end if;
  if hold is null then raise exception 'a meeting needs structuralHoldHours, which this instance does not set' using errcode = '22023'; end if;
  bal := bank_now(boss, (payload ->> 'weekly_moves')::numeric, (payload ->> 'bank_cap')::numeric);
  if bal is null then raise exception 'a meeting names the phase''s weekly_moves and bank_cap' using errcode = '22023'; end if;
  -- The one lock order, before the first write: a lasting move queued, or a lasting move ended by an inheritance decision, writes places, and the Acts this answer writes (a move_keep, a move_end) are rows an
  -- admin's reversal waits for after it holds the key.
  if exists (select 1 from jsonb_array_elements(case when jsonb_typeof(payload -> 'inherited') = 'array' then payload -> 'inherited' else '[]'::jsonb end) i where jsonb_typeof(i.value) = 'object')
     or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(payload -> 'moves') = 'array' then payload -> 'moves' else '[]'::jsonb end) m
                join move_kinds k on k.key = m.value ->> 'kind' where k.lasting)
     or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(payload -> 'bundles') = 'array' then payload -> 'bundles' else '[]'::jsonb end) b,
                     jsonb_array_elements(case when jsonb_typeof(b.value -> 'parts') = 'array' then b.value -> 'parts' else '[]'::jsonb end) p
                join move_kinds k on k.key = p.value ->> 'kind' where k.lasting) then
    perform lock_thread_places();
  end if;

  -- The moves: a kind outside the catalog raises; a rule the queue would refuse is skipped and recorded, and costs nothing.
  for mv in select value from jsonb_array_elements(coalesce(payload -> 'moves', '[]')) loop
    idx := idx + 1;
    select * into kind_row from move_kinds k where k.key = mv ->> 'kind';
    if not found then raise exception 'there is no move kind "%"', mv ->> 'kind' using errcode = '23514'; end if;
    -- A kind the Boss does not use yet (its persona holds it back until a beat unlocks, 0333) is skipped and recorded, and costs nothing: the engine drops it too, and the database holds the line.
    if kind_row.key = any (held) then
      held_skipped := held_skipped || jsonb_build_array(jsonb_build_object('index', idx - 1, 'kind', kind_row.key));
      continue;
    end if;
    if kind_row.key = 'setRule' then
      problem := rule_params_problem(mv -> 'params');
      if problem is null then
        problem := rule_conflict(nullif(mv #>> '{params,board}', '')::uuid, mv #>> '{params,predicate}', nullif(mv #> '{params,param}', 'null'::jsonb));
      end if;
      if problem is not null then
        rules_skipped := rules_skipped || jsonb_build_array(jsonb_build_object('index', idx - 1, 'why', problem));
        continue;
      end if;
    end if;
    -- A machine move the queue's guard would refuse for its params, its demand or its bounds (the guard's own predicate, machine_move_problem without the machine as it is
    -- at landing) is skipped and recorded, and costs nothing: one bad machine move never fails the whole answer, as a bad rule does not.
    if kind_row.key in ('pullSlot', 'repriceSlot', 'flashSale') then
      problem := null;
      begin
        mlive := greatest((mv ->> 'go_live_at')::timestamptz, now());
        mhours := case when jsonb_typeof(mv -> 'expires_in_hours') = 'number' then (mv ->> 'expires_in_hours')::numeric end;
        problem := machine_move_problem(kind_row.key,
          case when jsonb_typeof(mv #> '{params,slot}') = 'string' then jsonb_set(mv -> 'params', '{slot}', to_jsonb(lower(mv #>> '{params,slot}'))) else mv -> 'params' end,
          mv -> 'demand', mlive, case when mhours is not null then mlive + mhours * interval '1 hour' end, false);
        if problem is null and mv -> 'demand' is not null and jsonb_typeof(mv -> 'demand') <> 'null' then
          if not exists (select 1 from demand_kinds d where d.key = mv #>> '{demand,kind}') then problem := 'there is no such demand kind';
          else problem := demand_params_problem(mv -> 'demand'); end if;
        end if;
      exception when others then
        problem := 'the move is malformed';
      end;
      if problem is not null then
        machine_skipped := machine_skipped || jsonb_build_array(jsonb_build_object('index', idx - 1, 'why', problem));
        continue;
      end if;
    end if;
    -- The three lasting board moves the queue would refuse (what they name is not there, a board is closed, a merge would make a cycle, a demand a lasting move cannot carry) are skipped
    -- and recorded, and cost nothing, as a machine move is: one bad one never fails the whole answer.
    if kind_row.key in ('createBoard', 'moveThread', 'mergeBoard') then
      problem := null;
      begin
        if mv -> 'demand' is not null and jsonb_typeof(mv -> 'demand') <> 'null' then problem := 'a lasting move carries no demand';
        else problem := lasting_move_problem(kind_row.key, mv -> 'params'); end if;
      exception when others then
        problem := 'the move is malformed';
      end;
      if problem is not null then
        lasting_skipped := lasting_skipped || jsonb_build_array(jsonb_build_object('index', idx - 1, 'why', problem));
        continue;
      end if;
    end if;
    kept_moves := kept_moves || jsonb_build_array(mv);
  end loop;
  spent := jsonb_array_length(kept_moves);

  -- The orders: validated into a plan, so nothing is written before the bank has agreed.
  if jsonb_typeof(payload -> 'orders') = 'array' and jsonb_array_length(payload -> 'orders') > 0 then
    most := (setting('modBots') ->> 'allowanceMost')::integer;
    if most is null then raise exception 'orders need the setting modBots, which this instance does not set' using errcode = '22023'; end if;
    for ord in select value from jsonb_array_elements(payload -> 'orders') loop
      who := ord ->> 'mod';
      if jsonb_typeof(ord) is distinct from 'object' or who is null or who = any (planned_mods) or not exists (select 1 from staff_now n where n.staff = who) then
        orders_skipped := orders_skipped + 1;
        continue;
      end if;
      bs := '{}';
      for b in select t.v from jsonb_array_elements_text(case when jsonb_typeof(ord -> 'boards') = 'array' then ord -> 'boards' else '[]'::jsonb end) with ordinality t(v, n) order by t.n loop
        if b ~* uuid_re then
          bid := lower(b)::uuid;
          if exists (select 1 from boards x where x.id = bid and not x.is_system) and bid <> all (claimed) and bid <> all (bs) then bs := bs || bid; end if;
        end if;
      end loop;
      claimed := claimed || bs;
      asked := case when jsonb_typeof(ord -> 'allowance') = 'number' then floor((ord ->> 'allowance')::numeric) else 0 end;
      amount := greatest(0, least(asked, most));
      if amount is distinct from asked then clamped := clamped + 1; end if;
      line := left(btrim(coalesce(ord ->> 'order', ''), E' \t\n\r\f\v'), 200);
      -- A blank line is no instruction: the Mod keeps the one it had.
      if line = '' then line := coalesce((select x.order_line from staff_orders x where x.staff = who order by x.id desc limit 1), ''); end if;
      mod_memory := case when jsonb_typeof(ord -> 'memory') = 'object' then jsonb_set(jsonb_set(ord -> 'memory', '{opinions}', public_entries(ord #> '{memory,opinions}')), '{grudges}', public_entries(ord #> '{memory,grudges}')) end;
      planned := planned || jsonb_build_array(jsonb_build_object('mod', who, 'boards', to_jsonb(bs), 'order', line, 'allowance', amount, 'memory', mod_memory));
      planned_mods := planned_mods || who;
      handed := handed + amount;
    end loop;
  end if;

  -- What the Mods did not spend goes back, never above the cap: one lock per persona with an order, in key order, so a Mod's move queued at the same
  -- moment is either counted here or counted against the new order, never both and never neither.
  for who in select distinct o.staff from staff_orders o order by o.staff loop
    perform pg_advisory_xact_lock(hashtextextended('kayfabb.allowance.' || who, 0));
    returned := returned + order_unspent(who);
  end loop;
  -- What was added is what the cap allowed, and that is what is recorded.
  bal2 := least(cap, bal + returned);
  returned := greatest(0, bal2 - bal);
  -- The Boss's own moves are its own: they must be paid, else this raises, as it always has. The allowances are what is left. A Mod that queued between the
  -- meeting's read and this apply spent some of what the answer counted on; the answer is not failed for it: the allowances are trimmed from the last
  -- order backward to the bank, and the trims are recorded.
  -- The bundles (fangame split design, sections 2, 5 and 9), each all or nothing: its parts are queued under one bundle id and one name, in the order sent (a role names an earlier part), and a
  -- beat's bundle writes `played` with it. An authored bundle (it names a beat of this Boss's that is unlocked and unplayed) costs the bank nothing; a bundle of the Boss's own costs one move a part
  -- and holds at most bundleMostParts, none of a kind held back. A beat with no bundle has no parts and is played by being named. A bundle the queue would refuse (the guard raises), a beat
  -- that is not unlocked and a bank that cannot pay are each skipped and recorded, with the reason: one bad bundle never fails the whole answer. The guard still holds every part.
  for bnd in select value from jsonb_array_elements(case when jsonb_typeof(payload -> 'bundles') = 'array' then payload -> 'bundles' else '[]'::jsonb end) loop
    bidx := bidx + 1;
    begin
      if jsonb_typeof(bnd) is distinct from 'object' or jsonb_typeof(bnd -> 'parts') is distinct from 'array' then
        raise exception 'a bundle is {name, beat, parts}' using errcode = '22023';
      end if;
      authored := jsonb_typeof(bnd -> 'beat') = 'string';
      parts_n := jsonb_array_length(bnd -> 'parts');
      if authored then
        if not exists (select 1 from persona_arcs a, jsonb_array_elements(a.beats) b where a.staff = boss and b.value ->> 'key' = bnd ->> 'beat') then
          raise exception 'the beat "%" is not this Boss''s', bnd ->> 'beat' using errcode = '22023';
        end if;
        if arc_latest_states(boss, season_id) ->> (bnd ->> 'beat') is distinct from 'unlocked' then
          raise exception 'the beat "%" is not unlocked, or has been played', bnd ->> 'beat' using errcode = '22023';
        end if;
        if parts_n > authored_most then raise exception 'an authored bundle holds at most % parts', authored_most using errcode = '22023'; end if;
        charged := 0;
      else
        if parts_n < 1 then raise exception 'a bundle of the Boss''s own has at least one part' using errcode = '22023'; end if;
        if parts_n > composed_most then raise exception 'a bundle of the Boss''s own holds at most % parts', composed_most using errcode = '22023'; end if;
        if spent + parts_n > floor(bal2) then raise exception 'the bank cannot pay for % parts', parts_n using errcode = '23514'; end if;
        charged := parts_n;
      end if;
      if parts_n > 0 and btrim(coalesce(bnd ->> 'name', '')) = '' then raise exception 'a bundle has a name' using errcode = '22023'; end if;
      bundle_id := case when parts_n > 0 then gen_random_uuid() end;
      for bpart in select value from jsonb_array_elements(bnd -> 'parts') loop
        select * into kind_row from move_kinds k where k.key = bpart ->> 'kind';
        if not found then raise exception 'there is no move kind "%"', bpart ->> 'kind' using errcode = '23514'; end if;
        if not authored and kind_row.key = any (held) then raise exception 'the kind % is held back', kind_row.key using errcode = '23514'; end if;
        live := greatest((bpart ->> 'go_live_at')::timestamptz, now());
        if kind_row.structural then live := greatest(live, now() + hold); end if;
        insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural, bundle, bundle_name, role)
        values (apply_meeting.meeting, boss, kind_row.key, bpart -> 'params', bpart -> 'demand', bpart ->> 'why', live,
          live + coalesce((bpart ->> 'expires_in_hours')::numeric, 0) * interval '1 hour', kind_row.structural, bundle_id, left(bnd ->> 'name', 120), nullif(bpart ->> 'role', ''));
      end loop;
      if authored then
        insert into arc_beat_events (season, staff, beat, event, bundle) values (season_id, boss, bnd ->> 'beat', 'played', bundle_id);
        beats_played := beats_played || (bnd ->> 'beat');
      end if;
      spent := spent + charged;
      queued_n := queued_n + parts_n;
    exception when others then
      bundles_skipped := bundles_skipped || jsonb_build_array(jsonb_build_object('index', bidx - 1, 'name', bnd ->> 'name', 'why', left(sqlerrm, 300)));
    end;
  end loop;

  if spent > floor(bal2) then
    raise exception 'the moves cost % and the bank holds %', spent, bal2 using errcode = '23514';
  end if;
  room := floor(bal2)::integer - spent;
  at_order := jsonb_array_length(planned);
  while handed > room and at_order > 0 loop
    amount := (planned -> (at_order - 1) ->> 'allowance')::integer;
    if amount > 0 then
      asked := least(amount, handed - room);
      planned := jsonb_set(planned, array[(at_order - 1)::text, 'allowance'], to_jsonb(amount - asked::integer));
      handed := handed - asked::integer;
      trimmed := trimmed + 1;
    end if;
    at_order := at_order - 1;
  end loop;

  -- Only debuted public characters are named: the engine checks this too, and the database keeps it whatever the caller sent. The
  -- memory is written only when it came.
  if jsonb_typeof(memory) = 'object' then
    memory := jsonb_set(jsonb_set(memory, '{opinions}', public_entries(memory -> 'opinions')), '{grudges}', public_entries(memory -> 'grudges'));
    insert into staff_memory (staff, meeting, body) values (boss, apply_meeting.meeting, memory);
  end if;
  if jsonb_typeof(payload -> 'profile') = 'object' then
    insert into staff_profiles (staff, meeting, interests, favorites, mood, signature)
    values (boss, apply_meeting.meeting,
      array(select jsonb_array_elements_text(coalesce(payload -> 'profile' -> 'interests', '[]'))),
      array(select f.id from (select case when t.f ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then t.f::uuid end as id, min(t.ord) as ord from jsonb_array_elements_text(coalesce(payload -> 'profile' -> 'favorites', '[]')) with ordinality t(f, ord) group by 1) f
        where f.id in (select c.id from characters_public c) order by f.ord),
      coalesce(payload -> 'profile' ->> 'mood', ''), coalesce(payload -> 'profile' ->> 'signature', ''));
  end if;

  for mv in select value from jsonb_array_elements(kept_moves) loop
    select * into kind_row from move_kinds k where k.key = mv ->> 'kind';
    live := greatest((mv ->> 'go_live_at')::timestamptz, now());
    if kind_row.structural then live := greatest(live, now() + hold); end if;
    -- A favor's check must fall between its go-live and its expiry as the queue lands them; the answer set it from the meeting's clock, so one that no longer does is
    -- moved to half the favor's life from its go-live.
    if kind_row.key = 'conferGroup' and mv #> '{params,checkAt}' is not null then
      begin
        check_at := (mv #>> '{params,checkAt}')::timestamptz;
      exception when others then
        check_at := null;
      end;
      if check_at is null or check_at <= live or check_at >= live + ((mv ->> 'expires_in_hours')::numeric * interval '1 hour') then
        mv := jsonb_set(mv, '{params,checkAt}', to_jsonb(to_char((live + ((mv ->> 'expires_in_hours')::numeric * interval '30 minutes')) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
      end if;
    end if;
    insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
    values (apply_meeting.meeting, boss, kind_row.key, mv -> 'params', mv -> 'demand', mv ->> 'why', live,
      live + ((mv ->> 'expires_in_hours')::numeric * interval '1 hour'), kind_row.structural);
  end loop;

  -- The successor: queued beside the moves, not among them, and not charged to the bank.
  if jsonb_typeof(payload -> 'successor') = 'object' then
    select * into kind_row from move_kinds k where k.key = 'nameSuccessor';
    if found and jsonb_typeof(payload #> '{successor,boss}') = 'string' and (payload #>> '{successor,boss}') = any (boss_roster()) and (payload #>> '{successor,boss}') <> boss then
      insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
      values (apply_meeting.meeting, boss, 'nameSuccessor', jsonb_build_object('boss', payload #>> '{successor,boss}'), null,
        left(coalesce(nullif(payload #>> '{successor,why}', ''), 'No reason given.'), 200), now() + hold, null, kind_row.structural);
      nominated := true;
    else
      skipped := skipped + 1;
    end if;
  end if;

  -- The inheritance review: what the answer names must be among the moves due now; the rest is dropped. Each is answered at most once.
  for inh in select value from jsonb_array_elements(case when jsonb_typeof(payload -> 'inherited') = 'array' then payload -> 'inherited' else '[]'::jsonb end) loop
    act_id := case when (inh ->> 'move_act') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (inh ->> 'move_act')::uuid end;
    select * into due from inheritance_due(boss, 100) d where d.act = act_id;
    -- An answer with no decision (null in the test) is no decision: skipped, never read as "end".
    if act_id is null or not found or not coalesce((inh ->> 'decision') in ('keep', 'end'), false) then
      skipped := skipped + 1;
    elsif inh ->> 'decision' = 'keep' then
      perform write_staff_act(boss, 'move_keep', due.thread, due.act, '{}'::jsonb);
      kept := kept + 1;
    elsif inh ->> 'decision' = 'end' then
      if (end_move(due.act, 'superseded', 'boss') ->> 'ended')::boolean then perform say_move_end(due.act, 'superseded'); ended_n := ended_n + 1; end if;
    end if;
  end loop;

  -- The farewell and the handoff (0337), kept only from a meeting within farewellWindowHours of the season's end: the engine's repair already dropped them from any other, and the database holds
  -- the same line. Each is trimmed to its bound (the farewell to postMaxLength, the note to 2000) and the trim is recorded, never a lost answer. A blank one is none; a meeting that gives neither
  -- writes no row, so an earlier meeting's words are not displaced by silence. A new row is the latest of its season, and the ones before it stay.
  if hf_farewell is not null or hf_note is not null then
    if not in_farewell_window() then
      hf_skipped := jsonb_build_array(jsonb_build_object('why', 'inFarewellWindow'));
    else
      if hf_farewell is not null and hf_post_most is not null and char_length(hf_farewell) > hf_post_most then
        hf_trims := hf_trims || jsonb_build_array(jsonb_build_object('path', 'farewell', 'predicate', 'maxLength(' || hf_post_most || ')', 'before', char_length(hf_farewell), 'after', hf_post_most));
        hf_farewell := left(hf_farewell, hf_post_most);
      end if;
      if hf_note is not null and char_length(hf_note) > 2000 then
        hf_trims := hf_trims || jsonb_build_array(jsonb_build_object('path', 'handoff', 'predicate', 'maxLength(2000)', 'before', char_length(hf_note), 'after', 2000));
        hf_note := left(hf_note, 2000);
      end if;
      -- What this meeting leaves out stands as the latest row had it: a later meeting that writes only a note does not take the farewell back, nor one that writes only a farewell the note.
      insert into handoffs (season, staff, meeting, farewell, note)
      select season_id, boss, apply_meeting.meeting, coalesce(hf_farewell, x.farewell), coalesce(hf_note, x.note, '')
      from (select 1) one left join handoffs_latest x on x.season = season_id and x.staff = boss;
    end if;
  end if;

  -- An answer that left a persona with an order out carries it forward only while the persona is on staff (staff_now: an order ends with the office, the
  -- excerpts-and-orders design, section 2): its beat (less what another order claimed) and its line, with an allowance of 0, because what it had was returned above.
  -- A persona off staff (a Boss, or a Mod moved off) is carried nothing: if its latest row still holds a line, a beat or an allowance, one blank row with 0 ends it (the allowance is
  -- returned above once, and a Mod that comes back has no order until a meeting gives it one), and once the latest row is blank no row is written. After this meeting every
  -- persona on staff with an order has its latest from it.
  for ord in select value from jsonb_array_elements(planned) loop
    insert into staff_orders (meeting, staff, boards, order_line, allowance)
    values (apply_meeting.meeting, ord ->> 'mod', array(select jsonb_array_elements_text(ord -> 'boards'))::uuid[], ord ->> 'order', (ord ->> 'allowance')::integer);
    if jsonb_typeof(ord -> 'memory') = 'object' then
      insert into staff_memory (staff, meeting, body) values (ord ->> 'mod', apply_meeting.meeting, ord -> 'memory');
    end if;
  end loop;
  for who in
    select distinct o.staff from staff_orders o
    where o.meeting <> apply_meeting.meeting and o.staff <> all (planned_mods) order by o.staff
  loop
    select * into prev from staff_orders o where o.staff = who and o.meeting <> apply_meeting.meeting order by o.id desc limit 1;
    if exists (select 1 from staff_now n where n.staff = who) then
      insert into staff_orders (meeting, staff, boards, order_line, allowance)
      values (apply_meeting.meeting, who, array(select x from unnest(prev.boards) x where x <> all (claimed)), prev.order_line, 0);
    elsif prev.order_line <> '' or prev.allowance > 0 or prev.boards <> '{}' then
      insert into staff_orders (meeting, staff, boards, order_line, allowance)
      values (apply_meeting.meeting, who, '{}', '', 0);
    end if;
  end loop;

  -- The patrols the answer scheduled, kept on the meeting record by meet/core.ts (its repair already dropped a Mod off staff, moved a time into today and cut them to
  -- patrolsPerDay); the database holds the same line whatever the caller sent. Written once with the meeting: a retry finds the meeting closed above, and (meeting, n) is
  -- unique besides.
  pat_most := coalesce((select (s.value ->> 'patrolsPerDay')::integer from settings s where s.key = 'modBots'), 0);
  if jsonb_typeof(payload #> '{record,patrols}') = 'array' then
    for pat in select value from jsonb_array_elements(payload #> '{record,patrols}') loop
      if pat_n >= pat_most then pat_skipped := pat_skipped + 1; continue; end if;
      pat_at := null;
      begin
        pat_at := (pat ->> 'at')::timestamptz;
      exception when others then pat_at := null;
      end;
      if jsonb_typeof(pat) is distinct from 'object' or pat_at is null or jsonb_typeof(pat -> 'mod') is distinct from 'string'
         or not exists (select 1 from staff_now n where n.staff = pat ->> 'mod') then
        pat_skipped := pat_skipped + 1;
        continue;
      end if;
      pat_n := pat_n + 1;
      insert into patrols (meeting, n, staff, at)
      values (apply_meeting.meeting, pat_n, pat ->> 'mod', least(greatest(pat_at, now()), now() + interval '24 hours'))
      on conflict on constraint patrols_meeting_n_key do nothing;
    end loop;
  end if;

  insert into move_bank (staff, balance, as_of) values (boss, bal2 - spent - handed, now())
  on conflict (staff) do update set balance = excluded.balance, as_of = excluded.as_of;
  perform close_meeting(apply_meeting.meeting, 'ok', null, bal, bal2 - spent - handed,
    coalesce(payload -> 'record', '{}') || jsonb_build_object(
      'handover', jsonb_build_object('kept', kept, 'ended', ended_n, 'skipped', skipped, 'nominated', nominated),
      'allowances', jsonb_build_object('returned', returned, 'handed', handed, 'orders', jsonb_array_length(planned), 'skipped', orders_skipped, 'clamped', clamped, 'trimmed', trimmed),
      'rulesSkipped', rules_skipped,
      'machineSkipped', machine_skipped,
      'lastingSkipped', lasting_skipped,
      -- What was actually played (0335): the engine's `beatsDefaulted` and its `playedWithDefaults` trims say what it meant to play, and are kept only for the beats this transaction played.
      'beatsPlayed', to_jsonb(beats_played),
      'beatsDefaulted', coalesce((select jsonb_agg(d.k) from jsonb_array_elements_text(case when jsonb_typeof(payload #> '{record,beatsDefaulted}') = 'array' then payload #> '{record,beatsDefaulted}' else '[]'::jsonb end) d(k) where d.k = any (beats_played)), '[]'::jsonb),
      'trims', coalesce((select jsonb_agg(x.t order by x.n) from jsonb_array_elements(case when jsonb_typeof(payload #> '{record,trims}') = 'array' then payload #> '{record,trims}' else '[]'::jsonb end) with ordinality x(t, n)
                         where not (x.t ->> 'predicate' = 'playedWithDefaults' and not ((regexp_replace(coalesce(x.t ->> 'path', ''), '^beats\.', '')) = any (beats_played)))), '[]'::jsonb),
      'heldBackSkipped', held_skipped,
      'bundlesSkipped', bundles_skipped,
      'handoffTrims', hf_trims,
      'handoffSkipped', hf_skipped,
      'patrolsWritten', jsonb_build_object('written', pat_n, 'skipped', pat_skipped)));
  return jsonb_build_object('status', 'applied', 'meeting', apply_meeting.meeting, 'queued', jsonb_array_length(kept_moves) + queued_n, 'beats_played', to_jsonb(beats_played), 'bank_before', bal, 'bank_after', bal2 - spent - handed,
    'returned', returned, 'handed', handed);
end $$;



-- ------------------------------------------------------------------------------------- the seed benches the departing ----

-- Task 2 (docs/plans/2026-11-21-departed-personas-plan.md; its design, sections 2 and 3). The seed's roster is the whole staff: a persona it does not list is benched (office `benched`, cause `seed`), and the Boss of the open
-- season, where it is one of them, is handed over at once first. A persona the seed benched comes back only by a seed that lists it again; set_office refuses it meanwhile, and boss_roster() leaves it out, a waiting one included.

-- boss_roster (0082_offices.sql), leaving out a persona whose latest office row is `benched`, whatever staff_office_now shows (a persona that never debuted and was benched by the seed reads `waiting` there, and a handover
-- would debut it). Everything else as 0082_offices.sql wrote it.
create or replace function boss_roster() returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  with listed as (
    select r.key, r.ord from jsonb_array_elements_text(coalesce((select s.value from settings s where s.key = 'bossRoster' and jsonb_typeof(s.value) = 'array'), '[]'::jsonb)) with ordinality r(key, ord)
  ), personas as (
    select c.staff, coalesce(l.ord, 1000000) as ord from characters c
    join staff_office_now o on o.staff = c.staff left join listed l on l.key = c.staff
    where c.retired_at is null and o.office <> 'benched'
      and coalesce((select x.office from staff_offices x where x.staff = c.staff order by x.id desc limit 1), 'member') <> 'benched'
  )
  select coalesce(array_agg(p.staff order by p.ord, p.staff), '{}') from personas p
$$;

-- set_office (0082_offices.sql), refusing first a persona that left the instance's roster: its latest office row is `benched` with cause `seed`, and only a seed that lists it brings it back. Everything else as
-- 0082_offices.sql wrote it.
create or replace function set_office(staff text, office text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  who characters%rowtype;
  held text;
begin
  perform only_admins('moves a persona between offices');
  if set_office.office is null or set_office.office not in ('mod', 'member', 'benched') then
    raise exception 'an office is mod, member or benched, not %; the season names its Boss', coalesce(set_office.office, 'nothing') using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- One at a time with a handover and with another admin, so the last-mod check reads what stands.
  perform pg_advisory_xact_lock(hashtext('kayfabb.offices'));
  select * into who from characters c where c.staff = set_office.staff and c.staff_kind = 'persona' for no key update;
  if not found then raise exception 'there is no such persona' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if exists (select 1 from (select x.office, x.cause from staff_offices x where x.staff = set_office.staff order by x.id desc limit 1) l where l.office = 'benched' and l.cause = 'seed') then
    raise exception 'that persona left the instance''s roster; a seed that lists it brings it back' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  select o.office into held from staff_office_now o where o.staff = set_office.staff;
  if held = 'boss' then
    raise exception 'the season''s Boss holds the Boss''s office, which changes at the handover' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if held = set_office.office then raise exception 'that persona is already %', held using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  if held = 'waiting' and set_office.office = 'benched' then
    raise exception 'a waiting persona has not debuted; make it a member or hire it first' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if held = 'mod' and not exists (select 1 from staff_office_now o join characters c on c.staff = o.staff
                                   where o.office = 'mod' and o.staff <> set_office.staff and c.retired_at is null) then
    raise exception 'that is the last Mod Bot, and the staff is never empty' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if held = 'waiting' then update characters c set debuted_at = now() where c.id = who.id; end if;
  insert into staff_offices (staff, office, cause, admin) values (set_office.staff, set_office.office, 'admin', auth.uid());
  return jsonb_build_object('staff', set_office.staff, 'office', set_office.office);
end $$;

-- seed_instance (0397_refund_outcome.sql), the departing benched, a departing Boss handed over first, a persona listed again brought back, a Mod Bot hired where the departure left none, and the answer's `departed`,
-- `returned` and `handover` keys (the keys benched this run, the keys re-listed this run, and the new Boss's key or null). Everything else as 0397_refund_outcome.sql wrote it.
create or replace function public.seed_instance(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  flags integer;
  flagged text;
  unknown text;
  sys uuid;
  opened uuid;
  was text := current_setting('kayfabb.seeding', true);
  listed text[];
  first_staff text[];
  departing text[];
  departed text[] := '{}';
  returned text[] := '{}';
  open_id bigint;
  boss_was text;
  boss_now text;
  handed text;
  mods_were bigint;
begin
  -- Two seeds at once would each find no office row and both write one into the append-only office log. An advisory
  -- transaction lock serializes seeds without locking any table a player reads, and lets go at commit.
  perform pg_advisory_xact_lock(hashtext('kayfabb.seed_instance'));
  -- The settings trigger (settings_tuned) marks a row tuned for any write but a seed's: this transaction is the seed's, so its writes leave no mark.
  perform set_config('kayfabb.seeding', 'on', true);
  select count(*), min(e ->> 'slug') into flags, flagged
  from jsonb_array_elements(coalesce(payload -> 'boards', '[]')) e where coalesce((e ->> 'system')::boolean, false);
  if flags > 1 then raise exception 'a seed flags one board as The System''s, not %', flags using errcode = '22023'; end if;
  -- The economy is merged, number by number: a card kind is never removed, so the numbers its rules read stay in the row with it.
  perform seed_setting(e.key, e.value) from jsonb_each(payload -> 'settings') e;
  insert into class_kinds (key, name) select e ->> 'key', e ->> 'name' from jsonb_array_elements(payload -> 'classes') e
  on conflict (key) do update set name = excluded.name;
  -- Reaction kinds are the one vocabulary a seed removes. Classes and cards never are: a card must outlive its slot and its pulls
  -- (0139). A reaction kind has nothing that must outlive it once nothing uses it, and a kind something does use is never removed.
  if payload ? 'reactions' then
    select string_agg(k.key || ' (' || (select count(*) from reactions r where r.kind = k.key) || ' reactions)', ', ' order by k.key) into unknown
    from reaction_kinds k
    where not exists (select 1 from jsonb_array_elements(payload -> 'reactions') e where e ->> 'key' = k.key)
      and (exists (select 1 from reactions r where r.kind = k.key) or exists (select 1 from reaction_tallies t where t.kind = k.key));
    if unknown is not null then
      raise exception 'the instance no longer lists reaction kinds that reactions use: %; a used kind is never removed (#216)', unknown using errcode = '22023';
    end if;
    -- `not exists`, not `not in`: an element with no key would make `not in` null for every kind, hiding a used one.
    delete from reaction_kinds k where not exists (select 1 from jsonb_array_elements(payload -> 'reactions') e where e ->> 'key' = k.key);
  end if;
  insert into reaction_kinds (key, emoji, quadrant) select e ->> 'key', e ->> 'emoji', e ->> 'quadrant' from jsonb_array_elements(payload -> 'reactions') e
  on conflict (key) do update set emoji = excluded.emoji, quadrant = excluded.quadrant;
  -- Member groups (0128): the instance's whole set, the ladder and the groups a move confers. A condition kind group_now has no case for stops the seed,
  -- naming the group. A group the payload no longer lists is deleted unless a move (landed or queued) names it, so the log line that names it still can.
  if payload ? 'groups' then
    select string_agg(e ->> 'key' || ' (' || coalesce(e ->> 'condition', 'none') || ')', ', ') into unknown
    from jsonb_array_elements(payload -> 'groups') e
    where e ->> 'source' = 'ladder' and coalesce(e ->> 'condition', '') <> all (array['default', 'posts', 'seasons', 'staff']);
    if unknown is not null then
      raise exception 'the instance''s groups name a condition kind group_now has no case for: %', unknown using errcode = '22023';
    end if;
    delete from group_kinds k
    where not exists (select 1 from jsonb_array_elements(payload -> 'groups') e where e ->> 'key' = k.key)
      and not exists (select 1 from acts a where a.kind = 'move' and a.payload ->> 'kind' = 'conferGroup' and a.payload #>> '{params,group}' = k.key)
      and not exists (select 1 from queued_moves q where q.kind = 'conferGroup' and q.params ->> 'group' = k.key);
    insert into group_kinds (key, name, badge, color, stripe, source, rung, condition, at_least, tone)
    select e ->> 'key', e ->> 'name', e ->> 'badge', e ->> 'color', coalesce((e ->> 'stripe')::boolean, false), e ->> 'source', (e ->> 'rung')::integer,
      e ->> 'condition', (e ->> 'atLeast')::integer, e ->> 'tone'
    from jsonb_array_elements(payload -> 'groups') e
    on conflict (key) do update set name = excluded.name, badge = excluded.badge, color = excluded.color, stripe = excluded.stripe, source = excluded.source, rung = excluded.rung,
      condition = excluded.condition, at_least = excluded.at_least, tone = excluded.tone;
  end if;
  -- A card's play, rarity, trap, gimmick and time up (0054, 0148), and its reaches (0055), checked as instanceProblems checks them, each
  -- naming the card. The reaches are read against reachRarity and reachLasts as the settings above have just written them.
  select nullif(concat_ws('; ', card_kinds_problem(payload -> 'cards'), card_reach_problem(payload -> 'cards')), '') into unknown;
  if unknown is not null then raise exception '%', unknown using errcode = '22023'; end if;
  -- A card's stack, whether it is seeded and the economy numbers its rules read are the code's, as its name is; so
  -- are its rarity, its play, its trap (with its match), its gimmick, its discipline, how long a Use of it is up, where it reaches, whether it pins, whether it writes, whether it replies, whether it keeps, its skim, whether it scores as a class, what it draws, its drive and the words it refuses a blank message with.
  insert into card_kinds (key, name, alignment, stack, seeded, reads, rarity, play, trap, gimmick, refunds, discipline, lasts, reaches, pins, writes, replies, keeps, skim, scores_as, draws, drive, needs_message, veil, adds_reaction, surface)
  select e ->> 'key', e ->> 'name', e ->> 'alignment', coalesce((e ->> 'stack')::integer, 1), coalesce((e ->> 'seeded')::boolean, false),
    coalesce(array(select jsonb_array_elements_text(e -> 'reads')), '{}'),
    e ->> 'rarity', coalesce(e ->> 'play', 'cast'), nullif(e -> 'trap', 'null'), nullif(e -> 'gimmick', 'null'), nullif(e -> 'refunds', 'null'), nullif(e -> 'discipline', 'null'), span_interval(e -> 'lasts'),
    case when e ? 'reaches' then array(select jsonb_array_elements_text(e -> 'reaches')) else '{post}' end, coalesce((e ->> 'pins')::boolean, false), coalesce((e ->> 'writes')::boolean, false),
    coalesce((e ->> 'replies')::boolean, false), coalesce((e ->> 'keeps')::boolean, false),
    nullif(e -> 'skim', 'null'), coalesce((e ->> 'scoresAs')::boolean, false),
    case when jsonb_typeof(e -> 'draws') = 'array' then array(select jsonb_array_elements_text(e -> 'draws')) end, nullif(e -> 'drive', 'null'), nullif(e ->> 'needsMessage', ''),
    nullif(e ->> 'veil', ''), coalesce((e ->> 'addsReaction')::boolean, false), coalesce((e ->> 'surface')::boolean, false)
  from jsonb_array_elements(payload -> 'cards') e
  on conflict (key) do update set name = excluded.name, alignment = excluded.alignment,
    stack = excluded.stack, seeded = excluded.seeded, reads = excluded.reads,
    rarity = excluded.rarity, play = excluded.play, trap = excluded.trap, gimmick = excluded.gimmick, refunds = excluded.refunds, discipline = excluded.discipline, lasts = excluded.lasts,
    reaches = excluded.reaches, pins = excluded.pins, writes = excluded.writes, replies = excluded.replies, keeps = excluded.keeps, skim = excluded.skim, scores_as = excluded.scores_as,
    draws = excluded.draws, drive = excluded.drive, needs_message = excluded.needs_message, veil = excluded.veil, adds_reaction = excluded.adds_reaction, surface = excluded.surface;
  -- The packs the instance sells (replaced each seed: their pulls are its code), then the slots it names that the database does not hold yet,
  -- at the end of the grid in the instance's order. A slot already holding the item is never touched: its place, availability and price are an
  -- admin's (0139). A pack or card a slot names must exist, and a missing one is a foreign key's refusal.
  -- A pack is a pull pack (its pulls and what it leaves out) or a fixed one (its cards in order, 0377); the table holds exactly one of the two.
  insert into pack_kinds (key, pulls, leaves, contents)
  select e ->> 'key', nullif(e -> 'pulls', 'null'), coalesce(array(select jsonb_array_elements_text(e -> 'leaves')), '{}'),
         case when jsonb_typeof(e -> 'contents') = 'array' then array(select jsonb_array_elements_text(e -> 'contents')) end
  from jsonb_array_elements(coalesce(payload -> 'packs', '[]')) e
  on conflict (key) do update set pulls = excluded.pulls, leaves = excluded.leaves, contents = excluded.contents;
  if payload ? 'gear' then
    insert into gear_kinds (key, rarity) select e ->> 'key', e ->> 'rarity' from jsonb_array_elements(payload -> 'gear') e
    on conflict (key) do update set rarity = excluded.rarity;
    delete from gear_kinds k where not exists (select 1 from jsonb_array_elements(payload -> 'gear') e where e ->> 'key' = k.key)
      and not exists (select 1 from gear_ledger l where l.gear = k.key) and not exists (select 1 from gear_worn w where w.gear = k.key);
  end if;
  if payload ? 'eventLines' then
    insert into event_lines (key, outcome, text) select e ->> 'key', e ->> 'outcome', e ->> 'text' from jsonb_array_elements(payload -> 'eventLines') e
    on conflict (key) do update set outcome = excluded.outcome, text = excluded.text;
    delete from event_lines l where not exists (select 1 from jsonb_array_elements(payload -> 'eventLines') e where e ->> 'key' = l.key);
  end if;
  -- The instance's trophy kinds (0206): added and brought up to date, the places, the Boss's kinds and the met demand's set as the catalog names them, and a kind the instance
  -- dropped removed unless an award names it. An admin-made kind is never touched, and an instance key that begins `made-` is refused (those are the admin page's).
  if payload ? 'trophies' then
    select string_agg(e ->> 'key', ', ') into unknown from jsonb_array_elements(payload -> 'trophies' -> 'kinds') e where e ->> 'key' like 'made-%';
    if unknown is not null then raise exception 'a trophy key begins "made-" only on the admin page: %', unknown using errcode = '22023'; end if;
    select string_agg(k, ', ') into unknown
    from (select jsonb_array_elements_text(coalesce(payload -> 'trophies' -> 'seasonPlaces', '[]') || coalesce(payload -> 'trophies' -> 'boss', '[]')
                                           || case when payload -> 'trophies' ? 'demandMet' then jsonb_build_array(payload -> 'trophies' ->> 'demandMet') else '[]'::jsonb end) k) n
    where not exists (select 1 from jsonb_array_elements(payload -> 'trophies' -> 'kinds') e where e ->> 'key' = n.k);
    if unknown is not null then raise exception 'the trophy catalog names kinds it does not define: %', unknown using errcode = '22023'; end if;
    -- The flags are cleared and set again, so that the unique indexes never see a place twice.
    update trophy_kinds set season_place = null, boss_gives = false, demand_met = false where made_by is null and (season_place is not null or boss_gives or demand_met);
    insert into trophy_kinds (key, name, line, belt) select e ->> 'key', e ->> 'name', nullif(e ->> 'line', ''), coalesce((e ->> 'belt')::boolean, false)
    from jsonb_array_elements(payload -> 'trophies' -> 'kinds') e
    on conflict (key) do update set name = excluded.name, line = excluded.line, belt = excluded.belt;
    update trophy_kinds k set season_place = p.n::smallint
    from jsonb_array_elements_text(coalesce(payload -> 'trophies' -> 'seasonPlaces', '[]')) with ordinality p(key, n) where k.key = p.key;
    update trophy_kinds k set boss_gives = true where k.key in (select jsonb_array_elements_text(coalesce(payload -> 'trophies' -> 'boss', '[]')));
    update trophy_kinds k set demand_met = true where k.key = payload -> 'trophies' ->> 'demandMet';
    delete from trophy_kinds k where k.made_by is null and not exists (select 1 from jsonb_array_elements(payload -> 'trophies' -> 'kinds') e where e ->> 'key' = k.key)
      and not exists (select 1 from trophy_awards a where a.trophy = k.key);
  end if;
  insert into machine_slots (position, card, pack, availability, price)
  select (select coalesce(max(position), 0) from machine_slots) + row_number() over (order by m.i), m.e ->> 'card', m.e ->> 'pack', m.e ->> 'availability', (m.e ->> 'price')::integer
  from jsonb_array_elements(coalesce(payload -> 'machine', '[]')) with ordinality m(e, i)
  where not exists (select 1 from machine_slots s where s.card = m.e ->> 'card' or s.pack = m.e ->> 'pack');
  -- The welcome pack's backfill (0377): every account with a character and no welcome pack yet gets one, when `startingPack` names a fixed pack. One insert with a semi-join to characters
  -- (characters_owner) and an anti-join to packs (packs_one_welcome), which writes nothing on a second seed; the unique index makes it once ever, so a seed racing a character's creation
  -- grants once, and an instance that changes `startingPack` later gives no second.
  insert into packs (account, pack, price, contents, source)
  select a.id, k.key, 0, k.contents, 'welcome'
  from pack_kinds k
  join accounts a on exists (select 1 from characters c where c.owner = a.id)
  where k.key = welcome_pack_kind()
    and not exists (select 1 from packs w where w.account = a.id and w.source = 'welcome')
  on conflict (account) where source = 'welcome' do nothing;
  -- The flag leaves the board that held it before another takes it, so the index never sees two.
  -- A seed naming one slug twice is refused by the upsert ("cannot affect row a second time"),
  -- where 0004 took its first; an instance never holds one (instanceProblems).
  if flagged is not null then update boards set is_system = false where is_system and slug <> flagged; end if;
  insert into boards (slug, name, description, is_system)
  select e ->> 'slug', e ->> 'name', coalesce(e ->> 'description', ''), coalesce(e ->> 'slug' = flagged, false) from jsonb_array_elements(payload -> 'boards') e
  on conflict (slug) do update set is_system = true where excluded.is_system and not boards.is_system;
  -- A pip style is added or renamed, never removed: a profile may name it.
  insert into pip_styles (key, name, full_image, empty_image)
  select e ->> 'key', e ->> 'name', e ->> 'full', e ->> 'empty' from jsonb_array_elements(coalesce(payload -> 'pipStyles', '[]')) e
  on conflict (key) do update set name = excluded.name, full_image = excluded.full_image, empty_image = excluded.empty_image;
  -- The instance's personas (0082), once each: a persona is made when its key has no character yet, with the profile its seed gives (its
  -- title and its signature, cut to what a profile holds). The first Boss and the first staff debut at seed time; every other persona
  -- is made waiting, with no debut, and debuts the moment it first takes an office. What an admin wrote is never written over: a reseed
  -- finds the key and does nothing. A persona in firstStaff with no office row is hired as a Mod Bot, cause `seed`; one with a row,
  -- a benched one's included, is left as that row says, so a reseed never rehires.
  unknown := (select string_agg(distinct e ->> 'key', ', ') from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
    where e ? 'pronouns' and not pronouns_hold(pronouns_lowered(e -> 'pronouns')));
  if unknown is not null then raise exception 'persona % has pronouns that are not five words of 1 to 12 letters and a plural', unknown using errcode = '22023'; end if;
  with seeded as (
    select e ->> 'key' as staff, e ->> 'name' as name, coalesce(e ->> 'title', '') as title, coalesce(e ->> 'signature', '') as signature,
      pronouns_lowered(e -> 'pronouns') as pronouns
    from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
  ), made as (
    insert into characters (name, staff, staff_kind, debuted_at)
    select s.name, s.staff, 'persona',
      case when s.staff = nullif(payload -> 'system' ->> 'firstBoss', '')
             or s.staff in (select jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]'))) then now() end
    from seeded s
    on conflict (staff) do nothing returning id, staff
  )
  insert into character_profiles (character, title, signature, pronouns)
  select m.id, left(s.title, 40), left(s.signature, 500), coalesce(s.pronouns, new_pronouns()) from made m join seeded s on s.staff = m.staff;
  -- Each listed persona's pronouns (0124), as its beats below: the seed's set is the persona's, so a reseed rewrites what an earlier seed or an earlier
  -- persona file wrote; a persona the seed gives none is left as it was. Its title and its signature stay as the first seed wrote them.
  update character_profiles p set pronouns = pronouns_lowered(e.value -> 'pronouns')
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e, characters c
  where e.value ? 'pronouns' and c.staff = e.value ->> 'key' and c.staff_kind = 'persona' and p.character = c.id
    and p.pronouns is distinct from pronouns_lowered(e.value -> 'pronouns');
  select string_agg(k, ', ') into unknown from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k
  where not exists (select 1 from characters c where c.staff = k and c.staff_kind = 'persona');
  if unknown is not null then raise exception 'firstStaff names %, which no persona in the seed''s roster is', unknown using errcode = '22023'; end if;
  -- Each listed persona's beat preferences (0103): the slugs of the kinds of board it likes. The seed's list is the persona's whole list, so a reseed
  -- replaces what an earlier seed wrote; a persona the seed gives no `beats` is left as it was.
  delete from staff_beats b where b.staff in (select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where e ? 'beats');
  insert into staff_beats (staff, slug)
  select distinct e ->> 'key', s
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e,
       jsonb_array_elements_text(case when jsonb_typeof(e -> 'beats') = 'array' then e -> 'beats' else '[]'::jsonb end) s
  where e ? 'beats';
  -- Each listed persona's visit traits (0105): the hours a visit of its runs and what talks it down. The seed's entry is the persona's whole traits, so a
  -- reseed replaces what an earlier seed wrote; a persona the seed gives neither is left as it was. A challenge carries a kind and its number (how many
  -- questions, or the price) and nothing else: a quiz's answers are never seeded here, where a client could read them.
  unknown := (select string_agg(distinct e ->> 'key', ', ') from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
    where (e ? 'visitHours' or e ? 'challenge') and visit_traits_problem(e -> 'visitHours', e -> 'challenge') is not null);
  if unknown is not null then
    raise exception 'persona % has visit traits that are wrong: %', unknown, (select visit_traits_problem(e -> 'visitHours', e -> 'challenge')
      from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where (e ? 'visitHours' or e ? 'challenge') and visit_traits_problem(e -> 'visitHours', e -> 'challenge') is not null limit 1) using errcode = '22023';
  end if;
  -- A quiz persona's questions (0108): the question, its choices and the right one, kept where no client can read them. The seed's entry is the persona's whole quiz, so a
  -- reseed replaces what an earlier seed wrote. A quiz that cannot be played is refused with the persona's name, and nothing is written.
  unknown := (select string_agg(distinct e ->> 'key', ', ') from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
    where (e ? 'visitHours' or e ? 'challenge' or e ? 'quiz') and quiz_problem(e -> 'challenge', e -> 'quiz') is not null);
  if unknown is not null then
    raise exception 'persona % has a quiz that cannot be played: %', unknown, (select quiz_problem(e -> 'challenge', e -> 'quiz')
      from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where (e ? 'visitHours' or e ? 'challenge' or e ? 'quiz') and quiz_problem(e -> 'challenge', e -> 'quiz') is not null limit 1) using errcode = '22023';
  end if;
  insert into staff_visit_traits (staff, visit_least, visit_most, challenge)
  select e ->> 'key', coalesce((e #>> '{visitHours,least}')::integer, 1), coalesce((e #>> '{visitHours,most}')::integer, 1000), coalesce(e -> 'challenge', '{"kind": "distraction"}'::jsonb)
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
  where e ? 'visitHours' or e ? 'challenge'
  on conflict (staff) do update set visit_least = excluded.visit_least, visit_most = excluded.visit_most, challenge = excluded.challenge;
  delete from staff_quiz_questions q where q.staff in (select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where e ? 'visitHours' or e ? 'challenge' or e ? 'quiz');
  insert into staff_quiz_questions (staff, idx, question, choices, answer)
  select e ->> 'key', (x.n - 1)::integer, btrim(x.q ->> 'question'), x.q -> 'choices', x.q ->> 'answer'
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e,
       jsonb_array_elements(case when jsonb_typeof(e -> 'quiz') = 'array' then e -> 'quiz' else '[]'::jsonb end) with ordinality x(q, n)
  where e #>> '{challenge,kind}' = 'quiz';
  insert into staff_offices (staff, office, cause)
  select k, 'mod', 'seed' from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k
  where not exists (select 1 from staff_offices x where x.staff = k);
  -- A persona the seed seats as a mod is debuted: a reseed that adds a still-waiting persona to firstStaff hires it above, and it debuts here.
  update characters c set debuted_at = now()
  where c.debuted_at is null and c.staff_kind = 'persona'
    and c.staff in (select k from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k)
    and exists (select 1 from staff_offices x where x.staff = c.staff and x.cause = 'seed' and x.office = 'mod');
  -- The staff group is the ladder's staff rung (group_kinds, seeded above), so no staffGroup setting is written; a row an earlier seed left is read by no one.
  -- The catalogs (0046): the moves and demands the engine holds, as the engine lists them. A reseed upserts a move's flag and
  -- never removes a kind, since a landed move may name it. A missing flag is a seed's mistake (a move that reshapes a board
  -- must not be seeded as one that does not), so it is refused by the column.
  insert into move_kinds (key, structural, shapes_board, lasting, offices, derived)
  select e ->> 'key', (e ->> 'structural')::boolean, coalesce((e ->> 'shapesBoard')::boolean, false), coalesce((e ->> 'lasting')::boolean, false),
         case when jsonb_typeof(e -> 'offices') = 'array' and jsonb_array_length(e -> 'offices') > 0 then array(select jsonb_array_elements_text(e -> 'offices')) else '{boss}' end,
         case when jsonb_typeof(e -> 'derived') = 'array' then array(select jsonb_array_elements_text(e -> 'derived')) else '{}' end
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'moves', '[]')) e
  on conflict (key) do update set structural = excluded.structural, shapes_board = excluded.shapes_board, lasting = excluded.lasting, offices = excluded.offices, derived = excluded.derived;
  -- The rule predicates (0102), as the engine lists them (engine/rules/predicates.ts). A reseed upserts; a predicate is never removed,
  -- since a landed rule may name it.
  insert into rule_predicates (key, param_kind, least, most, tags, plain)
  select e ->> 'key', e ->> 'param', (e ->> 'least')::integer, (e ->> 'most')::integer,
         case when jsonb_typeof(e -> 'tags') = 'array' then array(select jsonb_array_elements_text(e -> 'tags')) end, e ->> 'plain'
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'predicates', '[]')) e
  on conflict (key) do update set param_kind = excluded.param_kind, least = excluded.least, most = excluded.most, tags = excluded.tags, plain = excluded.plain;
  insert into demand_kinds (key) select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'demands', '[]')) e
  on conflict (key) do nothing;
  -- The conditions that unlock a beat (0332), as the engine lists them (engine/system/conditions.ts). A reseed upserts; a condition is never removed, since a persona's arc may name it.
  insert into condition_kinds (key, plain)
  select e ->> 'key', e ->> 'plain' from jsonb_array_elements(coalesce(payload -> 'system' -> 'conditions', '[]')) e
  on conflict (key) do update set plain = excluded.plain;
  -- A persona's arc (0332): one row each, rewritten by a reseed. An arc naming a condition the catalog lacks is refused, naming it: the check that no beat waits on a condition nothing reads.
  unknown := (select string_agg(distinct c ->> 'kind', ', ')
              from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) p, jsonb_array_elements(coalesce(p -> 'arc', '[]')) b, jsonb_array_elements(coalesce(b -> 'unlock', '[]')) c
              where not exists (select 1 from condition_kinds k where k.key = c ->> 'kind'));
  if unknown is not null then raise exception 'an arc names a condition the catalog lacks: %', unknown using errcode = '23514'; end if;
  delete from persona_arcs where staff in (select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e);
  insert into persona_arcs (staff, beats, holds_back, phase_days)
  select e ->> 'key', coalesce(e -> 'arc', '[]'), coalesce(e -> 'holdsBack', '[]'), coalesce(e -> 'phaseDays', '{}')
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e;
  -- The roster's order (0051): the seed's personas, in the order it lists them, so the rotation has one to follow. A seed with no
  -- persona leaves the setting as it was.
  perform seed_setting('bossRoster', r.roster)
  from (select jsonb_agg(e.value ->> 'key' order by e.ord) as roster
        from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) with ordinality e(value, ord)
        having count(*) > 0) r;
  if not exists (select 1 from seasons) then insert into seasons (number, starts_at) values (1, now()); end if;
  -- The open season's Boss (0043's seasons.boss) is the seed's firstBoss when it has none: a season opened before a Boss
  -- existed, or by this seed. A season that already has a Boss keeps it.
  if nullif(payload -> 'system' ->> 'firstBoss', '') is not null then
    update seasons set boss = payload -> 'system' ->> 'firstBoss' where ends_at is null and boss is null;
  end if;
  -- The announcements thread: the one thread on The System's board where a landed move is written and a move's end is said. Made once,
  -- titled from the seed (`system.announcementsTitle`), and its id recorded in the setting `systemAnnouncements` where the tick finds it.
  -- A reseed finds the setting (and the thread it names) and makes nothing; a seed with no title makes none, and until a seed has one
  -- the tick lands nothing (a board with nowhere to say a move is no board it can move). The setting is not in a seed's `settings`,
  -- so no seed writes it over.
  if nullif(payload -> 'system' ->> 'announcementsTitle', '') is not null
     and setting_thread('systemAnnouncements') is null then
    insert into threads (board, title) values (system_board(), payload -> 'system' ->> 'announcementsTitle') returning id into opened;
    perform seed_setting('systemAnnouncements', to_jsonb(opened::text));
  end if;
  -- The developer persona and its thread (0062): a seed with a `developer` entry ({ name, title, avatar }) makes the one developer, once,
  -- as it makes a persona: debuted at seed time, with the tagline as its profile title, cut to what a profile holds. What an admin wrote is
  -- never written over: a reseed finds the key and does nothing, except that the avatar's asset key is the instance's to change. Then
  -- the updates thread, on The System's board, recorded in the setting `updatesThread` (not in a seed's `settings`, so no seed
  -- writes it over); the board's thread counter is netted by the thread's own, since a board's count is the length of its list and
  -- thread_list never lists this one.
  if jsonb_typeof(payload -> 'developer') = 'object' then
    if payload -> 'developer' ? 'pronouns' and not pronouns_hold(pronouns_lowered(payload -> 'developer' -> 'pronouns')) then
      raise exception 'the developer has pronouns that are not five words of 1 to 12 letters and a plural' using errcode = '22023';
    end if;
    -- The thread opens on The System's board, so a database with no board is told so before anything is made.
    if system_board() is null then raise exception 'a developer needs The System''s board; seed boards first' using errcode = '22023'; end if;
    with made as (
      insert into characters (name, staff, staff_kind, debuted_at) values (payload -> 'developer' ->> 'name', 'developer', 'developer', now())
      on conflict (staff) do nothing returning id
    )
    insert into character_profiles (character, title, signature, pronouns)
    select m.id, left(coalesce(payload -> 'developer' ->> 'title', ''), 40), '', coalesce(pronouns_lowered(payload -> 'developer' -> 'pronouns'), new_pronouns()) from made m;
    -- The developer's pronouns, when the seed names them, are rewritten on every seed (0124); its title and signature are not.
    update character_profiles p set pronouns = pronouns_lowered(payload -> 'developer' -> 'pronouns')
    from characters c
    where payload -> 'developer' ? 'pronouns' and c.staff = 'developer' and p.character = c.id and p.pronouns is distinct from pronouns_lowered(payload -> 'developer' -> 'pronouns');
    if nullif(payload -> 'developer' ->> 'avatar', '') is not null then
      perform seed_setting('developerAvatar', to_jsonb(payload -> 'developer' ->> 'avatar'));
    end if;
    if setting_thread('updatesThread') is null then
      sys := system_board();
      insert into threads (board, title) values (sys, 'Updates') returning id into opened;
      perform seed_setting('updatesThread', to_jsonb(opened::text));
      update board_thread_counts set threads = threads - 1
       where board = sys and shard = coalesce((select c.shard from board_thread_counts c where c.board = sys order by c.shard for update skip locked limit 1), 0);
    end if;
  end if;
  -- The anonymous poster (0357): a seed with an `anonymous` entry ({ name, title, avatar, pronouns }) makes the one stand-in, once, as it makes the developer: debuted at seed time, the tagline its profile title, the pronouns
  -- rewritten on every seed when the seed names them, the avatar's asset key the instance's to change. What an admin wrote is never written over. A seed with none makes none, and stand_in() is then null (land_refusal
  -- refuses a veil until one exists); seed.ts always sends one, the engine's own when the instance names none.
  if jsonb_typeof(payload -> 'anonymous') = 'object' then
    if payload -> 'anonymous' ? 'pronouns' and not pronouns_hold(pronouns_lowered(payload -> 'anonymous' -> 'pronouns')) then
      raise exception 'the anonymous poster has pronouns that are not five words of 1 to 12 letters and a plural' using errcode = '22023';
    end if;
    with made as (
      insert into characters (name, staff, staff_kind, debuted_at) values (payload -> 'anonymous' ->> 'name', 'anonymous', 'anonymous', now())
      on conflict (staff) do nothing returning id
    )
    insert into character_profiles (character, title, signature, pronouns)
    select m.id, left(coalesce(payload -> 'anonymous' ->> 'title', ''), 40), '', coalesce(pronouns_lowered(payload -> 'anonymous' -> 'pronouns'), new_pronouns()) from made m;
    update character_profiles p set pronouns = pronouns_lowered(payload -> 'anonymous' -> 'pronouns')
    from characters c
    where payload -> 'anonymous' ? 'pronouns' and c.staff = 'anonymous' and p.character = c.id and p.pronouns is distinct from pronouns_lowered(payload -> 'anonymous' -> 'pronouns');
    if nullif(payload -> 'anonymous' ->> 'avatar', '') is not null then
      perform seed_setting('anonymousAvatar', to_jsonb(payload -> 'anonymous' ->> 'avatar'));
    end if;
  end if;
  -- The seed's roster is the whole staff (docs/plans/2026-11-21-departed-personas-design.md, sections 2 and 3). A persona the roster does not list, and that the seed has not already benched, is departing. This block runs last,
  -- after the persona files, the roster setting, the season and its first Boss and the announcements thread are in place, so a departing Boss's handover reads the roster this seed wrote and says its farewell in the thread.
  -- It runs after (and not inside) the `firstStaff` hire above, which hires only a persona with no office row: a persona the seed benched has one, so it is brought back here and only by a roster that lists it. A seed that
  -- lists no persona (a partial seed) is not a roster and benches nobody, as it leaves `bossRoster` as it was.
  listed := array(select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e);
  first_staff := array(select k from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k);
  if cardinality(listed) > 0 then
    -- One at a time with a handover and with an admin's set_office, so what stands is what is read.
    perform pg_advisory_xact_lock(hashtext('kayfabb.offices'));
    select s.id, s.boss into open_id, boss_was from seasons s where s.ends_at is null;
    mods_were := (select count(*) from staff_office_now o join characters c on c.staff = o.staff where o.office = 'mod' and c.retired_at is null);
    -- A persona listed again after a seed benched it comes back first, so a Boss that is leaving can hand the chair to it: a Mod where firstStaff names it, else a member. A member row debuts nothing; a Mod row debuts it,
    -- as the firstStaff hire does.
    returned := array(
      select k from unnest(listed) k
      where exists (select 1 from characters c where c.staff = k and c.staff_kind = 'persona')
        and (select o.office = 'benched' and o.cause = 'seed' from staff_offices o where o.staff = k order by o.id desc limit 1));
    insert into staff_offices (staff, office, cause) select k, case when k = any (first_staff) then 'mod' else 'member' end, 'seed' from unnest(returned) k;
    update characters c set debuted_at = now() where c.debuted_at is null and c.staff_kind = 'persona' and c.staff = any (returned) and c.staff = any (first_staff);
    departing := array(
      select c.staff from characters c
      where c.staff_kind = 'persona' and c.staff <> all (listed)
        and not coalesce((select o.office = 'benched' and o.cause = 'seed' from staff_offices o where o.staff = c.staff order by o.id desc limit 1), false)
      order by c.staff);
    -- The other departing personas first, so neither the rotation nor a standing nomination can seat one.
    insert into staff_offices (staff, office, cause) select k, 'benched', 'seed' from unnest(departing) k where k is distinct from boss_was;
    departed := array(select k from unnest(departing) k where k is distinct from boss_was);
    if boss_was is not null and boss_was = any (departing) then
      -- The early handover, in the open season: it refuses (and the seed with it, nothing written) where no one else can sit in the chair. Its farewell is posted before the bench below, since a benched persona writes nothing.
      perform hand_over(open_id, boss_was, now(), true);
      insert into staff_offices (staff, office, cause) values (boss_was, 'benched', 'seed');
      departed := departed || boss_was;
      select s.boss into handed from seasons s where s.id = open_id;
    end if;
    -- The staff is never empty: where a Mod stood before this seed and none stands now (it benched the last one, or the Boss's handover did), each listed firstStaff persona that is not the Boss is hired. If that still leaves none,
    -- the seed is refused. A staff that had no Mod before this seed is not this seed's doing, so it is left as it was (the firstStaff hire above is how a first seed gets its Mod).
    if mods_were > 0
       and not exists (select 1 from staff_office_now o join characters c on c.staff = o.staff where o.office = 'mod' and c.retired_at is null) then
      insert into staff_offices (staff, office, cause)
      select k, 'mod', 'seed' from unnest(first_staff) k
      where k = any (listed) and k is distinct from (select s.boss from seasons s where s.id = open_id)
        and exists (select 1 from characters c where c.staff = k and c.staff_kind = 'persona' and c.retired_at is null);
      update characters c set debuted_at = now() where c.debuted_at is null and c.staff_kind = 'persona' and c.staff = any (first_staff)
        and exists (select 1 from staff_offices x where x.staff = c.staff and x.cause = 'seed' and x.office = 'mod' and x.id = (select max(y.id) from staff_offices y where y.staff = c.staff));
      if not exists (select 1 from staff_office_now o join characters c on c.staff = o.staff where o.office = 'mod' and c.retired_at is null) then
        raise exception 'the seed leaves no Mod Bot on staff: name one in firstStaff' using hint = 'kayfabb.refusal', errcode = '55000';
      end if;
    end if;
  end if;
  -- Seeding ends here: a write later in a transaction that called this (a test file's, one session's) is not the seed's. The flag goes back to the value this found. A custom
  -- setting cannot be truly unset inside a transaction, so one that was unset (null) or empty goes back to 'off', which the trigger reads the same.
  perform set_config('kayfabb.seeding', coalesce(nullif(was, ''), 'off'), true);
  return jsonb_build_object('settings', (select count(*) from settings), 'classes', (select count(*) from class_kinds),
    'reactions', (select count(*) from reaction_kinds), 'groups', (select count(*) from group_kinds), 'cards', (select count(*) from card_kinds), 'boards', (select count(*) from boards),
    'departed', to_jsonb(departed), 'returned', to_jsonb(returned), 'handover', to_jsonb(handed));
end $function$;
