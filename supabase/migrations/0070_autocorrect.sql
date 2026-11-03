-- A post's words and version for a card's rules, and a play decided against an older version refused.
-- docs/plans/2026-11-03-autocorrect-plan.md, Task 2.
--
-- A card that works on a post's words (an instance's phrase matcher) is decided by the act Edge Function against the post as
-- card_target reads it, and is written by play_card a moment later. An edit landing between the two would leave the play priced,
-- and its configuration checked, against words the post no longer has. So card_target says which version it read (the latest
-- edit's id, or the post's own id before any edit, as acts_public picks the latest edit, 0022), and the act function hands that
-- version back to play_card, which refuses the play once the post has moved on.
--
-- The check runs under the locks play_card already takes, the account's and then the post's (0058), in that order, and before it. An edit does not take that lock
-- (edit_post, 0005) and needs not: an edit committed after the check is an edit after the play, and the card's strips follow
-- the phrase into it (the design, section 2). Only the gap between the Edge Function's read and this write is closed here.
--
-- play_card's body (0058) is not copied: the version is checked by an overload that takes it, locks the post, compares, and
-- calls the nine-argument play_card in the same transaction, so one body holds the rules of a play.

-- The latest version of a post: its latest edit, or the post itself before any edit (acts_public's order, 0022).
create function post_version(post uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select x.id from acts x where x.kind = 'edit' and x.target_act_id = post order by x.created_at desc, x.id desc limit 1), post)
$$;
revoke execute on function post_version(uuid) from public, anon, authenticated;

-- card_target (0055), with the post's current words (`body`) and the version they are (`version`).
create or replace function card_target(target uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('reach', 'post', 'act', a.id, 'kind', a.kind,
    'length', char_length(coalesce(a.current_payload ->> 'body', '')),
    'body', coalesce(a.current_payload ->> 'body', ''),
    'version', post_version(a.id),
    'effects', coalesce((select jsonb_agg(e.effect order by e.at, e.id) from (
        select k.created_at as at, k.id, jsonb_strip_nulls(jsonb_build_object('card', k.payload ->> 'card', 'act', k.id,
          'ward', case when ck.ward then ck.rarity end, 'ends', k.payload ->> 'ends')) as effect
        from acts k left join card_kinds ck on ck.key = k.payload ->> 'card'
        where k.kind = 'card' and k.target_act_id = a.id and not (k.payload ? 'caught') and coalesce(k.payload ->> 'reach', 'post') = 'post'
        union all
        select s.created_at, s.id, jsonb_build_object('card', null, 'act', s.id, 'faceDown', true,
          'ends', to_jsonb(coalesce(least(sp.created_at, f.ends_at), f.ends_at)))
        from acts s join face_down f on f.play = s.id
        left join acts sp on sp.kind = 'spring' and (sp.payload ->> 'set') = s.id::text
        where s.kind = 'set' and s.target_act_id = a.id
      ) e), '[]'))
  from acts_public a where a.id = target
$$;

-- play_card, given the version its play was decided against: refused, in the same words for everyone, once the post has another.
create function play_card(who uuid, card text, through uuid, target uuid, config jsonb, price integer, message text,
                          reach text, from_post uuid, version uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if version is not null and reach = 'post' then
    -- The locks the nine-argument play_card takes, in its order (0058): the player's account, then the post. Taken here first,
    -- so the check and the play see one post; the same locks again inside it are no wait. The other order would deadlock with
    -- any play of this player's that takes the account first and the post after (a character play from this post).
    perform 1 from accounts where id = who for no key update;
    perform 1 from acts a where a.id = target and a.kind = 'post' for no key update;
    if found and post_version(target) is distinct from version then
      raise exception 'the post was edited; look again' using hint = 'kayfabb.refusal', errcode = '55000';
    end if;
  end if;
  return play_card(who, card, through, target, config, price, message, reach, from_post);
end $$;
revoke execute on function play_card(uuid, text, uuid, uuid, jsonb, integer, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function play_card(uuid, text, uuid, uuid, jsonb, integer, text, text, uuid, uuid) to service_role;
