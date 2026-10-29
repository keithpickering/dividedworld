-- The actions that write Acts: start a thread, post (a reply, quoting an Act or not), edit a
-- post, spin a thread from an Act. react() is 0002's.
--
-- Task 9 of docs/plans/2026-10-28-core-loop-engine-plan.md. The Edge Function decides first
-- (engine/rules/actions.ts) and calls one of these as the player, with their own session;
-- each checks again what it can and writes in one transaction, so a check missed in TypeScript
-- cannot get through (supabase/tests/0011-actions.sql calls each with what the decision
-- refuses). Each returns the public projection of what it wrote, and nothing else.

-- The caller, and that they play `through`, which has debuted (played_by, 0001).
create function acting(through uuid) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'sign in to act' using hint = 'kayfabb.refusal', errcode = '28000'; end if;
  perform played_by(through, caller);
  return caller;
end $$;

-- Text that is something, and no longer than the setting allows, counted in characters.
create function within(field text, value text, limit_setting text, may_be_empty boolean default false) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare most integer := (setting(limit_setting))::integer;
begin
  -- Blank is the same set of characters engine/rules/actions.ts calls blank: JavaScript's
  -- whitespace and line terminators, and the zero-width ones.
  if value is null or (not may_be_empty and value ~ '^[\s   -‍    ⁠　﻿]*$') then raise exception '% is empty', field using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if char_length(value) > most then raise exception '% is longer than % characters', field, most using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  return value;
end $$;

create function act_projection(written uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select to_jsonb(a) from acts_public a where a.id = written
$$;

-- A thread, by the columns that are public, named: a column added later is not shown by accident.
create function thread_projection(made uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', t.id, 'board', t.board, 'title', t.title, 'origin_act_id', t.origin_act_id, 'created_at', t.created_at)
  from threads t where t.id = made
$$;

create function start_thread(board_slug text, through uuid, title text, body text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  on_board uuid;
  made uuid;
  written uuid;
begin
  perform acting(through);
  perform within('title', title, 'titleMaxLength');
  perform within('body', body, 'postMaxLength');
  select id into on_board from boards where slug = board_slug;
  if on_board is null then raise exception 'there is no such board' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  insert into threads (board, title) values (on_board, title) returning id into made;
  insert into acts (character, kind, thread, payload) values (through, 'post', made, jsonb_build_object('body', body)) returning id into written;
  return jsonb_build_object('thread', thread_projection(made), 'act', act_projection(written));
end $$;

create function post(in_thread uuid, through uuid, body text, quoting uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare written uuid;
begin
  perform acting(through);
  perform within('body', body, 'postMaxLength');
  if not exists (select 1 from threads where id = in_thread) then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if quoting is not null and not exists (select 1 from acts where id = quoting) then raise exception 'there is no such Act to quote' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  insert into acts (character, kind, thread, target_act_id, payload)
  values (through, 'post', in_thread, quoting, jsonb_build_object('body', body)) returning id into written;
  return act_projection(written);
end $$;

-- An edit: a new Act over the post, never a change to it ("Append-only"). The table's own
-- trigger holds that it is the author's own post (0001, acts_well_formed).
create function edit_post(target uuid, through uuid, body text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  in_thread uuid;
begin
  perform acting(through);
  perform within('body', body, 'postMaxLength');
  select thread into in_thread from acts where id = target and kind = 'post' and character = through;
  if in_thread is null then raise exception 'that is not a post of this character''s' using hint = 'kayfabb.refusal', errcode = '42501'; end if;
  insert into acts (character, kind, thread, target_act_id, payload) values (through, 'edit', in_thread, target, jsonb_build_object('body', body));
  return act_projection(target);
end $$;

-- Spin a thread from any Act: a new thread on the origin's board, pointing at it, opened by a
-- spin Act that points at it too.
create function spin(origin uuid, through uuid, title text, body text default '') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  on_board uuid;
  made uuid;
  written uuid;
begin
  perform acting(through);
  perform within('title', title, 'titleMaxLength');
  perform within('body', coalesce(body, ''), 'postMaxLength', true);
  select t.board into on_board from acts a join threads t on t.id = a.thread where a.id = origin and a.kind <> 'edit';
  if on_board is null then raise exception 'there is no such Act to spin from' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  insert into threads (board, title, origin_act_id) values (on_board, title, origin) returning id into made;
  insert into acts (character, kind, thread, target_act_id, payload)
  values (through, 'spin', made, origin, jsonb_build_object('title', title, 'body', coalesce(body, ''))) returning id into written;
  return jsonb_build_object('thread', thread_projection(made), 'act', act_projection(written));
end $$;

revoke execute on function acting(uuid), within(text, text, text, boolean), act_projection(uuid), thread_projection(uuid) from public, anon, authenticated;
revoke execute on function start_thread(text, uuid, text, text), post(uuid, uuid, text, uuid), edit_post(uuid, uuid, text), spin(uuid, uuid, text, text)
  from public, anon;
grant execute on function start_thread(text, uuid, text, text), post(uuid, uuid, text, uuid), edit_post(uuid, uuid, text), spin(uuid, uuid, text, text)
  to authenticated;
