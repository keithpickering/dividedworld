/**
 * Where the HUD's tab is on the window, for the crossing to start from and close back into (docs/plans/2026-11-04-glass-polish-design.md,
 * section 9). The HUD publishes a reader of its tab's box while it is mounted; when it unmounts (the board's frame has left) the last
 * box it read is kept, so a glass page closing back into the HUD's bar still has a place to close into. A module value rather than a
 * context: the crossing's two worlds are siblings, and the frame that holds the HUD is the one leaving.
 */
import type { Rect } from '../glass/motion.ts';

let read: (() => Rect | null) | null = null;
let last: Rect | null = null;

/** The HUD publishes a reader of its tab's box; the returned function withdraws it, keeping the last box read. */
export function publishHudTab(reader: () => Rect | null): () => void {
  read = reader;
  return () => {
    if (read === reader) { last = reader() ?? last; read = null; }
  };
}

/** The tab's box on the window now, else the last one read, else the middle of the window's foot (a signed-out first load). */
export function hudTabRect(within: { readonly width: number; readonly height: number }): Rect {
  const now = read?.() ?? null;
  if (now) last = now;
  return now ?? last ?? { x: within.width / 2 - 100, y: within.height - 72, width: 200, height: 56 };
}
