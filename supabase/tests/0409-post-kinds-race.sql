-- A reaction or a spun thread never loses its draw to a refresh of the same play (supabase/migrations/0409_post_kinds.sql; docs/plans/2026-11-21-post-plays-plan.md, Task 2).
-- refresh_play_post writes `drawn` from play_row's read, and the two draw triggers add to it, so a trigger that ran between the refresh's read and its write would be lost. Both take the per-play advisory lock the refresh holds.
-- Staged without a barrier: one session holds the play's lock open, a second writes a tally (and then a spun thread) in autocommit and must wait on it; then the holder commits and the draw must be there. The rows are committed, in the scratch database the run drops.
create function pg_temp.waits_on(lockname text, conn text) returns void language plpgsql as $$
declare tries integer := 0; max_tries constant integer := 1200; key bigint := hashtextextended(lockname, 0);
begin
  loop
    -- The lock's waiter is the second session; the key is split into classid and objid.
    exit when exists (select 1 from pg_locks l where l.locktype = 'advisory' and not l.granted and l.classid = ((key >> 32) & 4294967295)::oid and l.objid = (key & 4294967295)::oid);
    tries := tries + 1;
    -- Gives up at 30 s, the lock_timeout (tools/test-sql.mjs, SESSION_BOUNDS), 1200 looks of 25 ms: the pool runs several files at once, so a parked session can take seconds to show here on a loaded runner. The loop leaves the moment the wait shows, so the bound is only how long a broken race takes to fail.
    if tries > max_tries then raise exception 'nothing waited on the expected lock (%)', conn; end if;
    perform pg_sleep(0.025);
  end loop;
  if extensions.dblink_is_busy(conn) <> 1 then raise exception 'the session did not wait on the lock (%)', conn; end if;
end $$;

do $$
declare
  ann uuid := gen_random_uuid(); a uuid := gen_random_uuid(); t uuid := gen_random_uuid(); p uuid := gen_random_uuid(); pl uuid := gen_random_uuid();
  r text;
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'pk-race-ann-' || %1$L || '@test.invalid');
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
  perform pg_temp.waits_on('play_post:' || pl::text, 'pk_draw');
  perform extensions.dblink_exec('pk_hold', 'commit');
  select x.s into r from extensions.dblink_get_result('pk_draw') as x(s text);
  perform * from extensions.dblink_get_result('pk_draw') as x(s text);
  if (select drawn from play_post where play = pl) is distinct from 1 then raise exception 'the tally was lost: drawn is %', (select drawn from play_post where play = pl); end if;

  -- A spun thread, the same.
  perform extensions.dblink_exec('pk_hold', 'begin');
  perform extensions.dblink_exec('pk_hold', format('do $x$ begin perform pg_advisory_xact_lock(hashtextextended(%L, 0)); end $x$', 'play_post:' || pl));
  perform extensions.dblink_send_query('pk_draw', format('insert into threads (board, title, origin_act_id) select b.id, ''Pk race spun'', %L from boards b where b.slug = ''general''', pl));
  perform pg_temp.waits_on('play_post:' || pl::text, 'pk_draw');
  perform extensions.dblink_exec('pk_hold', 'commit');
  perform * from extensions.dblink_get_result('pk_draw') as x(s text);
  if (select drawn from play_post where play = pl) is distinct from 2 then raise exception 'the spun thread was lost: drawn is %', (select drawn from play_post where play = pl); end if;
  if exists (select 1 from play_post_drift() d where d.play = pl) then raise exception 'the play drifts after the draws'; end if;
  perform extensions.dblink_disconnect('pk_hold');
  perform extensions.dblink_disconnect('pk_draw');
end $$;

-- Two refreshes of plays of one drive meet on one lock, the drive's, taken before any play's: so A's refresh (holding A, then its mate B) and B's (holding B, then A) cannot cross.
-- Session 1 refreshes A in an open transaction; session 2's refresh of the mate B must wait on the drive's lock, not on B's own.
do $$
declare
  ann uuid := gen_random_uuid(); a uuid := gen_random_uuid(); t uuid := gen_random_uuid(); p uuid := gen_random_uuid(); pa uuid := gen_random_uuid(); pb uuid := gen_random_uuid();
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'pk-race-drive-' || %1$L || '@test.invalid');
    insert into accounts (id) values (%1$L);
    insert into characters (id, owner, name, debuted_at) values (%2$L, %1$L, 'Pk Drive', now());
    insert into class_history (character, class_key) values (%2$L, 'alpha');
    insert into threads (id, board, title) select %3$L, id, 'Pk drive' from boards where slug = 'general';
    insert into acts (id, character, kind, thread, payload) values (%4$L, %2$L, 'post', %3$L, '{"body": "Drive me."}');
    insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, stack, drive) values
      ('pkdrive', 'Pk Drive', 'sweet', 'uncommon', 'cast', '{post}', null, 2, '{"lasts": {"unit": "hour", "count": 1}, "gifts": [], "overhead": "pk.over"}');
    insert into acts (id, character, kind, thread, payload, target_act_id) values (%5$L, %2$L, 'card', %3$L, '{"card": "pkdrive"}', %4$L);
    insert into acts (id, character, kind, thread, payload, target_act_id) values (%6$L, %2$L, 'card', %3$L, jsonb_build_object('card', 'pkdrive', 'drive', %5$L::text), %4$L);
  $sql$, ann, a, t, p, pa, pb));
  perform extensions.dblink_connect('pk_hold', current_setting('kayfabb.scratch_url'));
  perform extensions.dblink_connect('pk_draw', current_setting('kayfabb.scratch_url'));
  perform extensions.dblink_exec('pk_hold', 'begin');
  perform extensions.dblink_exec('pk_hold', format('do $x$ begin perform refresh_play_post(%L); end $x$', pa));
  perform extensions.dblink_send_query('pk_draw', format('select refresh_play_post(%L)', pb));
  -- It waits on the drive's lock: the post, the card and the drive's id, as play_row computes them.
  perform pg_temp.waits_on(format('play_drive:%s|pkdrive|%s', p, pa), 'pk_draw');
  perform extensions.dblink_exec('pk_hold', 'commit');
  perform * from extensions.dblink_get_result('pk_draw') as x(s text);
  perform extensions.dblink_disconnect('pk_hold');
  perform extensions.dblink_disconnect('pk_draw');
  if exists (select 1 from play_post_drift() d where d.play in (pa, pb)) then raise exception 'the drive''s plays drift'; end if;
end $$;
