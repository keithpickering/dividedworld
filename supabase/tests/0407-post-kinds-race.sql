-- A reaction or a spun thread never loses its draw to a refresh of the same play (supabase/migrations/0407_post_kinds.sql; docs/plans/2026-11-21-post-plays-plan.md, Task 2).
-- refresh_play_post writes `drawn` from play_row's read, and the two draw triggers add to it, so a trigger that ran between the refresh's read and its write would be lost. Both take the per-play advisory lock the refresh holds.
-- Staged without a barrier: one session holds the play's lock open, a second writes a tally (and then a spun thread) in autocommit and must wait on it; then the holder commits and the draw must be there. The rows are committed, in the scratch database the run drops.
create function pg_temp.waits_on(pl uuid, conn text) returns void language plpgsql as $$
declare tries integer := 0; key bigint := hashtextextended('play_post:' || pl::text, 0);
begin
  loop
    -- The lock's waiter is the second session; the key is split into classid and objid.
    exit when exists (select 1 from pg_locks l where l.locktype = 'advisory' and not l.granted and l.classid = ((key >> 32) & 4294967295)::oid and l.objid = (key & 4294967295)::oid);
    tries := tries + 1;
    if tries > 200 then raise exception 'the draw trigger did not wait on the play''s lock (%)', conn; end if;
    perform pg_sleep(0.025);
  end loop;
  if extensions.dblink_is_busy(conn) <> 1 then raise exception 'the draw did not wait on the play''s lock (%)', conn; end if;
end $$;

do $$
declare
  ann uuid := gen_random_uuid(); a uuid := gen_random_uuid(); t uuid := gen_random_uuid(); p uuid := gen_random_uuid(); pl uuid := gen_random_uuid();
  r text;
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'pk-race-ann@test.invalid');
    insert into accounts (id) values (%1$L);
    insert into characters (id, owner, name, debuted_at) values (%2$L, %1$L, 'Pk Race', now());
    insert into class_history (character, class_key) values (%2$L, 'alpha');
    insert into threads (id, board, title) select %3$L, id, 'Pk race' from boards where slug = 'general';
    insert into acts (id, character, kind, thread, payload) values (%4$L, %2$L, 'post', %3$L, '{"body": "Draw me."}');
    insert into acts (id, character, kind, thread, payload, target_act_id) values (%5$L, %2$L, 'card', %3$L, '{"card": "pkx"}', %4$L);
  $sql$, ann, a, t, p, pl));
  perform extensions.dblink_connect('pk_hold', current_setting('kayfabb.scratch_url'));
  perform extensions.dblink_connect('pk_draw', current_setting('kayfabb.scratch_url'));

  -- A tally, while the play's lock is held (as a refresh holds it between its read and its write).
  perform extensions.dblink_exec('pk_hold', 'begin');
  perform extensions.dblink_exec('pk_hold', format('do $x$ begin perform pg_advisory_xact_lock(hashtextextended(%L, 0)); end $x$', 'play_post:' || pl));
  perform extensions.dblink_send_query('pk_draw', format('insert into reaction_tallies (act, kind, count) values (%L, ''up'', 1)', pl));
  perform pg_temp.waits_on(pl, 'pk_draw');
  perform extensions.dblink_exec('pk_hold', 'commit');
  select x.s into r from extensions.dblink_get_result('pk_draw') as x(s text);
  perform * from extensions.dblink_get_result('pk_draw') as x(s text);
  if (select drawn from play_post where play = pl) is distinct from 1 then raise exception 'the tally was lost: drawn is %', (select drawn from play_post where play = pl); end if;

  -- A spun thread, the same.
  perform extensions.dblink_exec('pk_hold', 'begin');
  perform extensions.dblink_exec('pk_hold', format('do $x$ begin perform pg_advisory_xact_lock(hashtextextended(%L, 0)); end $x$', 'play_post:' || pl));
  perform extensions.dblink_send_query('pk_draw', format('insert into threads (board, title, origin_act_id) select b.id, ''Pk race spun'', %L from boards b where b.slug = ''general''', pl));
  perform pg_temp.waits_on(pl, 'pk_draw');
  perform extensions.dblink_exec('pk_hold', 'commit');
  perform * from extensions.dblink_get_result('pk_draw') as x(s text);
  if (select drawn from play_post where play = pl) is distinct from 2 then raise exception 'the spun thread was lost: drawn is %', (select drawn from play_post where play = pl); end if;
  if exists (select 1 from play_post_drift() d where d.play = pl) then raise exception 'the play drifts after the draws'; end if;
  perform extensions.dblink_disconnect('pk_hold');
  perform extensions.dblink_disconnect('pk_draw');
end $$;
