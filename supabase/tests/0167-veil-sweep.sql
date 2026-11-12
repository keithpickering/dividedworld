-- The author's veil, swept (supabase/migrations/0300_post_veils.sql; docs/plans/2026-11-11-card-notes-part-3-plan.md, Task 2, "veil-sweep"): the guard that the list of reads a veil changes is whole.
--
-- A fixture: author A's post P opens a thread, with an edit, a use card of A's on it, another character's quote of it, a spin from it, a follower, an alert about it to a third player R, a card R played on it that an
-- admin ended, and a card R played on A's character from a post of A's elsewhere. R reads everything below as a third player would.
--
--  1. THE DETECTOR'S POISON. Before the cast, every probe below must find what it looks for (A's id or name, or the veiled Acts' ids, or the stand-in's emptiness). A probe that cannot go red on the unveiled
--     fixture proves nothing, so the test fails on one that does not; a probe that carries no character at all says so (`fires` false) and can only show absence.
--  2. After the cast, as R, no probe finds it. The reads are those the plan names: the thread's page, acts_public (by id, by thread, by character A and by the stand-in), thread_open and thread_list, the board and the index,
--     the profile of A (P absent) and of the stand-in (P present), the record, alerts, the log, followed threads, the caster's ended plays, a play's moment, the effects above a page's characters, post tails, boot, and the
--     staff presence box. Search is Task 3's: its three reads are listed as `pending` below and are asserted to STILL find the author, so the day Task 3 closes one this test fails and says to move it to `swept`.
--  3. COMPLETENESS. One list holds every table, view and function a signed-in player may read or run, each marked `swept`, `no author` (with its reason) or `pending`, and the test fails on a name the catalog holds and the
--     list does not (and on one the list holds and the catalog does not). Its poison: the test makes a granted view `select id, character from acts`, asserts the check names it, and drops it.
--
--  How Task 3 slots in: move `search_posts`, `search_threads` and `search_suggest` (and `search_suggest_threads`) from the `pending` block of the list to `swept` (change their mark), add their probes to the `probes`
--  below with `pending` false, and delete the `pending` probes; the post_search grant and the author condition are Task 3's own.

create function pg_temp.coded(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

-- The text a statement answers to a signed-in account, or its refusal.
create function pg_temp.read_as(account uuid, stmt text) returns text language plpgsql as $$
declare res text; ctx text;
begin
  perform tests.become(account);
  begin
    execute stmt into res;
  exception when others then
    get stacked diagnostics ctx = pg_exception_context;
    perform tests.unbecome();
    return 'refused ' || sqlstate || ' ' || sqlerrm || ' in ' || replace(ctx, E'\n', ' < ');
  end;
  perform tests.unbecome();
  return coalesce(res, 'null');
end $$;

create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k
$$;

create function pg_temp.cards() returns void language plpgsql as $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, veil, stack, gimmick) values
    ('swauthor', 'Sw Whodunnit', 'salty', 'rare', 'cast', '{post}', interval '3 days', 'author', 1, null),
    ('swplain', 'Sw Plain', 'sweet', 'common', 'cast', '{post}', null, null, 1, null),
    ('swuse', 'Sw Use', 'salty', 'uncommon', 'use', '{post}', interval '7 days', null, 1, '{"kind": "ward", "cards": ["swnothing"]}'),
    ('swchar', 'Sw Char', 'salty', 'uncommon', 'cast', '{character}', interval '1 day', null, 1, null)
  on conflict (key) do nothing;
end $$;

-- ---------------------------------------------------------------------------------------------------------------- the list ----
-- Every table, view and function in `public` a signed-in player may read or run, by name (an overloaded function once), and what the sweep does about it. `swept`: read in the probes below. `no author`: carries no
-- post's author, for the reason given. `pending`: carries it today and is another task's to close.
create temp table listed (kind text not null, name text not null, mark text not null check (mark in ('swept', 'no author', 'pending')), why text not null, primary key (kind, name));
insert into listed (kind, name, mark, why)
select 'relation', n, m, w from (values
  -- tables and views
  ('acts', 'no author', 'every column but `character` is granted (0300) and `select character from acts` is refused (0166-post-veils.sql); no other column names an author'),
  ('acts_public', 'swept', 'the projection: by id, by thread, by character and by the stand-in'),
  ('account_preferences', 'no author', 'the caller''s own preferences (row security)'),
  ('accounts', 'no author', 'the caller''s own account (row security)'),
  ('alerts', 'no author', 'the caller''s own alerts: `character` is the character alerted, the caller''s own'),
  ('bars_now', 'no author', 'a character''s bars from a board: a public fact of the character, never of a post'),
  ('board_counts', 'no author', 'counters of threads'),
  ('boards', 'no author', 'the instance''s boards'),
  ('boards_now', 'no author', 'boards by their name now'),
  ('card_kinds', 'no author', 'the instance''s catalog'),
  ('card_ledger', 'no author', 'the caller''s own ledger (row security)'),
  ('character_post_counts', 'no author', 'the counts of an author''s posts, which still count a veiled one (a clue the game allows: the author''s other posts, and when they posted); never tied to a post'),
  ('character_profiles', 'no author', 'a character''s public profile'),
  ('characters', 'no author', 'the caller''s own characters (row security)'),
  ('characters_public', 'no author', 'a debuted character''s public name and office; the stand-in is one of them'),
  ('class_history', 'no author', 'the caller''s own classes (row security)'),
  ('class_kinds', 'no author', 'the instance''s classes'),
  ('class_reveals', 'no author', 'a reveal is the character''s own public Act, never a post'),
  ('current_season', 'no author', 'the open season'),
  ('current_standings', 'no author', 'a character''s standing: public, never tied to a post'),
  ('effect_releases', 'no author', 'the caller''s own releases of effects'),
  ('effect_state', 'no author', 'the saved state of a play: no character'),
  ('face_down', 'no author', 'the caller''s own face-down cards (row security)'),
  ('ledger', 'no author', 'the caller''s own ledger (row security)'),
  ('machine_now', 'no author', 'the machine''s grid'),
  ('moves_log', 'no author', 'a Boss''s moves: staff, public'),
  ('my_appeals', 'no author', 'the caller''s own appeals'),
  ('my_bans', 'no author', 'the caller''s own bans'),
  ('my_card_ledger', 'no author', 'the caller''s own card ledger'),
  ('my_cards', 'no author', 'the caller''s own hand'),
  ('my_cards_ended', 'swept', 'the caller''s ended plays, naming a post''s author as the projection shows it'),
  ('my_caught', 'no author', 'the caller''s own caught cards'),
  ('my_characters', 'no author', 'the caller''s own characters'),
  ('my_face_down', 'no author', 'the caller''s own face-down cards'),
  ('my_followed_threads', 'swept', 'its columns name no character; it leaves the caller''s own posts out of a count by their true author, which is the caller''s own fact and the same answer for anyone else (its sweep can only show absence)'),
  ('my_group_moves', 'no author', 'the caller''s own group moves'),
  ('my_infractions', 'no author', 'the caller''s own infractions'),
  ('my_invites', 'no author', 'the caller''s own invitations'),
  ('my_ledger', 'no author', 'the caller''s own ledger'),
  ('my_ledger_shares', 'no author', 'the caller''s own ledger shares'),
  ('my_packs', 'no author', 'the caller''s own packs'),
  ('my_posts_played_on', 'no author', 'plays on the caller''s own posts: the character played on is the caller''s own'),
  ('my_posts_written_on', 'no author', 'texts written on the caller''s own posts'),
  ('my_reactions', 'no author', 'the caller''s own reactions'),
  ('my_reports', 'no author', 'the caller''s own reports'),
  ('my_reports_left', 'no author', 'how many reports the caller''s own characters have left'),
  ('my_scored_as', 'no author', 'the caller''s own scored-as plays'),
  ('my_veiled_posts', 'no author', 'the caller''s own rows by design: a live author veil on a post of a character the caller owns (0166-post-veils.sql: nobody else''s)'),
  ('my_wallet', 'no author', 'the caller''s own wallet'),
  ('my_wallet_events', 'no author', 'the caller''s own wallet events'),
  ('pack_kinds', 'no author', 'the instance''s packs'),
  ('packs', 'no author', 'the caller''s own packs'),
  ('pending_turns', 'no author', 'the caller''s own pending Turns'),
  ('pip_styles', 'no author', 'the instance''s pip styles'),
  ('play_moment_layers', 'no author', 'the layers of a play''s moment: play ids and saved states'),
  ('play_moments', 'no author', 'the version of a post a play was made on: ids'),
  ('play_reach', 'no author', 'a play beyond a post: its target character, thread or board, which is public; a card on a character is played from one of its posts that shows it (a veiled post is the stand-in''s, so it cannot be the origin)'),
  ('post_search', 'pending', 'its `character` column is a post''s author; Task 3 grants every column but it and reads it through the projection'),
  ('reaction_kinds', 'no author', 'the instance''s reactions'),
  ('reaction_tallies', 'no author', 'counts of reactions to an Act: no character'),
  ('reading', 'no author', 'the caller''s own reading places (row security)'),
  ('screen_settings', 'no author', 'public settings'),
  ('season_results', 'no author', 'a season''s results per character: public, never tied to a post'),
  ('season_size', 'no author', 'a count'),
  ('seasons', 'no author', 'seasons'),
  ('seasons_finished', 'no author', 'seasons'),
  ('settlements', 'no author', 'settlement windows'),
  ('staff_now', 'no author', 'the staff''s keys: public'),
  ('staff_office_now', 'no author', 'the staff''s offices: public'),
  ('staff_profile_now', 'no author', 'a Boss''s in-character profile: public'),
  ('standings', 'no author', 'standings per character: public, never tied to a post'),
  ('thread_follows', 'no author', 'the caller''s own follows (row security)'),
  ('thread_list', 'swept', 'a thread''s first and last poster'),
  ('thread_open', 'swept', 'a thread''s first and last poster'),
  ('thread_view_counts', 'no author', 'view counts of a thread'),
  ('threads', 'no author', 'a thread''s title and counters'),
  ('turns_announced', 'no author', 'a Turn is the character''s own public Act, never a post'),
  ('wallet_events', 'no author', 'the caller''s own wallet events'),
  ('wallets', 'no author', 'the caller''s own wallet')
) t(n, m, w);
insert into listed (kind, name, mark, why)
select 'function', n, m, w from (values
  ('admin_contact', 'no author', 'one setting, the same for every caller'),
  ('admin_machine', 'no author', 'an admin''s screen of the machine'),
  ('admin_queue', 'no author', 'an admin''s queue: real moderation speaks plainly and admins see the true author by design (decided in planning); refused to a player'),
  ('alerts_page', 'swept', 'the caller''s alerts and the Acts they lead to'),
  ('apologize', 'no author', 'a write: answers the Act it wrote, to the caller who wrote it'),
  ('banned_until', 'no author', 'a character''s ban: a public fact of the character'),
  ('barred', 'no author', 'a character''s bar from a board: a public fact of the character'),
  ('bars_of', 'no author', 'a character''s bars: a public fact of the character'),
  ('bbcode_plain', 'no author', 'a pure function of its argument'),
  ('bbcode_plain_host_ok', 'no author', 'a pure function of its argument'),
  ('bbcode_plain_ipv4_number', 'no author', 'a pure function of its argument'),
  ('bbcode_plain_pct', 'no author', 'a pure function of its argument'),
  ('bbcode_plain_punycode_ok', 'no author', 'a pure function of its argument'),
  ('bbcode_plain_query_v', 'no author', 'a pure function of its argument'),
  ('bbcode_plain_quote_act', 'no author', 'a pure function of its argument'),
  ('bbcode_plain_quote_head', 'no author', 'a pure function of its argument'),
  ('bbcode_plain_trim', 'no author', 'a pure function of its argument'),
  ('bbcode_plain_u16len', 'no author', 'a pure function of its argument'),
  ('bbcode_plain_url_ok', 'no author', 'a pure function of its argument'),
  ('bbcode_plain_video_ok', 'no author', 'a pure function of its argument'),
  ('bbcode_walk', 'no author', 'a pure function of its arguments'),
  ('beat_mod_name', 'no author', 'a Mod Bot''s name for a board'),
  ('board_page', 'swept', 'a board''s page: its threads'' first and last posters'),
  ('boot', 'swept', 'the app''s first read: the caller''s own characters and public settings'),
  ('boss_roster_names', 'no author', 'staff names'),
  ('card_ended', 'no author', 'whether a play has ended'),
  ('card_held', 'no author', 'the count of a card in the caller''s own hand'),
  ('card_of_play', 'no author', 'the card a play is of'),
  ('card_target', 'no author', 'a post''s words, length and the plays on it: no character'),
  ('card_target_reach', 'swept', 'what is up above a post, read from the character shown'),
  ('create_character', 'no author', 'a write: the caller''s own new character'),
  ('create_invite', 'no author', 'a write: the caller''s own invitation'),
  ('describe_board', 'no author', 'an admin''s write'),
  ('dismiss_handover_todo', 'no author', 'an admin''s write'),
  ('drive_gifts', 'no author', 'a drive''s donors: characters that gave, public, never a post''s author'),
  ('drive_gifts_page', 'no author', 'a drive''s donors: characters that gave, public, never a post''s author'),
  ('edit_post', 'no author', 'a write: answers the Act it wrote through the projection, to its author'),
  ('effects_above', 'swept', 'the plays above the characters of a page, which are the characters shown'),
  ('finished_seasons', 'no author', 'seasons'),
  ('fold_text', 'no author', 'a pure function of its argument'),
  ('follow_thread', 'no author', 'a write: the caller''s own follow'),
  ('following_thread', 'no author', 'whether the caller follows a thread'),
  ('group_now', 'no author', 'a character''s group: a public fact of the character'),
  ('here', 'no author', 'the presence poll: answers presence_box (swept) after writing the caller''s own presence'),
  ('hold_move', 'no author', 'an admin''s write'),
  ('index_page', 'swept', 'the index: each board''s latest thread (no poster is read today; its sweep can only show absence)'),
  ('infraction_relief', 'no author', 'the caller''s own infraction'),
  ('intercept', 'no author', 'a write: the caller''s own answer to a Mod Bot'),
  ('is_admin', 'no author', 'whether the caller is an admin'),
  ('log_page', 'swept', 'the caller''s log and the Acts it names'),
  ('mark_read', 'no author', 'a write: the caller''s own reading place'),
  ('meet_card', 'no author', 'a card''s public description'),
  ('move_expires_at', 'no author', 'a move''s time'),
  ('move_progress', 'no author', 'a move''s progress, computed from public Acts'),
  ('move_slot', 'no author', 'an admin''s write'),
  ('my_account_opened', 'no author', 'the caller''s own account'),
  ('my_alerts', 'no author', 'the caller''s own alerts: the character alerted is the caller''s own'),
  ('my_alerts_unread', 'no author', 'a count of the caller''s own alerts'),
  ('my_apologies', 'no author', 'the caller''s own apologies'),
  ('my_characters_page', 'no author', 'the caller''s own characters'),
  ('my_settlement_moved', 'no author', 'the caller''s own settlement'),
  ('next_settlement_at', 'no author', 'a time'),
  ('open_account', 'no author', 'a write: the caller''s own account'),
  ('open_appeal', 'no author', 'a write: the caller''s own appeal'),
  ('open_report', 'no author', 'a write: refuses a post whose author is hidden, in words that name no one'),
  ('pack_pulls_problem', 'no author', 'a pure function of its argument'),
  ('phrase_fold', 'no author', 'a pure function of its argument'),
  ('phrase_in', 'no author', 'a pure function of its arguments'),
  ('phrase_norm', 'no author', 'a pure function of its argument'),
  ('phrase_word_class', 'no author', 'a constant'),
  ('pinned_threads', 'no author', 'a board''s pinned threads: ids'),
  ('play_moment', 'swept', 'a play''s moment: the post as the projection shows it'),
  ('post', 'no author', 'a write: answers the Act it wrote through the projection, to its author'),
  ('post_tails', 'swept', 'the words written on posts: no character'),
  ('post_update', 'no author', 'an admin''s write'),
  ('presence_box', 'swept', 'who is here: the staff listed leave out the stand-in'),
  ('profile_page', 'swept', 'a profile and its newest Acts'),
  ('pronouns_hold', 'no author', 'a pure function of its argument'),
  ('punishment_words', 'no author', 'the words of the caller''s own punishment'),
  ('queue_page', 'no author', 'an admin''s queue'),
  ('reaches_hold', 'no author', 'a pure function of its argument'),
  ('react', 'no author', 'a write: answers the tally of an Act, no character'),
  ('record_page', 'swept', 'a character''s record of Acts'),
  ('reissue_invite', 'no author', 'a write: the caller''s own invitation'),
  ('release_effect', 'no author', 'a write: a play''s release'),
  ('replace_queued_description', 'no author', 'an admin''s write'),
  ('replace_successor', 'no author', 'an admin''s write'),
  ('replay_tour', 'no author', 'a write: the caller''s own preference'),
  ('restore_character', 'no author', 'a write: the caller''s own character'),
  ('restore_tips', 'no author', 'a write: the caller''s own preference'),
  ('result_place', 'no author', 'a season''s result for a character: public'),
  ('results_page', 'no author', 'a season''s results: public, per character'),
  ('resume_tips', 'no author', 'a write: the caller''s own preference'),
  ('retire_character', 'no author', 'a write: the caller''s own character'),
  ('reverse_card', 'no author', 'an admin''s write: answers the card_end it wrote'),
  ('reverse_move', 'no author', 'an admin''s write'),
  ('save_machine', 'no author', 'an admin''s write'),
  ('screen_refusal', 'no author', 'a refusal''s words'),
  ('search_cursor_cast', 'no author', 'a pure function of its argument'),
  ('search_cursor_ok', 'no author', 'a pure function of its arguments'),
  ('search_lang', 'no author', 'a setting'),
  ('search_match_conds', 'pending', 'the search''s author condition reads post_search.character; Task 3 gives it the projection'),
  ('search_matches', 'pending', 'the search''s walk returns post_search.character; Task 3 makes it a definer and gives it the projection'),
  ('search_matches_sql', 'pending', 'the search''s text names post_search.character; Task 3 gives it shown_author'),
  ('search_post_cards', 'no author', 'the cards on a post: no character'),
  ('search_posts', 'pending', 'returns post_search.character; Task 3 closes it'),
  ('search_suggest', 'swept', 'suggests thread titles, boards and characters by name: no post''s author (its sweep can only show absence)'),
  ('search_suggest_threads', 'no author', 'suggests thread titles and boards: no author'),
  ('search_thread_matches', 'pending', 'counts post_search rows by author; Task 3 closes it'),
  ('search_threads', 'pending', 'returns post_search.character; Task 3 closes it'),
  ('search_updates_thread', 'no author', 'the Updates thread''s id'),
  ('search_walk', 'pending', 'the search''s walk reads post_search.character; Task 3 makes it a definer and gives it the projection'),
  ('search_walk_sql', 'pending', 'the search''s text names post_search.character; Task 3 gives it shown_author'),
  ('search_words', 'no author', 'a pure function of its arguments'),
  ('season_news', 'no author', 'season news: public'),
  ('season_page', 'no author', 'a season''s page: results per character, public'),
  ('see_alerts', 'no author', 'a write: the caller''s own mark'),
  ('see_settlement', 'no author', 'a write: the caller''s own mark'),
  ('see_tip', 'no author', 'a write: the caller''s own tips'),
  ('see_welcome', 'no author', 'a write: the caller''s own mark'),
  ('set_admin_contact', 'no author', 'an admin''s write'),
  ('set_debut', 'no author', 'a write: the caller''s own character'),
  ('set_office', 'no author', 'an admin''s write'),
  ('set_preferences', 'no author', 'a write: the caller''s own preferences'),
  ('set_presence_hidden', 'no author', 'a write: the caller''s own character''s presence'),
  ('set_profile', 'no author', 'a write: the caller''s own profile'),
  ('set_slot', 'no author', 'an admin''s write'),
  ('skip_tips', 'no author', 'a write: the caller''s own tips'),
  ('span_interval', 'no author', 'a pure function of its argument'),
  ('spin', 'no author', 'a write: answers the Act it wrote through the projection, to its author'),
  ('staff_career', 'no author', 'a staff character''s career: public'),
  ('standing_place', 'no author', 'a character''s place: public'),
  ('standings_page', 'no author', 'standings: public, per character'),
  ('standings_season', 'no author', 'a season number'),
  ('start_thread', 'no author', 'a write: answers the Act it wrote through the projection, to its author'),
  ('suggest_characters', 'no author', 'characters by name prefix: all characters_public shows, the stand-in included'),
  ('thread_page', 'swept', 'a thread''s page'),
  ('tip_keys_ok', 'no author', 'a pure function of its argument'),
  ('turn', 'no author', 'a write: the caller''s own character'),
  ('unmask', 'no author', 'a write: answers the Act it wrote through the projection, to its author'),
  ('update_payload_problem', 'no author', 'a pure function of its argument'),
  ('updates', 'no author', 'the developer''s updates: public, written by an admin'),
  ('updates_page', 'no author', 'the developer''s updates: public, written by an admin'),
  ('visit_quiz', 'no author', 'a visit''s quiz: no character'),
  ('warn_points', 'no author', 'a character''s warn points: a public fact of the character'),
  ('whoami', 'no author', 'the caller''s own account'),
  ('withdraw_turn', 'no author', 'a write: the caller''s own character')
) t(n, m, w);

-- What the catalog holds that a signed-in player may read or run, against what the list holds: names the list lacks, and names it holds that the catalog no longer does.
create function pg_temp.unlisted() returns text language sql as $$
  select coalesce(string_agg(x.kind || ' ' || x.name, ', ' order by x.kind, x.name), '') from (
    select 'relation' as kind, c.relname::text as name
    from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p')
      and (has_table_privilege('authenticated', c.oid, 'select')
           or exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and has_column_privilege('authenticated', c.oid, a.attnum, 'select')))
    union
    select 'function', p.proname::text from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p') and has_function_privilege('authenticated', p.oid, 'execute')
  ) x
  where not exists (select 1 from listed l where l.kind = x.kind and l.name = x.name)
$$;
create function pg_temp.stale() returns text language sql as $$
  select coalesce(string_agg(l.kind || ' ' || l.name, ', ' order by l.kind, l.name), '') from listed l
  where not exists (
    select 1 from pg_class c where l.kind = 'relation' and c.relnamespace = 'public'::regnamespace and c.relname = l.name and c.relkind in ('r', 'v', 'm', 'p')
      and (has_table_privilege('authenticated', c.oid, 'select')
           or exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and has_column_privilege('authenticated', c.oid, a.attnum, 'select'))))
    and not exists (select 1 from pg_proc p where l.kind = 'function' and p.pronamespace = 'public'::regnamespace and p.proname = l.name and p.prokind in ('f', 'p') and has_function_privilege('authenticated', p.oid, 'execute'))
$$;

-- ---------------------------------------------------------------------------------------------------------------- the migration exists ----
select tests.unbecome();
do $$
begin
  if to_regclass('post_veils') is null then raise exception 'post_veils exists'; end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------- 3. completeness ----
do $$
declare got text;
begin
  got := pg_temp.unlisted();
  if got <> '' then raise exception 'the sweep''s list lacks what a signed-in player may read or run: %. List each as swept (and probe it below) or as no author with its reason.', got; end if;
  got := pg_temp.stale();
  if got <> '' then raise exception 'the sweep''s list holds what is no longer granted: %', got; end if;
  -- Its poison: a granted view that carries a post's character, which the check must name.
  create view public.sweep_poison as select id, character from acts;
  grant select on public.sweep_poison to authenticated;
  got := pg_temp.unlisted();
  if got is distinct from 'relation sweep_poison' then raise exception 'the completeness check did not name a granted view of acts.character: %', got; end if;
  drop view public.sweep_poison;
  if pg_temp.unlisted() <> '' then raise exception 'the poison left something behind'; end if;
  -- And one function.
  create function public.sweep_poison_fn() returns uuid language sql security definer as 'select id from acts limit 1';
  grant execute on function public.sweep_poison_fn() to authenticated;
  got := pg_temp.unlisted();
  if got is distinct from 'function sweep_poison_fn' then raise exception 'the completeness check did not name a granted function: %', got; end if;
  drop function public.sweep_poison_fn();
  -- The marks mean what they say: every swept name has a probe below (checked at the end of the sweep), and nothing is marked `no author` with an empty reason.
  if exists (select 1 from listed where length(btrim(why)) < 5) then raise exception 'a listed name has no reason'; end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------- the sweep ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('sw-ann'); bob uuid := tests.account('sw-bob'); ray uuid := tests.account('sw-ray'); adm uuid := tests.account('sw-admin');
  a uuid := tests.character(ann, 'Sw Ann'); b uuid := tests.character(bob, 'Sw Bob'); r uuid := tests.character(ray, 'Sw Ray');
  general uuid := (select id from boards where slug = 'general');
  t uuid := tests.thread('Sw sweep thread'); t3 uuid := tests.thread('Sw elsewhere');
  stand uuid;
  p uuid; p2 uuid; edit uuid; used uuid; quoted uuid; ray_card uuid; vplay uuid; spun jsonb; on_a uuid;
  veiled uuid[];
  probe record; res text; leaks boolean; found text[] := '{}'; missed text[] := '{}'; phase text;
begin
  perform pg_temp.cards();
  insert into admins (account) values (adm);
  insert into characters (name, staff, staff_kind, debuted_at) values ('Anonymous', 'anonymous', 'anonymous', now()) returning characters.id into stand;
  insert into character_profiles (character, title, signature) values (stand, 'Could be anyone.', '');
  insert into settings (key, value) values ('systemEnabled', 'true') on conflict (key) do update set value = 'true';
  perform pg_temp.hand(ann, 'swuse');
  perform pg_temp.hand(bob, 'swauthor');
  perform pg_temp.hand(ray, 'swplain', 'swchar');

  -- The fixture: A's post opens the thread, with an edit, a use card of A's, B's quote of it, a spin from it, a follower and an alert; A has another post elsewhere.
  perform tests.post(r, t3, 'Ray opens the other thread.');
  p := tests.post(a, t, 'Sweep words about pie.');
  edit := tests.act(a, 'edit', t, jsonb_build_object('body', 'Sweep words about pie, reworded.'), p);
  quoted := tests.act(b, 'post', t, jsonb_build_object('body', 'Quoting the sweep.'), p);
  p2 := tests.post(a, t3, 'A post of A''s elsewhere.');
  p2 := tests.post(a, t3, 'A post of A''s elsewhere.');
  perform tests.post(r, t3, 'Ray has the last word there.');
  perform tests.post(r, t, 'Ray replies in the thread.');
  perform tests.become_service();
  used := (play_card(ann, 'swuse', a, p, '{}', 0, '') ->> 'id')::uuid;
  ray_card := (play_card(ray, 'swplain', r, p, '{}', 0, '') ->> 'id')::uuid;
  perform tests.unbecome();
  -- A card of R's on A's character, played from A's post elsewhere an hour before (written as play_card writes it, so it is older than the cards below: a play's moment reads the plays above that were up before it).
  on_a := tests.act(r, 'card', t3, jsonb_build_object('card', 'swchar', 'message', '', 'config', '{}'::jsonb, 'reach', 'character', 'character', a, 'ends', now() + interval '1 day', 'targetName', 'Sw Ann'), p2, now() - interval '1 hour');
  insert into play_reach (play, reach, character, ends_at) values (on_a, 'character', a, now() + interval '1 day');
  perform tests.become(adm); perform reverse_card(ray_card); perform tests.unbecome();
  perform tests.become(bob); spun := spin(p, b, 'Sw spun thread', 'A spin from the sweep post.'); perform tests.unbecome();
  insert into thread_follows (account, thread, follow) values (ray, t, true);
  perform write_alert(r, 'quote', null, p, null);

  perform set_config('sweep.a', a::text, true); perform set_config('sweep.stand', stand::text, true); perform set_config('sweep.t', t::text, true);
  perform set_config('sweep.p', p::text, true); perform set_config('sweep.used', used::text, true); perform set_config('sweep.general', general::text, true);

  -- The probes, as R reads them. kind: `id` leaks if A's id or name is in the answer; `absent` if any veiled Act's id is; `present` if the stand-in's answer lacks P; `standname` if the stand-in is named.
  -- fires: whether the detector can go red on the unveiled fixture. pending: still leaks after the cast, and is another task's to close.
  create temp table probes (name text primary key, kind text not null, stmt text not null, fires boolean not null default true, pending boolean not null default false);
  insert into probes (name, kind, stmt, fires, pending) values
    ('thread_page', 'id', 'select thread_page(current_setting(''sweep.t'')::uuid, 1, null, null, null)::text', true, false),
    ('acts_public by id', 'id', 'select coalesce(jsonb_agg(to_jsonb(x)), ''[]'')::text from acts_public x where x.id = current_setting(''sweep.p'')::uuid', true, false),
    ('acts_public by thread', 'id', 'select coalesce(jsonb_agg(to_jsonb(x)), ''[]'')::text from acts_public x where x.thread = current_setting(''sweep.t'')::uuid', true, false),
    ('acts_public by character A', 'absent', 'select coalesce(jsonb_agg(x.id), ''[]'')::text from acts_public x where x.character = current_setting(''sweep.a'')::uuid and x.thread = current_setting(''sweep.t'')::uuid', true, false),
    ('acts_public by the stand-in', 'present', 'select coalesce(jsonb_agg(x.id), ''[]'')::text from acts_public x where x.character = current_setting(''sweep.stand'')::uuid', true, false),
    ('thread_open', 'id', 'select coalesce(jsonb_agg(to_jsonb(o)), ''[]'')::text from thread_open o where o.id = current_setting(''sweep.t'')::uuid', true, false),
    ('thread_list', 'id', 'select coalesce(jsonb_agg(to_jsonb(l)), ''[]'')::text from thread_list l where l.board = current_setting(''sweep.general'')::uuid', true, false),
    ('board_page', 'id', 'select board_page(''general'', 1, null)::text', true, false),
    ('index_page', 'id', 'select index_page()::text', false, false),
    ('profile_page(A)', 'absent', 'select profile_page(current_setting(''sweep.a'')::uuid)::text', true, false),
    ('profile_page(stand-in)', 'present', 'select profile_page(current_setting(''sweep.stand'')::uuid)::text', true, false),
    ('record_page(A)', 'absent', 'select record_page(current_setting(''sweep.a'')::uuid, ''all'', 1)::text', true, false),
    ('record_page(stand-in)', 'present', 'select record_page(current_setting(''sweep.stand'')::uuid, ''all'', 1)::text', true, false),
    ('alerts_page', 'rows', 'select alerts_page(null)::text', true, false),
    ('log_page', 'rows', 'select log_page(null)::text', true, false),
    ('my_followed_threads', 'id', 'select coalesce(jsonb_agg(to_jsonb(f)), ''[]'')::text from my_followed_threads f', false, false),
    ('my_cards_ended', 'id', 'select coalesce(jsonb_agg(to_jsonb(e)), ''[]'')::text from my_cards_ended e', true, false),
    ('play_moment', 'id', 'select play_moment(current_setting(''sweep.used'')::uuid)::text', true, false),
    ('effects_above', 'id', 'select coalesce(jsonb_agg(to_jsonb(e)), ''[]'')::text from effects_above(array(select distinct x.character from acts_public x where x.thread = current_setting(''sweep.t'')::uuid and x.character is not null), current_setting(''sweep.t'')::uuid, current_setting(''sweep.general'')::uuid) e', true, false),
    ('card_target_reach', 'nonempty', 'select coalesce(card_target_reach(''post'', current_setting(''sweep.p'')::uuid) -> ''above'' -> ''character'', ''[]'')::text', true, false),
    ('post_tails', 'id', 'select coalesce(jsonb_agg(to_jsonb(x)), ''[]'')::text from post_tails(array[current_setting(''sweep.p'')::uuid]) x', false, false),
    ('boot', 'id', 'select boot()::text', false, false),
    ('presence_box', 'standname', 'select presence_box(''thread'', current_setting(''sweep.t'')::uuid)::text', false, false),
    ('search_posts', 'id', 'select search_posts(''pie'', null, null, null, null, false, ''newest'', null, 20)::text', true, true),
    ('search_threads', 'id', 'select search_threads(''pie'', null, null, null, null, false, ''newest'', null, 20)::text', true, true),
    ('search_suggest', 'id', 'select search_suggest(''Sw sweep'', array[''threads''], null, true, 10)::text', false, false);

  -- Whether a probe's answer holds what it looks for.
  create function pg_temp.leaks(kind text, res text) returns boolean language plpgsql as $f$
  declare vs uuid[] := string_to_array(current_setting('sweep.veiled', true), ',')::uuid[]; v uuid;
  begin
    if res like 'refused %' then raise exception 'a probe was refused: %', res; end if;
    if kind = 'id' then return res like '%' || current_setting('sweep.a') || '%' or res like '%Sw Ann%'; end if;
    if kind = 'absent' then
      foreach v in array vs loop if res like '%' || v::text || '%' then return true; end if; end loop;
      return false;
    end if;
    if kind = 'present' then return res not like '%' || current_setting('sweep.p') || '%'; end if;
    if kind = 'standname' then return res like '%Anonymous%'; end if;
    if kind = 'nonempty' then return res not in ('[]', 'null'); end if;
    -- A veiled Act anywhere in the answer, as an object, with its true character.
    if kind = 'rows' then
      return exists (select 1 from jsonb_path_query(res::jsonb, 'strict $.**') o
                     where jsonb_typeof(o) = 'object' and o ->> 'id' = any (select unnest(vs)::text) and o ->> 'character' = current_setting('sweep.a'));
    end if;
    raise exception 'a probe of kind %', kind;
  end $f$;

  -- The Acts that are veiled once the cast has landed: P, its edit, A's use card on it (its character is A's, its target is P). Set before the cast too, so the `absent` probes look for the same ids in both phases.
  veiled := array[p, edit, used];
  perform set_config('sweep.veiled', array_to_string(veiled, ','), true);

  -- ---- 1. The detector's poison: before the cast, every probe that can fire does, as R ----
  for probe in select * from probes order by name loop
    res := pg_temp.read_as(ray, probe.stmt);
    if res like 'refused %' then raise exception 'probe % was refused: %', probe.name, res; end if;
    leaks := pg_temp.leaks(probe.kind, res);
    if probe.fires and not leaks then missed := missed || (probe.name || ' answered ' || left(res, 160)); end if;
  end loop;
  if cardinality(missed) > 0 then
    raise exception 'the sweep''s detector found nothing before the cast in: %. A probe that cannot go red on the unveiled fixture proves nothing: fix the fixture or the probe, or mark it as one that carries no character (fires false).', missed;
  end if;

  -- ---- The cast ----
  perform tests.become_service();
  vplay := (play_card(bob, 'swauthor', b, p, '{}', 0, '') ->> 'id')::uuid;
  perform tests.unbecome();
  if not exists (select 1 from post_veils v where v.play = vplay and v.post = p) then raise exception 'the veil did not land'; end if;

  -- ---- 2. After the cast, as R, no probe leaks (the pending ones still do, until Task 3) ----
  found := '{}';
  for probe in select * from probes order by name loop
    res := pg_temp.read_as(ray, probe.stmt);
    if res like 'refused %' then raise exception 'probe % was refused: %', probe.name, res; end if;
    leaks := pg_temp.leaks(probe.kind, res);
    if leaks and not probe.pending then found := found || (probe.name || ' => ' || left(res, 300)); end if;
    if probe.pending and not leaks then
      raise exception '% no longer finds the author: Task 3 has closed it. Move it from `pending` to `swept` in the list and in the probes, and delete this check''s pending marks.', probe.name;
    end if;
  end loop;
  if cardinality(found) > 0 then raise exception 'after the cast a third player still reads the author in: %', found; end if;

  -- The author's own player reads the same: the projection is one for everybody (their own fact comes from my_veiled_posts alone).
  for probe in select * from probes where not pending and kind in ('id', 'present') and name not in ('profile_page(stand-in)', 'record_page(stand-in)', 'alerts_page', 'log_page', 'my_followed_threads', 'my_cards_ended') order by name loop
    res := pg_temp.read_as(ann, probe.stmt);
    if probe.kind = 'id' and (res like '%Sw Ann%' and probe.name not in ('thread_page', 'boot')) then raise exception 'the author reads their own name in % after the cast: %', probe.name, left(res, 300); end if;
    if probe.kind = 'present' and pg_temp.leaks('present', res) then raise exception 'the author does not read the stand-in''s answer in %', probe.name; end if;
  end loop;

  -- Every name the list marks `swept` has a probe, by the name its probe carries (a function by its name, a read of a thread or a page by the read).
  if exists (select 1 from listed l where l.mark = 'swept' and l.name not in ('acts_public', 'thread_open', 'thread_list', 'my_cards_ended', 'my_followed_threads')
               and not exists (select 1 from probes p where p.name = l.name or p.name like l.name || '(%' or p.name like l.name || ' %')) then
    raise exception 'a name the list marks swept has no probe: %', (select string_agg(l.name, ', ') from listed l where l.mark = 'swept' and l.name not in ('acts_public', 'thread_open', 'thread_list', 'my_cards_ended', 'my_followed_threads')
      and not exists (select 1 from probes p where p.name = l.name or p.name like l.name || '(%' or p.name like l.name || ' %'));
  end if;
end $$;
