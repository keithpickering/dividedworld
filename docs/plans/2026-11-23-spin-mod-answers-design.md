# A Mod's answer to a report or an appeal can be spun: design

Record, written 2026-11-23. A design session with the owner, who asked: "How big a change would it be to allow Spinning
mod bot report/appeal answers? We pay for a model call for an in-character answer, and it works; it's a bit of a shame
that it's one of the only things in the game you can't show other people." The plan is
`docs/plans/2026-11-23-spin-mod-answers-plan.md`.

It widens the origin place (`docs/plans/2026-11-04-origin-place-design.md`) and the ORIGIN box
(`docs/plans/2026-11-12-spin-at-post-design.md`), and it reads the Acts the Mod Bots design laid down
(`docs/plans/2026-11-06-mod-bots-design.md`).

## 0. What happens today

- **The server already takes it.** `spin_written` (latest in `supabase/migrations/0395_polls.sql`) takes any Act that
  sits in a thread, other than an edit. A `report_verdict` and an `appeal_ruling` sit in the reported post's (or the
  punishment's) thread, so they can be origins now.
- **One screen already offers it.** A visit's "How it went" rows (`engine/ui/cards/Visit.tsx`, `HowRow`) carry Spin
  thread on every row: the report, the Mod's verdict, the appeal and its ruling among them.
- **What a spin of one shows is broken.** `thread_open.origin_place` (latest in `0396_poll_reads.sql`) places an Act
  only by its place number, which a verdict and a ruling do not have, so the head reads "Spun from an Act". The ORIGIN
  box (`engine/ui/spin/Origin.tsx`) has no case for these kinds; they fall through to the post renderer, which draws
  `payload.body`, and a verdict keeps the Mod's words in `payload.line`. The box is a byline over nothing.
- **Most answers have no Spin anywhere.** A report dismissed or backfired with no visit, an appeal of a ban and an
  appeal of a group move have no visit panel. Their Mod's words are shown only to the person who asked, in the form's
  result (`engine/ui/cards/Forms.tsx`). The player's log (`engine/ui/log/lines.ts`) and the Mod's public moderation log
  (`engine/ui/profile/modlog.ts`) say what was done and never quote the line.

## 1. What the box shows

**Decided: the exchange** (the owner chose it over the answer alone, and over the exchange under a snapshot of the
reported post as it was).

```
ORIGIN · Spun from Kassie's verdict on Wario's report of #12 in Kart tier list
┌───────────────────────────────────────────┐
│ [av] Wario reported it · Nov 20, 4:02 PM   │
│ "this is clearly spam, look at it"         │
│                                           │
│ [av] Kassie · Mod · Nov 20, 4:03 PM        │
│ Dismissed, and frankly I'm offended you   │
│ wasted my break on this.                  │
│                                           │
│ Kassie dismissed it. No visit opened.      │
│                            Go to post #12 │
└───────────────────────────────────────────┘
```

- **The ask:** the report's reason or the appeal's plea, under the asking character's byline (one link to its profile,
  avatar inside it) and the time.
- **The answer:** the Mod's (or the hearer's) words, under that staff character's byline, its role, and the time. The
  words are in character and may bluff.
- **The plain line:** what the verdict or ruling did, in the glass's own true words (section 3).
- **A link to the post** as it is now. No snapshot of the post is taken.

Weighed: the answer alone (smallest, but the joke usually needs what was asked); the exchange under the post as it
read when reported (the most context, but it needs a moment of the post, and its effects then were never recorded).

## 2. Where Spin is offered

**Decided: the form, the player's log and the Mod's moderation log** (the owner chose it over the asker alone, and over
a new mark on the post).

- **The form:** the report and appeal forms, right after the answer lands, wherever the form is opened from a page
  that can hold the spin form (a thread's post). The form opened from the log (a ban's "Appeal to the Boss") and from
  the composer offers it too, where its host gives it a way to spin.
- **The player's own log:** the line for each report and appeal that has an answer.
- **The Mod's moderation log:** each judged report's and heard appeal's row, so any player can spin any answer, as any
  player can spin a visit's row today. A visit's own row is not changed.

Weighed: only the asker (keeps the answer theirs to share, but an answer is a public Act, and anyone can already spin
one from a visit's rows); a mark on the post for every judged report (makes reports visible in the thread, which
changes how reporting feels; bigger, and a different design).

## 3. The head, the Acts and the plain line

**Confirmed by the owner as one section.**

**The head phrase.** A new kind of origin place, the answer:

- "Spun from **Kassie**'s verdict on **Wario**'s report of **#12 in Kart tier list**"
- "Spun from **the Boss**'s ruling on **Wario**'s appeal of the warn points from **#12 in …**"
- "… appeal of the ban from **#12 in …**"
- "… appeal of the move into **Trial Members**"

Each character's name is a link to its profile (with its avatar inside, in the box), the post is a link to it as it is
now, and a move is a link to its line in the thread where it has one. The board's thread list draws the same phrase
without avatars, as it does for spin-at-post. One function draws it for both (`placeParts`).

**Which Acts.** A spin from the report or the appeal itself (already offered on a visit's rows) gets the same box. The
head names the Act spun: "Spun from Wario's report of #12 in …". A spin from the verdict or ruling is fixed, since the
exchange is settled. A spin from the report or plea reads its answer when the box is drawn, and says "Not answered
yet." while there is none. **Decided in planning:** the box is not subscribed to the origin's thread; it reads the
answer each time it is drawn. A judgment lands within seconds of a report, so a spin of an unanswered report is rare
and a reload shows it.

**The plain line** is computed from the verdict's or ruling's own payload and the punishment's kind, all public:

| Act | Words |
|---|---|
| `visit`, with `visit_act` | "{Mod} sent a visit to the post." |
| `visit`, no `visit_act` | "{Mod} judged it a visit, but no visit opened." |
| `dismissed` | "{Mod} dismissed it. No visit opened." |
| `backfire`, with `visit_act` | "{Mod} judged it a backfire: a visit went to {reporter}'s latest post." |
| `backfire`, no `visit_act` | "{Mod} judged it a backfire, but no visit opened." |
| `overturned`, warn points | "{Hearer} overturned it: {n} points came off." |
| `overturned`, ban or move | "{Hearer} overturned it: it ended {until} UTC." |
| `upheld` | "{Hearer} upheld it. Nothing changed." |
| `reduced`, warn points | "{Hearer} reduced it: {n} points came off." |
| `reduced` or `increased`, ban or move | "{Hearer} {reduced or lengthened} it: it ends {until} UTC." (or "ended", once past) |
| `increased`, warn points | "{Hearer} increased it: {n} more points landed." |

"{n} points" is singular for one. **It leaves out Aura:** what someone paid or got back is wallet business, said in
their own log, not in a spin. It never says why a visit did not open (a veil or an earlier charge): the reporter's log
says that, and the spin need not.

**Spins already made from a verdict, a ruling, a report or an appeal** draw the new head and box with no change to any
Act: both are views.

## 4. The masks

- **The place** reads the asking character, the staff character, the post's thread, title and number, the punishment's
  kind and a move's group: each a public fact of a public Act. The asking character's name is read as `acts_public`
  shows the ask's character, so a stand-in shows where one would.
- **The box** reads the ask and the answer from `acts_public` by id and by `target_act_id`. Nothing reads an owner, a
  class or who reacted.
- **The spin form, the log line's button and the moderation log's button** offer the same thing to every reader who can
  see the row. The log is the player's own and already shows these rows; adding a button proves nothing new.
- **The form's answer** carries the verdict's or ruling's id (which `close_report` and `close_appeal` already return,
  and the staff function drops). It is the id of a public Act the asker is about to see in any case.

## 5. Ways out

No state is added to a player, a character or a post. The box is a view; a spin is a thread like any other. A box
whose read fails says so with Try again, as the moment does.

## 6. A busy instance

- **The place:** `thread_open` gains joins by primary key (the origin's target, the punishment, the infraction's
  post) met only by a thread spun from an ask or an answer, and null probes for every other row. The plan's test
  measures a board's deep page with half its threads spun this way, as `0152`'s header and spin-at-post's test did.
- **The box:** at most three reads by key or by `target_act_id` (indexed), once per draw. It does not grow with the
  instance.
- **The log and the moderation log:** one more column each from rows they already join.

## 7. Open

- Whether a visit's own Act (`visit`, `visit_end`) should get a box of its own when spun. Today it falls through to
  the post renderer as the verdict does; it is a separate design.
- Whether the box should show the reported post as it was when reported, if a moment of a reported post is ever
  recorded (section 1's third alternative).
