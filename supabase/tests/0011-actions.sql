-- The actions that write Acts (supabase/migrations/0005_actions.sql), called directly, as a
-- player, with what engine/rules/actions.ts's decide() refuses: a check missed in TypeScript
-- cannot get through. And what only the database can refuse. Plan Task 9.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('act-ann');
  bob uuid := tests.account('act-bob');
  a uuid := tests.character(ann, 'Actor');
  b uuid := tests.character(bob, 'Bystander');
  long_title text := repeat('t', (setting('titleMaxLength'))::integer + 1);
  long_body text := repeat('🔥', (setting('postMaxLength'))::integer + 1);
  full_body text := repeat('🔥', (setting('postMaxLength'))::integer);
  made jsonb;
  t uuid;
  p uuid;
  why text;
begin
  -- No session: nothing.
  if pg_temp.refusal(format('select start_thread(%L, %L, %L, %L)', 'general', a, 'Hello', 'First.')) is null then raise exception 'an action with no session went through'; end if;

  perform tests.become(ann);
  perform auth.assert_impersonating();

  -- What decide() refuses, refused here too.
  if pg_temp.refusal(format('select start_thread(%L, %L, %L, %L)', 'general', a, '   ', 'First.')) is null then raise exception 'an empty title went through'; end if;
  if pg_temp.refusal(format('select start_thread(%L, %L, %L, %L)', 'general', a, long_title, 'First.')) is null then raise exception 'a title past the limit went through'; end if;
  if pg_temp.refusal(format('select start_thread(%L, %L, %L, %L)', 'general', a, 'Hello', '')) is null then raise exception 'an empty post went through'; end if;
  if pg_temp.refusal(format('select start_thread(%L, %L, %L, %L)', 'general', a, 'Hello', long_body)) is null then raise exception 'a post past the limit went through'; end if;
  if pg_temp.refusal(format('select start_thread(%L, %L, %L, %L)', 'nowhere', a, 'Hello', 'First.')) is null then raise exception 'a thread on no board went through'; end if;

  -- Through a character the caller does not play: the same words for another's and for none.
  why := pg_temp.refusal(format('select start_thread(%L, %L, %L, %L)', 'general', b, 'Hello', 'First.'));
  if why is distinct from 'you do not play that character' then raise exception 'acting through another''s character: %', why; end if;
  if pg_temp.refusal(format('select start_thread(%L, %L, %L, %L)', 'general', gen_random_uuid(), 'Hello', 'First.')) is distinct from why then
    raise exception 'a missing character should read as another''s';
  end if;

  -- A post at exactly the limit, in characters, goes through: char_length counts as decide() does.
  made := start_thread('general', a, 'Hello', full_body);
  t := (made -> 'thread' ->> 'id')::uuid;
  p := (made -> 'act' ->> 'id')::uuid;
  if (made -> 'act' ->> 'seq')::integer <> 1 or made -> 'thread' ? 'next_seq' then raise exception 'start_thread returns the public projection: %', made; end if;
  if made -> 'act' ? 'owner' or made::text like '%' || ann || '%' then raise exception 'an action''s answer carries its player'; end if;

  -- A reply quoting the opening post; a quote of nothing.
  made := post(t, a, 'Quoting myself.', p);
  if (made ->> 'target_act_id')::uuid <> p or (made ->> 'seq')::integer <> 2 then raise exception 'a reply quoting a post: %', made; end if;
  if pg_temp.refusal(format('select post(%L, %L, %L, %L)', t, a, 'x', gen_random_uuid())) is null then raise exception 'a quote of nothing went through'; end if;
  if pg_temp.refusal(format('select post(%L, %L, %L)', gen_random_uuid(), a, 'x')) is null then raise exception 'a post to no thread went through'; end if;

  -- An edit is a new Act; the post's current text is the edit's.
  made := edit_post(p, a, 'Edited.');
  if made -> 'current_payload' ->> 'body' <> 'Edited.' or made -> 'payload' ->> 'body' <> full_body then raise exception 'an edit: %', made; end if;
  if pg_temp.refusal(format('select edit_post(%L, %L, %L)', p, a, '')) is null then raise exception 'an empty edit went through'; end if;

  -- A spin from the post: a new thread pointing at it.
  made := spin(p, a, 'Spun off', '');
  if (made -> 'thread' ->> 'origin_act_id')::uuid <> p or made -> 'act' ->> 'kind' <> 'spin' then raise exception 'a spin: %', made; end if;
  if pg_temp.refusal(format('select spin(%L, %L, %L, %L)', p, a, long_title, '')) is null then raise exception 'a spin''s title past the limit went through'; end if;
  if pg_temp.refusal(format('select spin(%L, %L, %L, %L)', gen_random_uuid(), a, 'Spun', '')) is null then raise exception 'a spin from nothing went through'; end if;
  perform tests.unbecome();

  -- Another player cannot edit the post, through their own character or the author's.
  perform tests.become(bob);
  if pg_temp.refusal(format('select edit_post(%L, %L, %L)', p, b, 'Mine now.')) is null then raise exception 'another player edited a post'; end if;
  if pg_temp.refusal(format('select edit_post(%L, %L, %L)', p, a, 'Mine now.')) is null then raise exception 'another player edited through the author'; end if;
  perform tests.unbecome();
  if (select current_payload ->> 'body' from acts_public where id = p) <> 'Edited.' then raise exception 'the post changed hands'; end if;
end $$;
