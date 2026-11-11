-- The admin screen's reads (the conduct plan, Task 7; the conduct design, "The admin screen"). Two functions, each an admin's alone (`only_admins`, so a
-- player or a visitor is refused and a refusal says nothing about any report):
--
--   admin_reports()     {reports, moreReports, reviews, moreReviews}. `reports` are the open reports (no decision names them), newest first, each with the version's words (as
--                       admin_version reads them), the post and thread it belongs to, the section and the note, the author's account (null for a staff
--                       character's post, which has none) and that account's last 20 decisions. The reporter is not in it: the design asks the screen for
--                       the report, the author's account and its past outcomes, and nobody has a reason to be shown who reported. `reviews` are the
--                       versions on the re-review list (`reviews_due`), oldest first, with the edit's words. Neither list is unbounded: an account's open
--                       reports are limited, but accounts times that limit is not a bound, so each is a page of at most 50 with a `more` flag the screen says plainly
--                       (reports newest first; reviews oldest first, the ones waiting longest). A list drains as admins decide, so what is left behind surfaces.
--   admin_failed_mail() {failed, moreFailed, waiting, addressSet}. `failed` are the outbox rows whose latest attempt failed (it will be tried again) or was refused
--                       (it never will be), newest first, at most 200 and a flag for more (read through a partial index, below). `addressSet` says whether the
--                       instance's admin reply-to address (Settings.conduct.adminAddress) is set; while it is not, mail waits, so `waiting` counts the rows
--                       with no attempt, which is the screen's plain "Mail is waiting" and the way out of that state. With an address set `waiting` is 0.
--
-- Both read the tables as their owner (the tables are no client's) and both are stable.
--
-- Two reads are a player's own, for the report form and the hidden note (Task 6): my_hidden_version(act) is the author's own words of a version hidden until edited
-- (null for anyone else), and my_open_reports() is the caller's own count of reports waiting for an admin.

create function admin_reports() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  most constant integer := 50;
  reps jsonb;
  revs jsonb;
  failed jsonb;
  waiting bigint;
begin
  perform only_admins('reads the reports');
  -- Open reports, newest first: a walk back down the primary key that stops at `most` + 1 open ones (a decided report is skipped by one lookup of conduct_decisions_report).
  -- The extra row is only to say whether more wait.
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'versionAct', r.version_act,
      'post', case when v.kind = 'edit' then v.target_act_id else v.id end,
      'thread', v.thread,
      'section', r.section,
      'note', r.note,
      'at', r.at,
      'author', who.account,
      'words', v.payload ->> 'body',
      -- The author's last 20 decisions, by conduct_decisions_author (author_account, id desc): one index range, never a scan of every decision.
      'past', coalesce((
        select jsonb_agg(jsonb_build_object('outcome', p.outcome, 'until', p.until, 'at', p.at, 'note', p.note) order by p.id desc)
        from (select d.id, d.outcome, d.until, d.at, d.note from conduct_decisions d where d.author_account = who.account order by d.id desc limit 20) p), '[]'::jsonb)
    ) order by r.id desc), '[]'::jsonb)
  into reps
  from (
    select x.* from conduct_reports x
    where not exists (select 1 from conduct_decisions d where d.report = x.id)
    order by x.id desc limit most + 1
  ) r
  join acts v on v.id = r.version_act
  cross join lateral (select conduct_author(r.version_act) as account) who;
  -- Versions awaiting a second look, oldest first (the ones waiting longest), at most `most` and a flag for more.
  select coalesce(jsonb_agg(jsonb_build_object(
      'decision', u.decision,
      'post', u.post,
      'versionAct', u.version_act,
      'thread', u.thread,
      'editedAt', u.edited_at,
      'author', conduct_author(u.version_act),
      'words', (select e.payload ->> 'body' from acts e where e.id = u.version_act)
    ) order by u.edited_at, u.decision), '[]'::jsonb)
  into revs
  from (select z.* from reviews_due z order by z.edited_at, z.decision limit most + 1) u;
  return jsonb_build_object(
    'reports', (select coalesce(jsonb_agg(e order by ord), '[]'::jsonb) from jsonb_array_elements(reps) with ordinality t(e, ord) where ord <= most),
    'moreReports', jsonb_array_length(reps) > most,
    'reviews', (select coalesce(jsonb_agg(e order by ord), '[]'::jsonb) from jsonb_array_elements(revs) with ordinality t(e, ord) where ord <= most),
    'moreReviews', jsonb_array_length(revs) > most);
end $$;

-- Mail whose latest attempt failed or was refused: a walk down mail_attempts_failed (the failed and refused attempts, newest first), keeping an attempt only when no later
-- attempt of its mail exists (one lookup of mail_attempts_outbox), so the work is the failures and not the whole outbox, and it stops at 201 rows (200 and a flag for more).
create index mail_attempts_failed on mail_attempts (at desc) where kind in ('failed', 'refused');

create function admin_failed_mail() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  address jsonb;
  unset boolean;
  rows_ jsonb;
begin
  perform only_admins('reads the mail that failed');
  address := setting('conduct') -> 'adminAddress';
  unset := address is null or jsonb_typeof(address) = 'null';
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'template', f.template, 'account', f.account, 'kind', f.kind, 'error', coalesce(f.error, ''), 'at', f.at) order by f.at desc, f.id desc), '[]'::jsonb)
  into rows_
  from (
    select o.id, o.template, o.account, l.kind, l.error, l.at
    from mail_attempts l
    join mail_outbox o on o.id = l.outbox
    where l.kind in ('failed', 'refused')
      and not exists (select 1 from mail_attempts n where n.outbox = l.outbox and n.at > l.at)
    order by l.at desc, o.id desc
    limit 201
  ) f;
  return jsonb_build_object(
    'failed', (select coalesce(jsonb_agg(e order by ord), '[]'::jsonb) from jsonb_array_elements(rows_) with ordinality t(e, ord) where ord <= 200),
    'moreFailed', jsonb_array_length(rows_) > 200,
    'waiting', case when unset then (select count(*) from mail_outbox o where not exists (select 1 from mail_attempts a where a.outbox = o.id)) else 0 end,
    'addressSet', not unset);
end $$;

-- ---------------------------------------------------------------------- the author's own reads ----

-- The author's own words of a version that is hidden until its author edits it (the hidden note's "Only you see this" panel), and where the post stands for them.
-- It is admin_version's author-only sibling: it answers only a caller who plays the post's character (a character is its account's alone), and only about the post's
-- current version while that is hidden; everyone else, a post that is not hidden, and a version an admin hid outright, get null, so the answer proves nothing about
-- who owns a mask to anyone who is not that mask's player. Called for a post (or for one of its versions) it says:
--   {"status": "hiddenUntilEdited", "version": <act>, "words": <the version's words>}   the author's edit is what ends it (the first time it shows again at once; the second time an
--                                                                                       admin looks at the edit first)
--   {"status": "waiting", "version": <act>, "words": <the edit's words>}               the author's edit follows a second hide until edited and is hidden until an admin
--                                                                                       approves it; the words are the author's own, so Edit can start from them
-- A player's words are never destroyed: the author reads their own, and this is the only door they have to them while an admin has them hidden.
create function my_hidden_version(act uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  p acts;
  cur acts;
  d conduct_decisions;
begin
  select * into p from acts a where a.id = my_hidden_version.act;
  if found and p.kind = 'edit' then
    select * into p from acts a where a.id = p.target_act_id;
  end if;
  if not found or p.kind <> 'post' or auth.uid() is null
     or not exists (select 1 from characters c where c.id = p.character and c.owner = auth.uid()) then
    return null;
  end if;
  select * into cur from acts e where e.kind = 'edit' and e.target_act_id = p.id order by e.created_at desc, e.id desc limit 1;
  if not found then cur := p; end if;
  if not version_hidden(cur.id, p.id) then return null; end if;
  select * into d from conduct_decisions x
  where x.post = p.id and x.version_act = cur.id and x.outcome in ('hide', 'hideUntilEdited', 'unhide', 'approve')
  order by x.id desc limit 1;
  if found then
    if d.outcome <> 'hideUntilEdited' then return null; end if;
    return jsonb_build_object('status', 'hiddenUntilEdited', 'version', cur.id, 'words', cur.payload ->> 'body');
  end if;
  return jsonb_build_object('status', 'waiting', 'version', cur.id, 'words', cur.payload ->> 'body');
end $$;

-- {open, most}: how many reports to admins the caller's account holds open now, and the most it may (`report_post` refuses at `most`), so the report form can say the limit before it is asked to send. Only the caller's own account is counted, so it is the limit state's
-- "You have {n} reports waiting" and nothing about anyone else.
create function my_open_reports() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'open', (select count(*) from conduct_reports r where r.reporter = auth.uid() and not exists (select 1 from conduct_decisions d where d.report = r.id)),
    'most', (setting('conduct') ->> 'openReportsMost')::integer)
$$;

revoke execute on function admin_reports(), admin_failed_mail() from public, anon;
grant execute on function admin_reports(), admin_failed_mail() to authenticated;
revoke execute on function my_hidden_version(uuid), my_open_reports() from public, anon;
grant execute on function my_hidden_version(uuid), my_open_reports() to authenticated;
