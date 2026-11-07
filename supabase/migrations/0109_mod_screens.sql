-- The reads behind the Mod Bots' screens (the Mod Bots design, section 9; its plan, Task 13).
--
--   my_infractions, my_bans, my_reports, my_appeals   the player's own log lines: the infractions filed against, the bans laid on, the reports made and the appeals made by the
--                          CALLER'S characters (characters.owner = auth.uid()), and nothing of anyone else's. Each row says which Act did what (the Act's id), to which character
--                          of the player's, when, and how it ended, in the facts the log's plain words are written from. A report or an appeal says what became of its price
--                          (refunded, and why). They are the caller's own rows, so reading them proves nothing about anyone else's characters; no row names an account, an
--                          owner, a class or who reacted. Each is a view that reads the caller's characters first and probes the Acts by the indexes the warn bar, the reports
--                          and the appeals already have (acts_infractions, acts_bans, acts_reports_by_character, acts_by_character), so its cost is the caller's own history
--                          and never the instance's.
--   my_characters          (0074) also carries `banned_until` as its last column: when the character's ban ends, null while it is not banned (a public fact; the composer says so).
--   reports_left_today(who)   how many reports `who` may still make today (UTC): the instance's `reportsPerDay` less the day's report Acts of that character, none counted for
--                          a report refunded for a failed judgment (open_report's own rule). It answers from public Acts for any id, the same for everyone, except that the caller's OWN
--                          character's failed refunds are also left out of the count: the one place a number depends on ownership, and it differs only for the owner's own screen.
--                          Nothing is refused for a character that is not the caller's, and a character that is none gets the full quota.
--   presence_box(kind, place)   (0102) a Mod with an open visit in a thread is listed in that thread's box, with the number of the post it is visiting (`visit_post`, its
--                          lowest where it has several). A visit is a public Act and a Mod is public, so this is computed from nothing private; the Mod need not have posted. A name
--                          the box lists twice (it posted, and it visits) is one name. An index of the thread's visits (acts_visits_by_thread, 0106) keeps the read to the thread's own.
--   moves_log              (0051) a Mod's moderation log also lists its visits, the reports it judged and the appeals it heard, each with how it ended: a visit's outcome
--                          (null while it is open), a report's verdict, an appeal's ruling. `kind` is 'visit', 'report' or 'appeal'; `params` carries the post's number and what the
--                          screen's plain words need. Public Acts only, as every other row.
--
-- Ways out. Nothing here adds a state; a view is a read. The report quota's number is a read of the one rule open_report keeps.

-- ------------------------------------------------------------------------------------------------------ my_characters ----

-- my_characters (0074), also saying when a character's ban ends (`banned_until`, null while it is not banned) as its last column, so the composer can say so without a read of its own.
-- A ban is a public Act and this is the caller's own characters, so it says nothing that a thread's postbit does not. The grants are as 0030 left them.
create or replace view my_characters as
  select c.id, c.name, h.class_key as class, h.started_at as class_since,
         case when t.at > now() then t.at end as turn_opens_at,
         c.debuted_at, c.debut_loudness, c.retired_at,
         p.class_key as pending_class, p.loudness as pending_loudness, p.show_from as pending_show_from, p.show_to as pending_show_to,
         case when p.character is not null then next_settlement_at(now()) end as takes_effect_at,
         exists (select 1 from presence_hidden x where x.character = c.id) as presence_hidden,
         h.due_at as class_due_at,
         banned_until(c.id) as banned_until
  from characters c
  cross join lateral (select x.class_key, x.started_at, x.due_at from class_history x where x.character = c.id order by x.started_at desc limit 1) h
  cross join lateral (
    select (select max(x.started_at) from class_history x
            where x.character = c.id and x.started_at > (select min(f.started_at) from class_history f where f.character = c.id))
           + span_interval((select s.value from settings s where s.key = 'turnCooldown')) as at
  ) t
  left join pending_turns p on p.character = c.id
  where c.owner = auth.uid();

-- ------------------------------------------------------------------------------------------------ reports left today ----

create function reports_left_today(who uuid) returns integer
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  per_day integer := coalesce((select (s.value ->> 'reportsPerDay')::integer from settings s where s.key = 'modBots'), 3);
  day_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  own boolean := exists (select 1 from characters c where c.id = reports_left_today.who and c.owner = auth.uid());
begin
  return greatest(0, per_day - (
    select count(*) from acts r
    where r.kind = 'report' and r.character = reports_left_today.who and r.created_at >= day_start
      and not (own and exists (select 1 from report_refunds f where f.report_act = r.id and f.why = 'failed'))))::integer;
end $$;
revoke execute on function reports_left_today(uuid) from public, anon;
grant execute on function reports_left_today(uuid) to authenticated;

-- ------------------------------------------------------------------------------------------------------- the log views ----

-- A function a view calls is executed with the privileges of whoever reads the view (0102's note on warn_points), so the two the log's views read are granted to signed-in players.
-- Each answers a public fact about any id, the same for everyone: an infraction is a public Act, its rule is the rule's own words, and a relief is what a public ruling took off.
grant execute on function punishment_words(uuid) to authenticated;
grant execute on function infraction_relief(uuid) to authenticated;

-- The infractions filed against the caller's characters: the Act, the character, when, the band and the points frozen on it, the rule in the glass's words, the Mod that filed it,
-- the post it is about (and its number), when the points drop off, how many an appeal took off, and when a ban emptied the bar (null: none has since).
create view my_infractions as
  select i.id as infraction, c.id as character, i.created_at as at, i.payload ->> 'band' as band, (i.payload ->> 'points')::integer as points,
         (i.payload ->> 'rule_number')::integer as rule_number, punishment_words(i.id) as rule,
         (select m.name from characters m where m.staff = i.payload ->> 'staff') as mod_name,
         (i.payload ->> 'about_act')::uuid as post, (select p.seq from acts p where p.id = (i.payload ->> 'about_act')::uuid) as post_seq, i.thread,
         (i.payload ->> 'expires_at')::timestamptz as expires_at, infraction_relief(i.id) as relief,
         (select min(b.created_at) from acts b where b.kind = 'ban' and b.payload ->> 'character' = c.id::text and b.created_at > i.created_at) as emptied_at
  from characters c
  join acts i on i.kind = 'infraction' and i.payload ->> 'character' = c.id::text
  where c.owner = auth.uid();

-- The bans laid on the caller's characters: the Act, the character, when, how many days, when it ends now (an appeal's ruling read in place of the ban's own end), the infraction that
-- filled the bar and its rule.
create view my_bans as
  select b.id as ban, c.id as character, b.created_at as at, (b.payload ->> 'days')::integer as days,
         coalesce((select (r.payload ->> 'until')::timestamptz from acts a join acts r on r.kind = 'appeal_ruling' and r.target_act_id = a.id
                   where a.kind = 'appeal' and a.target_act_id = b.id and r.payload ? 'until' limit 1),
                  (b.payload ->> 'until')::timestamptz) as until,
         (b.payload ->> 'infraction_act')::uuid as infraction, punishment_words((b.payload ->> 'infraction_act')::uuid) as rule, b.thread
  from characters c
  join acts b on b.kind = 'ban' and b.payload ->> 'character' = c.id::text
  where c.owner = auth.uid();

-- The reports the caller's characters made: the Act, the character, when, the post and its number, the verdict and when it came (null: none yet), the Mod that gave it and what became
-- of the price (`refund`: 'failed' or 'stale' when it went back, else null).
create view my_reports as
  select r.id as report, c.id as character, r.created_at as at, r.target_act_id as post, (select p.seq from acts p where p.id = r.target_act_id) as post_seq, r.thread,
         v.payload ->> 'verdict' as verdict, v.created_at as verdict_at, (select m.name from characters m where m.id = v.character) as mod_name,
         (select f.why from report_refunds f where f.report_act = r.id) as refund
  from characters c
  join acts r on r.kind = 'report' and r.character = c.id
  left join acts v on v.kind = 'report_verdict' and v.target_act_id = r.id
  where c.owner = auth.uid();

-- The appeals the caller's characters made: the Act, the character, when, the punishment (an infraction or a ban) and its post's number, the ruling and when it came (null: none
-- yet), the points it moved, the staff member who heard it and what became of the price.
create view my_appeals as
  select a.id as appeal, c.id as character, a.created_at as at, a.target_act_id as punishment, p.kind as punishment_kind,
         (select x.seq from acts x where x.id = case when p.kind = 'infraction' then (p.payload ->> 'about_act')::uuid else (select (i.payload ->> 'about_act')::uuid from acts i where i.id = (p.payload ->> 'infraction_act')::uuid) end) as post_seq,
         a.thread, r.payload ->> 'verdict' as verdict, r.created_at as ruled_at, (r.payload ->> 'points_delta')::integer as points_delta,
         (select m.name from characters m where m.id = r.character) as hearer_name,
         (select f.why from appeal_refunds f where f.appeal_act = a.id) as refund
  from characters c
  join acts a on a.kind = 'appeal' and a.character = c.id
  join acts p on p.id = a.target_act_id
  left join acts r on r.kind = 'appeal_ruling' and r.target_act_id = a.id
  where c.owner = auth.uid();

revoke all on my_infractions, my_bans, my_reports, my_appeals from public, anon, authenticated;
grant select on my_infractions, my_bans, my_reports, my_appeals to authenticated;

-- ------------------------------------------------------------------------------------------------------------ presence ----

-- presence_box (0102), a thread's box also listing a Mod with an open visit there, with the number of the post it visits. Everything else as 0102 wrote it.
create or replace function presence_box(in_kind text, in_place uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  win interval := span_interval(setting('presenceWindow'));
  cap integer := (setting('presenceNames') #>> '{}')::integer;
  at_board uuid;
  shown jsonb;
  total integer;
begin
  if in_kind = 'thread' then
    select t.board into at_board from threads t where t.id = in_place;
    if at_board is null then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  elsif in_kind = 'board' then
    select b.id into at_board from boards b where b.id = in_place;
    if at_board is null then raise exception 'there is no such board' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  elsif in_kind is distinct from 'index' then
    raise exception 'there is no such place to browse' using hint = 'kayfabb.refusal', errcode = 'P0002';
  end if;

  -- The box, read by one statement per kind of place (0041). A board's box reads a staff character's rows (one per thread it posted in)
  -- as one name; the index never lists a staff character. A thread's box also lists a Mod on an open visit in it, once.
  if in_kind = 'thread' then
    with seen as (
      select l.id, l.name, l.staff, l.place_since, null::integer as visit_post from presence_listed l
      where l.place = in_place and l.seen_at >= now() - win
      union all
      select m.id, m.name, true, v.created_at, p.seq
      from acts v
      join visits_open o on o.visit_act = v.id
      join acts p on p.id = o.post
      join characters m on m.id = v.character
      where v.kind = 'visit' and v.thread = in_place and m.staff is not null and m.staff_kind is distinct from 'developer' and m.debuted_at is not null and m.retired_at is null),
    one as (
      select s.id, s.name, bool_or(s.staff) as staff, min(s.place_since) as place_since, min(s.visit_post) as visit_post from seen s group by s.id, s.name),
    f as (select * from one order by one.place_since, one.id limit cap)
    select (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'staff', f.staff, 'banned_until', banned_until(f.id))
                                      || case when f.visit_post is not null then jsonb_build_object('visit_post', f.visit_post) else '{}'::jsonb end
                                      order by f.place_since, f.id), '[]'::jsonb) from f),
           (select count(*) from one)
      into shown, total;
  elsif in_kind = 'board' then
    with b as (
      select l.id, l.name, l.staff, min(l.place_since) as place_since from presence_listed l
      where l.board = in_place and l.seen_at >= now() - win group by l.id, l.name, l.staff),
    f as (select * from b order by b.place_since, b.id limit cap)
    select (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'staff', f.staff, 'banned_until', banned_until(f.id)) order by f.place_since, f.id), '[]'::jsonb) from f),
           (select count(*) from b)
      into shown, total;
  else
    select (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'staff', false, 'banned_until', banned_until(f.id)) order by f.online_since, f.id), '[]'::jsonb)
            from (select l.id, l.name, l.online_since from presence_listed l
                  where not l.staff and l.seen_at >= now() - win order by l.online_since, l.id limit cap) f),
           (select count(*) from presence_listed l where not l.staff and l.seen_at >= now() - win)
      into shown, total;
  end if;
  return jsonb_build_object('names', shown, 'others', greatest(0, total - jsonb_array_length(shown)));
end $$;

-- ------------------------------------------------------------------------------------------------------- moves_log ----

-- moves_log (0051), also listing a staff member's visits, the reports it judged and the appeals it heard (columns as 0051 wrote them; only rows are added). For these `ended_why` says
-- how it ended: a visit's outcome (null while it is open), a report's verdict, an appeal's ruling; `ended_at` is when; `params` has the post's number and the plain facts the screen says.
create or replace view moves_log as
  select a.id, c.staff, a.payload ->> 'kind' as kind, a.payload -> 'params' as params, a.payload -> 'demand' as demand,
         (a.payload ->> 'expires_at')::timestamptz as expires_at, a.thread, a.created_at as at,
         e.payload ->> 'why' as ended_why, e.payload ->> 'by' as ended_by, e.created_at as ended_at,
         k.staff as kept_by, k.at as kept_at
  from characters c
  cross join lateral (select x.* from acts x where x.character = c.id and x.kind = 'move') a
  left join acts e on e.kind = 'move_end' and e.target_act_id = a.id
  left join lateral (
    select kc.staff, ka.created_at as at from acts ka join characters kc on kc.id = ka.character
    where ka.kind = 'move_keep' and ka.target_act_id = a.id order by ka.created_at desc, ka.id desc limit 1
  ) k on true
  where c.staff is not null
  union all
  select v.id, c.staff, 'visit'::text, jsonb_build_object('post', p.seq, 'rule', v.payload #>> '{charges,0,rule}', 'rule_number', v.payload #> '{charges,0,rule_number}', 'band', v.payload #>> '{charges,0,band}', 'cause', v.payload #>> '{charges,0,cause}'),
         null::jsonb, (v.payload ->> 'ends_at')::timestamptz, v.thread, v.created_at,
         e.payload ->> 'outcome', null::text, e.created_at, null::text, null::timestamptz
  from characters c
  join acts v on v.character = c.id and v.kind = 'visit'
  join acts p on p.id = v.target_act_id
  left join acts e on e.kind = 'visit_end' and e.target_act_id = v.id
  where c.staff is not null
  union all
  select d.id, c.staff, 'report'::text, jsonb_build_object('post', p.seq, 'verdict', d.payload ->> 'verdict'),
         null::jsonb, null::timestamptz, d.thread, d.created_at,
         d.payload ->> 'verdict', null::text, d.created_at, null::text, null::timestamptz
  from characters c
  join acts d on d.character = c.id and d.kind = 'report_verdict'
  join acts r on r.id = d.target_act_id
  join acts p on p.id = r.target_act_id
  where c.staff is not null
  union all
  select u.id, c.staff, 'appeal'::text,
         jsonb_build_object('post', (select x.seq from acts x where x.id = case when pu.kind = 'infraction' then (pu.payload ->> 'about_act')::uuid else (select (i.payload ->> 'about_act')::uuid from acts i where i.id = (pu.payload ->> 'infraction_act')::uuid) end),
                            'punishment', pu.kind, 'verdict', u.payload ->> 'verdict', 'points_delta', u.payload -> 'points_delta'),
         null::jsonb, null::timestamptz, u.thread, u.created_at,
         u.payload ->> 'verdict', null::text, u.created_at, null::text, null::timestamptz
  from characters c
  join acts u on u.character = c.id and u.kind = 'appeal_ruling'
  join acts ap on ap.id = u.target_act_id
  join acts pu on pu.id = ap.target_act_id
  where c.staff is not null;
grant select on moves_log to anon, authenticated;
