/**
 * The menu bar on every glass page (the web plan's glass amendment to Task 3; the glass plan,
 * section 7, boards 02 and 07): Back to the board first, with Esc as its key, then Vending Machine, My
 * characters, Rankings, My log and Settings, the current one marked with aria-current. Signed out, the bar holds Back
 * alone, since every page on it needs an account. The arrow and the ESC key cap the boards draw on
 * Back are empty, hidden elements the stylesheet writes into (`data-kb-key`), so the link's name and
 * text are its words alone.
 *
 * Esc anywhere on a glass page goes back, as the Back link does, unless something else has
 * answered it first (an overlay, which closes and leaves the page; a control that handled it), it
 * was typed into a text field, where Esc belongs to the field, or it is a held key's repeat or the
 * end of an IME composition (keys.ts). A modified or middle click on Back opens the board as the
 * browser would and leaves this page and its kept place alone. Where the bar's pages live is
 * GLASS_NAV's (nav.ts): My log stands in on the standings until its page exists.
 *
 * On the Main board's layout the bar is the boards': 84px, its tabs skewed with their words set
 * upright, Back outlined in white with its ESC key cap before its words, the current tab lit. While
 * an overlay is open over the page the bar stays in view, dimmed and inert (Overlay.tsx).
 *
 * On a phone Back is on its own row and the pages are a strip under it that scrolls sideways, so
 * the current page's tab is scrolled into view as a page opens; with reduced motion it is there at
 * once. Back stays out of the strip, so no tab ever slides under it.
 */
import { useEffect, useRef } from 'react';
import { motionReduced } from '../appearance.ts';
import { usePlayer } from '../player.tsx';
import { Link, useLocation } from '../router.tsx';
import { backHref, boardPlace, useBackToBoard } from './back.ts';
import { pageEscape, plainClick } from './keys.ts';
import { GLASS_NAV } from './nav.ts';
import './shell.css';

interface Tab { readonly label: string; readonly to: string; readonly current: (path: string) => boolean }

const TABS: readonly Tab[] = [
  { label: 'Vending Machine', to: GLASS_NAV.vending, current: (p) => p === GLASS_NAV.vending },
  { label: 'My characters', to: GLASS_NAV.characters, current: (p) => p === '/characters' || p.startsWith('/characters/') },
  { label: 'Rankings', to: GLASS_NAV.rankings, current: (p) => p === GLASS_NAV.rankings },
  { label: 'My log', to: GLASS_NAV.log, current: () => false },
  { label: 'Settings', to: GLASS_NAV.settings, current: (p) => p === '/settings' || p === '/invites' },
];

export function MenuBar() {
  const { session } = usePlayer();
  const { path } = useLocation();
  const back = useBackToBoard();
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!pageEscape(e)) return;
      e.preventDefault();
      back();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [back]);

  useEffect(() => {
    const current = list.current?.querySelector('[aria-current="page"]');
    current?.scrollIntoView?.({ inline: 'nearest', block: 'nearest', behavior: motionReduced() ? 'auto' : 'smooth' });
  }, [path, session.signedIn]);

  return (
    <nav className="kb-glass-menu" aria-label="Menu">
      <div className="kb-glass-menu-row">
        <Link
          to={backHref(boardPlace())}
          className="kb-glass-menu-back kb-glass-skew"
          aria-keyshortcuts="Escape"
          onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); back(); }}
        >
          <span className="kb-glass-upright">
            <span className="kb-glass-menu-arrow" aria-hidden="true" data-kb-key="‹" />
            <span className="kb-glass-menu-key" aria-hidden="true" data-kb-key="ESC" />
            Back to the board
          </span>
        </Link>
        {session.signedIn && (
          <ul ref={list} className="kb-glass-menu-list">
            {TABS.map((t) => (
              <li key={t.label}>
                <Link to={t.to} className="kb-glass-menu-tab kb-glass-skew" aria-current={t.current(path) ? 'page' : undefined}><span className="kb-glass-upright">{t.label}</span></Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </nav>
  );
}
