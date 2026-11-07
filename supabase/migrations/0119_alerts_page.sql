-- alerts_page(before): /alerts in one read (the glass-load design, section 7; its plan, Task 7).
-- The Alerts screen reads a page of the caller's alerts, the account's mark and opening date, then what the words need beside the rows
-- (engine/ui/alerts/useAlerts.ts): the Acts the rows name and the Acts those quote (`actsAround`), the authors of those Acts, the opening Acts of
-- the rows' threads (`startedAmong`) and how far the caller has read those threads. This answers them as one document.
--
--   alerts    my_alerts(before, 30): ALERTS_PAGE rows, newest first, each as the adapter's alerts() reads it (`before` is the page's cursor).
--   seenAt    the caller's account_preferences.alerts_seen_at (null where it never looked or has no preferences row yet).
--   openedAt  my_account_opened().
--   acts      the acts_public rows the alerts name (depth 1) and, in up to three rounds in all, those they quote through target_act_id (depth 2
--             is the Act a row's Act quotes, depth 3 the Act that one quotes: a card ended, the card it ended, the post it landed on). The
--             recursion stops at depth three, so a chain of any length, or a loop, costs three rounds; a row without an Act (a followed thread,
--             a settlement) names none.
--   people    the characters_public rows, each with its character_profiles row nested as boot's `faces` are, of those Acts' authors.
--   openings  the opening Acts (seq 1) of the alerts' threads.
--   reading   the caller's own `reading` rows (thread, furthest_seq) for those threads.
-- Writes nothing: see_alerts stays the screen's write on landing.
--
-- Bounded by a page of alerts (30) and the rounds by three: at most 90 Acts, their authors, 30 openings and 30 reading rows. Every piece is a
-- public projection or the caller's own row, read as the caller (security invoker). It reads only what a screen may read
-- (tools/check-web-reads.mjs) and is stable, which supabase/tests/e2e/0016-screen-reads.ts holds. A visitor is refused.
--
-- The alert rows are held as jsonb (their columns read by name) so that this function depends on my_alerts and not on the composite type it returns.

create function alerts_page(in_before timestamptz) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  with recursive al as (
    select to_jsonb(a) - 'ordinality' as j, a.ordinality as o
    from my_alerts(in_before, 30) with ordinality as a
  ), chain(id, depth) as (
    select (al.j ->> 'act')::uuid, 1 from al where al.j ->> 'act' is not null
    union
    select x.target_act_id, c.depth + 1
    from chain c join acts_public x on x.id = c.id
    where c.depth < 3 and x.target_act_id is not null
  ), ac as (
    select a.* from acts_public a where a.id in (select c.id from chain c)
  ), th as (
    select distinct (al.j ->> 'thread')::uuid as id from al where al.j ->> 'thread' is not null
  )
  select jsonb_build_object(
    'alerts', coalesce((select jsonb_agg(al.j order by al.o) from al), '[]'::jsonb),
    'seenAt', (select p.alerts_seen_at from account_preferences p limit 1),
    'openedAt', my_account_opened(),
    'acts', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at, a.id::text collate "C") from ac a), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(f.face order by f.name) from (
        select cp.name, to_jsonb(cp) || jsonb_build_object('profile', (
          select to_jsonb(p) from (
            select r.character, r.title, r.signature, r.avatar_square, r.avatar_portrait, r.square_frame, r.portrait_frame, r.pip_style
            from character_profiles r where r.character = cp.id) p)) as face
        from characters_public cp where cp.id in (select a.character from ac a)) f), '[]'::jsonb),
    'openings', coalesce((select jsonb_agg(to_jsonb(a) order by a.thread::text collate "C") from acts_public a where a.thread in (select t.id from th t) and a.seq = 1), '[]'::jsonb),
    'reading', coalesce((select jsonb_agg(to_jsonb(r) order by r.thread::text collate "C") from (
      select g.thread, g.furthest_seq from reading g where g.thread in (select t.id from th t)) r), '[]'::jsonb)
  );
end;

revoke all on function alerts_page(timestamptz) from public, anon, authenticated;
grant execute on function alerts_page(timestamptz) to authenticated;
