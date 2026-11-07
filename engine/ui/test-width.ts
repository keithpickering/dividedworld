/** A window this wide, as matchMedia answers it (jsdom has none); undo it with `vi.unstubAllGlobals()`. */
import { vi } from 'vitest';

export function widthOf(px: number): void {
  vi.stubGlobal('matchMedia', (q: string) => {
    const m = /\((min|max)-width:\s*([\d.]+)(px|em)\)/.exec(q);
    const edge = m ? Number(m[2]) * (m[3] === 'em' ? 16 : 1) : 0;
    const matches = m ? (m[1] === 'min' ? px >= edge : px <= edge) : false;
    return { matches, media: q, addEventListener: () => {}, removeEventListener: () => {} } as unknown as MediaQueryList;
  });
}
