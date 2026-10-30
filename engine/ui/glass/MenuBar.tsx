/**
 * The menu bar on every glass page (the web plan's glass amendment to Task 3; the glass plan,
 * section 7, board 02): Back to the board first, with Esc as its key, then My characters, Rankings,
 * My log and Settings, the current one marked with aria-current. Signed out, the bar holds Back
 * alone, since every page on it needs an account. The arrow and the ESC key cap the boards draw on
 * Back are empty, hidden elements the stylesheet writes into (`data-kb-key`), so the link's name and
 * text are its words alone.
 *
 * Esc anywhere on a glass page goes back, as the Back link does, unless something else has
 * answered it first (an overlay, which closes and leaves the page; a control that handled it) or
 * it was typed into a text field, where Esc belongs to the field. Where the bar's pages live is
 * GLASS_NAV's (nav.ts): Rankings and My log stand in on the standings until their pages exist.
 */
import { useEffect } from 'react';
import { usePlayer } from '../player.tsx';
import { Link, useLocation } from '../router.tsx';
import { backHref, boardPlace, useBackToBoard } from './back.ts';
import { GLASS_NAV } from './nav.ts';
import './shell.css';

/** Where Esc belongs to the control it was typed in. */
export function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file', 'image'].includes(target.type);
}

interface Tab { readonly label: string; readonly to: string; readonly current: (path: string) => boolean }

const TABS: readonly Tab[] = [
  { label: 'My characters', to: GLASS_NAV.characters, current: (p) => p === '/characters' || p.startsWith('/characters/') },
  { label: 'Rankings', to: GLASS_NAV.rankings, current: () => false },
  { label: 'My log', to: GLASS_NAV.log, current: () => false },
  { label: 'Settings', to: GLASS_NAV.settings, current: (p) => p === '/settings' || p === '/invites' },
];

export function MenuBar() {
  const { session } = usePlayer();
  const { path } = useLocation();
  const back = useBackToBoard();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isEditable(e.target)) return;
      e.preventDefault();
      back();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [back]);

  return (
    <nav className="kb-glass-menu" aria-label="Menu">
      <ul className="kb-glass-menu-list">
        <li>
          <Link
            to={backHref(boardPlace())}
            className="kb-glass-menu-back kb-glass-cut-button"
            aria-keyshortcuts="Escape"
            onClick={(e) => { e.preventDefault(); back(); }}
          >
            <span className="kb-glass-menu-arrow" aria-hidden="true" data-kb-key="‹" />
            Back to the board
            <span className="kb-glass-menu-key" aria-hidden="true" data-kb-key="ESC" />
          </Link>
        </li>
        {session.signedIn && TABS.map((t) => (
          <li key={t.label}>
            <Link to={t.to} className="kb-glass-menu-tab" aria-current={t.current(path) ? 'page' : undefined}>{t.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
