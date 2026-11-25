-- What the digest sees of the board: its polls, spun threads, plays and standouts (docs/plans/2026-11-25-digest-sees-the-board-plan.md, Task 1; design docs/plans/2026-11-25-digest-sees-the-board-design.md, section 4).
-- Task 1 adds the settings; later tasks of the plan add system_digest and patrol_sample to this file.
--
-- 1. the settings
--   settings_held (0424_staff_requests.sql), holding four more keys, each a whole number from 1 to its ceiling in DIGEST_MOST (engine/system/digest.ts):
--                 digestPolls (polls, a day of the window, 1 to 20), digestSpins (spun threads, a day of the window, 1 to 20), digestPlays (plays, a day of the window, 1 to 20) and
--                 digestStandoutDays (the span in days the standouts count over, 1 to 30). Everything else as 0424_staff_requests.sql wrote it.
--   Existing rows: this writes no settings row. As with digestConversations (0415_chattier_staff.sql), the release's seed inserts the four keys (seed_setting, 0355_settings_tuned.sql),
--   and engine/rules/instance.ts (SETTINGS) holds the same rules. supabase/tests/0079-settings-held.sql lists a poison at each edge of each key.
-- Ways out: no state is added. Masks: a setting is the instance's own number, read by no response that could show a private fact.

-- settings_held (0424_staff_requests.sql), holding `digestPolls`, `digestSpins`, `digestPlays` and `digestStandoutDays` beside `digestConversations`. Everything else as 0424_staff_requests.sql wrote it.
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
  kinds text[] := array['quote', 'cardOnYours', 'trapStruck', 'trapSprang', 'hint', 'ruling', 'settlement', 'followed', 'update', 'seasonNews', 'cardEnded', 'framed', 'trophy', 'beltLost', 'beltBack', 'gift', 'conduct'];
begin
  why := case new.key
    when 'walletCap' then case when not setting_whole(v, 1) then 'a whole number of hundredths, at least 1' end
    when 'vote' then case when not setting_whole(v, 1) then 'a whole number of hundredths, at least 1' end
    when 'halving' then case when not coalesce(jsonb_typeof(v) = 'number' and setting_positive(v) and (v #>> '{}')::numeric <= 1, false)
      then 'a fraction above 0 and at most 1' end
    when 'revealPerk' then case when not coalesce(jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric between 0 and 1, false) then 'a number from 0 to 1' end
    -- How many days a post's debate is followed (0391): a whole number of days, at least 1 and at most 365 (as digestBoardDays and movedStubDays are), so the `::integer` and the interval the inputs build from it cannot overflow.
    when 'debateDays' then case when not setting_whole(v, 1, 365) then 'a whole number of days, at least 1 and at most 365' end
    when 'reactionCap' then case when not setting_whole(v, 1) then 'a whole number, at least 1' end
    when 'postEffects' then case when not setting_whole(v, 1, 16) then 'a whole number of effects, at least 1 and at most 16' end
    when 'crowdPayEach' then case when not setting_whole(v, 0) then 'a whole number of hundredths, at least 0' end
    when 'crowdFloor' then case when not setting_whole(v, 0) then 'a whole number of hundredths, at least 0' end
    when 'crowdPayMost' then case when not setting_whole(v, 1) then 'a whole number, at least 1' end
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
    -- How many conversations with waiting replies the digest shows a pool persona (0415): a whole number from 0 to 12, as DIGEST_MOST.conversations holds.
    when 'digestConversations' then case when not setting_whole(v, 0, 12) then 'a whole number of conversations, at least 0 and at most 12' end
    -- The digest's per-day lists and the standouts' span (0433, docs/plans/2026-11-25-digest-sees-the-board-design.md, section 4): a whole number of each per day of the window, from 1 to DIGEST_MOST's ceiling,
    -- and the span in days of the standouts, from 1 to 30 (DIGEST_MOST.standoutDays); the instance's values are held by engine/rules/instance.ts too.
    when 'digestPolls' then case when not setting_whole(v, 1, 20) then 'a whole number of polls, at least 1 and at most 20' end
    when 'digestSpins' then case when not setting_whole(v, 1, 20) then 'a whole number of spun threads, at least 1 and at most 20' end
    when 'digestPlays' then case when not setting_whole(v, 1, 20) then 'a whole number of plays, at least 1 and at most 20' end
    when 'digestStandoutDays' then case when not setting_whole(v, 1, 30) then 'a whole number of days, at least 1 and at most 30' end
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
    -- How long a conferred request waits for a meeting, and how many a meeting reads (0424): setting_staffrequests.
    when 'staffRequests' then setting_staffrequests(v)
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


-- ====================================================================================================================================
-- 2. system_digest, and the five helpers it reads the Acts the digest role cannot read through
--
-- system_digest (0424_staff_requests.sql), also returning, and keeping everything else as 0424 wrote it (its owner, its grants, its settings):
--   * days: the window's days, rounded up, at least one. `threads`, the top posts (`excerpts`) and the `conversations` are capped at the setting times the days, held within the ceiling DIGEST_MOST holds (25, 20, 12); every other use of
--     digestExcerpts (the standings, the moves, the quotes, the Boss's reactions) stays the setting.
--   * extras: one call of post_extras for every post the digest shows (the top posts, both sides of each exchange, the Boss's reacted posts, the polls'), each answer joined to its post as `extras` (post_extras' entry without `post` and `body`),
--     and `origin` (`{kind, place, at, spunAt, moment, post: null}`, as pool_read_origin reads it) for a shown post that opens a spun thread, else null.
--   * the Boss's reactions gain `text` and `cut` (the post's words cut to digestExcerptChars, as the top posts are) where the Act has words.
--   * `polls`: the polls open at any time in the window whose post the board shows, most voters (poll_counts) then newest, at most least(digestPolls x days, 20), each {poll, post, thread, title, board, seq, extras}.
--     A removed poll and one a later poll on its post replaced are not listed.
--   * `spins`: the threads created in the window with an origin Act the board shows (a set that has not sprung is not one: the board shows its origin once it has), most replies then newest, at most least(digestSpins x days, 20), each {thread, title, origin}.
--   * `plays`: the plays played in the window that landed and that the board shows as plays (not a caught play, not one whose write was refunded, not a face-down set that has not sprung; a back that sprang is one), most drawn then newest, at most
--     least(digestPlays x days, 20), each {play, card, at, by, config, state, text, covered, post, thread, title, seq}. The window is the only time it reads: a play that has ended since is listed, as the meeting that read the window would have seen it (nothing here
--     is read against now()). The helper shapes each row from the play's own Act (read through acts_public: `by` is the public caster as the board gives it, an author veil's stand-in included), its saved state, the words a writing card made (card_texts, as the
--     page's tails show them) and the share of a surface it covers; for a back that sprang `card` is the card the public spring Act names (#1071). A play on a hidden post or in an unlisted thread is left out in the helper, ahead of the cap.
--   * `standouts`: over the span `until - digestStandoutDays`, for each of cards, received, polls, ballots, spun and exchanges, the three characters that are not staff with the most, each {character, name, count}. The counts are for the renderer's words.
-- Masks: every count is of public Acts (digest_standouts reads `acts` itself and applies the view's masks by hand, for cost; supabase/tests/0433-digest-sees-the-board.sql compares each category with a plain read through acts_public). A secret ballot's character is hidden by acts_public and is never counted (the helper leaves out the ballots of a secret poll), a face-down set names its caster in `acts` and is never counted until it has sprung
-- (a spring Act is the play), and an Act an author veil covers is left out as acts_public gives it the stand-in. Nothing reads a reactor or an owner.
--
-- The five helpers (digest_standouts, digest_polls, digest_origin, digest_spins, digest_plays) are owned by the migration's role, as 0426's extras_ids is (the digest role reads no column of `acts` and none of play_post), and return ids, times, names of public
-- characters and counts, and, for digest_plays, what the page shows of a play to every reader (the play's config, its saved state and the words a writing card made, public as post_extras gives them), for the digest role alone. supabase/tests/0050-digest.sql
-- holds the reviewed list of the functions that role may run, and digest_origin is on it beside the others. Each carries the settings 0426's
-- helpers run under (no sequential scan, no bitmap scan), and each Act is read through a key. At a busy instance's scale (a week of thousands of plays, polls with many voters):
--   digest_standouts   reads the Acts of the span by kind: the cards, springs, ballots and polls of the span, each from a partial index of its own ordered by time (`include` holding the id, the character and the target: the plays' and the ballots' read is of the index alone, the polls' also reads the heap for `removed`), one probe of the target
--                      post for each play (received), one of a ballot's poll for each (poll, character) pair that voted (secret?), one digest_origin (the origin Act and, for a set, its spring) for each spin of the span. It reads no Act outside the span and no post.
--   digest_polls       the polls created in the last pollLastsMax and the window (acts_digest_polls_at), each with one probe of its close (acts_one_poll_close), its newest poll (acts_polls) and its post through acts_public (hidden, kind): the polls of a few weeks, never their ballots
--                      (the ballots are poll_counts' own read, one pass over a poll's voters for the polls kept after the cut to the window's, each).
--   digest_origin      one probe of an origin Act and, for a set, of the spring Act that names it (acts_target): the one predicate of whether the board shows an origin, asked by digest_spins and by system_digest.
--   digest_spins       the spun threads created in the window (threads_digest_spun) and one digest_origin for each, in order, until the cap is full.
--   digest_plays       the plays played in the window from play_post (play_post_digest_at), sorted by what they drew, then one probe through acts_public of the Act and one of the post, and of its text, state and surface, for each play kept, in order, until the cap is full.
-- New indexes, each added only because no existing one is ordered by time for its kind: acts_digest_plays_at, acts_digest_ballots_at, acts_digest_polls_at (acts_card_created holds cards alone, with no character, and nothing holds springs, ballots or polls by time:
-- acts_created holds every kind, so a read by it is of every post of the span), threads_digest_spun and play_post_digest_at (play_post has no index by time). Each insert of those kinds writes one more entry; no Act is touched.
-- supabase/tests/0433-digest-sees-the-board-scale.sql counts the rows of `acts` and `play_post` these read and goes red with an index withheld.
-- Applying: the five `create index` statements are not concurrent (a migration runs in a transaction, and the owner applies migrations by hand), so each takes a write lock on `acts`, `play_post` or `threads` while it builds, and
-- inserts of those tables wait. Apply this migration at a quiet moment.
-- Ways out: no state is added.

grant create on schema public to kayfabb_digest;

create index acts_digest_plays_at on acts (created_at) include (id, "character", target_act_id) where kind = 'spring' or (kind = 'card' and not (payload ? 'caught'));
create index acts_digest_ballots_at on acts (created_at) include (id, "character", target_act_id) where kind = 'ballot';
create index acts_digest_polls_at on acts (created_at) include ("character", target_act_id) where kind = 'poll';
create index threads_digest_spun on threads (created_at) include (origin_act_id, replies) where origin_act_id is not null;
create index play_post_digest_at on play_post (played_at) include (post, drawn) where kind <> '' or sprung;

-- The top three characters that are not staff for each of five categories over [from_at, to_at): `cards` (landed card Acts and springs: a face-down set is no play until its spring, and a caught play never landed, nor one whose write was
-- refunded; a spring is a play whether or not its payload carries `caught`, which marks a cast that a back caught and is read on card Acts alone), `received` (the same plays whose target post is the character's, as the board shows its author), `polls` (poll Acts that are not removals), `ballots` (the polls a character voted on publicly: a ballot of a secret poll never counts, and
-- one character is counted once for each poll however often it changed its ballot) and `spun` (threads created in the span whose origin Act is the character's, not a back). Staff are left out, and so is any Act an author veil covers (acts_public shows the stand-in).
-- Why this reads `acts` and not acts_public, and the masks it therefore re-implements: acts_public is a union of three selects over every Act, each with its own subqueries (ballot_secret, the veil cover, the conceal layers), so a read of the span's thousands of
-- plays and ballots through it costs several rows of `acts` for each, and a plan the planner may take reads the whole view. Here each Act is read once, from a partial index by time, with the two masks the counts depend on written out: an author veil covers an Act
-- (post_veil_cover under a live author veil: acts_public gives the stand-in character, and a staff one never stands out) and a secret poll's ballot has no character (acts_public gives it none: ballot_secret). The drift test in
-- supabase/tests/0433-digest-sees-the-board.sql reads every category through acts_public on its fixture and compares; a change to either mask in acts_public must change both.
create function digest_standouts(from_at timestamptz, to_at timestamptz) returns table (category text, "character" uuid, name text, n integer)
language plpgsql stable security definer set search_path = public, pg_temp set jit = off set enable_seqscan = off set enable_bitmapscan = off as $$
begin
  return query
  with pl as materialized (
    select a.id, a."character" as ch, a.target_act_id as tgt
    from acts a
    where (a.kind = 'spring' or (a.kind = 'card' and not (a.payload ? 'caught'))) and a.created_at >= from_at and a.created_at < to_at and a."character" is not null
      and not exists (select 1 from card_write_refunds r where r.play = a.id)
      and not exists (select 1 from post_veil_cover c join post_veils_live v on v.play = c.play and v.veil = 'author' where c.act = a.id)
  ),
  bl as materialized (
    select a.target_act_id as poll, a."character" as ch
    from acts a
    where a.kind = 'ballot' and a.created_at >= from_at and a.created_at < to_at and a."character" is not null
      and not exists (select 1 from post_veil_cover c join post_veils_live v on v.play = c.play and v.veil = 'author' where c.act = a.id)
    group by a.target_act_id, a."character"
  ),
  -- The polls voted on in the span that are not secret: one call of ballot_secret (a probe of the poll) for each poll, never for each voter (a materialized step, so the call is not pushed below the distinct).
  vp as materialized (select distinct x.poll from bl x),
  open_polls as materialized (select q.poll from vp q where not ballot_secret(q.poll)),
  counts as (
    select 'cards'::text as category, p.ch, count(*) as n from pl p group by p.ch
    union all
    select 'received', t.ch, count(*)
    from pl p cross join lateral (select x."character" as ch from acts x where x.id = p.tgt and x.kind in ('post', 'spin') and x."character" is not null
                                    and not exists (select 1 from post_veil_cover c join post_veils_live v on v.play = c.play and v.veil = 'author' where c.act = x.id)) t
    group by t.ch
    union all
    select 'polls', a."character", count(*)
    from acts a
    where a.kind = 'poll' and not (a.payload ? 'removed') and a.created_at >= from_at and a.created_at < to_at and a."character" is not null
      and not exists (select 1 from post_veil_cover c join post_veils_live v on v.play = c.play and v.veil = 'author' where c.act = a.id)
    group by a."character"
    union all
    select 'ballots', b.ch, count(*) from bl b join open_polls pp on pp.poll = b.poll group by b.ch
    union all
    select 'spun', o.ch, count(*)
    from threads t cross join lateral (select x."character" as ch from acts x where x.id = t.origin_act_id and x."character" is not null
                                         and exists (select 1 from digest_origin(x.id))
                                         and not exists (select 1 from post_veil_cover c join post_veils_live v on v.play = c.play and v.veil = 'author' where c.act = x.id)) o
    where t.origin_act_id is not null and t.created_at >= from_at and t.created_at < to_at
    group by o.ch
  ),
  named as (
    select k.category, k.ch, c.name, k.n::integer as n
    from counts k join characters c on c.id = k.ch and c.staff is null and c.debuted_at is not null
  ),
  ranked as (
    select m.category, m.ch, m.name, m.n, row_number() over (partition by m.category order by m.n desc, m.name, m.ch) as rn from named m
  )
  select r.category, r.ch, r.name, r.n from ranked r where r.rn <= 3;
end $$;

-- The polls open at any time in [since, until): created before the end and ending after the start (the least of its time and its close), not a removal, still its post's newest poll, on a post or a spin. Newest-created first is the caller's to order.
create function digest_polls(since timestamptz, until timestamptz) returns table (poll uuid, post uuid, created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp set jit = off set enable_seqscan = off set enable_bitmapscan = off as $$
declare lasts interval;
begin
  begin lasts := span_interval(setting('pollLastsMax')); exception when others then lasts := interval '14 days'; end;
  return query
  select a.id, a.target_act_id, a.created_at
  from acts a
  -- the post by its id, one probe for each poll (a lateral subquery behind `offset 0`: a planner that believes the posts many reads them all and merges), through acts_public: a hidden post's poll, one on a thread that is unlisted and one on no post is left
  -- out here, ahead of the caller's cap, as digest_spins leaves out the unlisted ones
  cross join lateral (select p.thread from acts_public p where p.id = a.target_act_id and p.hidden is not true and p.kind in ('post', 'spin') offset 0) pk
  where a.kind = 'poll' and a.created_at >= digest_polls.since - lasts and a.created_at < digest_polls.until and not (a.payload ? 'removed')
    and least((a.payload ->> 'closes_at')::timestamptz, coalesce((select min(x.created_at) from acts x where x.kind = 'poll_close' and x.target_act_id = a.id), 'infinity')) > digest_polls.since
    and not exists (select 1 from acts n where n.kind = 'poll' and n.target_act_id = a.target_act_id and (n.created_at, n.id) > (a.created_at, a.id))
    and not exists (select 1 from unlisted_threads u where u.thread = pk.thread);
end $$;

-- The origin Act of a spun thread as the board shows it, one row, or none where the board does not: a set shows its origin only once it has sprung, and a spring Act, public and naming the set and its post, is that. One predicate
-- for the three places that ask (digest_spins, which cuts to the cap on it, and system_digest's origins for the spins and for a shown post that opens a thread), so a slot digest_spins keeps is never dropped after the cap. It reads the Act
-- by its key and the spring through acts_target; the kind and the time of an Act are the same in acts_public, which an author veil changes only for the character.
create function digest_origin(origin uuid) returns table (kind text, made_at timestamptz)
language sql stable security definer set search_path = public, pg_temp set jit = off set enable_seqscan = off set enable_bitmapscan = off as $$
  select o.kind, o.created_at
  from acts o
  where o.id = digest_origin.origin
    and (o.kind <> 'set' or exists (select 1 from acts sp where sp.kind = 'spring' and sp.target_act_id = o.target_act_id and sp.payload ->> 'set' = o.id::text))
$$;

-- digest_plays gates on play_post.sprung (`p.kind <> '' or p.sprung`, the partial index's own predicate), not on digest_origin: a play listed is a play the board's own play_post draws, and play_post is that board's list of plays. It agrees with
-- digest_origin because 0408 (play_row) derives `sprung` from the same Act, a spring naming the set, and a spring is written only on the set's own post by the one who set it (acts_well_formed refuses any other, so a spring naming a set
-- but targeting another post cannot exist outside a test that forces one past the trigger: supabase/tests/0433-digest-sees-the-board.sql section 8). digest_origin's extra clause on the spring's target is that same fact, asked of the Act.
-- The threads created in [since, until) whose origin Act the board shows (digest_origin), in the order the digest lists them (replies, newest), unlisted threads left out, `most` of them.
create function digest_spins(since timestamptz, until timestamptz, most integer) returns table (thread uuid)
language sql stable security definer set search_path = public, pg_temp set jit = off set enable_seqscan = off set enable_bitmapscan = off as $$
  select x.id
  from (select t.id, t.replies, t.created_at, t.origin_act_id from threads t
        where t.origin_act_id is not null and t.created_at >= digest_spins.since and t.created_at < digest_spins.until
        order by t.replies desc, t.created_at desc, t.id) x
  where not exists (select 1 from unlisted_threads u where u.thread = x.id)
    and exists (select 1 from digest_origin(x.origin_act_id))
  limit digest_spins.most
$$;

-- The plays played in [since, until) that landed and that the board shows as plays, most drawn first, `most` of them, each shaped as the page's extras shape a play: the rows of play_post by time, then each in order through its Act (acts_public: a card or a
-- set that is not caught and not refunded; the caster is the public one), its post (not hidden, a post or a spin, in a listed thread) and its saved state, words and surface, until the cap is full. A face-down set that has not sprung is never here
-- (a row kept out of the index); a back that sprang is, `card` being the card the public spring Act names (acts_layers finds it by the post). Nothing is read against now(): a play that has ended since is a play of the window all the same.
create function digest_plays(since timestamptz, until timestamptz, most integer)
  returns table (play uuid, post uuid, drawn integer, played_at timestamptz, card text, made_at timestamptz, caster text, config jsonb, state jsonb, words text, covered double precision)
language sql stable security definer set search_path = public, pg_temp set jit = off set enable_seqscan = off set enable_bitmapscan = off as $$
  select c.play, c.post, c.drawn, c.played_at,
         case when a.kind = 'card' then a.payload ->> 'card'
              else (select s.payload ->> 'card' from acts s where s.kind = 'spring' and s.target_act_id = c.post and s.payload ->> 'set' = c.play::text limit 1) end,
         a.created_at, cn.name, a.payload -> 'config', es.state, t.text, sf.covered
  from (select p.play, p.post, p.drawn, p.played_at from play_post p
        where p.played_at >= digest_plays.since and p.played_at < digest_plays.until and (p.kind <> '' or p.sprung)
        order by p.drawn desc, p.played_at desc, p.play desc) c
  cross join lateral (select v.id, v.kind, v.created_at, v.payload, v."character" from acts_public v where v.id = c.play and v.kind in ('card', 'set') and not (v.payload ? 'caught') and v.untaken is not true offset 0) a
  cross join lateral (select pv.thread from acts_public pv where pv.id = c.post and pv.hidden is not true and pv.kind in ('post', 'spin') offset 0) pk
  left join lateral (select cp.name from characters_public cp where cp.id = a."character") cn on true
  left join lateral (select e.state from effect_state e where e.play = c.play offset 0) es on true
  -- the words a writing play made, as the page's tails (post_tails) show them to any reader: the text for the post's current version, else the latest text it has
  left join lateral (select ct.text from card_texts ct where ct.play = c.play and ct.text is not null order by (ct.version = post_version(c.post)) desc, ct.created_at desc, ct.id desc limit 1) t on true
  -- the share of a surface a play covers: bit_count of the cover over the grid's 100 x 100 cells (0317), a row for a surface card alone
  left join lateral (select bit_count(x.cover)::double precision / 10000 as covered from surfaces x where x.play = c.play) sf on true
  where not exists (select 1 from unlisted_threads u where u.thread = pk.thread)
  limit digest_plays.most
$$;

revoke execute on function digest_standouts(timestamptz, timestamptz), digest_polls(timestamptz, timestamptz), digest_origin(uuid), digest_spins(timestamptz, timestamptz, integer), digest_plays(timestamptz, timestamptz, integer)
  from public, anon, authenticated, service_role;
grant execute on function digest_standouts(timestamptz, timestamptz), digest_polls(timestamptz, timestamptz), digest_origin(uuid), digest_spins(timestamptz, timestamptz, integer), digest_plays(timestamptz, timestamptz, integer) to kayfabb_digest;

create or replace function system_digest(since timestamptz, until timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  threads_cap integer := (setting('digestThreads'))::integer;
  short_cap integer := (setting('digestExcerpts'))::integer;
  chars integer := (setting('digestExcerptChars'))::integer;
  board_cap integer;
  board_days integer;
  conv_cap integer;
  days integer;
  top_cap integer;
  polls_cap integer;
  spins_cap integer;
  plays_cap integer;
  stand_days integer;
  span_from timestamptz;
  req_most integer;
  hours numeric;
  result jsonb;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  met_by_most constant integer := 8;
begin
  if since is null or until is null or until <= since then
    raise exception 'a digest covers a window that ends after it starts' using errcode = '22023';
  end if;
  -- The board lines' two settings: an instance that has not set them (seeded before them) reads the defaults, as inheritance_due reads inheritanceGraceDays.
  begin board_cap := (setting('digestBoards'))::integer; exception when no_data_found then board_cap := 30; end;
  begin board_days := (setting('digestBoardDays'))::integer; exception when no_data_found then board_days := 21; end;
  -- The conversations' setting (0415): an instance seeded before it reads the default of 6.
  begin conv_cap := (setting('digestConversations'))::integer; exception when no_data_found then conv_cap := 6; end;
  -- The requests' setting (0424): an instance seeded before it reads the default of 10.
  begin req_most := ((setting('staffRequests')) ->> 'meetingMost')::integer; exception when no_data_found then req_most := 10; end;
  -- The new lists' settings (0433): an instance seeded before them reads the defaults the instance sets (5, 5, 5 and 7).
  begin polls_cap := (setting('digestPolls'))::integer; exception when no_data_found then polls_cap := 5; end;
  begin spins_cap := (setting('digestSpins'))::integer; exception when no_data_found then spins_cap := 5; end;
  begin plays_cap := (setting('digestPlays'))::integer; exception when no_data_found then plays_cap := 5; end;
  begin stand_days := (setting('digestStandoutDays'))::integer; exception when no_data_found then stand_days := 7; end;
  -- The window's days, rounded up, at least one: each list that is a window's flow holds its setting a day, so a longer window reads as much of each day, within the ceiling DIGEST_MOST (engine/system/digest.ts) holds for it. The caps of the lists that are
  -- no window's flow (the standings, the moves, the quotes, the Boss's reactions) stay the setting, unscaled.
  days := greatest(1, ceil(extract(epoch from (until - since)) / 86400))::integer;
  threads_cap := least(threads_cap * days, 25);
  top_cap := least(short_cap * days, 20);
  conv_cap := least(conv_cap * days, 12);
  polls_cap := least(polls_cap * days, 20);
  spins_cap := least(spins_cap * days, 20);
  plays_cap := least(plays_cap * days, 20);
  span_from := until - make_interval(days => stand_days);
  hours := greatest(extract(epoch from (until - since)) / 3600.0, 1.0 / 60);
  with
  w as (
    select p.id, p.thread, p.character, p.target_act_id, p.created_at, left(p.current_payload ->> 'body', chars) as excerpt,
           coalesce(length(p.current_payload ->> 'body') > chars, false) as cut
    from acts_public p
    where p.kind = 'post' and p.created_at >= since and p.created_at < until and p.character is not null
  ),
  react as (
    select w.thread, reaction_quadrant(t.act, t.kind) as quadrant, sum(t.count)::integer as n
    from w join reaction_tallies_open t on t.act = w.id
    group by w.thread, reaction_quadrant(t.act, t.kind)
  ),
  split as (
    select r.thread, sum(r.n) as total, max(r.n) as biggest from react r group by r.thread
  ),
  hot as (
    select tl.id as thread, left(tl.title, 120) as title, tl.board as board_id, h.posts,
           round(h.posts / hours, 2) as heat,
           round(coalesce(1 - s.biggest::numeric / nullif(s.total, 0), 0), 4) as controversy,
           tl.last_seq as length
    from (select w.thread, count(*) as posts from w group by w.thread) h
    join thread_list tl on tl.id = h.thread
    left join split s on s.thread = h.thread
    order by h.posts desc, coalesce(1 - s.biggest::numeric / nullif(s.total, 0), 0) desc, tl.id
    limit threads_cap
  ),
  -- Order and cut first, number after. The order is the standings screen's, amount then name (then the character, for
  -- a tie of both), so the top rows come off standings_season_amount (season, amount desc, name; 0030) already in order
  -- and stop at the cap: the season's rows are never sorted, only the few of a tie are. The rank is numbered over the cut.
  -- A row that is not a public character is skipped inside the cut, so the cap is still full.
  stand as (
    select row_number() over (order by top.amount desc, top.name, top.character) as rank, top.character, top.amount
    from (
      select s.character, s.amount, s.name
      from standings s
      where s.season = standings_season()
        and exists (select 1 from settlements x where x.ends_at > since and x.ends_at <= until)
        and exists (select 1 from characters_public cp where cp.id = s.character)
      order by s.amount desc, s.name, s.character
      limit short_cap
    ) top
  ),
  quoted as (
    select w.character as q_from, tgt.character as q_to, count(*) as n
    from w join acts_public tgt on tgt.id = w.target_act_id
    where tgt.kind = 'post' and tgt.character is not null and tgt.character <> w.character
    group by w.character, tgt.character
    order by count(*) desc, w.character, tgt.character
    limit short_cap
  ),
  boss as (
    select cp.id from characters_public cp where cp.staff is not null and cp.staff = current_boss()
  ),
  boss_acts as (
    select a.id, a.thread, left(a.current_payload ->> 'body', chars) as excerpt, coalesce(length(a.current_payload ->> 'body') > chars, false) as cut, a.current_payload ? 'body' as has_body
    from acts_public a
    where a.character in (select id from boss) and a.kind in ('post', 'spin', 'card')
      and a.created_at >= since - (until - since) and a.created_at < until
  ),
  boss_tally as (
    select ba.id as act, ba.thread, sum(t.count)::integer as total, jsonb_object_agg(t.kind, t.count order by t.kind) as tally, ba.excerpt, ba.cut, ba.has_body
    from boss_acts ba join reaction_tallies_open t on t.act = ba.id
    group by ba.id, ba.thread, ba.excerpt, ba.cut, ba.has_body
    order by sum(t.count) desc, ba.id
    limit short_cap
  ),
  excerpted as (
    select w.id as act, w.thread, w.character, coalesce(sum(t.count), 0)::integer as reactions, w.excerpt, w.cut, w.created_at
    from w left join reaction_tallies_open t on t.act = w.id
    group by w.id, w.thread, w.character, w.excerpt, w.cut, w.created_at
    order by coalesce(sum(t.count), 0) desc, w.created_at desc, w.id
    limit top_cap
  ),
  -- The moves in force (open_moves: a handful of rows, whatever the instance's history) and those whose end fell in the window,
  -- each capped (the reversals first, so a met move's end cannot crowd one out); the merge below orders and caps them again. An end after the window is not the digest's yet.
  open_m as (
    select a.id as act, a.created_at as landed_at, a.payload, null::jsonb as ended, 1 as grp, 'inForce'::text as state, a.created_at as sort_at, null::timestamptz as held_at, null::text as why
    from open_moves o join acts_public a on a.id = o.move_act
    where a.created_at < until
    order by a.created_at desc, a.id
    limit short_cap
  ),
  ended_m as (
    select a.id as act, a.created_at as landed_at, a.payload,
           jsonb_build_object('why', e.payload ->> 'why', 'by', e.payload ->> 'by', 'at', e.created_at) as ended,
           case when e.payload ->> 'by' = 'admin' then 0 else 2 end as grp, 'ended'::text as state, e.created_at as sort_at, null::timestamptz as held_at, null::text as why
    from acts_public e join acts_public a on a.id = e.target_act_id
    where e.kind = 'move_end' and e.created_at >= since and e.created_at < until
    order by (e.payload ->> 'by' = 'admin') desc, e.created_at desc, e.id
    limit short_cap
  ),
  -- A move an admin held in the window never landed, so it has no Act: its row in the queue (the columns the digest role may read).
  held_m as (
    select null::uuid as act, null::timestamptz as landed_at,
           jsonb_build_object('kind', q.kind, 'params', q.params, 'demand', q.demand, 'expires_at', q.expires_at) as payload,
           null::jsonb as ended, 0 as grp, 'held'::text as state, q.held_at as sort_at, q.held_at, q.why
    from queued_moves q
    where q.held_at >= since and q.held_at < until
    order by q.held_at desc, q.id
    limit short_cap
  ),
  moved as (
    select * from (select * from open_m union all select * from ended_m union all select * from held_m) u order by u.grp, u.sort_at desc, u.act limit short_cap
  ),
  -- The moves in the list that ended `met`, with the params of their demand read as the demand evaluator reads them. A param that is
  -- not what its kind needs reads null, so one malformed move cannot stop the digest.
  met_m as (
    select m.act, m.landed_at, (m.ended ->> 'at')::timestamptz as end_at, m.payload #>> '{demand,kind}' as dkind,
           case when m.payload #>> '{demand,params,board}' ~ uuid_re then (m.payload #>> '{demand,params,board}')::uuid end as board,
           case when m.payload #>> '{demand,params,thread}' ~ uuid_re then (m.payload #>> '{demand,params,thread}')::uuid end as thread,
           case when m.payload #>> '{demand,params,character}' ~ uuid_re then (m.payload #>> '{demand,params,character}')::uuid end as character,
           case when m.payload #>> '{demand,params,a}' ~ uuid_re then (m.payload #>> '{demand,params,a}')::uuid end as a,
           case when m.payload #>> '{demand,params,b}' ~ uuid_re then (m.payload #>> '{demand,params,b}')::uuid end as b,
           m.payload #>> '{demand,params,quadrant}' as quadrant,
           case when m.payload #>> '{demand,params,count}' ~ '^[0-9]{1,9}$' then (m.payload #>> '{demand,params,count}')::integer end as cnt
    from moved m
    where m.state = 'ended' and m.ended ->> 'why' = 'met' and jsonb_typeof(m.payload -> 'demand') = 'object'
  ),
  -- Who met a move: the public, non-staff characters whose public Acts counted toward its demand, from the landing to the end. For the
  -- two board counts, whoever posted on the board in between, in the order they first did; for a quadrant, the authors of the posts whose
  -- public tallies counted, the most reacted first; for a post in a thread, the character named; for a crossQuote, the two. A staff
  -- character's Acts never count (the evaluator skips them) and are never listed. Only public relations, and never a reactor.
  met_credit as (
    select p.act, p.character, min(p.created_at) as first_at, 0::bigint as weight
    from (
      -- postsOnBoard: the posts demand_progress counted, the first `count` after the landing (oldest first, staff skipped), read as it
      -- reads them: the Acts in time order from the landing, limited to `count` matches (the header says what that does and doesn't
      -- bound). A post after the count was reached, before the tick noticed, is not the move's.
      select mm.act, x.character, x.created_at
      from met_m mm
      cross join lateral (
        select a.character, a.created_at
        from acts_public a
        join characters_public c on c.id = a.character
        where a.thread in (select tl.id from thread_list tl where tl.board = mm.board)
          and a.kind = 'post' and a.created_at > mm.landed_at and a.created_at <= mm.end_at and c.staff is null
        order by a.created_at, a.id
        limit mm.cnt
      ) x
      where mm.dkind = 'postsOnBoard' and mm.cnt >= 1
    ) p
    group by p.act, p.character
    union all
    -- distinctCharactersOnBoard: the first `count` distinct characters to post after the landing, in the order they first did. Each step
    -- finds the next post, in time order from the previous step's, by a character not yet found; every post skipped on the way is by one
    -- already found (or a staff character), so the steps are the characters' first posts in order, and the walk reads the Acts up to the
    -- `count`th new character's first post and no further.
    select w.act, w.character, w.created_at, 0::bigint
    from (
      with recursive walk(act, board, end_at, cnt, n, character, created_at, id, found) as (
        select mm.act, mm.board, mm.end_at, mm.cnt, 0, null::uuid, mm.landed_at, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, '{}'::uuid[]
        from met_m mm
        where mm.dkind = 'distinctCharactersOnBoard' and mm.cnt >= 1
        union all
        select w.act, w.board, w.end_at, w.cnt, w.n + 1, x.character, x.created_at, x.id, w.found || x.character
        from walk w
        cross join lateral (
          select a.character, a.created_at, a.id
          from acts_public a
          join characters_public c on c.id = a.character
          where a.thread in (select tl.id from thread_list tl where tl.board = w.board)
            and a.kind = 'post' and a.created_at >= w.created_at and a.created_at <= w.end_at and (a.created_at, a.id) > (w.created_at, w.id)
            and a.character <> all (w.found) and c.staff is null
          order by a.created_at, a.id
          limit 1
        ) x
        where w.n < w.cnt
      )
      select * from walk where n >= 1
    ) w
    union all
    -- quadrantOnBoard: the public tally as it stands when the digest is built, not as of the move's end. A reaction after the end can raise
    -- it, and a public tally keeps no time per reaction (a reaction's time is private, and is never read here), so this credit may include
    -- an author a later reaction put in the quadrant.
    select mm.act, a.character, min(a.created_at), -sum(t.count)::bigint
    from met_m mm
    join thread_list tl on tl.board = mm.board
    join acts_public a on a.thread = tl.id
    join characters_public c on c.id = a.character
    join reaction_tallies_open t on t.act = a.id
    where mm.dkind = 'quadrantOnBoard' and reaction_quadrant(t.act, t.kind) = mm.quadrant
      and a.kind = 'post' and a.created_at > mm.landed_at and a.created_at <= mm.end_at and c.staff is null
    group by mm.act, a.character
    having sum(t.count) > 0
    union all
    select mm.act, a.character, min(a.created_at), 0::bigint
    from met_m mm
    join acts_public a on a.thread = mm.thread and a.character = mm.character
    join characters_public c on c.id = a.character
    where mm.dkind = 'characterPostsInThread'
      and a.kind = 'post' and a.created_at > mm.landed_at and a.created_at <= mm.end_at and c.staff is null
    group by mm.act, a.character
    union all
    select mm.act, c.id, mm.landed_at, (case when c.id = mm.a then 0 else 1 end)::bigint
    from met_m mm
    join characters_public c on c.id in (mm.a, mm.b)
    where mm.dkind = 'crossQuote' and c.staff is null
  ),
  met_top as (
    select r.act, r.character, r.rank
    from (select x.act, x.character, row_number() over (partition by x.act order by x.weight, x.first_at, x.character) as rank from met_credit x) r
    where r.rank <= met_by_most
  ),
  -- The board lines: each open board that is not The System's, with the posts on it over the `board_days` days before the window's end, on the board each thread is on now
  -- (threads.board, which a move that landed has already changed). Public posts of public characters only, counted per board and read from nothing else: no owner,
  -- account, class or reaction. The count is one range of the partial index acts_posts_by_time and one primary-key read per thread's post, grouped by board; the lines are the
  -- number of boards, which a busy instance keeps small. When there are more than `board_cap`, the busiest half (the odd one too) and the quietest half; the numbering is over
  -- the ordered whole, so the two halves cannot overlap, and a cap the boards do not reach keeps them all.
  board_posts as (
    select tl.board, count(*)::integer as n
    from acts_public p join threads tl on tl.id = p.thread
    where p.kind = 'post' and p.character is not null and p.created_at >= until - make_interval(days => board_days) and p.created_at < until
    group by tl.board
  ),
  board_all as (
    select bn.id, left(bn.name, 120) as name, left(bn.premise, 200) as premise, coalesce(bp.n, 0) as n,
           row_number() over (order by coalesce(bp.n, 0) desc, bn.id) as rn, count(*) over () as total
    from boards_now bn left join board_posts bp on bp.board = bn.id
    where not bn.is_system and not bn.closed
  ),
  board_lines as (
    select x.id, x.name, x.premise, x.n, x.rn from board_all x
    where x.rn <= (board_cap + 1) / 2 or x.rn > x.total - board_cap / 2
  ),
  -- The conversations (0415): a persona's turns in one thread over the window, from pool_turns, each turn's post read through acts_public (a removed post is not a turn the digest shows) and its reactions the public
  -- total, as an excerpt's are. Ranked by the reactions, then the turns, then the thread and persona; cut to the setting. The persona is read through characters_public, so one that never debuted is not listed.
  turn_r as (
    select t.id as turn, t.thread, t.staff, t.at, t.post_act, t.quoting,
           (select coalesce(sum(rt.count), 0)::integer from reaction_tallies_open rt where rt.act = t.post_act) as reactions
    from pool_turns t join acts_public pa on pa.id = t.post_act
    -- `day` is the UTC day of the session a turn belongs to, which began no later than the turn; the day bounds (a day wider before, for a session that ran past midnight) let the (day) index serve the read, the `at` bounds make it exact.
    where t.day >= (since at time zone 'UTC')::date - 1 and t.day <= (until at time zone 'UTC')::date and t.at >= since and t.at < until
  ),
  conv as (
    select g.thread, g.staff, g.turns, g.reactions, left(tl.title, 120) as title, cp.id as persona
    from (select tr.thread, tr.staff, count(*)::integer as turns, sum(tr.reactions)::integer as reactions from turn_r tr group by tr.thread, tr.staff) g
    join thread_list tl on tl.id = g.thread
    join characters_public cp on cp.staff = g.staff
    order by g.reactions desc, g.turns desc, g.thread, g.staff
    limit conv_cap
  ),
  -- Who a conversation answered: the public authors of the replies its turns answered (pool_answered), the most answered first, at most 8.
  conv_with as (
    select x.thread, x.staff, x.character, x.name
    from (
      select c.thread, c.staff, r.character, cp.name, row_number() over (partition by c.thread, c.staff order by count(*) desc, r.character) as rn
      from conv c
      join turn_r tr on tr.thread = c.thread and tr.staff = c.staff
      join pool_answered pan on pan.turn = tr.turn
      join acts_public r on r.id = pan.reply
      join characters_public cp on cp.id = r.character
      group by c.thread, c.staff, r.character, cp.name
    ) x
    where x.rn <= 8
  ),
  -- The hottest exchange: the turn the crowd reacted to most (the later one on a tie) and the reply it quoted, each cut to the excerpt setting.
  conv_best as (
    select distinct on (c.thread, c.staff) c.thread, c.staff, pa.id as turn_act, q.id as reply_act, q.thread as reply_thread,
           left(pa.current_payload ->> 'body', chars) as turn_text, coalesce(length(pa.current_payload ->> 'body') > chars, false) as turn_cut,
           q.character as reply_by, left(q.current_payload ->> 'body', chars) as reply_text, coalesce(length(q.current_payload ->> 'body') > chars, false) as reply_cut
    from conv c
    join turn_r tr on tr.thread = c.thread and tr.staff = c.staff
    join acts_public pa on pa.id = tr.post_act
    join acts_public q on q.id = tr.quoting and q.character is not null
    order by c.thread, c.staff, tr.reactions desc, tr.at desc, tr.turn desc
  ),
  -- Everything below is 0433. The posts the digest shows (the top posts, both sides of each exchange, the Boss's reacted posts, the polls' posts and the plays'), each with its thread.
  poll_rank as (
    select pc.poll, pc.post, pc.created_at, c.voters
    from digest_polls(since, until) pc
    -- poll_counts by the poll's key, one probe for each candidate (a lateral subquery behind `offset 0`: a planner that believes the polls many reads every poll of the history and hashes them)
    cross join lateral (select k.voters from poll_counts k where k.poll = pc.poll offset 0) c
    order by c.voters desc, pc.created_at desc, pc.poll
    limit polls_cap
  ),
  poll_v as (
    select r.poll, r.post, r.created_at, r.voters, ap.thread, ap.seq, left(tl.title, 120) as title, tl.board as board_id
    from poll_rank r
    cross join lateral (select x.thread, x.seq from acts_public x where x.id = r.post and x.hidden is not true and x.kind in ('post', 'spin') offset 0) ap
    cross join lateral (select l.title, l.board from thread_list l where l.id = ap.thread offset 0) tl
  ),
  play_v as (
    select pr.play, pr.post, pr.drawn, pr.played_at, pr.card, pr.made_at, pr.caster, pr.config, pr.state, pr.words, pr.covered, ap.thread, ap.seq, left(tl.title, 120) as title
    from digest_plays(since, until, plays_cap) pr
    cross join lateral (select x.thread, x.seq from acts_public x where x.id = pr.post and x.hidden is not true and x.kind in ('post', 'spin') offset 0) ap
    cross join lateral (select l.title from thread_list l where l.id = ap.thread offset 0) tl
  ),
  shown_ids as (
    select e.act, e.thread from excerpted e
    union select b.turn_act, b.thread from conv_best b
    union select b.reply_act, b.reply_thread from conv_best b
    union select bt.act, bt.thread from boss_tally bt
    union select p.post, p.thread from poll_v p
  ),
  -- One call of post_extras for all of them (at most 200: the caps' ceilings add up to 84), each answer keyed by its post, without the post and the body.
  ex as materialized (select post_extras(array(select s.act from shown_ids s)) as j),
  ex_by as (
    select coalesce(jsonb_object_agg(e.x ->> 'post', e.x - 'post' - 'body'), '{}'::jsonb) as j from ex, jsonb_array_elements(ex.j) e(x)
  ),
  -- A shown post that opens a spun thread (its thread's first post, the thread having an origin Act the board shows, a back left out): the origin as pool_read_origin reads it, without the post it stands on.
  org as (
    select s.act, jsonb_build_object('kind', o.kind, 'place', tl.origin_place, 'at', o.made_at, 'spunAt', tl.created_at, 'moment', o.kind in ('card', 'set', 'spring'), 'post', null) as j
    from shown_ids s
    cross join lateral (select l.first_act, l.origin_act_id, l.origin_place, l.created_at from thread_list l where l.id = s.thread offset 0) tl
    cross join lateral digest_origin(tl.origin_act_id) o
    where tl.first_act = s.act and tl.origin_act_id is not null
  ),
  see_by as (
    select coalesce(jsonb_object_agg(s.act::text, jsonb_build_object('extras', (select x.j from ex_by x) -> s.act::text, 'origin', (select g.j from org g where g.act = s.act))), '{}'::jsonb) as j
    from shown_ids s
  ),
  spin_v as (
    select tl.id as thread, left(tl.title, 120) as title, tl.replies, tl.created_at,
           jsonb_build_object('kind', o.kind, 'place', tl.origin_place, 'at', o.made_at, 'spunAt', tl.created_at, 'moment', o.kind in ('card', 'set', 'spring'), 'post', null) as origin
    from digest_spins(since, until, spins_cap) sp
    cross join lateral (select l.id, l.title, l.replies, l.created_at, l.origin_act_id, l.origin_place from thread_list l where l.id = sp.thread offset 0) tl
    cross join lateral digest_origin(tl.origin_act_id) o
  ),
  -- The standouts: the helper counts the five categories of public Acts; the sixth, exchanges, is the repliers (public, not staff) whose replies a persona's turn in the span answered, read as the conversations read them.
  so_x as (
    select 'exchanges'::text as category, r.character, r.name, r.n::integer as n
    from (
      select z.character, z.name, z.n, row_number() over (order by z.n desc, z.name, z.character) as rn
      from (
        select a.character, cp.name, count(distinct pan.reply) as n
        from pool_turns t
        -- the turn's post and each reply by its id, one probe for each (a lateral subquery behind `offset 0`: acts_public is a union over every Act, and a planner that believes the turns or replies many hashes it whole)
        cross join lateral (select 1 from acts_public pa where pa.id = t.post_act offset 0) pk
        join pool_answered pan on pan.turn = t.id
        cross join lateral (select x."character" from acts_public x where x.id = pan.reply and x."character" is not null offset 0) a
        join characters_public cp on cp.id = a.character and cp.staff is null
        where t.day >= (span_from at time zone 'UTC')::date - 1 and t.day <= (until at time zone 'UTC')::date and t.at >= span_from and t.at < until
        group by a.character, cp.name
      ) z
    ) r where r.rn <= 3
  ),
  so as (
    select s.category, s.character, s.name, s.n from digest_standouts(span_from, until) s
    union all select x.category, x.character, x.name, x.n from so_x x
  ),
  named as (
    select q_from as id from quoted union select q_to from quoted union select character from stand union select character from excerpted
    union select character from met_top
    union select persona from conv union select character from conv_with union select reply_by from conv_best
  )
  select jsonb_build_object(
    'since', since,
    'until', until,
    'threads', coalesce((select jsonb_agg(jsonb_build_object('thread', h.thread, 'title', h.title, 'board', (select bn.name from boards_now bn where bn.id = h.board_id), 'posts', h.posts,
                          'heat', h.heat, 'controversy', h.controversy, 'length', h.length)
                         order by h.posts desc, h.controversy desc, h.thread) from hot h), '[]'::jsonb),
    'boards', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'premise', l.premise, 'posts', l.n) order by l.rn) from board_lines l), '[]'::jsonb),
    'boardDays', board_days,
    'standings', coalesce((select jsonb_agg(jsonb_build_object('rank', s.rank, 'character', s.character, 'amount', s.amount) order by s.rank) from stand s), '[]'::jsonb),
    'moves', coalesce((select jsonb_agg(jsonb_build_object('act', m.act, 'kind', m.payload ->> 'kind', 'params', m.payload -> 'params',
                          'demand', m.payload -> 'demand', 'expiresAt', m.payload -> 'expires_at', 'landedAt', m.landed_at,
                          'progress', case when m.state = 'held' then null else demand_progress_or_error(m.act) end, 'ended', m.ended, 'state', m.state)
                          || case when m.state = 'held' then jsonb_build_object('heldAt', m.held_at, 'why', m.why) else '{}'::jsonb end
                          || case when m.state = 'ended' and m.ended ->> 'why' = 'met'
                                  then jsonb_build_object('metBy', coalesce((select jsonb_agg(t.character order by t.rank) from met_top t where t.act = m.act), '[]'::jsonb))
                                  else '{}'::jsonb end
                          order by m.grp, m.sort_at desc, m.act) from moved m), '[]'::jsonb),
    'quotes', coalesce((select jsonb_agg(jsonb_build_object('from', q.q_from, 'to', q.q_to, 'count', q.n) order by q.n desc, q.q_from, q.q_to) from quoted q), '[]'::jsonb),
    'bossReactions', coalesce((select jsonb_agg(jsonb_build_object('act', bt.act, 'thread', bt.thread, 'total', bt.total, 'tally', bt.tally)
                                                     || case when bt.has_body then jsonb_build_object('text', bt.excerpt, 'cut', bt.cut) else '{}'::jsonb end
                                                     || coalesce((select sb.j from see_by sb) -> bt.act::text, '{}'::jsonb)
                                                     order by bt.total desc, bt.act) from boss_tally bt), '[]'::jsonb),
    'excerpts', coalesce((select jsonb_agg(jsonb_build_object('act', e.act, 'thread', e.thread, 'character', e.character, 'reactions', e.reactions, 'text', e.excerpt, 'cut', e.cut)
                          || coalesce((select sb.j from see_by sb) -> e.act::text, '{}'::jsonb)
                          || coalesce((select jsonb_build_object('poll', jsonb_build_object('question', p.payload ->> 'question',
                                         'options', (select coalesce(jsonb_agg(jsonb_build_object('text', o.t, 'count', coalesce(c.counts[o.n::integer], 0)) order by o.n), '[]'::jsonb)
                                                     from jsonb_array_elements_text(p.payload -> 'options') with ordinality o(t, n)),
                                         'closed', c.closed))
                                       from (select a.id, a.payload from acts_public a where a.kind = 'poll' and a.target_act_id = e.act order by a.created_at desc, a.id desc limit 1) p
                                       join poll_counts c on c.poll = p.id), '{}'::jsonb)
                          order by e.reactions desc, e.created_at desc, e.act) from excerpted e), '[]'::jsonb),
    'conversations', coalesce((select jsonb_agg(jsonb_build_object('thread', c.thread, 'title', c.title, 'persona', jsonb_build_object('staff', c.staff, 'character', c.persona),
                          'with', coalesce((select jsonb_agg(jsonb_build_object('id', w.character, 'name', w.name) order by w.name, w.character) from conv_with w where w.thread = c.thread and w.staff = c.staff), '[]'::jsonb),
                          'turns', c.turns, 'reactions', c.reactions,
                          'exchange', (select jsonb_build_object('text', b.turn_text, 'cut', b.turn_cut, 'reply', jsonb_build_object('character', b.reply_by, 'text', b.reply_text, 'cut', b.reply_cut)
                                                                                 || coalesce((select sb.j from see_by sb) -> b.reply_act::text, '{}'::jsonb))
                                              || coalesce((select sb.j from see_by sb) -> b.turn_act::text, '{}'::jsonb)
                                       from conv_best b where b.thread = c.thread and b.staff = c.staff))
                          order by c.reactions desc, c.turns desc, c.thread, c.staff) from conv c), '[]'::jsonb),
    'polls', coalesce((select jsonb_agg(jsonb_build_object('poll', p.poll, 'post', p.post, 'thread', p.thread, 'title', p.title, 'board', (select bn.name from boards_now bn where bn.id = p.board_id),
                          'seq', p.seq, 'extras', (select x.j from ex_by x) -> p.post::text) order by p.voters desc, p.created_at desc, p.poll) from poll_v p), '[]'::jsonb),
    'spins', coalesce((select jsonb_agg(jsonb_build_object('thread', s.thread, 'title', s.title, 'origin', s.origin) order by s.replies desc, s.created_at desc, s.thread) from spin_v s), '[]'::jsonb),
    'plays', coalesce((select jsonb_agg(jsonb_build_object('play', p.play, 'card', p.card, 'at', p.made_at, 'by', p.caster, 'config', p.config, 'state', p.state, 'text', p.words, 'covered', p.covered,
                          'post', p.post, 'thread', p.thread, 'title', p.title, 'seq', p.seq) order by p.drawn desc, p.played_at desc, p.play desc) from play_v p), '[]'::jsonb),
    'standouts', jsonb_build_object('days', stand_days,
      'cards', coalesce((select jsonb_agg(jsonb_build_object('character', s.character, 'name', s.name, 'count', s.n) order by s.n desc, s.name, s.character) from so s where s.category = 'cards'), '[]'::jsonb),
      'received', coalesce((select jsonb_agg(jsonb_build_object('character', s.character, 'name', s.name, 'count', s.n) order by s.n desc, s.name, s.character) from so s where s.category = 'received'), '[]'::jsonb),
      'polls', coalesce((select jsonb_agg(jsonb_build_object('character', s.character, 'name', s.name, 'count', s.n) order by s.n desc, s.name, s.character) from so s where s.category = 'polls'), '[]'::jsonb),
      'ballots', coalesce((select jsonb_agg(jsonb_build_object('character', s.character, 'name', s.name, 'count', s.n) order by s.n desc, s.name, s.character) from so s where s.category = 'ballots'), '[]'::jsonb),
      'spun', coalesce((select jsonb_agg(jsonb_build_object('character', s.character, 'name', s.name, 'count', s.n) order by s.n desc, s.name, s.character) from so s where s.category = 'spun'), '[]'::jsonb),
      'exchanges', coalesce((select jsonb_agg(jsonb_build_object('character', s.character, 'name', s.name, 'count', s.n) order by s.n desc, s.name, s.character) from so s where s.category = 'exchanges'), '[]'::jsonb)),
    'requests', requests_waiting(req_most),
    'requestsWaiting', requests_waiting_total(),
    'characters', coalesce((select jsonb_agg(jsonb_build_object('id', cp.id, 'name', cp.name, 'staff', cp.staff is not null and cp.office is distinct from 'anonymous',
                                                                'pronouns', (select p.pronouns from character_profiles p where p.character = cp.id)) order by cp.id)
                            from characters_public cp where cp.id in (select id from named)), '[]'::jsonb)
  ) into result;
  return result;
end $$;

alter function system_digest(timestamptz, timestamptz) owner to kayfabb_digest;
revoke create on schema public from kayfabb_digest;
revoke execute on function system_digest(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function system_digest(timestamptz, timestamptz) to service_role;

-- ----------------------------------------------------------------------------- the patrol reads whole posts --
-- (docs/plans/2026-11-25-digest-sees-the-board-plan.md, Task 4; design section 5.) patrol_sample(boards, most, pool, seed) is 0362's, with its draw and its order unchanged, and each sampled post now carries what the board shows with it:
--   the post's `post_extras` answer minus `post` (poll, plays, reactions, rewoundTo, and `body` replacing the words where a rewind shows another version, as pool_read does), asked once for the whole sample (the sampled posts and the origin posts below, at most 2 * `most`);
--   `origin`, for a post that opens a spun thread (it is the thread's first Act and the thread has an origin Act): exactly pool_read's `origin` (pool_read_origin(thread, row) with the origin post's own extras, and for a moment the plays as they stood), `post` being the full shape or null as pool_read gives it; null for any other post.
-- The words are the whole current words (SQL never cut them: the engine's excerpt did, and no longer does).
-- Grants and owner: patrol_sample stays owned by the digest role (the owner change 0110 and 0362 used: the role holds `create` on the schema while it happens and gives it back), and its door stays the service role's. post_extras and pool_read_origin are owned by that same role
-- (0426), so the function runs them as its owner with no new grant: none is needed and none is given. The masks are 0426's: everything arrives through post_extras and pool_read_origin, which read acts_public and the public views only, so no secret ballot's voter, no unsprung set and no owner is in the answer.
-- Settings: the planner settings 0426's functions carry (jit off, no seq or bitmap scan, no sort or incremental sort: every probe reads a table by its key), with the same search_path. The draw's own order by has no index to use and still runs (enable_sort only discourages a sort).
-- Cost at a busy instance: unchanged draw; then at most `most` origin probes (pool_read_origin reads a thread's row, the origin Act and its post by key) and one post_extras for at most 2 * `most` posts, which is bounded as 0426 bounds it. post_extras refuses above 200 posts, so `most` above 100 is refused plainly (the setting holds it to 25).

drop function patrol_sample(uuid[], integer, integer, bigint);
create function patrol_sample(boards uuid[], most integer, pool integer, seed bigint) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp set jit = off
  set enable_seqscan = off set enable_bitmapscan = off set enable_sort = off set enable_incremental_sort = off as $$
declare
  picked jsonb; e jsonb; org jsonb; opost jsonb; mp jsonb; act_id text; orgs jsonb := '{}'::jsonb; ids uuid[] := '{}'::uuid[]; ex jsonb; ex_by jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('act', s.id, 'thread', s.thread, 'title', s.title, 'board', s.board, 'name', s.name, 'pronouns', s.pronouns, 'body', s.body, 'trow', s.trow) order by s.created_at desc, s.id desc), '[]'::jsonb)
  into picked
  from (
    select k.id, k.thread, k.created_at, k.title, k.board, k.name, k.pronouns, k.body, k.trow
    from (
      select cand.*, -ln(h.u) / cand.weight as drawn
      from (
        select a.id, a.thread, a.created_at, th.title, th.board, c.name, (select cp.pronouns from character_profiles cp where cp.character = c.id) as pronouns,
               coalesce(a.current_payload ->> 'body', '') as body,
               coalesce((select max(w.weight) from watched_characters w where w.character = a.character), 1) as weight,
               case when th.origin_act_id is not null and a.id = th.first_act
                    then jsonb_build_object('origin_act_id', th.origin_act_id, 'created_at', th.t_created, 'origin_place', th.origin_place, 'first_act', th.first_act) end as trow
        from unnest(coalesce(boards, '{}'::uuid[])) with ordinality b(id, ord)
        cross join lateral (select t.id, t.title, t.board, t.origin_act_id, t.created_at as t_created, t.origin_place, t.first_act from thread_list t where t.board = b.id order by t.last_at desc, t.id desc limit greatest(patrol_sample.pool, 0)) th
        cross join lateral (
          select p.id, p.thread, p.character, p.created_at, p.current_payload
          from acts_public p
          where p.thread = th.id and p.kind in ('post', 'spin')
            and not exists (select 1 from acts_public v where v.kind = 'visit' and v.target_act_id = p.id)
          order by p.created_at desc, p.id desc limit greatest(patrol_sample.most, 0)
        ) a
        join characters_public c on c.id = a.character and c.staff is null
        where b.ord <= 50
        order by a.created_at desc, a.id desc
        limit greatest(patrol_sample.pool, 0)
      ) cand
      cross join lateral (select (hashtextextended(patrol_sample.seed::text || ':' || cand.id::text, 0)::numeric + 9223372036854775808 + 0.5) / 18446744073709551616 as u) h
    ) k
    order by k.drawn, k.id
    limit greatest(patrol_sample.most, 0)
  ) s;

  -- the origin of each post that opens a spun thread
  for e in select x from jsonb_array_elements(picked) x where jsonb_typeof(x -> 'trow') = 'object' loop
    org := pool_read_origin((e ->> 'thread')::uuid, e -> 'trow');
    if org is not null then
      orgs := orgs || jsonb_build_object(e ->> 'act', org);
      if jsonb_typeof(org -> 'post') = 'object' then ids := ids || (org #>> '{post,act}')::uuid; end if;
    end if;
  end loop;

  -- one post_extras for the sampled posts and the origin posts
  ids := array(select (x ->> 'act')::uuid from jsonb_array_elements(picked) x) || ids;
  ex := post_extras(ids);
  select coalesce(jsonb_object_agg(x ->> 'post', x - 'post'), '{}'::jsonb) into ex_by from jsonb_array_elements(ex) x;

  -- each origin, as pool_read gives it: its post with its extras, and for a moment the plays as they stood and the post's own words
  for act_id, org in select o.key, o.value from jsonb_each(orgs) o loop
    opost := org -> 'post';
    mp := org -> 'momentPlays';
    if jsonb_typeof(opost) = 'object' then
      opost := opost || coalesce(ex_by -> (opost ->> 'act'), '{}'::jsonb);
      if (org -> 'moment') = 'true'::jsonb then opost := opost || jsonb_build_object('body', org -> 'post' -> 'body', 'plays', coalesce(mp, '[]'::jsonb), 'rewoundTo', null); end if;
    end if;
    orgs := orgs || jsonb_build_object(act_id, (org - 'momentPlays') || jsonb_build_object('post', opost));
  end loop;

  return coalesce((
    select jsonb_agg(((x - 'trow') || coalesce(ex_by -> (x ->> 'act'), '{}'::jsonb) || jsonb_build_object('origin', orgs -> (x ->> 'act'))) order by n)
    from jsonb_array_elements(picked) with ordinality p(x, n)
  ), '[]'::jsonb);
end $$;
revoke execute on function patrol_sample(uuid[], integer, integer, bigint) from public, anon, authenticated;
grant execute on function patrol_sample(uuid[], integer, integer, bigint) to service_role;
-- The digest role's, as 0110, 0127 and 0362 left it: the owner change needs the role to hold create on the schema while it happens, and the grant is taken back at once.
grant create on schema public to kayfabb_digest;
alter function patrol_sample(uuid[], integer, integer, bigint) owner to kayfabb_digest;
revoke create on schema public from kayfabb_digest;
