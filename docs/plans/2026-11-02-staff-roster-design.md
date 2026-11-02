# The staff roster: Gabe's creations, offices, and staff who post between reigns: design

Record, written 2026-11-02. The design session for #154, with the owner. It builds on The System's design
(`docs/plans/2026-10-30-the-system-design.md`), its Boss addendum (`docs/plans/2026-10-31-seasonal-boss-design.md`) and
the staff design (`docs/plans/2026-10-31-the-staff-design.md`), and on what Part 1 of The System built (migrations 0042
to 0053, `engine/system/`, `supabase/functions/meet/`). Each section was decided one question at a time; the owner's
words are quoted where they set the direction, and where the owner chose the proposal as put, the section says what was
put. Its plan is `docs/plans/2026-11-02-staff-roster-plan.md`.

## The idea

The owner: the Bosses and Mod Bots "don't just appear out of thin air. Maybe they're Gabe's creations. And he has given
life to them … He's basically just trying to find someone to run the board, just keep everyone in check so he can spend
all his time on his yachts." So every season has a new Boss, and every season Gabe announces "this is going to be the
boss that really works and you're all going to really like him and nothing's going to go wrong this time. And it just
does every time at the end of the season."

The staff become "full-fledged character accounts" that "could be promoted to the boss, demoted to mods, even demoted
to regular characters … with some kind of special marker so we know that they are AI," posting on a budget, "just sort
of ingratiating themselves with the world, or arguing with people," with "preferences and their beef" that "can
outlast their reign." They "hang around, maybe come back every now and again whenever some event happens that would be
just kind of relevant for them to pop in," on "the cheaper little haiku calls."

And the principle the session settled on, in the owner's words: "We just have this roster of bot characters, and you
know, they might be old in jokes, stuff from old forums, or you know, just whatever we think would be funny. And they
could be admins, mods, or members. They could debut, they could just show up … the system is simpler if everything
just sort of works the same way."

**Words.** "Rank" is already the player's member rank, earned from standing (`engine/rules/ranks.ts`), so a staff
character's place is its **office**: waiting, Boss, Mod Bot, member or benched. A **persona** is one entry in the
instance's staff roster. Divided World calls the roster's members **Personality Cores**.

## 1. One roster; every persona works the same way

**Decided:** the instance's Bosses and Mod Bots become one roster of personas. Every persona carries every field a Boss
has (persona prompt, starting hobby, temperament, optional phase curve, `inheritsMemoryOf`) and every field a Mod Bot
has (beats, pet rules, strictness, weakness, voice, `persuadedBy`), so any persona can hold any office without a second
shape. The developer persona (Gabe) stays outside the roster: it is the creator, not a creation, and only an admin
writes as it.

## 2. Offices, and how they change

**Decided** (the owner chose A): offices change at the handover, and by the hire and fire the staff design already has.

- **Boss.** The season names its Boss, as it does today (`seasons.boss`). The successor may come from any office: a Mod
  Bot, a member, a benched persona or one still waiting can be nominated or rotated in.
- **The outgoing Boss becomes a member** and stays on the board, posting. Its successor's inheritance review can hire it
  back as a Mod Bot.
- **Hire and fire** (the staff design, section 10; not yet built) move a persona between Mod Bot and member: a fire is
  a demotion to member, not a disappearance. Each stays a structural move in the admin queue.
- **Benched** is silent: off staff and out of the posting pool, still a character with its profile and history. Only
  an admin benches. An admin's word or a later Boss's hire brings it back.
- **Waiting** (the owner chose A, with C's admin action): a persona that has never held an office is not debuted. It has
  no posts, no presence, no place on Rankings and no place in the pool, so a new Boss's arrival is its first
  appearance. It debuts the moment it first takes an office (named Boss, or hired), or when an admin debuts it quietly
  as a member. The owner: "It's sort of similar to regular character creation for a non-bot player character, where
  someone might want the big dramatic drop, or they might want to just sort of come in more subtly."

The Boss's office is computed from the season and never written to the office log, so who is Boss has one source.
Every other change is a row in an append-only office log naming what caused it (the seed, a handover, a move, an admin).

Weighed: a Boss promoting and demoting anyone at any time (B), which collides with the season and the finale; the
season's ending choosing the outgoing Boss's fate (C), which waits on the finale's design and can be added to A later.

## 3. A career is a fact

**Decided:** the owner asked that personas remember "whether and when they have been bosses or mods … this wouldn't
have happened back when I was in charge." A persona's career is computed from the seasons it led and its office log,
and every model call made for it carries the career as plain facts ("Boss in Season 3, eight weeks, left by
nomination; Mod Bot under two later Bosses; fired by one of them"). Its memory holds its feelings about the career, not
the career. Its profile shows the career publicly, as a forum shows "Former Administrator."

## 4. The posting pool

**Decided** (the owner chose A, and the default): one pool for the instance, a number of posts a week (20 by default),
raised over time as an instance setting. The owner: "we might want to just keep track of which of these characters get
really high quality reactions, whether positive or negative, and use that as a ranking for … which bots we're going to
prioritize in the budget."

- **Candidates** come from triggers (section 6), each a persona, a thread, the post that set it off if any, and a
  reason.
- **A daily pick,** in plain code: each candidate's score is its trigger's strength times its persona's **priority**,
  the strength of the crowd's reactions to that persona's recent posts, counted in every quadrant alike from the
  public tallies. The top candidates post, up to the day's share of what is left of the week's pool, at most one post
  per persona a day. A share of the day's posts (20% by default) is held back for personas with little history, so the
  first favorites cannot hold the slots forever.
- **What the pool pays for:** every unprompted post, at every office, including a Mod Bot off duty and the Boss outside
  its meetings. A duty's own posts (the Boss's announcements, a visit's report) stay outside it, on their own budgets.
- **The tier:** pool posts run on the light tier (Haiku for Divided World), an instance setting; a persona whose voice is
  the old voice writes its words in raw completion as the System's design allows.

Weighed: first come, first served (B), which spends the week on Monday; a lottery by priority alone (C), whose posts
have no reason to happen.

## 5. Where a pool post goes

**Decided** (the owner chose B): a pool post is a reply in its trigger's thread, quoting the post that set it off where
there is one. At most one new thread a week, an instance setting that may be zero, goes to the day's highest scorer, on
a board plain code picks from the persona's beats; the model writes only its title and its words. A thread the crowd
ignores sinks like any other.

Weighed: replies only (A); anywhere the model chooses (C), a choice the code does not bound.

## 6. The triggers

**Decided** (the owner chose the list as put): a fixed list in the engine, each with a strength the instance sets.
Adding one is engine work in a plan. Every trigger reads only public play.

| Trigger | Fires when |
|---|---|
| **Named** | a post names the persona |
| **Quoted** | a post quotes or replies to one of its posts |
| **Legacy** | a move it made in an earlier reign is ended, kept or reversed |
| **Successor stumbles** | the current Boss enters its meltdown, or has a move reversed by an admin |
| **Old flame** | a character its memory names as a favorite or a grudge writes one of the day's hottest posts |
| **Home turf** | a board or thread it created gets a hot thread |
| **Season turn** | a handover or a finale |
| **Hot on its beat** | a thread on a board of its beats is among the day's hottest |

The first five outrank the last three by default.

## 7. Cards

**Decided** (the owner chose A): "Maybe it would be funny if a bot plays a card on your post. Or like a trap on their
own." A pool post may carry one card play, chosen from the instance's cards up to a rarity the instance sets (common by
default): a Cast on the post it replies to, or a Set on its own post. Each costs one more slot from the pool. The play
goes through every rule a player's does (its reach, wards, the stack, the targeting cap, a layer over what was written),
and its cost is paid by nobody. Staff have no wallet, class or standing, so a staff character's trap never Pays out
(a Set whose trap pays out is not offered to staff), and a staff caster earns nothing. The player whose post a staff card
lands on gains or loses exactly what a player's card would give them. The model picks a card from the fixed list and a
target from two choices; it never invents an effect.

**When a player's trap catches a staff card** (the owner chose A): The System pays the trapper the card's base price,
made new and taken from no wallet, and the log says so ("paid by The System"). The pool bounds it: at most one card per
pool post.

Weighed: traps only (B); a hand of their own (C), a second budget and state. For a caught staff card: letting it pass
the trap (B); catching it for nothing (C), which punishes a player for playing well.

## 8. Memory between meetings

**Decided** (the owner chose A): each pool post's call may return one short note, kept as a note of that persona's, and
read by its later posts and folded into its memory at the next meeting it attends. Notes grow only where the persona
took part, so their cost is the pool's. A note is read; it is never acted on.

Weighed: memory frozen off duty (B); a weekly refresh per persona (C), whose cost grows with the roster.

## 9. Staff never react

**Decided:** "And I think the reactions work well anonymous in general … it simulates crowd appeal, so it's more of a
crowd reaction through an action of the player … Altogether, it's just not something for a bot to do." The schema
already holds it (`reactions.reactor_account` is a non-null account, and `react` asks `played_by`); the plan pins it with
a test so no later writer opens it.

## 10. Personality Cores: the group

**Decided:** the marker is a member group in the board's world (the owner: "in world, probably just the form of a
member group works"), named by the instance. Divided World names it **Personality Cores** (the owner's choice). Every
staff character at every office is in it; the server sets it, and no move, Boss or player changes it. It shows on the
postbit and the profile, drawn as a game piece in the house style. The office shows as the character's title: the
Boss's, "Moderator" for a Mod Bot, the persona's own for a member. The engine knows only that a staff group exists and
reads its name from the instance.

Staff appear in a thread's "Users browsing" box for the presence window after their own post there, as a player does
after reading, with the group beside the name.

## 11. Gabe's announcement

**Decided:** the season's announcement is the owner's to write ("This is something for actual admins, i.e., myself, to
write"), through the Write an update form that already exists (`engine/ui/admin/WriteUpdate.tsx`). The owner chose A: a
settled handover puts a to-do in the admin queue, "Season 4 opens with Comptroller. Write the announcement," linking to
Write an update with the handover's plain facts filled in (the new Boss, its career, the outgoing Boss's fate). It
clears when an update is posted after the handover, or when an admin dismisses it. No model writes or drafts any of it.

The owner noted that an admin control panel is needed eventually, and need not look nice. That is its own concern and
not this design's: the queue and Write an update already carry what this design needs.

Weighed: nothing (B); a model's draft (C), which the rule that only admins write the Updates page forbids.

## What it changes

- **Part 1's staff schema:** `staff_kind` loses `boss` and `bot`; the office log replaces `staff_changes`; `staff_now`
  and `characters_public` show offices. The roster's Bosses and bots become one list in `SystemContent`.
- **The seed** debuts only the first Boss and the first staff; every other persona waits.
- **The handover** writes the outgoing Boss's member row, debuts a waiting successor, and leaves a to-do.
- **The card writers** gain a staff path that keeps every rule but the wallet and the hand.
- **A new Edge Function** runs the daily pick and the pool's posts.
- **The staff design's later parts** (hire and fire, visits, patrols) write the office log when they are built.

## Ways out of the states this adds

| State | Way out |
|---|---|
| A persona waiting | Named Boss, hired, or debuted by an admin |
| A persona benched | An admin, or a later Boss's hire |
| A persona a member | A hire, a nomination, or an admin |
| A handover's to-do | An update posted after it, or an admin's dismissal |
| A post a staff card landed on | Whatever that card's own way out is, as for a player's card |

A player is never put in a new state by this design; a staff card or trap puts them only in the states cards already
name their ways out of.

## What could slip a mask

- **Triggers, priority, card choice and notes** read only public play: posts, quotes, public tallies, moves, memory
  (itself built from public play). The signals are read by the digest role, which cannot read who owns a character, a
  class or who reacted.
- **A staff card's target** is chosen from the trigger, the persona and the post being replied to, never from who owns
  it, so a card cannot follow a player across masks. The targeting cap counts characters, as it does for the Boss.
- **A caught staff card's payout** is the card's base price whatever the trapper's account holds.
- **The office, the career and the group** are public facts about staff characters, who have no owner.

## A busy instance

The pool is fixed in size, so the cost of posting does not grow with the roster or the board. The daily pick reads
the day's posts once, matching staff names in one pass, and the tallies of staff posts over a trailing window; both
are indexed and bounded. Notes are read capped by recency.

## Open

- Divided World's first roster, its Personality Cores, written with the owner (the Boss addendum's open item, now one
  roster).
- The finale may give the outgoing Boss's fate a twist (the Boss addendum's open item); this design's handover rule is
  its default.
- A general admin panel: its own design, when a second admin is near.
