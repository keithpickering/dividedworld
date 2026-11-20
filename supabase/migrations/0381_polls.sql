-- Polls: the kinds, the writes and the guards (docs/plans/2026-11-20-polls-design.md; plan docs/plans/2026-11-20-polls-plan.md, Task 1; models 0357_post_veils.sql, 0371_veil_cover.sql and 0092_card_end.sql).
--
-- A poll is an Act of kind `poll` whose target is a post (a post or a spin, `post_kind`), written by that post's character in the post's thread, with the payload {question, options, pick, secret, closes_at} or {removed: true}. A post's
-- current poll is its latest poll Act by (created_at, id) unless that is a removal; every earlier one is replaced. A ballot is an Act of kind `ballot` whose target is a poll: {picks: int[]}, distinct indices, sorted, possibly empty
-- (a withdrawal). A close is an Act of kind `poll_close` whose target is a poll: {by: 'author' | 'admin'}; an admin's close has no character, as card_end has none. A poll's end is the earlier of its closes_at and its close's
-- created_at; it is closed once now() reaches that. A character's counted ballot is its latest ballot by (created_at, id) created before the poll's end, so a ballot written in the transaction a close commits after, but created
-- later than the close's, counts for no reader, and every reader reads the same counts whatever the commit order was. All three kinds take no seq, so none is a place in a thread (and none moves the thread's last activity).
--
--   1. the kinds        acts_kind_check, acts_seq_check, acts_take_seq (each copied from its latest definition, 0317) gain the three; acts_character_null (0092) lets a poll_close of an admin's have no character.
--   2. the payloads     acts_poll_payload, acts_ballot_payload, acts_poll_close_payload, with builtins alone (jsonpath), so a direct writer meets no function it may not run. Lengths and counts that depend on settings are the writers'.
--   3. indexes          acts_ballots (a poll's ballots by character, newest first: the counted ballot, the voter list), acts_polls (a post's polls, newest first: the current poll by key), acts_one_poll_close (a poll has one close).
--   4. the settings     pollOptionsMax, pollQuestionMax, pollOptionMax, pollLastsMin, pollLastsMax, held where written (settings_held, copied whole from 0377); engine/rules/instance.ts and 0079-settings-held.sql hold the same.
--   5. acts_well_formed (copied whole from 0374) holds each Act to its target: a poll to a post_kind Act by the same character in the same thread, a ballot and a close to a poll in the same thread, an author's close to the poll's own character.
--   6. the writers      poll_written (internal), latest_poll and ballot_secret (a public fact of a poll, for the readers of acts_public); span_words (0055) says a span in a refusal; post, start_thread and edit_post gain a last parameter, `poll jsonb default null` (the old signatures are dropped, so no call is ambiguous);
--                       cast_ballot(poll, through, picks), close_poll(poll, through), close_poll_as_admin(poll), granted to authenticated. A draft is {question, options, pick, secret, lasts}; `lasts` is an interval string
--                       ("3 days", "1 hour") or a span object as the settings hold them ({"unit": "day", "count": 3}), and the poll closes at now() plus it.
--   7. the reads        poll_counts (one row per poll: counts per option, voters, ends_at, closed; characters counted and no owner read, the same for every caller) and my_ballots (the caller's own, as my_veiled_posts is).
--   8. acts_public      a ballot whose poll is secret projects a null character and {"secret": true} as payload and current_payload, for every reader alike (ballot_secret reads the poll once per ballot row): a third select takes
--                       the secret ballots with a null character, and the first two leave them out. The selects still read `acts` alone with no WHERE and no join of their own, so the union stays one appendrel.
--   9. the veil         acts_veil_cover (0371) resolves a ballot's and a close's post through its poll, so the veiled author's own ballot shows the stand-in; post_veils_cover also covers the ballots and closes the author wrote before the veil landed.
--  10. the guards       react refuses the three kinds; settlement_input and estimate_input leave them out of win_acts; spin_written refuses a close, a replaced or removed poll and a secret ballot.
--
-- Masks ("A response never proves a private fact"): a secret ballot's character and picks are withheld by acts_public, the one projection every read goes through, for every reader alike; its owner reads it through my_ballots alone.
-- poll_counts counts characters and reads no owner. cast_ballot's refusals read the poll, the picks and the caller's own character; none differs with who owns another character, and its answer and the event built from it name no
-- character on a secret poll. Two characters of one account each count; a secret poll's counts equal its voting characters, never its players.
--
-- Every function that reads base `acts` by `character` (found with the catalog: each body that selects from or joins `acts` and names a character), and how it skips a secret ballot. None needs a change but the two named; the rest
-- are keyed by kind, by seq or by one Act's id, so a ballot (no seq, never one of those kinds) is never in what they read:
--   changed here       acts_public (the projection: a secret ballot's character is null), acts_veil_cover and post_veils_cover (the veil's cover), settlement_input and estimate_input (win_acts leaves out the three kinds).
--   by kind            infract, live_infractions, banned_until, punishment_running, staff_punishments, apology and appeal readers (kinds infraction, ban, move, appeal, appeal_ruling); the visit family: start_visit, file_visit, end_visit, distract_visits,
--                      intercept, presence_box, visit_quiz, filings_due (visit, visit_join, visit_end, intercept); the report family: open_report, close_report, report_post, my_reports_left (report, report_verdict); draw_visits, rule_breaks,
--                      arc_board_posts, write_staff_note, backfill_character_post_counts (post, spin, card); masks_change, unmask (unmask); season_news, alerts_news, news readers (announce, update, tally); pool_orphans, record_pool_spend
--                      (post, set, card, draw); the move readers (admin_queue, bars_of, group_now, group_move_bars, system_tick, hand_over, handoff_facts, move_owner, say_move_end, end_move: move, move_end, move_keep, describe);
--                      the card readers (place_cast, place_set, play_card, lay_sprung, spring_traps, spring_facts, take_back, card_target, card_target_reach, land_refusal, land_rows, ward_refusal, reach_effects, scored_as_plays, reverse_card,
--                      play_moment, spin_moment, save_effect_state, claim_card_writes, act_window_counts: card, set, spring, take_back, card_end, draw, wash).
--   by seq (= 1)       my_alerts_unread, my_followed_threads, following_thread (a thread's first Act: a ballot has no seq).
--   by one Act's id    acts_appeal_guard, acts_report_guard, acts_visit_guard, acts_intercept_guard, acts_warn_guard, conduct_author, conduct_decisions_well_formed, my_hidden_version, donate, surface_apply, wash_surface, surface_cuts_of,
--                      surface_marks_of, cosmetic_log_rows, trophy_given_by, fire_hint, file_visit's post read, my_alerts (an alert's own Act): each reads the character of an Act it was handed the id of (a post, a card, a visit...), never
--                      a set of Acts by character. A ballot's id reaches none of them: each refuses or ignores a target that is not of its own kind.
--   views by kind      bars_now, character_veiled_counts, class_reveals, moves_log, my_appeals, my_bans, my_cards_ended, my_falls_taken, my_infractions, my_posts_played_on, my_posts_written_on, my_reports, my_scored_as, rules_now,
--                      turns_announced, watched_characters, thread_open (the thread's first Act: seq = 1).
--   acts_base          the ungranted view of today's acts_public with the true character is read by no function, view or role (the digest's role reads acts_public).
-- The grep the plan names (`grep -n "from acts "` over the latest definitions) was run over the catalog's bodies and views instead of the files, since a body is the definition that is deployed.
--
-- Ways out: an open poll closes by itself at closes_at, by its author's close_poll or by an admin's; a ballot is changed or withdrawn by its character until the poll's end (a new ballot, an empty one); a poll that has ballots
-- cannot change, and says so in one sentence that points at Close; a closed poll is final, holds nothing of anyone's, and its post and its words go on as before.
--
-- Lock order: POST, THEN visits_open, THEN CHARACTER (0357's header), in each function below that takes more than one. edit_post takes the post `for no key update` before it checks anything when it sets or removes a poll, and cast_ballot and
-- the closes take the poll's post `for share` before they read the post's current poll or check the character, so an edit and a ballot meet at the post's row and never hold one row each and wait on the other: whichever
-- commits second is refused (a ballot on the replaced poll, or an edit of a poll that has a ballot), never a ballot that counts on a replaced poll (supabase/tests/0381-polls.sql, section 1). A close also takes the poll's own row
-- `for no key update`, which a ballot's foreign key (`for key share`) does not conflict with, so two closes are laid one at a time and the second is refused. No function here takes a character's row; the veil's advisory lock
-- (veil_cover_lock) is taken by the triggers after every row lock, as 0371 has it.
--
-- Each function below is copied from its latest definition, named in the comment above it, changing only what that comment names.


-- ===================================================================================== 1. the kinds ====
alter table acts drop constraint acts_kind_check;
alter table acts add constraint acts_kind_check check (kind in ('post', 'spin', 'card', 'edit', 'tally', 'reveal', 'unmask', 'move', 'move_end', 'move_keep', 'set', 'spring', 'update', 'card_end', 'announce', 'describe', 'infraction', 'ban',
  'visit', 'visit_join', 'visit_end', 'report', 'report_verdict', 'intercept', 'appeal', 'appeal_ruling', 'take_back', 'donation', 'draw', 'wash', 'poll', 'ballot', 'poll_close'));

alter table acts drop constraint acts_seq_check;
alter table acts add constraint acts_seq_check check ((kind = 'edit') = (seq is null) or kind in ('card', 'set', 'spring', 'card_end', 'describe', 'infraction', 'ban', 'visit', 'visit_join', 'visit_end', 'report', 'report_verdict', 'intercept',
  'appeal', 'appeal_ruling', 'take_back', 'donation', 'draw', 'wash', 'poll', 'ballot', 'poll_close'));

-- An admin's close belongs to no character, as a card_end does not; an author's close is its character's.
alter table acts drop constraint acts_character_null;
alter table acts add constraint acts_character_null check (("character" is null) = (kind in ('tally', 'reveal', 'move_end', 'card_end', 'describe', 'infraction', 'ban', 'visit_end') or (kind = 'poll_close' and payload ->> 'by' = 'admin')));

-- acts_take_seq (0317), also leaving a poll, a ballot and a close out of the thread's seq. Everything else as 0317 wrote it.
create or replace function acts_take_seq() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.kind in ('edit', 'card', 'set', 'spring', 'card_end', 'describe', 'infraction', 'ban', 'visit', 'visit_join', 'visit_end', 'report', 'report_verdict', 'intercept', 'appeal', 'appeal_ruling', 'take_back', 'donation', 'draw', 'wash', 'poll', 'ballot', 'poll_close') then
    new.seq := null;
  else
    -- On the right of an assignment a column is its old value: a post that takes a seq above 1 is a reply.
    update threads set next_seq = next_seq + 1, last_at = greatest(last_at, new.created_at),
                       replies = replies + case when new.kind = 'post' and next_seq > 1 then 1 else 0 end
     where id = new.thread returning next_seq - 1 into new.seq;
  end if;
  return new;
end $$;

-- ===================================================================================== 2. the payloads ====
-- Each as a constraint of its own, in builtins alone: jsonpath reads the arrays' elements, so no function is called that a direct writer (an import) might not run.
-- A poll is exactly {removed: true}, or exactly its five fields: a question that is a string, two or more options that are strings, a pick that is a whole number from 1 to the options' count, a boolean secret and a closes_at
-- that is a string and begins as a time does. (That it is a time is the writers' to say; they write one from now().) A ballot's picks are an array of whole numbers: their range is the writer's, since it is the poll's. A close is
-- by 'author' or by 'admin'.
alter table acts add constraint acts_poll_payload check (kind <> 'poll' or (
  payload = '{"removed": true}'::jsonb
  or (payload - 'question' - 'options' - 'pick' - 'secret' - 'closes_at' = '{}'::jsonb
      and jsonb_path_exists(payload, '$ ? (@.question.type() == "string" && @.options.type() == "array" && @.options.size() >= 2 && !exists(@.options[*] ? (@.type() != "string"))
        && @.pick.type() == "number" && @.pick >= 1 && @.pick <= @.options.size() && @.pick == @.pick.floor() && @.secret.type() == "boolean"
        && @.closes_at.type() == "string" && @.closes_at like_regex "^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ]")'))) is true);

alter table acts add constraint acts_ballot_payload check (kind <> 'ballot' or (
  payload - 'picks' = '{}'::jsonb
  and jsonb_path_exists(payload, '$ ? (@.picks.type() == "array" && !exists(@.picks[*] ? (@.type() != "number" || @ != @.floor())))')) is true);

alter table acts add constraint acts_poll_close_payload check (kind <> 'poll_close' or (
  payload - 'by' = '{}'::jsonb and jsonb_typeof(payload -> 'by') = 'string' and payload ->> 'by' in ('author', 'admin')) is true);

-- ===================================================================================== 3. indexes ====
-- A poll's ballots by character, newest first: the counted ballot of each character (poll_counts reads it by DISTINCT ON), the voter list, and the history of changes, all keyed by the poll.
create index acts_ballots on acts (target_act_id, "character", created_at desc, id desc) where kind = 'ballot';
-- A post's polls, newest first: the current poll is the first row.
create index acts_polls on acts (target_act_id, created_at desc, id desc) where kind = 'poll';
-- A poll has one close; a second, written by two closes at once, is refused by the key (the writers lock the poll and refuse it in words first).
create unique index acts_one_poll_close on acts (target_act_id) where kind = 'poll_close';

-- ===================================================================================== 4. the settings ====
-- settings_held (0377), also holding the five poll settings: the most options a poll has (2 to 100), the longest question and option (characters, at least 1), and the least and most a poll may last (a span: a unit of hour, day, week or month
-- and a whole count from 1 to 1000; an hour is allowed here as a card's `lasts` allows it). Everything else as 0377 wrote it. engine/rules/instance.ts (SETTINGS) holds the same, and 0079-settings-held.sql lists a poison at each edge.
create or replace function public.settings_held()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v jsonb := new.value;
  why text;
  shape text;
  phase text;
  pkey text;
  kinds text[] := array['quote', 'cardOnYours', 'trapStruck', 'trapSprang', 'hint', 'ruling', 'settlement', 'followed', 'update', 'seasonNews', 'cardEnded', 'framed', 'trophy', 'beltLost', 'beltBack'];
begin
  why := case new.key
    when 'walletCap' then case when not setting_whole(v, 1) then 'a whole number of hundredths, at least 1' end
    when 'vote' then case when not setting_whole(v, 1) then 'a whole number of hundredths, at least 1' end
    when 'halving' then case when not coalesce(jsonb_typeof(v) = 'number' and setting_positive(v) and (v #>> '{}')::numeric <= 1, false)
      then 'a fraction above 0 and at most 1' end
    when 'reactionCap' then case when not setting_whole(v, 1) then 'a whole number, at least 1' end
    when 'charactersPerPlayer' then case when not setting_whole(v, 1) then 'a whole number, at least 1' end
    when 'settlementCron' then case when not setting_cron(v) then 'a five-field cron expression, each field inside its range' end
    when 'viewCountCron' then case when not setting_cron(v) then 'a five-field cron expression, each field inside its range' end
    when 'meetingCron' then case when not setting_cron(v) then 'a five-field cron expression, each field inside its range' end
    -- The spans the earlier triggers hold, but let through with a field missing.
    when 'settlementLength' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'seasonLength' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'turnCooldown' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'inviteLifetime' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'setLasts' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'editGrace' then case when not setting_span(v, array['minute', 'day', 'week', 'month']) then 'a span: a unit of minute, day, week or month and a whole count from 1 to 1000' end
    when 'presenceWindow' then case when not setting_span(v, array['minute', 'day', 'week', 'month']) then 'a span: a unit of minute, day, week or month and a whole count from 1 to 1000' end
    when 'registrationMode' then case when v not in ('"open"', '"invite"', '"closed"') then '"open", "invite" or "closed"' end
    when 'postMaxLength' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'pollOptionsMax' then case when not setting_whole(v, 2, 100) then 'a whole number of options, at least 2 and at most 100' end
    when 'pollQuestionMax' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'pollOptionMax' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'pollLastsMin' then case when not setting_span(v, array['hour', 'day', 'week', 'month']) then 'a span: a unit of hour, day, week or month and a whole count from 1 to 1000' end
    when 'pollLastsMax' then case when not setting_span(v, array['hour', 'day', 'week', 'month']) then 'a span: a unit of hour, day, week or month and a whole count from 1 to 1000' end
    when 'titleMaxLength' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'postsPerPage' then case when not setting_whole(v, 1) then 'a whole number of posts, at least 1' end
    when 'hotReplies' then case when not setting_whole(v, 1) then 'a whole number of replies, at least 1' end
    when 'presenceNames' then case when not setting_whole(v, 1) then 'a whole number of names, at least 1' end
    when 'presencePollSeconds' then case when not setting_whole(v, 10, 300) then 'a whole number of seconds from 10 to 300' end
    when 'cardSettings' then case when not setting_named_numbers(v) then 'an object of named numbers' end
    when 'systemEnabled' then case when jsonb_typeof(v) is distinct from 'boolean' then 'true or false' end
    when 'oldVoice' then case when jsonb_typeof(v) is distinct from 'boolean' then 'true or false' end
    when 'cardWriteSettleSeconds' then case when not setting_whole(v, 0, 600) then 'a whole number of seconds, at least 0 and at most 600' end
    -- The old voice's window (§4 of docs/plans/2026-11-12-old-voice-window-design.md), in the words engine/rules/instance.ts gives each.
    when 'oldVoiceWindow' then case when not setting_whole(v, 64, 1000000) then 'a whole number of tokens from 64 to 1,000,000' end
    when 'oldVoiceTokenizer' then case when v not in ('"gpt2"', '"bytes"') then '"gpt2" or "bytes"' end
    when 'oldVoicePromptFloor' then case when not setting_whole(v, 1) then 'a whole number of tokens, at least 1' end
    when 'cardWriteFullShare' then case when not coalesce(case when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric between 0 and 1 end, false) then 'a number from 0 to 1' end
    when 'cardWriteTopUps' then case when not setting_whole(v, 0, 5) then 'a whole number from 0 to 5' end
    when 'hints' then case when not coalesce(jsonb_typeof(v) = 'object'
        and setting_whole(v -> 'least', 1)
        and jsonb_typeof(v -> 'share') = 'number' and (v ->> 'share')::numeric > 0.5 and (v ->> 'share')::numeric <= 1
        and jsonb_typeof(v -> 'split') = 'number' and setting_positive(v -> 'split') and (v ->> 'split')::numeric <= 0.5
        and setting_span(v -> 'window', array['minute', 'day', 'week', 'month']), false)
      then 'an object giving least (a whole number of reactions, at least 1), share (above 0.5, at most 1), split (above 0, at most 0.5) and window (a span: a unit of minute, day, week or month and a whole count from 1 to 1000)' end
    when 'toastDefaults' then case when not coalesce(jsonb_typeof(v) = 'array'
        and not exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'string' or (e #>> '{}') <> all (kinds))
        and (select count(*) = count(distinct e) from jsonb_array_elements(v) e), false)
      then 'a list of the kinds of alert that toast (' || array_to_string(kinds, ', ') || '), each named once' end
    when 'phases' then null  -- below: it needs a loop
    when 'inheritanceGraceDays' then case when not setting_whole(v, 0) then 'a whole number of days, at least 0' end
    when 'rosterRecentExcluded' then case when not setting_whole(v, 0) then 'a whole number of Bosses, at least 0' end
    when 'structuralHoldHours' then case when not setting_whole(v, 1) then 'a whole number of hours, at least 1' end
    when 'microEventDailyCalls' then case when not setting_whole(v, 0) then 'a whole number of calls, at least 0' end
    when 'digestThreads' then case when not setting_whole(v, 1, 25) then 'a whole number of threads, at least 1 and at most 25' end
    when 'digestExcerpts' then case when not setting_whole(v, 1, 20) then 'a whole number of posts, at least 1 and at most 20' end
    when 'digestBoards' then case when not setting_whole(v, 1, 30) then 'a whole number of boards, at least 1 and at most 30' end
    when 'digestBoardDays' then case when not setting_whole(v, 1, 365) then 'a whole number of days, at least 1 and at most 365' end
    when 'movedStubDays' then case when not setting_whole(v, 1, 365) then 'a whole number of days, at least 1 and at most 365' end
    when 'bundleMostParts' then case when not setting_whole(v, 1, 16) then 'a whole number of parts, at least 1 and at most 16' end
    when 'bundleAuthoredMostParts' then case when not setting_whole(v, 1, 16) then 'a whole number of parts, at least 1 and at most 16' end
    when 'farewellWindowHours' then case when not setting_whole(v, 1, 720) then 'a whole number of hours, at least 1 and at most 720' end
    when 'digestExcerptChars' then case when not setting_whole(v, 1, 1000) then 'a whole number of characters, at least 1 and at most 1000' end
    when 'memoryOpinions' then case when not setting_whole(v, 1) then 'a whole number of opinions, at least 1' end
    when 'memoryGrudges' then case when not setting_whole(v, 1) then 'a whole number of grudges, at least 1' end
    when 'memoryWheelhouse' then case when not setting_whole(v, 1) then 'a whole number of subjects, at least 1' end
    when 'memoryRealWorld' then case when not setting_whole(v, 1) then 'a whole number of subjects, at least 1' end
    when 'boardNameMaxLength' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'moveExpiryMostDays' then case when not setting_whole(v, 1) then 'a whole number of days, at least 1' end
    when 'moveExpiryLeastHours' then case when not setting_whole(v, 1) then 'a whole number of hours, at least 1' end
    when 'demandCheckMinutes' then case when not setting_whole(v, 1, 1440) then 'a whole number of minutes, at least 1 and at most 1440' end
    when 'demandChecksPerTick' then case when not setting_whole(v, 1, 1000) then 'a whole number of moves, at least 1 and at most 1000' end
    when 'searchLanguage' then case when not coalesce(jsonb_typeof(v) = 'string' and exists (select 1 from pg_ts_config c where c.cfgname = v #>> '{}'), false)
      then 'the name of a text search configuration this database holds (english or simple, for example)' end
    when 'searchRankPool' then case when not setting_whole(v, 100, 100000) then 'a whole number of matches from 100 to 100,000' end
    when 'pool' then setting_pool(v)
    when 'modBots' then setting_modbots(v)
    when 'warnBar' then setting_warnbar(v)
    when 'pronouns' then case when not pronouns_hold(pronouns_lowered(v)) then 'an object of five words of 1 to 12 letters each (an apostrophe or a hyphen between two letters is allowed) and a plural, true or false' end
    when 'apology' then setting_apology(v)
    when 'conduct' then setting_conduct(v)
    when 'conductVersion' then case when not setting_whole(v, 1) then 'a whole number, at least 1 (the version of the code of conduct)' end
    when 'conductSections' then case when not coalesce(jsonb_typeof(v) = 'array'
        and not exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) is distinct from 'string' or btrim(e #>> '{}', E' \t\n\r\f\v') = ''), false)
      then 'an array of section keys, each a non-blank string' end
    when 'cosmetics' then setting_cosmetics(v)
    -- The pack an account's first character is given (0377): the key of a pack, or null for none. That it names a fixed pack of the instance is the instance check's (engine/rules/instance.ts) and
    -- welcome_pack_kind's: a name that is no fixed pack grants nothing.
    when 'startingPack' then case when not (jsonb_typeof(v) = 'null' or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}', E' \t\n\r\f\v') <> '')) then 'the key of a fixed pack, or null for none' end
    when 'modelTiers' then case when not coalesce(jsonb_typeof(v) = 'object'
        and jsonb_typeof(v -> 'strong') = 'string' and btrim(v ->> 'strong', E' \t\n\r\f\v') <> ''
        and jsonb_typeof(v -> 'light') = 'string' and btrim(v ->> 'light', E' \t\n\r\f\v') <> '', false)
      then 'an object naming a model id for "strong" and for "light"' end
    else null
  end;
  if new.key = 'phases' then
    shape := 'an object of honeymoon, reign and meltdown, each holding its numbers (honeymoon and meltdown also their days) as whole numbers, at least 1';
    if jsonb_typeof(v) <> 'object' then raise exception 'phases is %', shape using errcode = '23514'; end if;
    foreach phase in array array['honeymoon', 'reign', 'meltdown'] loop
      if jsonb_typeof(v -> phase) is distinct from 'object' then raise exception 'phases is %; "%" is missing', shape, phase using errcode = '23514'; end if;
      foreach pkey in array case when phase = 'reign' then array['weeklyMoves', 'bankCap', 'moveExpiryMostDays']
                                 else array['days', 'weeklyMoves', 'bankCap', 'moveExpiryMostDays'] end loop
        if not setting_whole(v -> phase -> pkey, 1) then raise exception 'phases is %; "%.%" is not', shape, phase, pkey using errcode = '23514'; end if;
      end loop;
      select k into pkey from jsonb_object_keys(v -> phase) k
        where k <> all (case when phase = 'reign' then array['weeklyMoves', 'bankCap', 'moveExpiryMostDays']
                             else array['days', 'weeklyMoves', 'bankCap', 'moveExpiryMostDays'] end) limit 1;
      if pkey is not null then raise exception 'phases is %; "%.%" is not a number a phase holds', shape, phase, pkey using errcode = '23514'; end if;
    end loop;
  end if;
  -- The least a poll may last is held against the most, whichever is written (the other's row is read as it stands; a row that is not a span is that row's own refusal, never this one).
  if why is null and new.key = 'pollLastsMin' and setting_span((select g.value from settings g where g.key = 'pollLastsMax'), array['hour', 'day', 'week', 'month'])
     and span_interval(v) > span_interval((select g.value from settings g where g.key = 'pollLastsMax')) then
    why := 'a span no longer than pollLastsMax';
  end if;
  if why is null and new.key = 'pollLastsMax' and setting_span((select g.value from settings g where g.key = 'pollLastsMin'), array['hour', 'day', 'week', 'month'])
     and span_interval(v) < span_interval((select g.value from settings g where g.key = 'pollLastsMin')) then
    why := 'a span no shorter than pollLastsMin';
  end if;
  if why is not null then raise exception '% is %', new.key, why using errcode = '23514'; end if;
  return new;
end $function$;

-- ===================================================================================== 5. acts_well_formed ====
-- acts_well_formed (0374), holding a poll to a post_kind Act by the same character in the same thread, a ballot and a close to a poll in the same thread, and an author's close to the poll's own character (an admin's has no character:
-- acts_character_null holds it). Everything else as 0374 wrote it.
create or replace function public.acts_well_formed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare t acts%rowtype;
begin
  if new.character is not null and coalesce(current_setting('kayfabb.staff_writer', true), '') <> 'on'
     and exists (select 1 from characters c where c.id = new.character and c.staff is not null) then
    raise exception 'a staff character acts only through the game''s own moves' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.kind in ('move', 'move_keep') and new.character is not null and not exists (select 1 from characters c where c.id = new.character and c.staff is not null) then
    raise exception 'a % is a staff character''s Act', new.kind using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.kind = 'move' then
    if not exists (select 1 from move_kinds k where k.key = new.payload ->> 'kind') then
      raise exception 'there is no move kind "%"', coalesce(new.payload ->> 'kind', '') using errcode = '23514';
    end if;
    if jsonb_typeof(new.payload -> 'demand') = 'object' and not exists (select 1 from demand_kinds d where d.key = new.payload #>> '{demand,kind}') then
      raise exception 'there is no demand kind "%"', coalesce(new.payload #>> '{demand,kind}', '') using errcode = '23514';
    end if;
    if jsonb_typeof(new.payload -> 'demand') = 'object' and demand_params_problem(new.payload -> 'demand') is not null then
      raise exception 'the demand''s params are malformed at %', demand_params_problem(new.payload -> 'demand') using errcode = '23514';
    end if;
    -- Cast once here, so an expiry that is no time is refused at the door and the readers of it never meet one.
    if jsonb_typeof(new.payload -> 'expires_at') = 'string' then perform (new.payload ->> 'expires_at')::timestamptz; end if;
  end if;
  if new.kind = 'move_end' and coalesce(current_setting('kayfabb.move_end_writer', true), '') <> 'on' then
    raise exception 'a move ends only through end_move' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.kind = 'card_end' and coalesce(current_setting('kayfabb.card_end_writer', true), '') <> 'on' then
    raise exception 'a card ends only through reverse_card' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.kind in ('draw', 'wash') and coalesce(current_setting('kayfabb.surface_writer', true), '') <> 'on' then
    raise exception 'a draw or a wash is written only through draw_on_surface and wash_surface' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.character is not null and exists (select 1 from characters c where c.id = new.character and c.debuted_at is null) then
    raise exception 'that character debuts at the next settlement' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if new.character is not null and exists (select 1 from characters c where c.id = new.character and c.retired_at is not null) and new.kind <> 'wash' then
    raise exception 'that character is retired; an admin can restore it' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if new.kind = 'announce' then
    if new.payload ->> 'what' is distinct from 'debut' and new.payload ->> 'what' is distinct from 'turn' then
      raise exception 'an announcement is a debut or a Turn' using errcode = '23514';
    end if;
    if new.payload ->> 'what' = 'debut' and new.payload ? 'was' then
      raise exception 'a debut has no class it was' using errcode = '23514';
    end if;
  end if;
  if (new.kind = 'unmask' or (new.kind = 'announce' and new.payload ? 'class'))
     and (new.payload ->> 'class') is distinct from (select class_key from class_now(new.character, new.created_at)) then
    raise exception 'an % names the class its character holds', new.kind using errcode = '23514';
  end if;
  if new.target_act_id is null then return new; end if;
  select * into t from acts where id = new.target_act_id;
  if new.kind = 'move_end' and (t.kind <> 'move' or t.thread <> new.thread) then
    raise exception 'a move_end is of a move, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'card_end' and (t.kind <> 'card' or t.thread <> new.thread) then
    raise exception 'a card_end is of a card play, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'move_keep' then
    if t.kind <> 'move' or t.thread <> new.thread then
      raise exception 'a move_keep is of a move, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
    end if;
    if not exists (select 1 from open_moves o where o.move_act = t.id) then
      raise exception 'only a move in force can be kept' using hint = 'kayfabb.refusal', errcode = '55000';
    end if;
    if (select c.staff from characters c where c.id = new.character) is distinct from current_boss() then
      raise exception 'only the season''s Boss keeps a move' using hint = 'kayfabb.refusal', errcode = '42501';
    end if;
    if move_owner(t.id) is not distinct from current_boss() then
      raise exception 'that move is already the Boss''s own' using hint = 'kayfabb.refusal', errcode = '55000';
    end if;
  end if;
  if new.kind = 'edit' and (t.kind <> 'post' or t.character <> new.character or t.thread <> new.thread) then
    raise exception 'an edit is of its own author''s post, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  -- A poll is of a post (or a spin) of its own character's, in its thread; a ballot and a close are of a poll, in its thread; an author's close is by the poll's own character.
  if new.kind = 'poll' and (not post_kind(t.kind) or t.character is distinct from new.character or t.thread <> new.thread) then
    raise exception 'a poll is of its own author''s post, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind in ('ballot', 'poll_close') and (t.kind <> 'poll' or t.thread <> new.thread) then
    raise exception 'a % is of a poll, in its thread', new.kind using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'poll_close' and new.character is not null and new.character is distinct from t.character then
    raise exception 'a poll is closed by its own author or by an admin' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.kind = 'card' and not post_kind(t.kind) then
    raise exception 'a card lands on a post' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  -- A card set face down is its post's own author's, in the post's thread; a spring is its set's author's, on the set's post.
  if new.kind = 'set' and (not post_kind(t.kind) or t.character <> new.character or t.thread <> new.thread) then
    raise exception 'a card is set face down on a post of its own author''s, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'spring' and (not post_kind(t.kind) or t.thread <> new.thread or not exists (
       select 1 from acts s where s.id::text = new.payload ->> 'set' and s.kind = 'set' and s.target_act_id = t.id and s.character = new.character)) then
    raise exception 'a spring is of a card set face down on its post, by the one who set it' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  -- A take-back is of a card set face down on the post it is on, by the one who set it, in the post's thread, while the back is live as of the take-back: not sprung, not taken back before (acts_one_take_back
  -- holds that), and not past its time. The card's own account is read from face_down, never named in the Act.
  if new.kind = 'take_back' and (not post_kind(t.kind) or t.thread <> new.thread or not exists (
       select 1 from acts s join face_down f on f.play = s.id
       where s.id::text = new.payload ->> 'set' and s.kind = 'set' and s.target_act_id = t.id and s.character = new.character and f.ends_at > new.created_at
         and not exists (select 1 from acts p where p.kind = 'spring' and (p.payload ->> 'set') = s.id::text))) then
    raise exception 'a take-back is of a live card set face down on its post, by the one who set it' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  -- A gift is on a drive's opening play, in the play's thread: a card play whose card has a drive and whose payload names the play as its own drive. Whether the drive is still open and the amounts are donate's to say.
  if new.kind = 'donation' and (t.kind <> 'card' or t.thread <> new.thread or t.payload ->> 'drive' is distinct from t.id::text
       or not exists (select 1 from card_kinds ck where ck.key = t.payload ->> 'card' and ck.drive is not null)) then
    raise exception 'a gift is to a drive, the first play of a drive card' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  -- A draw or a wash is of a surface card's play that landed, in its thread; a wash is by the character that wrote the post under it.
  if new.kind in ('draw', 'wash') and (t.kind <> 'card' or t.thread <> new.thread or t.payload ? 'caught'
       or not exists (select 1 from card_kinds ck where ck.key = t.payload ->> 'card' and ck.surface) or not exists (select 1 from surfaces s where s.play = t.id)) then
    raise exception 'a % is of a surface card''s play, in its thread', new.kind using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'wash' and new.character is distinct from (select p.character from acts p where p.id = t.target_act_id) then
    raise exception 'a wash is by the post''s own character' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.kind <> 'edit' and t.kind = 'edit' then
    raise exception 'an edit is not answered; answer the post' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  return new;
end $function$;

-- ===================================================================================== 6. the writers ====

-- The latest poll Act on a post, by (created_at, id): the post's current poll unless it is a removal. Null for a post that never had one. Volatile on purpose: each caller reads it after taking the post's row, and a volatile
-- function takes a snapshot of its own, so a poll an edit committed while the caller waited for that row is seen. For no API role.
create function latest_poll(on_post uuid) returns uuid
language sql security definer set search_path = public, pg_temp as $$
  select a.id from acts a where a.kind = 'poll' and a.target_act_id = on_post order by a.created_at desc, a.id desc limit 1
$$;
revoke execute on function latest_poll(uuid) from public, anon, authenticated;

-- Whether a ballot's poll is secret, read by the ballot's `target_act_id`. acts_public calls it once for each ballot row it projects and for no other Act (the call is the branch of a CASE on the Act's kind). Definer, since a function's
-- body runs as the session's user, which reads no `payload`. A view's functions run as its reader, so the readers of acts_public may run it (as they run conceal_layer and quote_hidden): whether a poll is secret is a public fact of the poll,
-- the same for any id, and the answer names no one.
create function ballot_secret(poll uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select (p.payload ->> 'secret')::boolean from acts p where p.id = ballot_secret.poll and p.kind = 'poll'), false)
$$;
revoke execute on function ballot_secret(uuid) from public, anon;
grant execute on function ballot_secret(uuid) to authenticated, kayfabb_digest;

-- poll_written (on_post, through, draft): writes the poll Act of a post that is written in this transaction or is the caller's own, after checking the draft {question, options, pick, secret, lasts} against the settings; the writers
-- post, start_thread and edit_post call it, and no API role does. Each refusal names the predicate that failed. The options are stored as given: two are one when they are equal after trimming, and no player's words are rewritten.
-- It closes at now() plus `lasts`, which is an interval string or a span object, within pollLastsMin and pollLastsMax. Returns the poll's id.
create function poll_written(on_post uuid, through uuid, draft jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  most integer := (setting('pollOptionsMax'))::integer;
  lo jsonb := setting('pollLastsMin');
  hi jsonb := setting('pollLastsMax');
  q text := case when jsonb_typeof(draft -> 'question') = 'string' then draft ->> 'question' end;
  opts jsonb := draft -> 'options';
  n integer;
  o text;
  seen text[] := '{}';
  picked integer;
  lasts interval;
  in_thread uuid;
  made uuid;
begin
  perform within('question', q, 'pollQuestionMax');
  if jsonb_typeof(opts) is distinct from 'array' or jsonb_array_length(opts) not between 2 and most then
    raise exception 'a poll has 2 to % options', most using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  n := jsonb_array_length(opts);
  for o in select case when jsonb_typeof(e.v) = 'string' then e.v #>> '{}' end from jsonb_array_elements(opts) with ordinality e(v, i) order by e.i loop
    perform within('option', o, 'pollOptionMax');
    if btrim(o) = any (seen) then raise exception 'no two options are the same' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    seen := seen || btrim(o);
  end loop;
  if jsonb_typeof(draft -> 'pick') is distinct from 'number' or (draft ->> 'pick')::numeric <> trunc((draft ->> 'pick')::numeric) or (draft ->> 'pick')::numeric not between 1 and n then
    raise exception 'a poll lets 1 to % options be picked', n using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if jsonb_typeof(draft -> 'secret') is distinct from 'boolean' then
    raise exception 'a poll''s ballots are public or secret' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  picked := (draft ->> 'pick')::integer;
  begin
    lasts := case jsonb_typeof(draft -> 'lasts') when 'string' then (draft ->> 'lasts')::interval when 'object' then span_interval(draft -> 'lasts') end;
  exception when others then lasts := null;
  end;
  if lasts is null or lasts < span_interval(lo) or lasts > span_interval(hi) then
    raise exception 'a poll lasts from % to %', span_words(lo), span_words(hi) using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  select a.thread into in_thread from acts a where a.id = on_post;
  insert into acts (character, kind, thread, target_act_id, payload)
  values (through, 'poll', in_thread, on_post,
          jsonb_build_object('question', q, 'options', opts, 'pick', picked, 'secret', (draft ->> 'secret')::boolean, 'closes_at', now() + lasts))
  returning id into made;
  return made;
end $$;
revoke execute on function poll_written(uuid, uuid, jsonb) from public, anon, authenticated;

-- ===================================================================================== 7. the reads ====
-- poll_counts: one row per poll Act (a removal is no poll): {poll, counts, voters, ends_at, closed}, from each character's counted ballot (its latest created before the poll's end) through acts_ballots. `counts` has one entry for each
-- option (the counted ballots that pick it), `voters` is the characters whose counted ballot picks anything. It counts characters and reads no owner, so it is the same for every caller. Owner rights, as acts_public has.
create view poll_counts as
  select p.id as poll, c.counts, c.voters, e.ends_at, now() >= e.ends_at as closed
  from acts p
  cross join lateral (
    select least((p.payload ->> 'closes_at')::timestamptz, coalesce((select min(x.created_at) from acts x where x.kind = 'poll_close' and x.target_act_id = p.id), 'infinity')) as ends_at
  ) e
  cross join lateral (
    with counted as (
      select distinct on (b."character") b.payload -> 'picks' as picks
      from acts b
      where b.kind = 'ballot' and b.target_act_id = p.id and b.created_at < e.ends_at
      order by b."character", b.created_at desc, b.id desc)
    select array(select (select count(*) from counted k where k.picks @> to_jsonb(g.i))::integer
                 from generate_series(0, jsonb_array_length(p.payload -> 'options') - 1) g(i) order by g.i) as counts,
           (select count(*) from counted k where jsonb_array_length(k.picks) > 0)::integer as voters
  ) c
  where p.kind = 'poll' and not (p.payload ? 'removed');
revoke all on poll_counts from public, anon, authenticated, service_role;
grant select on poll_counts to authenticated;

-- The caller's own ballots, with the character and the picks of a secret one too: the player's own fact, as my_veiled_posts gives the author's. Owner rights, filtered by auth.uid() as my_reactions is (0018).
create view my_ballots as
  select b.id as act, b.target_act_id as poll, b."character" as character, b.payload -> 'picks' as picks, b.created_at
  from acts b
  where b.kind = 'ballot' and b."character" in (select c.id from characters c where c.owner = auth.uid());
revoke all on my_ballots from public, anon, authenticated, service_role;
grant select on my_ballots to authenticated;


-- post (0142), also taking `poll`, a draft for the post's own poll, written after the post's insert. The old signature is dropped so no call is ambiguous. Everything else as 0142 wrote it, its lock order included.
drop function post(uuid, uuid, text, uuid, uuid[]);
CREATE OR REPLACE FUNCTION public.post(in_thread uuid, through uuid, body text, quoting uuid DEFAULT NULL::uuid, framing uuid[] DEFAULT '{}'::uuid[], poll jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  on_board uuid;
  written uuid;
  sprung jsonb;
  locked uuid[];
begin
  perform acting(through);
  perform not_banned(through);
  perform within('body', body, 'postMaxLength');
  select board into on_board from threads where id = in_thread;
  if on_board is null then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform not_the_systems(on_board);
  perform not_barred(through, on_board);
  if quoting is not null and not exists (select 1 from acts where id = quoting) then raise exception 'there is no such Act to quote' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- Steps 3 to 5 of the lock order, for the quoted post's back (lock_for_quote).
  locked := lock_for_quote(through, in_thread, quoting);
  insert into acts (character, kind, thread, target_act_id, payload)
  values (through, 'post', in_thread, quoting, jsonb_build_object('body', body)) returning id into written;
  if poll is not null then perform poll_written(written, through, poll); end if;
  -- Only a back this post locked springs (spring_traps' `held`).
  if quoting is not null then sprung := spring_traps('quote', quoting, written, held => locked); end if;
  if quoting is not null then perform write_alert((select a.character from acts a where a.id = quoting), 'quote', null, written, auth.uid()); end if;
  perform write_framed(body, framing, written, auth.uid());
  perform draw_visits(written);
  return act_projection(written) || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $function$;
revoke execute on function post(uuid, uuid, text, uuid, uuid[], jsonb) from public, anon;
grant execute on function post(uuid, uuid, text, uuid, uuid[], jsonb) to authenticated;

-- start_thread (0326), also taking `poll`, as post does. Everything else as 0326 wrote it.
drop function start_thread(text, uuid, text, text, uuid[]);
CREATE OR REPLACE FUNCTION public.start_thread(board_slug text, through uuid, title text, body text, framing uuid[] DEFAULT '{}'::uuid[], poll jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  on_board uuid;
  made uuid;
  written uuid;
begin
  perform acting(through);
  perform not_banned(through);
  perform within('title', title, 'titleMaxLength');
  perform within('body', body, 'postMaxLength');
  select id into on_board from boards where slug = board_slug;
  if on_board is null then raise exception 'there is no such board' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform not_the_systems(on_board);
  -- Shared, and in a statement before the check, so the check's snapshot is made once a closing move on this board has committed (or none is open): the thread is never stored on a board that is closing.
  perform lock_board_start(on_board);
  perform not_closed(on_board);
  perform not_barred(through, on_board);
  insert into threads (board, title) values (on_board, title) returning id into made;
  insert into acts (character, kind, thread, payload) values (through, 'post', made, jsonb_build_object('body', body)) returning id into written;
  if poll is not null then perform poll_written(written, through, poll); end if;
  perform write_framed(body, framing, written, auth.uid());
  perform draw_visits(written);
  return jsonb_build_object('thread', thread_projection(made), 'act', act_projection(written));
end $function$;
revoke execute on function start_thread(text, uuid, text, text, uuid[], jsonb) from public, anon;
grant execute on function start_thread(text, uuid, text, text, uuid[], jsonb) to authenticated;

-- edit_post (0130), also taking `poll`: null keeps the post's poll, an object sets one (a new poll Act, which replaces the old), {"removed": true} removes it. Setting or removing takes the post `for no key update` before
-- anything else is read, so the edit meets a ballot's `for share` at the post, and is refused, in one sentence, when the post's current poll has any ballot (a poll cannot change once a ballot is cast; the words still edit, and
-- the poll can still be closed), and when the current poll is closed ('a closed poll cannot change'). A removal on a post with no poll writes nothing. Everything else as 0130 wrote it.
drop function edit_post(uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.edit_post(target uuid, through uuid, body text, poll jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  in_thread uuid;
  on_board uuid;
  current_poll uuid;
begin
  if poll is not null then perform 1 from acts a where a.id = target and a.kind = 'post' and a.character = through for no key update; end if;
  perform acting(through);
  perform not_banned(through);
  perform within('body', body, 'postMaxLength');
  select a.thread, t.board into in_thread, on_board from acts a join threads t on t.id = a.thread where a.id = target and a.kind = 'post' and a.character = through;
  if in_thread is null then raise exception 'that is not a post of this character''s' using hint = 'kayfabb.refusal', errcode = '42501'; end if;
  perform not_barred(through, on_board);
  if poll is not null then
    current_poll := latest_poll(target);
    if current_poll is not null and exists (select 1 from acts b where b.kind = 'ballot' and b.target_act_id = current_poll) then
      raise exception 'a poll cannot change once a ballot is cast; you can still close it' using hint = 'kayfabb.refusal', errcode = '55000';
    end if;
    -- A closed poll is final, with ballots or none: its time has passed or it was closed, and it can no longer be replaced or removed (a post whose poll was removed, or never had one, takes a new poll as before).
    if current_poll is not null and exists (
         select 1 from acts p where p.id = current_poll and not (p.payload ? 'removed')
           and now() >= least((p.payload ->> 'closes_at')::timestamptz, coalesce((select min(x.created_at) from acts x where x.kind = 'poll_close' and x.target_act_id = p.id), 'infinity'))) then
      raise exception 'a closed poll cannot change' using hint = 'kayfabb.refusal', errcode = '55000';
    end if;
  end if;
  insert into acts (character, kind, thread, target_act_id, payload) values (through, 'edit', in_thread, target, jsonb_build_object('body', body));
  if poll = '{"removed": true}'::jsonb then
    if current_poll is not null and not exists (select 1 from acts p where p.id = current_poll and p.payload ? 'removed') then
      insert into acts (character, kind, thread, target_act_id, payload) values (through, 'poll', in_thread, target, '{"removed": true}');
    end if;
  elsif poll is not null then
    perform poll_written(target, through, poll);
  end if;
  return act_projection(target);
end $function$;
revoke execute on function edit_post(uuid, uuid, text, jsonb) from public, anon;
grant execute on function edit_post(uuid, uuid, text, jsonb) to authenticated;

-- cast_ballot (poll, through, picks): one ballot of a character's on a poll. It runs the gates post runs for a character writing in a thread (acting, not_banned, not_the_systems, not_barred), takes the poll's post `for share` first (so
-- it meets an edit's lock: POST, THEN CHARACTER), reads the post's current poll after the wait, and refuses a poll that is replaced or removed ("that poll was replaced"), one that is closed ("that poll has closed") and picks that are out of
-- range, repeated or more than the poll lets ("pick up to N options"). The picks are stored sorted; none at all is a withdrawal. It answers with the ballot's projection (which on a secret poll names no one), the poll's id and thread,
-- and the poll's counts: the shape of the event the act function sends, built from this answer and never from the request. Every refusal reads the poll, the picks and the caller's own character.
create function cast_ballot(poll uuid, through uuid, picks integer[]) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p acts%rowtype;
  on_board uuid;
  n integer;
  most integer;
  ends timestamptz;
  sorted integer[];
  made uuid;
  c poll_counts%rowtype;
begin
  perform acting(through);
  select * into p from acts a where a.id = cast_ballot.poll and a.kind = 'poll' and not (a.payload ? 'removed');
  if p.id is null then raise exception 'there is no such poll' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- The post first (the lock order is post, then visits_open, then character): an edit that replaces the poll holds it `for no key update`, and this waits for it and reads the poll as the edit left it.
  perform 1 from acts a where a.id = p.target_act_id for share;
  perform not_banned(through);
  select t.board into on_board from threads t where t.id = p.thread;
  perform not_the_systems(on_board);
  perform not_barred(through, on_board);
  if latest_poll(p.target_act_id) is distinct from p.id then raise exception 'that poll was replaced' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  ends := least((p.payload ->> 'closes_at')::timestamptz, coalesce((select min(x.created_at) from acts x where x.kind = 'poll_close' and x.target_act_id = p.id), 'infinity'));
  if now() >= ends then raise exception 'that poll has closed' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  n := jsonb_array_length(p.payload -> 'options');
  most := (p.payload ->> 'pick')::integer;
  if picks is null or cardinality(picks) > most or exists (select 1 from unnest(picks) g where g is null or g < 0 or g >= n)
     or (select count(distinct g) from unnest(picks) g) <> cardinality(picks) then
    raise exception 'pick up to % option%', most, case when most = 1 then '' else 's' end using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  sorted := array(select g from unnest(picks) g order by g);
  insert into acts (character, kind, thread, target_act_id, payload)
  values (through, 'ballot', p.thread, p.id, jsonb_build_object('picks', to_jsonb(sorted))) returning id into made;
  select * into c from poll_counts k where k.poll = p.id;
  return jsonb_build_object('act', act_projection(made), 'poll', p.id, 'thread', p.thread, 'counts', to_jsonb(c.counts), 'voters', c.voters, 'ends_at', c.ends_at, 'closed', c.closed);
end $$;
revoke execute on function cast_ballot(uuid, uuid, integer[]) from public, anon;
grant execute on function cast_ballot(uuid, uuid, integer[]) to authenticated;

-- poll_close_written (poll, through): the close of a poll, by its character (`through`) or, with no character, by an admin. It refuses what cast_ballot does of a poll (replaced or removed, closed) in the same words, and takes the
-- poll's post `for share` and then the poll's own row `for no key update`, so two closes are laid one at a time and the second is refused. Answers as cast_ballot does. For no API role: close_poll and close_poll_as_admin are the doors.
create function poll_close_written(poll uuid, through uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p acts%rowtype;
  ends timestamptz;
  made uuid;
  c poll_counts%rowtype;
begin
  select * into p from acts a where a.id = poll_close_written.poll and a.kind = 'poll' and not (a.payload ? 'removed');
  if p.id is null then raise exception 'there is no such poll' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if through is not null and p.character is distinct from through then
    raise exception 'only a poll''s author can close it' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  perform 1 from acts a where a.id = p.target_act_id for share;
  perform 1 from acts a where a.id = p.id for no key update;
  if latest_poll(p.target_act_id) is distinct from p.id then raise exception 'that poll was replaced' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  ends := least((p.payload ->> 'closes_at')::timestamptz, coalesce((select min(x.created_at) from acts x where x.kind = 'poll_close' and x.target_act_id = p.id), 'infinity'));
  if now() >= ends then raise exception 'that poll has closed' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  insert into acts (character, kind, thread, target_act_id, payload)
  values (through, 'poll_close', p.thread, p.id, jsonb_build_object('by', case when through is null then 'admin' else 'author' end)) returning id into made;
  select * into c from poll_counts k where k.poll = p.id;
  return jsonb_build_object('act', act_projection(made), 'poll', p.id, 'thread', p.thread, 'counts', to_jsonb(c.counts), 'voters', c.voters, 'ends_at', c.ends_at, 'closed', c.closed);
end $$;
revoke execute on function poll_close_written(uuid, uuid) from public, anon, authenticated;

-- close_poll (poll, through): the poll's own character, played by the caller, closes it early. Its way out for an author who wants it over; a banned or barred character may still close what it wrote.
create function close_poll(poll uuid, through uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform acting(through);
  return poll_close_written(close_poll.poll, through);
end $$;
revoke execute on function close_poll(uuid, uuid) from public, anon;
grant execute on function close_poll(uuid, uuid) to authenticated;

-- close_poll_as_admin (poll): an admin closes any poll; the Act has no character and says it is an admin's.
create function close_poll_as_admin(poll uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform only_admins('closes a poll');
  return poll_close_written(close_poll_as_admin.poll, null);
end $$;
revoke execute on function close_poll_as_admin(uuid) from public, anon;
grant execute on function close_poll_as_admin(uuid) to authenticated;

-- ===================================================================================== 8. acts_public ====
-- acts_public (0371), a ballot whose poll is secret projecting a null character and {"secret": true} as its payload and current_payload, for every reader alike. A third select takes the secret ballots alone, with a null character (a constant, so a predicate on `character`, as a profile's
-- latest Acts ask it (0036-bounded-reads.sql), drops the whole branch, and in the other two still reaches acts_character), and the first two leave a secret ballot out in their `ok` (the call is the second term of an AND on the Act's kind, so no other
-- Act asks). Each select carries a column `secret` the outer select applies to the payload. The three selects read `acts` alone with no WHERE and no join of their own, so the union stays one appendrel. Everything else as 0371 wrote it.
create or replace view acts_public as
  select u.id, u."character", u.kind, u.thread, u.target_act_id, u.seq, u.created_at,
         shown_payload(case when u.secret then '{"secret": true}'::jsonb else u.payload end, h.own, co.refs, co.ready, co.body) as payload,
         shown_payload(coalesce(e.payload, case when u.secret then '{"secret": true}'::jsonb else u.payload end), h.cur, coalesce(cc.refs, co.refs), coalesce(cc.ready, co.ready), coalesce(cc.body, co.body)) as current_payload,
         e.created_at as edited_at,
         case when e.created_at > u.created_at + coalesce(span_interval((select g.value from settings g where g.key = 'editGrace')), interval '0')
           then e.created_at end as shown_edited_at,
         case when u.kind = 'card' then exists (select 1 from card_write_refunds r where r.play = u.id) end as untaken,
         case when u.kind = 'set' then (select f.ends_at from face_down f where f.play = u.id) end as ends_at,
         h.cur as hidden,
         u.kind = 'post' and quote_hidden(u.id) as any_hidden,
         not h.cur and coalesce(cc.refs, co.refs) and not coalesce(cc.ready, co.ready) as concealing,
         h.own as payload_hidden,
         not h.own and co.refs and not co.ready as payload_concealing
  from (
    select a.id, a."character" as "character", a.kind, a.thread, a.target_act_id, a.seq, a.created_at, a.payload,
           true as g, (not exists (select 1 from post_veil_cover c join post_veils_live v on v.play = c.play and v.veil = 'author' where c.act = a.id) and not (a.kind = 'ballot' and ballot_secret(a.target_act_id))) as ok, false as secret
    from acts a
    union all
    select a.id, (select k.id from characters k where k.staff_kind = 'anonymous') as "character", a.kind, a.thread, a.target_act_id, a.seq, a.created_at, a.payload,
           true as g, (exists (select 1 from post_veil_cover c join post_veils_live v on v.play = c.play and v.veil = 'author' where c.act = a.id) and not (a.kind = 'ballot' and ballot_secret(a.target_act_id))) as ok, false as secret
    from acts a
    union all
    select a.id, null::uuid as "character", a.kind, a.thread, a.target_act_id, a.seq, a.created_at, a.payload,
           true as g, (a.kind = 'ballot' and ballot_secret(a.target_act_id)) as ok, true as secret
    from acts a
  ) u
  left join lateral (
    select x.id, x.payload, x.created_at from acts x
    where x.kind = 'edit' and x.target_act_id = u.id
    order by x.created_at desc, x.id desc limit 1
  ) e on u.kind = 'post'
  cross join lateral (
    select o.own, case when e.id is null then o.own else version_hidden(e.id, u.id) end as cur
    from (select u.kind in ('post', 'edit') and version_hidden(u.id, case when u.kind = 'edit' then u.target_act_id else u.id end) as own) o
  ) h
  cross join lateral conceal_layer(u.id) co
  left join lateral conceal_layer(e.id) cc on e.id is not null
  where u.g and u.ok;

-- ===================================================================================== 9. the veil ====
-- post_veils_cover (0371), also covering the ballots and closes the veiled post's author wrote on the post's polls before the veil landed (the second and third unions: acts_ballots and acts_one_poll_close hold each by key). The poll
-- itself targets the post, so the author's Acts the first selects read already cover it. Everything else as 0371 wrote it.
create or replace function post_veils_cover() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform veil_cover_lock(new.post);
  insert into post_veil_cover (act, play)
  select new.post, new.play
  union
  -- The author's Acts on the post, in two selects so that each reaches an index of its own: acts_target is partial (kind <> 'edit') and acts_edits holds the edits (kind = 'edit'); one select over both is a scan of the author's Acts.
  select a.id, new.play from acts a
  where a.target_act_id = new.post and a.character = new.author and a.kind not in ('post', 'spin', 'edit')
  union
  select a.id, new.play from acts a
  where a.target_act_id = new.post and a.character = new.author and a.kind = 'edit'
  union
  select d.id, new.play from acts k join acts d on d.target_act_id = k.id
  where k.kind = 'card' and k.target_act_id = new.post and d.kind in ('draw', 'wash') and d.character = new.author
  union
  select b.id, new.play from acts p join acts b on b.target_act_id = p.id and b.kind = 'ballot' and b."character" = new.author
  where p.kind = 'poll' and p.target_act_id = new.post
  union
  select k.id, new.play from acts p join acts k on k.target_act_id = p.id and k.kind = 'poll_close' and k."character" = new.author
  where p.kind = 'poll' and p.target_act_id = new.post
  union
  select c.card, new.play from post_veil_cards c where c.post = new.post and c.author = new.author
  on conflict do nothing;
  return null;
end $$;

-- acts_veil_cover (0371), a ballot or a close read through its poll to the post: the post's live author veils cover the veiled author's own ballot and its own close as they cover its other Acts on the post. Everything else as 0371 wrote it.
create or replace function acts_veil_cover() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  tgt record;
  pst uuid;
  pc uuid;
begin
  select t.id, t.kind, t.target_act_id into tgt from acts t where t.id = new.target_act_id;
  if new.kind in ('draw', 'wash') and tgt.kind = 'card' then pst := tgt.target_act_id;
  elsif new.kind in ('ballot', 'poll_close') and tgt.kind = 'poll' then pst := tgt.target_act_id;
  else pst := tgt.id; end if;
  select a.character into pc from acts a where a.id = pst;
  if pc is not null and pc = new.character then
    perform veil_cover_lock(pst);
    insert into post_veil_cover (act, play)
    select new.id, v.play from post_veils v
    where v.post = pst and v.veil = 'author' and v.author = new.character and v.ends_at > now()
    on conflict do nothing;
  end if;
  return null;
end $$;

-- ===================================================================================== 10. the guards ====
-- react (0359), refusing a reaction to a poll, a ballot or a close: reactions go to the post. Everything else as 0359 wrote it, its lock order included.
CREATE OR REPLACE FUNCTION public.react(target uuid, through uuid, reaction text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  caller uuid := auth.uid();
  cap integer := (setting('reactionCap'))::integer;
  target_kind text;
  author_owner uuid;
  held text[];
  free_slot integer;
  local_play uuid;
begin
  if caller is null then raise exception 'sign in to react' using hint = 'kayfabb.refusal', errcode = '28000'; end if;
  perform played_by(through, caller);
  perform not_banned(through);
  if not exists (select 1 from reaction_kinds k where k.key = reaction) then
    -- Not one of the instance's: it may be one a card added to this post (its key starts with `x-`; one probe of post_reaction_kinds, found by its primary key).
    if reaction like 'x-%' then select p.play into local_play from post_reaction_kinds p where p.post = target and p.key = reaction; end if;
    if local_play is null then
      raise exception 'there is no reaction "%"', reaction using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    if card_ended(local_play) then
      raise exception 'that reaction is no longer offered on this post' using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
  end if;
  -- The System's own Acts (a tally, the reveal) have no author, and no author's owner to hold the
  -- caller apart from: they are reacted to like any Act, and pay nobody (settle.ts).
  select a.kind, c.owner into target_kind, author_owner
  from acts a left join characters c on c.id = a.character where a.id = target;
  if target_kind is null then
    raise exception 'there is no such Act' using hint = 'kayfabb.refusal', errcode = 'P0002';
  end if;
  if target_kind = 'edit' then raise exception 'an edit is not reacted to; react to the post' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if target_kind in ('poll', 'ballot', 'poll_close') then raise exception 'a poll is not reacted to; react to the post' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  -- A gift is no one's to react to (design, section 5): it earns nothing, and settlement and the estimate leave it out.
  if target_kind = 'donation' then raise exception 'a gift cannot be reacted to' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  -- The author's owner now: a character changing hands is not in this slice, and the session
  -- that adds it decides what becomes of reactions between its old and new owner's characters.
  if author_owner = caller then
    raise exception 'your characters cannot react to each other' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;

  select coalesce(array_agg(r.kind order by r.slot), '{}') into held
  from reactions r where r.act = target and r.reactor_account = caller;
  -- The lowest free slot, so a slot given back (a reaction removed, later) is taken again rather
  -- than colliding for ever. The slot only makes two reactions at once collide; the cap is held
  -- by the count above, so lowering reactionCap later leaves existing reactions as they are.
  select min(g) into free_slot from generate_series(1, cardinality(held) + 1) g
  where not exists (select 1 from reactions r where r.act = target and r.reactor_account = caller and r.slot = g);
  if reaction = any (held) then
    raise exception 'you have already left that reaction here' using hint = 'kayfabb.refusal', errcode = '23505';
  end if;
  if cardinality(held) >= cap then
    raise exception 'you have left % reactions here, the most there are', cap using hint = 'kayfabb.refusal', errcode = '23514';
  end if;

  begin
    insert into reactions (act, reactor_character, reactor_account, kind, slot)
    values (target, through, caller, reaction, free_slot);
  exception when unique_violation then
    -- Another reaction of this player's landed between the read above and this write.
    raise exception 'you reacted here twice at once; try again' using hint = 'kayfabb.refusal', errcode = '40001';
  end;
  insert into reaction_tallies (act, kind, count) values (target, reaction, 1)
  on conflict (act, kind) do update set count = reaction_tallies.count + 1;
  -- A reaction springs nothing: who reacted is a private fact, so no card lands on or by it (face-down Moves, design section 2).

  return jsonb_build_object('act', target, 'thread', (select thread from acts where id = target),
    'tally', case when exists (select 1 from post_veils_live v where v.post = target and v.veil = 'totals') then null
                  else (select coalesce(jsonb_object_agg(t.kind, t.count order by t.kind), '{}') from reaction_tallies t where t.act = target) end);
end $function$;

-- spin_written (0374), refusing a spin of a close ("spin the poll"), of a poll that is replaced or removed ("that poll was replaced") and of a secret ballot ("a secret ballot cannot be spun": the spin's head would have no one to name).
-- A spin of the poll itself or of a public ballot is written. Public facts only, the same words for every caller. Everything else as 0374 wrote it.
create or replace function public.spin_written(origin uuid, through uuid, title text, body text, check_bar boolean, framing uuid[], at_post uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  on_board uuid;
  made uuid;
  written uuid;
  o record;
begin
  perform within('title', title, 'titleMaxLength');
  perform within('body', coalesce(body, ''), 'postMaxLength', true);
  select case when b.is_system then players_board() else b.id end into on_board
  from acts a join threads t on t.id = a.thread join boards b on b.id = t.board where a.id = origin and a.kind <> 'edit';
  if on_board is null then raise exception 'there is no such Act to spin from' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  select a.id, a.kind, a.payload, a.target_act_id into o from acts a where a.id = origin;
  if o.kind = 'poll_close' then raise exception 'spin the poll' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if o.kind = 'poll' and (o.payload ? 'removed' or latest_poll(o.target_act_id) is distinct from o.id) then
    raise exception 'that poll was replaced' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if o.kind = 'ballot' and ballot_secret(o.target_act_id) then raise exception 'a secret ballot cannot be spun' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  -- The post a spin is pressed at: a post by the character a landed, live play was cast on. Public facts only; one sentence for every predicate that fails.
  if at_post is not null then
    if not exists (
      select 1 from acts k join play_reach r on r.play = k.id join acts p on p.id = at_post
      where k.id = origin and k.kind = 'card' and not (k.payload ? 'caught')
        and r.reach = 'character' and post_kind(p.kind) and shown_author(p.id, p.character) = r.character
        and r.ends_at > now()
        and not exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = k.id)
    ) then raise exception 'that card is not on that post' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  end if;
  if check_bar then perform not_barred(through, on_board); end if;
  insert into threads (board, title, origin_act_id) values (on_board, title, origin) returning id into made;
  insert into acts (character, kind, thread, target_act_id, payload)
  values (through, 'spin', made, origin,
          jsonb_build_object('title', title, 'body', coalesce(body, '')) || case when at_post is not null then jsonb_build_object('at', at_post) else '{}'::jsonb end)
  returning id into written;
  perform write_framed(body, framing, written, auth.uid());
  perform draw_visits(written);
  return jsonb_build_object('thread', thread_projection(made), 'act', act_projection(written));
end $function$;

-- settlement_input (0378) and estimate_input (0378): a poll, a ballot and a close are not in a settlement's Acts. They pay no Aura, are no source of any, and are no one's to settle: `win_acts` leaves out all three kinds, as it leaves out
-- a gift (a donation). Everything else as 0378 wrote it.
create or replace function settlement_input(window_start timestamptz, window_end timestamptz) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with
  -- The plays an admin ended before the window's end (Task 3): out of this window, with the votes on them. `<` as every other bound
  -- here is, so a card_end written at the instant window_end is after the window, as a vote written then is.
  ended as (select e.target_act_id as id from acts e where e.kind = 'card_end' and e.created_at < window_end),
  -- Every live Earn Gimmick play still up when the window opens, played before it (a play inside it is a window Act already): settle.ts boosts only with the play in the input, and an Earn play of an earlier window
  -- is still up in this one. Live is not ended by an admin, not caught, and ending after the window's start; found by creation time, a window of the longest Earn `lasts` before the window, and each comes with its post.
  earn_up as (
    select k.id, case when coalesce(k.payload ->> 'reach', 'post') = 'post' then k.target_act_id end as post
    from acts k join card_kinds ck on ck.key = k.payload ->> 'card'
    where k.kind = 'card' and ck.gimmick ->> 'kind' in ('earn', 'cushion')
      and k.created_at < window_start and k.created_at >= window_start - (select max(e.lasts) from card_kinds e where e.gimmick ->> 'kind' in ('earn', 'cushion'))
      and coalesce(k.payload ->> 'reach', 'post') in ('post', 'character') and not (k.payload ? 'caught')
      and (k.payload ->> 'ends')::timestamptz > window_start and k.id not in (select id from ended)),
  -- The System's own Acts (the reveal) are no character's, and nobody's to settle; a staff character's
  -- are The System's too (0043): staff earn nothing, and a card on a staff Act is nobody's to score.
  -- A gift (a donation) is no one's to settle (design, section 5): it earns nothing, is never counted as posting or in the halving, and is no one's reaction to count. It is left out here, of the window's Acts and of
  -- the reactions to one; `all_acts` leaves it out once more, since an Act a reaction touched is read whatever its kind.
  win_acts as (select * from acts a where a.created_at >= window_start and a.created_at < window_end and a.character is not null and a.kind <> 'donation' and a.kind not in ('poll', 'ballot', 'poll_close')
               and not is_staff_side(a.character, a.kind, a.target_act_id) and a.id not in (select id from ended)),
  win_reactions as (select * from reactions r where r.created_at >= window_start and r.created_at < window_end and r.act not in (select id from ended)
                    and not exists (select 1 from acts d where d.id = r.act and d.kind = 'donation')),
  reacted as (select distinct act from win_reactions),
  -- What each play of the window is scored against (0378): the Act a card or a spring lies on, and the cast a spring caught (`by`). A class's rule reads how the room took that Act (engine/rules/settle.ts, targetLean), and a
  -- reaction before the window counts as much as one inside it, so the Act's earlier reactions are sent whether or not a reaction reached it today. One probe by Act for each play of the window, never a scan of reactions.
  scored as (
    select a.target_act_id as id from win_acts a where a.kind in ('card', 'spring') and a.target_act_id is not null and coalesce(a.payload ->> 'reach', 'post') = 'post'
    union
    select (a.payload ->> 'by')::uuid from win_acts a where a.kind = 'spring' and a.payload ->> 'by' is not null),
  -- Only what a reaction reached is paid (`paid`, below, still joins `reacted`): an earlier reaction on a scored Act is read for the lean and pays nothing.
  earlier_reactions as (select r.* from reactions r join (select act from reacted union select id from scored where id not in (select id from ended)) x on x.act = r.act where r.created_at < window_start),
  -- Every skim play made before the window and still up in it (a play inside it is a window Act already), as earn_up carries Earn plays: live is not ended by an admin, not caught, and ending after the window's start;
  -- found by creation time through acts_card_created, a window of the longest skim `lasts` before the window, and each comes with its post.
  skim_up as (
    select k.id, k.target_act_id as post
    from acts k join card_kinds ck on ck.key = k.payload ->> 'card'
    where k.kind = 'card' and ck.skim is not null and k.target_act_id is not null
      and k.created_at < window_start and k.created_at >= window_start - (select max(s.lasts) from card_kinds s where s.skim is not null)
      and coalesce(k.payload ->> 'reach', 'post') = 'post' and not (k.payload ? 'caught')
      and (k.payload ->> 'ends')::timestamptz > window_start and k.id not in (select id from ended)),
  -- The cards on a post among the Acts reacted to in the window, and what pays on them: the ride springs that rode (acts_spring_by, one probe each), and the ride gimmick plays on the post that were up when the cast was made
  -- (acts_layers, the plays on the post), each with the post. A cast that drew no reaction in the window brings none of them, however many have sprung.
  rc as (select a.id, a.target_act_id as post, a.created_at from acts a join reacted x on x.act = a.id
         where a.kind = 'card' and a.target_act_id is not null and coalesce(a.payload ->> 'reach', 'post') = 'post' and a.id not in (select id from ended)),
  ride_springs as (select s.id from rc join acts s on s.kind = 'spring' and (s.payload ->> 'by') = rc.id::text where s.payload ->> 'did' = 'rode'),
  ride_gimmicks as (
    select g.id from rc
    join acts g on g.target_act_id = rc.post and g.kind = 'card' and coalesce(g.payload ->> 'reach', 'post') = 'post' and g.id <> rc.id
    join card_kinds ck on ck.key = g.payload ->> 'card' and ck.gimmick ->> 'kind' = 'ride'
    where not (g.payload ? 'caught') and g.created_at <= rc.created_at and (g.payload ->> 'ends')::timestamptz > rc.created_at and g.id not in (select id from ended)),
  active_spun as (select distinct t.id from threads t join win_acts a on a.thread = t.id where t.origin_act_id is not null),
  spins as (select a.* from acts a join active_spun t on t.id = a.thread where a.kind = 'spin'),
  first_posts as (
    -- Each character's first post in the thread, read through acts_thread_posts, one per
    -- character rather than a sort of the whole thread.
    select f.* from active_spun t
    cross join lateral (select distinct a.character from acts a where a.thread = t.id and a.kind = 'post' and a.created_at < window_end) w
    cross join lateral (select a.* from acts a where a.thread = t.id and a.character = w.character and a.kind = 'post' and a.created_at < window_end
                        order by a.created_at, a.id limit 1) f
  ),
  touched as (
    select id from win_acts union select act from reacted
    union select id from earn_up union select post from earn_up where post is not null
    union select target_act_id from win_acts where kind in ('card', 'spin', 'spring') and target_act_id is not null and coalesce(payload ->> 'reach', 'post') = 'post'
    union select id from spins union select target_act_id from spins where target_act_id is not null
    -- Every card on an Act a reaction touches, an earlier window's too: a vote counts once per
    -- player and alignment, for the earliest card (engine/rules/settle.ts).
    union select a.id from acts a join reacted x on x.act = a.target_act_id where a.kind in ('card', 'spring') and coalesce(a.payload ->> 'reach', 'post') = 'post'
    union select id from first_posts
    union select id from skim_up union select post from skim_up
    union select id from ride_springs union select id from ride_gimmicks union select post from rc
    union select id from scored
  ),
  all_acts as (select a.* from acts a join touched t on t.id = a.id where a.created_at < window_end and a.character is not null and a.kind <> 'donation'
               and not is_staff_side(a.character, a.kind, a.target_act_id) and a.id not in (select id from ended)),
  -- A staff post a window's card landed on (0054): named with its reactions, so the card is judged against it, and paid nobody. And, since 0378, a staff cast a window spring caught, which `scored` names, so the spring is
  -- judged against it as a card on a post is.
  unscored as (select a.* from acts a join characters c on c.id = a.character
               where c.staff is not null and (a.id in (select k.target_act_id from all_acts k where k.kind = 'card' and k.created_at >= window_start and coalesce(k.payload ->> 'reach', 'post') = 'post')
                                              or a.id in (select id from scored))),
  -- Named, never settled: settle.ts drops a reaction to one, and reads a spin from one as from another.
  system_acts as (select a.id from acts a join touched t on t.id = a.id
                  where (a.character is null or is_staff_side(a.character, a.kind, a.target_act_id)) and a.id not in (select id from unscored)),
  all_reactions as (select * from win_reactions union all select * from earlier_reactions),
  named as (select character as id from all_acts union select reactor_character from all_reactions),
  ms as (select 1)
  select jsonb_build_object(
    'window', jsonb_build_object('id', to_jsonb(window_start) #>> '{}',
      'from', (extract(epoch from window_start) * 1000)::bigint, 'to', (extract(epoch from window_end) * 1000)::bigint),
    'characters', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'player', c.owner, 'classes', coalesce((
        select jsonb_agg(jsonb_build_object('class', h.class_key, 'from', (extract(epoch from h.started_at) * 1000)::bigint) order by h.started_at)
        from class_history h where h.character = c.id and h.started_at < window_end), '[]')) order by c.id)
      from characters c join named n on n.id = c.id), '[]'),
    'acts', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', a.id, 'character', a.character, 'kind', a.kind,
        'at', (extract(epoch from a.created_at) * 1000)::bigint, 'thread', a.thread,
        'target', case when coalesce(a.payload ->> 'reach', 'post') = 'post' then a.target_act_id end,
        'reach', case when a.kind = 'card' then nullif(coalesce(a.payload ->> 'reach', 'post'), 'post') end,
        'card', case when a.kind in ('card', 'spring') then a.payload ->> 'card' end,
        'by', case when a.kind = 'spring' then a.payload ->> 'by' end,
        -- A caught play is never in effect (0370): its `ends`, where a row written before 0370 holds one, is not sent, so it boosts and skims nothing.
        'ends', case when a.kind = 'card' and not (a.payload ? 'caught') and (select ck.gimmick is not null or ck.skim is not null from card_kinds ck where ck.key = a.payload ->> 'card')
                     then (extract(epoch from (a.payload ->> 'ends')::timestamptz) * 1000)::bigint end,
        'quadrant', case when a.kind = 'card' and (select ck.skim is not null from card_kinds ck where ck.key = a.payload ->> 'card') then a.payload #>> '{config,quadrant}'
                         when a.kind = 'spring' then a.payload ->> 'quadrant' end,
        'on', case when a.kind = 'card' and a.payload ->> 'reach' = 'character' then a.payload ->> 'character' end)) order by a.created_at, a.id)
      from all_acts a), '[]'),
    -- A staff Act that is a card's play carries its `card` (0378), so a class's rule can tell a cast of a Salty card from any other Act the room reacted to.
    'unscoredTargets', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', a.id, 'kind', a.kind, 'at', (extract(epoch from a.created_at) * 1000)::bigint, 'thread', a.thread, 'staff', true,
        'card', case when a.kind = 'card' then a.payload ->> 'card' end)) order by a.created_at, a.id)
      from unscored a), '[]'),
    'reactions', coalesce((
      select jsonb_agg(jsonb_build_object('act', r.act, 'kind', r.kind, 'at', (extract(epoch from r.created_at) * 1000)::bigint,
        'player', r.reactor_account, 'character', r.reactor_character)
        || case when r.kind like 'x-%' then jsonb_build_object('quadrant', reaction_quadrant(r.act, r.kind)) else '{}'::jsonb end order by r.created_at, r.id)
      from all_reactions r), '[]'),
    -- The System's Acts an input Act points at (a spin from the reveal): named, never settled.
    'systemActs', coalesce((select jsonb_agg(id order by id) from system_acts), '[]'),
    -- The plays that name a class for this window (scored_as_plays), each with its character, its class and the play.
    'scoredAs', coalesce((select jsonb_agg(jsonb_build_object('character', s.character, 'class', s.class_key, 'play', s.play) order by s.character) from scored_as_plays(window_start, window_end) s), '[]'),
    -- What earlier windows paid for every player's vote on each Act this window's reactions touch (section 9).
    'paid', coalesce((
      select jsonb_agg(jsonb_build_object('player', p.account, 'act', p.act, 'weight', p.weight, 'shares', p.shares) order by p.account, p.act)
      from paid_votes p join reacted r on r.act = p.act), '[]'))
$$;
create or replace function estimate_input(account uuid, until timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  salt text := gen_random_uuid()::text;
  window_start timestamptz := coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons));
  season_end timestamptz;
  window_end timestamptz;
  you text := md5(salt || 'you');
begin
  -- The window the next settlement reads begins where next_settlement_window (0004) begins it: at
  -- the last settled end, or, where no season holds that instant (a gap between seasons), at the
  -- next season's start; and it never runs past its season's end.
  if window_start is not null and not exists (select 1 from seasons where starts_at <= window_start and (ends_at is null or ends_at > window_start)) then
    window_start := (select min(starts_at) from seasons where starts_at > window_start);
  end if;
  if window_start is null then return null; end if;
  select coalesce(s.ends_at, nullif(greatest(s.starts_at + span_interval(setting('seasonLength')), window_start), window_start)) into season_end
  from seasons s where s.starts_at <= window_start and (s.ends_at is null or s.ends_at > window_start);
  window_end := least(until, coalesce(season_end, 'infinity'));
  if window_start >= window_end then return null; end if;
  return (
  with
  -- The plays an admin ended before the window's end (Task 3): out of this window, with the votes on them. `<` as every other bound
  -- here is, so a card_end written at the instant window_end is after the window, as a vote written then is.
  ended as (select e.target_act_id as id from acts e where e.kind = 'card_end' and e.created_at < window_end),
  mine as (select id from characters where owner = account),
  -- The live Earn plays on the caller's characters and posts, played before the window and still up in it (settlement_input's earn_up, for what the caller's earnings can carry): another player's play on
  -- the caller's post is a public Act and counts as one of the caller's own.
  earn_up as (
    select k.id, case when coalesce(k.payload ->> 'reach', 'post') = 'post' then k.target_act_id end as post
    from acts k join card_kinds ck on ck.key = k.payload ->> 'card'
    where k.kind = 'card' and ck.gimmick ->> 'kind' in ('earn', 'cushion')
      and k.created_at < window_end and k.created_at >= window_start - (select max(e.lasts) from card_kinds e where e.gimmick ->> 'kind' in ('earn', 'cushion'))
      and coalesce(k.payload ->> 'reach', 'post') in ('post', 'character') and not (k.payload ? 'caught')
      and (k.payload ->> 'ends')::timestamptz > window_start and k.id not in (select id from ended)
      and case when coalesce(k.payload ->> 'reach', 'post') = 'character' then (k.payload ->> 'character')::uuid in (select id from mine)
               else exists (select 1 from acts p join mine m on m.id = p.character where p.id = k.target_act_id) end),
  win_acts as (select a.* from acts a join mine m on m.id = a.character where a.created_at >= window_start and a.created_at < window_end and a.kind <> 'donation' and a.kind not in ('poll', 'ballot', 'poll_close')
               and a.id not in (select id from ended)),
  -- (Task 5) The caller's skim plays made before the window and still up in it, by acts_card_plays (the caller's own plays), with their posts: the posts' reactions are read, as settlement_input reads them.
  skim_up as (
    select k.id, k.target_act_id as post
    from acts k join mine m on m.id = k.character join card_kinds ck on ck.key = k.payload ->> 'card'
    where k.kind = 'card' and ck.skim is not null and k.target_act_id is not null
      and k.created_at < window_start and k.created_at >= window_start - (select max(s.lasts) from card_kinds s where s.skim is not null)
      and coalesce(k.payload ->> 'reach', 'post') = 'post' and not (k.payload ? 'caught')
      and (k.payload ->> 'ends')::timestamptz > window_start and k.id not in (select id from ended)),
  -- The caller's live ride gimmick plays (a Toll on a post of the caller's player's), and the casts one covers on its post that a reaction reached in the window (reactions_window, one probe each); and the caller's ride springs
  -- whose cast a reaction reached in the window (one probe each). Only the caller's own plays lead: a bystander has none, so none of this is in a bystander's input.
  my_gimmicks as (
    select g.id, g.target_act_id as post, g.created_at, (g.payload ->> 'ends')::timestamptz as ends
    from acts g join mine m on m.id = g.character join card_kinds ck on ck.key = g.payload ->> 'card' and ck.gimmick ->> 'kind' = 'ride'
    where g.kind = 'card' and g.target_act_id is not null and coalesce(g.payload ->> 'reach', 'post') = 'post' and not (g.payload ? 'caught')
      and g.created_at < window_end and g.created_at >= window_start - (select max(r.lasts) from card_kinds r where r.gimmick ->> 'kind' = 'ride')
      and (g.payload ->> 'ends')::timestamptz > window_start and g.id not in (select id from ended)),
  rode as (
    select s.id as spring, (s.payload ->> 'by')::uuid as by_cast
    from acts s join mine m on m.id = s.character
    where s.kind = 'spring' and s.payload ->> 'did' = 'rode' and s.id not in (select id from ended)
      and exists (select 1 from reactions r where r.act = (s.payload ->> 'by')::uuid and r.created_at >= window_start and r.created_at < window_end)),
  ride_casts as (
    select c.id from my_gimmicks g join acts c on c.target_act_id = g.post and c.kind = 'card' and coalesce(c.payload ->> 'reach', 'post') = 'post'
    where c.id <> g.id and c.created_at >= g.created_at and c.created_at < g.ends and c.created_at < window_end and c.id not in (select id from ended)
      and exists (select 1 from reactions r where r.act = c.id and r.created_at >= window_start and r.created_at < window_end)
    union select by_cast from rode),
  -- The caller's Acts reacted to in the window, whenever written: each of the caller's Acts, then
  -- its reactions through the index that leads with the Act, never the whole window's reactions.
  mine_reacted as (select distinct a.id as act from acts a join mine m on m.id = a.character
                   where exists (select 1 from reactions r where r.act = a.id and r.created_at >= window_start and r.created_at < window_end)),
  -- The Acts the caller reacted to in the window, through reactions_reactor.
  reacted_by_me as (select distinct r.act from reactions r where r.reactor_account = account and r.created_at >= window_start and r.created_at < window_end),
  targets as (select target_act_id as id from win_acts where kind in ('card', 'spin', 'spring') and target_act_id is not null and coalesce(payload ->> 'reach', 'post') = 'post'),
  -- The casts the caller's window springs caught (settlement_input's `scored`, 0378): a spring is scored against the cast it caught, so the cast's reactions are read. They go through `all_reactions`, `keyed` and
  -- `totals_withheld` as every other does, and nothing here is keyed by who owns the cast or its reactors.
  spring_by as (select (payload ->> 'by')::uuid as id from win_acts where kind = 'spring' and payload ->> 'by' is not null),
  -- Every card of the caller's on a post the caller's window cards point at: a vote counts for the earliest.
  my_cards_there as (select a.id from acts a join mine m on m.id = a.character join targets t on t.id = a.target_act_id where a.kind in ('card', 'spring') and a.created_at < window_end and coalesce(a.payload ->> 'reach', 'post') = 'post'),
  -- Cards others played on the caller's posts in the window.
  landed as (select a.id from acts p join mine m on m.id = p.character join acts a on a.target_act_id = p.id
             where a.kind = 'card' and a.created_at >= window_start and a.created_at < window_end and coalesce(a.payload ->> 'reach', 'post') = 'post'),
  -- The caller's spun threads active in the window: the spin, and each character's first post.
  spun as (select distinct s.thread as id from acts s join mine m on m.id = s.character
           where s.kind = 'spin' and exists (select 1 from acts x where x.thread = s.thread and x.created_at >= window_start and x.created_at < window_end)),
  spins as (select a.id from acts a join spun t on t.id = a.thread where a.kind = 'spin'),
  first_posts as (
    select f.id from spun t
    cross join lateral (select distinct a.character from acts a where a.thread = t.id and a.kind = 'post' and a.created_at < window_end) w
    cross join lateral (select a.id from acts a where a.thread = t.id and a.character = w.character and a.kind = 'post' and a.created_at < window_end
                        order by a.created_at, a.id limit 1) f
  ),
  -- The Acts whose reactions are read.
  voted as (select id from win_acts union select act from mine_reacted union select act from reacted_by_me union select id from targets
            union select post from skim_up union select id from ride_casts union select id from spring_by),
  touched as (
    select id from voted union select id from my_cards_there union select id from landed union select id from spins
    union select id from earn_up union select post from earn_up where post is not null
    union select target_act_id from acts a join spins s on s.id = a.id where a.target_act_id is not null
    union select id from first_posts
    union select id from skim_up union select id from my_gimmicks union select spring from rode
    -- The post each card, spin or spring among the voted Acts points at (Task 1, #137): a card the caller only reacted to is
    -- judged against its post, and a spin the caller only reacted to is read with its origin (settle.ts reads every spin's), as
    -- settlement_input reads every window play's target.
    union select a.target_act_id from acts a join voted v on v.id = a.id
          where a.kind in ('card', 'spin', 'spring') and a.target_act_id is not null and coalesce(a.payload ->> 'reach', 'post') = 'post'
  ),
  -- As settlement_input (0004, as 0043 changed it): a staff character's Acts, and a card on one, are named and pay nobody.
  all_acts as (select a.* from acts a join touched t on t.id = a.id where a.created_at < window_end and a.character is not null and a.kind <> 'donation'
               and not is_staff_side(a.character, a.kind, a.target_act_id) and a.id not in (select id from ended)),
  -- A staff post a window's card of the caller's landed on, as settlement_input names it (0054).
  unscored as (select a.* from acts a join characters c on c.id = a.character join touched t on t.id = a.id
               where c.staff is not null and a.id in (select k.target_act_id from all_acts k where k.kind = 'card' and k.created_at >= window_start and coalesce(k.payload ->> 'reach', 'post') = 'post')),
  system_acts as (select a.id from acts a join touched t on t.id = a.id
                  where (a.character is null or is_staff_side(a.character, a.kind, a.target_act_id)) and a.id not in (select id from unscored)),
  -- Every reaction on an Act voted on, up to now, but the caller's own to the caller's own characters,
  -- and none on The System's own Acts: the tally every player reacts to would hand each caller who
  -- reacted to it every other player's reaction.
  --
  -- The settlement never pays a player's reactions to their own characters, and until 0073 this read
  -- left them out too, which made a live line computed from who reacted: a fire landing on Bob's post
  -- under Ann's card with no lift line told Ann it came from one of Bob's masks. The live estimate is not
  -- The System's scoring (CLAUDE.md, "A response never proves a private fact": "The live estimate is not
  -- that exception: it leaves out only the caller's own reactions, counts every other as anyone's, and
  -- the settlement is exact"). So ownership is read here only to tell the caller's own from the rest:
  -- the caller knows their own, and every other reaction, the author's own player's included, is
  -- counted under `keyed`'s per-mask keys, which the engine cannot tie to an author. The estimate can then
  -- say more than the settlement pays, as it says "up to"; the settled log is exact.
  all_reactions as (
    select r.* from reactions r join voted v on v.id = r.act
    join acts a on a.id = r.act join characters c on c.id = a.character
    where r.created_at < window_end and not (r.reactor_account = account and c.owner = account) and r.act not in (select id from ended) and a.kind <> 'donation'
      and not (r.reactor_account <> account and totals_withheld(r.act, account))
      and (not is_staff_side(a.character, a.kind, a.target_act_id) or a.id in (select id from unscored))
  ),
  -- Each reaction's voter and mask as the engine reads them: the caller's own, as the caller's;
  -- any other's, under keys made up for this request.
  keyed as (
    select r.id, r.act, r.kind, r.created_at,
      case when r.reactor_account = account then you else md5(salt || 'reactor' || r.reactor_character) end as player,
      case when r.reactor_account = account then r.reactor_character::text else md5(salt || 'mask' || r.reactor_character) end as character
    from all_reactions r
  ),
  others as (
    select distinct a.character::text as id, md5(salt || 'author' || a.character) as player from all_acts a where a.character not in (select id from mine)
    union select distinct k.character, k.player from keyed k where k.player <> you
  )
  select jsonb_build_object(
    'player', you,
    -- The window's start exactly, as the settlement that opened it ended: `from` is whole
    -- milliseconds, which can fall short of it. The estimate keeps its answer with this one.
    'windowStart', window_start,
    -- The classes the caller's own characters are scored as for this window (scored_as_plays), beside the window's start: the estimate can say it.
    'scoredAs', coalesce((select jsonb_agg(jsonb_build_object('character', s.character, 'class', s.class_key, 'play', s.play) order by s.character)
                          from scored_as_plays(window_start, window_end) s join mine m on m.id = s.character), '[]'),
    'window', jsonb_build_object('id', 'estimate',
      'from', (extract(epoch from window_start) * 1000)::bigint, 'to', (extract(epoch from window_end) * 1000)::bigint),
    'characters', coalesce((
      select jsonb_agg(x order by x ->> 'id') from (
        select jsonb_build_object('id', c.id, 'player', you, 'classes', coalesce((
          select jsonb_agg(jsonb_build_object('class', h.class_key, 'from', (extract(epoch from h.started_at) * 1000)::bigint) order by h.started_at)
          from class_history h where h.character = c.id and h.started_at < window_end), '[]')) as x
        from characters c join mine m on m.id = c.id
        union all
        select jsonb_build_object('id', o.id, 'player', o.player, 'classes', '[]'::jsonb) from others o
      ) cs), '[]'),
    'acts', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', a.id, 'character', a.character, 'kind', a.kind,
        'at', (extract(epoch from a.created_at) * 1000)::bigint, 'thread', a.thread,
        'target', case when coalesce(a.payload ->> 'reach', 'post') = 'post' then a.target_act_id end,
        'reach', case when a.kind = 'card' then nullif(coalesce(a.payload ->> 'reach', 'post'), 'post') end,
        'card', case when a.kind in ('card', 'spring') then a.payload ->> 'card' end,
        'by', case when a.kind = 'spring' then a.payload ->> 'by' end,
        -- A caught play is never in effect (0370): its `ends`, where a row written before 0370 holds one, is not sent, so it boosts and skims nothing.
        'ends', case when a.kind = 'card' and not (a.payload ? 'caught') and (select ck.gimmick is not null or ck.skim is not null from card_kinds ck where ck.key = a.payload ->> 'card')
                     then (extract(epoch from (a.payload ->> 'ends')::timestamptz) * 1000)::bigint end,
        'quadrant', case when a.kind = 'card' and (select ck.skim is not null from card_kinds ck where ck.key = a.payload ->> 'card') then a.payload #>> '{config,quadrant}'
                         when a.kind = 'spring' then a.payload ->> 'quadrant' end,
        'on', case when a.kind = 'card' and a.payload ->> 'reach' = 'character' then a.payload ->> 'character' end)) order by a.created_at, a.id)
      from all_acts a), '[]'),
    'unscoredTargets', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'at', (extract(epoch from a.created_at) * 1000)::bigint, 'thread', a.thread, 'staff', true) order by a.created_at, a.id)
      from unscored a), '[]'),
    'reactions', coalesce((
      select jsonb_agg(jsonb_build_object('act', k.act, 'kind', k.kind, 'at', (extract(epoch from k.created_at) * 1000)::bigint,
        'player', k.player, 'character', k.character)
        || case when k.kind like 'x-%' then jsonb_build_object('quadrant', reaction_quadrant(k.act, k.kind)) else '{}'::jsonb end order by k.created_at, k.id)
      from keyed k), '[]'),
    'systemActs', coalesce((select jsonb_agg(id order by id) from system_acts), '[]'))
  );
end $$;
