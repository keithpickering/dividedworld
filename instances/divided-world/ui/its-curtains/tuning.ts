/**
 * Every number of It's Curtains' look and motion, in one place so the owner can retune it. They are the values the owner tuned and approved on the
 * prototype bench (docs/research/2026-11-23-its-curtains/bench.html, 2026-11-25), where they differ from the plan's first numbers (the plan's
 * Task 6): the halves open in 500 ms on an ease-in-out (the plan said 750 ms, ease-in), six pleats a half (three), the confetti is two hundred
 * pieces falling for 1.6 s and thrown at 40% of the open (a hundred and twenty, about 2 s, after it), and the spotlights lap in 2 s.
 * Nothing here is read from the instance's settings but the touch reading line, which is Laugh Track's (`laughTrack.line`).
 */
export const TUNING = {
  /** The halves leave over this long, on this ease. */
  openMs: 500,
  openEase: 'cubic-bezier(.65,0,.35,1)',
  /** The whoosh plays this long after the halves start, and the tada this long before they are fully out. */
  whooshAfterMs: 0,
  tadaBeforeEndMs: 150,
  /** The curtain is taken off the post this long after the halves are out, so the last frame is drawn before it goes. */
  settleMs: 20,
  /** The drumroll's fade-out on leave, and when the press ends it. */
  drumFadeMs: 100,
  drumFadeOnOpenMs: 15,
  /** A click that moved the pointer farther than this many CSS px since it went down is the end of a drag, and opens nothing. */
  dragSlopPx: 10,
  spot: {
    /** One lap of the figure 8, in seconds. */
    lapSeconds: 2,
    /** The ellipse's size against the bench's default size. */
    size: 0.9,
    /** The brightness while the drumroll plays, and at rest. */
    bright: 0.75,
    rest: 0.28,
    /** Where the two sit at rest, as a share of the width. */
    restLeft: 0.3,
    restRight: 0.7,
  },
  /** The reader's line on a touch screen, in percent of the space above the HUD, when the instance does not set `laughTrack.line`. */
  touchLine: 50,
  confetti: {
    count: 200,
    fallSeconds: 1.6,
    /** The throw starts this many percent of the way through the open. */
    startPercent: 40,
    spread: 1,
    power: 1,
    /** The throw's geometry is worked out against at most this much of the covered box's height: a tall post's confetti is not a mile high. */
    boxMaxPx: 900,
    /** How far past the box's top border a piece may fly, in px. */
    bleedPx: 80,
    /** The pieces' colors besides the fabric's light shade. */
    gold: '#e2ba00',
    white: '#ffffff',
  },
  shape: {
    pleatsPerHalf: 6,
    swags: 6,
    swagHeightPx: 64,
    /** Each half's width in percent of the box: they overlap in the middle, the right one over the left. */
    halfWidthPercent: 51,
    textureStrength: 0.35,
    /** The fabric's lag as the halves open: how far the pleats bunch and the hem trails. */
    fabricLag: 0.6,
  },
} as const;
