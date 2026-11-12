-- What reads a post's words for a model or a card's condition reads what a player would (supabase/migrations/0236_conduct.sql, which re-creates
-- 0105's rule_breaks and 0144's spring_facts; the conduct plan, Task 2): a Mod Bot's rule and a visit's draw find nothing wrong with a hidden
-- post, which would otherwise be a way to measure words an admin hid, and a card's Says condition cannot match them.

do $$
declare
  seed jsonb;
  admin_a uuid := tests.account('admin-a');
  author uuid := tests.account('author');
  ch_author uuid := tests.character(author, 'Ada');
  th uuid;
  shout uuid;
  rule uuid;
  base timestamptz := now() - interval '1 day';
  n integer;
  f spring_facts;
  quoting uuid;
  hid_post uuid;
  plain_q uuid;
  loud uuid; long_reply uuid; short_reply uuid; secret_quote uuid; open_quote uuid;
  r1 integer; r2 integer;
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'rp-boss',
      'staff', jsonb_build_array(jsonb_build_object('key', 'rp-boss', 'name', 'Rule Boss', 'title', 'Boss', 'signature', 'Hi')),
      'firstStaff', '[]'::jsonb,
      'moves', jsonb_build_array(jsonb_build_object('key', 'setRule', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')),
      'predicates', jsonb_build_array(
        jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts'),
        jsonb_build_object('key', 'minLength', 'param', 'count', 'least', 1, 'most', 200, 'plain', 'posts of at least {param} characters'),
        jsonb_build_object('key', 'bannedWord', 'param', 'word', 'least', 1, 'most', 40, 'plain', 'the word "{param}" is banned'))));
  perform seed_instance(seed);
  insert into admins (account) values (admin_a);
  th := tests.thread('Shouting');

  -- A rule in force against all-caps posts, landed as the tick would.
  perform set_config('kayfabb.staff_writer', 'on', true);
  rule := tests.act((select id from characters where staff = 'rp-boss'), 'move', (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements'),
    jsonb_build_object('kind', 'setRule', 'body', 'A rule.', 'params', jsonb_build_object('board', null, 'predicate', 'noAllCaps', 'band', 'minor')), null, base);
  perform set_config('kayfabb.staff_writer', '', true);

  shout := tests.post(ch_author, th, 'THIS IS ALL IN CAPITALS AND LOUD', base + interval '1 minute');
  select count(*) into n from rule_breaks(shout);
  if n is distinct from 1 then raise exception 'the planted rule does not fire on an all-caps post, so the test below proves nothing (% rows)', n; end if;

  -- Hidden, the post's words are not judged.
  perform tests.become(admin_a);
  perform decide(null, shout, 'hide', null, 'model reads');
  perform tests.unbecome();
  select count(*) into n from rule_breaks(shout);
  if n is distinct from 0 then raise exception 'rule_breaks still judges the words of a hidden post (% rows)', n; end if;
  perform tests.become(admin_a);
  perform decide(null, shout, 'unhide', null, '');
  perform tests.unbecome();
  select count(*) into n from rule_breaks(shout);
  if n is distinct from 1 then raise exception 'rule_breaks does not judge a post again once it is unhidden (% rows)', n; end if;

  -- ---- A card's condition reads the quoting post through the public form ----
  -- spring_facts needs no back to read the Act that met it (a null back is the call 0135 times too), and `by_body` is what the Says phrase is matched against.
  hid_post := tests.post(ch_author, th, 'The hidden secret.', base + interval '3 minutes');
  quoting := tests.post(ch_author, th, 'Plain words with the zebra phrase.', base + interval '4 minutes');
  f := spring_facts(null::face_down, 'quote', quoting, null);
  if f.by_body is distinct from 'Plain words with the zebra phrase.' then raise exception 'spring_facts does not read a post nobody hid: %', f.by_body; end if;
  perform tests.become(admin_a);
  perform decide(null, quoting, 'hide', null, 'condition');
  perform tests.unbecome();
  f := spring_facts(null::face_down, 'quote', quoting, null);
  if f.by_body is not null then raise exception 'spring_facts reads the words of a hidden post: %', f.by_body; end if;
  -- A post that quotes a hidden one: the quoted words are emptied.
  perform tests.become(admin_a);
  perform decide(null, hid_post, 'hide', null, 'condition');
  perform tests.unbecome();
  quoting := tests.post(ch_author, th, format('Mine [quote=%s]The hidden secret.[/quote] end', hid_post), base + interval '5 minutes');
  f := spring_facts(null::face_down, 'quote', quoting, null);
  if f.by_body like '%secret%' then raise exception 'spring_facts reads a hidden post''s words through a quote: %', f.by_body; end if;

  -- ---- A post that quotes a hidden one is judged on its own words, as soon as it is written and after its layer: the quote is neither a way out of a rule nor a way in ----
  -- (rules and traps run in the posting transaction, before the conceal job has made the layer, when the public form of such a post is withheld.) hid_post is hidden here.
  perform set_config('kayfabb.staff_writer', 'on', true);
  perform tests.act((select id from characters where staff = 'rp-boss'), 'move', (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements'),
    jsonb_build_object('kind', 'setRule', 'body', 'A rule.', 'params', jsonb_build_object('board', null, 'predicate', 'minLength', 'param', 20, 'band', 'minor')), null, base + interval '6 minutes');
  perform tests.act((select id from characters where staff = 'rp-boss'), 'move', (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements'),
    jsonb_build_object('kind', 'setRule', 'body', 'A rule.', 'params', jsonb_build_object('board', null, 'predicate', 'bannedWord', 'param', 'secret', 'band', 'minor')), null, base + interval '7 minutes');
  perform set_config('kayfabb.staff_writer', '', true);
  -- the rules are those, and a post of its own words that breaks none breaks none
  plain_q := tests.post(ch_author, th, 'A calm post with enough words of its own.', base + interval '8 minutes');
  select count(*) into n from rule_breaks(plain_q);
  if n is distinct from 0 then raise exception 'a calm post of 40 characters breaks % rules, so the tests below prove nothing', n; end if;

  loud := tests.post(ch_author, th, format('I AM SHOUTING AT EVERYONE HERE[quote=%s]the hidden secret quietly and slowly spoken aloud in many words[/quote]', hid_post), base + interval '9 minutes');
  select count(*) into n from rule_breaks(loud);
  if n is distinct from 1 or (select predicate from rule_breaks(loud)) is distinct from 'noAllCaps' then raise exception 'a shouting post that quotes a hidden one is immune to noAllCaps, or breaks another rule: % (%)', n, (select string_agg(predicate, ',') from rule_breaks(loud)); end if;
  long_reply := tests.post(ch_author, th, format('This reply has plenty of words of its own[quote=%s]x[/quote]', hid_post), base + interval '10 minutes');
  select count(*) into n from rule_breaks(long_reply);
  if n is distinct from 0 then raise exception 'a long reply that quotes a hidden post breaks % rules (minLength judged the withheld form?): %', n, (select string_agg(predicate, ',') from rule_breaks(long_reply)); end if;
  short_reply := tests.post(ch_author, th, format('ok[quote=%s]a long long long long long long quote[/quote]', plain_q), base + interval '11 minutes');
  select count(*) into n from rule_breaks(short_reply);
  if n is distinct from 1 or (select predicate from rule_breaks(short_reply)) is distinct from 'minLength' then raise exception 'a short reply is not short because it quotes a long post: % (%)', n, (select string_agg(predicate, ',') from rule_breaks(short_reply)); end if;
  -- no word of a quote, hidden or not, is read by a rule: bannedWord 'secret' is in the quoted words and nowhere else
  secret_quote := tests.post(ch_author, th, format('Fine words of my own here[quote=%s]the hidden secret quietly[/quote]', hid_post), base + interval '12 minutes');
  select count(*) into n from rule_breaks(secret_quote);
  if n is distinct from 0 then raise exception 'a rule read the words of a hidden post through a quote (%)', (select string_agg(predicate, ',') from rule_breaks(secret_quote)); end if;
  open_quote := tests.post(ch_author, th, format('Fine words of my own here[quote=%s]a secret nobody hid[/quote]', plain_q), base + interval '13 minutes');
  select count(*) into n from rule_breaks(open_quote);
  if n is distinct from 0 then raise exception 'a rule read the quoted words of a post nobody hid (%)', (select string_agg(predicate, ',') from rule_breaks(open_quote)); end if;
  -- a card's condition reads the same: nothing of the hidden words, and the post's own words whole
  f := spring_facts(null::face_down, 'quote', secret_quote, null);
  if f.by_body like '%secret%' or f.by_body is distinct from 'Fine words of my own here' then raise exception 'spring_facts reads % of a post that quotes a hidden one (before its layer)', f.by_body; end if;
  -- after the layer the answers are the same
  perform tests.become_service();
  perform record_layer(loud, array[hid_post], format('I AM SHOUTING AT EVERYONE HERE[quote=%s][/quote]', hid_post));
  perform record_layer(secret_quote, array[hid_post], format('Fine words of my own here[quote=%s][/quote]', hid_post));
  perform tests.unbecome();
  select count(*) into n from rule_breaks(loud);
  select count(*) into r1 from rule_breaks(secret_quote);
  if n is distinct from 1 or r1 is distinct from 0 then raise exception 'rule_breaks changes with the layer: % and % rows', n, r1; end if;
end $$;

-- ---- A card that writes reads the version it writes on through the public form (0149's claim_card_writes, re-created by 0341) ----
do $$
declare
  admin_a uuid := tests.account('admin-w');
  author uuid := tests.account('author-w');
  ch_author uuid := tests.character(author, 'Wren');
  caster uuid := tests.character(tests.account('caster-w'), 'Cas');
  th uuid := tests.thread('Writing');
  base timestamptz := '2030-01-01T00:00:00Z';
  wpost uuid;
  got jsonb;
begin
  insert into admins (account) values (admin_a);
  insert into settings (key, value) values ('oldVoice', 'true') on conflict (key) do update set value = excluded.value;
  insert into settings (key, value) values ('cardWriteSettleSeconds', '0') on conflict (key) do update set value = excluded.value;
  insert into card_kinds (key, name, alignment, rarity, play, stack, writes) values ('mr-scribe', 'Scribe', 'salty', 'uncommon', 'cast', 3, true);
  wpost := tests.post(ch_author, th, 'The words only the author may keep.', base);
  perform tests.act(caster, 'card', th, jsonb_build_object('card', 'mr-scribe', 'message', '', 'config', '{}'::jsonb, 'layer', 1), wpost, base + interval '1 minute');
  perform tests.become_service();
  got := claim_card_writes(5, wpost);
  perform tests.unbecome();
  if got -> 0 ->> 'body' is distinct from 'The words only the author may keep.' then raise exception 'the claim does not carry a visible post''s words, so the test below proves nothing: %', got; end if;
  update card_writes set claimed_until = null where post = wpost;
  perform tests.become(admin_a);
  perform decide(null, wpost, 'hide', null, 'writes');
  perform tests.unbecome();
  perform tests.become_service();
  got := claim_card_writes(5, wpost);
  perform tests.unbecome();
  if jsonb_array_length(got) is distinct from 1 or got -> 0 ->> 'body' is distinct from '' then
    raise exception 'claim_card_writes sends a model the words of a hidden version: %', got;
  end if;
end $$;

-- ---- A card that writes on a post that quotes a hidden one, before the conceal job has written its layer (public_payload is null then) ----
-- The model is handed the post's own words with every quote cut out, never anyone's quoted words; the posts shown before it are read the same; a hidden version yields nothing.
do $$
declare
  admin_a uuid := tests.account('admin-q');
  author uuid := tests.account('author-q');
  ch_author uuid := tests.character(author, 'Quin');
  caster uuid := tests.character(tests.account('caster-q'), 'Qas');
  th uuid := tests.thread('Quoting');
  base timestamptz := '2031-01-01T00:00:00Z';
  secret uuid; earlier uuid; qpost uuid;
  got jsonb;
begin
  insert into admins (account) values (admin_a);
  insert into settings (key, value) values ('oldVoice', 'true') on conflict (key) do update set value = excluded.value;
  insert into settings (key, value) values ('cardWriteSettleSeconds', '0') on conflict (key) do update set value = excluded.value;
  insert into card_kinds (key, name, alignment, rarity, play, stack, writes) values ('mr-scribe-q', 'Scribe Q', 'salty', 'uncommon', 'cast', 3, true) on conflict do nothing;
  secret := tests.post(ch_author, th, 'The hidden secret words.', base);
  perform tests.become(admin_a);
  perform decide(null, secret, 'hide', null, 'quoted');
  perform tests.unbecome();
  earlier := tests.post(ch_author, th, format('Earlier own words [quote=%s]hidden secret words[/quote] done', secret), base + interval '1 minute');
  qpost := tests.post(ch_author, th, format('Own words of the quoting post [quote=%s]The hidden secret words.[/quote] and the end', secret), base + interval '2 minutes');
  perform tests.act(caster, 'card', th, jsonb_build_object('card', 'mr-scribe-q', 'message', '', 'config', '{}'::jsonb, 'layer', 1), qpost, base + interval '3 minutes');
  if (select concealing from acts_public where id = qpost) is not true then raise exception 'the quoting post is not concealing before its layer, so the test below proves nothing'; end if;
  perform tests.become_service();
  got := claim_card_writes(5, qpost);
  perform tests.unbecome();
  if jsonb_array_length(got) is distinct from 1 or got -> 0 ->> 'body' is distinct from 'Own words of the quoting post  and the end' or got -> 0 ->> 'body' ilike '%secret%' then
    raise exception 'claim_card_writes does not hand the model a quoting post''s own words with the quote cut out: %', got;
  end if;
  if got -> 0 #>> '{before,0,body}' is distinct from '' or got -> 0 #>> '{before,1,body}' is distinct from 'Earlier own words  done' or got::text ilike '%secret%' then
    raise exception 'claim_card_writes hands the model a hidden neighbor''s words, a quoting neighbor empty, or a word of a hidden post: %', got;
  end if;
  -- a hidden version of the quoting post yields nothing
  update card_writes set claimed_until = null where post = qpost;
  perform tests.become(admin_a);
  perform decide(null, qpost, 'hide', null, 'writes');
  perform tests.unbecome();
  perform tests.become_service();
  got := claim_card_writes(5, qpost);
  perform tests.unbecome();
  if jsonb_array_length(got) is distinct from 1 or got -> 0 ->> 'body' is distinct from '' then raise exception 'claim_card_writes sends the words of a hidden quoting post: %', got; end if;
end $$;

-- ---- A back's Quotes condition does not read a hidden post's words through a quote of it (0340's spring_facts: the excerpt is emptied while the back's own post is hidden) ----
-- The phrase is found in the quoted words alone. The back sits on the post that is quoted, so while an admin has it hidden its words must not match, and once it is shown again they do.
do $$
declare
  admin_a uuid := tests.account('admin-p');
  author uuid := tests.account('author-p');
  ch_author uuid := tests.character(author, 'Pia');
  th uuid := tests.thread('Passage');
  base timestamptz := '2032-01-01T00:00:00Z';
  hid uuid; quoter uuid;
  fd face_down;
  f spring_facts;
begin
  insert into admins (account) values (admin_a);
  hid := tests.post(ch_author, th, 'Only the hidden words say quokka parade.', base);
  quoter := tests.post(ch_author, th, format('My own words [quote=%s]Only the hidden words say quokka parade.[/quote] and no more', hid), base + interval '1 minute');
  fd.play := gen_random_uuid(); fd.post := hid; fd.passage := 'quokka parade';
  f := spring_facts(fd, 'quote', quoter, null);
  if f.passage_hit is distinct from true then raise exception 'a Quotes phrase found in the quoted words of a post nobody hid does not match, so the test below proves nothing: %', f.passage_hit; end if;
  perform tests.become(admin_a);
  perform decide(null, hid, 'hide', null, 'passage');
  perform tests.unbecome();
  f := spring_facts(fd, 'quote', quoter, null);
  if f.passage_hit is distinct from false then raise exception 'a Quotes condition matches the words of a hidden post through a quote of it: %', f.passage_hit; end if;
  perform tests.become(admin_a);
  perform decide(null, hid, 'unhide', null, '');
  perform tests.unbecome();
  f := spring_facts(fd, 'quote', quoter, null);
  if f.passage_hit is distinct from true then raise exception 'a Quotes condition does not match once the post is shown again: %', f.passage_hit; end if;
end $$;

-- ---- bbcode_walk's `unquoted` cuts every quote the one parser reads, closed or not, inside other tags or nested (0340) ----
-- supabase/tests/data/unquoted-corpus.json is made by engine/bbcode/unquoted-corpus.test.ts: bodies of numbered marker words and, for each, the markers concealQuotes (the parser's own reading of a quote,
-- with every id hidden) took out. No such marker may survive in what the database's walk calls unquoted, which is what a rule and a card's Says condition judge. The file is read by psql from the repository root
-- (where `npm run test:sql` runs), and handed to the block as a setting, which lasts to the end of the file's transaction.
\set unquoted_corpus `cat supabase/tests/data/unquoted-corpus.json`
select set_config('kayfabb.unquoted_corpus', :'unquoted_corpus', true) \gset

do $$
declare
  f record;
  m text;
  u text;
  bodies integer := 0;
  markers integer := 0;
begin
  for f in select e ->> 'name' as name, e ->> 'body' as body, e -> 'removed' as removed from jsonb_array_elements(current_setting('kayfabb.unquoted_corpus')::jsonb) e loop
    u := (select w.unquoted from bbcode_walk(f.body, null) w);
    bodies := bodies + 1;
    for m in select jsonb_array_elements_text(f.removed) loop
      markers := markers + 1;
      if position(m in u) > 0 then raise exception 'bbcode_walk leaves the words of a quote in unquoted (%): % survives in %, from %', f.name, m, to_json(u), to_json(f.body); end if;
    end loop;
  end loop;
  if bodies < 600 or markers < 200 then raise exception 'the unquoted corpus was not read whole: % bodies, % markers', bodies, markers; end if;
end $$;
