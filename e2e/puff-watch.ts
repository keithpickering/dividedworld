import type { Page } from '@playwright/test';

/**
 * Watches an extinguisher's puff from inside the page, a frame at a time (a page round trip on a slow runner takes longer than the puff's fade): the content
 * area is `areaSelector`, its puff tiles `canvas.dw-chair-puff`, its chairs `.dw-chair-group` (docs/plans/2026-11-23-steel-chair-objects-design.md, Task 12).
 * It is shared by e2e/steel-chair.spec.ts (a thread's post) and e2e/origin-effects.spec.ts (a spun thread's ORIGIN box), so both read the puff the same way.
 *
 * It waits up to `startMs` for the first puff tile, then up to `endMs` after it for the last to go. Each frame it reads the tiles once.
 */
export interface PuffWatch {
  /** Frames seen with the extinguisher drawn and no puff tile (and so no fog) anywhere in the page. */
  readonly framesBefore: number;
  /** Whether a puff tile was drawn at all. */
  readonly started: boolean;
  /** How far above the area's bottom border the extinguisher's lowest drawn point was in the first frame with a puff tile: it is on the floor then. */
  readonly liftAtStart: number;
  /** ms from the first frame with a tile to the first frame whose tiles' union is the area's box with fog of alpha over 100 (of 255) in the 5 by 5 mean at the area's middle; -1 if never. */
  readonly filledAfter: number;
  /** ms from the first frame with a tile to the first frame with none after it; -1 if the tiles were still there when the watch ended. */
  readonly goneAfter: number;
  /** The most puff tiles seen in any frame, and the most of them outside the area. */
  readonly tiles: number;
  readonly tilesOutside: number;
}

export function watchPuff(page: Page, areaSelector: string, startMs: number, endMs: number): Promise<PuffWatch> {
  return page.evaluate(([selector, start, end]) => new Promise<PuffWatch>((resolve) => {
    const out = { framesBefore: 0, started: false, liftAtStart: Number.NaN, filledAfter: -1, goneAfter: -1, tiles: 0, tilesOutside: 0 };
    const began = performance.now();
    let first = 0;
    const tick = (): void => {
      const now = performance.now();
      const a = document.querySelector<HTMLElement>(selector as string);
      const all = [...document.querySelectorAll<HTMLCanvasElement>('canvas.dw-chair-puff')].filter((c) => c.width > 0 && c.getBoundingClientRect().width > 0);
      if (!out.started) {
        if (all.length > 0 && a) {
          out.started = true;
          first = now;
          const r = a.getBoundingClientRect(), bottom = r.top + a.clientTop + a.clientHeight;
          const low = Math.max(...[...a.querySelectorAll('.dw-chair-group .dw-chair-piece')].map((p) => p.getBoundingClientRect().bottom));
          out.liftAtStart = bottom - low;
        } else {
          if (a?.querySelector('.dw-chair-group')) out.framesBefore++;
          if (now - began > (start as number)) { resolve(out); return; }
          requestAnimationFrame(tick);
          return;
        }
      }
      if (a) {
        const inArea = all.filter((c) => a.contains(c));
        out.tiles = Math.max(out.tiles, all.length);
        out.tilesOutside = Math.max(out.tilesOutside, all.length - inArea.length);
        if (out.filledAfter < 0 && inArea.length > 0) {
          const r = a.getBoundingClientRect();
          const box = { left: r.left + a.clientLeft, top: r.top + a.clientTop, right: r.left + a.clientLeft + a.clientWidth, bottom: r.top + a.clientTop + a.clientHeight };
          const rects = inArea.map((c) => c.getBoundingClientRect());
          const union = { left: Math.min(...rects.map((b) => b.left)), top: Math.min(...rects.map((b) => b.top)), right: Math.max(...rects.map((b) => b.right)), bottom: Math.max(...rects.map((b) => b.bottom)) };
          const mx = (box.left + box.right) / 2, my = (box.top + box.bottom) / 2;
          const c = inArea.find((q) => { const b = q.getBoundingClientRect(); return mx >= b.left && mx < b.right && my >= b.top && my < b.bottom; });
          let seen = 0;
          if (c) {
            const b = c.getBoundingClientRect(), k = c.width / b.width;
            const x = Math.max(0, Math.round((mx - b.left) * k) - 2), y = Math.max(0, Math.round((my - b.top) * k) - 2);
            const d = c.getContext('2d')!.getImageData(x, y, Math.min(c.width - x, 5), Math.min(c.height - y, 5)).data;
            let sum = 0;
            for (let i = 3; i < d.length; i += 4) sum += d[i]!;
            seen = sum / (d.length / 4);
          }
          if (union.left <= box.left + 1 && union.right >= box.right - 1 && union.top <= box.top + 1 && union.bottom >= box.bottom - 1 && seen > 100) out.filledAfter = now - first;
        }
      }
      if (all.length === 0) { out.goneAfter = now - first; resolve(out); return; }
      if (now - first > (end as number)) { resolve(out); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), [areaSelector, startMs, endMs] as const);
}
