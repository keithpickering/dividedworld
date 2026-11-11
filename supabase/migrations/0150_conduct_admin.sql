-- The admin screen's reads (the conduct plan, Task 7; the conduct design, "The admin screen"). Two functions, each an admin's alone (`only_admins`, so a
-- player or a visitor is refused and a refusal says nothing about any report):
--
--   admin_reports()     {reports, reviews}. `reports` are the open reports (no decision names them), newest first, each with the version's words (as
--                       admin_version reads them), the post and thread it belongs to, the section and the note, the author's account (null for a staff
--                       character's post, which has none) and that account's last 20 decisions. The reporter is not in it: the design asks the screen for
--                       the report, the author's account and its past outcomes, and nobody has a reason to be shown who reported. `reviews` are the
--                       versions on the re-review list (`reviews_due`), oldest first, with the edit's words. Open reports are bounded by the open-report
--                       limit of each account, so the list is not capped; a cap would hide the oldest, which are the ones waiting longest.
--   admin_failed_mail() {failed, waiting, addressSet}. `failed` are the outbox rows whose latest attempt failed (it will be tried again) or was refused
--                       (it never will be), newest first, at most 200 (the outbox grows with admins' decisions only). `addressSet` says whether the
--                       instance's admin reply-to address (Settings.conduct.adminAddress) is set; while it is not, mail waits, so `waiting` counts the rows
--                       with no attempt, which is the screen's plain "Mail is waiting" and the way out of that state. With an address set `waiting` is 0.
--
-- Both read the tables as their owner (the tables are no client's) and both are stable.

create function admin_reports() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform only_admins('reads the reports');
  return jsonb_build_object(
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'versionAct', r.version_act,
        'post', case when v.kind = 'edit' then v.target_act_id else v.id end,
        'thread', v.thread,
        'section', r.section,
        'note', r.note,
        'at', r.at,
        'author', who.account,
        'words', v.payload ->> 'body',
        'past', coalesce((
          select jsonb_agg(jsonb_build_object('outcome', p.outcome, 'until', p.until, 'at', p.at, 'note', p.note) order by p.at desc, p.id desc)
          from (
            select d.id, d.outcome, d.until, d.at, d.note
            from conduct_decisions d
            where who.account is not null and (d.account = who.account or conduct_author(coalesce(d.post, d.version_act)) = who.account)
            order by d.at desc, d.id desc
            limit 20
          ) p), '[]'::jsonb)
      ) order by r.at desc, r.id desc)
      from conduct_reports r
      join acts v on v.id = r.version_act
      cross join lateral (select conduct_author(r.version_act) as account) who
      where not exists (select 1 from conduct_decisions d where d.report = r.id)), '[]'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'decision', u.decision,
        'post', u.post,
        'versionAct', u.version_act,
        'thread', u.thread,
        'editedAt', u.edited_at,
        'author', conduct_author(u.version_act),
        'words', (select e.payload ->> 'body' from acts e where e.id = u.version_act)
      ) order by u.edited_at, u.decision)
      from reviews_due u), '[]'::jsonb));
end $$;

create function admin_failed_mail() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  address jsonb;
  unset boolean;
begin
  perform only_admins('reads the mail that failed');
  address := setting('conduct') -> 'adminAddress';
  unset := address is null or jsonb_typeof(address) = 'null';
  return jsonb_build_object(
    'failed', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'template', f.template, 'account', f.account, 'kind', f.kind, 'error', coalesce(f.error, ''), 'at', f.at) order by f.at desc, f.id desc)
      from (
        select o.id, o.template, o.account, l.kind, l.error, l.at
        from mail_outbox o
        cross join lateral (select a.kind, a.error, a.at from mail_attempts a where a.outbox = o.id order by a.at desc limit 1) l
        where l.kind in ('failed', 'refused')
        order by l.at desc, o.id desc
        limit 200
      ) f), '[]'::jsonb),
    'waiting', case when unset then (select count(*) from mail_outbox o where not exists (select 1 from mail_attempts a where a.outbox = o.id)) else 0 end,
    'addressSet', not unset);
end $$;

revoke execute on function admin_reports(), admin_failed_mail() from public, anon;
grant execute on function admin_reports(), admin_failed_mail() to authenticated;
