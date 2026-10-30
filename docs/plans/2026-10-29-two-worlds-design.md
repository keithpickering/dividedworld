# Two worlds: the board, and the game behind the glass

Record, written 2026-10-29. A design session with the owner, started from a visual question the owner put: how the
house style (harsh contrast, 1px borders, web-safe fonts) can be contrasted with "an extraordinarily gamelike
interface for game elements such as the HUD, aura orbs, postcards and hand, modals for character config", "taking
inspiration from the sort of dark, cloudy neon look of newer WWE games". "In theory the game view is the forum, the
2003 styling. We can imagine this as being as separate from the 'meta interface' as a real video game's HUD and
settings menus are from its actual gameplay window, i.e. a portal into a different world."

It was worked as a canvas of mockups, one board per screen, and each question after the first was put to the owner one
at a time with alternatives and a recommendation. The boards, as the owner approved them, are in
`docs/research/2026-10-29-two-worlds/`. The owner on the finished set: "These mockups are perfect, I'd like to really
aim for this exact look." So the boards are the look's reference: a build matches them, and where a board and this
design disagree, the design wins on what is decided and the board wins on how it looks.

This design changes `docs/plans/2026-10-29-screens-design.md`, which the web and cards plans build. Its plan is
`docs/plans/2026-10-29-two-worlds-plan.md` (the engine's one change), and the screens' two plans carry the rest as
amendment blocks, as the clues and class reveal designs did: `docs/plans/2026-10-29-screens-web-plan.md` and
`docs/plans/2026-10-29-screens-cards-plan.md`. None of the screens is built yet.

**Amended 2026-10-30, after the pause-menu boards.** The owner compared the Main, Phone, Turn and Hold boards as first
approved with versions drawn to section 5, and chose the second: "the pause menu just feels like a more fleshed out
version, I approve that direction". Those versions replaced the first in `docs/research/2026-10-29-two-worlds/`, and
they settle Open's "Three boards behind section 5":

- The board's 2003 banner holds the board's own links only. Sign out leaves it for the glass.
- The HUD carries Menu, with an Esc key cap, beside the hand. On a phone the HUD's Menu has no key cap, and the 2003
  header's own button reads Boards, so the two worlds do not both have a button called Menu.
- The Turn modal opens over My characters, the glass page it was opened from, with the menu bar left in view, dimmed
  and inert. Close and Esc return to My characters. So section 5's overlays open "over the board" when the board
  opened them, and otherwise over what opened them, as the web plan's Task 3 already says.
- The places where the two worlds have to touch did not change: an armed card's "Play Whoops! here" on a post, the
  postcards rising over the board, and Stick Around's frame around the held post.

Two placeholders these boards add, beside Open's: the banner's links past Index (General, The System, Search), which
are an instance's boards and a search no design has decided; and where in the glass Sign out lives.

**Amended 2026-10-30, after the boards' audit** (`docs/plans/2026-10-30-glass-to-the-boards-plan.md`). The boards draw
not one smoke but nine recipes, each tuned to its screen, so section 4's smoke is a recipe per surface, and the guard
checks every text color against every recipe its surface uses. The settlement's smoke is too bright for its large type
to stand on it uncalmed (`#f1ecff` at 2.81:1), so on that surface every text node stands in a calm, as its board
already draws its heading. That plan's section 9 takes defaults for this design's Open placeholders (Search is not
built; Sign out is at the foot of Settings, Account; the machine's name stays a placeholder; Rankings' first look), each
for the owner to overturn.

The words this design uses: **the board** is the 2003 message board, the game's arena; **the glass** is everything
outside it, the game's own interface. The owner, on the direction: "It even fits the name of the game." The board and
the glass are the divided world.

## 1. Two worlds: the board is the arena, and everything else is the glass

**Decided:** two looks, and each screen belongs to one. The board (the index, boards, threads, posts, profiles, the
standings, the reveal, The System's board and every post on it) stays the 2003 BBCode board of the screens design:
Verdana and bold Courier New, black and white, 1px rules, color only on the game's own pieces. The glass is everything
else: the HUD, the hand, the React picker, the play form, the Turn modal, the Vending Machine, My characters, the log,
Rankings, settings, the account screens, invites, errors, and real moderation.

The owner, on where settings belong: "if the settings have a 2003 style we almost accomplish the opposite of your
goal, since the 2003 style is the gameplay arena. If you buy a video game, all the settings still look like the video
game HUD." On accessibility: "The glass styling remains accessible regardless, easily achievable with modern CSS and
JavaScript." And on what the contrast does: "Maximum contrast, and it will ensure people see the forum as a game first
and foremost."

Weighed: settings, the account and errors in the 2003 style, with only the HUD and the game pieces as glass (it was the
first board's reading; the owner's point is that it makes the board look like the menu rather than the arena); the
glass as an accent only (neon borders on 2003 screens), which keeps neither world whole.

## 2. The look of the glass

**Decided:** the boards' look, as the owner approved it. Each value below is Divided World's (section 6), and the
boards in `docs/research/2026-10-29-two-worlds/` are the reference for all of them.

- **The ground** is near-black violet, `#07050d`, opaque under everything, so the glass is legible before any smoke has
  drawn and when it never does.
- **The smoke** is two procedural layers of fractal noise over the ground, violet (`rgb(140,36,250)` at 0.95) and cyan
  (`rgb(20,217,255)` at 0.5), each blurred (the owner: "I would make the clouds a bit blurrier"; the boards blur at a
  standard deviation of 18px). It drifts slowly under full motion and holds still under reduced motion.
- **The calm** thins the smoke behind text (section 4): the owner's "weigh the clouds toward areas without text to keep
  text backgrounds closer to solid black without trending toward a surplus of solid background modules."
- **Neon:** cyan `#19e3ff` for the selected and the current (with its pale `#c9f8ff` and `#9ef4ff` for text), gold
  `#ffd93d` for what is ready or earned, Salty pink `#ff3d7f` for loss. Text is `#f1ecff` and `#e4def7`. Each class
  keeps its color from the board's game pieces (Face `#3db8ff`, Heel `#ff3d57`, Lurker `#2ef0a0`, Jabroni `#ffd93d`),
  shown to a player only for their own characters' classes (section 7).
- **Type:** Anton for headings and numbers that are moments; Barlow Condensed, in weights 500 to 800 and italic, for
  everything else. Both are SIL Open Font License faces and are served from the instance's own files, never from a font
  service, so no third party sees who reads the glass and an instance exported and moved keeps its look ("Portable by
  construction").
- **Shapes:** buttons and tabs skewed by -10 degrees with their text set upright inside; panels with chamfered corners;
  a glow of the neon on what is selected or ready. No rounded pills, no soft drop shadows: the glass is a game's menu,
  not an app's.
- **The seam:** where the glass meets the board (the HUD's top edge, a modal's frame), a 1px rule of pale cyan with a
  cyan glow, so the two worlds touch at a line.

Weighed: a flat dark theme with no smoke (it loses the WWE register the owner asked for); a smoke image instead of a
procedural one (its worst pixel has to be measured from the file, and it cannot drift or reflow).

## 3. The glass never speaks in character

**Decided** (the owner, A): the glass is always plain and always true. The System is an enemy inside the game, and its
voice (the bluff, the cruelty, the Mod Bots' personas) lives only on the board, as its posts. The owner: "The System
is an enemy within the game, the Glass is helping you play the game efficiently." A card's name and a player's own card
message may appear in the glass, as the things they are; a card's description there is its rules, in plain words.

This is CLAUDE.md's "The fiction may lie; the log never does" given a place to stand: the fiction is the board, and
the glass is where a player steps back from it.

Weighed: the glass speaking as The System (a menu that bluffs, which would leave a frustrated player nowhere to stand);
the glass speaking in character for the game's flavor only, never for facts (a line that drifts).

## 4. Text on smoke, by game rules

**Decided** (the owner, A): the glass follows the rules games use for text, not the rules websites use, because the
glass is a game's interface. The rules are the Xbox Accessibility Guidelines 101 (text display) and 102 (contrast),
read at PC sizes. The board, a web page in the fiction and in fact, keeps WCAG 2.2 AA. The owner: "I want to make sure
for the glass we lean toward game UI rules and not normal web ones", and before it: "We should design our rule updates
around the look you are cultivating now rather than feel constrained the other way around."

1. **Size.** Glass text inks at least 18px from ascender to descender at 1080p (XAG 101's PC figure). The two faces ink
   a measured share of their em: Barlow Condensed 0.90 (0.91 at weight 800), Anton 0.99. So Barlow Condensed is never
   below 20px on the glass, body copy is 21px, and labels a player must read are 20px or more. On a phone, which is held
   closer than a monitor, the floor is 16px of Barlow Condensed and body copy 17px; that figure is this design's, not
   XAG's, and is checked on real phones (Open).
2. **Large text** inks at least 36px (Anton at 37px or more, Barlow Condensed at 40px or more) and may stand on the full
   smoke at 3:1. At the boards' smoke the worst pixel is `rgb(77,126,247)`, luminance 0.232, and only the palest text
   clears 3:1 there: white 3.72:1, `#f1ecff` 3.22:1, `#c9f8ff` 3.25:1. A large heading in `#9ef4ff` (2.99:1), gold
   (2.70:1) or cyan (2.39:1) takes a calm like any other text.
3. **Everything else** reaches 4.5:1 against the worst pixel beneath it, which means it stands in a calm. Each text
   color has a ceiling the ground under it must stay below: `#e4def7` 0.129 luminance, `#f1ecff` 0.152, gold 0.119,
   cyan 0.100. Text a player cannot use yet (a Turn that opens later) reaches 3:1. Type is opaque, never translucent.
4. **The calm belongs to the words.** It is a backing on the text block's own element, sized by the block and feathered
   at its edge, so it follows the text when it reflows at 200% and cannot drift away from it. It fails safe: where a
   browser cannot feather it, it is a hard-edged dark panel and the text is still legible. This is the lesson of the
   owner's jamacha-greens page heroes, where the shade sized by the words' own wrapper was the one that held across
   widths (that repository's `tools/check-hero-scrim.mjs` and its hero styles).
5. **Player options:** high contrast, where every line of glass text stands on solid ground and reaches 7:1 (XAG 102's
   enhanced level); text size from 100% to 200%, the glass folding into one column past 150% with nothing cut off; smoke
   at full, low or off; motion following the device, reduced or full, reduced keeping every card's effect and cost.
6. **Blocks of text** longer than two lines are at most 80 characters wide and set at 1.5. A label of one or two words
   may be capitals. A logo, a card's name drawn as its art, and decoration are exempt.
7. **Two guards.** One reads the instance's glass tokens and does the arithmetic above before anything renders: the
   smoke's worst pixel from its layers, each text color against the full smoke (for large text) and against the calm (for
   all text), the high-contrast key against 7:1 and against the same list of tokens as the standard key, and each text
   size against the floor by its face's ratio. The other measures the rendered glass in a browser: each glyph's inked
   height, and whether each text node that is not large stands in a calm. Each is driven red first (the plan's poisons).

The boards were redrawn to these rules before the owner approved them; the first set had body text at 15 to 19px.

Weighed: WCAG's sizes for the glass too (B: a website's rule for a game's interface, and it let the first boards set
body text at 15px); solid panels behind all glass text (the "surplus of solid background modules" the owner ruled out).

## 5. The crossing: a pause menu

**Decided** (the owner: "Pause menu is awesome, that's the right idea"): the glass's pages are full screens, each
under the same menu bar: Back to the board (and Esc), the Vending Machine, My characters, Rankings, My log and Settings.
Every way into the glass is the HUD's: its menu button and its own pieces (the orbs open My log, the avatar My
characters, the hand the hand drawer). The board's 2003 banner holds only the board's own navigation. Going back
returns the reader to the place on the board they left.

The glass's overlays (the hand drawer, the React picker, the play form, the Turn modal, a card's controls on a post)
open over the board, dimming it, and close back onto it, focus held while open and returned when closed.

Weighed: the glass pages as modals over the board (they are long, and a log or Settings in a modal crowds both
worlds); the glass's links in the 2003 banner (the board then carries the menu, the opposite of section 1).

## 6. The layers: the engine owns the two worlds, and the instance owns the look

**Decided** (the owner, A): KayfaBB owns the split and its rules, so every instance is two worlds: which screens are the
board and which are the glass, the pause menu, the HUD's ways in, the glass's plain voice, the type and contrast rules
with both guards, and a theme interface for the glass beside the board's. An instance owns the look: the palette, the
smoke's layers, the calm's strength, its fonts as files, the shapes, and the board's era (Divided World's is 2003).

The interface is `InstanceUi.glass` (the web plan's Task 1, amended): token values for the standard and the
high-contrast keys (the glass is dark under both of the device's modes, and the board's theme keeps its light and
dark); the smoke as data
(each layer's color, opacity, frequencies, octaves, seed and blur), from which the engine draws the smoke and the guard
computes its worst pixel; the calm's opacity and feather; each font's file and its measured ink ratio; and the
high-contrast key.

Weighed: the glass as Divided World's alone (B: the next instance would rebuild the split); the engine owning the look
too (C: the engine would know an instance's palette).

## 7. Character pages stay on the board; Rankings is the glass's

**Decided** (the owner, A, and more): what is public about a character is the board's. Its profile, the season's
standings and the reveal stay 2003 pages, because they are the arena's record and anyone can watch them. The owner: "a
profile is an integral part of character identity". The glass gains **Rankings**, "WWE style rankings in the glass too
for personal reference": a player's own view of the season's public standings, in the glass's look, with their own
characters marked.

The rule for the glass, from this: the glass may show public facts as a reference, and only the player's own private
facts. Rankings marks a player's own characters and their classes; it shows anyone else's class only where its player
made it public (`docs/plans/2026-10-29-class-reveal-design.md`), and never a count or an order computed from who owns
what.

**Scope drift, named:** the owner would "consider crazy stuff like custom HTML within reason. Geocities, FrontPage,
freewebz with a z would be a cool goal" for a character's profile. That is a design of its own (Open): a homepage a
player writes is the board's, and an outside image or stylesheet on it can watch who reads it, which is a way to read
a mask.

Weighed: profiles in the glass (the glass would then hold other players' characters' pages, which are the arena's).

## 8. What this changes in the screens design

- **Section 2 (the frame):** the 2003 banner holds the board's own navigation; the HUD is the glass, docked at the
  bottom, and is the only way into the rest of the glass (section 5).
- **Sections 7, 8 and 9 (the log, characters and Turns, the Vending Machine and playing a card):** in the glass. The
  log keeps every word of its section; only its look changes. The boards add one screen of the log's, the settlement's
  summary ("While you were away"): on the player's first visit after a settlement, each of their characters' result
  from that settlement in the log's own words, its rank and any Turn that took effect, with Open my log and Back to the
  board as its ways out. It is built from the same rows as the log and says nothing the log does not.
- **Section 12 (the out-of-character screens):** in the glass. Registration, sign-in, invites, settings and errors keep
  every decision of that section. Settings gain smoke, contrast and text size (section 4). The themes of section 12
  restyle the board.
- **Section 13 (the index, the profile, the reveal):** unchanged, on the board; Rankings is added in the glass.
- **Section 15 and the brief:** the forum meets WCAG 2.2 AA; the glass meets it and XAG 101 and 102 as section 4 reads
  them.

`PRODUCT.md`'s positioning, brand commitments, themes and accessibility say the same, and the design session's skill
(`.claude/skills/design-session/SKILL.md`) asks a screen's design which world it is in.

## Open

- **The phone's floor** (section 4.1): 16px of Barlow Condensed is this design's figure, to be checked with the owner on
  real phones.
- **What Rankings shows** beyond the public standings and the player's own characters marked: tiers, title holders,
  movement since the last settlement, all of which the owner may want in the WWE manner.
- **Character homepages** with custom HTML (section 7): a design of their own.
- **Whether a player-made theme can reach the glass.** Until the owner decides, a theme restyles the board only, since
  the guard cannot check a theme it has not seen.
- **Placeholders the boards invented**, each instance content or a rule the owner has not given: the Vending Machine's
  name; the rank names (Enhancement Talent, Midcarder, Main Eventer); the pip style select's styles beyond the default;
  the dim behind Stick Around's hold; Settings' Notifications, Privacy and Export my data sections, and its "Announce
  card effects" read-out, which no design has decided. What the boards show that is decided elsewhere stands as it was
  decided: six characters at most, an admin retiring one on request, and the Turn cooldown (30 days, an instance
  setting, `instances/divided-world/settings.ts`).
- **Where the settlement's summary remembers it was seen:** on the device (the web plan's choice, so it may show again
  on a second device) or on the account.
- **One number the boards disagree on:** the Turn board shows Pipewrench's standing as 2.40 where the log and the roster
  show 2.95 before the night's rank up and 3.30 after it. The log's set is the coherent one.
- **Three boards behind section 5,** which was decided after they were drawn: the Main, Turn and Hold boards' 2003
  banners still list the glass's pages beside the index, Main's HUD has no Menu button yet, and the Turn board opens its
  modal over a 2003 My characters table. Section 5 wins: the banner holds the board's own navigation only, the HUD
  carries Menu, and My characters is the glass page of the Roster board.

## Review focus

- The calm at 200% text and in one column on a phone: whether a backing sized by its block still covers every glyph
  when the block wraps, and whether the feather stays outside the text.
- The smoke's drawing cost on a phone, drifting behind a long log, and the battery under full motion.
- A smoke layer an instance tunes brighter: whether the token guard is the only thing between it and every glass page.
- Rankings: that its marks, its order and its counts are computed from public rows and the player's own, and from
  nothing that a player's own marks could expose to another player's screen.
- The seam: a theme that restyles the board, reaching across into the HUD or a modal's frame.
