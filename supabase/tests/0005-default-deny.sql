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
                           'reading', 'my_reactions', 'thread_view_counts',
                           'pip_styles', 'account_preferences', 'character_profiles',
                           'class_reveals', 'turns_announced',
                           'my_characters', 'my_wallet', 'my_ledger', 'my_ledger_shares', 'my_wallet_events', 'my_card_ledger', 'my_posts_played_on', 'screen_settings', 'thread_list', 'character_post_counts', 'season_size', 'board_counts', 'current_standings', 'current_season',
                           'staff_now', 'staff_office_now', 'staff_profile_now', 'boards_now', 'moves_log', 'face_down', 'my_face_down', 'my_caught', 'play_reach', 'play_moments', 'play_moment_layers',
                           'alerts', 'thread_follows', 'my_followed_threads', 'thread_open'];
  callable text[] := array['react(uuid,uuid,text)', 'start_thread(text,uuid,text,text)', 'post(uuid,uuid,text,uuid)',
                           'edit_post(uuid,uuid,text)', 'spin(uuid,uuid,text,text)', 'whoami()', 'card_target(uuid)', 'card_of_play(uuid)', 'turn(uuid,text,text)', 'withdraw_turn(uuid)', 'create_invite()', 'reissue_invite(bigint)', 'open_account(text)', 'create_character(text,text,text,text)', 'set_debut(uuid,text,text)',
                           'next_settlement_at(timestampwithtimezone)', 'release_effect(uuid)', 'mark_read(uuid,integer,uuid)', 'set_preferences(text,text,text,text,text,integer,text[],boolean)', 'meet_card(text)', 'see_welcome()', 'see_tip(text)', 'skip_tips()', 'restore_tips()', 'resume_tips()', 'replay_tour()', 'my_account_opened()', 'see_alerts(timestampwithtimezone)', 'see_settlement(timestampwithtimezone)', 'follow_thread(uuid,boolean)', 'following_thread(uuid)', 'my_alerts(timestampwithtimezone,integer)', 'my_alerts_unread()', 'my_settlement_moved(bigint)', 'set_profile(uuid,text,text,text)', 'is_admin()', 'retire_character(uuid)', 'restore_character(uuid)', 'span_interval(jsonb)',
                           'unmask(uuid,uuid,text)', 'turn(uuid,text,text,boolean,boolean)', 'standing_place(uuid)', 'standings_page(integer,integer)', 'standings_season()', 'admin_queue()', 'hold_move(bigint)', 'reverse_move(uuid)', 'replace_successor(bigint,text)', 'set_office(text,text)', 'boss_roster_names()', 'dismiss_handover_todo(integer)', 'move_progress(uuid)',
                           'here(text,uuid,uuid)', 'set_presence_hidden(uuid,boolean)',
                           -- The box here() ends with (0092), readable without marking a mask.
                           'presence_box(text,uuid)',
                           -- A board's page and the index, each in one read (0094): invoker, stable, and readable by a signed-in player alone.
                           'board_page(text,integer,text[])', 'index_page()',
                           -- Cards beyond a post (0055): a target's effects for the act function, and a page's plays above its posts and its board's pins.
                           'card_target_reach(text,uuid,uuid)', 'effects_above(uuid[],uuid,uuid)', 'pinned_threads(uuid)',
                           -- Updates (0062): an admin's post_update, and the page's read.
                           'post_update(text,text,jsonb)', 'updates(timestampwithtimezone,integer)',
                           -- Season news (0063): the season page's News tab.
                           'season_news(timestampwithtimezone,integer)',
                           -- A play's moment (0072): what was on a post when a play landed.
                           'play_moment(uuid)',
                           -- A persona's career (0083): public facts about staff.
                           'staff_career(text)',
                           -- How players reach an admin (0081): a visitor and a player read the contact, an admin writes it.
                           'admin_contact()', 'set_admin_contact(jsonb)',
                           -- Pure predicates a CHECK calls, granted to PUBLIC by 0080 so a direct writer is not refused (each reads no table).
                           'tip_keys_ok(text[])', 'update_payload_problem(jsonb)', 'reaches_hold(text[])'];
  -- What a visitor (anon) may execute, on purpose; each is also in the list above.
  visitor_callable text[] := array['move_progress(uuid)', 'staff_career(text)',
                           -- The contact (0081): the player who most needs a person is often one who cannot sign in. One setting, the same for every caller.
                           'admin_contact()',
                           -- The same three CHECK predicates, which PUBLIC (so anon too) may execute by 0080; pure, reading no table.
                           'tip_keys_ok(text[])', 'update_payload_problem(jsonb)', 'reaches_hold(text[])'];
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'S'
             and (has_sequence_privilege('anon', c.oid, 'usage,select,update') or has_sequence_privilege('authenticated', c.oid, 'usage,select,update'))
  loop bad := bad || format(E'\n  sequence %s', r.relname); end loop;
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
             and (has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger') and not c.relname in ('screen_settings', 'staff_now', 'staff_office_now', 'staff_profile_now', 'boards_now', 'moves_log')
                  -- screen_settings (0030) is a view a visitor reads: the sign-up page must know whether the instance asks for an invite.
                  -- staff_now (0043) is the other, and staff_office_now (0082) its source: the staff are known to be staff, signed in or not.
                  -- staff_profile_now (0044) is the third: a Boss's in-character profile is a public page.
                  -- boards_now and moves_log (0046) are the last two: a board's name now, and a Boss's moves with how each ended, are
                  -- computed from Acts anyone can read.
                  or has_table_privilege('anon', c.oid, 'insert,update,delete,truncate,references,trigger')
                  or (has_table_privilege('authenticated', c.oid, 'select,insert,update,delete,truncate,references,trigger') and not c.relname = any (readable))
                  or has_table_privilege('authenticated', c.oid, 'insert,update,delete,truncate,references,trigger'))
  loop bad := bad || format(E'\n  table or view %s', r.relname); end loop;
  for r in select p.oid::regprocedure::text as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and ((has_function_privilege('anon', p.oid, 'execute') and not replace(p.oid::regprocedure::text, ' ', '') = any (visitor_callable))
                  -- move_progress (0050) is the one function a visitor may call: a move's way out is computed from Acts anyone can read.
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
