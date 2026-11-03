-- A reply passes each card back once (supabase/migrations/0075_reply_passes.sql): the first post in a thread by another character
-- spends every waiting back's reply moment, whatever the card, and springs at most the newest reply trap among them. The cost-at-scale
-- plan, Task 4; the cost-at-scale design, sections 4 and 5. The cards are the engine's test set, never an instance's.

create function pg_temp.cards() returns void language plpgsql as $$
begin
  update settings set value = value || '{"hook.price": 100, "quoter.price": 100, "bluffy.price": 25}' where key = 'economy';
  insert into card_kinds (key, name, alignment, price_setting, rarity, play, trap) values
    ('hook', 'Hook', 'salty', 'hook.price', 'uncommon', 'set', '{"trigger": {"on": "reply"}, "outcome": {"do": "strike", "card": "blot"}}'),
    ('quoter', 'Quoter', 'salty', 'quoter.price', 'uncommon', 'set', '{"trigger": {"on": "quote"}, "outcome": {"do": "strike", "card": "sweetie"}}'),
    ('bluffy', 'Bluffy', 'pepperoni', 'bluffy.price', 'common', 'set', null)
  on conflict (key) do nothing;
end $$;

create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k
$$;

-- What this transaction has read and written so far in the tables a post locks and stamps, one number after another.
create function pg_temp.touched() returns bigint[] language sql as $$
  select array_agg(n order by r, i) from (
    select r, i, case i when 1 then pg_stat_get_xact_tuples_returned(r::regclass) when 2 then pg_stat_get_xact_tuples_fetched(r::regclass)
                        when 3 then pg_stat_get_xact_tuples_inserted(r::regclass) when 4 then pg_stat_get_xact_tuples_updated(r::regclass)
                        else pg_stat_get_xact_tuples_deleted(r::regclass) end as n
    from unnest(array['face_down', 'face_down_reply']) r, generate_series(1, 5) i) s
$$;

create function pg_temp.minus(after bigint[], before bigint[]) returns bigint[] language sql as $$
  select array_agg(a - b order by i) from unnest(after, before) with ordinality u(a, b, i)
$$;

-- ---- Two reply traps: the newest springs, both are passed, and the next post springs nothing ----
do $$
declare
  ann uuid := tests.account('pass-ann');
  bob uuid := tests.account('pass-bob');
  a uuid := tests.character(ann, 'Passed Setter');
  b uuid := tests.character(bob, 'Passer');
  t uuid := tests.thread('Two traps');
  posts uuid[] := '{}';
  nine jsonb;
  ten jsonb;
  hook_5 uuid; hook_8 uuid;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'hook', 'hook');
  for i in 1..8 loop posts := posts || tests.post(case when i in (5, 8) then a else b end, t, 'Post ' || i); end loop;
  perform tests.become_service();
  hook_5 := (set_card(ann, 'hook', a, posts[5], '{}', 0) ->> 'id')::uuid;
  hook_8 := (set_card(ann, 'hook', a, posts[8], '{}', 0) ->> 'id')::uuid;
  perform tests.unbecome();
  perform tests.become(bob);
  nine := post(t, b, 'Post 9', null);
  if (nine -> 'sprung' ->> 'target_act_id')::uuid is distinct from posts[8] then
    raise exception 'the newest reply trap springs on the first post after it: %', nine -> 'sprung';
  end if;
  ten := post(t, b, 'Post 10', null);
  if ten ? 'sprung' then raise exception 'a reply trap an earlier post passed sprang on a later one: %', ten -> 'sprung'; end if;
  perform tests.unbecome();
  if (select count(*) from acts where kind = 'spring' and target_act_id = posts[5]) is distinct from 0::bigint then raise exception 'the older trap sprang'; end if;
  if (select count(*) from face_down_reply where passed_by = (nine ->> 'id')::uuid and play in (hook_5, hook_8)) is distinct from 2::bigint then
    raise exception 'post 9 passed both backs: %', (select jsonb_agg(to_jsonb(r)) from face_down_reply r where play in (hook_5, hook_8));
  end if;
  if (select count(*) from face_down_reply where passed_by is null and play in (hook_5, hook_8)) is distinct from 0::bigint then raise exception 'a back was left waiting'; end if;
end $$;

-- ---- A Bluff, a quote trap and a reply trap are each passed by the first post by another character, alike ----
do $$
declare
  ann uuid := tests.account('alike-ann');
  bob uuid := tests.account('alike-bob');
  a uuid := tests.character(ann, 'Alike Setter');
  b uuid := tests.character(bob, 'Alike Passer');
  cards text[] := array['bluffy', 'quoter', 'hook'];
  k text;
  t uuid; p uuid; set_act uuid; answer jsonb;
  before bigint[]; seen bigint[]; first_seen bigint[];
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'bluffy', 'quoter', 'hook');
  foreach k in array cards loop
    t := tests.thread('Alike ' || k);
    p := tests.post(a, t, 'Backed by ' || k);
    perform tests.become_service();
    set_act := (set_card(ann, k, a, p, '{}', 0) ->> 'id')::uuid;
    perform tests.unbecome();
    perform tests.become(bob);
    before := pg_temp.touched();
    answer := post(t, b, 'The first post by another.', null);
    seen := pg_temp.minus(pg_temp.touched(), before);
    perform tests.unbecome();
    if (select passed_by from face_down_reply where play = set_act) is distinct from (answer ->> 'id')::uuid then raise exception '% was not passed by the first post by another character', k; end if;
    if (select passed_at from face_down_reply where play = set_act) is null then raise exception '% was passed without a time', k; end if;
    if k = 'hook' then
      if not answer ? 'sprung' then raise exception 'the reply trap did not spring on the pass'; end if;
    elsif answer ? 'sprung' then raise exception '% sprang on a pass', k;
    end if;
    -- The same rows read and written for every card, the spring itself aside.
    if first_seen is null then first_seen := seen; end if;
    if seen is distinct from first_seen then raise exception 'a post read or wrote other rows for %: % against %', k, seen, first_seen; end if;
  end loop;
end $$;

-- ---- A post by the back's own author passes nothing; a quote trap that was passed still springs on a quote ----
do $$
declare
  ann uuid := tests.account('own-ann');
  bob uuid := tests.account('own-bob');
  a uuid := tests.character(ann, 'Own Setter');
  a2 uuid := tests.character(ann, 'Own Other Mask');
  b uuid := tests.character(bob, 'Own Passer');
  t uuid := tests.thread('Own post');
  p uuid := tests.post(a, t, 'Quote me later.');
  q uuid := tests.post(a, t, 'And me.');
  quoter_set uuid; bluff_set uuid; answer jsonb;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'quoter', 'bluffy');
  perform tests.become_service();
  quoter_set := (set_card(ann, 'quoter', a, p, '{}', 0) ->> 'id')::uuid;
  bluff_set := (set_card(ann, 'bluffy', a, q, '{}', 0) ->> 'id')::uuid;
  perform tests.unbecome();
  perform tests.become(ann);
  perform post(t, a, 'The author again.', null);
  perform tests.unbecome();
  if (select count(*) from face_down_reply where passed_by is not null and play in (quoter_set, bluff_set)) is distinct from 0::bigint then
    raise exception 'a post by the back''s own author passed a back';
  end if;
  -- Another of the same player's masks is another character: it passes.
  perform tests.become(ann);
  perform post(t, a2, 'The same player, another mask.', null);
  perform tests.unbecome();
  if (select count(*) from face_down_reply where passed_by is not null and play in (quoter_set, bluff_set)) is distinct from 2::bigint then
    raise exception 'another mask of the setter passed nothing';
  end if;
  -- A passed quote trap still springs on a quote.
  perform tests.become(bob);
  answer := post(t, b, 'As you said.', p);
  perform tests.unbecome();
  if answer -> 'sprung' -> 'payload' ->> 'trigger' is distinct from 'quote' then raise exception 'a passed quote trap did not spring on a quote: %', answer; end if;
end $$;

-- ---- A thread with 200 live backs passed long ago: a post reads only what still waits ----
do $$
declare
  ann uuid := tests.account('scale-ann');
  bob uuid := tests.account('scale-bob');
  a uuid := tests.character(ann, 'Scale Setter');
  b uuid := tests.character(bob, 'Scale Passer');
  t uuid := tests.thread('Two hundred backs');
  opener uuid := tests.post(b, t, 'Opener.');
  passing uuid := tests.post(b, t, 'Passed them all.');
  posted uuid; set_act uuid;
  before bigint[]; seen bigint[]; reads bigint;
begin
  perform pg_temp.cards();
  for i in 1..200 loop
    posted := tests.post(a, t, 'Post ' || i);
    set_act := tests.act(a, 'set', t, '{}', posted);
    insert into face_down (play, account, card, post, thread, round, ends_at) values (set_act, ann, 'bluffy', posted, t, 1, now() + interval '5 days');
    insert into face_down_reply (play, thread, passed_by, passed_at) values (set_act, t, passing, now() - interval '1 day');
  end loop;
  perform tests.become(bob);
  before := pg_temp.touched();
  perform post(t, b, 'A new post.', null);
  seen := pg_temp.minus(pg_temp.touched(), before);
  perform tests.unbecome();
  -- face_down returned and fetched, then face_down_reply's.
  reads := seen[1] + seen[2] + seen[6] + seen[7];
  if reads > 20 then raise exception 'a post in a thread of 200 passed backs read % rows of the backs; it reads only what waits: %', reads, seen; end if;
end $$;
