/**
 * A peeled strip coming away (the Autocorrect design, section 4): it curls up from the corner it was pulled at, then drifts
 * slowly down the screen, swaying back and forth like a piece of paper, and is gone. Under reduced motion it lifts off and fades
 * where it was, with no drift and no sway, and is peeled all the same (section 6).
 *
 * The strip itself is already gone from the post when this runs: what falls is a copy, fixed over the page where the strip was,
 * hidden from screen readers and taking no pointer, removed when its animation ends. The sway is seeded by the strip's key, so a
 * strip falls the same way on every screen. A browser with no Web Animations removes the copy at once.
 */
import { seeded } from '../../ui/seeded.ts';

export type Corner = 'left' | 'right';

/** How long the fall takes, and the fade under reduced motion. */
export const FALL_MS = 3200;
export const FADE_MS = 180;

/** The fall's keyframes: a curl from the pulled corner, then a swaying drift `drop` pixels down. */
export function fallFrames(seed: string, drop: number, corner: Corner): Keyframe[] {
  const next = seeded(seed);
  const side = corner === 'left' ? -1 : 1;
  const origin = `${corner} center`;
  const frames: Keyframe[] = [
    { offset: 0, transform: 'translateY(0px) translateX(0px) rotate(0deg)', transformOrigin: origin, opacity: 1 },
    { offset: 0.1, transform: `translateY(-8px) translateX(${(side * 4).toFixed(1)}px) rotate(${(side * -16).toFixed(1)}deg)`, transformOrigin: origin, opacity: 1 },
  ];
  const swings = 5;
  const reach = 26 + next() * 18;
  for (let i = 1; i <= swings; i++) {
    const at = 0.1 + (0.9 * i) / swings;
    const x = (i % 2 === 1 ? side : -side) * reach * (0.7 + next() * 0.3);
    const turn = (i % 2 === 1 ? side : -side) * (10 + next() * 14);
    const y = i === swings ? drop : Math.round((drop * i) / swings);
    frames.push({ offset: Math.min(1, at), transform: `translateY(${y}px) translateX(${x.toFixed(1)}px) rotate(${turn.toFixed(1)}deg)`, transformOrigin: origin, opacity: i === swings ? 0 : 1 });
  }
  return frames;
}

/** Lets a copy of `strip` fall from where it is, or fade there under reduced motion. */
export function dropStrip(strip: HTMLElement, o: { readonly corner: Corner; readonly reduced: boolean; readonly seed: string }): void {
  const box = strip.getBoundingClientRect();
  const copy = strip.cloneNode(true) as HTMLElement;
  copy.removeAttribute('id');
  copy.setAttribute('aria-hidden', 'true');
  copy.setAttribute('tabindex', '-1');
  copy.dataset.kbFalling = '';
  copy.classList.add('dw-ac-falling');
  Object.assign(copy.style, { position: 'fixed', left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, margin: '0', pointerEvents: 'none', zIndex: '60' });
  document.body.append(copy);
  if (typeof copy.animate !== 'function') { copy.remove(); return; }
  const view = typeof window !== 'undefined' ? window.innerHeight : 800;
  const run = o.reduced
    ? copy.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: 'ease-out', fill: 'forwards' })
    : copy.animate(fallFrames(o.seed, Math.max(120, view - box.top + 40), o.corner), { duration: FALL_MS, easing: 'cubic-bezier(.3,.05,.6,1)', fill: 'forwards' });
  const gone = () => copy.remove();
  run.onfinish = gone;
  void run.finished?.then(gone, gone);
}
