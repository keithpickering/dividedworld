# The code of conduct, conduct reports and decisions by email: design

Record, written 2026-11-02. The design session for #153, with the owner, held in the same session as the staff roster's
(`docs/plans/2026-11-02-staff-roster-design.md`). This is the real moderation that the screens' design said open
registration waits on (`docs/plans/2026-10-29-screens-design.md`, section 12: "an admin's hide-a-post (a layer, never a
deletion) and suspend-an-account tools"). Each section was decided one question at a time; the owner's words are quoted
where they set the direction, and where the owner chose the proposal as put, the section says what was put. Its plan is
`docs/plans/2026-11-02-conduct-plan.md`.

## The idea

The owner: "We are going to need an out-of-character code of conduct and a way to report players for things that they
have said through their characters … we can like throw jabs and stuff, and that's part of it being 18 plus, but we don't
want to have anyone feeling like legitimately victimized or anything. We don't want to harbor that kind of behavior. So
we'll need a simple system for that in the glass. And I think when decisions are made in regard to those reports,
whether it be a permanent ban or a timed suspension, it should probably just be email delivery … We don't have to build
a whole UI for it. And that kind of tracks with the whole video game thing."

All of it is out of character and plain (CLAUDE.md: "anything about real moderation [is] written plainly … never in
character"), so none of it is in Gabe's voice, and none of it is The System's: every decision is an admin's.

## 1. The report lives in the glass

**Decided** (the owner chose A): the board's in-game Report, which a Mod Bot hears (the staff design, section 7), stays
the game's. The glass's layer over a post gains **Report to admins**, a short form: the section of the code broken and
an optional note. The code of conduct page links to it and says the difference: the board's Report is part of the game;
this one reaches a person. Sending it shows a plain confirmation and changes nothing on the board.

The owner: "There will need to be some care in the design to make sure this doesn't just look like a card … Because then
it just looks like still part of the game, but part of the metagame." So the entry is never drawn as a mark, a card or
anything neon: it takes the plain look of the account and settings screens, so it reads as the website, not the game.
Its screen is designed with the owner in the glass's look before it is built (the plan's Task 6).

Weighed: one Report with two choices inside (B), a choice read at the worst moment, and the board's world knowing about
real moderation; reports by email (C), tied to no post.

## 2. Every version is reportable, and a hide covers a version

**Decided:** the owner: "a previous version of a post should exist in the backend record whether it violated a rule or
not, but it shouldn't be visible the way history normally is. It's also possible to break a rule and then edit it out
before anyone sees, leaving the break only in the history log, which means any version of a post needs to be
individually reportable."

Every post has a public History, and each version in it is its own Act (the screens' design, section 6). So a report
names a version, and an admin's hide covers a version:

- **Report to admins** is offered on the post and on each version in its History.
- **A hidden version** shows a plain note in the History, on the post when it is the current version, and anywhere it
  is quoted. Its words are served to nobody but admins.
- **Every version is kept** whether hidden or not ("Append-only"). An admin can unhide any version, and its words come
  back.

## 3. Six outcomes, each an admin's

**Decided** (the owner chose A, and added the fourth):

1. **No action.**
2. **A nudge:** a private note to the reported player, with no sanction.
3. **Hide:** the version is hidden.
4. **Hide until edited:** the current version is hidden with the note "Hidden by an admin until its author edits it."
   The author sees their own words under it, with an Edit button, and the email says what to change. The owner: "Oftentimes the whole thing doesn't need to go, baby with bathwater etc." What the edit does (the
   owner chose C):
   - **The first time** a post is hidden until edited, the author's edit brings it back at once, and the admin gets a
     re-review item to look at the new version.
   - **If that post was hidden before,** the edit waits for an admin, and the post stays hidden until one approves it.
5. **A timed suspension,** with an end date.
6. **A permanent ban.**

A hide can go with a nudge, a suspension or a ban. An admin can also act against a reporter who reported play as abuse
(section 5). Warnings that count up to an automatic sanction were weighed and set aside: an admin judges a small cast
better than a counter.

## 4. What a suspension shows on the board

**Decided** (the owner chose A): nothing. A suspended or banned account's characters show no label, no retirement and
no change on any profile. They go quiet. What is in play runs its course: a trap stays set, a card in force stays in
force, and settlement still pays their posts. A suspension that ends lets the player carry on. A permanent ban leaves the
masks quiet; an admin may retire them one at a time, on separate days, if a quiet mask bothers anyone.

Masks that go quiet together are a clue built from activity, like a player taking a week off; nothing answers from the
fact that they are one account. Retiring them all at once (B) or marking them suspended (C) would prove it.

**The way out:** signing in shows one plain screen and nothing else: "This account is suspended until {date}. We
emailed you the details; reply to that email to appeal." A ban says the same without the date. The way out of a
suspension is its date. The way out of a ban, and of a suspension early, is an admin, reached by replying.

## 5. Reports used as a weapon

**Decided** (the owner chose A): the code says that reporting play as abuse to win the game is itself a breach, and
each account may hold at most three open reports (a setting). The limit counts the account, not the mask, and only its
own filer sees it. A second report on the same post is evidence, never refused.

## 6. What the reporter hears

**Decided** (the owner chose A, and asked for warmer words): the same email whatever the outcome, so it proves nothing
about anyone. Its draft, for the owner's review in the PR:

> **Your report was read by an admin.**
> Thanks for telling us. A person, not the game, read the post you reported and decided what to do about it. We don't
> share what happens to another player's account, the same way we'd never share yours, so you won't hear the outcome
> from us. If it keeps happening, report it again. Every report is read.

The reported player is never told who reported them.

## 7. Email, through Resend

**Decided** (the owner chose A; "I've been using resend, haven't had any problems with it"): one mail interface in the
engine, one adapter at the edge for Resend. Every email is a row: what was sent, to which account, when, and whether it
was delivered. A failed send is retried and shown in the admin screen. Replies go to the instance's admin address (a
setting), so an appeal reaches a person. The mail is part of the instance's export, a record of real moderation
("Portable by construction"). Templates are plain, in the engine; an instance may override their words.

Weighed: Supabase's own SMTP (B), with no delivery record; admins sending by hand (C), easy to skip.

## 8. What a hidden version shows

**Decided** (the owner chose A): a plain note from the glass over the post's body, "Hidden by an admin: it broke the code
of conduct," linking to the code, in the glass's plain look and never as a card mark. The postbit, the author and the
post's place in the thread stay. The author's log says it plainly: "An admin hid your post in {thread} (code of
conduct). We emailed you the details." A vanished post (B) leaves quotes pointing at nothing; a board-world stub (C)
could pass for The System's doing.

## 9. The code itself

**Decided:** the owner accepted the draft ("This will work, and it can be refined over time as needed"):

1. **The mask is fair game; the person isn't.** Roast a character all you like. Don't go after the real person behind
   it: their looks, their job, their family, their real life.
2. **No hate.** No slurs, and no attacks on anyone's race, gender, sexuality, religion or disability, in character or
   out of it.
3. **No sexual harassment** and no sexual content aimed at anyone.
4. **Stop when asked.** If someone tells you out of character that something isn't fun for them, it stops, even if it's
   "just the game."
5. **Keep it on the board.** No threats, and nothing that follows a player off the site.
6. **Don't report play as abuse to win.**
7. **Don't out a mask with outside knowledge.** Don't reveal on the board who plays a mask using what you know from
   outside the game. Guessing in character from clues is the game.

The code is the instance's content, versioned. A player accepts it beside the 18+ checkbox at registration; an account
that has not accepted the current version accepts it at its next sign-in, before anything else.

## 10. The System's words

A model can write something genuinely hurtful. A staff post is reported and hidden the same way; the remedy is the hide
and a fix to the persona, which is the instance's content and is changed in a PR.

## The admin screen

Plain and functional (the owner, of admin screens: "It doesn't matter what that looks like. It doesn't get seen by
anybody"): `/admin/reports`, the open reports newest first, each showing the reported version's words, the report, the
author's account and its past outcomes; the outcome form; the re-review list; and failed mail.

## Ways out of the states this adds

| State | Way out |
|---|---|
| An open report (the reporter's) | An admin closes it; the email says so |
| A version hidden | An admin unhides it |
| An edit after a plain hide (added 2026-11-12, the owner's answer in the build) | An admin approves it, or unhides the hidden version, which frees every edit written after the hide |
| Hidden until edited, first time | The author's edit |
| Hidden until edited, again | An admin approves the edit (an edit after a second hide-until-edited stays hidden until then; confirmed as built, added 2026-11-12, the owner's answer in the build) |
| Suspended | Its end date, or an admin, reached by replying to the email |
| Banned | An admin, reached by replying to the email |
| Not yet accepted the current code | Accepting it at sign-in |
| Three reports open | An admin closes one |

## What could slip a mask

- **A suspension** shows nothing on any mask (section 4).
- **The reporter's email** is the same for every outcome (section 6).
- **The open-report limit** is computed from the filer's own account and shown only to it.
- **The admin screen** shows a reported character's account, which only admins read (they already can).
- **A hidden version's note** names the post, never the account.
- **A refusal or delay** never differs with who owns the reported character: a report on any post is accepted the same
  way.

## Open

- Whether a banned account's address may register again: answered 2026-11-12 by the owner as no, since a ban that a fresh sign-up undoes is not a ban, and the refusal reads the same as for any other address. As built, an account is its Auth login and an address is one login, so signing up again is signing in as the barred account (supabase/tests/0167-banned-address.sql); there is no setting, because "yes" would need one login to hold two accounts.
- The admin address and Resend's sending domain for dw.gripe: the owner's to set when the instance deploys.
