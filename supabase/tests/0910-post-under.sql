-- A card that replies: the catalog, post_under and the write (supabase/migrations/0410_post_under.sql; docs/plans/2026-11-11-card-notes-part-2-plan.md, Task 2).
-- A play of a card whose kind `replies` writes two Acts in one transaction: the card Act on the parent post, and the reply, an ordinary post in the parent's thread that takes
-- its own number. One post_under row says the reply is drawn under the parent for as long as the play is in force. Every refusal leaves the whole play unwritten and unspent.
-- The cards are this file's own (pa...), never an instance's.

create function pg_temp.coded(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k
$$;

-- What a refused play must leave alone: every Act, every post_under row, the wallet, the ledger and the hand.
create function pg_temp.state(who uuid, card text) returns text language sql as $$
  select (select count(*) from acts) || '/' || (select count(*) from post_under) || '/' || coalesce((select balance from wallets where account = who), 0) || '/'
    || (select count(*) from card_ledger where account = who) || '/' || card_held(who, card)
$$;

-- A play of the card as the act function sends it: the service role, with the reply and the framing.
create function pg_temp.cut(who uuid, card text, through uuid, target uuid, reply text, price integer default 0) returns text language sql as $$
  select pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, %s, %L, reply => %L)', who, card, through, target, '{}', price, '', reply))
$$;

create function pg_temp.board(slug text) returns uuid language sql as $$ select id from boards where boards.slug = board.slug $$;
create function pg_temp.announcements() returns uuid language sql as $$ select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements' $$;

-- A one-day ban of a character, with the infraction a ban follows, about a post of the character's in the thread.
create function pg_temp.ban(who uuid, in_thread uuid) returns void language plpgsql as $$
declare
  p uuid := tests.post(who, in_thread, 'A post that earned it.');
  inf uuid;
begin
  perform set_config('kayfabb.warn_writer', 'on', true);
  inf := tests.act(null, 'infraction', in_thread, jsonb_build_object('character', who, 'band', 'minor', 'points', 2, 'rule_number', null,
    'board', (select board from threads where id = in_thread), 'about_act', p, 'visit_act', null, 'staff', 'pa-boss', 'expires_at', now() + interval '14 days'));
  perform tests.act(null, 'ban', in_thread, jsonb_build_object('character', who, 'days', 1, 'until', now() + interval '1 day', 'infraction_act', inf, 'season', 1));
  perform set_config('kayfabb.warn_writer', '', true);
end $$;

-- A group move that has landed (as an Act): a bar from a board.
create function pg_temp.landed(staff text, who uuid, grp text, board uuid) returns uuid language plpgsql as $$
declare
  made uuid;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  made := tests.act((select id from characters c where c.staff = landed.staff), 'move', pg_temp.announcements(),
    jsonb_build_object('kind', 'conferGroup', 'body', 'Moved.', 'params', jsonb_build_object('character', who::text, 'group', grp, 'board', board::text),
      'demand', jsonb_build_object('kind', 'apologyAccepted', 'params', '{}'::jsonb), 'expires_at', clock_timestamp() + interval '3 days'),
    null, clock_timestamp() - interval '1 hour');
  perform set_config('kayfabb.staff_writer', '', true);
  return made;
end $$;

-- The world the bar and the persona need: a Boss and a Mod, a ladder, a conferred group, and a pool that plays up to rare.
do $$
begin
  perform seed_instance(jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true,
      'apology', jsonb_build_object('apologyEveryHours', 24, 'apologyJudgeBatch', 2, 'apologyRulingMaxWords', 80),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.'), 'moveMet', jsonb_build_array('Met, {move}.')),
      'systemMoveWords', jsonb_build_object('conferGroup', 'moving a member into "{groupName}"')),
    'groups', jsonb_build_array(
      jsonb_build_object('key', 'members', 'name', 'Members', 'color', '#7a7a7a', 'source', 'ladder', 'rung', 0, 'condition', 'default'),
      jsonb_build_object('key', 'trialMembers', 'name', 'Trial Members', 'color', '#d2691e', 'stripe', true, 'source', 'conferred', 'tone', 'punishment')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'pa-boss',
      'staff', jsonb_build_array(jsonb_build_object('key', 'pa-boss', 'name', 'Pa Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb),
                                 jsonb_build_object('key', 'pa-mod', 'name', 'Pa Mod', 'title', 'Mod', 'signature', 'Ho', 'beats', '[]'::jsonb)),
      'firstStaff', jsonb_build_array('pa-mod'),
      'moves', jsonb_build_array(
        jsonb_build_object('key', 'conferGroup', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'), 'derived', jsonb_build_array('groupName'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'apologyAccepted')),
      'predicates', '[]'::jsonb)));
  insert into settings (key, value) values ('pool', '{"weekly": 20, "holdback": 0.2, "threadsWeekly": 1, "cardRarityMost": "rare", "priorityDays": 28, "notesRead": 12, "chatterThreadPosts": 8, "strengths": {"named": 5, "quoted": 5, "legacy": 5, "successorStumbles": 5, "oldFlame": 5, "homeTurf": 2, "seasonTurn": 2, "hotOnBeat": 2}, "chatterCron": "37 17 * * *"}') on conflict (key) do update set value = excluded.value;
  insert into card_kinds (key, name, alignment, rarity, play, stack, reaches, replies, trap, lasts, gimmick) values
    ('pacut', 'Pa Cut', 'pepperoni', 'rare', 'cast', 1, '{post}', true, null, null, null),
    ('patrap', 'Pa Trap', 'sweet', 'rare', 'set', 1, '{post}', false, '{"trigger": {"on": "cast"}}', null, null),
    ('paward', 'Pa Ward', 'sweet', 'common', 'use', 1, '{post}', false, null, interval '7 days', '{"kind": "ward", "flavors": ["pepperoni"]}'),
    ('paride', 'Pa Ride', 'sweet', 'rare', 'set', 1, '{post}', false, '{"trigger": {"on": "cast"}, "outcome": {"kind": "ride", "share": 1}}', null, null);
end $$;

-- ---- A play of a card that replies writes the card Act, the reply and one post_under row, and spends once ----
do $$
declare
  ann uuid := tests.account('pa-ann'); bob uuid := tests.account('pa-bob');
  a uuid := tests.character(ann, 'Pa Ann'); b uuid := tests.character(bob, 'Pa Bob');
  t uuid := tests.thread('Pa cut'); p uuid := tests.post(a, t, 'The parent.'); p2 uuid := tests.post(a, t, 'Another post.');
  before_t threads%rowtype; after_t threads%rowtype; played jsonb; pl uuid; r acts%rowtype; k acts%rowtype; hand_before integer;
begin
  perform pg_temp.hand(bob, 'pacut', 'pacut', 'pacut');
  insert into wallets (account, balance) values (bob, 500);
  select * into before_t from threads where id = t;
  hand_before := card_held(bob, 'pacut');
  perform tests.become_service();
  played := play_card(bob, 'pacut', b, p, '{}', 40, '', reply => 'Cutting in line.');
  perform tests.unbecome();
  pl := (played ->> 'id')::uuid;
  select * into k from acts where id = pl;
  if k.kind is distinct from 'card' or k.target_act_id is distinct from p or k.payload ->> 'reply' is null then raise exception 'the card Act names the reply: %', to_jsonb(k); end if;
  select * into r from acts where id = (k.payload ->> 'reply')::uuid;
  if r.id is null or r.kind is distinct from 'post' or r.character is distinct from b or r.thread is distinct from t or r.target_act_id is not null
     or r.payload ->> 'body' is distinct from 'Cutting in line.' then raise exception 'the reply is a post of the caster in the thread with the words given, quoting nothing: %', to_jsonb(r); end if;
  if r.seq is null or r.seq is distinct from (select max(x.seq) from acts x where x.thread = t and x.kind = 'post') or r.seq = (select seq from acts where id = p2) then raise exception 'the reply takes a number of its own: %', r.seq; end if;
  if (select count(*) from post_under u where u.play = pl and u.parent = p and u.reply = r.id and u.thread = t) is distinct from 1 or (select count(*) from post_under) is distinct from 1 then
    raise exception 'one post_under row says the reply is under its parent';
  end if;
  select * into after_t from threads where id = t;
  if after_t.replies is distinct from before_t.replies + 1 or after_t.last_at is distinct from r.created_at or after_t.next_seq is distinct from before_t.next_seq + 1 then
    raise exception 'the thread counts the reply as any post: % to %', to_jsonb(before_t), to_jsonb(after_t);
  end if;
  if (select balance from wallets where account = bob) is distinct from 460 or (select count(*) from wallet_events w where w.account = bob and w.kind = 'play' and w.ref = pl) is distinct from 1
     or (select count(*) from card_ledger l where l.account = bob and l.kind = 'played' and l.act = pl) is distinct from 1 or card_held(bob, 'pacut') is distinct from hand_before - 1 then
    raise exception 'the wallet, the ledger and the hand moved once';
  end if;
  -- The answer says what the play carried: the parent, the card Act and the reply as an Act projection.
  if played #>> '{under,parent}' is distinct from p::text or played #>> '{under,play}' is distinct from pl::text or played #>> '{under,act}' is null
     or (played #>> '{under,act}')::jsonb ->> 'id' is distinct from r.id::text then raise exception 'the answer carries under: %', played -> 'under'; end if;
  if played ? 'sprung' then raise exception 'a play that landed carries no sprung'; end if;
end $$;

-- ---- Refused, with nothing written and nothing spent ----
do $$
declare
  ann uuid := tests.account('pb-ann'); bob uuid := tests.account('pb-bob'); cal uuid := tests.account('pb-cal'); dee uuid := tests.account('pb-dee'); eli uuid := tests.account('pb-eli');
  a uuid := tests.character(ann, 'Pb Ann'); b uuid := tests.character(bob, 'Pb Bob'); c uuid := tests.character(cal, 'Pb Cal'); d uuid := tests.character(dee, 'Pb Dee'); e uuid := tests.character(eli, 'Pb Eli');
  t uuid := tests.thread('Pb refusals'); p uuid := tests.post(a, t, 'The parent.'); p2 uuid := tests.post(a, t, 'A second parent.');
  sys_t uuid; sys_p uuid; general uuid := pg_temp.board('general');
  why text; s0 text; played jsonb; reply_post uuid;
begin
  perform pg_temp.hand(bob, 'pacut', 'pacut', 'pacut', 'pacut', 'sweetie');
  perform pg_temp.hand(cal, 'pacut', 'pacut');
  perform pg_temp.hand(dee, 'pacut', 'pacut');
  perform pg_temp.hand(eli, 'pacut', 'pacut', 'pacut');
  insert into wallets (account, balance) values (bob, 500), (cal, 500), (dee, 500), (eli, 500);
  s0 := pg_temp.state(bob, 'pacut');
  -- No reply, and a reply of spaces or with no letter or digit in it.
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 40, %L)', bob, 'pacut', b, p, '{}', ''));
  if why is distinct from '22023 write the reply this card carries' then raise exception 'no reply: %', why; end if;
  why := pg_temp.cut(bob, 'pacut', b, p, '   ', 40);
  if why is distinct from '22023 write the reply this card carries' then raise exception 'a reply of spaces: %', why; end if;
  why := pg_temp.cut(bob, 'pacut', b, p, '...', 40);
  if why is distinct from '22023 write the reply this card carries' then raise exception 'a reply with no letter or digit: %', why; end if;
  why := pg_temp.cut(bob, 'pacut', b, p, repeat('x', 20001), 40);
  if why is distinct from '22001 body is longer than 20000 characters' then raise exception 'a reply over postMaxLength: %', why; end if;
  -- A reply handed to a card that does not carry one.
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 40, %L, reply => %L)', bob, 'sweetie', b, p, '{}', '', 'Not here.'));
  if why is distinct from '22023 only a card that carries a reply takes one' then raise exception 'a reply handed to a card that carries none: %', why; end if;
  if pg_temp.state(bob, 'pacut') is distinct from s0 then raise exception 'a refused play wrote or spent something: % to %', s0, pg_temp.state(bob, 'pacut'); end if;

  -- A banned character, and a barred one.
  perform pg_temp.ban(b, t);
  s0 := pg_temp.state(bob, 'pacut');
  why := pg_temp.cut(bob, 'pacut', b, p, 'Banned.', 40);
  if why is null or why not like '55000 this character is banned until % UTC%' then raise exception 'a banned character: %', why; end if;
  if pg_temp.state(bob, 'pacut') is distinct from s0 then raise exception 'a banned play wrote or spent something'; end if;
  perform pg_temp.landed('pa-boss', c, 'trialMembers', general);
  s0 := pg_temp.state(cal, 'pacut');
  why := pg_temp.cut(cal, 'pacut', c, p, 'Barred.', 40);
  if why is null or why not like '55000 Pb Cal is barred from posting on General until %' then raise exception 'a barred character: %', why; end if;
  if pg_temp.state(cal, 'pacut') is distinct from s0 then raise exception 'a barred play wrote or spent something'; end if;

  -- A thread on The System's board.
  insert into threads (board, title) select id, 'Pb system thread' from boards where slug = 'the-system' returning id into sys_t;
  sys_p := tests.post(a, sys_t, 'On the System''s board.');
  s0 := pg_temp.state(dee, 'pacut');
  why := pg_temp.cut(dee, 'pacut', d, sys_p, 'Cutting the System.', 40);
  if why is distinct from '42501 only the staff post here; spin a thread from what they said' then raise exception 'a post on the System''s board: %', why; end if;
  if pg_temp.state(dee, 'pacut') is distinct from s0 then raise exception 'a play on the System''s board wrote or spent something'; end if;

  -- A first play lands; a second on the same parent is refused by the stack and a play on the reply in force by the guard, each leaving everything as it was.
  perform tests.become_service();
  played := play_card(eli, 'pacut', e, p, '{}', 0, '', reply => 'First.');
  perform tests.unbecome();
  reply_post := (played #>> '{under,act,id}')::uuid;
  s0 := pg_temp.state(eli, 'pacut');
  why := pg_temp.cut(eli, 'pacut', e, p, 'Second.');
  if why is distinct from '23505 this post already carries that card' then raise exception 'a second play on the same parent: %', why; end if;
  why := pg_temp.cut(eli, 'pacut', e, reply_post, 'A reply to the reply.');
  if why is distinct from '23505 a reply drawn under a post takes no reply under it' then raise exception 'a play on a reply in force: %', why; end if;
  if pg_temp.state(eli, 'pacut') is distinct from s0 then raise exception 'a refused play wrote or spent something'; end if;
  -- Another post is still free.
  if pg_temp.cut(eli, 'pacut', e, p2, 'Another post.') is not null then raise exception 'a play on another post lands'; end if;
end $$;

-- ---- An admin's end drops the reply back to its number: the parent takes a second play, and the old reply takes one ----
do $$
declare
  ann uuid := tests.account('pc-ann'); bob uuid := tests.account('pc-bob'); adm uuid := tests.account('pc-adm');
  a uuid := tests.character(ann, 'Pc Ann'); b uuid := tests.character(bob, 'Pc Bob');
  t uuid := tests.thread('Pc ended'); p uuid := tests.post(a, t, 'The parent.');
  played jsonb; reply1 uuid; play1 uuid; played2 jsonb; reply2 uuid; played3 jsonb; target jsonb; plain uuid;
begin
  perform pg_temp.hand(bob, 'pacut', 'pacut', 'pacut');
  insert into admins (account) values (adm);
  perform tests.become_service();
  played := play_card(bob, 'pacut', b, p, '{}', 0, '', reply => 'First.');
  perform tests.unbecome();
  play1 := (played ->> 'id')::uuid; reply1 := (played #>> '{under,act,id}')::uuid;
  -- A reply in force says where it sits; the parent says nothing.
  perform tests.become(bob);
  target := card_target(reply1);
  perform tests.unbecome();
  if target ->> 'under' is distinct from p::text then raise exception 'card_target of a reply in force names its parent: %', target; end if;
  perform tests.become(bob);
  target := card_target(p);
  perform tests.unbecome();
  if target ? 'under' then raise exception 'card_target of the parent has no under: %', target; end if;
  -- The ordinary post a play is not drawn under says nothing either, and a missing key is not a null.
  plain := tests.post(a, t, 'Plain.');
  perform tests.become(bob);
  target := card_target(plain);
  perform tests.unbecome();
  if target ? 'under' then raise exception 'card_target of a plain post has no under: %', target; end if;

  perform tests.become(adm);
  perform reverse_card(play1);
  perform tests.unbecome();
  perform tests.become(bob);
  target := card_target(reply1);
  perform tests.unbecome();
  if target ? 'under' then raise exception 'card_target of an ended reply has no under: %', target; end if;
  perform tests.become_service();
  played2 := play_card(bob, 'pacut', b, p, '{}', 0, '', reply => 'Second.');
  perform tests.unbecome();
  reply2 := (played2 #>> '{under,act,id}')::uuid;
  if (select count(*) from post_under where parent = p) is distinct from 2 or not exists (select 1 from post_under u where u.reply = reply2 and not card_ended(u.play)) then
    raise exception 'after an admin''s end a second play on the parent lands';
  end if;
  perform tests.become_service();
  played3 := play_card(bob, 'pacut', b, reply1, '{}', 0, '', reply => 'Under the old reply.');
  perform tests.unbecome();
  if played3 #>> '{under,parent}' is distinct from reply1::text then raise exception 'a play on the old reply lands: %', played3; end if;
end $$;

-- ---- A caught cast writes the caught card Act, no post and no post_under row ----
do $$
declare
  ann uuid := tests.account('pd-ann'); bob uuid := tests.account('pd-bob');
  a uuid := tests.character(ann, 'Pd Ann'); b uuid := tests.character(bob, 'Pd Bob');
  t uuid := tests.thread('Pd caught'); p uuid := tests.post(a, t, 'A post with a back.');
  played jsonb; posts_before integer; under_before integer;
begin
  perform pg_temp.hand(ann, 'patrap');
  perform pg_temp.hand(bob, 'pacut');
  perform tests.become_service();
  perform set_card(ann, 'patrap', a, p, '{}', 0, 'pacut');
  select count(*) into posts_before from acts where kind = 'post' and thread = t;
  select count(*) into under_before from post_under;
  played := play_card(bob, 'pacut', b, p, '{}', 0, '', reply => 'Caught.');
  perform tests.unbecome();
  if played -> 'sprung' is null or played #>> '{payload,caught}' is null then raise exception 'the cast was caught: %', played; end if;
  if played #>> '{payload,reply}' is null then raise exception 'the caught card Act still names the reply id: %', played -> 'payload'; end if;
  if (select count(*) from acts where kind = 'post' and thread = t) is distinct from posts_before or (select count(*) from post_under) is distinct from under_before
     or exists (select 1 from acts where id = (played #>> '{payload,reply}')::uuid) then
    raise exception 'a caught cast wrote a reply';
  end if;
  if played ? 'under' then raise exception 'a caught cast has no under'; end if;
end $$;

-- ---- A ward that covers the kind refuses before anything is written ----
do $$
declare
  ann uuid := tests.account('pe-ann'); bob uuid := tests.account('pe-bob');
  a uuid := tests.character(ann, 'Pe Ann'); b uuid := tests.character(bob, 'Pe Bob');
  t uuid := tests.thread('Pe warded'); p uuid := tests.post(a, t, 'A warded post.'); why text; s0 text;
begin
  perform pg_temp.hand(ann, 'paward');
  perform pg_temp.hand(bob, 'pacut');
  insert into wallets (account, balance) values (bob, 500);
  perform tests.become_service();
  perform play_card(ann, 'paward', a, p, '{}', 0, '');
  perform tests.unbecome();
  s0 := pg_temp.state(bob, 'pacut');
  why := pg_temp.cut(bob, 'pacut', b, p, 'Warded.', 40);
  if why is distinct from '42501 this post''s Pa Ward turns away Pepperoni cards' then raise exception 'a ward that covers the kind: %', why; end if;
  if pg_temp.state(bob, 'pacut') is distinct from s0 then raise exception 'a warded play wrote or spent something'; end if;
end $$;

-- ---- Face down, and a persona's play, are refused; the guards hold on every path that writes ----
do $$
declare
  ann uuid := tests.account('pf-ann'); a uuid := tests.character(ann, 'Pf Ann');
  t uuid := tests.thread('Pf paths'); p uuid := tests.post(a, t, 'A post.'); why text; boss uuid := (select id from characters where staff = 'pa-boss');
begin
  perform pg_temp.hand(ann, 'pacut');
  perform tests.become_service();
  why := pg_temp.coded(format('select set_card(%L, %L, %L, %L, %L, 0)', ann, 'pacut', a, p, '{}'));
  if why is distinct from '22023 Pa Cut carries a reply, so it is cast face up and never set face down' then raise exception 'a card that replies was set face down, or refused in other words: %', why; end if;
  -- The trigger on face_down holds where set_card is skipped.
  why := pg_temp.coded(format('insert into face_down (play, account, card, config, post, thread, round, ends_at) values (gen_random_uuid(), %L, %L, ''{}'', %L, %L, 1, now() + interval ''1 day'')', ann, 'pacut', p, t));
  if why is null or why not like '22023 Pa Cut carries a reply%' then raise exception 'a direct back of a card that replies: %', why; end if;
  -- A persona's play passes no marker, so the Act is refused: nothing it wrote stays.
  why := pg_temp.coded(format('select staff_play_card(%L, %L, %L)', 'pa-mod', 'pacut', p));
  if why is distinct from '22023 Pa Cut is cast with its reply' then raise exception 'a persona played a card that replies: %', why; end if;
  if exists (select 1 from acts where kind = 'card' and payload ->> 'card' = 'pacut' and character = (select id from characters where staff = 'pa-mod')) then raise exception 'a persona''s refused play left an Act'; end if;
  -- And a raw card Act of the kind with no reply named.
  why := pg_temp.coded(format('insert into acts (character, kind, thread, target_act_id, payload) values (%L, ''card'', %L, %L, %L)', a, t, p, '{"card": "pacut", "message": "", "config": {}, "layer": 1}'));
  if why is distinct from '22023 Pa Cut is cast with its reply' then raise exception 'a card Act of the kind with no reply: %', why; end if;
  perform tests.unbecome();
end $$;

-- ---- post_under is insert-only, and no visitor reads it ----
do $$
declare
  ann uuid := tests.account('pg-ann'); bob uuid := tests.account('pg-bob');
  a uuid := tests.character(ann, 'Pg Ann'); b uuid := tests.character(bob, 'Pg Bob');
  t uuid := tests.thread('Pg rows'); p uuid := tests.post(a, t, 'The parent.'); played jsonb; why text; n integer;
begin
  perform pg_temp.hand(bob, 'pacut');
  perform tests.become_service();
  played := play_card(bob, 'pacut', b, p, '{}', 0, '', reply => 'A row.');
  perform tests.unbecome();
  why := pg_temp.coded(format('update post_under set parent = reply where play = %L', (played ->> 'id')::uuid));
  if why is null or why not like '%never edited%' then raise exception 'post_under refuses an update: %', why; end if;
  why := pg_temp.coded(format('delete from post_under where play = %L', (played ->> 'id')::uuid));
  if why is null or why not like '%never edited%' then raise exception 'post_under refuses a delete: %', why; end if;
  why := pg_temp.coded('truncate post_under');
  if why is null or why not like '%never edited%' then raise exception 'post_under refuses a truncate: %', why; end if;
  -- A signed-in player reads every row, and writes none.
  perform tests.become(ann);
  select count(*) into n from post_under;
  if n < 1 then raise exception 'a player reads the rows'; end if;
  why := pg_temp.coded(format('insert into post_under (play, parent, reply, thread) values (gen_random_uuid(), %L, gen_random_uuid(), %L)', p, t));
  if why is null or why not like '42501%' then raise exception 'a player writes none: %', why; end if;
  perform tests.unbecome();
  perform tests.become_anon();
  why := pg_temp.coded('select count(*) from post_under');
  if why is null or why not like '42501%' then raise exception 'anon reads nothing: %', why; end if;
  perform tests.unbecome();
  -- The guard holds where the table is written directly: a row whose parent is the reply of a row in force is refused in the guard's words.
  why := pg_temp.coded(format('insert into post_under (play, parent, reply, thread) select gen_random_uuid(), reply, %L, %L from post_under where play = %L', p, t, (played ->> 'id')::uuid));
  if why is distinct from '23505 a reply drawn under a post takes no reply under it' then raise exception 'a row under a reply in force: %', why; end if;
end $$;

-- ---- A cast a ride back lets land writes its reply, its row and answers `under`; the outcomes of a cast on a back are: caught (above), ridden (here) and no back at all (the first block) ----
do $$
declare
  ann uuid := tests.account('ph-ann'); bob uuid := tests.account('ph-bob');
  a uuid := tests.character(ann, 'Ph Ann'); b uuid := tests.character(bob, 'Ph Bob');
  t uuid := tests.thread('Ph rode'); p uuid := tests.post(a, t, 'A post with a ride back.');
  back uuid; played jsonb; k acts%rowtype;
begin
  perform pg_temp.hand(ann, 'paride');
  perform pg_temp.hand(bob, 'pacut');
  insert into wallets (account, balance) values (bob, 500);
  perform tests.become_service();
  back := (set_card(ann, 'paride', a, p, '{"quadrant": "excitedPositive"}', 0, 'pacut') ->> 'id')::uuid;
  played := play_card(bob, 'pacut', b, p, '{}', 0, '', reply => 'Cutting past the ride.');
  perform tests.unbecome();
  select * into k from acts where id = (played ->> 'id')::uuid;
  if played -> 'sprung' is null or played #>> '{sprung,payload,did}' is distinct from 'rode' or k.payload ? 'caught' or k.payload ->> 'rode' is distinct from back::text then
    raise exception 'the cast met a ride back: % %', played -> 'sprung', k.payload;
  end if;
  if not exists (select 1 from acts r where r.id = (k.payload ->> 'reply')::uuid and r.kind = 'post' and r.thread = t and r.character = b and r.payload ->> 'body' = 'Cutting past the ride.') then
    raise exception 'a cast that rode wrote no reply: %', k.payload;
  end if;
  if (select count(*) from post_under u where u.play = k.id and u.parent = p and u.reply = (k.payload ->> 'reply')::uuid) is distinct from 1
     or played #>> '{under,parent}' is distinct from p::text or played #>> '{under,act}' is null or played #>> '{under,play}' is distinct from k.id::text then
    raise exception 'a cast that rode writes its row and answers under: %', played;
  end if;
end $$;

-- ---- The framing a reply carries is the framing a post's is ----
do $$
declare
  ann uuid := tests.account('pi-ann'); bob uuid := tests.account('pi-bob'); cal uuid := tests.account('pi-cal');
  a uuid := tests.character(ann, 'Pi Ann'); b uuid := tests.character(bob, 'Pi Bob'); c uuid := tests.character(cal, 'Pi Cal');
  t uuid := tests.thread('Pi framing'); p uuid := tests.post(a, t, 'The parent.'); p2 uuid := tests.post(a, t, 'Another.');
  body text := 'He said [quote="Cal" user=' || c || ']things[/quote]'; played jsonb; reply_id uuid; made jsonb; plain jsonb;
begin
  perform pg_temp.hand(bob, 'pacut', 'pacut');
  insert into wallets (account, balance) values (bob, 500);
  perform tests.become_service();
  played := play_card(bob, 'pacut', b, p, '{}', 0, '', reply => body, framing => array[c]);
  perform tests.unbecome();
  reply_id := (played #>> '{under,act,id}')::uuid;
  if (select count(*) from alerts where kind = 'framed' and act = reply_id) is distinct from 1
     or not exists (select 1 from alerts where kind = 'framed' and act = reply_id and account = cal and character = c) then
    raise exception 'a reply that frames a character alerts its owner once, about the reply';
  end if;
  -- As a post of the same words and framing does.
  perform tests.become(bob);
  made := post(t, b, body, null, array[c]);
  perform tests.unbecome();
  if (select count(*) from alerts where kind = 'framed' and act = (made ->> 'id')::uuid and account = cal and character = c) is distinct from 1 then
    raise exception 'post() with the same framing alerts the same way';
  end if;
  -- And none without it.
  perform pg_temp.hand(bob, 'pacut');
  perform tests.become_service();
  plain := play_card(bob, 'pacut', b, p2, '{}', 0, '', reply => body);
  perform tests.unbecome();
  if exists (select 1 from alerts where kind = 'framed' and act = (plain #>> '{under,act,id}')::uuid) then raise exception 'a reply with no framing alerts nobody'; end if;
end $$;

-- ---- The guard on post_under refuses a parent or a reply that is no post of the thread, and a reach that is not a post's is refused with nothing written ----
do $$
declare
  ann uuid := tests.account('pj-ann'); bob uuid := tests.account('pj-bob');
  a uuid := tests.character(ann, 'Pj Ann'); b uuid := tests.character(bob, 'Pj Bob');
  t uuid := tests.thread('Pj guard'); t2 uuid := tests.thread('Pj other'); p uuid := tests.post(a, t, 'Parent.'); r uuid := tests.post(a, t, 'Reply.'); other uuid := tests.post(a, t2, 'Elsewhere.');
  played jsonb; why text; s0 text;
begin
  perform pg_temp.hand(bob, 'pacut');
  insert into wallets (account, balance) values (bob, 500);
  perform tests.become_service();
  played := play_card(bob, 'pacut', b, p, '{}', 0, '', reply => 'Making a card Act.');
  perform tests.unbecome();
  -- A parent that is a card Act, not a post.
  why := pg_temp.coded(format('insert into post_under (play, parent, reply, thread) values (gen_random_uuid(), %L, %L, %L)', (played ->> 'id')::uuid, r, t));
  if why is distinct from '23514 a reply is drawn under a post of its own thread' then raise exception 'a parent that is no post: %', why; end if;
  -- A reply that is a post of another thread.
  why := pg_temp.coded(format('insert into post_under (play, parent, reply, thread) values (gen_random_uuid(), %L, %L, %L)', p, other, t));
  if why is distinct from '23514 a reply is drawn under a post of its own thread' then raise exception 'a reply of another thread: %', why; end if;
  -- A parent that is no Act at all.
  why := pg_temp.coded(format('insert into post_under (play, parent, reply, thread) values (gen_random_uuid(), gen_random_uuid(), %L, %L)', r, t));
  if why is distinct from '23514 a reply is drawn under a post of its own thread' then raise exception 'a parent that is nothing: %', why; end if;
  if (select count(*) from post_under where reply in (r, other)) is distinct from 0 then raise exception 'a refused row stayed'; end if;

  -- A card that replies played at any reach but a post.
  perform pg_temp.hand(bob, 'pacut');
  s0 := pg_temp.state(bob, 'pacut');
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, reply => %L)', bob, 'pacut', b, a, '{}', '', 'character', 'At a character.'));
  if why is distinct from '22023 this card lands on a post' then raise exception 'a card that replies played at a character: %', why; end if;
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, reply => %L)', bob, 'pacut', b, t, '{}', '', 'thread', 'At a thread.'));
  if why is distinct from '22023 this card lands on a post' then raise exception 'a card that replies played at a thread: %', why; end if;
  if pg_temp.state(bob, 'pacut') is distinct from s0 then raise exception 'a refused reach wrote or spent something: % to %', s0, pg_temp.state(bob, 'pacut'); end if;
end $$;
