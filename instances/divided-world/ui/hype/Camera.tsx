/**
 * The turn in space (docs/plans/2026-11-21-commentary-video-design.md, section 5a): the stage draws the board inside a wrapper, and a shot
 * turns the board as a plane in perspective, so the game is drawn at an angle and not a picture of it.
 *
 * At rest the wrapper is two plain elements with no style on them, so the page lays out, stacks and fixes exactly as it does without them
 * (perspective and a transform each make a box the containing block of a fixed one, so neither is set until a shot turns the board).
 * `turnBoard` sets, for the next frame, a perspective on the outer element and a transform on the plane, both about the middle of the
 * window as it is scrolled to now, and black behind: the page's own background is moved onto the plane, and the page's is black. `levelBoard`
 * takes all of it off again. A shot turns the board only while no pointer press is in progress, and reads no element's place while it is
 * turned: a turned page's boxes are not where they are drawn.
 */
import type { ReactNode } from 'react';

/** How the board is turned: degrees about each axis, a push toward (or away from) the viewer in px, and a scale. Each is nothing when left out. */
export interface Turn {
  readonly rx?: number;
  readonly ry?: number;
  readonly rz?: number;
  readonly z?: number;
  readonly scale?: number;
}

/** How far off the viewer the plane's picture sits, as a perspective: the nearer, the stronger the turn reads. */
const PERSPECTIVE = 1600;
const BACKGROUND = ['backgroundColor', 'backgroundImage', 'backgroundRepeat', 'backgroundSize', 'backgroundPosition', 'backgroundAttachment'] as const;

export function Camera({ children }: { readonly children: ReactNode }) {
  return <div id="kb-camera"><div id="kb-plane">{children}</div></div>;
}

/** What the page's background was before a turn put black behind the plane, for `levelBoard` to put back. */
let kept: { readonly html: string; readonly body: string } | null = null;

const parts = () => {
  const outer = document.getElementById('kb-camera');
  const plane = document.getElementById('kb-plane');
  if (!outer || !plane) throw new Error('the stage has no camera: only the stage story draws one');
  return { outer, plane };
};

/** Turns the board for the next frame. */
export function turnBoard({ rx = 0, ry = 0, rz = 0, z = 0, scale = 1 }: Turn = {}): void {
  const { outer, plane } = parts();
  const root = document.documentElement, body = document.body;
  if (kept === null) {
    kept = { html: root.style.background, body: body.style.background };
    /* The page's background goes on the plane, which is what a viewer sees of it, and the page itself goes black. */
    const from = getComputedStyle(body).backgroundColor === 'rgba(0, 0, 0, 0)' ? getComputedStyle(root) : getComputedStyle(body);
    for (const p of BACKGROUND) plane.style[p] = from[p];
    root.style.background = '#000';
    body.style.background = '#000';
  }
  const middle = `${scrollX + innerWidth / 2}px ${scrollY + innerHeight / 2}px`;
  outer.style.perspective = `${PERSPECTIVE}px`;
  outer.style.perspectiveOrigin = middle;
  outer.style.overflow = 'clip';
  plane.style.transformOrigin = middle;
  plane.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg) translateZ(${z}px) scale(${scale})`;
  plane.style.setProperty('--kb-cam-lift', `${scrollY + innerHeight - plane.offsetHeight}px`);
  plane.setAttribute('data-kb-turned', '');
}

/** Takes the turn off: the board is the plain page again, with no style on the wrapper. */
export function levelBoard(): void {
  const { outer, plane } = parts();
  outer.removeAttribute('style');
  plane.removeAttribute('style');
  plane.removeAttribute('data-kb-turned');
  if (kept !== null) {
    document.documentElement.style.background = kept.html;
    document.body.style.background = kept.body;
    kept = null;
  }
}
