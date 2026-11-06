-- Visits (the Mod Bots design, section 6; its plan, Task 6).
--
-- A visit is a Mod's inspection of one post that broke a rule in force, built from Acts: `visit` (by the Mod, on the post: its charges, when it ends, what talks
-- it down, and the Mod's arrival line), `visit_join` (by the Mod, on the visit: a charge added while it is open) and `visit_end` (of no character, on the
-- visit: filed, intercepted, trapped or reversed, with the line said). None of them takes a seq in the thread, as a card's play takes none, so a visit never
-- moves a page. A post has at most one open visit; a second charge joins it. `visits_open` is derived state, one row per open visit, kept by a trigger as
-- `open_moves` is; the tick reads it by its index on the end time, so a busy instance's tick reads only the visits that are due.
--
-- What starts one. `post()` and `start_thread()` call `draw_visits` after the insert: each rule in force that the post breaks (`rule_breaks`, plain code) becomes
-- a charge, started by `start_visit` with the Mod on the post's board's beat (`beat_of`). A rule never refuses a post: with no Mod on staff beat_of answers null
-- and no visit starts; a post by a staff character starts none; and whatever draw_visits meets, it is caught (a warning), so the post goes up. rule_breaks runs
-- only on a new post and a new thread, never on `edit_post`: an edit is not checked (the design's rules are read against a post as it was made). A spin's opening
-- post is not hooked either: `infract` is for a `post` (Task 5), and a visit that could never file would be a trap. A character with an open tail (Task 9; the
-- hook `open_tail_staff` is empty until then) draws a visit for Obstruction on its next post.
--
-- Its window. The persona's hours (`staff_visit_traits`, seeded from `Persona.strictness.visitHours`) are clamped into `modBots.visitHours`, and the hours are
-- drawn between them by a hash of the post's id, so a retry draws the same. The same hash draws a quiz's question (`question_index` of the persona's `questions`);
-- a bribe's price and a distraction come from the persona. The quiz's answers are never in SQL here or in any read a client has: Task 9 owns them.
--
-- Filing. `file_visit(visit, line)` writes the `visit_end` (filed) with the line, then `infract`s once: the band is the highest of the visit's charges and the
-- join's, and the infraction carries THAT charge's rule number (the first of the highest band when bands tie; null for Obstruction). One infraction per visit.
-- It is idempotent and safe against the tick and the filing cron racing: it takes the visit's open row for update, and a visit already ended returns its end
-- and files nothing. `end_visit` is the one writer of a `visit_end`, for the other outcomes Task 9 and Task 10 add. The tick files each open visit
-- `filingGraceMinutes` past its end with the stock line `visitFiled`, whatever the switch says, so nothing waits on a model.
--
-- Masks. start_visit reads no owner; a visit's charge, window and challenge are public, and a visit's players are characters.
--
-- Ways out. A visit ends by itself: the tick files it past its end whether or not its Mod is still on staff (a Mod that has left is named on the infraction all
-- the same), and an interception, a trap or an admin's reversal may end it first. A tick that cannot file one (an error) tries again at the next tick and says so.

-- ---------------------------------------------------------------------------------------------------- the Acts ----

alter table acts drop constraint acts_kind_check;
alter table acts add constraint acts_kind_check check (kind in ('post', 'spin', 'card', 'edit', 'tally', 'reveal', 'unmask', 'move', 'move_end', 'move_keep', 'set', 'spring', 'update', 'card_end', 'describe', 'infraction', 'ban',
  'visit', 'visit_join', 'visit_end'));

alter table acts drop constraint acts_character_null;
alter table acts add constraint acts_character_null check ((character is null) = (kind in ('tally', 'reveal', 'move_end', 'card_end', 'describe', 'infraction', 'ban', 'visit_end')));

alter table acts drop constraint acts_seq_check;
alter table acts add constraint acts_seq_check check ((kind = 'edit') = (seq is null) or kind in ('card', 'set', 'spring', 'card_end', 'describe', 'infraction', 'ban', 'visit', 'visit_join', 'visit_end'));

-- The shape of each: a visit's charges (each checked in the guard), its end time, its challenge and its arrival line; a join's charge and the band the visit holds with
-- it; an end's visit, outcome, the Act that ended it (an interception, a trap) and the line said.
alter table acts add constraint acts_visit_payload check (
  case kind
    when 'visit' then payload - 'charges' - 'ends_at' - 'challenge' - 'line' = '{}'::jsonb
      and jsonb_typeof(payload -> 'charges') = 'array' and jsonb_array_length(payload -> 'charges') = 1
      and jsonb_typeof(payload -> 'ends_at') = 'string'
      and jsonb_typeof(payload -> 'challenge') = 'object' and payload #>> '{challenge,kind}' in ('quiz', 'bribe', 'distraction')
      and jsonb_typeof(payload -> 'line') = 'string'
    when 'visit_join' then payload - 'charge' - 'band' = '{}'::jsonb
      and jsonb_typeof(payload -> 'charge') = 'object' and payload ->> 'band' in ('minor', 'moderate', 'severe')
    when 'visit_end' then payload - 'visit_act' - 'outcome' - 'by_act' - 'line' = '{}'::jsonb
      and jsonb_typeof(payload -> 'visit_act') = 'string' and payload ->> 'visit_act' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and payload ->> 'outcome' in ('filed', 'intercepted', 'trapped', 'reversed')
      and (not payload ? 'by_act' or (jsonb_typeof(payload -> 'by_act') = 'string' and payload ->> 'by_act' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
      and jsonb_typeof(payload -> 'line') = 'string'
    else true
  end is true);

-- One end per visit, and a post's visits are found by the post.
create unique index acts_one_visit_end on acts (target_act_id) where kind = 'visit_end';
create index acts_visits_by_post on acts (target_act_id, created_at desc, id desc) where kind = 'visit';
create index acts_visit_joins on acts (target_act_id, created_at, id) where kind = 'visit_join';

-- acts_take_seq (0102), also leaving a visit, a join and an end out of their thread's seq; everything else as 0102 wrote it.
create or replace function acts_take_seq() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.kind in ('edit', 'card', 'set', 'spring', 'card_end', 'describe', 'infraction', 'ban', 'visit', 'visit_join', 'visit_end') then
    new.seq := null;
  else
    -- On the right of an assignment a column is its old value: a post that takes a seq above 1 is a reply.
    update threads set next_seq = next_seq + 1, last_at = greatest(last_at, new.created_at),
                       replies = replies + case when new.kind = 'post' and next_seq > 1 then 1 else 0 end
     where id = new.thread returning next_seq - 1 into new.seq;
  end if;
  return new;
end $$;

-- ------------------------------------------------------------------------------------------------- the traits ----

-- What a persona's visits are like: its hours and what talks it down. Not an Act: the instance's own content, replaced by a reseed. A challenge carries a kind and
-- its number only (a quiz's question count, a bribe's price), never an answer; a client cannot read this table.
create table staff_visit_traits (
  staff text primary key references characters (staff),
  visit_least integer not null check (visit_least >= 1),
  visit_most integer not null check (visit_most >= visit_least),
  challenge jsonb not null check (jsonb_typeof(challenge) = 'object' and challenge ->> 'kind' in ('quiz', 'bribe', 'distraction'))
);
alter table staff_visit_traits enable row level security;
revoke all on staff_visit_traits from public, anon, authenticated;

-- What is wrong with a persona's seeded visit traits, or null (engine/rules/instance.ts holds the same for the TypeScript side): whole hours, the least at least 1 and no
-- more than the most; a challenge of a known kind carrying exactly its number, so a quiz's answers cannot ride in.
create function visit_traits_problem(hours jsonb, challenge jsonb) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare k text := challenge ->> 'kind';
begin
  if hours is not null and not coalesce(jsonb_typeof(hours) = 'object' and (select count(*) from jsonb_object_keys(hours)) = 2
      and setting_whole(hours -> 'least', 1) and setting_whole(hours -> 'most', 1) and (hours ->> 'most')::numeric >= (hours ->> 'least')::numeric, false) then
    return 'visitHours is a least and a most, whole hours, the least at least 1 and no more than the most';
  end if;
  if challenge is not null then
    if jsonb_typeof(challenge) is distinct from 'object' or k is null or k not in ('quiz', 'bribe', 'distraction') then return 'a challenge is a quiz, a bribe or a distraction'; end if;
    if k = 'quiz' and not (challenge - 'kind' - 'questions' = '{}'::jsonb and setting_whole(challenge -> 'questions', 1, 1000)) then return 'a quiz carries only kind and questions (how many, at least 1)'; end if;
    if k = 'bribe' and not (challenge - 'kind' - 'price' = '{}'::jsonb and setting_whole(challenge -> 'price', 0, 2147483647)) then return 'a bribe carries only kind and price (a whole number, at least 0)'; end if;
    if k = 'distraction' and challenge - 'kind' <> '{}'::jsonb then return 'a distraction carries only its kind'; end if;
  end if;
  return null;
end $$;
revoke execute on function visit_traits_problem(jsonb, jsonb) from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------ the open visits ----

-- The visits open now: one row each, filled when a visit is written and cleared when its end is, as `open_moves` is (0046). One per post (the unique index).
create table visits_open (
  visit_act uuid primary key references acts (id),
  post uuid not null references acts (id),
  ends_at timestamptz not null
);
create unique index visits_open_post on visits_open (post);
-- The tick's read: the visits whose time (and grace) is past, oldest first.
create index visits_open_due on visits_open (ends_at, visit_act);
alter table visits_open enable row level security;
revoke all on visits_open from public, anon, authenticated;

create function acts_track_visits() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.kind = 'visit' then
    insert into visits_open (visit_act, post, ends_at) values (new.id, new.target_act_id, (new.payload ->> 'ends_at')::timestamptz);
  else
    delete from visits_open where visit_act = new.target_act_id;
  end if;
  return null;
end $$;
revoke execute on function acts_track_visits() from public, anon, authenticated;
create trigger acts_track_visits after insert on acts for each row when (new.kind in ('visit', 'visit_end')) execute function acts_track_visits();

-- visits_open is derived state and a restore fires no trigger: an admin runs this after a partial one. In one statement it removes every row whose Act is no visit or
-- whose visit has an end, and adds a row for every visit with none. Returns how many rows it changed.
create function rebuild_visits_open() returns integer
language sql security definer set search_path = public, pg_temp as $$
  with gone as (
    delete from visits_open o
    where not exists (select 1 from acts a where a.id = o.visit_act and a.kind = 'visit')
       or exists (select 1 from acts e where e.kind = 'visit_end' and e.target_act_id = o.visit_act)
    returning 1
  ), added as (
    insert into visits_open (visit_act, post, ends_at)
    select a.id, a.target_act_id, (a.payload ->> 'ends_at')::timestamptz from acts a
    where a.kind = 'visit' and not exists (select 1 from acts e where e.kind = 'visit_end' and e.target_act_id = a.id)
    on conflict do nothing
    returning 1
  )
  select ((select count(*) from gone) + (select count(*) from added))::integer
$$;
revoke execute on function rebuild_visits_open() from public, anon, authenticated;
grant execute on function rebuild_visits_open() to service_role;

-- Only a Mod visits and only a Mod's visit gains a charge, each well formed beyond what a check can say; a visit_end is written only through end_visit.
create function acts_visit_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  charge jsonb;
  t acts%rowtype;
begin
  if new.kind = 'visit_end' then
    if coalesce(current_setting('kayfabb.visit_writer', true), '') <> 'on' then
      raise exception 'a visit ends only through end_visit' using hint = 'kayfabb.refusal', errcode = '42501';
    end if;
  elsif not exists (select 1 from characters c where c.id = new.character and c.staff is not null) then
    raise exception 'a % is a staff character''s Act', new.kind using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  select * into t from acts where id = new.target_act_id;
  if new.kind = 'visit' then
    if t.kind is distinct from 'post' or t.thread <> new.thread or exists (select 1 from characters c where c.id = t.character and c.staff is not null) then
      raise exception 'a visit is of a player''s post, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
    end if;
    perform (new.payload ->> 'ends_at')::timestamptz;
  elsif new.kind = 'visit_join' then
    if t.kind is distinct from 'visit' or t.thread <> new.thread or not exists (select 1 from visits_open o where o.visit_act = t.id) then
      raise exception 'a visit_join is of an open visit, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
    end if;
  else
    if t.kind is distinct from 'visit' or t.thread <> new.thread or new.payload ->> 'visit_act' <> t.id::text then
      raise exception 'a visit_end is of a visit, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
    end if;
  end if;
  -- A charge: the rule it names (null where none: Obstruction, a premise), the board, a band, what drew it and the post it is about.
  for charge in select c from jsonb_array_elements(case new.kind when 'visit' then new.payload -> 'charges' when 'visit_join' then jsonb_build_array(new.payload -> 'charge') else '[]'::jsonb end) c loop
    if jsonb_typeof(charge) is distinct from 'object' or charge ->> 'band' is null or charge ->> 'band' not in ('minor', 'moderate', 'severe')
       or charge ->> 'cause' is null or charge ->> 'cause' not in ('rule', 'report', 'patrol', 'tail')
       or jsonb_typeof(charge -> 'rule_number') not in ('number', 'null') or (jsonb_typeof(charge -> 'board') is distinct from 'string')
       or jsonb_typeof(charge -> 'about_act') is distinct from 'string' then
      raise exception 'a charge names its rule number (or null), board, band, cause and the post it is about: %', charge using hint = 'kayfabb.refusal', errcode = '23514';
    end if;
  end loop;
  return new;
end $$;
revoke execute on function acts_visit_guard() from public, anon, authenticated;
create trigger acts_visit_guard before insert on acts for each row when (new.kind in ('visit', 'visit_join', 'visit_end')) execute function acts_visit_guard();

-- write_staff_act (0082), also writing a visit and a join. A visit_end is of no character and is written only by end_visit. Everything else as 0082 wrote it.
create or replace function write_staff_act(staff_key text, kind text, thread uuid, target uuid, payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  who uuid;
  whose text;
  written uuid;
  held text;
begin
  select c.id, c.staff_kind into who, whose from characters c where c.staff = staff_key;
  if whose = 'developer' then
    raise exception 'the developer speaks only through post_update, by an admin' using errcode = '42501';
  end if;
  if kind is null or kind not in ('post', 'spin', 'card', 'edit', 'move', 'move_keep', 'visit', 'visit_join') then
    raise exception 'a staff character posts, spins, plays a card, edits, moves, keeps a move or visits, not %', coalesce(kind, 'nothing') using errcode = '22023';
  end if;
  if jsonb_typeof(payload) is distinct from 'object' then raise exception 'an Act''s payload is an object' using errcode = '22023'; end if;
  if who is null then raise exception 'there is no staff member "%"', staff_key using errcode = 'P0002'; end if;
  -- A persona that has not debuted writes nothing, and a benched one is silent (0082).
  select o.office into held from staff_office_now o where o.staff = staff_key;
  if held in ('waiting', 'benched') then
    raise exception 'a % persona writes nothing', held using errcode = '55000';
  end if;
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload) values (who, kind, thread, target, payload) returning id into written;
  perform set_config('kayfabb.staff_writer', '', true);
  return act_projection(written);
end $$;

-- ----------------------------------------------------------------------------------------------- the window, the challenge ----

-- How long a visit by `staff` on `post` runs: the persona's hours clamped (each end) into modBots.visitHours (the engine's 2 to 12 where the setting is not
-- there), then drawn between them by a hash of the post's id, so the same post draws the same window however often it is asked. A persona with no traits row takes
-- the settings' whole range.
create function visit_window(post uuid, staff text) returns interval
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  s_lo integer := coalesce((select (m.value #>> '{visitHours,least}')::integer from settings m where m.key = 'modBots'), 2);
  s_hi integer := coalesce((select (m.value #>> '{visitHours,most}')::integer from settings m where m.key = 'modBots'), 12);
  p_lo integer;
  p_hi integer;
  lo integer;
  hi integer;
begin
  select t.visit_least, t.visit_most into p_lo, p_hi from staff_visit_traits t where t.staff = visit_window.staff;
  lo := least(greatest(coalesce(p_lo, s_lo), s_lo), s_hi);
  hi := least(greatest(coalesce(p_hi, s_hi), s_lo), s_hi);
  return make_interval(hours => lo + (mod(hashtextextended(post::text, 0) & 9223372036854775807, (hi - lo + 1)::bigint))::integer);
end $$;
revoke execute on function visit_window(uuid, text) from public, anon, authenticated;
grant execute on function visit_window(uuid, text) to service_role;

-- What talks a visit of `staff` on `post` down, as the visit carries it: a quiz with the index of the question drawn by a hash of the post (of the persona's
-- `questions`), a bribe with its price, or a distraction. Never an answer. A persona with no traits is a distraction.
create function visit_challenge(post uuid, staff text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c jsonb;
begin
  select t.challenge into c from staff_visit_traits t where t.staff = visit_challenge.staff;
  if c is null then return jsonb_build_object('kind', 'distraction'); end if;
  if c ->> 'kind' = 'quiz' then
    return jsonb_build_object('kind', 'quiz', 'question_index', mod(hashtextextended(post::text || ':question', 0) & 9223372036854775807, (c ->> 'questions')::bigint)::integer);
  elsif c ->> 'kind' = 'bribe' then
    return jsonb_build_object('kind', 'bribe', 'price', (c ->> 'price')::integer);
  end if;
  return jsonb_build_object('kind', 'distraction');
end $$;
revoke execute on function visit_challenge(uuid, text) from public, anon, authenticated;
grant execute on function visit_challenge(uuid, text) to service_role;

-- The charges of a visit: the one it started with, then each join's, in order.
create function visit_charges(visit uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x.c order by x.k, x.n), '[]'::jsonb)
  from (
    select e.c, 0 as k, e.n from acts v, jsonb_array_elements(v.payload -> 'charges') with ordinality e(c, n) where v.id = visit and v.kind = 'visit'
    union all
    select j.payload -> 'charge', 1, row_number() over (order by j.created_at, j.id) from acts j where j.kind = 'visit_join' and j.target_act_id = visit
  ) x
$$;
revoke execute on function visit_charges(uuid) from public, anon, authenticated;

-- A Mod's line on a visit, from the instance's stock lines (`visitArrived`, `visitFiled`): {mod} is the Mod's name and {rule} the rules charged, in words, one after
-- another. Where the instance gave no line the plain default says the same.
create function visit_line(line_key text, staff text, charges jsonb) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  lines jsonb;
  mod_name text := coalesce((select c.name from characters c where c.staff = visit_line.staff), '');
  rules text := coalesce(nullif((select string_agg(coalesce(nullif(c ->> 'rule', ''), 'a breach of the rules'), '; ' order by n) from jsonb_array_elements(charges) with ordinality e(c, n)), ''), 'a breach of the rules');
begin
  select s.value -> line_key into lines from settings s where s.key = 'systemLines';
  if jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) > 0 and jsonb_typeof(lines -> 0) = 'string' then
    return fill_tokens(lines ->> floor(random() * jsonb_array_length(lines))::integer, jsonb_build_object('mod', mod_name, 'rule', rules));
  end if;
  return case line_key when 'visitArrived' then mod_name || ' is looking at this post under ' || rules || '.' else mod_name || ' filed this post under ' || rules || '.' end;
end $$;
revoke execute on function visit_line(text, text, jsonb) from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------------ the hooks ----

-- The staff member whose tail the character is under, or null (Task 9 writes the tails, appends to them and replaces this body): a character with an open tail draws
-- a visit for Obstruction on its next post. Empty until then, so nothing here names a table that is not there yet.
create function open_tail_staff(who uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$ select null::text $$;
revoke execute on function open_tail_staff(uuid) from public, anon, authenticated;

-- Whether a card's trap springs on a visit: only once a card with a visit trigger exists (the seed and card_kinds_problem refuse one until Task 9 wires the trigger).
-- Task 9 removes this check and start_visit calls spring_traps always.
create function visit_traps_wired() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$ select exists (select 1 from card_kinds k where k.trap #>> '{trigger,on}' = 'visit') $$;
revoke execute on function visit_traps_wired() from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------------ start_visit ----

-- A Mod's visit starts on a post, or a charge joins the visit already open on it. `charge` is {rule_number (null where none), board, band, cause (rule | report |
-- patrol | tail), about_act, predicate?, rule? (the rule in words)}; about_act is taken to be the post when it is left out. Returns {visit, joined, ends_at, sprung}:
-- joined is true when a visit_join was written, false when the charge was already on the open visit; {visit: null, repeat: true} when an earlier visit of the post
-- already carried the charge (a post is not charged twice for one breach), and null for a post by a staff character (no visit). Reads no owner: the charge, the window
-- and the challenge are public and drawn from the post's id.
create function start_visit(post_act uuid, staff text, charge jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p record;
  ch jsonb;
  open_visit uuid;
  held jsonb;
  top text;
  same boolean;
  ends timestamptz;
  written uuid;
  joined uuid;
  sprung jsonb;
begin
  select a.id, a.thread, t.board, c.staff is not null as by_staff into p
  from acts a join threads t on t.id = a.thread join characters c on c.id = a.character where a.id = post_act and a.kind = 'post';
  if not found then raise exception 'there is no such post to visit' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if p.by_staff then return null; end if;
  if jsonb_typeof(charge) is distinct from 'object' or charge ->> 'band' is null or charge ->> 'band' not in ('minor', 'moderate', 'severe') or charge ->> 'cause' is null or charge ->> 'cause' not in ('rule', 'report', 'patrol', 'tail') then
    raise exception 'a charge names its band and its cause' using errcode = '22023';
  end if;
  ch := jsonb_strip_nulls(jsonb_build_object('predicate', charge -> 'predicate', 'rule', charge -> 'rule')) || jsonb_build_object(
    'rule_number', coalesce(charge -> 'rule_number', 'null'::jsonb), 'board', coalesce(charge ->> 'board', p.board::text), 'band', charge ->> 'band', 'cause', charge ->> 'cause',
    'about_act', coalesce(charge ->> 'about_act', post_act::text));
  -- One decision per post at a time: two charges drawn at once meet here, and the second joins.
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.visit:' || post_act::text, 0));
  select o.visit_act into open_visit from visits_open o where o.post = post_act;
  -- The charge may already be on this post, on an open visit or an ended one.
  select exists (
    select 1 from acts x, jsonb_array_elements(case x.kind when 'visit' then x.payload -> 'charges' else jsonb_build_array(x.payload -> 'charge') end) c
    where (x.kind = 'visit' and x.target_act_id = post_act or x.kind = 'visit_join' and x.target_act_id in (select v.id from acts v where v.kind = 'visit' and v.target_act_id = post_act))
      and c ->> 'cause' = ch ->> 'cause' and c ->> 'rule_number' is not distinct from ch ->> 'rule_number' and c ->> 'board' = ch ->> 'board') into same;
  if same then
    return case when open_visit is not null then jsonb_build_object('visit', open_visit, 'joined', false) else jsonb_build_object('visit', null, 'repeat', true) end;
  end if;
  if open_visit is not null then
    -- A second charge joins; the band the visit holds is the highest of its charges.
    held := visit_charges(open_visit);
    top := (select c ->> 'band' from jsonb_array_elements(held || jsonb_build_array(ch)) c
            order by case c ->> 'band' when 'severe' then 3 when 'moderate' then 2 else 1 end desc limit 1);
    joined := (write_staff_act(staff, 'visit_join', p.thread, open_visit, jsonb_build_object('charge', ch, 'band', top)) ->> 'id')::uuid;
    return jsonb_build_object('visit', open_visit, 'joined', true, 'join', joined);
  end if;
  ends := now() + visit_window(post_act, staff);
  written := (write_staff_act(staff, 'visit', p.thread, post_act, jsonb_build_object(
    'charges', jsonb_build_array(ch), 'ends_at', ends, 'challenge', visit_challenge(post_act, staff), 'line', visit_line('visitArrived', staff, jsonb_build_array(ch)))) ->> 'id')::uuid;
  -- A trap set on the post springs when a visit starts on it (Task 9 wires the trigger and removes this check).
  if visit_traps_wired() then sprung := spring_traps('visit', post_act, written); end if;
  return jsonb_build_object('visit', written, 'joined', false, 'ends_at', ends) || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $$;
revoke execute on function start_visit(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function start_visit(uuid, text, jsonb) to service_role;

-- What a new post draws: each rule in force that it breaks becomes a charge on the beat Mod's visit, and a character under a tail draws Obstruction (minor, no rule).
-- Called by post() and start_thread() after the insert. It never refuses and never raises: no Mod on staff is no visit, a post by a staff character is none, and
-- anything unforeseen is a warning, so the post goes up. A post is checked as it was made; an edit is not.
create function draw_visits(post_act uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p record;
  r rules_now%rowtype;
  who text;
  tail text;
  words text;
begin
  select a.character, t.board, c.staff is not null as by_staff into p
  from acts a join threads t on t.id = a.thread join characters c on c.id = a.character where a.id = post_act and a.kind = 'post';
  if not found or p.by_staff then return; end if;
  begin
    for r in select * from rule_breaks(post_act) loop
      if who is null then who := beat_of(p.board); end if;
      exit when who is null;
      select 'Rule ' || r.number || ': ' || fill_tokens(x.plain, jsonb_build_object('param', coalesce(r.param #>> '{}', ''))) into words from rule_predicates x where x.key = r.predicate;
      if r.board is null then words := 'House ' || words; end if;
      perform start_visit(post_act, who, jsonb_build_object('rule_number', r.number, 'board', p.board, 'band', r.band, 'cause', 'rule', 'about_act', post_act,
        'predicate', r.predicate, 'rule', words));
    end loop;
    tail := open_tail_staff(p.character);
    if tail is not null then
      who := coalesce(who, beat_of(p.board));
      if who is null then return; end if;
      perform start_visit(post_act, coalesce((select n.staff from staff_now n where n.staff = tail), who), jsonb_build_object('rule_number', null, 'board', p.board, 'band', 'minor',
        'cause', 'tail', 'about_act', post_act, 'rule', 'Obstruction'));
    end if;
  exception when others then
    raise warning 'draw_visits: post % drew no visit: % (%)', post_act, sqlerrm, sqlstate;
  end;
end $$;
revoke execute on function draw_visits(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------- ending and filing ----

-- The one writer of a visit_end: the visit's open row is taken for update, so two endings at once end it once, and a visit already ended returns its end and
-- writes nothing. Returns {ended, end_act, outcome}. Outcomes: filed (file_visit), intercepted and trapped (Task 9), reversed (Task 10 and an admin).
create function end_visit(visit_act uuid, outcome text, by_act uuid default null, line text default '') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v acts%rowtype;
  e acts%rowtype;
  written uuid;
begin
  if outcome is null or outcome not in ('filed', 'intercepted', 'trapped', 'reversed') then raise exception 'a visit ends filed, intercepted, trapped or reversed, not %', coalesce(outcome, 'nothing') using errcode = '22023'; end if;
  select * into v from acts a where a.id = end_visit.visit_act and a.kind = 'visit';
  if not found then raise exception 'there is no such visit' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform 1 from visits_open o where o.visit_act = v.id for update;
  select * into e from acts a where a.kind = 'visit_end' and a.target_act_id = v.id;
  if found then return jsonb_build_object('ended', false, 'end_act', e.id, 'outcome', e.payload ->> 'outcome'); end if;
  perform set_config('kayfabb.visit_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload)
  values (null, 'visit_end', v.thread, v.id, jsonb_strip_nulls(jsonb_build_object('visit_act', v.id, 'outcome', outcome, 'by_act', by_act, 'line', coalesce(line, ''))))
  returning id into written;
  perform set_config('kayfabb.visit_writer', '', true);
  return jsonb_build_object('ended', true, 'end_act', written, 'outcome', outcome);
end $$;
revoke execute on function end_visit(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function end_visit(uuid, text, uuid, text) to service_role;

-- A visit files: its end (filed) with the line (the stock line `visitFiled` where none is given), then one infraction against the post's author, in the band of the
-- visit's highest charge and carrying that charge's rule number. Idempotent: a visit already ended returns {filed: false, end_act, outcome} and writes nothing. The
-- Mod need not still be on staff. Returns {filed, end_act, infraction, points, warn_points, ban, until}.
create function file_visit(visit_act uuid, line text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v acts%rowtype;
  charges jsonb;
  top jsonb;
  who uuid;
  mod_key text;
  said text;
  ended jsonb;
  hit jsonb;
begin
  select * into v from acts a where a.id = file_visit.visit_act and a.kind = 'visit';
  if not found then raise exception 'there is no such visit' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- The row end_visit takes, taken first: the end and the infraction are one decision, and the one that waits finds the visit ended.
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
  who := (select a.character from acts a where a.id = v.target_act_id);
  hit := infract(who, top ->> 'band', v.target_act_id, mod_key, nullif(top ->> 'rule_number', '')::integer, v.id);
  return jsonb_build_object('filed', true, 'end_act', ended -> 'end_act') || hit;
end $$;
revoke execute on function file_visit(uuid, text) from public, anon, authenticated;
grant execute on function file_visit(uuid, text) to service_role;

-- ------------------------------------------------------------------------------------------------------- the seed ----

-- seed_instance (0101), also seeding each persona's visit traits (`visitHours`, `challenge`). Everything else as 0101 wrote it.
create or replace function seed_instance(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  flags integer;
  flagged text;
  unknown text;
  sys uuid;
  opened uuid;
begin
  -- Two seeds at once would each find no office row and both write one into the append-only office log. An advisory
  -- transaction lock serializes seeds without locking any table a player reads, and lets go at commit.
  perform pg_advisory_xact_lock(hashtext('kayfabb.seed_instance'));
  select count(*), min(e ->> 'slug') into flags, flagged
  from jsonb_array_elements(coalesce(payload -> 'boards', '[]')) e where coalesce((e ->> 'system')::boolean, false);
  if flags > 1 then raise exception 'a seed flags one board as The System''s, not %', flags using errcode = '22023'; end if;
  -- The economy is merged, number by number: a card kind is never removed, so the price of one
  -- the code no longer sells stays in the row with it (settings_economy_whole, 0006).
  insert into settings (key, value) select key, value from jsonb_each(payload -> 'settings')
  on conflict (key) do update set value = case when settings.key = 'economy' then settings.value || excluded.value else excluded.value end;
  insert into class_kinds (key, name) select e ->> 'key', e ->> 'name' from jsonb_array_elements(payload -> 'classes') e
  on conflict (key) do update set name = excluded.name;
  -- Reaction kinds are the one vocabulary a seed removes. Classes and cards never are: a card's price must outlive the card
  -- (0006). A reaction kind has nothing that must outlive it once nothing uses it, and a kind something does use is never removed.
  if payload ? 'reactions' then
    select string_agg(k.key || ' (' || (select count(*) from reactions r where r.kind = k.key) || ' reactions)', ', ' order by k.key) into unknown
    from reaction_kinds k
    where not exists (select 1 from jsonb_array_elements(payload -> 'reactions') e where e ->> 'key' = k.key)
      and (exists (select 1 from reactions r where r.kind = k.key) or exists (select 1 from reaction_tallies t where t.kind = k.key));
    if unknown is not null then
      raise exception 'the instance no longer lists reaction kinds that reactions use: %; a used kind is never removed (#216)', unknown using errcode = '22023';
    end if;
    -- `not exists`, not `not in`: an element with no key would make `not in` null for every kind, hiding a used one.
    delete from reaction_kinds k where not exists (select 1 from jsonb_array_elements(payload -> 'reactions') e where e ->> 'key' = k.key);
  end if;
  insert into reaction_kinds (key, emoji, quadrant) select e ->> 'key', e ->> 'emoji', e ->> 'quadrant' from jsonb_array_elements(payload -> 'reactions') e
  on conflict (key) do update set emoji = excluded.emoji, quadrant = excluded.quadrant;
  -- A card's play, rarity, trap, ward and time up (0054), and its reaches (0055), checked as instanceProblems checks them, each
  -- naming the card. The reaches are read against reachRarity and reachLasts as the settings above have just written them.
  select nullif(concat_ws('; ', card_kinds_problem(payload -> 'cards'), card_reach_problem(payload -> 'cards')), '') into unknown;
  if unknown is not null then raise exception '%', unknown using errcode = '22023'; end if;
  -- A card's stack, whether it is seeded and the economy numbers its rules read are the code's, as its name and price are; so
  -- are its rarity, its play, its trap, whether it is a ward, how long a Use of it is up, where it reaches and whether it pins.
  insert into card_kinds (key, name, alignment, price_setting, stack, seeded, reads, rarity, play, trap, ward, lasts, reaches, pins)
  select e ->> 'key', e ->> 'name', e ->> 'alignment', e ->> 'priceSetting', coalesce((e ->> 'stack')::integer, 1), coalesce((e ->> 'seeded')::boolean, false),
    coalesce(array(select jsonb_array_elements_text(e -> 'reads')), '{}'),
    e ->> 'rarity', coalesce(e ->> 'play', 'cast'), e -> 'trap', coalesce((e ->> 'ward')::boolean, false), span_interval(e -> 'lasts'),
    case when e ? 'reaches' then array(select jsonb_array_elements_text(e -> 'reaches')) else '{post}' end, coalesce((e ->> 'pins')::boolean, false)
  from jsonb_array_elements(payload -> 'cards') e
  on conflict (key) do update set name = excluded.name, alignment = excluded.alignment, price_setting = excluded.price_setting,
    stack = excluded.stack, seeded = excluded.seeded, reads = excluded.reads,
    rarity = excluded.rarity, play = excluded.play, trap = excluded.trap, ward = excluded.ward, lasts = excluded.lasts,
    reaches = excluded.reaches, pins = excluded.pins;
  -- The flag leaves the board that held it before another takes it, so the index never sees two.
  -- A seed naming one slug twice is refused by the upsert ("cannot affect row a second time"),
  -- where 0004 took its first; an instance never holds one (instanceProblems).
  if flagged is not null then update boards set is_system = false where is_system and slug <> flagged; end if;
  insert into boards (slug, name, description, is_system)
  select e ->> 'slug', e ->> 'name', coalesce(e ->> 'description', ''), coalesce(e ->> 'slug' = flagged, false) from jsonb_array_elements(payload -> 'boards') e
  on conflict (slug) do update set is_system = true where excluded.is_system and not boards.is_system;
  -- A pip style is added or renamed, never removed: a profile may name it.
  insert into pip_styles (key, name, full_image, empty_image)
  select e ->> 'key', e ->> 'name', e ->> 'full', e ->> 'empty' from jsonb_array_elements(coalesce(payload -> 'pipStyles', '[]')) e
  on conflict (key) do update set name = excluded.name, full_image = excluded.full_image, empty_image = excluded.empty_image;
  -- The instance's personas (0082), once each: a persona is made when its key has no character yet, with the profile its seed gives (its
  -- title and its signature, cut to what a profile holds). The first Boss and the first staff debut at seed time; every other persona
  -- is made waiting, with no debut, and debuts the moment it first takes an office. What an admin wrote is never written over: a reseed
  -- finds the key and does nothing. A persona in firstStaff with no office row is hired as a Mod Bot, cause `seed`; one with a row,
  -- a benched one's included, is left as that row says, so a reseed never rehires.
  with seeded as (
    select e ->> 'key' as staff, e ->> 'name' as name, coalesce(e ->> 'title', '') as title, coalesce(e ->> 'signature', '') as signature
    from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
  ), made as (
    insert into characters (name, staff, staff_kind, debuted_at)
    select s.name, s.staff, 'persona',
      case when s.staff = nullif(payload -> 'system' ->> 'firstBoss', '')
             or s.staff in (select jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]'))) then now() end
    from seeded s
    on conflict (staff) do nothing returning id, staff
  )
  insert into character_profiles (character, title, signature)
  select m.id, left(s.title, 40), left(s.signature, 500) from made m join seeded s on s.staff = m.staff;
  select string_agg(k, ', ') into unknown from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k
  where not exists (select 1 from characters c where c.staff = k and c.staff_kind = 'persona');
  if unknown is not null then raise exception 'firstStaff names %, which no persona in the seed''s roster is', unknown using errcode = '22023'; end if;
  -- Each listed persona's beat preferences (0101): the slugs of the kinds of board it likes. The seed's list is the persona's whole list, so a reseed
  -- replaces what an earlier seed wrote; a persona the seed gives no `beats` is left as it was.
  delete from staff_beats b where b.staff in (select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where e ? 'beats');
  insert into staff_beats (staff, slug)
  select distinct e ->> 'key', s
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e,
       jsonb_array_elements_text(case when jsonb_typeof(e -> 'beats') = 'array' then e -> 'beats' else '[]'::jsonb end) s
  where e ? 'beats';
  -- Each listed persona's visit traits (0103): the hours a visit of its runs and what talks it down. The seed's entry is the persona's whole traits, so a
  -- reseed replaces what an earlier seed wrote; a persona the seed gives neither is left as it was. A challenge carries a kind and its number (how many
  -- questions, or the price) and nothing else: a quiz's answers are never seeded here, where a client could read them.
  unknown := (select string_agg(distinct e ->> 'key', ', ') from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
    where (e ? 'visitHours' or e ? 'challenge') and visit_traits_problem(e -> 'visitHours', e -> 'challenge') is not null);
  if unknown is not null then
    raise exception 'persona % has visit traits that are wrong: %', unknown, (select visit_traits_problem(e -> 'visitHours', e -> 'challenge')
      from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where (e ? 'visitHours' or e ? 'challenge') and visit_traits_problem(e -> 'visitHours', e -> 'challenge') is not null limit 1) using errcode = '22023';
  end if;
  insert into staff_visit_traits (staff, visit_least, visit_most, challenge)
  select e ->> 'key', coalesce((e #>> '{visitHours,least}')::integer, 1), coalesce((e #>> '{visitHours,most}')::integer, 1000), coalesce(e -> 'challenge', '{"kind": "distraction"}'::jsonb)
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
  where e ? 'visitHours' or e ? 'challenge'
  on conflict (staff) do update set visit_least = excluded.visit_least, visit_most = excluded.visit_most, challenge = excluded.challenge;
  insert into staff_offices (staff, office, cause)
  select k, 'mod', 'seed' from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k
  where not exists (select 1 from staff_offices x where x.staff = k);
  -- A persona the seed seats as a mod is debuted: a reseed that adds a still-waiting persona to firstStaff hires it above, and it debuts here.
  update characters c set debuted_at = now()
  where c.debuted_at is null and c.staff_kind = 'persona'
    and c.staff in (select k from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k)
    and exists (select 1 from staff_offices x where x.staff = c.staff and x.cause = 'seed' and x.office = 'mod');
  -- The name of the member group every persona is in, which the instance gives.
  insert into settings (key, value)
  select 'staffGroup', payload -> 'system' -> 'staffGroup' where jsonb_typeof(payload -> 'system' -> 'staffGroup') = 'object'
  on conflict (key) do update set value = excluded.value;
  -- The catalogs (0046): the moves and demands the engine holds, as the engine lists them. A reseed upserts a move's flag and
  -- never removes a kind, since a landed move may name it. A missing flag is a seed's mistake (a move that reshapes a board
  -- must not be seeded as one that does not), so it is refused by the column.
  insert into move_kinds (key, structural, shapes_board, offices)
  select e ->> 'key', (e ->> 'structural')::boolean, coalesce((e ->> 'shapesBoard')::boolean, false),
         case when jsonb_typeof(e -> 'offices') = 'array' and jsonb_array_length(e -> 'offices') > 0 then array(select jsonb_array_elements_text(e -> 'offices')) else '{boss}' end
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'moves', '[]')) e
  on conflict (key) do update set structural = excluded.structural, shapes_board = excluded.shapes_board, offices = excluded.offices;
  -- The rule predicates (0100), as the engine lists them (engine/rules/predicates.ts). A reseed upserts; a predicate is never removed,
  -- since a landed rule may name it.
  insert into rule_predicates (key, param_kind, least, most, tags, plain)
  select e ->> 'key', e ->> 'param', (e ->> 'least')::integer, (e ->> 'most')::integer,
         case when jsonb_typeof(e -> 'tags') = 'array' then array(select jsonb_array_elements_text(e -> 'tags')) end, e ->> 'plain'
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'predicates', '[]')) e
  on conflict (key) do update set param_kind = excluded.param_kind, least = excluded.least, most = excluded.most, tags = excluded.tags, plain = excluded.plain;
  insert into demand_kinds (key) select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'demands', '[]')) e
  on conflict (key) do nothing;
  -- The roster's order (0051): the seed's personas, in the order it lists them, so the rotation has one to follow. A seed with no
  -- persona leaves the setting as it was.
  insert into settings (key, value)
  select 'bossRoster', jsonb_agg(e.value ->> 'key' order by e.ord)
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) with ordinality e(value, ord)
  having count(*) > 0
  on conflict (key) do update set value = excluded.value;
  if not exists (select 1 from seasons) then insert into seasons (number, starts_at) values (1, now()); end if;
  -- The open season's Boss (0043's seasons.boss) is the seed's firstBoss when it has none: a season opened before a Boss
  -- existed, or by this seed. A season that already has a Boss keeps it.
  if nullif(payload -> 'system' ->> 'firstBoss', '') is not null then
    update seasons set boss = payload -> 'system' ->> 'firstBoss' where ends_at is null and boss is null;
  end if;
  -- The announcements thread: the one thread on The System's board where a landed move is written and a move's end is said. Made once,
  -- titled from the seed (`system.announcementsTitle`), and its id recorded in the setting `systemAnnouncements` where the tick finds it.
  -- A reseed finds the setting (and the thread it names) and makes nothing; a seed with no title makes none, and until a seed has one
  -- the tick lands nothing (a board with nowhere to say a move is no board it can move). The setting is not in a seed's `settings`,
  -- so no seed writes it over.
  if nullif(payload -> 'system' ->> 'announcementsTitle', '') is not null
     and not exists (select 1 from settings s join threads t on t.id::text = s.value #>> '{}' where s.key = 'systemAnnouncements') then
    with made as (
      insert into threads (board, title) values (system_board(), payload -> 'system' ->> 'announcementsTitle') returning id
    )
    insert into settings (key, value) select 'systemAnnouncements', to_jsonb(made.id::text) from made
    on conflict (key) do update set value = excluded.value;
  end if;
  -- The developer persona and its thread (0062): a seed with a `developer` entry ({ name, title, avatar }) makes the one developer, once,
  -- as it makes a persona: debuted at seed time, with the tagline as its profile title, cut to what a profile holds. What an admin wrote is
  -- never written over: a reseed finds the key and does nothing, except that the avatar's asset key is the instance's to change. Then
  -- the updates thread, on The System's board, recorded in the setting `updatesThread` (not in a seed's `settings`, so no seed
  -- writes it over); the board's thread counter is netted by the thread's own, since a board's count is the length of its list and
  -- thread_list never lists this one.
  if jsonb_typeof(payload -> 'developer') = 'object' then
    -- The thread opens on The System's board, so a database with no board is told so before anything is made.
    if system_board() is null then raise exception 'a developer needs The System''s board; seed boards first' using errcode = '22023'; end if;
    with made as (
      insert into characters (name, staff, staff_kind, debuted_at) values (payload -> 'developer' ->> 'name', 'developer', 'developer', now())
      on conflict (staff) do nothing returning id
    )
    insert into character_profiles (character, title, signature)
    select m.id, left(coalesce(payload -> 'developer' ->> 'title', ''), 40), '' from made m;
    if nullif(payload -> 'developer' ->> 'avatar', '') is not null then
      insert into settings (key, value) values ('developerAvatar', to_jsonb(payload -> 'developer' ->> 'avatar'))
      on conflict (key) do update set value = excluded.value;
    end if;
    if not exists (select 1 from settings s join threads t on t.id::text = s.value #>> '{}' where s.key = 'updatesThread') then
      sys := system_board();
      insert into threads (board, title) values (sys, 'Updates') returning id into opened;
      insert into settings (key, value) values ('updatesThread', to_jsonb(opened::text)) on conflict (key) do update set value = excluded.value;
      update board_thread_counts set threads = threads - 1
       where board = sys and shard = coalesce((select c.shard from board_thread_counts c where c.board = sys order by c.shard for update skip locked limit 1), 0);
    end if;
  end if;
  return jsonb_build_object('settings', (select count(*) from settings), 'classes', (select count(*) from class_kinds),
    'reactions', (select count(*) from reaction_kinds), 'cards', (select count(*) from card_kinds), 'boards', (select count(*) from boards));
end $$;

-- post (0102), checking the new post against the rules in force once it is written (draw_visits): a rule never refuses a post. Everything else as 0102 wrote it.
CREATE OR REPLACE FUNCTION public.post(in_thread uuid, through uuid, body text, quoting uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  on_board uuid;
  written uuid;
  sprung jsonb;
  candidate uuid;
  maybe uuid[];
  parked uuid[];
  locked uuid[];
  passes uuid[];
  setters uuid[];
begin
  perform acting(through);
  perform not_banned(through);
  perform within('body', body, 'postMaxLength');
  select board into on_board from threads where id = in_thread;
  if on_board is null then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform not_the_systems(on_board);
  if quoting is not null and not exists (select 1 from acts where id = quoting) then raise exception 'there is no such Act to quote' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- What this post may pass: the thread's waiting backs on others' posts (the partial index), those that have sprung apart, since a
  -- sprung back is neither locked nor probed for a lock (a spring is public, and acts_one_spring finds it by index).
  select coalesce(array_agg(w.play) filter (where not w.sprung), '{}'), coalesce(array_agg(w.play) filter (where w.sprung), '{}') into maybe, parked
  from (select r.play, exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = r.play::text) as sprung
        from face_down_reply r join face_down f on f.play = r.play join acts p on p.id = f.post
        where r.thread = in_thread and r.passed_by is null and p.character is distinct from through) w;
  -- Plus the quoted post's live, unsprung back, passed or not.
  maybe := maybe || array(select f.play from face_down f
                          where f.post = quoting and f.ends_at > now() and f.play <> all (maybe)
                            and not exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = f.play::text));
  -- Step 3: those backs with their reply rows, in `play` order, in one statement. A reply row is read as locked: a post that passed a
  -- back while this waited has stamped it, and it is not this post's to pass. spring_traps then finds each row already held.
  select coalesce(array_agg(b.play), '{}'), coalesce(array_agg(b.play) filter (where b.waits and b.poster is distinct from through), '{}'),
         coalesce(array_agg(b.setter), '{}')
    into locked, passes, setters
  from (select f.play, s.character as setter, p.character as poster, (r.passed_by is null and r.thread = in_thread) as waits
        from face_down f join face_down_reply r on r.play = f.play join acts s on s.id = f.play join acts p on p.id = f.post
        where f.play = any (maybe)
        order by f.play for update of f, r) b;
  -- Step 4: the thread whose seq the insert takes.
  perform 1 from threads where id = in_thread for no key update;
  -- Step 5: the poster's count row and every setter's, by character, each made first where it is missing.
  insert into character_post_counts (character)
  select distinct c from unnest(setters || through) c order by c on conflict do nothing;
  perform 1 from character_post_counts where character = any (setters || through) order by character for update;
  insert into acts (character, kind, thread, target_act_id, payload)
  values (through, 'post', in_thread, quoting, jsonb_build_object('body', body)) returning id into written;
  -- Only a back this post locked springs (the header's note on `held`).
  if quoting is not null then sprung := spring_traps('quote', quoting, written, held => locked); end if;
  -- Locked and read as waiting in step 3, so no other post can have stamped them.
  update face_down_reply set passed_by = written, passed_at = now() where play = any (passes);
  -- The sprung ones are stamped without waiting: a post that locked one in step 3 (it read the back unsprung) may hold the row and
  -- wait on this post's thread or count row, so a wait here could cross. A row held by another is skipped and stays waiting; the next
  -- post by another character stamps it.
  if cardinality(parked) > 0 then
    update face_down_reply set passed_by = written, passed_at = now()
    where play in (select r.play from face_down_reply r where r.play = any (parked) and r.passed_by is null order by r.play for update skip locked);
  end if;
  if sprung is null then
    for candidate in
      select f.post from face_down f join acts p on p.id = f.post
      where f.play = any (passes)
      group by f.post, p.seq order by p.seq desc
    loop
      sprung := spring_traps('reply', candidate, written, held => locked);
      exit when sprung is not null;
    end loop;
  end if;
  if quoting is not null then perform write_alert((select a.character from acts a where a.id = quoting), 'quote', null, written, auth.uid()); end if;
  perform draw_visits(written);
  return act_projection(written) || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $function$;

-- start_thread (0102), checking the opening post the same way. Everything else as 0102 wrote it.
CREATE OR REPLACE FUNCTION public.start_thread(board_slug text, through uuid, title text, body text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  on_board uuid;
  made uuid;
  written uuid;
begin
  perform acting(through);
  perform not_banned(through);
  perform within('title', title, 'titleMaxLength');
  perform within('body', body, 'postMaxLength');
  select id into on_board from boards where slug = board_slug;
  if on_board is null then raise exception 'there is no such board' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform not_the_systems(on_board);
  insert into threads (board, title) values (on_board, title) returning id into made;
  insert into acts (character, kind, thread, payload) values (through, 'post', made, jsonb_build_object('body', body)) returning id into written;
  perform draw_visits(written);
  return jsonb_build_object('thread', thread_projection(made), 'act', act_projection(written));
end $function$;

-- ------------------------------------------------------------------------------------------------------ the tick ----

-- system_tick (0100), also filing the visits that are due (step 4, above its return). Everything else as 0100 wrote it.
create or replace function system_tick() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  enabled boolean := coalesce((select s.value = 'true'::jsonb from settings s where s.key = 'systemEnabled'), false);
  ann uuid := (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements');
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
  checked integer := 0;
  out_of_time boolean := false;
  superseded integer := 0;
  filed integer := 0;
  late record;
  filing_grace interval := make_interval(mins => coalesce((select (s.value #>> '{modBots,filingGraceMinutes}')::integer from settings s where s.key = 'modBots'), 10));
  boss text := current_boss();
  season_start timestamptz := (select x.starts_at from seasons x where x.ends_at is null);
  grace interval := make_interval(days => coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'inheritanceGraceDays'), 3));
begin
  if not pg_try_advisory_xact_lock(hashtext('kayfabb.system_tick')) then return jsonb_build_object('skipped', true); end if;

  -- 1. Landing: only while The System is on, and only where there is a thread to say it in.
  if enabled and ann is not null then
    for due in
      select q.id, q.staff, q.kind, q.params, q.demand, q.expires_at, q.admin_description from queued_moves q where q.landed_act is null and q.held_at is null and q.refused_at is null and q.go_live_at <= now() order by q.go_live_at, q.id for update skip locked
    loop
      begin
        -- Two rules that conflict may have waited together; the one that lands second meets the first. It is refused for good, with the reason.
        if due.kind = 'setRule' then
          clash := rule_conflict(nullif(due.params ->> 'board', '')::uuid, due.params ->> 'predicate', nullif(due.params -> 'param', 'null'::jsonb));
          if clash is not null then
            update queued_moves set failed_at = now(), failure = left('that rule would leave no post that follows the rules: ' || clash, 500), refused_at = now() where id = due.id;
            continue;
          end if;
        end if;
        written := (write_staff_act(due.staff, 'move', ann, null,
          jsonb_build_object('kind', due.kind, 'params', due.params, 'body', system_line(case when due.kind = 'setRule' then 'ruleSet' else 'moveLanded' end, due.kind, due.params, due.staff))
          || case when due.demand is not null then jsonb_build_object('demand', due.demand) else '{}'::jsonb end
          || case when due.expires_at is not null then jsonb_build_object('expires_at', due.expires_at) else '{}'::jsonb end) ->> 'id')::uuid;
        update queued_moves set landed_act = written where id = due.id;
        if due.kind = 'renameBoard' and due.admin_description is not null then
          perform write_describe((due.params ->> 'board')::uuid, due.admin_description, written);
        end if;
        landed := landed + 1;
      exception when others then
        failed := failed + 1;
        raise warning 'system_tick: queued move % did not land: % (%)', due.id, sqlerrm, sqlstate;
        -- Recorded on the row (the latest failure), so the admin queue can show it and an admin can hold the row. The row stays due.
        update queued_moves set failed_at = now(), failure = left(sqlerrm || ' (' || sqlstate || ')', 500) where id = due.id;
      end;
    end loop;
  end if;

  -- 2. Expiry: whatever the switch says, for every move in force, every tick. It is a comparison.
  for inforce in
    select o.move_act, a.character, a.thread, a.payload from open_moves o join acts a on a.id = o.move_act order by o.landed_at, o.move_act
  loop
    expires := (inforce.payload ->> 'expires_at')::timestamptz;
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
  -- after the handover (or after it landed, if later), ends `superseded`: the new Boss's review never came, or never reached it. A move the
  -- Boss kept is its own (move_owner), so it never ends here. The read is of the moves in force, a handful of rows.
  if boss is not null then
    for inforce in
      select o.move_act, a.payload ->> 'kind' as kind, o.landed_at
      from open_moves o join acts a on a.id = o.move_act join move_kinds k on k.key = a.payload ->> 'kind' and (k.shapes_board or k.key = 'nameSuccessor')
      where move_owner(o.move_act) is distinct from boss
      order by o.landed_at, o.move_act
    loop
      begin
        if inforce.kind = 'nameSuccessor' then
          perform end_move(inforce.move_act, 'spent', 'handover');
        elsif greatest(inforce.landed_at, season_start) + grace <= now() then
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
    select o.move_act, a.thread, a.payload from open_moves o join acts a on a.id = o.move_act where jsonb_typeof(a.payload -> 'demand') = 'object' and (o.checked_at is null or o.checked_at <= now() - check_every) order by o.checked_at nulls first, o.move_act limit cap
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
        if did_end then met := met + 1; end if;
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

  -- 4. Visits: each open visit `filingGraceMinutes` past its end is filed with the stock line, so nothing waits on a model. Whatever the switch says: a
  -- visit that has started is filed even if The System is turned off, and even if its Mod has left the staff. By visits_open_due, oldest first, and none once
  -- the budget is spent; file_visit locks the visit, so the filing cron racing this files it once. One that fails is left for the next tick.
  for late in
    select o.visit_act from visits_open o where o.ends_at <= now() - filing_grace order by o.ends_at, o.visit_act limit cap
  loop
    if clock_timestamp() > budget_ends then out_of_time := true; exit; end if;
    begin
      if (file_visit(late.visit_act, null) ->> 'filed')::boolean then filed := filed + 1; end if;
    exception when others then
      failed := failed + 1;
      raise warning 'system_tick: visit % did not file: % (%)', late.visit_act, sqlerrm, sqlstate;
    end;
  end loop;

  return jsonb_build_object('landed', landed, 'met', met, 'expired', expired, 'superseded', superseded, 'failed', failed, 'checked', checked, 'visits', filed, 'budget', out_of_time,
    'noThread', enabled and ann is null);
end $$;

-- ------------------------------------------------------------------------------------------------------ the page ----

-- thread_page (0102), also carrying each page post's latest visit (`visits`): its Mod (among `people`), end time, charges, challenge (kind, question index or price: never
-- an answer) and its end. Everything else as 0102 wrote it.
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
  -- Each of the page's posts' latest visit (0103), by acts_visits_by_post: its Mod, when it ends, its charges (the start's and every join's, in order) and its
  -- challenge, whitelisted to the kind and the number, never an answer; and its end if it has one.
  vis as materialized (
    select distinct on (v.target_act_id) v.id, v.target_act_id as post, v.character, v.created_at, v.payload
    from acts_public v where v.kind = 'visit' and v.target_act_id in (select p.id from posts p)
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
          'warn_points', c.warn_points, 'banned_until', c.banned_until),
        'profile', (select jsonb_build_object('character', p.character, 'title', p.title, 'signature', p.signature, 'avatar_square', p.avatar_square,
                      'avatar_portrait', p.avatar_portrait, 'square_frame', p.square_frame, 'portrait_frame', p.portrait_frame, 'pip_style', p.pip_style)
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
        'challenge', jsonb_strip_nulls(jsonb_build_object('kind', v.payload #>> '{challenge,kind}', 'question_index', v.payload #> '{challenge,question_index}', 'price', v.payload #> '{challenge,price}')),
        'end', (select jsonb_build_object('act', e.id, 'at', e.created_at, 'outcome', e.payload ->> 'outcome', 'by_act', e.payload -> 'by_act', 'line', e.payload -> 'line')
                from acts_public e where e.kind = 'visit_end' and e.target_act_id = v.id limit 1)
      ) order by v.created_at, v.id), '[]'::jsonb) from vis v),
    'faces', (select coalesce(jsonb_agg(jsonb_build_object('play', f.play, 'card', f.card)), '[]'::jsonb)
              from my_face_down f where f.play in (select p.id from played p where p.kind = 'set')),
    'states', (select coalesce(jsonb_agg(jsonb_build_object('play', e.play, 'state', e.state, 'saved_at', e.saved_at)), '[]'::jsonb)
               from effect_state e where e.play in (select w.id from wanted_plays w)),
    'releases', (select coalesce(jsonb_agg(r.play), '[]'::jsonb) from effect_releases r where r.play in (select w.id from wanted_plays w)),
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

