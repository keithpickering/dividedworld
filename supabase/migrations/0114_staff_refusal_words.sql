-- acts_well_formed (0100), its staff refusal in the engine's neutral words: the player reads this message as the backend wrote it
-- (web/src/data/supabase.ts passes a kayfabb.refusal through), and the engine names no instance's cast, so "The System" is "the game's own
-- moves" here, as 0113 did for not_the_systems. The signature, security settings and search path are 0100's, and so is every other line.
-- (0002's "nobody reacts to The System's own Acts" is gone already: react, since 0015, no longer raises it.) The seed-time errors that name
-- The System's board (22023, raised to an admin running a seed) are left as written: no player reads them.
create or replace function acts_well_formed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare t acts%rowtype;
begin
  if new.character is not null and coalesce(current_setting('kayfabb.staff_writer', true), '') <> 'on'
     and exists (select 1 from characters c where c.id = new.character and c.staff is not null) then
    raise exception 'a staff character acts only through the game''s own moves' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.kind in ('move', 'move_keep') and new.character is not null and not exists (select 1 from characters c where c.id = new.character and c.staff is not null) then
    raise exception 'a % is a staff character''s Act', new.kind using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.kind = 'move' then
    if not exists (select 1 from move_kinds k where k.key = new.payload ->> 'kind') then
      raise exception 'there is no move kind "%"', coalesce(new.payload ->> 'kind', '') using errcode = '23514';
    end if;
    if jsonb_typeof(new.payload -> 'demand') = 'object' and not exists (select 1 from demand_kinds d where d.key = new.payload #>> '{demand,kind}') then
      raise exception 'there is no demand kind "%"', coalesce(new.payload #>> '{demand,kind}', '') using errcode = '23514';
    end if;
    if jsonb_typeof(new.payload -> 'demand') = 'object' and demand_params_problem(new.payload -> 'demand') is not null then
      raise exception 'the demand''s params are malformed at %', demand_params_problem(new.payload -> 'demand') using errcode = '23514';
    end if;
    -- Cast once here, so an expiry that is no time is refused at the door and the readers of it never meet one.
    if jsonb_typeof(new.payload -> 'expires_at') = 'string' then perform (new.payload ->> 'expires_at')::timestamptz; end if;
  end if;
  if new.kind = 'move_end' and coalesce(current_setting('kayfabb.move_end_writer', true), '') <> 'on' then
    raise exception 'a move ends only through end_move' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.kind = 'card_end' and coalesce(current_setting('kayfabb.card_end_writer', true), '') <> 'on' then
    raise exception 'a card ends only through reverse_card' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.character is not null and exists (select 1 from characters c where c.id = new.character and c.debuted_at is null) then
    raise exception 'that character debuts at the next settlement' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if new.character is not null and exists (select 1 from characters c where c.id = new.character and c.retired_at is not null) then
    raise exception 'that character is retired; an admin can restore it' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if new.kind = 'announce' then
    if new.payload ->> 'what' is distinct from 'debut' and new.payload ->> 'what' is distinct from 'turn' then
      raise exception 'an announcement is a debut or a Turn' using errcode = '23514';
    end if;
    if new.payload ->> 'what' = 'debut' and new.payload ? 'was' then
      raise exception 'a debut has no class it was' using errcode = '23514';
    end if;
  end if;
  if (new.kind = 'unmask' or (new.kind = 'announce' and new.payload ? 'class'))
     and (new.payload ->> 'class') is distinct from (select class_key from class_now(new.character, new.created_at)) then
    raise exception 'an % names the class its character holds', new.kind using errcode = '23514';
  end if;
  if new.target_act_id is null then return new; end if;
  select * into t from acts where id = new.target_act_id;
  if new.kind = 'move_end' and (t.kind <> 'move' or t.thread <> new.thread) then
    raise exception 'a move_end is of a move, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'card_end' and (t.kind <> 'card' or t.thread <> new.thread) then
    raise exception 'a card_end is of a card play, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'move_keep' then
    if t.kind <> 'move' or t.thread <> new.thread then
      raise exception 'a move_keep is of a move, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
    end if;
    if not exists (select 1 from open_moves o where o.move_act = t.id) then
      raise exception 'only a move in force can be kept' using hint = 'kayfabb.refusal', errcode = '55000';
    end if;
    if (select c.staff from characters c where c.id = new.character) is distinct from current_boss() then
      raise exception 'only the season''s Boss keeps a move' using hint = 'kayfabb.refusal', errcode = '42501';
    end if;
    if move_owner(t.id) is not distinct from current_boss() then
      raise exception 'that move is already the Boss''s own' using hint = 'kayfabb.refusal', errcode = '55000';
    end if;
  end if;
  if new.kind = 'edit' and (t.kind <> 'post' or t.character <> new.character or t.thread <> new.thread) then
    raise exception 'an edit is of its own author''s post, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'card' and t.kind <> 'post' then
    raise exception 'a card lands on a post' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  -- A card set face down is its post's own author's, in the post's thread; a spring is its set's author's, on the set's post.
  if new.kind = 'set' and (t.kind <> 'post' or t.character <> new.character or t.thread <> new.thread) then
    raise exception 'a card is set face down on a post of its own author''s, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'spring' and (t.kind <> 'post' or t.thread <> new.thread or not exists (
       select 1 from acts s where s.id::text = new.payload ->> 'set' and s.kind = 'set' and s.target_act_id = t.id and s.character = new.character)) then
    raise exception 'a spring is of a card set face down on its post, by the one who set it' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind <> 'edit' and t.kind = 'edit' then
    raise exception 'an edit is not answered; answer the post' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  return new;
end $$;

-- open_report (0107), its refusal of a staff post in the same neutral words: "a post by The System" is "a post by the staff", as the fake
-- backend says it (engine/ui/data/fake.ts). The signature, security settings, search path and grants are 0107's, and so is every other line.
create or replace function open_report(through uuid, post uuid, reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid;
  p record;
  bots jsonb := coalesce((select s.value from settings s where s.key = 'modBots'), '{}'::jsonb);
  price integer := coalesce((bots ->> 'reportPrice')::integer, 25);
  per_day integer := coalesce((bots ->> 'reportsPerDay')::integer, 3);
  budget integer := coalesce((bots ->> 'judgmentsPerDay')::integer, 60);
  day_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  said text := btrim(coalesce(reason, ''));
  mod_key text;
  rid uuid;
  board record;
  me text;
begin
  caller := acting(through);
  perform not_banned(through);
  if regexp_replace(said, '[\s ​-‍⁠　﻿]', '', 'g') = '' then
    raise exception 'say why you are reporting this post' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if char_length(said) > 280 then
    raise exception 'a reason is at most 280 characters' using hint = 'kayfabb.refusal', errcode = '22001';
  end if;
  if not coalesce((select s.value = 'true'::jsonb from settings s where s.key = 'systemEnabled'), false) then
    raise exception 'there is no one on duty to hear a report right now' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  select a.id, a.thread, t.board, c.staff is not null as by_staff into p
  from acts a join threads t on t.id = a.thread join characters c on c.id = a.character where a.id = open_report.post and a.kind in ('post', 'spin');
  if not found then raise exception 'there is no such post to report' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if p.by_staff then raise exception 'a post by the staff is not reported' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  mod_key := beat_of(p.board);
  if mod_key is null then raise exception 'there is no one on duty to hear a report right now' using hint = 'kayfabb.refusal', errcode = '55000'; end if;

  -- The checks and the write are one decision: one lock for the instance, taken before the count of the day is read.
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.reports', 0));
  -- The instance's budget first, and before anything is paid: one count (the ledger's judgments and the reports in flight), and the same words for everyone.
  if judgment_load_today() >= budget then
    raise exception 'the Mods have heard all the reports they will today; reports open again after midnight UTC' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  -- This character's quota, and only this character's: a report refunded for a failed judgment is not one of the day's (the player may report again); one swept for
  -- never being judged is.
  if (select count(*) from acts r where r.kind = 'report' and r.character = open_report.through and r.created_at >= day_start
        and not exists (select 1 from report_refunds f where f.report_act = r.id and f.why = 'failed')) >= per_day then
    raise exception 'this character has made its % reports for today', per_day using hint = 'kayfabb.refusal', errcode = '55000';
  end if;

  perform set_config('kayfabb.report_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload)
  values (through, 'report', p.thread, open_report.post, jsonb_build_object('reason', said)) returning id into rid;
  perform set_config('kayfabb.report_writer', '', true);
  perform wallet_spend(caller, price, 'report', rid);

  select b.id, b.name, b.premise into board from boards_now b where b.id = p.board;
  select c.name into me from characters c where c.id = through;
  return jsonb_build_object('report', rid, 'post', open_report.post, 'thread', p.thread, 'staff', mod_key, 'price', price, 'reason', said,
    'board', jsonb_build_object('id', board.id, 'name', board.name, 'premise', board.premise),
    'reporter', jsonb_build_object('id', through, 'name', me));
end $$;
revoke execute on function open_report(uuid, uuid, text) from public, anon;
grant execute on function open_report(uuid, uuid, text) to authenticated, service_role;
