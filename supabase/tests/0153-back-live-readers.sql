-- Readers of a live back (supabase/migrations/0146_card_types.sql, Task 4 review): a back is live only while unsprung, not taken back and before its time, so lock_for_quote (post()'s and
-- write_staff_act's locks) neither locks nor returns a taken-back back, and log_page says how each ended back ended (setEnds[].ended_by). The cards are this file's own (lq...).

select tests.unbecome();
do $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts) values
    ('lqmatch', 'Lq Match', 'sweet', 'uncommon', 'set', '{"trigger": {"on": "cast"}, "match": {"flavors": ["salty"]}}', '{post}', null)
  on conflict (key) do nothing;
end $$;

select tests.unbecome();
do $$
declare
  ann uuid := tests.account('lq-ann'); bob uuid := tests.account('lq-bob');
  a uuid := tests.character(ann, 'Lq Ann'); b uuid := tests.character(bob, 'Lq Bob');
  t uuid := tests.thread('Lq thread'); p uuid := tests.post(a, t, 'Backed.'); q uuid := tests.post(b, t, 'Quoting.', now());
  back uuid; locked uuid[];
begin
  insert into card_ledger (account, card, kind, price) values (ann, 'lqmatch', 'bought', 0);
  perform tests.become_service();
  back := (set_card(ann, 'lqmatch', a, p, '{}', 0) ->> 'id')::uuid;
  perform tests.unbecome();
  locked := lock_for_quote(b, t, p);
  if locked is distinct from array[back] then raise exception 'a live back was not locked: %', locked; end if;
  perform tests.become_service();
  perform take_back(ann, a, back);
  perform tests.unbecome();
  locked := lock_for_quote(b, t, p);
  if locked is distinct from '{}'::uuid[] then raise exception 'a taken-back back was locked and returned: %', locked; end if;
end $$;

select tests.unbecome();
do $$
declare
  ann uuid := tests.account('lq-l-ann'); a uuid := tests.character(ann, 'Lq L Ann');
  t uuid := tests.thread('Lq log');
  p1 uuid := tests.post(a, t, 'Time.'); p2 uuid := tests.post(a, t, 'Taken.'); p3 uuid := tests.post(a, t, 'Sprang.');
  s uuid; sp uuid; ends timestamptz := now() - interval '1 day'; ends_by jsonb;
begin
  s := tests.act(a, 'set', t, '{}', p1, now() - interval '3 days');
  insert into face_down (play, account, card, post, thread, round, ends_at) values (s, ann, 'lqmatch', p1, t, 1, ends);
  s := tests.act(a, 'set', t, '{}', p2, now() - interval '3 days');
  insert into face_down (play, account, card, post, thread, round, ends_at) values (s, ann, 'lqmatch', p2, t, 1, ends);
  sp := tests.act(a, 'take_back', t, jsonb_build_object('set', s::text), p2, now() - interval '2 days');
  s := tests.act(a, 'set', t, '{}', p3, now() - interval '3 days');
  insert into face_down (play, account, card, post, thread, round, ends_at) values (s, ann, 'lqmatch', p3, t, 1, ends);
  sp := tests.act(a, 'spring', t, jsonb_build_object('card', 'lqmatch', 'trigger', 'cast', 'did', 'caught', 'set', s::text, 'by', gen_random_uuid()::text), p3, now() - interval '2 days');
  perform tests.become(ann);
  ends_by := (select jsonb_object_agg(x ->> 'post', x ->> 'ended_by') from jsonb_array_elements(log_page(null) #> '{sources,setEnds}') x);
  perform tests.unbecome();
  if ends_by is distinct from jsonb_build_object(p1::text, 'time', p2::text, 'taken back', p3::text, 'sprung') then raise exception 'log_page setEnds ended_by: % of %', ends_by, (log_page(null) #> '{sources,setEnds}'); end if;
end $$;
