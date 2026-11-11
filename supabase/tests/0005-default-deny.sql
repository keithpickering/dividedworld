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
                           'seasons', 'season_results', 'seasons_finished', 'settlements', 'standings', 'ledger', 'wallets', 'wallet_events',
                           'card_ledger', 'my_cards', 'effect_state',
                           -- Gear (0150): the kinds and what each mask wears are public, the ledger is cut to the caller's own rows by its policy, and the wardrobe and an admin's grant check the caller inside.
                           'gear_kinds', 'gear_ledger', 'gear_worn',
                           -- The machine (0139): its slots as players see them, a pack's pulls, and a buyer's own packs. The slots table itself is nobody's to read.
                           'machine_now', 'pack_kinds', 'packs', 'my_packs', 'my_invites', 'pending_turns', 'effect_releases',
                           'reading', 'my_reactions', 'thread_view_counts',
                           'pip_styles', 'account_preferences', 'character_profiles',
                           'class_reveals', 'turns_announced',
                           'my_characters', 'my_wallet', 'my_ledger', 'my_ledger_shares', 'my_wallet_events', 'my_card_ledger', 'my_posts_played_on', 'my_posts_written_on', 'screen_settings', 'thread_list', 'character_post_counts', 'season_size', 'board_counts', 'current_standings', 'current_season',
                           'staff_now', 'staff_office_now', 'staff_profile_now', 'boards_now', 'moves_log', 'bars_now', 'face_down', 'my_face_down', 'my_caught', 'my_cards_ended', 'play_reach', 'play_moments', 'play_moment_layers',
                           'alerts', 'thread_follows', 'my_followed_threads', 'thread_open',
                           -- The log's lines for the Mod Bots (0111): each the caller's own characters' rows.
                           'my_infractions', 'my_bans', 'my_reports', 'my_appeals', 'my_reports_left', 'my_group_moves',
                           -- The search index (0117): one row per post or spin, readable as the Acts are; the table is no client's to write.
                           'post_search'];
  callable text[] := array['react(uuid,uuid,text)', 'start_thread(text,uuid,text,text,uuid[])', 'post(uuid,uuid,text,uuid,uuid[])',
                           'edit_post(uuid,uuid,text)', 'spin(uuid,uuid,text,text,uuid[])', 'whoami()', 'card_target(uuid)', 'card_of_play(uuid)', 'turn(uuid,text,text)', 'withdraw_turn(uuid)', 'create_invite()', 'reissue_invite(bigint)', 'open_account(text)', 'create_character(text,text,text,text,jsonb)', 'set_debut(uuid,text,text)',
                           'next_settlement_at(timestampwithtimezone)', 'release_effect(uuid)', 'mark_read(uuid,integer,uuid)', 'set_preferences(text,text,text,text,text,integer,text,text,text,text[],boolean)', 'meet_card(text)', 'see_welcome()', 'see_tip(text)', 'skip_tips()', 'restore_tips()', 'resume_tips()', 'replay_tour()', 'my_account_opened()', 'see_alerts(timestampwithtimezone)', 'see_settlement(timestampwithtimezone)', 'follow_thread(uuid,boolean)', 'following_thread(uuid)', 'my_alerts(timestampwithtimezone,integer)', 'my_alerts_unread()', 'my_settlement_moved(bigint)', 'set_profile(uuid,text,text,text,jsonb)', 'is_admin()', 'retire_character(uuid)', 'restore_character(uuid)', 'span_interval(jsonb)',
                           'unmask(uuid,uuid,text)', 'turn(uuid,text,text,boolean,boolean)', 'standing_place(uuid)', 'standings_page(integer,integer)', 'standings_season()', 'admin_queue()', 'admin_machine()', 'set_slot(uuid,text,integer)', 'move_slot(uuid,text)', 'save_machine(jsonb)', 'hold_move(bigint)', 'replace_queued_description(bigint,text)', 'describe_board(uuid,text)', 'reverse_move(uuid)', 'reverse_card(uuid)', 'card_ended(uuid)', 'post_tails(uuid[])', 'replace_successor(bigint,text)', 'set_office(text,text)', 'boss_roster_names()', 'dismiss_handover_todo(integer)', 'move_progress(uuid)',
                           'here(text,uuid,uuid)', 'set_presence_hidden(uuid,boolean)',
                           -- The box here() ends with (0093), readable without marking a mask.
                           'presence_box(text,uuid)',
                           -- A board's page and the index, each in one read (0095): invoker, stable, and readable by a signed-in player alone.
                           'board_page(text,integer,text[])', 'index_page()',
                           -- A character's two pages, each in one read (0096): invoker and stable, held to the web's read lists by the screen-function guard.
                           'profile_page(uuid)', 'record_page(uuid,text,integer)',
                           -- A player's wardrobe and an admin's grant of gear (0150): each asks who is calling inside.
                           'my_wardrobe()', 'grant_gear(uuid,text,integer)',
                           -- A finished season's results (0099): its list, a page of 50 and a character's place, invoker reads for a signed-in player.
                           'finished_seasons()', 'results_page(integer,integer)', 'result_place(integer,uuid)',
                           -- A thread's page in one read (0094), a security invoker function.
                           'thread_page(uuid,integer,integer,integer,text[])',
                           -- The frame and the HUD in one read (0097): a signed-in player's own boot document, stable, writing nothing.
                           'boot()',
                           -- The glass screens, each in one read (the glass-load plan, Tasks 5 to 9): invoker, stable, a signed-in player alone, writing nothing.
                           -- The Characters screen (0115).
                           'my_characters_page()',
                           -- The Season screen, Rankings and News (0117).
                           'season_page(text,integer,uuid,integer)',
                           -- The Alerts screen (0119).
                           'alerts_page(timestampwithtimezone)',
                           -- The Updates screen and the admin queue (0121).
                           'updates_page(uuid,timestampwithtimezone,integer)', 'queue_page()',
                           -- The player's own log (0123): a page of each of its sources and what the lines name.
                           'log_page(timestampwithtimezone)',
                           -- The refusal a SQL-standard screen function raises through (0094).
                           'screen_refusal(text)',
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
                           -- The bar and the ban (0104): columns of characters_public, whose reader executes the functions that compute them; public facts, the same for any id.
                           'warn_points(uuid)', 'banned_until(uuid)',
                           -- The group (0128): a column of characters_public and my_characters, whose reader executes the function; public facts, the same for any id.
                           'group_now(uuid)', 'move_expires_at(uuid)',
                           -- The bar and the apology (0130): barred() is a public fact, from bars_now, for any character and board; apologize() is the barred character's door, which verifies the caller
                           -- plays the character and that it is not banned. The ruling and the judge's queue are the service's.
                           'barred(uuid,uuid)', 'bars_of(uuid)', 'apologize(uuid,uuid,text,text,uuid[])',
                           -- The barred box's read (0133): the caller's own character's apologies, empty for any other id.
                           'my_apologies(uuid)',
                           -- A report (0107): the player's door, which verifies the caller plays the character and is not banned. Its closing, its refund and its budget are the service's.
                           'open_report(uuid,uuid,text)',
                           -- An interception (0108): the player's door, which verifies the caller plays the character, that it is not banned and its own wallet. And the question a quiz visit asks,
                           -- with its choices and never its answer, which thread_page (invoker) reads for the signed-in player.
                           'intercept(uuid,uuid,text)', 'visit_quiz(uuid)',
                           -- An appeal (0109): the punished character's door, which verifies the caller plays the character (and does not refuse a banned one: a ban is appealed by the banned).
                           -- Its ruling, its refund, its sweep and its helpers are the service's.
                           'open_appeal(uuid,uuid,text)',
                           -- The screens' reads (0111): the report's judge, and the two functions the log's views call, each a public fact about any id (a view's functions run as its reader).
                           'beat_mod_name(uuid)', 'punishment_words(uuid)', 'infraction_relief(uuid)',
                           -- Pure predicates a CHECK calls, granted to PUBLIC by 0080 so a direct writer is not refused (each reads no table).
                           'tip_keys_ok(text[])', 'update_payload_problem(jsonb)', 'reaches_hold(text[])', 'pronouns_hold(jsonb)',
                           -- The search index's words (0117): the folded text an index of names and titles is written with, the stemming language and the words of a text, each reading nothing but a
                           -- setting and its arguments; the search reads (security invoker) call them.
                           'fold_text(text)', 'bbcode_plain(text)', 'bbcode_plain_u16len(text)', 'bbcode_plain_url_ok(text,text[],boolean)',
                           -- 0118: the helpers bbcode_plain calls for the tags it learned (quote heads, video addresses); each reads nothing but its arguments.
                           'bbcode_plain_trim(text)', 'bbcode_plain_quote_head(text)', 'bbcode_plain_pct(text)', 'bbcode_plain_query_v(text)', 'bbcode_plain_ipv4_number(text)', 'bbcode_plain_punycode_ok(text)', 'bbcode_plain_host_ok(text)', 'bbcode_plain_video_ok(text)',
                           -- 0142: the phrase matcher a face-down Move's spring asks of a post's plain words, and the case fold it reads them through; each reads nothing but its arguments.
                           'phrase_in(text,text)', 'phrase_fold(text)', 'phrase_norm(text)', 'bbcode_walk(text,uuid)', 'bbcode_plain_quote_act(text)', 'phrase_word_class()',
                           'search_lang()', 'search_words(text,text)', 'search_words(text,text,regconfig)',
                           -- The search reads (0117): three screens' reads, security invoker and stable, and the functions they call. The two definers say only a public fact of their arguments: the Updates thread's id,
                           -- and the id and name of a debuted character a prefix finds (all characters_public shows of one; `characters` is owner-only).
                           'search_posts(text,uuid,uuid,timestampwithtimezone,timestampwithtimezone,boolean,text,jsonb,integer)', 'search_threads(text,uuid,uuid,timestampwithtimezone,timestampwithtimezone,boolean,text,jsonb,integer)',
                           'search_suggest(text,text[],uuid,boolean,integer)', 'search_suggest_threads(text,uuid,boolean,integer)', 'suggest_characters(text,integer)',
                           'search_matches(text,uuid,uuid,timestampwithtimezone,timestampwithtimezone,boolean,boolean,timestampwithtimezone,uuid,integer)', 'search_walk(text,uuid,uuid,timestampwithtimezone,timestampwithtimezone,boolean,boolean,timestampwithtimezone,uuid,integer,integer)',
                           'search_matches_sql(text,uuid,uuid,timestampwithtimezone,timestampwithtimezone,boolean,boolean,timestampwithtimezone,uuid,integer)', 'search_walk_sql(text,uuid,uuid,timestampwithtimezone,timestampwithtimezone,boolean,boolean,timestampwithtimezone,uuid,integer)', 'search_cursor_ok(jsonb,boolean)', 'search_cursor_cast(jsonb)', 'search_updates_thread()',
                           'search_match_conds(text,tsquery,uuid,timestampwithtimezone,timestampwithtimezone,boolean)', 'search_thread_matches(uuid,tsquery,uuid,timestampwithtimezone,timestampwithtimezone,boolean)', 'search_post_cards(uuid)',
                           -- The pulls check on pack_kinds (0139), granted to PUBLIC like them, and the count of a hand, which the ledger's policy cuts to the caller's own cards (my_cards calls it).
                           'pack_pulls_problem(jsonb)', 'card_held(uuid,text)'];
  -- What a visitor (anon) may execute, on purpose; each is also in the list above.
  visitor_callable text[] := array['move_progress(uuid)', 'staff_career(text)',
                           -- The contact (0081): the player who most needs a person is often one who cannot sign in. One setting, the same for every caller.
                           'admin_contact()',
                           -- The same three CHECK predicates, which PUBLIC (so anon too) may execute by 0080; pure, reading no table.
                           'tip_keys_ok(text[])', 'update_payload_problem(jsonb)', 'reaches_hold(text[])', 'pronouns_hold(jsonb)', 'pack_pulls_problem(jsonb)'];
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'S'
             and (has_sequence_privilege('anon', c.oid, 'usage,select,update') or has_sequence_privilege('authenticated', c.oid, 'usage,select,update'))
  loop bad := bad || format(E'\n  sequence %s', r.relname); end loop;
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
             and (has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger') and not c.relname in ('screen_settings', 'staff_now', 'staff_office_now', 'staff_profile_now', 'boards_now', 'moves_log', 'bars_now', 'machine_now', 'pack_kinds')
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
