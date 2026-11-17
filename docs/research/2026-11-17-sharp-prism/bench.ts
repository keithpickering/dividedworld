import { makeFoil } from '../../../engine/ui/shine/foil.ts';
import { bandOf } from '../../../engine/ui/shine/band.ts';

const light = { '--kb-fg': '#000000', '--kb-bg': '#e5e5e5', '--kb-muted': '#3f4a52', '--kb-link': '#00507a', '--kb-link-visited': '#4b3f7a' };
const band = bandOf(light);
const STOPS = ['#ffb9be', '#ffc09f', '#fff2a0', '#a8e6a1', '#9fd3ff', '#d8c0ff'];

function time(box: { w: number; h: number }, density: number, sharp: boolean, seam: number, lookup = false): number {
  const cv = new OffscreenCanvas(Math.round(box.w * density), Math.round(box.h * density));
  const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D;
  const foil = makeFoil({ seed: 'post-8f2c:p1,p2,p3', pattern: 'prism', palette: STOPS, stars: 10, glint: '#ffffff', sharp, seam, lookup });
  const runs: number[] = [];
  for (let k = 0; k < 80; k++) {
    const t0 = performance.now();
    foil.draw(ctx, box, density, { x: Math.sin(k * 0.1), y: Math.cos(k * 0.07) * 0.5 }, band, k * 16, false, null);
    ctx.getImageData(0, 0, 1, 1); // force the raster, so the time includes what the canvas does with the draws
    if (k >= 20) runs.push(performance.now() - t0);
  }
  runs.sort((a, b) => a - b);
  return runs[Math.floor(runs.length / 2)]!;
}

const out: string[] = [];
for (const [w, h, d] of [[988, 300, 2], [720, 1000, 2], [720, 512, 2]] as const) {
  const cv = new OffscreenCanvas(w * d, h * d), ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D;
  const foil = makeFoil({ seed: 's', pattern: 'prism', palette: STOPS, stars: 10, glint: '#ffffff', lookup: true, seam: 1 });
  const t0 = performance.now(); foil.draw(ctx, { w, h }, d, { x: 0, y: 0 }, band, 0, false, null); ctx.getImageData(0, 0, 1, 1);
  out.push(`first draw (map build) ${w}x${h} @${d}: ${(performance.now() - t0).toFixed(1)} ms, holds ${((w * d * h * d * 8) / 1e6).toFixed(1)} MB`);
}
for (const [w, h] of [[375, 230], [988, 300], [720, 1000]] as const) {
  for (const d of [1, 2]) {
    const today = time({ w, h }, d, false, 1), look = time({ w, h }, d, false, 1, true);
    out.push(`${w}x${h} @${d}: today ${today.toFixed(2)} ms, lookup ${look.toFixed(2)} ms`);
  }
}
(window as any).__out = out;
