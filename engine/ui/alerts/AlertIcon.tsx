/**
 * The icon of an alert's kind, in the kind's ink (set by the caller's `color`): the shapes Alerts' rows and the toasts both draw. Followed threads
 * and quotes in the neon, cards, traps and rulings in the salty, settlements and hints in the ready, news in the pale (alerts.css, toasts.css).
 */
import type { ReactNode } from 'react';
import type { AlertKind } from '../../rules/alerts.ts';

export const SHAPES: Readonly<Record<AlertKind, ReactNode>> = {
  followed: <><path d="M6 7h20M6 13h20M6 19h13" strokeWidth="2.2" strokeLinecap="round" fill="none" /><circle cx="24" cy="22" r="4" fill="currentColor" stroke="none" /></>,
  quote: <><path d="M6 9h20v12H15l-6 5v-5H6z" fill="none" strokeWidth="2.2" strokeLinejoin="round" /><path d="M11 14h10M11 17.5h6" strokeWidth="2" strokeLinecap="round" /></>,
  /* A quote's bubble with a slash through its words: the quote is not what it seems. */
  framed: <><path d="M6 9h20v12H15l-6 5v-5H6z" fill="none" strokeWidth="2.2" strokeLinejoin="round" /><path d="M12 19l8-7" strokeWidth="2" strokeLinecap="round" /></>,
  cardOnYours: <><rect x="8" y="5" width="16" height="22" rx="2" fill="none" strokeWidth="2.2" /><path d="M12 12l8 8M20 12l-8 8" strokeWidth="2" strokeLinecap="round" /></>,
  cardEnded: <><rect x="8" y="5" width="16" height="22" rx="2" fill="none" strokeWidth="2.2" /><path d="M12 16h8" strokeWidth="2.2" strokeLinecap="round" /></>,
  trapStruck: <><path d="M7 25h12M10 21h6M13 21V13" strokeWidth="2.2" strokeLinecap="round" fill="none" /><rect x="11" y="4" width="14" height="7" rx="1" transform="rotate(35 18 7.5)" fill="none" strokeWidth="2.2" /></>,
  trapSprang: <><path d="M7 25h12M10 21h6M13 21V13" strokeWidth="2.2" strokeLinecap="round" fill="none" /><rect x="11" y="4" width="14" height="7" rx="1" transform="rotate(35 18 7.5)" fill="none" strokeWidth="2.2" /></>,
  ruling: <><path d="M7 25h12M10 21h6M13 21V13" strokeWidth="2.2" strokeLinecap="round" fill="none" /><rect x="11" y="4" width="14" height="7" rx="1" transform="rotate(35 18 7.5)" fill="none" strokeWidth="2.2" /></>,
  /* A cup and a belt buckle: the character was given a trophy, or lost the belt. */
  trophy: <path d="M9 5h14v6a7 7 0 0 1-14 0zM9 8H5a4 4 0 0 0 4 5M23 8h4a4 4 0 0 1-4 5M16 18v4M11 27h10M13 22h6" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />,
  beltBack: <><rect x="4" y="11" width="24" height="10" rx="2" fill="none" strokeWidth="2.2" /><path d="M13 12v8h6v-8z" fill="none" strokeWidth="2" strokeLinejoin="round" /></>,
  beltLost: <><rect x="4" y="11" width="24" height="10" rx="2" fill="none" strokeWidth="2.2" /><path d="M13 12v8h6v-8z" fill="none" strokeWidth="2" strokeLinejoin="round" /><path d="M5 27L27 5" strokeWidth="2.2" strokeLinecap="round" /></>,
  hint: <path d="M16 4c1 5 7 7 7 14a7 7 0 0 1-14 0c0-4 2-6 3-8 1 3 2 4 4 4-1-4-1-7 0-10z" fill="none" strokeWidth="2.2" strokeLinejoin="round" />,
  settlement: <><circle cx="16" cy="16" r="10" fill="none" strokeWidth="2.2" /><path d="M16 10v6l4 3" strokeWidth="2.2" strokeLinecap="round" fill="none" /></>,
  update: <><rect x="5" y="6" width="22" height="20" fill="none" strokeWidth="2.2" /><path d="M5 11h22M10 16h12M10 20h8" strokeWidth="2" strokeLinecap="round" /></>,
  seasonNews: <path d="M9 5h14v6a7 7 0 0 1-14 0zM9 8H5a4 4 0 0 0 4 5M23 8h4a4 4 0 0 1-4 5M16 18v4M11 27h10M13 22h6" fill="none" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />,
};

export function AlertIcon({ kind, className }: { readonly kind: AlertKind; readonly className?: string }) {
  return <svg className={className} aria-hidden="true" focusable="false" viewBox="0 0 32 32" stroke="currentColor">{SHAPES[kind]}</svg>;
}
