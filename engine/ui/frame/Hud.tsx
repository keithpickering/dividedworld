/**
 * The Game HUD, docked at the bottom of every board page, in the glass (the web plan's glass
 * amendment to Task 3; the glass plan, sections 5, 7 and 8). Three groups: the character plate
 * (the avatar, which opens My characters; the name; the class tag only its player sees; the swap),
 * the aura (the orbs, which open My log, and the clock to the next settlement), and Menu beside the
 * hand. Its top edge is a tab over the aura, cut by the shapes' HUD tab polygon from four points
 * the aura's own position sets (`--tab-a` to `--tab-d`), with the seam drawn along the same points.
 * The hand's sheet is a region of its own, beside the HUD and drawn above it (the Phone board).
 * Menu shows its key cap, ESC, for the eye; its name is Menu, and the key is aria-keyshortcuts'.
 *
 * It is the player's alone: what it shows is their own rows, and changing the character sends
 * nothing anywhere (player.tsx). Menu and Esc anywhere on the board open the glass at My characters,
 * keeping the board's place for Back (engine/ui/glass/back.ts); an Esc another control handled, or
 * one typed in a text field, is that control's. While the hand is open, Esc closes the hand.
 *
 * The swap is named "Swap mask" where the three groups fit (the Main board) and "Posting as" below
 * 1340px, where the HUD is the Phone board's.
 */
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import type { Character } from '../data/api.ts';
import { useKayfa } from '../context.tsx';
import { usePlayer } from '../player.tsx';
import { signInHref } from '../account/next.ts';
import { dayAndTime } from '../characters/format.ts';
import { Link, useLocation, useNavigate } from '../router.tsx';
import { Orbs } from '../orbs/Orbs.tsx';
import { cascade, CASCADE_BEAT_MS } from '../orbs/fill.ts';
import { motionReduced } from '../appearance.ts';
import { Smoke } from '../glass/Smoke.tsx';
import { rememberBoard } from '../glass/back.ts';
import { isEditable } from '../glass/MenuBar.tsx';
import { GLASS_NAV } from '../glass/nav.ts';

/** Where the HUD stops being the Main board's three groups and becomes the Phone board's. */
const WIDE = '(min-width: 1340px)';

/** The tab's slopes: 28px across, 24px tall, its top 20px wider than the aura each side, as the Main board draws them. */
const SLOPE = 28;
const TAB = 24;
const TAB_OUT = 20;

function useWide(): boolean {
  const query = () => (typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(WIDE) : null);
  const [wide, setWide] = useState(() => query()?.matches ?? true);
  useEffect(() => {
    const q = query();
    if (!q) return;
    const on = () => setWide(q.matches);
    on();
    q.addEventListener?.('change', on);
    return () => q.removeEventListener?.('change', on);
  }, []);
  return wide;
}

export function Hud() {
  const { api, instance, settings } = useKayfa();
  const player = usePlayer();
  const location = useLocation();
  const navigate = useNavigate();
  const wide = useWide();
  const [face, setFace] = useState<Character | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [handOpen, setHandOpen] = useState(false);
  const [tab, setTab] = useState<readonly [number, number, number, number] | null>(null);
  const handButton = useRef<HTMLButtonElement>(null);
  const section = useRef<HTMLElement>(null);
  const aura = useRef<HTMLDivElement>(null);
  const drawerId = useId();
  const selectId = useId();
  const hud = player.hudCharacter;
  const signedIn = player.session.signedIn;

  const hudId = hud?.id ?? null;
  useEffect(() => {
    let live = true;
    setFace(null);
    if (!hudId) return;
    /* No face is the initial in the slot; a later page asks again. */
    void api.characters([hudId]).then((cs) => { if (live) setFace(cs[0] ?? null); }, () => {});
    return () => { live = false; };
  }, [api, hudId]);

  useEffect(() => {
    let live = true;
    setNext(null);
    if (!signedIn) return;
    void api.nextSettlementAt().then((at) => { if (live) setNext(at); }, () => {});
    return () => { live = false; };
  }, [api, signedIn]);

  /* Once the cascade has played (or at once, under reduced motion), this device has seen the new wallet. */
  const { walletSeen, markWalletSeen } = player;
  const balance = player.wallet?.balance ?? null;
  const cap = player.wallet?.cap ?? null;
  useEffect(() => {
    if (walletSeen === null || balance === null || cap === null) return;
    const steps = cascade(walletSeen, balance, cap);
    const t = setTimeout(markWalletSeen, motionReduced() ? 0 : steps.length * CASCADE_BEAT_MS + 600);
    return () => clearTimeout(t);
  }, [balance, cap, walletSeen, markWalletSeen]);

  /*
   * What sits above the HUD (the hand's sheet, the new-posts bar) needs the HUD's real height: on a
   * narrow screen its groups stack. The tab's four points follow the
   * aura's own box, so the tab sits over the orbs at every width.
   */
  useEffect(() => {
    const el = section.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const measure = () => {
      root.style.setProperty('--kb-hud-measured', `${Math.ceil(el.getBoundingClientRect().height)}px`);
      const a = aura.current?.getBoundingClientRect();
      const s = el.getBoundingClientRect();
      if (a && a.width > 0) {
        const left = Math.round(a.left - s.left) - TAB_OUT;
        const right = Math.round(a.left - s.left + a.width) + TAB_OUT;
        setTab((t) => (t && t[1] === left && t[2] === right ? t : [left - SLOPE, left, right, right + SLOPE]));
      }
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    if (aura.current) watch.observe(aura.current);
    return () => { watch.disconnect(); root.style.removeProperty('--kb-hud-measured'); };
  }, [signedIn]);

  const here = `${location.path}${location.query.size ? `?${location.query}` : ''}`;
  const toGlass = (to: string) => { rememberBoard(here); navigate(to); };

  /* Esc on the board: the hand's when it is open, else the menu's. */
  useEffect(() => {
    if (!signedIn) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (handOpen) {
        e.preventDefault();
        setHandOpen(false);
        handButton.current?.focus();
        return;
      }
      if (isEditable(e.target)) return;
      e.preventDefault();
      rememberBoard(here);
      navigate(GLASS_NAV.characters);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [signedIn, handOpen, here, navigate]);

  const held = player.cards.reduce((n, c) => n + c.held, 0);
  const cardName = (key: string) => instance.cards.find((c) => c.key === key)?.name ?? key;
  const handName = `Hand, ${held} ${held === 1 ? 'postcard' : 'postcards'}${handOpen ? ', open' : ''}`;
  const className = hud ? instance.classes.find((c) => c.key === hud.class)?.name ?? hud.class : null;
  const tabVars = tab ? { '--tab-a': `${tab[0]}px`, '--tab-b': `${tab[1]}px`, '--tab-c': `${tab[2]}px`, '--tab-d': `${tab[3]}px` } as CSSProperties : undefined;
  const seam = tab ? `0,${TAB + 6} ${tab[0]},${TAB + 6} ${tab[1]},6 ${tab[2]},6 ${tab[3]},${TAB + 6} 10000,${TAB + 6}` : `0,${TAB + 6} 10000,${TAB + 6}`;

  return (
    <>
      {signedIn && (
        <section id={drawerId} className="kb-glass kb-hand-drawer" aria-label="Your hand" hidden={!handOpen}>
          <Smoke surface="hand" />
          <div className="kb-hand-bar">
            <button
              type="button"
              className="kb-hand-close"
              aria-label="Close the hand"
              onClick={() => { setHandOpen(false); handButton.current?.focus(); }}
            >
              <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16"><path d="M3 3 L13 13 M13 3 L3 13" /></svg>
            </button>
          </div>
          {held === 0 ? (
            <p className="kb-hand-empty">No postcards in your hand.</p>
          ) : (
            <ul className="kb-hand-cards">
              {player.cards.filter((c) => c.held > 0).map((c) => (
                <li key={c.card} className="kb-hand-card" data-kb-card={c.card}>{cardName(c.card)} ×{c.held}</li>
              ))}
            </ul>
          )}
        </section>
      )}
      <section ref={section} className="kb-hud" aria-label="Game HUD" style={tabVars} data-kb-wide={wide || undefined}>
        <div className="kb-glass kb-hud-glass">
          <div className="kb-hud-ground kb-glass-hud-tab" aria-hidden="true"><Smoke surface="hud" /></div>
          <svg className="kb-hud-seam" aria-hidden="true" focusable="false" preserveAspectRatio="none">
            <polyline className="kb-glass-seam-glow" points={seam} />
            <polyline className="kb-glass-seam-core" points={seam} />
          </svg>
          <div className="kb-hud-bar">
            <div className={`kb-hud-plate${signedIn && player.loaded && hud ? ' kb-hud-plate--cast' : ''}`}>
              <div className="kb-hud-plate-in">
                {!signedIn ? (
                  <Link to={signInHref(location.path, location.query.size ? `?${location.query}` : '')} className="kb-hud-sign-in kb-glass-cut-button">Sign in</Link>
                ) : !player.loaded ? null : !hud ? (
                  <Link to="/characters/new" className="kb-hud-make kb-glass-cut-button">Make a character</Link>
                ) : (
                  <>
                    <Link
                      to={GLASS_NAV.characters}
                      className="kb-hud-avatar"
                      aria-label="My characters"
                      onClick={(e) => { e.preventDefault(); toGlass(GLASS_NAV.characters); }}
                    >
                      {face?.avatarSquare ? <img src={face.avatarSquare} alt="" /> : <span className="kb-hud-avatar-none" aria-hidden="true">{hud.name.slice(0, 1)}</span>}
                    </Link>
                    <span className="kb-hud-who">
                      <span className="kb-hud-name kb-glass-display">{hud.name}</span>
                      <span className="kb-hud-class-line">
                        <span className="kb-hud-class kb-glass-skew-tag" style={{ '--kb-hud-class-fill': `var(--kb-glass-class-${hud.class}-fill)`, '--kb-hud-class-ink': `var(--kb-glass-class-${hud.class}-ink)` } as CSSProperties}>
                          {className}
                        </span>
                        <span className="kb-hud-secret">
                          <svg aria-hidden="true" focusable="false" width="15" height="16" viewBox="0 0 11 12"><rect x="1" y="5" width="9" height="6.5" rx="1" /><path d="M3 5 V3.4 a2.5 2.5 0 0 1 5 0 V5" /></svg>
                          Only you see this
                        </span>
                      </span>
                    </span>
                    <span className="kb-hud-swap">
                      <label htmlFor={selectId} className="kb-hud-swap-label">{wide ? 'Swap mask' : 'Posting as'}</label>
                      <select id={selectId} className="kb-hud-select" value={hud.id} onChange={(e) => player.setHudCharacter(e.target.value)}>
                        {player.actingCharacters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </span>
                  </>
                )}
              </div>
            </div>
            {signedIn && (
              <div ref={aura} className="kb-hud-aura">
                <p className="kb-hud-aura-legend"><span>Aura</span><span className="kb-hud-aura-ghost">Ghost = estimate until settlement</span></p>
                {player.wallet && (
                  <Link
                    to={GLASS_NAV.log}
                    className="kb-hud-orbs"
                    onClick={(e) => { e.preventDefault(); toGlass(GLASS_NAV.log); }}
                  >
                    <span className="kb-visually-hidden">My log: </span>
                    <Orbs settled={player.wallet.balance} pending={player.pending} cap={player.wallet.cap ?? settings.walletCap} cascadeFrom={player.walletSeen} />
                  </Link>
                )}
              </div>
            )}
            {signedIn && (
              <div className="kb-hud-side">
                <p className="kb-hud-clock">
                  <span className="kb-hud-clock-label">Next settlement</span>
                  {next ? <time className="kb-hud-clock-time kb-num" dateTime={next}>{dayAndTime(next)}</time> : <span className="kb-hud-clock-time">not yet set</span>}
                </p>
                <div className="kb-hud-actions">
                  <button
                    type="button"
                    className="kb-hud-menu kb-glass-skew"
                    aria-label="Menu"
                    aria-haspopup="true"
                    aria-keyshortcuts="Escape"
                    onClick={() => toGlass(GLASS_NAV.characters)}
                  >
                    <kbd className="kb-hud-key kb-glass-upright">ESC</kbd>
                    <span className="kb-glass-upright">Menu</span>
                  </button>
                  <button
                    ref={handButton}
                    type="button"
                    className="kb-hud-hand kb-glass-skew"
                    aria-expanded={handOpen}
                    aria-controls={drawerId}
                    aria-label={handName}
                    onClick={() => setHandOpen((o) => !o)}
                  >
                    <span className="kb-glass-upright">Hand</span> <span className="kb-hud-hand-count kb-glass-upright kb-num">{held}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
