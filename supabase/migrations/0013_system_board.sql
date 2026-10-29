-- The System's board: one board of the instance's is The System's own, flagged in its seed
-- (engine/rules/types.ts's BoardSeed.system). The System posts its tally and its reveal there
-- (system_board(), 0007); players post nowhere on it, and a thread spun from what it said
-- opens on a board of theirs. The screens' engine plan, Task 1; the screens' design, section 13.
--
-- What an instance seeded before this migration holds stays where it is: no thread moves, and
-- until an admin seeds the instance again with the flag, The System goes on posting on the first
-- board, as it did. A season's Turns thread opened there before the flag stays that season's,
-- and players may still reply in it, as they could; the next season's opens on the flagged board.
-- A refused post's way out is the spin the refusal names.

alter table boards add column is_system boolean not null default false;
-- At most one: The System has one board.
create unique index boards_one_system on boards ((true)) where is_system;

-- The board The System posts on: the flagged one; on an instance not yet seeded with the flag,
-- its first board, as before.
create or replace function system_board() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select id from boards where is_system), (select id from boards order by created_at, slug limit 1))
$$;

-- The first board for players, where a thread spun from The System's Act opens.
create function players_board() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from boards where not is_system order by created_at, slug limit 1
$$;

-- A thread on The System's board takes no player's post: said in one place, in one set of words.
create function not_the_systems(on_board uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from boards where id = on_board and is_system) then
    raise exception 'only The System posts here; spin a thread from what it said' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
end $$;

-- seed_instance (0004), with the flag: a board the seed flags becomes The System's, and only its
-- flag is written, so an admin's name and description stay. A seed that flags no board leaves the
-- flag where it is; one that flags another moves it there. Everything else as 0004 wrote it.
create or replace function seed_instance(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare flagged text := (select e ->> 'slug' from jsonb_array_elements(payload -> 'boards') e where (e ->> 'system')::boolean limit 1);
begin
  if (select count(*) from jsonb_array_elements(coalesce(payload -> 'boards', '[]')) e where coalesce((e ->> 'system')::boolean, false)) > 1 then
    raise exception 'a seed flags one board as The System''s' using errcode = '22023';
  end if;
  insert into settings (key, value) select key, value from jsonb_each(payload -> 'settings')
  on conflict (key) do update set value = case when settings.key = 'economy' then settings.value || excluded.value else excluded.value end;
  insert into class_kinds (key, name) select e ->> 'key', e ->> 'name' from jsonb_array_elements(payload -> 'classes') e
  on conflict (key) do update set name = excluded.name;
  insert into reaction_kinds (key, emoji, quadrant) select e ->> 'key', e ->> 'emoji', e ->> 'quadrant' from jsonb_array_elements(payload -> 'reactions') e
  on conflict (key) do update set emoji = excluded.emoji, quadrant = excluded.quadrant;
  insert into card_kinds (key, name, alignment, price_setting)
  select e ->> 'key', e ->> 'name', e ->> 'alignment', e ->> 'priceSetting' from jsonb_array_elements(payload -> 'cards') e
  on conflict (key) do update set name = excluded.name, alignment = excluded.alignment, price_setting = excluded.price_setting;
  -- The flag leaves the board that held it before another takes it, so the index never sees two.
  if flagged is not null then update boards set is_system = false where is_system and slug <> flagged; end if;
  insert into boards (slug, name, description, is_system)
  select e ->> 'slug', e ->> 'name', coalesce(e ->> 'description', ''), coalesce(e ->> 'slug' = flagged, false) from jsonb_array_elements(payload -> 'boards') e
  on conflict (slug) do update set is_system = true where excluded.is_system and not boards.is_system;
  if not exists (select 1 from seasons) then insert into seasons (number, starts_at) values (1, now()); end if;
  return jsonb_build_object('settings', (select count(*) from settings), 'classes', (select count(*) from class_kinds),
    'reactions', (select count(*) from reaction_kinds), 'cards', (select count(*) from card_kinds), 'boards', (select count(*) from boards));
end $$;

-- start_thread and post (0005), refusing The System's board.
create or replace function start_thread(board_slug text, through uuid, title text, body text) returns jsonb
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
  perform not_the_systems(on_board);
  insert into threads (board, title) values (on_board, title) returning id into made;
  insert into acts (character, kind, thread, payload) values (through, 'post', made, jsonb_build_object('body', body)) returning id into written;
  return jsonb_build_object('thread', thread_projection(made), 'act', act_projection(written));
end $$;

create or replace function post(in_thread uuid, through uuid, body text, quoting uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  on_board uuid;
  written uuid;
begin
  perform acting(through);
  perform within('body', body, 'postMaxLength');
  select board into on_board from threads where id = in_thread;
  if on_board is null then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform not_the_systems(on_board);
  if quoting is not null and not exists (select 1 from acts where id = quoting) then raise exception 'there is no such Act to quote' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  insert into acts (character, kind, thread, target_act_id, payload)
  values (through, 'post', in_thread, quoting, jsonb_build_object('body', body)) returning id into written;
  return act_projection(written);
end $$;

-- spin (0005): a thread spun from an Act on The System's board opens on the players' first board.
create or replace function spin(origin uuid, through uuid, title text, body text default '') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  on_board uuid;
  made uuid;
  written uuid;
begin
  perform acting(through);
  perform within('title', title, 'titleMaxLength');
  perform within('body', coalesce(body, ''), 'postMaxLength', true);
  select case when b.is_system then players_board() else b.id end into on_board
  from acts a join threads t on t.id = a.thread join boards b on b.id = t.board where a.id = origin and a.kind <> 'edit';
  if on_board is null then raise exception 'there is no such Act to spin from' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  insert into threads (board, title, origin_act_id) values (on_board, title, origin) returning id into made;
  insert into acts (character, kind, thread, target_act_id, payload)
  values (through, 'spin', made, origin, jsonb_build_object('title', title, 'body', coalesce(body, ''))) returning id into written;
  return jsonb_build_object('thread', thread_projection(made), 'act', act_projection(written));
end $$;

revoke execute on function players_board(), not_the_systems(uuid) from public, anon, authenticated;
