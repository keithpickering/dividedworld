/**
 * The rolled-up tape drops (docs/plans/2026-11-11-autocorrect-tape-design.md, section 6): a small hop, then a quick fall under
 * gravity, turning as it goes, and gone below the screen. It drops the roll left when a piece is peeled to its end or tears; it never
 * drifts. Under reduced motion, or where the browser has no Web Animations, nothing falls: the roll is gone at once (section 11). The
 * caller hides the roll itself.
 *
 * What falls is a copy of the roll, fixed over the page where the roll was, hidden from screen readers and taking no pointer, removed
 * when its animation ends. The sway is seeded by `seed`, so a roll falls the same way on every screen.
 */
import { seeded } from '../../ui/seeded.ts';

/** The fall's keyframes: a small curl, then a sideways drift and a spin down `fall` pixels. The drift and spin come from the seed. */
export function dropFrames(seed: string, fall: number): Keyframe[] {
  const r = seeded(seed);
  const drift = (r() - 0.5) * 50;
  const spin = (r() > 0.5 ? 1 : -1) * (200 + r() * 260);
  return [
    { offset: 0, transform: 'translate(0, 0) rotate(0deg)' },
    { offset: 0.1, transform: `translate(${drift * 0.1}px, -5px) rotate(${spin * 0.06}deg)` },
    { offset: 1, transform: `translate(${drift}px, ${fall}px) rotate(${spin}deg)` },
  ];
}

/** How long a fall of `fall` pixels takes: gravity, so the longer the fall the longer it takes, but more slowly than it falls. */
export function dropMs(fall: number): number {
  return 260 + 13 * Math.sqrt(fall);
}

/** Lets a copy of `roll` fall from where it is to below the screen, or does nothing under reduced motion or without Web Animations. */
export function dropRoll(roll: HTMLElement, o: { readonly reduced: boolean; readonly seed: string }): void {
  if (o.reduced || typeof roll.animate !== 'function') return;
  const box = roll.getBoundingClientRect();
  const copy = roll.cloneNode(true) as HTMLElement;
  copy.removeAttribute('id');
  copy.setAttribute('aria-hidden', 'true');
  copy.setAttribute('tabindex', '-1');
  Object.assign(copy.style, { position: 'fixed', left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, margin: '0', pointerEvents: 'none', zIndex: '60' });
  document.body.append(copy);
  const fall = Math.max(80, window.innerHeight - box.top + 40);
  const run = copy.animate(dropFrames(o.seed, fall), { duration: dropMs(fall), easing: 'cubic-bezier(.55,0,.9,.55)', fill: 'forwards' });
  const gone = () => copy.remove();
  run.onfinish = gone;
  void run.finished?.then(gone, gone);
}
