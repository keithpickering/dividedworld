-- kayfabb-sql: alone
-- This file holds wall-clock budgets, so it runs with nothing beside it (#1099).
-- A report, a verdict, an appeal and a ruling are origins with a place (supabase/migrations/0422_spin_answers.sql;
-- docs/plans/2026-11-23-spin-mod-answers-plan.md, Task 1; docs/plans/2026-11-23-spin-mod-answers-design.md, sections 3, 4 and 6).
--
-- 1. Every ask and every answer, spun, gives its thread an `answer` origin place, key for key: who asked (as acts_public shows the ask's character), who answered (null while none has),
--    the punishment an appeal is of, a move's group, and the post (a move's line where it has a seq), in thread_open and in thread_list alike.
-- 2. A thread spun from a plain post keeps its `post` place; a spin made before the migration (a spin of a verdict, which drew no place) draws the new one with no Act changed.
-- 3. my_reports.verdict_act and my_appeals.ruling_act name the answer, and are null for an ask nobody has answered.
-- 4. The asker is the ask's character as acts_public shows it.
-- 5. The cost: a deep page of a board whose threads are half spun from answers (the measurement is in the comment above that section).

create function pg_temp.place(th uuid) returns jsonb language plpgsql as $$
declare a jsonb; b jsonb;
begin
  select origin_place into a from thread_open where id = th;
  select origin_place into b from thread_list where id = th;
  if a is distinct from b then raise exception 'thread_open and thread_list differ: % and %', a, b; end if;
  return a;
end $$;

-- A spin of `origin`, through `through`, as spin_written writes it (the function spin and the staff's spin both call it); the thread it made.
create function pg_temp.spun(through uuid, origin uuid) returns uuid language plpgsql as $$
declare made jsonb;
begin
  made := spin_written(origin, through, 'Spun ' || left(gen_random_uuid()::text, 6), 'Discuss.', false, array[]::uuid[]);
  return (made -> 'thread' ->> 'id')::uuid;
end $$;

create function pg_temp.line(post uuid) returns jsonb language sql as $$
  select jsonb_build_object('kind', 'post', 'thread', p.thread, 'title', t.title, 'seq', p.seq) from acts p join threads t on t.id = p.thread where p.id = post
$$;

create function pg_temp.person(c uuid) returns jsonb language sql as $$ select jsonb_build_object('id', c, 'name', (select name from characters where id = c)) $$;

create function pg_temp.expect(label text, got jsonb, want jsonb) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception '%: got % but wanted %', label, got, want; end if;
end $$;

do $$
declare
  ann uuid := tests.account('sa-ann'); bob uuid := tests.account('sa-bob'); cat uuid := tests.account('sa-cat');
  w uuid := tests.character(ann, 'Sa Wario');   -- the asker
  v uuid := tests.character(bob, 'Sa Victim');  -- whose posts are reported
  s uuid := tests.character(cat, 'Sa Spinner');
  kassie uuid; boss uuid;
  t uuid := tests.thread('Sa Kart tier list');
  ann_thread uuid := tests.thread('Sa Announcements');
  pa uuid := tests.post(v, t, 'Post A.'); pb uuid := tests.post(v, t, 'Post B.'); pc uuid := tests.post(v, t, 'Post C.'); pd uuid := tests.post(v, t, 'Post D.');
  pe uuid := tests.post(v, t, 'Post E.'); pf uuid := tests.post(v, t, 'Post F.');
  r_dis uuid; r_vis uuid; r_back uuid; r_none uuid; v_dis uuid; v_vis uuid; v_back uuid;
  inf uuid; ban uuid; mov uuid; ap_inf uuid; ap_ban uuid; ap_mov uuid; ru_inf uuid; ru_ban uuid; ru_mov uuid; ap_open uuid;
  inf2 uuid; ban_inf uuid; th uuid; spun_plain uuid; board uuid := (select id from boards where slug = 'general');
  want jsonb;
begin
  insert into characters (name, staff, staff_kind, debuted_at) values ('Sa Kassie', 'sa-kassie', 'persona', now()) returning id into kassie;
  insert into characters (name, staff, staff_kind, debuted_at) values ('Sa Boss', 'sa-boss', 'persona', now()) returning id into boss;

  insert into move_kinds (key, structural) values ('conferGroup', false) on conflict (key) do nothing;
  insert into group_kinds (key, name, color, source, tone) values ('trialMembers', 'Trial Members', '#cc0000', 'conferred', 'punishment') on conflict (key) do nothing;
  perform set_config('kayfabb.report_writer', 'on', true);
  perform set_config('kayfabb.staff_writer', 'on', true);
  perform set_config('kayfabb.warn_writer', 'on', true);
  perform set_config('kayfabb.appeal_writer', 'on', true);

  -- Four reports: dismissed, judged a visit, a backfire, and one nobody has answered.
  insert into acts (character, kind, thread, target_act_id, payload) values (w, 'report', t, pa, '{"reason": "a"}') returning id into r_dis;
  insert into acts (character, kind, thread, target_act_id, payload) values (w, 'report', t, pb, '{"reason": "b"}') returning id into r_vis;
  insert into acts (character, kind, thread, target_act_id, payload) values (w, 'report', t, pc, '{"reason": "c"}') returning id into r_back;
  insert into acts (character, kind, thread, target_act_id, payload) values (w, 'report', t, pd, '{"reason": "d"}') returning id into r_none;
  insert into acts (character, kind, thread, target_act_id, payload) values (kassie, 'report_verdict', t, r_dis, jsonb_build_object('report_act', r_dis, 'verdict', 'dismissed', 'line', 'No.')) returning id into v_dis;
  insert into acts (character, kind, thread, target_act_id, payload) values (kassie, 'report_verdict', t, r_vis, jsonb_build_object('report_act', r_vis, 'verdict', 'visit', 'line', 'Noted.')) returning id into v_vis;
  insert into acts (character, kind, thread, target_act_id, payload) values (kassie, 'report_verdict', t, r_back, jsonb_build_object('report_act', r_back, 'verdict', 'backfire', 'line', 'Hm.')) returning id into v_back;

  -- An infraction of the victim's post E and a ban that followed it, and a move in the announcements thread (conferring a group).
  insert into acts (character, kind, thread, payload) values (null, 'infraction', t, jsonb_build_object('character', v, 'band', 'severe', 'points', 7, 'rule_number', null, 'board', board, 'about_act', pe, 'visit_act', null, 'staff', 'sa-kassie', 'expires_at', now() + interval '14 days')) returning id into inf;
  insert into acts (character, kind, thread, payload) values (null, 'ban', t, jsonb_build_object('character', v, 'days', 3, 'until', now() + interval '3 days', 'infraction_act', inf, 'season', 1)) returning id into ban;
  insert into acts (character, kind, thread, payload) values (kassie, 'move', ann_thread, jsonb_build_object('kind', 'conferGroup', 'params', jsonb_build_object('group', 'trialMembers', 'character', v))) returning id into mov;

  -- An appeal of each (an appeal is its character's own, in the punishment's thread: the move is in the announcements thread, so its appellant appeals there).
  insert into acts (character, kind, thread, target_act_id, payload) values (v, 'appeal', t, inf, '{"plea": "i"}') returning id into ap_inf;
  insert into acts (character, kind, thread, target_act_id, payload) values (v, 'appeal', t, ban, '{"plea": "b"}') returning id into ap_ban;
  insert into acts (character, kind, thread, target_act_id, payload) values (v, 'appeal', ann_thread, mov, '{"plea": "m"}') returning id into ap_mov;
  insert into acts (character, kind, thread, target_act_id, payload) values (v, 'appeal', t, inf, '{"plea": "second"}') returning id into ap_open;
  insert into acts (character, kind, thread, target_act_id, payload) values (boss, 'appeal_ruling', t, ap_inf, jsonb_build_object('appeal_act', ap_inf, 'verdict', 'upheld', 'points_delta', 0, 'line', 'Upheld.')) returning id into ru_inf;
  insert into acts (character, kind, thread, target_act_id, payload) values (boss, 'appeal_ruling', t, ap_ban, jsonb_build_object('appeal_act', ap_ban, 'verdict', 'upheld', 'points_delta', 0, 'line', 'Upheld.')) returning id into ru_ban;
  insert into acts (character, kind, thread, target_act_id, payload) values (boss, 'appeal_ruling', ann_thread, ap_mov, jsonb_build_object('appeal_act', ap_mov, 'verdict', 'upheld', 'points_delta', 0, 'line', 'Upheld.')) returning id into ru_mov;

  perform set_config('kayfabb.report_writer', '', true); perform set_config('kayfabb.staff_writer', '', true);
  perform set_config('kayfabb.warn_writer', '', true); perform set_config('kayfabb.appeal_writer', '', true);

  -- ---- 1. A report's place, spun from the verdict and from the ask ----
  perform pg_temp.expect('a dismissed report, spun from its verdict', pg_temp.place(pg_temp.spun(s, v_dis)),
    jsonb_build_object('kind', 'answer', 'spun', 'answer', 'ask', 'report', 'asker', pg_temp.person(w), 'staff', pg_temp.person(kassie), 'punishment', null, 'group', null, 'on', pg_temp.line(pa)));
  perform pg_temp.expect('a visit report, spun from its verdict', pg_temp.place(pg_temp.spun(s, v_vis)),
    jsonb_build_object('kind', 'answer', 'spun', 'answer', 'ask', 'report', 'asker', pg_temp.person(w), 'staff', pg_temp.person(kassie), 'punishment', null, 'group', null, 'on', pg_temp.line(pb)));
  perform pg_temp.expect('a backfired report, spun from its verdict', pg_temp.place(pg_temp.spun(s, v_back)),
    jsonb_build_object('kind', 'answer', 'spun', 'answer', 'ask', 'report', 'asker', pg_temp.person(w), 'staff', pg_temp.person(kassie), 'punishment', null, 'group', null, 'on', pg_temp.line(pc)));
  perform pg_temp.expect('a report spun from the report itself, answered', pg_temp.place(pg_temp.spun(s, r_dis)),
    jsonb_build_object('kind', 'answer', 'spun', 'ask', 'ask', 'report', 'asker', pg_temp.person(w), 'staff', pg_temp.person(kassie), 'punishment', null, 'group', null, 'on', pg_temp.line(pa)));
  perform pg_temp.expect('a report spun from the report itself, unanswered', pg_temp.place(pg_temp.spun(s, r_none)),
    jsonb_build_object('kind', 'answer', 'spun', 'ask', 'ask', 'report', 'asker', pg_temp.person(w), 'staff', null, 'punishment', null, 'group', null, 'on', pg_temp.line(pd)));

  -- ---- 2. An appeal's place: of an infraction, of a ban (through its infraction), of a move (its line) ----
  perform pg_temp.expect('an appeal of an infraction, spun from its ruling', pg_temp.place(pg_temp.spun(s, ru_inf)),
    jsonb_build_object('kind', 'answer', 'spun', 'answer', 'ask', 'appeal', 'asker', pg_temp.person(v), 'staff', pg_temp.person(boss), 'punishment', 'infraction', 'group', null, 'on', pg_temp.line(pe)));
  perform pg_temp.expect('an appeal of a ban, spun from its ruling', pg_temp.place(pg_temp.spun(s, ru_ban)),
    jsonb_build_object('kind', 'answer', 'spun', 'answer', 'ask', 'appeal', 'asker', pg_temp.person(v), 'staff', pg_temp.person(boss), 'punishment', 'ban', 'group', null, 'on', pg_temp.line(pe)));
  perform pg_temp.expect('an appeal of a move, spun from its ruling', pg_temp.place(pg_temp.spun(s, ru_mov)),
    jsonb_build_object('kind', 'answer', 'spun', 'answer', 'ask', 'appeal', 'asker', pg_temp.person(v), 'staff', pg_temp.person(boss), 'punishment', 'move', 'group', 'trialMembers', 'on', pg_temp.line(mov)));
  perform pg_temp.expect('an appeal of an infraction, spun from the appeal', pg_temp.place(pg_temp.spun(s, ap_inf)),
    jsonb_build_object('kind', 'answer', 'spun', 'ask', 'ask', 'appeal', 'asker', pg_temp.person(v), 'staff', pg_temp.person(boss), 'punishment', 'infraction', 'group', null, 'on', pg_temp.line(pe)));
  perform pg_temp.expect('an appeal of a ban, spun from the appeal', pg_temp.place(pg_temp.spun(s, ap_ban)),
    jsonb_build_object('kind', 'answer', 'spun', 'ask', 'ask', 'appeal', 'asker', pg_temp.person(v), 'staff', pg_temp.person(boss), 'punishment', 'ban', 'group', null, 'on', pg_temp.line(pe)));
  perform pg_temp.expect('an unheard appeal of an infraction, spun from the appeal', pg_temp.place(pg_temp.spun(s, ap_open)),
    jsonb_build_object('kind', 'answer', 'spun', 'ask', 'ask', 'appeal', 'asker', pg_temp.person(v), 'staff', null, 'punishment', 'infraction', 'group', null, 'on', pg_temp.line(pe)));

  -- ---- 3. A thread spun from a plain post keeps its post place; a spin made earlier needs no migration of any Act ----
  spun_plain := pg_temp.spun(s, pf);
  perform pg_temp.expect('a thread spun from a plain post', pg_temp.place(spun_plain), pg_temp.line(pf));
  if (select count(*) from acts where kind = 'spin' and target_act_id = v_dis) is distinct from 1::bigint then raise exception 'the verdict was spun once above'; end if;
  perform pg_temp.expect('a spin made before, of the same verdict, draws the new place from its unchanged Acts',
    pg_temp.place((select thread from acts where kind = 'spin' and target_act_id = v_dis order by created_at, id limit 1)),
    jsonb_build_object('kind', 'answer', 'spun', 'answer', 'ask', 'report', 'asker', pg_temp.person(w), 'staff', pg_temp.person(kassie), 'punishment', null, 'group', null, 'on', pg_temp.line(pa)));

  -- ---- 4. The log's views name the answer ----
  perform tests.become(ann);
  if (select verdict_act from my_reports where report = r_dis) is distinct from v_dis or (select verdict_act from my_reports where report = r_vis) is distinct from v_vis
     or (select verdict_act from my_reports where report = r_back) is distinct from v_back then raise exception 'my_reports.verdict_act is the verdict''s id'; end if;
  if (select verdict_act from my_reports where report = r_none) is not null then raise exception 'an unanswered report has no verdict_act'; end if;
  perform tests.unbecome();
  perform tests.become(bob);
  if (select ruling_act from my_appeals where appeal = ap_inf) is distinct from ru_inf or (select ruling_act from my_appeals where appeal = ap_ban) is distinct from ru_ban
     or (select ruling_act from my_appeals where appeal = ap_mov) is distinct from ru_mov then raise exception 'my_appeals.ruling_act is the ruling''s id'; end if;
  if (select ruling_act from my_appeals where appeal = ap_open) is not null then raise exception 'an unheard appeal has no ruling_act'; end if;
  perform tests.unbecome();
  if (select count(*) from information_schema.columns where table_name = 'my_reports' and column_name = 'verdict_act') is distinct from 1::bigint then raise exception 'my_reports has verdict_act'; end if;
  -- The grants stay: signed-in players read them, visitors do not.
  if not has_table_privilege('authenticated', 'my_reports', 'select') or not has_table_privilege('authenticated', 'my_appeals', 'select')
     or has_table_privilege('anon', 'my_reports', 'select') or has_table_privilege('anon', 'my_appeals', 'select') then raise exception 'my_reports and my_appeals keep their grants'; end if;
end $$;

-- ---- 5. A veiled asker is the stand-in, named as acts_public shows it; a staff or an asker that has not debuted does not take the place away ----
-- A player reports their own post under a live author veil (post_veils, a card play that covers it): acts_public shows the report under the stand-in. The place must name the stand-in, never the owner's character.
do $$
declare
  ann uuid := tests.account('sv-ann');
  w uuid := tests.character(ann, 'Sv Wario');
  kassie uuid; stand uuid;
  t uuid := tests.thread('Sv thread'); p uuid := tests.post(w, t, 'My own post.');
  card uuid; r uuid; vd uuid; th uuid; got jsonb; shown uuid;
begin
  insert into characters (name, staff, staff_kind, debuted_at) values ('Sv Kassie', 'sv-kassie', 'persona', now()) returning id into kassie;
  select id into stand from characters where staff_kind = 'anonymous';
  if stand is null then insert into characters (name, staff, staff_kind, debuted_at) values ('Sv Anonymous', 'sv-anon', 'anonymous', now()) returning id into stand; end if;
  set local session_replication_role = replica;
  insert into acts (character, kind, thread, target_act_id, payload) values (w, 'card', t, p, '{"card": "sv-veil", "reach": "post"}') returning id into card;
  insert into post_veils (play, post, veil, author, ends_at, post_kind) values (card, p, 'author', w, now() + interval '1 day', 'post');
  set local session_replication_role = origin;
  perform set_config('kayfabb.report_writer', 'on', true); perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload) values (w, 'report', t, p, '{"reason": "a"}') returning id into r;
  insert into acts (character, kind, thread, target_act_id, payload) values (kassie, 'report_verdict', t, r, jsonb_build_object('report_act', r, 'verdict', 'dismissed', 'line', 'No.')) returning id into vd;
  perform set_config('kayfabb.report_writer', '', true); perform set_config('kayfabb.staff_writer', '', true);
  shown := (select "character" from acts_public where id = r);
  if shown is distinct from stand then raise exception 'the fixture: the veiled report shows as %, not the stand-in', shown; end if;
  th := (spin_written(vd, w, 'Spun veil', 'Discuss.', false, array[]::uuid[]) -> 'thread' ->> 'id')::uuid;
  got := (select origin_place -> 'asker' from thread_open where id = th);
  if got is distinct from jsonb_build_object('id', stand, 'name', (select name from characters where id = stand)) then raise exception 'a veiled asker is the stand-in with its name, not %', got; end if;
  -- An asker that has not debuted (not in characters_public) and the answer's staff keep the place.
  update characters set debuted_at = null where id = kassie;
  got := (select origin_place from thread_open where id = th);
  if got ->> 'kind' is distinct from 'answer' or got #>> '{staff,id}' is distinct from kassie::text or got #>> '{staff,name}' is distinct from 'Sv Kassie' then
    raise exception 'an answer by a staff character outside characters_public keeps its place and names it: %', got;
  end if;
end $$;

-- ---- 5b. A player's character that has not debuted has no public name: its ask draws no answer place, and its answer names no staff ----
do $$
declare
  ann uuid := tests.account('sg-ann'); bob uuid := tests.account('sg-bob');
  v uuid := tests.character(bob, 'Sg Victim');
  ghost uuid; kassie uuid; t uuid := tests.thread('Sg thread'); p uuid := tests.post(v, t, 'A post.');
  r uuid; vd uuid; th uuid; got jsonb;
begin
  insert into characters (owner, name, debuted_at) values (ann, 'Sg Ghost', now()) returning id into ghost;
  insert into characters (name, staff, staff_kind, debuted_at) values ('Sg Kassie', 'sg-kassie', 'persona', now()) returning id into kassie;
  perform set_config('kayfabb.report_writer', 'on', true); perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload) values (ghost, 'report', t, p, '{"reason": "a"}') returning id into r;
  insert into acts (character, kind, thread, target_act_id, payload) values (kassie, 'report_verdict', t, r, jsonb_build_object('report_act', r, 'verdict', 'dismissed', 'line', 'No.')) returning id into vd;
  perform set_config('kayfabb.report_writer', '', true); perform set_config('kayfabb.staff_writer', '', true);
  update characters set debuted_at = null where id = ghost;
  th := (spin_written(vd, v, 'Spun ghost', 'Discuss.', false, array[]::uuid[]) -> 'thread' ->> 'id')::uuid;
  got := (select origin_place from thread_open where id = th);
  if got is not null then raise exception 'an ask by a character that has not debuted draws no place: %', got; end if;
end $$;

-- ---- 6. The cost: a deep board page, half its threads spun from answers ----
-- Two boards of 5,000 threads each: one spun from posts alone, one with every other thread spun from a verdict. The page is the one the board reads (thread_list, by board, newest first), at offset
-- 2000, as 0298's cost section reads spin-at-post (the same ratio guard: the two boards are measured in one transaction under one plan).
-- MEASURED (2026-11-24, local Postgres 16): 2,267 ms on the posts-only board, 2,350 ms on the half-spun one, best of three; written in 0422's header.
do $$
declare
  ann uuid := tests.account('sc-ann'); a uuid := tests.character(ann, 'Sc Ann'); b uuid := tests.character(ann, 'Sc Bob');
  kassie uuid; t uuid := tests.thread('Sc Cost'); plain uuid; spun uuid;
  p uuid := tests.post(b, t, 'Cost post.', now() - interval '2 days');
  r uuid; vd uuid; plan jsonb; best_plain numeric := 1e9; best_spun numeric := 1e9;
begin
  insert into characters (name, staff, staff_kind, debuted_at) values ('Sc Kassie', 'sc-kassie', 'persona', now()) returning id into kassie;
  perform set_config('kayfabb.report_writer', 'on', true); perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload) values (a, 'report', t, p, '{"reason": "a"}') returning id into r;
  insert into acts (character, kind, thread, target_act_id, payload) values (kassie, 'report_verdict', t, r, jsonb_build_object('report_act', r, 'verdict', 'dismissed', 'line', 'No.')) returning id into vd;
  perform set_config('kayfabb.report_writer', '', true); perform set_config('kayfabb.staff_writer', '', true);
  insert into boards (slug, name) values ('sc-plain', 'Cost plain') returning id into plain;
  insert into boards (slug, name) values ('sc-spun', 'Cost spun') returning id into spun;
  set local session_replication_role = replica;
  with made as (
    insert into threads (board, title, origin_act_id, created_at, last_at, next_seq, origin_board)
    select bd, 'Cost ' || i, case when bd = spun and i % 2 = 0 then vd else p end, now() - make_interval(secs => i), now() - make_interval(secs => i), 2, bd
    from generate_series(1, 5000) i cross join (values (plain), (spun)) v(bd)
    returning id, origin_act_id)
  insert into acts (character, kind, thread, target_act_id, payload, seq, created_at)
  select a, 'spin', m.id, m.origin_act_id, jsonb_build_object('title', 'x', 'body', ''), 1, now() from made m;
  set local session_replication_role = origin;
  analyze threads; analyze acts;
  for i in 1..3 loop
    execute format('explain (analyze, format json) select * from thread_list where board = %L order by last_at desc offset 2000 limit 20', plain) into plan;
    best_plain := least(best_plain, (plan -> 0 ->> 'Execution Time')::numeric);
    execute format('explain (analyze, format json) select * from thread_list where board = %L order by last_at desc offset 2000 limit 20', spun) into plan;
    best_spun := least(best_spun, (plan -> 0 ->> 'Execution Time')::numeric);
  end loop;
  raise notice 'the deep page (offset 2000 of 5,000 threads) ran in % ms with every thread spun from a post and % ms with half spun from a verdict (best of three, in a transaction)', best_plain, best_spun;
  if best_spun > 3 * best_plain + 250 then raise exception 'the deep page took % ms against % ms for a board of plain spins; thread_open''s joins grew past a probe per skipped row', best_spun, best_plain; end if;
  if (select count(*) from thread_list where board = spun and origin_place ->> 'kind' = 'answer') is distinct from 2500::bigint then
    raise exception 'half the threads draw an answer place: %', (select count(*) from thread_list where board = spun and origin_place ->> 'kind' = 'answer');
  end if;
end $$;
