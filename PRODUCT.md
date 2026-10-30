# Product

<!-- impeccable:product-schema 1 -->

This is the product record impeccable reads before any design work (`.claude/skills/impeccable/`). The working rules
are `CLAUDE.md`; the decisions behind every line here are in `docs/plans/`.

## Platform

web

## Users

A cast of people who have known each other for over twenty years, across MFGG and then Minus World: adults (18+)
sharing a social context in which the game's "harassment" reads as play. Each person (a **player**) signs in to one
**account** and plays up to six masked **characters**, each with a hidden class. They read the board in bed on a phone
and at a desk on a computer, and switch between the two daily. Registration is invite-only for the playtest and opens
once real moderation tools exist.

## Product Purpose

**Divided World** (dw.gripe) is a kayfabe forum game: a message board where everything anyone does is a public Act,
characters earn Aura by drawing the reactions their secret class favors, and an arbitrary machine, The System, runs the
board, settles Aura daily, and ends each season with a public reveal of every character's classes (never who played
them). Success is a board the cast keeps coming back to: performances, accusation threads, ripostes with postcards,
and the reveal.

## Positioning

Two worlds, as the name says: a 2003 BBCode message board that is the game's arena, and behind the glass the game's
own interface, dark, smoky and neon in the manner of the newer WWE games, as separate from the board as a video game's
HUD and menus are from its play. Any character might be someone you know; the masks hold because the system never tells
and never lets anyone measure who is behind them.

## Operating Context

- The board (the index, threads, posts, profiles, the standings, the reveal) is the arena, in the 2003 look. The glass
  is everything else: the HUD docked at the bottom of every board page (the character being played, the orbs, the
  hand), the hand drawer, the React picker, the play form, the Turn modal, and full-screen pages under one menu bar
  like a game's pause menu (the Vending Machine, My characters, Rankings, My log, Settings), plus the account screens
  and errors. Every way into the glass is the HUD's, and Back or Esc returns the reader to the post they left.
- The System speaks only on the board, as its posts, and may bluff there; the glass never speaks in character.
- Daily settlement turns the day's reactions into Aura; between settlements the HUD shows a live estimate.
- Postcards are played on posts as Acts of their own: Stick Around holds a reader on a post; Whoops! splats it in ink
  that readers scrub and the author washes.
- The engine is **KayfaBB**; Divided World is its first instance and supplies classes, cards, reactions, ranks, copy
  and theme. The engine's screens never name an instance.

## Capabilities and Constraints

- Desktop-first and fully playable on a phone; layout in percentages so it fits any screen.
- Vite, React and TypeScript with Motion and Storybook; Supabase behind it; the server decides every game rule and the
  client only previews.
- No page, payload, live event or timing may vary with a private fact (who owns a character, a class, who reacted,
  whether an address has an account).
- Every state a player can be put in names its way out; the fiction may bluff, but the player's own log and every
  out-of-character screen speak plainly.
- Themeable: every color, font and border comes from named tokens and every screen has stable hooks, so a theme is a
  CSS file of overrides; admins consider player-made themes for the selector. A theme restyles the board; whether one
  can reach the glass is open. The engine owns the two worlds and their rules; the instance owns both looks.
- Open: the Vending Machine's name, rank names, pip styles beyond the default, card art.

## Brand Commitments

- The house style: a 2003 BBCode message board. Verdana for body and UI, bold Courier New for headers, logs and system
  text; black and white, in light and dark themes; color only on the game's own pieces (orbs, postcards and their
  effects, reactions, rank pips, the Vending Machine).
- The glass: a near-black violet ground under two layers of slow procedural smoke, violet and cyan; cyan for the
  selected, gold for the ready and earned, Salty pink for loss; Anton for headings and moments, Barlow Condensed for
  the rest, both served from the instance's own files; buttons and tabs skewed, panels chamfered, no rounded pills and
  no soft shadows. The boards in `docs/research/2026-10-29-two-worlds/` are its reference, and a build aims at exactly
  that look.
- The board and the glass touch at a seam: a 1px rule of pale cyan with a cyan glow.
- Neither look governs which interactions are allowed: a modal or a bottom sheet is used where it is the best
  experience.
- Paper Mario: The Thousand-Year Door's HUD and orbs; WWE crowd psychology (Faces, Heels, Turns); Minus World's spells.

## Evidence on Hand

The owner's prototypes of the Whoops! splat and the TTYD Aura bar, and Minus World's spellbooks
(`docs/research/minus-world/`). No testimonials, metrics or players yet: the game is pre-alpha.

## Product Principles

- The game may be unfair; it may never be a trap.
- The masks hold: the system never tells and never lets anyone measure.
- A wait is designed, never incidental.
- An obstacle's accessible path costs what the obstacle costs; the forum around it has no friction.
- Nothing a player wrote is destroyed; effects are layers over it.

## Accessibility & Inclusion

WCAG 2.2 AA for the forum itself: reading, posting, navigating, settings and the log (contrast, focus, keyboard,
labels, reflow to 320px, reduced motion). The glass meets it and also follows the rules games use for text, the Xbox
Accessibility Guidelines 101 and 102 read at PC sizes: text inks at least 18px at 1080p (Barlow Condensed at 20px or
more, body copy 21px), large text may stand on the smoke at 3:1, everything else reaches 4.5:1 on a calm thinned
behind it, and a player may choose high contrast at 7:1, text up to 200%, the smoke low or off, and reduced motion
(`docs/plans/2026-10-29-two-worlds-design.md`, section 4). Game obstacles follow CLAUDE.md's "An accessible path costs
what the obstacle costs": reduced motion makes an effect instant, never absent.
