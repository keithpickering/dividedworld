# The glass in email: design

Record, written 2026-11-07. Designed with the owner in one session, which began as impeccable's `shape` step and
continued as a design session. The mockup is `docs/research/2026-11-07-mail/`. The plan that carries this out is
`docs/plans/2026-11-07-glass-mail-plan.md`.

## 1. What this is

Divided World sends two emails today: the sign-in code and the sign-up code (`supabase/templates/sign-in.html` and
`sign-up.html`, set in `supabase/config.toml`). They are four lines of bare HTML. The conduct design
(`docs/plans/2026-11-02-conduct-design.md`, section 7) adds mail through Resend: report read, nudge, hidden, hidden
until edited, suspended, banned and lifted. Its plan (`docs/plans/2026-11-02-conduct-plan.md`, Task 3) is not built,
and its `Mailer` sends plain text only.

This design gives every email one shell, in the glass's look as closely as email HTML allows. The two Auth emails use
it now, and the conduct mail uses it when it is built. Game notifications, which the alerts design leaves open
(`docs/plans/2026-11-02-alerts-design.md`, section 7), can be added to it later without changing the frame.

**World:** the glass (`docs/plans/2026-10-29-two-worlds-design.md`). An email is out of character: plain, never The
System's or any character's voice, and never in the developer persona's either. It is account and moderation mail,
written plainly ("The fiction may lie; the log never does").

**Mode:** Operate. The player is in the middle of a task (signing in), or has just learned something real about their
account. The look shows in precise details, and nothing in it slows reading.

## 2. Decisions with the owner

1. **Scope** (the owner: "Auth + conduct but leave a path for extending the shell later to handle game notifications").
   The shell is a fixed set of typed blocks. A future email adds a block type; it never forks the frame. Weighed:
   building for Auth only (B), which would leave conduct to invent its own frame; and building every future email now
   (C), which would design blocks for content nobody has designed yet.
2. **Smoke, layered** (the owner chose A). Every color is set as a plain color, so the email reads complete with images
   blocked. A baked smoke image sits under the masthead, where the client shows it. Weighed: flat colors only (B), the
   plainest look; and a required smoke hero (C), which shows only alt-less blank ground when images are blocked.
3. **Smoke in a masthead band** (the owner chose A). The band is 600 by 180 CSS pixels, baked at 2x, and fades to the
   ground in its lower 60%, so it ends without an edge before the seam. Weighed: the whole column (B), which seams or
   runs out on a long conduct email and which more clients drop as a body background; and smoke only behind the focal
   panel (C), which puts the image behind the text that most needs contrast.
4. **Masthead and foot** (the owner: "Name as text only but include the coin centered in the footer as the very last
   thing in the template"). The masthead carries the instance's name in the display face as live text, and nothing
   else. The coin is the last thing in the email, centered, 40px, with empty alt text.
5. **The look and the copy** (the owner confirmed the mockup, with its copy change). The sign-in email's first line
   becomes "Type this code where you asked for it, or use the button to sign in." The sign-up email's first line becomes
   "Type this code where you asked for it, or use the button to finish signing up." The code moves into its own panel.
   The preheader says "Your code is {code}." The closing sentences stay word for word.

## 3. The look, translated

What the glass does, and what email can do instead:

| The glass | In email | Why |
| --- | --- | --- |
| Procedural smoke, drifting | A baked JPEG of the `page` recipe, in the masthead band only | No filters and no animation in mail; a background image works in Apple Mail, iOS, Gmail on the web and Outlook through VML |
| Near-black violet ground | `--kb-glass-ground`, set as `bgcolor`, as `background` and again as a `linear-gradient` | Gmail's apps invert a flat color but not a background image |
| The seam: 1px pale cyan with a cyan glow | One 1px row of `--kb-glass-pale`, then three 1px rows of `--kb-glass-neon` blended over the ground at 38%, 18% and 7% | box-shadow is dropped by most clients; solid rows render everywhere |
| Chamfered panels, the border drawn along the cut | A square panel with a 1px border, and a 12px corner image (2x) with the cut and its diagonal edge baked in | No clip-path in mail. With images blocked the panel is square with its border whole, never broken |
| Skewed buttons | A square button in neon fill with dark ink, chamfered bottom right by a corner image | Gmail strips `transform` |
| Anton and Barlow Condensed | `@font-face` from the instance's own site. Anton falls back to Impact, then Arial Narrow; Barlow Condensed falls back to Arial Narrow, then Arial. Outlook on Windows is given Arial by a conditional style | Clients that load web fonts (Apple Mail, iOS Mail, Samsung, Thunderbird) get the faces. Gmail and Outlook do not, and a declared web font with no fallback makes Outlook use Times |
| Cyan for the selected, gold for the earned, Salty pink for loss | Cyan for the action and the code's edge. No gold and no pink in Auth or conduct mail | They are game pieces. A notification block may use them later |
| No rounded pills, no soft shadows | The same | |

**Type.** The masthead name is the display face at 34px. Headings are the display face at 30px, uppercase. Body text is
Barlow Condensed Medium at 20px; notes are 18px and labels 16px SemiBold, uppercase with 2px letter-spacing. The code is
the display face at 48px with 12px letter-spacing and tabular numerals. Body copy never goes below 18px. The code is
typed text in one run of digits, so it copies without spaces.

**Color.** Every color the shell writes comes from the instance's glass tokens (`instances/<name>/ui/glass.json`, the
standard key), or is one of them blended over the ground by the shell. There is no second list of colors. Text is held
to 4.5:1 against the plain ground and against `--kb-glass-field` (the panels), with no smoke behind it. The masthead
name is large text, held to 3:1 against the `page` recipe's full worst, as the glass guard reads it.

**Width.** The column is at most 600px and fluid below it. Under 620px the side padding drops from 40px to 24px, by a
media query where the client honors one, and the column still fits at 320px where it does not.

**Dark mode.** The email is always dark; there is no light variant.

- The head declares `color-scheme: dark` and `supported-color-schemes: dark`, so Apple Mail and Outlook for Mac leave it
  as it is.
- Gmail's apps invert colors regardless. The ground's background image survives that. Text is kept light by Gmail's
  blend-mode wrappers (`u + .body` selectors, `mix-blend-mode: screen` and `difference`), which only Gmail matches.
- Outlook.com and the Outlook apps' partial inversion leave a dark design mostly alone.

**Images.** There are four images, plus the fonts: the smoke band, the two corners and the coin. Each is a static file
on the instance's site, the same bytes for every recipient. Every image has a width, a height and alt text (empty for
all four, since none carries meaning), and nothing breaks when it is missing.

## 4. The blocks

An email is a subject, a preheader and a list of blocks. The shell draws the masthead, the seam, the blocks in order,
then the foot (the instance's name and its site link, over a rule) and the coin.

| Block | Draws | Used by |
| --- | --- | --- |
| `heading` | The display face, uppercase | Every email |
| `paragraph` | Body text | Every email |
| `code` | A field panel, chamfered top right, with a label and the code | Sign-in, sign-up |
| `button` | The neon button, chamfered bottom right, with a link | Sign-in, sign-up, hidden until edited |
| `facts` | Label and value rows over violet rules | Hidden, suspended (the thread, the rule, the date, the admin's note) |
| `quote` | A field panel with a violet edge, holding the player's own words, with a label | Hidden, hidden until edited |
| `note` | Smaller body text, the email's last sentence | Every email |

The shell writes a plain-text body from the same blocks, for Resend's text part. Supabase Auth sends HTML only, so the
HTML must stand alone.

**The way to add game notifications** is a new block type in the same list, such as an Aura line, a card's thumbnail or
an unsubscribe foot with `List-Unsubscribe`. Each arrives with its own design. None is designed here.

## 5. Layers

- **Engine** (`engine/mail/`): the block types, the HTML and text renderers, color blending, escaping, and the default
  words of the two Auth emails with the instance's name as a slot. It is pure TypeScript with no DOM and no vendor
  client, so Node, Deno and Vite can all import it ("Portable by construction"). It never names an instance.
- **Instance** (`instances/divided-world/mail/`): a `MailTheme` built from its `glass.json` and its site's address. It
  carries the token names the shell reads, the font files and stacks, the asset URLs and the name. The baked assets
  are served from the instance's `ui/public/mail/`, which the web build copies to `https://dw.gripe/mail/`.
- **Composition root** (`supabase/functions/_shared/mail/`): it renders the two Auth templates for the deployed
  instance, with Supabase's `{{ .Token }}` and `{{ .ConfirmationURL }}` as slot values. Later, conduct's sender renders
  each outbox row here.

**One source, two renderers.** The two files in `supabase/templates/` are generated and committed, and the build
refuses them when they differ from what the generator writes. Resend renders the same shell at send time.

## 6. What could prove a private fact

Every recipient gets the same asset URLs and the same markup. The only parts that differ are the code, the link, the
dates, an admin's note and the player's own quoted words. Nothing in the shell varies with whether an address has an
account, who owns a character or anyone's class. The sign-in and sign-up emails differ as they already do; this design
changes how they look and no part of when they are sent.

There is no tracking pixel and no per-recipient image URL. An image load tells the site's host that some email was
opened, and nobody else. Gmail and Apple's Mail Privacy Protection proxy those loads anyway.

The report-read email stays one template whatever the outcome (the conduct design, section 6). The shell changes how it
looks, not what it carries.

## 7. Ways out

The shell adds no state that a player, a character or a post can be put in. The conduct emails carry the ways out the
conduct design names: editing the post, the suspension's end date, and replying to the email.

## 8. Accepted limits

- Gmail and Outlook show the fallback faces (Impact and Arial Narrow), not Anton and Barlow Condensed. The glass's
  craft rule calls a system display face a failure as a page's voice. In email it is what those clients allow, and the
  faces load wherever a client takes them.
- The buttons are square with a chamfer, not skewed.
- Outlook on Windows may show the corner images with a hairline seam. The square fallback is whole when it does not
  load them.
- Real-client rendering (Gmail on iOS, Apple Mail, Outlook on Windows) cannot be tested by the build. The owner checks
  it after the first deploy (the plan's last task).

## 9. Open

- The words of the conduct emails are the conduct plan's (Task 3, `TEMPLATES`). The mockup's hidden-post email uses
  stand-in words.
- Whether a player's high-contrast choice should reach their email. The standard key already meets 4.5:1 on the plain
  ground, and a mail client's own zoom covers text size. Not designed here.
