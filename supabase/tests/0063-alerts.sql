-- Alerts written with their Acts (supabase/migrations/0058_alerts.sql): a quote, a card on a post, a character or a thread, a
-- trap struck and a trap sprung each write one row for the right account and queue one broadcast on `account:<owner>`; a board
-- play, a play on a staff character and a play by the owner's own other mask write none. The caster's answer from post and
-- play_card is the same projection, field for field, whatever owns the target, and never holds the alert. An account reads its
-- own rows alone, and no API role can write one. docs/plans/2026-11-02-alerts-plan.md, Task 3; the design, sections 2 and 10.
-- Rewritten for face-down Moves (docs/plans/2026-11-07-face-down-moves-plan.md, Task 6): a Move springs on a quote and lands on the quoting post, a Trap Card
-- catches the card it names, and a reaction springs nothing. The cards are the engine's test set, never an instance's.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function pg_temp.cards() returns void language plpgsql as $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, trap) values
    ('glint', 'Glint', 'pepperoni', 'uncommon', 'cast', '{character}', interval '7 days', null),
    ('marquee', 'Marquee', 'sweet', 'rare', 'cast', '{thread}', interval '1 day', null),
    ('quake', 'Quake', 'salty', 'legendary', 'cast', '{board}', interval '1 day', null),
    ('catcher', 'Catcher', 'salty', 'rare', 'set', '{post}', null, '{"trigger": {"on": "cast"}}'),
    ('quoter', 'Quoter', 'salty', 'uncommon', 'cast', '{post}', null, null)
  on conflict (key) do nothing;
end $$;

create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k
$$;

-- A projection with what differs by construction (ids, times, places, the target's own public name) taken out.
create function pg_temp.shape(projection jsonb) returns jsonb language sql as $$
  select (projection - array['id', 'created_at', 'thread', 'seq', 'target_act_id'])
         || jsonb_build_object('payload', (projection -> 'payload') - array['character', 'thread', 'board', 'targetName'],
                               'current_payload', (projection -> 'current_payload') - array['character', 'thread', 'board', 'targetName'])
$$;

create function pg_temp.queued() returns bigint language sql as $$ select count(*) from broadcasts_due where topic like 'account:%' $$;

-- ---- The table is there, holds no content, and reaches no API role's writes ----
do $$
begin
  if to_regclass('public.alerts') is null then raise exception 'alerts: there is no alerts table'; end if;
  if to_regprocedure('write_alert(uuid,text,text,uuid,uuid)') is null then raise exception 'alerts: there is no write_alert'; end if;
  if (select string_agg(attname, ',' order by attnum) from pg_attribute where attrelid = 'public.alerts'::regclass and attnum > 0 and not attisdropped)
     is distinct from 'id,account,kind,sub,act,character,at' then
    raise exception 'alerts: its columns hold something besides the account, the kind, the Act and the time: %', (select string_agg(attname, ',' order by attnum) from pg_attribute where attrelid = 'public.alerts'::regclass and attnum > 0 and not attisdropped);
  end if;
  if exists (select 1 from pg_publication_tables where tablename = 'alerts') then raise exception 'alerts: the table is in a publication'; end if;
end $$;

-- ---- Who gets a row, and the one broadcast ----
do $$
declare
  ann uuid := tests.account('al-ann'); bob uuid := tests.account('al-bob'); cat uuid := tests.account('al-cat');
  a1 uuid := tests.character(ann, 'Al Ann One'); a2 uuid := tests.character(ann, 'Al Ann Two');
  b1 uuid := tests.character(bob, 'Al Bob One'); b2 uuid := tests.character(bob, 'Al Bob Two'); c1 uuid := tests.character(cat, 'Al Cat One');
  staff uuid;
  t uuid := tests.thread('Al thread'); mine_t uuid := tests.thread('Al Ann''s thread'); t_staff uuid := tests.thread('Al staff thread');
  b2_post uuid; a1_first uuid; a1_post uuid; a2_post uuid; staff_post uuid; b1_post uuid;
  said jsonb; before_rows bigint; r record; brd uuid; announce uuid;
  trapped uuid; trapped2 uuid; reply uuid; sprung_act uuid;
begin
  perform pg_temp.cards();
  insert into boards (slug, name) values ('al-board', 'Al Board') returning id into brd;
  announce := tests.thread('Al Announcements');
  insert into settings (key, value) values ('systemAnnouncements', to_jsonb(announce::text)) on conflict (key) do update set value = excluded.value;
  insert into characters (name, staff, staff_kind, debuted_at) values ('Al Bot', 'al-bot', 'persona', now()) returning id into staff;
  perform set_config('kayfabb.staff_writer', 'on', true);
  staff_post := tests.post(staff, t_staff, 'The bot speaks.');
  perform set_config('kayfabb.staff_writer', '', true);
  a1_first := tests.post(a1, mine_t, 'Ann One starts it.');
  a1_post := tests.post(a1, t, 'Ann One posts.');
  a2_post := tests.post(a2, t, 'Ann Two posts.');
  b1_post := tests.post(b1, t, 'Bob One posts.');
  b2_post := tests.post(b2, t, 'Bob Two posts.');
  perform pg_temp.hand(bob, 'sweetie', 'sweetie', 'sweetie', 'glint', 'glint', 'glint', 'marquee', 'quake');
  perform pg_temp.hand(ann, 'sweetie', 'quoter', 'quoter', 'marquee');
  insert into wallets (account, balance) values (ann, 600), (bob, 600);

  -- A quote of Ann's post by Bob: one row for Ann, one broadcast on her channel.
  before_rows := (select count(*) from alerts);
  perform tests.become(bob);
  said := post(t, b1, 'Bob quotes Ann.', a1_post);
  perform tests.unbecome();
  if (select count(*) from alerts) is distinct from before_rows + 1 then raise exception 'a quote wrote % rows, not 1', (select count(*) from alerts) - before_rows; end if;
  select * into r from alerts where kind = 'quote';
  if r.account is distinct from ann or r.character is distinct from a1 or r.act is distinct from (said ->> 'id')::uuid or r.sub is not null then
    raise exception 'a quote is Ann''s, about Bob''s new post and her character: %', to_jsonb(r);
  end if;
  if (select count(*) from broadcasts_due where topic = 'account:' || ann) is distinct from 1 then raise exception 'a quote queued % broadcasts on Ann''s channel', (select count(*) from broadcasts_due where topic = 'account:' || ann); end if;
  if (select payload from broadcasts_due where topic = 'account:' || ann) is distinct from jsonb_build_object('id', r.id, 'kind', 'quote', 'sub', null, 'act', r.act, 'character', a1, 'at', r.at)
     or (select event from broadcasts_due where topic = 'account:' || ann) is distinct from 'alert' then
    raise exception 'the broadcast is the alert''s public projection: %', (select to_jsonb(x) from broadcasts_due x where topic = 'account:' || ann);
  end if;
  if (select payload::text from broadcasts_due where topic = 'account:' || ann) ~ (bob::text || '|' || b1::text) then raise exception 'the broadcast names the caster'; end if;
  delete from broadcasts_due where topic like 'account:%';
  delete from alerts;

  -- Quoting a staff post, one's own post, and one's own other mask's post write nothing.
  perform tests.become(bob);
  perform post(t_staff, b1, 'Bob quotes the bot.', staff_post);
  perform post(t, b1, 'Bob quotes himself.', b1_post);
  perform tests.unbecome();
  perform tests.become(ann);
  perform post(t, a1, 'Ann quotes her other mask.', a2_post);
  perform tests.unbecome();
  if exists (select 1 from alerts) or pg_temp.queued() <> 0 then raise exception 'a quote of staff, of oneself or of one''s own mask wrote an alert or a broadcast'; end if;

  -- A card on a post: Ann's post, Bob's Sweetie.
  said := play_card(bob, 'sweetie', b1, a1_post, '{}', 0);
  select * into r from alerts;
  if (select count(*) from alerts) is distinct from 1 or r.kind is distinct from 'cardOnYours' or r.account is distinct from ann or r.character is distinct from a1 or r.act is distinct from (said ->> 'id')::uuid then
    raise exception 'a card on a post is Ann''s cardOnYours about the play: % / %', to_jsonb(r), (select count(*) from alerts);
  end if;
  if (select count(*) from broadcasts_due where topic = 'account:' || ann) is distinct from 1 or pg_temp.queued() is distinct from 1 then raise exception 'a card on a post queued % account broadcasts', pg_temp.queued(); end if;
  delete from broadcasts_due where topic like 'account:%'; delete from alerts;

  -- A card on a character: Ann's Ann One, from her post.
  said := play_card(bob, 'glint', b1, a1, '{}', 0, '', 'character', a1_post);
  select * into r from alerts;
  if (select count(*) from alerts) is distinct from 1 or r.kind is distinct from 'cardOnYours' or r.account is distinct from ann or r.character is distinct from a1 or r.act is distinct from (said ->> 'id')::uuid then
    raise exception 'a card on a character is Ann''s cardOnYours: % / %', to_jsonb(r), (select count(*) from alerts);
  end if;
  if (select count(*) from broadcasts_due where topic = 'account:' || ann) is distinct from 1 or pg_temp.queued() is distinct from 1 then raise exception 'a card on a character queued % account broadcasts', pg_temp.queued(); end if;
  delete from broadcasts_due where topic like 'account:%'; delete from alerts;

  -- A card on a thread: the player of the character that started it.
  said := play_card(bob, 'marquee', b1, mine_t, '{}', 0, '', 'thread');
  select * into r from alerts;
  if (select count(*) from alerts) is distinct from 1 or r.kind is distinct from 'cardOnYours' or r.account is distinct from ann or r.character is distinct from a1 or r.act is distinct from (said ->> 'id')::uuid then
    raise exception 'a card on a thread is its starter''s player''s: % / %', to_jsonb(r), (select count(*) from alerts);
  end if;
  if pg_temp.queued() <> 1 then raise exception 'a card on a thread queued % account broadcasts', pg_temp.queued(); end if;
  delete from broadcasts_due where topic like 'account:%'; delete from alerts;

  -- A board play writes none; a play on a staff character and on a staff post none; a play by Ann's own other mask on Ann's none.
  perform play_card(bob, 'quake', b1, brd, '{}', 0, '', 'board');
  perform play_card(bob, 'glint', b1, staff, '{}', 0, '', 'character', staff_post);
  perform play_card(ann, 'sweetie', a2, tests.post(a1, t, 'Ann One, once more.'), '{}', 0);
  if exists (select 1 from alerts) or pg_temp.queued() <> 0 then
    raise exception 'a board play, a play on staff or a play by the owner''s own mask wrote an alert (%) or a broadcast (%)', (select count(*) from alerts), pg_temp.queued();
  end if;

  -- A trap sprung and struck. Ann sets a Quoter on her post; Bob quotes it: the Move lands on Bob's own post, so he is told by his
  -- answer and Ann by an alert about the spring (trapSprang). Nothing is written for Bob: he is the actor.
  trapped := tests.post(a1, t, 'A trapped post.');
  perform set_card(ann, 'quoter', a1, trapped, '{}', 0);
  perform tests.become(bob);
  said := post(t, b1, 'Bob quotes the trap.', trapped);
  perform tests.unbecome();
  sprung_act := (said -> 'sprung' ->> 'id')::uuid;
  if sprung_act is null then raise exception 'the quote did not spring the trap: %', said; end if;
  if (select count(*) from alerts where kind = 'quote') is distinct from 1 then raise exception 'the quote of the trapped post wrote no quote alert'; end if;
  select * into r from alerts where kind = 'trapSprang';
  if (select count(*) from alerts where kind = 'trapSprang') is distinct from 1 or r.account is distinct from ann or r.character is distinct from a1 or r.act is distinct from sprung_act then
    raise exception 'a trap sprung is the setter''s, about the spring: %', to_jsonb(r);
  end if;
  -- The replier's post was struck by a trap another account set: the replier's own trapStruck, about the card that struck. It goes
  -- to the replier's own account, so it tells no one else anything.
  select * into r from alerts where kind = 'trapStruck';
  if (select count(*) from alerts where kind = 'trapStruck') is distinct from 1 or r.account is distinct from bob or r.character is distinct from b1 or r.act is distinct from (said -> 'sprung' -> 'struck' ->> 'id')::uuid then
    raise exception 'a trap set off against another player''s is the replier''s trapStruck: %', (select jsonb_agg(to_jsonb(x)) from alerts x);
  end if;
  if (select count(*) from broadcasts_due where topic like 'account:%') is distinct from 3 then raise exception 'a quote that sprang a trap queued % broadcasts, not 3', pg_temp.queued(); end if;
  delete from broadcasts_due where topic like 'account:%'; delete from alerts;

  -- A trap Bob set on his other mask's post, set off by his Bob One: his own doing to himself, so no alert at all.
  perform pg_temp.hand(bob, 'quoter');
  perform set_card(bob, 'quoter', b2, b2_post, '{}', 0);
  perform tests.become(bob);
  said := post(t, b1, 'Bob quotes his own trap.', b2_post);
  perform tests.unbecome();
  if said -> 'sprung' is null then raise exception 'the quote did not spring the own-mask trap: %', said; end if;
  if exists (select 1 from alerts) or pg_temp.queued() <> 0 then raise exception 'a trap of one''s own mask set off by oneself wrote % alerts', (select count(*) from alerts); end if;

  -- A Move that lands on a post whose author is not the one acting (a path the rules do not take today, but spring_traps takes
  -- the post it lands on as given) is that author's trapStruck, about the card that landed.
  trapped2 := tests.post(a1, t, 'Another trapped post.');
  perform set_card(ann, 'quoter', a1, trapped2, '{}', 0);
  reply := tests.post(c1, t, 'Cat quotes the trap.');
  said := spring_traps('quote', trapped2, reply);
  if said is null or said -> 'struck' is null then raise exception 'the direct spring did not land: %', said; end if;
  select * into r from alerts where kind = 'trapStruck';
  if (select count(*) from alerts where kind = 'trapStruck') is distinct from 1 or r.account is distinct from cat or r.character is distinct from c1 or r.act is distinct from (said -> 'struck' ->> 'id')::uuid then
    raise exception 'a trap struck is the struck post''s author''s, about the card that struck: %', to_jsonb(r);
  end if;
  select * into r from alerts where kind = 'trapSprang';
  if (select count(*) from alerts where kind = 'trapSprang') is distinct from 1 or r.account is distinct from ann or r.act is distinct from (said ->> 'id')::uuid then
    raise exception 'the same spring is also the setter''s trapSprang: %', to_jsonb(r);
  end if;
  if pg_temp.queued() <> 2 then raise exception 'a landing and its spring queued % account broadcasts, not 2', pg_temp.queued(); end if;
  delete from broadcasts_due where topic like 'account:%'; delete from alerts;
end $$;

-- ---- The caster's answer is the same whatever owns the target, and never holds the alert ----
do $$
declare
  ann uuid := tests.account('as-ann'); bob uuid := tests.account('as-bob');
  a1 uuid := tests.character(ann, 'As Ann One');
  b1 uuid := tests.character(bob, 'As Bob One'); b2 uuid := tests.character(bob, 'As Bob Two');
  staff uuid;
  t1 uuid := tests.thread('As one'); t2 uuid := tests.thread('As two'); t3 uuid := tests.thread('As three');
  owned uuid; staffs uuid; mine uuid;
  said_owned jsonb; said_staff jsonb; said_mine jsonb;
begin
  perform pg_temp.cards();
  insert into characters (name, staff, staff_kind, debuted_at) values ('As Bot', 'as-bot', 'persona', now()) returning id into staff;
  perform set_config('kayfabb.staff_writer', 'on', true);
  staffs := tests.post(staff, t2, 'The bot.');
  perform set_config('kayfabb.staff_writer', '', true);
  owned := tests.post(a1, t1, 'Ann''s.');
  mine := tests.post(b2, t3, 'Bob''s own other mask.');
  perform pg_temp.hand(bob, 'sweetie', 'sweetie', 'sweetie', 'glint', 'glint', 'glint');

  -- post, quoting a post of another player's, of staff's, and of the caster's own other mask's.
  perform tests.become(bob);
  said_owned := post(t1, b1, 'Same words.', owned);
  said_staff := post(t2, b1, 'Same words.', staffs);
  said_mine := post(t3, b1, 'Same words.', mine);
  perform tests.unbecome();
  if pg_temp.shape(said_owned) is distinct from pg_temp.shape(said_staff) or pg_temp.shape(said_owned) is distinct from pg_temp.shape(said_mine) then
    raise exception 'the answer from post differs with who owns the quoted post: % / % / %', pg_temp.shape(said_owned), pg_temp.shape(said_staff), pg_temp.shape(said_mine);
  end if;
  if said_owned::text ~* 'alert' or said_staff::text ~* 'alert' or said_mine::text ~* 'alert' then raise exception 'post''s answer holds the alert'; end if;

  -- play_card on a post, and on a character, of each kind of owner.
  said_owned := play_card(bob, 'sweetie', b1, owned, '{}', 0);
  said_staff := play_card(bob, 'sweetie', b1, staffs, '{}', 0);
  said_mine := play_card(bob, 'sweetie', b1, mine, '{}', 0);
  if pg_temp.shape(said_owned) is distinct from pg_temp.shape(said_staff) or pg_temp.shape(said_owned) is distinct from pg_temp.shape(said_mine) then
    raise exception 'the answer from play_card on a post differs with who owns it: % / % / %', pg_temp.shape(said_owned), pg_temp.shape(said_staff), pg_temp.shape(said_mine);
  end if;
  if said_owned::text ~* 'alert' or said_staff::text ~* 'alert' or said_mine::text ~* 'alert' then raise exception 'play_card''s answer holds the alert'; end if;

  said_owned := play_card(bob, 'glint', b1, a1, '{}', 0, 'Hi.', 'character', owned);
  said_staff := play_card(bob, 'glint', b1, staff, '{}', 0, 'Hi.', 'character', staffs);
  said_mine := play_card(bob, 'glint', b1, b2, '{}', 0, 'Hi.', 'character', mine);
  if pg_temp.shape(said_owned) is distinct from pg_temp.shape(said_staff) or pg_temp.shape(said_owned) is distinct from pg_temp.shape(said_mine) then
    raise exception 'the answer from play_card on a character differs with who owns it: % / % / %', pg_temp.shape(said_owned), pg_temp.shape(said_staff), pg_temp.shape(said_mine);
  end if;
  if said_owned::text ~* 'alert' or said_staff::text ~* 'alert' or said_mine::text ~* 'alert' then raise exception 'play_card''s answer on a character holds the alert'; end if;
  -- The queue is only ever read after the answer: nothing in an answer says a broadcast was queued.
  if (select array_agg(k order by k) from jsonb_object_keys(said_owned) k) is distinct from (select array_agg(k order by k) from jsonb_object_keys(said_staff) k) then
    raise exception 'the answers differ in their keys';
  end if;
end $$;

-- ---- A card on a thread: the same answer whoever started it ----
do $$
declare
  ann uuid := tests.account('th-ann'); bob uuid := tests.account('th-bob');
  a1 uuid := tests.character(ann, 'Th Ann One'); b1 uuid := tests.character(bob, 'Th Bob One'); b2 uuid := tests.character(bob, 'Th Bob Two');
  staff uuid;
  t_owned uuid := tests.thread('Th owned'); t_staff uuid := tests.thread('Th staff'); t_mine uuid := tests.thread('Th mine');
  said_owned jsonb; said_staff jsonb; said_mine jsonb;
begin
  perform pg_temp.cards();
  insert into characters (name, staff, staff_kind, debuted_at) values ('Th Bot', 'th-bot', 'persona', now()) returning id into staff;
  perform tests.post(a1, t_owned, 'Ann starts.');
  perform tests.post(b2, t_mine, 'Bob Two starts.');
  perform set_config('kayfabb.staff_writer', 'on', true);
  perform tests.post(staff, t_staff, 'The bot starts.');
  perform set_config('kayfabb.staff_writer', '', true);
  perform pg_temp.hand(bob, 'marquee', 'marquee', 'marquee');
  said_owned := play_card(bob, 'marquee', b1, t_owned, '{}', 0, '', 'thread');
  said_staff := play_card(bob, 'marquee', b1, t_staff, '{}', 0, '', 'thread');
  said_mine := play_card(bob, 'marquee', b1, t_mine, '{}', 0, '', 'thread');
  if pg_temp.shape(said_owned) is distinct from pg_temp.shape(said_staff) or pg_temp.shape(said_owned) is distinct from pg_temp.shape(said_mine) then
    raise exception 'the answer from play_card on a thread differs with who started it: % / % / %', pg_temp.shape(said_owned), pg_temp.shape(said_staff), pg_temp.shape(said_mine);
  end if;
  if said_owned::text ~* 'alert' or said_staff::text ~* 'alert' or said_mine::text ~* 'alert' then raise exception 'play_card''s answer on a thread holds the alert'; end if;
  if (select count(*) from alerts where account = ann and act = (said_owned ->> 'id')::uuid) is distinct from 1
     or exists (select 1 from alerts where act in ((said_staff ->> 'id')::uuid, (said_mine ->> 'id')::uuid)) then
    raise exception 'only the thread owned by another account wrote an alert';
  end if;
end $$;

-- ---- A trap sprung by a cast, and one sprung with no one named as acting ----
do $$
declare
  ann uuid := tests.account('cs-ann'); bob uuid := tests.account('cs-bob');
  a1 uuid := tests.character(ann, 'Cs Ann One'); a2 uuid := tests.character(ann, 'Cs Ann Two');
  b1 uuid := tests.character(bob, 'Cs Bob One'); b2 uuid := tests.character(bob, 'Cs Bob Two');
  t uuid := tests.thread('Cs');
  anns uuid; bobs uuid; third uuid; reply uuid; said jsonb; r record;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'catcher', 'quoter', 'sweetie');
  perform pg_temp.hand(bob, 'catcher', 'sweetie');
  insert into wallets (account, balance) values (ann, 600), (bob, 600);
  anns := tests.post(a1, t, 'Ann''s trapped post.');
  bobs := tests.post(b2, t, 'Bob Two''s trapped post.');
  perform set_card(ann, 'catcher', a1, anns, '{"card": "sweetie"}', 0, 'sweetie');
  perform set_card(bob, 'catcher', b2, bobs, '{"card": "sweetie"}', 0, 'sweetie');

  -- Bob's cast on Ann's trapped post springs her trap: her trapSprang (about the spring), beside her cardOnYours.
  said := play_card(bob, 'sweetie', b1, anns, '{}', 0);
  if said -> 'sprung' is null then raise exception 'the cast did not spring the trap: %', said; end if;
  select * into r from alerts where kind = 'trapSprang' and account = ann;
  if (select count(*) from alerts where kind = 'trapSprang') is distinct from 1 or r.character is distinct from a1 or r.act is distinct from (said -> 'sprung' ->> 'id')::uuid then
    raise exception 'a cast that springs another''s trap is the setter''s trapSprang: %', (select jsonb_agg(to_jsonb(x)) from alerts x where kind = 'trapSprang');
  end if;
  delete from broadcasts_due where topic like 'account:%'; delete from alerts;

  -- Bob's other mask casts on Bob's own trapped post: his own doing, no alert at all.
  perform pg_temp.hand(bob, 'sweetie');
  said := play_card(bob, 'sweetie', b1, bobs, '{}', 0);
  if said -> 'sprung' is null then raise exception 'the own-mask cast did not spring the trap: %', said; end if;
  if exists (select 1 from alerts) or pg_temp.queued() <> 0 then raise exception 'a cast on one''s own mask''s trap wrote % alerts', (select count(*) from alerts); end if;

  -- With no caster and no signed-in player (the rules name no actor), the setter is still told: the one thing it cannot know is
  -- that the account setting it off is the setter's own, so this pins that it writes the setter's trapSprang and, since the
  -- setter's owner is the struck post's owner, no trapStruck.
  third := tests.post(a1, t, 'A third trapped post.');
  perform set_card(ann, 'quoter', a1, third, '{}', 0);
  reply := tests.post(a2, t, 'Ann Two replies.');
  said := spring_traps('quote', third, reply);
  if said is null then raise exception 'the direct spring did not spring: %', said; end if;
  if (select count(*) from alerts where kind = 'trapSprang' and account = ann and act = (said ->> 'id')::uuid) is distinct from 1 then
    raise exception 'a spring with no named actor writes the setter''s trapSprang: %', (select jsonb_agg(to_jsonb(x)) from alerts x);
  end if;
  if exists (select 1 from alerts where kind = 'trapStruck') then raise exception 'the setter''s owner was written a trapStruck for their own mask''s doing'; end if;
end $$;

-- ---- A quote that springs a Move, a reaction that springs nothing, and a retired character ----
do $$
declare
  ann uuid := tests.account('rx-ann'); bob uuid := tests.account('rx-bob'); cat uuid := tests.account('rx-cat');
  a1 uuid := tests.character(ann, 'Rx Ann One'); b1 uuid := tests.character(bob, 'Rx Bob One'); b2 uuid := tests.character(bob, 'Rx Bob Two');
  c1 uuid := tests.character(cat, 'Rx Cat One');
  t uuid := tests.thread('Rx');
  anns uuid; cats uuid; bobs uuid; plain uuid; said jsonb; said_other jsonb; r record; why text;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'quoter'); perform pg_temp.hand(cat, 'quoter'); perform pg_temp.hand(bob, 'quoter', 'sweetie');
  insert into wallets (account, balance) values (ann, 600), (bob, 600), (cat, 600);
  anns := tests.post(a1, t, 'Ann''s trapped post.');
  cats := tests.post(c1, t, 'Cat''s trapped post.');
  bobs := tests.post(b2, t, 'Bob Two''s trapped post.');
  perform set_card(ann, 'quoter', a1, anns, '{}', 0);
  perform set_card(cat, 'quoter', c1, cats, '{}', 0);
  perform set_card(bob, 'quoter', b2, bobs, '{}', 0);
  delete from broadcasts_due where topic like 'account:%'; delete from alerts;

  -- A reaction springs nothing, whoever set the back: it writes no alert and queues no broadcast.
  perform tests.become(bob);
  said := react(anns, b1, 'meh');
  perform tests.unbecome();
  if said ? 'sprung' or exists (select 1 from alerts) or pg_temp.queued() <> 0 then raise exception 'a reaction sprang a back or wrote an alert: %', said; end if;

  -- Bob One's quote springs Ann's Move: one trapSprang for Ann, about the spring, and a payload of the public projection alone.
  perform tests.become(bob);
  said := post(t, b1, 'Bob quotes the Move.', anns);
  perform tests.unbecome();
  if said -> 'sprung' is null then raise exception 'the quote did not spring the Move: %', said; end if;
  select * into r from alerts where kind = 'trapSprang';
  if (select count(*) from alerts where kind = 'trapSprang') is distinct from 1 or r.account is distinct from ann or r.character is distinct from a1 or r.act is distinct from (said -> 'sprung' ->> 'id')::uuid then
    raise exception 'a quote that springs a Move is the setter''s one trapSprang: %', (select jsonb_agg(to_jsonb(x)) from alerts x);
  end if;
  if (select count(*) from broadcasts_due where topic = 'account:' || ann and payload ->> 'kind' = 'trapSprang') is distinct from 1 then raise exception 'the spring queued % broadcasts on the setter''s channel, not 1', pg_temp.queued(); end if;
  if (select array_agg(k order by k) from broadcasts_due b, jsonb_object_keys(b.payload) k where b.topic like 'account:%' and b.payload ->> 'kind' = 'trapSprang') is distinct from array['act', 'at', 'character', 'id', 'kind', 'sub'] then
    raise exception 'the broadcast holds more than the public projection: %', (select payload from broadcasts_due where topic like 'account:%' and payload ->> 'kind' = 'trapSprang');
  end if;
  -- Masks: an alert's id says nothing of how many alerts were written for others (a shared counter's gaps would count them, and
  -- a skipped alert, one for a target the actor owns, is a private fact). So it is not drawn from a sequence.
  if (select format_type(a.atttypid, a.atttypmod) from pg_attribute a where a.attrelid = 'alerts'::regclass and a.attname = 'id') is distinct from 'uuid'
     or (select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum where d.adrelid = 'alerts'::regclass and a.attname = 'id') ~* 'nextval'
     or exists (select 1 from pg_depend d where d.refobjid = 'alerts'::regclass and d.classid = 'pg_class'::regclass and d.deptype in ('a', 'i') and (select relkind from pg_class where oid = d.objid) = 'S') then
    raise exception 'alerts.id is drawn from a sequence, so its gaps count the alerts written for everyone';
  end if;
  if (select array_agg(c.column_name::text order by c.ordinal_position) from information_schema.columns c where c.table_name = 'alerts' and c.table_schema = 'public')
     is distinct from array['id', 'account', 'kind', 'sub', 'act', 'character', 'at'] then raise exception 'the alert row carries a column besides the account, kind, Act, character and time'; end if;
  if r::text ~ (bob::text || '|' || b1::text) or exists (select 1 from broadcasts_due where topic = 'account:' || ann and payload::text ~ (bob::text || '|' || b1::text)) then
    raise exception 'an alert names the quoter or its account';
  end if;
  delete from broadcasts_due where topic like 'account:%'; delete from alerts;

  -- The answer is the same shape whoever set the Move.
  perform tests.become(bob);
  said_other := post(t, b1, 'Bob quotes Cat''s Move.', cats);
  perform tests.unbecome();
  if (select array_agg(k order by k) from jsonb_object_keys(said) k) is distinct from (select array_agg(k order by k) from jsonb_object_keys(said_other) k)
     or (select array_agg(k order by k) from jsonb_object_keys(said -> 'sprung') k) is distinct from (select array_agg(k order by k) from jsonb_object_keys(said_other -> 'sprung') k)
     or (select array_agg(k order by k) from jsonb_object_keys(said -> 'sprung' -> 'payload') k) is distinct from (select array_agg(k order by k) from jsonb_object_keys(said_other -> 'sprung' -> 'payload') k) then
    raise exception 'post''s answer differs in shape with who set the Move: % / %', said, said_other;
  end if;
  if said::text ~* 'alert' or said_other::text ~* 'alert' then raise exception 'post''s answer holds the alert'; end if;
  delete from broadcasts_due where topic like 'account:%'; delete from alerts;

  -- A reaction by the account that owns the setter is refused outright, so it springs nothing and writes nothing.
  perform tests.become(bob);
  why := pg_temp.refusal(format('select react(%L, %L, %L)', bobs, b1, 'meh'));
  perform tests.unbecome();
  if why is distinct from 'your characters cannot react to each other' then raise exception 'a reaction on one''s own mask''s trap: %', why; end if;
  if exists (select 1 from alerts) or pg_temp.queued() <> 0 then raise exception 'a refused reaction wrote an alert'; end if;

  -- A retired character is still its owner's: a card on its post is still Ann's alert.
  plain := tests.post(a1, t, 'Ann One, retired.');
  update characters set retired_at = now() where id = a1;
  said := play_card(bob, 'sweetie', b1, plain, '{}', 0);
  if (select count(*) from alerts where account = ann and kind = 'cardOnYours' and act = (said ->> 'id')::uuid and character = a1) is distinct from 1 then
    raise exception 'the owner of a retired character got no alert for a card on its post';
  end if;
end $$;

-- ---- Who reads a row, and who may write one ----
do $$
declare
  ann uuid := tests.account('rd-ann'); bob uuid := tests.account('rd-bob'); cat uuid := tests.account('rd-cat');
  a1 uuid := tests.character(ann, 'Rd Ann One'); b1 uuid := tests.character(bob, 'Rd Bob One');
  t uuid := tests.thread('Rd'); p uuid; q uuid; why text; seen bigint;
begin
  p := tests.post(a1, t, 'Ann.');
  perform tests.become(bob);
  q := (post(t, b1, 'Bob quotes Ann.', p) ->> 'id')::uuid;
  perform tests.unbecome();
  if (select count(*) from alerts where account = ann and act = q) is distinct from 1 then raise exception 'Ann has no alert to read'; end if;

  seen := (select count(*) from alerts where account = ann);
  perform tests.become(ann);
  if (select count(*) from alerts) is distinct from seen or seen < 1 then raise exception 'Ann reads % alerts, not her %', (select count(*) from alerts), seen; end if;
  perform tests.unbecome();
  perform tests.become(bob);
  if exists (select 1 from alerts where account <> bob) then raise exception 'Bob reads Ann''s alert'; end if;
  perform tests.unbecome();
  perform tests.become(cat);
  if exists (select 1 from alerts where account <> cat) then raise exception 'Cat reads an alert that is not hers'; end if;
  perform tests.unbecome();
  perform tests.become_anon();
  why := pg_temp.refusal('select count(*) from alerts');
  if why is null then raise exception 'a visitor may read alerts'; end if;
  perform tests.unbecome();

  -- No API role writes one: not the owner, not the service.
  perform tests.become(ann);
  why := pg_temp.refusal(format('insert into alerts (account, kind, act) values (%L, %L, %L)', ann, 'quote', q));
  if why is null then raise exception 'a player inserted an alert'; end if;
  why := pg_temp.refusal('update alerts set kind = ''hint''');
  if why is null then raise exception 'a player updated an alert'; end if;
  why := pg_temp.refusal('delete from alerts');
  if why is null then raise exception 'a player deleted an alert'; end if;
  perform tests.unbecome();
  perform tests.become_service();
  why := pg_temp.refusal(format('insert into alerts (account, kind, act) values (%L, %L, %L)', ann, 'quote', q));
  if why is null then raise exception 'the service role inserted an alert'; end if;
  why := pg_temp.refusal('update alerts set kind = ''hint''');
  if why is null then raise exception 'the service role updated an alert'; end if;
  why := pg_temp.refusal('delete from alerts');
  if why is null then raise exception 'the service role deleted an alert'; end if;
  perform tests.unbecome();
  if exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) r
             where has_table_privilege(r, 'public.alerts', 'insert,update,delete,truncate') or has_function_privilege(r, 'write_alert(uuid,text,text,uuid,uuid)', 'execute')) then
    raise exception 'an API role holds a write on alerts or can call write_alert';
  end if;
  if exists (select 1 from alerts where act = q and kind is distinct from 'quote') or (select count(*) from alerts where act = q) is distinct from 1 then raise exception 'an alert changed under a refused write'; end if;
end $$;
