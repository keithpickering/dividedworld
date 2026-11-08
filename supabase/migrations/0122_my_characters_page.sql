-- my_characters_page(): /characters and /characters/edit in one read (the glass-load design, section 7; its plan, Task 5).
-- The Characters screen reads the caller's characters, then for the debuted ones their public faces and profiles, their standing, their announced
-- Turns, their post counters and when the next settlement is. This answers them as one document, so choosing another character on the screen
-- reads nothing more.
--
-- `characters` is the caller's own characters, by name, one object each: the my_characters row as the adapter's myCharacters reads it, with
--   `face`      the characters_public row joined to its character_profiles row (the shape of boot's `faces` piece; null while the character
--               has not debuted, which characters_public does not show),
--   `counts`    its character_post_counts row (null where it has done nothing),
--   `standing`  current_standings.standing (null where the season's standings hold no row for it; the adapter's standingAmounts reads that as 0),
--   `reveals`   its class_reveals rows and `turns` its turns_announced rows, oldest first.
-- `nextSettlementAt` is next_settlement_at().
--
-- Bounded by the caller's own characters. Every piece is a public projection or the caller's own row, read as the caller (security invoker): a
-- view's own policy decides what she sees, so another player's characters are absent by the same rule that hides them from a direct read. It
-- writes nothing, reads only what a screen may read (tools/check-web-reads.mjs) and is stable, which supabase/tests/e2e/0016-screen-reads.ts
-- holds. A signed-in caller with no account gets an empty list; a visitor is refused.

create function my_characters_page() returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  select jsonb_build_object(
    'characters', coalesce((
      select jsonb_agg(
        to_jsonb(c) || jsonb_build_object(
          'face', (
            select to_jsonb(cp) || jsonb_build_object('profile', (
              select to_jsonb(p) from (
                select r.character, r.title, r.signature, r.avatar_square, r.avatar_portrait, r.square_frame, r.portrait_frame, r.pip_style
                from character_profiles r where r.character = cp.id) p))
            from characters_public cp where cp.id = c.id),
          'counts', (select to_jsonb(n) from (select k.character, k.posts, k.spins, k.cards from character_post_counts k where k.character = c.id) n),
          'standing', (select s.standing from current_standings s where s.character = c.id),
          'reveals', coalesce((select jsonb_agg(to_jsonb(r) order by r.at, r.act::text collate "C") from (
            select v.act, v.character, v.class, v.at, v.via, v.thread from class_reveals v where v.character = c.id) r), '[]'::jsonb),
          'turns', coalesce((select jsonb_agg(to_jsonb(t) order by t.at, t.act::text collate "C") from (
            select u.act, u.character, u.at, u.was from turns_announced u where u.character = c.id) t), '[]'::jsonb))
        order by c.name)
      from my_characters c), '[]'::jsonb),
    'nextSettlementAt', next_settlement_at()
  );
end;

revoke all on function my_characters_page() from public, anon, authenticated;
grant execute on function my_characters_page() to authenticated;
