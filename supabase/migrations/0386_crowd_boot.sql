-- boot (0368's, whole): `newestSettlement` is the newest settlement the caller has a line in, and crowd pay is a line (docs/plans/2026-11-20-crowd-pay-plan.md, Task 5): the settlement is the newest over my_ledger and my_crowd_paid (0384),
-- so a settlement that paid the caller crowd pay alone opens the summary on the first load. Both are the caller's own rows and name no one else; everything else as 0368 wrote it. Its grants are 0097's, kept by replacing in place.

create or replace function public.boot()
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return (
  SELECT jsonb_build_object('settings', ( SELECT s.settings
            FROM screen_settings s
          LIMIT 1), 'account', ( SELECT to_jsonb(whoami()) AS to_jsonb), 'preferences', ( SELECT to_jsonb(p.*) AS to_jsonb
            FROM ( SELECT a.theme,
                     a.postbit,
                     a.motion,
                     a.smoke,
                     a.contrast,
                     a.text_size,
                     a.tilt,
                     a.effects,
                     a.game_sound,
                     a.game_volume,
                     a.interface_sound,
                     a.interface_volume,
                     a.mode,
                     a.cards_met,
                     a.alerts_seen_at,
                     a.settlement_seen,
                     a.toasts,
                     a.welcomed_at,
                     a.tips,
                     a.tips_seen
                    FROM account_preferences a
                  LIMIT 1) p), 'characters', COALESCE(( SELECT jsonb_agg(to_jsonb(c.*) ORDER BY c.name) AS jsonb_agg
            FROM my_characters c), '[]'::jsonb), 'faces', COALESCE(( SELECT jsonb_agg(f.face ORDER BY f.name) AS jsonb_agg
            FROM ( SELECT cp.name,
                     (to_jsonb(cp.*) || jsonb_build_object('profile', ( SELECT (to_jsonb(p.*) || profile_cosmetics(p."character"))
                            FROM ( SELECT r."character",
                                     r.title,
                                     r.signature,
                                     r.avatar_square,
                                     r.avatar_portrait,
                                     r.square_frame,
                                     r.portrait_frame,
                                     r.pip_style,
                                     r.pronouns
                                    FROM character_profiles r
                                   WHERE (r."character" = cp.id)) p))) AS face
                    FROM characters_public cp
                   WHERE (cp.id IN ( SELECT m.id
                            FROM my_characters m))) f), '[]'::jsonb), 'wallet', ( SELECT to_jsonb(w.*) AS to_jsonb
            FROM ( SELECT mw.balance,
                     mw.cap
                    FROM my_wallet mw
                  LIMIT 1) w), 'cards', COALESCE(( SELECT jsonb_agg(to_jsonb(k.*) ORDER BY k.card) AS jsonb_agg
            FROM ( SELECT mc.card,
                     mc.held
                    FROM my_cards mc) k), '[]'::jsonb), 'boards', COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', b.id, 'slug', b.slug, 'name', b.name, 'description', b.description, 'is_system', b.is_system, 'move_act', b.move_act, 'thread_count', COALESCE(bc.threads, 0), 'last_at', l.last_at, 'last_character', l.last_character, 'last_thread', l.id, 'last_title', l.title) ORDER BY b.created_at, b.id) AS jsonb_agg
            FROM ((boards_now b
              LEFT JOIN board_counts bc ON ((bc.board = b.id)))
              LEFT JOIN LATERAL ( SELECT t.id,
                     t.title,
                     t.last_at,
                     t.last_character
                    FROM thread_list t
                   WHERE (t.board = b.id)
                   ORDER BY t.last_at DESC
                  LIMIT 1) l ON (true))), '[]'::jsonb), 'admin', COALESCE(is_admin(), false), 'unread',
         CASE
             WHEN (whoami() IS NULL) THEN 0
             ELSE my_alerts_unread()
         END, 'nextSettlementAt', next_settlement_at(), 'lastSettledAt', ( SELECT s.ends_at
            FROM settlements s
           ORDER BY s.ends_at DESC
          LIMIT 1), 'newestSettlement', ( SELECT s.ends_at
            FROM settlements s
           WHERE (s.id = ( SELECT max(l.settlement) AS max
                    FROM ( SELECT m.settlement FROM my_ledger m
                          UNION ALL
                          SELECT c.settlement FROM my_crowd_paid c) l)))) AS jsonb_build_object
  );
end
$function$;
