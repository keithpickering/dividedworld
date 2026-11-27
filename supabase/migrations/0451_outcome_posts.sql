-- A Mod's outcome is a post in the thread (docs/plans/2026-11-26-outcome-posts-design.md; its plan, Task 1).
--
-- Four outcomes post as a staff character, each where its story is, quoting what it answers: a visit filed (at once, in file_visit); a visit talked down (owed by the talk-down, written by the next staff run, or posted from
-- the persona's stock past `concessionWriteMinutes`); an appeal ruled on (at once, in close_appeal: an infraction's in the punished post's thread, a group move's in the move's staff thread, a ban's in its season's Banlist
-- quoting the ban's entry); a ban (owed by `infract`, written by the next staff run, or posted from stock past `owedLines.graceMinutes`, or by a ruling on the ban first). One outcome post per outcome, best effort: a refused post
-- leaves the outcome standing and is recorded.
--
-- outcome_posts     one row per outcome whose post was tried, keyed by the Act the outcome is about (a `visit_end`, an `appeal_ruling`, or for a ban's entry the `ban`): its kind, the visit it belongs to (null for a ban's entry, a ban's
--                   ruling and a move's ruling, which carry no visit mark), its source (`model` or `stock`), the post's Act or the refusal's words. Its primary key is the one-post guard. Append-only; no client reads it.
-- concessions_owed  a talk-down's debt: the visit, its end, who talked the Mod down and how. No client reads it. Owed and unpaid: a row with no outcome_posts row for its `end_act`.
-- bans_owed         a ban's entry's debt, written by infract (the one writer of a ban): the ban, the Mod whose infraction filled the bar, the ban's season (a number). Owed and unpaid: a row with no outcome_posts row for its ban.
--                   A ban written before this change has none, and its ruling posts nothing.
-- seasons.banlist_thread, banlist_thread(season)   the season's Banlist, opened by its first entry on the system board, titled by the copy's `banlistThreadTitle`; written as meetings_thread (0439) is. It follows the system board's
--                   flag through instance_thread_rows().
-- ban_entry_head(ban)     the code line of an entry: the copy's `banlistEntry` with {character}, {days}, {rule} and {post} filled from the ban.
-- post_outcome(...)       internal, no role. The one place an outcome post is written: under the outcome's own lock, once, inside a block of its own so a refusal rolls back only the post (and the Banlist a first entry opened).
-- post_ban_entry(ban, line, source), post_visit_concession(visit, body)   service only: the staff run's writes (and, from stock, the tick's and close_appeal's). Each answers {posted, existing, post, error}.
-- pending_concessions(most), pending_ban_entries(most)   service only: what the staff run reads, newest window only.
-- visit_outcome_posts(visit)   anon, authenticated and service: [{kind, about, post}] for a visit's outcome posts that are public posts (replaces visit_concession_post).
-- outcome_page_rows(posts)     the page's join from a list of posts to the visits whose outcome post each is, by the post's id (indexed); thread_page reads as its caller, who reads no column of outcome_posts.
--
-- Latest definitions copied (each confirmed with grep): infract (0361_discipline_cards.sql), file_visit and close_appeal (0423_rulings_alerts.sql), intercept (0449_concession_post.sql), distract_visits
-- (0449_concession_post.sql), system_tick (0449_concession_post.sql), thread_page (0438_board_cards_on_their_board.sql), instance_thread_rows (0437_move_threads.sql), standing_order_line_calls_today (0445_persona_lines.sql),
-- the duty check of staff_call_records (0449_concession_post.sql).
--
-- Replaced from 0449: post_concession, write_visit_concession and visit_concession_post are dropped, and so is visits_open.concession_at with its two triggers. visit_concessions, visit_concession_posts and staff_concessions
-- stay as written (the posts' rows are carried into outcome_posts below; staff_concessions is still the persona's stock).
--
-- Outcomes already held: no post is made for an outcome that ended before this migration. Each visit_concession_posts row is copied into outcome_posts. A visit open now and talked down later owes a concession like any
-- other. A ban written before this owes no entry, and its ruling posts nothing. A move landed before this and ruled on after posts its ruling when its thread is a staff thread.
--
-- Masks. Nothing here reads an owner, a class or a reactor. A post names a character; a ban's entry names the banned character, its days from the ban, its rule from the infraction and links a public post. When a post lands
-- depends on the outcome and the staff run's clock; whether it lands depends only on the Mod's character and the thread. outcome_posts.error reaches no page. The page read returns only public post ids for a public visit.
-- Ways out. An owed concession ends by itself, as a post, within `concessionWriteMinutes` and a tick; an owed ban entry within `owedLines.graceMinutes` and a tick, or at the ban's ruling. The Banlist is read-only to players as
-- every thread on the system board is (not_the_systems).
-- Scale. One row per outcome. The tick and the staff run find what is owed by an index on `at`, reading the open sets (concessions_owed_open, bans_owed_open: a row for each debt unsettled, gone when its outcome post is recorded), so the scan is bounded by what is unpaid and never by the instance's history, and
-- no debt is too old to be paid. The page's join is by the post's id, indexed, over the page's own posts.

-- ------------------------------------------------------------------------------------------------ the tables ----

create table outcome_posts (
  about_act uuid primary key references acts (id),
  kind text not null check (kind in ('filed', 'intercepted', 'ruling', 'banned', 'ban_ruling', 'move_ruling')),
  visit_act uuid references acts (id),
  source text not null check (source in ('model', 'stock')),
  post_act uuid references acts (id),
  error text,
  at timestamptz not null default now(),
  -- Posted, or refused with its reason; never both and never neither.
  constraint outcome_posts_outcome check ((post_act is null) = (error is not null))
);
create index outcome_posts_post on outcome_posts (post_act) where post_act is not null;
create index outcome_posts_visit on outcome_posts (visit_act) where visit_act is not null;
alter table outcome_posts enable row level security;
revoke all on outcome_posts from public, anon, authenticated;

create table concessions_owed (
  visit_act uuid primary key references acts (id),
  end_act uuid not null references acts (id),
  interceptor uuid not null references characters (id),
  how text not null check (how in ('answered', 'paid', 'distracted')),
  intercept_act uuid references acts (id),
  at timestamptz not null default now()
);
create index concessions_owed_at on concessions_owed (at);
alter table concessions_owed enable row level security;
revoke all on concessions_owed from public, anon, authenticated;

create table bans_owed (
  ban_act uuid primary key references acts (id),
  staff text not null references characters (staff),
  season integer not null,
  at timestamptz not null default now()
);
create index bans_owed_at on bans_owed (at);
alter table bans_owed enable row level security;
revoke all on bans_owed from public, anon, authenticated;

-- The open sets (as lines_owed_open is, 0445): a row for each debt not yet settled, so the tick and the staff run read the unsettled alone, oldest first by `at`, and never the debts' history. A row is made beside its owed row
-- and goes when the outcome post (posted or refused) is recorded. The owed tables themselves stay append-only.
create table concessions_owed_open (
  visit_act uuid primary key references acts (id),
  end_act uuid not null unique references acts (id),
  at timestamptz not null
);
create index concessions_owed_open_at on concessions_owed_open (at, visit_act);
create table bans_owed_open (
  ban_act uuid primary key references acts (id),
  at timestamptz not null
);
create index bans_owed_open_at on bans_owed_open (at, ban_act);
alter table concessions_owed_open enable row level security;
alter table bans_owed_open enable row level security;
revoke all on concessions_owed_open from public, anon, authenticated;
revoke all on bans_owed_open from public, anon, authenticated;

create function outcome_owed_open() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_table_name = 'concessions_owed' then
    insert into concessions_owed_open (visit_act, end_act, at) select new.visit_act, new.end_act, new.at
    where not exists (select 1 from outcome_posts o where o.about_act = new.end_act) on conflict do nothing;
  elsif tg_table_name = 'bans_owed' then
    insert into bans_owed_open (ban_act, at) select new.ban_act, new.at
    where not exists (select 1 from outcome_posts o where o.about_act = new.ban_act) on conflict do nothing;
  else
    delete from concessions_owed_open where end_act = new.about_act;
    delete from bans_owed_open where ban_act = new.about_act;
  end if;
  return null;
end $$;
revoke execute on function outcome_owed_open() from public, anon, authenticated;
create trigger concessions_owed_open_make after insert on concessions_owed for each row execute function outcome_owed_open();
create trigger bans_owed_open_make after insert on bans_owed for each row execute function outcome_owed_open();
create trigger outcome_posts_close_open after insert on outcome_posts for each row execute function outcome_owed_open();

create function outcome_tables_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'an outcome post, and what is owed for one, is never edited or removed (% of %)', tg_op, tg_table_name using errcode = 'P0001';
end $$;
revoke execute on function outcome_tables_append_only() from public, anon, authenticated;

create trigger outcome_posts_no_update before update or delete on outcome_posts for each row execute function outcome_tables_append_only();
create trigger outcome_posts_no_truncate before truncate on outcome_posts for each statement execute function outcome_tables_append_only();
alter table outcome_posts enable always trigger outcome_posts_no_update;
alter table outcome_posts enable always trigger outcome_posts_no_truncate;
create trigger concessions_owed_no_update before update or delete on concessions_owed for each row execute function outcome_tables_append_only();
create trigger concessions_owed_no_truncate before truncate on concessions_owed for each statement execute function outcome_tables_append_only();
alter table concessions_owed enable always trigger concessions_owed_no_update;
alter table concessions_owed enable always trigger concessions_owed_no_truncate;
create trigger bans_owed_no_update before update or delete on bans_owed for each row execute function outcome_tables_append_only();
create trigger bans_owed_no_truncate before truncate on bans_owed for each statement execute function outcome_tables_append_only();
alter table bans_owed enable always trigger bans_owed_no_update;
alter table bans_owed enable always trigger bans_owed_no_truncate;

alter table seasons add column banlist_thread uuid references threads (id);

-- ------------------------------------------------------------------------------------------ the Banlist thread ----

-- The season's Banlist: its thread where it has one, else one opened on the system board titled by the copy's `banlistThreadTitle`, recorded and returned. The season's row is locked, so two first entries at once open one thread
-- between them. Written as meetings_thread (0439_minutes.sql) is; it is listed on the board and counted by the ordinary thread trigger, as the Staff Meetings thread is. The caller's own block takes the thread back with a refused first entry.
create function banlist_thread(in_season bigint) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s seasons%rowtype;
  made uuid;
begin
  select * into s from seasons where id = in_season for no key update;
  if s.id is null then raise exception 'there is no season %', in_season using errcode = '22023'; end if;
  if s.banlist_thread is not null then return s.banlist_thread; end if;
  insert into threads (board, title) values (system_board(), copy_of('banlistThreadTitle', s.number)) returning id into made;
  update seasons set banlist_thread = made where id = s.id;
  return made;
end $$;
revoke execute on function banlist_thread(bigint) from public, anon, authenticated;
grant execute on function banlist_thread(bigint) to service_role;

-- instance_thread_rows (0437_move_threads.sql), also each season's Banlist, so it follows the system board's flag as the Roster Report and Staff Meetings threads do. Everything else as 0437 wrote it.
create or replace function instance_thread_rows() returns table (id uuid, board uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id, t.board from threads t
  where t.id = any (array(
    select case when s.value #>> '{}' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (s.value #>> '{}')::uuid end
    from settings s where s.key in ('systemAnnouncements', 'updatesThread')
    union select x.turns_thread from seasons x where x.turns_thread is not null
    union select x.meetings_thread from seasons x where x.meetings_thread is not null
    union select x.banlist_thread from seasons x where x.banlist_thread is not null))
$$;

-- --------------------------------------------------------------------------------------------- the ban's entry ----

-- The code line of a ban's entry: the copy's `banlistEntry` with {character} (the banned character's name), {days} (the ban's days), {rule} (the rule's words, punishment_words of its infraction) and {post} (the address of the post
-- that tipped the bar, the infraction's about_act, as the thread page reads an address: /t/<thread>#post-<seq>) filled. Null where the copy has no `banlistEntry`. Every fact in it is the ban's own, as the log's are.
create function ban_entry_head(ban uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select fill_tokens(c.value ->> 'banlistEntry', jsonb_build_object(
    'character', ch.name,
    'days', b.payload ->> 'days',
    'rule', coalesce(punishment_words((b.payload ->> 'infraction_act')::uuid), ''),
    'post', '/t/' || p.thread::text || '#post-' || coalesce(p.seq::text, '')))
  from acts b
  join characters ch on ch.id = (b.payload ->> 'character')::uuid
  join acts i on i.id = (b.payload ->> 'infraction_act')::uuid
  join acts p on p.id = (i.payload ->> 'about_act')::uuid
  join settings c on c.key = 'copy'
  where b.id = ban_entry_head.ban and b.kind = 'ban'
    and jsonb_typeof(c.value -> 'banlistEntry') = 'string' and btrim(c.value ->> 'banlistEntry') <> ''
$$;
revoke execute on function ban_entry_head(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------ the one writer ----

-- post_outcome: the one place an outcome post is written. Under the outcome's own lock (two writers of one outcome are one after another, and the second finds the row), inside a block of its own: any refusal (a benched or
-- waiting persona, a lockout, a trap, a missing word of the copy, a blank line) rolls back only the post, and the Banlist a first entry opened with it, and is recorded; the outcome stands, and the caller never fails with it.
-- `season` (a season's number) names the Banlist where `thread` is null. The body is cut to the instance's `postMaxLength` (5000 where it is missing). Answers {posted, existing, post, error}. No role calls it.
create function post_outcome(about uuid, kind text, visit uuid, staff_key text, in_thread uuid, target uuid, body text, source text, season integer default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cap integer := greatest(coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'postMaxLength'), 5000), 1);
  th uuid := in_thread;
  made jsonb;
  err text;
  held outcome_posts%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.outcome.' || about::text, 0));
  select * into held from outcome_posts o where o.about_act = post_outcome.about;
  if found then return jsonb_build_object('posted', false, 'existing', true, 'post', held.post_act); end if;
  begin
    if nullif(btrim(coalesce(body, ''), E' \t\n\r\f\v'), '') is null then raise exception 'no line' using errcode = 'P0001'; end if;
    if th is null and post_outcome.season is not null then
      th := banlist_thread((select x.id from seasons x where x.number = post_outcome.season order by x.id desc limit 1));
    end if;
    made := write_staff_act(staff_key, 'post', th, target, jsonb_build_object('body', left(body, cap)));
    insert into outcome_posts (about_act, kind, visit_act, source, post_act) values (about, post_outcome.kind, visit, post_outcome.source, (made ->> 'id')::uuid);
    return jsonb_build_object('posted', true, 'existing', false, 'post', (made ->> 'id')::uuid);
  exception when others then
    err := left(sqlerrm, 500);
    raise warning 'post_outcome: % % posted nothing: % (%)', kind, about, sqlerrm, sqlstate;
  end;
  insert into outcome_posts (about_act, kind, visit_act, source, error) values (about, post_outcome.kind, visit, post_outcome.source, err);
  return jsonb_build_object('posted', false, 'existing', false, 'error', err);
end $$;
revoke execute on function post_outcome(uuid, text, uuid, text, uuid, uuid, text, text, integer) from public, anon, authenticated, service_role;

-- post_ban_entry: a ban's entry in its season's Banlist, as the ban's Mod: the code line (ban_entry_head), a blank line, then `line` (the model's, source `model`), or for `stock` a line of the persona's `banEntry` (else the
-- instance's), drawn by the ban's id, with {mod}, {banned} and the Mod's pronouns filled; the head alone where neither has one. A model line that is blank is the stock. Returns {posted, existing, post, error}; a ban that owes
-- no entry (one from before this) answers {posted: false, owed: false}. Where the copy has no `banlistThreadTitle` or no `banlistEntry` the refusal is recorded and nothing is opened. Service only.
create function post_ban_entry(ban uuid, line text, source text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o bans_owed%rowtype;
  held outcome_posts%rowtype;
  head text;
  said text;
  src text := post_ban_entry.source;
  lines jsonb;
  mod_id uuid;
  banned text;
  missing text;
begin
  if src is null or src not in ('model', 'stock') then raise exception 'an entry is the model''s or the stock''s, not %', coalesce(src, 'nothing') using errcode = '22023'; end if;
  select * into o from bans_owed b where b.ban_act = post_ban_entry.ban;
  if not found then return jsonb_build_object('posted', false, 'existing', false, 'owed', false); end if;
  select * into held from outcome_posts x where x.about_act = post_ban_entry.ban;
  if found then return jsonb_build_object('posted', false, 'existing', true, 'post', held.post_act); end if;
  head := ban_entry_head(post_ban_entry.ban);
  select string_agg(k, ' and ') into missing from (values ('banlistThreadTitle'), ('banlistEntry')) w(k)
  where not exists (select 1 from settings s where s.key = 'copy' and jsonb_typeof(s.value -> w.k) = 'string' and btrim(s.value ->> w.k) <> '');
  if missing is not null or head is null then
    -- The words are the instance's to give: without them nothing is posted and nothing is opened, and the ban stands.
    perform pg_advisory_xact_lock(hashtextextended('kayfabb.outcome.' || post_ban_entry.ban::text, 0));
    insert into outcome_posts (about_act, kind, visit_act, source, error)
    values (post_ban_entry.ban, 'banned', null, src, left('the instance gives no words for copy.' || coalesce(missing, 'banlistEntry') || '; seed them', 500))
    on conflict (about_act) do nothing;
    return jsonb_build_object('posted', false, 'existing', false, 'error', 'no words');
  end if;
  if src = 'model' then said := left(btrim(coalesce(line, ''), E' \t\n\r\f\v'), 280); end if;
  if src = 'model' and nullif(said, '') is null then src := 'stock'; said := null; end if;
  if src = 'stock' then
    lines := stock_lines('banEntry', o.staff);
    mod_id := (select c.id from characters c where c.staff = o.staff);
    banned := (select c.name from characters c join acts b on b.id = post_ban_entry.ban where c.id = (b.payload ->> 'character')::uuid);
    if jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) > 0 and jsonb_typeof(lines -> 0) = 'string' then
      said := fill_tokens(lines ->> concession_line_index(post_ban_entry.ban, jsonb_array_length(lines)), jsonb_build_object('mod', coalesce((select c.name from characters c where c.id = mod_id), ''), 'banned', coalesce(banned, '')) || pronoun_tokens('mod', mod_id));
    end if;
  end if;
  return post_outcome(post_ban_entry.ban, 'banned', null, o.staff, null, null, head || case when said is not null then E'\n\n' || said else '' end, src, o.season);
end $$;
revoke execute on function post_ban_entry(uuid, text, text) from public, anon, authenticated;
grant execute on function post_ban_entry(uuid, text, text) to service_role;

-- post_visit_concession: a talked-down Mod's concession, written by the staff run: `{who}` filled with the interceptor's character's name (one `replace` pass, so a name that holds `{who}` is not filled again), posted as the
-- Mod quoting the visited post. Answers {posted, existing, post, error}; a visit that was not talked down owes nothing and answers {posted: false, owed: false}. Service only.
create function post_visit_concession(visit uuid, body text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c concessions_owed%rowtype;
  v acts%rowtype;
  who text;
begin
  select * into c from concessions_owed o where o.visit_act = post_visit_concession.visit;
  if not found then return jsonb_build_object('posted', false, 'existing', false, 'owed', false); end if;
  select * into v from acts a where a.id = c.visit_act;
  who := (select ch.name from characters ch where ch.id = c.interceptor);
  return post_outcome(c.end_act, 'intercepted', c.visit_act, (select ch.staff from characters ch where ch.id = v.character), v.thread, v.target_act_id,
    replace(coalesce(post_visit_concession.body, ''), '{who}', coalesce(who, 'someone')), 'model');
end $$;
revoke execute on function post_visit_concession(uuid, text) from public, anon, authenticated;
grant execute on function post_visit_concession(uuid, text) to service_role;

-- post_stock_concession: the persona's stock concession for a talked-down visit (the line its id draws, `{who}` filled), through post_outcome as the stock; a persona with none records `no line`. The tick's. No role calls it.
create function post_stock_concession(visit uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c concessions_owed%rowtype;
  v acts%rowtype;
  mod_key text;
  said text;
begin
  select * into c from concessions_owed o where o.visit_act = post_stock_concession.visit;
  if not found then return jsonb_build_object('posted', false, 'existing', false, 'owed', false); end if;
  select * into v from acts a where a.id = c.visit_act;
  mod_key := (select ch.staff from characters ch where ch.id = v.character);
  select l.line into said from (select s.line, row_number() over (order by s.idx) - 1 as pos, count(*) over () as total from staff_concessions s where s.staff = mod_key) l
  where l.pos = concession_line_index(c.visit_act, l.total::integer);
  return post_outcome(c.end_act, 'intercepted', c.visit_act, mod_key, v.thread, v.target_act_id,
    replace(said, '{who}', coalesce((select ch.name from characters ch where ch.id = c.interceptor), 'someone')), 'stock');
end $$;
revoke execute on function post_stock_concession(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------- what the staff run reads ----

-- pending_concessions (0449_concession_post.sql), now the talk-downs that owe a concession: owed rows with no outcome post, within `modBots.concessionWriteMinutes` of the talk-down (15 where the setting is missing), oldest first, each
-- with the visit and its end, its Mod's staff key, the visited post, thread, board (its name and premise) and charges, the interceptor's id (the staff run reads the pronouns from character_faces) and name, `how`, for `answered` the quiz's question, choices and answer, for `paid` the price, for `distracted` the card's
-- key. A visit whose concession call already has a record (staff_call_records, duty `concession`) is not here: a rejected, failed or unrepairable answer posts nothing and is not asked for again, so a talk-down
-- costs one call, and the tick's stock follows at the window. A visit that carries no staff, and an answer to nobody, is not here: a row is a talk-down that happened. Service only.
drop function pending_concessions(integer);
create function pending_concessions(most integer) returns table (visit_act uuid, end_act uuid, staff text, post_act uuid, thread uuid, board uuid, board_name text, board_premise text, charges jsonb, interceptor_id uuid, interceptor_name text, how text,
                                                                question text, choices jsonb, answer text, price integer, card text, owed_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.visit_act, c.end_act, m.staff, v.target_act_id, v.thread, t.board, b.name, b.premise, visit_charges(c.visit_act), c.interceptor, i.name, c.how,
         q.question, q.choices, q.answer,
         case when c.how = 'paid' then (v.payload #>> '{challenge,price}')::integer end,
         case when c.how = 'distracted' then (select k.payload ->> 'card' from acts k where k.id = c.intercept_act) end,
         c.at
  from concessions_owed_open u
  join concessions_owed c on c.visit_act = u.visit_act
  join acts v on v.id = c.visit_act
  join characters m on m.id = v.character
  join characters i on i.id = c.interceptor
  join threads t on t.id = v.thread
  left join boards_now b on b.id = t.board
  left join visit_quizzes q on q.visit_act = c.visit_act and c.how = 'answered'
  where u.at > now() - make_interval(mins => coalesce((select (s.value ->> 'concessionWriteMinutes')::integer from settings s where s.key = 'modBots'), 15))
    and not exists (select 1 from staff_call_records r where r.cause_act = c.visit_act and r.duty = 'concession')
  order by u.at, u.visit_act
  limit greatest(pending_concessions.most, 0)
$$;
revoke execute on function pending_concessions(integer) from public, anon, authenticated;
grant execute on function pending_concessions(integer) to service_role;

-- pending_ban_entries: the bans that owe an entry, within `owedLines.graceMinutes` of the ban (owed_grace_minutes), oldest first, at most `most`, each with the ban, its Mod's staff key, the banned character's name, the days, the
-- rule's words, the season (a number), and the post that tipped the bar (its id, thread and board's name and premise); the banned character's id too, for the staff run's pronouns (character_faces). A recorded call does not
-- hide an entry here: the run pays the stock at once on a failure, so an entry stays owed past a recorded call only where `post_ban_entry` itself raised, and `perDay` and the grace bound that. Service only.
create function pending_ban_entries(most integer) returns table (ban_act uuid, staff text, banned_id uuid, banned text, days integer, rule text, season integer, post_act uuid, thread uuid, board uuid, board_name text, board_premise text, owed_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select o.ban_act, o.staff, ch.id, ch.name, (b.payload ->> 'days')::integer, punishment_words((b.payload ->> 'infraction_act')::uuid), o.season, p.id, p.thread, t.board, bn.name, bn.premise, o.at
  from bans_owed_open u
  join bans_owed o on o.ban_act = u.ban_act
  join acts b on b.id = o.ban_act
  join characters ch on ch.id = (b.payload ->> 'character')::uuid
  join acts i on i.id = (b.payload ->> 'infraction_act')::uuid
  join acts p on p.id = (i.payload ->> 'about_act')::uuid
  join threads t on t.id = p.thread
  left join boards_now bn on bn.id = t.board
  where u.at > now() - make_interval(mins => owed_grace_minutes())
  order by u.at, u.ban_act
  limit greatest(pending_ban_entries.most, 0)
$$;
revoke execute on function pending_ban_entries(integer) from public, anon, authenticated;
grant execute on function pending_ban_entries(integer) to service_role;

-- standing_order_line_calls_today (0445_persona_lines.sql), also counting the duty `banEntry`: a ban's entry is a line owed for an act that has happened, and shares the owed lines' day. Everything else as 0445 wrote it.
create or replace function standing_order_line_calls_today() returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::integer from model_calls m where m.duty in ('standingOrderLine', 'banEntry') and m.at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
$$;

-- staff_call_records (0449_concession_post.sql), also taking the duty banEntry, the call that writes a ban's persona line. Everything else as 0449 wrote it.
alter table staff_call_records drop constraint staff_call_records_duty_check;
alter table staff_call_records add constraint staff_call_records_duty_check check (duty in ('filing', 'reportJudge', 'patrolJudge', 'appeal', 'ruling', 'apologyJudge', 'standingOrderLine', 'quizQuestion', 'concession', 'banEntry'));

-- ------------------------------------------------------------------------------------ the page's reads ----

-- outcome_page_rows: from a list of posts, the visits whose outcome post each is: [(visit, post, kind, at)]. By the post's id (outcome_posts_post), for the page's own posts alone; only an outcome with a visit and a post is
-- here. thread_page reads as its caller, who reads no column of outcome_posts, so this runs as its owner and answers ids and the outcome's kind. A post is a public post by a Mod in a public visit's thread, so the answer is
-- the same for every caller and names no owner, class or reaction.
create function outcome_page_rows(posts uuid[]) returns table (visit_act uuid, post_act uuid, kind text, at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select o.visit_act, o.post_act, o.kind, o.at from outcome_posts o where o.post_act = any (outcome_page_rows.posts) and o.visit_act is not null
    and exists (select 1 from acts_public v where v.id = o.visit_act and v.kind = 'visit')
$$;
revoke execute on function outcome_page_rows(uuid[]) from public;
grant execute on function outcome_page_rows(uuid[]) to anon, authenticated, service_role;

-- visit_outcome_posts: the outcome posts of a visit that are public posts: [{kind, about, post}], oldest first; never `error` or `source`. Replaces visit_concession_post (0449). A client read, so plpgsql with one generic plan
-- and no JIT, as every client read is (0368_client_reads_plan_once.sql).
create function visit_outcome_posts(visit uuid) returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return coalesce((select jsonb_agg(jsonb_build_object('kind', o.kind, 'about', o.about_act, 'post', o.post_act) order by o.at, o.about_act)
                   from outcome_posts o join acts a on a.id = o.post_act and a.kind = 'post'
                   where o.visit_act = visit_outcome_posts.visit and o.post_act is not null
                     and exists (select 1 from acts_public v where v.id = visit_outcome_posts.visit and v.kind = 'visit')), '[]'::jsonb);
end
$function$;
revoke execute on function visit_outcome_posts(uuid) from public;
grant execute on function visit_outcome_posts(uuid) to anon, authenticated, service_role;

-- The #1191 concession post's rows, carried: each visit_concession_posts row becomes an `intercepted` outcome of its visit's end. A function so a test can call it; run once below and idempotent.
create function carry_visit_concession_posts() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  with moved as (
    insert into outcome_posts (about_act, kind, visit_act, source, post_act, error, at)
    select e.id, 'intercepted', p.visit_act, p.source, p.post_act, p.error, p.at
    from visit_concession_posts p join acts e on e.kind = 'visit_end' and e.target_act_id = p.visit_act
    on conflict (about_act) do nothing
    returning 1
  ) select count(*)::integer into n from moved;
  return n;
end $$;
revoke execute on function carry_visit_concession_posts() from public, anon, authenticated;
grant execute on function carry_visit_concession_posts() to service_role;
select carry_visit_concession_posts();

-- 0449's machinery for the stock-or-written concession is replaced above: a talk-down owes a row, and one outcome post settles it.
drop function post_concession(uuid, uuid);
drop function write_visit_concession(uuid, text, text, text);
drop function visit_concession_post(uuid);
drop function visits_open_mark_concession() cascade;
drop function visit_concessions_clear_mark() cascade;
drop index visits_open_concession_pending;
alter table visits_open drop column concession_at;


-- ------------------------------------------------------------------------------------------- the writers ----

-- infract (0361_discipline_cards.sql), where it writes a `ban` also owing the ban's entry (a bans_owed row: the ban, the `staff` Mod whose infraction filled the bar, the ban's season). It is the one writer of a ban, so file_visit's and
-- close_appeal's bans both owe their entries from here. Everything else as 0361 wrote it. Its grants stand (create or replace keeps them).
create or replace function public.infract(who uuid, band text, about_act uuid, staff text, rule_number integer DEFAULT NULL::integer, visit_act uuid DEFAULT NULL::uuid, fall_play uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  bar jsonb;
  pts integer;
  in_thread uuid;
  on_board uuid;
  at timestamptz;
  inf uuid;
  total integer;
  made uuid;
  season_no integer;
  prior integer;
  steps jsonb;
  days integer;
  ends timestamptz;
  ban_at timestamptz;
  author uuid;
begin
  if band is null or band not in ('minor', 'moderate', 'severe') then raise exception 'there is no band "%"; a breach is minor, moderate or severe', coalesce(band, '') using errcode = '22023'; end if;
  if staff is null or staff = '' then raise exception 'an infraction names the Mod that filed it' using errcode = '22023'; end if;
  perform 1 from characters c where c.id = who and c.staff is null for no key update;
  if not found then raise exception 'there is no player character to warn' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if fall_play is null then
    select a.thread, t.board into in_thread, on_board from acts a join threads t on t.id = a.thread where a.id = about_act and a.kind in ('post', 'spin') and a.character = who;
    if in_thread is null then raise exception 'an infraction is for a post this character wrote' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  else
    -- A fall (card notes, Part 5): the post is another's, and the play is this character's own card Act of a fall kind on that very post, on the post's reach. Only who and where are held to the play: whether
    -- an admin has ended it since, or a filing spent it, is for the caller to decide (file_visit takes a live one; an appeal's `increased` names the one the first infraction named).
    select a.thread, t.board, a.character into in_thread, on_board, author from acts a join threads t on t.id = a.thread
    where a.id = about_act and a.kind in ('post', 'spin')
      and exists (select 1 from acts k join card_kinds ck on ck.key = k.payload ->> 'card'
                  where k.id = fall_play and k.kind = 'card' and k.character = who and k.target_act_id = a.id and coalesce(k.payload ->> 'reach', 'post') = 'post' and ck.discipline ->> 'kind' = 'fall');
    if in_thread is null then raise exception 'a fall is the play of a fall card by this character, on the post' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  end if;
  if visit_act is not null and not exists (select 1 from acts v where v.id = visit_act) then raise exception 'there is no such visit' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- The time and the bar are taken with the row held: a filing that waited for another's ban lands after it, and sees its bar.
  at := clock_timestamp();
  bar := setting('warnBar');
  pts := (bar -> 'bands' ->> band)::integer;
  perform set_config('kayfabb.warn_writer', 'on', true);
  insert into acts (character, kind, thread, payload, created_at)
  values (null, 'infraction', in_thread,
    jsonb_build_object('character', who, 'band', band, 'points', pts, 'rule_number', rule_number, 'board', on_board, 'about_act', about_act, 'visit_act', visit_act,
                       'staff', staff, 'expires_at', at + span_interval(bar -> 'decay'))
      || case when fall_play is not null then jsonb_build_object('fall_play', fall_play, 'fall_for', author) else '{}'::jsonb end, at)
  returning id into inf;
  total := warn_points(who);
  if total >= (bar ->> 'size')::integer then
    -- This season's bans of this character, this one counting: a new season has none, so the ladder starts again. A ban an appeal overturned is not counted.
    -- With no season open (between one and the next) it is the latest season's; 0 only where no season was ever made.
    season_no := coalesce((select max(s.number) from seasons s), 0);
    select count(*) into prior from acts b where b.kind = 'ban' and b.payload ->> 'character' = who::text and (b.payload ->> 'season')::integer = season_no
      and not exists (select 1 from acts ap join acts r on r.kind = 'appeal_ruling' and r.target_act_id = ap.id
                      where ap.kind = 'appeal' and ap.target_act_id = b.id and r.payload ->> 'verdict' = 'overturned');
    steps := bar -> 'banDays';
    days := (steps ->> least(prior, jsonb_array_length(steps) - 1))::integer;
    ban_at := greatest(clock_timestamp(), at + interval '1 microsecond');
    ends := ban_at + make_interval(days => days);
    insert into acts (character, kind, thread, payload, created_at)
    values (null, 'ban', in_thread, jsonb_build_object('character', who, 'days', days, 'until', ends, 'infraction_act', inf, 'season', season_no), ban_at)
    returning id into made;
    -- The ban owes its entry (design, section 8): the Mod whose infraction filled the bar writes it, or the tick posts it from stock. infract is the one writer of a ban.
    -- A key no staff character holds (only a test writes one) can write no entry, so owes none.
    insert into bans_owed (ban_act, staff, season) select made, staff, season_no where exists (select 1 from characters c where c.staff = infract.staff);
    total := 0;
  end if;
  perform set_config('kayfabb.warn_writer', '', true);
  return jsonb_build_object('infraction', inf, 'points', pts, 'warn_points', total, 'ban', made, 'until', ends);
end $function$;


-- file_visit (0423_rulings_alerts.sql), after the visit's end posting the line the filing call wrote, else the `visitFiled` stock line, as the Mod in the visit's thread, quoting the visited post (post_outcome). Everything else as 0423 wrote it.
CREATE OR REPLACE FUNCTION public.file_visit(visit_act uuid, line text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v acts%rowtype;
  charges jsonb;
  top jsonb;
  who uuid;
  mod_key text;
  said text;
  ended jsonb;
  hit jsonb;
  author uuid;
  fall uuid;
  taker uuid;
begin
  select * into v from acts a where a.id = file_visit.visit_act and a.kind = 'visit';
  if not found then raise exception 'there is no such visit' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- The lock order this file keeps, here and in every writer a fall meets: the post's row (place_cast takes it to lay a play on a post, so a fall cast and a filing are laid one after the other, and the one that goes
  -- second sees the first), then the visit's open row (the row end_visit takes: the end and the infraction are one decision, and the one that waits finds the visit ended), then, inside infract, the row of the
  -- character the infraction lands on. place_cast at post reach takes the post's row; at character reach it takes the character's row alone. start_visit takes advisory locks (visit:<post>, cap:<author>) and then
  -- the open row, and no post row today. `for no key update` is place_cast's own mode, so the two conflict; it does not conflict with a key share (a foreign key) or a read.
  -- The rule for a later change: post first everywhere. Any path that takes both a post row and a character row takes the post's first (so a path that plays from a post on a character takes the post it is cast from
  -- before the character), and a path that takes the open row takes the post's before it. Then no two writers hold one and want the other.
  perform 1 from acts p where p.id = v.target_act_id for no key update;
  perform 1 from visits_open o where o.visit_act = v.id for update;
  charges := visit_charges(v.id);
  top := (select c from jsonb_array_elements(charges) with ordinality e(c, n)
          order by case c ->> 'band' when 'severe' then 3 when 'moderate' then 2 else 1 end desc, n limit 1);
  mod_key := (select c.staff from characters c where c.id = v.character);
  said := coalesce(nullif(btrim(coalesce(line, '')), ''), visit_line('visitFiled', mod_key, charges));
  ended := end_visit(v.id, 'filed', null, said);
  if not (ended ->> 'ended')::boolean then
    return jsonb_build_object('filed', false, 'end_act', ended -> 'end_act', 'outcome', ended ->> 'outcome');
  end if;
  -- The Mod's line is a post in the visit's thread, quoting the visited post, in the Mod's character, in this transaction and inside post_outcome's own block: a refusal (a benched Mod, a lockout, a trap) is recorded and the filing goes on.
  perform post_outcome((ended ->> 'end_act')::uuid, 'filed', v.id, mod_key, v.thread, v.target_act_id, said, case when nullif(btrim(coalesce(line, '')), '') is not null then 'model' else 'stock' end);
  author := (select a.character from acts a where a.id = v.target_act_id);
  who := author;
  -- Task 4 (section 3), taking the fall: the oldest live play of a fall card on the post's own reach that no infraction names, not caught (a caught play holds no place) and not ended by an admin; its caster takes
  -- the filing in the author's place. The play is a public Act, so nothing here reads an owner. A caster infract would refuse where it would not refuse the author (a staff character now: infract warns a player
  -- character alone; a character that is gone cannot be, an Act's character being a foreign key) takes no fall: the filing lands on the author as if there were none, and the play stays unspent. A caster who is
  -- banned now takes it, as infract warns a banned character today. The post's row is held (above), so nothing spends this play or lays another between this read and the infraction.
  select k.id, k.character into fall, taker
  from acts k join card_kinds ck on ck.key = k.payload ->> 'card' and ck.discipline ->> 'kind' = 'fall'
  where k.kind = 'card' and k.target_act_id = v.target_act_id and coalesce(k.payload ->> 'reach', 'post') = 'post' and not (k.payload ? 'caught') and not card_ended(k.id)
    and not exists (select 1 from acts i where i.kind = 'infraction' and i.payload ? 'fall_play' and i.payload ->> 'fall_play' = k.id::text)
  order by k.created_at, k.id limit 1;
  if fall is not null and taker is distinct from author and exists (select 1 from characters c where c.id = taker and c.staff is null) then
    who := taker;
  else
    fall := null;
  end if;
  hit := infract(who, top ->> 'band', v.target_act_id, mod_key, nullif(top ->> 'rule_number', '')::integer, v.id, fall);
  -- A filing is the one thing that tells the visited: the character the infraction landed on hears a ban or a warning, about that Act. Where a fall was taken, the author hears `fallTaken` about the infraction, acting as the taker's player,
  -- so a player who took the fall for their own other mask hears nothing on it. A visit that ended any other way (intercepted, trapped, reversed, dropped) returned above and wrote nothing.
  perform write_alert(who, 'ruling', case when hit ->> 'ban' is not null then 'ban' else 'warning' end, coalesce((hit ->> 'ban')::uuid, (hit ->> 'infraction')::uuid), null);
  if fall is not null then
    perform write_alert(author, 'ruling', 'fallTaken', (hit ->> 'infraction')::uuid, (select c.owner from characters c where c.id = who));
  end if;
  return jsonb_build_object('filed', true, 'end_act', ended -> 'end_act') || hit;
end $function$;


-- close_appeal (0423_rulings_alerts.sql), the ruling's line cut to 2000 characters (was 280; a sentence cut cannot be done in SQL, the staff function has already cut it, and this cut only guards) and posted where its story is (see the
-- block after the ruling's alert). A move's ruling that ends its move says the end itself, so the end line (say_move_end) is made only where the ruling's post was not. Everything else as 0423 wrote it.
CREATE OR REPLACE FUNCTION public.close_appeal(appeal_act uuid, verdict text, line text DEFAULT NULL::text, staff text DEFAULT NULL::text, most_days integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  ap acts%rowtype;
  pun acts%rowtype;
  ruling acts%rowtype;
  mod_key text;
  who uuid;
  appellant text;
  said text := left(btrim(coalesce(close_appeal.line, '')), 2000);
  v text := close_appeal.verdict;
  pts integer;
  delta integer := 0;
  payload jsonb;
  hit jsonb;
  new_until timestamptz;
  days integer;
  paid record;
  amount integer := 0;
  written uuid;
  key text;
  own_end timestamptz;
  length interval;
  most_all numeric;
  most numeric;
  ended boolean := false;
  from_model boolean;
  posted boolean := false;
  entry_post uuid;
begin
  select * into ap from acts a where a.id = close_appeal.appeal_act and a.kind = 'appeal';
  if not found then raise exception 'there is no such appeal' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- The appeal's own lock: closing and refunding it are one decision, so it is closed once, or refunded once, never both.
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.appeal.' || ap.id::text, 0));
  select * into ruling from acts a where a.kind = 'appeal_ruling' and a.target_act_id = ap.id;
  if found then
    -- The ruling's own numbers, so a retry after a lost answer reports the true outcome.
    return jsonb_build_object('closed', false, 'existing', true, 'ruling_act', ruling.id, 'verdict', ruling.payload ->> 'verdict', 'line', ruling.payload ->> 'line',
      'points_delta', (ruling.payload ->> 'points_delta')::integer,
      'refunded_amount', coalesce((select f.amount from appeal_refunds f where f.appeal_act = ap.id and f.why = 'overturned'), 0))
      || case when ruling.payload ? 'until' then jsonb_build_object('until', ruling.payload ->> 'until') else '{}'::jsonb end;
  end if;
  if exists (select 1 from appeal_refunds f where f.appeal_act = ap.id) then
    return jsonb_build_object('closed', false, 'refunded', true);
  end if;
  if v is null or v not in ('overturned', 'upheld', 'reduced', 'increased') then
    raise exception 'an appeal is answered with overturned, upheld, reduced or increased, not %', coalesce(v, 'nothing') using errcode = '22023';
  end if;
  select * into pun from acts a where a.id = ap.target_act_id;
  -- A move ends under its own lock (end_move's): the ruling, the tick and an apology's end are then one after another, and a move one of them ended is seen as ended here.
  if pun.kind = 'move' then perform pg_advisory_xact_lock(hashtext('kayfabb.end_move'), hashtext(pun.id::text)); end if;
  -- The punishment ran out while the appeal waited: nothing is left to rule on, and an increase must not revive it. No ruling; the price comes back (the appeal stays used).
  if not punishment_running(pun.id) then
    perform refund_appeal(ap.id, 'expired');
    return jsonb_build_object('closed', false, 'refunded', true, 'expired', true, 'reason', 'that punishment had already run out before the appeal was heard, so nothing was ruled and your Aura is back');
  end if;
  mod_key := appeal_hearer(pun.id);
  if mod_key is null then raise exception 'no one is on staff to hear an appeal' using errcode = '55000'; end if;
  if close_appeal.staff is not null and close_appeal.staff <> mod_key then
    raise exception 'this appeal is heard by someone else now' using errcode = '55000';
  end if;
  who := ap.character;
  appellant := (select c.name from characters c where c.id = who);

  if pun.kind = 'move' then
    own_end := (pun.payload ->> 'expires_at')::timestamptz;
    -- A move that ends only by an apology or an admin has no length to halve or add to: the model's other verdicts are written as upheld, in the stock line.
    if own_end is null and v in ('reduced', 'increased') then v := 'upheld'; said := ''; end if;
  end if;
  payload := jsonb_build_object('appeal_act', ap.id, 'verdict', v);

  if pun.kind = 'infraction' then
    pts := (pun.payload ->> 'points')::integer;
    if v = 'overturned' then delta := -pts;
    elsif v = 'reduced' then delta := -least(pts, greatest(1, (pts + 1) / 2));
    elsif v = 'increased' then
      -- One more infraction of the same band for the same post: at most one band's points, and a full bar bans. A fall's infraction names its play again, so the increase lands on the same character, the one who appealed (Task 4).
      hit := infract(who, pun.payload ->> 'band', (pun.payload ->> 'about_act')::uuid, mod_key, nullif(pun.payload ->> 'rule_number', '')::integer, nullif(pun.payload ->> 'visit_act', '')::uuid, nullif(pun.payload ->> 'fall_play', '')::uuid);
      delta := (hit ->> 'points')::integer;
      payload := payload || jsonb_build_object('infraction_act', hit ->> 'infraction');
    end if;
  elsif pun.kind = 'move' then
    -- Its length is from its landing to its own end. A reduction ends it at landing plus half the length (the end may be behind us); an increase adds half the length, but
    -- never past the phase's most days from landing (the smaller of the phase's number and the instance's own).
    length := own_end - pun.created_at;
    if v = 'overturned' then new_until := now();
    elsif v = 'reduced' then new_until := pun.created_at + length / 2;
    elsif v = 'increased' then
      -- The instance's setting is the outer limit (setting() raises where it is missing); the phase's number, where the call has one, can only lower it.
      most_all := (setting('moveExpiryMostDays') #>> '{}')::numeric;
      most := greatest(1, least(coalesce(close_appeal.most_days, most_all), most_all));
      new_until := own_end + least(length / 2, greatest(interval '0', most * interval '1 day' - length));
    end if;
    if new_until is not null then payload := payload || jsonb_build_object('until', new_until); end if;
  else
    -- A ban: its length is its days; a reduction counts half of them from the ban's start, an increase runs half of them past its end.
    days := (pun.payload ->> 'days')::integer;
    if v = 'overturned' then new_until := now();
    elsif v = 'reduced' then new_until := pun.created_at + days * interval '12 hours';
    elsif v = 'increased' then new_until := (pun.payload ->> 'until')::timestamptz + days * interval '12 hours';
    end if;
    if new_until is not null then payload := payload || jsonb_build_object('until', new_until); end if;
  end if;

  key := 'appeal' || initcap(v);
  from_model := nullif(said, '') is not null;
  said := coalesce(nullif(said, ''), appeal_line(key, mod_key, appellant));
  payload := payload || jsonb_build_object('points_delta', delta, 'line', said);
  written := (write_staff_act(mod_key, 'appeal_ruling', ap.thread, ap.id, payload) ->> 'id')::uuid;
  -- The appellant hears the ruling, about the ruling Act. An `increased` verdict's extra points or ban are told in this one alert: its call to infract above writes no warning or ban of its own.
  perform write_alert(ap.character, 'ruling', 'appealAnswered', written, null);

  -- The ruling is a post where its story is (design, sections 8 and 10), best effort and inside post_outcome's own block: an infraction's in the punished post's thread, quoting the post; a group move's in the move's thread,
  -- quoting the move, when that thread is a staff thread; a ban's in its season's Banlist, quoting the ban's entry (posted first, from stock, where it is still owed; quoting nothing where the entry was refused), for a ban that owes an
  -- entry (a ban from before this posts nothing). The ruling Act keeps its `line`, and the Lens shows it where the post was refused.
  begin
    if pun.kind = 'infraction' then
      perform post_outcome(written, 'ruling', nullif(pun.payload ->> 'visit_act', '')::uuid, mod_key, pun.thread, (pun.payload ->> 'about_act')::uuid, said, case when from_model then 'model' else 'stock' end);
    elsif pun.kind = 'move' then
      if exists (select 1 from threads x where x.id = pun.thread and x.staff_placed) then
        posted := coalesce((post_outcome(written, 'move_ruling', null, mod_key, pun.thread, pun.id, said, case when from_model then 'model' else 'stock' end) ->> 'posted')::boolean, false);
      end if;
    elsif exists (select 1 from bans_owed o where o.ban_act = pun.id) then
      perform post_ban_entry(pun.id, null, 'stock');
      entry_post := (select o.post_act from outcome_posts o where o.about_act = pun.id);
      perform post_outcome(written, 'ban_ruling', null, mod_key, null, entry_post, said, case when from_model then 'model' else 'stock' end, (select o.season from bans_owed o where o.ban_act = pun.id));
    end if;
  exception when others then
    raise warning 'close_appeal: the ruling % posted nothing: % (%)', written, sqlerrm, sqlstate;
  end;

  -- A move's effect: overturned ends it at once; a reduction that has already run its course ends it now. Each is end_move's, so a move something else just ended is not ended twice.
  if pun.kind = 'move' then
    if v = 'overturned' then
      ended := (end_move(pun.id, 'overturned', 'appeal') ->> 'ended')::boolean;
      if ended and not posted then perform say_move_end(pun.id, 'overturned'); end if;
    elsif v = 'reduced' and new_until <= now() then
      ended := (end_move(pun.id, 'expired', 'appeal') ->> 'ended')::boolean;
      if ended and not posted then perform say_move_end(pun.id, 'expired'); end if;
    end if;
  end if;

  -- An overturned appeal gets its price back.
  if v = 'overturned' then
    select w.account, -w.change as price into paid from wallet_events w where w.kind = 'appeal' and w.ref = ap.id;
    amount := coalesce(paid.price, 0);
    insert into appeal_refunds (appeal_act, amount, why) values (ap.id, amount, 'overturned');
    if amount > 0 then perform wallet_move(paid.account, amount, 'refund', null, ap.id); end if;
  end if;
  return jsonb_build_object('closed', true, 'ruling_act', written, 'verdict', v, 'staff', mod_key, 'line', said, 'points_delta', delta, 'refunded_amount', amount)
    || case when new_until is not null then jsonb_build_object('until', new_until) else '{}'::jsonb end
    || case when ended then jsonb_build_object('ended', true) else '{}'::jsonb end
    || case when hit is not null then jsonb_build_object('infraction', hit ->> 'infraction', 'ban', hit -> 'ban') else '{}'::jsonb end;
end $function$;
-- intercept (0449_concession_post.sql), a successful talk-down owing its concession (a concessions_owed row: the interceptor, `answered` for a quiz and `paid` for a bribe, the intercept Act) where it called post_concession. Everything
-- else as 0449 wrote it (its lock order is unchanged).
create or replace function intercept(through uuid, visit_act uuid, answer text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid;
  v acts%rowtype;
  ckind text;
  price integer;
  mod_key text;
  mod_name text;
  me text;
  said text := btrim(coalesce(answer, ''));
  wanted text;
  shown jsonb;
  ok boolean;
  iid uuid;
  until timestamptz;
  hours integer := coalesce((select (m.value ->> 'tailHours')::integer from settings m where m.key = 'modBots'), 24);
  held numeric;
  closed jsonb;
begin
  caller := acting(through);
  perform not_banned(through);
  select * into v from acts a where a.id = intercept.visit_act and a.kind = 'visit';
  if not found then raise exception 'there is no such visit' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- The visit's open row, taken for update: a filing or another interception waits, then finds the visit over. A visit with no open row has ended.
  perform 1 from visits_open o where o.visit_act = v.id for update;
  if not found then raise exception 'this visit is over' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  if exists (select 1 from acts i where i.kind = 'intercept' and i.character = through and i.payload ->> 'visit_act' = v.id::text) then
    raise exception 'this character has already tried this visit' using hint = 'kayfabb.refusal', errcode = '23505';
  end if;
  ckind := v.payload #>> '{challenge,kind}';
  select c.staff, c.name into mod_key, mod_name from characters c where c.id = v.character;
  select c.name into me from characters c where c.id = through;
  if ckind = 'quiz' then
    -- The question is the visit's own row. With none written yet the quiz is pending: refused in the same words for everyone, before anything is written, so the character's one try is not spent.
    select q.answer, q.choices into wanted, shown from visit_quizzes q where q.visit_act = v.id;
    if not found then raise exception 'the question is still being written; try again in a few minutes' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
    if said = '' then raise exception 'pick an answer' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    -- An answer is one of the choices shown: anything else (or something far too long) is refused the same way for everyone, before anything is written.
    if char_length(said) > 200 or not shown ? said then raise exception 'pick one of the answers shown' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    ok := said = wanted;
  elsif ckind = 'bribe' then
    price := (v.payload #>> '{challenge,price}')::integer;
    select w.balance into held from wallets w where w.account = caller;
    if coalesce(held, 0) < price then
      raise exception 'that costs %, and your wallet holds %', price, coalesce(held, 0) using hint = 'kayfabb.refusal', errcode = 'P0001';
    end if;
    ok := true;
    said := '';
  else
    raise exception 'this Mod is moved by a card played on the thread, not by an answer or a payment' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  perform set_config('kayfabb.intercept_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload)
  values (through, 'intercept', v.thread, v.target_act_id, jsonb_build_object('visit_act', v.id, 'kind', ckind, 'succeeded', ok) || case when ckind = 'quiz' then jsonb_build_object('answer', said) else '{}'::jsonb end)
  returning id into iid;
  perform set_config('kayfabb.intercept_writer', '', true);
  if ckind = 'bribe' then perform wallet_spend(caller, price, 'bribe', iid); end if;
  if ok then
    closed := end_visit(v.id, 'intercepted', iid, me || ' got past ' || mod_name || '''s ' || case ckind when 'quiz' then 'quiz' else 'price' end || '.');
    -- The talk-down owes the Mod's concession (design, section 2): the staff run writes it from the thread, or the tick posts the persona's stock past `concessionWriteMinutes`. Nothing is posted here.
    if (closed ->> 'ended')::boolean then
      insert into concessions_owed (visit_act, end_act, interceptor, how, intercept_act)
      values (v.id, (closed ->> 'end_act')::uuid, through, case ckind when 'quiz' then 'answered' else 'paid' end, iid);
    end if;
  else
    until := now() + make_interval(hours => hours);
    insert into tails (character, staff, intercept_act, until) values (through, mod_key, iid, until);
  end if;
  return jsonb_build_object('intercept', iid, 'visit', v.id, 'kind', ckind, 'succeeded', ok, 'ended', ok, 'tail_until', until);
end $$;
revoke execute on function intercept(uuid, uuid, text) from public, anon;
grant execute on function intercept(uuid, uuid, text) to authenticated, service_role;

-- distract_visits (0449_concession_post.sql), every visit it ends owing its Mod's concession by the caster's name (a concessions_owed row naming the cast), where it called post_concession for each. Everything else as 0449 wrote it.
-- The concession posts no longer wait inside the cast, so the cast takes no Mod's count row and the lock order 0449 wrote down about them is gone with them: the cast takes the thread's row (place_cast), then each distraction visit's
-- open row here, in the order the visits are read, and an interception takes only its own visit's open row.
create or replace function distract_visits(caster uuid, in_thread uuid, card_act uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v record;
  iid uuid;
  ended integer := 0;
  me text := (select c.name from characters c where c.id = caster);
  said text;
  closed jsonb;
begin
  for v in
    select a.id, a.target_act_id, (select m.name from characters m where m.id = a.character) as mod_name
    from acts a join visits_open o on o.visit_act = a.id
    where a.kind = 'visit' and a.thread = in_thread and a.payload #>> '{challenge,kind}' = 'distraction'
    order by a.created_at, a.id
  loop
    perform 1 from visits_open o where o.visit_act = v.id for update;
    continue when not found;
    continue when exists (select 1 from acts i where i.kind = 'intercept' and i.character = caster and i.payload ->> 'visit_act' = v.id::text);
    perform set_config('kayfabb.intercept_writer', 'on', true);
    insert into acts (character, kind, thread, target_act_id, payload)
    values (caster, 'intercept', in_thread, v.target_act_id, jsonb_build_object('visit_act', v.id, 'kind', 'distraction', 'succeeded', true, 'card', card_act))
    returning id into iid;
    perform set_config('kayfabb.intercept_writer', '', true);
    said := me || ' drew ' || v.mod_name || '''s attention away from this post with a card.';
    closed := end_visit(v.id, 'intercepted', iid, said);
    -- Each visit the cast ends owes its Mod's concession, by the caster's name, with the cast Act (design, section 2); nothing is posted here, so the cast waits for no Mod's count row.
    if (closed ->> 'ended')::boolean then
      insert into concessions_owed (visit_act, end_act, interceptor, how, intercept_act) values (v.id, (closed ->> 'end_act')::uuid, caster, 'distracted', card_act);
    end if;
    ended := ended + 1;
  end loop;
  return ended;
end $$;
revoke execute on function distract_visits(uuid, uuid, uuid) from public, anon, authenticated;
-- system_tick (0449_concession_post.sql), step 7 no longer writing a quiz's `none` concession beside its bank row (a talk-down owes its concession now), step 8 posting the stock concession of each talk-down past its window, and a
-- step 9 posting the stock entry of each ban past `owedLines.graceMinutes`; counted as `concessionsLapsed` and `banEntriesLapsed`. Everything else as 0449 wrote it.
create or replace function system_tick() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  enabled boolean := coalesce((select s.value = 'true'::jsonb from settings s where s.key = 'systemEnabled'), false);
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
  lapsed_n integer := 0;
  rq record;
  asked record;
  owed_late record;
  owed_error text;
  owed_paid integer := 0;
  rq_public boolean;
  mt uuid;
  ann_mt uuid;
  ann_why text;
  act_p jsonb;
  quiz_grace interval := make_interval(mins => coalesce((select (s.value ->> 'quizWriteMinutes')::integer from settings s where s.key = 'modBots'), 15));
  quiz_late record;
  quiz_bank jsonb;
  quiz_banked integer := 0;
  conc_grace interval := make_interval(mins => coalesce((select (s.value ->> 'concessionWriteMinutes')::integer from settings s where s.key = 'modBots'), 15));
  conc_late record;
  conc_lapsed integer := 0;
  ban_late record;
  ban_lapsed integer := 0;
  -- Owed concessions and ban entries are looked for in the last seven days of owed rows only (the index on their time), so the scan is bounded by a week and never by the instance's history.
  posted_now jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtext('kayfabb.system_tick')) then return jsonb_build_object('skipped', true); end if;

  -- The one lock order (0339): the global place key before anything is written. A lasting move due to land, or one in force that this tick may end (an expiry, a demand met, a superseded one), writes places, so
  -- the key is taken first. A landing move also opens a thread of its own on the system board and writes its Act into it, a thread no one else holds until the tick commits; an admin's reversal takes the key
  -- and only then writes its end into the move's thread. A non-lasting landing therefore has no row a reversal waits for, and the key is needed only where a lasting move is due or in force, which is the test
  -- below. The one key is held to the end of the tick; the tick's own rows are the only thing it waits for before it is taken.
  if exists (select 1 from queued_moves q join move_kinds k on k.key = q.kind
             where k.lasting and q.landed_act is null and q.held_at is null and q.refused_at is null and q.go_live_at <= now())
     or exists (select 1 from open_moves o join acts a on a.id = o.move_act join move_kinds k on k.key = a.payload ->> 'kind' where k.lasting) then
    perform lock_thread_places();
  end if;

  -- 1. Landing: only while The System is on. A landed move is written in a thread of its own on the staff's board (below), so it needs no thread made beforehand.
  if enabled then
    for due in
      select q.id, q.staff, q.kind, q.params, q.demand, q.expires_at, q.admin_description, q.bundle, q.depends_on, q.line from queued_moves q where q.landed_act is null and q.held_at is null and q.refused_at is null and q.go_live_at <= now() order by q.go_live_at, q.id for update skip locked
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
            then beat_role_board(meeting_season((select q.meeting from queued_moves q where q.id = due.id)), due.staff, lp #>> array[rk, 'beat'], lp #>> array[rk, 'role'], lp #>> array[rk, 'of'])
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
        -- The move's thread (the staff-board threads design, section 6): a part of a bundle goes in the thread of the bundle's earliest landed part, whenever that landed; anything else, and a bundle's first part,
        -- opens a staff thread of its own, titled for its kind. It is opened here, inside this move's block, so a part that fails to land takes its thread with it and the next one that lands opens it again.
        mt := null;
        ann_mt := null;
        ann_why := null;
        if due.bundle is not null then
          -- A bundle an announced beat played lands in that beat's announcement thread (arc_announcements, read through the play it announces); one with no announcement (a beat with no `announce` block, or a bundle played
          -- before announcements) goes where 0437 sent it: the thread of the bundle's earliest landed part.
          select n.thread into ann_mt from arc_announcements n join arc_beat_events e on e.id = n.play where e.bundle = due.bundle limit 1;
          mt := ann_mt;
          if mt is null then
            select a.thread into mt from queued_moves p join acts a on a.id = p.landed_act where p.bundle = due.bundle and p.landed_act is not null order by a.created_at, a.seq, a.id limit 1;
          end if;
        end if;
        if mt is null then mt := open_staff_thread(due.staff, move_thread_title(due.kind, lp, due.staff)); end if;
        act_p := jsonb_build_object('kind', due.kind, 'params', lp, 'body', case when nullif(btrim(due.line, E' \t\n\r\f\v'), '') is not null then system_line_fill(btrim(due.line, E' \t\n\r\f\v'), due.kind, lp, due.staff)
            else system_line(case when due.kind = 'setRule' then 'ruleSet' else 'moveLanded' end, due.kind, lp, due.staff) end)
          || case when due.demand is not null then jsonb_build_object('demand', due.demand) else '{}'::jsonb end
          || case when due.expires_at is not null then jsonb_build_object('expires_at', due.expires_at) else '{}'::jsonb end;
        if ann_mt is not null then
          -- A part the announcement thread will not take (a refusal of write_staff_act) does not wait on it for good: it falls back to where 0437 sent a bundle (the thread of the bundle's earliest landed part outside the
          -- announcement's, else a thread of its own), and the row says so. A thread moved to another board takes it as before: a move's Act is written in the thread wherever it stands.
          begin
            written := (write_staff_act(due.staff, 'move', ann_mt, null, act_p) ->> 'id')::uuid;
          exception when others then
            ann_why := left(sqlerrm, 300);
            raise warning 'system_tick: queued move % could not land in its announcement thread %: % (%)', due.id, ann_mt, sqlerrm, sqlstate;
            select a.thread into mt from queued_moves p join acts a on a.id = p.landed_act where p.bundle = due.bundle and p.landed_act is not null and a.thread <> ann_mt order by a.created_at, a.seq, a.id limit 1;
            if mt is null then mt := open_staff_thread(due.staff, move_thread_title(due.kind, lp, due.staff)); end if;
            written := (write_staff_act(due.staff, 'move', mt, null, act_p) ->> 'id')::uuid;
          end;
        else
          written := (write_staff_act(due.staff, 'move', mt, null, act_p) ->> 'id')::uuid;
        end if;
        update queued_moves set landed_act = written where id = due.id;
        if ann_why is not null then
          update queued_moves set failed_at = now(), failure = left('landed in a thread of its own: the announcement thread would not take it (' || ann_why || ')', 500) where id = due.id;
        end if;
        -- A ruling on a player's own character (design section 2): the member a Boss put in a group is told, as is the starter of a thread the Boss moved. A mergeBoard and a group left alert no one.
        if due.kind = 'conferGroup' then
          perform write_alert(safe_uuid(lp ->> 'character'), 'ruling', 'grouped', written, null);
        elsif due.kind = 'moveThread' then
          perform write_alert((select a.character from acts a where a.thread = safe_uuid(lp ->> 'thread') and a.seq = 1), 'ruling', 'threadMoved', written, null);
        end if;
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

  -- 5. Staff requests (0424): a request a persona conferred and no meeting has ruled lapses `staffRequests.daysMost` days after it was conferred (staff_requests_now.lapses_at), and one whose request post is
  -- hidden, or gone, lapses at the next tick. Whatever the switch says, as a visit is filed: a state's way out is time, so a request does not wait on The System being on. The oldest first, at most `demandChecksPerTick`
  -- (the tick's one count for work per run), and none once the budget is spent. Where the post is still public and The System is on, the Boss replies in the thread to the request post with the stock line
  -- `requestLapsed` ({boss}, {asker}: the asker as the post's public author shows, so a veiled one is the anonymous name); an instance with no such line says nothing, and a post that cannot be written is
  -- a warning, never a request left waiting (boss_request_reply writes it, as requests_ruled's replies are). The reply is written before its ruling row (which names it), so the request's key is held first: try-locked, never waited on, so a meeting ruling the same
  -- request (requests_ruled holds the same key) and this pass cannot wait on each other; one it holds is left to the next tick. It reads the queue (staff_requests_open), the requests that wait and no other, so a row is read per
  -- waiting request, which the days they wait bound, and never one per request ruled in the past. As visits are (4 above), a request that failed to lapse, or was held by a meeting, goes behind the rest by its last
  -- failure (failed_at, then the oldest first), so one request that keeps raising or keeps being held never holds a slot of the pass from the others; it is still read when the others have been, and a meeting can rule it.
  for rq in select d.id, d.request_act, d.thread from staff_requests_due(cap) d
  loop
    if clock_timestamp() > budget_ends then out_of_time := true; exit; end if;
    begin
      if not pg_try_advisory_xact_lock(hashtextextended('kayfabb.request.' || rq.id, 0)) then
        -- A meeting holds it (the row may be one its transaction has already ruled): behind the others, and never waited for (skip locked), so the tick does not wait on that transaction either.
        update staff_requests_open set failed_at = now() where request = (select x.request from staff_requests_open x where x.request = rq.id for update skip locked);
        continue;
      end if;
      if exists (select 1 from staff_request_rulings g where g.request = rq.id) then continue; end if;
      rq_public := staff_request_post_public(rq.request_act);
      if rq_public and enabled and boss is not null then
        begin
          select s.asker_name, s.body into asked from staff_request_shown(rq.id) s;
          perform owe_line(boss, 'requestLapsed', rq.thread, rq.request_act, rq.request_act, rq.id,
            jsonb_build_object('asker', coalesce(asked.asker_name, ''), 'body', left(coalesce(asked.body, ''), 600)));
        exception when others then
          raise warning 'system_tick: the lapse of request % was not owed: % (%)', rq.id, sqlerrm, sqlstate;
        end;
      end if;
      insert into staff_request_rulings (request, ruling) values (rq.id, 'lapsed');
      lapsed_n := lapsed_n + 1;
    exception when others then
      failed := failed + 1;
      raise warning 'system_tick: request % did not lapse: % (%)', rq.id, sqlerrm, sqlstate;
      -- Recorded and sent behind the others (the order above). The block's own writes are undone, so this is the one write left; a row a meeting is ruling is not waited for.
      update staff_requests_open set failed_at = now(), attempts = attempts + 1 where request = (select x.request from staff_requests_open x where x.request = rq.id for update skip locked);
    end;
  end loop;

  -- 6. Owed lines (the persona lines plan, Task 4): a line a move's end, a request's lapse or a handover's arrival owes its speaker (lines_owed_open), not paid by the staff run within `owedLines.graceMinutes`, is posted from the
  -- speaker's stock (pay_owed_line with no body); with The System off it is paid `unsaid` ('The System is off') and nothing is posted, as the lapse above says nothing then. Whatever the switch says otherwise: the line's act has happened. The
  -- oldest first (a row that failed goes behind the rest, by its last failure, so one line that keeps raising never holds the pass), at most `demandChecksPerTick` (the tick's one count for work per run), and none once the budget is spent.
  -- The queue is the lines not yet paid, which the grace bounds, and never one per line paid in the past. A row the staff run holds is skipped (skip locked) and paid by whoever has it. A line that raises (only a transient failure gets here:
  -- pay_owed_line pays every other failure `unsaid` itself) is counted and sent behind the others (the attempts, a record and no cap), and is tried again on a later tick, so a run of transient failures never turns a line into an unsaid one.
  for owed_late in
    select o.owed from lines_owed_open o where o.at <= now() - make_interval(mins => owed_grace_minutes()) order by o.failed_at nulls first, o.at, o.owed limit cap for update of o skip locked
  loop
    if clock_timestamp() > budget_ends then out_of_time := true; exit; end if;
    begin
      if enabled then
        perform pay_owed_line(owed_late.owed, null);
      else
        perform pay_owed_unsaid(owed_late.owed, 'The System is off');
      end if;
      owed_paid := owed_paid + 1;
    exception when others then
      failed := failed + 1;
      owed_error := left(sqlerrm || ' (' || sqlstate || ')', 400);
      raise warning 'system_tick: owed line % was not paid: %', owed_late.owed, owed_error;
      update lines_owed_open set failed_at = now(), attempts = attempts + 1 where owed = owed_late.owed;
    end;
  end loop;

  -- 7. Pending quizzes (the written quiz plan, Task 1): a quiz visit with no question row whose start is `modBots.quizWriteMinutes` or more in the past is given its bank question (snapshotted into the row, so a reseed of
  -- the bank cannot change it), whatever the switch says: the staff run writes the model's question sooner where it can, and no visit waits longer than this. The oldest first, found by the partial index on visits_open
  -- (the pending ones alone), at most `demandChecksPerTick`, and none once the budget is spent. A visit whose persona has no bank question for it (a reseed removed it) is not scanned at all, so it can never hold the head of the scan and starve the rest (pending_quizzes leaves it out for the same reason); it ends with its visit, or is banked once a reseed gives the bank that question back. Best effort per visit: one that fails is warned and left for the next tick; a row
  -- the staff run wrote first is left as it stands (write_visit_quiz answers it and writes nothing).
  for quiz_late in
    select o.visit_act from visits_open o where o.quiz_at is not null and o.quiz_at <= now() - quiz_grace
      and exists (select 1 from acts v join characters c on c.id = v.character join staff_quiz_questions q on q.staff = c.staff and q.idx = (v.payload #>> '{challenge,question_index}')::integer where v.id = o.visit_act)
    order by o.quiz_at, o.visit_act limit cap
  loop
    if clock_timestamp() > budget_ends then out_of_time := true; exit; end if;
    begin
      quiz_bank := bank_quiz_for(quiz_late.visit_act);
      if quiz_bank is null then
        raise warning 'system_tick: quiz visit % has no bank question to fall back on', quiz_late.visit_act;
        continue;
      end if;
      if (write_visit_quiz(quiz_late.visit_act, 'bank', quiz_bank ->> 'question', quiz_bank -> 'choices', quiz_bank ->> 'answer') ->> 'written')::boolean then
        quiz_banked := quiz_banked + 1;
      end if;
    exception when others then
      raise warning 'system_tick: the question for visit % was not banked: % (%)', quiz_late.visit_act, sqlerrm, sqlstate;
    end;
  end loop;

  -- 8. Owed concessions (the outcome posts plan, Task 1): a talk-down whose concession no staff run wrote within `modBots.concessionWriteMinutes` has the persona's stock line posted (the line its visit's id draws, `{who}` filled), whatever the
  -- switch says: the staff run writes the Mod's own words sooner where it can, and no talk-down waits longer than this. A persona with no stock line records `no line` and posts nothing. The oldest first, found by the index on the
  -- owed row's time, at most `demandChecksPerTick`, and none once the budget is spent. Best effort per visit: one that fails is warned and left for the next tick; one the staff run posted first is left as it stands (post_outcome finds it).
  for conc_late in
    select c.visit_act from concessions_owed_open c
    where c.at <= now() - conc_grace
    order by c.at, c.visit_act limit cap
  loop
    if clock_timestamp() > budget_ends then out_of_time := true; exit; end if;
    begin
      posted_now := post_stock_concession(conc_late.visit_act);
      if not coalesce((posted_now ->> 'existing')::boolean, false) then conc_lapsed := conc_lapsed + 1; end if;
    exception when others then
      raise warning 'system_tick: the concession for visit % was not settled: % (%)', conc_late.visit_act, sqlerrm, sqlstate;
    end;
  end loop;

  -- 9. Owed ban entries (the outcome posts plan, Task 1): a ban whose entry no staff run wrote and no ruling posted within `owedLines.graceMinutes` has its entry posted from stock (the code line and a `banEntry` line), whatever the
  -- switch says: the ban has happened. The oldest first, at most `demandChecksPerTick` (the tick's one count for work per run, the owed lines' grace bound), and none once the budget is spent.
  for ban_late in
    select b.ban_act from bans_owed_open b
    where b.at <= now() - make_interval(mins => owed_grace_minutes())
    order by b.at, b.ban_act limit cap
  loop
    if clock_timestamp() > budget_ends then out_of_time := true; exit; end if;
    begin
      posted_now := post_ban_entry(ban_late.ban_act, null, 'stock');
      if not coalesce((posted_now ->> 'existing')::boolean, false) then ban_lapsed := ban_lapsed + 1; end if;
    exception when others then
      raise warning 'system_tick: the entry for ban % was not posted: % (%)', ban_late.ban_act, sqlerrm, sqlstate;
    end;
  end loop;

  return jsonb_build_object('landed', landed, 'met', met, 'expired', expired, 'superseded', superseded, 'unmet', unmet, 'failed', failed, 'checked', checked, 'visits', filed, 'beats', arcs, 'budget', out_of_time,
    'awardsFailed', awards_failed, 'requestsLapsed', lapsed_n, 'owedPaid', owed_paid, 'quizzesBanked', quiz_banked, 'concessionsLapsed', conc_lapsed, 'banEntriesLapsed', ban_lapsed);
end $$;
-- thread_page (0438_board_cards_on_their_board.sql), its visits also taking those whose outcome post is on the page (by the post's id, over the page's own posts: outcome_page_rows), even where the visited post is on another page,
-- and each visit's JSON gaining `answers`, the ids of its outcome posts on the page. Everything else as 0438 wrote it; its grants are as they were (replaced in place).
CREATE OR REPLACE FUNCTION public.thread_page(in_thread uuid, in_page integer, in_seq integer, per_page integer, effect_cards text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_generic_plan'
 SET jit TO 'off'
AS $function$
#variable_conflict use_column
begin
  perform
         CASE
             WHEN ((COALESCE(per_page, ( SELECT ((x.settings ->> 'postsPerPage'::text))::integer AS int4
                FROM screen_settings x
              LIMIT 1)) IS NULL) OR ((COALESCE(per_page, ( SELECT ((x.settings ->> 'postsPerPage'::text))::integer AS int4
                FROM screen_settings x
              LIMIT 1)) < 1) OR (COALESCE(per_page, ( SELECT ((x.settings ->> 'postsPerPage'::text))::integer AS int4
                FROM screen_settings x
              LIMIT 1)) > 100))) THEN screen_refusal('a page holds 1 to 100 posts'::text)
             ELSE NULL::integer
         END AS "case";
  return (
  WITH pp AS MATERIALIZED (
          SELECT COALESCE(per_page, ( SELECT ((x.settings ->> 'postsPerPage'::text))::integer AS int4
                    FROM screen_settings x
                  LIMIT 1)) AS n
         ), s AS MATERIALIZED (
          SELECT o.id,
             o.board,
             o.title,
             o.origin_act_id,
             o.created_at,
             o.last_at,
             o.last_seq,
             o.replies,
             o.first_act,
             o.first_character,
             o.last_act,
             o.last_character,
             o.replies_this_week,
             o.origin_thread,
             o.origin_place,
             (GREATEST((1)::numeric, ceil(((o.last_seq)::numeric / (( SELECT pp.n
                    FROM pp))::numeric))))::integer AS last_page
            FROM thread_open o
           WHERE (o.id = thread_page.in_thread)
         ), pg AS MATERIALIZED (
          SELECT s.id,
             s.board,
             s.title,
             s.origin_act_id,
             s.created_at,
             s.last_at,
             s.last_seq,
             s.replies,
             s.first_act,
             s.first_character,
             s.last_act,
             s.last_character,
             s.replies_this_week,
             s.origin_thread,
             s.origin_place,
             s.last_page,
             LEAST(s.last_page, GREATEST(1, COALESCE(
                 CASE
                     WHEN (thread_page.in_seq IS NOT NULL) THEN (GREATEST((1)::numeric, ceil(((thread_page.in_seq)::numeric / (( SELECT pp.n
                        FROM pp))::numeric))))::integer
                     ELSE NULL::integer
                 END, thread_page.in_page, 1))) AS page
            FROM s
         ), rng AS MATERIALIZED (
          SELECT pg.id,
             pg.board,
             pg.title,
             pg.origin_act_id,
             pg.created_at,
             pg.last_at,
             pg.last_seq,
             pg.replies,
             pg.first_act,
             pg.first_character,
             pg.last_act,
             pg.last_character,
             pg.replies_this_week,
             pg.origin_thread,
             pg.origin_place,
             pg.last_page,
             pg.page,
             (((pg.page - 1) * ( SELECT pp.n
                    FROM pp)) + 1) AS first_seq,
             (pg.page * ( SELECT pp.n
                    FROM pp)) AS end_seq
            FROM pg
         ), range_acts AS MATERIALIZED (
          SELECT a.id,
             a."character",
             a.kind,
             a.thread,
             a.target_act_id,
             a.seq,
             a.created_at,
             a.payload,
             a.current_payload,
             a.edited_at,
             a.shown_edited_at,
             a.untaken,
             a.ends_at,
             a.hidden,
             a.any_hidden,
             a.concealing,
             a.payload_hidden,
             a.payload_concealing
            FROM acts_public a,
             rng
           WHERE ((a.thread = rng.id) AND ((a.seq >= rng.first_seq) AND (a.seq <= rng.end_seq)) AND (a.kind <> ALL (ARRAY['edit'::text, 'card'::text])))
         ), drawn AS MATERIALIZED (
          SELECT r.id,
             r.seq,
             r.kind,
             u.play,
             u.parent
            FROM (range_acts r
              CROSS JOIN LATERAL ( SELECT x.play,
                     x.parent
                    FROM post_under x
                   WHERE (x.reply = r.id)) u)
           WHERE (NOT card_ended(u.play))
         ), page_acts AS MATERIALIZED (
          SELECT r.id,
             r."character",
             r.kind,
             r.thread,
             r.target_act_id,
             r.seq,
             r.created_at,
             r.payload,
             r.current_payload,
             r.edited_at,
             r.shown_edited_at,
             r.untaken,
             r.ends_at,
             r.hidden,
             r.any_hidden,
             r.concealing,
             r.payload_hidden,
             r.payload_concealing
            FROM range_acts r
           WHERE (NOT (EXISTS ( SELECT 1
                    FROM drawn d
                   WHERE (d.id = r.id))))
         ), page_posts AS MATERIALIZED (
          SELECT a.id,
             a."character",
             a.created_at
            FROM page_acts a
           WHERE post_kind(a.kind)
         ), nested AS MATERIALIZED (
          SELECT u.play,
             p.id AS parent,
             a.id,
             a."character",
             a.created_at,
             to_jsonb(a.*) AS act
            FROM ((page_posts p
              CROSS JOIN LATERAL ( SELECT x.play,
                     x.reply
                    FROM post_under x
                   WHERE ((x.parent = p.id) AND (NOT card_ended(x.play)))) u)
              JOIN acts_public a ON ((a.id = u.reply)))
         ), posts AS MATERIALIZED (
          SELECT p.id,
             p."character",
             p.created_at
            FROM page_posts p
         UNION ALL
          SELECT n.id,
             n."character",
             n.created_at
            FROM nested n
         ), on_ids AS MATERIALIZED (
          SELECT x.post,
             x.play
            FROM post_play_ids(ARRAY( SELECT p.id
                    FROM posts p)) x
         ), on_all AS MATERIALIZED (
          SELECT i.play AS id
            FROM on_ids i
         UNION ALL
          SELECT r.r AS id
            FROM play_rider_ids(ARRAY( SELECT i.play
                    FROM on_ids i)) r(r)
         UNION ALL
          -- The board cards written in this thread, which sit on no post (target_act_id is null): from this page's first Act up to the next page's first (page 1 from the start, the last page to the end), at most 100.
          -- Read as the page reads every play, through acts_public, by id, in on_posts below; the page's `plays` leave them out and `boardCards` is made of them.
          SELECT b.b AS id
            FROM rng,
             board_card_ids(rng.id, rng.page, rng.first_seq, rng.end_seq) b(b)
         ), on_posts AS MATERIALIZED (
          SELECT a.id,
             a."character",
             a.kind,
             a.thread,
             a.target_act_id,
             a.seq,
             a.created_at,
             a.payload,
             a.current_payload,
             a.edited_at,
             a.shown_edited_at,
             a.untaken,
             a.ends_at,
             a.hidden,
             a.any_hidden,
             a.concealing,
             a.payload_hidden,
             a.payload_concealing
            FROM acts_public a
           WHERE (a.kind = ANY (ARRAY['card'::text, 'set'::text, 'spring'::text, 'take_back'::text])) AND (a.id = ANY (ARRAY( SELECT o.id
                    FROM on_all o)))
         ), ends_on_posts AS MATERIALIZED (
          SELECT a.id,
             a."character",
             a.kind,
             a.thread,
             a.target_act_id,
             a.seq,
             a.created_at,
             a.payload,
             a.current_payload,
             a.edited_at,
             a.shown_edited_at,
             a.untaken,
             a.ends_at,
             a.hidden,
             a.any_hidden,
             a.concealing,
             a.payload_hidden,
             a.payload_concealing
            FROM acts_public a
           WHERE ((a.kind = 'card_end'::text) AND (a.target_act_id IN ( SELECT o.id
                    FROM on_posts o
                   WHERE (o.target_act_id IS NOT NULL))))
         ), above AS MATERIALIZED (
          SELECT x.play,
             x.reach,
             x.target,
             x.ends_at,
             x.act
            FROM effects_above(ARRAY( SELECT DISTINCT p."character"
                    FROM posts p
                   WHERE (p."character" IS NOT NULL)), ( SELECT rng.id
                    FROM rng), ( SELECT rng.board
                    FROM rng)) x(play, reach, target, ends_at, act)
         ), kept_span AS MATERIALIZED (
          SELECT min(p.created_at) AS lo,
             max(p.created_at) AS hi
            FROM posts p
         ), kept_reach AS MATERIALIZED (
          SELECT x.play,
             x.reach,
             COALESCE(x."character", x.thread, x.board) AS target,
             x.ends_at
            FROM play_reach x,
             kept_span s
           WHERE ((s.lo IS NOT NULL) AND (x.thread = ( SELECT rng.id
                    FROM rng)) AND (tstzrange(x.started_at, x.ends_at) && tstzrange(s.lo, s.hi, '[]'::text)) AND (x.ends_at <= now()))
         UNION ALL
          SELECT x.play,
             x.reach,
             x."character" AS target,
             x.ends_at
            FROM ((( SELECT DISTINCT p."character"
                    FROM posts p
                   WHERE (p."character" IS NOT NULL)) au
              CROSS JOIN kept_span s)
              CROSS JOIN LATERAL ( SELECT r.play,
                     r.reach,
                     r."character",
                     r.ends_at
                    FROM play_reach r
                   WHERE ((r."character" = au."character") AND (tstzrange(r.started_at, r.ends_at) && tstzrange(s.lo, s.hi, '[]'::text)) AND (r.ends_at <= now()))) x)
         ), kept_window AS MATERIALIZED (
          SELECT r.play,
             r.reach,
             r.target,
             r.ends_at,
             a.created_at AS started,
             to_jsonb(a.*) AS act,
             (a.payload ->> 'card'::text) AS card
            FROM (kept_reach r
              JOIN acts_public a ON ((a.id = r.play))),
             kept_span s
           WHERE ((a.created_at <= s.hi) AND (EXISTS ( SELECT 1
                    FROM posts p
                   WHERE ((a.created_at <= p.created_at) AND (p.created_at < r.ends_at) AND ((r.reach <> 'character'::text) OR (p."character" = r.target))))))
         ), kept AS MATERIALIZED (
          SELECT w.play,
             w.reach,
             w.target,
             w.ends_at,
             w.act
            FROM (kept_window w
              JOIN card_kinds ck ON (((ck.key = w.card) AND ck.keeps)))
           WHERE (NOT card_ended(w.play))
           ORDER BY w.started, w.play
          LIMIT 100
         ), played AS MATERIALIZED (
          SELECT o.id,
             o.kind,
             o."character",
             (o.payload ->> 'card'::text) AS card
            FROM on_posts o
         UNION
          SELECT ((x.act ->> 'id'::text))::uuid AS uuid,
             (x.act ->> 'kind'::text),
             ((x.act ->> 'character'::text))::uuid AS uuid,
             ((x.act -> 'payload'::text) ->> 'card'::text)
            FROM above x
         UNION
          SELECT ((x.act ->> 'id'::text))::uuid AS uuid,
             (x.act ->> 'kind'::text),
             ((x.act ->> 'character'::text))::uuid AS uuid,
             ((x.act -> 'payload'::text) ->> 'card'::text)
            FROM kept x
         ), answers_on AS MATERIALIZED (
          SELECT o.visit_act,
             o.post_act,
             o.at
            FROM outcome_page_rows(ARRAY(( SELECT p.id
                    FROM posts p))) o
         ), vis AS MATERIALIZED (
          SELECT DISTINCT ON (u.id) u.id,
             u.post,
             u."character",
             u.created_at,
             u.payload
            FROM (( SELECT DISTINCT ON (v.target_act_id) v.id,
                     v.target_act_id AS post,
                     v."character",
                     v.created_at,
                     v.payload
                    FROM acts_public v
                   WHERE ((v.kind = 'visit'::text) AND (v.target_act_id IN ( SELECT a.id
                            FROM page_acts a
                           WHERE (a.kind = ANY (ARRAY['post'::text, 'spin'::text]))
                         UNION ALL
                          SELECT n.id
                            FROM nested n)))
                   ORDER BY v.target_act_id, v.created_at DESC, v.id DESC)
                 UNION ALL
                  SELECT v.id,
                     v.target_act_id,
                     v."character",
                     v.created_at,
                     v.payload
                    FROM acts_public v
                   WHERE ((v.kind = 'visit'::text) AND (v.id IN ( SELECT x.visit_act
                            FROM answers_on x)))) u
           ORDER BY u.id
         ), o_on AS MATERIALIZED (
          SELECT r.origin_act_id AS id
            FROM rng r
           WHERE ((r.origin_act_id IS NOT NULL) AND (EXISTS ( SELECT 1
                    FROM page_acts a
                   WHERE (a.id = r.first_act))))
         ), o_act AS MATERIALIZED (
          SELECT a.*
            FROM (o_on o
              JOIN acts_public a ON ((a.id = o.id)))
         ), o_ids AS MATERIALIZED (
          SELECT x.post,
             x.play
            FROM (o_on o
              CROSS JOIN LATERAL post_play_ids(ARRAY[o.id]) x)
         ), o_all AS MATERIALIZED (
          SELECT i.play AS id
            FROM o_ids i
         UNION ALL
          SELECT r.r AS id
            FROM play_rider_ids(ARRAY( SELECT i.play
                    FROM o_ids i)) r(r)
         ), o_plays AS MATERIALIZED (
          SELECT a.*
            FROM acts_public a
           WHERE (EXISTS ( SELECT 1
                    FROM o_ids x)) AND (a.kind = ANY (ARRAY['card'::text, 'set'::text, 'spring'::text, 'take_back'::text])) AND (a.id = ANY (ARRAY( SELECT o.id
                    FROM o_all o)))
         ), o_shown AS MATERIALIZED (
          SELECT s.*
            FROM o_plays s
         ), o_ends AS MATERIALIZED (
          SELECT e.*
            FROM acts_public e
           WHERE ((e.kind = 'card_end'::text) AND (e.target_act_id IN ( SELECT s.id
                    FROM o_shown s)))
         ), o_cast AS MATERIALIZED (
          SELECT w.c
            FROM ( SELECT a."character" AS c
                    FROM o_act a
                 UNION
                  SELECT s."character"
                    FROM o_shown s
                 UNION
                  SELECT
                         CASE
                             WHEN ((a.kind = ANY (ARRAY['card'::text, 'set'::text, 'spring'::text])) AND ((a.payload ->> 'reach'::text) = 'character'::text)) THEN ((a.payload ->> 'character'::text))::uuid
                             ELSE NULL::uuid
                         END AS "character"
                    FROM o_act a) w
           WHERE (w.c IS NOT NULL)
         ), o_post AS MATERIALIZED (
          SELECT x.id
            FROM ( SELECT
                         CASE
                             WHEN post_kind(a.kind) THEN a.id
                             WHEN (a.kind = 'poll'::text) THEN a.target_act_id
                             WHEN (a.kind = 'ballot'::text) THEN ( SELECT q.target_act_id
                                FROM acts_public q
                               WHERE (q.id = a.target_act_id))
                             ELSE NULL::uuid
                         END AS id
                    FROM o_act a) x
           WHERE (x.id IS NOT NULL)
         ), pl_post AS MATERIALIZED (
          SELECT p.id
            FROM posts p
         UNION
          SELECT o.id
            FROM o_post o
         ), pl_cur AS MATERIALIZED (
          SELECT x.id AS post,
             l.id AS poll,
             l.created_at,
             ((l.payload ->> 'secret'::text))::boolean AS secret,
             to_jsonb(l.*) AS act
            FROM (pl_post x
              CROSS JOIN LATERAL ( SELECT a.*
                    FROM acts_public a
                   WHERE ((a.kind = 'poll'::text) AND (a.target_act_id = x.id))
                   ORDER BY a.created_at DESC, a.id DESC
                  LIMIT 1) l)
           WHERE (NOT (l.payload ? 'removed'::text))
         ), pl_polls AS MATERIALIZED (
          SELECT c.post,
             c.poll,
             c.created_at,
             c.secret,
             c.act,
             k.counts,
             k.voters,
             k.ends_at,
             k.closed,
             cl.j AS close,
             EXISTS (SELECT 1 FROM acts b WHERE b.kind = 'ballot'::text AND b.target_act_id = c.poll) AS balloted
            FROM ((pl_cur c
              CROSS JOIN LATERAL ( SELECT n.counts,
                     n.voters,
                     n.ends_at,
                     n.closed
                    FROM poll_counts n
                   WHERE (n.poll = c.poll)) k)
              LEFT JOIN LATERAL ( SELECT to_jsonb(e.*) AS j
                    FROM acts_public e
                   WHERE ((e.kind = 'poll_close'::text) AND (e.target_act_id = c.poll))
                  LIMIT 1) cl ON (true))
         ), pl_voters AS MATERIALIZED (
          SELECT p.post,
             p.poll,
             b.id AS act,
             b."character",
             (b.payload -> 'picks'::text) AS picks,
             b.created_at
            FROM ((pl_polls p
              CROSS JOIN LATERAL poll_voter_acts(p.poll, p.ends_at, 50) v(act))
              CROSS JOIN LATERAL ( SELECT x.id,
                     x."character",
                     x.payload,
                     x.created_at
                    FROM acts_public x
                   WHERE (x.id = v.act)) b)
           WHERE (NOT p.secret)
         ), pl_cast AS MATERIALIZED (
          SELECT DISTINCT v."character" AS c
            FROM pl_voters v
           WHERE (v."character" IS NOT NULL)
         ), pl_mine AS MATERIALIZED (
          SELECT m.act,
             m.poll,
             p.post,
             m."character",
             m.picks,
             m.created_at
            FROM (my_latest_ballots m
              JOIN pl_polls p ON ((p.poll = m.poll)))
           WHERE (m.created_at < p.ends_at)
         UNION ALL
          SELECT b.act,
             l.poll,
             p.post,
             l."character",
             b.picks,
             b.created_at
            FROM ((my_latest_ballots l
              JOIN pl_polls p ON ((p.poll = l.poll)))
              CROSS JOIN LATERAL ( SELECT m.act,
                     m.picks,
                     m.created_at
                    FROM my_ballots m
                   WHERE ((m.poll = l.poll) AND (m."character" = l."character") AND (m.created_at < p.ends_at))
                   ORDER BY m.created_at DESC, m.act DESC
                  LIMIT 1) b)
           WHERE (l.created_at >= p.ends_at)
         ), ids AS MATERIALIZED (
          SELECT a.id
            FROM page_acts a
         UNION
          SELECT n.id
            FROM nested n
         UNION
          SELECT p.id
            FROM played p
         UNION
          SELECT a.id
            FROM o_act a
         UNION
          SELECT s.id
            FROM o_shown s
         UNION
          SELECT p.poll
            FROM pl_polls p
         ), who AS MATERIALIZED (
          SELECT w.c
            FROM ( SELECT a."character" AS c
                    FROM page_acts a
                 UNION
                  SELECT n."character"
                    FROM nested n
                 UNION
                  SELECT p."character"
                    FROM played p
                 UNION
                  SELECT v."character"
                    FROM vis v) w
           WHERE (w.c IS NOT NULL)
         ), wanted_plays AS MATERIALIZED (
          SELECT p.id
            FROM played p
           WHERE (p.card = ANY (COALESCE(thread_page.effect_cards, '{}'::text[])))
         UNION
          SELECT s.id
            FROM o_shown s
           WHERE ((s.payload ->> 'card'::text) = ANY (COALESCE(thread_page.effect_cards, '{}'::text[])))
         ), heads AS MATERIALIZED (
          SELECT c.id,
             jsonb_build_object('character', jsonb_build_object('id', c.id, 'name', c.name, 'joined', c.joined, 'staff', c.staff, 'office', c.office, 'warn_points', c.warn_points, 'banned_until', c.banned_until, 'locked_until', locked_out_until(c.id, thread_page.in_thread), 'group', c."group"), 'profile', ( SELECT (jsonb_build_object('character', p."character", 'title', p.title, 'signature', p.signature, 'avatar_square', p.avatar_square, 'avatar_portrait', p.avatar_portrait, 'square_frame', p.square_frame, 'portrait_frame', p.portrait_frame, 'pip_style', p.pip_style, 'pronouns', p.pronouns) || profile_cosmetics(p."character"))
                    FROM character_profiles p
                   WHERE (p."character" = c.id))) AS head
            FROM (( SELECT w.c
                    FROM who w
                 UNION
                  SELECT o.c
                    FROM o_cast o
                 UNION
                  SELECT v.c
                    FROM pl_cast v) k(id)
              CROSS JOIN LATERAL ( SELECT x.*
                    FROM characters_public x
                   WHERE (x.id = k.id)
                  OFFSET 0) c)
         ), spun AS MATERIALIZED (
          SELECT l.id,
             l.board,
             l.title,
             l.origin_act_id,
             l.created_at,
             l.last_at,
             l.last_seq,
             l.replies,
             l.first_act,
             l.first_character,
             l.last_act,
             l.last_character,
             l.replies_this_week,
             l.origin_thread,
             l.origin_place,
             l.n
            FROM ( SELECT t.id,
                     t.board,
                     t.title,
                     t.origin_act_id,
                     t.created_at,
                     t.last_at,
                     t.last_seq,
                     t.replies,
                     t.first_act,
                     t.first_character,
                     t.last_act,
                     t.last_character,
                     t.replies_this_week,
                     t.origin_thread,
                     t.origin_place,
                     row_number() OVER (PARTITION BY t.origin_act_id ORDER BY t.created_at, t.id) AS n
                    FROM thread_list t
                   WHERE (t.origin_act_id IN ( SELECT i.id
                            FROM ids i))) l
           WHERE (l.n <= 200)
         ), rw AS MATERIALIZED (
          -- The live rewind plays of the page's posts (and the replies drawn under them) and of the ORIGIN post, from one set-based read (post_rewind_plays), as `on_ids` reads post_play_ids.
          SELECT r.post,
             r.play,
             r.played_at,
             rewind_view(r.play) AS view
            FROM post_rewind_plays(ARRAY( SELECT x.id
                    FROM ( SELECT p.id
                            FROM posts p
                         UNION
                          SELECT o.id
                            FROM o_on o) x)) r
         )
  SELECT
         CASE
             WHEN (NOT (EXISTS ( SELECT 1
                FROM rng))) THEN NULL::jsonb
             ELSE jsonb_build_object('summary', ( SELECT (to_jsonb(s.*) - 'last_page'::text)
                FROM s), 'page', ( SELECT rng.page
                FROM rng), 'boardCards', ( SELECT COALESCE(jsonb_agg(to_jsonb(o.*) ORDER BY o.created_at, o.id), '[]'::jsonb) AS "coalesce"
                FROM on_posts o
               WHERE (o.target_act_id IS NULL)), 'acts', ( SELECT COALESCE(jsonb_agg(to_jsonb(a.*) ORDER BY a.seq), '[]'::jsonb) AS "coalesce"
                FROM page_acts a), 'people', ( SELECT COALESCE(jsonb_agg((c.head || jsonb_build_object('posts', COALESCE(( SELECT n.posts
                        FROM character_post_counts n
                       WHERE (n."character" = c.id)), 0), 'standing', COALESCE(( SELECT st.standing
                        FROM current_standings st
                       WHERE (st."character" = c.id)), 0), 'reveals', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', r.act, 'character', r."character", 'class', r.class, 'at', r.at, 'via', r.via, 'thread', r.thread) ORDER BY r.at, r.act), '[]'::jsonb) AS "coalesce"
                        FROM class_reveals r
                       WHERE (r."character" = c.id)), 'turns', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', u.act, 'character', u."character", 'at', u.at, 'was', u.was) ORDER BY u.at, u.act), '[]'::jsonb) AS "coalesce"
                        FROM turns_announced u
                       WHERE (u."character" = c.id)))) ORDER BY c.id), '[]'::jsonb) AS "coalesce"
                FROM heads c
               WHERE (c.id IN ( SELECT w.c
                        FROM who w))), 'plays', ( SELECT COALESCE(jsonb_agg(x.j ORDER BY x.created_at, x.id), '[]'::jsonb) AS "coalesce"
                FROM ( SELECT to_jsonb(o.*) AS j,
                         o.created_at,
                         o.id
                        FROM on_posts o
                       WHERE (o.target_act_id IS NOT NULL)
                     UNION ALL
                      SELECT to_jsonb(e.*) AS to_jsonb,
                         e.created_at,
                         e.id
                        FROM ends_on_posts e) x), 'counts', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('post', k.post, 'card', k.card, 'all', k.plays, 'took', k.took) ORDER BY k.post, k.card NULLS FIRST), '[]'::jsonb) AS "coalesce"
                FROM post_kind_counts(ARRAY( SELECT p.id
                        FROM posts p)) k), 'above', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('play', x.play, 'reach', x.reach, 'target', x.target, 'ends_at', x.ends_at, 'act', x.act) ORDER BY ((x.act ->> 'created_at'::text))::timestamp with time zone, x.play), '[]'::jsonb) AS "coalesce"
                FROM above x), 'kept', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('play', x.play, 'reach', x.reach, 'target', x.target, 'ends_at', x.ends_at, 'act', x.act) ORDER BY ((x.act ->> 'created_at'::text))::timestamp with time zone, x.play), '[]'::jsonb) AS "coalesce"
                FROM kept x), 'under', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('parent', n.parent, 'play', n.play, 'act', n.act) ORDER BY ((n.act ->> 'seq'::text))::integer, n.id), '[]'::jsonb) AS "coalesce"
                FROM nested n), 'cut', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('seq', d.seq, 'parent_seq', ( SELECT pa.seq
                        FROM acts_public pa
                       WHERE (pa.id = d.parent))) ORDER BY d.seq), '[]'::jsonb) AS "coalesce"
                FROM drawn d
               WHERE (d.kind = 'post'::text)), 'visits', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('visit', v.id, 'post', v.post, 'mod', v."character", 'at', v.created_at, 'ends_at', (v.payload -> 'ends_at'::text), 'line', (v.payload -> 'line'::text), 'charges', ((v.payload -> 'charges'::text) || COALESCE(( SELECT jsonb_agg((j.payload -> 'charge'::text) ORDER BY j.created_at, j.id) AS jsonb_agg
                        FROM acts_public j
                       WHERE ((j.kind = 'visit_join'::text) AND (j.target_act_id = v.id))), '[]'::jsonb)), 'challenge', (jsonb_strip_nulls(jsonb_build_object('kind', (v.payload #>> '{challenge,kind}'::text[]), 'question_index', (v.payload #> '{challenge,question_index}'::text[]), 'price', (v.payload #> '{challenge,price}'::text[]))) || COALESCE(visit_quiz(v.id), '{}'::jsonb)), 'end', ( SELECT jsonb_build_object('act', e.id, 'at', e.created_at, 'outcome', (e.payload ->> 'outcome'::text), 'by_act', (e.payload -> 'by_act'::text), 'line', (e.payload -> 'line'::text)) AS jsonb_build_object
                        FROM acts_public e
                       WHERE ((e.kind = 'visit_end'::text) AND (e.target_act_id = v.id))
                      LIMIT 1), 'ruling', ( SELECT (r.payload ->> 'verdict'::text)
                        FROM ((acts_public i
                          JOIN acts_public ap ON (((ap.kind = 'appeal'::text) AND (ap.target_act_id = i.id))))
                          JOIN acts_public r ON (((r.kind = 'appeal_ruling'::text) AND (r.target_act_id = ap.id))))
                       WHERE ((i.kind = 'infraction'::text) AND ((i.payload ->> 'visit_act'::text) = (v.id)::text))
                      LIMIT 1), 'answers', COALESCE(( SELECT jsonb_agg(x.post_act ORDER BY x.at, x.post_act) AS jsonb_agg
                        FROM answers_on x
                       WHERE (x.visit_act = v.id)), '[]'::jsonb)) ORDER BY v.created_at, v.id), '[]'::jsonb) AS "coalesce"
                FROM vis v), 'faces', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('play', f.play, 'card', f.card)), '[]'::jsonb) AS "coalesce"
                FROM my_face_down f
               WHERE (f.play IN ( SELECT p.id
                        FROM played p
                       WHERE (p.kind = 'set'::text)))), 'veiled', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('post', v.post, 'character', v."character", 'play', v.play, 'ends_at', v.ends_at) ORDER BY v.post), '[]'::jsonb) AS "coalesce"
                FROM my_veiled_posts v
               WHERE (v.post IN ( SELECT p.id
                        FROM posts p))), 'states', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('play', e.play, 'state', e.state, 'saved_at', e.saved_at)), '[]'::jsonb) AS "coalesce"
                FROM effect_state e
               WHERE (e.play IN ( SELECT w.id
                        FROM wanted_plays w))), 'releases', ( SELECT COALESCE(jsonb_agg(r.play), '[]'::jsonb) AS "coalesce"
                FROM effect_releases r
               WHERE (r.play IN ( SELECT w.id
                        FROM wanted_plays w))), 'spent', ( SELECT COALESCE(jsonb_agg(o.id ORDER BY o.created_at, o.id), '[]'::jsonb) AS "coalesce"
                FROM (on_posts o
                  JOIN card_kinds ck ON (((ck.key = (o.payload ->> 'card'::text)) AND ((ck.discipline ->> 'kind'::text) = 'fall'::text))))
               WHERE ((o.kind = 'card'::text) AND fall_spent(o.id))), 'surfaces', ( SELECT COALESCE(jsonb_object_agg((sf.play)::text, jsonb_build_object('covered', bit_count(sf.cover), 'live', to_jsonb(sf.live))), '{}'::jsonb) AS "coalesce"
                FROM surfaces sf
               WHERE (sf.play IN ( SELECT o.id
                        FROM on_posts o
                       WHERE (o.kind = 'card'::text)))), 'tallies', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', t.act, 'kind', t.kind, 'count', t.count)), '[]'::jsonb) AS "coalesce"
                FROM reaction_tallies t
               WHERE (t.act IN ( SELECT i.id
                        FROM ids i))), 'mine', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', m.act, 'kind', m.kind, 'character', m."character")), '[]'::jsonb) AS "coalesce"
                FROM my_reactions m
               WHERE (m.act IN ( SELECT i.id
                        FROM ids i))), 'polls', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('post', p.post, 'act', p.act, 'counts', to_jsonb(p.counts), 'voters', p.voters, 'ends_at', p.ends_at, 'closed', p.closed, 'close', p.close, 'balloted', p.balloted) ORDER BY p.created_at, p.poll), '[]'::jsonb) AS "coalesce"
                FROM pl_polls p), 'voters', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('poll', v.poll, 'act', v.act, 'character', v."character", 'picks', v.picks, 'at', v.created_at) ORDER BY v.poll, v.created_at DESC, v.act DESC), '[]'::jsonb) AS "coalesce"
                FROM pl_voters v), 'votersMore', ( SELECT COALESCE(jsonb_agg(p.poll ORDER BY p.created_at, p.poll), '[]'::jsonb) AS "coalesce"
                FROM pl_polls p
               WHERE ((NOT p.secret) AND (p.voters > 50))), 'voterCast', ( SELECT COALESCE(jsonb_agg(h.head ORDER BY h.id), '[]'::jsonb) AS "coalesce"
                FROM heads h
               WHERE (h.id IN ( SELECT v.c
                        FROM pl_cast v))), 'myBallots', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', m.act, 'poll', m.poll, 'character', m."character", 'picks', m.picks, 'at', m.created_at) ORDER BY m.created_at, m.act), '[]'::jsonb) AS "coalesce"
                FROM pl_mine m), 'spun', ( SELECT COALESCE(jsonb_agg((to_jsonb(l.*) - 'n'::text) ORDER BY l.created_at, l.id), '[]'::jsonb) AS "coalesce"
                FROM spun l), 'reading', ( SELECT r.furthest_seq
                FROM reading r
               WHERE (r.thread = thread_page.in_thread)
              LIMIT 1), 'board', ( SELECT jsonb_build_object('id', b.id, 'slug', b.slug, 'name', b.name, 'description', b.description, 'is_system', b.is_system, 'move_act', b.move_act) AS jsonb_build_object
                FROM boards_now b
               WHERE (b.id = ( SELECT rng.board
                        FROM rng))), 'following', following_thread(in_thread), 'presence', presence_box('thread'::text, in_thread), 'unread', my_alerts_unread(), 'rewinds', ( SELECT COALESCE(jsonb_agg(w.view ORDER BY w.played_at DESC, w.play DESC), '[]'::jsonb) AS "coalesce"
                FROM rw w
               WHERE (w.view IS NOT NULL))) ||
             CASE
                 WHEN (EXISTS ( SELECT 1
                    FROM o_on)) THEN jsonb_build_object('origin', jsonb_build_object('act', ( SELECT to_jsonb(a.*) AS to_jsonb
                        FROM o_act a), 'plays', ( SELECT COALESCE(jsonb_agg(x.j ORDER BY x.grp, x.created_at, x.id), '[]'::jsonb) AS "coalesce"
                        FROM ( SELECT to_jsonb(s.*) AS j,
                                 0 AS grp,
                                 s.created_at,
                                 s.id
                                FROM o_shown s
                             UNION ALL
                              SELECT to_jsonb(e.*) AS to_jsonb,
                                 1,
                                 e.created_at,
                                 e.id
                                FROM o_ends e) x), 'counts', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('post', k.post, 'card', k.card, 'all', k.plays, 'took', k.took) ORDER BY k.post, k.card NULLS FIRST), '[]'::jsonb) AS "coalesce"
                        FROM post_kind_counts(ARRAY( SELECT o.id
                                FROM o_on o)) k), 'moment', origin_moment(in_thread), 'at', ( SELECT jsonb_build_object('thread', (z.q ->> 'thread'::text), 'seq', ((z.q ->> 'seq'::text))::integer) AS jsonb_build_object
                        FROM ( SELECT
                                 CASE
                                     WHEN ((r.origin_place ->> 'kind'::text) = 'play'::text) THEN COALESCE(NULLIF((r.origin_place -> 'at'::text), 'null'::jsonb),
                                     CASE
                                         WHEN ((r.origin_place #>> '{on,kind}'::text[]) = 'post'::text) THEN (r.origin_place -> 'on'::text)
                                         ELSE NULLIF((r.origin_place -> 'from'::text), 'null'::jsonb)
                                     END)
                                     WHEN ((r.origin_place ->> 'kind'::text) = ANY (ARRAY['poll'::text, 'ballot'::text])) THEN (r.origin_place -> 'on'::text)
                                     ELSE NULL::jsonb
                                 END AS q
                                FROM rng r) z
                       WHERE (jsonb_typeof(z.q) = 'object'::text)), 'cast', ( SELECT COALESCE(jsonb_agg(h.head ORDER BY h.id), '[]'::jsonb) AS "coalesce"
                        FROM heads h
                       WHERE (h.id IN ( SELECT o.c
                                FROM o_cast o
                             UNION
                              SELECT v."character"
                                FROM pl_voters v
                               WHERE ((v.post IN ( SELECT op.id
                                        FROM o_post op)) AND (EXISTS ( SELECT 1
                                        FROM o_act a
                                       WHERE (a.kind = ANY (ARRAY['poll'::text, 'ballot'::text]))))))))) ||
                     CASE
                         WHEN (EXISTS ( SELECT 1
                            FROM o_act a
                           WHERE (a.kind = ANY (ARRAY['poll'::text, 'ballot'::text])))) THEN jsonb_build_object('polls', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('post', p.post, 'act', p.act, 'counts', to_jsonb(p.counts), 'voters', p.voters, 'ends_at', p.ends_at, 'closed', p.closed, 'close', p.close, 'balloted', p.balloted) ORDER BY p.created_at, p.poll), '[]'::jsonb) AS "coalesce"
                            FROM pl_polls p
                           WHERE (p.post IN ( SELECT op.id
                                    FROM o_post op))), 'voters', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('poll', v.poll, 'act', v.act, 'character', v."character", 'picks', v.picks, 'at', v.created_at) ORDER BY v.poll, v.created_at DESC, v.act DESC), '[]'::jsonb) AS "coalesce"
                            FROM pl_voters v
                           WHERE (v.post IN ( SELECT op.id
                                    FROM o_post op))), 'votersMore', ( SELECT COALESCE(jsonb_agg(p.poll ORDER BY p.created_at, p.poll), '[]'::jsonb) AS "coalesce"
                            FROM pl_polls p
                           WHERE ((NOT p.secret) AND (p.voters > 50) AND (p.post IN ( SELECT op.id
                                    FROM o_post op)))), 'myBallots', ( SELECT COALESCE(jsonb_agg(jsonb_build_object('act', m.act, 'poll', m.poll, 'character', m."character", 'picks', m.picks, 'at', m.created_at) ORDER BY m.created_at, m.act), '[]'::jsonb) AS "coalesce"
                            FROM pl_mine m
                           WHERE (m.post IN ( SELECT op.id
                                    FROM o_post op))))
                         ELSE '{}'::jsonb
                     END)
                 ELSE '{}'::jsonb
             END
         END AS jsonb_build_object
  );
end
$function$;
