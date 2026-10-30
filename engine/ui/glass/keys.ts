/**
 * The keys and clicks the glass and the HUD answer on the whole page, shared so the board and the
 * glass read them alike. A page-wide Esc is the glass's way in (the HUD's Menu) and out (Back), so
 * it answers one deliberate press only: not a held key's repeats, which would bounce a reader in
 * and straight back out, not the Esc that ends an IME composition, which belongs to the text being
 * composed, not one another control has already answered, and not one typed in a text field.
 * A link the glass answers itself (Back, the HUD's avatar and orbs) takes over a plain click only,
 * so a modified or middle click opens a new tab or window as the browser would.
 */
import type { MouseEvent } from 'react';

/** Where Esc belongs to the control it was typed in. */
export function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file', 'image'].includes(target.type);
}

/** A press of Esc that the page as a whole may answer. */
export function pageEscape(e: KeyboardEvent): boolean {
  return e.key === 'Escape' && !e.defaultPrevented && !e.repeat && !e.isComposing && !isEditable(e.target);
}

/** A primary-button click with no modifier: the one a link the glass answers takes over. */
export function plainClick(e: MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}
