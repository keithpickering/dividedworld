-- The verdict worked out before the thread lock (supabase/migrations/0393_forged_quotes.sql, section 3: forged_verdict_stage, acts_forged_quotes; section 4: post; issue #898).
--   reuse:  a staged verdict that matches the insert (the transaction, the body's digest, the instant) is the one written, and is cleared; a staged verdict with a wrong digest, a wrong txid or a wrong instant is
--           ignored and the trigger searches for itself. The staged value here is a lie (a quote that holds, staged as forged, and the reverse), so that "used" and "ignored" cannot look alike.
--   lock:   post() stages the verdict before lock_for_quote runs: lock_for_quote is wrapped in this transaction (DDL rolls back with the file) by a function that records whether a verdict was staged when it was
--           called, and post() searches exactly once (quote_forged's call count in this transaction: the trigger used the staged verdict and did not search again).
--   cap:    the time cap is the same for every caller: the verdict of a body past it is the same for the author and for a stranger (quote_check as two accounts).

create function pg_temp.noise(n integer) returns text language sql as $$
  select left(string_agg(md5(random()::text || g::text), ' '), n) from generate_series(1, n / 32 + 1) g
$$;

create function pg_temp.searches() returns bigint language sql as $$
  select coalesce(pg_stat_get_xact_function_calls('quote_forged(text, timestamptz)'::regprocedure), 0)
$$;

do $$
declare
  au uuid := tests.account('fqs2-author');
  other uuid := tests.account('fqs2-other');
  ch uuid := tests.character(au, 'Fqs2 Author');
  th uuid := tests.thread('Forged staged');
  real_post uuid := tests.post(ch, th, 'The real words of the post.', now() - interval '1 hour');
  holds text := format('[quote=%s]real words[/quote] and mine', real_post);
  fails text := format('[quote=%s]fake words[/quote] and mine', real_post);
  staged text; id1 uuid; p jsonb; before_calls bigint; saw text;
begin
  -- reuse: a matching staged verdict is used (here a lie: the quote holds and is staged as forged), and cleared
  perform forged_verdict_stage(holds);
  staged := current_setting('kayfabb.forged_verdict', true);
  if staged is null or staged = '' then raise exception 'stage: nothing was staged for a body with a quote'; end if;
  if split_part(staged, '|', 1) is distinct from txid_current()::text or split_part(staged, '|', 2) is distinct from md5(holds) or split_part(staged, '|', 4) is distinct from '' then
    raise exception 'stage: the staged value is %', staged;
  end if;
  perform set_config('kayfabb.forged_verdict', staged || real_post::text, true);
  before_calls := pg_temp.searches();
  insert into acts (character, kind, thread, payload) values (ch, 'post', th, jsonb_build_object('body', holds)) returning id into id1;
  if (select a.payload -> 'forged' from acts a where a.id = id1) is distinct from to_jsonb(array[real_post]) then raise exception 'reuse: the matching staged verdict was not used: %', (select a.payload from acts a where a.id = id1); end if;
  if pg_temp.searches() <> before_calls then raise exception 'reuse: the trigger searched although a verdict matched'; end if;
  if nullif(current_setting('kayfabb.forged_verdict', true), '') is not null then raise exception 'reuse: the used verdict was not cleared'; end if;

  -- a wrong digest (the staged body is another one), a wrong txid and a wrong instant are each ignored: the trigger searches itself, and a quote that holds is authentic
  perform forged_verdict_stage(holds);
  staged := current_setting('kayfabb.forged_verdict', true);
  perform set_config('kayfabb.forged_verdict', concat_ws('|', split_part(staged, '|', 1), md5('another body'), split_part(staged, '|', 3), real_post::text), true);
  before_calls := pg_temp.searches();
  insert into acts (character, kind, thread, payload) values (ch, 'post', th, jsonb_build_object('body', holds)) returning id into id1;
  if (select a.payload ? 'forged' from acts a where a.id = id1) then raise exception 'wrong digest: the staged verdict was believed'; end if;
  if pg_temp.searches() <> before_calls + 1 then raise exception 'wrong digest: the trigger did not search for itself'; end if;

  perform set_config('kayfabb.forged_verdict', concat_ws('|', (txid_current() + 1)::text, split_part(staged, '|', 2), split_part(staged, '|', 3), real_post::text), true);
  insert into acts (character, kind, thread, payload) values (ch, 'post', th, jsonb_build_object('body', holds)) returning id into id1;
  if (select a.payload ? 'forged' from acts a where a.id = id1) then raise exception 'wrong txid: the staged verdict was believed'; end if;

  perform set_config('kayfabb.forged_verdict', concat_ws('|', split_part(staged, '|', 1), split_part(staged, '|', 2), (split_part(staged, '|', 3)::numeric + 1)::text, real_post::text), true);
  insert into acts (character, kind, thread, payload) values (ch, 'post', th, jsonb_build_object('body', holds)) returning id into id1;
  if (select a.payload ? 'forged' from acts a where a.id = id1) then raise exception 'wrong instant: the staged verdict was believed'; end if;

  -- and the reverse lie (a forged quote staged as authentic, bound wrongly) is ignored: the trigger finds it forged
  perform set_config('kayfabb.forged_verdict', concat_ws('|', (txid_current() + 1)::text, md5(fails), split_part(staged, '|', 3), ''), true);
  insert into acts (character, kind, thread, payload) values (ch, 'post', th, jsonb_build_object('body', fails)) returning id into id1;
  if (select a.payload -> 'forged' from acts a where a.id = id1) is distinct from to_jsonb(array[real_post]) then raise exception 'wrong txid: a forged quote was let through'; end if;

  -- a body with no quote stages nothing, and a malformed or empty setting is no verdict
  perform set_config('kayfabb.forged_verdict', '', true);
  perform forged_verdict_stage('no quote here');
  if nullif(current_setting('kayfabb.forged_verdict', true), '') is not null then raise exception 'stage: a body with no quote staged a verdict'; end if;
  perform set_config('kayfabb.forged_verdict', 'garbage', true);
  insert into acts (character, kind, thread, payload) values (ch, 'post', th, jsonb_build_object('body', fails)) returning id into id1;
  if (select a.payload -> 'forged' from acts a where a.id = id1) is distinct from to_jsonb(array[real_post]) then raise exception 'garbage: a malformed setting changed the verdict'; end if;

  -- lock: wrap lock_for_quote so that it records what was staged when post() reached it
  alter function lock_for_quote(uuid, uuid, uuid) rename to lock_for_quote_real;
  create function lock_for_quote(a uuid, b uuid, c uuid) returns uuid[] language plpgsql as $f$
  begin
    perform set_config('kayfabb.test_saw', coalesce(current_setting('kayfabb.forged_verdict', true), '<none>'), true);
    return lock_for_quote_real(a, b, c);
  end $f$;
  perform set_config('kayfabb.forged_verdict', '', true);
  perform tests.become(au);
  before_calls := pg_temp.searches();
  p := post(th, ch, fails);
  perform tests.unbecome();
  saw := current_setting('kayfabb.test_saw', true);
  if saw is null or saw = '<none>' or saw = '' then raise exception 'lock: post() reached lock_for_quote with no verdict staged: %', saw; end if;
  if split_part(saw, '|', 2) is distinct from md5(fails) or split_part(saw, '|', 4) is distinct from real_post::text then raise exception 'lock: the staged verdict is not this body''s: %', saw; end if;
  if pg_temp.searches() <> before_calls + 1 then raise exception 'lock: post() searched % times, not once', pg_temp.searches() - before_calls; end if;
  if (select a.payload -> 'forged' from acts a where a.id = (p ->> 'id')::uuid) is distinct from to_jsonb(array[real_post]) then raise exception 'lock: the forged quote was not written forged by post()'; end if;
  if nullif(current_setting('kayfabb.forged_verdict', true), '') is not null then raise exception 'lock: post() left the verdict staged'; end if;
  -- a post with no quote reaches the lock with nothing staged, and still posts
  perform set_config('kayfabb.test_saw', '', true);
  perform tests.become(au);
  p := post(th, ch, 'Plainly my own words.');
  perform tests.unbecome();
  if coalesce(nullif(current_setting('kayfabb.test_saw', true), '<none>'), '') <> '' then raise exception 'lock: a plain post staged %', current_setting('kayfabb.test_saw', true); end if;
end $$;

-- cap: past the time cap the verdict is forged, and it is the same for every caller (quote_check, as the author and as a stranger). The shape cannot finish in 100 ms: a periodic quote with its odd letter first against
-- 60 versions (about 1.5 s of strpos in all), and the quote holds in the oldest, so only the clock forges it. Its twin, one quote that holds in the newest version, is found at once and is authentic.
do $$
declare
  au uuid := tests.account('fqs3-author');
  other uuid := tests.account('fqs3-other');
  ch uuid := tests.character(au, 'Fqs3 Author');
  th uuid := tests.thread('Forged cap');
  base timestamptz := now() - interval '1 day';
  post_id uuid; i integer; qbody text; v1 uuid[]; v2 uuid[];
begin
  post_id := tests.post(ch, th, 'z1' || repeat(' ab', 6600) || ' end0', base);
  for i in 1..59 loop
    perform tests.act(ch, 'edit', th, jsonb_build_object('body', 'v' || i || repeat(' ab', 6600) || ' end' || i), post_id, base + make_interval(mins => i));
  end loop;
  qbody := format('[quote=%s]v59%s[/quote]', post_id, repeat(' ab', 10));
  perform tests.become(au); v1 := quote_check(qbody); perform tests.unbecome();
  perform tests.become(other); v2 := quote_check(qbody); perform tests.unbecome();
  if cardinality(v1) <> 0 or v1 is distinct from v2 then raise exception 'cap: a quote of the newest version is forged: % / %', v1, v2; end if;
  qbody := format('[quote=%s]z1%s[/quote] [quote=%s]z1%s[/quote]', post_id, repeat(' ab', 3000), post_id, repeat(' ab', 2999));
  perform tests.become(au); v1 := quote_check(qbody); perform tests.unbecome();
  perform tests.become(other); v2 := quote_check(qbody); perform tests.unbecome();
  if v1 is distinct from array[post_id] or v2 is distinct from v1 then raise exception 'cap: a body past the time cap is not forged for everyone alike: % / %', v1, v2; end if;
end $$;
