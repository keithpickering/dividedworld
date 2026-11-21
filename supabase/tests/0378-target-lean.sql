-- What the lean reads (supabase/migrations/0378_target_lean.sql; docs/plans/2026-11-18-face-thunder-plan.md, Task 2; models: 0376-cushion.sql and 0048-staff.sql).
-- A card or spring played in the window is scored against the Act it lies on and, for a spring, the cast it caught (`by`). settlement_input sends those Acts' earlier reactions whether or not a reaction reached them in
-- the window, and names a staff cast a window spring caught as an unscored target with its card; estimate_input carries the reactions on a cast the caller's window spring caught, keyed under per-mask keys like every
-- other. Nothing a window play is scored against adds a `paid` row: a vote is paid only where a reaction reached the Act in the window. The card keys are this file's own (tl...); no card kind is seeded for them, since nothing asserted here turns on one.

create function pg_temp.entry(input jsonb, id uuid) returns jsonb language sql as $$
  select e from jsonb_array_elements(input -> 'acts') e where e ->> 'id' = id::text
$$;
create function pg_temp.reactions_on(input jsonb, act uuid) returns jsonb language sql as $$
  select coalesce(jsonb_agg(e), '[]') from jsonb_array_elements(input -> 'reactions') e where e ->> 'act' = act::text
$$;
create function pg_temp.ms(t timestamptz) returns bigint language sql as $$ select (extract(epoch from t) * 1000)::bigint $$;

-- ---- A card played in the window on a post whose only reactions are before it: the reactions and the post are in the input, and nothing is paid for them ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('tl-ann'); bob uuid := tests.account('tl-bob'); cat uuid := tests.account('tl-cat');
  a uuid := tests.character(ann, 'Tl Ann'); b uuid := tests.character(bob, 'Tl Bob'); c uuid := tests.character(cat, 'Tl Cat');
  s1 constant timestamptz := (select min(starts_at) from seasons);
  w0 timestamptz; w1 timestamptz;
  t uuid := tests.thread('Tl settlement thread');
  pa uuid; played uuid; input jsonb; got jsonb;
begin
  if not exists (select 1 from settlements) then
    perform set_config('role', 'service_role', true);
    perform apply_settlement(s1, s1 + interval '1 day', '[]');
    perform tests.unbecome();
  end if;
  w0 := (select max(ends_at) from settlements); w1 := w0 + interval '1 day';
  pa := tests.post(a, t, 'Ann''s post.', w0 - interval '20 hours');
  -- The room's reaction, a window ago; and what an earlier window paid for it, which a settlement carries only where a reaction reaches the Act again.
  insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values (pa, c, cat, 'up', 1, w0 - interval '10 hours');
  insert into paid_votes (account, act, weight, shares, settlement) values (cat, pa, 1, '{"excitedPositive": 1}', (select max(id) from settlements));
  played := tests.act(b, 'card', t, jsonb_build_object('card', 'tlcard', 'message', '', 'config', '{}'::jsonb), pa, w0 + interval '2 hours');

  input := settlement_input(w0, w1);
  if pg_temp.entry(input, pa) is null then raise exception 'the post a window card landed on is not in the input'; end if;
  got := pg_temp.reactions_on(input, pa);
  if jsonb_array_length(got) is distinct from 1 or (got -> 0 ->> 'at')::bigint is distinct from pg_temp.ms(w0 - interval '10 hours') then
    raise exception 'a post a window card landed on, reacted to only before the window, does not carry its earlier reactions: %', got;
  end if;
  -- Paid nothing: no reaction reached it in the window, so the earlier window's paid vote is not carried and no amount can move.
  if exists (select 1 from jsonb_array_elements(input -> 'paid') p where p ->> 'act' = pa::text) then
    raise exception 'the earlier reactions on a scored Act brought a paid row with them: %', input -> 'paid';
  end if;
end $$;

-- ---- A spring whose `by` is a staff cast: the cast is an unscored target with its card; the reactions on a staff cast the spring caught are read ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('tl-ann2'); bob uuid := tests.account('tl-bob2'); cat uuid := tests.account('tl-cat2');
  a uuid := tests.character(ann, 'Tl Ann Two'); b uuid := tests.character(bob, 'Tl Bob Two'); c uuid := tests.character(cat, 'Tl Cat Two');
  boss uuid;
  s1 constant timestamptz := (select min(starts_at) from seasons);
  w0 timestamptz; w1 timestamptz;
  t uuid := tests.thread('Tl staff thread');
  pb uuid; scast uuid; spr uuid; sset uuid; sset2 uuid; decree uuid; plain uuid; plain_card uuid; input jsonb; est jsonb; got jsonb; target jsonb;
begin
  if not exists (select 1 from settlements) then
    perform set_config('role', 'service_role', true);
    perform apply_settlement(s1, s1 + interval '1 day', '[]');
    perform tests.unbecome();
  end if;
  w0 := (select max(ends_at) from settlements); w1 := w0 + interval '1 day';
  insert into characters (name, staff, staff_kind, debuted_at) values ('Tl Boss', 'tl-bot', 'persona', now()) returning id into boss;
  pb := tests.post(a, t, 'Ann''s post.', w0 - interval '20 hours');
  perform set_config('kayfabb.staff_writer', 'on', true);
  -- The staff cast, made before the window with the reaction the room gave it; and a staff post a window card lands on, as 0054's decree is.
  scast := tests.act(boss, 'card', t, jsonb_build_object('card', 'tlsalty', 'message', '', 'config', '{}'::jsonb), pb, w0 - interval '5 hours');
  decree := tests.act(boss, 'post', t, jsonb_build_object('body', 'A decree.'), null, w0 - interval '4 hours');
  perform set_config('kayfabb.staff_writer', '', true);
  insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values (scast, c, cat, 'wow', 1, w0 - interval '3 hours');
  -- Ann's Sweet spring in the window, on her own post (a set is its author's), that caught the staff cast; and Ann's card on the decree.
  sset := tests.act(a, 'set', t, '{}', pb, w0 + interval '3 hours');
  spr := tests.act(a, 'spring', t, jsonb_build_object('card', 'tlsweet', 'trigger', 'cast', 'did', 'caught', 'set', sset::text, 'by', scast::text, 'caught', scast::text), pb, w0 + interval '4 hours');
  perform tests.act(a, 'card', t, jsonb_build_object('card', 'tlcard', 'message', '', 'config', '{}'::jsonb), decree, w0 + interval '5 hours');
  -- A plain cast of Bob's on another post of Ann's, with the reaction the room gave it before the window, caught by Ann's window spring, for the estimate.
  plain := tests.post(a, t, 'Ann''s other post.', w0 - interval '19 hours');
  plain_card := tests.act(b, 'card', t, jsonb_build_object('card', 'tlsalty', 'message', '', 'config', '{}'::jsonb), plain, w0 - interval '6 hours');
  insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values (plain_card, c, cat, 'wow', 2, w0 - interval '2 hours');
  sset2 := tests.act(a, 'set', t, '{}', plain, w0 + interval '5 hours 30 minutes');
  perform tests.act(a, 'spring', t, jsonb_build_object('card', 'tlsweet', 'trigger', 'cast', 'did', 'caught', 'set', sset2::text, 'by', plain_card::text, 'caught', plain_card::text), plain, w0 + interval '6 hours');

  input := settlement_input(w0, w1);
  select x into target from jsonb_array_elements(input -> 'unscoredTargets') x where x ->> 'id' = scast::text;
  if target is null then raise exception 'the staff cast a window spring caught is not an unscored target: %', input -> 'unscoredTargets'; end if;
  if target ->> 'card' is distinct from 'tlsalty' or (target ->> 'staff')::boolean is not true then raise exception 'the staff cast is not named with its card: %', target; end if;
  got := pg_temp.reactions_on(input, scast);
  if jsonb_array_length(got) is distinct from 1 then raise exception 'the earlier reactions on a staff cast a window spring caught are not in the input: %', got; end if;
  if exists (select 1 from jsonb_array_elements(input -> 'paid') p where p ->> 'act' = scast::text) then raise exception 'a paid row for the staff cast'; end if;
  select x into target from jsonb_array_elements(input -> 'unscoredTargets') x where x ->> 'id' = decree::text;
  if target is null or target ? 'card' then raise exception 'a staff post (no card play) is missing from the unscored targets or carries a card: %', target; end if;

  -- The estimate for the setter: the reactions on a cast a window spring of hers caught, under keys made up for the request.
  perform tests.become_service();
  est := estimate_input(ann, w0 + interval '8 hours');
  got := pg_temp.reactions_on(est, plain_card);
  if jsonb_array_length(got) is distinct from 1 then raise exception 'the estimate does not hold the reactions on the cast the caller''s window spring caught: %', got; end if;
  if got -> 0 ->> 'character' = c::text or got -> 0 ->> 'player' = cat::text then raise exception 'the estimate names the reactor of the cast: %', got; end if;
  -- A bystander with no spring of his own is handed none of it.
  est := estimate_input(cat, w0 + interval '8 hours');
  if jsonb_array_length(pg_temp.reactions_on(est, plain_card)) <> 0 then raise exception 'a bystander''s estimate holds the reactions on a cast only another player''s spring caught: %', pg_temp.reactions_on(est, plain_card); end if;
  perform tests.unbecome();
end $$;

-- ---- An input with no card plays is what it was: the reactions on the Acts reacted to, the earlier ones too, and nothing else new ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('tl-ann3'); cat uuid := tests.account('tl-cat3');
  a uuid := tests.character(ann, 'Tl Ann Three'); c uuid := tests.character(cat, 'Tl Cat Three');
  s1 constant timestamptz := (select min(starts_at) from seasons);
  w0 timestamptz; w1 timestamptz;
  t uuid := tests.thread('Tl plain thread');
  p1 uuid; p2 uuid; unrelated uuid; input jsonb; expected jsonb;
begin
  if not exists (select 1 from settlements) then
    perform set_config('role', 'service_role', true);
    perform apply_settlement(s1, s1 + interval '1 day', '[]');
    perform tests.unbecome();
  end if;
  -- Two days past the settled end: the file's earlier sections (one transaction) left their plays in the days after it.
  w0 := (select max(ends_at) from settlements) + interval '2 days'; w1 := w0 + interval '1 day';
  p1 := tests.post(a, t, 'One.', w0 - interval '20 hours');
  p2 := tests.post(a, t, 'Two.', w0 + interval '1 hour');
  unrelated := tests.post(a, t, 'Unrelated.', w0 - interval '19 hours');
  insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values
    (p1, c, cat, 'up', 1, w0 - interval '10 hours'), (p1, c, cat, 'wow', 2, w0 + interval '2 hours'), (p2, c, cat, 'up', 3, w0 + interval '3 hours'),
    (unrelated, c, cat, 'up', 4, w0 - interval '9 hours');
  input := settlement_input(w0, w1);
  -- What 0376 sent, for this file's own Acts (a committed file may leave others in the window): every reaction on an Act reacted to in the window, the earlier ones too, and none on an Act nothing reached.
  select coalesce(jsonb_agg(format('%s|%s|%s|%s', r.act, r.kind, pg_temp.ms(r.created_at), r.reactor_character) order by r.id), '[]') into expected from reactions r
  where r.act in (p1, p2) and r.created_at < w1;
  if (select coalesce(jsonb_agg(x order by x), '[]') from (select format('%s|%s|%s|%s', e ->> 'act', e ->> 'kind', e ->> 'at', e ->> 'character') x from jsonb_array_elements(input -> 'reactions') e where e ->> 'act' in (p1::text, p2::text, unrelated::text)) q)
     is distinct from (select coalesce(jsonb_agg(x order by x), '[]') from (select e #>> '{}' x from jsonb_array_elements(expected) e) q) then
    raise exception 'an input with no card plays sends other reactions than the Acts reacted to: %', input -> 'reactions';
  end if;
  if pg_temp.reactions_on(input, unrelated) <> '[]' then raise exception 'reactions on an Act nothing reached are in an input with no card plays'; end if;
  if input -> 'unscoredTargets' <> '[]' then raise exception 'an input with no card plays names unscored targets: %', input -> 'unscoredTargets'; end if;
  if input -> 'paid' <> '[]' then raise exception 'an input with no earlier payments names paid votes: %', input -> 'paid'; end if;
  -- The input's keys are the keys 0376 sent, and `quotes` (0390) and `tallied` (0398).
  if (select array_agg(k order by k) from jsonb_object_keys(input) k) is distinct from array['acts', 'characters', 'paid', 'quotes', 'reactions', 'scoredAs', 'systemActs', 'tallied', 'unscoredTargets', 'window'] then
    raise exception 'the input''s keys changed: %', (select array_agg(k order by k) from jsonb_object_keys(input) k);
  end if;
end $$;
