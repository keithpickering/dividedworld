-- Alerts written with their Acts (supabase/migrations/0058_alerts.sql): a quote, a card on a post, a character or a thread, a
-- trap struck and a trap sprung each write one row for the right account and queue one broadcast on `account:<owner>`; a board
-- play, a play on a staff character and a play by the owner's own other mask write none. The caster's answer from post and
-- play_card is the same projection, field for field, whatever owns the target, and never holds the alert. An account reads its
-- own rows alone, and no API role can write one. docs/plans/2026-11-02-alerts-plan.md, Task 3; the design, sections 2 and 10.
-- The cards are the engine's test set, never an instance's.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function pg_temp.cards() returns void language plpgsql as $$
begin
  update settings set value = value || '{"glint.price": 100, "marquee.price": 100, "quake.price": 100, "quoter.price": 100, "sweetie.price": 10}' where key = 'economy';
  insert into card_kinds (key, name, alignment, price_setting, rarity, play, reaches, lasts, trap) values
    ('glint', 'Glint', 'pepperoni', 'glint.price', 'uncommon', 'cast', '{character}', interval '7 days', null),
    ('marquee', 'Marquee', 'sweet', 'marquee.price', 'rare', 'cast', '{thread}', interval '1 day', null),
    ('quake', 'Quake', 'salty', 'quake.price', 'legendary', 'cast', '{board}', interval '1 day', null),
    ('quoter', 'Quoter', 'salty', 'quoter.price', 'uncommon', 'set', '{post}', null, '{"trigger": {"on": "quote"}, "outcome": {"do": "strike", "card": "sweetie"}}')
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
  insert into characters (name, staff, staff_kind, debuted_at) values ('Al Bot', 'al-bot', 'bot', now()) returning id into staff;
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
  if (select payload from broadcasts_due where topic = 'account:' || ann) is distinct from jsonb_build_object('kind', 'quote', 'sub', null, 'act', r.act, 'character', a1, 'at', r.at)
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
  if (select count(*) from alerts) <> 1 or r.kind <> 'cardOnYours' or r.account <> ann or r.character <> a1 or r.act <> (said ->> 'id')::uuid then
    raise exception 'a card on a post is Ann''s cardOnYours about the play: % / %', to_jsonb(r), (select count(*) from alerts);
  end if;
  if (select count(*) from broadcasts_due where topic = 'account:' || ann) <> 1 or pg_temp.queued() <> 1 then raise exception 'a card on a post queued % account broadcasts', pg_temp.queued(); end if;
  delete from broadcasts_due where topic like 'account:%'; delete from alerts;

  -- A card on a character: Ann's Ann One, from her post.
  said := play_card(bob, 'glint', b1, a1, '{}', 0, '', 'character', a1_post);
  select * into r from alerts;
  if (select count(*) from alerts) <> 1 or r.kind <> 'cardOnYours' or r.account <> ann or r.character <> a1 or r.act <> (said ->> 'id')::uuid then
    raise exception 'a card on a character is Ann''s cardOnYours: % / %', to_jsonb(r), (select count(*) from alerts);
  end if;
  if (select count(*) from broadcasts_due where topic = 'account:' || ann) <> 1 or pg_temp.queued() <> 1 then raise exception 'a card on a character queued % account broadcasts', pg_temp.queued(); end if;
  delete from broadcasts_due where topic like 'account:%'; delete from alerts;

  -- A card on a thread: the player of the character that started it.
  said := play_card(bob, 'marquee', b1, mine_t, '{}', 0, '', 'thread');
  select * into r from alerts;
  if (select count(*) from alerts) <> 1 or r.kind <> 'cardOnYours' or r.account <> ann or r.character <> a1 or r.act <> (said ->> 'id')::uuid then
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

  -- A trap sprung and struck. Ann sets a Quoter on her post; Bob quotes it: the strike lands on Bob's own post, so he is told by his
  -- answer and Ann by an alert about the spring (trapSprang). Nothing is written for Bob: he is the actor.
  trapped := tests.post(a1, t, 'A trapped post.');
  perform set_card(ann, 'quoter', a1, trapped, '{}', 0);
  perform tests.become(bob);
  said := post(t, b1, 'Bob quotes the trap.', trapped);
  perform tests.unbecome();
  sprung_act := (said -> 'sprung' ->> 'id')::uuid;
  if sprung_act is null then raise exception 'the quote did not spring the trap: %', said; end if;
  if (select count(*) from alerts where kind = 'quote') <> 1 then raise exception 'the quote of the trapped post wrote no quote alert'; end if;
  select * into r from alerts where kind = 'trapSprang';
  if (select count(*) from alerts where kind = 'trapSprang') <> 1 or r.account <> ann or r.character <> a1 or r.act <> sprung_act then
    raise exception 'a trap sprung is the setter''s, about the spring: %', to_jsonb(r);
  end if;
  -- The replier's post was struck by a trap another account set: the replier's own trapStruck, about the card that struck. It goes
  -- to the replier's own account, so it tells no one else anything.
  select * into r from alerts where kind = 'trapStruck';
  if (select count(*) from alerts where kind = 'trapStruck') <> 1 or r.account <> bob or r.character <> b1 or r.act <> (said -> 'sprung' -> 'struck' ->> 'id')::uuid then
    raise exception 'a trap set off against another player''s is the replier''s trapStruck: %', (select jsonb_agg(to_jsonb(x)) from alerts x);
  end if;
  if (select count(*) from broadcasts_due where topic like 'account:%') <> 3 then raise exception 'a quote that sprang a trap queued % broadcasts, not 3', pg_temp.queued(); end if;
  delete from broadcasts_due where topic like 'account:%'; delete from alerts;

  -- A trap Bob set on his other mask's post, set off by his Bob One: his own doing to himself, so no alert at all.
  perform pg_temp.hand(bob, 'quoter');
  perform set_card(bob, 'quoter', b2, b2_post, '{}', 0);
  perform tests.become(bob);
  said := post(t, b1, 'Bob quotes his own trap.', b2_post);
  perform tests.unbecome();
  if said -> 'sprung' is null then raise exception 'the quote did not spring the own-mask trap: %', said; end if;
  if exists (select 1 from alerts) or pg_temp.queued() <> 0 then raise exception 'a trap of one''s own mask set off by oneself wrote % alerts', (select count(*) from alerts); end if;

  -- A strike that lands on a post whose author is not the one acting (a path the rules do not take today, but spring_traps takes
  -- the post it strikes as given) is that author's trapStruck, about the card that struck.
  trapped2 := tests.post(a1, t, 'Another trapped post.');
  perform set_card(ann, 'quoter', a1, trapped2, '{}', 0);
  reply := tests.post(c1, t, 'Cat quotes the trap.');
  said := spring_traps('quote', trapped2, reply);
  if said is null or said -> 'struck' is null then raise exception 'the direct spring did not strike: %', said; end if;
  select * into r from alerts where kind = 'trapStruck';
  if (select count(*) from alerts where kind = 'trapStruck') <> 1 or r.account <> cat or r.character <> c1 or r.act <> (said -> 'struck' ->> 'id')::uuid then
    raise exception 'a trap struck is the struck post''s author''s, about the card that struck: %', to_jsonb(r);
  end if;
  select * into r from alerts where kind = 'trapSprang';
  if (select count(*) from alerts where kind = 'trapSprang') <> 1 or r.account <> ann or r.act <> (said ->> 'id')::uuid then
    raise exception 'the same spring is also the setter''s trapSprang: %', to_jsonb(r);
  end if;
  if pg_temp.queued() <> 2 then raise exception 'a strike and its spring queued % account broadcasts, not 2', pg_temp.queued(); end if;
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
  insert into characters (name, staff, staff_kind, debuted_at) values ('As Bot', 'as-bot', 'bot', now()) returning id into staff;
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
  if (select count(*) from alerts where account = ann and act = q) <> 1 then raise exception 'Ann has no alert to read'; end if;

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
  if exists (select 1 from alerts where act = q and kind <> 'quote') or (select count(*) from alerts where act = q) <> 1 then raise exception 'an alert changed under a refused write'; end if;
end $$;
