/**
 * The HUD, docked at the bottom of every page: who the player is posting as (a plain select, so a
 * keyboard and a screen reader use it as it is), that character's avatar, the orbs, and the hand.
 * It is the player's alone: what it shows is their own rows, and changing the character sends
 * nothing anywhere (player.tsx).
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { Character } from '../data/api.ts';
import { useKayfa } from '../context.tsx';
import { usePlayer } from '../player.tsx';
import { Link } from '../router.tsx';
import { Orbs } from '../orbs/Orbs.tsx';
import { cascade, CASCADE_BEAT_MS } from '../orbs/fill.ts';
import { motionReduced } from '../appearance.ts';

export function Hud() {
  const { api, instance, settings } = useKayfa();
  const player = usePlayer();
  const [face, setFace] = useState<Character | null>(null);
  const [handOpen, setHandOpen] = useState(false);
  const handButton = useRef<HTMLButtonElement>(null);
  const section = useRef<HTMLElement>(null);
  const drawerId = useId();
  const selectId = useId();
  const hud = player.hudCharacter;

  const hudId = hud?.id ?? null;
  useEffect(() => {
    let live = true;
    setFace(null);
    if (!hudId) return;
    /* No face is the initial in the slot; a later page asks again. */
    void api.characters([hudId]).then((cs) => { if (live) setFace(cs[0] ?? null); }, () => {});
    return () => { live = false; };
  }, [api, hudId]);

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

  /* What sits above the HUD (a sheet, the new-posts bar) needs the HUD's real height: on a narrow screen its controls wrap to a second line, and the hand drawer adds its own. */
  useEffect(() => {
    const el = section.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const measure = () => root.style.setProperty('--kb-hud-measured', `${Math.ceil(el.getBoundingClientRect().height)}px`);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => { watch.disconnect(); root.style.removeProperty('--kb-hud-measured'); };
  }, []);

  useEffect(() => {
    if (!handOpen) return;
    const onKey = (e: KeyboardEvent) => {
      /* An Esc another dialog or control has handled is its own. */
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      setHandOpen(false);
      handButton.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [handOpen]);

  const held = player.cards.reduce((n, c) => n + c.held, 0);
  const cardName = (key: string) => instance.cards.find((c) => c.key === key)?.name ?? key;

  return (
    <section ref={section} className="kb-hud" aria-label="HUD">
      {player.session.signedIn && (
        <div id={drawerId} className="kb-hand-drawer" role="region" aria-label="Your hand" hidden={!handOpen}>
          {held === 0 ? (
            <p className="kb-muted">No cards in your hand.</p>
          ) : (
            <ul className="kb-hand-cards">
              {player.cards.filter((c) => c.held > 0).map((c) => (
                <li key={c.card} className="kb-hand-card" data-kb-card={c.card}>{cardName(c.card)} ×{c.held}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="kb-hud-bar">
        {!player.session.signedIn ? (
          <Link to="/sign-in" className="kb-hud-sign-in">Sign in</Link>
        ) : !player.loaded ? null : !hud ? (
          <Link to="/characters/new" className="kb-hud-make">Make a character</Link>
        ) : (
          <>
            <span className="kb-hud-avatar" aria-hidden="true">
              {face?.avatarSquare ? <img src={face.avatarSquare} alt="" /> : <span className="kb-hud-avatar-none">{hud.name.slice(0, 1)}</span>}
            </span>
            <label htmlFor={selectId} className="kb-visually-hidden">Posting as</label>
            <select id={selectId} className="kb-select kb-hud-select" value={hud.id} onChange={(e) => player.setHudCharacter(e.target.value)}>
              {player.actingCharacters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </>
        )}
        {player.session.signedIn && player.wallet && (
          <Orbs settled={player.wallet.balance} pending={player.pending} cap={player.wallet.cap ?? settings.walletCap} cascadeFrom={player.walletSeen} />
        )}
        {player.session.signedIn && (
          <button
            ref={handButton}
            type="button"
            className="kb-button kb-hand-button kb-mono"
            aria-expanded={handOpen}
            aria-controls={drawerId}
            aria-label={`Hand: ${held} ${held === 1 ? 'card' : 'cards'}`}
            onClick={() => setHandOpen((o) => !o)}
          >
            Hand {held}
          </button>
        )}
      </div>
    </section>
  );
}
