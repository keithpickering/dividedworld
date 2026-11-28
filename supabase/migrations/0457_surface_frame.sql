-- What a post shows in its content area, for the server function to hold a draw's declared frame to (issue #1259; the owner's answer, option 1: "the server bounds the declared box against the post"). A tag is counted in the
-- box its drawer's screen declares (0456), while every reader's screen draws it rigid in ems or in image widths, so a box declared taller than its post makes a tag count less than it covers. The act function lays the post out
-- from what this read gives (engine/rules/frame.ts, `tallestBox`) and refuses a box taller than that before any write.
--
-- surface_frame_of(post): {kind, versions: [{body, forged}], signature, poll: {question, options} | null}, or null for an Act that is no post or spun thread's opening Act. Every version of the post is given, oldest first,
-- because a live rewind shows an older one in place of the current words (0413), and the tallest of them is what the box may honestly be. The signature is the one the post is shown with: its character's as acts_public
-- projects the post (a veil's stand-in, where a veil is up, never the hidden author's). The poll is the post's current one (latest_poll, 0395), null when there is none or it was removed. Words are read through acts_public,
-- so a version an admin hid has an empty body, as surface_version_pair reads it (0456).
--
-- Masks ("A response never proves a private fact"): every field is what any reader of the post's page is shown. It reads no owner and is the same for every caller. Service role only, as 0456's two reads.
-- Cost: one read of the post's versions (the post and its edits, by acts' target index), one profile row and one poll; a draw is a player's own act, never a page's.

create function surface_frame_of(p_post uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'kind', q.kind,
    'versions', coalesce((select jsonb_agg(jsonb_build_object('body', coalesce(v.payload ->> 'body', ''), 'forged', coalesce(v.payload -> 'forged', '[]'::jsonb)) order by v.created_at, v.id)
                          from acts_public v where v.id = q.id or (v.kind = 'edit' and v.target_act_id = q.id)), '[]'::jsonb),
    'signature', coalesce((select p.signature from character_profiles p where p."character" = q.character), ''),
    'poll', (select case when l.payload ? 'removed' then null else jsonb_build_object('question', coalesce(l.payload ->> 'question', ''), 'options', coalesce(l.payload -> 'options', '[]'::jsonb)) end
             from acts_public l where l.id = latest_poll(q.id)))
  from acts_public q where q.id = p_post and q.kind in ('post', 'spin')
$$;
revoke execute on function surface_frame_of(uuid) from public, anon, authenticated;
grant execute on function surface_frame_of(uuid) to service_role;
