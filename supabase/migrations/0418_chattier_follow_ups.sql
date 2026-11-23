-- Chattier staff follow-ups, the database (docs/plans/2026-11-23-chattier-staff-follow-ups-plan.md, Task 1; issue #1022).
--
-- 1. pool_thread (0366_excerpts_and_orders.sql) reads a list of replies beside the newest `most` posts. A turn answers up to 12 replies in a thread; each was read alone (`most` 0 and `also`), a call each, and
--    now one call reads them all. The list is a fifth argument, `more uuid[]`: the page holds the newest `most` posts, the post `also` names and every post `more` names (at most the first 50 of them, so the read
--    stays bounded whatever a caller passes), oldest first. The four-argument form every caller already uses (the chatter, staff and appeal functions, the system tests) stays as it was, a wrapper that reads no list.
--    The five-argument form has no default on `more`, so a call with three or four arguments (`null` as the fourth included) resolves to the wrapper alone. Everything else in pool_thread as 0366 wrote it.
--    Both are the digest role's, as 0089 made pool_thread: the owner change needs the role to hold create on the schema while it happens, and the grant is taken back at once. Grants are restated below.
-- Ways out: no state is added. Masks: the read is of public posts by public characters (acts_public, characters_public), as before.
--
-- The tests that drive the review's two poisons red (F1, F2 of the final review of PR #1000) are supabase/tests/0418-chattier-follow-ups.sql; the two-connection test of write_staff_turn is
-- supabase/tests/e2e/0033-staff-turn-race.ts.

create function pool_thread(in_thread uuid, most integer, chars integer, also uuid, more uuid[]) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with page as (
    select a.id, a.seq, a.created_at, c.name, (select cp.pronouns from character_profiles cp where cp.character = c.id) as pronouns,
           left(coalesce(a.current_payload ->> 'body', ''), greatest(chars, 1)) as body,
           length(coalesce(a.current_payload ->> 'body', '')) > greatest(chars, 1) as cut
    from acts_public a join characters_public c on c.id = a.character
    where a.thread = in_thread and a.kind = 'post'
      and (a.id = also or a.id = any (coalesce(more[1:50], '{}'::uuid[]))
           or a.id in (select n.id from acts_public n where n.thread = in_thread and n.kind = 'post'
                       order by n.created_at desc, n.id desc limit greatest(most, 0)))
  )
  select jsonb_build_object(
    'title', coalesce((select t.title from thread_list t where t.id = in_thread), ''),
    'posts', coalesce((select jsonb_agg(jsonb_build_object('act', p.id, 'name', p.name, 'pronouns', p.pronouns, 'body', p.body, 'cut', p.cut) order by p.created_at, p.id) from page p), '[]'::jsonb),
    'walls', coalesce((select jsonb_agg(jsonb_build_object('play', k.id, 'card', k.payload ->> 'card',
                                                           'about', 'a post by ' || p.name || coalesce(' (#' || p.seq || ')', '')) order by p.created_at, p.id, k.id)
                       from page p join surfaces s on s.post = p.id join acts_public k on k.id = s.play
                       where not exists (select 1 from acts_public e where e.kind = 'card_end' and e.target_act_id = k.id)
                         and not exists (select 1 from card_write_refunds r where r.play = k.id)), '[]'::jsonb))
$$;

-- The four-argument form, as 0366 left it in behavior: the newest `most` posts and the one post `also` names.
create or replace function pool_thread(in_thread uuid, most integer, chars integer, also uuid default null) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select pool_thread(in_thread, most, chars, also, null::uuid[])
$$;

grant create on schema public to kayfabb_digest;
alter function pool_thread(uuid, integer, integer, uuid, uuid[]) owner to kayfabb_digest;
revoke create on schema public from kayfabb_digest;

revoke execute on function pool_thread(uuid, integer, integer, uuid, uuid[]), pool_thread(uuid, integer, integer, uuid) from public, anon, authenticated;
grant execute on function pool_thread(uuid, integer, integer, uuid, uuid[]), pool_thread(uuid, integer, integer, uuid) to service_role;
