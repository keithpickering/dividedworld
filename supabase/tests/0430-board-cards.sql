-- A board card lands in a thread on its board (supabase/migrations/0430_board_cards_on_their_board.sql; docs/plans/2026-11-24-staff-board-threads-plan.md, Task 5; the design, section 7).
--
-- 1. play_card and place_cast of a board card take the thread to play it in. It must be a thread on the target board; with none, or with a thread on another board, the card is refused in the words below, and
--    a board with no thread at all says to start one. A board card on the system board is allowed, in a thread on it.
-- 2. lay_sprung lands a sprung board card in the thread its `set` was laid in when that thread is on the target board, else in the target board's most recently active thread; a board with no thread takes none.
--    spring_facts no longer asks for the announcements thread: a board card springs where the quoted post's board has a thread.
-- 3. None of the three writes anything into the announcements thread.
-- 4. thread_page returns the board cards played in the thread, from the page's first Act up to the next page's first (the last page: to the end), each once, so a page draws the line under its newest post before the card.
-- 5. What the lookups read of `threads` does not move with the threads an instance holds.
create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k
$$;

-- What a call reads from `threads` and its indexes, as 0308 counts it.
create function pg_temp.reads() returns bigint language sql as $$
  select coalesce(sum(pg_stat_get_xact_tuples_fetched(o.oid) + pg_stat_get_xact_tuples_returned(o.oid)), 0)::bigint
  from pg_class t cross join lateral (select t.oid union all select i.indexrelid from pg_index i where i.indrelid = t.oid) o(oid)
  where t.relname = 'threads' and t.relnamespace = 'public'::regnamespace
$$;

-- ---- 1. play_card and place_cast of a board card ----
do $$
declare
  owner uuid := tests.account('bc-own');
  a uuid := tests.character(owner, 'Bc Caster');
  b_help uuid; b_empty uuid; b_other uuid; t_help uuid; t_other uuid; t_old uuid;
  ann uuid; ann_acts bigint; why text; pl jsonb; sysb uuid := system_board(); t_sys uuid;
begin
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts) values
    ('bcquake', 'Bc Quake', 'salty', 'legendary', 'cast', '{board}', interval '1 day'),
    ('bcrumble', 'Bc Rumble', 'salty', 'legendary', 'cast', '{board}', interval '1 day');
  perform pg_temp.hand(owner, 'bcquake', 'bcquake', 'bcquake', 'bcquake', 'bcrumble');
  insert into boards (slug, name) values ('bc-help', 'Bc Help') returning id into b_help;
  insert into boards (slug, name) values ('bc-empty', 'Bc Empty') returning id into b_empty;
  insert into boards (slug, name) values ('bc-other', 'Bc Other') returning id into b_other;
  insert into threads (board, title) values (b_help, 'Bc Help Wanted') returning id into t_help;
  insert into threads (board, title) values (b_other, 'Bc Elsewhere') returning id into t_other;
  perform tests.post(a, t_help, 'Anybody?');
  perform tests.post(a, t_other, 'Over here.');
  -- The announcements thread, which a board card used to be written in, and how many Acts it holds.
  ann := (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements');
  if ann is null then
    insert into threads (board, title) values (sysb, 'Bc Announcements') returning id into ann;
    insert into settings (key, value) values ('systemAnnouncements', to_jsonb(ann::text));
  end if;
  ann_acts := (select count(*) from acts x where x.thread = ann);

  -- A board with threads, and none named: the card is refused in the words, and nothing is spent.
  why := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L)', owner, 'bcquake', a, b_help, '{}', '', 'board'));
  if why is distinct from 'pick a thread on Bc Help to play it in' then raise exception 'a board card with no thread was not asked for one, said %', why; end if;
  -- A thread on another board is no thread on this one.
  why := pg_temp.refusal(format('select place_cast(%L, %L, %L, %L, %L, %L, null, %L, 0)', a, 'bcquake', b_help, '{}', '', 'board', owner));
  if why is distinct from 'pick a thread on Bc Help to play it in' then raise exception 'place_cast of a board card with no thread, said %', why; end if;
  -- A board with no thread says to start one.
  why := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L)', owner, 'bcquake', a, b_empty, '{}', '', 'board'));
  if why is distinct from 'start a thread on Bc Empty first' then raise exception 'a board with no thread, said %', why; end if;
  if (select count(*) from card_ledger where account = owner and kind = 'played') is distinct from 0 then raise exception 'a refused board card spent a card'; end if;

  -- With the thread named, it lands there, on no post, with its row for the board.
  why := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, null, null, null, null, %L, %L)', owner, 'bcquake', a, b_help, '{}', '', 'board', '{}', t_other));
  if why is distinct from 'pick a thread on Bc Help to play it in' then raise exception 'a thread on another board was taken, said %', why; end if;
  why := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, null, null, null, null, %L, %L)', owner, 'bcquake', a, b_help, '{}', '', 'board', '{}', gen_random_uuid()));
  if why is distinct from 'pick a thread on Bc Help to play it in' then raise exception 'a thread that does not exist was taken, said %', why; end if;
  pl := play_card(owner, 'bcquake', a, b_help, '{}', 0, '', 'board', null, null, null, null, '{}', t_help);
  if pl ->> 'thread' is distinct from t_help::text or pl ->> 'target_act_id' is not null then raise exception 'a board card did not land in the thread named: %', pl; end if;
  if not exists (select 1 from play_reach r where r.play = (pl ->> 'id')::uuid and r.reach = 'board' and r.board = b_help) then raise exception 'its play_reach row names the board'; end if;
  if (select count(*) from acts x where x.thread = ann) is distinct from ann_acts then raise exception 'a board card wrote into the announcements thread'; end if;
  -- One at a time on a board, as before: the second is refused with the old words, whichever thread it names.
  why := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, null, null, null, null, %L, %L)', owner, 'bcrumble', a, b_help, '{}', '', 'board', '{}', t_help));
  if why not like 'this board already carries a board card until%' then raise exception 'a second board card on a board, said %', why; end if;

  -- A board card on the system board is allowed, in a thread on it.
  insert into threads (board, title, staff_placed) values (sysb, 'Bc Staff Thread', true) returning id into t_sys;
  perform tests.post(a, t_sys, 'A staff post.');
  pl := play_card(owner, 'bcquake', a, sysb, '{}', 0, '', 'board', null, null, null, null, '{}', t_sys);
  if pl ->> 'thread' is distinct from t_sys::text then raise exception 'a board card on the system board did not land in the thread named: %', pl; end if;
  if (select count(*) from acts x where x.thread = ann) is distinct from ann_acts then raise exception 'a system board card wrote into the announcements thread'; end if;
end $$;

-- ---- 2. lay_sprung and spring_facts ----
do $$
declare
  owner uuid := tests.account('bc-spr');
  a uuid := tests.character(owner, 'Bc Setter');
  b_spr uuid; b_two uuid; b_none uuid; t_old uuid; t_new uuid; t_elsewhere uuid; p_old uuid; p_two uuid;
  set_a uuid; spring_a uuid; set_b uuid; spring_b uuid; laid uuid; ann uuid; ann_acts bigint; why text; f spring_facts;
begin
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts) values ('bcspring', 'Bc Spring', 'salty', 'legendary', 'cast', '{board}', interval '1 day');
  insert into boards (slug, name) values ('bc-spr', 'Bc Spr') returning id into b_spr;
  insert into boards (slug, name) values ('bc-spr-two', 'Bc Spr Two') returning id into b_two;
  insert into boards (slug, name) values ('bc-spr-none', 'Bc Spr None') returning id into b_none;
  insert into threads (board, title) values (b_spr, 'Bc Set Here') returning id into t_old;
  insert into threads (board, title) values (b_spr, 'Bc Busier') returning id into t_new;
  insert into threads (board, title) values (b_two, 'Bc Two Only') returning id into t_elsewhere;
  p_old := tests.post(a, t_old, 'The set sits under this.', now() - interval '2 hours');
  perform tests.post(a, t_new, 'Busier, and later.', now() - interval '1 hour');
  p_two := tests.post(a, t_elsewhere, 'Another board.', now() - interval '30 minutes');
  update threads set last_at = now() - interval '2 hours' where id = t_old;
  update threads set last_at = now() - interval '1 hour' where id = t_new;
  ann := (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements');
  if ann is null then
    insert into threads (board, title) select id, 'Bc Announcements Two' from boards where slug = 'the-system' returning id into ann;
    insert into settings (key, value) values ('systemAnnouncements', to_jsonb(ann::text));
  end if;
  ann_acts := (select count(*) from acts x where x.thread = ann);

  -- A set laid in a thread on the target board: its spring's card lands in that thread, though another is busier.
  set_a := tests.act(a, 'set', t_old, '{}', p_old);
  spring_a := tests.act(a, 'spring', t_old, jsonb_build_object('card', 'bcspring', 'trigger', 'quote', 'did', 'landed', 'set', set_a::text), p_old);
  laid := lay_sprung(a, 'bcspring', '{}', b_spr, 'board', spring_a, null);
  if (select x.thread from acts x where x.id = laid) is distinct from t_old then raise exception 'a sprung board card did not land in its set''s thread, it landed in %', (select x.thread from acts x where x.id = laid); end if;
  -- A set laid on another board: the target board's most recently active thread.
  set_b := tests.act(a, 'set', t_elsewhere, '{}', p_two);
  spring_b := tests.act(a, 'spring', t_elsewhere, jsonb_build_object('card', 'bcspring', 'trigger', 'quote', 'did', 'landed', 'set', set_b::text), p_two);
  laid := lay_sprung(a, 'bcspring', '{}', b_spr, 'board', spring_b, null);
  if (select x.thread from acts x where x.id = laid) is distinct from t_new then raise exception 'a sprung board card did not land in the most recently active thread of its board, it landed in %', (select x.thread from acts x where x.id = laid); end if;
  -- A spring with no set found takes the same.
  laid := lay_sprung(a, 'bcspring', '{}', b_spr, 'board', gen_random_uuid(), null);
  if (select x.thread from acts x where x.id = laid) is distinct from t_new then raise exception 'a spring with no set did not land in the most recently active thread'; end if;
  -- A board with no thread cannot take it.
  why := pg_temp.refusal(format('select lay_sprung(%L, %L, %L, %L, %L, %L, null)', a, 'bcspring', '{}', b_none, 'board', gen_random_uuid()));
  if why is distinct from 'start a thread on Bc Spr None first' then raise exception 'lay_sprung on a board with no thread, said %', why; end if;
  if (select count(*) from acts x where x.thread = ann) is distinct from ann_acts then raise exception 'a sprung board card wrote into the announcements thread'; end if;

  -- spring_facts no longer reads the announcements thread: with none set it still answers, and a board card springs where the quoted post's board has a thread.
  delete from settings where key = 'systemAnnouncements';
  f := spring_facts(null::face_down, 'quote', null, null);
  if f.announce_thread is not null then raise exception 'spring_facts still names an announcements thread: %', f.announce_thread; end if;
  if (select pg_get_functiondef('spring_facts(face_down, text, uuid, text)'::regprocedure)) like '%systemAnnouncements%' then raise exception 'spring_facts still reads the announcements setting'; end if;
  if (select pg_get_functiondef('lay_sprung(uuid, text, jsonb, uuid, text, uuid, uuid)'::regprocedure)) like '%systemAnnouncements%' then raise exception 'lay_sprung still reads the announcements setting'; end if;
  if (select pg_get_functiondef(p.oid) from pg_proc p where p.proname = 'place_cast' and p.pronamespace = 'public'::regnamespace) like '%systemAnnouncements%' then raise exception 'place_cast still reads the announcements setting'; end if;
  insert into settings (key, value) values ('systemAnnouncements', to_jsonb(ann::text));
end $$;

-- ---- 4. thread_page carries the board cards of its page ----
do $$
declare
  owner uuid := tests.account('bc-page');
  a uuid := tests.character(owner, 'Bc Pager');
  other uuid := tests.account('bc-page-other');
  o uuid := tests.character(other, 'Bc Reactor');
  b_pg uuid; t uuid; posts uuid[] := '{}'; c1 uuid; c2 uuid; c3 uuid; r jsonb; r1 jsonb; r2 jsonb; i integer;
  base timestamptz := now() - interval '10 hours';
begin
  insert into boards (slug, name) values ('bc-page', 'Bc Page') returning id into b_pg;
  insert into threads (board, title) values (b_pg, 'Bc Paged') returning id into t;
  for i in 1 .. 6 loop
    posts := posts || tests.post(a, t, 'Post ' || i, base + i * interval '1 hour');
  end loop;
  -- Three board cards: between posts 2 and 3, between posts 4 and 5 (the page break at per_page 3 falls between 3 and 4), and after the last post.
  c1 := tests.act(a, 'card', t, jsonb_build_object('card', 'bcquake', 'reach', 'board', 'board', b_pg, 'ends', now() + interval '1 day', 'targetName', 'Bc Page'), null, base + interval '2 hours 30 minutes');
  c2 := tests.act(a, 'card', t, jsonb_build_object('card', 'bcquake', 'reach', 'board', 'board', b_pg, 'ends', now() + interval '1 day', 'targetName', 'Bc Page'), null, base + interval '4 hours 30 minutes');
  c3 := tests.act(a, 'card', t, jsonb_build_object('card', 'bcquake', 'reach', 'board', 'board', b_pg, 'ends', now() + interval '1 day', 'targetName', 'Bc Page'), null, base + interval '7 hours');
  -- A board card in another thread, and a card on a post of this one, are neither of them a board card of this page.
  perform tests.act(a, 'card', (select id from threads where title = 'Bc Elsewhere' limit 1), jsonb_build_object('card', 'bcquake', 'reach', 'board', 'board', b_pg), null, base + interval '2 hours');
  perform tests.act(a, 'card', t, '{"card": "splat"}', posts[2], base + interval '2 hours 45 minutes');

  perform tests.become(owner);
  r1 := thread_page(t, 1, null, 3, '{}');
  r2 := thread_page(t, 2, null, 3, '{}');
  perform tests.unbecome();
  if r1 -> 'boardCards' is null or r2 -> 'boardCards' is null then raise exception 'thread_page carries no boardCards: %', r1 - 'acts'; end if;
  if (select array_agg((x ->> 'id')::uuid order by x ->> 'created_at') from jsonb_array_elements(r1 -> 'boardCards') x) is distinct from array[c1] then raise exception 'page 1 board cards: %', r1 -> 'boardCards'; end if;
  if (select array_agg((x ->> 'id')::uuid order by x ->> 'created_at') from jsonb_array_elements(r2 -> 'boardCards') x) is distinct from array[c2, c3] then raise exception 'page 2 board cards: %', r2 -> 'boardCards'; end if;
  -- Its reactions come with it: the id is among those the page's tallies are read for.
  perform tests.become(other); perform react(c1, o, 'up'); r1 := thread_page(t, 1, null, 3, '{}'); perform tests.unbecome();
  if not exists (select 1 from jsonb_array_elements(r1 -> 'tallies') x where (x ->> 'act')::uuid = c1) then raise exception 'a board card''s reaction was not carried: %', r1 -> 'tallies'; end if;
  if not exists (select 1 from jsonb_array_elements(r1 -> 'people') x where x -> 'character' ->> 'id' = a::text) then raise exception 'the caster is not among the page''s people'; end if;
  perform tests.become(owner);
  -- A board card in another thread is that thread's, and a thread with none carries an empty list.
  if jsonb_array_length(thread_page((select id from threads where title = 'Bc Elsewhere' limit 1), 1, null, 3, '{}') -> 'boardCards') is distinct from 1 then
    raise exception 'a thread''s board cards are not its own';
  end if;
  if thread_page((select id from threads where title = 'Bc Help Wanted' limit 1), 1, null, 3, '{}') -> 'boardCards' is distinct from '[]'::jsonb
     and jsonb_array_length(thread_page((select id from threads where title = 'Bc Help Wanted' limit 1), 1, null, 3, '{}') -> 'boardCards') is distinct from 1 then
    raise exception 'a thread with no card of its own carries one';
  end if;
  perform tests.unbecome();
end $$;

-- ---- 5. The lookups read a constant of `threads` ----
do $$
declare
  owner uuid := tests.account('bc-scale');
  a uuid := tests.character(owner, 'Bc Scaler');
  brd uuid[] := '{}'; ths uuid[] := '{}'; one uuid; th uuid; i integer; before bigint; pc_few bigint; ls_few bigint; pc_many bigint; ls_many bigint; held integer; bad text[] := '{}';
begin
  perform set_config('enable_seqscan', 'off', true);
  discard plans;
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts) values ('bcscale', 'Bc Scale', 'salty', 'legendary', 'cast', '{board}', interval '1 day');
  for i in 1 .. 16 loop
    insert into boards (slug, name) values ('bc-scale-' || i, 'Bc Scale ' || i) returning id into one;
    insert into threads (board, title) values (one, 'Bc Scale thread ' || i) returning id into th;
    brd := brd || one; ths := ths || th;
  end loop;
  for i in 1 .. 3 loop
    perform place_cast(a, 'bcscale', brd[i], '{}', '', 'board', null, owner, 0, '{}', ths[i]);
    perform lay_sprung(a, 'bcscale', '{}', brd[i + 3], 'board', gen_random_uuid(), null);
  end loop;
  before := pg_temp.reads(); perform place_cast(a, 'bcscale', brd[7], '{}', '', 'board', null, owner, 0, '{}', ths[7]); pc_few := pg_temp.reads() - before;
  before := pg_temp.reads(); perform lay_sprung(a, 'bcscale', '{}', brd[8], 'board', gen_random_uuid(), null); ls_few := pg_temp.reads() - before;
  select count(*) into held from threads;
  insert into threads (board, title) select (select id from boards where slug = 'general'), 'Bc filler ' || n from generate_series(1, 400) n;
  insert into threads (board, title) select brd[9], 'Bc board filler ' || n from generate_series(1, 200) n;
  analyze threads;
  discard plans;
  for i in 1 .. 3 loop
    perform place_cast(a, 'bcscale', brd[9 + i], '{}', '', 'board', null, owner, 0, '{}', ths[9 + i]);
    perform lay_sprung(a, 'bcscale', '{}', brd[9 + i], 'board', gen_random_uuid(), null);
  end loop;
  before := pg_temp.reads(); perform place_cast(a, 'bcscale', brd[13], '{}', '', 'board', null, owner, 0, '{}', ths[13]); pc_many := pg_temp.reads() - before;
  before := pg_temp.reads(); perform lay_sprung(a, 'bcscale', '{}', brd[9], 'board', gen_random_uuid(), null); ls_many := pg_temp.reads() - before;
  perform set_config('enable_seqscan', 'on', true);
  if pc_few = 0 then raise exception 'the reads were not counted'; end if;
  -- lay_sprung on the board that holds 200 threads reads the same as on one that holds one: it asks for the newest by an index, never the board's threads.
  if pc_many > pc_few + 2 then bad := bad || format('place_cast of a board card reads %s entries of threads with %s threads and %s with 600 more', pc_few, held, pc_many); end if;
  if ls_many > ls_few + 2 then bad := bad || format('lay_sprung of a board card reads %s entries of threads with %s threads and %s with a board of 200', ls_few, held, ls_many); end if;
  if pc_many > 16 or ls_many > 16 then bad := bad || format('a lookup reads a whole index of threads: place_cast %s, lay_sprung %s entries', pc_many, ls_many); end if;
  if cardinality(bad) > 0 then raise exception '%', array_to_string(bad, '; '); end if;
end $$;
