Record, written 2026-11-27.

# A Mod's outcome post quotes what it answers: plan

Follows `docs/plans/2026-11-26-outcome-posts-plan.md` (built in #1202, merged as 45541d0), and answers #1205 (that
build's final review, F4). One PR from `main`, written by the build session that built #1202 at the orchestrating
session's request; no design session was held, since the owner's answer settles the design and this plan records it.

## The owner's answer

On #1205 ("should a staff reply with a target draw what it quotes?"), relayed by the orchestrating session on
2026-11-27: "Yes, let's do the rendered quote." Every Mod outcome post (a filing, a concession, an infraction's
ruling, a ban's ruling, a move's ruling) and the Banlist's ban entry quotes what it answers as a player's reply
does: the code writes a real `[quote]` of the target's opening words into the post's body when it posts, ahead of
the Mod's words. The quote names its author as a player's quote does, a quote trap or a No quote applies to it, and
a refused post takes the best-effort path #1202 built.

## Decided here

- **The quote's form is a player's.** `[quote=<act id>]…[/quote]` followed by a line break, the form
  `engine/ui/composer/text.ts` `quoteText()` writes. The head (the author's byline and Post #seq) is drawn from the
  Act at render time, as for any real quote; nothing in the body names the author.
- **Its words are the target's opening words, as a player's selection would quote them.** A player's whole-post quote
  copies the body with its markup; a player's selection copies words. A server quote is a selection: the plain words
  of the target's current visible version (the latest edit, else the Act), with whitespace collapsed. All of them when
  they fit; otherwise the first `OUTCOME_QUOTE_MOST` (280) characters cut at a word, followed by `…`. They are
  wrapped in `[noparse]` when they hold a `[`, as `asTyped()` wraps a selection that looks like a tag. They pass the
  forged-quote check (`0393_forged_quotes.sql`) by construction: they are a verbatim run of the version's words, and
  `quote_norm` drops the trailing `…`. A test holds that no outcome post is recorded `forged`.
- **What each outcome quotes:**
  - a filing, a talked-down visit's concession (model or stock): the visited post;
  - an infraction's ruling: the punished post;
  - a ban's entry: the post that tipped the bar (the infraction's `about_act`), in another thread. The entry keeps
    its approved code line and its link. The quote stands above them, and the post's target becomes that post.
  - a ban's ruling: the ban's entry. Where the entry was refused, the ruling quotes nothing, as now.
  - a move's ruling: the move Act. A move has no post body of its own beyond its payload's `body`, the said line its
    post shows under the move's tag. Its quote shows that line's words. The forged-quote check counts a `move` with a
    string `body` as a version of itself: `acts_quote_sources` and the version query in `quote_forged` take `move`
    beside `post` and `spin`. A player's quote of a move is then real too, where today it reads as a counterfeit; that
    is the truthful reading of a move's words, and it is tested.
- **The bound counts only the Mod's words.** The model is still asked for, and its words cut to,
  `min(postMaxLength, 2000)` (#1202's `outcomePostMost`); a ban entry's persona line stays at 280. The quote is added
  on top, and the whole body must fit `postMaxLength`: the quote's words take at most `OUTCOME_QUOTE_MOST`, and fewer
  where `postMaxLength` leaves less room after the Mod's words and the markup. Where no room is left for even one word,
  the quote is left out and the target kept. The Mod's words are never cut to make room. Divided World's 5,000 always
  leaves room.
- **A No quote applies.** A target under a live No quote gets no `[quote]` in the body, and `write_staff_act` drops the
  target as it does today, so the post lands as a plain reply, the case #1202's test 10(a) holds. Without this check
  the body's quote would make `acts_quote_guard` refuse the whole post.
- **A quote trap applies,** as it does today on the target: it springs once, on the Mod, and the post stands. The
  body's quote feeds the trap's passage and phrase conditions (`spring_facts`), as a player's does.
- **The model never writes the quote.** The filing, concession, appeal and ban-entry prompts say the post will be shown
  under a quote of what it answers, and no longer ask the model to quote. The repairs strip any `[quote…]…[/quote]`
  the model writes anyway, recorded as a trim (`quote(model)`).
- **The Lens row shows the Mod's words.** The row's opening words (`excerpt`, `engine/ui/profile/record.ts`) skip the
  post's leading quote. Otherwise every outcome row would open with the visited post's words.
- **Pool and chatter staff replies get no rendered quote.** They keep their target and post the model's words as
  written. The question was put to the owner through the orchestrating session on 2026-11-27, and the owner answered:
  "Agreed. Ordinary chatter can just be replies, and it seems they often respond to multiple characters within one
  post, so the quote of only one post would be a bit odd in those cases." The owner saw the plan's other decisions
  (the quote's words, the bound, the move ruling, the ban entry and the No quote) and raised nothing on them.

**Masks.** The quote is the target's public words, written as a player's quote. Nothing in it, in when it lands or in
whether it is left out turns on who owns any character. A No quote's check reads the target's public No quote, as
`acts_quote_guard` does.

**States.** None added.

**Scale.** One extra read of the target's current version per outcome post (one row by the edit index), once per
outcome.

**Already held.** Outcome posts already posted keep their bodies (append-only). No backfill.

## Task 1. The database: the quote in every outcome post

Model: sonnet

**Files:** the new migration `supabase/migrations/NNNN_outcome_quotes.sql`, NNNN the next free number on `main` when
the build starts (0452 at 45541d0). Tests: `supabase/tests/NNNN-outcome-quotes.sql` (new), and `0451-outcome-posts.sql`
and `0393-forged-*.sql` where they assert a body this changes. Each rewritten function is copied from its latest
definition, with the same "`<name>` (`<latest>`), <what changes>. Everything else as `<latest>` wrote it." header #1202
used.

- **`outcome_quote(target uuid, room int)`**, internal: null when `target` is null, when it holds a live No quote (the
  test `acts_quote_guard` uses), or when `room` is too small for one word. Else
  `[quote=<target>]<words>[/quote]` and a line break, the words chosen as "Decided here" says, at most
  `least(280, room)` characters of words. For a `move`, the version is its payload's `body`.
- **`post_outcome`** (`0451_outcome_posts.sql`): the body is `outcome_quote(target, cap - length(body) - markup) ||
  body`, the Mod's words never cut for the quote. Its `left(body, cap)` guard stays.
- **`post_ban_entry`**: passes the post that tipped the bar as the target. If `write_staff_act` or `lock_for_quote`
  refuses a target in another thread, stop and report it as a plan gap.
- **The forged-quote check** (`0393_forged_quotes.sql`, latest definitions): `acts_quote_sources`' trigger and backfill,
  and `quote_forged`'s versions, take `move` with a string `body`. The backfill fills sources for the moves already
  written.
- **Tests first:** each outcome kind's post opens with a real quote of its target, and `payload.forged` is empty; a
  long target is cut at a word to 280 with `…`, a short one is whole; a target holding `[b]` in its words is wrapped
  in `[noparse]` and still not forged; an edited target quotes its latest version; a ban entry quotes the post that
  tipped the bar, and its target is that post; a ban ruling quotes the entry; a move ruling quotes the move's said
  line, not forged; a player's quote of a move is not forged; a target under No quote: the post lands with no quote
  and no target; a quote trap springs once and the post stands; with a small `postMaxLength`, the quote shrinks, then
  goes, and the Mod's words are whole.

## Task 2. The engine and the screens: prompts, repairs, the Lens row, the fake

Model: sonnet

**Files:** `engine/system/judgment.ts`, `engine/system/concession.ts`, `engine/system/banlist.ts` and their tests;
`engine/ui/profile/record.ts` (or the Lens row's call of it in `engine/ui/cards/Visit.tsx`) and its test;
`engine/ui/data/fake.ts` and `engine/ui/data/fake.test.tsx`; the e2e fake model's matchers in
`supabase/tests/e2e/0017-a-day-of-the-mods.ts` and `0027-hearts-falls-tattles.ts` if a prompt's last line changes.

- **Prompts:** `filingPrompt`, `appealPrompt`, `concessionPrompt` and `banEntryPrompt` say the post will appear under
  a quote of what it answers and ask for the reply alone, where they asked for a reply "quoting the post".
- **Repairs:** `repairFiling`, `repairAppeal`, `repairConcession` and `repairBanLine` strip `[quote…]…[/quote]` blocks
  (nested included), recorded as `quote(model)`. A body left blank by the strip is blank, as before.
- **The Lens row:** an outcome row's opening words skip the post's leading quote.
- **The fake:** each outcome post's body opens with the same quote the database writes (the fake's own copy of the
  rule, held to the same cases by `fake.test.tsx`).
- **Tests first:** each prompt no longer asks the model to quote; a model answer carrying a `[quote]` is stripped and
  recorded; a Lens row of an outcome post shows the Mod's words, not the quoted ones; the fake's filed post opens with
  a quote of the visited post, cut as the database cuts.

## Task 3. The build

Model: inline

`npm run typecheck`, `npm run build`, `npm run test:sql`, with the tails in the PR.

## Review focus

- No outcome post is recorded `forged`, for any target kind, edited targets included.
- A No quote never refuses an outcome post. A quote trap behaves as on a player's quote.
- The Mod's words are never cut for the quote. The body fits `postMaxLength`.
- Widening the forged-quote check to moves changes nothing for posts, spins and edits.
- A ban entry's cross-thread target: what it springs, and whom it alerts.
