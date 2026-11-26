-- screen_settings carries the switch and the season's length (0434, docs/plans/2026-11-21-gabes-voice-plan.md Task 1): `systemEnabled` as a boolean and `seasonLength` as a span,
-- and every key the view held before (0416) it still holds, so a key dropped in the copy is red.

do $$
declare
  seen jsonb;
  k text;
begin
  insert into settings (key, value) values
    ('systemEnabled', 'true'::jsonb), ('seasonLength', '{"unit": "week", "count": 8}'::jsonb)
  on conflict (key) do update set value = excluded.value;
  seen := (select settings from screen_settings);
  if jsonb_typeof(seen -> 'systemEnabled') is distinct from 'boolean' then raise exception 'systemEnabled is a boolean on the screens: %', seen -> 'systemEnabled'; end if;
  if not setting_span(seen -> 'seasonLength', array['day', 'week', 'month']) then raise exception 'seasonLength is a span on the screens: %', seen -> 'seasonLength'; end if;
  if seen -> 'seasonLength' is distinct from '{"unit": "week", "count": 8}'::jsonb then raise exception 'seasonLength is the setting''s own'; end if;
  -- Every key the view held before is still listed: one the instance holds still shows.
  foreach k in array array['postsPerPage', 'crowdFloor', 'settlementLength', 'registrationMode', 'turnCooldown', 'setLasts', 'pollLastsMax'] loop
    if (select count(*) from settings where key = k) = 1 and not seen ? k then raise exception 'screen_settings dropped %', k; end if;
  end loop;
  if not seen ? 'cardEconomy' or not seen ? 'groups' then raise exception 'screen_settings dropped cardEconomy or groups'; end if;
end $$;

-- The key list itself (the view's text), so a key the instance has no row for is still checked: every one of the earlier keys is named, and so are the two new.
do $$
declare
  def text := pg_get_viewdef('public.screen_settings'::regclass);
  k text;
begin
  foreach k in array array['postsPerPage', 'hotReplies', 'editGrace', 'reactionCap', 'crowdPayEach', 'crowdFloor', 'crowdPayMost', 'charactersPerPlayer', 'invitesPerPlayer', 'inviteLifetime',
                  'turnCooldown', 'walletCap', 'postMaxLength', 'titleMaxLength', 'registrationMode', 'settlementLength', 'cardSettings',
                  'presencePollSeconds', 'presenceWindow', 'toastDefaults', 'economy', 'searchLanguage', 'searchRankPool', 'pronouns', 'setLasts',
                  'oldVoiceWindow', 'oldVoicePromptFloor',
                  'pollOptionsMax', 'pollQuestionMax', 'pollOptionMax', 'pollLastsMin', 'pollLastsMax', 'systemEnabled', 'seasonLength'] loop
    if position('''' || k || '''' in def) = 0 then raise exception 'the view''s key list lacks %', k; end if;
  end loop;
end $$;
