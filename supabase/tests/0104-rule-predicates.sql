-- Rules (supabase/migrations/0102_rules.sql; the Mod Bots design, section 4; its plan, Task 3): move offices, the predicate catalog, rules_now,
-- rule_conflict, the queue guard's refusal, rule_breaks, and the ruleSet stock line.
--
-- THE CHECK AND ITS POISON. `rule_breaks` has a branch for every row of `rule_predicates`, and raises `no check for predicate %` for a key with
-- none. Section 2 below walks the catalog as the database holds it and calls `rule_breaks` with a rule of each key in force, so a predicate
-- added to the catalog and not to the function fails there by name. Its poison is a planted catalog row with no branch: run this file with
--     PGOPTIONS='-c kayfabb.poison=noPoison'
-- and it plants `noPoison` before the walk, and must fail with `no check for predicate noPoison`. Without it the file passes.

-- ---- 1. The catalogs: offices on the kinds, the predicates, seeded by seed_instance ----
do $$
declare
  seed jsonb;
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true,
      'systemLines', jsonb_build_object(
        'moveLanded', jsonb_build_array('It is done: {move}.'),
        'ruleSet', jsonb_build_array('On {board}: {rule}.')),
      'systemMoveWords', jsonb_build_object('renameBoard', 'the renaming of a board to "{name}"', 'setRule', 'a rule')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'rp-boss',
      'staff', jsonb_build_array(jsonb_build_object('key', 'rp-boss', 'name', 'Rule Boss', 'title', 'Boss', 'signature', 'Hi')),
      'firstStaff', '[]'::jsonb,
      'moves', jsonb_build_array(
        jsonb_build_object('key', 'renameBoard', 'structural', true, 'shapesBoard', true, 'offices', jsonb_build_array('boss')),
        jsonb_build_object('key', 'setRule', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')),
      'predicates', jsonb_build_array(
        jsonb_build_object('key', 'minLength', 'param', 'count', 'least', 1, 'most', 200, 'plain', 'posts of at least {param} characters'),
        jsonb_build_object('key', 'maxLength', 'param', 'count', 'least', 20, 'most', 20000, 'plain', 'posts of at most {param} characters'),
        jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts'),
        jsonb_build_object('key', 'noDoublePost', 'param', 'none', 'least', null, 'most', null, 'plain', 'no double posting'),
        jsonb_build_object('key', 'noNecropost', 'param', 'count', 'least', 1, 'most', 365, 'plain', 'no replies to a thread quiet for more than {param} days'),
        jsonb_build_object('key', 'noDuplicateTitle', 'param', 'none', 'least', null, 'most', null, 'plain', 'no thread titled like a live one on the board'),
        jsonb_build_object('key', 'bannedWord', 'param', 'word', 'least', 1, 'most', 40, 'plain', 'the word "{param}" is banned'),
        jsonb_build_object('key', 'requiredWord', 'param', 'word', 'least', 1, 'most', 40, 'plain', 'every post says "{param}"'),
        jsonb_build_object('key', 'noTag', 'param', 'tag', 'least', null, 'most', null, 'plain', 'no [{param}] tags', 'tags', jsonb_build_array('b', 'i', 'u', 's', 'color', 'size', 'url', 'img', 'code', 'quote', 'list')),
        jsonb_build_object('key', 'repliesOnly', 'param', 'none', 'least', null, 'most', null, 'plain', 'replies only, no new threads'))));
  perform seed_instance(seed);
  perform seed_instance(seed);
  if (select offices from move_kinds where key = 'renameBoard') is distinct from array['boss'] then raise exception 'renameBoard is not the Boss''s alone: %', (select offices from move_kinds where key = 'renameBoard'); end if;
  if (select offices from move_kinds where key = 'setRule') is distinct from array['boss', 'mod'] then raise exception 'setRule is not the Boss''s and a Mod''s'; end if;
  if (select count(*) from rule_predicates) is distinct from 10 then raise exception 'the seed did not carry ten predicates (twice is once): %', (select count(*) from rule_predicates); end if;
  if (select param_kind || least || most from rule_predicates where key = 'minLength') is distinct from 'count1200' then raise exception 'minLength lost its kind or its bounds'; end if;
  if (select plain from rule_predicates where key = 'noDoublePost') is distinct from 'no double posting' then raise exception 'a predicate lost its words'; end if;
  if exists (select 1 from move_kinds where offices = '{}' or offices is null) then raise exception 'a move kind has no office'; end if;
  begin insert into move_kinds (key, structural, offices) values ('nobody', false, '{}'); raise exception 'a move kind with no office was seeded';
  exception when check_violation then null; end;
  begin insert into move_kinds (key, structural, offices) values ('deputy', false, '{deputy}'); raise exception 'a move kind with an unknown office was seeded';
  exception when check_violation then null; end;
  perform tests.account('rp-x');
  insert into admins (account) values (tests.account('rp-admin'));
  perform tests.account('rp-y');
end $$;

-- ---- helpers ----
create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

create function pg_temp.announcements() returns uuid language sql as $$
  select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements'
$$;

-- A setRule move in force, as the tick will have landed it, at the next moment (so landing order is the order of the calls).
create function pg_temp.rule(on_board uuid, predicate text, param jsonb default null, band text default 'minor', at timestamptz default clock_timestamp()) returns uuid language plpgsql as $$
declare written uuid;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  written := tests.act((select id from characters where staff = 'rp-boss'), 'move', pg_temp.announcements(),
    jsonb_build_object('kind', 'setRule', 'body', 'A rule.',
      'params', jsonb_build_object('board', on_board, 'predicate', predicate, 'param', param, 'band', band)),
    null, at);
  perform set_config('kayfabb.staff_writer', '', true);
  return written;
end $$;

create function pg_temp.board(slug text) returns uuid language sql as $$
  insert into boards (slug, name) values (slug, 'Board ' || slug) returning id
$$;

create function pg_temp.thread_on(b uuid, title text) returns uuid language sql as $$
  insert into threads (board, title) values (b, title) returning id
$$;

-- A post at the next moment.
create function pg_temp.say(who uuid, in_thread uuid, body text, at timestamptz default clock_timestamp()) returns uuid language sql as $$
  select tests.post(who, in_thread, body, at)
$$;

create function pg_temp.breaks(post uuid) returns integer language sql as $$
  select count(*)::integer from rule_breaks(post)
$$;

create function pg_temp.expect(label text, post uuid, want integer) returns void language plpgsql as $$
declare got integer := pg_temp.breaks(post);
begin
  if got is distinct from want then raise exception '%: expected % rule(s) broken, got % (%)', label, want, got, (select string_agg(predicate || coalesce(':' || param::text, ''), ', ') from rule_breaks(post)); end if;
end $$;

create function pg_temp.end_all() returns void language plpgsql as $$
declare m uuid;
begin
  for m in select move_act from open_moves loop perform end_move(m, 'expired', 'test'); end loop;
end $$;

-- ---- 2. THE CHECK: a rule of every catalog key, in force, and rule_breaks answers for each (it raises `no check for predicate %` for a key with no branch) ----
do $$
declare
  k record;
  b uuid := pg_temp.board('rp-walk');
  t uuid := pg_temp.thread_on(b, 'Walk');
  a uuid := tests.character(tests.account('rp-walker'), 'Rp Walker');
  post uuid := tests.post(a, t, 'A post to walk past every rule.');
begin
  if current_setting('kayfabb.poison', true) = 'noPoison' then
    insert into rule_predicates (key, param_kind, plain) values ('noPoison', 'none', 'a predicate with no branch');
  end if;
  for k in select key, param_kind from rule_predicates order by key loop
    perform pg_temp.rule(b, k.key, case k.param_kind when 'count' then to_jsonb(50) when 'word' then to_jsonb('zzz'::text) when 'tag' then to_jsonb('b'::text) end);
    perform rule_breaks(post);
    perform pg_temp.end_all();
  end loop;
  if (select count(*) from rule_predicates where key <> 'noPoison') is distinct from 10 then raise exception 'the walk did not see the catalog'; end if;
end $$;

-- ---- 3. Each key: a breaking post and a compliant post, one row and none ----
do $$
declare
  x uuid := tests.account('rp-pa');
  y uuid := tests.account('rp-pb');
  a uuid := tests.character(x, 'Rp A');
  c uuid := tests.character(y, 'Rp C');
  b uuid;
  t uuid;
  p uuid;
  p2 uuid;
begin
  -- minLength 10
  b := pg_temp.board('rp-min'); t := pg_temp.thread_on(b, 'Min'); perform pg_temp.rule(b, 'minLength', to_jsonb(10));
  perform pg_temp.expect('minLength: short', pg_temp.say(a, t, 'too short'), 1);
  perform pg_temp.expect('minLength: exactly the minimum', pg_temp.say(c, t, '0123456789'), 0);
  perform pg_temp.expect('minLength: long', pg_temp.say(a, t, 'plenty of words in this one'), 0);
  perform pg_temp.end_all();
  -- maxLength 20
  b := pg_temp.board('rp-max'); t := pg_temp.thread_on(b, 'Max'); perform pg_temp.rule(b, 'maxLength', to_jsonb(20));
  perform pg_temp.expect('maxLength: over', pg_temp.say(a, t, repeat('x', 21)), 1);
  perform pg_temp.expect('maxLength: exactly the maximum', pg_temp.say(c, t, repeat('x', 20)), 0);
  perform pg_temp.end_all();
  -- noAllCaps
  b := pg_temp.board('rp-caps'); t := pg_temp.thread_on(b, 'Caps'); perform pg_temp.rule(b, 'noAllCaps');
  perform pg_temp.expect('noAllCaps: shouting', pg_temp.say(a, t, 'THIS IS VERY LOUD INDEED'), 1);
  perform pg_temp.expect('noAllCaps: calm', pg_temp.say(c, t, 'This is a calm Sentence'), 0);
  perform pg_temp.expect('noAllCaps: the letters of tags do not count', pg_temp.say(a, t, '[B]quiet words[/B] [URL=http://x]here[/URL]'), 0);
  perform pg_temp.expect('noAllCaps: no letters at all', pg_temp.say(c, t, '1234 !!!'), 0);
  perform pg_temp.end_all();
  -- noDoublePost
  b := pg_temp.board('rp-double'); t := pg_temp.thread_on(b, 'Double'); perform pg_temp.rule(b, 'noDoublePost');
  perform pg_temp.expect('noDoublePost: the first post', pg_temp.say(a, t, 'one'), 0);
  perform pg_temp.expect('noDoublePost: another character replies', pg_temp.say(c, t, 'two'), 0);
  perform pg_temp.expect('noDoublePost: the first answers, not directly under itself', pg_temp.say(a, t, 'three'), 0);
  perform pg_temp.expect('noDoublePost: directly under itself', pg_temp.say(a, t, 'four'), 1);
  perform pg_temp.end_all();
  -- noNecropost 3 days
  b := pg_temp.board('rp-necro'); t := pg_temp.thread_on(b, 'Necro'); perform pg_temp.rule(b, 'noNecropost', to_jsonb(3));
  perform pg_temp.say(a, t, 'old', now() - interval '10 days');
  perform pg_temp.expect('noNecropost: a reply the next day', pg_temp.say(c, t, 'fresh', now() - interval '9 days'), 0);
  perform pg_temp.expect('noNecropost: a reply after nine days of quiet', pg_temp.say(a, t, 'dug up', now()), 1);
  perform pg_temp.expect('noNecropost: a reply right after', pg_temp.say(c, t, 'and again', now() + interval '1 hour'), 0);
  perform pg_temp.end_all();
  -- noDuplicateTitle
  b := pg_temp.board('rp-title'); perform pg_temp.rule(b, 'noDuplicateTitle');
  t := pg_temp.thread_on(b, 'The Same Title');
  perform pg_temp.expect('noDuplicateTitle: the first thread', pg_temp.say(a, t, 'opener'), 0);
  t := pg_temp.thread_on(b, '  the same TITLE ');
  p := pg_temp.say(c, t, 'opener');
  perform pg_temp.expect('noDuplicateTitle: a thread titled like a live one', p, 1);
  perform pg_temp.expect('noDuplicateTitle: a reply in that thread', pg_temp.say(a, t, 'reply'), 0);
  perform pg_temp.expect('noDuplicateTitle: a different title', pg_temp.say(a, pg_temp.thread_on(b, 'Another Title'), 'opener'), 0);
  perform pg_temp.expect('noDuplicateTitle: the same title on another board', pg_temp.say(a, pg_temp.thread_on(pg_temp.board('rp-title2'), 'The Same Title'), 'opener'), 0);
  perform pg_temp.end_all();
  -- bannedWord
  b := pg_temp.board('rp-banned'); t := pg_temp.thread_on(b, 'Banned'); perform pg_temp.rule(b, 'bannedWord', to_jsonb('toast'::text));
  perform pg_temp.expect('bannedWord: the word, any case', pg_temp.say(a, t, 'I love Toast!'), 1);
  perform pg_temp.expect('bannedWord: a longer word that contains it', pg_temp.say(c, t, 'a toaster is not toast'), 1);
  perform pg_temp.expect('bannedWord: only inside another word', pg_temp.say(c, t, 'toasty and toasted'), 0);
  perform pg_temp.expect('bannedWord: absent', pg_temp.say(a, t, 'bread'), 0);
  perform pg_temp.end_all();
  perform pg_temp.rule(b, 'bannedWord', to_jsonb('c++'::text));
  perform pg_temp.expect('bannedWord: a word of symbols is matched literally', pg_temp.say(c, t, 'I like c++ a lot'), 1);
  perform pg_temp.expect('bannedWord: and not as a pattern', pg_temp.say(a, t, 'I like cc a lot'), 0);
  perform pg_temp.end_all();
  -- requiredWord
  b := pg_temp.board('rp-required'); t := pg_temp.thread_on(b, 'Required'); perform pg_temp.rule(b, 'requiredWord', to_jsonb('please'::text));
  perform pg_temp.expect('requiredWord: left out', pg_temp.say(a, t, 'help me'), 1);
  perform pg_temp.expect('requiredWord: said, any case', pg_temp.say(c, t, 'Please help me'), 0);
  perform pg_temp.end_all();
  -- noTag
  b := pg_temp.board('rp-tag'); t := pg_temp.thread_on(b, 'Tag'); perform pg_temp.rule(b, 'noTag', to_jsonb('img'::text));
  perform pg_temp.expect('noTag: the tag', pg_temp.say(a, t, 'look [img]http://x/y.png[/img]'), 1);
  perform pg_temp.expect('noTag: the tag, any case, with an attribute', pg_temp.say(c, t, 'look [IMG=1]http://x/y.png[/IMG]'), 1);
  perform pg_temp.expect('noTag: another tag', pg_temp.say(a, t, '[b]bold[/b]'), 0);
  perform pg_temp.expect('noTag: a longer name', pg_temp.say(c, t, '[imgx]no[/imgx]'), 0);
  perform pg_temp.expect('noTag: the word in plain text', pg_temp.say(a, t, 'img is not a tag here'), 0);
  perform pg_temp.end_all();
  -- repliesOnly
  b := pg_temp.board('rp-replies'); perform pg_temp.rule(b, 'repliesOnly');
  t := pg_temp.thread_on(b, 'Replies');
  perform pg_temp.expect('repliesOnly: a new thread', pg_temp.say(a, t, 'opener'), 1);
  perform pg_temp.expect('repliesOnly: a reply', pg_temp.say(c, t, 'reply'), 0);
  -- a thread opened by a spin is a new thread too, and a rule reads it as it reads a post
  p := tests.act(a, 'spin', pg_temp.thread_on(b, 'Spun'), jsonb_build_object('title', 'Spun', 'body', 'from elsewhere'), (select id from acts limit 1));
  perform pg_temp.expect('repliesOnly: a thread spun from a post', p, 1);
  perform pg_temp.end_all();
  -- an Act that is no post breaks nothing
  if exists (select 1 from rule_breaks((select id from acts where kind = 'move' limit 1))) then raise exception 'a move Act broke a rule'; end if;
  if exists (select 1 from rule_breaks(gen_random_uuid())) then raise exception 'an Act that is not there broke a rule'; end if;
end $$;

-- ---- 4. A rule applies on its board, and an every-board rule on all; two rules at once; the mask test ----
do $$
declare
  x uuid := tests.account('rp-ma');
  y uuid := tests.account('rp-mb');
  m1 uuid := tests.character(x, 'Rp Mask One');
  m2 uuid := tests.character(x, 'Rp Mask Two');
  o uuid := tests.character(y, 'Rp Other');
  ba uuid := pg_temp.board('rp-scope-a');
  bb uuid := pg_temp.board('rp-scope-b');
  ta uuid := pg_temp.thread_on(ba, 'Scope A');
  tb uuid := pg_temp.thread_on(bb, 'Scope B');
  r1 uuid;
  r2 uuid;
begin
  perform pg_temp.rule(ba, 'minLength', to_jsonb(30));
  perform pg_temp.expect('a rule on board A: a short post on A', pg_temp.say(o, ta, 'short'), 1);
  perform pg_temp.expect('a rule on board A: a short post on B', pg_temp.say(o, tb, 'short'), 0);
  perform pg_temp.rule(null, 'minLength', to_jsonb(5));
  perform pg_temp.expect('an every-board rule: a post of 3 on B', pg_temp.say(o, tb, 'abc'), 1);
  perform pg_temp.expect('an every-board rule: a post of 10 on B', pg_temp.say(o, tb, 'abcdefghij'), 0);
  perform pg_temp.expect('both apply on A: a post of 3 breaks the two', pg_temp.say(o, ta, 'abc'), 2);
  perform pg_temp.expect('both apply on A: a post of 10 breaks the board''s', pg_temp.say(o, ta, 'abcdefghij'), 1);
  perform pg_temp.end_all();

  -- The mask test: noDoublePost compares characters, never accounts.
  perform pg_temp.rule(ba, 'noDoublePost');
  perform pg_temp.say(m1, ta, 'under the opener, first mask');
  perform pg_temp.expect('mask test: another mask of the same account replies directly under a post', pg_temp.say(m2, ta, 'second mask answers'), 0);
  perform pg_temp.expect('mask test: the first mask answers its own other mask''s post', pg_temp.say(m1, ta, 'first mask again'), 0);
  perform pg_temp.expect('mask test: the first mask directly under itself', pg_temp.say(m1, ta, 'first mask once more'), 1);
  perform pg_temp.expect('mask test: a stranger directly under it', pg_temp.say(o, ta, 'a stranger'), 0);
  perform pg_temp.end_all();
end $$;

-- ---- 5. rules_now: the numbering, the staff, the params; a rule that ends leaves, and the rest are numbered again ----
do $$
declare
  ba uuid := pg_temp.board('rp-num-a');
  bb uuid := pg_temp.board('rp-num-b');
  m1 uuid; m2 uuid; m3 uuid; h1 uuid; h2 uuid; n1 uuid;
  hbase integer := (select count(*) from acts where kind = 'move' and payload ->> 'kind' = 'setRule' and payload #>> '{params,board}' is null);
begin
  m1 := pg_temp.rule(ba, 'noAllCaps', null, 'minor');
  h1 := pg_temp.rule(null, 'noDoublePost', null, 'moderate');
  m2 := pg_temp.rule(ba, 'minLength', to_jsonb(12), 'severe');
  n1 := pg_temp.rule(bb, 'bannedWord', to_jsonb('toast'::text), 'minor');
  h2 := pg_temp.rule(null, 'noNecropost', to_jsonb(30), 'minor');
  if (select number from rules_now where move_act = m1) is distinct from 1 or (select number from rules_now where move_act = m2) is distinct from 2 then raise exception 'board A''s rules are not numbered 1, 2 in landing order'; end if;
  if (select number from rules_now where move_act = n1) is distinct from 1 then raise exception 'board B''s first rule is not number 1'; end if;
  if (select number from rules_now where move_act = h1) is distinct from hbase + 1 or (select number from rules_now where move_act = h2) is distinct from hbase + 2 then raise exception 'the every-board rules are not numbered on their own'; end if;
  if (select board from rules_now where move_act = h1) is not null then raise exception 'an every-board rule has a board'; end if;
  if (select staff from rules_now where move_act = m1) is distinct from 'rp-boss' then raise exception 'the rule does not name the staff member who made it'; end if;
  if (select (predicate, param, band) from rules_now where move_act = m2)::text is distinct from '(minLength,12,severe)' then raise exception 'rules_now read the params wrongly: %', (select (predicate, param, band) from rules_now where move_act = m2); end if;
  if (select param from rules_now where move_act = m1) is not null then raise exception 'a rule with no parameter has one: %', (select param from rules_now where move_act = m1); end if;
  perform end_move(m1, 'expired', 'test');
  if exists (select 1 from rules_now where move_act = m1) then raise exception 'an ended rule is still in force'; end if;
  if (select number from rules_now where move_act = m2) is distinct from 2 then raise exception 'an earlier rule ending renumbered board A''s remaining rule: %', (select number from rules_now where move_act = m2); end if;
  perform end_move(h1, 'expired', 'test');
  if (select number from rules_now where move_act = h2) is distinct from hbase + 2 then raise exception 'an ended house rule renumbered the next'; end if;
  m3 := pg_temp.rule(ba, 'noDoublePost');
  if (select number from rules_now where move_act = m3) is distinct from 3 then raise exception 'a new rule on board A is not number 3, after one that ended'; end if;
  if exists (select 1 from rules_now where move_act in (select id from acts where kind = 'move' and payload ->> 'kind' = 'renameBoard')) then raise exception 'a rename is a rule'; end if;
  perform pg_temp.end_all();
end $$;

-- ---- 6. rule_conflict: each pair, each way round, and what is not a conflict ----
do $$
declare
  ba uuid := pg_temp.board('rp-con-a');
  bb uuid := pg_temp.board('rp-con-b');
  got text;
  hit text;
begin
  -- a banned word and a required one
  perform pg_temp.rule(ba, 'bannedWord', to_jsonb('Toast'::text));
  got := rule_conflict(ba, 'requiredWord', to_jsonb('toast'::text));
  if got is null or got !~ 'Toast' then raise exception 'requiring a banned word was allowed: %', got; end if;
  if rule_conflict(ba, 'requiredWord', to_jsonb('jam'::text)) is not null then raise exception 'requiring another word conflicted'; end if;
  if rule_conflict(bb, 'requiredWord', to_jsonb('toast'::text)) is not null then raise exception 'a word banned on board A conflicted on board B'; end if;
  if rule_conflict(ba, 'bannedWord', to_jsonb('toast'::text)) is null then raise exception 'the same banned word in another case was allowed twice'; end if;
  if rule_conflict(null, 'requiredWord', to_jsonb('toast'::text)) is null then raise exception 'requiring on every board a word one board bans was allowed'; end if;
  perform pg_temp.end_all();
  perform pg_temp.rule(ba, 'requiredWord', to_jsonb('please'::text));
  if rule_conflict(ba, 'bannedWord', to_jsonb('PLEASE'::text)) is null then raise exception 'banning a required word was allowed'; end if;
  perform pg_temp.end_all();
  -- a minimum above a maximum, both ways round
  perform pg_temp.rule(ba, 'maxLength', to_jsonb(100));
  got := rule_conflict(ba, 'minLength', to_jsonb(101));
  if got is null or got !~ '100' or got !~ '101' then raise exception 'a minimum above the maximum was allowed: %', got; end if;
  if rule_conflict(ba, 'minLength', to_jsonb(100)) is not null then raise exception 'a minimum equal to the maximum conflicted'; end if;
  if rule_conflict(ba, 'minLength', to_jsonb(40)) is not null then raise exception 'a minimum under the maximum conflicted'; end if;
  perform pg_temp.end_all();
  perform pg_temp.rule(null, 'minLength', to_jsonb(60));
  if rule_conflict(bb, 'maxLength', to_jsonb(50)) is null then raise exception 'a maximum under an every-board minimum was allowed'; end if;
  if rule_conflict(bb, 'maxLength', to_jsonb(60)) is not null then raise exception 'a maximum equal to the minimum conflicted'; end if;
  perform pg_temp.end_all();
  -- the same rule twice
  perform pg_temp.rule(ba, 'minLength', to_jsonb(10));
  if rule_conflict(ba, 'minLength', to_jsonb(10)) is null then raise exception 'the same rule twice was allowed'; end if;
  if rule_conflict(ba, 'minLength', to_jsonb(11)) is not null then raise exception 'the same predicate with another parameter conflicted'; end if;
  if rule_conflict(bb, 'minLength', to_jsonb(10)) is not null then raise exception 'the same rule on another board conflicted'; end if;
  perform pg_temp.end_all();
  perform pg_temp.rule(ba, 'noAllCaps');
  if rule_conflict(ba, 'noAllCaps', null) is null or rule_conflict(ba, 'noAllCaps', 'null'::jsonb) is null then raise exception 'the same rule with no parameter twice was allowed'; end if;
  hit := rule_conflict(ba, 'noDoublePost', null);
  if hit is not null then raise exception 'two different rules with no parameter conflicted: %', hit; end if;
  if rule_conflict(null, 'noAllCaps', null) is not null then raise exception 'a house rule was refused as a copy of a board''s rule'; end if;
  perform pg_temp.rule(null, 'noAllCaps');
  if rule_conflict(bb, 'noAllCaps', null) is not null then raise exception 'a board''s rule was refused as a copy of a house rule'; end if;
  if rule_conflict(null, 'noAllCaps', null) is null then raise exception 'two house rules of the same predicate were allowed'; end if;
  perform pg_temp.end_all();
  if rule_conflict(ba, 'noAllCaps', null) is not null then raise exception 'a rule that ended still conflicts'; end if;
end $$;

-- ---- 7. The queue's guard refuses a rule that is malformed or leaves no compliant post, naming why; a good rule queues ----
create function pg_temp.queue_rule(params jsonb, staff text default 'rp-boss') returns bigint language plpgsql as $$
declare
  m bigint;
  q bigint;
begin
  insert into meetings (started_at, slot, finished_at, outcome) values (now(), clock_timestamp(), now(), 'ok') returning id into m;
  insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
  values (m, staff, 'setRule', params, null, 'because', now() - interval '1 minute', now() + interval '3 days', false) returning id into q;
  return q;
end $$;

do $$
declare
  ba uuid := pg_temp.board('rp-guard');
  got text;
  q bigint;
begin
  q := pg_temp.queue_rule(jsonb_build_object('board', ba, 'predicate', 'minLength', 'param', 10, 'band', 'minor'));
  if q is null then raise exception 'a good rule did not queue'; end if;
  got := pg_temp.refusal(format('select pg_temp.queue_rule(%L)', jsonb_build_object('board', ba, 'predicate', 'minLength', 'param', 10, 'band', 'minor')));
  if got is not null then raise exception 'a rule waiting twice was refused, but waiting rules are not in force and so conflict with nothing: %', got; end if;
  perform pg_temp.rule(ba, 'maxLength', to_jsonb(100));
  got := pg_temp.refusal(format('select pg_temp.queue_rule(%L)', jsonb_build_object('board', ba, 'predicate', 'minLength', 'param', 150, 'band', 'minor')));
  if got is null or got !~ '^23514: that rule would leave no post that follows the rules: .*100.*150' then raise exception 'a minimum above the maximum was queued, or the reason is not given: %', got; end if;
  perform pg_temp.end_all();
  got := pg_temp.refusal(format('select pg_temp.queue_rule(%L)', jsonb_build_object('board', ba, 'predicate', 'noPoison', 'band', 'minor')));
  if got is null or got !~ '^23514: a rule is malformed: there is no predicate "noPoison"' then raise exception 'an unknown predicate was queued: %', got; end if;
  got := pg_temp.refusal(format('select pg_temp.queue_rule(%L)', jsonb_build_object('board', ba, 'predicate', 'minLength', 'param', 0, 'band', 'minor')));
  if got is null or got !~ '^23514: a rule is malformed: minLength takes a whole number from 1 to 200' then raise exception 'a parameter under its bound was queued: %', got; end if;
  got := pg_temp.refusal(format('select pg_temp.queue_rule(%L)', jsonb_build_object('board', ba, 'predicate', 'minLength', 'param', 'ten', 'band', 'minor')));
  if got is null or got !~ 'a whole number' then raise exception 'a text parameter was queued: %', got; end if;
  got := pg_temp.refusal(format('select pg_temp.queue_rule(%L)', jsonb_build_object('board', ba, 'predicate', 'noAllCaps', 'param', 3, 'band', 'minor')));
  if got is null or got !~ 'takes no parameter' then raise exception 'a parameter on a predicate with none was queued: %', got; end if;
  got := pg_temp.refusal(format('select pg_temp.queue_rule(%L)', jsonb_build_object('board', ba, 'predicate', 'bannedWord', 'param', 'two words', 'band', 'minor')));
  if got is null or got !~ 'one word' then raise exception 'a word with a space was queued: %', got; end if;
  got := pg_temp.refusal(format('select pg_temp.queue_rule(%L)', jsonb_build_object('board', ba, 'predicate', 'noAllCaps', 'band', 'dire')));
  if got is null or got !~ 'the band is minor, moderate or severe' then raise exception 'an unknown band was queued: %', got; end if;
  got := pg_temp.refusal(format('select pg_temp.queue_rule(%L)', jsonb_build_object('board', gen_random_uuid(), 'predicate', 'noAllCaps', 'band', 'minor')));
  if got is null or got !~ 'no board' then raise exception 'a rule on no board was queued: %', got; end if;
  got := pg_temp.refusal(format('select pg_temp.queue_rule(%L)', jsonb_build_object('board', ba, 'predicate', 'noTag', 'param', 'blink', 'band', 'minor')));
  if got is null or got !~ 'a tag the BBCode parser knows' then raise exception 'a tag the parser does not know was queued: %', got; end if;
  got := pg_temp.refusal(format('select pg_temp.queue_rule(%L)', jsonb_build_object('board', ba, 'predicate', 'noTag', 'param', 'quote', 'band', 'minor')));
  if got is not null then raise exception 'a known tag was refused: %', got; end if;
  -- The board is stored in one form, lowercase, so numbering and indexes compare one.
  q := pg_temp.queue_rule(jsonb_build_object('board', upper(ba::text), 'predicate', 'noAllCaps', 'band', 'minor'));
  if (select params ->> 'board' from queued_moves where id = q) is distinct from ba::text then raise exception 'an uppercase board was stored as written: %', (select params ->> 'board' from queued_moves where id = q); end if;
  -- A rule carries an expiry, so none waits on an admin to end it.
  got := pg_temp.refusal(format($f$insert into queued_moves (meeting, staff, kind, params, why, go_live_at, expires_at, structural)
    values ((select max(id) from meetings), 'rp-boss', 'setRule', %L, 'because', now(), null, false)$f$, jsonb_build_object('board', ba, 'predicate', 'noAllCaps', 'band', 'minor')));
  if got is null or got !~ '^23514: a rule needs an expiry' then raise exception 'a rule with no expiry was queued: %', got; end if;
  got := pg_temp.refusal(format('select pg_temp.queue_rule(%L)', jsonb_build_object('board', null, 'predicate', 'noAllCaps', 'band', 'minor')));
  if got is not null then raise exception 'a rule on every board (a null board) was refused: %', got; end if;
end $$;

-- ---- 8. The tick lands a queued setRule as a small move, in its own stock line, numbered as it will be ----
do $$
declare
  ba uuid := pg_temp.board('rp-tick');
  q bigint;
  mv uuid;
  line text;
  house integer;
begin
  -- Whatever section 7 left waiting lands first, and ends, so the numbers below are of this section's rules alone.
  perform system_tick();
  perform pg_temp.end_all();
  -- The tick writes the move at the transaction's now(), so a rule in force before it is placed before now().
  perform pg_temp.rule(ba, 'noAllCaps', null, 'minor', now() - interval '1 minute');
  q := pg_temp.queue_rule(jsonb_build_object('board', ba, 'predicate', 'noDoublePost', 'band', 'moderate'));
  perform system_tick();
  mv := (select landed_act from queued_moves where id = q);
  if mv is null then raise exception 'the tick did not land the rule'; end if;
  line := (select payload ->> 'body' from acts where id = mv);
  if line is distinct from 'On Board rp-tick: Rule 2: no double posting.' then raise exception 'the landing line is "%"', line; end if;
  if (select number from rules_now where move_act = mv) is distinct from 2 then raise exception 'the landed rule is not numbered 2'; end if;
  perform pg_temp.end_all();
  q := pg_temp.queue_rule(jsonb_build_object('board', null, 'predicate', 'minLength', 'param', 25, 'band', 'minor'));
  house := (select count(*) from acts where kind = 'move' and payload ->> 'kind' = 'setRule' and payload #>> '{params,board}' is null) + 1;
  perform system_tick();
  mv := (select landed_act from queued_moves where id = q);
  line := (select payload ->> 'body' from acts where id = mv);
  if line is distinct from format('On every board: House Rule %s: posts of at least 25 characters.', house) then raise exception 'the house rule''s landing line is "%"', line; end if;
  -- A kind with no rule is said as ever.
  if system_line('moveLanded', 'renameBoard', jsonb_build_object('name', 'X'), 'rp-boss') is distinct from 'It is done: the renaming of a board to "X".' then raise exception 'a rename''s line changed'; end if;
  perform pg_temp.end_all();
end $$;

-- ---- 9. Two conflicting rules may both wait, but not both land: the tick rechecks at landing, and the one that cannot lands never does ----
do $$
declare
  ba uuid := pg_temp.board('rp-race');
  q1 bigint;
  q2 bigint;
  landed integer;
  got text;
begin
  perform system_tick();
  perform pg_temp.end_all();
  q1 := pg_temp.queue_rule(jsonb_build_object('board', ba, 'predicate', 'bannedWord', 'param', 'Toast', 'band', 'minor'));
  q2 := pg_temp.queue_rule(jsonb_build_object('board', ba, 'predicate', 'requiredWord', 'param', 'toast', 'band', 'minor'));
  perform system_tick();
  if (select landed_act is null from queued_moves where id = q1) then raise exception 'the first of two conflicting rules did not land'; end if;
  if (select landed_act is not null from queued_moves where id = q2) then raise exception 'both conflicting rules landed'; end if;
  if (select failure !~ 'bans the word' or failed_at is null from queued_moves where id = q2) then raise exception 'the refused rule carries no reason: %', (select failure from queued_moves where id = q2); end if;
  if (select count(*) from rules_now where board = ba) is distinct from 1 then raise exception 'two rules in force'; end if;
  -- A final refusal: a later tick does not try it again, and the reason stays as first written.
  perform pg_sleep(0.01);
  landed := (system_tick() ->> 'failed')::integer;
  if landed <> 0 then raise exception 'the tick tried the refused rule again (% failed)', landed; end if;

  -- The admin queue does not list the refused rule as waiting: it is with the ended, with its reason.
  perform tests.become((select id from auth.users where email = 'rp-admin@test.invalid'));
  if exists (select 1 from jsonb_array_elements(admin_queue() -> 'waiting') w where (w ->> 'id')::bigint = q2) then raise exception 'a refused rule is listed as waiting'; end if;
  if (select e ->> 'how' from jsonb_array_elements(admin_queue() -> 'ended') e where (e ->> 'id')::bigint = q2) is distinct from 'refused' then raise exception 'a refused rule is not listed as refused'; end if;
  if (select e ->> 'reason' from jsonb_array_elements(admin_queue() -> 'ended') e where (e ->> 'id')::bigint = q2) !~ 'bans the word' then raise exception 'a refused rule does not carry its reason'; end if;
  perform tests.unbecome();
  -- A refusal is final: it does not change once set.
  got := pg_temp.refusal(format('update queued_moves set refused_at = null, failed_at = null, failure = null where id = %s', q2));
  if got is null or got !~ '^23514' then raise exception 'a refusal was undone: %', got; end if;
  got := pg_temp.refusal(format($f$update queued_moves set failure = 'something else' where id = %s$f$, q2));
  if got is null or got !~ '^23514' then raise exception 'a refusal''s reason was changed: %', got; end if;
  perform pg_temp.end_all();
end $$;
