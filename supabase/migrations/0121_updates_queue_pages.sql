-- updates_page(update, before, handover_season) and queue_page(): /updates and /admin/queue, each in one read (the glass-load design, section 7;
-- its plan, Task 8).
--
-- updates_page: the Updates screen (engine/ui/updates/Updates.tsx) reads a page of updates, then for the update that is open the reactions on it,
-- and, for an admin who followed a handover link, the queue's to-do list.
--   updates   updates(in_before, 20): UPDATES_PAGE rows, newest first, each as the adapter's updates() reads it (`in_before` is the page's cursor).
--   tallies   reaction_tallies' (act, kind, count) rows of the open update's Act; `mine` the caller's own my_reactions (act, kind, character)
--             rows of it. The open update is `in_update` (an update's Act id, the address's `?update=`), else the newest update of the page.
--   queue     admin_queue(), only when in_handover_season is given and the caller is an admin; the key is absent otherwise.
-- queue_page: the admin queue screen (engine/ui/admin/Queue.tsx). Null unless the caller is an admin (the screen then says "The admin queue is for
-- admins", as it does today); otherwise
--   queue       admin_queue();
--   boardNames  every board as it is named now with the name it was created under ({ id, slug, name, was }), as the adapter's boardNames() reads
--               boards_now and boards;
--   bosses      boss_roster_names();
--   contact     admin_contact().
-- The boards themselves come from boot.
--
-- Bounded by a page of updates (20) and one update's tallies (one row per reaction kind), the caller's own reactions to it, the queue's own bounds
-- (admin_queue caps its lists), the boards (the instance's few) and the roster. Every piece is a public projection, the caller's own row or an
-- admin's read of the function the browser already calls, as the caller (security invoker). Neither writes anything, reads only what a screen may
-- read (tools/check-web-reads.mjs) and is stable, which supabase/tests/e2e/0016-screen-reads.ts holds. A visitor is refused.
--
-- The update rows are held as jsonb so that these functions depend on updates() and not on the composite type it returns.

create function updates_page(in_update uuid, in_before timestamptz, in_handover_season integer) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  with up as (
    select to_jsonb(u) - 'ordinality' as j, u.ordinality as o
    from updates(in_before, 20) with ordinality as u
  ), open as (
    select coalesce(in_update, (select (up.j ->> 'act')::uuid from up order by up.o limit 1)) as act
  )
  select jsonb_build_object(
    'updates', coalesce((select jsonb_agg(up.j order by up.o) from up), '[]'::jsonb),
    'tallies', coalesce((select jsonb_agg(to_jsonb(t) order by t.kind) from (
      select r.act, r.kind, r.count from reaction_tallies r where r.act = (select act from open)) t), '[]'::jsonb),
    'mine', coalesce((select jsonb_agg(to_jsonb(m) order by m.kind, m.character::text collate "C") from (
      select r.act, r.kind, r.character from my_reactions r where r.act = (select act from open)) m), '[]'::jsonb)
  ) || case when in_handover_season is not null and coalesce(is_admin(), false) then jsonb_build_object('queue', admin_queue()) else '{}'::jsonb end;
end;

create function queue_page() returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  select case when coalesce(is_admin(), false) then jsonb_build_object(
    'queue', admin_queue(),
    'boardNames', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'slug', n.slug, 'name', n.name, 'was', coalesce(b.name, n.name)) order by n.created_at, n.id)
      from boards_now n left join boards b on b.id = n.id), '[]'::jsonb),
    'bosses', boss_roster_names(),
    'contact', admin_contact()) end;
end;

revoke all on function updates_page(uuid, timestamptz, integer), queue_page() from public, anon, authenticated;
grant execute on function updates_page(uuid, timestamptz, integer), queue_page() to authenticated;
