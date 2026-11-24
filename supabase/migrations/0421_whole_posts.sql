-- Whole posts, the database (docs/plans/2026-11-23-whole-posts-plan.md, Task 2; the design is docs/plans/2026-11-23-whole-posts-design.md, sections 2, 3 and 5).
-- A persona's turn reads whole posts instead of excerpts, and the day's budget is counted in characters instead of turns.
--
-- 1. the settings   setting_pool (0415), `turns` without perDay, and the pool holding `charsPerDay` (a whole number from 0 to 20,000,000: the characters of staff words in a UTC day) and `readMost` (a whole number from 1,000 to 200,000:
--    the most characters a turn's read holds). Everything else as 0415 wrote it. The stored `pool` row is rewritten here by pool_rewrite_whole_posts, which a test re-runs on rows of its own: turns.perDay removed, charsPerDay
--    set to perDay x 13,000 (800,000 where there was no perDay), readMost 40,000 where absent; `tuned_at` is kept (the seeding flag, as a seed's own write sets it). A settings row, not an Act: an UPDATE is allowed.
--    seed_setting (0355) cannot put turns.perDay back: its write goes through the settings trigger, which holds setting_pool, and a pool with turns.perDay is refused (23514); on a tuned row it fills only keys the row lacks.
--
-- 2. the spends   pool_spends, pool_turns and pool_attempts hold `chars` (the characters the call wrote or was charged, an integer, not null, default 0, never negative). record_pool_spend, write_staff_turn and
--    record_turn_attempt take it as their last parameter, with no default, so a caller that forgets it is refused and not silently charged nothing; the old signatures are dropped and the new ones carry the grants.
--    pool_chars_today(day) is the sum of chars over the day's pool_spends, pool_turns and paid pool_attempts (as pool_turns_today, 0419, counts the day's turns plus paid attempts; it stays). Each function is its latest
--    definition (0420, 0415, 0419) with the parameter added and the column written; lock order and refusals as they were.
--
-- 3. pool_read(in_thread, staff_key, named, "window")   one read of a thread for a persona: {title, self, posts}, every body whole (no left(), no cut). posts is the union, each once, in thread order, of the thread's first
--    post; its newest `window` posts (the engine's READ_WINDOW, passed in; clamped to 200 here); `named` (the first 50); the persona's newest 20 posts there and the newest 10 replies to each; and the posts of this
--    thread that any of those quote (quote_refs), one hop and no further, at most 10 for each quoting post. Each post is {act, seq, at, author, name, pronouns, body, replyTo, quotes}: seq is the post's number in the thread
--    (acts.seq, the "#n" pool_thread names a post by), replyTo its target_act_id, quotes the posts of this thread it quotes. Reads only acts_public, characters_public, character_profiles, quote_refs and thread_list (and
--    the persona's own id is read from characters_public, the debuted characters, and a persona that has not debuted has none), so a hidden post (acts_public's `hidden`, which still lists the row, with no words) is in no part of it: not as a post, not as a quote, not counted in the window. security definer, owned by kayfabb_digest as pool_thread is, the service role's only.
--    quote_refs is read by that role: its select on (act, quoted) and a policy of its own, as the digest role has on the other tables it reads (0045_digest.sql). A quote of a post is in the quoting post's own public body,
--    and the rows read are those of Acts acts_public already shows, so nothing is said that a player cannot see.
--    The newest `window` is read by number from thread_list's last_seq, and the page by an id array, so the view is never evaluated over the whole thread (the test reads the rows of acts a 1,000- and a 4,000-post thread cost: 404 each). `set jit = off`, as 0368's reads have it: a call's cost passes jit_above_cost and JIT added ~350 ms.
--    Bounded by constants: seeds are at most 1 + 200 + 50 + 20 + 200 = 471 posts and the hop adds at most 10 for each, so at most 471 + 4,710 = 5,181 posts however long the thread; each probe is an index probe (acts_thread_seq_key, acts_thread_posts, acts_target for the replies, acts_edits (an index-only probe) for a post's latest edit, quote_refs' primary key, acts' own key).
-- Ways out: no state is added. A spend, a turn and an attempt are ledger rows; a budget spent by the day's end is the next day's fresh one.
-- Masks: pool_read reads public Acts and characters (characters_public); the persona's own id is its own. Nothing here reads an owner, a class or who reacted.
-- The test that drives it red is supabase/tests/0421-whole-posts.sql.

-- ===================================================================================== 1. the settings ====
-- setting_pool (0415_chattier_staff.sql), `turns` without perDay, the pool holding charsPerDay and readMost.
create or replace function setting_pool(v jsonb) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  fields text[] := array['weekly', 'holdback', 'threadsWeekly', 'cardRarityMost', 'priorityDays', 'notesRead', 'chatterThreadPosts', 'strengths', 'sessions', 'turns', 'charsPerDay', 'readMost', 'chatterCron'];
  triggers text[] := array['named', 'quoted', 'legacy', 'successorStumbles', 'oldFlame', 'homeTurf', 'seasonTurn', 'hotOnBeat'];
  shape text := 'an object giving weekly, priorityDays, notesRead and chatterThreadPosts (whole numbers, at least 1), threadsWeekly (a whole number, at least 0), '
    'holdback (from 0 to 0.5), cardRarityMost (common, uncommon, rare or legendary), strengths (a whole number, at least 1, for each of '
    'named, quoted, legacy, successorStumbles, oldFlame, homeTurf, seasonTurn, hotOnBeat) sessions (perDay, a whole number from 0 to 8; minutes, least and most, whole, from 10 to 180, the least not above the most; waking, from and to, whole UTC hours from 0 to 23), '
    'turns (waitHours, a whole number from 1 to 168; perThread, from 1 to 6; perSession, from perThread to 12), charsPerDay (a whole number from 0 to 20,000,000), readMost (a whole number from 1,000 to 200,000) and chatterCron (a five-field cron expression, each field inside its range)';
  k text;
  s jsonb;
  t jsonb;
begin
  if jsonb_typeof(v) is distinct from 'object' then return shape; end if;
  select e into k from jsonb_object_keys(v) e where e <> all (fields) limit 1;
  if k is not null then return format('%s; "%s" is not one of its fields', shape, k); end if;
  foreach k in array array['weekly', 'priorityDays', 'notesRead', 'chatterThreadPosts'] loop
    if not setting_whole(v -> k, 1) then return format('%s; "%s" is not', shape, k); end if;
  end loop;
  if not setting_whole(v -> 'threadsWeekly', 0) then return shape || '; "threadsWeekly" is not'; end if;
  if not coalesce(jsonb_typeof(v -> 'holdback') = 'number' and (v ->> 'holdback')::numeric >= 0 and (v ->> 'holdback')::numeric <= 0.5, false) then
    return shape || '; "holdback" is not';
  end if;
  if not coalesce(jsonb_typeof(v -> 'cardRarityMost') = 'string' and rarity_rank(v ->> 'cardRarityMost') is not null, false) then
    return shape || '; "cardRarityMost" is not';
  end if;
  if not setting_cron(v -> 'chatterCron') then return shape || '; "chatterCron" is not'; end if;
  -- sessions: exactly perDay, minutes and waking (0415; `sessionsHeld` in engine/rules/instance.ts).
  s := v -> 'sessions';
  if jsonb_typeof(s) is distinct from 'object' or (select count(*) from jsonb_object_keys(s)) <> 3
     or not setting_whole(s -> 'perDay', 0, 8)
     or jsonb_typeof(s -> 'minutes') is distinct from 'object' or (select count(*) from jsonb_object_keys(s -> 'minutes')) <> 2
     or not setting_whole(s -> 'minutes' -> 'least', 10, 180) or not setting_whole(s -> 'minutes' -> 'most', 10, 180)
     or (s -> 'minutes' -> 'least') > (s -> 'minutes' -> 'most')
     or jsonb_typeof(s -> 'waking') is distinct from 'object' or (select count(*) from jsonb_object_keys(s -> 'waking')) <> 2
     or not setting_whole(s -> 'waking' -> 'from', 0, 23) or not setting_whole(s -> 'waking' -> 'to', 0, 23) then
    return shape || '; "sessions" is not';
  end if;
  -- turns: exactly waitHours, perThread and perSession (0415, perDay gone in 0421; `turnsHeld` in engine/rules/instance.ts). The day's budget is charsPerDay, in characters.
  t := v -> 'turns';
  if jsonb_typeof(t) is distinct from 'object' or (select count(*) from jsonb_object_keys(t)) <> 3
     or not setting_whole(t -> 'waitHours', 1, 168) or not setting_whole(t -> 'perThread', 1, 6)
     or not setting_whole(t -> 'perSession', case when setting_whole(t -> 'perThread', 1, 6) then (t ->> 'perThread')::numeric else 1 end, 12) then
    return shape || '; "turns" is not';
  end if;
  -- charsPerDay: the characters of model-written words the staff may spend in a UTC day; readMost: the most characters of a thread a turn's read holds (0421; `POOL_WHOLE` in engine/rules/instance.ts).
  if not setting_whole(v -> 'charsPerDay', 0, 20000000) then return shape || '; "charsPerDay" is not'; end if;
  if not setting_whole(v -> 'readMost', 1000, 200000) then return shape || '; "readMost" is not'; end if;
  if jsonb_typeof(v -> 'strengths') is distinct from 'object' then return shape || '; "strengths" is not'; end if;
  select e into k from jsonb_object_keys(v -> 'strengths') e where e <> all (triggers) limit 1;
  if k is not null then return format('%s; "strengths.%s" is not a trigger', shape, k); end if;
  foreach k in array triggers loop
    if not setting_whole(v -> 'strengths' -> k, 1) then return format('%s; "strengths.%s" is not', shape, k); end if;
  end loop;
  return null;
end $$;

-- The stored pool's rewrite: perDay out of turns, charsPerDay = perDay x 13,000 (the draft's 800,000 where there was none), readMost 40,000 where absent. A row already rewritten is returned as it is.
create function pool_rewrite_whole_posts(v jsonb) returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select case when jsonb_typeof(v) is distinct from 'object' then v
    else (v #- '{turns,perDay}')
         || case when v ? 'charsPerDay' then '{}'::jsonb
                 else jsonb_build_object('charsPerDay', case when jsonb_typeof(v #> '{turns,perDay}') = 'number' then least(round((v #>> '{turns,perDay}')::numeric * 13000), 20000000) else 800000 end) end
         || case when v ? 'readMost' then '{}'::jsonb else '{"readMost": 40000}'::jsonb end
    end
$$;
revoke execute on function pool_rewrite_whole_posts(jsonb) from public, anon, authenticated;

-- The stored row, rewritten (the new setting_pool above holds the result). A migration's write is a seed's: tuned_at is left as it was.
do $$
declare was text := current_setting('kayfabb.seeding', true);
begin
  perform set_config('kayfabb.seeding', 'on', true);
  update settings set value = pool_rewrite_whole_posts(value) where key = 'pool';
  perform set_config('kayfabb.seeding', coalesce(nullif(was, ''), 'off'), true);
end $$;

-- ===================================================================================== 2. the spends ====
alter table pool_spends add column chars integer not null default 0 check (chars >= 0);
alter table pool_turns add column chars integer not null default 0 check (chars >= 0);
alter table pool_attempts add column chars integer not null default 0 check (chars >= 0);

drop function record_pool_spend(date, text, text, uuid, uuid, boolean, jsonb);
create function record_pool_spend(on_day date, of_staff text, by_trigger text, post uuid, card uuid, started boolean, note jsonb, in_chars integer)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  who uuid;
  made bigint;
begin
  select c.id into who from characters c where c.staff = of_staff and c.staff_kind = 'persona';
  if who is null then raise exception 'there is no persona "%"', of_staff using errcode = 'P0002'; end if;
  if not exists (select 1 from acts a where a.id = post and a.character = who and a.kind in ('post', 'spin')) then
    raise exception 'the spend''s post is not a post of %', of_staff using errcode = '22023';
  end if;
  if card is not null and not exists (select 1 from acts a where a.id = card and a.character = who and a.kind in ('card', 'set', 'draw')) then
    raise exception 'the spend''s card is not a card of %', of_staff using errcode = '22023';
  end if;
  insert into pool_spends (day, staff, trigger, post_act, card_act, started_thread, record, chars)
  values (on_day, of_staff, by_trigger, post, card, coalesce(started, false), coalesce(note, '{}'::jsonb), in_chars)
  on conflict (day, staff) do nothing returning id into made;
  if made is null then return jsonb_build_object('status', 'already'); end if;
  return jsonb_build_object('status', 'spent', 'id', made);
end $$;
revoke execute on function record_pool_spend(date, text, text, uuid, uuid, boolean, jsonb, integer) from public, anon, authenticated;
grant execute on function record_pool_spend(date, text, text, uuid, uuid, boolean, jsonb, integer) to service_role;

drop function write_staff_turn(text, bigint, uuid, uuid, uuid[], text);
create function write_staff_turn(staff_key text, in_session bigint, in_thread uuid, quoting uuid, answers uuid[], body text, in_chars integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  who uuid;
  sess staff_sessions;
  wanted uuid[];
  written jsonb;
  made bigint;
begin
  select c.id into who from characters c where c.staff = staff_key and c.staff_kind = 'persona';
  if who is null then raise exception 'there is no persona "%"', staff_key using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('kayfabb-staff-turn:' || staff_key, 0));
  select * into sess from staff_sessions s where s.id = in_session;
  if sess.id is null or sess.staff is distinct from staff_key then
    raise exception 'that session is not %''s', staff_key using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if not (sess.starts_at <= now() and now() < sess.ends_at) then
    raise exception 'that session is not open now' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  select coalesce(array_agg(distinct x), '{}') into wanted from unnest(answers) x;
  if cardinality(wanted) = 0 or write_staff_turn.quoting is null or not (write_staff_turn.quoting = any (wanted)) then
    raise exception 'a turn quotes one of the replies it answers' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- A reply is answered once. Two guards: the persona's lock above serializes its turns, so the second of two racing turns finds the first's pool_answered rows here; and pool_answered's primary key (reply) refuses a
  -- duplicate whatever got past this read, rolling the whole turn back.
  if exists (select 1 from pool_answered p where p.reply = any (wanted)) then
    raise exception 'a reply is answered once' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  -- Each answer is waiting now, by the very read that finds waiting replies (pool_waiting_in_thread): a public reply by a character that is not staff to a post of this persona in this thread, within the wait, not under an
  -- author veil, not in a thread the persona is locked out of.
  if (select count(*) from pool_waiting_in_thread(in_thread, array[staff_key], now() - coalesce(((select g.value from settings g where g.key = 'pool') -> 'turns' ->> 'waitHours')::integer, 48) * interval '1 hour') w
      where w.act = any (wanted)) is distinct from cardinality(wanted) then
    raise exception 'a turn answers the replies waiting on its own posts in its thread' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  perform within('body', body, 'postMaxLength');
  written := write_staff_act(staff_key, 'post', in_thread, write_staff_turn.quoting, jsonb_build_object('body', body));
  insert into pool_turns (day, staff, session, thread, post_act, quoting, chars)
  values (sess.day, staff_key, in_session, in_thread, (written ->> 'id')::uuid, write_staff_turn.quoting, in_chars) returning id into made;
  insert into pool_answered (reply, turn) select x, made from unnest(wanted) x;
  return jsonb_build_object('turn', made, 'post', written);
end $$;
revoke execute on function write_staff_turn(text, bigint, uuid, uuid, uuid[], text, integer) from public, anon, authenticated;
grant execute on function write_staff_turn(text, bigint, uuid, uuid, uuid[], text, integer) to service_role;

drop function record_turn_attempt(text, bigint, uuid, uuid[], text, boolean);
create function record_turn_attempt(staff_key text, in_session bigint, in_thread uuid, answers uuid[], outcome text, paid boolean, in_chars integer) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  sess staff_sessions;
  wanted uuid[];
  made bigint;
begin
  select * into sess from staff_sessions s where s.id = in_session;
  if sess.id is null or sess.staff is distinct from staff_key then
    raise exception 'that session is not %''s', staff_key using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if coalesce(cardinality(answers), 0) = 0 or array_position(answers, null) is not null then
    raise exception 'an attempt names the replies it answers' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  select array_agg(distinct x) into wanted from unnest(answers) x;
  if (select count(*) from pool_waiting_in_thread(in_thread, array[staff_key], now() - coalesce(((select g.value from settings g where g.key = 'pool') -> 'turns' ->> 'waitHours')::integer, 48) * interval '1 hour') w
      where w.act = any (wanted)) is distinct from cardinality(wanted) then
    raise exception 'an attempt names the replies waiting on its own posts in its thread' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  insert into pool_attempts (day, staff, session, thread, outcome, paid, chars)
  values (sess.day, staff_key, in_session, in_thread, record_turn_attempt.outcome, record_turn_attempt.paid, in_chars) returning id into made;
  insert into pool_attempt_replies (attempt, reply) select made, x from unnest(wanted) x;
  return made;
end $$;
revoke execute on function record_turn_attempt(text, bigint, uuid, uuid[], text, boolean, integer) from public, anon, authenticated;
grant execute on function record_turn_attempt(text, bigint, uuid, uuid[], text, boolean, integer) to service_role;

-- The characters spent on a UTC day, instance-wide: the day's spends, turns and paid failed attempts (an unpaid attempt cost nothing). pool_turns_today (0419) counts calls and stays.
create function pool_chars_today(on_day date) returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select (select coalesce(sum(s.chars), 0) from pool_spends s where s.day = on_day)
       + (select coalesce(sum(t.chars), 0) from pool_turns t where t.day = on_day)
       + (select coalesce(sum(p.chars), 0) from pool_attempts p where p.day = on_day and p.paid)
$$;
revoke execute on function pool_chars_today(date) from public, anon, authenticated;
grant execute on function pool_chars_today(date) to service_role;

-- ===================================================================================== 3. pool_read ====
grant select (act, quoted) on quote_refs to kayfabb_digest;
create policy digest_reads on quote_refs for select to kayfabb_digest using (true);

-- `self` is looked up by staff key alone, not staff_kind = 'persona': a Mod Bot reads a thread through this too (Task 7), with its own staff key.
create function pool_read(in_thread uuid, staff_key text, named uuid[], "window" integer) returns jsonb
language sql stable security definer set search_path = public, pg_temp set jit = off as $$
  with me as (select c.id from characters_public c where c.staff = pool_read.staff_key),
  -- The persona's newest 20 posts in the thread (a spin it started counts as one, as in pool_conversation).
  mine as (
    select o.id from (
      select a.id, a.created_at from acts_public a where a.thread = in_thread and a.kind = 'post' and a.hidden is not true and a.character = (select m.id from me m)
      union all
      select a.id, a.created_at from acts_public a where a.thread = in_thread and a.seq = 1 and a.kind = 'spin' and a.hidden is not true and a.character = (select m.id from me m)) o
    order by o.created_at desc, o.id desc limit 20
  ),
  -- The seeds: the opener, the newest window, what is named, the persona's own posts and the newest 10 replies to each.
  seeds as (
    select a.id from acts_public a where a.thread = in_thread and a.seq = 1 and a.kind in ('post', 'spin') and a.hidden is not true
    union
    -- The newest `window` posts, by number: only the thread's last 2 x window + 60 numbers are looked at (thread_list's last_seq), so the view is evaluated for a constant count of Acts, never for the whole thread
    -- (acts_public's veiled branch has no index to order by and would otherwise be read to the thread's start). Hidden posts and the few numbered Acts that are no post (a spin, an unmask, a tally) are inside that margin.
    (select n.id from acts_public n
     where n.thread = in_thread and n.kind = 'post' and n.hidden is not true
       and n.seq > coalesce((select t.last_seq from thread_list t where t.id = in_thread), 0) - 2 * least(greatest(coalesce("window", 0), 0), 200) - 60
     order by n.seq desc, n.id desc limit least(greatest(coalesce("window", 0), 0), 200))
    union
    select a.id from acts_public a where a.thread = in_thread and a.kind = 'post' and a.hidden is not true and a.id = any (coalesce(pool_read.named[1:50], '{}'::uuid[]))
    union
    select m.id from mine m
    union
    select r.id from mine m cross join lateral (
      select x.id from acts_public x where x.target_act_id = m.id and x.thread = in_thread and x.kind = 'post' and x.hidden is not true order by x.created_at desc, x.id desc limit 10) r
  ),
  -- One hop: the posts of this thread the seeds quote.
  -- An edit is an Act of its own and its quote_refs hang on its id, so a post's quotes are read from its latest edit's id when it has one (as acts_public's current_payload is), else its own.
  seed_refs as (
    select s.id, coalesce((select e.id from acts_public e where e.kind = 'edit' and e.target_act_id = s.id order by e.created_at desc, e.id desc limit 1), s.id) as ref from seeds s
  ),
  hop as (
    select q.id from seed_refs s cross join lateral (
      select x.id from quote_refs r join acts_public x on x.id = r.quoted
      where r.act = s.ref and x.thread = in_thread and x.hidden is not true and (x.kind = 'post' or (x.kind = 'spin' and x.seq = 1))
      order by x.created_at desc, x.id desc limit 10) q
  ),
  chosen as (select s.id from seeds s union select h.id from hop h),
  page as (
    select a.id, a.seq, a.created_at, a.character, a.target_act_id, c.name,
           coalesce((select e.id from acts_public e where e.kind = 'edit' and e.target_act_id = a.id order by e.created_at desc, e.id desc limit 1), a.id) as ref,
           (select cp.pronouns from character_profiles cp where cp.character = c.id) as pronouns,
           coalesce(a.current_payload ->> 'body', '') as body
    from acts_public a join characters_public c on c.id = a.character
    -- The ids are fixed first (an array), so the view is evaluated for those posts and not hash-joined to the whole thread's.
    where a.id = any (array(select k.id from chosen k)) and a.thread = in_thread and a.hidden is not true
  )
  select jsonb_build_object(
    'title', coalesce((select t.title from thread_list t where t.id = in_thread), ''),
    'self', (select m.id from me m),
    'posts', coalesce((
      select jsonb_agg(jsonb_build_object('act', p.id, 'seq', p.seq, 'at', p.created_at, 'author', p.character, 'name', p.name, 'pronouns', p.pronouns,
                                          'body', p.body, 'replyTo', p.target_act_id,
                                          'quotes', coalesce((
                                            select jsonb_agg(z.id order by z.created_at desc, z.id desc)
                                            from (select x.id, x.created_at from quote_refs r join acts_public x on x.id = r.quoted
                                                  where r.act = p.ref and x.thread = in_thread and x.hidden is not true and (x.kind = 'post' or (x.kind = 'spin' and x.seq = 1))
                                                  order by x.created_at desc, x.id desc limit 10) z), '[]'::jsonb))
                       order by p.created_at, p.id)
      from page p), '[]'::jsonb))
$$;

grant create on schema public to kayfabb_digest;
alter function pool_read(uuid, text, uuid[], integer) owner to kayfabb_digest;
revoke create on schema public from kayfabb_digest;
revoke execute on function pool_read(uuid, text, uuid[], integer) from public, anon, authenticated;
grant execute on function pool_read(uuid, text, uuid[], integer) to service_role;
