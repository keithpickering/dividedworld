-- What a post shows in its content area, for the act function to hold a draw's frame to (supabase/migrations/0456_surface_coats.sql; issue #1259): every version of the post's words, oldest first, the signature it is shown
-- with, its current poll (null once removed), and null for an Act that is no post. The service role's alone.

select tests.unbecome();

do $$
declare
  ann uuid := tests.account('fr-ann');
  bob uuid := tests.account('fr-bob');
  a uuid := tests.character(ann, 'Fr Ann');
  b uuid := tests.character(bob, 'Fr Bob');
  t uuid := tests.thread('Fr thread');
  post uuid;
  e1 uuid;
  poll uuid;
  plain uuid;
  got jsonb;
  denied text;
begin
  post := tests.post(a, t, 'First words.', now() - interval '2 minutes');
  insert into character_profiles ("character", signature) values (a, 'My [b]sig[/b] [img]https://fr.test/banner.png[/img]')
    on conflict ("character") do update set signature = excluded.signature;
  perform tests.become_service();
  got := surface_frame_of(post);
  perform tests.unbecome();
  if got is distinct from jsonb_build_object('kind', 'post', 'versions', jsonb_build_array(jsonb_build_object('body', 'First words.', 'forged', '[]'::jsonb)),
       'signature', 'My [b]sig[/b] [img]https://fr.test/banner.png[/img]', 'poll', null) then
    raise exception 'a post with no edits and no poll gives its words and its signature: %', got;
  end if;

  -- Two edits and a poll: every version, oldest first, and the poll's question and options.
  e1 := tests.act(a, 'edit', t, '{"body": "Second, longer words."}', post, now() - interval '1 minute');
  perform tests.act(a, 'edit', t, '{"body": "Third."}', post, now());
  poll := tests.act(a, 'poll', t, jsonb_build_object('question', 'Best kart?', 'options', '["Pipe Frame", "Badwagon"]'::jsonb, 'pick', 1, 'secret', false, 'closes_at', now() + interval '1 day'), post);
  perform tests.become_service();
  got := surface_frame_of(post);
  perform tests.unbecome();
  if got -> 'versions' is distinct from jsonb_build_array(jsonb_build_object('body', 'First words.', 'forged', '[]'::jsonb), jsonb_build_object('body', 'Second, longer words.', 'forged', '[]'::jsonb), jsonb_build_object('body', 'Third.', 'forged', '[]'::jsonb)) then
    raise exception 'every version, oldest first: %', got -> 'versions';
  end if;
  if got -> 'poll' is distinct from jsonb_build_object('question', 'Best kart?', 'options', '["Pipe Frame", "Badwagon"]'::jsonb) then raise exception 'the current poll: %', got -> 'poll'; end if;

  -- A removed poll is none; another post's edits are not this post's.
  perform tests.act(a, 'poll', t, '{"removed": true}', post, now() + interval '1 second');
  perform tests.act(b, 'edit', t, '{"body": "Bob words."}', tests.post(b, t, 'Bob post.'));
  perform tests.become_service();
  got := surface_frame_of(post);
  perform tests.unbecome();
  if got -> 'poll' is distinct from 'null'::jsonb or jsonb_array_length(got -> 'versions') is distinct from 3 then raise exception 'a removed poll is none, and only this post''s versions: %', got; end if;

  -- A character with no profile row has an empty signature; an Act that is no post, and no Act at all, give null.
  plain := tests.post(b, t, 'Plain.');
  perform tests.become_service();
  if surface_frame_of(plain) ->> 'signature' is distinct from '' then raise exception 'no profile, no signature'; end if;
  if surface_frame_of(e1) is not null or surface_frame_of(poll) is not null or surface_frame_of(gen_random_uuid()) is not null then raise exception 'an edit, a poll and nothing give null'; end if;
  perform tests.unbecome();

  -- The service role's alone.
  perform tests.become(bob);
  begin
    perform surface_frame_of(post);
    denied := 'called';
  exception when insufficient_privilege then
    denied := 'denied';
  end;
  perform tests.unbecome();
  if denied is distinct from 'denied' then raise exception 'a player does not call surface_frame_of'; end if;
end $$;
