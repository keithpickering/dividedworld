-- The code of conduct, reports to admins and what an admin decides (docs/plans/2026-11-02-conduct-design.md, sections 2-5 and 8;
-- docs/plans/2026-11-02-conduct-plan.md, Task 2).
--
-- Real moderation, out of character and plain: every decision is an admin's, never The System's. Three append-only tables (a player's
-- acceptance of the code, a report to admins, an admin's decision), reached only through the functions below, and what the decisions
-- compute: a hidden version (its words served to nobody but admins, in acts_public or in a quote of it), a suspension or ban (the
-- writers refuse the account, with a plain hint the gate reads) and the re-review list.
--
-- Where this stops: the mail a decision sends is Task 3's (decide_report gains its enqueue there), and no screen is here.
--
-- The masks ("A response never proves a private fact"): report_post accepts or refuses only on the filer's own account and on the
-- version itself, never on who owns the reported character, and reads no character at all; nothing here answers a player from another
-- account's sanction. A suspension changes no relation that shows a character (Task 4 tests it); only the writers refuse, and only the
-- account that is barred is told.
--
-- Ways out ("No player is ever stuck"): an open report ends with an admin's decision; a hidden version with an unhide; hidden until
-- edited ends as a hidden post, the first time, at the author's next edit (its new version shows; the offending one stays hidden until an unhide) and, the
-- second time, at an approve; a suspension at its date or a lift; a ban at a lift; three open reports at an admin's decision on one of them.

-- ------------------------------------------------------------------------------- the three tables ----

-- That an account has accepted a version of the code of conduct. The setting conductVersion (seeded from the instance's code) is the one
-- an account must have accepted; a new version asks everyone again at their next sign-in (Task 4).
create table conduct_acceptances (
  account uuid not null references accounts (id),
  version integer not null check (version >= 1),
  at timestamptz not null default now(),
  primary key (account, version)
);

-- A report to admins: the filer's account (never a character), one version, the section of the code broken and an optional note.
-- Open until a decision names it. Two reports on one version are both kept: the second is evidence, never refused.
create table conduct_reports (
  id bigint generated always as identity primary key,
  reporter uuid not null references accounts (id),
  version_act uuid not null references acts (id),
  section text not null check (section <> ''),
  note text check (note is null or char_length(note) <= 1000),
  at timestamptz not null default now()
);
-- The reporter's open reports: the count report_post limits, and the reporter's own history.
create index conduct_reports_reporter on conduct_reports (reporter, id);
create index conduct_reports_version on conduct_reports (version_act);

-- What an admin decides. A report decided is a report named by a decision; a decision with no report is an admin acting alone (a lift, an
-- unhide, an approval, acting against a reporter). `post` is the post the version belongs to (the version itself for a post, the edit's
-- post for an edit), written by the trigger below so no writer can get it wrong: every hidden check reads it through one index.
create table conduct_decisions (
  id bigint generated always as identity primary key,
  report bigint references conduct_reports (id),
  version_act uuid references acts (id),
  post uuid references acts (id),
  account uuid references accounts (id),
  -- The account a decision is about: the account behind the version it names (none for a staff character's), else the account it names. Written by the trigger below,
  -- so the admin screen reads one account's decisions through one index and never scans them all.
  author_account uuid references accounts (id),
  admin uuid not null references accounts (id),
  outcome text not null check (outcome in ('none', 'nudge', 'hide', 'hideUntilEdited', 'suspend', 'ban', 'unhide', 'lift', 'approve', 'close')),
  until timestamptz,
  note text not null default '' check (char_length(note) <= 2000),
  at timestamptz not null default now(),
  -- A decision about a version names it; one about an account names it; a nudge goes to someone.
  check (outcome not in ('hide', 'hideUntilEdited', 'unhide', 'approve') or version_act is not null),
  check (outcome not in ('suspend', 'ban', 'lift', 'nudge') or account is not null),
  -- Only a suspension has an end date; a ban has none.
  check ((outcome = 'suspend') = (until is not null)),
  check (report is not null or version_act is not null or account is not null)
);
create index conduct_decisions_report on conduct_decisions (report) where report is not null;
create index conduct_decisions_author on conduct_decisions (author_account, id desc) where author_account is not null;
-- Every version decision of a post, newest first: the hidden check's one lookup (the partial index is empty for a post nobody ever decided on).
create index conduct_decisions_post on conduct_decisions (post, id desc) where outcome in ('hide', 'hideUntilEdited', 'unhide', 'approve');
-- An account's bar: its suspensions, bans and lifts, newest first, the one lookup behind every writer's refusal.
create index conduct_decisions_bar on conduct_decisions (account, id desc) where outcome in ('suspend', 'ban', 'lift');

alter table conduct_acceptances enable row level security;
alter table conduct_reports enable row level security;
alter table conduct_decisions enable row level security;
revoke all on conduct_acceptances, conduct_reports, conduct_decisions from public, anon, authenticated;

-- Append-only, as 0043's staff_changes is: no client reaches these tables, and nothing, the owner included, edits or removes a row.
create function conduct_acceptances_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'an acceptance is never edited or removed (%); write a new one', tg_op using errcode = 'P0001';
end $$;
create function conduct_reports_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a report is never edited or removed (%); a decision closes it', tg_op using errcode = 'P0001';
end $$;
create function conduct_decisions_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a decision is never edited or removed (%); write a new one that reverses it', tg_op using errcode = 'P0001';
end $$;
create trigger conduct_acceptances_no_update before update or delete on conduct_acceptances for each row execute function conduct_acceptances_append_only();
create trigger conduct_acceptances_no_truncate before truncate on conduct_acceptances for each statement execute function conduct_acceptances_append_only();
create trigger conduct_reports_no_update before update or delete on conduct_reports for each row execute function conduct_reports_append_only();
create trigger conduct_reports_no_truncate before truncate on conduct_reports for each statement execute function conduct_reports_append_only();
create trigger conduct_decisions_no_update before update or delete on conduct_decisions for each row execute function conduct_decisions_append_only();
create trigger conduct_decisions_no_truncate before truncate on conduct_decisions for each statement execute function conduct_decisions_append_only();
-- Always: a session in replica mode, as a restore with triggers disabled runs, fires them too.
alter table conduct_acceptances enable always trigger conduct_acceptances_no_update;
alter table conduct_acceptances enable always trigger conduct_acceptances_no_truncate;
alter table conduct_reports enable always trigger conduct_reports_no_update;
alter table conduct_reports enable always trigger conduct_reports_no_truncate;
alter table conduct_decisions enable always trigger conduct_decisions_no_update;
alter table conduct_decisions enable always trigger conduct_decisions_no_truncate;

-- What a report may name: a post or an edit (a version), and nothing else. Held on the table so a writer that forgets cannot file another kind.
create function conduct_reports_well_formed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from acts a where a.id = new.version_act and a.kind in ('post', 'edit')) then
    raise exception 'a report names a post or an edit' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  return new;
end $$;
create trigger conduct_reports_well_formed before insert on conduct_reports for each row execute function conduct_reports_well_formed();

-- What a decision may be, held on the table: only an admin decides (a row whose admin is not in `admins` is refused whoever inserts it,
-- so no function that forgets only_admins can write one), a version is a post or an edit, and a decision on a report names that report's version.
create function conduct_decisions_well_formed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  k text;
  p uuid;
  reported uuid;
begin
  if not exists (select 1 from admins a where a.account = new.admin) then
    raise exception 'only an admin decides' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.version_act is not null then
    select a.kind, case when a.kind = 'edit' then a.target_act_id else a.id end into k, p from acts a where a.id = new.version_act;
    if k is null or k not in ('post', 'edit') then
      raise exception 'a decision about a version names a post or an edit' using hint = 'kayfabb.refusal', errcode = '23514';
    end if;
    new.post := p;
    select c.owner into new.author_account from acts a join characters c on c.id = a.character where a.id = new.version_act;
  end if;
  new.author_account := coalesce(new.author_account, new.account);
  if new.report is not null then
    select r.version_act into reported from conduct_reports r where r.id = new.report;
    if new.version_act is not null and new.version_act is distinct from reported then
      raise exception 'a decision on a report names the version it reports' using hint = 'kayfabb.refusal', errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger conduct_decisions_well_formed before insert on conduct_decisions for each row execute function conduct_decisions_well_formed();

revoke execute on function conduct_acceptances_append_only(), conduct_reports_append_only(), conduct_decisions_append_only(),
  conduct_reports_well_formed(), conduct_decisions_well_formed() from public, anon, authenticated;

-- --------------------------------------------------------------------------------- the code accepted ----

-- The signed-in account accepts the instance's current code. Accepting twice is the same as once.
create function accept_conduct(version integer) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  current integer := (select (s.value #>> '{}')::integer from settings s where s.key = 'conductVersion');
begin
  if current is null or version is distinct from current then
    raise exception 'that is not the current code of conduct; reload to read it' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  insert into conduct_acceptances (account, version) values (caller, accept_conduct.version) on conflict do nothing;
end $$;

-- Whether the caller has accepted the current code. An instance with no code has nothing to accept. A bar does not refuse this: the gate
-- asks it before it asks anything else, and it says only what the caller's own account did.
create function conduct_accepted() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select not exists (select 1 from settings s where s.key = 'conductVersion')
      or exists (select 1 from conduct_acceptances c
                 where c.account = auth.uid() and c.version = (select (s.value #>> '{}')::integer from settings s where s.key = 'conductVersion'))
$$;

-- ------------------------------------------------------------------------------------- what is hidden ----

-- Whether version `w` (a post, or an edit of `pst`) is hidden now: its latest decision of its own is a hide or a hide until edited (a hide covers a version, and
-- only an `unhide` or an `approve` of that version brings its words back). What the author's edit ends is the post being hidden until edited: its new current version has
-- no decision of its own and shows, and the re-review list (reviews_due) holds it. The second time a post is hidden until edited, the edits written after it are hidden
-- too, until an `approve` on the post; and so are the edits written after a plain `hide` of any version of the post, until an `approve` on the post or an `unhide` of the
-- version that was hidden (an admin hid those words, and an edit that keeps them is not a way back). An approve frees the edits written after it, and the
-- approved version itself: an edit written before it, with no decision of its own, stays hidden, as every version that was hidden does unless unhidden. An unhide of
-- the version a plain hide covered frees every edit written after that hide, whenever the unhide is written: the admin undid the hide, so the post shows its latest version. For a post nobody ever decided on it is one index lookup, empty; for a decided post, one more on the post's decisions.
create function version_hidden(w uuid, pst uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  d conduct_decisions;
  made timestamptz;
begin
  if not exists (select 1 from conduct_decisions x where x.post = pst and x.outcome in ('hide', 'hideUntilEdited', 'unhide', 'approve')) then
    return false;
  end if;
  select * into d from conduct_decisions x
  where x.post = pst and x.version_act = w and x.outcome in ('hide', 'hideUntilEdited', 'unhide', 'approve')
  order by x.id desc limit 1;
  if found then
    return d.outcome in ('hide', 'hideUntilEdited');
  end if;
  if w = pst then return false; end if;
  select a.created_at into made from acts a where a.id = w and a.kind = 'edit';
  if made is null then return false; end if;
  return exists (
    select 1 from conduct_decisions x
    where x.post = pst and x.at < made and x.outcome in ('hide', 'hideUntilEdited')
      and (x.outcome = 'hide' or exists (select 1 from conduct_decisions y where y.post = pst and y.outcome = 'hideUntilEdited' and y.id < x.id))
      and not exists (select 1 from conduct_decisions z where z.post = pst and z.id > x.id
                      and ((z.outcome = 'approve' and z.at < made)
                           or (x.outcome = 'hide' and z.outcome = 'unhide' and z.version_act = x.version_act))));
end $$;

create function version_hidden(w uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select a.kind in ('post', 'edit') and version_hidden(a.id, case when a.kind = 'edit' then a.target_act_id else a.id end)
  from acts a where a.id = w
$$;

-- Whether a quote of Act `q` shows words that are hidden: any version of that post is hidden now. (A quote copies the words it quoted, so
-- it cannot say which version it copied.) For a post nobody decided on, one empty index lookup.
create function quote_hidden(q uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from conduct_decisions x where x.post = q and x.outcome in ('hide', 'hideUntilEdited', 'unhide', 'approve'))
     and (version_hidden(q, q) or exists (select 1 from acts e where e.kind = 'edit' and e.target_act_id = q and version_hidden(e.id, q)))
$$;

-- -------------------------------------------------------------------------- quotes of hidden posts, as a layer ----

-- A quote copies the words it quotes, so a version that is hidden is readable in every post that quotes it, unless those quotes are emptied. The database does not read BBCode
-- (a copy of the parser in SQL drifted from engine/bbcode/parse.ts four times in review, each a leak or a read a crafted post could make unbearably slow). The one parser does it, as a
-- job: engine/bbcode/conceal.ts's concealQuotes, run by the conceal Edge Function over the posts that quote a hidden version, and its result is stored here as a layer beside the
-- quoting version, append-only, never an edit of the post ("The System acts; it never destroys what a player wrote": the post's own words stay in `acts`). acts_public serves the layer
-- whose hidden set is the current one and does no parsing on a read.
--
-- Four tables, none reachable by a client:
--   quote_refs      every id a body names after `[quote=`: a superset of the real quotes (the id of a quote that is in a code block counts too), so no real quote is missed. Filled by a trigger
--                   on every Act written with such a body, backfilled below. It says who to ask about, never what to show.
--   conceal_requests  one row each time what is hidden may have changed for a quoting Act: a decision that hides, unhides or approves a version of a quoted post, the author's edit of a post
--                   that has such a decision, and the writing of an Act that quotes a post with a hidden version. Append-only.
--   quote_layers    the quoting version's body with the contents of its quotes of the hidden posts in `hidden` emptied (null when `hidden` is empty), the latest row of an Act winning, and
--                   `upto`, the last request of the Act the row answers. A request is done when a layer with `upto` at or after it exists, so nothing is ever marked in place.
--
-- Ways out ("No player is ever stuck"): a post whose quote of a hidden version has no layer yet is withheld behind a plain note that says it will show again in a moment; the job runs every
-- minute and writes the layer, which ends the note by itself. An unhide, an approval or a hide that ends needs no job at all: with nothing hidden among its refs a post serves its own words.
--
-- At a busy instance: a read costs one probe of quote_refs for a body that quotes nothing hidden, and for a body that does, one more of the layer's index; nothing reads a body's length. A decision
-- writes one request for each Act that quotes the post, an index range of quote_refs (quoted, act); the requests grow with admin decisions and the Acts quoting what they hide, never with posts read
-- or players. conceal_due anti-joins the requests to their layers as mail_due (0319) does the outbox to its attempts, and a request marker table or a cursor would be wrong here: ids committed out
-- of order would strand a request below a cursor.
create table quote_refs (
  act uuid not null references acts (id),
  quoted uuid not null,
  primary key (act, quoted)
);
create index quote_refs_quoted on quote_refs (quoted, act);

create table conceal_requests (
  id bigint generated always as identity primary key,
  act uuid not null references acts (id),
  at timestamptz not null default now()
);
create index conceal_requests_act on conceal_requests (act, id desc);

create table quote_layers (
  id bigint generated always as identity primary key,
  act uuid not null references acts (id),
  -- The ids of the quoted posts with a hidden version when the layer was made, sorted, each once.
  hidden uuid[] not null,
  body text,
  upto bigint not null default 0,
  at timestamptz not null default now(),
  check ((cardinality(hidden) = 0) = (body is null))
);
create index quote_layers_act on quote_layers (act, at desc, id desc);

alter table quote_refs enable row level security;
alter table conceal_requests enable row level security;
alter table quote_layers enable row level security;
revoke all on quote_refs, conceal_requests, quote_layers from public, anon, authenticated;

create function quote_refs_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a quote reference is never edited or removed (%); an Act''s words do not change', tg_op using errcode = 'P0001';
end $$;
create function conceal_requests_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a request to conceal is never edited or removed (%); write a new one', tg_op using errcode = 'P0001';
end $$;
create function quote_layers_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a quote layer is never edited or removed (%); write a new one over it', tg_op using errcode = 'P0001';
end $$;
create trigger quote_refs_no_update before update or delete on quote_refs for each row execute function quote_refs_append_only();
create trigger quote_refs_no_truncate before truncate on quote_refs for each statement execute function quote_refs_append_only();
create trigger conceal_requests_no_update before update or delete on conceal_requests for each row execute function conceal_requests_append_only();
create trigger conceal_requests_no_truncate before truncate on conceal_requests for each statement execute function conceal_requests_append_only();
create trigger quote_layers_no_update before update or delete on quote_layers for each row execute function quote_layers_append_only();
create trigger quote_layers_no_truncate before truncate on quote_layers for each statement execute function quote_layers_append_only();
-- Always: a session in replica mode, as a restore with triggers disabled runs, fires them too.
alter table quote_refs enable always trigger quote_refs_no_update;
alter table quote_refs enable always trigger quote_refs_no_truncate;
alter table conceal_requests enable always trigger conceal_requests_no_update;
alter table conceal_requests enable always trigger conceal_requests_no_truncate;
alter table quote_layers enable always trigger quote_layers_no_update;
alter table quote_layers enable always trigger quote_layers_no_truncate;
revoke execute on function quote_refs_append_only(), conceal_requests_append_only(), quote_layers_append_only() from public, anon, authenticated;

-- Every id a body names after `[quote=`, anywhere in the tag (a name may be quoted, padded or followed by `user=`; the parser's own reading of it is stricter than this and so is inside it).
-- One pass of one regular expression, linear in the body.
create function quote_ids(body text) returns setof uuid
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select distinct lower(m[1])::uuid
  from regexp_matches(body, '\[quote=[^\[\]]*?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'gi') m
$$;

-- Backfill: the Acts already written.
insert into quote_refs (act, quoted)
select a.id, q from acts a, lateral quote_ids(a.payload ->> 'body') q
where a.payload ->> 'body' ilike '%[quote=%'
on conflict do nothing;

-- The ids of the quoted posts, among those an Act's body names, that have a hidden version now: sorted, each once, empty when there are none (the Act serves its own words).
create function hidden_refs(v uuid) returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(r.quoted order by r.quoted), '{}'::uuid[]) from quote_refs r where r.act = v and quote_hidden(r.quoted)
$$;

-- Ask for a layer of every Act that quotes `post`.
create function conceal_request_quoters(post uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into conceal_requests (act) select r.act from quote_refs r where r.quoted = post
$$;

-- Writing an Act whose body quotes: record what it quotes, and ask for its layer at once if any of it is hidden now.
create function acts_quote_refs() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into quote_refs (act, quoted) select new.id, q from quote_ids(new.payload ->> 'body') q on conflict do nothing;
  if exists (select 1 from quote_refs r where r.act = new.id and quote_hidden(r.quoted)) then
    insert into conceal_requests (act) values (new.id);
  end if;
  return null;
end $$;
create trigger acts_quote_refs after insert on acts for each row
  when (new.payload ->> 'body' ilike '%[quote=%') execute function acts_quote_refs();

-- An admin's decision that hides, unhides or approves a version changes what is hidden for every Act that quotes the post.
create function conduct_decisions_conceal() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform conceal_request_quoters(new.post);
  return null;
end $$;
create trigger conduct_decisions_conceal after insert on conduct_decisions for each row
  when (new.outcome in ('hide', 'hideUntilEdited', 'unhide', 'approve') and new.post is not null) execute function conduct_decisions_conceal();

-- The author's edit of a post an admin decided on is where a hide until edited ends, which computes, with no decision of its own: ask again. (It is a probe of the decisions' own index for
-- any edit, and a request for a post nobody quotes writes nothing.)
create function acts_edit_conceal() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from conduct_decisions x where x.post = new.target_act_id and x.outcome in ('hide', 'hideUntilEdited', 'unhide', 'approve')) then
    perform conceal_request_quoters(new.target_act_id);
  end if;
  return null;
end $$;
create trigger acts_edit_conceal after insert on acts for each row when (new.kind = 'edit') execute function acts_edit_conceal();
revoke execute on function hidden_refs(uuid), conceal_request_quoters(uuid), acts_quote_refs(), conduct_decisions_conceal(), acts_edit_conceal() from public, anon, authenticated;

-- What an Act's quotes of hidden posts come to now: `refs` whether any quote of a hidden post is named, `ready` whether a layer made for exactly the hidden set of now exists, and its body.
-- For a body that names nothing hidden, one probe of quote_refs. No parsing, whatever the body.
create function conceal_layer(v uuid) returns table (refs boolean, ready boolean, body text)
language plpgsql stable security definer rows 1 set search_path = public, pg_temp as $$
declare
  hs uuid[] := hidden_refs(v);
  l quote_layers;
begin
  if cardinality(hs) = 0 then return query select false, true, null::text; return; end if;
  select * into l from quote_layers x where x.act = v order by x.at desc, x.id desc limit 1;
  if found and l.hidden = hs then return query select true, true, l.body; return; end if;
  return query select true, false, null::text;
end $$;

-- What a payload shows a player: a hidden version's body is null; a body that names a quote of a hidden post is the layer's, or null until the job has made it (`ready` false, and
-- acts_public says `concealing`); any other body is as written. A payload with no text body is left as it is. `v` is the Act the payload belongs to.
create function shown_payload(p jsonb, hidden boolean, refs boolean, ready boolean, layer text) returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select case
    when p is null or jsonb_typeof(p -> 'body') is distinct from 'string' then p
    when hidden then jsonb_set(p, '{body}', 'null'::jsonb)
    when not refs then p
    when ready then jsonb_set(p, '{body}', to_jsonb(layer))
    else jsonb_set(p, '{body}', 'null'::jsonb)
  end
$$;
create function public_payload(p jsonb, hidden boolean, v uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select case when hidden or p is null or jsonb_typeof(p -> 'body') is distinct from 'string' then shown_payload(p, hidden, false, true, null)
              else (select shown_payload(p, false, c.refs, c.ready, c.body) from conceal_layer(v) c) end
$$;

-- The work for the job: the Acts with an open request, oldest first, the hidden set each must be concealed against now, and the Act's own words, which the job's parser reads. The service
-- role alone calls it (the words are the quoting post's own, hidden quote included, and go to the job and nowhere else).
create function conceal_due(most integer) returns table (act uuid, hidden uuid[], body text)
language sql stable security definer set search_path = public, pg_temp as $$
  select d.act, hidden_refs(d.act), x.payload ->> 'body'
  from (select r.act, min(r.id) as first from conceal_requests r
        where not exists (select 1 from quote_layers l where l.act = r.act and l.upto >= r.id)
        group by r.act order by min(r.id) limit greatest(conceal_due.most, 0)) d
  join acts x on x.id = d.act
  order by d.first
$$;

-- The job's answer for an Act: the body with the contents of its quotes of the posts in `hidden` emptied (null when none). It is refused when `hidden` is not the set of now, so a job that
-- read the state before a decision cannot store, and then serve, a layer that shows what is hidden. Service role only.
create function record_layer(act uuid, hidden uuid[], body text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  mine uuid[] := coalesce((select array_agg(distinct x order by x) from unnest(record_layer.hidden) x), '{}'::uuid[]);
  seen bigint;
  id bigint;
begin
  -- The last request is read before the hidden set is, so a decision that lands in between leaves its request open.
  select coalesce(max(r.id), 0) into seen from conceal_requests r where r.act = record_layer.act;
  if mine is distinct from hidden_refs(record_layer.act) then
    raise exception 'the hidden set changed since it was read; read it again' using hint = 'kayfabb.conceal_stale', errcode = 'P0001';
  end if;
  insert into quote_layers (act, hidden, body, upto) values (record_layer.act, mine, case when cardinality(mine) = 0 then null else record_layer.body end, seen)
  returning quote_layers.id into id;
  return id;
end $$;
revoke execute on function quote_ids(text), conceal_layer(uuid), shown_payload(jsonb, boolean, boolean, boolean, text), public_payload(jsonb, boolean, uuid), conceal_due(integer), record_layer(uuid, uuid[], text)
  from public, anon, authenticated;
grant execute on function conceal_due(integer), record_layer(uuid, uuid[], text) to service_role;

-- Two reads of a post's words that feed a model or a card's condition, now reading what a player would read (0105's rule_breaks and 0144's spring_facts, each
-- otherwise as that migration left it): a hidden version has no words to judge, and the contents of a quote of a hidden post are emptied. rule_breaks finds
-- nothing wrong with a post that is hidden, the words it counts being the public form's; spring_facts's `by_body` is null for a hidden version and has hidden quotes
-- emptied, so neither a Mod Bot's rule or visit, nor a Says or Quotes condition, reads what an admin hid.
create or replace function rule_breaks(post_act uuid, only_move uuid default null) returns setof rules_now
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  p record;
  prev record;
  r rules_now%rowtype;
  body text;
  broken boolean;
begin
  select a.character, a.thread, a.seq, a.created_at, coalesce(public_payload(a.payload, false, a.id) ->> 'body', '') as body, t.board, t.title into p
  from acts a join threads t on t.id = a.thread where a.id = post_act and a.kind in ('post', 'spin') and not coalesce(version_hidden(a.id), false);
  if not found then return; end if;
  body := p.body;
  -- The post before this one in the thread: the unique (thread, seq) index walked back. A thread's opener has none.
  select x.character, x.created_at into prev from acts x
  where x.thread = p.thread and x.seq < p.seq and x.kind in ('post', 'spin') order by x.seq desc limit 1;
  for r in select * from rules_now x where (x.board is null or x.board = p.board) and (only_move is null or x.move_act = only_move) order by x.board nulls first, x.number loop
    broken := case r.predicate
      when 'minLength' then char_length(body) < (r.param #>> '{}')::integer
      when 'maxLength' then char_length(body) > (r.param #>> '{}')::integer
      when 'noAllCaps' then (
        select w.letters > 0 and w.uppers * 2 > w.letters
        from (select length(regexp_replace(q.s, '[^[:alpha:]]', '', 'g')) as letters, length(regexp_replace(q.s, '[^[:upper:]]', '', 'g')) as uppers
              from (select regexp_replace(body, '\[/?[a-zA-Z*]+(=[^\]]*)?\]', '', 'g') as s) q) w)
      when 'noDoublePost' then prev.character is not null and prev.character = p.character
      when 'noNecropost' then prev.created_at is not null and p.created_at - prev.created_at > make_interval(days => (r.param #>> '{}')::integer)
      when 'noDuplicateTitle' then p.seq = 1 and exists (
        select 1 from threads o where o.board = p.board and o.id <> p.thread and lower(btrim(o.title)) = lower(btrim(p.title)))
      when 'bannedWord' then body ~* ('(^|[^[:alnum:]_])' || regex_escape(r.param #>> '{}') || '([^[:alnum:]_]|$)')
      when 'requiredWord' then body !~* ('(^|[^[:alnum:]_])' || regex_escape(r.param #>> '{}') || '([^[:alnum:]_]|$)')
      when 'noTag' then body ~* ('\[' || regex_escape(r.param #>> '{}') || '([=\] ]|$)')
      when 'repliesOnly' then p.seq = 1
      else null end;
    if broken is null then raise exception 'no check for predicate %', r.predicate using errcode = '0A000'; end if;
    if broken then return next r; end if;
  end loop;
end $$;

create or replace function spring_facts(fd face_down, trigger text, by_act uuid, incoming_card text) returns spring_facts
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  f spring_facts;
  k card_kinds%rowtype;
  named text;
  in_character integer;
  in_thread integer;
  in_board integer;
  walked_plain text;
  walked_excerpt text;
  ic card_kinds%rowtype;
  m jsonb;
  ic_rank integer;
  up_rank integer;
  own_rank integer;
  flavor_ok boolean;
  matched boolean;
begin
  -- 1. The setter's character, and what decides whether it can act (retired, not debuted), who it belongs to and whether it is staff.
  select a.character into f.setter_character from acts a where a.id = fd.play;
  select c.retired_at, c.debuted_at, c.owner, c.staff is not null into f.setter_retired, f.setter_debuted, f.setter_owner, f.setter_staff from characters c where c.id = f.setter_character;
  -- 2. The back's card kind.
  select * into k from card_kinds x where x.key = fd.card;
  f.kind_play := k.play; f.kind_trap := k.trap; f.kind_stack := k.stack; f.kind_seeded := k.seeded;
  f.kind_skim := k.skim is not null; f.kind_scores := k.scores_as;
  f.reach := coalesce(k.reaches[1], 'post');
  -- 3. The Act that met the back: its kind, character, thread, board and words, and the thread's first post and the announcements thread a board card would be written in. For a cast
  -- or a visit by_act is not a post, or not yet written, and these find what they find.
  select a.kind, a.character, a.thread, public_payload(a.payload, coalesce(version_hidden(a.id), false), a.id) ->> 'body', t.board into f.by_kind, f.by_character, f.by_thread, f.by_body, f.by_board
  from acts a left join threads t on t.id = a.thread where a.id = by_act;
  select a.id into f.first_post from acts a where a.thread = f.by_thread and a.seq = 1 and a.kind = 'post';
  select t.id into f.announce_thread from settings s join threads t on t.id::text = s.value #>> '{}' where s.key = 'systemAnnouncements';
  -- 4. The stack at the would-be target and reach, for every reach: the plays of the card still up on the Act (a post's), the layer to go on from, and the plays of it still up on
  -- the Act's character, thread and board (a play beyond a post's), counted as place_cast counts them. Which reach the card takes is then a choice among values already read.
  f.target := case f.reach when 'post' then by_act when 'character' then f.by_character when 'thread' then f.by_thread else f.by_board end;
  -- Each play found is asked whether an admin ended it, whatever card it is (card_ended is a read of its own, and the subquery cannot be flattened away, so it is made for every play found and not only
  -- for the ones of this back's card): which card is counted is chosen after the reads.
  select count(*) filter (where l.card is not distinct from fd.card and (l.ends is null or l.ends > now()) and not l.ended),
         greatest(coalesce(max(l.layer) filter (where l.card is not distinct from fd.card), 0), count(*) filter (where l.card is not distinct from fd.card)) + 1,
         count(*) filter (where l.card is not distinct from fd.card and (l.ends is null or l.ends > now()) and not l.ended and l.quadrant is not distinct from (fd.config ->> 'quadrant'))
    into f.up, f.layer, f.quadrant_up
  from (select k2.payload ->> 'card' as card, (k2.payload ->> 'ends')::timestamptz as ends, (k2.payload ->> 'layer')::integer as layer, card_ended(k2.id) as ended,
               k2.payload #>> '{config,quadrant}' as quadrant
        from acts k2 where k2.kind = 'card' and k2.target_act_id = by_act and not (k2.payload ? 'caught') and coalesce(k2.payload ->> 'reach', 'post') = 'post' offset 0) l;
  f.quadrant_ok := (fd.config ->> 'quadrant') = any (array['excitedPositive', 'excitedNegative', 'calmPositive', 'boredNegative']);
  -- The window a scored-as play would name, and whether the quoting character already has a class named for it: a play of any scored-as card made at or after the last settled window's end, not ended.
  select w.opens, w.closes, w.why into f.window_opens, f.window_closes, f.window_why from scored_as_window(now()) w;
  f.class_ok := exists (select 1 from class_kinds ck where ck.key = fd.config ->> 'class');
  select count(*) filter (where l.card = fd.card and not l.ended and l.character = f.by_character), count(*) filter (where l.card = fd.card and not l.ended and l.thread = f.by_thread),
         count(*) filter (where l.card = fd.card and not l.ended and l.board = f.by_board),
         count(*) filter (where l.scores and not l.ended and l.character = f.by_character and l.at >= (select max(x.ends_at) from settlements x)) > 0
    into in_character, in_thread, in_board, f.class_taken
  from (select k2.payload ->> 'card' as card, r.character, r.thread, r.board, card_ended(r.play) as ended, k2.created_at as at, coalesce(ck.scores_as, false) as scores
        from play_reach r join acts k2 on k2.id = r.play left join card_kinds ck on ck.key = k2.payload ->> 'card'
        where r.ends_at > now() and (r.character = f.by_character or r.thread = f.by_thread or r.board = f.by_board) offset 0) l;
  f.reach_up := case f.reach when 'character' then in_character when 'thread' then in_thread else in_board end;
  -- 4b. Whether a live ward Gimmick on the Act turns the card away: place_cast turns a cast away by the same test (ward_refusal), and a Move does not land through it either.
  f.warded := ward_refusal('post', by_act, k) is not null;
  -- 5. A board's live card, whatever the card's reach.
  select max(r.ends_at) into f.live_board from play_reach r where r.board = f.by_board and r.ends_at > now() and not card_ended(r.play);
  -- 6. The named catch (a back with none reads its own card's row, so the read finds one row either way: a null key would be a read of nothing), compared with the incoming card.
  select x.key into named from card_kinds x where x.key = coalesce(fd.catches, fd.card);
  -- 6b. The back's match, and the incoming card's printed row, for every back whatever it holds (a back with no match reads the same row and asks the same questions of an empty one): the card's
  -- flavor in the match's `flavors`, its rarity at or below the match's `upTo` and at or below the back's own card's. A cast back springs on the card it names or on one its match holds.
  select * into ic from card_kinds x where x.key = incoming_card;
  m := case when jsonb_typeof(k.trap -> 'match') = 'object' then k.trap -> 'match' else '{}'::jsonb end;
  ic_rank := rarity_rank(ic.rarity); up_rank := rarity_rank(coalesce(m ->> 'upTo', 'legendary')); own_rank := rarity_rank(k.rarity);
  flavor_ok := case when jsonb_typeof(m -> 'flavors') = 'array' then (m -> 'flavors') ? ic.alignment else true end;
  matched := jsonb_typeof(k.trap -> 'match') = 'object' and ic.key is not null and flavor_ok and ic_rank <= up_rank and ic_rank <= own_rank;
  f.caught := (fd.catches is not null and fd.catches = incoming_card and named is not null) or coalesce(matched, false);
  -- 7. ONE walk of the Act's words for every back: its own visible words, and the excerpt of the quotes of the back's post (null for a cast or a visit, whose by_act holds no words). A function in a FROM
  -- clause runs once however many columns are taken from it, and both are taken here, so the walk costs the same whatever the back holds.
  select w.plain, w.excerpt into walked_plain, walked_excerpt from bbcode_walk(f.by_body, fd.post) w;
  -- 8. Both probes, for every back, whatever it holds: phrase_probe folds the text and compiles and runs a pattern of one shape (a back with no such condition has a pattern built around its own id, which
  -- cannot match), the Says over the Act's own words and the Quotes, on a token of its own, over the excerpt. And the Who check, against an empty list for Anyone.
  f.phrase_hit := coalesce(phrase_probe(walked_plain, fd.phrase, fd.play::text), false);
  f.passage_hit := coalesce(phrase_probe(walked_excerpt, fd.passage, fd.play::text || 'p'), false);
  f.who_hit := coalesce(f.by_character = any (coalesce(fd.who, '{}')), false);
  return f;
end $$;

-- season_news (0100), its Boss items reading the arrival post's words through what a player would read: a hidden post gives the item no quote (the item still names
-- the Act, which is public), and a quote in the post that quotes a hidden post is emptied. Everything else as 0100 wrote it. The function is security definer and every
-- player calls it, so a read of `acts.payload` here would show every player what an admin hid; 0164-conduct-leaks.sql lists every function that reads a body from
-- `acts` itself and refuses one it has not been told is safe.
create or replace function season_news(before timestamptz default null, most integer default 20) returns setof season_news_row
language sql stable security definer set search_path = public, pg_temp as $$
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
    select 'bossLeft', h.outgoing, h.landed_at, h.number - 1, 'bossFarewell' from season_boss_changes h
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
  order by m.at desc, m.kind, m.act nulls first
$$;

-- Every version hidden now: a version an admin hid, and an edit that follows a plain hide or carries a second hide-until-edited. For the service and the admin screen; a player
-- reads which versions are hidden from acts_public's `hidden`.
create view hidden_versions as
  select h.version_act
  from (
    select d.version_act from conduct_decisions d where d.version_act is not null and d.outcome in ('hide', 'hideUntilEdited', 'unhide', 'approve')
    union
    select e.id from acts e where e.kind = 'edit' and e.target_act_id in (select d.post from conduct_decisions d where d.outcome in ('hide', 'hideUntilEdited'))
  ) h
  where version_hidden(h.version_act);

-- Versions waiting on an admin after an author's edit with no decision since: the admin's re-review list. A post hidden until edited for the first time
-- shows its new version as soon as its author edits (the offending version stays hidden); a post hidden outright, or hidden until edited a second time, keeps the edit hidden
-- (version_hidden) until an admin approves it. Either way this lists the newest version of each such post until an admin decides again (approve, hide again, unhide), so an
-- admin hears of the edit. Admins read it, nobody else.
create view reviews_due as
  select d.id as decision, d.post,
         (select e.id from acts e where e.kind = 'edit' and e.target_act_id = d.post order by e.created_at desc, e.id desc limit 1) as version_act,
         (select max(x.created_at) from acts x where x.kind = 'edit' and x.target_act_id = d.post) as edited_at,
         (select p.thread from acts p where p.id = d.post) as thread
  from conduct_decisions d
  where is_admin()
    and (d.outcome = 'hide'
         or (d.outcome = 'hideUntilEdited'
             and not exists (select 1 from conduct_decisions e where e.post = d.post and e.outcome = 'hideUntilEdited' and e.id < d.id)))
    and exists (select 1 from acts x where x.kind = 'edit' and x.target_act_id = d.post and x.created_at > d.at)
    and not exists (select 1 from conduct_decisions l where l.post = d.post and l.id > d.id and l.outcome in ('hide', 'hideUntilEdited', 'unhide', 'approve'));

-- acts_public (0156), every column and grant as it was, with `hidden`, `any_hidden` and `concealing` last, after 0156's `ends_at`: a hidden version's body is null, `hidden` says so, and a body
-- that quotes a hidden post is served as its layer (quote_layers: the one parser's concealQuotes, run by the conceal job, empties the contents of those quotes) once the layer made for
-- the hidden set of now exists. Until it does the body is null and `concealing` is true (the screen says the post will show again in a moment, never the hidden words; like `hidden`, `concealing` is about the current version); with nothing hidden among
-- what it quotes a body is as written, which needs no job. `payload` is the version the Act is (a post's original, an edit's own words);
-- `current_payload` is the post's current version, and `hidden` says whether that version is hidden. `any_hidden` says whether any version of the post is (quote_hidden), which is what a quote's note stands on.
-- A view calls its functions with its caller's privileges, so each is granted to the roles that read it.
-- A post nobody decided on costs one index-only probe of conduct_decisions_post for `hidden` and one for `any_hidden` (2 buffers each), a probe of acts_edits for its latest edit and one of
-- quote_refs for each version (conceal_layer); a decided post adds one index probe for its latest decision of the version, and a body that quotes a hidden post one more of quote_layers. Nothing here
-- reads a body's length or parses it: a page of 20 posts costs the same whatever the 20 bodies hold (supabase/tests/0168-conduct-concealing.sql holds it).
create or replace view acts_public as
  select a.id, a.character, a.kind, a.thread, a.target_act_id, a.seq, a.created_at,
         shown_payload(a.payload, h.own, co.refs, co.ready, co.body) as payload,
         shown_payload(coalesce(e.payload, a.payload), h.cur, coalesce(cc.refs, co.refs), coalesce(cc.ready, co.ready), coalesce(cc.body, co.body)) as current_payload,
         e.created_at as edited_at,
         case when e.created_at > a.created_at + coalesce(span_interval((select g.value from settings g where g.key = 'editGrace')), interval '0')
           then e.created_at end as shown_edited_at,
         case when a.kind = 'card' then exists (select 1 from card_write_refunds r where r.play = a.id) end as untaken,
         case when a.kind = 'set' then (select f.ends_at from face_down f where f.play = a.id) end as ends_at,
         h.cur as hidden,
         a.kind = 'post' and quote_hidden(a.id) as any_hidden,
         not h.cur and coalesce(cc.refs, co.refs) and not coalesce(cc.ready, co.ready) as concealing
  from acts a
  left join lateral (
    select x.id, x.payload, x.created_at from acts x
    where x.kind = 'edit' and x.target_act_id = a.id
    order by x.created_at desc, x.id desc limit 1
  ) e on a.kind = 'post'
  cross join lateral (
    select o.own, case when e.id is null then o.own else version_hidden(e.id, a.id) end as cur
    from (select a.kind in ('post', 'edit') and version_hidden(a.id, case when a.kind = 'edit' then a.target_act_id else a.id end) as own) o
  ) h
  cross join lateral conceal_layer(a.id) co
  left join lateral conceal_layer(e.id) cc on e.id is not null;

-- Words are read through acts_public, never from the table: a player's `select` on `acts` loses the `payload` column. A hidden version's words, and the copy of
-- them inside a post that quotes it, are in `payload`, and no row policy can empty a quote's contents, so the column goes. Everything else on the row stays as public as
-- it was. The two security-invoker views that read `acts.payload` as their reader read acts_public instead (the same rows and the same words for a card, a move or an
-- appeal, none of which can be hidden); every other view or function that reads payload runs as its owner.
revoke select on acts from authenticated;
grant select (id, character, kind, thread, target_act_id, seq, created_at) on acts to authenticated;

create or replace view my_cards_ended with (security_invoker = true) as
WITH mine AS (
         SELECT c.id
           FROM characters c
          WHERE (c.owner = auth.uid())
        ), plays AS (
         SELECT e.id AS card_end,
            k.id AS play,
            (k.payload ->> 'card'::text) AS card,
            e.created_at AS at,
            'cast'::text AS side,
            k."character" AS caster,
            COALESCE(pr.reach, 'post'::text) AS reach,
            k.target_act_id,
            (k.payload ->> 'targetName'::text) AS named,
            pr."character" AS reach_character,
            pr.thread AS reach_thread,
            pr.board AS reach_board,
            k."character" AS mine_character
           FROM (((mine
             JOIN acts_public k ON (((k."character" = mine.id) AND (k.kind = 'card'::text))))
             JOIN acts_public e ON (((e.target_act_id = k.id) AND (e.kind = 'card_end'::text))))
             LEFT JOIN play_reach pr ON ((pr.play = k.id)))
          WHERE ((pr.play IS NOT NULL) OR (COALESCE((k.payload ->> 'reach'::text), 'post'::text) = 'post'::text))
        UNION ALL
         SELECT e.id,
            k.id,
            (k.payload ->> 'card'::text),
            e.created_at,
            'onMine'::text,
            k."character",
            'post'::text,
            k.target_act_id,
            NULL::text,
            NULL::uuid,
            NULL::uuid,
            NULL::uuid,
            p."character"
           FROM (((mine
             JOIN acts_public p ON (((p."character" = mine.id) AND (p.kind = 'post'::text))))
             JOIN acts_public k ON (((k.target_act_id = p.id) AND (k.kind = 'card'::text))))
             JOIN acts_public e ON (((e.target_act_id = k.id) AND (e.kind = 'card_end'::text))))
          WHERE ((COALESCE((k.payload ->> 'reach'::text), 'post'::text) = 'post'::text) AND (NOT (EXISTS ( SELECT 1
                   FROM play_reach x
                  WHERE (x.play = k.id)))) AND (NOT (k."character" IN ( SELECT mine_1.id
                   FROM mine mine_1))))
        UNION ALL
         SELECT e.id,
            k.id,
            (k.payload ->> 'card'::text),
            e.created_at,
            'onMine'::text,
            k."character",
            'character'::text,
            k.target_act_id,
            (k.payload ->> 'targetName'::text),
            pr."character",
            NULL::uuid,
            NULL::uuid,
            pr."character"
           FROM (((mine
             JOIN play_reach pr ON ((pr."character" = mine.id)))
             JOIN acts_public k ON (((k.id = pr.play) AND (k.kind = 'card'::text))))
             JOIN acts_public e ON (((e.target_act_id = k.id) AND (e.kind = 'card_end'::text))))
          WHERE (NOT (k."character" IN ( SELECT mine_1.id
                   FROM mine mine_1)))
        UNION ALL
         SELECT e.id,
            k.id,
            (k.payload ->> 'card'::text),
            e.created_at,
            'onMine'::text,
            k."character",
            'thread'::text,
            k.target_act_id,
            (k.payload ->> 'targetName'::text),
            NULL::uuid,
            pr.thread,
            NULL::uuid,
            o."character"
           FROM ((((mine
             JOIN acts_public o ON (((o."character" = mine.id) AND (o.seq = 1))))
             JOIN play_reach pr ON ((pr.thread = o.thread)))
             JOIN acts_public k ON (((k.id = pr.play) AND (k.kind = 'card'::text))))
             JOIN acts_public e ON (((e.target_act_id = k.id) AND (e.kind = 'card_end'::text))))
          WHERE (NOT (k."character" IN ( SELECT mine_1.id
                   FROM mine mine_1)))
        )
 SELECT card_end,
    play,
    card,
    at,
    side,
    reach,
        CASE reach
            WHEN 'character'::text THEN COALESCE(named, ( SELECT cp.name
               FROM characters_public cp
              WHERE (cp.id = pl.reach_character)))
            WHEN 'thread'::text THEN COALESCE(named, ( SELECT th.title
               FROM threads th
              WHERE (th.id = pl.reach_thread)))
            WHEN 'board'::text THEN COALESCE(named, ( SELECT bd.name
               FROM boards bd
              WHERE (bd.id = pl.reach_board)))
            ELSE NULL::text
        END AS target_name,
        CASE
            WHEN (reach = 'post'::text) THEN ( SELECT cp.name
               FROM (acts_public pa
                 JOIN characters_public cp ON ((cp.id = pa."character")))
              WHERE (pa.id = pl.target_act_id))
            ELSE NULL::text
        END AS post_author_name,
    ( SELECT cp.name
           FROM characters_public cp
          WHERE (cp.id = pl.caster)) AS caster_name,
    mine_character AS "character"
   FROM plays pl;

create or replace view my_group_moves with (security_invoker = true) as
SELECT m.id AS move,
    c.id AS "character",
    m.created_at AS at,
    m.thread,
    m.seq,
    (m.payload #>> '{params,group}'::text[]) AS "group",
        CASE
            WHEN (jsonb_typeof((m.payload #> '{params,board}'::text[])) = 'string'::text) THEN ((m.payload #>> '{params,board}'::text[]))::uuid
            ELSE NULL::uuid
        END AS board,
    ( SELECT b.name
           FROM boards_now b
          WHERE (b.id =
                CASE
                    WHEN (jsonb_typeof((m.payload #> '{params,board}'::text[])) = 'string'::text) THEN ((m.payload #>> '{params,board}'::text[]))::uuid
                    ELSE NULL::uuid
                END)) AS board_name,
    move_expires_at(m.id) AS expires_at,
        CASE
            WHEN (jsonb_typeof((m.payload -> 'expires_at'::text)) = 'string'::text) THEN ((m.payload ->> 'expires_at'::text))::timestamp with time zone
            ELSE NULL::timestamp with time zone
        END AS landed_until,
        CASE
            WHEN (jsonb_typeof((m.payload #> '{params,checkAt}'::text[])) = 'string'::text) THEN ((m.payload #>> '{params,checkAt}'::text[]))::timestamp with time zone
            ELSE NULL::timestamp with time zone
        END AS check_at,
    (m.payload #>> '{demand,kind}'::text[]) AS demand,
    COALESCE(NULLIF((m.payload ->> 'office'::text), ''::text), 'boss'::text) AS office,
    (e.payload ->> 'why'::text) AS ended_why,
    (e.payload ->> 'by'::text) AS ended_by,
    e.created_at AS ended_at,
    (r.payload ->> 'verdict'::text) AS ruling,
    r.created_at AS ruled_at,
        CASE
            WHEN (jsonb_typeof((r.payload -> 'until'::text)) = 'string'::text) THEN ((r.payload ->> 'until'::text))::timestamp with time zone
            ELSE NULL::timestamp with time zone
        END AS ruled_until,
    NULLIF((r.payload ->> 'office'::text), ''::text) AS ruled_office
   FROM (((characters c
     JOIN acts_public m ON (((m.kind = 'move'::text) AND ((m.payload ->> 'kind'::text) = 'conferGroup'::text) AND ((m.payload #>> '{params,character}'::text[]) = (c.id)::text))))
     LEFT JOIN acts_public e ON (((e.kind = 'move_end'::text) AND (e.target_act_id = m.id))))
     LEFT JOIN LATERAL ( SELECT ru.id,
            ru."character",
            ru.kind,
            ru.thread,
            ru.target_act_id,
            ru.payload,
            ru.seq,
            ru.created_at
           FROM (acts_public ap
             JOIN acts_public ru ON (((ru.kind = 'appeal_ruling'::text) AND (ru.target_act_id = ap.id))))
          WHERE ((ap.kind = 'appeal'::text) AND (ap.target_act_id = m.id))
          ORDER BY ru.created_at DESC, ru.id DESC
         LIMIT 1) r ON (true))
  WHERE (c.owner = auth.uid());

-- An admin reads a version's words, hidden or not.
create function admin_version(act uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare words text;
begin
  perform only_admins('reads a version''s words');
  select a.payload ->> 'body' into words from acts a where a.id = admin_version.act and a.kind in ('post', 'edit');
  return words;
end $$;

-- ---------------------------------------------------------------------------------------- reporting ----

-- Report a version to admins: the signed-in account's own report, never a character's. It is refused only at the account's open limit
-- (the setting conduct.openReportsMost, naming the limit), for an Act that is not a post or an edit, and for a section the code does not hold.
-- It reads no character, so no refusal and no delay depends on who owns the reported words; one's own post is accepted, and so is a
-- second report on a version.
create function report_post(version_act uuid, section text, note text default null) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  most integer := (setting('conduct') ->> 'openReportsMost')::integer;
  open_now integer;
  said text := nullif(btrim(note), '');
  made bigint;
begin
  -- One report at a time per account, so two at once cannot both slip under the limit.
  perform 1 from accounts a where a.id = caller for no key update;
  select count(*) into open_now from conduct_reports r
  where r.reporter = caller and not exists (select 1 from conduct_decisions d where d.report = r.id);
  if open_now >= most then
    raise exception 'you have % reports open, the most an account can; an admin will close one', most using hint = 'kayfabb.refusal', errcode = '53400';
  end if;
  if not exists (select 1 from acts a where a.id = report_post.version_act and a.kind in ('post', 'edit')) then
    raise exception 'a report names a post or an edit' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if report_post.section is null or not (setting('conductSections') ? report_post.section) then
    raise exception 'that is not a section of the code of conduct' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if said is not null and char_length(said) > 1000 then
    raise exception 'a note is at most 1000 characters' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  insert into conduct_reports (reporter, version_act, section, note) values (caller, report_post.version_act, report_post.section, said)
  returning id into made;
  return made;
end $$;

-- ----------------------------------------------------------------------------------------- deciding ----

-- The account behind a version, or null for a staff character's (a Mod Bot and a Boss have no account).
create function conduct_author(version uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select c.owner from acts a join characters c on c.id = a.character where a.id = version
$$;

-- One decision row, as the admin who is calling. A suspension needs an end date in the future.
create function conduct_write(for_report bigint, for_version uuid, for_account uuid, outcome text, ends timestamptz, said text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare made bigint;
begin
  if outcome = 'suspend' and (ends is null or ends <= now()) then
    raise exception 'a suspension needs an end date in the future' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if outcome <> 'suspend' and ends is not null then
    raise exception 'only a suspension has an end date' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  insert into conduct_decisions (report, version_act, account, admin, outcome, until, note)
  values (for_report, for_version, for_account, auth.uid(), outcome, ends, coalesce(said, ''))
  returning id into made;
  return made;
end $$;

-- An admin decides a report: one decision row for each outcome, in one transaction (a hide with a suspension is two rows). The report is
-- then closed. `outcomes` is an array of {outcome, until?, note?}; the outcomes here are none, nudge, hide, hideUntilEdited, suspend, ban and
-- close. A report that is decided is not decided again here; what follows is `decide`. (Task 3 adds the mail.)
create function decide_report(report bigint, outcomes jsonb) returns bigint[]
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
  return made;
end $$;

-- An admin acts with no report: lift a bar, unhide a version, approve an edit, or act against a reporter. Name the version or the account
-- (a version's author's account is taken when an account outcome names only the version). An account outcome (suspend, ban, lift, nudge)
-- is about an account; hide, hideUntilEdited, unhide and approve are about a version; none and close are noted on either.
create function decide(account uuid, version_act uuid, outcome text, until timestamptz default null, note text default '') returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  who uuid := decide.account;
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
  return conduct_write(null, decide.version_act, case when outcome in ('suspend', 'ban', 'lift', 'nudge') then who else decide.account end, outcome, decide.until, decide.note);
end $$;

-- ------------------------------------------------------------------------------------------- the bar ----

-- An account's bar now, or null: the latest suspend, ban or lift decides, and nothing before it is read. A lift is no bar, a ban is banned,
-- a suspension is barred until its date and no bar once that has passed (it ends by itself). One index probe for the account's newest
-- decision, the same single lookup for a lapsed suspension as for none, so what it costs says nothing. {kind: 'banned' | 'suspended', until}.
create function account_bar(who uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  d record;
begin
  select x.outcome, x.until into d from conduct_decisions x
    where x.account = who and x.outcome in ('suspend', 'ban', 'lift') order by x.id desc limit 1;
  if d.outcome = 'ban' then return jsonb_build_object('kind', 'banned', 'until', null); end if;
  if d.outcome = 'suspend' and d.until > now() then return jsonb_build_object('kind', 'suspended', 'until', d.until); end if;
  return null;
end $$;

-- The caller's own bar, for the gate, and nobody else's.
create function my_bar() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select account_bar(auth.uid()) where auth.uid() is not null
$$;

-- Refuses a barred account, with the hint the client reads to show the bar's screen. Plain, and said only to the account it is about.
create function refuse_if_barred(who uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare bar jsonb := account_bar(who);
begin
  if bar is not null then
    raise exception '%', case when bar ->> 'kind' = 'banned' then 'this account is banned'
                              else 'this account is suspended until ' || to_char((bar ->> 'until')::timestamptz at time zone 'UTC', 'YYYY-MM-DD') end
      using hint = 'kayfabb.barred', errcode = '28000';
  end if;
end $$;

-- signed_in_account (0009), refusing a barred account: every writer that asks who is signed in refuses alike.
create or replace function signed_in_account() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare caller uuid := auth.uid();
begin
  if caller is null or not exists (select 1 from accounts where id = caller) then
    raise exception 'sign in with an account first' using hint = 'kayfabb.refusal', errcode = '28000';
  end if;
  perform refuse_if_barred(caller);
  return caller;
end $$;

-- played_by (0021), refusing a barred account first: every action a character takes asks it, so a barred account's characters act nowhere.
create or replace function played_by(through uuid, who uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  waiting boolean;
  retired boolean;
begin
  perform refuse_if_barred(who);
  select c.debuted_at is null, c.retired_at is not null into waiting, retired from characters c where c.id = through and c.owner = who;
  if waiting is null then
    raise exception 'you do not play that character' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if waiting then
    raise exception 'that character debuts at the next settlement' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if retired then
    raise exception 'that character is retired; an admin can restore it' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
end $$;

-- ------------------------------------------------------------------------------------------ the log ----

-- What admins decided about the caller's own versions (a hide, a hide until edited, an unhide, an approval), for the player's log: which
-- version, its post and thread, and when. Never the note (that is in the mail), never the admin, never another player's. Newest first.
-- A hide until edited ends at the author's own edit, which is already an Act in their log.
create function my_conduct_log(most integer default 100) returns table (decision bigint, outcome text, version_act uuid, post uuid, thread uuid, at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select d.id, d.outcome, d.version_act, d.post, a.thread, d.at
  from conduct_decisions d
  join acts a on a.id = d.version_act
  join characters c on c.id = a.character
  where d.outcome in ('hide', 'hideUntilEdited', 'unhide', 'approve') and c.owner = auth.uid()
  order by d.id desc
  limit greatest(least(most, 500), 0)
$$;

-- ---------------------------------------------------------------------------------- the words they read ----

-- play_moment (0092), with the one change this migration needs: the version a play landed on is shown as acts_public shows it, so a hidden
-- version's words are not served through a card's moment. Everything else is as 0092 wrote it.
create or replace function public.play_moment(play uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  k acts%rowtype;
  on_post acts%rowtype;
  v acts%rowtype;
  recorded boolean;
  on_board uuid;
  grace interval := coalesce(span_interval((select g.value from settings g where g.key = 'editGrace')), interval '0');
  -- A play beyond a post that began before this one ends at most its reach's reachLasts after it began (play_card), so before this
  -- play's time plus that bound: each probe of play_reach reads the plays live then and none begun since, however old the play is.
  -- (An instance that lowers reachLasts later bounds an older moment by the lower span; a play that outlived it is left off that
  -- moment's list of plays above, which is words on the frame.)
  bound record;
begin
  select * into k from acts a where a.id = play_moment.play;
  if k.id is not null and k.kind in ('card', 'set', 'spring') and k.target_act_id is not null and coalesce(k.payload ->> 'reach', 'post') = 'post' then
    select * into on_post from acts a where a.id = k.target_act_id;
  end if;
  if on_post.kind is distinct from 'post' then raise exception 'that is no play on a post' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  select * into v from acts a where a.id = (select m.post_version from play_moments m where m.play = k.id);
  recorded := v.id is not null;
  if not recorded then
    select * into v from acts e where e.kind = 'edit' and e.target_act_id = on_post.id and e.created_at <= k.created_at
    order by e.created_at desc, e.id desc limit 1;
    if v.id is null then v := on_post; end if;
  end if;
  select t.board into on_board from threads t where t.id = on_post.thread;
  -- An instance seeded without reachLasts (settings_reach_hold makes it whole once written) bounds nothing, rather than reading none.
  select coalesce(span_interval(setting('reachLasts') -> 'character'), interval '1000 months') as character,
         coalesce(span_interval(setting('reachLasts') -> 'thread'), interval '1000 months') as thread,
         coalesce(span_interval(setting('reachLasts') -> 'board'), interval '1000 months') as board into bound;
  return jsonb_build_object(
    'version', act_projection(on_post.id) || jsonb_build_object(
      'current_payload', public_payload(v.payload, version_hidden(v.id), v.id),
      'edited_at', case when v.kind = 'edit' then v.created_at end,
      'shown_edited_at', case when v.kind = 'edit' and v.created_at > on_post.created_at + grace then v.created_at end),
    -- The rows' order is for a stable answer only: a caught play and its spring share a transaction's time, so readers order the layers
    -- themselves (inPlayOrder) and find a caught play's spring by its set, never by this order.
    'layers', jsonb_build_array(jsonb_build_object('act', act_projection(k.id), 'state', null, 'savedAt', null))
      || coalesce((select jsonb_agg(jsonb_build_object('act', to_jsonb(a), 'state', l.state, 'savedAt', l.saved_at) order by a.created_at, a.id)
                   from play_moment_layers l join acts_public a on a.id = l.layer where l.play = k.id), '[]'::jsonb)
      || coalesce((select jsonb_agg(jsonb_build_object('act', to_jsonb(e), 'state', null, 'savedAt', null) order by e.created_at, e.id)
                   from acts_public e
                   where e.kind = 'card_end' and e.created_at <= k.created_at
                     and e.target_act_id in (select k.id union all select l.layer from play_moment_layers l where l.play = k.id)), '[]'::jsonb),
    'above', coalesce((
      select jsonb_agg(jsonb_build_object('play', r.play, 'reach', r.reach, 'target', coalesce(r.character, r.thread, r.board), 'ends_at', r.ends_at, 'act', to_jsonb(a))
                       order by a.created_at, a.id)
      from (
        select x.* from play_reach x where x.character = on_post.character and x.ends_at > k.created_at and x.ends_at <= k.created_at + bound.character
        union all
        select x.* from play_reach x where x.thread = on_post.thread and x.ends_at > k.created_at and x.ends_at <= k.created_at + bound.thread
        union all
        select x.* from play_reach x where x.board = on_board and x.ends_at > k.created_at and x.ends_at <= k.created_at + bound.board
      ) r join acts_public a on a.id = r.play
      where a.created_at < k.created_at
        and not exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = r.play and e.created_at <= k.created_at)), '[]'::jsonb),
    'recorded', recorded);
end $function$;


-- card_held (0148) counted the backs that ended unsprung and untaken by reading the `payload` of a spring and a take-back, and it runs as its caller, who has no read of an Act's
-- `payload` since the column was revoked (below). The two probes move into back_closed, which runs as its owner and answers one fact: whether a spring or a take-back of this back
-- exists, which is two public Acts (acts_public shows both). Each is still one index probe (acts_one_spring, acts_one_take_back) per ended back, as 0148 measured. card_held
-- stays the caller's own: it still reads face_down and card_ledger as the caller, so it counts only the caller's own backs, as it did.
create function back_closed(play uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select (select s.id from acts s where s.kind = 'spring' and (s.payload ->> 'set') = back_closed.play::text limit 1) is not null
      or (select tb.id from acts tb where tb.kind = 'take_back' and (tb.payload ->> 'set') = back_closed.play::text limit 1) is not null
$$;
revoke execute on function back_closed(uuid) from public, anon;
grant execute on function back_closed(uuid) to authenticated, service_role;

create or replace function card_held(who uuid, card text) returns integer
language sql stable set search_path = public, pg_temp as $$
  select (count(*) filter (where l.kind in ('bought', 'pulled', 'caught', 'returned', 'found')) - count(*) filter (where l.kind = 'played')
          + (select count(*) from face_down f
             where f.account = card_held.who and f.card = card_held.card and f.ends_at <= now() and not back_closed(f.play)))::integer
  from card_ledger l where l.account = card_held.who and l.card = card_held.card
$$;

-- claim_card_writes (0149), reading the words of the version a card writes on through the layer a player reads, so a hidden version is a hidden body to the model it is sent to
-- and not its original words. Everything else as 0149 wrote it.
create or replace function claim_card_writes(most integer, only_post uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  nearby integer := coalesce((((select s.value from settings s where s.key = 'pool') ->> 'chatterThreadPosts'))::integer, 8);
  claimed jsonb;
begin
  delete from card_writes w where w.play in (
    select x.play from card_writes x where card_ended(x.play) and (claim_card_writes.only_post is null or x.post = claim_card_writes.only_post) for update skip locked);
  with picked as materialized (
    select c.play from card_writes c join acts a on a.id = c.play
    where (c.claimed_until is null or c.claimed_until < clock_timestamp()) and c.not_before <= clock_timestamp() and not card_ended(c.play)
      and (claim_card_writes.only_post is null or c.post = claim_card_writes.only_post)
      and not exists (select 1 from card_writes e join acts ea on ea.id = e.play
                      where e.post = c.post and e.play <> c.play and not card_ended(e.play) and (ea.created_at, ea.id) < (a.created_at, a.id))
    order by c.queued_at, c.play limit greatest(claim_card_writes.most, 0) for update of c skip locked
  ), taken as (
    update card_writes w set claimed_until = clock_timestamp() + interval '5 minutes', attempts = w.attempts + 1, version = post_version(w.post)
    from picked where w.play = picked.play
    returning w.play, w.post, w.version, w.attempts, w.queued_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'play', t.play, 'version', t.version, 'post', t.post, 'thread', pa.thread, 'attempts', t.attempts,
      'card', pl.payload ->> 'card', 'config', coalesce(pl.payload -> 'config', '{}'::jsonb), 'tokens', (pl.payload ->> 'tokens')::integer,
      'author', ch.name, 'body', coalesce(public_payload(v.payload, version_hidden(v.id, pa.id), v.id) ->> 'body', ''), 'title', th.title,
      'before', (select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'body', x.body) order by x.seq), '[]'::jsonb)
                 from (select n.seq, cn.name, coalesce(n.current_payload ->> 'body', '') as body
                       from acts_public n join characters_public cn on cn.id = n.character
                       where n.thread = pa.thread and n.kind = 'post' and n.seq < pa.seq
                       order by n.seq desc limit greatest(nearby, 0)) x),
      'earlier', (select coalesce(jsonb_agg(jsonb_build_object('play', q.id, 'text', q.text) order by q.created_at, q.id), '[]'::jsonb)
                  from (select ea.id, ea.created_at,
                          coalesce((select x.text from card_texts x where x.play = ea.id and x.version = t.version and x.text is not null),
                                   (select x.text from card_texts x where x.play = ea.id and x.text is not null order by x.created_at desc, x.id desc limit 1)) as text
                        from live_writing_plays(t.post) lp join acts ea on ea.id = lp
                        where (ea.created_at, ea.id) < (pl.created_at, pl.id)) q
                  where q.text is not null)
    ) order by t.queued_at, t.play), '[]'::jsonb) into claimed
  from taken t
  join acts pl on pl.id = t.play
  join acts pa on pa.id = t.post
  join characters ch on ch.id = pa.character
  join threads th on th.id = pa.thread
  join acts v on v.id = t.version;
  return claimed;
end $$;

-- ------------------------------------------------------------------------------------------ search ----

-- post_search holds each post's current words, which a player can match and read. A hidden current version holds none (the thread's title stays, for a thread's first
-- post): search_words_of reads through acts_public, so it already gives a hidden version's title alone. The words are rewritten when the two things that change what is
-- hidden happen: an admin's decision on a post's versions, and a new edit of a post that has been decided on (a second hide until edited hides it too). The search
-- queries are unchanged, so their plans are.
create function conduct_decisions_search() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update post_search set words = coalesce(search_words_of(new.post, search_lang()), words) where act = new.post;
  return null;
end $$;
create trigger conduct_decisions_search after insert on conduct_decisions
  for each row when (new.post is not null and new.outcome in ('hide', 'hideUntilEdited', 'unhide', 'approve')) execute function conduct_decisions_search();

create function acts_search_hidden() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from conduct_decisions d where d.post = new.target_act_id and d.outcome in ('hide', 'hideUntilEdited', 'unhide', 'approve')) then
    update post_search set words = coalesce(search_words_of(new.target_act_id, search_lang()), words) where act = new.target_act_id;
  end if;
  return null;
end $$;
-- Named after acts_search so it fires after it, over the words that trigger wrote.
create trigger acts_search_hidden after insert on acts for each row when (new.kind = 'edit') execute function acts_search_hidden();
revoke execute on function conduct_decisions_search(), acts_search_hidden() from public, anon, authenticated;

-- ------------------------------------------------------------------- the screens that carry acts_public's rows ----

-- Five screen reads are SQL-standard functions (`begin atomic`), whose bodies Postgres parses once, when they are created: a `select a.*` from
-- acts_public inside one is expanded to the columns the view had that day. A column the view gains later (`hidden`, above) does not reach them
-- until the function is created again, and a page of Acts without `hidden` would show a hidden version as an empty post with no note. So each is
-- re-created here with its latest text unchanged (thread_page, profile_page and record_page as 0128 wrote them, alerts_page as 0134 did, log_page
-- as 0139 did, but log_page as 0153 wrote it: its gift events and donation target); the grants stay as they are. A later migration that re-creates one takes its text from here.

create or replace function thread_page(in_thread uuid, in_page integer, in_seq integer, per_page integer, effect_cards text[]) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  -- The refusal, before anything is read.
  select case when coalesce(thread_page.per_page, (select (x.settings ->> 'postsPerPage')::integer from screen_settings x limit 1)) is null
                or coalesce(thread_page.per_page, (select (x.settings ->> 'postsPerPage')::integer from screen_settings x limit 1)) not between 1 and 100
              then screen_refusal('a page holds 1 to 100 posts') end;

  with pp as materialized (
    select coalesce(thread_page.per_page, (select (x.settings ->> 'postsPerPage')::integer from screen_settings x limit 1)) as n
  ),
  s as materialized (
    select o.*, greatest(1, ceil(o.last_seq::numeric / (select pp.n from pp)))::integer as last_page
    from thread_open o where o.id = thread_page.in_thread
  ),
  pg as materialized (
    select s.*,
           least(s.last_page, greatest(1, coalesce(case when thread_page.in_seq is not null then greatest(1, ceil(thread_page.in_seq::numeric / (select pp.n from pp)))::integer end,
                                                   thread_page.in_page, 1))) as page
    from s
  ),
  rng as materialized (
    select pg.*, (pg.page - 1) * (select pp.n from pp) + 1 as first_seq, pg.page * (select pp.n from pp) as end_seq from pg
  ),
  page_acts as materialized (
    select a.* from acts_public a, rng
    where a.thread = rng.id and a.seq between rng.first_seq and rng.end_seq and a.kind not in ('edit', 'card')
  ),
  posts as materialized (select a.id, a.character from page_acts a where a.kind = 'post'),
  -- At most PLAYS_PER_POST layers a post, oldest first.
  on_posts as materialized (
    select l.* from (
      select a.*, row_number() over (partition by a.target_act_id order by a.created_at, a.id) as n
      from acts_public a where a.kind in ('card', 'set', 'spring') and a.target_act_id in (select p.id from posts p)
    ) l where l.n <= 8
  ),
  -- An admin's end of each of those plays (0092), as cardsOnMany answers it beside them: the client marks a play reversed only from
  -- its card_end (engine/ui/cards/plays.ts), so a page without it would draw an ended effect over its post. One per play at most.
  ends_on_posts as materialized (
    select a.* from acts_public a where a.kind = 'card_end' and a.target_act_id in (select o.id from on_posts o)
  ),
  above as materialized (
    select x.play, x.reach, x.target, x.ends_at, x.act
    from effects_above(array(select distinct p.character from posts p where p.character is not null), (select rng.id from rng), (select rng.board from rng)) x
  ),
  -- Every play the page draws, on a post or above: by id, with its caster.
  played as materialized (
    select o.id, o.kind, o.character, o.payload ->> 'card' as card from on_posts o
    union
    select (x.act ->> 'id')::uuid, x.act ->> 'kind', (x.act ->> 'character')::uuid, x.act -> 'payload' ->> 'card' from above x
  ),
  -- Each of the page's posts' latest visit (0105), by acts_visits_by_post: its Mod, when it ends, its charges (the start's and every join's, in order) and its
  -- challenge, whitelisted to the kind and the number, never an answer; and its end if it has one.
  vis as materialized (
    select distinct on (v.target_act_id) v.id, v.target_act_id as post, v.character, v.created_at, v.payload
    from acts_public v where v.kind = 'visit' and v.target_act_id in (select a.id from page_acts a where a.kind in ('post', 'spin'))
    order by v.target_act_id, v.created_at desc, v.id desc
  ),
  ids as materialized (select a.id from page_acts a union select p.id from played p),
  who as materialized (
    select c from (select a.character as c from page_acts a union select p.character from played p union select v.character from vis v) w where c is not null
  ),
  wanted_plays as materialized (select p.id from played p where p.card = any (coalesce(thread_page.effect_cards, '{}'))),
  spun as materialized (
    select l.* from (
      select t.*, row_number() over (partition by t.origin_act_id order by t.created_at, t.id) as n
      from thread_list t where t.origin_act_id in (select i.id from ids i)
    ) l where l.n <= 200
  )
  select case when not exists (select 1 from rng) then null else jsonb_build_object(
    'summary', (select to_jsonb(s) - 'last_page' from s),
    'page', (select rng.page from rng),
    'acts', (select coalesce(jsonb_agg(to_jsonb(a) order by a.seq), '[]'::jsonb) from page_acts a),
    'people', (select coalesce(jsonb_agg(jsonb_build_object(
        'character', jsonb_build_object('id', c.id, 'name', c.name, 'joined', c.joined, 'staff', c.staff, 'office', c.office,
          'warn_points', c.warn_points, 'banned_until', c.banned_until, 'group', c."group"),
        'profile', (select jsonb_build_object('character', p.character, 'title', p.title, 'signature', p.signature, 'avatar_square', p.avatar_square,
                      'avatar_portrait', p.avatar_portrait, 'square_frame', p.square_frame, 'portrait_frame', p.portrait_frame, 'pip_style', p.pip_style, 'pronouns', p.pronouns) || profile_cosmetics(p.character)
                    from character_profiles p where p.character = c.id),
        'posts', coalesce((select n.posts from character_post_counts n where n.character = c.id), 0),
        'standing', coalesce((select st.standing from current_standings st where st.character = c.id), 0),
        'reveals', (select coalesce(jsonb_agg(jsonb_build_object('act', r.act, 'character', r.character, 'class', r.class, 'at', r.at, 'via', r.via, 'thread', r.thread)
                      order by r.at, r.act), '[]'::jsonb) from class_reveals r where r.character = c.id),
        'turns', (select coalesce(jsonb_agg(jsonb_build_object('act', u.act, 'character', u.character, 'at', u.at, 'was', u.was) order by u.at, u.act), '[]'::jsonb)
                  from turns_announced u where u.character = c.id)
      ) order by c.id), '[]'::jsonb)
      from characters_public c where c.id in (select w.c from who w)),
    'plays', (select coalesce(jsonb_agg(x.j order by x.created_at, x.id), '[]'::jsonb) from (
                select to_jsonb(o) - 'n' as j, o.created_at, o.id from on_posts o
                union all
                select to_jsonb(e), e.created_at, e.id from ends_on_posts e
              ) x),
    'above', (select coalesce(jsonb_agg(jsonb_build_object('play', x.play, 'reach', x.reach, 'target', x.target, 'ends_at', x.ends_at, 'act', x.act)
                order by (x.act ->> 'created_at')::timestamptz, x.play), '[]'::jsonb) from above x),
    'visits', (select coalesce(jsonb_agg(jsonb_build_object(
        'visit', v.id, 'post', v.post, 'mod', v.character, 'at', v.created_at, 'ends_at', v.payload -> 'ends_at', 'line', v.payload -> 'line',
        'charges', (v.payload -> 'charges') || coalesce((select jsonb_agg(j.payload -> 'charge' order by j.created_at, j.id) from acts_public j where j.kind = 'visit_join' and j.target_act_id = v.id), '[]'::jsonb),
        'challenge', jsonb_strip_nulls(jsonb_build_object('kind', v.payload #>> '{challenge,kind}', 'question_index', v.payload #> '{challenge,question_index}', 'price', v.payload #> '{challenge,price}'))
          || coalesce(visit_quiz(v.id), '{}'::jsonb),
        'end', (select jsonb_build_object('act', e.id, 'at', e.created_at, 'outcome', e.payload ->> 'outcome', 'by_act', e.payload -> 'by_act', 'line', e.payload -> 'line')
                from acts_public e where e.kind = 'visit_end' and e.target_act_id = v.id limit 1),
        -- Read through acts_public as the rest of the page is (e2e/0016 holds a screen to the public projections).
        'ruling', (select r.payload ->> 'verdict' from acts_public i
                   join acts_public ap on ap.kind = 'appeal' and ap.target_act_id = i.id
                   join acts_public r on r.kind = 'appeal_ruling' and r.target_act_id = ap.id
                   where i.kind = 'infraction' and i.payload ->> 'visit_act' = v.id::text limit 1)
      ) order by v.created_at, v.id), '[]'::jsonb) from vis v),
    'faces', (select coalesce(jsonb_agg(jsonb_build_object('play', f.play, 'card', f.card)), '[]'::jsonb)
              from my_face_down f where f.play in (select p.id from played p where p.kind = 'set')),
    'states', (select coalesce(jsonb_agg(jsonb_build_object('play', e.play, 'state', e.state, 'saved_at', e.saved_at)), '[]'::jsonb)
               from effect_state e where e.play in (select w.id from wanted_plays w)),
    'releases', (select coalesce(jsonb_agg(r.play), '[]'::jsonb) from effect_releases r where r.play in (select w.id from wanted_plays w)),
    'surfaces', (select coalesce(jsonb_object_agg(sf.play::text, jsonb_build_object('covered', bit_count(sf.cover), 'live', to_jsonb(sf.live))), '{}'::jsonb)
                 from surfaces sf where sf.play in (select o.id from on_posts o where o.kind = 'card')),
    'tallies', (select coalesce(jsonb_agg(jsonb_build_object('act', t.act, 'kind', t.kind, 'count', t.count)), '[]'::jsonb)
                from reaction_tallies t where t.act in (select i.id from ids i)),
    'mine', (select coalesce(jsonb_agg(jsonb_build_object('act', m.act, 'kind', m.kind, 'character', m.character)), '[]'::jsonb)
             from my_reactions m where m.act in (select i.id from ids i)),
    'spun', (select coalesce(jsonb_agg(to_jsonb(l) - 'n' order by l.created_at, l.id), '[]'::jsonb) from spun l),
    'reading', (select r.furthest_seq from reading r where r.thread = thread_page.in_thread limit 1),
    'board', (select jsonb_build_object('id', b.id, 'slug', b.slug, 'name', b.name, 'description', b.description, 'is_system', b.is_system, 'move_act', b.move_act)
              from boards_now b where b.id = (select rng.board from rng)),
    'following', following_thread(thread_page.in_thread),
    'presence', presence_box('thread', thread_page.in_thread),
    'unread', my_alerts_unread()
  ) end;
end;

create or replace function profile_page(in_character uuid) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  with c as (
    select id, name, joined, staff, office, warn_points, banned_until, "group" from characters_public where id = in_character
  ), acts5 as (
    -- PROFILE_ROWS (engine/ui/profile/record.ts): the newest few of its own Acts, with no count.
    select a.* from acts_public a
    where a.character = in_character and a.kind in ('post', 'spin', 'card')
    order by a.created_at desc limit 5
  ), rv as (
    select r.act, r.character, r.class, r.at, r.via, r.thread from class_reveals r where r.character = in_character
  ), tn as (
    select t.act, t.character, t.at, t.was from turns_announced t where t.character = in_character
  )
  select case when not exists (select 1 from c) then null else jsonb_build_object(
    'character', (select to_jsonb(c) from c),
    'profile', (select to_jsonb(p) || profile_cosmetics(p.character) from (
      select character, title, signature, avatar_square, avatar_portrait, square_frame, portrait_frame, pip_style, pronouns
      from character_profiles where character = in_character) p),
    'counts', (select to_jsonb(n) from (select character, posts, spins, cards from character_post_counts where character = in_character) n),
    'standing', standing_place(in_character),
    'settled_at', (select s.ends_at from settlements s order by s.ends_at desc limit 1),
    'season', (select to_jsonb(s) from current_season s limit 1),
    'reveals', coalesce((select jsonb_agg(to_jsonb(r) order by r.at, r.act::text collate "C") from rv r), '[]'::jsonb),
    'turns', coalesce((select jsonb_agg(to_jsonb(t) order by t.at, t.act::text collate "C") from tn t), '[]'::jsonb),
    'acts', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from acts5 a), '[]'::jsonb),
    -- The card plays' target posts and the Turns' tallies, placed with one batched read (playLinks, turnLinks).
    'targets', coalesce((select jsonb_agg(to_jsonb(x)) from acts_public x
      where x.id in (select a.target_act_id from acts5 a where a.kind = 'card' and a.target_act_id is not null union select t.act from tn t)), '[]'::jsonb),
    'seasons', coalesce((select jsonb_agg(to_jsonb(a) order by a.at desc, a.season desc) from (
      select f.number as season, r.place, r.standing, f.results_at as at
      from season_results r join seasons_finished f on f.id = r.season
      where r.character = in_character
      order by f.results_at desc, f.number desc limit 50) a), '[]'::jsonb),
    'unread', my_alerts_unread()
  ) end;
end;

create or replace function record_page(in_character uuid, in_kind text, in_page integer) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  with c as (
    select id, name, joined, staff, office, warn_points, banned_until, "group" from characters_public where id = in_character
  ), k as (
    select case when in_kind in ('all', 'post', 'spin', 'card', 'class', 'seasons') then in_kind else 'all' end as kind,
           least(greatest(coalesce(in_page, 1), 1), 10000) as page
  ), rv as (
    select r.act, r.character, r.class, r.at, r.via, r.thread from class_reveals r, k
    where r.character = in_character and k.kind in ('all', 'class')
  ), tn as (
    select t.act, t.character, t.at, t.was from turns_announced t, k
    where t.character = in_character and k.kind in ('all', 'class')
  ), seasons_read as (
    select f.number as season, r.place, r.standing, f.results_at as at
    from season_results r join seasons_finished f on f.id = r.season, k
    where k.kind in ('all', 'seasons') and r.character = in_character
    order by f.results_at desc, f.number desc limit 50
  ), w as (
    -- The window of the character's own Acts: for `all`, from `max(0, offset - extras)` for `offset + 20 - from` rows
    -- (the extras are merged in by the client, `mergeWindow`); for one kind, the page itself; for class and seasons, none.
    select case k.kind when 'all' then array['post', 'spin', 'card'] when 'post' then array['post'] when 'spin' then array['spin']
                       when 'card' then array['card'] else array[]::text[] end as kinds,
           case when k.kind = 'all' then greatest(0, (k.page - 1) * 20 - ((select count(*) from rv) + (select count(*) from tn) + (select count(*) from seasons_read)))
                else (k.page - 1) * 20 end as from_row,
           case when k.kind = 'all' then (k.page - 1) * 20 + 20 else 20 end as base
    from k
  ), acts_read as (
    -- The kinds as an init plan, so the planner keeps the ordered scan of the character's Acts with the limit pushed down.
    select a.* from acts_public a
    where a.character = in_character and a.kind = any (((select kinds from w)::text[]))
    order by a.created_at desc
    offset (select from_row from w)
    limit (select case when k.kind = 'all' then w.base - w.from_row else 20 end from w, k)
  )
  select case when not exists (select 1 from c) then null else jsonb_build_object(
    'kind', (select kind from k),
    'page', (select page from k),
    'character', (select to_jsonb(c) from c),
    'profile', (select to_jsonb(p) || profile_cosmetics(p.character) from (
      select character, title, signature, avatar_square, avatar_portrait, square_frame, portrait_frame, pip_style, pronouns
      from character_profiles where character = in_character) p),
    -- RecordScreen reads the counters for all, post, spin and card only.
    'counts', (select to_jsonb(n) from (select character, posts, spins, cards from character_post_counts where character = in_character and (select kind from k) in ('all', 'post', 'spin', 'card')) n),
    'reveals', coalesce((select jsonb_agg(to_jsonb(r) order by r.at, r.act::text collate "C") from rv r), '[]'::jsonb),
    'turns', coalesce((select jsonb_agg(to_jsonb(t) order by t.at, t.act::text collate "C") from tn t), '[]'::jsonb),
    'seasons', coalesce((select jsonb_agg(to_jsonb(a) order by a.at desc, a.season desc) from seasons_read a), '[]'::jsonb),
    'acts', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from acts_read a), '[]'::jsonb),
    'targets', coalesce((select jsonb_agg(to_jsonb(x)) from acts_public x
      where x.id in (select a.target_act_id from acts_read a where a.kind = 'card' and a.target_act_id is not null union select t.act from tn t)), '[]'::jsonb),
    'unread', my_alerts_unread()
  ) end;
end;

create or replace function alerts_page(in_before timestamptz) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  with recursive al as (
    select to_jsonb(a) - 'ordinality' as j, a.ordinality as o
    from my_alerts(in_before, 30) with ordinality as a
  ), chain(id, depth, ended) as (
    select (al.j ->> 'act')::uuid, 1, al.j ->> 'kind' = 'cardEnded' from al where al.j ->> 'act' is not null
    union
    select x.target_act_id, c.depth + 1, c.ended
    from chain c join acts_public x on x.id = c.id
    where (c.depth < 2 or (c.depth < 3 and c.ended)) and x.target_act_id is not null
  ), ac as (
    select a.* from acts_public a where a.id in (select c.id from chain c)
  ), th as (
    select distinct (al.j ->> 'thread')::uuid as id from al where al.j ->> 'kind' = 'followed' and al.j ->> 'thread' is not null
  )
  select jsonb_build_object(
    'alerts', coalesce((select jsonb_agg(al.j order by al.o) from al), '[]'::jsonb),
    'seenAt', (select p.alerts_seen_at from account_preferences p limit 1),
    'openedAt', my_account_opened(),
    'acts', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at, a.id::text collate "C") from ac a), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(f.face order by f.name) from (
        select cp.name, to_jsonb(cp) || jsonb_build_object('profile', (
          select to_jsonb(p) || profile_cosmetics(p.character) from (
            select r.character, r.title, r.signature, r.avatar_square, r.avatar_portrait, r.square_frame, r.portrait_frame, r.pip_style, r.pronouns
            from character_profiles r where r.character = cp.id) p)) as face
        from (select c.id, c.name, c.joined, c.staff, c.office, c."group" from characters_public c
              where c.id in (select a.character from ac a where a.id in (select h.id from chain h where h.depth = 3))) cp) f), '[]'::jsonb),
    'openings', coalesce((select jsonb_agg(to_jsonb(a) order by a.thread::text collate "C") from acts_public a where a.thread in (select t.id from th t) and a.seq = 1), '[]'::jsonb),
    'reading', coalesce((select jsonb_agg(to_jsonb(r) order by r.thread::text collate "C") from (
      select g.thread, g.furthest_seq from reading g where g.thread in (select t.id from th t)) r), '[]'::jsonb)
  );
end;

create or replace function log_page(in_before timestamptz) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  with recursive
  mine as (
    select m.id, m.class_since from my_characters m
  ), lg as materialized (
    select l.settlement, l.starts_at, l.ends_at, l.character, l.reason, l.amount, l.shares_kept, l.params
    from my_ledger l where in_before is null or l.ends_at <= in_before
    order by l.ends_at desc, l.settlement, l.character, l.reason limit 200
  ), wl as materialized (
    select e.settlement, e.kind, e.change, e.overflow, e.floored, e.balance_after, e.ref, e.at
    from my_wallet_events e where in_before is null or e.at <= in_before
    order by e.at desc, e.settlement, e.kind, e.ref, e.change, e.overflow, e.floored, e.balance_after limit 200
  ), cd as materialized (
    select c.card, c.kind, c.act, c.price, c.at, c.springs, c.pack, c.repriced
    from my_card_ledger c where in_before is null or c.at <= in_before
    order by c.at desc, c.card, c.kind, c.act, c.price, c.pack limit 200
  ), pk as materialized (
    select p.id, p.pack, p.price, p.repriced, p.contents, p.bought_at
    from my_packs p where in_before is null or p.bought_at <= in_before
    order by p.bought_at desc, p.id limit 200
  ), po as materialized (
    select p.play, p.post, p.at, p.reach, p.target_name, p.target_character
    from my_posts_played_on p where in_before is null or p.at <= in_before
    order by p.at desc, p.play limit 200
  ), wr as materialized (
    select w.play, w.post, w.version, w.failed, w.opening, w.over, w.at
    from my_posts_written_on w where in_before is null or w.at <= in_before
    order by w.at desc, w.play, w.version limit 200
  ), dr as materialized (
    select r.act, r.kind, r.play, r.post, r.character, r.mine, r.at, r.cells
    from my_draws r where in_before is null or r.at <= in_before
    order by r.at desc, r.act, r.mine limit 200
  ), wd as materialized (
    select r.act, r.kind, r.play, r.post, r.character, r.mine, r.at, r.cells
    from my_walls_drawn_on r where in_before is null or r.at <= in_before
    order by r.at desc, r.act, r.mine limit 200
  ), sv as materialized (
    select p.play, p.post, p.saved_at
    from my_posts_played_on p where p.saved_at is not null and (in_before is null or p.saved_at <= in_before)
    order by p.saved_at desc, p.play limit 200
  ), se as materialized (
    select f.play, f.card, f.post, f.spring, f.ended_at, f.ended_by
    from my_face_down f where f.ended_at is not null and (in_before is null or f.ended_at <= in_before)
    order by f.ended_at desc, f.play limit 200
  ), sp as materialized (
    select f.play, f.card, f.post, f.ends_at, f.passed_at
    from my_face_down f where f.passed_at is not null and f.spring is null and (in_before is null or f.passed_at <= in_before)
    order by f.passed_at desc, f.play limit 200
  ), ca as materialized (
    select c.play, c.card, c.post, c.trap, c.spring, c.price, c.at
    from my_caught c where in_before is null or c.at <= in_before
    order by c.at desc, c.play limit 200
  ), en as materialized (
    select e.card_end, e.play, e.card, e.at, e.side, e.reach, e.target_name, e.post_author_name, e.caster_name, e.character
    from my_cards_ended e where in_before is null or e.at <= in_before
    order by e.at desc, e.card_end limit 200
  ), inf as materialized (
    select i.infraction, i.character, i.at, i.band, i.points, i.rule_number, i.rule, i.mod_name, i.post, i.post_seq, i.thread, i.expires_at, i.relief, i.emptied_at
    from my_infractions i where in_before is null or i.at <= in_before
    order by i.at desc, i.infraction limit 200
  ), bn as materialized (
    select b.ban, b.character, b.at, b.days, b.until, b.infraction, b.rule, b.thread, b.ruling, b.own_until
    from my_bans b where in_before is null or b.at <= in_before
    order by b.at desc, b.ban limit 200
  ), gm as materialized (
    select g.move, g.character, g.at, g.thread, g.seq, g."group", g.board, g.board_name, g.expires_at, g.landed_until, g.check_at, g.demand, g.office,
           g.ended_why, g.ended_by, g.ended_at, g.ruling, g.ruled_at, g.ruled_until, g.ruled_office
    from my_group_moves g where in_before is null or g.at <= in_before
    order by g.at desc, g.move limit 200
  ), rp as materialized (
    select r.report, r.character, r.at, r.post, r.post_seq, r.thread, r.verdict, r.verdict_at, r.mod_name, r.refund
    from my_reports r where in_before is null or r.at <= in_before
    order by r.at desc, r.report limit 200
  ), ap as materialized (
    select a.appeal, a.character, a.at, a.punishment, a.punishment_kind, a.post_seq, a.thread, a.verdict, a.ruled_at, a.points_delta, a.hearer_name, a.refund
    from my_appeals a where in_before is null or a.at <= in_before
    order by a.at desc, a.appeal limit 200
  ), cs as materialized (
    select c.kind, c.id, c.at, c.character, c.outcome, c.item, c.text, c.copies, c.trophy, c.name, c.by, c.by_name, c.season, c.place, c.line, c.to_name
    from cosmetic_log_rows(in_before, 200) c
    order by c.at desc, c.kind, c.id
  ), sh as materialized (
    select s.settlement, s.character, s.reason, s.act, s.quadrant, s.amount, s.card
    from my_ledger_shares s where s.settlement in (select x.settlement from lg x)
  ), sa as materialized (
    select s.settlement, s.character, s.named_class, s.play, s.card, s.starts_at, s.ends_at
    from my_scored_as s where in_before is null or s.ends_at <= in_before
    order by s.ends_at desc, s.settlement, s.character limit 200
  ), tn as materialized (
    select t.act, t.character, t.at, t.was from turns_announced t where t.character in (select m.id from mine m)
  ), named(id) as (
    -- actsNamed (engine/ui/log/lines.ts) over every row read; the Turns are the latest one of each character, the one announced as its class began.
    select x.act from sh x where x.act is not null
    union select t.act from tn t where exists (select 1 from mine m where m.id = t.character and date_trunc('milliseconds', m.class_since) = date_trunc('milliseconds', t.at))
    union select x.act from cd x where x.act is not null
    union select x.play from po x union select x.post from po x where x.post is not null
    union select x.play from wr x union select x.post from wr x
    union select x.play from dr x union select x.post from dr x
    union select x.play from wd x union select x.post from wd x
    union select x.play from sv x union select x.post from sv x where x.post is not null
    union select x.post from se x where x.post is not null union select x.spring from se x where x.spring is not null
    union select x.post from sp x where x.post is not null
    union select x.play from ca x union select x.post from ca x where x.post is not null
    union select x.play from en x
    union select x.ref from wl x where x.kind in ('bribe', 'gift_out', 'gift_in') and x.ref is not null
  ), walk(id, depth) as (
    -- actsFollowed, twice: what the Acts read lead to. A loop costs the two rounds as a chain does.
    select n.id, 0 from named n
    union
    select f.id, w.depth + 1
    from walk w
    join acts_public a on a.id = w.id
    cross join lateral (values
      (case when a.kind in ('card', 'spring', 'set', 'donation') then a.target_act_id end),
      (case when a.kind = 'intercept' and a.payload ->> 'visit_act' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.payload ->> 'visit_act')::uuid end),
      (case when a.kind in ('spring', 'card') and a.payload ->> 'spring' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.payload ->> 'spring')::uuid end),
      (case when a.kind = 'spring' and a.payload ->> 'caught' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.payload ->> 'caught')::uuid end),
      (case when a.kind = 'spring' and a.payload ->> 'by' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.payload ->> 'by')::uuid end)
    ) f(id)
    where w.depth < 2 and f.id is not null
  ), ac as materialized (
    select a.* from acts_public a where a.id in (select w.id from walk w)
  ), reach as materialized (
    -- A play beyond a post carries its target's name (play_card, 0056); one written without reads it as it stands, so its target is named here.
    select a.payload ->> 'reach' as kind,
           case when a.payload ->> (a.payload ->> 'reach') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.payload ->> (a.payload ->> 'reach'))::uuid end as target
    from ac a
    where a.kind = 'card' and jsonb_typeof(a.payload -> 'targetName') is distinct from 'string' and a.payload ->> 'reach' in ('character', 'thread', 'board')
  ), pe(id) as (
    select a.character from ac a where a.character is not null and a.character not in (select m.id from mine m)
    union select x.character from dr x where x.character not in (select m.id from mine m)
    union select x.character from wd x where x.character not in (select m.id from mine m)
    union select r.target from reach r where r.kind = 'character' and r.target is not null and r.target not in (select m.id from mine m)
  ), th(id) as (
    select a.thread from ac a where a.id in (select t.act from tn t where exists (select 1 from mine m where m.id = t.character and date_trunc('milliseconds', m.class_since) = date_trunc('milliseconds', t.at)))
    union select r.target from reach r where r.kind = 'thread' and r.target is not null
  )
  select jsonb_build_object(
    'sources', jsonb_build_object(
      'ledger', coalesce((select jsonb_agg(to_jsonb(x) order by x.ends_at desc, x.settlement, x.character, x.reason) from lg x), '[]'::jsonb),
      'wallet', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.settlement, x.kind, x.ref, x.change, x.overflow, x.floored, x.balance_after) from wl x), '[]'::jsonb),
      'cards', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.card, x.kind, x.act, x.price, x.pack) from cd x), '[]'::jsonb),
      'packs', coalesce((select jsonb_agg(to_jsonb(x) order by x.bought_at desc, x.id) from pk x), '[]'::jsonb),
      'playsOnMine', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.play) from po x), '[]'::jsonb),
      'writes', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.play, x.version) from wr x), '[]'::jsonb),
      'draws', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.act, x.mine) from dr x), '[]'::jsonb),
      'wallsDrawn', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.act, x.mine) from wd x), '[]'::jsonb),
      'saves', coalesce((select jsonb_agg(to_jsonb(x) order by x.saved_at desc, x.play) from sv x), '[]'::jsonb),
      'setEnds', coalesce((select jsonb_agg(to_jsonb(x) order by x.ended_at desc, x.play) from se x), '[]'::jsonb),
      'setPasses', coalesce((select jsonb_agg(to_jsonb(x) order by x.passed_at desc, x.play) from sp x), '[]'::jsonb),
      'caught', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.play) from ca x), '[]'::jsonb),
      'ended', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.card_end) from en x), '[]'::jsonb),
      'infractions', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.infraction) from inf x), '[]'::jsonb),
      'bans', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.ban) from bn x), '[]'::jsonb),
      'groupMoves', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.move) from gm x), '[]'::jsonb),
      'reports', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.report) from rp x), '[]'::jsonb),
      'appeals', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.appeal) from ap x), '[]'::jsonb),
      'cosmetics', coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc, x.kind, x.id) from cs x), '[]'::jsonb)),
    'shares', coalesce((select jsonb_agg(to_jsonb(x) order by x.settlement desc, x.character, x.reason, x.card, x.act, x.quadrant) from sh x), '[]'::jsonb),
    'scoredAs', coalesce((select jsonb_agg(to_jsonb(x) order by x.ends_at desc, x.settlement, x.character) from sa x), '[]'::jsonb),
    'acts', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at, a.id::text collate "C") from ac a), '[]'::jsonb),
    'states', coalesce((select jsonb_agg(to_jsonb(e) order by e.play::text collate "C") from (
      select s.play, s.state, s.saved_at from effect_state s where s.play in (select v.play from sv v)) e), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(f.face order by f.name, f.id) from (
        select cp.name, cp.id, to_jsonb(cp) || jsonb_build_object('profile', (
          select to_jsonb(p) || profile_cosmetics(p.character) from (
            select r.character, r.title, r.signature, r.avatar_square, r.avatar_portrait, r.square_frame, r.portrait_frame, r.pip_style, r.pronouns
            from character_profiles r where r.character = cp.id) p)) as face
        from (select c.id, c.name, c.joined, c.staff, c.office, c."group" from characters_public c where c.id in (select p.id from pe p)) cp) f), '[]'::jsonb),
    'threads', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at, t.id::text collate "C") from thread_open t where t.id in (select h.id from th h)), '[]'::jsonb),
    'boards', coalesce((select jsonb_agg(to_jsonb(b) order by b.id::text collate "C") from (
      select n.id, n.slug, n.name, n.description, n.is_system, n.move_act from boards_now n
      where n.id in (select r.target from reach r where r.kind = 'board' and r.target is not null)) b), '[]'::jsonb),
    'standings', coalesce((select jsonb_agg(to_jsonb(s) order by s.character::text collate "C") from (
      select c.character, c.standing from current_standings c where c.character in (select m.id from mine m)) s), '[]'::jsonb),
    'turns', coalesce((select jsonb_agg(to_jsonb(t) order by t.at, t.act::text collate "C") from tn t), '[]'::jsonb),
    'season', (select to_jsonb(s) from current_season s limit 1)
  );
end;

-- ----------------------------------------------------------------------------------------------------- settings ----

-- The `conduct` setting: exactly the fields of ConductSettings (engine/rules/types.ts): openReportsMost, a whole number, at least 1, and adminAddress, null (not
-- set yet) or a string containing "@" (`conductRule` in engine/rules/instance.ts). supabase/tests/0079-settings-held.sql lists its poisons and goods.
create function setting_conduct(v jsonb) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  shape constant text := 'an object giving openReportsMost (the most reports to admins one account holds open, a whole number, at least 1) and adminAddress (null, or an email address containing "@")';
  k text;
begin
  if jsonb_typeof(v) is distinct from 'object' then return shape; end if;
  select e into k from jsonb_object_keys(v) e where e <> all (array['openReportsMost', 'adminAddress']) limit 1;
  if k is not null then return format('%s; "%s" is not one of its fields', shape, k); end if;
  if not setting_whole(v -> 'openReportsMost', 1) then return format('%s; "openReportsMost" is not', shape); end if;
  if not (v ? 'adminAddress') or not (jsonb_typeof(v -> 'adminAddress') = 'null' or (jsonb_typeof(v -> 'adminAddress') = 'string' and (v ->> 'adminAddress') like '%@%')) then
    return format('%s; "adminAddress" is not', shape);
  end if;
  return null;
end $$;
revoke execute on function setting_conduct(jsonb) from public, anon, authenticated;

-- settings_held (0130), also holding `conduct` and the two settings the seed writes beside it, `conductVersion` and `conductSections`. Everything else as 0130 wrote it.
create or replace function public.settings_held()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v jsonb := new.value;
  why text;
  shape text;
  phase text;
  pkey text;
  kinds text[] := array['quote', 'cardOnYours', 'trapStruck', 'trapSprang', 'hint', 'ruling', 'settlement', 'followed', 'update', 'seasonNews', 'cardEnded', 'framed', 'trophy', 'beltLost', 'beltBack'];
begin
  why := case new.key
    when 'walletCap' then case when not setting_whole(v, 1) then 'a whole number of hundredths, at least 1' end
    when 'vote' then case when not setting_whole(v, 1) then 'a whole number of hundredths, at least 1' end
    when 'halving' then case when not coalesce(jsonb_typeof(v) = 'number' and setting_positive(v) and (v #>> '{}')::numeric <= 1, false)
      then 'a fraction above 0 and at most 1' end
    when 'reactionCap' then case when not setting_whole(v, 1) then 'a whole number, at least 1' end
    when 'charactersPerPlayer' then case when not setting_whole(v, 1) then 'a whole number, at least 1' end
    when 'settlementCron' then case when not setting_cron(v) then 'a five-field cron expression, each field inside its range' end
    when 'viewCountCron' then case when not setting_cron(v) then 'a five-field cron expression, each field inside its range' end
    when 'meetingCron' then case when not setting_cron(v) then 'a five-field cron expression, each field inside its range' end
    -- The spans the earlier triggers hold, but let through with a field missing.
    when 'settlementLength' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'seasonLength' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'turnCooldown' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'inviteLifetime' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'setLasts' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'editGrace' then case when not setting_span(v, array['minute', 'day', 'week', 'month']) then 'a span: a unit of minute, day, week or month and a whole count from 1 to 1000' end
    when 'presenceWindow' then case when not setting_span(v, array['minute', 'day', 'week', 'month']) then 'a span: a unit of minute, day, week or month and a whole count from 1 to 1000' end
    when 'registrationMode' then case when v not in ('"open"', '"invite"', '"closed"') then '"open", "invite" or "closed"' end
    when 'postMaxLength' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'titleMaxLength' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'postsPerPage' then case when not setting_whole(v, 1) then 'a whole number of posts, at least 1' end
    when 'hotReplies' then case when not setting_whole(v, 1) then 'a whole number of replies, at least 1' end
    when 'presenceNames' then case when not setting_whole(v, 1) then 'a whole number of names, at least 1' end
    when 'presencePollSeconds' then case when not setting_whole(v, 10, 300) then 'a whole number of seconds from 10 to 300' end
    when 'cardSettings' then case when not setting_named_numbers(v) then 'an object of named numbers' end
    when 'systemEnabled' then case when jsonb_typeof(v) is distinct from 'boolean' then 'true or false' end
    when 'oldVoice' then case when jsonb_typeof(v) is distinct from 'boolean' then 'true or false' end
    when 'cardWriteSettleSeconds' then case when not setting_whole(v, 0, 600) then 'a whole number of seconds, at least 0 and at most 600' end
    when 'hints' then case when not coalesce(jsonb_typeof(v) = 'object'
        and setting_whole(v -> 'least', 1)
        and jsonb_typeof(v -> 'share') = 'number' and (v ->> 'share')::numeric > 0.5 and (v ->> 'share')::numeric <= 1
        and jsonb_typeof(v -> 'split') = 'number' and setting_positive(v -> 'split') and (v ->> 'split')::numeric <= 0.5
        and setting_span(v -> 'window', array['minute', 'day', 'week', 'month']), false)
      then 'an object giving least (a whole number of reactions, at least 1), share (above 0.5, at most 1), split (above 0, at most 0.5) and window (a span: a unit of minute, day, week or month and a whole count from 1 to 1000)' end
    when 'toastDefaults' then case when not coalesce(jsonb_typeof(v) = 'array'
        and not exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'string' or (e #>> '{}') <> all (kinds))
        and (select count(*) = count(distinct e) from jsonb_array_elements(v) e), false)
      then 'a list of the kinds of alert that toast (' || array_to_string(kinds, ', ') || '), each named once' end
    when 'phases' then null  -- below: it needs a loop
    when 'inheritanceGraceDays' then case when not setting_whole(v, 0) then 'a whole number of days, at least 0' end
    when 'rosterRecentExcluded' then case when not setting_whole(v, 0) then 'a whole number of Bosses, at least 0' end
    when 'structuralHoldHours' then case when not setting_whole(v, 1) then 'a whole number of hours, at least 1' end
    when 'microEventDailyCalls' then case when not setting_whole(v, 0) then 'a whole number of calls, at least 0' end
    when 'digestThreads' then case when not setting_whole(v, 1, 25) then 'a whole number of threads, at least 1 and at most 25' end
    when 'digestExcerpts' then case when not setting_whole(v, 1, 20) then 'a whole number of posts, at least 1 and at most 20' end
    when 'digestExcerptChars' then case when not setting_whole(v, 1, 1000) then 'a whole number of characters, at least 1 and at most 1000' end
    when 'memoryOpinions' then case when not setting_whole(v, 1) then 'a whole number of opinions, at least 1' end
    when 'memoryGrudges' then case when not setting_whole(v, 1) then 'a whole number of grudges, at least 1' end
    when 'memoryWheelhouse' then case when not setting_whole(v, 1) then 'a whole number of subjects, at least 1' end
    when 'memoryRealWorld' then case when not setting_whole(v, 1) then 'a whole number of subjects, at least 1' end
    when 'boardNameMaxLength' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'moveExpiryMostDays' then case when not setting_whole(v, 1) then 'a whole number of days, at least 1' end
    when 'moveExpiryLeastHours' then case when not setting_whole(v, 1) then 'a whole number of hours, at least 1' end
    when 'demandCheckMinutes' then case when not setting_whole(v, 1, 1440) then 'a whole number of minutes, at least 1 and at most 1440' end
    when 'demandChecksPerTick' then case when not setting_whole(v, 1, 1000) then 'a whole number of moves, at least 1 and at most 1000' end
    when 'searchLanguage' then case when not coalesce(jsonb_typeof(v) = 'string' and exists (select 1 from pg_ts_config c where c.cfgname = v #>> '{}'), false)
      then 'the name of a text search configuration this database holds (english or simple, for example)' end
    when 'searchRankPool' then case when not setting_whole(v, 100, 100000) then 'a whole number of matches from 100 to 100,000' end
    when 'pool' then setting_pool(v)
    when 'modBots' then setting_modbots(v)
    when 'warnBar' then setting_warnbar(v)
    when 'pronouns' then case when not pronouns_hold(pronouns_lowered(v)) then 'an object of five words of 1 to 12 letters each (an apostrophe or a hyphen between two letters is allowed) and a plural, true or false' end
    when 'apology' then setting_apology(v)
    when 'conduct' then setting_conduct(v)
    when 'conductVersion' then case when not setting_whole(v, 1) then 'a whole number, at least 1 (the version of the code of conduct)' end
    when 'conductSections' then case when not coalesce(jsonb_typeof(v) = 'array'
        and not exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) is distinct from 'string' or btrim(e #>> '{}', E' \t\n\r\f\v') = ''), false)
      then 'an array of section keys, each a non-blank string' end
    when 'cosmetics' then setting_cosmetics(v)
    when 'modelTiers' then case when not coalesce(jsonb_typeof(v) = 'object'
        and jsonb_typeof(v -> 'strong') = 'string' and btrim(v ->> 'strong', E' \t\n\r\f\v') <> ''
        and jsonb_typeof(v -> 'light') = 'string' and btrim(v ->> 'light', E' \t\n\r\f\v') <> '', false)
      then 'an object naming a model id for "strong" and for "light"' end
    else null
  end;
  if new.key = 'phases' then
    shape := 'an object of honeymoon, reign and meltdown, each holding its numbers (honeymoon and meltdown also their days) as whole numbers, at least 1';
    if jsonb_typeof(v) <> 'object' then raise exception 'phases is %', shape using errcode = '23514'; end if;
    foreach phase in array array['honeymoon', 'reign', 'meltdown'] loop
      if jsonb_typeof(v -> phase) is distinct from 'object' then raise exception 'phases is %; "%" is missing', shape, phase using errcode = '23514'; end if;
      foreach pkey in array case when phase = 'reign' then array['weeklyMoves', 'bankCap', 'moveExpiryMostDays']
                                 else array['days', 'weeklyMoves', 'bankCap', 'moveExpiryMostDays'] end loop
        if not setting_whole(v -> phase -> pkey, 1) then raise exception 'phases is %; "%.%" is not', shape, phase, pkey using errcode = '23514'; end if;
      end loop;
      select k into pkey from jsonb_object_keys(v -> phase) k
        where k <> all (case when phase = 'reign' then array['weeklyMoves', 'bankCap', 'moveExpiryMostDays']
                             else array['days', 'weeklyMoves', 'bankCap', 'moveExpiryMostDays'] end) limit 1;
      if pkey is not null then raise exception 'phases is %; "%.%" is not a number a phase holds', shape, phase, pkey using errcode = '23514'; end if;
    end loop;
  end if;
  if why is not null then raise exception '% is %', new.key, why using errcode = '23514'; end if;
  return new;
end $function$;
revoke execute on function settings_held() from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------ who calls ----

revoke execute on function conduct_author(uuid), conduct_write(bigint, uuid, uuid, text, timestamptz, text),
  account_bar(uuid), refuse_if_barred(uuid) from public, anon, authenticated;
-- acts_public calls two functions with its readers' privileges (the digest's role and the service role read it too);
-- every other helper is reached through those and runs as its owner.
revoke execute on function version_hidden(uuid, uuid), version_hidden(uuid), quote_hidden(uuid) from public, anon, authenticated;
revoke execute on function version_hidden(uuid) from authenticated;
grant execute on function version_hidden(uuid, uuid), quote_hidden(uuid) to authenticated, service_role, kayfabb_digest;
-- acts_public reads the layer through these (security definer, so no one reads quote_layers or quote_refs itself).
revoke execute on function conceal_layer(uuid), shown_payload(jsonb, boolean, boolean, boolean, text) from public, anon, authenticated;
grant execute on function conceal_layer(uuid), shown_payload(jsonb, boolean, boolean, boolean, text) to authenticated, service_role, kayfabb_digest;
revoke execute on function accept_conduct(integer), conduct_accepted(), report_post(uuid, text, text), decide_report(bigint, jsonb), decide(uuid, uuid, text, timestamptz, text),
  admin_version(uuid), my_bar(), my_conduct_log(integer) from public, anon;
grant execute on function accept_conduct(integer), conduct_accepted(), report_post(uuid, text, text), decide_report(bigint, jsonb), decide(uuid, uuid, text, timestamptz, text),
  admin_version(uuid), my_bar(), my_conduct_log(integer) to authenticated;
-- hidden_versions is the service's and an admin screen's, no API role's. reviews_due is granted to signed-in players on purpose: the view itself returns no row
-- unless is_admin(), so a player's read is empty and an admin's (Task 7's screen) is the list; anon has no grant (0005 lists it among the readable).
revoke all on hidden_versions, reviews_due from public, anon, authenticated;
grant select on reviews_due to authenticated;
