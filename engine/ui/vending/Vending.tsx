/**
 * The Vending Machine, as the Vending board draws it (docs/research/2026-10-29-two-worlds/07-vending.html;
 * the cards plan's Task 2): a glass page under the menu bar, with the wallet and the hand on its
 * left, the drawn machine in the middle and the line about the empty slots on its right. Each slot
 * is a button that selects a card ("Buy Stick Around, 1.00 orb, common Cast": its rarity and play after its price; the selected one adds ", selected"),
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
 * given, "Buy Stick Around, 1.00 orb, common Cast", contains it), and the instance's stylesheet
 * (instances/divided-world/ui/vending/vending.css) gives them their colors, their words and their glow. What
 * a player reads and presses is real text in the glass's tokens, so a card, a price and a refusal
 * are said once, in words.
 *
 * What is bought is private: nothing here is sent to anyone, and a lost answer is read again from
 * the wallet and the hand rather than guessed at (player.tsx's buyCard).
 *
 * The slots are the machine's as the server shows them now (`api.machine`, in its order): a card on sale, a pack on sale (drawn as the foil
 * pack the instance gives it, with what is in it and its odds beside the machine when it is selected), a slot that is sold out (greyed, saying
 * why: an admin's choice, or the Boss's Pull in its plain words), and a place with nothing in it, sealed. A hidden slot is not listed. A price the
 * Boss moved shows the admin's price struck through beside the new one, and each move in force is said in plain words beside the machine
 * (machine-words.ts): the glass never speaks as the Boss. Buying a pack opens the reveal (PackOpening.tsx): the cards are in the hand from the
 * purchase, and the reveal only shows them. While the first look has not answered the machine says nothing of what is on it; a machine that cannot be
 * read says so plainly and offers to try again.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { PackRules } from '../../rules/packs.ts';
import { motionReduced } from '../appearance.ts';
import { Postcard, PostcardBack } from '../cards/Postcard.tsx';
import { facesOf, orbs, plainRefusal, playWord, priceOf, withCardEconomy, type CardFace } from '../cards/faces.ts';
import { useMachine } from '../cards/machine.ts';
import type { CardArt } from '../cards/types.ts';
import { signInHref } from '../account/next.ts';
import { useKayfa } from '../context.tsx';
import type { BoardName, Id, Slot } from '../data/api.ts';
import { backHref, boardPlace } from '../glass/back.ts';
import { GlassButton } from '../glass/Button.tsx';
import { Overlay } from '../glass/Overlay.tsx';
import { Orbs } from '../orbs/Orbs.tsx';
import { cascade, CASCADE_BEAT_MS } from '../orbs/fill.ts';
import { usePlayer } from '../player.tsx';
import { Link, searchOf, useLocation } from '../router.tsx';
import './vending.css';
import { CalmRegion } from '../glass/Calm.tsx';
import { Layers } from '../glass/layer.tsx';
import { PackArt } from './PackArt.tsx';
import { PackOdds } from './PackOdds.tsx';
import { PackOpening } from './PackOpening.tsx';
import { oddsGroups, packCards, packLine, moveWords, priceNote, soldWhy, unsoldOnTheirOwn } from './machine-words.ts';

/* The refusal's words are the cards' (the play form says them too); the Vending Machine's tests and callers still reach them here. */
export { plainRefusal };

/** The slots the machine has: three rows of two, more when the machine holds more than that. */
const MIN_SLOTS = 6;

/** How many slots the machine has for this many items. */
const slotsFor = (items: number) => Math.max(MIN_SLOTS, Math.ceil(items / 2) * 2);

/** A slot's code on the machine's front: A1, A2, B1 ... two to a row. */
const codeOf = (i: number) => `${String.fromCharCode(65 + Math.floor(i / 2))}${(i % 2) + 1}`;

/** How long the card is in flight to the hand, ms: the drop and the flight together. */
const DELIVERY_MS = 1500;

/** "orb" for one orb exactly, "orbs" for any other amount: the slot's name says "1.00 orb". */
const orbWord = (hundredths: number) => (hundredths === 100 ? 'orb' : 'orbs');

/** What the instance gives a pack to draw itself with (`InstanceUi.packs`). */
interface PackLook { readonly name: string; readonly art?: CardArt }

/** One slot of the machine as the screen draws it: a card or a pack, on sale or sold out, with the price it shows now. */
interface Item {
  readonly slot: Slot;
  readonly code: string;
  readonly name: string;
  /** The price the slot shows now, in hundredths. */
  readonly price: number;
  /** The admin's price, where a Boss move has changed it: it is shown struck through beside the new one. */
  readonly was: number | null;
  readonly face: CardFace | null;
  readonly pack: PackRules | null;
  readonly look: PackLook | null;
  readonly sold: boolean;
  readonly color: string;
  readonly ink: string;
}

/** What a button says of what the slot sells, after its price: "common Cast", "a pack of 5 postcards". */
const whatOf = (it: Item) => (it.pack ? `a pack of ${it.pack.pulls.length} postcards` : `${it.face!.rarity} ${playWord(it.face!.play)}`);

/** The slot's accessible name: what it sells, its price, and (where the Boss changed it) how; a sold out slot says why instead. */
function nameOf(it: Item, selected: boolean): string {
  if (it.sold) {
    const why = soldWhy(it.slot.move);
    return `${it.name}, sold out${why === 'sold out' ? '' : `: ${why}`}`;
  }
  return `Buy ${it.name}, ${orbs(it.price)} ${orbWord(it.price)}${priceNote(it.slot.move, it.price)}, ${whatOf(it)}${selected ? ', selected' : ''}`;
}

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

/** A pack that has been bought and is being turned over: the slot it came from and what the purchase's answer said it held, in pull order. */
interface Opening {
  readonly slot: Id;
  readonly name: string;
  readonly art: CardArt | undefined;
  readonly cards: readonly string[];
  readonly note: string | null;
}

/** What the screen holds, with the account it was held for. */
interface Kept {
  readonly for: Id | null;
  readonly pickedId: Id | null;
  readonly busy: boolean;
  readonly outcome: Outcome | null;
  /* The wallet the drain starts from, until it has played. */
  readonly drainFrom: number | null;
  readonly drop: Drop | null;
  readonly opening: Opening | null;
}

/** Nothing held yet for `account`. */
const emptyFor = (account: Id | null): Kept => ({ for: account, pickedId: null, busy: false, outcome: null, drainFrom: null, drop: null, opening: null });

/** One of `list` by `random` (0 up to, never including, 1); with no list, `fallback`. */
export function pick(list: readonly string[] | undefined, fallback: string, random: () => number): string {
  if (list === undefined || list.length === 0) return fallback;
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))]!;
}

/** The art of a slot's item: a card's face at the slot's size, or the pack's foil. */
function SlotArt({ it }: { readonly it: Item }) {
  if (it.face) return <Postcard face={it.face} size="slot" />;
  return <PackArt name={it.name} count={it.pack!.pulls.length} {...(it.look?.art ? { art: it.look.art } : {})} />;
}

/** "In this pack": five small backs, the last one the hit's gold, and what opening does. */
function InPack({ pack, count, line, mark }: { readonly pack: PackRules; readonly count: number; readonly line: string; readonly mark: string | undefined }) {
  return (
    <section className="kb-vending-inpack" aria-label="In this pack">
      <p className="kb-vending-inpack-head" aria-hidden="true" data-kb-art />
      <div className="kb-vending-backs" aria-hidden="true" data-kb-key={pack.key}>
        {Array.from({ length: count }, (_, i) => <PostcardBack key={i} size="slot" hit={i === count - 1} {...(mark ? { mark } : {})} />)}
      </div>
      <p className="kb-vending-inpack-line">{line}</p>
    </section>
  );
}

function Machine({ items, status, picked, onPick, onAbout, onBuy, busy, drop, onLanded, shopName, marquees, random, retry, slotRef, inPack }: {
  readonly items: readonly Item[];
  readonly status: 'loading' | 'ready' | 'failed';
  readonly picked: Item | null;
  readonly onPick: (id: Id) => void;
  readonly onAbout: (id: Id, button: HTMLElement) => void;
  readonly onBuy: () => void;
  readonly busy: boolean;
  readonly drop: Drop | null;
  readonly onLanded: () => void;
  readonly shopName: string;
  readonly marquees: readonly string[] | undefined;
  readonly random: () => number;
  readonly retry: () => void;
  readonly slotRef: (id: Id, el: HTMLButtonElement | null) => void;
  readonly inPack: React.ReactNode;
}) {
  /* The sign is decoration: one name, picked when the screen opens and kept while it is open. */
  const [sign] = useState(() => pick(marquees, shopName, random));
  const total = slotsFor(items.length);
  const dropped = drop ? items.find((it) => it.face?.key === drop.key) : undefined;
  const pickedWords = picked ? `Selected: ${picked.code}, ${picked.name}, ${orbs(picked.price)}` : 'Nothing selected';
  return (
    <div className="kb-vending-machine" role="group" aria-label={shopName}>
      <div className="kb-vending-body" aria-hidden="true" data-kb-art />
      <div className="kb-vending-marquee" aria-hidden="true" data-kb-art><span className="kb-vending-sign" style={{ '--kb-sign-chars': sign.length } as CSSProperties}>{sign}</span></div>

      <div className="kb-vending-front">
        <div className="kb-vending-sheen" aria-hidden="true" data-kb-art />
        {status === 'failed' ? (
          <div className="kb-vending-unread">
            <p>The machine can&apos;t be read right now.</p>
            <GlassButton size="s" onClick={retry}>Try again</GlassButton>
          </div>
        ) : (
          <div className="kb-vending-slots" aria-busy={status === 'loading' ? 'true' : undefined}>
            {status === 'loading'
              ? Array.from({ length: MIN_SLOTS }, (_, i) => <div key={i} className="kb-vending-cell kb-vending-cell--waiting" aria-hidden="true" />)
              : Array.from({ length: total }, (_, i) => {
                const it = items[i];
                const code = codeOf(i);
                if (!it) {
                  return (
                    <div key={code} className="kb-vending-cell">
                      <div className="kb-vending-slot kb-vending-slot--sealed" role="img" aria-label={`Empty slot ${code}, waiting for a future postcard`}>
                        <span className="kb-vending-sealed" aria-hidden="true" data-kb-art />
                      </div>
                      <div className="kb-vending-shelf" aria-hidden="true" data-kb-art>
                        <span className="kb-vending-slot-code" data-code={code} />
                      </div>
                    </div>
                  );
                }
                const selected = picked?.slot.id === it.slot.id;
                const struck = it.was !== null && it.was !== it.price;
                const why = soldWhy(it.slot.move);
                return (
                  <div key={it.slot.id} className="kb-vending-cell" data-kb-sold={it.sold ? '' : undefined} data-kb-pack={it.pack ? '' : undefined} style={{ '--kb-card-color': it.color, '--kb-card-ink': it.ink } as CSSProperties}>
                    <button
                      ref={(el) => slotRef(it.slot.id, el)}
                      type="button"
                      className="kb-vending-slot"
                      aria-label={nameOf(it, selected)}
                      {...(it.sold ? { 'aria-disabled': true } : { 'aria-pressed': selected })}
                      data-kb-alignment={it.face?.alignment}
                      onClick={() => { if (!it.sold) onPick(it.slot.id); }}
                    >
                      <SlotArt it={it} />
                      {it.sold && <span className="kb-vending-stripe" aria-hidden="true" data-kb-art data-kb-stripe={why === 'sold out' ? 'Sold out' : 'Pulled'} />}
                    </button>
                    <div className="kb-vending-shelf">
                      {/* A sold out slot's chip says so and nothing else: the code and "sold out" together would not leave the info control its place on the shelf, and a wrapped shelf makes every row taller. */}
                      <span className="kb-vending-slot-code" aria-hidden="true" data-kb-art data-code={it.sold ? 'Sold out' : struck ? `${code} · ` : `${code} · ${orbs(it.price)}`}>
                        {struck && !it.sold && <><s>{orbs(it.was!)}</s> {orbs(it.price)}</>}
                      </span>
                      <GlassButton
                        size="s"
                        className="kb-vending-about"
                        aria-label={`About ${it.name}`}
                        onClick={(e) => onAbout(it.slot.id, e.currentTarget)}
                      >
                        <span aria-hidden="true" data-kb-art>i</span>
                      </GlassButton>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      <div className="kb-vending-panel">
        <div className="kb-vending-lcd" role="status" aria-label={pickedWords}>
          <span className="kb-visually-hidden">{pickedWords}</span>
          <span className="kb-vending-lcd-name" aria-hidden="true" data-kb-art>{picked ? `${picked.code} · ${picked.name}` : 'Pick a slot'}</span>
          <span className="kb-vending-lcd-price kb-num" aria-hidden="true" data-kb-art>{picked ? orbs(picked.price) : '0.00'}</span>
        </div>
        {inPack ?? <div className="kb-vending-aura-in" aria-hidden="true" data-kb-art><span className="kb-vending-aura-slot" /><span className="kb-vending-aura-label" /></div>}
        <button type="button" className="kb-vending-buy" disabled={!picked || busy} onClick={onBuy}>
          <span className="kb-vending-buy-word">Buy</span>{' '}
          {picked && <span className="kb-vending-buy-card">{picked.name} · {orbs(picked.price)}</span>}
        </button>
      </div>

      <div className="kb-vending-tray">
        <span className="kb-vending-tray-label" aria-hidden="true" data-kb-art />
        {dropped && drop && dropped.face && (
          <span key={drop.n} className="kb-vending-drop" aria-hidden="true" onAnimationEnd={onLanded}>
            <Postcard face={dropped.face} size="slot" />
          </span>
        )}
        <span className="kb-vending-tray-to" aria-hidden="true" data-kb-art />
        {picked && <span className="kb-visually-hidden">Push {picked.name} to your hand</span>}
      </div>
    </div>
  );
}

export function Vending() {
  const { api, instance, settings, ui, random } = useKayfa();
  const player = usePlayer();
  const location = useLocation();
  /*
   * What the machine sells is its slots as the server shows them now (api.machine), in the grid's order, at the price each has, so a price an admin
   * has tuned is the one shown and a Boss's move is already in the slot's availability and price. A hidden slot is not in the machine.
   */
  const { slots, status, look } = useMachine();
  const cardFaces = useMemo(() => facesOf(instance.cards, ui.cards, withCardEconomy(instance.settings, settings.cardEconomy)), [instance, ui.cards, settings.cardEconomy]);
  const items = useMemo(() => (slots ?? []).flatMap((slot): Omit<Item, 'code'>[] => {
    const sold = slot.availability === 'soldOut';
    const was = slot.move?.kind === 'repriceSlot' ? slot.move.was : null;
    if ('card' in slot.item) {
      const key = slot.item.card;
      const face = cardFaces.find((f) => f.key === key);
      return face ? [{ slot, name: face.name, price: slot.price, was, face, pack: null, look: null, sold, color: face.art.color, ink: face.art.ink }] : [];
    }
    const key = slot.item.pack;
    const pack = instance.packs.find((p) => p.key === key);
    if (!pack) return [];
    const look = ui.packs?.[key] ?? null;
    return [{ slot, name: look?.name ?? key, price: slot.price, was, face: null, pack, look, sold, color: look?.art.color ?? 'var(--kb-glass-ready)', ink: look?.art.ink ?? 'var(--kb-glass-ink-ready)' }];
  }).map((it, i): Item => ({ ...it, code: codeOf(i) })), [slots, cardFaces, instance.packs, ui.packs]);
  /*
   * What the screen holds (the pick, the answer in words, the drain, the card in flight, the pack being opened, the press
   * in progress) is kept with the account it was made for and read in render against the account
   * signed in now, as player.tsx keeps its rows: another account's pick and answer read as nothing
   * in the very commit the account changes, so a held answer for the last player is never worded
   * under the next one's wallet.
   */
  const account = player.session.account;
  const [kept, setKept] = useState<Kept>(() => emptyFor(null));
  const empty = useMemo(() => emptyFor(account), [account]);
  const mine = kept.for === account ? kept : empty;
  const { pickedId, busy, outcome, drainFrom, drop, opening } = mine;
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
  /* The slot whose info is open, and the info button that opened it: it is where focus returns. */
  const [about, setAbout] = useState<Id | null>(null);
  const aboutButton = useRef<HTMLElement | null>(null);
  /* Each slot's button, so focus can be given back to the slot a pack was bought from. */
  const slotButtons = useRef(new Map<Id, HTMLButtonElement>());
  const slotRef = (id: Id, el: HTMLButtonElement | null) => { if (el) slotButtons.current.set(id, el); else slotButtons.current.delete(id); };

  /* The names of the boards a move's demand is about, read once there is a demand to name one for. */
  const [boards, setBoards] = useState<readonly BoardName[]>([]);
  const wantsBoards = items.some((it) => it.slot.move?.demand != null);
  useEffect(() => {
    if (!wantsBoards) return;
    let live = true;
    void api.boardNames().then((b) => { if (live) setBoards(b); }, () => { /* The words then say "its board". */ });
    return () => { live = false; };
  }, [api, wantsBoards]);

  const wallet = player.wallet;
  const balance = wallet?.balance ?? 0;
  const cap = wallet?.cap ?? 0;
  const heldNow = player.cards.reduce((n, c) => n + c.held, 0);
  /* On their way, the cards have not reached the hand: the count moves when they land. */
  const held = heldNow - (drop?.flying ?? 0);
  const picked = items.find((it) => it.slot.id === pickedId && !it.sold) ?? null;
  const aboutItem = items.find((it) => it.slot.id === about) ?? null;
  const short = picked !== null && balance < picked.price;
  const shortWords = picked ? `${picked.name} costs ${orbs(picked.price)} and your wallet holds ${orbs(balance)}. Only solid Aura can be spent; the ghost estimate cannot.` : '';
  const after = picked && !short ? balance - picked.price : null;
  /* How many cards buying the picked slot puts in the hand. */
  const arrives = picked?.pack ? picked.pack.pulls.length : 1;

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
    const bought = picked.pack ? await player.buyPack(picked.slot) : await player.buyCard(picked.slot);
    pressed.current.delete(account);
    /* The answer is the account's that pressed: for anyone signed in now it is not shown. */
    if (!bought.ok) {
      change(account, () => ({ busy: false, outcome: { tone: 'refusal', text: plainRefusal(bought.error) } }));
      /* A price that moved, or a slot that sold out, is read again, so the machine shows what it is now. */
      void look();
      return;
    }
    if (picked.pack && 'contents' in bought.value) {
      const { contents, balance: left } = bought.value;
      const text = `${picked.name} opened: its ${contents.length} cards are in your hand. ${orbs(left)} is left, solid.`;
      /* The reveal returns focus to the slot it was bought from, so the slot has it as the reveal opens. */
      slotButtons.current.get(picked.slot.id)?.focus();
      /* A card the pack gave that the machine does not sell on its own: said once the hit is turned, plainly. */
      const hitKey = contents[contents.length - 1];
      const alone = (key: string) => slots?.some((s) => 'card' in s.item && s.item.card === key && s.availability === 'onSale') ?? false;
      const hit = hitKey === undefined ? undefined : cardFaces.find((f) => f.key === hitKey);
      const note = hit && !alone(hit.key) ? `${hit.name} isn't sold on its own; this is one of the ways to get it.` : null;
      change(account, () => ({
        busy: false, outcome: { tone: 'done', text }, opening: { slot: picked.slot.id, name: picked.name, art: picked.look?.art, cards: contents, note },
        ...(motionReduced() ? {} : { drainFrom: before }),
      }));
      return;
    }
    const left = 'balance' in bought.value ? bought.value.balance : balance;
    const text = `${picked.name} is in your hand. ${orbs(left)} is left, solid.`;
    change(account, (m) => ({
      busy: false,
      outcome: { tone: 'done', text },
      ...(motionReduced() ? {} : { drainFrom: before, drop: { key: picked.face!.key, n: (m.drop?.n ?? 0) + 1, flying: (m.drop?.flying ?? 0) + 1 } }),
    }));
  }

  if (!player.sessionKnown || (player.session.signedIn && !player.loaded)) return <div className="kb-vending" aria-busy="true" />;
  if (!player.session.signedIn) {
    return (
      <div className="kb-vending">
        <CalmRegion as="p" className="kb-vending-signin">
          The Vending Machine is for players. <Link to={signInHref(location.path, searchOf(location.query))}>Sign in</Link> to spend your Aura here.
        </CalmRegion>
      </div>
    );
  }

  const handLink = backHref(boardPlace());
  const walletName = after !== null && picked
    ? `Wallet: ${orbs(balance)} of ${orbs(cap)}; buying ${picked.name} leaves ${orbs(after)}`
    : `Wallet: ${orbs(balance)} of ${orbs(cap)}`;

  /* The pack picked: its odds beside the machine, and what is in it by the price. */
  const pack = picked?.pack ?? null;
  const packOf = (it: Item | null) => (it?.pack ? { odds: oddsGroups(it.pack, instance.cards), line: packLine(it.pack, instance.cards) } : null);
  const picks = packOf(picked);
  /* The cards a pack can give that the machine is not selling now: "Main Event isn't sold on its own." */
  const unsold = (p: PackRules) => unsoldOnTheirOwn(packCards(p, instance.cards).filter((k) => !slots?.some((s) => 'card' in s.item && s.item.card === k)).map((k) => cardFaces.find((f) => f.key === k)?.name ?? k));
  /* Every Boss move in force, in plain words, in the machine's order. */
  const moves = items.flatMap((it) => {
    const move = it.slot.move;
    if (!move) return [];
    const board = move.demand && typeof move.demand.params['board'] === 'string' ? boards.find((b) => b.id === move.demand!.params['board'])?.name ?? null : null;
    const key = it.face?.key;
    const carrier = key ? items.find((o) => o.pack && !o.sold && packCards(o.pack, instance.cards).includes(key)) : undefined;
    return [{ id: it.slot.id, ...moveWords(move, { name: it.name, price: it.price, board, inPacks: move.kind === 'pullSlot' && carrier !== undefined, packsWord: `${carrier?.name ?? 'packs'}s` }) }];
  });
  const emptied = status === 'ready' ? slotsFor(items.length) - items.length : 0;

  return (
    <div className="kb-vending-frame">
    <div className="kb-vending">
      <aside className="kb-vending-side">
        <CalmRegion className="kb-vending-head">
          <p className="kb-vending-eyebrow">Spend Aura</p>
          <h1 className="kb-vending-title kb-glass-display">Vending Machine</h1>
        </CalmRegion>
        <section className="kb-vending-wallet kb-glass-cut-panel" aria-label="Your wallet">
          <CalmRegion className="kb-vending-wallet-in">
            <p className="kb-vending-label">Wallet · solid only</p>
            <div className="kb-vending-orbs">
              <Orbs settled={balance} pending={after !== null && picked ? -picked.price : 0} cap={cap} cascadeFrom={drainFrom} figures={false} label={walletName} />
            </div>
            <p className="kb-vending-sum kb-num">
              {orbs(balance)}{after !== null ? <> → <b>{orbs(after)}</b></> : null}
            </p>
            <p className="kb-vending-fine">
              {!picked ? 'Pick a slot to see what it costs.' : picked.face && picked.face.extra > 0
                ? `Playing it on a long post costs up to ${orbs(picked.face.extra)} more, never more than ${orbs(picked.price + picked.face.extra)} in all.`
                : picked.pack ? 'Opening it costs nothing more.' : 'Playing it costs nothing more.'}
            </p>
            {short && !outcome && <p className="kb-vending-fine">{shortWords}</p>}
            {/*
              * Each on the page from the start and empty until it speaks, so a screen reader hears the outcome (WCAG 4.1.3; #89 P2-1): a
              * purchase made politely, a refusal at once.
              */}
            <p className="kb-vending-fine kb-vending-outcome" role="status" aria-live="polite" data-kb-tone="done">{outcome?.tone === 'refusal' ? '' : outcome?.text ?? ''}</p>
            <p className="kb-vending-fine kb-vending-outcome" role="alert" data-kb-tone="refusal">{outcome?.tone === 'refusal' ? outcome.text : ''}</p>
            <p className="kb-vending-fine">The ghost estimate can't be spent. What you buy is private: nobody else sees it until you play it.</p>
          </CalmRegion>
        </section>
        <Link to={handLink} className="kb-vending-hand kb-glass-skew">
          <span className="kb-vending-hand-word kb-glass-upright">Your hand</span>{' '}
          <span className="kb-vending-hand-count kb-glass-upright kb-num">{picked && !short ? `${held} → ${held + arrives}` : held}</span>
        </Link>
      </aside>

      <Machine
        items={items} status={status} picked={picked} busy={busy} drop={drop} shopName={ui.copy.shopName} marquees={ui.copy.marquees} random={random ?? Math.random}
        onPick={(id) => change(account, () => ({ pickedId: id, outcome: null }))}
        onAbout={(id, button) => { aboutButton.current = button; setAbout(id); }}
        onBuy={() => void buy()}
        onLanded={() => change(account, () => ({ drop: null }))}
        retry={() => void look()} slotRef={slotRef}
        inPack={pack && picks ? <InPack pack={pack} count={pack.pulls.length} line={picks.line} mark={ui.cardBack?.mark} /> : null}
      />

      {/* The column's words stand in one calm, as an aside's do (the smoke is taken away under them). */}
      <CalmRegion className="kb-vending-right">
        {pack && picked && picks && (
          <aside className="kb-vending-about-pack" aria-label={`About the ${picked.name}`}>
            <PackOdds name={picked.name} groups={picks.odds} />
            <p className="kb-vending-note">{unsold(pack) ? `${unsold(pack)} ` : ''}Within a rarity, every card is equally likely.</p>
          </aside>
        )}
        {moves.length > 0 && (
          <section className="kb-vending-moves" aria-labelledby="kb-vending-moves-head">
            <h2 id="kb-vending-moves-head" className="kb-vending-moves-head">The Boss&apos;s moves</h2>
            {moves.map((m) => <p key={m.id} className="kb-vending-move"><b>{m.lead}</b> {m.rest}</p>)}
          </section>
        )}
        {emptied > 0 && (
          <div className="kb-vending-empty-line">
            <p className="kb-vending-empty-line-row">{emptied} {emptied === 1 ? 'slot' : 'slots'} empty</p>
            <p className="kb-vending-empty-line-says">More postcards arrive in later seasons.</p>
          </div>
        )}
      </CalmRegion>

      <Layers>
      {aboutItem && (
        <Overlay title={aboutItem.name} surface="vending" className="kb-vending-about-dialog" onClose={() => setAbout(null)} returnFocusTo={() => aboutButton.current}>
          {aboutItem.face ? (
            <div className="kb-vending-about-body" data-kb-alignment={aboutItem.face.alignment}>
              <p className="kb-vending-about-price kb-num">{priceOf(aboutItem.price, aboutItem.face.extra)}</p>
              <p className="kb-vending-about-says">{aboutItem.face.describe}</p>
            </div>
          ) : aboutItem.pack ? (
            <div className="kb-vending-about-body">
              <p className="kb-vending-about-price kb-num">{orbs(aboutItem.price)}</p>
              <p className="kb-vending-about-says">{packLine(aboutItem.pack, instance.cards)}</p>
              <PackOdds name={aboutItem.name} groups={oddsGroups(aboutItem.pack, instance.cards)} />
              <p className="kb-vending-about-says">{unsold(aboutItem.pack) ? `${unsold(aboutItem.pack)} ` : ''}Within a rarity, every card is equally likely.</p>
            </div>
          ) : null}
        </Overlay>
      )}
      {opening && (
        <PackOpening
          name={opening.name} {...(opening.art ? { art: opening.art } : {})} note={opening.note}
          cards={opening.cards.flatMap((k) => cardFaces.filter((f) => f.key === k))}
          onClose={() => change(account, () => ({ opening: null }))}
          returnFocusTo={() => slotButtons.current.get(opening.slot) ?? null}
        />
      )}
      </Layers>
    </div>
    </div>
  );
}
