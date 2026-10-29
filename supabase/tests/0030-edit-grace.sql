-- The edit grace period (supabase/migrations/0022_edit_grace.sql): an edit made within editGrace
-- of its post records a version, which the post's history shows, and does not set "Last edited";
-- one made after it does. The screens' engine plan, Task 11; the screens' design, section 6.

do $$
declare
  ann uuid := tests.account('grace-ann');
  a uuid := tests.character(ann, 'Grace Writer');
  t uuid := tests.thread();
  quick uuid := tests.post(a, t, 'Teh first.', now() - interval '10 minutes');
  slow uuid := tests.post(a, t, 'A second.', now() - interval '10 minutes');
  later uuid := tests.post(a, t, 'A third.', now() - interval '10 minutes');
  edge uuid := tests.post(a, t, 'A fourth.', now() - interval '10 minutes');
begin
  -- Measured from the post, never from the edit before: five minutes on, a minute after the last.
  insert into acts (character, kind, thread, target_act_id, payload, created_at) values
    (a, 'edit', t, later, '{"body": "A third, once."}', now() - interval '6 minutes'),
    (a, 'edit', t, later, '{"body": "A third, twice."}', now() - interval '5 minutes'),
    (a, 'edit', t, edge, '{"body": "A fourth, on the grace."}', now() - interval '8 minutes');
  insert into acts (character, kind, thread, target_act_id, payload, created_at) values
    (a, 'edit', t, quick, '{"body": "The first."}', now() - interval '9 minutes'),
    (a, 'edit', t, slow, '{"body": "A second, fixed."}', now() - interval '9 minutes'),
    (a, 'edit', t, slow, '{"body": "A second, changed."}', now() - interval '7 minutes');
  perform tests.become(ann);
  -- A minute after: no "Last edited", and the version is in the post's history.
  if (select (current_payload ->> 'body', shown_edited_at) from acts_public where id = quick) is distinct from ('The first.'::text, null::timestamptz) then
    raise exception 'an edit within the grace sets no "Last edited": %', (select to_jsonb(x) from acts_public x where id = quick);
  end if;
  if (select edited_at from acts_public where id = quick) is null then raise exception 'edited_at still says when it was last edited'; end if;
  if not exists (select 1 from acts_public where kind = 'edit' and target_act_id = quick) then raise exception 'an edit in the grace is still in the post''s history'; end if;
  -- Three minutes after: "Last edited" is the latest edit past the grace.
  if (select shown_edited_at from acts_public where id = slow) is distinct from now() - interval '7 minutes' then
    raise exception 'an edit past the grace sets "Last edited": %', (select to_jsonb(x) from acts_public x where id = slow);
  end if;
  if (select shown_edited_at from acts_public where id = later) is distinct from now() - interval '5 minutes' then raise exception 'the grace is measured from the post, not the edit before'; end if;
  -- An edit at exactly the grace's end is still inside it.
  if (select shown_edited_at from acts_public where id = edge) is not null then raise exception 'an edit at the grace''s end set "Last edited"'; end if;
  perform tests.unbecome();
  -- The grace is the instance's: a longer one covers the second edit too.
  update settings set value = '{"unit": "minute", "count": 5}' where key = 'editGrace';
  perform tests.become(ann);
  if (select shown_edited_at from acts_public where id = slow) is not null then raise exception 'a five-minute grace covers an edit three minutes on'; end if;
  perform tests.unbecome();
  -- An instance not yet seeded with a grace shows every edit, as before it had one.
  delete from settings where key = 'editGrace';
  perform tests.become(ann);
  if (select shown_edited_at from acts_public where id = quick) is distinct from now() - interval '9 minutes' then raise exception 'with no grace every edit is shown'; end if;
  perform tests.unbecome();
  begin
    insert into settings (key, value) values ('editGrace', '{"unit": "second", "count": 90}');
    raise exception 'a grace in seconds was written';
  exception when check_violation then null;
  end;
  if span_interval('{"unit": "minute", "count": 2}') is distinct from interval '2 minutes' then raise exception 'span_interval reads minutes'; end if;
end $$;
