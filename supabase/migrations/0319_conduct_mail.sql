-- Moderation mail (the conduct plan, Task 3 and Task 5): an outbox that decisions write into, the attempts to send each row, the two functions the
-- mail Edge Function calls (mail_due, record_mail_attempt), the job that calls it every minute, decide_report and decide enqueuing their mail, and
-- open_account recording that the new account accepted the code it was shown.
--
-- Mail is done when a `sent` or a `refused` attempt exists; a `failed` one is tried again after a backoff. Both tables are append-only as 0043's staff_changes is, and no client reaches them. A facts object
-- holds exactly the slots its template names (engine/mail/conduct.ts is strict both ways), as text; `post`, `thread` and `conduct` are paths on
-- the site, which the composition root (supabase/functions/_shared/mail/conduct.ts) turns into addresses, and `section` is the section's key, which
-- it turns into the section's title from the instance's code of conduct.

create table mail_outbox (
  id bigint generated always as identity primary key,
  account uuid not null references accounts (id),
  template text not null check (template in ('reportRead', 'nudge', 'hidden', 'hiddenUntilEdited', 'suspended', 'banned', 'lifted')),
  facts jsonb not null default '{}' check (jsonb_typeof(facts) = 'object'),
  decision bigint references conduct_decisions (id),
  at timestamptz not null default now()
);
create table mail_attempts (
  outbox bigint not null references mail_outbox (id),
  at timestamptz not null default now(),
  -- sent: the provider took it. refused: the provider (or the missing address) said no about this mail, so it is never tried again. failed: a transport or Auth
  -- failure that may pass, tried again after 2^n minutes for n failures, at most a day.
  kind text not null check (kind in ('sent', 'refused', 'failed')),
  provider_id text,
  error text check (char_length(error) <= 1000)
);
-- The one lookup mail_due makes of the attempts: a row's attempts by kind.
create index mail_attempts_outbox on mail_attempts (outbox, kind, at);
alter table mail_outbox enable row level security;
alter table mail_attempts enable row level security;
revoke all on mail_outbox, mail_attempts from public, anon, authenticated;

create function mail_outbox_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a mail is never edited or removed (%); write a new one', tg_op using errcode = 'P0001';
end $$;
create function mail_attempts_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a mail attempt is never edited or removed (%); write a new one', tg_op using errcode = 'P0001';
end $$;
create trigger mail_outbox_no_update before update or delete on mail_outbox for each row execute function mail_outbox_append_only();
create trigger mail_outbox_no_truncate before truncate on mail_outbox for each statement execute function mail_outbox_append_only();
create trigger mail_attempts_no_update before update or delete on mail_attempts for each row execute function mail_attempts_append_only();
create trigger mail_attempts_no_truncate before truncate on mail_attempts for each statement execute function mail_attempts_append_only();
-- Always: a session in replica mode, as a restore with triggers disabled runs, fires them too.
alter table mail_outbox enable always trigger mail_outbox_no_update;
alter table mail_outbox enable always trigger mail_outbox_no_truncate;
alter table mail_attempts enable always trigger mail_attempts_no_update;
alter table mail_attempts enable always trigger mail_attempts_no_truncate;
revoke execute on function mail_outbox_append_only(), mail_attempts_append_only() from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------ enqueuing ----

-- The author's mail for one decision, or nothing: the outcomes that tell the author something (nudge, hide, hideUntilEdited, suspend, ban, lift),
-- to the account the decision names or else the version's author. A staff character has no account, so a staff author is sent nothing.
create function mail_for_decision(decision bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d conduct_decisions;
  tmpl text;
  who uuid;
  sect text := '';
  pst uuid;
  thr uuid;
  seq_of integer;
  per integer := coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'postsPerPage'), 20);
  facts jsonb;
begin
  select * into d from conduct_decisions x where x.id = mail_for_decision.decision;
  tmpl := case d.outcome when 'nudge' then 'nudge' when 'hide' then 'hidden' when 'hideUntilEdited' then 'hiddenUntilEdited'
                         when 'suspend' then 'suspended' when 'ban' then 'banned' when 'lift' then 'lifted' end;
  if tmpl is null then return; end if;
  who := coalesce(d.account, case when d.version_act is not null then conduct_author(d.version_act) end);
  if who is null then return; end if;
  if d.report is not null then select r.section into sect from conduct_reports r where r.id = d.report; end if;
  if d.version_act is not null then
    select p.id, p.thread, p.seq into pst, thr, seq_of from acts v join acts p on p.id = case when v.kind = 'edit' then v.target_act_id else v.id end where v.id = d.version_act;
  end if;
  facts := jsonb_build_object(
    'post', case when pst is null then '' else '/t/' || thr || '?page=' || greatest(1, ceil(seq_of::numeric / per)::integer) || '#post-' || seq_of end,
    'thread', case when thr is null then '' else '/t/' || thr end,
    'section', sect,
    'note', d.note,
    'until', case when d.until is null then '' else to_char(d.until at time zone 'UTC', 'FMMonth FMDD, YYYY "at" HH24:MI "UTC"') end,
    'conduct', '/conduct',
    'words', coalesce((select a.payload ->> 'body' from acts a where a.id = d.version_act), ''));
  -- Exactly the slots the template names, as engine/mail/conduct.ts holds them.
  facts := facts - case tmpl
    when 'nudge' then array['until', 'words']
    when 'hidden' then array['until']
    when 'hiddenUntilEdited' then array['until']
    when 'suspended' then array['words']
    when 'banned' then array['until', 'words']
    else array['post', 'thread', 'section', 'note', 'until', 'words'] end;
  insert into mail_outbox (account, template, facts, decision) values (who, tmpl, facts, d.id);
end $$;

-- decide_report and decide (0318), enqueuing the mail: the same text, with the mail added. A later migration that re-creates either takes its text from here.
create or replace function decide_report(report bigint, outcomes jsonb) returns bigint[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid;
  r conduct_reports;
  author uuid;
  o jsonb;
  names text[] := '{}';
  name text;
  made bigint[] := '{}';
begin
  perform only_admins('decides a report');
  caller := signed_in_account();
  select * into r from conduct_reports x where x.id = decide_report.report for no key update;
  if r.id is null then raise exception 'there is no such report' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if exists (select 1 from conduct_decisions d where d.report = r.id) then
    raise exception 'that report is already decided; use decide to act further' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if jsonb_typeof(outcomes) is distinct from 'array' or jsonb_array_length(outcomes) = 0 or jsonb_array_length(outcomes) > 6 then
    raise exception 'outcomes is a list of one to six outcomes' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  for o in select e from jsonb_array_elements(outcomes) e loop
    if jsonb_typeof(o) is distinct from 'object' or jsonb_typeof(o -> 'outcome') is distinct from 'string'
       or (o ->> 'outcome') not in ('none', 'nudge', 'hide', 'hideUntilEdited', 'suspend', 'ban', 'close') then
      raise exception 'each outcome is an object whose outcome is none, nudge, hide, hideUntilEdited, suspend, ban or close' using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    if (o ->> 'outcome') = any (names) then
      raise exception 'an outcome is given once' using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    names := names || (o ->> 'outcome');
  end loop;
  if (names && array['none', 'close'] and cardinality(names) > 1)
     or (names @> array['hide', 'hideUntilEdited']) or (names @> array['suspend', 'ban']) then
    raise exception 'those outcomes contradict each other' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  author := conduct_author(r.version_act);
  if author is null and names && array['nudge', 'suspend', 'ban'] then
    raise exception 'that version has no player account to write to' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  for o in select e from jsonb_array_elements(outcomes) e loop
    name := o ->> 'outcome';
    made := made || conduct_write(
      r.id,
      r.version_act,
      case when name in ('nudge', 'suspend', 'ban') then author end,
      name,
      (o ->> 'until')::timestamptz,
      o ->> 'note');
  end loop;
  -- The mail (0319): the author's, for each decision that has one, and the reporter's reportRead, the same words whatever was decided.
  foreach name in array made::text[] loop perform mail_for_decision(name::bigint); end loop;
  insert into mail_outbox (account, template, facts, decision) values (r.reporter, 'reportRead', '{}', made[1]);
  return made;
end $$;

create or replace function decide(account uuid, version_act uuid, outcome text, until timestamptz default null, note text default '') returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  who uuid := decide.account;
  made bigint;
begin
  perform only_admins('decides');
  perform signed_in_account();
  if outcome is null or outcome not in ('none', 'nudge', 'hide', 'hideUntilEdited', 'suspend', 'ban', 'unhide', 'lift', 'approve', 'close') then
    raise exception 'that is not an outcome' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if decide.account is null and decide.version_act is null then
    raise exception 'name an account or a version' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if outcome in ('suspend', 'ban', 'lift', 'nudge') and who is null then who := conduct_author(decide.version_act); end if;
  if outcome in ('suspend', 'ban', 'lift', 'nudge') and who is null then
    raise exception 'that version has no player account' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if outcome in ('hide', 'hideUntilEdited', 'unhide', 'approve') and decide.version_act is null then
    raise exception '% names a version' , outcome using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  made := conduct_write(null, decide.version_act, case when outcome in ('suspend', 'ban', 'lift', 'nudge') then who else decide.account end, outcome, decide.until, decide.note);
  perform mail_for_decision(made);
  return made;
end $$;
-- ------------------------------------------------------------------------------------ the mail job ----

-- The outbox rows still to send, oldest first: those with no sent or refused attempt, and whose failed attempts (n of them) are not still backing off (due again
-- 2^n minutes after the last, at most a day; n is capped at 11 so the power cannot overflow). Each bar-carrying row (suspended, banned, lifted) carries the account's
-- bar now, never its own decision's: a lift, or a suspension that has ended, reads as {outcome: 'lift'}, so an old failed row applied late clears the login instead
-- of barring it again, and the Auth ban follows the SQL bar. Its cost grows with the whole outbox, sent rows included:
-- the attempt lookups and the anti-join run over every row before the limit, and account_bar is one indexed probe per bar row the anti-join
-- leaves. That is modest because only an admin's decision writes a row (the outbox grows with decisions, never with posts or players), and
-- an open-rows marker would cost a second table for no gain at that scale.
create function mail_due(most integer) returns table (id bigint, account uuid, template text, facts jsonb, bar jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  select o.id, o.account, o.template, o.facts,
         case when o.template in ('suspended', 'banned', 'lifted') then
           case when b.bar is null then jsonb_build_object('outcome', 'lift', 'until', null)
                when b.bar ->> 'kind' = 'banned' then jsonb_build_object('outcome', 'ban', 'until', null)
                else jsonb_build_object('outcome', 'suspend', 'until', b.bar -> 'until') end
         end
  from mail_outbox o
  cross join lateral (select count(*) as n, max(a.at) as last from mail_attempts a where a.outbox = o.id and a.kind = 'failed') f
  cross join lateral (select case when o.template in ('suspended', 'banned', 'lifted') then account_bar(o.account) end as bar) b
  where not exists (select 1 from mail_attempts a where a.outbox = o.id and a.kind in ('sent', 'refused'))
    and (f.n = 0 or f.last + least(interval '1 day', interval '1 minute' * power(2, least(f.n, 11))) <= now())
  order by o.id
  limit greatest(mail_due.most, 0)
$$;

create function record_mail_attempt(outbox bigint, kind text, provider_id text, error text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into mail_attempts (outbox, kind, provider_id, error) values (record_mail_attempt.outbox, record_mail_attempt.kind, record_mail_attempt.provider_id, left(record_mail_attempt.error, 1000));
end $$;

revoke execute on function mail_for_decision(bigint), mail_due(integer), record_mail_attempt(bigint, text, text, text) from public, anon, authenticated;
grant execute on function mail_due(integer), record_mail_attempt(bigint, text, text, text) to service_role;

-- As schedule_settlement (0071) does: the jobs key from the vault, and nothing sent until the secrets are made.
create function schedule_mail() returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return cron.schedule('kayfabb-mail', '* * * * *', $job$
    select net.http_post(
      url := s.base || '/functions/v1/mail',
      headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', s.secret),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    )
    from (
      select (select decrypted_secret from vault.decrypted_secrets where name = 'kayfabb_functions_url') as base,
             (select decrypted_secret from vault.decrypted_secrets where name = 'kayfabb_jobs_key') as secret
    ) s
    where s.base is not null and s.secret is not null
  $job$);
end $$;
revoke execute on function schedule_mail() from public, anon, authenticated;
select schedule_mail();

-- -------------------------------------------------------------------------------- registration (Task 5) ----

-- open_account (0020), recording the acceptance of the code the sign-up page showed: the register form's checkbox is the acceptance, and the version it
-- carries (`conduct_version`) is written in the same transaction as the account, only when it is the current conductVersion. The other way into an
-- account (a signed-in login with no account, which shows no code) passes none, so records nothing, and the Accept gate asks the player instead. A
-- stale version, or an instance with no code (no conductVersion), records nothing either. The one-argument form is replaced, so a call with a code
-- alone is this function with the default.
drop function open_account(text);
create function open_account(code text, conduct_version integer default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := auth.uid();
  mode text := setting('registrationMode') #>> '{}';
  spent bigint;
begin
  if caller is null or not exists (select 1 from auth.users where id = caller) then
    raise exception 'sign in first' using hint = 'kayfabb.refusal', errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtext('kayfabb.open_account'), hashtext(caller::text));
  if exists (select 1 from accounts where id = caller) then return jsonb_build_object('account', caller, 'opened', false); end if;
  if mode = 'closed' then raise exception 'registration is closed' using hint = 'kayfabb.refusal', errcode = 'P0001'; end if;
  if mode = 'invite' then
    select id into spent from invites where code_hash = invite_hash(coalesce(code, '')) and used_by is null and expires_at > now() for update;
    if spent is null then raise exception 'that invite opens nothing' using hint = 'kayfabb.refusal', errcode = 'P0001'; end if;
  end if;
  insert into accounts (id) values (caller);
  if spent is not null then update invites set used_by = caller, used_at = now() where id = spent; end if;
  insert into conduct_acceptances (account, version)
  select caller, open_account.conduct_version from settings s
  where s.key = 'conductVersion' and open_account.conduct_version is not null and (s.value #>> '{}')::integer = open_account.conduct_version
  on conflict do nothing;
  return jsonb_build_object('account', caller, 'opened', true);
end $$;
revoke execute on function open_account(text, integer) from public, anon, authenticated;
grant execute on function open_account(text, integer) to authenticated;
