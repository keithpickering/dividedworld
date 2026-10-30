/**
 * The Game HUD, docked at the bottom of every board page, in the glass (the web plan's glass
 * amendment to Task 3; the glass plan, sections 5, 7 and 8). Three groups: the character plate
 * (the avatar, which opens My characters; the name; the class tag only its player sees; the swap),
 * the aura (the orbs, which open My log, and the clock to the next settlement), and Menu beside the
 * hand. Its top edge is a tab over the aura, cut by the shapes' HUD tab polygon from four points
 * the aura's own position sets (`--tab-a` to `--tab-d`), with the seam drawn along the same points.
 * The hand's sheet is a region of its own, beside the HUD and drawn above it (the Phone board).
 * Menu shows its key cap, ESC, for the eye and hides it from the accessibility tree, so the button's
 * name is its word alone, Menu, taken from its content and not set over it; the key is
 * aria-keyshortcuts'.
 *
 * It is the player's alone: what it shows is their own rows, and changing the character sends
 * nothing anywhere (player.tsx). Menu and Esc anywhere on the board open the glass at My characters;
 * an Esc another control handled, or one typed in a text field, is that control's, and a held Esc's
 * repeats and the Esc that ends an IME composition open nothing (engine/ui/glass/keys.ts). While the
 * hand is open, Esc closes the hand. No control here keeps the board's place for Back: the router's
 * move from a board route into the glass does (keepBoardPlace, engine/ui/glass/back.ts), so every
 * way into the glass keeps it, these and any link elsewhere on the page alike. A modified or middle
 * click on the avatar or the orbs opens its page as the browser would and leaves this one alone.
 * Menu navigates rather than opening a menu, so it claims no popup.
 *
 * The hand opens as a region and takes focus, so a keyboard is in it at once; its Close the hand
 * button, or Esc, closes it and returns focus to the hand. What it holds is the cards' (engine/ui/cards/Hand.tsx):
 * a sheet above the bar on the Phone board's layout, and on the Main board's the cards themselves,
 * fanned through the seam over the hand button. It is not a modal: the HUD stays live under it, as
 * the boards draw it, since the hand is how a card is picked to play on the board behind.
 *
 * The swap is named "Swap mask" on the Main board's layout and "Posting as" on the Phone board's.
 * Which layout it is comes from useBoard (engine/ui/glass/useBoard.ts): the Main board's from the
 * width worked out from the instance's sizes (engine/ui/glass/board.ts), drawn
 * at the window's scale below 1440px, and the Phone board's below that width. The glass pages
 * switch at the same width.
 */
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Character } from '../data/api.ts';
import { useKayfa } from '../context.tsx';
import { usePlayer } from '../player.tsx';
import { signInHref } from '../account/next.ts';
import { dayAndTime } from '../characters/format.ts';
import { Link, searchOf, useLocation, useNavigate } from '../router.tsx';
import { Hand } from '../cards/Hand.tsx';
import { facesOf } from '../cards/faces.ts';
import { landing } from '../cards/land.ts';
import { usePlay } from '../cards/play.tsx';
import { Orbs } from '../orbs/Orbs.tsx';
import { cascade, CASCADE_BEAT_MS } from '../orbs/fill.ts';
import { motionReduced } from '../appearance.ts';
import { HUD_CLASS } from '../glass/place.ts';
import { Smoke, useSurfaceStyle } from '../glass/Smoke.tsx';
import { pageEscape } from '../glass/keys.ts';
import { GLASS_NAV } from '../glass/nav.ts';
import { useBoard } from '../glass/useBoard.ts';

/** The tab's slopes: 28px across, 24px tall, its top 20px wider than the aura each side, as the Main board draws them. */
const SLOPE = 28;
const TAB = 24;
const TAB_OUT = 20;

export function Hud() {
  const { api, instance, settings, ui } = useKayfa();
  const player = usePlayer();
  const location = useLocation();
  const navigate = useNavigate();
  const { board, scale } = useBoard();
  const wide = board === 'main';
  const [face, setFace] = useState<Character | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [tab, setTab] = useState<readonly [number, number, number, number] | null>(null);
  const handButton = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const aura = useRef<HTMLDivElement>(null);
  const drawerId = useId();
  const faces = useMemo(() => facesOf(instance.cards, ui.cards, instance.settings), [instance, ui.cards]);
  const selectId = useId();
  /* Each of the two surfaces here draws its own recipe's calm under its text (useSurfaceStyle, engine/ui/glass/Smoke.tsx). */
  const hudCalm = useSurfaceStyle('hud');
  const handCalm = useSurfaceStyle('hand');
  const hud = player.hudCharacter;
  /* Whether the hand is open, which card is armed and which post the hand was opened for are the Frame's (cards/play.tsx): a post's own buttons read them too. */
  const play = usePlay();
  if (!play) throw new Error('the HUD is drawn inside the Frame');
  const { handOpen, setHandOpen, armed, handFor } = play;
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
   * What sits above the HUD (the hand's sheet, the new-posts bar) and the page's foot need the HUD's
   * real height, as the window draws it: on the Phone board's layout its rows grow with what they
   * hold, and on the Main board's it is scaled with the window. The tab's four points follow the
   * aura's own box, so the tab sits over the orbs at every width.
   *
   * The HUD is drawn at the board's scale (`zoom`, frame.css), and a box measured here is the
   * window's, so the height is set as it stands, for what sits outside the HUD, and the tab's points
   * are divided by the HUD's zoom, since they are set on the HUD and drawn at it.
   *
   * Watching the section and the bar's three groups is enough: the HUD's height changes only with
   * the section's box, and the aura moves only when the section's width or the size of a group
   * beside it changes (a longer name in the plate, the hand's count) or it changes size itself.
   * Each of those resizes something watched here, so no move of the tab goes unmeasured. A change of
   * scale alone resizes nothing in the HUD's own lengths, so it measures again on its own.
   */
  useEffect(() => {
    const el = section.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const measure = () => {
      const s = el.getBoundingClientRect();
      root.style.setProperty('--kb-hud-measured', `${Math.ceil(s.height)}px`);
      const a = aura.current?.getBoundingClientRect();
      /* A browser that draws zoom but has no currentCSSZoom (older Safari) draws it at the board's scale. */
      const zoom = el.currentCSSZoom ?? scale;
      if (a && a.width > 0) {
        const left = Math.round((a.left - s.left) / zoom) - TAB_OUT;
        const right = Math.round((a.left - s.left + a.width) / zoom) + TAB_OUT;
        setTab((t) => (t && t[1] === left && t[2] === right ? t : [left - SLOPE, left, right, right + SLOPE]));
      }
      /* Where the bar starts in the glass, so the bar can cut what it draws to the tab's shape (frame.css). */
      const bar = el.querySelector('.kb-hud-bar')?.getBoundingClientRect();
      if (bar) el.style.setProperty('--kb-hud-bar-shift', `${Math.round((bar.left - s.left) / zoom)}px`);
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    for (const group of el.querySelectorAll('.kb-hud-bar > *')) watch.observe(group);
    return () => { watch.disconnect(); root.style.removeProperty('--kb-hud-measured'); };
  }, [signedIn, board, scale]);

  /* The opened hand takes focus, so the keyboard is in it at once. */
  useEffect(() => { if (handOpen) drawer.current?.focus(); }, [handOpen]);

  /* Esc on the board: the hand's when it is open, else the menu's. */
  useEffect(() => {
    if (!signedIn) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.repeat || e.isComposing) return;
      /* An armed card is put back first, and the hand, if it is open, stays; the next Esc is the hand's. */
      if (armed !== null) {
        e.preventDefault();
        play.arm(null);
        return;
      }
      if (handOpen) {
        e.preventDefault();
        setHandOpen(false);
        handButton.current?.focus();
        return;
      }
      if (!pageEscape(e)) return;
      e.preventDefault();
      navigate(GLASS_NAV.characters);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [signedIn, handOpen, armed, play, setHandOpen, navigate]);

  /* Opened for a post, the hand shows only the cards that can land on it. */
  const shown = useMemo(() => {
    if (!handFor) return faces;
    const carried = handFor.plays.get(handFor.post.id).plays;
    return faces.filter((f) => {
      const rules = instance.cards.find((c) => c.key === f.key);
      return rules !== undefined && landing(rules, handFor.post, carried).ok;
    });
  }, [faces, handFor, instance.cards]);
  /* Opened for a post, a card is played on it; opened alone, a card is armed, or put back if it was the armed one. */
  const pick = (face: { readonly key: string }) => {
    if (handFor) {
      /* The hand is put away as the form opens, so focus goes to the post first: that is where the form hands it back. */
      document.getElementById(`post-${handFor.post.seq}`)?.focus({ preventScroll: true });
      play.openForm(face.key, handFor);
    }
    else {
      play.arm(armed === face.key ? null : face.key);
      /* The Phone board's sheet covers the foot of the page, where the posts to pick are: it is put away, and the armed card waits in the hand. */
      if (!wide) setHandOpen(false);
    }
  };

  const held = player.cards.reduce((n, c) => n + c.held, 0);
  /*
   * On the Phone board's layout an armed card is the hand button's words, and one press puts it back
   * (the owner's answer on #80): the sheet is put away once a card is armed, so the HUD is where the
   * player is told, and where the way out is. The name holds the visible words first (WCAG 2.5.3).
   * The Main board keeps the fan open with the armed card and its tag, and Esc.
   */
  const armedName = !wide && armed !== null ? instance.cards.find((c) => c.key === armed)?.name ?? armed : null;
  const handName = armedName !== null ? `Armed · ${armedName}, press to put it back` : `Hand, ${held} ${held === 1 ? 'postcard' : 'postcards'}${handOpen ? ', open' : ''}`;
  const className = hud ? instance.classes.find((c) => c.key === hud.class)?.name ?? hud.class : null;
  const tabVars = tab ? { '--tab-a': `${tab[0]}px`, '--tab-b': `${tab[1]}px`, '--tab-c': `${tab[2]}px`, '--tab-d': `${tab[3]}px` } as CSSProperties : undefined;
  const seam = tab ? `0,${TAB + 6} ${tab[0]},${TAB + 6} ${tab[1]},6 ${tab[2]},6 ${tab[3]},${TAB + 6} 10000,${TAB + 6}` : `0,${TAB + 6} 10000,${TAB + 6}`;

  return (
    <>
      {signedIn && (
        <div ref={drawer} id={drawerId} className="kb-glass kb-hand-drawer" role="region" aria-label="Your hand" tabIndex={-1} hidden={!handOpen} style={handCalm}>
          <Smoke surface="hand" />
          <Hand
            held={player.cards} faces={shown} vendingHref={GLASS_NAV.vending}
            armed={armed} forPost={handFor ? `${handFor.author}'s post #${handFor.post.seq}` : undefined}
            onPick={hud ? pick : undefined}
            onClose={() => { setHandOpen(false); handButton.current?.focus(); }}
          />
        </div>
      )}
      <section ref={section} className={HUD_CLASS} aria-label="Game HUD" style={tabVars}>
        <div className="kb-glass kb-hud-glass" style={hudCalm}>
          <div className="kb-hud-ground kb-glass-hud-tab" aria-hidden="true"><Smoke surface="hud" /></div>
          <svg className="kb-hud-seam" aria-hidden="true" focusable="false" preserveAspectRatio="none">
            <polyline className="kb-glass-seam-glow" points={seam} />
            <polyline className="kb-glass-seam-core" points={seam} />
          </svg>
          <div className="kb-hud-bar">
            <div className={`kb-hud-plate${signedIn && player.loaded && hud ? ' kb-hud-plate--cast kb-calm' : ''}`}>
              <div className="kb-hud-plate-in">
                {!signedIn ? (
                  <Link to={signInHref(location.path, searchOf(location.query))} className="kb-hud-sign-in kb-glass-cut-button">Sign in</Link>
                ) : !player.loaded ? null : !hud ? (
                  <Link to="/characters/new" className="kb-hud-make kb-glass-cut-button">Make a character</Link>
                ) : (
                  <>
                    <Link
                      to={GLASS_NAV.characters}
                      className="kb-hud-avatar"
                      aria-label="My characters"
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
                    <span className="kb-hud-swap kb-calm">
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
              <div ref={aura} className="kb-hud-aura kb-calm">
                <p className="kb-hud-aura-legend"><span>Aura</span><span className="kb-hud-aura-ghost">Ghost = estimate until settlement</span></p>
                {player.wallet && (
                  <Link
                    to={GLASS_NAV.log}
                    className="kb-hud-orbs"
                  >
                    <span className="kb-visually-hidden">My log: </span>
                    <Orbs settled={player.wallet.balance} pending={player.pending} cap={player.wallet.cap ?? settings.walletCap} cascadeFrom={player.walletSeen} />
                  </Link>
                )}
              </div>
            )}
            {signedIn && (
              <div className="kb-hud-side">
                <p className="kb-hud-clock kb-calm">
                  <span className="kb-hud-clock-label">Next settlement</span>
                  {next ? <time className="kb-hud-clock-time kb-num" dateTime={next}>{dayAndTime(next)}</time> : <span className="kb-hud-clock-time">not yet set</span>}
                </p>
                <div className="kb-hud-actions">
                  <button
                    type="button"
                    className="kb-hud-menu kb-glass-skew"
                    aria-keyshortcuts="Escape"
                    onClick={() => navigate(GLASS_NAV.characters)}
                  >
                    <kbd className="kb-hud-key kb-glass-upright" aria-hidden="true">ESC</kbd>
                    <span className="kb-glass-upright">Menu</span>
                  </button>
                  <button
                    ref={handButton}
                    type="button"
                    className="kb-hud-hand kb-glass-skew"
                    {...(armedName === null ? { 'aria-expanded': handOpen, 'aria-controls': drawerId } : {})}
                    aria-label={handName}
                    data-kb-armed={armedName !== null ? 'true' : undefined}
                    onClick={() => (armedName !== null ? play.arm(null) : setHandOpen(!handOpen))}
                  >
                    {armedName !== null
                      ? <span className="kb-hud-hand-armed kb-glass-upright">Armed · {armedName}</span>
                      : <><span className="kb-glass-upright">Hand</span> <span className="kb-hud-hand-count kb-glass-upright kb-num">{held}</span></>}
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
