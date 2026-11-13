-- The thread's page draws a reply under its post, and a kept play's end (supabase/migrations/0349_thread_page_under.sql;
-- docs/plans/2026-11-11-card-notes-part-2-plan.md, Task 3). A reply a play of a card that replies carried (post_under, 0348) is a post with a number of its own, drawn under
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
  t uuid := tests.thread('Tu forty-five'); posts uuid[] := '{}'; hs uuid[] := '{}'; played jsonb; pl uuid; reply uuid; reply_card uuid;
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

-- ---- Where a reply's number falls, and what is drawn from it ----
create function pg_temp.drawn_under(parent uuid, by_character uuid, body text) returns uuid[] language plpgsql as $$
declare th uuid := (select a.thread from acts a where a.id = parent); reply uuid; play uuid;
begin
  reply := tests.post(by_character, th, body);
  play := tests.act(by_character, 'card', th, jsonb_build_object('card', 'tucut', 'reach', 'post', 'reply', reply), parent);
  insert into post_under (play, parent, reply, thread) values (play, parent, reply, th);
  return array[play, reply];
end $$;

-- A reply whose number falls on its parent's own page is drawn once: in `under`, not in `acts`, in `cut`. When its play is ended it holds its number there again, and `under` is empty.
do $$
declare
  ann uuid := tests.account('to-ann'); admin_acc uuid := tests.account('to-admin'); a1 uuid := tests.character(ann, 'To One');
  t uuid := tests.thread('To own page'); posts uuid[] := '{}'; hs uuid[] := '{}'; made uuid[]; doc jsonb;
begin
  insert into admins (account) values (admin_acc);
  for i in 1..5 loop posts := posts || tests.post(a1, t, 'Post ' || i); end loop;
  made := pg_temp.drawn_under(posts[3], a1, 'On its parent''s page.');
  perform tests.become(ann); doc := thread_page(t, 1, null, 20, '{}'); perform tests.unbecome();
  if pg_temp.seqs(doc) is distinct from array[1, 2, 3, 4, 5] then raise exception 'the reply (number 6) is not among page 1''s Acts: %', pg_temp.seqs(doc); end if;
  if jsonb_array_length(doc -> 'under') is distinct from 1 or doc #>> '{under,0,act,id}' is distinct from made[2]::text or (doc #>> '{under,0,act,seq}')::integer is distinct from 6 or doc #>> '{under,0,parent}' is distinct from posts[3]::text then
    raise exception 'the reply is under post 3, once: %', doc -> 'under'; end if;
  if doc -> 'cut' is distinct from jsonb_build_array(jsonb_build_object('seq', 6, 'parent_seq', 3)) then raise exception 'cut names number 6 on its parent''s own page: %', doc -> 'cut'; end if;
  -- Its play ended, the reply is at its number on the parent's page and nothing is drawn under.
  perform tests.become(admin_acc); perform reverse_card(made[1]); perform tests.unbecome();
  perform tests.become(ann); doc := thread_page(t, 1, null, 20, '{}'); perform tests.unbecome();
  if pg_temp.seqs(doc) is distinct from array[1, 2, 3, 4, 5, 6] then raise exception 'an ended play puts the reply back at its number, on its parent''s page: %', pg_temp.seqs(doc); end if;
  if doc -> 'under' is distinct from '[]'::jsonb or doc -> 'cut' is distinct from '[]'::jsonb then raise exception 'an ended play draws nothing under and cuts nothing: % %', doc -> 'under', doc -> 'cut'; end if;
end $$;

-- A page whose every number is drawn elsewhere (the thread's last page): no Acts, a `cut` for each number, no error, and nothing under.
do $$
declare
  ann uuid := tests.account('te-ann'); a1 uuid := tests.character(ann, 'Te One');
  t uuid := tests.thread('Te all cut'); posts uuid[] := '{}'; hs uuid[] := '{}'; doc jsonb;
begin
  for i in 1..3 loop posts := posts || tests.post(a1, t, 'Post ' || i); end loop;
  perform pg_temp.drawn_under(posts[1], a1, 'Under one.');
  perform pg_temp.drawn_under(posts[2], a1, 'Under two.');
  perform tests.become(ann); doc := thread_page(t, 2, null, 3, '{}'); perform tests.unbecome();
  if (doc ->> 'page')::integer is distinct from 2 or (doc #>> '{summary,last_seq}')::integer is distinct from 5 then raise exception 'page 2 is the last page of five numbers at three a page: %', doc -> 'summary'; end if;
  if doc -> 'acts' is distinct from '[]'::jsonb then raise exception 'every number of page 2 is drawn elsewhere, so it holds no Act: %', doc -> 'acts'; end if;
  if doc -> 'cut' is distinct from jsonb_build_array(jsonb_build_object('seq', 4, 'parent_seq', 1), jsonb_build_object('seq', 5, 'parent_seq', 2)) then raise exception 'cut names each number: %', doc -> 'cut'; end if;
  if doc -> 'under' is distinct from '[]'::jsonb or doc -> 'kept' is distinct from '[]'::jsonb then raise exception 'the parents are on page 1: nothing under here: %', doc; end if;
  perform tests.become(ann); doc := thread_page(t, 1, null, 3, '{}'); perform tests.unbecome();
  if pg_temp.seqs(doc) is distinct from array[1, 2, 3] or jsonb_array_length(doc -> 'under') is distinct from 2 or doc -> 'cut' is distinct from '[]'::jsonb then raise exception 'page 1 draws both replies under their posts: %', doc; end if;
end $$;

-- A concealed reply and a hidden parent: the layer holds for a drawn reply as for a page's own post, and neither is dropped.
do $$
declare
  ann uuid := tests.account('th-ann'); admin_acc uuid := tests.account('th-admin'); a1 uuid := tests.character(ann, 'Th One');
  t uuid := tests.thread('Th hidden'); posts uuid[] := '{}'; hs uuid[] := '{}'; secret uuid[]; open_reply uuid[]; doc jsonb; own jsonb; under_act jsonb;
begin
  insert into admins (account) values (admin_acc);
  for i in 1..4 loop posts := posts || tests.post(a1, t, case i when 4 then 'Sekrit page words.' else 'Post ' || i end); end loop;
  secret := pg_temp.drawn_under(posts[2], a1, 'Sekrit reply words.');
  open_reply := pg_temp.drawn_under(posts[3], a1, 'Plain reply words.');
  perform tests.become(admin_acc);
  perform decide(null, secret[2], 'hide', null, 'the reply');
  perform decide(null, posts[4], 'hide', null, 'a page post, for comparison');
  perform decide(null, posts[3], 'hide', null, 'a parent');
  perform tests.unbecome();
  perform tests.become(ann); doc := thread_page(t, 1, null, 20, '{}'); perform tests.unbecome();
  if jsonb_array_length(doc -> 'under') is distinct from 2 then raise exception 'a concealed reply and a reply under a hidden parent are both still drawn: %', doc -> 'under'; end if;
  under_act := (select x -> 'act' from jsonb_array_elements(doc -> 'under') x where x ->> 'play' = secret[1]::text);
  own := (select x from jsonb_array_elements(doc -> 'acts') x where x ->> 'id' = posts[4]::text);
  if under_act ->> 'id' is distinct from secret[2]::text then raise exception 'the concealed reply is under its parent: %', doc -> 'under'; end if;
  perform tests.become(ann);
  if under_act is distinct from (select to_jsonb(a) from acts_public a where a.id = secret[2]) then raise exception 'a concealed reply carries the projection a reader gets from acts_public: %', under_act; end if;
  perform tests.unbecome();
  if under_act -> 'hidden' is distinct from 'true'::jsonb or (under_act -> 'payload') is distinct from (own -> 'payload') or (under_act -> 'payload_hidden') is distinct from (own -> 'payload_hidden') then
    raise exception 'a concealed reply is masked as a concealed post on the page is: % vs %', under_act, own; end if;
  if doc::text like '%Sekrit%' then raise exception 'a hidden word reaches the document'; end if;
  -- A hidden parent still draws its visible reply under it, and its number stays cut.
  if not exists (select 1 from jsonb_array_elements(doc -> 'under') x where x ->> 'play' = open_reply[1]::text and x ->> 'parent' = posts[3]::text and x #>> '{act,payload,body}' = 'Plain reply words.') then
    raise exception 'a visible reply under a hidden parent is drawn: %', doc -> 'under'; end if;
  if (select array_agg((x ->> 'seq')::integer order by (x ->> 'seq')::integer) from jsonb_array_elements(doc -> 'cut') x) is distinct from array[5, 6] then raise exception 'both numbers are cut: %', doc -> 'cut'; end if;
  if pg_temp.seqs(doc) is distinct from array[1, 2, 3, 4] then raise exception 'the page holds its four posts, the hidden one among them: %', pg_temp.seqs(doc); end if;
end $$;

-- A live play of the kind that keeps, over a thread that also has a worn-off one, is in `above`; the worn-off one is in `kept`; neither is in the other.
do $$
declare
  ann uuid := tests.account('tl-ann'); a1 uuid := tests.character(ann, 'Tl One');
  t uuid := tests.thread('Tl live and worn');
  p uuid := tests.post(a1, t, 'In both windows.', now() - interval '5 days');
  worn uuid; live uuid; doc jsonb;
begin
  worn := tests.act(a1, 'card', t, '{"card": "tukeep", "reach": "thread"}', p, now() - interval '10 days');
  insert into play_reach (play, reach, thread, ends_at) values (worn, 'thread', t, now() - interval '3 days');
  live := tests.act(a1, 'card', t, '{"card": "tukeep", "reach": "thread"}', p, now() - interval '9 days');
  insert into play_reach (play, reach, thread, ends_at) values (live, 'thread', t, now() + interval '2 days');
  perform tests.become(ann); doc := thread_page(t, 1, null, 20, '{}'); perform tests.unbecome();
  if (select array_agg(x ->> 'play') from jsonb_array_elements(doc -> 'above') x) is distinct from array[live::text] then raise exception 'the live play is in above: %', doc -> 'above'; end if;
  if (select array_agg(x ->> 'play') from jsonb_array_elements(doc -> 'kept') x) is distinct from array[worn::text] then raise exception 'the worn-off play is in kept, the live one is not: %', doc -> 'kept'; end if;
end $$;

-- ---- Rows read do not grow with history (docs/plans/2026-11-13-glitter-keeps-bound-plan.md, Task 2): the thread's plays, as 0480's test holds the authors' ----
-- One post long ago, the one play that holds it, then N later worn-off thread plays of a keeping kind; one real thread_page call, one post a page, counted: the tuples the transaction read of
-- play_reach and of each of its indexes (pg_stat_get_xact_tuples_returned, summed before and after the call). enable_seqscan is off around the call, as a toy table would otherwise be
-- seq-scanned for `spun` whatever `kept` does. A btree counts only the entries that pass its index conditions, so the plan block below holds the index's name.
-- Measured before the range predicate and the GiST index: 14 rows read at N = 5 and 501 at N = 500 (the plan's scratch database: 14 and 509); after, 9 and 1.
create function pg_temp.reach_rows() returns bigint language sql as $$
  select (pg_stat_get_xact_tuples_returned('play_reach'::regclass)
          + coalesce((select sum(pg_stat_get_xact_tuples_returned(i.indexrelid)) from pg_index i where i.indrelid = 'play_reach'::regclass), 0))::bigint
$$;

do $$
declare
  ann uuid := tests.account('rh-ann'); a1 uuid := tests.character(ann, 'Rh One');
  n integer; t uuid; p uuid; w uuid; held uuid; doc jsonb; before_n bigint; reads bigint[] := '{}'; ts uuid[] := '{}'; hs uuid[] := '{}';
begin
  foreach n in array array[5, 500] loop
    t := tests.thread('Rh history ' || n); ts := ts || t;
    p := tests.post(a1, t, 'Long ago.', now() - interval '3000 days');
    held := tests.act(a1, 'card', t, '{"card": "tukeep", "reach": "thread"}', p, now() - interval '3010 days');
    insert into play_reach (play, reach, thread, ends_at) values (held, 'thread', t, now() - interval '2995 days');
    hs := hs || held;
    -- N later worn-off thread plays of the keeping kind, one every four days, each lasting two.
    for i in 1..n loop
      w := tests.act(a1, 'card', t, '{"card": "tukeep", "reach": "thread"}', p, now() - interval '2900 days' + make_interval(days => 4 * i));
      insert into play_reach (play, reach, thread, ends_at) values (w, 'thread', t, now() - interval '2900 days' + make_interval(days => 4 * i + 2));
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
    if (select array_agg(x ->> 'play') from jsonb_array_elements(doc -> 'kept') x) is distinct from array[held::text] then
      raise exception 'the old page keeps the one thread play that holds its post, at N = %: %', n, doc -> 'kept'; end if;
  end loop;
  if reads[2] > reads[1] + 5 then
    raise exception 'rows read of play_reach grow with history: % at N = 5, % at N = 500', reads[1], reads[2]; end if;
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
  -- The statement's own shape: a probe of the reply index for each number of the range, and of the parent index for each post of the page.
  plan := '';
  for ln in execute format('explain select r.id from acts r cross join lateral (select x.play from post_under x where x.reply = r.id) u where r.thread = %L and r.seq between 1 and 20', u) loop plan := plan || E'\n' || ln."QUERY PLAN"; end loop;
  if plan not like '%post_under_reply_key%' then raise exception 'the range''s probe is not a lateral probe of the unique index on reply: %', plan; end if;
  plan := '';
  for ln in execute format('explain select x.reply from acts p cross join lateral (select y.reply from post_under y where y.parent = p.id) x where p.thread = %L and p.seq <= 20', u) loop plan := plan || E'\n' || ln."QUERY PLAN"; end loop;
  if plan not like '%post_under_parent%' then raise exception 'the nested read is not a lateral probe of post_under_parent: %', plan; end if;
  plan := '';
  -- The kept read is bounded at both ends: a replica of kept_reach's thread probe, the plays whose window can hold a post of the page (`tstzrange(started_at, ends_at) && [lo, hi]`).
  for ln in execute format($q$explain select x.play from play_reach x where x.thread = %L and tstzrange(x.started_at, x.ends_at) && tstzrange(%L::timestamptz, %L::timestamptz, '[]') and x.ends_at <= now()$q$,
                           t, now() - interval '30 days', now() - interval '29 days') loop plan := plan || E'\n' || ln."QUERY PLAN"; end loop;
  if plan not like '%play_reach_thread_window%' then raise exception 'the kept read is not from play_reach_thread_window: %', plan; end if;
  if plan like '%Seq Scan on play_reach%' then raise exception 'the kept read scans play_reach: %', plan; end if;
  set local enable_seqscan = on;
end $$;
