-- The thread lockout (supabase/migrations/0402_thread_lockout.sql; docs/plans/2026-11-21-so-very-happy-plan.md, Task 2; design docs/plans/2026-11-21-so-very-happy-design.md, section 3).
-- A Reversal with `outcome: {kind: lockout, hours}` lets a cast land and locks the caster's character out of the post's thread: the spring is `did: lockedOut` with `locks` (the character) and `until`, and
-- not_locked_out refuses that character's posts, plays and sets there until `until` or an admin's card_end on the spring. Other characters, other threads, edits, spins and reactions are untouched.
-- Cards, accounts and characters here are this file's own (lk...).

create function pg_temp.coded(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k, generate_series(1, 6)
$$;

create function pg_temp.spring_of(back uuid) returns jsonb language sql as $$
  select s.payload from acts s where s.kind = 'spring' and (s.payload ->> 'set') = back::text
$$;

create function pg_temp.spring_id(back uuid) returns uuid language sql as $$
  select s.id from acts s where s.kind = 'spring' and (s.payload ->> 'set') = back::text
$$;

-- The refusal's words for a character and the end the lockout has, as not_banned rounds it.
create function pg_temp.words(name text, until timestamptz) returns text language sql as $$
  select format('%s is locked out of this thread until %s UTC; the lockout ends by itself then, and it holds only this character, not your other characters',
    name, to_char(date_trunc('minute', until + interval '59.999999 seconds') at time zone 'UTC', 'YYYY-MM-DD HH24:MI'))
$$;

create function pg_temp.cards() returns void language plpgsql as $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts, gimmick, stack, replies) values
    ('lkback', 'Lk Back', 'pepperoni', 'rare', 'set', '{"trigger": {"on": "cast"}, "match": {"flavors": ["salty", "pepperoni"], "upTo": "rare"}, "outcome": {"kind": "lockout", "hours": 24}}', '{post}', null, null, 1, false),
    ('lksalty', 'Lk Salty', 'salty', 'common', 'cast', null, '{post}', null, null, 6, false),
    ('lksweet', 'Lk Sweet', 'sweet', 'common', 'cast', null, '{post}', null, null, 6, false),
    ('lkleg', 'Lk Legendary', 'salty', 'legendary', 'cast', null, '{post}', null, null, 6, false),
    ('lkpep', 'Lk Pepperoni', 'pepperoni', 'rare', 'cast', null, '{post}', null, null, 6, false),
    ('lkthread', 'Lk Thread Cast', 'salty', 'common', 'cast', null, '{thread}', interval '1 day', null, 6, false),
    ('lkchar', 'Lk Char Cast', 'salty', 'common', 'cast', null, '{character}', interval '1 day', null, 6, false),
    ('lkreply', 'Lk Reply', 'salty', 'common', 'cast', null, '{post}', null, null, 6, true)
  on conflict (key) do nothing;
end $$;

-- ---- The catalog: a lockout card passes card_kinds_problem, and each poison is refused in the engine's words ----
select tests.unbecome();
do $$
declare
  good constant jsonb := '{"key": "lkgood", "rarity": "rare", "play": "set", "reaches": ["post"], "trap": {"trigger": {"on": "cast"}, "match": {"flavors": ["salty", "pepperoni"], "upTo": "rare"}, "outcome": {"kind": "lockout", "hours": 24}}}';
  got text; why text;
begin
  got := card_kinds_problem(jsonb_build_array(good));
  if got is not null then raise exception 'a good lockout card was refused: %', got; end if;
  got := card_kinds_problem(jsonb_build_array(jsonb_set(good, '{trap,outcome,hours}', '1')));
  if got is not null then raise exception 'a lockout of 1 hour was refused: %', got; end if;
  got := card_kinds_problem(jsonb_build_array(jsonb_set(good, '{trap,outcome,hours}', '168')));
  if got is not null then raise exception 'a lockout of 168 hours was refused: %', got; end if;
  got := card_kinds_problem(jsonb_build_array(jsonb_set(good, '{trap,outcome,hours}', '0')));
  if got is distinct from 'card "lkgood" locks out for 0 hours; a lockout is a whole number of hours from 1 to 168' then raise exception 'hours 0: %', got; end if;
  got := card_kinds_problem(jsonb_build_array(jsonb_set(good, '{trap,outcome,hours}', '169')));
  if got is distinct from 'card "lkgood" locks out for 169 hours; a lockout is a whole number of hours from 1 to 168' then raise exception 'hours 169: %', got; end if;
  got := card_kinds_problem(jsonb_build_array(jsonb_set(good, '{trap,outcome,hours}', '1.5')));
  if got is distinct from 'card "lkgood" locks out for 1.5 hours; a lockout is a whole number of hours from 1 to 168' then raise exception 'hours 1.5: %', got; end if;
  got := card_kinds_problem(jsonb_build_array(jsonb_set(good, '{trap,outcome,hours}', '"24"')));
  if got is distinct from 'card "lkgood" locks out for "24" hours; a lockout is a whole number of hours from 1 to 168' then raise exception 'hours "24": %', got; end if;
  got := card_kinds_problem(jsonb_build_array(jsonb_set(good, '{trap,outcome,hours}', 'null')));
  if got is distinct from 'card "lkgood" locks out for null hours; a lockout is a whole number of hours from 1 to 168' then raise exception 'hours null: %', got; end if;
  got := card_kinds_problem(jsonb_build_array(jsonb_set(good, '{trap,outcome}', '{"kind": "lockout"}')));
  if got is distinct from 'card "lkgood" has a lockout outcome with no hours; a lockout is a whole number of hours from 1 to 168' then raise exception 'hours missing: %', got; end if;
  got := card_kinds_problem(jsonb_build_array(jsonb_set(good, '{trap,outcome}', '{"kind": "lockout", "hours": 24, "share": 1}')));
  if got is distinct from 'card "lkgood" has a lockout outcome with share; a lockout outcome has hours alone' then raise exception 'a share on a lockout: %', got; end if;
  got := card_kinds_problem(jsonb_build_array(jsonb_set(good, '{trap,outcome}', '{"kind": "lockout", "hours": 24, "every": true}')));
  if got is distinct from 'card "lkgood" has a lockout outcome with every; a lockout outcome has hours alone' then raise exception 'an every on a lockout: %', got; end if;
  got := card_kinds_problem(jsonb_build_array(jsonb_set(good, '{trap,outcome}', '{"kind": "lock", "hours": 24}')));
  if got is distinct from 'card "lkgood" has an outcome of kind "lock"; an outcome is ride, refund or lockout' then raise exception 'kind lock: %', got; end if;
  -- A lockout is a set card's on a cast, as any outcome is.
  got := card_kinds_problem(jsonb_build_array(jsonb_set(good, '{play}', '"cast"')));
  if got is null then raise exception 'a lockout outcome on a cast card was let through'; end if;

  -- The table's own constraint takes the kind and still refuses another.
  perform pg_temp.cards();
  if not exists (select 1 from card_kinds where key = 'lkback') then raise exception 'the lockout card was not let into the catalog'; end if;
  why := pg_temp.coded($q$insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, stack) values ('lkbad', 'Lk Bad', 'salty', 'rare', 'set', '{"trigger": {"on": "cast"}, "match": {"flavors": ["salty"], "upTo": "rare"}, "outcome": {"kind": "lock", "hours": 24}}', '{post}', 1)$q$);
  if why is null or why not like '23514%card_kinds_outcome_set%' then raise exception 'an outcome of kind lock was let in the catalog: %', why; end if;
end $$;

-- ---- acts_spring_payload: a lockedOut spring has locks and until, and only it does ----
do $$
declare
  ann uuid := tests.account('lk-c-ann'); a uuid := tests.character(ann, 'Lk C Ann');
  t uuid := tests.thread('Lk constraint'); p uuid := tests.post(a, t, 'Held.'); sset uuid; why text;
  ok constant text := $q$select tests.act(%L, 'spring', %L, %L::jsonb, %L)$q$;
begin
  sset := tests.act(a, 'set', t, '{}', p);
  why := pg_temp.coded(format(ok, a, t, jsonb_build_object('card', 'lkback', 'trigger', 'cast', 'did', 'lockedOut', 'set', tests.act(a, 'set', t, '{}', p)::text, 'locks', a::text, 'until', (now() + interval '1 day')::text), p));
  if why is not null then raise exception 'a lockedOut spring with locks and until was refused: %', why; end if;
  why := pg_temp.coded(format(ok, a, t, jsonb_build_object('card', 'lkback', 'trigger', 'cast', 'did', 'lockedOut', 'set', tests.act(a, 'set', t, '{}', p)::text, 'until', (now() + interval '1 day')::text), p));
  if why is null or why not like '23514%acts_spring_payload%' then raise exception 'a lockedOut spring with no locks was let in: %', why; end if;
  why := pg_temp.coded(format(ok, a, t, jsonb_build_object('card', 'lkback', 'trigger', 'cast', 'did', 'lockedOut', 'set', tests.act(a, 'set', t, '{}', p)::text, 'locks', a::text), p));
  if why is null or why not like '23514%acts_spring_payload%' then raise exception 'a lockedOut spring with no until was let in: %', why; end if;
  why := pg_temp.coded(format(ok, a, t, jsonb_build_object('card', 'lkback', 'trigger', 'cast', 'did', 'lockedOut', 'set', tests.act(a, 'set', t, '{}', p)::text, 'locks', 5, 'until', (now() + interval '1 day')::text), p));
  if why is null or why not like '23514%acts_spring_payload%' then raise exception 'a lockedOut spring whose locks is no string was let in: %', why; end if;
  why := pg_temp.coded(format(ok, a, t, jsonb_build_object('card', 'lkback', 'trigger', 'quote', 'did', 'lockedOut', 'set', tests.act(a, 'set', t, '{}', p)::text, 'locks', a::text, 'until', (now() + interval '1 day')::text), p));
  if why is null or why not like '23514%acts_spring_payload%' then raise exception 'a lockedOut spring on a quote was let in: %', why; end if;
  why := pg_temp.coded(format(ok, a, t, jsonb_build_object('card', 'lkback', 'trigger', 'cast', 'did', 'caught', 'caught', gen_random_uuid()::text, 'set', tests.act(a, 'set', t, '{}', p)::text, 'locks', a::text), p));
  if why is null or why not like '23514%acts_spring_payload%' then raise exception 'locks on a caught spring was let in: %', why; end if;
  why := pg_temp.coded(format(ok, a, t, jsonb_build_object('card', 'lkback', 'trigger', 'cast', 'did', 'rode', 'set', tests.act(a, 'set', t, '{}', p)::text, 'until', (now() + interval '1 day')::text), p));
  if why is null or why not like '23514%acts_spring_payload%' then raise exception 'until on a rode spring was let in: %', why; end if;
  -- The springs written before still pass.
  why := pg_temp.coded(format(ok, a, t, jsonb_build_object('card', 'lkback', 'trigger', 'cast', 'did', 'caught', 'caught', gen_random_uuid()::text, 'set', tests.act(a, 'set', t, '{}', p)::text), p));
  if why is not null then raise exception 'a caught spring was refused: %', why; end if;
  why := pg_temp.coded(format(ok, a, t, jsonb_build_object('card', 'lkback', 'trigger', 'cast', 'did', 'returned', 'set', tests.act(a, 'set', t, '{}', p)::text), p));
  if why is not null then raise exception 'a returned spring was refused: %', why; end if;
  why := pg_temp.coded(format(ok, a, t, jsonb_build_object('card', 'lkback', 'trigger', 'cast', 'did', 'rode', 'set', tests.act(a, 'set', t, '{}', p)::text, 'quadrant', 'calmPositive'), p));
  if why is not null then raise exception 'a rode spring was refused: %', why; end if;
  if lockout_ends(p) is not null then raise exception 'lockout_ends of a post is not null'; end if;
end $$;

-- ---- The lockout: a Salty Move on a lockout back lands and locks its character out of the thread ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('lk-ann'); bob uuid := tests.account('lk-bob'); carol uuid := tests.account('lk-carol'); dave uuid := tests.account('lk-dave');
  admin_acc uuid := tests.account('lk-admin');
  a uuid := tests.character(ann, 'Lk Ann'); b uuid := tests.character(bob, 'Lk Bob'); b2 uuid := tests.character(bob, 'Lk Bob Two');
  c uuid := tests.character(carol, 'Lk Carol'); d uuid := tests.character(dave, 'Lk Dave');
  staff uuid;
  t uuid := tests.thread('Lk thread'); t2 uuid := tests.thread('Lk other thread');
  p1 uuid := tests.post(a, t, 'The back.'); p2 uuid := tests.post(a, t, 'Another post.'); p3 uuid := tests.post(a, t, 'Sweet.'); p4 uuid := tests.post(a, t, 'Legendary.');
  p5 uuid := tests.post(a, t, 'Pepperoni.'); p6 uuid := tests.post(a, t, 'Reply.'); p7 uuid := tests.post(a, t, 'Staff.');
  bp1 uuid := tests.post(b, t, 'Bob earlier.'); bp2 uuid := tests.post(b, t, 'Bob earlier two.');
  back uuid; back3 uuid; back4 uuid; back5 uuid; back6 uuid; back7 uuid;
  r jsonb; cp jsonb; sp jsonb; sp_id uuid; why text; until_b timestamptz; page jsonb; person jsonb; sp_c uuid; end_id uuid;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'lkback');
  perform pg_temp.hand(bob, 'lksalty', 'lkthread', 'lkchar', 'lkback');
  perform pg_temp.hand(carol, 'lksweet', 'lkleg', 'lkpep', 'lksalty');
  perform pg_temp.hand(dave, 'lkreply', 'lksalty');
  insert into admins (account) values (admin_acc);
  perform tests.become_service();

  back := (set_card(ann, 'lkback', a, p1, '{}', 0) ->> 'id')::uuid;
  r := play_card(bob, 'lksalty', b, p1, '{}', 0, '');
  select x.payload into cp from acts x where x.id = (r ->> 'id')::uuid;
  sp := pg_temp.spring_of(back); sp_id := pg_temp.spring_id(back);
  if cp ? 'caught' or cp ->> 'layer' is null then raise exception 'the Move that springs a lockout did not land: %', cp; end if;
  if sp is null or sp ->> 'did' is distinct from 'lockedOut' or sp ->> 'locks' is distinct from b::text or sp ->> 'trigger' is distinct from 'cast' or sp ? 'caught' or sp ? 'quadrant' then
    raise exception 'the spring of a lockout back: %', sp;
  end if;
  if (sp ->> 'until')::timestamptz is distinct from (select x.created_at + interval '24 hours' from acts x where x.id = sp_id) then raise exception 'the lockout is not 24 hours long: %', sp; end if;
  if exists (select 1 from card_ledger where kind = 'caught' and act = sp_id) or exists (select 1 from card_ledger where act = (r ->> 'id')::uuid and kind <> 'played') then raise exception 'a lockout wrote a caught row'; end if;
  until_b := (sp ->> 'until')::timestamptz;
  -- The play names its spring, as a ride's names the set it rode, so the caster's alert and log line can read it on from the play.
  if cp ->> 'lockedOut' is distinct from sp_id::text then raise exception 'the landed play does not name its lockedOut spring: % (spring %)', cp, sp_id; end if;
  if locked_out_until(b, t) is distinct from until_b then raise exception 'locked_out_until: %', locked_out_until(b, t); end if;
  if lockout_ends(sp_id) is distinct from until_b then raise exception 'lockout_ends of the spring: %', lockout_ends(sp_id); end if;
  if locked_out_until(b, t2) is not null or locked_out_until(b2, t) is not null or locked_out_until(a, t) is not null then raise exception 'a lockout held another thread or character'; end if;

  -- ---- What it refuses: this character's posts, plays and sets in the thread ----
  perform tests.unbecome(); perform tests.become(bob);
  why := pg_temp.coded(format('select post(%L, %L, %L)', t, b, 'Posting while locked.'));
  if why is distinct from '55000 ' || pg_temp.words('Lk Bob', until_b) then raise exception 'post while locked out: %', why; end if;
  -- The refusal names the character and the time and nothing else: no account, no other character of the player's.
  if why like '%lk-bob%' or why like '%Lk Bob Two%' or why like '%' || bob::text || '%' then raise exception 'the refusal names more than the character and the time: %', why; end if;
  why := pg_temp.coded(format('select post(%L, %L, %L, %L)', t, b, 'Quoting while locked.', p2));
  if why is distinct from '55000 ' || pg_temp.words('Lk Bob', until_b) then raise exception 'a quoting post while locked out: %', why; end if;
  perform tests.unbecome(); perform tests.become_service();
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', bob, 'lksalty', b, p2, '{}', ''));
  if why is distinct from '55000 ' || pg_temp.words('Lk Bob', until_b) then raise exception 'a play on another post while locked out: %', why; end if;
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L)', bob, 'lkthread', b, t, '{}', '', 'thread'));
  if why is distinct from '55000 ' || pg_temp.words('Lk Bob', until_b) then raise exception 'a thread play while locked out: %', why; end if;
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', bob, 'lkchar', b, b, '{}', '', 'character', bp1));
  if why is distinct from '55000 ' || pg_temp.words('Lk Bob', until_b) then raise exception 'a character play from a post of the thread while locked out: %', why; end if;
  why := pg_temp.coded(format('select set_card(%L, %L, %L, %L, %L, 0)', bob, 'lkback', b, bp1, '{}'));
  if why is distinct from '55000 ' || pg_temp.words('Lk Bob', until_b) then raise exception 'a set on the locked character''s own post while locked out: %', why; end if;
  -- Nothing was written by a refused play: no card Act by b beyond the one that sprung it.
  if (select count(*) from acts where kind = 'card' and character = b) is distinct from 1::bigint then raise exception 'a refused play wrote an Act'; end if;
  -- The words are the same whoever asks: the owner's other character is refused for its own lockout only (it has none).
  perform tests.unbecome(); perform tests.become(bob);

  -- ---- What it leaves: edits, other threads, spins, reactions, and the owner's other character ----
  perform edit_post(bp1, b, 'Edited while locked.');
  perform post(t2, b, 'Quoting out of the locked thread.', p2);
  perform spin(p2, b, 'A spin off a locked thread', 'Body.');
  perform react(p2, b, 'wow');
  perform post(t, b2, 'The other mask posts.');
  perform tests.unbecome();

  -- ---- Which Moves spring it: not a Sweet one, not a legendary one; a Pepperoni rare does ----
  perform tests.become_service();
  back3 := (set_card(ann, 'lkback', a, p3, '{}', 0) ->> 'id')::uuid;
  r := play_card(carol, 'lksweet', c, p3, '{}', 0, '');
  if pg_temp.spring_of(back3) is not null then raise exception 'a Sweet Move sprang the lockout'; end if;
  back4 := (set_card(ann, 'lkback', a, p4, '{}', 0) ->> 'id')::uuid;
  r := play_card(carol, 'lkleg', c, p4, '{}', 0, '');
  if pg_temp.spring_of(back4) is not null then raise exception 'a legendary Salty Move sprang the lockout'; end if;
  if locked_out_until(c, t) is not null then raise exception 'a Move that sprang nothing locked someone out'; end if;
  back5 := (set_card(ann, 'lkback', a, p5, '{}', 0) ->> 'id')::uuid;
  r := play_card(carol, 'lkpep', c, p5, '{}', 0, '');
  sp := pg_temp.spring_of(back5); sp_c := pg_temp.spring_id(back5);
  if sp is null or sp ->> 'did' is distinct from 'lockedOut' or sp ->> 'locks' is distinct from c::text then raise exception 'a Pepperoni rare Move did not spring it: %', sp; end if;
  if locked_out_until(c, t) is null then raise exception 'the Pepperoni Move did not lock its caster out'; end if;

  -- ---- A Move that carries a reply springs the lockout and still writes its reply ----
  back6 := (set_card(ann, 'lkback', a, p6, '{}', 0) ->> 'id')::uuid;
  perform pg_temp.hand(ann, 'lkback');
  r := play_card(dave, 'lkreply', d, p6, '{}', 0, '', 'post', null, null, null, 'The reply it carries.');
  sp := pg_temp.spring_of(back6);
  if sp is null or sp ->> 'did' is distinct from 'lockedOut' or sp ->> 'locks' is distinct from d::text then raise exception 'a Move with a reply did not spring it: %', sp; end if;
  if r -> 'under' is null or not exists (select 1 from acts x where x.id = (r -> 'under' -> 'act' ->> 'id')::uuid and x.kind = 'post' and x.character = d and x.payload ->> 'body' = 'The reply it carries.') then
    raise exception 'the sprung Move did not write its reply: %', r;
  end if;
  if locked_out_until(d, t) is null then raise exception 'the replying Move did not lock its caster out'; end if;

  -- ---- A staff persona is locked out as a player is, and its post is then refused ----
  insert into characters (name, staff, staff_kind, debuted_at) values ('Lk Staff', 'lk-staff', 'persona', now()) returning id into staff;
  insert into settings (key, value) values ('pool', '{"weekly": 20, "holdback": 0.2, "threadsWeekly": 1, "cardRarityMost": "uncommon", "priorityDays": 28, "notesRead": 12, "chatterThreadPosts": 8, "strengths": {"named": 5, "quoted": 5, "legacy": 5, "successorStumbles": 5, "oldFlame": 5, "homeTurf": 2, "seasonTurn": 2, "hotOnBeat": 2}, "sessions": {"perDay": 3, "minutes": {"least": 20, "most": 60}, "waking": {"from": 13, "to": 5}}, "turns": {"waitHours": 48, "perThread": 2, "perSession": 4, "perDay": 60}, "chatterCron": "37 17 * * *"}') on conflict (key) do update set value = excluded.value;
  back7 := (set_card(ann, 'lkback', a, p7, '{}', 0) ->> 'id')::uuid;
  r := staff_play_card('lk-staff', 'lksalty', p7);
  sp := pg_temp.spring_of(back7);
  if sp is null or sp ->> 'did' is distinct from 'lockedOut' or sp ->> 'locks' is distinct from staff::text then raise exception 'a staff Move did not spring the lockout: %', sp; end if;
  select x.payload into cp from acts x where x.id = (r ->> 'id')::uuid;
  if cp ? 'caught' or cp ->> 'layer' is null then raise exception 'a staff Move on a lockout back did not land: %', cp; end if;
  why := pg_temp.coded(format('select write_staff_act(%L, %L, %L, null, %L::jsonb)', 'lk-staff', 'post', t, '{"body": "A pool post while locked."}'));
  if why is null or why not like '55000 Lk Staff is locked out of this thread until %' then raise exception 'a locked-out persona''s post: %', why; end if;
  -- A staff spin is not asked.
  r := write_staff_act('lk-staff', 'spin', t, p2, '{"title": "A staff spin", "body": "x"}');

  -- ---- pool_context lists the persona's lockout: staff is its character id, as the `characters` map's values are, and thread the thread id ----
  if pool_context() -> 'characters' ->> 'lk-staff' is distinct from staff::text then raise exception 'pool_context characters: %', pool_context() -> 'characters'; end if;
  if not (pool_context() -> 'lockouts') @> jsonb_build_array(jsonb_build_object('staff', staff::text, 'thread', t::text)) then raise exception 'pool_context lockouts: %', pool_context() -> 'lockouts'; end if;
  if exists (select 1 from jsonb_array_elements(pool_context() -> 'lockouts') l where l ->> 'staff' is distinct from staff::text) then raise exception 'pool_context lists a player''s lockout: %', pool_context() -> 'lockouts'; end if;
  perform tests.unbecome();

  -- ---- The reads: thread_page's people and my_characters ----
  perform tests.become(carol);
  page := thread_page(t, 1, null, null, array[]::text[]);
  person := (select pe from jsonb_array_elements(page -> 'people') pe where pe -> 'character' ->> 'id' = b::text);
  if (person -> 'character' ->> 'locked_until')::timestamptz is distinct from until_b then raise exception 'thread_page does not carry the lockout: %', person -> 'character'; end if;
  person := (select pe from jsonb_array_elements(page -> 'people') pe where pe -> 'character' ->> 'id' = b2::text);
  if jsonb_typeof(person -> 'character' -> 'locked_until') is distinct from 'null' then raise exception 'thread_page locks the other character: %', person -> 'character'; end if;
  perform tests.unbecome();
  perform tests.become(bob);
  if (select jsonb_array_length(m.lockouts) from my_characters m where m.id = b) is distinct from 1
     or (select m.lockouts -> 0 ->> 'thread' from my_characters m where m.id = b) is distinct from t::text
     or (select (m.lockouts -> 0 ->> 'until')::timestamptz from my_characters m where m.id = b) is distinct from until_b then
    raise exception 'my_characters lockouts: %', (select m.lockouts from my_characters m where m.id = b);
  end if;
  if (select m.lockouts from my_characters m where m.id = b2) is distinct from '[]'::jsonb then raise exception 'the other character lists a lockout'; end if;
  perform tests.unbecome();
  perform tests.become(ann);
  if exists (select 1 from my_characters m where m.id = b) then raise exception 'the setter''s player reads the locked character''s row'; end if;
  perform tests.unbecome();

  -- ---- Two lockouts on one character in one thread overlap, and the later end holds ----
  perform tests.act(a, 'spring', t, jsonb_build_object('card', 'lkback', 'trigger', 'cast', 'did', 'lockedOut', 'set', tests.act(a, 'set', t, '{}', p6)::text, 'locks', d::text, 'until', (now() + interval '72 hours')::text), p6);
  if locked_out_until(d, t) is distinct from now() + interval '72 hours' then raise exception 'the later end did not hold: %', locked_out_until(d, t); end if;

  -- ---- An admin ends it: reverse_card takes the spring ----
  perform tests.become(carol);
  why := pg_temp.coded(format('select reverse_card(%L)', sp_id));
  perform tests.unbecome();
  if why is null or why not like '42501%' then raise exception 'a non-admin ended a lockout: %', why; end if;
  if locked_out_until(b, t) is null then raise exception 'a refused end ended the lockout'; end if;
  perform tests.become(admin_acc);
  r := reverse_card(sp_id);
  perform tests.unbecome();
  end_id := (r ->> 'id')::uuid;
  if r ->> 'kind' is distinct from 'card_end' or (r ->> 'target_act_id')::uuid is distinct from sp_id or (r -> 'payload') is distinct from '{"why": "reversed", "by": "admin"}'::jsonb then raise exception 'the end of a lockout: %', r; end if;
  if locked_out_until(b, t) is not null then raise exception 'locked_out_until is not null after the end'; end if;
  if lockout_ends(sp_id) is distinct from (select created_at from acts where id = (r ->> 'id')::uuid) then raise exception 'lockout_ends after the end: %', lockout_ends(sp_id); end if;
  perform tests.become(bob);
  perform post(t, b, 'Back in the thread.');
  perform tests.unbecome();
  perform tests.become(admin_acc);
  why := pg_temp.coded(format('select reverse_card(%L)', sp_id));
  perform tests.unbecome();
  if why is null or why not like '55000 an admin has already ended that card%' then raise exception 'a second end: %', why; end if;
  -- The setter's alert reads on: one cardEnded alert, to the setter's player, about the card_end. The locked character's player is now told too, as
  -- cardEnded/onYours about the same card_end (docs/plans/2026-11-23-rulings-and-missing-alerts-design.md, section 3, "a lockout that held your character",
  -- which revises this file's "the locked character's player is told nothing (design 3.4)"). Exactly those two, and nobody else.
  if (select count(*) from alerts where kind = 'cardEnded' and act = end_id) is distinct from 2::bigint
     or not exists (select 1 from alerts where kind = 'cardEnded' and act = end_id and account = ann and character = a and sub is null)
     or not exists (select 1 from alerts where kind = 'cardEnded' and act = end_id and account = bob and character = b and sub = 'onYours') then
    raise exception 'the setter''s cardEnded alert and the locked character''s onYours: %', (select jsonb_agg(to_jsonb(x)) from alerts x where x.act = end_id);
  end if;
  if exists (select 1 from alerts where kind = 'cardEnded' and account = bob and act is distinct from end_id) then raise exception 'the locked character''s player was alerted of another end'; end if;
  -- The log's ended source (my_cards_ended) carries the end to the setter's player ('cast') and the locked character's player ('onMine'), and to nobody else.
  perform tests.become(ann);
  if (select count(*) from my_cards_ended where card_end = end_id and play = sp_id and side = 'cast' and character = a) is distinct from 1::bigint then raise exception 'the setter''s log does not carry the end of the lockout'; end if;
  perform tests.unbecome(); perform tests.become(bob);
  if (select count(*) from my_cards_ended where card_end = end_id and play = sp_id and side = 'onMine' and character = b) is distinct from 1::bigint then raise exception 'the locked character''s log does not carry the end of the lockout'; end if;
  if exists (select 1 from my_cards_ended where character = b2) then raise exception 'the locked player''s other character reads the end'; end if;
  perform tests.unbecome(); perform tests.become(carol);
  if exists (select 1 from my_cards_ended where card_end = end_id) then raise exception 'a third player reads the end of a lockout'; end if;
  perform tests.unbecome();
  page := null;
  perform tests.become(carol);
  page := thread_page(t, 1, null, null, array[]::text[]);
  person := (select pe from jsonb_array_elements(page -> 'people') pe where pe -> 'character' ->> 'id' = b::text);
  if jsonb_typeof(person -> 'character' -> 'locked_until') is distinct from 'null' then raise exception 'thread_page still shows the ended lockout: %', person -> 'character'; end if;
  perform tests.unbecome();
  -- A caught spring and a post are still no card play.
  declare caught_set uuid := tests.act(a, 'set', t, '{}', p2); caught_sp uuid;
  begin
    caught_sp := tests.act(a, 'spring', t, jsonb_build_object('card', 'lkback', 'trigger', 'cast', 'did', 'caught', 'caught', gen_random_uuid()::text, 'set', caught_set::text), p2);
    perform tests.become(admin_acc);
    why := pg_temp.coded(format('select reverse_card(%L)', caught_sp));
    perform tests.unbecome();
    if why is null or why not like 'P0002 that is not a card play%' then raise exception 'a caught spring was ended: %', why; end if;
    perform tests.become(admin_acc);
    why := pg_temp.coded(format('select reverse_card(%L)', p2));
    perform tests.unbecome();
    if why is null or why not like 'P0002 that is not a card play%' then raise exception 'a post was ended: %', why; end if;
  end;

  -- ---- Time travel past `until`: the lockout is over by itself, and an admin's end says it has worn off ----
  alter table acts disable trigger acts_no_update;
  update acts set payload = jsonb_set(payload, '{until}', to_jsonb((now() - interval '1 minute')::text)) where id = sp_c;
  alter table acts enable trigger acts_no_update;
  if locked_out_until(c, t) is not null then raise exception 'locked_out_until is not null once the lockout has passed'; end if;
  perform tests.become(carol);
  perform post(t, c, 'Carol posts after it passed.');
  perform tests.unbecome();
  perform tests.become(admin_acc);
  why := pg_temp.coded(format('select reverse_card(%L)', sp_c));
  perform tests.unbecome();
  if why is null or why not like '55000 that card has already worn off%' then raise exception 'ending a worn-off lockout: %', why; end if;
end $$;

-- ---- A busy instance: locked_out_until reads acts_lockout_by, one index probe ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('lk-big-ann'); a uuid := tests.character(ann, 'Lk Big Ann');
  big uuid := tests.thread('Lk big'); t uuid := tests.thread('Lk big target');
  plan text; line text; src text;
begin
  insert into acts (character, kind, thread, payload) select a, 'post', big, jsonb_build_object('body', 'filler ' || g) from generate_series(1, 4000) g;
  -- Filler springs of other characters in other threads (written with the triggers off: they are bulk, not play), so the index has company to be chosen over.
  set local session_replication_role = replica;
  insert into acts (character, kind, thread, target_act_id, payload)
    select a, 'spring', big, (select x.id from acts x where x.thread = big limit 1), jsonb_build_object('card', 'lkback', 'trigger', 'cast', 'did', 'lockedOut', 'set', gen_random_uuid()::text, 'locks', gen_random_uuid()::text, 'until', (now() + interval '1 day')::text)
    from generate_series(1, 400);
  set local session_replication_role = origin;
  set local session_replication_role = replica;
  insert into acts (character, kind, thread, target_act_id, payload) values (a, 'spring', t, (select x.id from acts x where x.thread = big limit 1), jsonb_build_object('card', 'lkback', 'trigger', 'cast', 'did', 'lockedOut', 'set', gen_random_uuid()::text, 'locks', a::text, 'until', (now() + interval '1 day')::text));
  set local session_replication_role = origin;
  analyze acts;
  select prosrc into src from pg_proc where proname = 'locked_out_until';
  if src not like '%kind = ''spring''%' or src not like '%payload ->> ''did'' = ''lockedOut''%' or src not like '%payload ->> ''locks'' = who::text%' or src not like '%thread = in_thread%' then
    raise exception 'locked_out_until does not ask the predicate acts_lockout_by holds: %', src;
  end if;
  plan := '';
  for line in execute format($q$explain (costs off) select max(e.ends) from acts s cross join lateral (select lockout_ends(s.id) as ends) e
      where s.kind = 'spring' and s.payload ->> 'did' = 'lockedOut' and s.thread = %L and s.payload ->> 'locks' = %L and e.ends > now()$q$, big, gen_random_uuid()::text) loop
    plan := plan || line || E'\n';
  end loop;
  if plan not like '%acts_lockout_by%' then raise exception 'the lockout probe does not use acts_lockout_by: %', plan; end if;
  if locked_out_until(a, t) is null then raise exception 'locked_out_until missed a lockout among filler'; end if;
  -- my_characters and pool_context ask for a character's lockouts across threads, by `locks` alone: the same index, led by `locks`, serves them.
  plan := '';
  for line in execute format($q$explain (costs off) select s.thread, lockout_ends(s.id) from acts s
      where s.kind = 'spring' and s.payload ->> 'did' = 'lockedOut' and s.payload ->> 'locks' = %L and (s.payload ->> 'until')::timestamptz > now()$q$, a::text) loop
    plan := plan || line || E'\n';
  end loop;
  if plan not like '%acts_lockout_by%' then raise exception 'the locks-only lockout read does not use acts_lockout_by: %', plan; end if;
  select prosrc into src from pg_proc where proname = 'pool_context';
  if src not like '%payload ->> ''locks'' = c.id::text and (s.payload ->> ''until'')::timestamptz > now()%' then raise exception 'pool_context does not filter the cheap until before lockout_ends'; end if;
  if pg_get_viewdef('my_characters'::regclass) not like '%((s.payload ->> ''until''::text))::timestamp with time zone > now()%' then raise exception 'my_characters does not filter the cheap until before lockout_ends: %', pg_get_viewdef('my_characters'::regclass); end if;
  -- post() asks not_locked_out again once lock_for_quote has returned: a reply quoting the post a lockout sprang on waits on its row lock, and the spring is committed when it gets it.
  select prosrc into src from pg_proc where proname = 'post' and pronargs = 6;
  if src not like '%lock_for_quote(through, in_thread, quoting);%not_locked_out(through, in_thread)%' then raise exception 'post() does not ask not_locked_out again after lock_for_quote'; end if;
end $$;

create function pg_temp.entry_of(input jsonb, id uuid) returns jsonb language sql as $$
  select e from jsonb_array_elements(input -> 'acts') e where e ->> 'id' = id::text
$$;
create function pg_temp.reacted_to(input jsonb, act uuid) returns integer language sql as $$
  select count(*)::integer from jsonb_array_elements(input -> 'reactions') e where e ->> 'act' = act::text
$$;

-- ---- An admin's end of a lockout takes the setter's spring, and the reactions to it, out of the scoring window, as an ended card play does (issue #942) ----
-- settlement_input and estimate_input both build `ended` from every card_end by its target: the spring is the target here, so nothing in either is special to a card play. The Move that sprang it is not ended.
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('lk-w-ann'); bob uuid := tests.account('lk-w-bob'); carol uuid := tests.account('lk-w-carol'); admin_acc uuid := tests.account('lk-w-admin');
  a uuid := tests.character(ann, 'Lk W Ann'); b uuid := tests.character(bob, 'Lk W Bob'); c uuid := tests.character(carol, 'Lk W Carol');
  t uuid := tests.thread('Lk window thread'); p uuid := tests.post(a, t, 'The back, in a window.');
  w0 timestamptz := now() - interval '1 day'; w1 timestamptz := now() + interval '1 hour';
  back uuid; r jsonb; move uuid; spring uuid; input jsonb; est jsonb;
begin
  -- estimate_input's window starts at the last settled end, and an earlier file's race (0007) commits a settlement in 2027 through dblink, past
  -- this window: moved a century back inside this file's rollback, as 0077 does, so the estimate's window holds now.
  update settlements set starts_at = starts_at - interval '100 years', ends_at = ends_at - interval '100 years';
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'lkback');
  perform pg_temp.hand(bob, 'lksalty');
  insert into admins (account) values (admin_acc);
  perform tests.become_service();
  back := (set_card(ann, 'lkback', a, p, '{}', 0) ->> 'id')::uuid;
  r := play_card(bob, 'lksalty', b, p, '{}', 0, '');
  move := (r ->> 'id')::uuid;
  spring := pg_temp.spring_id(back);
  if spring is null then raise exception 'the window test''s lockout did not spring'; end if;
  insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values
    (spring, c, carol, 'up', 1, now()), (move, c, carol, 'up', 1, now());
  -- (a) Control: the lockout stands, so the spring, its reaction, the Move and its reaction are all in the window's input and in the setter's estimate.
  input := settlement_input(w0, w1);
  if pg_temp.entry_of(input, spring) is null then raise exception 'control: the spring of a standing lockout is not in settlement_input'; end if;
  if pg_temp.reacted_to(input, spring) is distinct from 1 then raise exception 'control: the reaction to a standing lockout''s spring is not in settlement_input: %', input -> 'reactions'; end if;
  est := estimate_input(ann, w1);
  if pg_temp.entry_of(est, spring) is null then raise exception 'control: the spring of a standing lockout is not in the setter''s estimate_input'; end if;
  if pg_temp.reacted_to(est, spring) is distinct from 1 then raise exception 'control: the reaction to a standing lockout''s spring is not in estimate_input: %', est -> 'reactions'; end if;

  -- (b) An admin ends the lockout: a card_end whose target is the spring.
  perform tests.become(admin_acc);
  perform reverse_card(spring);
  perform tests.unbecome(); perform tests.become_service();
  if not exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = spring) then raise exception 'reverse_card on the spring wrote no card_end'; end if;
  input := settlement_input(w0, w1);
  if pg_temp.entry_of(input, spring) is not null then raise exception 'an admin-ended lockout''s spring is still in settlement_input'; end if;
  if pg_temp.reacted_to(input, spring) <> 0 then raise exception 'a reaction to an admin-ended lockout''s spring is still in settlement_input: %', input -> 'reactions'; end if;
  -- (d) The Move that sprang it is not ended: it and its reaction stay.
  if pg_temp.entry_of(input, move) is null then raise exception 'the Move that sprang an ended lockout left settlement_input'; end if;
  if pg_temp.reacted_to(input, move) is distinct from 1 then raise exception 'the reaction to the Move that sprang an ended lockout left settlement_input'; end if;
  -- (c) The setter's estimate reads the same ended set.
  est := estimate_input(ann, w1);
  if pg_temp.entry_of(est, spring) is not null then raise exception 'an admin-ended lockout''s spring is still in estimate_input'; end if;
  if pg_temp.reacted_to(est, spring) <> 0 then raise exception 'a reaction to an admin-ended lockout''s spring is still in estimate_input: %', est -> 'reactions'; end if;
end $$;
