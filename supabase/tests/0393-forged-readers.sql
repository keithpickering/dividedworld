-- The readers of an Act's words pass the Act's verdict (supabase/migrations/0393_forged_quotes.sql, section 2; docs/plans/2026-11-20-forged-quotes-plan.md, Task 2). A real quote of a forged post is a counterfeit,
-- so its words are the poster's own in every reader: the search index and its snippets, a rule's judgment, the words a card writes on, and a card's Says condition. The verdict is the payload's `forged`;
-- Task 3's trigger writes it, so here the test writes it into the payload by hand, as superuser. Each assertion has a twin with no verdict that must read the quote as a quote, so a reader that passes
-- '{}' fails the first and one that always passes the verdict fails the second.

-- ---- act_forged ----
do $$
declare
  a uuid := '0f8fad5b-d9cb-469f-a165-70867728950e';
  b uuid := '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
begin
  if act_forged(jsonb_build_object('forged', jsonb_build_array(a, b))) is distinct from array[a, b] then raise exception 'act_forged does not read the list in order: %', act_forged(jsonb_build_object('forged', jsonb_build_array(a, b))); end if;
  if act_forged('{}') is distinct from '{}'::uuid[] or act_forged(null) is distinct from '{}'::uuid[] then raise exception 'act_forged of a payload with no verdict is not the empty list'; end if;
  if act_forged(jsonb_build_object('forged', 'nope')) is distinct from '{}'::uuid[] or act_forged(jsonb_build_object('forged', jsonb_build_array('nope', 7))) is distinct from '{}'::uuid[] then
    raise exception 'act_forged reads a verdict that is not a list of ids';
  end if;
  if act_forged(jsonb_build_object('forged', jsonb_build_array(upper(a::text), 'junk', b))) is distinct from array[a, b] then
    raise exception 'act_forged does not read an id in capitals, or does not leave out what is no id: %', act_forged(jsonb_build_object('forged', jsonb_build_array(upper(a::text), 'junk', b)));
  end if;
end $$;

-- ---- the search index, an edit read through current_payload, search_posts' snippet, own_words and spring_facts ----
do $$
declare
  au uuid := tests.account('fr-author');
  ch uuid := tests.character(au, 'Fr Author');
  th uuid := tests.thread('Forged readers');
  base timestamptz := now() - interval '1 day';
  q uuid; forged_post uuid; honest_post uuid; edited uuid; ed uuid;
  f spring_facts;
  hits uuid[];
  p jsonb;
begin
  -- The quoted post holds the honest twin's words, so that quote is authentic as the trigger judges it; the forged one's words are in no version.
  q := tests.post(ch, th, 'The quoted post. zqxhonest words', base);
  forged_post := tests.act(ch, 'post', th, jsonb_build_object('body', format('Own words [quote=%s]zqxforged words[/quote] end', q), 'forged', jsonb_build_array(q)), null, base + interval '1 minute');
  honest_post := tests.post(ch, th, format('Own words [quote=%s]zqxhonest words[/quote] end', q), base + interval '2 minutes');

  -- the insert trigger indexes a forged quote's words as the post's own, and an authentic quote's not
  if not exists (select 1 from post_search s where s.act = forged_post and s.words @@ plainto_tsquery(search_lang(), 'zqxforged')) then raise exception 'acts_search does not index a forged quote''s words'; end if;
  if exists (select 1 from post_search s where s.act = honest_post and s.words @@ plainto_tsquery(search_lang(), 'zqxhonest')) then raise exception 'acts_search indexes an authentic quote''s words'; end if;
  -- the row the rest of the readers rebuild it from agrees
  if search_words_of(forged_post, search_lang()) @@ plainto_tsquery(search_lang(), 'zqxforged') is not true then raise exception 'search_words_of does not read the verdict'; end if;
  if search_words_of(honest_post, search_lang()) @@ plainto_tsquery(search_lang(), 'zqxhonest') then raise exception 'search_words_of reads an authentic quote''s words'; end if;
  delete from post_search where act in (forged_post, honest_post);
  perform search_backfill();
  if not exists (select 1 from post_search s where s.act = forged_post and s.words @@ plainto_tsquery(search_lang(), 'zqxforged')) then raise exception 'search_backfill does not read the verdict'; end if;
  if exists (select 1 from post_search s where s.act = honest_post and s.words @@ plainto_tsquery(search_lang(), 'zqxhonest')) then raise exception 'search_backfill indexes an authentic quote''s words'; end if;

  -- search_posts finds the post by those words and its snippet shows them
  select coalesce(array_agg((r ->> 'act')::uuid), '{}') into hits from jsonb_array_elements(search_posts('zqxforged', null, null, null, null, false, null, null, null) -> 'results') r;
  if hits is distinct from array[forged_post] then raise exception 'search_posts does not find a post by a forged quote''s words: %', hits; end if;
  if (search_posts('zqxforged', null, null, null, null, false, null, null, null) -> 'results' -> 0 ->> 'snippet') not like '%zqxforged%' then raise exception 'search_posts'' snippet leaves out a forged quote''s words'; end if;
  select coalesce(array_agg((r ->> 'act')::uuid), '{}') into hits from jsonb_array_elements(search_posts('zqxhonest', null, null, null, null, false, null, null, null) -> 'results') r;
  if honest_post = any (hits) then raise exception 'search_posts finds a post by an authentic quote''s words: %', hits; end if;

  -- an edit whose own payload carries the verdict: the trigger, current_payload and the snippet read it
  edited := tests.post(ch, th, 'Oldword before the edit.', base + interval '3 minutes');
  ed := tests.act(ch, 'edit', th, jsonb_build_object('body', format('Newword [quote=%s]zqxedit words[/quote] end', q), 'forged', jsonb_build_array(q)), edited, base + interval '4 minutes');
  if not exists (select 1 from post_search s where s.act = edited and s.words @@ plainto_tsquery(search_lang(), 'zqxedit')) then raise exception 'acts_search does not read the verdict of an edit'; end if;
  if (select act_forged(a.current_payload) from acts_public a where a.id = edited) is distinct from array[q] then raise exception 'the edit''s verdict is not in current_payload: %', (select a.current_payload from acts_public a where a.id = edited); end if;
  if search_words_of(edited, search_lang()) @@ plainto_tsquery(search_lang(), 'zqxedit') is not true then raise exception 'search_words_of does not read the verdict of an edit'; end if;
  if (search_posts('zqxedit', null, null, null, null, false, null, null, null) -> 'results' -> 0 ->> 'snippet') not like '%zqxedit%' then raise exception 'search_posts'' snippet leaves out an edit''s forged quote words'; end if;

  -- own_words: the words a model or a rule is handed, with every real quote cut out and a counterfeit's kept
  p := (select a.payload from acts a where a.id = forged_post);
  if own_words(p ->> 'body', act_forged(p)) not like '%zqxforged%' then raise exception 'own_words cuts a forged quote out'; end if;
  if own_words(p ->> 'body') like '%zqxforged%' then raise exception 'own_words with no verdict keeps a quote''s words'; end if;

  -- spring_facts: a Says condition reads the post's own words, so a forged quote's are in by_body
  f := spring_facts(null::face_down, 'quote', forged_post, null);
  if f.by_body not like '%zqxforged%' then raise exception 'spring_facts does not read a forged quote''s words as the post''s own: %', f.by_body; end if;
  f := spring_facts(null::face_down, 'quote', honest_post, null);
  if f.by_body like '%zqxhonest%' then raise exception 'spring_facts reads an authentic quote''s words as the post''s own: %', f.by_body; end if;
end $$;

-- ---- rule_breaks and claim_card_writes ----
do $$
declare
  seed jsonb;
  au uuid := tests.account('fr-author2');
  ch uuid := tests.character(au, 'Fr Writer');
  caster uuid := tests.character(tests.account('fr-caster'), 'Fr Caster');
  th uuid;
  base timestamptz := '2032-01-01T00:00:00Z';
  q uuid; forged_post uuid; honest_post uuid; edited uuid; got jsonb;
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'rp-boss',
      'staff', jsonb_build_array(jsonb_build_object('key', 'rp-boss', 'name', 'Rule Boss', 'title', 'Boss', 'signature', 'Hi')),
      'firstStaff', '[]'::jsonb,
      'moves', jsonb_build_array(jsonb_build_object('key', 'setRule', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')),
      'predicates', jsonb_build_array(jsonb_build_object('key', 'bannedWord', 'param', 'word', 'least', 1, 'most', 40, 'plain', 'the word "{param}" is banned'))));
  perform seed_instance(seed);
  th := tests.thread('Forged rules');
  perform set_config('kayfabb.staff_writer', 'on', true);
  perform tests.act((select id from characters where staff = 'rp-boss'), 'move', (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements'),
    jsonb_build_object('kind', 'setRule', 'body', 'A rule.', 'params', jsonb_build_object('board', null, 'predicate', 'bannedWord', 'param', 'zqxbanned', 'band', 'minor')), null, base);
  perform set_config('kayfabb.staff_writer', '', true);
  q := tests.post(ch, th, 'The quoted post. zqxbanned words', base + interval '1 minute');
  edited := tests.post(ch, th, 'Oldword before the edit.', base + interval '1 minute 10 seconds');
  perform tests.act(ch, 'edit', th, jsonb_build_object('body', format('Newword [quote=%s]zqxedit words[/quote] end', q), 'forged', jsonb_build_array(q)), edited, base + interval '1 minute 20 seconds');
  forged_post := tests.act(ch, 'post', th, jsonb_build_object('body', format('Fine words [quote=%s]zqxbanned elsewhere[/quote] end', q), 'forged', jsonb_build_array(q)), null, base + interval '2 minutes');
  honest_post := tests.post(ch, th, format('Fine words [quote=%s]zqxbanned words[/quote] end', q), base + interval '3 minutes');
  if (select count(*) from rule_breaks(forged_post)) is distinct from 1::bigint then raise exception 'rule_breaks does not judge a forged quote''s words as the author''s (% rows)', (select count(*) from rule_breaks(forged_post)); end if;
  if (select count(*) from rule_breaks(honest_post)) is distinct from 0::bigint then raise exception 'rule_breaks judges an authentic quote''s words (% rows)', (select count(*) from rule_breaks(honest_post)); end if;

  -- a card that writes on a post: the version's own words, and the posts shown before it (the latest edit's verdict, else the post's own)
  insert into settings (key, value) values ('oldVoice', 'true') on conflict (key) do update set value = excluded.value;
  insert into settings (key, value) values ('cardWriteSettleSeconds', '0') on conflict (key) do update set value = excluded.value;
  insert into card_kinds (key, name, alignment, rarity, play, stack, writes) values ('fr-scribe', 'Fr Scribe', 'salty', 'uncommon', 'cast', 3, true);
  perform tests.act(caster, 'card', th, jsonb_build_object('card', 'fr-scribe', 'message', '', 'config', '{}'::jsonb, 'layer', 1), forged_post, base + interval '6 minutes');
  perform tests.become_service();
  got := claim_card_writes(5, forged_post);
  perform tests.unbecome();
  if got -> 0 ->> 'body' not like '%zqxbanned%' then raise exception 'claim_card_writes cuts a forged quote out of the words it writes on: %', got; end if;
  if not exists (select 1 from jsonb_array_elements(got -> 0 -> 'before') b where b ->> 'body' like '%zqxedit%') then raise exception 'claim_card_writes does not read the verdict of an edit in the posts before: %', got -> 0 -> 'before'; end if;
end $$;
