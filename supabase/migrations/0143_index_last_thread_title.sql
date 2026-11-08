-- The index's Last post names the thread it points at. index_page (0125) and boot (0125) each hand a board's latest thread as `last_thread` (its id); they now hand its
-- `last_title` too, read from the same thread_list row, so no extra read and nothing new is exposed: a thread's title is public to whoever may read the board's list.
-- Both functions are otherwise as 0125 wrote them; signatures and return types are unchanged, so each is replaced and its grants stand.

-- index_page

create or replace function index_page() returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  with bs as materialized (
    select b.id, b.slug, b.name, b.description, b.is_system, b.move_act, b.created_at,
           coalesce(c.threads, 0) as thread_count, l.id as last_thread, l.title as last_title, l.last_at, l.last_character
    from boards_now b
    left join board_counts c on c.board = b.id
    left join lateral (
      select t.id, t.title, t.last_at, t.last_character from thread_list t where t.board = b.id order by t.last_at desc limit 1
    ) l on true
  )
  select jsonb_build_object(
    'boards', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', b.id, 'slug', b.slug, 'name', b.name, 'description', b.description, 'is_system', b.is_system, 'move_act', b.move_act,
                 'thread_count', b.thread_count, 'last_at', b.last_at, 'last_character', b.last_character, 'last_thread', b.last_thread, 'last_title', b.last_title)
               order by b.created_at, b.id), '[]'::jsonb) from bs b),
    'characters', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', c.id, 'name', c.name, 'joined', c.joined, 'staff', c.staff, 'office', c.office,
                     'profile', case when f.character is null then null else jsonb_build_object(
                       'title', f.title, 'signature', f.signature, 'avatar_square', f.avatar_square, 'avatar_portrait', f.avatar_portrait,
                       'square_frame', f.square_frame, 'portrait_frame', f.portrait_frame, 'pip_style', f.pip_style, 'pronouns', f.pronouns) end)), '[]'::jsonb)
                   from characters_public c left join character_profiles f on f.character = c.id
                   where c.id in (select b.last_character from bs b where b.last_character is not null)),
    'presence', presence_box('index', null),
    'unread', my_alerts_unread());
end;

-- boot (0115's, which carries the account's `mode`), also handing each of the player's own faces its pronouns.

create or replace function boot() returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  select jsonb_build_object(
    'settings', (select s.settings from screen_settings s limit 1),
    'account', (select to_jsonb(whoami())),
    'preferences', (select to_jsonb(p) from (
      select a.theme, a.postbit, a.motion, a.smoke, a.contrast, a.text_size, a.tilt, a.mode, a.cards_met, a.alerts_seen_at, a.settlement_seen, a.toasts, a.welcomed_at, a.tips, a.tips_seen
      from account_preferences a limit 1) p),
    'characters', coalesce((select jsonb_agg(to_jsonb(c) order by c.name) from my_characters c), '[]'::jsonb),
    'faces', coalesce((
      select jsonb_agg(f.face order by f.name) from (
        select cp.name, to_jsonb(cp) || jsonb_build_object('profile', (
          select to_jsonb(p) from (
            select r.character, r.title, r.signature, r.avatar_square, r.avatar_portrait, r.square_frame, r.portrait_frame, r.pip_style, r.pronouns
            from character_profiles r where r.character = cp.id) p)) as face
        from characters_public cp where cp.id in (select m.id from my_characters m)) f), '[]'::jsonb),
    'wallet', (select to_jsonb(w) from (select mw.balance, mw.cap from my_wallet mw limit 1) w),
    'cards', coalesce((select jsonb_agg(to_jsonb(k) order by k.card) from (select mc.card, mc.held from my_cards mc) k), '[]'::jsonb),
    'boards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'slug', b.slug, 'name', b.name, 'description', b.description, 'is_system', b.is_system, 'move_act', b.move_act,
        'thread_count', coalesce(bc.threads, 0), 'last_at', l.last_at, 'last_character', l.last_character, 'last_thread', l.id, 'last_title', l.title) order by b.created_at, b.id)
      from boards_now b
      left join board_counts bc on bc.board = b.id
      left join lateral (select t.id, t.title, t.last_at, t.last_character from thread_list t where t.board = b.id order by t.last_at desc limit 1) l on true), '[]'::jsonb),
    'admin', coalesce(is_admin(), false),
    'unread', case when whoami() is null then 0 else my_alerts_unread() end,
    'nextSettlementAt', next_settlement_at(),
    'lastSettledAt', (select s.ends_at from settlements s order by s.ends_at desc limit 1),
    'newestSettlement', (select s.ends_at from settlements s where s.id = (select max(l.settlement) from my_ledger l))
  );
end;
