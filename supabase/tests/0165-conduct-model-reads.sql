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
        jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts'))));
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
end $$;

-- ---- A card that writes reads the version it writes on through the public form (0149's claim_card_writes, re-created by 0237) ----
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
