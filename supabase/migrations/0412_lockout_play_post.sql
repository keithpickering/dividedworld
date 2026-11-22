-- A back that sprang into a lockout is in force while that lockout is (docs/plans/2026-11-22-lockout-in-force-design.md, decision 6; plan Task 4, #991).
-- Post plays kept such a back over at its spring and held it up only through `lock_until`, as a stand-in or a probe of play_post_lock. The kept row now agrees with the screen: a back that sprang into a lockout (its spring's `did` is `lockedOut`, the earliest such
-- spring where more than one names it) takes the spring's `until` as its `ends_at`, and an admin's `card_end` of that spring as its `over_at` (null where none); `sprung` stays true. Any other back is as post plays left it. `lock_until` is untouched and now redundant with `ends_at` for
-- a live lockout (it still names the lockout an admin did not end).
--
--   1. play_row              0408's, whole, with the set arms of `ends_at` and `over_at` changed for a back with a lockedOut spring (a lateral probe of that spring by `set`, the same index probe lock_until makes). Nothing else changes.
--   2. play_post_on_act      unchanged, not redefined: 0408 already refreshes the back a spring's `card_end` names (its `card_end` branch), which is the trigger line this change needs.
--   3. post_effects_up       0411's, whole, with one change: a back that sprang (`sprung`) is no slot. It is a live back (kind '') only while face down; a sprung back's kind is '' and draws no effect, and now that a live lockout back is in force the count would take it for one.
--   4. the backfill          refresh_play_post for each back with a lockedOut spring, and only those.
--
-- Every reader of play_post's in-force rows, and what a live lockout back (kind '', sprung, over_at null, ends_at = until) does to it:
--   post_play_ids (0410)     holds it in the in-force arms (over_at null, ends_at ahead); its lock_until arm names it too, and the union is distinct. After the lockout ends or an admin ends it, it is a stand-in only if the newest or most drawn sprung back.
--   kind_play_ids (0410)     skips it while in force (its "not in force" test), so a page of Ended never reads a live lockout; once `until` passes it reads it, as it does any play out of force.
--   post_kind_counts (0410)  reads post_kinds, counted by play_post_counts (kind <> '' or sprung): a sprung back already counted, in force or not; unchanged.
--   play_rider_ids (0410)    reads Acts by the plays post_play_ids names; a live lockout back brings its spring as before.
--   post_plays, kind_plays, thread_page (0410) read through the four above; nothing of their own from play_post.
--   post_effects_up (0411)   see 3. post_room_words and every caller (place_cast, place_set) read it, so the limit on drawing effects is the same with a live lockout back as without.
--   play_post_drift (0409)   holds the row to play_row as for every row; the trigger above keeps it.
--   play_post_up, play_post_lock, the two stand-in indexes: probes of the columns above; a lockout back is in play_post_up while live (ends_at ahead), as every other timed play is.
-- Ways out: a lockout ends by itself at its `until`, or by an admin's end; the row says both. Masks: `until` and the `card_end` are public Acts; the row holds no private fact.
-- Cost at a busy instance's scale: the lateral probe is one index lookup by `set` for a back and none for any other play; the backfill touches only backs with a lockedOut spring.

create or replace function play_row(play uuid) returns play_post
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id, a.target_act_id,
         case when a.kind = 'card' then coalesce(a.payload ->> 'card', '') else '' end,
         case when a.kind = 'card' then coalesce(a.payload ->> 'reach', 'post') else 'post' end,
         a.created_at,
         case when a.kind = 'set' then coalesce((ls.payload ->> 'until')::timestamptz, f.ends_at)
              else least((a.payload ->> 'ends')::timestamptz, pr.ends_at,
                         case when ck.drive is not null and coalesce(a.payload ->> 'reach', 'post') = 'post' and not (a.payload ? 'caught') then
                           (select coalesce(max(k.created_at) filter (where not card_ended(k.id)), max(k.created_at)) from acts k
                            where k.kind = 'card' and k.target_act_id = a.target_act_id and k.payload ->> 'card' = a.payload ->> 'card' and not (k.payload ? 'caught')
                              and coalesce(k.payload ->> 'reach', 'post') = 'post' and coalesce(k.payload ->> 'drive', k.id::text) = coalesce(a.payload ->> 'drive', a.id::text))
                           + span_interval(ck.drive -> 'lasts') end) end,
         case when a.kind = 'set' and ls.id is not null then
                (select min(e.created_at) from acts e where e.kind = 'card_end' and e.target_act_id = ls.id)
              when a.kind = 'set' then
                least((select min(s.created_at) from acts s where s.kind = 'spring' and (s.payload ->> 'set') = a.id::text),
                      (select min(tb.created_at) from acts tb where tb.kind = 'take_back' and (tb.payload ->> 'set') = a.id::text))
              else
                least(case when a.payload ? 'caught' or a.payload ? 'instant' then a.created_at end,
                      (select min(e.created_at) from acts e where e.kind = 'card_end' and e.target_act_id = a.id),
                      rf.at,
                      (select min(c.created_at) from acts c where c.kind = 'card' and c.payload ? 'pierce' and (c.payload #>> '{pierce,by}') = a.id::text),
                      card_cut_at(a.id)) end,
         rf.play is null,
         a.kind = 'set' and exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = a.id::text),
         coalesce((select sum(t.count) from reaction_tallies t where t.act = a.id), 0)::integer + (select count(*) from threads th where th.origin_act_id = a.id)::integer,
         case when a.kind = 'set' then (select min((s.payload ->> 'until')::timestamptz) from acts s where s.kind = 'spring' and (s.payload ->> 'set') = a.id::text and s.payload ->> 'did' = 'lockedOut'
                                                                   and not exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = s.id)) end
  from acts a
  left join face_down f on f.play = a.id and a.kind = 'set'
  left join lateral (select s.id, s.payload from acts s where a.kind = 'set' and s.kind = 'spring' and (s.payload ->> 'set') = a.id::text and s.payload ->> 'did' = 'lockedOut'
                      order by s.created_at, s.id limit 1) ls on true
  left join play_reach pr on pr.play = a.id and a.kind = 'card'
  left join card_write_refunds rf on rf.play = a.id and a.kind = 'card'
  left join card_kinds ck on ck.key = a.payload ->> 'card' and a.kind = 'card'
  where a.id = play_row.play and a.kind in ('card', 'set') and a.target_act_id is not null
$$;
revoke execute on function play_row(uuid) from public, anon, authenticated, service_role;

create or replace function post_effects_up(post uuid) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::integer from play_post p
  where p.post = post_effects_up.post and p.reach = 'post' and p.over_at is null and (p.ends_at is null or p.ends_at > now())
    and ((p.kind = '' and not p.sprung) or exists (select 1 from card_kinds k where k.key = p.kind and k.draws_effect))
    and not effect_cleared(p.play, post_version(p.post))
$$;
revoke execute on function post_effects_up(uuid) from public, anon, authenticated;

-- ---- the backfill ----

-- Each back that sprang into a lockout, and no other: the row it kept (over at its spring) is rewritten from play_row.
select refresh_play_post(b.id) from (select distinct (s.payload ->> 'set')::uuid as id from acts s where s.kind = 'spring' and s.payload ->> 'did' = 'lockedOut') b where exists (select 1 from acts x where x.id = b.id);
