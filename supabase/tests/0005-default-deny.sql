-- What the API roles can reach, read from the catalog so every later migration is held to it:
-- no sequence (a counter is a clock: the class_history id moving says when a character's class
-- was set), no table or view they were not granted on purpose, and no function they can execute
-- unless it is one of the actions. And the append-only triggers fire always, so not even a
-- session in replica mode, as a restore runs, can change an Act.
do $$
declare
  bad text := '';
  r record;
  -- What the API roles are granted, on purpose; a new grant joins this list with its migration.
  readable text[] := array['class_kinds', 'reaction_kinds', 'card_kinds', 'boards', 'threads', 'acts',
                           'characters_public', 'acts_public', 'accounts', 'characters', 'class_history', 'reaction_tallies',
                           'seasons', 'settlements', 'standings', 'ledger', 'wallets', 'wallet_events',
                           'card_ledger', 'my_cards', 'effect_state', 'my_invites', 'pending_turns', 'effect_releases',
                           'reading', 'thread_view_counts', 'my_reactions',
                           'pip_styles', 'account_preferences', 'character_profiles'];
  callable text[] := array['react(uuid,uuid,text)', 'start_thread(text,uuid,text,text)', 'post(uuid,uuid,text,uuid)',
                           'edit_post(uuid,uuid,text)', 'spin(uuid,uuid,text,text)', 'whoami()', 'card_target(uuid)', 'card_of_play(uuid)', 'turn(uuid,text,text)', 'withdraw_turn(uuid)', 'create_invite()', 'reissue_invite(bigint)', 'open_account(text)', 'create_character(text,text)',
                           'next_settlement_at(timestampwithtimezone)', 'release_effect(uuid)', 'mark_read(uuid,integer,uuid)', 'set_preferences(text,text,text)', 'set_profile(uuid,text,text,text)', 'is_admin()'];
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'S'
             and (has_sequence_privilege('anon', c.oid, 'usage,select,update') or has_sequence_privilege('authenticated', c.oid, 'usage,select,update'))
  loop bad := bad || format(E'\n  sequence %s', r.relname); end loop;
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
             and (has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger')
                  or (has_table_privilege('authenticated', c.oid, 'select,insert,update,delete,truncate,references,trigger') and not c.relname = any (readable))
                  or has_table_privilege('authenticated', c.oid, 'insert,update,delete,truncate,references,trigger'))
  loop bad := bad || format(E'\n  table or view %s', r.relname); end loop;
  for r in select p.oid::regprocedure::text as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and (has_function_privilege('anon', p.oid, 'execute')
                  or (has_function_privilege('authenticated', p.oid, 'execute') and not replace(p.oid::regprocedure::text, ' ', '') = any (callable)))
  loop bad := bad || format(E'\n  function %s', r.fn); end loop;
  if bad <> '' then raise exception 'the API roles can reach what they were never granted:%', bad; end if;

  for r in select t.tgname from pg_trigger t where t.tgrelid = 'public.acts'::regclass and t.tgname in ('acts_no_update', 'acts_no_truncate') and t.tgenabled <> 'A'
  loop bad := bad || format(E'\n  trigger %s does not fire always', r.tgname); end loop;
  if (select count(*) from pg_trigger t where t.tgrelid = 'public.acts'::regclass and t.tgname in ('acts_no_update', 'acts_no_truncate')) is distinct from 2 then
    bad := bad || E'\n  an append-only trigger is missing';
  end if;
  if bad <> '' then raise exception 'acts can be changed:%', bad; end if;
end $$;

-- Replica mode, as a restore with triggers disabled runs, still cannot change an Act.
do $$
declare
  p uuid := tests.post(tests.character(tests.account('replica'), 'Replica'), tests.thread());
  refused boolean := false;
begin
  perform set_config('session_replication_role', 'replica', true);
  begin update acts set payload = '{}' where id = p;
  exception when raise_exception then refused := true; end;
  perform set_config('session_replication_role', 'origin', true);
  if not refused then raise exception 'an Act was changed in replica mode'; end if;
end $$;
