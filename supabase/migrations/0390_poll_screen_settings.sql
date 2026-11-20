-- Polls: the poll settings on the screens (docs/plans/2026-11-20-polls-plan.md, Task 6).
-- The poll editor says "Add option" only up to pollOptionsMax, offers only the lengths between pollLastsMin and pollLastsMax, and says a too-long question or option in the words poll_written
-- does, so a screen reads the five settings 0388 holds. screen_settings (0383's) also shows them; everything else in the view is as 0383 left it, and so are its grants.
-- Masks. Settings hold the instance's numbers; nothing here is computed from a private fact, and the view is public as it was.

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
  where s.key in ('postsPerPage', 'hotReplies', 'editGrace', 'reactionCap', 'crowdPayEach', 'crowdPayMost', 'charactersPerPlayer', 'invitesPerPlayer', 'inviteLifetime',
                  'turnCooldown', 'walletCap', 'postMaxLength', 'titleMaxLength', 'registrationMode', 'settlementLength', 'cardSettings',
                  'presencePollSeconds', 'presenceWindow', 'toastDefaults', 'economy', 'searchLanguage', 'searchRankPool', 'pronouns', 'setLasts',
                  'oldVoiceWindow', 'oldVoicePromptFloor',
                  'pollOptionsMax', 'pollQuestionMax', 'pollOptionMax', 'pollLastsMin', 'pollLastsMax');
