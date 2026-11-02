# Onboarding: the welcome, the Strategy Guide, tips, the starting grant and Feelin' Fab

Record, written 2026-11-02. A design session with the owner, who opened it by asking what a newcomer sees with no
account, what explains the game, whether a new account is invited to make a character, and whether it starts with
any Aura. The plan that carries it out is `docs/plans/2026-11-02-onboarding-plan.md`. The boards drawn with the
owner are `docs/research/2026-11-02-onboarding/`. The issues it filed are #150 (Autocorrect) and #151 (the persona's
voice).

## 0. Where it starts

What a newcomer met on 2026-11-02, read from the code:

- **Signed out:** the board is hidden. The Index says "The board is for players. Sign in to read it."
  (`engine/ui/mini.tsx`). Registration is by invite (`/register?invite=<code>`), passwordless, with an 18+ box.
- **Nothing explains the game.** A Strategy Guide draft existed only on an unmerged branch
  (`ca64ab9`, `instances/divided-world/guide/strategy-guide.md`), with no route.
- **After the account opens** the player lands where they were, or on the Index. Make a character is offered where
  they would act (the HUD's plate, the composer, My characters) and nowhere else. New character's debut defaulted to
  "at the next settlement" (`engine/ui/characters/NewCharacter.tsx`), so a newcomer taking the defaults could wait
  most of a day to post.
- **Aura:** a wallet starts at 0 (`supabase/migrations/0003_aura.sql`), and nothing grants anything.
- **Card callouts** existed: the first mark of each card kind shows a one-line glass bubble, met kinds kept on the
  account (`docs/plans/2026-10-31-marks-and-the-lens-design.md`, section 5).

## 1. Signed out stays hidden

**Decided** (the owner): nothing changes. It "aligns with how a multiplayer game normally works and it also
encourages people to post more openly." The friend who sent the invite is the pitch.

## 2. The sequence

**Decided:** register, then a **welcome page** on the glass, then the existing **New character**, then the board,
where the **HUD tour** runs.

- The welcome page shows once, as soon as the account opens. It holds:
  - Gabe's letter, opening with "After nine years of development" ("a perfect opportunity for a Gabe 'After nine years
    of development' gag", the owner);
  - **Before you start:** theme, motion and text size, the controls of Settings › Accessibility, saved as they change;
  - "Make your first character," and a quieter "Read the Strategy Guide first."
- No time zone setting: every time is already shown in the viewer's own device time.

Weighed: straight to New character, which runs the tour before the player has chosen their text size or motion; a
multi-step wizard, which puts the most clicks between a newcomer and their first post.

## 3. Debuts

**Decided** (the owner): **"Drop now" is the default for every new character**, not only a first one. "I think
maybe more than half of the time people will want to just drop now." Loudness keeps its default, announced. "At the
next settlement" stays a choice.

## 4. The starting grant

**Decided** (the owner chose A): once per account, when its first character is made, the wallet gets **1.00** and the
hand gets **one common card picked by the class chosen**. "Just let them see it fill up … the kind of stuff that would
let people see how it works."

| Class      | Starter card | Flavor    |
| ---------- | ------------ | --------- |
| Heel       | Whoops!      | Salty     |
| Face       | Feelin' Fab  | Sweet     |
| Technician | Stick Around | Sweet     |
| Jabroni    | Autocorrect  | Pepperoni |
| Lurker     | Bluff        | Pepperoni |

- The orb lands solid, at once, not at a settlement, so the HUD tour shows it.
- The log says it plainly, as its own line ("Welcome gift: +1.00 and a Feelin' Fab") ("The fiction may lie; the log
  never does").
- **The masks.** The orb is in the private wallet, and the card is an ordinary common anyone can buy, so nothing
  public differs between a newcomer's first mask and a veteran's new one. The owner asked whether this was "too much
  privacy": a character's creation date is public, and the debut announces it, and that is fine. The rule's only bite
  here is that a newcomer-only card, once played, would say "this mask's player is new", which is a fact about who
  owns the mask. An ordinary card avoids it.
- **The layers.** The engine knows "a starting grant: an amount, and a card per class", as instance settings. A check
  refuses an instance whose grant names a class it lacks, misses one it has, or names a card that does not exist or is
  not common.

Weighed: a grant with every new character (a farm: six masks, six cards, and a veteran paid for alts); the orb at
account opening and the card at the first character (an orb shown before any HUD exists to show it).

**Waits:** the grant names Feelin' Fab (section 5) and Autocorrect (#150), so its task is built after both cards exist.

## 5. Feelin' Fab

**Decided** (the owner): a new card, the Face's starter. "On Minus World Feelin' Fab was the most common spell, #1 on
the list, cheapest to use. Used many times without being annoying, which is great for a sweet spell."

- **Common, Sweet, cast on a post.** The cheapest card in the pool.
- **Stacks to three, and the stack is its intensity** ("on MW it didn't exist. Maybe in this case it controls the
  intensity of the effect"):
  1. the post's whole background slowly cycles through a rainbow's colors, with a few twinkles at random spots (the
     Minus World version, which performed well);
  2. an animated linear rainbow gradient, with more twinkles;
  3. an animated radial rainbow, the most striking.
- **Reduced motion** (the owner chose A): a still version of each level. Level 1 is a **random rainbow color on each
  load** ("then you at least get the feeling of it changing without it actually moving"); levels 2 and 3 are still
  gradients; the twinkles are still sparkles, more at each level.
- **Permanent.** "In practice people don't like when their plays 'expire', especially because there are sometimes
  periods of inactivity, slumps etc." A post is always fully readable under it, so it needs no timer to be a way out.
- **Readable at every color:** post text stays at 4.5:1 against every stop of every level, in both board themes, with
  the text shadow on top: pastels behind black text, deep colors behind white. The contrast check
  (`engine/ui/contrast.ts`) tests every stop.
- **A busy page:** the animation runs only on posts in view, one observer per page, and is CSS on the compositor
  (an animated `background-position`, or a registered custom property for the hue or angle), never layout.
- It settles for its caster by class, as any card does.

Weighed for motion: slowing instead of stopping (still motion, and people who turn motion down often mean none); one
still look at every level (a reduced-motion reader could not tell one Feelin' Fab from three).

## 6. Lifetimes of effects

**Decided** (the owner): **an effect on a post is permanent; an effect on a character, a thread or a board keeps its
timer.** "Higher-level effects … are more visible. People are more likely to see them just from clicking around …
Whereas with a post-level effect, you have to actually be reading that thread, that page … they're just a lot more
impactful for the person receiving them, especially for a user level effect. It might drive them a little crazy if
they can't just wait for that to wear off, unless we design a 'way out' for each." This matches the reach design
(`docs/plans/2026-11-01-card-mechanic-design.md`, section 7) as it stands.

## 7. Tips

**Decided** (the owner chose C, then shaped it):

- **The guideline:** what play can show, play teaches; a tip appears only where the screen cannot explain itself. "When
  you can just show something through the gameplay and you can avoid taking someone out of it to explain something.
  That should always be preferred."
- **The HUD tour**, on the first board landing after the first character: three spotlights on what is always on
  screen: the character plate, the orbs (the gift orb in them), the hand (the starter card in it).
- **Tips that wait for the real thing:**
  - the reaction grid, the first time a picker opens: the class decides which corners pay;
  - the ghost fill, the first time the orbs show an estimate.
- **Cut, because play shows them:** the settlement (its summary opens by itself), the log (the summary's Open my log
  leads there), a card cast on you (the toast leads to the post, and the effect is there).
- **The card's mark is the existing callout** (the owner chose A): the card callouts join the tips, keeping their
  light bubble. The first callout a player ever sees adds one line: the mark opens the Lens.
- **Pacing:** one tip a page load at most; never while the player is typing; never over a game effect that holds the
  screen (Stick Around's hold, a takeover). A tip that cannot show waits for the next load.
- **Skip:** every spotlight has Got it and Skip all tips. **One Skip ends every tip for good**, including card callouts
  and tips not yet triggered ("If somebody clicks skip at any point, just never show any of them"). Settings ›
  Accessibility's **Tips** row (which replaces "Card tips") turns them back on, with Show tips again (forgets every
  tip and card met) and Replay the HUD tour.
- **The masks:** every trigger is on the player's own screen, and what was seen lives on their own account row, read by
  no one else. No tip shows for a reason another player can cause and then watch for.

Weighed: one tour of everything at once (it needs an invented example, against dropping the player into the world);
only tips in context (a player might never see half).

## 8. The Strategy Guide

**Decided:**

- **A glass page** in Gabe's voice: "true information, just sort of zazzed up." The name is a joke, a game reference;
  it is "a general explainer of the mechanics so people can understand what's going on."
- **Surface only** (the owner chose B, held to the surface): "We should include information that will help somebody
  who is totally new to this and totally lost. We should not reveal deep mechanics that we only know about because
  we've built the thing. Those are fun for people to potentially discover over time, share strategies in threads."
  Out of the draft go every "Strategy:" paragraph, the griefing-and-Turn example, the Bluff and long-post arithmetic,
  staged feuds between one's own masks, the list of tells in The Masks (it shrinks to what is private and that public
  conduct is fair game), and "Impress the boss on its first day."
- **Classes** show the class card's own description and grid marks, drawn from the class's entry, and a one-line
  **Gabe's hint** kept in the guide alone (the owner chose B: "I already like the look of the class selection screen").
  A build check holds the hint map to exactly the instance's classes, so the two lists are one.
- **Markdown with markers** (the owner chose A): the prose is the instance's Markdown; the class list, the card table
  and every number are markers the engine fills from the live instance, so the guide is true after every retune.
- **The welcome letter is the guide's first section**, so the menu gains one tab, Guide, and no Welcome tab.

Weighed: hand-typed numbers with a check (every retune edits prose); a React page (every copy edit a code change, and
no guide frame for another instance).

## 9. The persona's voice

**Decided** (the owner, on #151): the developer persona speaks on the Updates page, the welcome page, the Strategy
Guide, and the onboarding tips on whatever page a tip appears. CLAUDE.md's "The fiction may lie; the log never does"
had bounded it to the Updates page, written only by admins. Its last sentence now reads:

> The glass never speaks as The System or as any character in play; its one voice is the instance's developer persona,
> always true. It speaks on the Updates page, written only by admins in the running instance and never by a model, and
> in the instance's own welcome page, Strategy Guide and onboarding tips (on whatever page a tip appears), which are
> committed to the repository and approved by the owner in review. The glass's copy may joke wherever it describes the
> game, but never bluffs.

**Gabe's face** is the owner's sprite ("I made this sprite a couple years ago"), cropped to head and shoulders on a
violet matte and drawn pixelated. It replaces the placeholder on the Updates page too.

## 10. The screens

All three are on the glass (`docs/plans/2026-10-29-two-worlds-design.md`). The owner chose each recommendation:

- **Welcome:** the Updates page's frame. A side column says what happens next, plainly; Gabe's post holds the letter,
  Before you start and the button. Board: `docs/research/2026-11-02-onboarding/01-welcome.html`.
- **Guide:** contents that stay in view and mark the section on screen in cyan, beside one long article; every section
  can be linked to. On a phone the contents fold into a menu. Board: `02-guide.html`.
- **Spotlight:** the page dims to about 72% black with a 6px blur; an even-odd cut-out keeps the shown part sharp, with
  a cyan ring. Gabe's panel is a dialog: title, step count, Skip all tips and Got it; focus starts on Got it, Escape is
  Skip all tips. It fades in; under reduced motion it appears and the cut-out jumps. On a phone the panel docks as a
  sheet above the HUD. Boards: `03-spotlight.html`, `04-phone.html`.
- **The grid's marks** in the guide are the class cards' own drawing, so the guide cannot draw a corner the card does
  not: top row excited, bottom calm; left negative, right positive. (The first guide board drew the Face's wrong; the
  owner caught it.)

## 11. Ways out of the states this adds

- **The welcome page:** its button; the menu's Back to the board, whose HUD then offers Make a character.
- **The tour and each tip:** Got it, Skip all tips, Escape. Tips off: Settings › Accessibility › Tips.
- **A Feelin' Fab:** none needed; the post is readable under every level, like a Whoops! splat.
- **The grant** puts nobody in a state.

## 12. Weighed at a busy instance

- Tips and the welcome are one row of the player's own preferences, read with the preferences the client already loads.
- The grant is one check and two inserts at a first character, never a scan.
- A page of Feelin' Fabs animates only the posts in view, on the compositor.
- The guide renders from the instance and the settings the client already holds; it makes no request of its own.

## Open

- **Force Field's one-week ward** is the only post-level effect with a timer. Section 6's line may call for it to
  last until the post's author lifts it; for the owner, when a card session takes it up.
- **Copy:** every line of Gabe's is a draft for the owner's review in the build's PR (section 9's rule).
