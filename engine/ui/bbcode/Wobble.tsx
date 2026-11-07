/**
 * The filter a counterfeit quote's border is drawn through (bbcode.css, `.kb-quote[data-kb-counterfeit]::before`): fractal noise
 * displaces the line a pixel or two, like a hand-traced copy. The numbers are the owner-approved mockup's variant A
 * (docs/research/2026-11-07-bbcode/mock-counterfeit-quote.html). A filter is found by id in the whole document, so the app frame
 * mounts this once and every post on the page uses it; it is paint only, out of the reading order.
 */
export function Wobble() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <filter id="kb-wobble">
        <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7" />
        <feDisplacementMap in="SourceGraphic" scale="3" />
      </filter>
    </svg>
  );
}
