# FanGaME's split: research

Record, written 2026-11-06, for `docs/plans/2026-11-06-fangame-split-design.md`.

- `fangame-portrait.webp`: the owner's picture of FanGaME (a personality core in a Mario cap and moustache, 1536 by
  2752), scaled to 512 by 917, the profile portrait's widest. 46 KB.
- `fangame-square.webp`: a 256 by 256 square cut from the same picture, framing the cap, the eye and the moustache; the
  owner approved the framing ("crop looks good"). 10 KB.

Both are inside a player's avatar limits (`supabase/functions/avatar/core.ts`, `LIMITS`). The plan's Task 10 copies them
into the instance's avatars.
