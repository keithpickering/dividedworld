import { makeFoil, type Foil } from '../../../engine/ui/shine/foil.ts';
import { bandOf, type Band } from '../../../engine/ui/shine/band.ts';

const STOPS = {
  light: ['#ffb9be', '#ffc09f', '#fff2a0', '#a8e6a1', '#9fd3ff', '#d8c0ff'],
  dark: ['#7f0c1e', '#682d06', '#4a3d00', '#0d471e', '#133b84', '#522191'],
};
const THEMES = {
  light: { '--kb-fg': '#000000', '--kb-bg': '#e5e5e5', '--kb-muted': '#3f4a52', '--kb-link': '#00507a', '--kb-link-visited': '#4b3f7a' },
  dark: { '--kb-fg': '#d8dee6', '--kb-bg': '#0c121b', '--kb-muted': '#97a6b5', '--kb-link': '#9cc9ff', '--kb-link-visited': '#c3b1e8' },
};
const SEED = 'post-8f2c:play-1,play-2,play-3';
const DPR = Math.min(2, window.devicePixelRatio || 1);

type Panel = { cv: HTMLCanvasElement; foil: Foil; band: Band; density: number; ms: number[]; out: HTMLElement; host: HTMLElement };
const panels: Panel[] = [];

function makePanel(cv: HTMLCanvasElement, board: 'light' | 'dark', variant: string, seam: number): Panel {
  const band = bandOf(THEMES[board]);
  const sharp = false; const lookup = variant === 'sharp';
  const tall = variant === 'tall';
  const foil = makeFoil({ seed: SEED, pattern: 'prism', palette: STOPS[board], stars: 10, glint: '#ffffff', cell: tall ? 6 : 3, sharp, seam, lookup });
  const density = tall ? DPR * 0.5 : DPR;
  const host = cv.parentElement!;
  return { cv, foil, band, density, ms: [], out: host.parentElement!.querySelector('.ms')!, host };
}

function build(seam: number) {
  for (const p of panels) p.foil.release();
  panels.length = 0;
  document.querySelectorAll<HTMLCanvasElement>('canvas[data-board]').forEach((cv) => {
    panels.push(makePanel(cv, cv.dataset.board as 'light' | 'dark', cv.dataset.variant!, seam));
  });
  size();
}
function size() {
  for (const p of panels) {
    const r = p.host.getBoundingClientRect();
    p.cv.style.width = `${r.width}px`; p.cv.style.height = `${r.height}px`;
    p.cv.width = Math.round(r.width * p.density); p.cv.height = Math.round(r.height * p.density);
  }
}

let light = { x: 0.3, y: -0.2 };
let target = { ...light };
let pointed = false, lastMove = 0;
window.addEventListener('pointermove', (e) => {
  pointed = true; lastMove = performance.now();
  target = { x: (e.clientX / innerWidth - 0.5) * 3, y: (e.clientY / innerHeight - 0.5) * 3 };
});
const params = new URLSearchParams(location.search);
const frozen = params.has('still');
if (params.has('lx')) light = target = { x: +params.get('lx')!, y: +params.get('ly')! };

function frame(now: number) {
  if (!frozen) {
    if (!pointed || now - lastMove > 4000) {
      const t = now / 1000;
      target = { x: Math.sin(t * 0.45) * 1.1, y: Math.cos(t * 0.31) * 0.8 };
    }
    light = { x: light.x + (target.x - light.x) * 0.12, y: light.y + (target.y - light.y) * 0.12 };
  }
  for (const p of panels) {
    const ctx = p.cv.getContext('2d')!;
    const r = p.host.getBoundingClientRect();
    const t0 = performance.now();
    p.foil.draw(ctx, { w: r.width, h: r.height }, p.density, light, p.band, now, !pointed, null);
    p.ms.push(performance.now() - t0);
    if (p.ms.length > 60) p.ms.shift();
  }
  if (Math.floor(now / 500) !== Math.floor((now - 16) / 500)) {
    for (const p of panels) p.out.textContent = `${(p.ms.reduce((a, b) => a + b, 0) / p.ms.length).toFixed(2)} ms a draw`;
  }
  if (!frozen) requestAnimationFrame(frame);
}

const seamIn = document.getElementById('seam') as HTMLInputElement;
const seamOut = document.getElementById('seamv')!;
seamIn.addEventListener('input', () => { seamOut.textContent = `${seamIn.value} px`; build(+seamIn.value); if (frozen) requestAnimationFrame(frame); });
window.addEventListener('resize', () => { size(); if (frozen) requestAnimationFrame(frame); });
build(+seamIn.value);
requestAnimationFrame(frame);
