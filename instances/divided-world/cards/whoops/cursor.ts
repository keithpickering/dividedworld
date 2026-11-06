/**
 * Whoops!'s drawn cursor (refinements design section 8; plan Task 8): a dripping sponge, or a felt-tip pen when the author writes
 * in ink, that follows a mouse over ink a stroke would take. It is drawn and not a CSS `cursor: url(...)` image because browsers
 * do not animate cursor images, so an image could not drip or squish; the cost is that it trails the system cursor by about a frame.
 *
 * One sponge, one pen and one drips canvas serve the whole page, fixed to the window, made the first time one is needed and removed
 * when no host has used them for IDLE_MS. The drips fall freely, so they are the one thing drawn in window coordinates.
 *
 * The cursor acts only for a mouse on a device that can hover and point finely: a touch or pen pointer, or a coarse device, never
 * shows it, because there is no system cursor there to replace. Everything drawn is aria-hidden and pointer-events: none, so it
 * is never a target and never read. Under reduced motion the sponge still shows, but it sheds no drips and does not squish.
 *
 * The Effect decides the mode on each pointer move and calls `over(host, event, mode, ink)`: the layer's ink color is the fourth
 * argument, read only for 'pen'. The sponge and its drips are the bench's (docs/research/2026-11-06-whoops-bench/01-bench.html);
 * the pen is drawn in the sponge's style, with its tip at the pointer.
 */
import { motionReduced } from '../../../../engine/ui/appearance.ts';

export type CursorMode = 'sponge' | 'pen' | null;
/** The part of a pointer event the cursor reads, so a test needs no PointerEvent. */
export type CursorPointer = Pick<PointerEvent, 'clientX' | 'clientY' | 'pointerType'>;

/** How long the drawn elements outlive the last host that used them. */
export const IDLE_MS = 4000;
const FINE = '(hover: hover) and (pointer: fine)';
/** Drops a second at a rate of 1, the design's "about 1.8 at rest" being 2 x 0.9. */
const DRIPS = 2;
const GRAVITY = 900;
const LIFE = 0.9;
/** The sponge's and the pen's offsets from the pointer to the SVG's own corner: the sponge's middle, the pen's tip. */
const SPONGE_AT = { x: 30, y: 28 };
const PEN_AT = { x: 6, y: 42 };

const SPONGE_SVG = `<svg viewBox="0 0 64 48" aria-hidden="true" data-kb-cursor="sponge" hidden>
  <defs>
    <linearGradient id="kb-sp-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe680"/><stop offset=".6" stop-color="#f5c842"/><stop offset="1" stop-color="#d9a326"/></linearGradient>
    <linearGradient id="kb-sp-pad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5fbf6a"/><stop offset="1" stop-color="#2c7a39"/></linearGradient>
    <pattern id="kb-sp-pores" width="7" height="6" patternUnits="userSpaceOnUse"><ellipse cx="2" cy="2" rx="1.25" ry=".95" fill="#b98316" opacity=".6"/><ellipse cx="5.4" cy="4.6" rx=".85" ry=".65" fill="#b98316" opacity=".5"/></pattern>
    <pattern id="kb-sp-scour" width="4" height="4" patternUnits="userSpaceOnUse"><path d="M0 4 L4 0" stroke="#1f5c2a" stroke-width=".8" opacity=".55"/></pattern>
  </defs>
  <g transform="rotate(-12 32 26)"><g class="kb-whoops-squish">
    <rect x="6" y="9" width="52" height="11" rx="4" fill="url(#kb-sp-pad)"/><rect x="6" y="9" width="52" height="11" rx="4" fill="url(#kb-sp-scour)"/>
    <rect x="6" y="17" width="52" height="24" rx="6" fill="url(#kb-sp-body)"/><rect x="6" y="17" width="52" height="24" rx="6" fill="url(#kb-sp-pores)"/>
    <rect x="10" y="19.5" width="30" height="2.6" rx="1.3" fill="#fff" opacity=".45"/>
    <rect x="6" y="17" width="52" height="24" rx="6" fill="none" stroke="#8a6210" stroke-width=".9" opacity=".7"/>
    <g fill="#fff" stroke="#6b7c92" stroke-width=".6" stroke-opacity=".5">
      <circle cx="11" cy="41" r="3"/><circle cx="16.5" cy="42.2" r="2.4"/><circle cx="22" cy="41.4" r="3.3"/><circle cx="28" cy="42.4" r="2.2"/><circle cx="33.5" cy="41.2" r="3.1"/>
      <circle cx="39.5" cy="42.3" r="2.5"/><circle cx="45" cy="41.3" r="3"/><circle cx="50.5" cy="42" r="2.3"/><circle cx="54.5" cy="40.6" r="2"/>
    </g>
    <g fill="#fff" opacity=".9"><circle cx="21" cy="40.2" r=".9"/><circle cx="32.6" cy="40" r=".8"/><circle cx="44.2" cy="40.1" r=".8"/></g>
  </g></g>
</svg>`;

/** A felt-tip drawn upright with its tip at (6, 42), then tilted about the tip: ink-colored barrel and cap, a pale grip, a blunt nib, the sponge's outline. */
const PEN_SVG = `<svg viewBox="0 0 48 48" aria-hidden="true" data-kb-cursor="pen" data-kb-tip-x="${PEN_AT.x}" data-kb-tip-y="${PEN_AT.y}" hidden>
  <g transform="rotate(40 6 42)">
    <path d="M3.4 34 L8.6 34 L7.2 42 L4.8 42 Z" fill="var(--kb-pen-ink, #000)" stroke="#2b2b2b" stroke-width=".9" stroke-linejoin="round"/>
    <rect x="2" y="16" width="8" height="18" rx="1.6" fill="#f3efe4" stroke="#2b2b2b" stroke-width=".9"/>
    <rect x="2" y="9" width="8" height="7" rx="1.6" fill="var(--kb-pen-ink, #000)" stroke="#2b2b2b" stroke-width=".9"/>
    <rect x="3.6" y="18" width="1.8" height="14" rx=".9" fill="#fff" opacity=".6"/>
    <rect x="2" y="21" width="8" height="2" fill="var(--kb-pen-ink, #000)" opacity=".85"/>
  </g>
</svg>`;

type Drop = { x: number; y: number; vx: number; vy: number; r: number; born: number };

let spongeEl: SVGSVGElement | null = null;
let penEl: SVGSVGElement | null = null;
let canvas: HTMLCanvasElement | null = null;
let drawing: CanvasRenderingContext2D | null = null;
let sprite: HTMLCanvasElement | null = null;
let ratio = 1;
let frame = 0;
let idle: ReturnType<typeof setTimeout> | undefined;

let host: HTMLElement | null = null;
let hostCursor = '';
let mode: CursorMode = null;
let pressed = false;
let x = 0, y = 0, speed = 0, lastMove = 0;
let acc = 0, lastTick: number | null = null;
let drops: Drop[] = [];

const canAct = (e: CursorPointer) => e.pointerType === 'mouse' && (window.matchMedia?.(FINE).matches ?? false);

function make(svg: string): SVGSVGElement {
  const box = document.createElement('div');
  box.innerHTML = svg;
  const el = box.firstElementChild as SVGSVGElement;
  el.classList.add('kb-whoops-cursor');
  el.style.pointerEvents = 'none';
  document.body.append(el);
  return el;
}

function sizeCanvas(): void {
  if (!canvas) return;
  ratio = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.ceil(innerWidth * ratio), h = Math.ceil(innerHeight * ratio);
  // Assigning a canvas's size clears it, so it is assigned only when it changed: the window may be zoomed or moved to another screen between frames.
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
}

/** The bench's drop: a teardrop with a gloss, drawn once. */
function dropSprite(): HTMLCanvasElement | null {
  const c = document.createElement('canvas');
  c.width = 24; c.height = 36;
  const g = c.getContext('2d');
  if (!g) return null;
  g.beginPath();
  g.moveTo(12, 2); g.bezierCurveTo(14, 10, 21, 16, 21, 24); g.arc(12, 24, 9, 0, Math.PI); g.bezierCurveTo(3, 16, 10, 10, 12, 2); g.closePath();
  const grd = g.createLinearGradient(4, 8, 20, 34);
  grd.addColorStop(0, 'rgba(200,222,245,0.385)'); grd.addColorStop(1, 'rgba(150,167,184,0.7)');
  g.fillStyle = grd; g.fill();
  g.strokeStyle = 'rgba(30,55,85,0.5)'; g.lineWidth = 1.2; g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.ellipse(8.6, 21, 2.2, 3.4, -0.4, 0, Math.PI * 2); g.fill();
  return c;
}

/** The three elements, made on first need. */
function ensure(): void {
  clearTimeout(idle);
  idle = undefined;
  spongeEl ??= make(SPONGE_SVG);
  penEl ??= make(PEN_SVG);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.dataset.kbCursor = 'drips';
    canvas.className = 'kb-whoops-drips';
    canvas.style.pointerEvents = 'none';
    document.body.append(canvas);
    drawing = canvas.getContext('2d');
    sprite = dropSprite();
    sizeCanvas();
    addEventListener('resize', sizeCanvas);
  }
}

function dispose(): void {
  spongeEl?.remove(); penEl?.remove(); canvas?.remove();
  spongeEl = penEl = null; canvas = null; drawing = null; sprite = null;
  removeEventListener('resize', sizeCanvas);
  cancelAnimationFrame(frame);
  frame = 0;
  drops = [];
  lastTick = null;
}

function release(): void {
  if (host) host.style.cursor = hostCursor;
  host = null;
  mode = null;
  pressed = false;
  if (spongeEl) { spongeEl.toggleAttribute('hidden', true); spongeEl.classList.remove('kb-whoops-pressing'); }
  penEl?.toggleAttribute('hidden', true);
  if (!idle && canvas) idle = setTimeout(() => { idle = undefined; if (!host) dispose(); }, IDLE_MS);
}

/** Frames run only while a cursor is shown or a drop is falling; `over` starts them again. */
function loop(t: number): void {
  frame = 0;
  try { cursor.tick(t); } catch (err) { console.error(err); }
  if (host || drops.length) frame = requestAnimationFrame(loop);
  else lastTick = null;
}

/** One frame: sheds, moves and draws the drops. Exposed so a test can step time. */
function tick(now: number): void {
  const dt = lastTick === null ? 0 : Math.min(0.05, Math.max(0, (now - lastTick) / 1000));
  lastTick = now;
  if (host && !host.isConnected) release();
  if (mode === 'sponge' && !motionReduced()) {
    acc += dt * DRIPS * (0.9 + speed / 260 + (pressed ? 1.4 : 0));
    while (acc > 1) {
      acc -= 1;
      drops.push({ x: x + (Math.random() - 0.5) * 36, y: y + 12 + Math.random() * 4, vx: (Math.random() - 0.5) * 10, vy: 20 + Math.random() * 40, r: 2 + Math.random() * 1.6, born: now });
    }
  }
  speed *= Math.exp(-dt * 6);
  drops = drops.filter((d) => (now - d.born) / 1000 < LIFE);
  for (const d of drops) { d.vy += GRAVITY * dt; d.x += d.vx * dt; d.y += d.vy * dt; }
  if (!drawing || !canvas) return;
  sizeCanvas();
  drawing.setTransform(1, 0, 0, 1, 0, 0);
  drawing.clearRect(0, 0, canvas.width, canvas.height);
  if (!sprite) return;
  drawing.setTransform(ratio, 0, 0, ratio, 0, 0);
  for (const d of drops) {
    const k = ((now - d.born) / 1000) / LIFE, stretch = 1 + Math.min(0.8, d.vy / GRAVITY);
    drawing.globalAlpha = 1 - Math.max(0, (k - 0.6) / 0.4);
    drawing.drawImage(sprite, d.x - d.r, d.y - d.r * 2 * stretch, d.r * 2, d.r * 3 * stretch);
  }
  drawing.globalAlpha = 1;
}

function over(el: HTMLElement, e: CursorPointer, want: CursorMode, ink?: string): void {
  if (!want || !canAct(e)) { if (host === el) release(); return; }
  ensure();
  if (host !== el) {
    if (host) host.style.cursor = hostCursor;
    host = el;
    hostCursor = el.style.cursor;
  }
  el.style.cursor = 'none';
  const now = performance.now();
  const d = Math.hypot(e.clientX - x, e.clientY - y), dt = Math.max(1, now - lastMove) / 1000;
  speed = Math.min(2000, speed * 0.7 + (d / dt) * 0.3);
  x = e.clientX; y = e.clientY; lastMove = now;
  mode = want;
  const [show, hide, at] = want === 'pen' ? [penEl!, spongeEl!, PEN_AT] : [spongeEl!, penEl!, SPONGE_AT];
  hide.toggleAttribute('hidden', true);
  show.toggleAttribute('hidden', false);
  if (want === 'pen' && ink) penEl!.style.setProperty('--kb-pen-ink', ink);
  show.style.transform = `translate(${x - at.x}px, ${y - at.y}px)`;
  if (!frame) frame = requestAnimationFrame(loop);
}

function press(down: boolean): void {
  pressed = down;
  spongeEl?.classList.toggle('kb-whoops-pressing', down && !motionReduced());
}

/** The pointer left the host, or the host went: its own cursor comes back. Another host's hold is left alone. */
function leave(el: HTMLElement): void {
  if (host === el) release();
}

export const cursor = {
  over,
  press,
  leave,
  tick,
  /** How many drops are falling now. */
  drips: () => drops.length,
};
