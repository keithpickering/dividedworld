-- The verdict in the two reads the cards and the History use (supabase/migrations/0393_forged_quotes.sql, section 4; plan Task 5): card_target (and card_target_reach through it) says `forged` of the post's current version,
-- and my_hidden_version says the verdict of the hidden version's own row, so a screen that draws the words draws each quote as the Act wrote it. Both answer [] where there is none.

do $$
declare
  adm uuid := tests.account('fr-admin'); au uuid := tests.account('fr-author'); qu uuid := tests.account('fr-quoter');
  ca uuid := tests.character(au, 'Fr Author'); cq uuid := tests.character(qu, 'Fr Quoter');
  t uuid := tests.thread('Fr rpcs');
  src uuid := tests.post(ca, t, 'The words that were really said.');
  doctored uuid; honest uuid; plain uuid; e1 uuid; got jsonb;
begin
  insert into admins (account) values (adm);
  doctored := tests.post(cq, t, format('[quote=%s]words nobody wrote[/quote]', src));
  honest := tests.post(cq, t, format('[quote=%s]really said[/quote]', src));
  plain := tests.post(cq, t, 'No quotes.');
  if card_target(doctored) -> 'forged' is distinct from to_jsonb(array[src]) then raise exception 'card_target does not carry the verdict: %', card_target(doctored); end if;
  if card_target(honest) -> 'forged' is distinct from '[]'::jsonb or card_target(plain) -> 'forged' is distinct from '[]'::jsonb then raise exception 'card_target forges a post with no doctored quote'; end if;
  if card_target_reach('post', doctored) -> 'forged' is distinct from to_jsonb(array[src]) then raise exception 'card_target_reach does not pass the verdict through'; end if;
  -- the current version's: an honest edit of the doctored post clears it
  e1 := tests.act(cq, 'edit', t, jsonb_build_object('body', format('[quote=%s]really said[/quote]', src)), doctored, now() + interval '1 minute');
  if card_target(doctored) -> 'forged' is distinct from '[]'::jsonb then raise exception 'card_target reads the original''s verdict after an edit: %', card_target(doctored) -> 'forged'; end if;

  -- my_hidden_version: the hidden version's own verdict. The original (doctored) hidden until edited, then the honest edit hidden until edited.
  perform tests.become(adm);
  perform decide(null, plain, 'hideUntilEdited', null, 'fr');
  perform tests.unbecome();
  -- a doctored version that is the latest and is hidden until edited
  perform tests.become(adm);
  perform decide(null, e1, 'hideUntilEdited', null, 'fr');
  perform tests.unbecome();
  perform tests.become(qu);
  got := my_hidden_version(doctored);
  perform tests.unbecome();
  if got ->> 'status' is distinct from 'hiddenUntilEdited' or got ->> 'version' is distinct from e1::text then raise exception 'my_hidden_version is not about the latest edit: %', got; end if;
  if got -> 'forged' is distinct from '[]'::jsonb then raise exception 'my_hidden_version carries the wrong version''s verdict: %', got; end if;
  -- a doctored latest version: a fresh post, doctored, hidden until edited
  perform tests.become(adm);
  perform decide(null, doctored, 'hideUntilEdited', null, 'fr2');
  perform tests.unbecome();
  doctored := tests.post(cq, t, format('[quote=%s]words nobody wrote again[/quote]', src));
  perform tests.become(adm);
  perform decide(null, doctored, 'hideUntilEdited', null, 'fr3');
  perform tests.unbecome();
  perform tests.become(qu);
  got := my_hidden_version(doctored);
  perform tests.unbecome();
  if got ->> 'status' is distinct from 'hiddenUntilEdited' or got -> 'forged' is distinct from to_jsonb(array[src]) then raise exception 'my_hidden_version does not carry the hidden version''s verdict: %', got; end if;
  -- a waiting version (no decision on it) says it too; a post with no verdict says []
  -- (the answer is null for anyone but the author, as before)
  perform tests.become(au);
  if my_hidden_version(doctored) is not null then raise exception 'my_hidden_version answered a stranger'; end if;
  perform tests.unbecome();
end $$;
