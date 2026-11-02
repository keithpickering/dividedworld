-- Hints (supabase/migrations/0065_hints.sql; the alerts design's section 5, the plan's Task 12): act_window_counts reads an Act's public
-- reaction counts by quadrant inside a window, and fire_hint writes the hint alert for the Act's own player, once per Act and pattern,
-- and for no one else. The service calls both after a reaction; no API role can. A hint's recipient and content are computed from the
-- Act and a pattern the engine named from public counts, never from who reacted.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- One reaction from a fresh player's fresh mask (a reactor is private, so each is its own), landed at `at`.
create function pg_temp.reaction(on_act uuid, kind text, at timestamptz default now()) returns void language plpgsql as $$
declare
  who uuid := tests.account('hn-r' || gen_random_uuid()::text);
  mask uuid := tests.character(who, 'Hn R' || substr(gen_random_uuid()::text, 1, 8));
begin
  insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values (on_act, mask, who, kind, 1, at);
end $$;

-- ---- The objects are there, and closed to the API roles ----
do $$
begin
  if to_regclass('public.hints_fired') is null then raise exception 'hints: there is no hints_fired table'; end if;
  if to_regprocedure('fire_hint(uuid,text)') is null then raise exception 'hints: there is no fire_hint'; end if;
  if to_regprocedure('act_window_counts(uuid,timestamptz)') is null then raise exception 'hints: there is no act_window_counts'; end if;
  if (select string_agg(attname, ',' order by attnum) from pg_attribute where attrelid = 'public.hints_fired'::regclass and attnum > 0 and not attisdropped)
     is distinct from 'act,pattern,at' then
    raise exception 'hints: hints_fired holds something besides the Act, the pattern and the time';
  end if;
  if exists (select 1 from pg_publication_tables where tablename = 'hints_fired') then raise exception 'hints: the table is in a publication'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.hints_fired'::regclass) then raise exception 'hints: hints_fired has no row-level security'; end if;
  if has_table_privilege('authenticated', 'public.hints_fired', 'select,insert,update,delete') or has_table_privilege('anon', 'public.hints_fired', 'select,insert,update,delete') then
    raise exception 'hints: an API role reaches hints_fired';
  end if;
  if has_function_privilege('anon', 'fire_hint(uuid,text)', 'execute') or has_function_privilege('authenticated', 'fire_hint(uuid,text)', 'execute')
     or has_function_privilege('anon', 'act_window_counts(uuid,timestamptz)', 'execute') or has_function_privilege('authenticated', 'act_window_counts(uuid,timestamptz)', 'execute') then
    raise exception 'hints: an API role can execute fire_hint or act_window_counts';
  end if;
  if not has_function_privilege('service_role', 'fire_hint(uuid,text)', 'execute') or not has_function_privilege('service_role', 'act_window_counts(uuid,timestamptz)', 'execute') then
    raise exception 'hints: the service cannot execute fire_hint or act_window_counts';
  end if;
end $$;

-- ---- act_window_counts: the window, the quadrants, and nothing private ----
do $$
declare
  ann uuid := tests.account('hn-ann'); bob uuid := tests.account('hn-bob');
  a1 uuid := tests.character(ann, 'Hn Ann One'); b1 uuid := tests.character(bob, 'Hn Bob One');
  t uuid := tests.thread('Hn counts'); p uuid; empty uuid; play uuid; thread_play uuid; got jsonb;
  since timestamptz := now() - interval '6 hours';
begin
  p := tests.post(a1, t, 'Counted.');
  empty := tests.post(a1, t, 'Never reacted to.');
  perform pg_temp.reaction(p, 'up', since);                              -- on the boundary: inside
  perform pg_temp.reaction(p, 'wow', since + interval '1 second');       -- same quadrant as up, another kind
  perform pg_temp.reaction(p, 'boo', now());
  perform pg_temp.reaction(p, 'boo', now() - interval '1 hour');
  perform pg_temp.reaction(p, 'calm', now() - interval '2 hours');
  perform pg_temp.reaction(p, 'meh', now() - interval '3 hours');
  perform pg_temp.reaction(p, 'up', since - interval '1 millisecond');   -- just before: outside
  perform pg_temp.reaction(p, 'boo', since - interval '2 days');         -- long before: outside

  got := act_window_counts(p, since);
  if got -> 'counts' is distinct from '{"excitedPositive": 2, "excitedNegative": 2, "calmPositive": 1, "boredNegative": 1}'::jsonb then
    raise exception 'the window counts the reactions from its start (inclusive), by quadrant, not before: %', got;
  end if;
  if got -> 'cardOn' is distinct from 'null'::jsonb then raise exception 'a post is on no post: %', got; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(got) k) is distinct from array['cardOn', 'counts'] then raise exception 'the answer holds more than the counts and the post: %', got; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(got -> 'counts') k) is distinct from array['boredNegative', 'calmPositive', 'excitedNegative', 'excitedPositive'] then
    raise exception 'the counts are the four quadrants and nothing else (no kind, no account): %', got;
  end if;
  if act_window_counts(p, now() + interval '1 minute') -> 'counts' is distinct from '{"excitedPositive": 0, "excitedNegative": 0, "calmPositive": 0, "boredNegative": 0}'::jsonb then
    raise exception 'a window starting after every reaction counts none';
  end if;
  if act_window_counts(empty, since) -> 'counts' is distinct from '{"excitedPositive": 0, "excitedNegative": 0, "calmPositive": 0, "boredNegative": 0}'::jsonb then
    raise exception 'an Act nobody reacted to has all four counts at zero';
  end if;
  if act_window_counts(gen_random_uuid(), since) -> 'counts' is distinct from '{"excitedPositive": 0, "excitedNegative": 0, "calmPositive": 0, "boredNegative": 0}'::jsonb then
    raise exception 'an unknown Act has all four counts at zero, the same as a quiet one';
  end if;

  -- A card played on a post names the post; a card beyond a post does not.
  play := tests.act(b1, 'card', t, '{"card": "splat", "reach": "post"}', p);
  perform pg_temp.reaction(play, 'up');
  if act_window_counts(play, since) is distinct from jsonb_build_object('counts', '{"excitedPositive": 1, "excitedNegative": 0, "calmPositive": 0, "boredNegative": 0}'::jsonb, 'cardOn', p) then
    raise exception 'a card on a post answers with its counts and the post: %', act_window_counts(play, since);
  end if;
  play := tests.act(b1, 'card', t, '{"card": "splat"}', p);
  if act_window_counts(play, since) -> 'cardOn' is distinct from to_jsonb(p) then raise exception 'a play written before reach was kept is on its post'; end if;
  thread_play := tests.act(b1, 'card', t, jsonb_build_object('card', 'splat', 'reach', 'thread', 'thread', t), p);
  if act_window_counts(thread_play, since) -> 'cardOn' is distinct from 'null'::jsonb then raise exception 'a card on a thread is on no post: %', act_window_counts(thread_play, since); end if;
end $$;

-- ---- fire_hint: once per Act and pattern, to the Act's own player ----
do $$
declare
  ann uuid := tests.account('hf-ann'); bob uuid := tests.account('hf-bob'); cat uuid := tests.account('hf-cat');
  a1 uuid := tests.character(ann, 'Hf Ann One'); a2 uuid := tests.character(ann, 'Hf Ann Two'); b1 uuid := tests.character(bob, 'Hf Bob One'); c1 uuid := tests.character(cat, 'Hf Cat One');
  t uuid := tests.thread('Hf thread'); t_staff uuid := tests.thread('Hf staff thread');
  p uuid; q uuid; staff uuid; staff_post uuid; r record; first_time boolean; again boolean; sent bigint;
begin
  p := tests.post(a1, t, 'Ann''s post.');
  q := tests.post(b1, t, 'Bob''s post.');
  insert into characters (name, staff, staff_kind, debuted_at) values ('Hf Bot', 'hf-bot', 'bot', now()) returning id into staff;
  perform set_config('kayfabb.staff_writer', 'on', true);
  staff_post := tests.post(staff, t_staff, 'The bot speaks.');
  perform set_config('kayfabb.staff_writer', '', true);
  delete from broadcasts_due;
  delete from alerts;

  first_time := fire_hint(p, 'leading:excitedNegative');
  again := fire_hint(p, 'leading:excitedNegative');
  if first_time is distinct from true then raise exception 'the first firing of a pattern says it fired'; end if;
  if again is distinct from false then raise exception 'the second firing of the same pattern says it did not'; end if;
  if (select count(*) from hints_fired where act = p) is distinct from 1 then raise exception 'a pattern is recorded once per Act'; end if;
  if (select count(*) from alerts) is distinct from 1 then raise exception 'a pattern fired twice wrote % alerts, not 1', (select count(*) from alerts); end if;
  select * into r from alerts;
  if r.account is distinct from ann or r.kind is distinct from 'hint' or r.sub is distinct from 'leading:excitedNegative' or r.act is distinct from p or r.character is distinct from a1 then
    raise exception 'the hint is Ann''s, kind hint, the pattern as its sub, about her post and the mask that wrote it: %', to_jsonb(r);
  end if;
  select count(*) into sent from broadcasts_due where topic = 'account:' || ann;
  if sent is distinct from 1 or (select count(*) from broadcasts_due) is distinct from 1 then raise exception 'a hint queues one broadcast, on the author''s channel alone: % of %', sent, (select count(*) from broadcasts_due); end if;
  if (select payload from broadcasts_due) is distinct from jsonb_build_object('id', r.id, 'kind', 'hint', 'sub', 'leading:excitedNegative', 'act', p, 'character', a1, 'at', r.at) then
    raise exception 'the broadcast is the alert''s public projection: %', (select payload from broadcasts_due);
  end if;

  -- Another pattern on the same Act is its own hint; the same pattern on another Act is too.
  if fire_hint(p, 'divisive') is distinct from true or fire_hint(q, 'leading:excitedNegative') is distinct from true then raise exception 'a pattern fires once per Act, so a new pattern or a new Act fires'; end if;
  if (select count(*) from alerts where account = ann) is distinct from 2 or (select count(*) from alerts where account = bob) is distinct from 1 or exists (select 1 from alerts where account = cat) then
    raise exception 'each hint went to its Act''s own player and no one else';
  end if;
  if exists (select 1 from alerts where account = ann and act = q) then raise exception 'Ann got a hint about Bob''s post'; end if;

  -- A card is its author's Act; a thunder is a hint about either side.
  if fire_hint(q, 'thunder') is distinct from true then raise exception 'a thunder on a post fires'; end if;

  -- The reader's side: Ann reads her alerts and not Bob's; Cat reads none.
  perform tests.become(ann);
  if (select count(*) from alerts) is distinct from 2 then raise exception 'Ann reads her own two hints and no more, read % ', (select count(*) from alerts); end if;
  perform tests.become(cat);
  if exists (select 1 from alerts) then raise exception 'Cat reads no hint'; end if;
  perform tests.unbecome();

  -- A staff Act's author is no player: no row, no alert, no broadcast, and it is not recorded as fired.
  delete from broadcasts_due;
  delete from alerts;
  if fire_hint(staff_post, 'divisive') is distinct from false then raise exception 'a staff Act''s hint says it did not fire'; end if;
  if exists (select 1 from alerts) or exists (select 1 from broadcasts_due) or exists (select 1 from hints_fired where act = staff_post) then
    raise exception 'a hint about a staff Act wrote an alert, a broadcast or a record';
  end if;

  -- A pattern the engine does not name is refused, and an Act that is not there is too, and neither writes.
  if pg_temp.refusal(format('select fire_hint(%L, %L)', p, 'leading:nonsense')) is null then raise exception 'a pattern outside the engine''s list is refused'; end if;
  if pg_temp.refusal(format('select fire_hint(%L, %L)', p, 'Divisive')) is null then raise exception 'a pattern is matched exactly'; end if;
  if pg_temp.refusal(format('select fire_hint(%L, %L)', gen_random_uuid(), 'divisive')) is null then raise exception 'a hint about no Act is refused'; end if;
  if pg_temp.refusal(format('select fire_hint(%L, %L)', null, 'divisive')) is null then raise exception 'a hint about a null Act is refused'; end if;
  if pg_temp.refusal(format('select fire_hint(%L, %L)', p, null)) is null then raise exception 'a null pattern is refused'; end if;
  if exists (select 1 from alerts) then raise exception 'a refused hint wrote an alert'; end if;

  -- The API roles cannot call either function, and cannot read the record of what fired.
  perform tests.become(bob);
  if pg_temp.refusal(format('select fire_hint(%L, %L)', q, 'divisive')) not like 'permission denied%' then raise exception 'a player calls fire_hint'; end if;
  if pg_temp.refusal(format('select act_window_counts(%L, now())', q)) not like 'permission denied%' then raise exception 'a player calls act_window_counts'; end if;
  if pg_temp.refusal('select * from hints_fired') not like 'permission denied%' then raise exception 'a player reads hints_fired'; end if;
  perform tests.become_anon();
  if pg_temp.refusal(format('select fire_hint(%L, %L)', q, 'divisive')) not like 'permission denied%' then raise exception 'a visitor calls fire_hint'; end if;
  perform tests.unbecome();
end $$;

-- ---- A hint is the same whoever reacted: its recipient and words come from the Act and the pattern alone ----
do $$
declare
  ann uuid := tests.account('hs-ann'); bob uuid := tests.account('hs-bob');
  a1 uuid := tests.character(ann, 'Hs Ann One'); b1 uuid := tests.character(bob, 'Hs Bob One');
  t uuid := tests.thread('Hs thread'); p1 uuid; p2 uuid; r1 record; r2 record;
begin
  p1 := tests.post(a1, t, 'Reacted to by one player.');
  p2 := tests.post(a1, t, 'Reacted to by another.');
  perform pg_temp.reaction(p1, 'boo');
  perform pg_temp.reaction(p2, 'boo');
  perform fire_hint(p1, 'leading:excitedNegative');
  perform fire_hint(p2, 'leading:excitedNegative');
  select kind, sub, account, character into r1 from alerts where act = p1;
  select kind, sub, account, character into r2 from alerts where act = p2;
  if r1 is distinct from r2 then raise exception 'two hints of one pattern on one player''s posts differ by who reacted: % vs %', r1, r2; end if;
  if (select count(*) from broadcasts_due where topic = 'account:' || bob) is distinct from 0 then raise exception 'a reactor''s channel heard a hint'; end if;
end $$;
