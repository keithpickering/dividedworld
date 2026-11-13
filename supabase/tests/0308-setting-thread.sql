-- A thread named by a setting is found by its key (migration 0360; issue #648). `systemAnnouncements` and `updatesThread` name a thread by its id, written as a JSON string, and the four
-- functions that find one (spring_facts, place_cast, lay_sprung, seed_instance) ask setting_thread. It answers the thread the setting names, or null, by one probe of threads_pkey: a value
-- that is not a uuid's canonical text finds no thread and never raises, and what it reads of `threads` does not move with the threads an instance holds.

-- What a call reads from `threads` and its indexes: rows fetched and index entries returned in this transaction so far, as 0135-face-down-moves.sql counts them.
create function pg_temp.reads() returns bigint language sql as $$
  select coalesce(sum(pg_stat_get_xact_tuples_fetched(o.oid) + pg_stat_get_xact_tuples_returned(o.oid)), 0)::bigint
  from pg_class t cross join lateral (select t.oid union all select i.indexrelid from pg_index i where i.indrelid = t.oid) o(oid)
  where t.relname = 'threads' and t.relnamespace = 'public'::regnamespace
$$;

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- A seed that makes The System's announcements thread and the Updates thread, as an instance's does.
create function pg_temp.seed() returns jsonb language sql as $$
  select seed_instance(jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'cards', '[]'::jsonb,
    'boards', jsonb_build_array(jsonb_build_object('slug', 'the-system', 'name', 'The System', 'description', '', 'system', true)),
    'system', jsonb_build_object('announcementsTitle', 'Announcements'), 'developer', jsonb_build_object('name', 'Dev Persona', 'title', 'Developer')))
$$;

-- ---- It answers the thread a setting names, and null for anything else, and raises for nothing ----
do $$
declare
  ann uuid; upd uuid; why text;
begin
  perform pg_temp.seed();
  ann := (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements');
  upd := (select (s.value #>> '{}')::uuid from settings s where s.key = 'updatesThread');
  if ann is null or upd is null or not exists (select 1 from threads where id = ann) or not exists (select 1 from threads where id = upd) then raise exception 'the seed did not make the two threads this file reads'; end if;
  if setting_thread('systemAnnouncements') is distinct from ann then raise exception 'setting_thread did not answer the announcements thread: %', setting_thread('systemAnnouncements'); end if;
  if setting_thread('updatesThread') is distinct from upd then raise exception 'setting_thread did not answer the updates thread: %', setting_thread('updatesThread'); end if;
  if setting_thread('nosuchsetting') is not null then raise exception 'a key with no setting named a thread'; end if;
  if setting_thread(null) is not null then raise exception 'a null key named a thread'; end if;

  -- A stray value finds no thread, and nothing raises inside the quote.
  insert into settings (key, value) values ('stNope', '"nope"'), ('stNumber', '42'::jsonb), ('stUpper', to_jsonb(upper(ann::text))), ('stGone', to_jsonb(gen_random_uuid()::text)),
    ('stNull', 'null'::jsonb), ('stObject', '{"a": 1}'::jsonb), ('stBraced', to_jsonb('{' || ann::text || '}')), ('stSpaced', to_jsonb(' ' || ann::text)), ('stUnhyphenated', to_jsonb(replace(ann::text, '-', '')));
  why := pg_temp.refusal('select setting_thread(''stNope'')');
  if why is not null then raise exception 'a value that is not a uuid raised: %', why; end if;
  if setting_thread('stNope') is not null then raise exception 'the value "nope" named a thread'; end if;
  if setting_thread('stNumber') is not null then raise exception 'a number named a thread'; end if;
  if setting_thread('stUpper') is not null then raise exception 'an uppercase uuid named a thread, as the text comparison it replaced never found one'; end if;
  if setting_thread('stGone') is not null then raise exception 'a uuid no thread has named a thread'; end if;
  if setting_thread('stNull') is not null then raise exception 'a JSON null named a thread'; end if;
  if setting_thread('stObject') is not null then raise exception 'a JSON object named a thread'; end if;
  if setting_thread('stBraced') is not null or setting_thread('stSpaced') is not null or setting_thread('stUnhyphenated') is not null then raise exception 'a uuid written other than as id::text writes it named a thread'; end if;
  -- The same value in the canonical spelling does name it.
  insert into settings (key, value) values ('stCanon', to_jsonb(ann::text));
  if setting_thread('stCanon') is distinct from ann then raise exception 'a canonical uuid did not name its thread'; end if;

  -- Nobody but the functions that call it executes it.
  if has_function_privilege('anon', 'setting_thread(text)', 'execute') or has_function_privilege('authenticated', 'setting_thread(text)', 'execute')
     or has_function_privilege('service_role', 'setting_thread(text)', 'execute') then
    raise exception 'setting_thread is executable by an API role';
  end if;
end $$;

-- ---- The four functions still find the announcements thread ----
do $$
declare
  ann uuid := (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements');
  upd uuid := (select (s.value #>> '{}')::uuid from settings s where s.key = 'updatesThread');
  owner uuid := tests.account('st-own');
  a uuid := tests.character(owner, 'St Caster');
  b1 uuid; b2 uuid; placed jsonb; laid uuid; threads_before bigint; settings_before jsonb;
begin
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts) values ('stquake', 'St Quake', 'salty', 'legendary', 'cast', '{board}', interval '1 day');
  insert into boards (slug, name) values ('st-one', 'St One') returning id into b1;
  insert into boards (slug, name) values ('st-two', 'St Two') returning id into b2;
  -- place_cast of a board card writes the play in the announcements thread.
  placed := place_cast(a, 'stquake', b1, '{}', '', 'board', null, owner, 0);
  if placed ->> 'thread' is distinct from ann::text then raise exception 'a board card was not written in the announcements thread: %', placed; end if;
  -- lay_sprung of a board card does too.
  laid := lay_sprung(a, 'stquake', '{}', b2, 'board', gen_random_uuid(), null);
  if (select x.thread from acts x where x.id = laid) is distinct from ann then raise exception 'a sprung board card was not written in the announcements thread'; end if;
  -- spring_facts, read before every face-down back's decision, finds it too (a back with nothing in it reads the same statement every back reads).
  if (spring_facts(null::face_down, 'quote', null, null)).announce_thread is distinct from ann then raise exception 'spring_facts did not find the announcements thread'; end if;
  -- seed_instance run again on a seeded instance makes no second announcements or updates thread, and moves neither setting.
  threads_before := (select count(*) from threads t where t.board = system_board());
  settings_before := (select jsonb_object_agg(s.key, s.value) from settings s where s.key in ('systemAnnouncements', 'updatesThread'));
  perform pg_temp.seed();
  if (select count(*) from threads t where t.board = system_board()) is distinct from threads_before then raise exception 'seeding again made a thread on The System''s board'; end if;
  if (select jsonb_object_agg(s.key, s.value) from settings s where s.key in ('systemAnnouncements', 'updatesThread')) is distinct from settings_before then raise exception 'seeding again moved a setting'; end if;
end $$;

-- ---- What each reads of `threads` does not move with the threads an instance holds ----
-- Counted as 0135 counts: with sequential scans off, so a statement that cannot use an index shows as the whole index it reads; each call on boards of its own (a board carries one board card at a time),
-- warmed so a call's reads are its execution's alone. A few hundred more threads are then inserted and analyzed, and the same calls counted again.
do $$
declare
  owner uuid := tests.account('st-scale');
  a uuid := tests.character(owner, 'St Scaler');
  brd uuid[] := '{}'; ids uuid[]; i integer; one uuid; before bigint;
  st_few bigint; pc_few bigint; ls_few bigint; si_few bigint;
  st_many bigint; pc_many bigint; ls_many bigint; si_many bigint;
  held integer; bad text[] := '{}';
begin
  perform set_config('enable_seqscan', 'off', true);
  discard plans;
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts) values ('stscale', 'St Scale', 'salty', 'legendary', 'cast', '{board}', interval '1 day');
  for i in 1 .. 16 loop
    insert into boards (slug, name) values ('st-scale-' || i, 'St Scale ' || i) returning id into one;
    brd := brd || one;
  end loop;
  -- Warm: each statement planned.
  for i in 1 .. 3 loop
    perform setting_thread('systemAnnouncements');
    perform place_cast(a, 'stscale', brd[i], '{}', '', 'board', null, owner, 0);
    perform lay_sprung(a, 'stscale', '{}', brd[i + 3], 'board', gen_random_uuid(), null);
    perform pg_temp.seed();
  end loop;

  before := pg_temp.reads(); perform setting_thread('systemAnnouncements'); st_few := pg_temp.reads() - before;
  before := pg_temp.reads(); perform place_cast(a, 'stscale', brd[7], '{}', '', 'board', null, owner, 0); pc_few := pg_temp.reads() - before;
  before := pg_temp.reads(); perform lay_sprung(a, 'stscale', '{}', brd[8], 'board', gen_random_uuid(), null); ls_few := pg_temp.reads() - before;
  before := pg_temp.reads(); perform pg_temp.seed(); si_few := pg_temp.reads() - before;

  select count(*) into held from threads;
  insert into threads (board, title) select (select id from boards where slug = 'general'), 'St filler ' || n from generate_series(1, 400) n;
  analyze threads;
  discard plans;
  for i in 1 .. 3 loop
    perform setting_thread('systemAnnouncements');
    perform place_cast(a, 'stscale', brd[8 + i], '{}', '', 'board', null, owner, 0);
    perform lay_sprung(a, 'stscale', '{}', brd[8 + i], 'board', gen_random_uuid(), null);
    perform pg_temp.seed();
  end loop;

  before := pg_temp.reads(); perform setting_thread('systemAnnouncements'); st_many := pg_temp.reads() - before;
  before := pg_temp.reads(); perform place_cast(a, 'stscale', brd[12], '{}', '', 'board', null, owner, 0); pc_many := pg_temp.reads() - before;
  before := pg_temp.reads(); perform lay_sprung(a, 'stscale', '{}', brd[13], 'board', gen_random_uuid(), null); ls_many := pg_temp.reads() - before;
  before := pg_temp.reads(); perform pg_temp.seed(); si_many := pg_temp.reads() - before;
  perform set_config('enable_seqscan', 'on', true);

  if st_few = 0 then raise exception 'the reads were not counted'; end if;
  -- Every assertion is made before any is raised, so one run says which of the four moved.
  if st_few > 4 or st_many is distinct from st_few then bad := bad || format('setting_thread reads %s entries of threads with %s threads and %s with 400 more', st_few, held, st_many); end if;
  if pc_many is distinct from pc_few then bad := bad || format('place_cast of a board card reads %s entries of threads with %s threads and %s with 400 more', pc_few, held, pc_many); end if;
  if ls_many is distinct from ls_few then bad := bad || format('lay_sprung of a board card reads %s entries of threads with %s threads and %s with 400 more', ls_few, held, ls_many); end if;
  if si_many is distinct from si_few then bad := bad || format('seed_instance run again reads %s entries of threads with %s threads and %s with 400 more', si_few, held, si_many); end if;
  if pc_many > 16 or ls_many > 16 or si_many > 16 then bad := bad || format('a lookup reads a whole index of threads: place_cast %s, lay_sprung %s, seed_instance %s entries', pc_many, ls_many, si_many); end if;
  if cardinality(bad) > 0 then raise exception '%', array_to_string(bad, '; '); end if;
end $$;
