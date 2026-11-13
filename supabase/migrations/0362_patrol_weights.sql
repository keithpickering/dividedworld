-- The patrol's weighted draw, and `modBots.patrolPool` (docs/plans/2026-11-11-card-notes-part-5-plan.md, Task 5 and Decided in planning 11 to 13; the design is
-- docs/plans/2026-11-11-card-notes-design.md, section 2, "Tattle-Tale"). It follows 0361, which gave `card_kinds` its `discipline` column: a card whose discipline is a watch
-- multiplies its character's weight in a patrol's draw while it is up. Nothing in a patrol's pick had a weight until now, so this writes the draw.
--
-- watched_characters
--   A view of two columns, character and weight: each play at character reach that is not over by time and not ended, whose card's discipline is a watch. "Ended" is `card_ended`'s
--   two tests (an admin's `card_end`, a refunded write) written out here, since the digest role holds no execute on functions beyond its reviewed list and a function a view calls
--   runs with the reader's privileges; the relations it reads run with the view owner's. The digest role may read it and nobody else; it is public plays only (a play, its card and the character it is on are public Acts),
--   and no owner, class or reactor is anywhere in it.
--
-- patrol_sample(boards, most, pool, seed)
--   Replaces patrol_sample(boards, most) (0127), which is dropped, as its latest text left it with the changes below and nothing else. It stays owned by the digest role, so the
--   owner change 0110 used is taken again: the role holds `create` on the schema while it happens and gives it back.
--   candidates  the newest `pool` eligible posts on the beat, read as the sample was: each board's newest `pool` threads (it was `most`), each thread's newest `most` posts (unchanged), and the
--               outer limit at `pool` (it was `most`). With a pool no larger than the sample, every candidate is returned, whatever the weights.
--   weight      the largest `watched_characters.weight` of the post's author, else 1.
--               The author is the post's character as acts_public shows it: a post under a live author veil (0357) is the stand-in's, a staff character, so it is no candidate at all and its true author's
--               watch never weighs it, as no Mod Bot visits a veiled post (supabase/tests/0314-discipline-veils.sql, section 5).
--   the draw    each candidate draws `u`, a number in (0, 1) from hashtextextended(seed::text || ':' || the post's id, 0), and its key is -ln(u) / weight; the sample is the `most` smallest keys
--               (a weighted draw without replacement). The same seed draws the same sample, so a patrol that runs again reads the posts it read. Ties break by id.
--   the order   the sample is returned newest first, in the shape it has today, so its order says nothing of a weight; nobody is shown a patrol's sample.
--   At a busy instance the read stays flat: at most 50 boards, `pool` threads each, `most` posts each, and one probe of `play_reach` by character per candidate for its weight.
--
-- setting_modbots
--   As 0103 wrote it (never redefined), holding one more field: `patrolPool`, a whole number from `patrolSample` to 100.

-- ----------------------------------------------------------------------------- the watch --

create view watched_characters as
select r.character, (k.discipline ->> 'weight')::numeric as weight
from play_reach r
join acts a on a.id = r.play and a.kind = 'card'
join card_kinds k on k.key = a.payload ->> 'card'
where r.reach = 'character' and r.ends_at > now() and k.discipline ->> 'kind' = 'watch'
  and not exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = r.play)
  and not exists (select 1 from card_write_refunds f where f.play = r.play);
revoke all on watched_characters from public, anon, authenticated, service_role;
grant select on watched_characters to kayfabb_digest;

-- ----------------------------------------------------------------------------- the draw --

drop function patrol_sample(uuid[], integer);
create function patrol_sample(boards uuid[], most integer, pool integer, seed bigint) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('act', s.id, 'thread', s.thread, 'title', s.title, 'board', s.board, 'name', s.name, 'pronouns', s.pronouns, 'body', s.body) order by s.created_at desc, s.id desc), '[]'::jsonb)
  from (
    select k.id, k.thread, k.created_at, k.title, k.board, k.name, k.pronouns, k.body
    from (
      select cand.*, -ln(h.u) / cand.weight as drawn
      from (
        select a.id, a.thread, a.created_at, th.title, th.board, c.name, (select cp.pronouns from character_profiles cp where cp.character = c.id) as pronouns,
               coalesce(a.current_payload ->> 'body', '') as body,
               coalesce((select max(w.weight) from watched_characters w where w.character = a.character), 1) as weight
        from unnest(coalesce(boards, '{}'::uuid[])) with ordinality b(id, ord)
        cross join lateral (select t.id, t.title, t.board from thread_list t where t.board = b.id order by t.last_at desc, t.id desc limit greatest(patrol_sample.pool, 0)) th
        cross join lateral (
          select p.id, p.thread, p.character, p.created_at, p.current_payload
          from acts_public p
          where p.thread = th.id and p.kind in ('post', 'spin')
            and not exists (select 1 from acts_public v where v.kind = 'visit' and v.target_act_id = p.id)
          order by p.created_at desc, p.id desc limit greatest(patrol_sample.most, 0)
        ) a
        join characters_public c on c.id = a.character and c.staff is null
        where b.ord <= 50
        order by a.created_at desc, a.id desc
        limit greatest(patrol_sample.pool, 0)
      ) cand
      cross join lateral (select (hashtextextended(patrol_sample.seed::text || ':' || cand.id::text, 0)::numeric + 9223372036854775808 + 0.5) / 18446744073709551616 as u) h
    ) k
    order by k.drawn, k.id
    limit greatest(patrol_sample.most, 0)
  ) s
$$;
revoke execute on function patrol_sample(uuid[], integer, integer, bigint) from public, anon, authenticated;
grant execute on function patrol_sample(uuid[], integer, integer, bigint) to service_role;
-- The digest role's, as 0110 and 0127 left it: the owner change needs the role to hold create on the schema while it happens, and the grant is taken back at once.
grant create on schema public to kayfabb_digest;
alter function patrol_sample(uuid[], integer, integer, bigint) owner to kayfabb_digest;
revoke create on schema public from kayfabb_digest;

-- ----------------------------------------------------------------------------- the setting --

create or replace function setting_modbots(v jsonb) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  wholes constant jsonb := '{"allowanceMost": 1, "ruleDaysMost": 1, "patrolsPerDay": 0, "reportPrice": 0, "reportsPerDay": 1, "judgmentsPerDay": 1, "filingLinesPerDay": 1, "appealPrice": 0, "tailHours": 1, "filingGraceMinutes": 1}';
  fields constant text[] := array['allowanceMost', 'ruleDaysMost', 'patrolsPerDay', 'reportPrice', 'reportsPerDay', 'judgmentsPerDay', 'filingLinesPerDay', 'appealPrice', 'tailHours', 'filingGraceMinutes', 'patrolSample', 'patrolPool', 'visitHours', 'cap', 'filingCron'];
  shape constant text := 'an object giving allowanceMost, ruleDaysMost, reportsPerDay, judgmentsPerDay, filingLinesPerDay, tailHours and filingGraceMinutes (whole numbers, at least 1), patrolsPerDay, reportPrice and appealPrice (whole numbers, at least 0), patrolSample (a whole number from 1 to 25), patrolPool (a whole number from patrolSample to 100), visitHours (least and most, whole hours, at least 1, most not below least), cap (punishments and days, whole numbers, at least 1) and filingCron (a five-field cron expression, each field inside its range)';
  k text;
begin
  if jsonb_typeof(v) is distinct from 'object' then return shape; end if;
  select e into k from jsonb_object_keys(v) e where e <> all (fields) limit 1;
  if k is not null then return format('%s; "%s" is not one of its fields', shape, k); end if;
  for k in select jsonb_object_keys(wholes) loop
    if not setting_whole(v -> k, (wholes ->> k)::numeric) then return format('%s; "%s" is not', shape, k); end if;
  end loop;
  if not setting_whole(v -> 'patrolSample', 1, 25) then return shape || '; "patrolSample" is not'; end if;
  if not setting_whole(v -> 'patrolPool', (v ->> 'patrolSample')::numeric, 100) then return shape || '; "patrolPool" is not'; end if;
  if not coalesce(jsonb_typeof(v -> 'visitHours') = 'object' and (select count(*) from jsonb_object_keys(v -> 'visitHours')) = 2
      and setting_whole(v -> 'visitHours' -> 'least', 1) and setting_whole(v -> 'visitHours' -> 'most', 1)
      and (v -> 'visitHours' ->> 'most')::numeric >= (v -> 'visitHours' ->> 'least')::numeric, false) then
    return shape || '; "visitHours" is not';
  end if;
  if not coalesce(jsonb_typeof(v -> 'cap') = 'object' and (select count(*) from jsonb_object_keys(v -> 'cap')) = 2
      and setting_whole(v -> 'cap' -> 'punishments', 1) and setting_whole(v -> 'cap' -> 'days', 1), false) then
    return shape || '; "cap" is not';
  end if;
  if not setting_cron(v -> 'filingCron') then return shape || '; "filingCron" is not'; end if;
  return null;
end $$;
