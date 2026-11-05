-- boot(): the frame and the HUD in one read (the forum-load design, sections 2 and 3; its plan, Task 7).
-- Every screen starts by asking the same dozen questions: the settings, who the caller is, her preferences, her characters and their
-- faces, her wallet and hand, the boards, how many alerts are unread, when the next settlement is and what the last one was. This
-- answers them as one document. Each piece is exactly what the adapter reads today, from the same views and functions, with the same
-- columns; nothing is computed here that those reads did not compute.
--
-- Public projections and the caller's own rows, as the caller (security invoker): a view's own policy decides what she sees, so
-- another player's characters, wallet and hand are absent by the same rule that hides them from a direct read. It writes nothing,
-- reads only what a screen may read (tools/check-web-reads.mjs) and is stable, which supabase/tests/e2e/0016-screen-reads.ts holds.
-- A signed-in caller with no account yet gets `account` null and the public pieces (settings, boards, times). A visitor is refused:
-- a signed-out load reads settings() alone, as today.
--
-- `unread` is 0 for a caller with no account, whom my_alerts_unread() refuses.
-- `boards` is index_page's boards piece, computed the way the adapter's boards() reads it: boards_now in creation order, each with
-- board_counts' threads and its newest listed thread by the (board, last_at) index, one index probe a board.
-- `newestSettlement` is the end of the newest settlement the caller has ledger lines in, as log() reads its first settlement;
-- `lastSettledAt` is the end of the newest settlement of all.

create function boot() returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  select jsonb_build_object(
    'settings', (select s.settings from screen_settings s limit 1),
    'account', (select to_jsonb(whoami())),
    'preferences', (select to_jsonb(p) from (
      select a.theme, a.postbit, a.motion, a.smoke, a.contrast, a.text_size, a.cards_met, a.alerts_seen_at, a.settlement_seen, a.toasts, a.welcomed_at, a.tips, a.tips_seen
      from account_preferences a limit 1) p),
    'characters', coalesce((select jsonb_agg(to_jsonb(c) order by c.name) from my_characters c), '[]'::jsonb),
    'faces', coalesce((
      select jsonb_agg(f.face order by f.name) from (
        select cp.name, to_jsonb(cp) || jsonb_build_object('profile', (
          select to_jsonb(p) from (
            select r.character, r.title, r.signature, r.avatar_square, r.avatar_portrait, r.square_frame, r.portrait_frame, r.pip_style
            from character_profiles r where r.character = cp.id) p)) as face
        from characters_public cp where cp.id in (select m.id from my_characters m)) f), '[]'::jsonb),
    'wallet', (select to_jsonb(w) from (select mw.balance, mw.cap from my_wallet mw limit 1) w),
    'cards', coalesce((select jsonb_agg(to_jsonb(k) order by k.card) from (select mc.card, mc.held from my_cards mc) k), '[]'::jsonb),
    'boards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'slug', b.slug, 'name', b.name, 'description', b.description, 'is_system', b.is_system, 'move_act', b.move_act,
        'threads', coalesce(bc.threads, 0), 'last_at', l.last_at, 'last_character', l.last_character, 'last_thread', l.id) order by b.created_at)
      from boards_now b
      left join board_counts bc on bc.board = b.id
      left join lateral (select t.id, t.last_at, t.last_character from thread_list t where t.board = b.id order by t.last_at desc limit 1) l on true), '[]'::jsonb),
    'unread', case when whoami() is null then 0 else my_alerts_unread() end,
    'nextSettlementAt', next_settlement_at(),
    'lastSettledAt', (select s.ends_at from settlements s order by s.ends_at desc limit 1),
    'newestSettlement', (select l.ends_at from my_ledger l order by l.ends_at desc limit 1)
  );
end;

revoke all on function boot() from public, anon, authenticated;
grant execute on function boot() to authenticated;
