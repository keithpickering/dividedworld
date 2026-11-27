-- An edit and every draw on its post serialize on one advisory lock (supabase/migrations/0455_surface_coats.sql, edit_post and surface_apply; review of graffiti everywhere, task 4).
--
-- A draw applies under its surface's row lock and reads the post's current version there. An edit that inserted its Act without a lock the draws share could be uncommitted while the draw applied: the draw then
-- committed places for the old version, and the edit's own places could not see the draw. A row lock on the post's surfaces cannot see a surface a concurrent, uncommitted first draw is creating, so the edit and
-- surface_apply (all four draw writers, first draws included) take pg_advisory_xact_lock(hashtextextended('kayfabb.surface_post.' || post, 0)), the repository's own key form.
--
-- A race, so the world is committed through dblink (tests.commit, the way 0446-written-quiz-race.sql does) and a second session holds the advisory lock while this one edits, and the reverse.

do $$
begin
  perform tests.commit($sql$
    do $w$
    declare
      u uuid;
      c uuid;
      t uuid;
      p uuid;
      pl uuid;
    begin
      insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, stack, surface)
      values ('elwall', 'El Wall', 'pepperoni', 'rare', 'cast', null, '{post}', 1, true);
      u := tests.account('el-ann');
      c := tests.character(u, 'El Ann');
      t := tests.thread('El thread');
      p := tests.post(c, t, 'A wall of words.');
      pl := tests.act(c, 'card', t, jsonb_build_object('card', 'elwall', 'message', '', 'config', '{}'::jsonb, 'layer', 1), p);
      perform open_surface(pl);
    end $w$;
  $sql$);
end $$;

do $$
declare
  w record;
  who uuid;
  refused text;
begin
  select s.play, s.post, k.character into w from surfaces s join acts k on k.id = s.play where k.payload ->> 'card' = 'elwall';
  if w.play is null then raise exception 'the race world has no wall'; end if;
  select c.owner into who from characters c where c.id = w.character;

  -- Another session holds the post's advisory lock, as a draw in progress does (a first draw too, whose surface row this session cannot see).
  perform extensions.dblink_connect('el_holder', current_setting('kayfabb.scratch_url'));
  begin
    perform extensions.dblink_exec('el_holder', 'begin');
    perform extensions.dblink_exec('el_holder', format('do $h$ begin perform pg_advisory_xact_lock(hashtextextended(%L, 0)); end $h$', 'kayfabb.surface_post.' || w.post::text));
    perform tests.become(who);
    perform set_config('lock_timeout', '300ms', true);
    begin
      perform edit_post(w.post, w.character, 'Edited while a draw holds the post.');
      refused := 'edit went through';
    exception when lock_not_available then
      refused := 'waited';
    end;
    perform tests.unbecome();
    perform set_config('lock_timeout', '0', true);
    perform extensions.dblink_exec('el_holder', 'rollback');
    perform extensions.dblink_disconnect('el_holder');
  exception when others then
    perform set_config('lock_timeout', '0', true);
    begin perform extensions.dblink_exec('el_holder', 'rollback'); exception when others then null; end;
    begin perform extensions.dblink_disconnect('el_holder'); exception when others then null; end;
    raise;
  end;
  if refused is distinct from 'waited' then raise exception 'an edit did not wait for the wall''s lock: %', refused; end if;
  if exists (select 1 from acts a where a.kind = 'edit' and a.target_act_id = w.post) then raise exception 'the waiting edit left an Act'; end if;

end $$;

-- The reverse: a session in the middle of an edit holds the post's advisory lock, and a draw waits for it.
do $$
declare
  w record;
  who uuid;
  refused text;
begin
  select s.play, s.post, k.character into w from surfaces s join acts k on k.id = s.play where k.payload ->> 'card' = 'elwall';
  select c.owner into who from characters c where c.id = w.character;
  perform extensions.dblink_connect('el_holder', current_setting('kayfabb.scratch_url'));
  begin
    perform extensions.dblink_exec('el_holder', 'begin');
    perform extensions.dblink_exec('el_holder', format('do $h$ begin perform pg_advisory_xact_lock(hashtextextended(%L, 0)); end $h$', 'kayfabb.surface_post.' || w.post::text));
    perform set_config('lock_timeout', '300ms', true);
    begin
      perform draw_on_surface(who, w.character, w.play, '{"box": {"w": 60, "h": 40}, "groups": [{}]}'::jsonb, repeat('k', 100) || repeat('0', 9900), '[]'::jsonb, 4000);
      refused := 'draw went through';
    exception when lock_not_available then
      refused := 'waited';
    end;
    perform set_config('lock_timeout', '0', true);
    perform extensions.dblink_exec('el_holder', 'rollback');
    perform extensions.dblink_disconnect('el_holder');
  exception when others then
    perform set_config('lock_timeout', '0', true);
    begin perform extensions.dblink_exec('el_holder', 'rollback'); exception when others then null; end;
    begin perform extensions.dblink_disconnect('el_holder'); exception when others then null; end;
    raise;
  end;
  if refused is distinct from 'waited' then raise exception 'a draw did not wait for an edit in progress: %', refused; end if;
  if exists (select 1 from surface_coats c where c.play = w.play) then raise exception 'the waiting draw left a coat'; end if;
end $$;

-- Last, because the edit takes the post's lock for the rest of this transaction: with the wall free the same edit lands.
do $$
declare
  w record;
  who uuid;
begin
  select s.play, s.post, k.character into w from surfaces s join acts k on k.id = s.play where k.payload ->> 'card' = 'elwall';
  select c.owner into who from characters c where c.id = w.character;
  perform tests.become(who);
  perform edit_post(w.post, w.character, 'Edited with the wall free.');
  perform tests.unbecome();
  if (select count(*) from acts a where a.kind = 'edit' and a.target_act_id = w.post) is distinct from 1::bigint then raise exception 'the edit did not land once the wall was free'; end if;
end $$;
