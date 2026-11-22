-- post_kinds: how many plays a post has had of each kind, and how many took, kept from play_post, and the draw kept on it (supabase/migrations/0408_post_kinds.sql; docs/plans/2026-11-21-post-plays-plan.md, Task 2; design docs/plans/2026-11-21-post-plays-design.md, section 2).
--   * Twelve plays of one kind, one refunded: plays 12, took 11. A back that sprang counts one under the empty kind; one taken back and one that ran out count none.
--   * A second, identical refresh of a play moves no count; a refund after an admin's end moves took once; took never passes plays.
--   * Three reactions of two kinds to a play and two threads spun from it: drawn 5. A reaction to the post itself moves no row. Drift is empty after each.
--   * The table is no API role's.
--   * The poisons: a reaction_tallies row written with its trigger off is named by play_post_drift(); so is a post_kinds row edited by hand.
-- The cards are this file's own (pk...); the Acts are written raw, as the triggers see them.

create function pg_temp.nodrift(label text) returns void language plpgsql as $$
begin
  if exists (select 1 from play_post_drift()) then
    raise exception 'after %, the kept rows drift: %', label, (select jsonb_agg(to_jsonb(d)) from play_post_drift() d);
  end if;
end $$;

create function pg_temp.pk(p uuid, k text) returns post_kinds language sql as $$ select * from post_kinds where post = p and kind = k $$;

create function pg_temp.coded(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

-- ---- The table: no client reaches it ----
select tests.unbecome();
do $$
begin
  if not exists (select 1 from pg_class c where c.relname = 'post_kinds' and c.relnamespace = 'public'::regnamespace and c.relrowsecurity) then raise exception 'post_kinds is missing or has no row-level security'; end if;
  if has_table_privilege('anon', 'post_kinds', 'select,insert,update,delete') or has_table_privilege('authenticated', 'post_kinds', 'select,insert,update,delete') or has_table_privilege('service_role', 'post_kinds', 'select,insert,update,delete') then
    raise exception 'post_kinds is granted to an API role';
  end if;
end $$;

-- ---- Twelve plays of one kind, one refunded ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pk-t-ann'); a uuid := tests.character(ann, 'Pk T Ann');
  t uuid := tests.thread('Pk twelve'); p uuid := tests.post(a, t, 'A post.');
  plays uuid[] := '{}'; i integer; k post_kinds;
begin
  for i in 1..12 loop plays := plays || tests.act(a, 'card', t, jsonb_build_object('card', 'pkx', 'layer', i), p); end loop;
  k := pg_temp.pk(p, 'pkx');
  if k.plays is distinct from 12 or k.took is distinct from 12 then raise exception 'twelve plays: %', to_jsonb(k); end if;
  perform pg_temp.nodrift('twelve plays');
  insert into card_write_refunds (play, amount) values (plays[3], 0);
  k := pg_temp.pk(p, 'pkx');
  if k.plays is distinct from 12 or k.took is distinct from 11 then raise exception 'one refunded should give plays 12, took 11: %', to_jsonb(k); end if;
  perform pg_temp.nodrift('a refund');
  -- A second identical refresh moves nothing; neither does a refresh of a refunded play.
  perform refresh_play_post(plays[3]); perform refresh_play_post(plays[3]); perform refresh_play_post(plays[4]); perform refresh_play_post(plays[4]);
  k := pg_temp.pk(p, 'pkx');
  if k.plays is distinct from 12 or k.took is distinct from 11 then raise exception 'a repeated refresh moved the counts: %', to_jsonb(k); end if;
  -- A refund after an admin's end: the end does not move took, the refund moves it once.
  insert into admins (account) values (ann);
  perform tests.become(ann); perform reverse_card(plays[5]); perform tests.unbecome();
  k := pg_temp.pk(p, 'pkx');
  if k.plays is distinct from 12 or k.took is distinct from 11 then raise exception 'an admin''s end moved the counts: %', to_jsonb(k); end if;
  insert into card_write_refunds (play, amount) values (plays[5], 0);
  perform refresh_play_post(plays[5]);
  k := pg_temp.pk(p, 'pkx');
  if k.plays is distinct from 12 or k.took is distinct from 10 or k.took > k.plays then raise exception 'a refund after an end: %', to_jsonb(k); end if;
  perform pg_temp.nodrift('a refund after an admin''s end');
  -- Another kind on the same post counts apart.
  perform tests.act(a, 'card', t, jsonb_build_object('card', 'pky'), p);
  if (pg_temp.pk(p, 'pky')).plays is distinct from 1 or (pg_temp.pk(p, 'pkx')).plays is distinct from 12 then raise exception 'a second kind did not count apart'; end if;
  perform pg_temp.nodrift('two kinds');
end $$;

-- ---- A back counts once it sprang, under the empty kind ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pk-b-ann'); a uuid := tests.character(ann, 'Pk B Ann');
  t uuid := tests.thread('Pk backs'); p uuid := tests.post(a, t, 'A post.');
  s1 uuid; s2 uuid; s3 uuid; k post_kinds;
begin
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts) values
    ('pkback', 'Pk Back', 'sweet', 'uncommon', 'set', '{"trigger": {"on": "cast"}, "match": {"flavors": ["salty"]}}', '{post}', null);
  s1 := tests.act(a, 'set', t, '{}', p);
  insert into face_down (play, account, card, post, thread, round, ends_at) values (s1, ann, 'pkback', p, t, 1, now() + interval '2 days');
  if exists (select 1 from post_kinds where post = p and plays > 0) then raise exception 'a live back counted before it sprang: %', (select jsonb_agg(to_jsonb(x)) from post_kinds x where x.post = p); end if;
  perform pg_temp.nodrift('a live back');
  perform tests.act(a, 'spring', t, jsonb_build_object('set', s1::text, 'card', 'pkback', 'trigger', 'cast', 'did', 'returned'), p);
  k := pg_temp.pk(p, '');
  if k.plays is distinct from 1 or k.took is distinct from 1 then raise exception 'a sprung back should count 1 under the empty kind: %', to_jsonb(k); end if;
  perform pg_temp.nodrift('a sprung back');
  -- Taken back unsprung.
  s2 := tests.act(a, 'set', t, '{}', p);
  insert into face_down (play, account, card, post, thread, round, ends_at) values (s2, ann, 'pkback', p, t, 2, now() + interval '2 days');
  perform tests.act(a, 'take_back', t, jsonb_build_object('set', s2::text), p);
  -- One that ran out.
  s3 := tests.act(a, 'set', t, '{}', p, now() - interval '9 days');
  insert into face_down (play, account, card, post, thread, round, ends_at) values (s3, ann, 'pkback', p, t, 3, now() - interval '2 days');
  k := pg_temp.pk(p, '');
  if k.plays is distinct from 1 or k.took is distinct from 1 then raise exception 'a back taken back or run out was counted: %', to_jsonb(k); end if;
  perform pg_temp.nodrift('a back taken back and one that ran out');
end $$;

-- ---- The draw: reactions and spun threads ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pk-d-ann'); a uuid := tests.character(ann, 'Pk D Ann');
  bob uuid := tests.account('pk-d-bob'); b uuid := tests.character(bob, 'Pk D Bob');
  t uuid := tests.thread('Pk draw'); p uuid := tests.post(a, t, 'A post.');
  pl uuid; th uuid; n integer;
begin
  pl := tests.act(a, 'card', t, jsonb_build_object('card', 'pkx'), p);
  perform tests.become(bob); perform react(pl, b, 'up'); perform tests.unbecome();
  if (select drawn from play_post where play = pl) is distinct from 1 then raise exception 'a reaction did not draw: %', (select to_jsonb(x) from play_post x where x.play = pl); end if;
  perform pg_temp.nodrift('a reaction');
  -- Two more, of two kinds, written as react writes them.
  insert into reaction_tallies (act, kind, count) values (pl, 'boo', 1) on conflict (act, kind) do update set count = reaction_tallies.count + 1;
  insert into reaction_tallies (act, kind, count) values (pl, 'up', 1) on conflict (act, kind) do update set count = reaction_tallies.count + 1;
  if (select drawn from play_post where play = pl) is distinct from 3 then raise exception 'three reactions: drawn is %', (select drawn from play_post where play = pl); end if;
  perform pg_temp.nodrift('three reactions of two kinds');
  -- Two threads spun from the play.
  insert into threads (board, title, origin_act_id) select bo.id, 'Pk spun one', pl from boards bo where bo.slug = 'general';
  insert into threads (board, title, origin_act_id) select bo.id, 'Pk spun two', pl from boards bo where bo.slug = 'general';
  if (select drawn from play_post where play = pl) is distinct from 5 then raise exception 'three reactions and two threads: drawn is %', (select drawn from play_post where play = pl); end if;
  perform pg_temp.nodrift('two threads');
  -- A thread with no origin, and a thread spun from an Act that is no play, move nothing.
  insert into threads (board, title) select bo.id, 'Pk plain' from boards bo where bo.slug = 'general';
  insert into threads (board, title, origin_act_id) select bo.id, 'Pk spun from a post', p from boards bo where bo.slug = 'general';
  -- A reaction to the post itself moves no play's row.
  insert into reaction_tallies (act, kind, count) values (p, 'up', 4);
  select count(*) into n from play_post where drawn <> 0 and play <> pl and post = p;
  if n <> 0 or (select drawn from play_post where play = pl) is distinct from 5 then raise exception 'a post''s own tally or thread moved a play''s draw'; end if;
  perform pg_temp.nodrift('a reaction to the post');
  -- An origin set after the thread's insert is drawn too (0096's test does so).
  th := (select id from threads where title = 'Pk plain');
  update threads set origin_act_id = pl where id = th;
  if (select drawn from play_post where play = pl) is distinct from 6 then raise exception 'an origin set by update did not draw'; end if;
  perform pg_temp.nodrift('an origin set by update');
end $$;

-- ---- Poison: a tally written with its trigger off is named ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pk-p-ann'); a uuid := tests.character(ann, 'Pk P Ann');
  t uuid := tests.thread('Pk poison'); p uuid := tests.post(a, t, 'A post.');
  pl uuid := tests.act(a, 'card', t, jsonb_build_object('card', 'pkx'), p);
  named integer;
begin
  perform pg_temp.nodrift('before the poison');
  alter table reaction_tallies disable trigger user;
  insert into reaction_tallies (act, kind, count) values (pl, 'up', 2);
  alter table reaction_tallies enable trigger user;
  if not exists (select 1 from play_post_drift() d where d.play = pl) then raise exception 'a tally written with its trigger off is not named by play_post_drift'; end if;
  -- Repaired by the kept row's own refresh.
  perform refresh_play_post(pl);
  perform pg_temp.nodrift('the repair');
end $$;

-- ---- Poison: a post_kinds row edited by hand is named, and so is a missing one ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pk-q-ann'); a uuid := tests.character(ann, 'Pk Q Ann');
  t uuid := tests.thread('Pk hand'); p uuid := tests.post(a, t, 'A post.');
  pl uuid := tests.act(a, 'card', t, jsonb_build_object('card', 'pkx'), p);
begin
  perform pg_temp.nodrift('before the poison');
  update post_kinds set plays = 5, took = 5 where post = p and kind = 'pkx';
  if not exists (select 1 from play_post_drift() d where d.why like '%pkx%' and d.play = p) then raise exception 'a post_kinds row edited by hand is not named: %', (select jsonb_agg(to_jsonb(d)) from play_post_drift() d); end if;
  update post_kinds set plays = 1, took = 1 where post = p and kind = 'pkx';
  perform pg_temp.nodrift('the hand edit put back');
  delete from post_kinds where post = p and kind = 'pkx';
  if not exists (select 1 from play_post_drift() d where d.play = p) then raise exception 'a missing post_kinds row is not named'; end if;
  insert into post_kinds (post, kind, plays, took) values (p, 'pkx', 1, 1);
  perform pg_temp.nodrift('the row put back');
  -- A row for a (post, kind) no play makes is named too.
  insert into post_kinds (post, kind, plays, took) values (p, 'pkghost', 1, 0);
  if not exists (select 1 from play_post_drift() d where d.why like '%pkghost%') then raise exception 'a post_kinds row of no play is not named'; end if;
  delete from post_kinds where kind = 'pkghost';
  -- took beyond plays is refused by the table.
  if pg_temp.coded(format('update post_kinds set took = 3 where post = %L', p)) is null then raise exception 'took beyond plays was allowed'; end if;
end $$;

-- ---- A fall makes no row, and a row that reaches zero is deleted; drift names a zero row ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pk-z-ann'); a uuid := tests.character(ann, 'Pk Z Ann');
  t uuid := tests.thread('Pk zero'); p uuid := tests.post(a, t, 'A post.');
begin
  perform play_post_add(p, 'pkz', -1, -1);
  if exists (select 1 from post_kinds where post = p) then raise exception 'a fall made a row: %', (select jsonb_agg(to_jsonb(x)) from post_kinds x where x.post = p); end if;
  perform play_post_add(p, 'pkz', 1, 1);
  perform play_post_add(p, 'pkz', 1, 0);
  perform play_post_add(p, 'pkz', -1, -1);
  if (pg_temp.pk(p, 'pkz')).plays is distinct from 1 or (pg_temp.pk(p, 'pkz')).took is distinct from 0 then raise exception 'the falls did not leave plays 1, took 0: %', to_jsonb(pg_temp.pk(p, 'pkz')); end if;
  perform play_post_add(p, 'pkz', -1, 0);
  if exists (select 1 from post_kinds where post = p) then raise exception 'a row that reached zero stayed: %', (select jsonb_agg(to_jsonb(x)) from post_kinds x where x.post = p); end if;
  -- A zero row written by hand is named: no play makes it.
  insert into post_kinds (post, kind, plays, took) values (p, 'pkz', 0, 0);
  if not exists (select 1 from play_post_drift() d where d.play = p and d.why like '%pkz%') then raise exception 'a zero row is not named by play_post_drift'; end if;
  delete from post_kinds where post = p;
  perform pg_temp.nodrift('the zero row removed');
end $$;

-- ---- The backfill: its statement rebuilds exactly the rows the triggers kept ----
select tests.unbecome();
create temp table pk_kept as select * from post_kinds;
truncate post_kinds;
insert into post_kinds (post, kind, plays, took)
select p.post, p.kind, sum(c.plays), sum(c.took) from play_post p cross join lateral play_post_counts(p) c group by p.post, p.kind having sum(c.plays) > 0;
do $$
declare lost integer; extra integer; kept integer;
begin
  select count(*) into kept from pk_kept;
  select count(*) into lost from (select * from pk_kept except select * from post_kinds) x;
  select count(*) into extra from (select * from post_kinds except select * from pk_kept) x;
  if kept = 0 or lost <> 0 or extra <> 0 then raise exception 'the backfill lost % and added % of the % rows the triggers kept', lost, extra, kept; end if;
  perform pg_temp.nodrift('the backfill');
end $$;
