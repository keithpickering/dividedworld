/**
 * The Vending Machine, as the Vending board draws it (docs/research/2026-10-29-two-worlds/07-vending.html;
 * the cards plan's Task 2): a glass page under the menu bar, with the wallet and the hand on its
 * left, the drawn machine in the middle and the line about the empty slots on its right. Each slot
 * is a button that selects a card ("Buy Stick Around, 1.00 orb"; the selected one adds ", selected"),
 * the price display says what is picked, and the buy button spends it. Slots with no card yet are
 * sealed and wait for a future postcard.
 *
 * There is no list of what is in the machine: it would grow with every card added (the owner's
 * answer on #75, the cards plan's Task 2). Each stocked slot carries an info button beside its
 * own ("About Whoops!") that opens an Overlay with that card's rules in plain words. It is a
 * sibling of the slot's button, never inside it, so opening it selects nothing and spends nothing;
 * a sealed slot has none.
 *
 * Buying spends solid orbs only: the wallet, never the ghost estimate. A purchase the wallet cannot
 * pay is refused here before the server is asked, and the server refuses it again if the wallet was
 * spent between the preview and the press, each in plain words ("Whoops! costs 1.00 and your wallet
 * holds 0.62"), since this is an out-of-character screen. On success the wallet's orbs drain the
 * cascade's way backwards (engine/ui/orbs/fill.ts: a spend runs from the last changed orb down), the
 * card drops into the tray and flies to the hand, and the count in the hand's link moves when it
 * lands. Under reduced motion there is no drop and no flight: the card is in the hand at once, and
 * the wallet shows what is left.
 *
 * The machine is a drawing and the drawing is the instance's: the engine lays out its parts and
 * marks each decorative one `data-kb-art` (hidden from a screen reader and, being the instance's
 * printing, outside the rendered type measurement; a code printed on a slot is an attribute the
 * stylesheet writes out, so a button's visible text is the card's name alone and the name it is
 * given, "Buy Stick Around, 1.00 orb", contains it), and the instance's stylesheet
 * (instances/divided-world/ui/vending/vending.css) gives them their colors, their words and their glow. What
 * a player reads and presses is real text in the glass's tokens, so a card, a price and a refusal
 * are said once, in words.
 *
 * What is bought is private: nothing here is sent to anyone, and a lost answer is read again from
 * the wallet and the hand rather than guessed at (player.tsx's buyCard).
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { motionReduced } from '../appearance.ts';
import { Postcard } from '../cards/Postcard.tsx';
import { facesOf, orbs, plainRefusal, priceOf, withCardEconomy, type CardFace } from '../cards/faces.ts';
import { signInHref } from '../account/next.ts';
import { useKayfa } from '../context.tsx';
import type { Id } from '../data/api.ts';
import { backHref, boardPlace } from '../glass/back.ts';
import { Overlay } from '../glass/Overlay.tsx';
import { Orbs } from '../orbs/Orbs.tsx';
import { cascade, CASCADE_BEAT_MS } from '../orbs/fill.ts';
import { usePlayer } from '../player.tsx';
import { Link, searchOf, useLocation } from '../router.tsx';
import './vending.css';

/* The refusal's words are the cards' (the play form says them too); the Vending Machine's tests and callers still reach them here. */
export { plainRefusal };

/** The slots the machine has: three rows of two, more when the instance sells more cards than that. */
const MIN_SLOTS = 6;

/** How many slots the machine has for this many cards. */
const slotsFor = (cards: number) => Math.max(MIN_SLOTS, Math.ceil(cards / 2) * 2);

/** A slot's code on the machine's front: A1, A2, B1 ... two to a row. */
const codeOf = (i: number) => `${String.fromCharCode(65 + Math.floor(i / 2))}${(i % 2) + 1}`;

/** How long the card is in flight to the hand, ms: the drop and the flight together. */
const DELIVERY_MS = 1500;

/** "orb" for one orb exactly, "orbs" for any other amount: the slot's name says "1.00 orb". */
const orbWord = (hundredths: number) => (hundredths === 100 ? 'orb' : 'orbs');

interface Outcome {
  readonly tone: 'refusal' | 'done';
  readonly text: string;
}

/** The cards on their way to the hand: the last one's key (a new one restarts the drop) and how many have not landed. */
interface Drop {
  readonly key: string;
  readonly n: number;
  readonly flying: number;
}

/** What the screen holds, with the account it was held for. */
interface Kept {
  readonly for: Id | null;
  readonly pickedKey: string | null;
  readonly busy: boolean;
  readonly outcome: Outcome | null;
  /* The wallet the drain starts from, until it has played. */
  readonly drainFrom: number | null;
  readonly drop: Drop | null;
}

/** Nothing held yet for `account`. */
const emptyFor = (account: Id | null): Kept => ({ for: account, pickedKey: null, busy: false, outcome: null, drainFrom: null, drop: null });

function Machine({ faces, picked, onPick, onAbout, onBuy, busy, drop, onLanded, shopName }: {
  readonly faces: readonly CardFace[];
  readonly picked: CardFace | null;
  readonly onPick: (key: string) => void;
  readonly onAbout: (key: string, button: HTMLElement) => void;
  readonly onBuy: () => void;
  readonly busy: boolean;
  readonly drop: Drop | null;
  readonly onLanded: () => void;
  readonly shopName: string;
}) {
  const total = slotsFor(faces.length);
  const dropped = drop ? faces.find((f) => f.key === drop.key) : undefined;
  const pickedCode = picked ? codeOf(faces.indexOf(picked)) : null;
  const pickedWords = picked ? `Selected: ${pickedCode}, ${picked.name}, ${orbs(picked.price)}` : 'Nothing selected';
  return (
    <div className="kb-vending-machine" role="group" aria-label={shopName}>
      <div className="kb-vending-body" aria-hidden="true" data-kb-art />
      <div className="kb-vending-marquee" aria-hidden="true" data-kb-art><span className="kb-vending-sign">{shopName}</span></div>

      <div className="kb-vending-front">
        <div className="kb-vending-sheen" aria-hidden="true" data-kb-art />
        <div className="kb-vending-slots">
          {Array.from({ length: total }, (_, i) => {
            const face = faces[i];
            const code = codeOf(i);
            if (!face) {
              return (
                <div key={code} className="kb-vending-slot kb-vending-slot--sealed" role="img" aria-label={`Empty slot ${code}, waiting for a future postcard`}>
                  <span className="kb-vending-sealed" aria-hidden="true" data-kb-art />
                  <span className="kb-vending-slot-code" aria-hidden="true" data-kb-art data-code={code} />
                </div>
              );
            }
            const selected = picked?.key === face.key;
            return (
              <div key={face.key} className="kb-vending-cell">
                <button
                  type="button"
                  className="kb-vending-slot"
                  aria-label={`Buy ${face.name}, ${orbs(face.price)} ${orbWord(face.price)}${selected ? ', selected' : ''}`}
                  aria-pressed={selected}
                  data-kb-alignment={face.alignment}
                  style={{ '--kb-card-color': face.art.color, '--kb-card-ink': face.art.ink } as CSSProperties}
                  onClick={() => onPick(face.key)}
                >
                  <Postcard face={face} size="slot" />
                  <svg className="kb-vending-coil" aria-hidden="true" focusable="false" width="120" height="22" viewBox="0 0 120 22" data-kb-art>
                    <path d="M4 11 q8 -10 16 0 t16 0 t16 0 t16 0 t16 0 t16 0 t16 0" fill="none" strokeWidth="2.5" />
                  </svg>
                  <span className="kb-vending-slot-code" aria-hidden="true" data-kb-art data-code={`${code} · ${orbs(face.price)}`} />
                </button>
                <button
                  type="button"
                  className="kb-vending-about"
                  aria-label={`About ${face.name}`}
                  style={{ '--kb-card-color': face.art.color } as CSSProperties}
                  onClick={(e) => onAbout(face.key, e.currentTarget)}
                >
                  <span aria-hidden="true" data-kb-art>i</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="kb-vending-panel">
        <div className="kb-vending-lcd" role="status" aria-label={pickedWords}>
          <span className="kb-visually-hidden">{pickedWords}</span>
          <span className="kb-vending-lcd-name" aria-hidden="true" data-kb-art>{picked ? `${pickedCode} · ${picked.name}` : 'Pick a slot'}</span>
          <span className="kb-vending-lcd-price kb-num" aria-hidden="true" data-kb-art>{picked ? orbs(picked.price) : '0.00'}</span>
        </div>
        <div className="kb-vending-aura-in" aria-hidden="true" data-kb-art><span className="kb-vending-aura-slot" /><span className="kb-vending-aura-label" /></div>
        <button type="button" className="kb-vending-buy" disabled={!picked || busy} onClick={onBuy}>
          <span className="kb-vending-buy-word">Buy</span>{' '}
          {picked && <span className="kb-vending-buy-card">{picked.name} · {orbs(picked.price)}</span>}
        </button>
        <p className="kb-vending-price-note kb-calm">
          {!picked ? 'Pick a slot to see what it costs.' : picked.extra > 0
            ? `Playing it on a long post costs up to ${orbs(picked.extra)} more, never more than ${orbs(picked.price + picked.extra)} in all.`
            : 'Playing it costs nothing more.'}
        </p>
      </div>

      <div className="kb-vending-tray">
        <span className="kb-vending-tray-label" aria-hidden="true" data-kb-art />
        {dropped && drop && (
          <span key={drop.n} className="kb-vending-drop" aria-hidden="true" onAnimationEnd={onLanded}>
            <Postcard face={dropped} size="slot" />
          </span>
        )}
        <span className="kb-vending-tray-to" aria-hidden="true" data-kb-art />
        {picked && <span className="kb-visually-hidden">Push {picked.name} to your hand</span>}
      </div>
    </div>
  );
}

export function Vending() {
  const { instance, settings, ui } = useKayfa();
  const player = usePlayer();
  const location = useLocation();
  /* Priced as the server will charge (withCardEconomy): a price an admin has tuned is the one the machine shows. */
  const faces = useMemo(() => facesOf(instance.cards, ui.cards, withCardEconomy(instance.settings, settings.cardEconomy)), [instance, ui.cards, settings.cardEconomy]);
  /*
   * What the screen holds (the pick, the answer in words, the drain, the card in flight, the press
   * in progress) is kept with the account it was made for and read in render against the account
   * signed in now, as player.tsx keeps its rows: another account's pick and answer read as nothing
   * in the very commit the account changes, so a held answer for the last player is never worded
   * under the next one's wallet.
   */
  const account = player.session.account;
  const [kept, setKept] = useState<Kept>(() => emptyFor(null));
  const empty = useMemo(() => emptyFor(account), [account]);
  const mine = kept.for === account ? kept : empty;
  const { pickedKey, busy, outcome, drainFrom, drop } = mine;
  /*
   * The account the screen is on now: an answer for another one is dropped, and a change is that account's own. The render-time
   * keying above already hides a stale answer; this keeps it from also replacing what the account signed in now has picked
   * (a test holds A's answer past B's pick), so it is the write's own guard and not only defense in depth.
   */
  const showing = useRef<Id | null>(null);
  showing.current = account;
  const change = (for_: Id | null, patch: (m: Kept) => Partial<Kept>) => {
    if (showing.current !== for_) return;
    setKept((k) => { const m = k.for === for_ ? k : emptyFor(for_); return { ...m, ...patch(m) }; });
  };
  /* Two presses in one tick both see `busy` false, so the guard is a ref too: the accounts with a purchase out. */
  const pressed = useRef(new Set<Id>());
  /* The card whose rules are open, and the info button that opened them: it is where focus returns. */
  const [about, setAbout] = useState<string | null>(null);
  const aboutButton = useRef<HTMLElement | null>(null);

  const wallet = player.wallet;
  const balance = wallet?.balance ?? 0;
  const cap = wallet?.cap ?? 0;
  const heldNow = player.cards.reduce((n, c) => n + c.held, 0);
  /* On their way, the cards have not reached the hand: the count moves when they land. */
  const held = heldNow - (drop?.flying ?? 0);
  const picked = faces.find((f) => f.key === pickedKey) ?? null;
  const aboutFace = faces.find((f) => f.key === about) ?? null;
  const short = picked !== null && balance < picked.price;
  const shortWords = picked ? `${picked.name} costs ${orbs(picked.price)} and your wallet holds ${orbs(balance)}. Only solid Aura can be spent; the ghost estimate cannot.` : '';
  const after = picked && !short ? balance - picked.price : null;

  /* The drain, once played, is forgotten, so a later change of the wallet starts from where it stands. */
  useEffect(() => {
    if (drainFrom === null) return;
    const t = setTimeout(() => change(account, () => ({ drainFrom: null })), cascade(drainFrom, balance, cap).length * CASCADE_BEAT_MS + 600);
    return () => clearTimeout(t);
  }, [drainFrom, balance, cap, account]);

  /* A card that never reports landing (a browser without animation events) still reaches the hand. */
  useEffect(() => {
    if (drop === null) return;
    const t = setTimeout(() => change(account, () => ({ drop: null })), DELIVERY_MS + 400);
    return () => clearTimeout(t);
  }, [drop, account]);

  async function buy() {
    if (!picked || !account || busy || pressed.current.has(account)) return;
    if (balance < picked.price) {
      change(account, () => ({ outcome: { tone: 'refusal', text: shortWords } }));
      return;
    }
    pressed.current.add(account);
    change(account, () => ({ busy: true, outcome: null }));
    const before = balance;
    const bought = await player.buyCard(picked.key);
    pressed.current.delete(account);
    /* The answer is the account's that pressed: for anyone signed in now it is not shown. */
    if (!bought.ok) {
      change(account, () => ({ busy: false, outcome: { tone: 'refusal', text: plainRefusal(bought.error) } }));
      return;
    }
    const text = `${picked.name} is in your hand. ${orbs(bought.value.balance)} is left, solid.`;
    change(account, (m) => ({
      busy: false,
      outcome: { tone: 'done', text },
      ...(motionReduced() ? {} : { drainFrom: before, drop: { key: picked.key, n: (m.drop?.n ?? 0) + 1, flying: (m.drop?.flying ?? 0) + 1 } }),
    }));
  }

  if (!player.sessionKnown || (player.session.signedIn && !player.loaded)) return <div className="kb-vending" aria-busy="true" />;
  if (!player.session.signedIn) {
    return (
      <div className="kb-vending">
        <p className="kb-vending-signin kb-calm">
          The Vending Machine is for players. <Link to={signInHref(location.path, searchOf(location.query))}>Sign in</Link> to spend your Aura here.
        </p>
      </div>
    );
  }

  const handLink = backHref(boardPlace());
  const walletName = after !== null && picked
    ? `Wallet: ${orbs(balance)} of ${orbs(cap)}; buying ${picked.name} leaves ${orbs(after)}`
    : `Wallet: ${orbs(balance)} of ${orbs(cap)}`;

  return (
    <div className="kb-vending">
      <aside className="kb-vending-side">
        <div className="kb-vending-head kb-calm">
          <p className="kb-vending-eyebrow">Spend Aura</p>
          <h1 className="kb-vending-title kb-glass-display">Vending Machine</h1>
        </div>
        <section className="kb-vending-wallet kb-glass-cut-panel" aria-label="Your wallet">
          <div className="kb-vending-wallet-in">
            <p className="kb-vending-label kb-calm">Wallet · solid only</p>
            <div className="kb-vending-orbs">
              <Orbs settled={balance} pending={after !== null && picked ? -picked.price : 0} cap={cap} cascadeFrom={drainFrom} figures={false} label={walletName} />
            </div>
            <p className="kb-vending-sum kb-num kb-calm">
              {orbs(balance)}{after !== null ? <> → <b>{orbs(after)}</b></> : null}
            </p>
            {short && !outcome && <p className="kb-vending-fine kb-calm">{shortWords}</p>}
            {outcome && (outcome.tone === 'refusal'
              ? <p className="kb-vending-fine kb-vending-outcome kb-calm" role="alert" data-kb-tone="refusal">{outcome.text}</p>
              : <p className="kb-vending-fine kb-vending-outcome kb-calm" aria-live="polite" data-kb-tone="done">{outcome.text}</p>)}
            <p className="kb-vending-fine kb-calm">The ghost estimate can't be spent. What you buy is private: nobody else sees it until you play it.</p>
          </div>
        </section>
        <Link to={handLink} className="kb-vending-hand kb-glass-skew">
          <span className="kb-vending-hand-word kb-glass-upright">Your hand</span>{' '}
          <span className="kb-vending-hand-count kb-glass-upright kb-num">{picked && !short ? `${held} → ${held + 1}` : held}</span>
        </Link>
      </aside>

      <Machine
        faces={faces} picked={picked} busy={busy} drop={drop} shopName={ui.copy.shopName}
        onPick={(key) => change(account, () => ({ pickedKey: key, outcome: null }))}
        onAbout={(key, button) => { aboutButton.current = button; setAbout(key); }}
        onBuy={() => void buy()}
        onLanded={() => change(account, () => ({ drop: null }))}
      />

      {aboutFace && (
        <Overlay title={aboutFace.name} surface="vending" className="kb-vending-about-dialog" onClose={() => setAbout(null)} returnFocusTo={() => aboutButton.current}>
          <div className="kb-vending-about-body kb-calm" data-kb-alignment={aboutFace.alignment}>
            <p className="kb-vending-about-price kb-num">{priceOf(aboutFace)}</p>
            <p className="kb-vending-about-says">{aboutFace.describe}</p>
          </div>
        </Overlay>
      )}

      {faces.length < slotsFor(faces.length) && (
        <div className="kb-vending-list kb-vending-item kb-vending-item--sealed kb-calm">
          <p className="kb-vending-item-row"><span className="kb-vending-item-name">{slotsFor(faces.length) - faces.length} {slotsFor(faces.length) - faces.length === 1 ? 'slot' : 'slots'} empty</span></p>
          <p className="kb-vending-item-says">More postcards arrive in later seasons.</p>
        </div>
      )}
    </div>
  );
}
