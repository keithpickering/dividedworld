-- The Strategy Guide's page learns the switch and the season's length (docs/plans/2026-11-21-gabes-voice-plan.md, Task 1): `systemEnabled` and `seasonLength` join the keys of `screen_settings`,
-- so the guide can pick a conditional on whether The System is switched on and say how long a season is.
--   1. screen_settings copied whole from 0416_crowd_floor_setting.sql (its latest): the two keys join the key list, nothing else changes. Grants as they were (replaced in place).
-- Masks. A setting is the instance's number, the same for every reader; nothing here is computed from a private fact, and the view is public as it was.

create or replace view screen_settings as
  select coalesce(jsonb_object_agg(s.key, s.value), '{}'::jsonb)
         || jsonb_build_object('cardEconomy', (
              select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
              from settings x cross join lateral jsonb_each(x.value) e
              where x.key = 'economy' and jsonb_typeof(x.value) = 'object'
                and e.key in (select unnest(k.reads) from card_kinds k)))
         || jsonb_build_object('groups', (
              select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('key', g.key, 'name', g.name, 'badge', g.badge, 'color', g.color, 'stripe', g.stripe, 'staff', g.condition = 'staff'))
                                        order by g.source = 'conferred', coalesce(g.rung, 0), g.key), '[]'::jsonb) from group_kinds g)) as settings
  from settings s
  where s.key in ('postsPerPage', 'hotReplies', 'editGrace', 'reactionCap', 'crowdPayEach', 'crowdFloor', 'crowdPayMost', 'charactersPerPlayer', 'invitesPerPlayer', 'inviteLifetime',
                  'turnCooldown', 'walletCap', 'postMaxLength', 'titleMaxLength', 'registrationMode', 'settlementLength', 'cardSettings',
                  'presencePollSeconds', 'presenceWindow', 'toastDefaults', 'economy', 'searchLanguage', 'searchRankPool', 'pronouns', 'setLasts',
                  'oldVoiceWindow', 'oldVoicePromptFloor',
                  'pollOptionsMax', 'pollQuestionMax', 'pollOptionMax', 'pollLastsMin', 'pollLastsMax',
                  'systemEnabled', 'seasonLength');
