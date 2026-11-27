/** The lock before a line only the player sees (the HUD's secret line, My characters' class line, the Random Event's): shut while the thing is private, its shackle lifted off the right post once it is public. Its strokes are its line's own (`fill: none; stroke: currentColor`, set where the line is styled). */
export function SecretLock({ open = false }: { readonly open?: boolean }) {
  return (
    <svg aria-hidden="true" focusable="false" width="15" height="16" viewBox="0 0 11 12">
      <rect x="1" y="5" width="9" height="6.5" rx="1" />
      <path d={open ? 'M3 5 V3.4 a2.5 2.5 0 0 1 5 0' : 'M3 5 V3.4 a2.5 2.5 0 0 1 5 0 V5'} />
    </svg>
  );
}
