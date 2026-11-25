load 'auto_explain'; set auto_explain.log_analyze = on; set auto_explain.log_nested_statements = on; set auto_explain.log_timing = off; set auto_explain.log_min_duration = -1;
-- A probe of one Act through acts_public reads `acts` by its key on any plan, however many veils are live and however many card_end Acts the instance holds (supabase/migrations/0434_reads_bounded_on_any_plan.sql, item 1).
-- 0395's acts_public asked whether a live author veil covers each Act with an EXISTS a planner could hash: every live veil, and for each every card_end Act, read once for each statement, so that a probe of one post read
-- veils x card_ends rows of `acts`. With the veils and card_ends planted below, one probe of a post nobody veiled read 4424 rows of `acts` through acts_public, against Postgres 16, before 0434.
-- 1. the bound: one probe through acts_public, and one through pool_probe, under each statistics state (as planted, true, empty for `acts` with relallvisible 0, empty for the veil tables too, generic plans), with the card_end Acts
--    few and then many, reads at most 5 rows;
-- 2. the check is post_veils_live's rule: author_veil_covers answers as 0395's EXISTS did, for a live veil, one ended by a card_end, one refunded, one over by its time, a totals veil, and an Act no veil covers.

create function pg_temp.acts_read() returns bigint language sql as $$
  select coalesce(sum(seq_tup_read + idx_tup_fetch), 0)::bigint from pg_stat_xact_all_tables where relname = 'acts'
$$;

create temp table fx (k text primary key, v uuid);
grant all on fx to public;
create function pg_temp.f(k text) returns uuid language sql as $$ select v from fx where fx.k = f.k $$;

-- ---- the fixture ----
-- The plain post and the planted veils alone, as the files before a guard left them on main's CI, where the planner hashed them (6 live veils, 9 card_end Acts): the posts of section 2, which stand a veil in each other way (ended,
-- refunded, over, a totals veil), are made after the bound is measured, since a refund or a veil of another kind moves the planner's choice (Postgres 17 hashed the planted veils without them and probed by key with them).
do $$
declare
  a uuid := tests.character(tests.account('rb-ann'), 'Rb Ann');
  t uuid := tests.thread('Rb Probes');
  pt uuid;
begin
  insert into fx values ('plain', tests.act(a, 'post', t, '{"body": "Nobody veiled this."}'::jsonb, null, now() - interval '1 hour'));
  pt := tests.plant_live_veils(8, 10);
  -- a planted post a live author veil covers
  insert into fx select 'veiled', v.post from post_veils v join acts p on p.id = v.post where p.thread = pt and v.veil = 'author' limit 1;
  if pg_temp.f('veiled') is null then raise exception 'the planting veiled nothing'; end if;
end $$;

-- ---- 4. the stand-in's own Acts, read from the live veils (the owner's answer on #1107) ----
-- The stand-in's profile and record list the Acts a live author veil covers. Read as a filter of acts_public they walk every Act of the instance (0395's hashed check made each row nearly free; a per-Act check, which a probe of
-- one Act needs, makes each an index probe: 3,175 buffers in 0304). They now read stand_in_acts, which starts from the live veils: here an author holds 3,000 posts and 30 live author veils, so each page reads its rows of
-- `acts` by the veils and the page, never by the author's posts; and each lists the Acts, in the order, that the view read lists (main's read).
do $$
declare
  a uuid := tests.character(tests.account('rb-vee'), 'Rb Vee');
  b uuid := tests.character(tests.account('rb-wil'), 'Rb Wil');
  t uuid := tests.thread('Rb Stand-in');
  base timestamptz := now() - interval '3 days';
  ps uuid[]; play uuid; i integer;
begin
  if not exists (select 1 from characters where staff_kind = 'anonymous') then
    insert into characters (name, staff, staff_kind, debuted_at) values ('Anonymous', 'anonymous', 'anonymous', now());
  end if;
  insert into acts (character, kind, thread, payload, created_at) select a, 'post', t, jsonb_build_object('body', 'Vee ' || g), base + g * interval '1 minute' from generate_series(1, 3000) g;
  ps := array(select x.id from acts x where x.thread = t order by x.created_at);
  -- thirty live author veils over the thread's length, one ended and one over by its time
  for i in 1..32 loop
    play := tests.act(b, 'card', t, jsonb_build_object('card', 'pvveil', 'message', '', 'config', '{}'::jsonb, 'layer', 1), ps[i * 90], base + interval '3 days' - interval '1 hour' + i * interval '1 second');
    insert into post_veils (play, post, veil, author, ends_at) values (play, ps[i * 90], 'author', a, case when i = 32 then now() - interval '1 minute' else now() + interval '1 day' end);
    if i = 31 then
      perform set_config('kayfabb.card_end_writer', 'on', true);
      insert into acts (character, kind, thread, target_act_id, payload) values (null, 'card_end', t, play, '{"why": "reversed", "by": "admin"}');
      perform set_config('kayfabb.card_end_writer', '', true);
    end if;
  end loop;
  insert into fx values ('stand', (select c.id from characters c where c.staff_kind = 'anonymous'));
  analyze acts; analyze post_veils; analyze post_veil_cover;
end $$;

create function pg_temp.stand_in_pages() returns void language plpgsql as $$
declare
  stand uuid := pg_temp.f('stand'); c0 bigint; c bigint; got jsonb; want uuid[]; have uuid[]; pg integer; kind text; kinds text[];
begin
  perform set_config('track_functions', 'all', true);
  -- main's read of the stand-in's Acts: acts_public by the character, newest first (as 0357's profile_page and record_page ask it)
  want := array(select x.id from acts_public x where x."character" = stand and x.kind in ('post', 'spin', 'card') order by x.created_at desc, x.id desc limit 5);
  if cardinality(want) < 5 then raise exception 'the stand-in shows % Acts, not five', cardinality(want); end if;
  perform tests.become((select u.id from auth.users u where u.email = 'rb-wil@test.invalid'));
  raise log 'Query Text: MARK-profile'; perform set_config('client_min_messages', 'log', true); perform set_config('auto_explain.log_min_duration', '0', true);
  c0 := pg_temp.acts_read(); got := profile_page(stand); c := pg_temp.acts_read() - c0;
  perform set_config('auto_explain.log_min_duration', '-1', true); perform set_config('client_min_messages', 'notice', true); raise log 'Query Text: MARK-end';
  perform tests.unbecome();
  have := array(select (e ->> 'id')::uuid from jsonb_array_elements(got -> 'acts') e);
  if have is distinct from want then raise exception 'the stand-in''s profile lists % where the view read lists %', have, want; end if;
  if c > 300 then raise exception 'the stand-in''s profile reads % rows of acts, with an author of 3,000 posts under 30 live veils: it reads the author''s posts, not the veils', c; end if;
  raise notice 'the stand-in''s profile: % rows of acts', c;
  foreach kind in array array['all', 'post', 'card'] loop
    kinds := case kind when 'all' then array['post', 'spin', 'card'] else array[kind] end;
    foreach pg in array array[1, 2] loop
      want := array(select x.id from acts_public x where x."character" = stand and x.kind = any (kinds) order by x.created_at desc, x.id desc offset (pg - 1) * 20 limit 20);
      perform tests.become((select u.id from auth.users u where u.email = 'rb-wil@test.invalid'));
      c0 := pg_temp.acts_read(); got := record_page(stand, kind, pg); c := pg_temp.acts_read() - c0;
      perform tests.unbecome();
      have := coalesce(array(select (e ->> 'id')::uuid from jsonb_array_elements(got -> 'acts') e), '{}');
      if have is distinct from want then raise exception 'the stand-in''s record (%, page %) lists % where the view read lists %', kind, pg, have, want; end if;
      if c > 300 then raise exception 'the stand-in''s record (%, page %) reads % rows of acts, with an author of 3,000 posts under 30 live veils', kind, pg, c; end if;
      raise notice 'the stand-in''s record (%, page %): % Acts, % rows of acts', kind, pg, cardinality(have), c;
    end loop;
  end loop;
  perform set_config('track_functions', 'none', true);
end $$;
select pg_temp.stand_in_pages();

