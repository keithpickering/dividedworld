-- The numbers a card gives the screens reach them.
--
-- A card's effect can decide something on the client: Whoops! (the cards plan's Task 5; the screens'
-- design, section 11) calls a layer washed clean once this share of it, in whole percent, is scrubbed
-- away, and the post author's save then marks the layer clean for everyone. Such a number is neither
-- the engine's (the engine names no card) nor the economy's (which no screen reads and
-- screen_settings keeps out): it is `cardSettings`, an object of named numbers an instance fills
-- ({"whoops.clean": 95} for Divided World), and it joins the keys screen_settings lists (0030). Like
-- postsPerPage it is a row of the settings table that seed_instance() writes from the instance's
-- settings, needing no SQL of its own; an instance seeded before this migration holds none until it
-- is seeded again, and screen_settings simply returns what the table holds (the web falls back to
-- the compiled settings, and an effect to its own default).
--
-- Nothing here is a private fact: they are numbers the whole instance shares.
create or replace view screen_settings as
  select coalesce(jsonb_object_agg(s.key, s.value), '{}'::jsonb) as settings
  from settings s
  where s.key in ('postsPerPage', 'hotReplies', 'editGrace', 'reactionCap', 'charactersPerPlayer', 'invitesPerPlayer', 'inviteLifetime',
                  'turnCooldown', 'walletCap', 'postMaxLength', 'titleMaxLength', 'registrationMode', 'settlementLength', 'cardSettings');
