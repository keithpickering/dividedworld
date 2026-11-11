-- A post may carry No quote (supabase/migrations/0153_card_notes_part_4.sql; docs/plans/2026-11-11-card-notes-part-4-plan.md, Task 3, sections 3 to 7; engine/rules/cards.ts, noQuoteWords, decideUse and decideSet).
-- While a use card whose gimmick is `noQuote` is live on a post, a post, a thread's first post, a spin or an edit that quotes it is refused before it is written, in the same words for every writer (the quoted
-- post's author and a staff character included): its quoting target, or any real quote of it in the body at any depth. A counterfeit quote, copied words and a spin or an edit OF the post are not quotes. An edit
-- is refused only for a quote it adds. When the play's time has passed, or an admin has ended it, quotes are written again. The card is refused on a post with a live back and no card is set face down on a post with
-- the card live, each in its own words. A Mod Bot's reply to a stopped post lands as a plain reply. The cards are this file's own (nq...).

create function pg_temp.coded(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

-- A statement run as a signed-in account: 'ok' when it went through, else the refusal's code and words.
create function pg_temp.as_(account uuid, stmt text) returns text language plpgsql as $$
begin
  perform tests.become(account);
  begin
    execute stmt;
  exception when others then
    perform tests.unbecome();
    return sqlstate || ' ' || sqlerrm;
  end;
  perform tests.unbecome();
  return 'ok';
end $$;

create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k
$$;

create function pg_temp.cards() returns void language plpgsql as $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts, gimmick) values
    ('nqlast', 'Nq Last Word', 'salty', 'uncommon', 'use', null, '{post}', interval '7 days', '{"kind": "noQuote"}'),
    ('nqmove', 'Nq Move', 'salty', 'common', 'cast', null, '{post}', null, null),
    ('nqtrap', 'Nq Trap', 'salty', 'uncommon', 'set', '{"trigger": {"on": "cast"}}', '{post}', null, null)
  on conflict (key) do nothing;
end $$;

-- The refusal the engine's noQuoteWords gives for a post under the play `stop`, written from the post and the play's own end.
create function pg_temp.words(stop uuid, in_thread uuid) returns text language sql as $$
  select format('%s carries Nq Last Word, so it cannot be quoted until %s; take that quote out and send again',
    coalesce('post ' || (select p.seq from acts p where p.id = k.target_act_id and p.thread = in_thread), 'a post in another thread'),
    refusal_time((k.payload ->> 'ends')::timestamptz))
  from acts k where k.id = stop
$$;

-- ---- The read: the live no-quote play on a post, for no API role ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('nq-read-ann');
  a uuid := tests.character(ann, 'Nq Read Ann');
  t uuid := tests.thread('Nq read');
  p uuid := tests.post(a, t, 'Stopped.'); q uuid := tests.post(a, t, 'Not stopped.'); done uuid := tests.post(a, t, 'Over.'); caught uuid := tests.post(a, t, 'Caught.');
  live uuid; n integer;
begin
  perform pg_temp.cards();
  live := tests.act(a, 'card', t, jsonb_build_object('card', 'nqlast', 'message', '', 'config', '{}'::jsonb, 'layer', 1, 'ends', now() + interval '2 days'), p);
  perform tests.act(a, 'card', t, jsonb_build_object('card', 'nqlast', 'message', '', 'config', '{}'::jsonb, 'layer', 1, 'ends', now() - interval '1 hour'), done, now() - interval '8 days');
  perform tests.act(a, 'card', t, jsonb_build_object('card', 'nqlast', 'message', '', 'config', '{}'::jsonb, 'ends', now() + interval '2 days', 'caught', gen_random_uuid()::text), caught);
  select count(*) into n from no_quote_on(p);
  if n <> 1 or (select s.name from no_quote_on(p) s) is distinct from 'Nq Last Word' or (select s.ends from no_quote_on(p) s) is distinct from now() + interval '2 days' then raise exception 'the live no-quote on a post: % rows', n; end if;
  if exists (select 1 from no_quote_on(q)) then raise exception 'a post with no play has one'; end if;
  if exists (select 1 from no_quote_on(done)) then raise exception 'a play whose time has passed is live'; end if;
  if exists (select 1 from no_quote_on(caught)) then raise exception 'a caught play is live'; end if;
  perform set_config('kayfabb.card_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload) values (null, 'card_end', t, live, '{"why": "reversed", "by": "admin"}');
  perform set_config('kayfabb.card_end_writer', '', true);
  if exists (select 1 from no_quote_on(p)) then raise exception 'a play an admin ended is live'; end if;
  if has_function_privilege('authenticated', 'no_quote_on(uuid)', 'execute') or has_function_privilege('anon', 'no_quote_on(uuid)', 'execute') or has_function_privilege('service_role', 'no_quote_on(uuid)', 'execute') then
    raise exception 'an API role can read no_quote_on';
  end if;
end $$;

-- ---- A post that quotes a stopped post is refused, whoever writes it and however it quotes ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('nq-ann'); bob uuid := tests.account('nq-bob');
  a uuid := tests.character(ann, 'Nq Ann'); b uuid := tests.character(bob, 'Nq Bob');
  t uuid := tests.thread('Nq thread'); t2 uuid := tests.thread('Nq other thread');
  p uuid := tests.post(a, t, 'Stopped.'); p2 uuid := tests.post(a, t, 'Another post.');
  pb uuid := tests.post(b, t, 'Bob writes something.');
  earlier uuid := tests.act(b, 'post', t, jsonb_build_object('body', '[quote=' || p || ']hi[/quote] before'), p);
  lw uuid; want text; got text; other text; hint text;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'nqlast');
  perform tests.become_service();
  lw := (play_card(ann, 'nqlast', a, p, '{}', 0, '') ->> 'id')::uuid;
  perform tests.unbecome();
  want := '42501 ' || pg_temp.words(lw, t);
  if want not like '42501 post % carries Nq Last Word, so it cannot be quoted until 20%-% UTC; take that quote out and send again' then raise exception 'the words are %', want; end if;

  -- The quoting target: refused in the words with the post's number; the same post with no target and no quote is written.
  got := pg_temp.as_(bob, format('select post(%L, %L, %L, %L)', t, b, 'Quoting it.', p));
  if got is distinct from want then raise exception 'a quote of a stopped post by its target: %', got; end if;
  got := pg_temp.as_(bob, format('select post(%L, %L, %L)', t, b, 'A plain reply.'));
  if got is distinct from 'ok' then raise exception 'a plain reply was refused: %', got; end if;
  got := pg_temp.as_(bob, format('select post(%L, %L, %L, %L)', t, b, 'Quoting another post.', p2));
  if got is distinct from 'ok' then raise exception 'a quote of a post that is not stopped was refused: %', got; end if;

  -- A real quote in the body: with another target, with none, inside a quote of another post; a counterfeit and a quote inside code are not quotes.
  got := pg_temp.as_(bob, format('select post(%L, %L, %L, %L)', t, b, format('[quote=%s]hi[/quote] and more', p), p2));
  if got is distinct from want then raise exception 'a body quote of a stopped post, with another target: %', got; end if;
  got := pg_temp.as_(bob, format('select post(%L, %L, %L)', t, b, format('[quote=%s]hi[/quote] and more', p)));
  if got is distinct from want then raise exception 'a body quote of a stopped post, with no target: %', got; end if;
  got := pg_temp.as_(bob, format('select post(%L, %L, %L)', t, b, format('[QUOTE="%s" user=%s]hi[/QUOTE]', upper(p::text), b)));
  if got is distinct from want then raise exception 'a body quote naming the post in capitals: %', got; end if;
  got := pg_temp.as_(bob, format('select post(%L, %L, %L)', t, b, format('[quote=%s]a [quote=%s]b[/quote][/quote]', p2, p)));
  if got is distinct from want then raise exception 'a stopped post quoted inside a quote of another post: %', got; end if;
  got := pg_temp.as_(bob, format('select post(%L, %L, %L)', t, b, format('[code][quote=%s]hi[/quote][/code]', p)));
  if got is distinct from 'ok' then raise exception 'a quote inside code was refused: %', got; end if;
  got := pg_temp.as_(bob, format('select post(%L, %L, %L)', t, b, format('[quote=Someone]hi[/quote] and the id %s in words', p)));
  if got is distinct from 'ok' then raise exception 'a quote of a name, and an id in words, were refused: %', got; end if;

  -- A thread's first post, and a spin's words: each starts a thread of its own, so the quoted post is in another thread.
  other := '42501 ' || pg_temp.words(lw, gen_random_uuid());
  got := pg_temp.as_(bob, format('select start_thread(%L, %L, %L, %L)', 'general', b, 'A new thread', format('[quote=%s]hi[/quote] starting', p)));
  if got is distinct from other then raise exception 'a thread''s first post that quotes a stopped post: %', got; end if;
  if exists (select 1 from threads where title = 'A new thread') then raise exception 'a refused first post left a thread'; end if;
  got := pg_temp.as_(bob, format('select spin(%L, %L, %L, %L)', p2, b, 'Spun', format('[quote=%s]hi[/quote] spinning', p)));
  if got is distinct from other then raise exception 'a spin whose words quote a stopped post: %', got; end if;

  -- A quote from another thread says so, with no number; and the quoted post's own author is refused in the same words as anyone.
  got := pg_temp.as_(bob, format('select post(%L, %L, %L)', t2, b, format('[quote=%s]hi[/quote] elsewhere', p)));
  if got is distinct from other or got not like '42501 a post in another thread carries Nq Last Word, so it cannot be quoted until %' then raise exception 'a quote from another thread: %', got; end if;
  got := pg_temp.as_(ann, format('select post(%L, %L, %L)', t, a, format('[quote=%s]me[/quote] again', p)));
  if got is distinct from want then raise exception 'the quoted post''s own author: %', got; end if;
  begin
    perform tests.become(bob);
    perform post(t, b, format('[quote=%s]hi[/quote] more', p));
    raise exception 'a stopped quote was written';
  exception when sqlstate '42501' then
    get stacked diagnostics hint = pg_exception_hint;
    perform tests.unbecome();
    if hint is distinct from 'kayfabb.refusal' then raise exception 'the refusal carries the hint %', hint; end if;
  end;
  if exists (select 1 from acts where kind in ('post', 'spin') and thread in (t, t2) and payload ->> 'body' like '%[quote=' || p || ']hi[/quote] and more' and id <> earlier) then raise exception 'a refused quote left an Act'; end if;

  -- Edits: one that adds the quote is refused; one that keeps a quote the post already held is written; the stopped post's own edit is written; a quote of another post is written.
  got := pg_temp.as_(bob, format('select edit_post(%L, %L, %L)', pb, b, format('now [quote=%s]x[/quote]', p)));
  if got is distinct from want then raise exception 'an edit that adds the quote: %', got; end if;
  got := pg_temp.as_(bob, format('select edit_post(%L, %L, %L)', earlier, b, format('[quote=%s]hi[/quote] before, and changed', p)));
  if got is distinct from 'ok' then raise exception 'an edit of a post that already held the quote: %', got; end if;
  got := pg_temp.as_(bob, format('select edit_post(%L, %L, %L)', earlier, b, format('[quote=%s]hi[/quote] [quote=%s]x[/quote] and a second quote', p, p2)));
  if got is distinct from 'ok' then raise exception 'an edit that keeps the old quote and adds another post''s: %', got; end if;
  got := pg_temp.as_(ann, format('select edit_post(%L, %L, %L)', p, a, 'Stopped, and reworded.'));
  if got is distinct from 'ok' then raise exception 'an edit of the stopped post by its author: %', got; end if;

  -- A spin FROM the stopped post is not a quote of it.
  got := pg_temp.as_(bob, format('select spin(%L, %L, %L, %L)', p, b, 'Spun from the stopped post', 'Just words.'));
  if got is distinct from 'ok' then raise exception 'a spin from the stopped post: %', got; end if;
end $$;

-- ---- When the time has passed, or an admin has ended the play, the quote is written ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('nq-end-ann'); bob uuid := tests.account('nq-end-bob'); adm uuid := tests.account('nq-end-admin');
  a uuid := tests.character(ann, 'Nq End Ann'); b uuid := tests.character(bob, 'Nq End Bob');
  t uuid := tests.thread('Nq end thread');
  over uuid := tests.post(a, t, 'Its Last Word is over.'); admin_ended uuid := tests.post(a, t, 'An admin ended its Last Word.');
  lw uuid; got text;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'nqlast');
  insert into admins (account) values (adm);
  perform tests.act(a, 'card', t, jsonb_build_object('card', 'nqlast', 'message', '', 'config', '{}'::jsonb, 'layer', 1, 'ends', now() - interval '1 hour'), over, now() - interval '8 days');
  got := pg_temp.as_(bob, format('select post(%L, %L, %L, %L)', t, b, 'Quoting it.', over));
  if got is distinct from 'ok' then raise exception 'a quote after the time had passed: %', got; end if;
  got := pg_temp.as_(bob, format('select post(%L, %L, %L)', t, b, format('[quote=%s]hi[/quote]', over)));
  if got is distinct from 'ok' then raise exception 'a body quote after the time had passed: %', got; end if;

  perform tests.become_service();
  lw := (play_card(ann, 'nqlast', a, admin_ended, '{}', 0, '') ->> 'id')::uuid;
  perform tests.unbecome();
  got := pg_temp.as_(bob, format('select post(%L, %L, %L, %L)', t, b, 'Quoting it.', admin_ended));
  if got is distinct from '42501 ' || pg_temp.words(lw, t) then raise exception 'a quote while it is live: %', got; end if;
  perform tests.become(adm);
  perform reverse_card(lw);
  perform tests.unbecome();
  got := pg_temp.as_(bob, format('select post(%L, %L, %L, %L)', t, b, 'Quoting it now.', admin_ended));
  if got is distinct from 'ok' then raise exception 'a quote after an admin ended it: %', got; end if;
end $$;

-- ---- A back and a no-quote never share a post ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('nq-back-ann'); bob uuid := tests.account('nq-back-bob');
  a uuid := tests.character(ann, 'Nq Back Ann'); b uuid := tests.character(bob, 'Nq Back Bob');
  t uuid := tests.thread('Nq back thread');
  held uuid := tests.post(a, t, 'A back lies here.'); stopped uuid := tests.post(a, t, 'Its Last Word is live.'); freed uuid := tests.post(a, t, 'Its Last Word is over.');
  back uuid; lw uuid; got text; made jsonb; set_words text;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'nqmove', 'nqmove', 'nqmove', 'nqtrap', 'nqlast', 'nqlast', 'nqlast');
  perform tests.become_service();
  back := (set_card(ann, 'nqmove', a, held, '{}', 0) ->> 'id')::uuid;

  -- The card is refused on a post with a live back, in decideUse's words, writing and spending nothing; once the back is taken back it lands.
  got := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', ann, 'nqlast', a, held, '{}', ''));
  if got is distinct from '23505 Nq Last Word stops quotes, and this post holds a card face down; take that card back first' then raise exception 'No quote on a post with a back: %', got; end if;
  if exists (select 1 from acts where kind = 'card' and target_act_id = held) or card_held(ann, 'nqlast') is distinct from 3 then raise exception 'a refused No quote wrote or spent'; end if;
  perform take_back(ann, a, back);
  made := play_card(ann, 'nqlast', a, held, '{}', 0, '');
  if made ->> 'id' is null then raise exception 'No quote was not accepted after the back was taken back: %', made; end if;

  -- A card is refused set face down on a post with a live No quote, a Move's and a Reversal's alike, in decideSet's words with the play's end.
  lw := (play_card(ann, 'nqlast', a, stopped, '{}', 0, '') ->> 'id')::uuid;
  set_words := '23505 this post''s Nq Last Word stops quotes until ' || refusal_time((select (k.payload ->> 'ends')::timestamptz from acts k where k.id = lw)) || ', so no card is set face down here until then';
  got := pg_temp.coded(format('select set_card(%L, %L, %L, %L, %L, 0)', ann, 'nqmove', a, stopped, '{}'));
  if got is distinct from set_words then raise exception 'a Move set on a post with No quote: %', got; end if;
  got := pg_temp.coded(format('select set_card(%L, %L, %L, %L, %L, 0, %L)', ann, 'nqtrap', a, stopped, '{}', 'nqmove'));
  if got is distinct from set_words then raise exception 'a Reversal set on a post with No quote: %', got; end if;
  if exists (select 1 from face_down where post = stopped) or card_held(ann, 'nqmove') is distinct from 3 then raise exception 'a refused set wrote or spent'; end if;

  -- Once the play has ended, a card is set again there; and a quote of it springs that back as before.
  perform tests.unbecome();
  perform tests.act(a, 'card', t, jsonb_build_object('card', 'nqlast', 'message', '', 'config', '{}'::jsonb, 'layer', 1, 'ends', now() - interval '1 hour'), freed, now() - interval '8 days');
  perform tests.become_service();
  perform set_card(ann, 'nqmove', a, freed, '{}', 0);
  perform tests.unbecome();
  perform tests.become(bob);
  made := post(t, b, 'Quoting a post whose Last Word is over.', freed);
  perform tests.unbecome();
  if made -> 'sprung' is null then raise exception 'a quote of a post whose No quote has ended did not spring its back: %', made; end if;
end $$;

-- ---- A Mod Bot's reply to a stopped post lands as a plain reply; its own quote is refused like anyone's ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('nq-staff-ann');
  a uuid := tests.character(ann, 'Nq Staff Ann');
  bot uuid;
  t uuid := tests.thread('Nq staff thread');
  p uuid := tests.post(a, t, 'Stopped.'); p2 uuid := tests.post(a, t, 'Not stopped.');
  lw uuid; made jsonb; got text; reply uuid; bp uuid;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'nqlast');
  insert into characters (name, staff, staff_kind, debuted_at) values ('Nq Bot', 'nq-bot', 'persona', now()) returning characters.id into bot;
  perform tests.become_service();
  lw := (play_card(ann, 'nqlast', a, p, '{}', 0, '') ->> 'id')::uuid;

  made := write_staff_act('nq-bot', 'post', t, p, '{"body": "A pool reply."}');
  reply := (made ->> 'id')::uuid;
  if (select (a2.character, a2.kind, a2.target_act_id, a2.payload ->> 'body') from acts a2 where a2.id = reply) is distinct from (bot, 'post'::text, null::uuid, 'A pool reply.'::text) then
    raise exception 'a pool reply to a stopped post: %', (select to_jsonb(a2) from acts a2 where a2.id = reply);
  end if;
  if made ? 'sprung' or exists (select 1 from acts where kind = 'spring' and target_act_id = p) then raise exception 'a pool reply to a stopped post sprang something: %', made; end if;
  -- A post that is not stopped keeps its target.
  made := write_staff_act('nq-bot', 'post', t, p2, '{"body": "A pool reply to another."}');
  if (select target_act_id from acts where id = (made ->> 'id')::uuid) is distinct from p2 then raise exception 'a pool reply to a post that is not stopped lost its target'; end if;
  -- Its body that holds a real quote of the stopped post is refused, as anyone's is.
  got := pg_temp.coded(format('select write_staff_act(%L, %L, %L, null, %L)', 'nq-bot', 'post', t, jsonb_build_object('body', format('[quote=%s]x[/quote] a reply', p))::text));
  if got is distinct from '42501 ' || pg_temp.words(lw, t) then raise exception 'a pool body that quotes a stopped post: %', got; end if;
  -- A persona's set goes through place_set, so it is held too.
  insert into settings (key, value) values ('pool', '{"weekly": 20, "holdback": 0.2, "threadsWeekly": 1, "cardRarityMost": "uncommon", "priorityDays": 28, "notesRead": 12, "chatterThreadPosts": 8, "strengths": {"named": 5, "quoted": 5, "legacy": 5, "successorStumbles": 5, "oldFlame": 5, "homeTurf": 2, "seasonTurn": 2, "hotOnBeat": 2}, "chatterCron": "37 17 * * *"}') on conflict (key) do update set value = excluded.value;
  bp := (write_staff_act('nq-bot', 'post', t, null, '{"body": "A pool post."}') ->> 'id')::uuid;
  perform tests.unbecome();
  perform tests.act(a, 'card', t, jsonb_build_object('card', 'nqlast', 'message', '', 'config', '{}'::jsonb, 'layer', 1, 'ends', now() + interval '3 days'), bp);
  perform tests.become_service();
  got := pg_temp.coded(format('select staff_set_card(%L, %L, %L, %L, %L)', 'nq-bot', 'nqtrap', bp, '{}', 'nqmove'));
  if got is distinct from '23505 this post''s Nq Last Word stops quotes until ' || refusal_time(now() + interval '3 days') || ', so no card is set face down here until then' then
    raise exception 'a persona''s set on a post with No quote: %', got;
  end if;
  perform tests.unbecome();
end $$;
