# Cut excerpts and an order that outlives its office: the design

Record, written 2026-11-13. A design session with the owner on the two new findings of the second season rehearsal
(`docs/research/2026-11-13-season-rehearsal-run-2/README.md`, carried in this design's PR). The plan is
`docs/plans/2026-11-13-excerpts-and-orders-plan.md`.

## 1. A cut excerpt reads as the author's (new finding 1)

The staff are shown other posts in excerpt, and an excerpt that was cut ends mid-word with nothing to say so. They
review the cut as the author's: QC-1000 filed FanGaME's complete farewell "as a demo" because it "cuts off at Plumber
Platfo" (run 2, day 91), and ONTOPIC 5.0 faulted a post for stopping "at the word will" (run 1). Four times in run 2.

**Where the cuts are.** Two kinds, and only one marks itself:

- **Cut in SQL, never marked.** `pool_thread` (`supabase/migrations/0317_surfaces.sql`) returns each post as
  `left(body, chars)`; chatter, reports and appeals read it, so the engine's own `clip` (which does add "…") never sees a
  string over its bound. `system_digest` (`0359_post_reactions.sql`) cuts the meeting digest's excerpts the same way.
- **Cut in the engine.** `engine/system/chatter.ts` and `engine/system/judgment.ts` each have a `clip` that adds "…";
  `engine/system/digest.ts` and `engine/system/apology.ts` each have one that does not.

**Decided (the owner): every cut is marked.** Every post excerpt any model reads ends in "…" when the game shortened
it, through one engine function, and every prompt that shows excerpts says once that "…" at the end of an excerpt means
the game shortened it for space and its author wrote more. This covers chatter, reports, appeals, patrols, apologies and
the meeting digest. Weighed: fixing only chatter and appeals, where the bots complained (the digest and patrol samples
would keep the same trap for the Boss and the Mods); showing the full post being replied to (more tokens on every reply,
and the thread around it would still be cut).

How:

- **One function** in the engine, `excerpt(text, most, cut)` (`engine/system/excerpt.ts`): the text on one line; where
  it is over `most` or `cut` says the source already shortened it, it is cut at a word with `cutAtWord`
  (`engine/system/validate.ts`, #658) and ends in "…". The four `clip`s use it for post text. A name or a title keeps
  the cut it has.
- **The source says when it cut.** `pool_thread` and `system_digest` return, beside each excerpt, `cut`: whether the
  post's words were longer than `chars`. A flag, not one character more of text, so a reader that does not know the
  setting (`renderDigest` slices to the ceiling, `DIGEST_MOST.excerptChars`) still knows. The words are read the same way
  as today, so nothing about who can see a post changes.
- **One sentence**, `EXCERPT_WORDS` in `engine/system/excerpt.ts`, shown once in each prompt that shows excerpts:
  "An excerpt that ends in … was shortened by the game for space; its author wrote more." Plain, never in character.

## 2. An order outlives its office (new finding 2)

At every meeting `apply_meeting` (`0338_handoff_carry.sql`) carries forward the latest order of every persona that
ever had one and was not given a new one: "its beat … and nothing once it is off staff, and its line". So a Mod who
becomes Boss keeps the last line the old Boss gave it, as a row on every later meeting. It is read: `mod_standing`
(`0106_mod_moves.sql`) returns the latest order line whatever the persona's office, and an appeal heard by the Boss
(`supabase/functions/staff/appeal.ts`) shows it as "Your standing order from the Boss". After the handover, QC-1000
as Boss would be told "Last day. You are Boss next, as discussed." A Mod who is moved off staff keeps the same stale
line for a return.

**Decided (the owner): an order ends with the office.** The meeting carries an order forward only for a Mod still on
staff (`staff_now`). `mod_standing` returns an order only while the persona's office is `mod`. A Boss's prompt says
nothing about a standing order: `modPrompt` (`engine/system/judgment.ts`) writes the order line, or "The Boss has given
you no standing order.", only for the Mod office. A persona who later returns as a Mod has no order until the Boss's
next meeting gives one, as a newly appointed Mod does today. Weighed: keeping the carried row and having only Mod
prompts read it (the row would still say what was never in force); letting the new Boss read it as a memento.

The rows already written stay (append-only, and they are a record of what was given); they are no longer read for a
persona out of the Mod office.

## Layers, masks, ways out

- **Engine:** `excerpt`, `EXCERPT_WORDS` and the prompts' use of them; `modPrompt`'s order line. Nothing names an
  instance.
- **SQL:** one migration recreating `pool_thread`, `system_digest`, `apply_meeting` and `mod_standing` from their latest
  bodies.
- **Instance:** nothing.
- **Masks:** `cut` is computed from the length of words the caller is already shown; nothing new is read about who owns
  or reacted to anything.
- **Ways out:** no state is added for a player, a character or a post.
- **Scale:** `cut` is a length comparison on rows already read; the carry-forward reads fewer rows than today.
