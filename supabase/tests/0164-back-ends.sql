-- A face-down card's end is the server's (docs/plans/2026-11-11-plain-words-plan.md, Task 8): acts_public answers a set's `ends_at`, the face_down row's, to every
-- reader (the end is the same setting for every back and names no card), and thread_page carries it on the set among a page's plays. An Act that is no set answers null.

select tests.unbecome();
do $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts) values
    ('beend', 'Be End', 'sweet', 'uncommon', 'set', '{"trigger": {"on": "cast"}, "match": {"flavors": ["salty"]}}', '{post}', null)
  on conflict (key) do nothing;
end $$;

select tests.unbecome();
do $$
declare
  ann uuid := tests.account('be-ann'); bob uuid := tests.account('be-bob');
  a uuid := tests.character(ann, 'Be Ann'); b uuid := tests.character(bob, 'Be Bob');
  t uuid := tests.thread('Be thread'); p uuid := tests.post(a, t, 'Backed.'); q uuid := tests.post(b, t, 'Plain.');
  s uuid; own timestamptz := date_trunc('second', now() + interval '41 days'); seen timestamptz; page jsonb; carried text;
begin
  -- An end an admin's setting change left far from the Act's time plus the span.
  s := tests.act(a, 'set', t, '{}', p, now() - interval '1 day');
  insert into face_down (play, account, card, post, thread, round, ends_at) values (s, ann, 'beend', p, t, 1, own);
  foreach carried in array array['bob', 'ann'] loop
    perform tests.become(case carried when 'bob' then bob else ann end);
    seen := (select x.ends_at from acts_public x where x.id = s);
    if seen is distinct from own then raise exception '% reads a set''s ends_at as %, not the row''s %', carried, seen, own; end if;
    page := thread_page(t, 1, null, 50, '{}');
    if (select x ->> 'ends_at' from jsonb_array_elements(page -> 'plays') x where x ->> 'id' = s::text)::timestamptz is distinct from own then
      raise exception '% reads thread_page''s set without its end: %', carried, page -> 'plays';
    end if;
    perform tests.unbecome();
  end loop;
  if exists (select 1 from acts_public x where x.id in (p, q) and x.ends_at is not null) then raise exception 'a post answers an ends_at'; end if;
end $$;

-- The line for a card about to be set says when it would end, from the setting the server answers.
select tests.unbecome();
do $$
declare ann uuid := tests.account('be-set-ann'); got jsonb;
begin
  perform tests.become(ann);
  got := (select x.settings -> 'setLasts' from screen_settings x limit 1);
  if got is distinct from '{"unit": "day", "count": 7}'::jsonb then raise exception 'screen_settings answers setLasts as %', got; end if;
end $$;
