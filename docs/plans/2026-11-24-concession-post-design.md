Record, written 2026-11-24.

# A talked-down Mod posts its concession in the thread: design

A design session with the owner. Its plan is `docs/plans/2026-11-24-concession-post-plan.md`. It is an addendum to the
written-quiz design and plan (`docs/plans/2026-11-22-written-quiz-design.md` and its plan, in PR #1002, not yet on `main`
when this was written), and it is built after them.

It follows a question the owner asked on 2026-11-24: whether talking a Mod Bot down stops it replying to the post it
came for. It does, in the sense that a visit never replies at all: its arrival line and its filing line are Acts on the
visit, shown in the Lens, with no place in the thread. A successful interception ends the visit with a stock line
("X got past Y's quiz."), and the Mod says nothing more. Its next chattier-staff turn
(`docs/plans/2026-11-22-chattier-staff-design.md`) is not told the visit happened, so a Mod bribed at noon can talk in
the same thread at two as if nothing did. The owner's proposal: the model call that writes a visit's quiz also writes
the post the Mod makes if it is talked down, so a talk-down ends in a reply in the thread, which players can answer
and which the chattier-staff turns then carry on.

## 1. Decided: every kind of Mod writes its concession when the visit opens

The owner chose, of:

- **Every kind, written ahead (chosen).** A quiz Mod's opening call (the written-quiz plan's `quizQuestion` call)
  returns its concession post beside its question. A bribe or distraction Mod, which has no call when its visit opens
  today, gets one that writes only the concession. All three ways out read alike, and the post lands the moment the
  Mod is talked down. The cost is a call per visit, most of which file and never use their concession.
- **Quiz only, in the same call.** Free, but a bribed or distracted Mod stays silent, which is the gap.
- **Every kind, written after the talk-down.** Paid only for talk-downs, and it knows who did it and how, but the post
  lands up to a staff run later, and the quiz call does not write it.

## 2. Decided: the post names whoever talked it down through a slot

The owner chose, of:

- **A slot code fills (chosen).** The model writes `{who}` where it means whoever talked it down; code puts that
  character's name in when the post lands. The interceptor is already public (the `intercept` Act names it, and the
  visit's end line says it). A concession with no slot stands as written; every `{who}` is filled.
- **No name.** The post quotes the visited post and speaks to it alone; the Lens names the interceptor.
- **A variant for each way out.** One way out applies to any Mod, so it buys nothing.

## 3. Decided: the fallback is each persona's own stock concessions

When a talk-down finds no written concession (the call failed or was rejected, the day's cap was spent, the System
was off, the window passed, or a bribe or distraction came before the staff run wrote one), the Mod still posts, from
its own stock. The owner: "Stock post is fine, might be something to write per-persona so it still seems in character
for vastly different personalities." So every persona carries `concessions`, its own stock lines (each may use
`{who}`), as every persona carries every field a Mod has. One is drawn by a hash of the visit. A written concession
that would arrive after a stock one was posted is never posted: a visit makes at most one concession post.

Weighed: today's end line and no post when none was written (whether a Mod speaks would then turn on the budget and
the clock); posting the written one late when it arrives (a post minutes after the fact, and a second pending state).

## 4. How it works

- **Kept with the visit, unread.** A visit's written concession is kept in a row of its own, written once, that no
  client reads, beside the written-quiz plan's `visit_quizzes`. Until the visit is talked down, nobody sees it. A
  visit that files, is trapped, is reversed or is dropped never posts it.
- **The call.** The model reads what the written-quiz call reads (the post as shown, the author as shown, the thread's
  title, the charge's rule), in the Mod's voice. The concession is at most 280 characters. Its checks follow "A
  validator tighter than the schema is a place a paid answer goes to die": an over-long concession is cut at a word
  boundary; a brace token other than `{who}` loses its braces and keeps its word; a blank concession is no concession
  (the stock is used), and in a quiz Mod's call a blank or broken concession never costs the question, nor a broken
  question the concession. An old-voice persona writes its concession with a completion call of its own, as its
  filing line is written.
- **The post.** A successful interception (a quiz answered right, a bribe paid, a distraction) ends the visit as
  today, then the Mod's character writes an ordinary post in the visit's thread that quotes the visited post, its
  body the concession with `{who}` filled. It takes a seq and moves the thread like any post. It is not a chattier
  turn: it waits on no session and spends no turn bound. The visit's end line in the Lens is unchanged, and the Lens's
  "How it went" links the post.
- **Best effort.** The talk-down never waits on or fails with the post. A post refused (the Mod's character is benched,
  gone from the roster, locked out of the thread) leaves the visit ended and is recorded for an admin, unseen by any
  player.
- **The conversation.** A player's reply to or quote of the post waits for the Mod as any reply to a staff post does,
  and the post is among its own posts in its conversation view. Nothing in the chattier-staff machinery changes.

## 5. Budgets

The written-quiz plan's names stand: a quiz Mod's opening call stays duty `quizQuestion` under
`modBots.quizQuestionsPerDay`, and now writes both. A bribe or distraction Mod's call, and an old-voice persona's
concession call, are duty `concession`, light tier, under `modBots.concessionsPerDay` (60), counted from the ledger. A
concession call is tried for `modBots.concessionWriteMinutes` (15) after its visit opens; past that the stock is used.
(The summary the owner approved named one renamed duty for both; separate names were kept because the ledger is
append-only and `quizQuestion` rows may already exist when this is built.)

## 6. Layers, masks, ways out, scale

- **Layers.** The engine holds the duty, the prompt and repair, the tables, the post, the settings and their checks.
  An instance supplies each persona's `concessions`. Divided World's are drafts for the owner to approve in review.
- **Masks.** The call reads only what readers see. The post names a character, never an account, and only one the
  interceptor's own public Act names. When it lands is when the interception lands. Whether it lands depends on the
  Mod's character, never on who owns the post or the interceptor.
- **Ways out.** No state is added. The concession post is an ordinary post, with every way an ordinary post has.
- **Scale.** At most `concessionsPerDay` new calls a day, one row per visit, and the staff run reads only the open
  visits with no concession row, by an index.

## 7. Left out, and open

- **A filed visit's line in the thread.** The filing line is model-written already, and stays on the visit. Moving it
  into the thread is its own change.
- **A quote trap on the visited post.** The concession quotes the visited post, so a quote trap its author set springs
  on the Mod's post as on anyone's. Kept, as a post is a post; whether it reads well is for play to show.
