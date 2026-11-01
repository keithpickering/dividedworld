-- The screens' one read that was service-only (the system plan, Task 12). A move in force shows its way out on the board it changed
-- ("WAY OUT: 7 OF 12 POSTERS"), so a client reads a landed move's progress:
--
--   move_progress(move_act)   demand_progress_or_error for a landed move, callable by a visitor and a player: {done, of, met} and,
--                             for a malformed demand, {done: 0, of: 0, met: false, error: <SQLSTATE>} (the form the digest and the
--                             tick read, so one bad move cannot break a board's page). An Act that is no move raises, in words.
--
-- Whose it is. The evaluator, demand_progress, is owned by the digest role (0045): the database refuses it who reacted, who owns a
-- mask and a class, so a progress read cannot prove a private fact. This wrapper adds no reach of its own: it reads one thing (whether
-- the Act is a move, from acts_public, which anyone may read) and then calls the evaluator. So it is a plain security definer
-- function owned by the migration's owner, and not the digest role's: giving it that ownership would add an eighth function to the
-- digest role's reviewed list (supabase/tests/0049-digest.sql) for no privilege it needs, and a function the web client calls is
-- better left outside a role whose whole point is to be small.
--
-- Cost on a busy instance. A board page calls it once, for the board's one move in force (boards_now.move_act); the evaluator reads
-- the Acts since the landing, bounded by the move's expiry and stopped at the demand's count (0045 says per case). That is one
-- call per board view, never one per post, thread or viewer, and it is the same work the tick already does for the move each minute.
--
-- Its way out: it changes nothing. A move whose evaluator fails is shown with no count; the board itself is unaffected.

-- 0048 granted this to the migration's owner already, for admin_queue; said again so this file does not depend on that order.
do $$ begin execute format('grant execute on function demand_progress_or_error(uuid) to %I', current_user); end $$;

create function move_progress(move_act uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from acts_public a where a.id = move_act and a.kind = 'move') then
    raise exception 'that is not a move' using hint = 'kayfabb.refusal', errcode = 'P0002';
  end if;
  return demand_progress_or_error(move_act);
end $$;
revoke execute on function move_progress(uuid) from public;
grant execute on function move_progress(uuid) to anon, authenticated;
