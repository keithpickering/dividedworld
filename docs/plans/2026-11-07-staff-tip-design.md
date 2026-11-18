# Telling a newcomer what the Personality Cores are: design

Record, written 2026-11-07. The design session with the owner, who opened it: "Do/should we have onboarding screens for
explaining the concept of Staff? Maybe the first time a new user sees a post from a personality core?" It builds on the
onboarding design (`docs/plans/2026-11-02-onboarding-design.md`, sections 7 and 8), the staff roster design
(`docs/plans/2026-11-02-staff-roster-design.md`, section 10), the member groups design
(`docs/plans/2026-11-06-member-groups-design.md`, section 4) and the Mod Bots design
(`docs/plans/2026-11-06-mod-bots-design.md`), and on what they built. Each section was decided one question at a time;
the owner chose the proposal as put in every one. Its plan is `docs/plans/2026-11-07-staff-tip-plan.md`.

## What stood

A Personality Core's post carries the staff badge: the Personality Cores group bar under its name (`GroupBar`, drawn in
`engine/ui/postbit/Postbit.tsx`'s `kb-postbit-group`) and, beside it for the Boss and a Mod Bot, ADMINISTRATOR or
MODERATOR (`engine/ui/postbit/StaffBadge.tsx`). A member or benched Core has the bar alone. Nothing tells a newcomer what it means. No tip names it
(`engine/ui/tips/keys.ts` holds `tour-plate`, `tour-orbs`, `tour-hand`, `grid`, `ghost`, `first-card` and `shine`), and
the Strategy Guide (`instances/divided-world/guide/strategy-guide.md`) never says "Personality Cores"; its one staff line
is "Mod Bots, The System's henchmen" under Coming attractions, which the Mod Bots build has since made untrue, along with
the lines for rules, the warn bar, reports and appeals.

A newcomer's real question on meeting one is whether a friend is behind it. The glass may not leave that open
(CLAUDE.md, "The fiction may lie; the log never does"): the roster design gave the staff "some kind of special marker so
we know that they are AI", and a badge that is never explained is a marker only to those who already know.

## 1. Where it is taught: a tip and a Guide section

**Decided:** a spotlight tip on the real thing, and a Guide section for anyone who skipped tips or wants more.

This is the onboarding design's guideline (section 7): a tip appears only where the screen cannot explain itself, and
waits for its real thing. A badge cannot explain itself.

Weighed: the tip alone (a player who pressed Skip all tips would never learn it); a full onboarding screen the first
time a staff post shows (an explainer that takes the player out of the board, which the guideline prefers to avoid, and
a second way of onboarding beside the tips).

## 2. What triggers it: the first staff post in view

**Decided:** the first time a post by any Personality Core is in view in a thread, at any office (Boss, Mod Bot, member),
the spotlight points at that post's staff badge. It is asked by the thread's post (`engine/ui/thread/Post.tsx`), so the
front door's made-up postbit and the profile editor's preview never ask it. The developer persona draws no badge
(`StaffBadge` returns nothing for it) and never asks it.

It is one tip like the others: one a page load, never while the player types or a game effect holds the screen, and
Skip all tips ends it with every other. Settings › Tips' Show tips again brings it back.

Weighed: also the staff profile and a staff name in "Users browsing" (more places, but the presence chip is small and
leaves when the window does, a poor thing to point at); only a badge with an office title (a Core posting as a member
would teach nothing, and a newcomer meets those first between reigns).

## 3. What the tip says: the plain fact, with light lore

**Decided:** the tip says outright that no player is behind a Core and an AI writes every word, with Gabe's framing as
the joke on top. The offices go to the Guide, not the tip. The draft, for the owner's review in the PR:

> **These are Personality Cores**
>
> I made them to run the board so I wouldn't have to. No player is behind any of them: an AI writes every word. One is
> the Boss, some are moderators, the rest just hang around. Argue with them all you like.

Weighed: the fact with the offices spelled out in the tip (self-contained, but long for a spotlight, and the Guide holds
it); lore alone ("Gabe's creations, here to run the board"), which could leave a newcomer thinking a person plays them,
a bluff the glass may not make.

## 4. The Guide: a Personality Cores section, and Coming attractions made true

**Decided:** a new second-level section, **Personality Cores**, after The System: no player behind them, an AI writes
them; the badge, and what ADMINISTRATOR and MODERATOR mean; that the Boss changes each season; that they post and argue
and remember, and that they never react. It holds to the guide's surface (onboarding design, section 8): nothing about
the posting budget, how a Boss is chosen, offices changing hands beyond "a new Boss each season", or a persona's grudges
and pet rules.

**Decided** (the owner chose to fold it in rather than file it apart): the guide's other untrue lines are put right in
the same change. Rules, the warn bar, visits, reports and appeals are built (migrations `0102` to `0111`), so they leave
Coming attractions and are described in a new section, **Rules and visits**, at the same surface: what a rule is, that
it never stops a post, what a visit is and that anyone reading may talk it down, the warn bar and the timed ban it can
bring and that it ends by itself, reports, and appeals. Coming attractions keeps what is not built: the permaban with the
Unban that ends it (the Mod Bots design moved it to Part 4) and more cards.

**No number is typed.** The guide states every number as a `{{setting:…}}` marker (`tools/check-guide.mjs`), and the
warn bar's size, the report's price and the appeal's are not among the screen settings (`ScreenSettings`,
`engine/ui/data/api.ts`; `KINDS`, `engine/ui/guide/markdown.ts`). The section says where each is shown instead: the
report form says its price and how many reports a character has left today, the post's Lens says an appeal's, the warn
meter says the bar's fill, and the log says a ban's end. Weighed: adding the warn bar and the Mod Bots' prices to the
screen settings so the guide can name them (a payload and a `KINDS` change for numbers every screen that uses them
already shows; the surface guideline says less is better here).

The two sections are drafted in full in the plan, for the owner's review in the PR.

## The layers

- **Engine:** the `staff` tip key (`TIP_KEYS`), and the thread post's ask for it. It knows only that a character is
  staff and that the badge drew, never the group's name.
- **Instance:** Divided World words the tip (`InstanceUi.onboarding.tips.staff`, held exact by `instanceUiProblems`) and
  writes the Guide's sections. "Personality Cores" is typed in the instance's own copy, as its other tips type its words.

## Ways out of the states this adds

None is added. The tip is ended by Got it or Skip all tips, and brought back by Settings › Tips, as every tip is.

## What could slip a mask

Nothing. Whether a character is staff is public (`characters_public` carries it, signed in or not), the trigger is on the
player's own screen, and the tip seen lives on the player's own account row (`account_preferences.tips_seen`), read by
no one else. No payload, Realtime event or timing is added.

## A busy instance

A thread can hold many staff posts. Each asks only while the account's tips are on and the `staff` tip is unseen
(`TipsStore.unseen`), so a seasoned account watches nothing, and the in-view watch shares the page's one
IntersectionObserver per threshold (`watchInView`, `engine/ui/shine/inView.ts`). The first to come into view settles the
key for the load; the rest are dropped by the store, as the tour's are.

## Open

- Whether the tip's copy should link to the Guide's section. The spotlight's line is plain text today, as `grid`'s
  "The Strategy Guide has the whole chart" is; a link is a change to the spotlight, and it is left for another day.
