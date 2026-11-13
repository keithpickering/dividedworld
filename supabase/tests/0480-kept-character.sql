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

-- ---- The cost guard: play_reach_character serves a per-author range probe of this shape ----
-- This explains a replica of kept_reach's character probe, not thread_page itself, so it cannot catch a change to thread_page; it guards cost only: that the index
-- play_reach_character (character, ends_at) serves a range probe for one author with 520 plays, and that it is not a sequential scan.
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
      cross join lateral (select r.play from play_reach r where r.character = au.character and r.ends_at <= now() and r.ends_at > %L) x$q$, p, now() - interval '30 days') loop
    plan := plan || E'\n' || ln."QUERY PLAN";
  end loop;
  set local enable_seqscan = on;
  if plan not like '%play_reach_character%' then raise exception 'a character''s kept read is not from play_reach_character: %', plan; end if;
  if plan like '%Seq Scan on play_reach%' then raise exception 'a character''s kept read scans play_reach: %', plan; end if;
end $$;
