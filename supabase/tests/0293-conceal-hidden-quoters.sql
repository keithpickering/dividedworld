-- conceal_request_hidden_quoters() (supabase/migrations/0344_quote_cut.sql; docs/plans/2026-11-13-quote-cut-plan.md, Decision 7): a layer stored before the parser's cap changed may hold hidden words quoted past
-- the old cap, so a layer is asked for again for every post that quotes a post hidden from quoting now, even when its layer was recorded and answered. A post that quotes nothing hidden gets no request.

create function pg_temp.due(a uuid) returns boolean language plpgsql as $$
declare found boolean;
begin
  perform tests.become_service();
  select exists (select 1 from conceal_due(1000) d where d.act = due.a) into found;
  perform tests.unbecome();
  return found;
end $$;

do $$
declare
  adm uuid := tests.account('chq-admin');
  au uuid := tests.account('chq-author');
  qu uuid := tests.account('chq-quoter');
  ch_au uuid := tests.character(au, 'Chq Author');
  ch_qu uuid := tests.character(qu, 'Chq Quoter');
  th uuid := tests.thread('Hidden quoters');
  base timestamptz := now() - interval '1 day';
  hid uuid; shown uuid; lifted uuid; stale uuid; ok uuid; of_lifted uuid; plain_post uuid;
  made integer;
  top bigint;
begin
  insert into admins (account) values (adm);
  hid := tests.post(ch_au, th, 'Hidden words zqxhidden.', base);
  shown := tests.post(ch_au, th, 'Visible words.', base + interval '1 minute');
  lifted := tests.post(ch_au, th, 'Words that were hidden once.', base + interval '2 minutes');
  perform tests.become(adm);
  perform decide(null, hid, 'hide', null, 'chq');
  perform decide(null, lifted, 'hide', null, 'chq');
  perform decide(null, lifted, 'unhide', null, 'chq');
  perform tests.unbecome();
  -- the quoters: one of the hidden post (its layer recorded, stale: it holds the hidden words, as one made before the cap changed would), one of a visible post, one of a post whose hide was lifted, one of nothing
  stale := tests.post(ch_qu, th, format('[quote=%s]Hidden words zqxhidden.[/quote] stale', hid), base + interval '3 minutes');
  ok := tests.post(ch_qu, th, format('[quote=%s]Visible words.[/quote] fine', shown), base + interval '4 minutes');
  of_lifted := tests.post(ch_qu, th, format('[quote=%s]Words that were hidden once.[/quote] lifted', lifted), base + interval '5 minutes');
  plain_post := tests.post(ch_qu, th, 'No quote at all.', base + interval '6 minutes');
  -- the job has answered every request so far, the stale one with a layer that still holds the hidden words
  perform tests.become_service();
  perform record_layer(stale, array[hid], format('[quote=%s]Hidden words zqxhidden.[/quote] stale', hid));
  perform record_layer(of_lifted, '{}'::uuid[], null);
  perform tests.unbecome();
  if pg_temp.due(stale) then raise exception 'the setup is wrong: the stale post is still due after its layer was recorded'; end if;
  if pg_temp.due(ok) or pg_temp.due(of_lifted) or pg_temp.due(plain_post) then raise exception 'the setup is wrong: a post that quotes nothing hidden is due'; end if;
  select coalesce(max(id), 0) into top from conceal_requests;

  made := conceal_request_hidden_quoters();

  if not pg_temp.due(stale) then raise exception 'a post whose layer was recorded before, and which quotes a hidden post, is not due after conceal_request_hidden_quoters()'; end if;
  -- (other files of the suite commit hidden posts that are quoted, so the count is not this file's alone: this file's posts are asked about by name)
  if made < 1 then raise exception 'conceal_request_hidden_quoters() wrote no request, one post quotes a hidden post'; end if;
  if exists (select 1 from conceal_requests r where r.id > top and r.act in (ok, of_lifted, plain_post)) then raise exception 'conceal_request_hidden_quoters() wrote a request for a post that quotes nothing hidden'; end if;
  if pg_temp.due(ok) or pg_temp.due(of_lifted) or pg_temp.due(plain_post) then raise exception 'a post that quotes nothing hidden (a visible post, a post whose hide was lifted, no quote) is due'; end if;
  -- the job answers it again, as it answers any request: nothing stays due
  perform tests.become_service();
  perform record_layer(stale, array[hid], format('[quote=%s][/quote] stale', hid));
  perform tests.unbecome();
  if pg_temp.due(stale) then raise exception 'the post is still due after the job recorded its new layer'; end if;
end $$;
