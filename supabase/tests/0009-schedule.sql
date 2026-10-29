-- The settlement job's database side (supabase/migrations/0004_schedule.sql): the instance
-- arriving as data, the schedule, the next window, and what a window's settlement reads.
-- Plan Task 8.

-- ---- An instance's vocabulary arrives as data, and arriving twice changes nothing ----
do $$
declare
  payload jsonb := jsonb_build_object(
    'settings', jsonb_build_object('reactionCap', 3, 'settlementCron', '5 9 * * *'),
    'classes', jsonb_build_array(jsonb_build_object('key', 'gamma', 'name', 'Gamma')),
    'reactions', jsonb_build_array(jsonb_build_object('key', 'zap', 'emoji', '⚡', 'quadrant', 'excitedPositive')),
    'cards', jsonb_build_array(jsonb_build_object('key', 'zing', 'name', 'Zing', 'alignment', 'pepperoni', 'basePrice', 150)),
    'boards', jsonb_build_array(jsonb_build_object('slug', 'side', 'name', 'Side', 'description', 'Off to one side.')));
  first jsonb;
  second jsonb;
begin
  first := seed_instance(payload);
  second := seed_instance(payload);
  if first <> second then raise exception 'seeding twice changed something: % then %', first, second; end if;
  if not exists (select 1 from class_kinds where key = 'gamma') or not exists (select 1 from reaction_kinds where key = 'zap')
     or not exists (select 1 from card_kinds where key = 'zing' and base_price = 150) or not exists (select 1 from boards where slug = 'side') then
    raise exception 'the instance''s vocabulary did not arrive';
  end if;
  if not exists (select 1 from class_kinds where key = 'alpha') then raise exception 'a kind the payload no longer names was removed'; end if;
  -- An admin's change to a seeded board stays.
  update boards set name = 'Sideboard' where slug = 'side';
  perform seed_instance(payload);
  if (select name from boards where slug = 'side') is distinct from 'Sideboard' then raise exception 'seeding again overwrote an admin''s board'; end if;
  if (select count(*) from seasons) is distinct from 1 then raise exception 'seeding opened a second season'; end if;

  -- The schedule follows the setting.
  if (select schedule from cron.job where jobname = 'kayfabb-settle') is distinct from '5 9 * * *' then
    raise exception 'the job should run at the instance''s settlementCron, got %', (select schedule from cron.job where jobname = 'kayfabb-settle');
  end if;
  update settings set value = '"40 7 * * *"' where key = 'settlementCron';
  if (select schedule from cron.job where jobname = 'kayfabb-settle') is distinct from '40 7 * * *' then raise exception 'changing the setting should reschedule the job'; end if;
end $$;

-- ---- The job sends nothing until both of its secrets exist, then calls the function with the minute it fired ----
do $$
declare
  cmd text;
  q record;
begin
  perform schedule_settlement();
  select command into cmd from cron.job where jobname = 'kayfabb-settle';
  delete from net.http_request_queue;
  execute cmd;
  if exists (select 1 from net.http_request_queue) then raise exception 'the job sent a request with no secrets'; end if;
  insert into vault.decrypted_secrets values ('kayfabb_functions_url', 'https://project.example');
  execute cmd;
  if exists (select 1 from net.http_request_queue) then raise exception 'the job sent a request with half its secrets'; end if;
  insert into vault.decrypted_secrets values ('kayfabb_service_key', 'not-a-real-key');
  execute cmd;
  select * into q from net.http_request_queue;
  if q.url <> 'https://project.example/functions/v1/settle' then raise exception 'the job called %', q.url; end if;
  if q.headers ->> 'Authorization' <> 'Bearer not-a-real-key' then raise exception 'the job should carry the service key'; end if;
  if (q.body ->> 'until')::timestamptz <> date_trunc('minute', now()) - interval '1 minute' then
    raise exception 'the body should carry the minute before the one the job fired in: %', q.body;
  end if;
end $$;

-- ---- The next window: from the last settled end, to now or the season's end ----
do $$
declare
  last_end timestamptz := coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons));
  w jsonb;
begin
  if next_settlement_window(last_end) is not null then raise exception 'a window ending where it starts is nothing to settle'; end if;
  w := next_settlement_window(last_end + interval '1 day');
  if (w ->> 'start')::timestamptz <> last_end or (w ->> 'end')::timestamptz <> last_end + interval '1 day' then raise exception 'the next window: %', w; end if;
  -- A season ending inside the window ends the window there.
  update seasons set ends_at = last_end + interval '6 hours' where number = 1;
  insert into seasons (number, starts_at) values (2, last_end + interval '6 hours');
  w := next_settlement_window(last_end + interval '1 day');
  if (w ->> 'end')::timestamptz <> last_end + interval '6 hours' then raise exception 'a window should stop at its season''s end: %', w; end if;
end $$;

-- ---- A window's input: what the settlement reads, and nothing it does not ----
do $$
declare
  ann uuid := tests.account('in-ann');
  bob uuid := tests.account('in-bob');
  cat uuid := tests.account('in-cat');
  a uuid := tests.character(ann, 'Input One', 'alpha', '2031-01-01');
  b uuid := tests.character(bob, 'Input Two', 'beta', '2031-01-01');
  c uuid := tests.character(cat, 'Input Three', 'alpha', '2031-01-01');
  far uuid := tests.character(tests.account('in-far'), 'Input Far', 'alpha', '2031-01-01');
  t uuid := tests.thread();
  spun uuid;
  old_post uuid := tests.post(a, t, 'Old.', '2031-01-01T01:00:00Z');
  new_post uuid := tests.post(a, t, 'New.', '2031-01-02T01:00:00Z');
  untouched uuid := tests.post(far, t, 'Nobody reacts to me.', '2031-01-01T02:00:00Z');
  card uuid;
  spin uuid;
  first_reply uuid;
  input jsonb;
  ids jsonb;
begin
  insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values
    (old_post, b, bob, 'up', 1, '2031-01-01T03:00:00Z'),   -- earlier, on an Act reacted to in the window: read
    (old_post, c, cat, 'boo', 1, '2031-01-02T02:00:00Z'),  -- in the window
    (untouched, b, bob, 'up', 1, '2031-01-01T04:00:00Z'),  -- earlier, on an Act not reacted to in the window: not read
    (new_post, b, bob, 'meh', 1, '2031-01-03T02:00:00Z');  -- after the window: not read
  card := tests.act(b, 'card', t, '{"card": "splat"}', old_post, '2031-01-02T03:00:00Z');
  insert into threads (board, title, origin_act_id) select board, 'Spun', untouched from threads where id = t returning id into spun;
  spin := tests.act(c, 'spin', spun, '{"title": "Spun"}', untouched, '2031-01-01T05:00:00Z');
  first_reply := tests.post(b, spun, 'First reply.', '2031-01-01T06:00:00Z');
  perform tests.post(c, spun, 'The spinner''s own, before the window.', '2031-01-01T07:00:00Z');
  perform tests.post(b, spun, 'Second reply.', '2031-01-02T04:00:00Z');
  input := settlement_input('2031-01-02T00:00:00Z', '2031-01-03T00:00:00Z');

  if (input -> 'window' ->> 'from')::bigint <> (extract(epoch from timestamptz '2031-01-02T00:00:00Z') * 1000)::bigint then raise exception 'the window in ms'; end if;
  select jsonb_agg(x ->> 'id' order by x ->> 'id') into ids from jsonb_array_elements(input -> 'acts') x;
  if not ids @> jsonb_build_array(old_post, new_post, card, spin, untouched) then raise exception 'the input should hold the window''s Acts and those they touch: %', ids; end if;
  -- A spun thread active in the window brings each character's first post in it, from before
  -- the window too; with the window's own post, Bob's two, and Cat's one.
  if not ids @> jsonb_build_array(first_reply) then raise exception 'a spun thread brings its repliers'' first posts from before the window'; end if;
  if (select count(*) from jsonb_array_elements(input -> 'acts') x where x ->> 'thread' = spun::text and x ->> 'kind' = 'post') is distinct from 3 then
    raise exception 'a spun thread brings each character''s first post and the window''s own, no more';
  end if;
  if (select x ->> 'card' from jsonb_array_elements(input -> 'acts') x where x ->> 'id' = card::text) is distinct from 'splat' then raise exception 'a card Act carries its card'; end if;
  if (select count(*) from jsonb_array_elements(input -> 'reactions')) is distinct from 2 then
    raise exception 'the input should hold the window''s reaction and the earlier one on the same Act, only: %', input -> 'reactions';
  end if;
  if (select x ->> 'player' from jsonb_array_elements(input -> 'reactions') x where x ->> 'kind' = 'boo') is distinct from cat::text then raise exception 'a reaction names its player'; end if;
  if (select jsonb_array_length(x -> 'classes') from jsonb_array_elements(input -> 'characters') x where x ->> 'id' = b::text) is distinct from 1 then
    raise exception 'a character carries its classes';
  end if;
  if exists (select 1 from jsonb_array_elements(input -> 'characters') x where x ->> 'id' = far::text and x ->> 'player' is null) then
    raise exception 'a character carries its player';
  end if;
end $$;

-- ---- Only the service role reads a window's input, seeds the instance or asks for the next window ----
do $$
declare refused integer := 0;
begin
  perform tests.become(tests.account('nosy'));
  begin perform settlement_input(now() - interval '1 day', now()); exception when insufficient_privilege then refused := refused + 1; end;
  begin perform seed_instance('{}'); exception when insufficient_privilege then refused := refused + 1; end;
  begin perform next_settlement_window(now()); exception when insufficient_privilege then refused := refused + 1; end;
  begin perform schedule_settlement(); exception when insufficient_privilege then refused := refused + 1; end;
  perform tests.unbecome();
  if refused <> 4 then raise exception 'a player reached % of the four service functions', 4 - refused; end if;
end $$;
