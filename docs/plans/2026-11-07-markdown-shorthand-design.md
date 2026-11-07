# Markdown shorthand: design

Record, written 2026-11-07. A design session with the owner, who asked whether BBCode and Markdown could live together
seamlessly in a post. The answer: a fixed Markdown subset can, as shorthand for the nodes BBCode already makes; full
CommonMark freely interleaved with full BBCode cannot be made to always mean what the writer meant, and is not
attempted. The plan is `docs/plans/2026-11-07-markdown-shorthand-plan.md`.

## The idea

A post is parsed into a tree of allowlisted nodes (`engine/bbcode/parse.ts`), and everything downstream (the renderer
`engine/ui/bbcode/render.tsx`, the visible-text walk `engine/bbcode/visible.ts`, the text layers cards draw over, a
card's reading of a post in `engine/rules/cards.ts`) reads only the tree. Markdown shorthand is a second way into the
same tree, inside the same one-pass parser. BBCode stays the canonical form: the toolbar, Quote and every stock line the
engine composes write BBCode. A player who types Discord-style out of habit gets what they meant.

## 1. An engine feature, an instance switch

Weighed: always on in every instance, with no setting; Markdown as a game piece (unlocked by a card or class, or
punished by Mod Bots as an anachronism). Chosen: the engine knows the shorthand, and an instance switches it on or off
in its settings (`postSyntax`). Out of the fiction it is a friendlier parser, nothing more.

The owner chose the default to be on: the setting's recommended value, written in its doc comment and in Divided
World's settings, is `'bbcode+markdown'`. (Every setting is explicit per instance, checked by `instanceProblems`, so the
"default" is the value an instance is set up with, not a fallback the engine supplies.) **Divided World turns it on**:
its community types Discord-style.

## 2. Recorded per post

Weighed: every post renders by the instance's current setting at read time (the traditional forum behavior, which the
owner named), and a per-post toggle in the composer. Chosen, because it was cheap: **each written body records the
syntax it was written under, and is rendered by that forever.** Flipping the switch affects what is written next, never
how an old post looks, which is what "The System acts; it never destroys what a player wrote" and "Append-only" ask
of a post's appearance, and an export round-trips exactly.

- The values are `'bbcode'` and `'bbcode+markdown'` (type `PostSyntax`). Greentext is part of Markdown (section 4),
  so there is one switch and one key.
- A post's, edit's, spin's and update's Act payload gains `syntax` beside `body`, written by the SQL function that
  writes the Act, from the setting in force; a client never chooses it. An edit records the syntax in force when it
  was made, and `acts_public.current_payload` already takes the latest edit's payload, so a post renders by its newest
  version's syntax.
- An Act with no `syntax` key reads as `'bbcode'`: every Act an instance already holds keeps its look with no backfill.
- A signature lives in a `profiles` row, not an Act. `profiles` gains `signature_syntax`, set by `set_profile` from the
  setting when the signature is saved, so "BBCode, as in a post" stays true.
- **Model-written words are written like a player's**: a Mod Bot's or a pool persona's post records the setting.
  **Stock lines the engine composes** (a move's notice, an announcement, a move's end) record `'bbcode'`, so a
  character's name filled into one (`_Bob_`) is never read as Markdown.

## 3. What is admitted

The owner chose all four groups:

| Shorthand | Node |
|---|---|
| `**b**` | bold |
| `*i*`, `_i_` | italic |
| `~~s~~` | strike |
| `` `x` `` | code, with a new `inline: true` flag so it renders in the line |
| ```` ``` ```` fenced block | code |
| `[text](url)`, `<https://…>` | url, the address through `safeHref` |
| `![alt](src)` | img, the source through `safeImageSrc`, with a new optional `alt` |
| `- `, `* `, `1. ` at the start of a line | list (unordered, unordered, ordered) |
| `>` at the start of a line | greentext (section 4) |

Not admitted: `#` headings (no node exists, and "#1 fan" is common prose), indented code blocks, tables, HTML, setext
underlines, reference links. Each is text, exactly as typed.

An image written in Markdown carries its alt text to the screen; one with an empty alt, and every `[img]`, keeps
today's `altFor` ("Image from example.com"). BBCode gains no alt syntax here.

## 4. Greentext

Weighed: `>` stays plain text; `>` becomes a new unattributed quote node. A quote on this board always names an Act, so
a mask can never be shown quoting words nobody posted; an unattributed quote would break that, and would need a ruling
of its own. Chosen: **a line starting with `>` is greentext**, a styling node (`greentext`, holding the line's inline
nodes), not a quote. Its color is a theme token (`--kb-bb-greentext`) each theme sets, so the engine names no color. Its
words are the post's own in the visible text, so a card that works on a post's words sees them.

Weighed: greentext with a switch of its own. Chosen by the owner: it comes with Markdown, one switch.

## 5. The mixing rules

Confirmed with the owner as written:

1. **One pass, one stack.** BBCode tags and Markdown delimiters open frames on the parser's one stack. A closer closes
   only an opener of its own kind (`**` closes `**`, `[/b]` closes `[b]`), and closing it closes whatever was opened
   inside it and never closed, the rule the parser keeps today. `**[i]x**[/i]` is bold italic `x`, then the text `[/i]`.
2. **An unclosed Markdown delimiter is text.** Unlike a BBCode tag, which closes at the end and keeps its words, a `**`
   or `*` that never closes is the characters typed, so `2 * 3 * 4` and a lone `**` never embolden a post.
3. **Flanking, kept simple.** An opener is followed by a character that is not whitespace and is at the start or after
   whitespace or punctuation; a closer mirrors it. `_` also needs a word boundary on its outer side, so `snake_case`
   stays text.
4. **The order at `[`.** A known BBCode tag (`[b]`, `[url=…]`, and the rest of `OPENERS` and `CLOSERS`) wins; else a
   well-formed `[text](checked-url)` is a link; else the `[` is text. `[b](http://x)` is bold `(http://x)`, a known
   surprise the precedence table pins.
5. **Code turns everything off.** Inside `` ` ``, a fence and `[code]`, neither syntax is read.
6. **The backslash escapes Markdown only.** `\*`, `\_`, `` \` ``, `\~`, `\[`, `\]`, `\(`, `\)`, `\>`, `\-`, `\!` and `\\`
   show the character. BBCode keeps no escape: `\[b]` is a backslash and then bold, as it is today.
7. **Line constructs at a line's start only:** the list markers and `>`.
8. **A BBCode-only post parses as today.** A property test runs the parser's existing cases and generated posts with no
   Markdown punctuation through both syntaxes and asserts identical trees.
9. **The bounds hold.** One pass, no recursion, `MAX_DEPTH` counted across both syntaxes, no input quadratic, every
   address through the same checks.

## 6. Writing a post

The toolbar and Quote insert BBCode. The editor's preview renders with the setting in force, which is what the post
will be recorded under. With Markdown on, the editor shows one plain line in the house style beside its count:
"BBCode, or Markdown shorthand." With it off, nothing new shows. The signature's hint stays "BBCode, as in a post."
Divided World's Strategy Guide gains a short section with a table of both syntaxes, in the developer persona's voice,
which the owner approves in review.

## 7. Mod Bots' `noTag`

Weighed: `**b**` breaks a "no [b]" rule by effect; a second predicate by effect beside the literal one. Chosen: **`noTag`
stays literal**, about the tag as written. The Mod Bots are 2003 bots that do not read asterisks, and finding that out
is play; the rule's plain text names the tag ("No [b] tags"), and the log says plainly which rule broke and why, so
nothing lies and nothing traps. The Mod Bots plan (`docs/plans/2026-11-06-mod-bots-plan.md`) is unchanged: its
`rule_breaks` reads the body in SQL, which already matches the tag as written.

## The layers

All of it is engine (`engine/bbcode/`, `engine/ui/`, `engine/rules/`, `supabase/`), except: Divided World's
`postSyntax` value (`instances/divided-world/settings.ts`), its themes' greentext color (wherever each theme's tokens
live), and its Strategy Guide section. The instance's content reaches the engine through `Settings` and the theme
tokens; the engine names no instance.

## Ways out of the states this adds

None. The syntax a post records is not a state a player, a character or a post is put in: it changes how words are
drawn, and a player who wants a post drawn differently edits it, which records the setting then in force.

## What could slip a mask

- `syntax` is written from the instance's setting at write time, the same for every writer, so it says when a post was
  written relative to a settings change and nothing about who wrote it. When a post was written is already public.
- No refusal, delay or payload differs with who owns a post. The parser is pure and bounded, so its time depends only on
  the words, which are public.

## Open

- Whether a later instance wants greentext without Markdown. The single key is a closed list of values, so a third
  value can be added without reading old Acts differently.
- Smart punctuation, autolinked bare addresses (`https://…` with no brackets) and `@mentions` are out; mentions are a
  feature of their own (`docs/plans/2026-11-02-alerts-design.md`).
