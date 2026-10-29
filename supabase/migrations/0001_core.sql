-- The core: accounts, characters, boards, threads and Acts.
--
-- Task 5 of docs/plans/2026-10-28-core-loop-engine-plan.md. Plain SQL ("Portable by
-- construction"). No class, card or emoji is named here: the instance's vocabulary arrives as
-- rows in the *_kinds tables and its numbers in `settings`, written by the composition root.
--
-- What is private, and how it stays so ("A response never varies with a private fact"):
-- who owns a character, and every class it has held. Every table has row-level security and
-- the API roles hold no privilege on a table they do not need; a player reads their own rows,
-- and everyone reads the public projections through views that carry no owner and no class.
-- Those views run as their owner, so they read every row and can only ever show the columns
-- they name. Writes go through one SQL function per action (later migrations), never through
-- a table grant.
--
-- An Act is never edited in place ("Append-only"): a trigger refuses every UPDATE, DELETE and
-- TRUNCATE on acts, whoever runs it and in every replication mode. An edit is a new Act whose target is the post, and a
-- post's current text is the latest edit's, read through acts_public.

-- Nothing the API roles can reach unless a migration grants it: Supabase gives anon and
-- authenticated every privilege on every table, sequence and function postgres makes in public,
-- and a sequence alone is a clock (an id counter moving says when a row was written). So every
-- default is taken back here, for this migration and every one after it, and each grant below
-- is made on purpose. supabase/tests/0005-default-deny.sql holds the result.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------- the instance's data ----

create table settings (
  key text primary key,
  value jsonb not null
);

create table class_kinds (
  key text primary key check (key ~ '^[a-z][a-z0-9-]*$'),
  name text not null
);

create table reaction_kinds (
  key text primary key check (key ~ '^[a-z][a-z0-9-]*$'),
  emoji text not null unique,
  quadrant text not null check (quadrant in ('excitedPositive', 'excitedNegative', 'calmPositive', 'boredNegative'))
);

create table card_kinds (
  key text primary key check (key ~ '^[a-z][a-z0-9-]*$'),
  name text not null,
  alignment text not null check (alignment in ('sweet', 'salty', 'pepperoni')),
  -- The economy setting that holds its base price (the instance's own key, such as
  -- "whoops.price"), so the season review retunes a price with a settings row, never a deploy.
  price_setting text not null check (price_setting <> '')
);

-- A setting the engine reads, or an error naming it: a missing number is never guessed at.
create function setting(name text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
  select s.value into v from settings s where s.key = name;
  if v is null then raise exception 'setting "%" is not set for this instance', name using errcode = 'P0002'; end if;
  return v;
end $$;

-- ----------------------------------------------------------------------- the players ----

-- An account is never deleted: its characters' Acts are the forum's record. A player who leaves
-- has their export, and the account closes without removing what was written (registration,
-- Task 14, and the screens that follow).
create table accounts (
  id uuid primary key references auth.users (id),
  created_at timestamptz not null default now()
);

create table characters (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references accounts (id),
  name text not null check (length(btrim(name)) between 1 and 40 and name = btrim(name)),
  created_at timestamptz not null default now(),
  -- A character debuts at the settlement after it was made (the owner's answer 16, on #4): until
  -- then only its player sees it, and it cannot act. The settlement sets this, once, to its
  -- window's end (0007's masks_change), so every mask made in a day appears together and nobody's
  -- sitting can be picked out. Its way out is that settlement.
  debuted_at timestamptz
);
-- One name per instance, whatever its case or its script: 0011_names.sql's name_key.
create index characters_owner on characters (owner);

-- Every class a character has held, from when. Private until the season's reveal.
create table class_history (
  id bigint generated always as identity primary key,
  character uuid not null references characters (id),
  class_key text not null references class_kinds (key),
  started_at timestamptz not null default now(),
  unique (character, started_at)
);

-- A player runs at most charactersPerPlayer characters. The account's row is locked first, so
-- two creations at once cannot both read a count below the cap.
create function characters_within_cap() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare cap integer := (setting('charactersPerPlayer'))::integer;
declare held integer;
begin
  perform 1 from accounts where id = new.owner for no key update;
  select count(*) into held from characters where owner = new.owner;
  if held >= cap then
    raise exception 'a player runs at most % characters', cap using hint = 'kayfabb.refusal', errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger characters_within_cap before insert on characters
  for each row execute function characters_within_cap();

-- ------------------------------------------------------------------ boards and threads ----

create table boards (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now()
);

create table threads (
  id uuid primary key default gen_random_uuid(),
  board uuid not null references boards (id),
  -- How long a title may be is a setting (titleMaxLength), held by the action that writes it.
  title text not null check (title !~ '^[\s   -‍    ⁠　﻿]*$'),
  -- For a thread spun from an Act: the Act it came from.
  origin_act_id uuid,
  created_at timestamptz not null default now(),
  -- The next sequence number an Act shown in this thread takes. A counter, not an Act.
  next_seq integer not null default 1
);
create index threads_board on threads (board, created_at);

-- ------------------------------------------------------------------------------ Acts ----

create table acts (
  id uuid primary key default gen_random_uuid(),
  -- Null only for The System's own Acts (a settlement's tally, the season's reveal): The System
  -- plays no mask.
  character uuid references characters (id),
  kind text not null check (kind in ('post', 'spin', 'card', 'edit', 'tally', 'reveal')),
  thread uuid not null references threads (id),
  -- A quote's quoted Act, a spin's origin, a card's target post, an edit's post.
  target_act_id uuid references acts (id),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  -- Its place in the thread, for ?page=N#post-M links. An edit is not shown in its own place.
  seq integer,
  created_at timestamptz not null default now(),
  unique (thread, seq),
  check ((kind = 'edit') = (seq is null)),
  check (kind in ('post', 'tally', 'reveal') or target_act_id is not null),
  check ((character is null) = (kind in ('tally', 'reveal')))
);
-- A thread's page is read by the unique (thread, seq) index.
create index acts_character on acts (character, created_at);
create index acts_target on acts (target_act_id) where kind <> 'edit';
-- A post's latest edit, for acts_public.
create index acts_edits on acts (target_act_id, created_at desc, id desc) where kind = 'edit';
create index acts_created on acts (created_at);

alter table threads add constraint threads_origin_act foreign key (origin_act_id) references acts (id);
create index threads_origin on threads (origin_act_id) where origin_act_id is not null;

-- Who may write an Act, and what each kind may point at, held on the table so no writer can get
-- it wrong: a character acts only once it has debuted (played_by holds every action to it, and
-- this holds a writer that forgets). An edit
-- is its own author's, of their own post, in that post's thread (so the view never shows another
-- character's words as a post's current text); a card lands on a post; a quote, a card and a
-- spin never point at an edit, which is a layer of a post and not an Act to answer.
create function acts_well_formed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare t acts%rowtype;
begin
  if new.character is not null and exists (select 1 from characters c where c.id = new.character and c.debuted_at is null) then
    raise exception 'that character debuts at the next settlement' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if new.target_act_id is null then return new; end if;
  select * into t from acts where id = new.target_act_id;
  if new.kind = 'edit' and (t.kind <> 'post' or t.character <> new.character or t.thread <> new.thread) then
    raise exception 'an edit is of its own author''s post, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'card' and t.kind <> 'post' then
    raise exception 'a card lands on a post' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind <> 'edit' and t.kind = 'edit' then
    raise exception 'an edit is not answered; answer the post' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  return new;
end $$;
create trigger acts_well_formed before insert on acts for each row execute function acts_well_formed();

-- The sequence number, from the thread's counter. The update locks the thread's row, so two
-- Acts posted to one thread at once take two numbers, in order.
create function acts_take_seq() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.kind = 'edit' then
    new.seq := null;
  else
    update threads set next_seq = next_seq + 1 where id = new.thread returning next_seq - 1 into new.seq;
  end if;
  return new;
end $$;
create trigger acts_take_seq before insert on acts for each row execute function acts_take_seq();

create function acts_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'an Act is never edited or removed (%); write a new Act instead', tg_op using errcode = 'P0001';
end $$;
create trigger acts_no_update before update or delete on acts for each row execute function acts_append_only();
create trigger acts_no_truncate before truncate on acts for each statement execute function acts_append_only();
-- Always: a session in replica mode, as a restore with triggers disabled runs, fires them too.
alter table acts enable always trigger acts_no_update;
alter table acts enable always trigger acts_no_truncate;

-- ------------------------------------------------------------------ public projections ----

-- A character's id and name, and nothing else: not when it was made, since masks made in one
-- sitting would show themselves one player's. A character is known by what it does, and is
-- known at all only once it has debuted.
create view characters_public as
  select c.id, c.name from characters c where c.debuted_at is not null;

-- That `who` plays `through`, and that it has debuted, for every action a character takes: the
-- same words whether the character is another player's or does not exist, so nobody learns a
-- waiting character is there; its own player is told it waits.
create function played_by(through uuid, who uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare waiting boolean;
begin
  select c.debuted_at is null into waiting from characters c where c.id = through and c.owner = who;
  if waiting is null then
    raise exception 'you do not play that character' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if waiting then
    raise exception 'that character debuts at the next settlement' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
end $$;

-- Every Act, and for a post its current text: the latest edit's payload over the original's.
create view acts_public as
  select a.id, a.character, a.kind, a.thread, a.target_act_id, a.seq, a.created_at,
         a.payload,
         coalesce(e.payload, a.payload) as current_payload,
         e.created_at as edited_at
  from acts a
  left join lateral (
    select x.payload, x.created_at from acts x
    where x.kind = 'edit' and x.target_act_id = a.id
    order by x.created_at desc, x.id desc limit 1
  ) e on a.kind = 'post';

-- ------------------------------------------------------------------- who reads what ----

alter table settings enable row level security;
alter table class_kinds enable row level security;
alter table reaction_kinds enable row level security;
alter table card_kinds enable row level security;
alter table accounts enable row level security;
alter table characters enable row level security;
alter table class_history enable row level security;
alter table boards enable row level security;
alter table threads enable row level security;
alter table acts enable row level security;

revoke all on settings, class_kinds, reaction_kinds, card_kinds, accounts, characters, class_history, boards, threads, acts
  from anon, authenticated;
revoke all on characters_public, acts_public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on function setting(text), played_by(uuid, uuid), characters_within_cap(), acts_well_formed(), acts_take_seq(), acts_append_only() from public, anon, authenticated;

-- The vocabulary and the public tables: any signed-in player reads them.
grant select on class_kinds, reaction_kinds, card_kinds, boards, threads, acts to authenticated;
create policy read on class_kinds for select to authenticated using (true);
create policy read on reaction_kinds for select to authenticated using (true);
create policy read on card_kinds for select to authenticated using (true);
create policy read on boards for select to authenticated using (true);
create policy read on threads for select to authenticated using (true);
create policy read on acts for select to authenticated using (true);
grant select on characters_public, acts_public to authenticated;

-- A player's own rows: their account, their characters, their characters' classes.
grant select on accounts, characters to authenticated;
-- Not a row's id: the gap between two of a player's own ids would count everyone else's class
-- changes between them, silent Turns included.
grant select (character, class_key, started_at) on class_history to authenticated;
create policy own on accounts for select to authenticated using (id = auth.uid());
create policy own on characters for select to authenticated using (owner = auth.uid());
create policy own on class_history for select to authenticated
  using (exists (select 1 from characters c where c.id = class_history.character and c.owner = auth.uid()));
