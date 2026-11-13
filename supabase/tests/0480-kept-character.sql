-- A worn-off play of a kind that keeps, at character reach, is read by the posts its target wrote while it was up (thread_page's `kept`, written again by
-- supabase/migrations/0480_kept_character.sql). A play whose target is character A falls on A's posts dated inside its window and on no other author's post, on the same page or
-- another; an admin can end it after its week (reverse_card, not changed); the document is a public projection, the same for every caller. The cards are this file's own (tg...).

create function pg_temp.coded(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

create function pg_temp.kept_plays(doc jsonb) returns text[] language sql as $$
  select coalesce(array_agg(x ->> 'play' order by ord), '{}') from jsonb_array_elements(doc -> 'kept') with ordinality as k(x, ord)
$$;

do $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, stack, reaches, replies, keeps, trap, lasts, gimmick) values
    ('tgkeep', 'Tg Keep', 'sweet', 'rare', 'cast', 1, '{character}', false, true, null, interval '7 days', null),
    ('tgplain', 'Tg Plain', 'sweet', 'rare', 'cast', 1, '{character}', false, false, null, interval '7 days', null),
    ('tgthread', 'Tg Thread Keep', 'sweet', 'rare', 'cast', 1, '{thread}', false, true, null, interval '7 days', null);
end $$;

-- ---- A thread of A's posts and others': the play falls on A's own posts in its window and on nobody else's ----
do $$
declare
  ann uuid := tests.account('tg-ann'); bob uuid := tests.account('tg-bob');
  a uuid := tests.character(ann, 'Tg A'); b uuid := tests.character(ann, 'Tg B'); c uuid := tests.character(bob, 'Tg Caster');
  t uuid := tests.thread('Tg kept character');
  p_before uuid := tests.post(a, t, 'A, before the play.', now() - interval '20 days');
  p_b uuid := tests.post(b, t, 'B, inside the window.', now() - interval '11 days');
  p_in uuid := tests.post(a, t, 'A, inside the window.', now() - interval '10 days');
  p_c uuid := tests.post(c, t, 'The caster, inside the window.', now() - interval '9 days');
  p_after uuid := tests.post(a, t, 'A, after the week.', now() - interval '2 days');
  worn uuid; doc jsonb; doc2 jsonb;
begin
  -- Made as 0094's worn_reach is: the play_reach row is written with an end that has passed (play_reach refuses an update). Cast by C on A.
  worn := tests.act(c, 'card', t, '{"card": "tgkeep", "reach": "character"}', p_before, now() - interval '15 days');
  insert into play_reach (play, reach, character, ends_at) values (worn, 'character', a, now() - interval '8 days');

  -- A page of one post, one for each post: only A's post inside the window lists the play.
  perform tests.become(ann);
  doc := thread_page(t, 1, null, 1, '{}');
  if pg_temp.kept_plays(doc) is distinct from '{}' then raise exception 'A''s post before the play lists nothing: %', doc -> 'kept'; end if;
  doc := thread_page(t, 2, null, 1, '{}');
  if pg_temp.kept_plays(doc) is distinct from '{}' then raise exception 'B''s post inside A''s window brings in nothing of A''s play: %', doc -> 'kept'; end if;
  doc := thread_page(t, 4, null, 1, '{}');
  if pg_temp.kept_plays(doc) is distinct from '{}' then raise exception 'the caster''s post inside the window brings in nothing: %', doc -> 'kept'; end if;
  doc := thread_page(t, 5, null, 1, '{}');
  if pg_temp.kept_plays(doc) is distinct from '{}' then raise exception 'A''s post after the end lists nothing: %', doc -> 'kept'; end if;
  doc := thread_page(t, 3, null, 1, '{}');
  perform tests.unbecome();
  if pg_temp.kept_plays(doc) is distinct from array[worn::text] then raise exception 'A''s post inside the window lists the play: %', doc -> 'kept'; end if;
  if doc #>> '{kept,0,reach}' is distinct from 'character' or doc #>> '{kept,0,target}' is distinct from a::text
     or (doc #>> '{kept,0,ends_at}')::timestamptz is distinct from (select ends_at from play_reach where play = worn)
     or doc #>> '{kept,0,act,id}' is distinct from worn::text or doc #>> '{kept,0,play}' is distinct from worn::text
     or (select array_agg(k order by k) from jsonb_object_keys(doc -> 'kept' -> 0) k) is distinct from array['act', 'ends_at', 'play', 'reach', 'target'] then
    raise exception 'kept lists the play in the shape of above: %', doc -> 'kept'; end if;
  if doc -> 'kept' -> 0 -> 'act' is distinct from (select to_jsonb(x) from acts_public x where x.id = worn) then raise exception 'kept''s act is the play as acts_public holds it'; end if;
  -- Its caster (who) arrives with the page though the caster wrote none of its posts; so does a tally on the play (ids).
  if not exists (select 1 from jsonb_array_elements(doc -> 'people') x where x -> 'character' ->> 'id' = c::text) then raise exception 'the caster is among the people: %', doc -> 'people'; end if;
  if doc -> 'above' is distinct from '[]'::jsonb then raise exception 'a worn-off play is not above: %', doc -> 'above'; end if;

  -- A page holding both A's and B's posts in the window lists it once; a page spanning the play's whole window and beyond too.
  perform tests.become(ann);
  doc2 := thread_page(t, 1, null, 5, '{}');
  perform tests.unbecome();
  if pg_temp.kept_plays(doc2) is distinct from array[worn::text] then raise exception 'a page of every post lists the play once: %', doc2 -> 'kept'; end if;
  -- The second page of two posts each holds A's inside post and A's after post.
  perform tests.become(ann);
  doc2 := thread_page(t, 2, null, 2, '{}');
  perform tests.unbecome();
  if pg_temp.kept_plays(doc2) is distinct from array[worn::text] then raise exception 'a page of A''s inside and after posts lists the play: %', doc2 -> 'kept'; end if;

  -- The tally on the play arrives with the page (its id joins ids).
  perform tests.become(ann); perform react(worn, a, 'up'); doc := thread_page(t, 3, null, 1, '{}'); perform tests.unbecome();
  if (select (x ->> 'count')::integer from jsonb_array_elements(doc -> 'tallies') x where x ->> 'act' = worn::text) is distinct from 1 then
    raise exception 'the kept play''s id joins ids, so its tally arrives: %', doc -> 'tallies'; end if;

  -- The same document for two different callers.
  perform tests.become(bob); doc2 := thread_page(t, 3, null, 1, '{}'); perform tests.unbecome();
  if doc2 -> 'kept' is distinct from doc -> 'kept' or doc2 -> 'above' is distinct from doc -> 'above' or doc2 -> 'people' is distinct from doc -> 'people' or doc2 -> 'acts' is distinct from doc -> 'acts'
     or doc2 -> 'under' is distinct from doc -> 'under' or doc2 -> 'cut' is distinct from doc -> 'cut' then
    raise exception 'kept, above, people, acts, under and cut differ between two callers'; end if;
end $$;

-- ---- The author match: a page holding A's post outside the play's window and another author's post inside it ----
-- Guards `p.character = r.target` in kept_window. A's play is read for the page because A wrote a post on it (the author probe), and the window holds B's and the caster's posts;
-- without the match those posts would bring in A's play. Correct: nothing is kept, for a page that holds A's post outside the window, and for the same page without B.
do $$
declare
  ann uuid := tests.account('tm-ann'); a uuid := tests.character(ann, 'Tm A'); b uuid := tests.character(ann, 'Tm B'); c uuid := tests.character(ann, 'Tm Caster');
  t uuid := tests.thread('Tm mixed page');
  p_before uuid := tests.post(a, t, 'A, before the play.', now() - interval '20 days');
  p_b uuid := tests.post(b, t, 'B, inside the window.', now() - interval '11 days');
  p_c uuid := tests.post(c, t, 'The caster, inside the window.', now() - interval '9 days');
  worn uuid; doc jsonb;
begin
  worn := tests.act(c, 'card', t, '{"card": "tgkeep", "reach": "character"}', p_before, now() - interval '15 days');
  insert into play_reach (play, reach, character, ends_at) values (worn, 'character', a, now() - interval '8 days');
  perform tests.become(ann); doc := thread_page(t, 1, null, 3, '{}'); perform tests.unbecome();
  if jsonb_array_length(doc -> 'acts') is distinct from 3 then raise exception 'the page holds all three posts: %', doc -> 'acts'; end if;
  if pg_temp.kept_plays(doc) is distinct from '{}' then
    raise exception 'A''s post outside the window and B''s and the caster''s inside it: A''s play falls on none of them: %', doc -> 'kept'; end if;
  perform tests.become(ann); doc := thread_page(t, 1, null, 2, '{}'); perform tests.unbecome();
  if pg_temp.kept_plays(doc) is distinct from '{}' then raise exception 'A''s post outside the window and B''s inside it: A''s play falls on neither: %', doc -> 'kept'; end if;
end $$;

-- ---- Live, ended and plain: a live play is above and not kept; an admin-ended one, ended during the week or after it, is in neither; a plain kind is in neither ----
do $$
declare
  ann uuid := tests.account('th-ann'); admin_acc uuid := tests.account('th-admin'); a uuid := tests.character(ann, 'Th A'); c uuid := tests.character(ann, 'Th Caster');
  t uuid := tests.thread('Th live, ended, plain');
  p1 uuid := tests.post(a, t, 'A, in the windows.', now() - interval '10 days');
  p2 uuid := tests.post(a, t, 'A, recently.', now() - interval '1 day');
  live uuid; ended_during uuid; ended_after uuid; plain uuid; doc jsonb;
begin
  insert into admins (account) values (admin_acc);
  live := tests.act(c, 'card', t, '{"card": "tgkeep", "reach": "character"}', p1, now() - interval '2 days');
  insert into play_reach (play, reach, character, ends_at) values (live, 'character', a, now() + interval '5 days');
  ended_during := tests.act(c, 'card', t, '{"card": "tgkeep", "reach": "character"}', p1, now() - interval '15 days');
  insert into play_reach (play, reach, character, ends_at) values (ended_during, 'character', a, now() - interval '8 days');
  ended_after := tests.act(c, 'card', t, '{"card": "tgkeep", "reach": "character"}', p1, now() - interval '14 days');
  insert into play_reach (play, reach, character, ends_at) values (ended_after, 'character', a, now() - interval '7 days');
  plain := tests.act(c, 'card', t, '{"card": "tgplain", "reach": "character"}', p1, now() - interval '16 days');
  insert into play_reach (play, reach, character, ends_at) values (plain, 'character', a, now() - interval '9 days');
  -- An admin's end during the week (written the way reverse_card writes it, dated inside the week) and after it (reverse_card itself).
  perform set_config('kayfabb.card_end_writer', 'on', true);
  perform tests.act(null, 'card_end', t, '{"why": "reversed", "by": "admin"}', ended_during, now() - interval '12 days');
  perform set_config('kayfabb.card_end_writer', '', true);
  perform tests.become(admin_acc); perform reverse_card(ended_after); perform tests.unbecome();

  perform tests.become(ann); doc := thread_page(t, 1, null, 1, '{}'); perform tests.unbecome();
  if (select array_agg(x ->> 'play') from jsonb_array_elements(doc -> 'above') x) is distinct from array[live::text] then raise exception 'the live play is above: %', doc -> 'above'; end if;
  if pg_temp.kept_plays(doc) is distinct from '{}' then
    raise exception 'a live play, an admin-ended one (during the week or after it) and a plain kind are not kept: %', doc -> 'kept'; end if;
  perform tests.become(ann); doc := thread_page(t, 2, null, 1, '{}'); perform tests.unbecome();
  if pg_temp.kept_plays(doc) is distinct from '{}' then raise exception 'a recent post sees none of them kept: %', doc -> 'kept'; end if;
end $$;

-- ---- An admin can end a worn-off character play of a kind that keeps; after it, the play is not kept ----
do $$
declare
  ann uuid := tests.account('tr-ann'); admin_acc uuid := tests.account('tr-admin'); a uuid := tests.character(ann, 'Tr A'); c uuid := tests.character(ann, 'Tr Caster');
  t uuid := tests.thread('Tr reversed');
  p uuid := tests.post(a, t, 'A, inside the window.', now() - interval '10 days');
  worn uuid; plain uuid; doc jsonb; why text;
begin
  insert into admins (account) values (admin_acc);
  worn := tests.act(c, 'card', t, '{"card": "tgkeep", "reach": "character"}', p, now() - interval '15 days');
  insert into play_reach (play, reach, character, ends_at) values (worn, 'character', a, now() - interval '8 days');
  plain := tests.act(c, 'card', t, '{"card": "tgplain", "reach": "character"}', p, now() - interval '15 days');
  insert into play_reach (play, reach, character, ends_at) values (plain, 'character', a, now() - interval '8 days');
  perform tests.become(ann); doc := thread_page(t, 1, null, 20, '{}'); perform tests.unbecome();
  if pg_temp.kept_plays(doc) is distinct from array[worn::text] then raise exception 'before the end the worn-off play is kept, the plain one is not: %', doc -> 'kept'; end if;
  perform tests.become(admin_acc);
  perform reverse_card(worn);
  why := pg_temp.coded(format('select reverse_card(%L)', plain));
  perform tests.unbecome();
  if not exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = worn) then raise exception 'an admin ended a worn-off character play of a kind that keeps'; end if;
  if why is null or why not like '%that card has already worn off%' then raise exception 'a worn-off character play of a kind that does not keep is still refused: %', why; end if;
  perform tests.become(ann); doc := thread_page(t, 1, null, 20, '{}'); perform tests.unbecome();
  if pg_temp.kept_plays(doc) is distinct from '{}' then raise exception 'after the end the play is not kept: %', doc -> 'kept'; end if;
end $$;

-- ---- Thread rows and character rows on one page, oldest first ----
do $$
declare
  ann uuid := tests.account('tt-ann'); a uuid := tests.character(ann, 'Tt A'); b uuid := tests.character(ann, 'Tt B'); c uuid := tests.character(ann, 'Tt Caster');
  t uuid := tests.thread('Tt both');
  p1 uuid := tests.post(a, t, 'A, inside both windows.', now() - interval '10 days');
  p2 uuid := tests.post(b, t, 'B, inside the thread window.', now() - interval '9 days');
  on_thread uuid; on_a uuid; on_b uuid; doc jsonb;
begin
  on_a := tests.act(c, 'card', t, '{"card": "tgkeep", "reach": "character"}', p1, now() - interval '16 days');
  insert into play_reach (play, reach, character, ends_at) values (on_a, 'character', a, now() - interval '8 days');
  on_thread := tests.act(c, 'card', t, '{"card": "tgthread", "reach": "thread"}', p1, now() - interval '15 days');
  insert into play_reach (play, reach, thread, ends_at) values (on_thread, 'thread', t, now() - interval '8 days');
  on_b := tests.act(c, 'card', t, '{"card": "tgkeep", "reach": "character"}', p1, now() - interval '14 days');
  insert into play_reach (play, reach, character, ends_at) values (on_b, 'character', b, now() - interval '8 days');
  perform tests.become(ann); doc := thread_page(t, 1, null, 20, '{}'); perform tests.unbecome();
  if pg_temp.kept_plays(doc) is distinct from array[on_a::text, on_thread::text, on_b::text] then
    raise exception 'a character play of A, a thread play and a character play of B, oldest first: %', doc -> 'kept'; end if;
  if (select array_agg(x ->> 'reach' order by ord) from jsonb_array_elements(doc -> 'kept') with ordinality as k(x, ord)) is distinct from array['character', 'thread', 'character'] then
    raise exception 'each row carries its reach: %', doc -> 'kept'; end if;
  -- A page of B's post alone: B's play and the thread's, not A's.
  perform tests.become(ann); doc := thread_page(t, 2, null, 1, '{}'); perform tests.unbecome();
  if pg_temp.kept_plays(doc) is distinct from array[on_thread::text, on_b::text] then raise exception 'B''s post: the thread play and B''s play, not A''s: %', doc -> 'kept'; end if;
end $$;

-- ---- Rows read do not grow with history (docs/plans/2026-11-13-glitter-keeps-bound-plan.md, Task 2) ----
-- One post long ago by author A, the one play that holds it, then N later worn-off plays of a keeping kind on A; one real thread_page call, one post a page, counted: the tuples
-- the transaction read of play_reach and of each of its indexes (pg_stat_get_xact_tuples_returned, summed before and after the call; the transaction's own counts, so the harness's
-- begin/rollback and the role the call is made as do not change them). enable_seqscan is off around the call: on a toy table the planner seq-scans play_reach for `spun` whatever `kept` does,
-- which would hide the difference. A btree counts only the entries that pass its index conditions, so this cannot see a walk; the plan block below holds the index's name.
-- Measured before the range predicate and the GiST index (the read bounded below by the page's earliest post and not above): 14 rows read at N = 5 and 501 at N = 500 (the plan's scratch
-- database: 14 and 509); after, 10 and 2.
create function pg_temp.reach_rows() returns bigint language sql as $$
  select (pg_stat_get_xact_tuples_returned('play_reach'::regclass)
          + coalesce((select sum(pg_stat_get_xact_tuples_returned(i.indexrelid)) from pg_index i where i.indrelid = 'play_reach'::regclass), 0))::bigint
$$;

do $$
declare
  ann uuid := tests.account('rh-ann'); c uuid := tests.character(ann, 'Rh Caster');
  n integer; a uuid; t uuid; p uuid; w uuid; held uuid; doc jsonb; before_n bigint; reads bigint[] := '{}'; ts uuid[] := '{}'; hs uuid[] := '{}';
begin
  foreach n in array array[5, 500] loop
    a := tests.character(ann, 'Rh A ' || n); t := tests.thread('Rh history ' || n); ts := ts || t;
    p := tests.post(a, t, 'A, long ago.', now() - interval '3000 days');
    held := tests.act(c, 'card', t, '{"card": "tgkeep", "reach": "character"}', p, now() - interval '3010 days');
    insert into play_reach (play, reach, character, ends_at) values (held, 'character', a, now() - interval '2995 days');
    hs := hs || held;
    -- N later worn-off plays of the keeping kind on A, one every four days, each lasting two.
    for i in 1..n loop
      w := tests.act(c, 'card', t, '{"card": "tgkeep", "reach": "character"}', p, now() - interval '2900 days' + make_interval(days => 4 * i));
      insert into play_reach (play, reach, character, ends_at) values (w, 'character', a, now() - interval '2900 days' + make_interval(days => 4 * i + 2));
    end loop;
  end loop;
  -- Every fixture is analyzed before the first call: a function's plan is made once for the loop's calls, and a plan made over the first, small table would price the two indexes alike.
  analyze play_reach;
  foreach n in array array[5, 500] loop
    t := ts[array_position(array[5, 500], n)]; held := hs[array_position(array[5, 500], n)];
    set local enable_seqscan = off;
    perform tests.become(ann);
    before_n := pg_temp.reach_rows();
    doc := thread_page(t, 1, null, 1, '{}');
    reads := reads || (pg_temp.reach_rows() - before_n);
    perform tests.unbecome();
    set local enable_seqscan = on;
    if pg_temp.kept_plays(doc) is distinct from array[held::text] then raise exception 'the old page keeps the one play that holds its post, at N = %: %', n, doc -> 'kept'; end if;
  end loop;
  if reads[2] > reads[1] + 5 then
    raise exception 'rows read of play_reach grow with history: % at N = 5, % at N = 500', reads[1], reads[2]; end if;
end $$;

-- ---- The cost guard: play_reach_character_window serves a per-author window probe of this shape ----
-- This explains a replica of kept_reach's character probe, not thread_page itself, so it cannot catch a change to thread_page; it guards cost only: that the GiST index
-- play_reach_character_window (character, tstzrange(started_at, ends_at)) serves the probe for one author with 520 plays, bounded at both ends, and that it is not a sequential scan.
do $$
declare
  ann uuid := tests.account('te-ann'); a uuid := tests.character(ann, 'Te A'); c uuid := tests.character(ann, 'Te Caster');
  t uuid := tests.thread('Te many plays'); p uuid; w uuid; ln record; plan text := '';
begin
  p := tests.post(a, t, 'A, a month ago.', now() - interval '30 days');
  -- A character with a worn-off play for each week of ten years.
  for i in 1..520 loop
    w := tests.act(c, 'card', t, '{"card": "tgkeep", "reach": "character"}', p, now() - make_interval(days => 7 * i + 1));
    insert into play_reach (play, reach, character, ends_at) values (w, 'character', a, now() - make_interval(days => 7 * i - 6));
  end loop;
  analyze play_reach;
  set local enable_seqscan = off;
  for ln in execute format($q$explain select x.play from (select distinct p.character from acts p where p.id = %L) au
      cross join (select %L::timestamptz as lo, %L::timestamptz as hi) s
      cross join lateral (select r.play from play_reach r where r.character = au.character and tstzrange(r.started_at, r.ends_at) && tstzrange(s.lo, s.hi, '[]') and r.ends_at <= now()) x$q$,
      p, now() - interval '30 days', now() - interval '29 days') loop
    plan := plan || E'\n' || ln."QUERY PLAN";
  end loop;
  set local enable_seqscan = on;
  if plan not like '%play_reach_character_window%' then raise exception 'a character''s kept read is not from play_reach_character_window: %', plan; end if;
  if plan like '%Seq Scan on play_reach%' then raise exception 'a character''s kept read scans play_reach: %', plan; end if;
end $$;

-- ---- A play's row carries its Act's date: the start of its window, filled by the trigger whatever a writer passes ----
-- play_card (through place_cast and lay_sprung) writes the Act, then the row; a direct insert is covered too. The check refuses a row that ends before it starts, and the row is still append-only.
do $$
declare
  ann uuid := tests.account('sb-ann'); bob uuid := tests.account('sb-bob');
  c uuid := tests.character(ann, 'Sb Caster'); target uuid := tests.character(bob, 'Sb Target');
  t uuid := tests.thread('Sb start'); p uuid; q uuid;
  ch jsonb; th jsonb; bd jsonb; own uuid; early uuid; ghost uuid := gen_random_uuid(); backwards uuid;
  general uuid := (select id from boards where slug = 'general');
  ann_thread uuid; why text;
begin
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts) values
    ('sbchar', 'Sb Char', 'sweet', 'rare', 'cast', '{character}', interval '2 days'),
    ('sbthread', 'Sb Thread', 'sweet', 'rare', 'cast', '{thread}', interval '2 days'),
    ('sbboard', 'Sb Board', 'sweet', 'rare', 'cast', '{board}', interval '2 days');
  insert into card_ledger (account, card, kind, price) values (ann, 'sbchar', 'bought', 0), (ann, 'sbthread', 'bought', 0), (ann, 'sbboard', 'bought', 0);
  select (value #>> '{}')::uuid into ann_thread from settings where key = 'systemAnnouncements';
  if ann_thread is null then
    insert into threads (board, title) select id, 'Announcements' from boards where slug = 'the-system' returning id into ann_thread;
    insert into settings (key, value) values ('systemAnnouncements', to_jsonb(ann_thread::text));
  end if;
  p := tests.post(target, t, 'The first.');
  q := tests.post(target, t, 'The second.');

  -- Every writer: a cast at character, thread and board reach.
  ch := play_card(ann, 'sbchar', c, target, '{}', 0, '', 'character', q);
  th := play_card(ann, 'sbthread', c, t, '{}', 0, '', 'thread');
  bd := play_card(ann, 'sbboard', c, general, '{}', 0, '', 'board');
  if (select count(*) from play_reach r join acts a on a.id = r.play where r.play in ((ch ->> 'id')::uuid, (th ->> 'id')::uuid, (bd ->> 'id')::uuid)
        and r.started_at is not distinct from a.created_at) is distinct from 3 then
    raise exception 'a cast at character, thread and board reach carries its Act''s date as its start: %', (select jsonb_agg(to_jsonb(r)) from play_reach r where r.play in ((ch ->> 'id')::uuid, (th ->> 'id')::uuid, (bd ->> 'id')::uuid));
  end if;

  -- A direct insert naming another start gets the Act's.
  early := tests.act(c, 'card', t, '{"card": "sbchar", "reach": "character"}', p, now() - interval '3 days');
  insert into play_reach (play, reach, character, started_at, ends_at) values (early, 'character', target, now() - interval '30 days', now() + interval '1 day');
  if (select r.started_at from play_reach r where r.play = early) is distinct from now() - interval '3 days' then
    raise exception 'a row naming another start gets its Act''s date: %', (select started_at from play_reach where play = early);
  end if;

  -- A row for an id with no Act is refused with the trigger's words, not a null.
  why := pg_temp.coded(format($s$insert into play_reach (play, reach, character, ends_at) values (%L, 'character', %L, now() + interval '1 day')$s$, ghost, target));
  if why is distinct from '23503 a play beyond a post is written after its Act' then raise exception 'a row with no Act is refused in the trigger''s words, said %', why; end if;

  -- A row ending before its Act's date is refused by the check, by name.
  backwards := tests.act(c, 'card', t, '{"card": "sbchar", "reach": "character"}', p);
  why := pg_temp.coded(format($s$insert into play_reach (play, reach, character, ends_at) values (%L, 'character', %L, now() - interval '1 hour')$s$, backwards, target));
  if why is null or why not like '23514 %play_reach_starts_before_end%' then raise exception 'a row ending before its Act is refused by play_reach_starts_before_end, said %', why; end if;

  -- Still append-only.
  why := pg_temp.coded(format('update play_reach set ends_at = ends_at + interval ''1 day'' where play = %L', early));
  if why is null or why not like '55000 a play beyond a post is never edited%' then raise exception 'play_reach refuses an update, said %', why; end if;
  why := pg_temp.coded(format('update play_reach set started_at = now() where play = %L', early));
  if why is null or why not like '55000 a play beyond a post is never edited%' then raise exception 'play_reach refuses an update of its start, said %', why; end if;
  why := pg_temp.coded(format('delete from play_reach where play = %L', early));
  if why is null or why not like '55000 a play beyond a post is never edited%' then raise exception 'play_reach refuses a delete, said %', why; end if;
  why := pg_temp.coded('truncate play_reach');
  if why is null or why not like '55000 a play beyond a post is never edited%' then raise exception 'play_reach refuses a truncate, said %', why; end if;
end $$;
