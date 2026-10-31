---
target: "the Glass on a post with postcards applied (PR #97)"
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/home/user/dividedworld/engine/ui/cards/Effects.tsx"
target_fingerprint: "sha256:53b048472e92a9bbcdc35643d94a89d6036ffde5928f4eab044a27d4d56bd566"
target_path: /home/user/dividedworld/engine/ui/cards/Effects.tsx
timestamp: 2026-10-31T13-41-46Z
slug: engine-ui-cards-effects-tsx
---
# Critique: the Glass on a post with plays (PR #97 @ 1431d9b)

Method: dual-agent (A: design review · B: detector + browser). Storybook stories `Boards/01 Plays on a post` and `Boards/01 Whoops layers`, at 1440 and 390.

## Design Health Score
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | The meter and readout are clear, but "top" means two things: the most-drawn play and the newest layer. |
| 2 | Match to the real world | 2 | It looks like a fanned deck, but the deck never fans out: the edges stay behind the top tag when the list is open. |
| 3 | User control | 3 | It has many exits, but its clear backdrop takes the first tap on anything underneath. |
| 4 | Consistency | 2 | The top tag is 54px on a phone and the list tags 33px; the panel ignores the phone sizes; × is set in a third face. |
| 5 | Error prevention | 3 | Making what lies under the list inert prevents half-presses. |
| 6 | Recognition over recall | 3 | Nothing ties a meter segment to its tag. |
| 7 | Flexibility | 2 | The plate cannot be collapsed. |
| 8 | Aesthetic and minimalist design | 1 | The plate stays open in the page flow, repeats what the tag says, and keeps its hint forever. |
| 9 | Error recovery | 3 | The save report is plain. |
| 10 | Help | 3 | The hint is good, but it shows on every post forever, not once. |
| **Total** | | **25/40** | **Acceptable** |

## Verdict
The parts are on-brand. As a system it is half game: the tag behaves like HUD and the plate behaves like a forum block.

Detector: the CLI found 0 findings, but it ran on regex only. The browser found 27 to 36 findings per story. Most are brand-mandated (dark-glow, cyan neon), or sit outside this PR's files (10px timestamps). The low-contrast reads come from cyan or pink borders under clip-path, not from the dark grounds, so they are probably false positives: check them by eye.

## Priority issues
- **[P1] The plate reflows the 2003 page.** It adds 206px per post at 1440 and 326px at 390, where the post's own ink is about 167px. Fix: no glass in page flow. A mark on the post, and a lens on request.
- **[P1] Who did it (the tag, at the corner) and how to resolve it (the plate, below) are two places with two orders.** Fix: one entry point, one panel, with tabs.
- **[P1] The stack fails in the ways the owner suspected.**
  - The edges stay visible when unstacked (a pixel diff confirms it).
  - The list overlaps the plate by 37px at 1440 and 70px at 390, and by 165px and 194px with long names.
  - The phone's list tags are 33px against a 54px top tag.
- **[P2] Plates do not compose.** One plate is drawn per card key in a flex-wrap slot. Four cards could take about 1,000px on a phone. Fix: one plate host per post, a generic contract per card.
- **[P2] Type clash.** Glass text is 20 to 26px against 12px Verdana, and the panel takes no phone tokens. The always-on glass carries sentences, so the XAG floor makes it loud.

## Direction proposed
- **Marks:** one per card kind, icon plus count plus a state edge. No words.
- **Lens:** a floating panel with tabs, the marks being the tabs. Each tab has the same three rows: State, Act (from a fixed control kit), Who (collapsed).
- **The field:** a first-time callout and in-world scrubbing.
- **Takeovers** (Stick Around) carry the same mark strip in their header and compose rather than compete.
