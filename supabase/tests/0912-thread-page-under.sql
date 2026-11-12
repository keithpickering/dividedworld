-- The thread's page draws a reply under its post, and a kept play's end (supabase/migrations/0411_thread_page_under.sql;
-- docs/plans/2026-11-11-card-notes-part-2-plan.md, Task 3). A reply a play of a card that replies carried (post_under, 0410) is a post with a number of its own, drawn under
-- its parent while the play is in force: the page's range of numbers leaves it out, and the document says where it is (`under`) and which numbers it left (`cut`). A play of a
-- kind that `keeps` is read after its week (`kept`) by the posts whose date falls inside it. The document is a public projection, the same for every caller.
-- The cards are this file's own (tu...), never an instance's.

create function pg_temp.coded(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

create function pg_temp.seqs(doc jsonb) returns integer[] language sql as $$
  select coalesce(array_agg((a ->> 'seq')::integer order by (a ->> 'seq')::integer), '{}') from jsonb_array_elements(doc -> 'acts') a
$$;

do $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, stack, reaches, replies, keeps, trap, lasts, gimmick) values
    ('tucut', 'Tu Cut', 'pepperoni', 'rare', 'cast', 1, '{post}', true, false, null, null, null),
    ('tukeep', 'Tu Keep', 'sweet', 'rare', 'cast', 1, '{thread}', false, true, null, interval '7 days', null),
    ('tuplain', 'Tu Plain', 'sweet', 'rare', 'cast', 1, '{thread}', false, false, null, interval '7 days', null);
end $$;

-- ---- A thread of 45 posts at 20 a page, with a reply (number 46) carried under post 3 ----
do $$
declare
  ann uuid := tests.account('tu-ann'); bob uuid := tests.account('tu-bob'); admin_acc uuid := tests.account('tu-admin');
  a1 uuid := tests.character(ann, 'Tu One'); a2 uuid := tests.character(ann, 'Tu Two'); cutter uuid := tests.character(bob, 'Tu Cutter');
  t uuid := tests.thread('Tu forty-five'); posts uuid[] := '{}'; played jsonb; pl uuid; reply uuid; reply_card uuid;
  doc jsonb; doc3 jsonb; doc_bob jsonb; why text;
begin
  insert into admins (account) values (admin_acc);
  for i in 1..45 loop posts := posts || tests.post(case when i % 2 = 0 then a2 else a1 end, t, 'Post ' || i); end loop;
  insert into card_ledger (account, card, kind, price) values (bob, 'tucut', 'bought', 0);
  insert into wallets (account, balance) values (bob, 100);
  perform tests.become_service();
  played := play_card(bob, 'tucut', cutter, posts[3], '{}', 0, '', reply => 'Cutting in line.');
  perform tests.unbecome();
  pl := (played ->> 'id')::uuid;
  reply := (played #>> '{under,act,id}')::uuid;
  if (select seq from acts where id = reply) is distinct from 46 then raise exception 'the reply takes number 46: %', (select seq from acts where id = reply); end if;
  -- The reply carries a card of its own, a reaction and a visit's worth of nothing else: its plays, its tally and its author arrive with the page.
  reply_card := tests.act(a2, 'card', t, '{"card": "splat", "config": {"color": "red"}}', reply);
  perform tests.become(ann); perform react(reply, a1, 'up'); perform tests.unbecome();

  perform tests.become(ann);
  doc := thread_page(t, 1, null, 20, '{}');
  perform tests.unbecome();
  if jsonb_array_length(doc -> 'acts') is distinct from 20 or pg_temp.seqs(doc) is distinct from (select array_agg(g) from generate_series(1, 20) g) then
    raise exception 'page 1 holds 20 Acts, numbers 1 to 20: %', pg_temp.seqs(doc); end if;
  if jsonb_array_length(doc -> 'under') is distinct from 1 or doc #>> '{under,0,parent}' is distinct from posts[3]::text or doc #>> '{under,0,play}' is distinct from pl::text
     or doc #>> '{under,0,act,id}' is distinct from reply::text or doc #>> '{under,0,act,payload,body}' is distinct from 'Cutting in line.' or (doc #>> '{under,0,act,seq}')::integer is distinct from 46
     or (select array_agg(k order by k) from jsonb_object_keys(doc -> 'under' -> 0) k) is distinct from array['act', 'parent', 'play'] then
    raise exception 'under names post 3, the play and the reply: %', doc -> 'under'; end if;
  if (doc -> 'under' -> 0 -> 'act') is distinct from (select to_jsonb(a) from acts_public a where a.id = reply) then raise exception 'under''s act is an Act as acts holds one'; end if;
  if doc -> 'cut' is distinct from '[]'::jsonb then raise exception 'page 1 cuts nothing: %', doc -> 'cut'; end if;
  if (select count(*) from jsonb_array_elements(doc -> 'acts') a where a ->> 'id' = reply::text) is distinct from 0::bigint then raise exception 'the reply is not among the page''s Acts'; end if;
  -- Its plays, its tally, its author.
  if not exists (select 1 from jsonb_array_elements(doc -> 'plays') x where x ->> 'id' = reply_card::text) then raise exception 'the reply''s own card is in plays: %', doc -> 'plays'; end if;
  if (select (x ->> 'count')::integer from jsonb_array_elements(doc -> 'tallies') x where x ->> 'act' = reply::text) is distinct from 1 then raise exception 'the reply''s tally: %', doc -> 'tallies'; end if;
  if not exists (select 1 from jsonb_array_elements(doc -> 'people') x where x -> 'character' ->> 'id' = cutter::text) then raise exception 'the reply''s author is among the people: %', doc -> 'people'; end if;
  if not exists (select 1 from jsonb_array_elements(doc -> 'mine') x where x ->> 'act' = reply::text) then raise exception 'the reader''s own reaction on the reply is in mine: %', doc -> 'mine'; end if;

  -- Page 3 holds 41 to 45 and not 46; cut says where 46 went; the number lands on page 3 still.
  perform tests.become(ann);
  doc3 := thread_page(t, 3, null, 20, '{}');
  perform tests.unbecome();
  if pg_temp.seqs(doc3) is distinct from array[41, 42, 43, 44, 45] then raise exception 'page 3 holds 41 to 45, not 46: %', pg_temp.seqs(doc3); end if;
  if doc3 -> 'cut' is distinct from jsonb_build_array(jsonb_build_object('seq', 46, 'parent_seq', 3)) then raise exception 'cut is [{46, 3}]: %', doc3 -> 'cut'; end if;
  if doc3 -> 'under' is distinct from '[]'::jsonb then raise exception 'page 3 draws nothing under a post: %', doc3 -> 'under'; end if;
  perform tests.become(ann);
  if (thread_page(t, 1, 46, 20, '{}') ->> 'page')::integer is distinct from 3 then raise exception 'in_seq 46 answers page 3'; end if;
  perform tests.unbecome();
  -- A page whose range holds neither the parent nor the reply says nothing of either.
  perform tests.become(ann);
  if (thread_page(t, 2, null, 20, '{}') -> 'under') is distinct from '[]'::jsonb or (thread_page(t, 2, null, 20, '{}') -> 'cut') is distinct from '[]'::jsonb then raise exception 'page 2 knows nothing of the reply'; end if;
  perform tests.unbecome();

  -- The same document for two different callers: the new keys, and the reply as an Act.
  perform tests.become(bob);
  doc_bob := thread_page(t, 1, null, 20, '{}');
  perform tests.unbecome();
  if doc_bob -> 'under' is distinct from doc -> 'under' or doc_bob -> 'cut' is distinct from doc -> 'cut' or doc_bob -> 'kept' is distinct from doc -> 'kept' then
    raise exception 'under, cut and kept differ between two callers'; end if;
  perform tests.become(bob);
  if (thread_page(t, 3, null, 20, '{}') -> 'cut') is distinct from doc3 -> 'cut' then raise exception 'cut differs between two callers'; end if;
  perform tests.unbecome();

  -- After an admin ends the play: nothing under, the reply holds its number again, cut is empty.
  perform tests.become(admin_acc);
  perform reverse_card(pl);
  perform tests.unbecome();
  perform tests.become(ann);
  doc := thread_page(t, 1, null, 20, '{}');
  doc3 := thread_page(t, 3, null, 20, '{}');
  perform tests.unbecome();
  if doc -> 'under' is distinct from '[]'::jsonb then raise exception 'after the end, page 1 draws nothing under: %', doc -> 'under'; end if;
  if pg_temp.seqs(doc3) is distinct from array[41, 42, 43, 44, 45, 46] or doc3 -> 'cut' is distinct from '[]'::jsonb then raise exception 'after the end, page 3 holds 46 and cuts nothing: % %', pg_temp.seqs(doc3), doc3 -> 'cut'; end if;
  if not exists (select 1 from jsonb_array_elements(doc3 -> 'plays') x where x ->> 'id' = reply_card::text) then raise exception 'the reply''s card is on page 3 at its number'; end if;
end $$;

-- ---- kept: a play of a kind that keeps, worn off, is read by the posts it was up over ----
do $$
declare
  ann uuid := tests.account('tk-ann'); admin_acc uuid := tests.account('tk-admin'); a1 uuid := tests.character(ann, 'Tk One');
  t uuid := tests.thread('Tk kept'); u uuid := tests.thread('Tk live and plain');
  p1 uuid := tests.post(a1, t, 'Before the week.', now() - interval '20 days');
  p2 uuid := tests.post(a1, t, 'Inside the week.', now() - interval '10 days');
  p3 uuid := tests.post(a1, t, 'After the week.', now() - interval '2 days');
  worn uuid; worn_ended uuid; plain uuid; live uuid; doc jsonb; doc_other jsonb; why text;
begin
  insert into admins (account) values (admin_acc);
  -- Made as 0094's worn_reach is: the play_reach row is written with an end that has passed (play_reach refuses an update).
  worn := tests.act(a1, 'card', t, '{"card": "tukeep", "reach": "thread"}', p1, now() - interval '15 days');
  insert into play_reach (play, reach, thread, ends_at) values (worn, 'thread', t, now() - interval '8 days');
  -- An admin-ended one: its own week over, then ended.
  worn_ended := tests.act(a1, 'card', t, '{"card": "tukeep", "reach": "thread"}', p1, now() - interval '25 days');
  insert into play_reach (play, reach, thread, ends_at) values (worn_ended, 'thread', t, now() - interval '9 days');
  -- A worn-off play of a kind that does not keep, over the same posts.
  plain := tests.act(a1, 'card', t, '{"card": "tuplain", "reach": "thread"}', p1, now() - interval '16 days');
  insert into play_reach (play, reach, thread, ends_at) values (plain, 'thread', t, now() - interval '8 days');
  -- A live play of the kind that keeps.
  live := tests.act(a1, 'card', t, '{"card": "tukeep", "reach": "thread"}', p3, now() - interval '1 day');
  insert into play_reach (play, reach, thread, ends_at) values (live, 'thread', t, now() + interval '6 days');

  perform tests.become(admin_acc);
  perform reverse_card(worn_ended);
  -- An admin ends a worn-off play of a kind that keeps; a worn-off play of any other kind is still refused.
  why := pg_temp.coded(format('select reverse_card(%L)', plain));
  perform tests.unbecome();
  if why is null or why not like '%that card has already worn off%' then raise exception 'a worn-off play of a kind that does not keep is refused: %', why; end if;
  if not exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = worn_ended) then raise exception 'an admin ended a worn-off play of a kind that keeps'; end if;
  if exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = plain) then raise exception 'the refusal wrote a card_end'; end if;
  perform tests.become(admin_acc);
  why := pg_temp.coded(format('select reverse_card(%L)', worn_ended));
  perform tests.unbecome();
  if why is null or why not like '%an admin has already ended that card%' then raise exception 'a second end is refused in its words: %', why; end if;

  -- A page with a post dated inside the window lists the worn-off play, and not the live one, the ended one or the plain one.
  perform tests.become(ann);
  doc := thread_page(t, 2, null, 1, '{}');
  doc_other := thread_page(t, 1, null, 1, '{}');
  perform tests.unbecome();
  if pg_temp.seqs(doc) is distinct from array[2] then raise exception 'one post to a page: %', pg_temp.seqs(doc); end if;
  if jsonb_array_length(doc -> 'kept') is distinct from 1 or doc #>> '{kept,0,play}' is distinct from worn::text or doc #>> '{kept,0,reach}' is distinct from 'thread'
     or doc #>> '{kept,0,target}' is distinct from t::text or (doc #>> '{kept,0,ends_at}')::timestamptz is distinct from (select ends_at from play_reach where play = worn)
     or doc #>> '{kept,0,act,id}' is distinct from worn::text or (select array_agg(k order by k) from jsonb_object_keys(doc -> 'kept' -> 0) k) is distinct from array['act', 'ends_at', 'play', 'reach', 'target'] then
    raise exception 'kept lists the worn-off play, in the shape of above: %', doc -> 'kept'; end if;
  if doc -> 'kept' -> 0 -> 'act' is distinct from (select to_jsonb(a) from acts_public a where a.id = worn) then raise exception 'kept''s act is the play as acts_public holds it'; end if;
  -- The play's caster and the play's tally arrive with the page, as an above play's do.
  if not exists (select 1 from jsonb_array_elements(doc -> 'people') x where x -> 'character' ->> 'id' = a1::text) then raise exception 'the caster is among the people'; end if;
  if (select array_agg(x ->> 'play') from jsonb_array_elements(doc -> 'above') x) is distinct from array[live::text] then raise exception 'only the live play is above, in neither kept nor above twice: %', doc -> 'above'; end if;
  -- A page whose posts are all outside the window lists nothing: before the play, and after the end.
  if doc_other -> 'kept' is distinct from '[]'::jsonb then raise exception 'a post before the play: %', doc_other -> 'kept'; end if;
  perform tests.become(ann);
  doc := thread_page(t, 3, null, 1, '{}');
  perform tests.unbecome();
  if doc -> 'kept' is distinct from '[]'::jsonb then raise exception 'a post after the end: %', doc -> 'kept'; end if;
  if jsonb_array_length(doc -> 'above') is distinct from 1 or doc #>> '{above,0,play}' is distinct from live::text then raise exception 'the live play is in above: %', doc -> 'above'; end if;
  -- A thread no play was on lists nothing.
  perform tests.post(a1, u, 'A post.', now() - interval '10 days');
  perform tests.become(ann);
  if (thread_page(u, 1, null, 20, '{}') -> 'kept') is distinct from '[]'::jsonb then raise exception 'a thread with no play keeps nothing'; end if;
  perform tests.unbecome();
end $$;

-- ---- The probes are index-backed (read line by line, as 0034's are) ----
do $$
declare
  t uuid := (select id from threads where title = 'Tk kept'); u uuid := (select id from threads where title = 'Tu forty-five');
  ln record; plan text := '';
begin
  set local enable_seqscan = off;
  for ln in execute format('explain select 1 from post_under x where x.reply = %L', (select reply from post_under limit 1)) loop plan := plan || E'\n' || ln."QUERY PLAN"; end loop;
  if plan not like '%post_under_reply_key%' then raise exception 'a post''s probe is not read from the unique index on reply: %', plan; end if;
  plan := '';
  for ln in execute format('explain select 1 from post_under x where x.parent = any (%L)', array(select id from acts where thread = u and kind = 'post' and seq <= 20)) loop plan := plan || E'\n' || ln."QUERY PLAN"; end loop;
  if plan not like '%post_under_parent%' then raise exception 'the nested read is not from post_under_parent: %', plan; end if;
  plan := '';
  for ln in execute format('explain select x.play from play_reach x where x.thread = %L and x.ends_at <= now() and x.ends_at > %L', t, now() - interval '30 days') loop plan := plan || E'\n' || ln."QUERY PLAN"; end loop;
  if plan not like '%play_reach_thread%' then raise exception 'the kept read is not from play_reach_thread: %', plan; end if;
  set local enable_seqscan = on;
end $$;
