-- The author's veil, swept (supabase/migrations/0400_post_veils.sql; docs/plans/2026-11-11-card-notes-part-3-plan.md, Task 2, "veil-sweep"): the guard that the list of reads a veil changes is whole.
--
-- A fixture: author A's post P opens a thread, with an edit, a use card of A's on it, another character's quote of it, a spin from it, a follower, an alert about it to a third player R, a card R played on it that an
-- admin ended, and a card R played on A's character from a post of A's elsewhere, and another from a second post of A's (P4), which names A and points at P4: a veil on P4 is refused, and P, which nothing was played from, is veiled.
-- R reads everything below as a third player would.
--
--  1. THE DETECTOR'S POISON. Before the cast, every probe below must find what it looks for (A's id or name, or the veiled Acts' ids, or the stand-in's emptiness). A probe that cannot go red on the unveiled
--     fixture proves nothing, so the test fails on one that does not; a probe that carries no character at all says so (`fires` false) and can only show absence.
--  2. After the cast, as R, no probe finds it. The reads are those the plan names: the thread's page, acts_public (by id, by thread, by character A and by the stand-in), thread_open and thread_list, the board and the index,
--     the profile of A (P absent) and of the stand-in (P present), the record, alerts, the log, followed threads, the caster's ended plays, a play's moment, the effects above a page's characters, post tails, boot, and the
--     staff presence box. Search (search_posts, search_threads, search_suggest) is swept too, with the functions under it and post_search.
--  3. COMPLETENESS. One list holds every table, view and function a signed-in player may read or run, each marked `swept`, `no author` (with its reason) or `pending`, and the test fails on a name the catalog holds and the
--     list does not (and on one the list holds and the catalog does not). Its poison: the test makes a granted view `select id, character from acts`, asserts the check names it, and drops it.
--
--  A read that still carries the author and is another task's to close is marked `pending` (in the list and in its probe), and is asserted to STILL find the author, so the day its task closes it this test fails and
--  says to move it to `swept`. None is pending now.

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
  -- A surface card (Graffiti's kind, 0317): a wall on a post that anyone may draw on and only the post's own character may wash.
  insert into card_kinds (key, name, alignment, rarity, play, reaches, stack, surface) values ('swwall', 'Sw Wall', 'pepperoni', 'rare', 'cast', '{post}', 1, true) on conflict (key) do nothing;
end $$;

-- ---------------------------------------------------------------------------------------------------------------- the list ----
-- Every table, view and function in `public` a signed-in player may read or run, by name (an overloaded function once), and what the sweep does about it. `swept`: read in the probes below. `no author`: carries no
-- post's author, for the reason given. `pending`: carries it today and is another task's to close.
create temp table listed (kind text not null, name text not null, mark text not null check (mark in ('swept', 'no author', 'pending')), why text not null, primary key (kind, name));
insert into listed (kind, name, mark, why)
select 'relation', n, m, w from (values
  -- tables and views
  ('acts', 'no author', 'every column but `character` is granted (0400) and `select character from acts` is refused (0166-post-veils.sql); no other column names an author'),
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
  ('my_draws', 'swept', 'the caller''s own drawings and the washes that cut them: the washer of a drawing on a veiled post is its author, so the row shows the stand-in for it (shown_author)'),
  ('reviews_due', 'no author', 'an admin''s list of edits awaiting a second look (0340_conduct): a decision, a post, a version, a time and a thread by id, and no character, name or account; empty for a player'),
  ('my_walls_drawn_on', 'no author', 'the walls on the caller''s own posts, read by their author: the post''s character is the caller''s own, and the rows name who drew or washed, public Acts'),
  ('surfaces', 'no author', 'a wall''s cover, the ids of its live Acts and its limit: no character'),
  ('character_post_counts', 'swept', 'a view over the stored counts (character_post_counts_base, granted to no one) that counts a veiled post, and the cards its author made on it (never a post or a spin of the author''s own that targets it, which acts_public leaves with them), for the stand-in and not for its author while the veil is live: A''s count equals what the profile can list, the stand-in''s includes P, and A''s is whole again at the end'),
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
  ('play_reach', 'no author', 'a play beyond a post: its target character, thread or board, which is public; a card on a character is played from one of its posts, so its Act points at that post and names its author: land_refusal refuses a veil on such a post, and none is played from a veiled one (the stand-in is no target), both held below and in 0166-post-veils.sql'),
  ('post_under', 'no author', 'a reply a Line Cutter cut in under a post (0348): the play, the parent, the reply and the thread, all ids of public Acts. The reply is its caster''s post, and the record names it (the card Act), so a veil is refused on a reply and on a post its own author cut in under (0166-post-veils.sql, section 16)'),
  ('post_search', 'swept', 'granted every column but `character`; the search reads it through the projection'),
  ('reaction_kinds', 'no author', 'the instance''s reactions'),
  ('post_reaction_kinds', 'no author', 'a post-local reaction (0402): the post, the key, the emoji, the quadrant and the card''s play, which a card Act states in public; the post''s author is on neither'),
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
  ('wallets', 'no author', 'the caller''s own wallet'),
  ('gear_kinds', 'no author', 'the instance''s gear catalog (key, rarity): no character'),
  ('gear_ledger', 'no author', 'the caller''s own gear, by account (row security)'),
  ('gear_worn', 'no author', 'the outfit a public character wears (0205): a fact of the character, never of a post'),
  ('my_cosmetic_log', 'no author', 'the caller''s own cosmetic log (gear and trophies given to the caller''s own characters; a Boss''s award names the Boss, a staff character)'),
  ('random_events', 'no author', 'the caller''s own random events (row security)'),
  ('trophy_kinds', 'no author', 'the trophy catalog (key, name, line, belt, art): no character')
) t(n, m, w);
insert into listed (kind, name, mark, why)
select 'function', n, m, w from (values
  ('admin_contact', 'no author', 'one setting, the same for every caller'),
  ('accept_conduct', 'no author', 'a write: the caller''s own acceptance of the code of conduct'),
  ('admin_failed_mail', 'no author', 'an admin''s read of the mail that failed: the account it was for and the template, never a post or a character; refused to a player'),
  ('admin_reports', 'swept', 'an admin''s open reports and edits awaiting a look: real moderation speaks plainly and names the author''s ACCOUNT (never the character, its name or the stand-in) beside the words, as admin_queue names its true author by design; it is probed as an admin against a reported veiled post, and refused to a player'),
  ('admin_version', 'no author', 'an admin''s read of one version''s words: text, no character'),
  ('back_closed', 'no author', 'whether a face-down play has sprung or been taken back: a boolean'),
  ('conceal_layer', 'no author', 'whether a version''s quote layer is made, and its words (null for a hidden version): no character; the concealment keys on the Act, never on who asks'),
  ('conduct_accepted', 'no author', 'whether the caller''s own account has accepted the current code'),
  ('decide', 'no author', 'an admin''s write: answers the decision id it wrote'),
  ('decide_report', 'no author', 'an admin''s write: answers the decision ids it wrote'),
  ('my_bar', 'no author', 'the caller''s own account''s suspension or ban'),
  ('my_conduct_log', 'no author', 'the caller''s own decisions on the caller''s own posts, by id: no character'),
  ('my_hidden_version', 'swept', 'a hidden post''s words and state, to its own player alone (the answer takes as long for anyone and is null for another player); probed as a third player against a veiled post'),
  ('my_open_reports', 'no author', 'how many reports the caller''s own account has open'),
  ('quote_hidden', 'no author', 'whether any version of a post is hidden: a boolean'),
  ('report_post', 'no author', 'a write: answers the report id it wrote, whoever owns the post (it reads no character)'),
  ('shown_payload', 'no author', 'a pure function of its arguments'),
  ('version_hidden', 'no author', 'whether a version is hidden: a boolean'),
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
  ('board_closed_to', 'no author', 'a closed board''s ways out: boards by name'),
  ('board_stubs', 'no author', 'the threads that moved off a board: ids, titles and boards'),
  ('move_thread_names', 'no author', 'the titles and boards of the threads a move names'),
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
  ('group_now', 'no author', 'a character''s group: a public fact of the character, made from the same projected count as character_post_counts (character_counts_shown), so it follows the count a player reads and never the true one'),
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
  ('my_totals_withheld', 'no author', 'whether a post''s totals are withheld from the caller''s own account (a totals veil, 0401): a boolean about the totals, never a character; the reaction_tallies policy calls it'),
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
  ('search_matches', 'swept', 'a definer; returns shown_author, so a veiled post is the stand-in''s'),
  ('search_post_cards', 'no author', 'the cards on a post: no character'),
  ('search_posts', 'swept', 'returns the projection''s character (shown_author), never post_search.character'),
  ('search_suggest', 'swept', 'suggests thread titles, boards and characters by name: no post''s author (its sweep can only show absence)'),
  ('search_suggest_threads', 'no author', 'suggests thread titles and boards: no author'),
  ('search_thread_matches', 'swept', 'a definer; counts by author through the veil as search_match_conds does'),
  ('search_threads', 'swept', 'returns the projection''s character (shown_author), never post_search.character'),
  ('search_updates_thread', 'no author', 'the Updates thread''s id'),
  ('search_walk', 'swept', 'a definer; its rows come from search_matches_sql''s text, so a veiled post is the stand-in''s'),
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
  ('surface_acts', 'swept', 'a wall''s live draws and washes, through acts_public: a wash is the post''s own character''s, so on a veiled post it is the stand-in''s'),
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
  ('withdraw_turn', 'no author', 'a write: the caller''s own character'),
  ('admin_awards', 'no author', 'an admin''s read of the awards given: each names the recipient character, its giver in words (a Boss or the season) and the award''s move, a staff Act; no post'),
  ('admin_character_named', 'no author', 'an admin''s lookup of a character by its name, for an award: a name is public'),
  ('award_trophy', 'no author', 'an admin''s write: an award to a named character'),
  ('belt_lineage', 'no author', 'a belt''s holders in order: characters that were given it, by award, never by post'),
  ('cosmetic_log_rows', 'no author', 'the caller''s own cosmetic log rows: gear and trophies of the caller''s own characters'),
  ('give_failed_award', 'no author', 'an admin''s write: an award a failed move left owing'),
  ('grant_gear', 'no author', 'an admin''s write: gear to a character'),
  ('make_trophy', 'no author', 'an admin''s write: a trophy kind'),
  ('my_wardrobe', 'no author', 'the caller''s own gear'),
  ('profile_cosmetics', 'no author', 'a public character''s outfit and trophy shelf, by character id: a fact of the character, never of a post'),
  ('reverse_award', 'no author', 'an admin''s write: takes an award back'),
  ('trophies_of', 'no author', 'a public character''s trophies, by character id: each names its giver in words and its move, a staff Act'),
  ('trophy_award_failures', 'no author', 'an admin''s read of the awards a failed move left owing: characters by name')
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
  -- The three helpers that build and run a search's text call stand_in() and shown_author(), which no API role may execute, so a call of theirs by a player could only fail; the two definers that run them own the right
  -- to (0400 revokes it), and the list above holds none of them.
  got := (select string_agg(p.oid::regprocedure::text, ', ' order by p.proname) from pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname in ('search_match_conds', 'search_matches_sql', 'search_walk_sql')
            and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')));
  if got is not null then raise exception 'a search helper is still granted to an API role: %', got; end if;
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
  p uuid; p2 uuid; p4 uuid; p5 uuid; back uuid; back5 uuid; q5 uuid; q6 uuid; spring6 uuid; laid5 uuid; laid6 uuid; linked boolean; qa uuid; wall uuid; wash uuid; edit uuid; used uuid; quoted uuid; ray_card uuid; vplay uuid; spun jsonb; on_a uuid; on_p4 uuid; counts0 jsonb;
  veiled uuid[];
  probe record; res text; leaks boolean; found text[] := '{}'; missed text[] := '{}'; phase text;
begin
  perform pg_temp.cards();
  insert into admins (account) values (adm);
  insert into characters (name, staff, staff_kind, debuted_at) values ('Anonymous', 'anonymous', 'anonymous', now()) returning characters.id into stand;
  insert into character_profiles (character, title, signature) values (stand, 'Could be anyone.', '');
  insert into settings (key, value) values ('systemEnabled', 'true') on conflict (key) do update set value = 'true';
  perform pg_temp.hand(ann, 'swuse', 'swplain', 'swplain');
  perform pg_temp.hand(bob, 'swauthor', 'swauthor');
  perform pg_temp.hand(ray, 'swplain', 'swchar');

  -- The fixture: A's post opens the thread, with an edit, a use card of A's, B's quote of it, a spin from it, a follower and an alert; A has another post elsewhere.
  perform tests.post(r, t3, 'Ray opens the other thread.');
  p := tests.post(a, t, 'Sweep words about pie.');
  edit := tests.act(a, 'edit', t, jsonb_build_object('body', 'Sweep words about pie, reworded.'), p);
  quoted := tests.act(b, 'post', t, jsonb_build_object('body', 'Quoting the sweep.'), p);
  p2 := tests.post(a, t3, 'A post of A''s elsewhere.');
  p2 := tests.post(a, t3, 'A post of A''s elsewhere.');
  p4 := tests.post(a, t3, 'A post a card is played from.');
  -- A's own quote of P, in the other thread: a post of its own, so a veil on P does not take it (who quoted what is the game's clue, and anyone may quote P); it is A's in every read, and counted as A's.
  qa := tests.act(a, 'post', t3, jsonb_build_object('body', 'A quote of her own post.'), p);
  perform tests.post(r, t3, 'Ray has the last word there.');
  perform tests.post(r, t, 'Ray replies in the thread.');
  perform tests.become_service();
  used := (play_card(ann, 'swuse', a, p, '{}', 0, '') ->> 'id')::uuid;
  ray_card := (play_card(ray, 'swplain', r, p, '{}', 0, '') ->> 'id')::uuid;
  perform tests.unbecome();
  -- A card of R's on A's character, played from A's post elsewhere an hour before (written as play_card writes it, so it is older than the cards below: a play's moment reads the plays above that were up before it).
  on_a := tests.act(r, 'card', t3, jsonb_build_object('card', 'swchar', 'message', '', 'config', '{}'::jsonb, 'reach', 'character', 'character', a, 'ends', now() + interval '1 day', 'targetName', 'Sw Ann'), p2, now() - interval '1 hour');
  insert into play_reach (play, reach, character, ends_at) values (on_a, 'character', a, now() + interval '1 day');
  -- Another, played from P4: the Act points at P4 and names A in its payload and in its play_reach row, all public, so no veil lands on P4.
  on_p4 := tests.act(r, 'card', t3, jsonb_build_object('card', 'swchar', 'message', '', 'config', '{}'::jsonb, 'reach', 'character', 'character', a, 'ends', now() + interval '1 day', 'targetName', 'Sw Ann'), p4, now() - interval '1 hour');
  insert into play_reach (play, reach, character, ends_at) values (on_p4, 'character', a, now() + interval '1 day');
  perform tests.become(adm); perform reverse_card(ray_card); perform tests.unbecome();
  perform tests.become(bob); spun := spin(p, b, 'Sw spun thread', 'A spin from the sweep post.'); perform tests.unbecome();
  insert into thread_follows (account, thread, follow) values (ray, t, true);
  perform write_alert(r, 'quote', null, p, null);
  -- A wall on P: R's card, R's drawing on it, and the author's own wash of it (only the post's own character may wash, so a wash names the post's author wherever it is read).
  insert into acts (character, kind, thread, target_act_id, payload) values (r, 'card', t, p, '{"card": "swwall", "message": "", "config": {}, "layer": 1}') returning id into wall;
  perform open_surface(wall);
  perform tests.become_service();
  perform draw_on_surface(ray, r, wall, '{"strokes": [{"width": 0.01, "points": [[0.1, 0.1]]}]}', (repeat('1', 300) || repeat('0', 9700))::bit(10000), 4000);
  wash := (wash_surface(ann, a, wall, '{"strokes": [{"width": 0.02, "points": [[0.1, 0.1]]}]}', (repeat('1', 100) || repeat('0', 9900))::bit(10000)) ->> 'id')::uuid;
  perform tests.unbecome();

  -- A's own backs (a card set face down, which only the post's own author may do): one on P, still face down at the cast, and one on a second post (P5) that springs now, on Bob's quote, before any cast: its card is A's
  -- on Bob's quote, naming the spring that targets P5, a public Act that ties A to P5 (so a veil on P5 is refused below, and that card is the detector's poison for the link probe).
  p5 := tests.post(a, t3, 'A post whose back sprang before any veil.');
  perform tests.become_service();
  back := (set_card(ann, 'swplain', a, p, '{}', 0) ->> 'id')::uuid;
  back5 := (set_card(ann, 'swplain', a, p5, '{}', 0) ->> 'id')::uuid;
  perform tests.unbecome();
  perform tests.become(bob); q5 := (post(t3, b, 'Bob quotes the post that holds a back.', p5) ->> 'id')::uuid; perform tests.unbecome();
  select k.id into laid5 from acts k where k.kind = 'card' and k.target_act_id = q5 and k.character = a;
  if laid5 is null then raise exception 'the back on the second post did not spring'; end if;

  -- A report on P by R (real moderation: the filer's account and the version, never a character): an admin reads it with the author's account, and no probe below may find the character in it.
  perform tests.become(ray); perform report_post(p, 'mask', 'Whose words are these?'); perform tests.unbecome();

  perform set_config('sweep.wall', wall::text, true);
  perform set_config('sweep.a', a::text, true); perform set_config('sweep.stand', stand::text, true); perform set_config('sweep.t', t::text, true);
  perform set_config('sweep.p', p::text, true); perform set_config('sweep.used', used::text, true); perform set_config('sweep.general', general::text, true);

  -- THE LINK PROBE. Whether any Act shown under A, as R reads them, carries in its payload (any string at any depth: `spring`, `set`, `by`, an id key) the id of an Act that targets the given post. A card A laid from a back
  -- names the spring, which targets the post the back was set on: so the card under A says A is that post's author. Its poison is the card above (laid5 on P5, which no veil covers): it must find the link there.
  create function pg_temp.link_leaks(on_post uuid) returns boolean language sql as $f$
    select exists (
      select 1 from acts_public x, jsonb_path_query(x.payload, 'strict $.**') v
      where x.character = current_setting('sweep.a')::uuid and jsonb_typeof(v) = 'string'
        and (v #>> '{}') in (select y.id::text from acts y where y.target_act_id = on_post))
  $f$;

  -- The probes, as R reads them. kind: `id` leaks if A's id or name is in the answer; `absent` if any veiled Act's id is; `absent_row` if one is a row of the answer (an object with that id); `present` if the stand-in's answer lacks P; `standname` if the stand-in is named.
  -- fires: whether the detector can go red on the unveiled fixture. pending: still leaks after the cast, and is another task's to close.
  create temp table probes (name text primary key, kind text not null, stmt text not null, fires boolean not null default true, pending boolean not null default false, as_admin boolean not null default false);
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
    ('profile_page(A)', 'absent_row', 'select profile_page(current_setting(''sweep.a'')::uuid)::text', true, false),
    ('profile_page(stand-in)', 'present', 'select profile_page(current_setting(''sweep.stand'')::uuid)::text', true, false),
    ('record_page(A)', 'absent_row', 'select record_page(current_setting(''sweep.a'')::uuid, ''all'', 1)::text', true, false),
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
    ('character_post_counts', 'counts', 'select jsonb_build_object(''counts'', (select n.posts from character_post_counts n where n.character = current_setting(''sweep.a'')::uuid), ''listed'', (select count(*) from acts_public x where x.character = current_setting(''sweep.a'')::uuid and x.kind = ''post''), ''profile'', profile_page(current_setting(''sweep.a'')::uuid) -> ''counts'' -> ''posts'', ''stand'', coalesce((select n.posts from character_post_counts n where n.character = current_setting(''sweep.stand'')::uuid), 0), ''stand_listed'', (select count(*) from acts_public x where x.character = current_setting(''sweep.stand'')::uuid and x.kind = ''post''))::text', false, false),
    ('surface_acts', 'id', 'select surface_acts(current_setting(''sweep.wall'')::uuid)::text', true, false),
    ('my_draws', 'id', 'select coalesce(jsonb_agg(to_jsonb(d)), ''[]'')::text from my_draws d', true, false),
    ('log_page draws', 'id', 'select (log_page(null) -> ''sources'' -> ''draws'')::text || (log_page(null) -> ''people'')::text', true, false),
    ('search_posts', 'id', 'select search_posts(''pie'', null, null, null, null, false, ''newest'', null, 20)::text', true, false),
    ('search_threads', 'id', 'select search_threads(''pie'', null, null, null, null, false, ''newest'', null, 20)::text', true, false),
    ('search_matches', 'id', 'select coalesce(jsonb_agg(to_jsonb(m)), ''[]'')::text from search_matches(''pie'', null, null, null, null, false, true, null, null, 20) m', true, false),
    ('search_walk', 'id', 'select coalesce(jsonb_agg(to_jsonb(w)), ''[]'')::text from search_walk(''pie'', null, null, null, null, false, true, null, null, 20, 100) w', true, false),
    ('search_thread_matches', 'id', 'select search_thread_matches(current_setting(''sweep.t'')::uuid, websearch_to_tsquery(''english'', ''pie''), current_setting(''sweep.a'')::uuid, null, null, false)::text', false, false),
    ('post_search', 'id', 'select coalesce(jsonb_agg(to_jsonb(x)), ''[]'')::text from (select act, thread, board, first, created_at, words from post_search) x', false, false),
    ('search_suggest', 'id', 'select search_suggest(''Sw sweep'', array[''threads''], null, true, 10)::text', false, false),
    ('my_hidden_version', 'id', 'select my_hidden_version(current_setting(''sweep.p'')::uuid)::text', false, false);
  -- The conduct work's admin read, as an admin (a player is refused it, below): the open report on P names the author's account and the words, and no character.
  insert into probes (name, kind, stmt, fires, pending, as_admin) values
    ('admin_reports', 'id', 'select admin_reports()::text', false, false, true);

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
    -- A veiled Act as a row of the answer (an object with its id), though not an Act that merely points at it: the author's own quote of P is the author's, and its `target_act_id` is P's.
    if kind = 'absent_row' then
      return exists (select 1 from jsonb_path_query(res::jsonb, 'strict $.**') o where jsonb_typeof(o) = 'object' and o ->> 'id' = any (select unnest(vs)::text));
    end if;
    if kind = 'present' then return res not like '%' || current_setting('sweep.p') || '%'; end if;
    if kind = 'standname' then return res like '%Anonymous%'; end if;
    -- A count that is not the number of posts the page can list proves a hidden post: the author's, as read, and as their profile returns it; and the stand-in's, which holds the veiled post.
    if kind = 'counts' then
      return (res::jsonb ->> 'counts')::integer is distinct from (res::jsonb ->> 'listed')::integer or (res::jsonb ->> 'profile')::integer is distinct from (res::jsonb ->> 'listed')::integer
          or (res::jsonb ->> 'stand')::integer is distinct from (res::jsonb ->> 'stand_listed')::integer;
    end if;
    if kind = 'nonempty' then return res not in ('[]', 'null'); end if;
    -- A veiled Act anywhere in the answer, as an object, with its true character.
    if kind = 'rows' then
      return exists (select 1 from jsonb_path_query(res::jsonb, 'strict $.**') o
                     where jsonb_typeof(o) = 'object' and o ->> 'id' = any (select unnest(vs)::text) and o ->> 'character' = current_setting('sweep.a'));
    end if;
    raise exception 'a probe of kind %', kind;
  end $f$;

  -- The Acts that are veiled once the cast has landed: P, its edit, A's use card on it (its character is A's, its target is P). Set before the cast too, so the `absent` probes look for the same ids in both phases.
  veiled := array[p, edit, used, wash];
  perform set_config('sweep.veiled', array_to_string(veiled, ','), true);

  -- ---- 1. The detector's poison: before the cast, every probe that can fire does, as R ----
  for probe in select * from probes order by name loop
    res := pg_temp.read_as(case when probe.as_admin then adm else ray end, probe.stmt);
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

  -- The link probe's detector first: before the veil took effect on anything A made, the card on P5's quote names P5's spring under A, as read by R (the probe goes red on a real link).
  perform tests.become(ray);
  linked := pg_temp.link_leaks(p5);
  perform tests.unbecome();
  if not linked then raise exception 'the link probe cannot find a card of A''s that names the spring on P5, so it proves nothing'; end if;
  -- R quotes the veiled P: A's back on it springs, and lays a card of A's on R's quote, naming the spring that targets P. It is shown under the stand-in, and (with the spring and the set) is among the Acts that are veiled.
  perform tests.become(ray); q6 := (post(t, r, 'Ray quotes the veiled post.', p) ->> 'id')::uuid; perform tests.unbecome();
  select s.id into spring6 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = back::text;
  select k.id into laid6 from acts k where k.kind = 'card' and k.target_act_id = q6 and k.character = a;
  if spring6 is null or laid6 is null then raise exception 'the back on the veiled post did not spring a card of A''s'; end if;
  veiled := veiled || array[back, spring6, laid6];
  perform set_config('sweep.veiled', array_to_string(veiled, ','), true);

  -- ---- 2. After the cast, as R, no probe leaks (the pending ones still do, until Task 3) ----
  found := '{}';
  for probe in select * from probes order by name loop
    res := pg_temp.read_as(case when probe.as_admin then adm else ray end, probe.stmt);
    if res like 'refused %' then raise exception 'probe % was refused: %', probe.name, res; end if;
    leaks := pg_temp.leaks(probe.kind, res);
    if leaks and not probe.pending then found := found || (probe.name || ' => ' || left(res, 300)); end if;
    if probe.pending and not leaks then
      raise exception '% no longer finds the author: Task 3 has closed it. Move it from `pending` to `swept` in the list and in the probes, and delete this check''s pending marks.', probe.name;
    end if;
  end loop;
  if cardinality(found) > 0 then raise exception 'after the cast a third player still reads the author in: %', found; end if;

  -- The reviewer's link probe: after the cast, as R, no Act shown under A names an Act that targets the veiled post (the card on R's quote is the stand-in's, with the spring and the set), while the same probe still finds
  -- the link on P5, which no veil covers (its card is A's, as it was).
  perform tests.become(ray);
  linked := pg_temp.link_leaks(p);
  perform tests.unbecome();
  if linked then raise exception 'after the cast an Act shown under A names an Act that targets the veiled post'; end if;
  if (select x.character from acts_public x where x.id = laid6) is distinct from stand or (select x.character from acts_public x where x.id = spring6) is distinct from stand then raise exception 'the card A''s back laid on the veiled post is not the stand-in''s'; end if;
  if (select n.cards from character_post_counts n where n.character = a) is distinct from (select count(*) from acts_public x where x.character = a and x.kind = 'card') then raise exception 'A''s card count is not the cards shown under A'; end if;
  -- And a veil on P5, whose back sprang before any cast, is refused in the record's words, for any caster.
  perform tests.become_service();
  res := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', bob, 'swauthor', b, p5, '{}', ''));
  perform tests.unbecome();
  if res is distinct from '42501 a card set on this post has sprung, so its author is on the record' then raise exception 'a veil on a post whose back sprang: %', res; end if;

  -- The counts probe's own poison: the stored count the view is made from still counts the veiled post, so a read of it that skipped the view would be caught by the same comparison.
  select jsonb_build_object('counts', (select n.posts from character_post_counts_base n where n.character = a), 'listed', (select count(*) from acts_public x where x.character = a and x.kind = 'post'),
                            'profile', (select n.posts from character_post_counts_base n where n.character = a), 'stand', 0, 'stand_listed', 0)
    into counts0;
  if not pg_temp.leaks('counts', counts0::text) then raise exception 'the counts probe cannot tell the stored count from what the page lists: %', counts0; end if;

  -- A post a card was played from names its author through that card's Act, so no veil lands on it, whoever casts: the refusal is the visit's manner, and nothing is written. P, which no card was played from, took the veil above.
  perform tests.become_service();
  res := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', bob, 'swauthor', b, p4, '{}', ''));
  perform tests.unbecome();
  if res is distinct from '42501 a card played from this post names its author, so the author is on the record' then raise exception 'a veil on a post a card was played from: %', res; end if;
  if exists (select 1 from post_veils v where v.post = p4) or exists (select 1 from acts_public x where x.id = p4 and x.character = stand) then raise exception 'a refused veil on the post a card was played from wrote something or hid its author'; end if;
  if res is null or (select count(*) from acts_public x where x.target_act_id = p4 and x.kind = 'card' and (x.payload ->> 'character')::uuid = a) is distinct from 1 then
    raise exception 'the card played from the post is not there to name its author';
  end if;

  -- The author's own quote of P is no content the derived veil covers: it stays A's in the projection and in the counts, which the counts probe above holds against the list of A's posts (a quote hidden by one read and
  -- counted by another would make them differ).
  if (select x.character from acts_public x where x.id = qa) is distinct from a or qa = any (veiled) then raise exception 'the author''s own quote of the veiled post is veiled with it'; end if;

  -- The author's own player reads the same: the projection is one for everybody (their own fact comes from my_veiled_posts alone).
  for probe in select * from probes where not pending and not as_admin and kind in ('id', 'present') and name not in ('profile_page(stand-in)', 'record_page(stand-in)', 'alerts_page', 'log_page', 'my_followed_threads', 'my_cards_ended') order by name loop
    res := pg_temp.read_as(ann, probe.stmt);
    -- The author's name may appear only where the page lists the caller's own masks: boot's `characters` and `faces` (every character the account owns, veiled post or not). Nowhere else, thread_page included: its `veiled`
    -- rows carry the author's own character by id, from my_veiled_posts, and no name.
    if probe.kind = 'id' and (case when probe.name = 'boot' then (res::jsonb - 'characters' - 'faces')::text else res end) like '%Sw Ann%' then raise exception 'the author reads their own name in % after the cast: %', probe.name, left(res, 300); end if;
    if probe.kind = 'present' and pg_temp.leaks('present', res) then raise exception 'the author does not read the stand-in''s answer in %', probe.name; end if;
  end loop;

  -- An admin's read is refused to a player, whoever they are.
  res := pg_temp.read_as(ray, 'select admin_reports()::text');
  if res not like 'refused %' then raise exception 'a player read the admin''s reports: %', left(res, 200); end if;
  if pg_temp.read_as(adm, 'select admin_reports()::text') not like '%Whose words are these?%' then raise exception 'the admin''s reports do not hold the report on the veiled post, so its probe proves nothing'; end if;

  -- Every name the list marks `swept` has a probe, by the name its probe carries (a function by its name, a read of a thread or a page by the read).
  if exists (select 1 from listed l where l.mark = 'swept' and l.name not in ('acts_public', 'thread_open', 'thread_list', 'my_cards_ended', 'my_followed_threads')
               and not exists (select 1 from probes p where p.name = l.name or p.name like l.name || '(%' or p.name like l.name || ' %')) then
    raise exception 'a name the list marks swept has no probe: %', (select string_agg(l.name, ', ') from listed l where l.mark = 'swept' and l.name not in ('acts_public', 'thread_open', 'thread_list', 'my_cards_ended', 'my_followed_threads')
      and not exists (select 1 from probes p where p.name = l.name or p.name like l.name || '(%' or p.name like l.name || ' %'));
  end if;

  -- ---- The end: an admin's end of the veil gives the author's count back by itself, and the stand-in's goes, as every other read shows the author again ----
  perform tests.become(adm); perform reverse_card(vplay); perform tests.unbecome();
  res := pg_temp.read_as(ray, (select stmt from probes where name = 'character_post_counts'));
  if pg_temp.leaks('counts', res) or (res::jsonb ->> 'stand')::integer is distinct from 0 or (res::jsonb ->> 'counts')::integer is distinct from (select n.posts from character_post_counts_base n where n.character = a) then
    raise exception 'after the veil was ended the counts are not whole again: %', res;
  end if;
end $$;
