# The backfill design session's boards

Record, written 2026-11-05. The boards the backfill design session (`docs/plans/2026-11-05-backfill-boards-design.md`)
draws with the owner, for the glass screens built without a board, and as amendments to the onboarding and The System
boards drawn before #202. They are drawn on #202's head (commit c2553b3), in the two-worlds boards' own markup
(`docs/research/2026-10-29-two-worlds/`): the same smoke, menu bar, display title, skewed controls and row rules. They
are references for the look, not code to copy. `gen.mjs` writes every board here (`node
docs/research/2026-11-05-backfill/gen.mjs`); each is one self-contained HTML file at a fixed size, loading Anton and
Barlow Condensed from Google Fonts.

The numbering continues the two-worlds folder's (01 to 13), so no board id here repeats one in another folder that
`e2e/boards.spec.ts` reads.

## Batch 1: the door

- `14-sign-in.html`: Sign in, 1440 by 1000. One field and one primary action on the left; the other ways in (New here?,
  Stuck?) as an aside on the right.
- `15-register.html`: Register, opened from an invite link, 1440 by 1000. Email, the filled invite, the 18+ check and
  Send a code; Already playing? and Stuck? in the aside.
- `16-contact.html`: Reach a person, 1440 by 1000. Each way to reach the admins is a row in the Settings board's idiom.
- `17-front-door.html`: the front door, 1440 by 1000. #224's sample thread (the board world, drawn for context and not
  compared) under the signed-out HUD, which is drawn in the signed-in HUD's own frame: the mask panel with "?", the Aura
  notch with its sockets empty, and Sign in and Register with an invite as one row.
- `18-door-phone.html`: the four at 390 by 844, side by side.
