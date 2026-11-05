-- The pool's spends and the doors the chatter function writes through (the staff roster design, sections 4, 5, 7 and 8; its plan, Task 10).
--
-- `pool_spends` is the pool's ledger of posts: a row for each persona that posted on a day, naming the trigger, the post, the card it
-- played with it (if one), whether the post started a thread, and a `record` of what the run trimmed or was refused. The week's spend is
-- counted from it (a row costs a slot, and one more when it carries a card). It is append-only, as an Act is, and unique on
-- (day, staff): a persona posts at most once a day, so a run repeated on the same day cannot post twice for it. No client reads or writes
-- it; the service role reaches it through the functions below.
--
-- A crash between a post and its spend must not post twice on the rerun. A pool post carries `pool` in its payload (the day, as
-- `YYYY-MM-DD`), and `pool_orphan(staff, day)` finds a persona's post of the day that has no spend: the rerun records that post's spend
-- and writes no second post. The window is not a guess: the post and the marker are one insert. The post's note, written after the post
-- and before the spend, is lost in that one case, and nothing is repeated; its card is found again (pool_orphan) and counted. supabase/functions/chatter/core.ts says the same.
--
-- Ways out: nothing here holds a player in a state. A spend is an inert record of what a persona did; a persona benched or waiting
-- writes nothing, and an admin brings it back (set_office, 0080).

create table pool_spends (
  id bigint generated always as identity primary key,
  day date not null,
  staff text not null references characters (staff),
  trigger text not null check (trigger in ('named', 'quoted', 'legacy', 'successorStumbles', 'oldFlame', 'homeTurf', 'seasonTurn', 'hotOnBeat')),
  post_act uuid not null references acts (id),
  card_act uuid references acts (id),
  started_thread boolean not null default false,
  at timestamptz not null default now(),
  -- What the run recorded about the pick: the trims it made to the answer, a card the card rules refused (with their words), a note
  -- that could not be written. Free-form, an object; nothing reads it back but a person.
  record jsonb not null default '{}'::jsonb check (jsonb_typeof(record) = 'object'),
  unique (day, staff),
  unique (post_act)
);
create index pool_spends_day on pool_spends (day);
alter table pool_spends enable row level security;
revoke all on pool_spends from public, anon, authenticated;

create function pool_spends_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a pool spend is never edited or removed (%); the pool''s ledger is written once', tg_op using errcode = 'P0001';
end $$;
create trigger pool_spends_no_update before update or delete on pool_spends for each row execute function pool_spends_append_only();
create trigger pool_spends_no_truncate before truncate on pool_spends for each statement execute function pool_spends_append_only();
-- Always: a session in replica mode, as a restore with triggers disabled runs, fires them too.
alter table pool_spends enable always trigger pool_spends_no_update;
alter table pool_spends enable always trigger pool_spends_no_truncate;
revoke execute on function pool_spends_append_only() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------- the week and the day ----

-- What the pick reads of the pool's spends for `today`'s week (Monday to Sunday, UTC, as engine/system/pool.ts `allowance` counts it):
--   spent    the slots the week spent before today (a row is one, and a card is one more),
--   threads  the threads the week started before today,
--   today    today's rows [{staff, post_act, card_act, started_thread}].
-- Today's own rows are left out of `spent` and `threads` so a rerun on the same day computes the allowance the first run did, and picks the
-- same; the rerun then skips the personas already spent and stops at the day's allowance.
create function pool_week(today date) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'spent', coalesce((select sum(1 + (s.card_act is not null)::int) from pool_spends s where s.day >= date_trunc('week', today::timestamp)::date and s.day < today), 0),
    'threads', coalesce((select count(*) from pool_spends s where s.started_thread and s.day >= date_trunc('week', today::timestamp)::date and s.day < today), 0),
    'today', coalesce((select jsonb_agg(jsonb_build_object('staff', s.staff, 'post_act', s.post_act, 'card_act', s.card_act, 'started_thread', s.started_thread) order by s.id)
                       from pool_spends s where s.day = today), '[]'::jsonb))
$$;

-- A persona's post of `day` that no spend names: the post a crash left behind. {act, startedThread, card}, or null.
-- `card` is the persona's card Act tied to that post, or null. The card doors (0084) leave no marker on a card Act, so it is tied from public
-- Act data alone: a card Act of the same persona, made at or after the post and within an hour of it (a card Act takes no place in its thread, so its time is all there is) (a run lasts minutes), that lands on the
-- post itself (a Set) or on the post's quoted target (a Cast, for a reply), and that no spend names. A persona posts once a day and plays one
-- card with the post, so the earliest such Act is the post's. The spend adopted with it counts the card's slot in the week.
create function pool_orphan(of_staff text, on_day date) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('act', a.id, 'startedThread', a.seq = 1,
    'card', (select k.id from acts k
             where k.character = a.character and k.kind = 'card'
               and (k.target_act_id = a.id or (a.target_act_id is not null and k.target_act_id = a.target_act_id))
               and k.created_at >= a.created_at and k.created_at < a.created_at + interval '1 hour'
               and not exists (select 1 from pool_spends s where s.card_act = k.id)
             order by k.created_at, k.id limit 1))
  from acts a join characters c on c.id = a.character
  where c.staff = of_staff and a.kind = 'post' and a.payload ->> 'pool' = on_day::text
    and not exists (select 1 from pool_spends s where s.post_act = a.id)
  order by a.created_at, a.id limit 1
$$;

-- Records a persona's spend for a day. The post (and the card, if any) must be that persona's own Acts. A second spend for the same persona
-- and day is not an error: it is `already`, and writes nothing, so a repeated call is harmless.
create function record_pool_spend(on_day date, of_staff text, by_trigger text, post uuid, card uuid, started boolean, note jsonb default '{}')
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  who uuid;
  made bigint;
begin
  select c.id into who from characters c where c.staff = of_staff and c.staff_kind = 'persona';
  if who is null then raise exception 'there is no persona "%"', of_staff using errcode = 'P0002'; end if;
  if not exists (select 1 from acts a where a.id = post and a.character = who and a.kind = 'post') then
    raise exception 'the spend''s post is not a post of %', of_staff using errcode = '22023';
  end if;
  if card is not null and not exists (select 1 from acts a where a.id = card and a.character = who and a.kind = 'card') then
    raise exception 'the spend''s card is not a card of %', of_staff using errcode = '22023';
  end if;
  insert into pool_spends (day, staff, trigger, post_act, card_act, started_thread, record)
  values (on_day, of_staff, by_trigger, post, card, coalesce(started, false), coalesce(note, '{}'::jsonb))
  on conflict (day, staff) do nothing returning id into made;
  if made is null then return jsonb_build_object('status', 'already'); end if;
  return jsonb_build_object('status', 'spent', 'id', made);
end $$;

-- --------------------------------------------------------------------------------------------- what the pick reads ----

-- The board the pool reads (facts of staff and boards, nothing of a player): the season's span, the Boss and the one before it, each
-- persona's office now, a persona's character by its key, and a board's slug by its id. The system board is not a beat.
create function pool_context() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'season', (select jsonb_build_object('startsAt', (extract(epoch from s.starts_at) * 1000)::bigint,
        'endsAt', (extract(epoch from coalesce(s.ends_at, s.starts_at + span_interval(setting('seasonLength')))) * 1000)::bigint)
      from seasons s where s.ends_at is null order by s.starts_at desc limit 1),
    'boss', current_boss(),
    'predecessor', (select h.outgoing from season_handovers h
                    where h.boss = current_boss() and h.outgoing is distinct from h.boss order by h.landed_at desc, h.season desc limit 1),
    'offices', coalesce((select jsonb_object_agg(o.staff, o.office) from staff_office_now o join characters c on c.staff = o.staff where c.staff_kind = 'persona'), '{}'::jsonb),
    'characters', coalesce((select jsonb_object_agg(c.staff, c.id) from characters c where c.staff is not null and c.staff_kind = 'persona'), '{}'::jsonb),
    'boards', coalesce((select jsonb_object_agg(b.id, b.slug) from boards b where not b.is_system), '{}'::jsonb))
$$;

-- A thread's title and its newest `most` posts, oldest first, each with its author's name and its current words cut to `chars`; `also` (a
-- post of the thread, or anything else, which is then ignored) is included as well when it is older than those, so the post a reply quotes
-- is always shown. Public play only (acts_public, characters_public, thread_list), read by the digest role like pool_signals (0086): the
-- database refuses it who owns a character, a class and who reacted.
create function pool_thread(in_thread uuid, most integer, chars integer, also uuid default null) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'title', coalesce((select t.title from thread_list t where t.id = in_thread), ''),
    'posts', coalesce((select jsonb_agg(jsonb_build_object('act', p.id, 'name', p.name, 'body', p.body) order by p.created_at, p.id)
      from (select a.id, a.created_at, c.name, left(coalesce(a.current_payload ->> 'body', ''), greatest(chars, 1)) as body
            from acts_public a join characters_public c on c.id = a.character
            where a.thread = in_thread and a.kind = 'post'
              and (a.id = also or a.id in (select n.id from acts_public n where n.thread = in_thread and n.kind = 'post'
                                           order by n.created_at desc, n.id desc limit greatest(most, 0)))) p), '[]'::jsonb))
$$;

-- The names of the public characters among `ids` (a json array of uuid strings; anything else is ignored), as {id: name}. What a memory's
-- opinions and grudges are shown by.
create function pool_names(ids jsonb) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_object_agg(c.id, c.name), '{}'::jsonb)
  from characters_public c
  where c.id in (select case when x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then x::uuid end
                 from jsonb_array_elements_text(case when jsonb_typeof(ids) = 'array' then ids else '[]'::jsonb end) x)
$$;

-- The two reads become the digest role's, as pool_signals did (0086): the owner change needs the role to hold create on the schema while it
-- happens, and the grant is taken back at once.
grant create on schema public to kayfabb_digest;
alter function pool_thread(uuid, integer, integer, uuid) owner to kayfabb_digest;
alter function pool_names(jsonb) owner to kayfabb_digest;
revoke create on schema public from kayfabb_digest;

-- ------------------------------------------------------------------------------------------------------ the writers ----

-- A staff persona's new thread, for the service role: the thread on `board` (a slug) and its first post, in one transaction, with
-- `marker` (the pool's day) merged into the post's payload. Refuses a persona that is waiting, benched or not a persona (the developer
-- speaks only through post_update), a title or body past titleMaxLength and postMaxLength, and a board that is not there. The staff flag
-- is open for the insert and put back to what it was after.
create function write_staff_thread(staff_key text, board text, title text, body text, marker jsonb default '{}')
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  who uuid;
  whose text;
  held text;
  on_board uuid;
  made uuid;
  written uuid;
  flag text;
begin
  select c.id, c.staff_kind into who, whose from characters c where c.staff = staff_key;
  if who is null then raise exception 'there is no staff member "%"', staff_key using errcode = 'P0002'; end if;
  if whose is distinct from 'persona' then raise exception 'only a persona starts a thread' using errcode = '42501'; end if;
  select o.office into held from staff_office_now o where o.staff = staff_key;
  if held in ('waiting', 'benched') then raise exception 'a % persona writes nothing', held using errcode = '55000'; end if;
  perform within('title', title, 'titleMaxLength');
  perform within('body', body, 'postMaxLength');
  select b.id into on_board from boards b where b.slug = write_staff_thread.board;
  if on_board is null then raise exception 'there is no such board' using errcode = 'P0002'; end if;
  flag := coalesce(current_setting('kayfabb.staff_writer', true), '');
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into threads (board, title) values (on_board, title) returning id into made;
  insert into acts (character, kind, thread, payload) values (who, 'post', made, coalesce(marker, '{}'::jsonb) || jsonb_build_object('body', body)) returning id into written;
  perform set_config('kayfabb.staff_writer', flag, true);
  return jsonb_build_object('thread', thread_projection(made), 'act', act_projection(written));
end $$;

-- A note a persona leaves with its post: its own post (the note is never without one), at most 280 characters (the table's check). Returns the
-- note's id.
create function write_staff_note(staff_key text, post uuid, body text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare made bigint;
begin
  if not exists (select 1 from acts a join characters c on c.id = a.character where a.id = post and a.kind = 'post' and c.staff = staff_key and c.staff_kind = 'persona') then
    raise exception 'a note goes with a post of its own persona' using errcode = '22023';
  end if;
  insert into staff_notes (staff, act, body) values (staff_key, post, body) returning id into made;
  return made;
end $$;

revoke execute on function pool_week(date), pool_orphan(text, date), record_pool_spend(date, text, text, uuid, uuid, boolean, jsonb), pool_context(),
  pool_thread(uuid, integer, integer, uuid), pool_names(jsonb), write_staff_thread(text, text, text, text, jsonb), write_staff_note(text, uuid, text)
  from public, anon, authenticated;
grant execute on function pool_week(date), pool_orphan(text, date), record_pool_spend(date, text, text, uuid, uuid, boolean, jsonb), pool_context(),
  pool_thread(uuid, integer, integer, uuid), pool_names(jsonb), write_staff_thread(text, text, text, text, jsonb), write_staff_note(text, uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------------------------------- the schedule ----

-- (Re)schedule the pool's daily pick and posts at `pool.chatterCron`, as schedule_meeting() (0071) schedules the meeting: the jobs key in
-- apikey, nothing sent until the Vault holds both its secrets. The body carries the minute the job fired in, the run's slot: the signals
-- end there, and the day is its UTC date.
create function schedule_chatter() returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return cron.schedule('kayfabb-chatter', setting('pool') ->> 'chatterCron', $job$
    select net.http_post(
      url := s.base || '/functions/v1/chatter',
      headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', s.secret),
      body := jsonb_build_object('slot', date_trunc('minute', now())),
      timeout_milliseconds := 150000
    )
    from (
      select (select decrypted_secret from vault.decrypted_secrets where name = 'kayfabb_functions_url') as base,
             (select decrypted_secret from vault.decrypted_secrets where name = 'kayfabb_jobs_key') as secret
    ) s
    where s.base is not null and s.secret is not null
  $job$);
end $$;

create function settings_reschedule_chatter() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform schedule_chatter();
  return null;
end $$;
create trigger settings_reschedule_chatter after insert or update on settings
  for each row when (new.key = 'pool') execute function settings_reschedule_chatter();
revoke execute on function schedule_chatter(), settings_reschedule_chatter() from public, anon, authenticated;

select schedule_chatter() where exists (select 1 from settings where key = 'pool');
