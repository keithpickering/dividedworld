-- An edit takes its post's walls' locks, as a draw does (supabase/migrations/0455_surface_coats.sql, edit_post; review of graffiti everywhere, task 4).
--
-- A draw applies under its surface's row lock and reads the post's current version there. An edit that inserted its Act without that lock could be uncommitted while the draw applied: the draw
-- then committed places for the old version, and the edit's own places could not see the draw, so its tags lost their place. edit_post now locks every surface on the post (`for update`,
-- ordered by play) before it inserts the edit, so the two serialize.
--
-- A race, so the world is committed through dblink (tests.commit, the way 0446-written-quiz-race.sql does) and a second session holds the wall's row lock while this one edits.

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

  -- Another session holds the wall's row, as a draw applying does.
  perform extensions.dblink_connect('el_holder', current_setting('kayfabb.scratch_url'));
  perform extensions.dblink_exec('el_holder', 'begin');
  perform extensions.dblink_exec('el_holder', format('do $h$ begin perform 1 from surfaces where play = %L for update; end $h$', w.play));

  perform tests.become(who);
  perform set_config('lock_timeout', '300ms', true);
  begin
    perform edit_post(w.post, w.character, 'Edited while a draw holds the wall.');
    refused := 'edit went through';
  exception when lock_not_available then
    refused := 'waited';
  end;
  perform tests.unbecome();
  perform set_config('lock_timeout', '0', true);
  perform extensions.dblink_exec('el_holder', 'rollback');
  perform extensions.dblink_disconnect('el_holder');
  if refused is distinct from 'waited' then raise exception 'an edit did not wait for the wall''s lock: %', refused; end if;
  if exists (select 1 from acts a where a.kind = 'edit' and a.target_act_id = w.post) then raise exception 'the waiting edit left an Act'; end if;

  -- With the wall free the same edit lands.
  perform tests.become(who);
  perform edit_post(w.post, w.character, 'Edited with the wall free.');
  perform tests.unbecome();
  if (select count(*) from acts a where a.kind = 'edit' and a.target_act_id = w.post) is distinct from 1::bigint then raise exception 'the edit did not land once the wall was free'; end if;
end $$;
