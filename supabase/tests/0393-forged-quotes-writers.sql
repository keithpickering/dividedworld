-- The writers and the guards (supabase/migrations/0393_forged_quotes.sql, section 4; docs/plans/2026-11-20-forged-quotes-plan.md, Task 4; docs/plans/2026-11-20-forged-quotes-design.md, sections 1, 6 and 11).
-- A real quote whose words are not in the post it names is a counterfeit, so the Act that holds it quotes no post: post() and write_staff_act spring no back and write no `quote` alert (the
-- trigger wrote the Act with no target and they read the target from the row), No-quote does not refuse it, the conduct layer does not empty it, and the quoted post's author is told with a
-- `framed` alert by post, start_thread and spin, counted with `framing` toward the same five. Each negative has a twin that must pass, so a writer that always or never treats a quote as forged fails one.
-- The cards are this file's own (fw...).

create function pg_temp.coded(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

-- post() as a signed-in account.
create function pg_temp.post_as(who uuid, in_thread uuid, through uuid, body text, quoting uuid default null, framing uuid[] default '{}') returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform tests.become(who);
  begin
    r := post(in_thread, through, body, quoting, framing);
  exception when others then
    perform tests.unbecome();
    raise;
  end;
  perform tests.unbecome();
  return r;
end $$;

create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k, generate_series(1, 14)
$$;

create function pg_temp.alerts_of(act_id uuid, of_kind text) returns bigint language sql as $$
  select count(*) from alerts where kind = of_kind and act = act_id
$$;

create function pg_temp.sprung_on(p uuid) returns bigint language sql as $$
  select count(*) from acts where kind = 'spring' and target_act_id = p
$$;

insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts, gimmick) values
  ('fwmove', 'Fw Move', 'salty', 'common', 'cast', null, '{post}', null, null),
  ('fwlast', 'Fw Last Word', 'salty', 'uncommon', 'use', null, '{post}', interval '7 days', '{"kind": "noQuote"}');

insert into card_kinds (key, name, alignment, rarity, play, stack, reaches, replies, trap, lasts, gimmick) values
  ('fwcut', 'Fw Cut', 'pepperoni', 'rare', 'cast', 1, '{post}', true, null, null, null);

-- ---- the function exists, and no API role runs it ----
do $$
begin
  if to_regprocedure('write_forged_framed(uuid,uuid,uuid[])') is null then raise exception 'write_forged_framed(uuid, uuid, uuid[]) does not exist'; end if;
  if exists (select 1 from pg_proc p, unnest(array['anon', 'authenticated', 'service_role']) r
             where p.oid = 'write_forged_framed(uuid,uuid,uuid[])'::regprocedure and has_function_privilege(r, p.oid, 'execute')) then
    raise exception 'an API role can run write_forged_framed';
  end if;
end $$;

-- ---- post: a doctored quote of a trapped post springs nothing, writes no quote alert, and frames its author ----
do $$
declare
  ann uuid := tests.account('fw-ann'); bob uuid := tests.account('fw-bob');
  a uuid := tests.character(ann, 'Fw Ann'); b uuid := tests.character(bob, 'Fw Bob');
  t uuid := tests.thread('Fw trapped');
  p uuid := tests.post(a, t, 'The trapped post: the punchline.');
  p2 uuid := tests.post(a, t, 'The second trapped post: another punchline.');
  back uuid; back2 uuid; made jsonb; w uuid; honest jsonb; h uuid;
begin
  perform pg_temp.hand(ann, 'fwmove');
  back := (set_card(ann, 'fwmove', a, p, '{}', 0) ->> 'id')::uuid;
  back2 := (set_card(ann, 'fwmove', a, p2, '{}', 0) ->> 'id')::uuid;

  made := pg_temp.post_as(bob, t, b, format('[quote=%s]a punchline nobody wrote[/quote] ha', p), p);
  w := (made ->> 'id')::uuid;
  if made ? 'sprung' then raise exception 'a doctored quote sprang the back: %', made; end if;
  if exists (select 1 from acts where kind = 'spring' and (payload ->> 'set') = back::text) then raise exception 'a doctored quote wrote a spring'; end if;
  if (select target_act_id from acts where id = w) is not null then raise exception 'a doctored quote kept its target'; end if;
  if (select payload -> 'forged' from acts where id = w) is distinct from to_jsonb(array[p]) then raise exception 'the doctored quote has no verdict: %', (select payload from acts where id = w); end if;
  if pg_temp.alerts_of(w, 'quote') <> 0 then raise exception 'a doctored quote wrote a quote alert'; end if;
  if pg_temp.alerts_of(w, 'framed') <> 1 or not exists (select 1 from alerts where kind = 'framed' and act = w and account = ann and character = a) then
    raise exception 'a doctored quote did not frame its author: % framed alerts', pg_temp.alerts_of(w, 'framed');
  end if;

  -- the twin: an honest quote of the same kind of post springs its back and writes the quote alert, and frames nobody
  honest := pg_temp.post_as(bob, t, b, format('[quote=%s]another punchline[/quote] ha', p2), p2);
  h := (honest ->> 'id')::uuid;
  if not (honest ? 'sprung') or not exists (select 1 from acts where kind = 'spring' and (payload ->> 'set') = back2::text) then raise exception 'an honest quote did not spring the back: %', honest; end if;
  if (select target_act_id from acts where id = h) is distinct from p2 then raise exception 'an honest quote lost its target'; end if;
  if pg_temp.alerts_of(h, 'quote') <> 1 or pg_temp.alerts_of(h, 'framed') <> 0 then raise exception 'an honest quote wrote % quote and % framed alerts', pg_temp.alerts_of(h, 'quote'), pg_temp.alerts_of(h, 'framed'); end if;
  -- the first back is still there for an honest quote of it
  honest := pg_temp.post_as(bob, t, b, format('[quote=%s]the punchline[/quote] ha', p), p);
  if not (honest ? 'sprung') then raise exception 'the back a doctored quote left was not sprung by an honest one: %', honest; end if;
end $$;

-- ---- No-quote: a doctored quote of a stopped post is written; an honest one is refused ----
do $$
declare
  ann uuid := tests.account('fw-nq-ann'); bob uuid := tests.account('fw-nq-bob');
  a uuid := tests.character(ann, 'Fw Nq Ann'); b uuid := tests.character(bob, 'Fw Nq Bob');
  t uuid := tests.thread('Fw no-quote');
  p uuid := tests.post(a, t, 'Stopped words.');
  got text; made jsonb;
begin
  perform pg_temp.hand(ann, 'fwlast');
  perform play_card(ann, 'fwlast', a, p, '{}', 0, '');
  got := pg_temp.coded(format('select pg_temp.post_as(%L, %L, %L, %L)', bob, t, b, format('[quote=%s]words nobody wrote[/quote]', p)));
  if got is not null then raise exception 'a doctored quote of a stopped post was refused: %', got; end if;
  got := pg_temp.coded(format('select pg_temp.post_as(%L, %L, %L, %L, %L)', bob, t, b, format('words nobody wrote [quote=%s]x[/quote]', p), p));
  if got is not null then raise exception 'a doctored quote with the stopped post as its target was refused: %', got; end if;
  got := pg_temp.coded(format('select pg_temp.post_as(%L, %L, %L, %L)', bob, t, b, format('[quote=%s]Stopped words.[/quote]', p)));
  if got is null or got not like '42501 %' then raise exception 'an honest quote of a stopped post was written: %', coalesce(got, 'ok'); end if;
  -- a thread start and a spin hold the same rule
  perform tests.become(bob);
  made := start_thread('general', b, 'Fw nq start doctored', format('[quote=%s]words nobody wrote[/quote]', p));
  if made -> 'act' ->> 'id' is null then raise exception 'a doctored quote started a thread: %', made; end if;
  made := spin(p, b, 'Fw nq spin doctored', format('[quote=%s]words nobody wrote[/quote]', p));
  if made -> 'act' ->> 'id' is null then raise exception 'a doctored quote spun a thread: %', made; end if;
  perform tests.unbecome();
  got := pg_temp.coded(format('select pg_temp.post_as(%L, %L, %L, %L)', bob, t, b, format('[quote=%s]Stopped words.[/quote]', p)));
  if got is null or got not like '42501 %' then raise exception 'an honest quote of a stopped post was written again: %', coalesce(got, 'ok'); end if;
end $$;

-- ---- No-quote on an edit: an edit that adds a doctored quote of a stopped post is written, an honest one refused ----
do $$
declare
  ann uuid := tests.account('fw-ne-ann'); bob uuid := tests.account('fw-ne-bob');
  a uuid := tests.character(ann, 'Fw Ne Ann'); b uuid := tests.character(bob, 'Fw Ne Bob');
  t uuid := tests.thread('Fw no-quote edit');
  p uuid := tests.post(a, t, 'Stopped edit words.');
  mine uuid := tests.post(b, t, 'My own post.');
  got text; e jsonb;
begin
  perform pg_temp.hand(ann, 'fwlast');
  perform play_card(ann, 'fwlast', a, p, '{}', 0, '');
  perform tests.become(bob);
  e := edit_post(mine, b, format('now [quote=%s]words nobody wrote[/quote]', p));
  perform tests.unbecome();
  if e is null then raise exception 'a doctored quote added by an edit was refused'; end if;
  if (select payload -> 'forged' from acts where kind = 'edit' and target_act_id = mine order by created_at desc limit 1) is distinct from to_jsonb(array[p]) then raise exception 'the edit has no verdict'; end if;
  perform tests.become(bob);
  got := pg_temp.coded(format('select edit_post(%L, %L, %L)', mine, b, format('now [quote=%s]Stopped edit words.[/quote]', p)));
  perform tests.unbecome();
  if got is null or got not like '42501 %' then raise exception 'an edit that added an honest quote of a stopped post was written: %', coalesce(got, 'ok'); end if;
  -- the edit's own earlier doctored quote is not "already there" for an honest one to hide behind: the current body's quote was a counterfeit
  perform tests.become(bob);
  got := pg_temp.coded(format('select edit_post(%L, %L, %L)', mine, b, format('again [quote=%s]Stopped edit words.[/quote]', p)));
  perform tests.unbecome();
  if got is null or got not like '42501 %' then raise exception 'an honest quote was let through because the current body held a doctored one: %', coalesce(got, 'ok'); end if;
end $$;

-- ---- the conduct layer: a doctored quote of a hidden post is served as written; an honest one, written before the hide, is concealed ----
do $$
declare
  adm uuid := tests.account('fw-cn-admin'); au uuid := tests.account('fw-cn-author'); qu uuid := tests.account('fw-cn-quoter'); rd uuid := tests.account('fw-cn-reader');
  ch_au uuid := tests.character(au, 'Fw Cn Author'); ch_qu uuid := tests.character(qu, 'Fw Cn Quoter');
  th uuid := tests.thread('Fw conceal');
  base timestamptz := now() - interval '1 day';
  hid uuid; honest uuid; doctored uuid; shown text; hiding boolean;
begin
  insert into admins (account) values (adm);
  hid := tests.post(ch_au, th, 'Hidden words fwzqx.', base);
  honest := tests.post(ch_qu, th, format('[quote=%s]Hidden words fwzqx.[/quote] fine', hid), base + interval '1 minute');
  perform tests.become(adm);
  perform decide(null, hid, 'hide', null, 'fw');
  perform tests.unbecome();
  doctored := (pg_temp.post_as(qu, th, ch_qu, format('[quote=%s]Words nobody wrote.[/quote] doctored', hid)) ->> 'id')::uuid;

  if exists (select 1 from conceal_requests r where r.act = doctored) or exists (select 1 from quote_refs r where r.act = doctored and r.quoted = hid) then
    raise exception 'a forged quote of a hidden post was entered in quote_refs or asked for a layer';
  end if;
  if hidden_refs(doctored) is distinct from '{}'::uuid[] then raise exception 'hidden_refs lists a forged post: %', hidden_refs(doctored); end if;
  -- acts_quote_refs already keeps a forged post out of quote_refs, so the filter in hidden_refs is tested on a row put there by hand: it must still leave the forged post out.
  insert into quote_refs (act, quoted) values (doctored, hid);
  if hidden_refs(doctored) is distinct from '{}'::uuid[] then raise exception 'hidden_refs lists a forged post when a quote_refs row is hand-written for it: %', hidden_refs(doctored); end if;
  if hidden_refs(honest) is distinct from array[hid] then raise exception 'hidden_refs does not list the honest quote of a hidden post: %', hidden_refs(honest); end if;
  perform tests.become(rd);
  select a.current_payload ->> 'body', a.concealing into shown, hiding from acts_public a where a.id = doctored;
  if shown is distinct from format('[quote=%s]Words nobody wrote.[/quote] doctored', hid) or hiding then raise exception 'a doctored quote of a hidden post is not served as written: % %', shown, hiding; end if;
  select a.current_payload ->> 'body', a.concealing into shown, hiding from acts_public a where a.id = honest;
  perform tests.unbecome();
  if not hiding then raise exception 'an honest quote of a hidden post is not concealed: % %', shown, hiding; end if;
  -- the job is never asked to empty the forged one
  perform tests.become_service();
  if exists (select 1 from conceal_due(1000) d where d.act = doctored and cardinality(d.hidden) > 0) then raise exception 'the conceal job is asked to empty a forged quote'; end if;
  if not exists (select 1 from conceal_due(1000) d where d.act = honest and d.hidden = array[hid]) then raise exception 'the conceal job is not asked to empty the honest quote'; end if;
  perform tests.unbecome();
end $$;

-- ---- a doctored quote of one's own other mask writes nothing, and the answer is the same as for another's ----
do $$
declare
  ann uuid := tests.account('fw-own-ann'); bob uuid := tests.account('fw-own-bob');
  a1 uuid := tests.character(ann, 'Fw Own One'); a2 uuid := tests.character(ann, 'Fw Own Two'); b uuid := tests.character(bob, 'Fw Own Bob');
  t uuid := tests.thread('Fw own mask');
  mine uuid := tests.post(a2, t, 'My other mask said this.');
  theirs uuid := tests.post(b, t, 'Bob said this.');
  r_own jsonb; r_other jsonb;
  strip text[] := array['id', 'created_at', 'seq', 'thread', 'target_act_id', 'author_seq'];
begin
  r_own := pg_temp.post_as(ann, t, a1, format('[quote=%s]words nobody wrote[/quote]', mine), mine);
  r_other := pg_temp.post_as(ann, t, a1, format('[quote=%s]words nobody wrote[/quote]', theirs), theirs);
  if pg_temp.alerts_of((r_own ->> 'id')::uuid, 'framed') <> 0 or pg_temp.alerts_of((r_own ->> 'id')::uuid, 'quote') <> 0 then raise exception 'a doctored quote of one''s own mask wrote an alert'; end if;
  if pg_temp.alerts_of((r_other ->> 'id')::uuid, 'framed') <> 1 or pg_temp.alerts_of((r_other ->> 'id')::uuid, 'quote') <> 0 then raise exception 'a doctored quote of another player''s post wrote the wrong alerts'; end if;
  -- the two answers, with what differs by construction taken out (the verdict names the quoted post; the body names it too)
  if (r_own - strip) - 'payload' - 'current_payload' is distinct from (r_other - strip) - 'payload' - 'current_payload' then
    raise exception 'the answer differs with who owns the quoted post: % vs %', r_own, r_other;
  end if;
  if (r_own -> 'payload') - array['body', 'forged'] is distinct from (r_other -> 'payload') - array['body', 'forged'] then raise exception 'the answer''s payload differs with who owns the quoted post'; end if;
  if (r_own ? 'sprung') <> (r_other ? 'sprung') then raise exception 'sprung differs with who owns the quoted post'; end if;
end $$;

-- ---- a Mod Bot's pool post: a doctored quote is written with no target and no alert; an honest one keeps its target ----
do $$
declare
  ann uuid := tests.account('fw-pool-ann'); a uuid := tests.character(ann, 'Fw Pool Ann');
  t uuid := tests.thread('Fw pool');
  p uuid := tests.post(a, t, 'Pool-trapped words.'); p2 uuid := tests.post(a, t, 'Pool-trapped words two.');
  bot uuid; made jsonb; w uuid; back uuid;
begin
  perform pg_temp.hand(ann, 'fwmove');
  back := (set_card(ann, 'fwmove', a, p, '{}', 0) ->> 'id')::uuid;
  insert into characters (name, staff, staff_kind, debuted_at) values ('Fw Bot', 'fw-bot', 'persona', now()) returning characters.id into bot;
  perform tests.become_service();
  made := write_staff_act('fw-bot', 'post', t, p, jsonb_build_object('body', format('[quote=%s]words nobody wrote[/quote] a pool reply', p)));
  w := (made ->> 'id')::uuid;
  if (select target_act_id from acts where id = w) is not null then raise exception 'a pool post with a doctored quote kept its target'; end if;
  if made ? 'sprung' or exists (select 1 from acts where kind = 'spring' and (payload ->> 'set') = back::text) then raise exception 'a pool post with a doctored quote sprang a back: %', made; end if;
  if (select payload -> 'forged' from acts where id = w) is distinct from to_jsonb(array[p]) then raise exception 'the pool post has no verdict'; end if;
  perform tests.unbecome();
  if exists (select 1 from alerts where act = w) then raise exception 'a pool post with a doctored quote wrote an alert'; end if;
  perform tests.become_service();
  -- the twin: an honest quote with a target keeps it and springs the back
  made := write_staff_act('fw-bot', 'post', t, p, jsonb_build_object('body', format('[quote=%s]Pool-trapped words.[/quote] a pool reply', p)));
  perform tests.unbecome();
  if (select target_act_id from acts where id = (made ->> 'id')::uuid) is distinct from p then raise exception 'an honest pool quote lost its target'; end if;
  if not (made ? 'sprung') then raise exception 'an honest pool quote did not spring the back: %', made; end if;
  -- a pool post with a doctored quote and no target is written as it was
  perform tests.become_service();
  made := write_staff_act('fw-bot', 'post', t, null, jsonb_build_object('body', format('[quote=%s]words nobody wrote[/quote] no target', p2)));
  perform tests.unbecome();
  if (select payload -> 'forged' from acts where id = (made ->> 'id')::uuid) is distinct from to_jsonb(array[p2]) then raise exception 'a targetless pool post has no verdict'; end if;
end $$;

-- ---- framed: start_thread, spin and post write one; an edit writes none; a character that is not debuted, or is staff, gets none ----
do $$
declare
  ann uuid := tests.account('fw-fr-ann'); bob uuid := tests.account('fw-fr-bob'); cat uuid := tests.account('fw-fr-cat');
  a uuid := tests.character(ann, 'Fw Fr Ann'); b uuid := tests.character(bob, 'Fw Fr Bob');
  waiting uuid; staff uuid; c uuid;
  t uuid := tests.thread('Fw framed');
  bp uuid := tests.post(b, t, 'Bob wrote this.');
  wp uuid; sp uuid;
  made jsonb; w uuid;
begin
  waiting := tests.character(cat, 'Fw Fr Waiting');
  insert into characters (name, staff, staff_kind, debuted_at) values ('Fw Fr Bot', 'fw-fr-bot', 'persona', now()) returning id into staff;
  wp := tests.post(waiting, t, 'Waiting words.');
  update characters set debuted_at = null where id = waiting;
  perform set_config('kayfabb.staff_writer', 'on', true);
  sp := tests.post(staff, t, 'Staff words.');
  perform set_config('kayfabb.staff_writer', '', true);
  perform tests.become(ann);
  made := start_thread('general', a, 'Fw framed start', format('[quote=%s]words nobody wrote[/quote]', bp));
  perform tests.unbecome();
  w := (made -> 'act' ->> 'id')::uuid;
  if pg_temp.alerts_of(w, 'framed') <> 1 or not exists (select 1 from alerts where kind = 'framed' and act = w and account = bob and character = b) then raise exception 'start_thread did not frame the quoted author'; end if;
  perform tests.become(ann);
  made := spin(bp, a, 'Fw framed spin', format('[quote=%s]words nobody wrote[/quote]', bp));
  perform tests.unbecome();
  w := (made -> 'act' ->> 'id')::uuid;
  if pg_temp.alerts_of(w, 'framed') <> 1 or not exists (select 1 from alerts where kind = 'framed' and act = w and account = bob and character = b) then raise exception 'spin did not frame the quoted author'; end if;
  -- an edit writes none
  perform tests.become(ann);
  w := (post(t, a, 'To be edited.') ->> 'id')::uuid;
  made := edit_post(w, a, format('Edited [quote=%s]words nobody wrote[/quote]', bp));
  perform tests.unbecome();
  if exists (select 1 from alerts where kind = 'framed' and act = (select e.id from acts e where e.kind = 'edit' and e.target_act_id = w)) then raise exception 'an edit wrote a framed alert'; end if;
  -- a quote of a post that is no Act, of a character that has not debuted, and of a staff character's post
  made := pg_temp.post_as(ann, t, a, format('[quote=%s]x[/quote] [quote=%s]y[/quote] [quote=%s]z[/quote]', gen_random_uuid(), wp, sp));
  if pg_temp.alerts_of((made ->> 'id')::uuid, 'framed') <> 0 then raise exception 'a framed alert was written for no debuted player character'; end if;
  if (select payload -> 'forged' from acts where id = (made ->> 'id')::uuid) is null then raise exception 'the quotes of posts that are not a debuted player''s are not forged'; end if;
  -- one alert for a character the post both names (framing) and forges
  made := pg_temp.post_as(ann, t, a, format('[quote="Geno" user=%s]x[/quote] [quote=%s]words nobody wrote[/quote]', b, bp), null, array[b]);
  if pg_temp.alerts_of((made ->> 'id')::uuid, 'framed') <> 1 then raise exception 'a character named and forged was framed % times', pg_temp.alerts_of((made ->> 'id')::uuid, 'framed'); end if;
end $$;

-- ---- at most five, framing and forged together ----
do $$
declare
  q uuid := tests.account('fw-cap-q'); qc uuid := tests.character(q, 'Fw Cap Quoter');
  t uuid := tests.thread('Fw cap');
  fa uuid[] := '{}'; fp uuid[] := '{}'; authors uuid[] := '{}'; posts uuid[] := '{}';
  i integer; acct uuid; ch uuid; body text := ''; made jsonb; w uuid; n bigint; named bigint;
begin
  for i in 1..3 loop
    acct := tests.account('fw-cap-f' || i); ch := tests.character(acct, 'Fw Cap F' || i);
    fa := fa || ch;
    body := body || format('[quote="x" user=%s]x[/quote] ', ch);
  end loop;
  for i in 1..4 loop
    acct := tests.account('fw-cap-a' || i); ch := tests.character(acct, 'Fw Cap A' || i);
    authors := authors || ch;
    posts := posts || tests.post(ch, t, 'Real words number ' || i || '.');
    body := body || format('[quote=%s]words nobody wrote %s[/quote] ', posts[i], i);
  end loop;
  made := pg_temp.post_as(q, t, qc, body, null, fa);
  w := (made ->> 'id')::uuid;
  select count(*) into n from alerts where kind = 'framed' and act = w;
  if n <> 5 then raise exception 'framing and forged together wrote % framed alerts, not 5', n; end if;
  select count(*) into named from alerts where kind = 'framed' and act = w and character = any (fa);
  if named <> 3 then raise exception 'the three named characters were not all told (%); framing comes first', named; end if;
  -- the two forged authors told are the first two of the sorted verdict
  if (select array_agg(al.character order by al.character) from alerts al where al.kind = 'framed' and al.act = w and al.character = any (authors))
     is distinct from (select array_agg(a.character order by a.character) from (select a2.id, a2.character from acts a2 where a2.id = any (posts) order by a2.id limit 2) a) then
    raise exception 'the forged authors told are not the first two by the verdict''s order';
  end if;
  -- with five framing ids named, the forged are never told; with none, four are
  fa := fa || (select tests.character(tests.account('fw-cap-f4'), 'Fw Cap F4')) || (select tests.character(tests.account('fw-cap-f5'), 'Fw Cap F5'));
  body := '';
  for i in 1..5 loop body := body || format('[quote="x" user=%s]x[/quote] ', fa[i]); end loop;
  for i in 1..4 loop body := body || format('[quote=%s]words nobody wrote %s[/quote] ', posts[i], i); end loop;
  made := pg_temp.post_as(q, t, qc, body, null, fa);
  select count(*) into n from alerts where kind = 'framed' and act = (made ->> 'id')::uuid;
  if n <> 5 or exists (select 1 from alerts where kind = 'framed' and act = (made ->> 'id')::uuid and character = any (authors)) then raise exception 'five framed ids and four forged wrote % alerts, a forged author among them', n; end if;
  body := '';
  for i in 1..4 loop body := body || format('[quote=%s]words nobody wrote %s[/quote] ', posts[i], i); end loop;
  made := pg_temp.post_as(q, t, qc, body);
  select count(*) into n from alerts where kind = 'framed' and act = (made ->> 'id')::uuid;
  if n <> 4 then raise exception 'four forged authors were told % times', n; end if;
end $$;

-- ---- a card's reply is a post: its doctored quote frames the author, and no quote alert or spring is written ----
do $$
declare
  ann uuid := tests.account('fw-rp-ann'); bob uuid := tests.account('fw-rp-bob');
  a uuid := tests.character(ann, 'Fw Rp Ann'); b uuid := tests.character(bob, 'Fw Rp Bob');
  t uuid := tests.thread('Fw reply'); p uuid := tests.post(a, t, 'The parent of a reply.'); p2 uuid := tests.post(a, t, 'A second parent.');
  played jsonb; reply_id uuid;
begin
  perform pg_temp.hand(bob, 'fwcut');
  perform tests.become_service();
  played := play_card(bob, 'fwcut', b, p, '{}', 0, '', reply => format('[quote=%s]words nobody wrote[/quote]', p));
  perform tests.unbecome();
  reply_id := (played -> 'payload' ->> 'reply')::uuid;
  if reply_id is null or (select payload -> 'forged' from acts where id = reply_id) is distinct from to_jsonb(array[p]) then raise exception 'the reply has no verdict: %', played; end if;
  if pg_temp.alerts_of(reply_id, 'framed') <> 1 or not exists (select 1 from alerts where kind = 'framed' and act = reply_id and account = ann) then raise exception 'a card reply with a doctored quote did not frame its author'; end if;
  if pg_temp.alerts_of(reply_id, 'quote') <> 0 or (select target_act_id from acts where id = reply_id) is not null then raise exception 'a card reply quoted a post'; end if;
end $$;
