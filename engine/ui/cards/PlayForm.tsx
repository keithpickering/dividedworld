/**
 * The play form, a glass overlay (engine/ui/glass/Overlay.tsx) on the `play` smoke, as the Cards
 * board draws it (docs/research/2026-10-29-two-worlds/05-cards.html): the card's name, the post it
 * will land on, the card's own settings (`CardUi.ConfigForm`: Whoops!'s ink), the caster's message
 * (plain text, at most 200 characters, counted as it is typed), what playing costs, the wallet after,
 * and Play as the HUD's character. It is out of character: plain and honest.
 *
 * The price is the rules' (`playPrice`, through `decidePlay`) for the post as it stands, so the
 * surcharge shown is the one the server charges: the post is read again when the form opens and
 * follows its edits live, never the copy the click captured. The server decides again, and a play it
 * refuses comes back in its words, said plainly in the form; the post's plays are then read again, so
 * a play that landed first (a fourth Whoops!) stops this one being offered, here and on the post. A card is paid for at the Vending Machine, so
 * what is paid now is only what the post adds (Whoops!'s long-post surcharge), and the form says the
 * card itself is already paid. Only solid Aura is spent: a wallet that cannot pay is said here,
 * before the server is asked, and the play waits.
 *
 * On a post by another of the player's own characters it says so: the play is the same and costs
 * the same, and the log will say both were theirs. Cancel, Close, Esc, the link to the post and the
 * play are its ways out; leaving changes nothing, and an armed card stays armed so another post can
 * be picked. An answer that comes back after the account changed is dropped: it is the other
 * account's, and this screen is not.
 *
 * A play is not sent twice. An answer that never came back may have gone through, so the form reads
 * the wallet, the hand and the post again, and only if the play is still not on the post does it
 * offer to play again, in so many words ("Play again anyway").
 */
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { casterMessage, MESSAGE_MOST } from '../../rules/cards.ts';
import { useKayfa } from '../context.tsx';
import type { Act, Id } from '../data/api.ts';
import { Overlay } from '../glass/Overlay.tsx';
import { Orbs } from '../orbs/Orbs.tsx';
import { usePlayer } from '../player.tsx';
import { Link } from '../router.tsx';
import { newer } from '../thread/feed.ts';
import { faceOf, orbs, plainRefusal, withCardEconomy } from './faces.ts';
import { landing, lengthOf, targetOf } from './land.ts';
import { effectCards, PLAYS_PER_POST, readEffects, usePlays } from './plays.ts';
import type { PlayTarget } from './play.tsx';
import './play.css';

export interface PlayFormProps {
  /** The card's key. */
  readonly card: string;
  readonly target: PlayTarget;
  readonly onClose: () => void;
  /** The play is on the post. */
  readonly onPlayed: () => void;
}

/** Where the message's counter starts to speak: its last stretch before the limit. */
const MESSAGE_NEAR = MESSAGE_MOST - 20;

export function PlayForm({ card, target, onClose, onPlayed }: PlayFormProps) {
  const { api, instance, settings: screen, ui } = useKayfa();
  /* Priced as the server will charge (withCardEconomy): a surcharge an admin has tuned is the one shown. */
  const priced = useMemo(() => withCardEconomy(instance.settings, screen.cardEconomy), [instance.settings, screen.cardEconomy]);
  const player = usePlayer();
  const id = useId();
  const [config, setConfig] = useState<Readonly<Record<string, unknown>> | undefined>(undefined);
  const [message, setMessage] = useState('');
  /** What the counter last said aloud: only on crossing into its last stretch, or on reaching the limit (#89 P2-2). */
  const [countSaid, setCountSaid] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [again, setAgain] = useState(false);
  const account = player.session.account;
  /*
   * The account the screen is on now, read after every wait: an answer for another one is dropped. These checks are defense in
   * depth behind PlayProvider (play.tsx), which reads the form as nothing in the very commit an account changes and unmounts it,
   * so a form never renders under another account and this ref is never updated to one. No test can tell them from that
   * (an unmounted form's ref still holds its own account), and they are kept for a form ever hosted where the provider's keying
   * is not: there they would be the only guard. The provider's `onPlayed` carries its own check, which is the pinned one.
   */
  const accountNow = useRef(account);
  accountNow.current = account;
  /* The post as it stands: its edits change its length and so its price, and the click's copy is only where it starts. */
  const [live, setLive] = useState(target.post);
  const post = live.id === target.post.id ? live : target.post;
  useEffect(() => {
    let open = true;
    const take = (a: Act) => { if (open && a.id === target.post.id && a.kind === 'post') setLive((held) => newer(held, a)); };
    try { void api.actsById([target.post.id]).then((read) => { for (const a of read) take(a); }, () => { /* the live edits still arrive */ }); } catch { /* ditto */ }
    const stop = api.subscribeThread(target.post.thread, { onAct: take });
    return () => { open = false; stop(); };
  }, [api, target.post.id, target.post.thread]);

  const rules = instance.cards.find((c) => c.key === card);
  const cardUi = ui.cards.find((c) => c.key === card);
  const face = useMemo(() => (rules ? faceOf(rules, cardUi, priced) : null), [rules, cardUi, priced]);
  const hud = player.hudCharacter;
  const wallet = player.wallet;

  /* Read on every render: a play landing on the post meanwhile (live) changes what it can take. */
  const carried = usePlays(target.plays, post.id).plays;
  const lands = rules ? landing(rules, post, carried) : { ok: false as const, why: 'there is no such card' };
  const price = useMemo(() => {
    if (!rules) return 0;
    try {
      const checked = rules.validateConfig(config);
      return rules.playPrice(priced, targetOf(post), checked.ok ? checked.value : config ?? {});
    } catch {
      return 0;
    }
  }, [rules, priced, post, config]);

  if (!rules || !face) return null;
  const length = lengthOf(post);
  const ownBoth = hud !== null && post.character !== null && post.character !== hud.id && player.actingCharacters.some((c) => c.id === post.character);
  const after = wallet ? wallet.balance - price : null;
  const short = wallet !== null && after !== null && after < 0;
  const shortWords = short && wallet ? plainRefusal(`that costs ${price}, and your wallet holds ${wallet.balance}`) : '';
  const blocked = busy || !hud || !wallet || short || !lands.ok;

  const change = (value: string) => {
    const typed = [...value];
    const was = [...message].length;
    const now = Math.min(typed.length, MESSAGE_MOST);
    setMessage(typed.slice(0, MESSAGE_MOST).join(''));
    /* Said politely and seldom: never on every key, only as the message nears its limit, reaches it, or loses what ran past it. */
    if (typed.length > MESSAGE_MOST) setCountSaid(`${MESSAGE_MOST} of ${MESSAGE_MOST} characters: the message is full, and the rest was not kept.`);
    else if (now === MESSAGE_MOST && was < MESSAGE_MOST) setCountSaid(`${MESSAGE_MOST} of ${MESSAGE_MOST} characters: the message is full.`);
    else if (now >= MESSAGE_NEAR && was < MESSAGE_NEAR) setCountSaid(`${MESSAGE_MOST - now} characters left.`);
    else if (now < MESSAGE_NEAR) setCountSaid('');
    if (again) { setAgain(false); setRefusal(null); }
  };
  const settle = (words: string | null) => (words === null ? null : plainRefusal(words));

  const landed = async (act: Act) => {
    /* The caster is named before the tag is drawn: a player's character may never have posted in this thread. */
    await target.know([act.character]);
    if (accountNow.current !== account) return;
    target.plays.add([act]);
    await player.refresh();
    if (accountNow.current !== account) return;
    onPlayed();
  };
  /* No answer came back: read what the play would have changed before offering it again. */
  const read = async () => {
    const [, acts] = await Promise.all([player.refresh(), api.cardsOn(post.id, PLAYS_PER_POST)]);
    await target.know(acts.map((a) => a.character));
    target.plays.add(acts);
    await readEffects(api, target.plays, acts, effectCards(ui));
  };
  const look = async (words: string | null, before: ReadonlySet<Id>, character: Id) => {
    let looked = true;
    try { await read(); } catch { looked = false; }
    if (accountNow.current !== account) return;
    const found = target.plays.get(post.id).plays.find((p) => !before.has(p.id) && p.card === card && p.caster === character);
    if (found) { onPlayed(); return; }
    setAgain(true);
    setRefusal(`${words === null ? 'No answer came back.' : plainRefusal(words)} ${looked ? 'Your play is not on the post yet.' : 'The post could not be checked for it.'} Press “Play again anyway” to play it again.`);
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (blocked || !hud) return;
    const said = casterMessage(message);
    if (!said.ok) { setRefusal(plainRefusal(said.why)); return; }
    const before = new Set(carried.map((p) => p.id));
    setBusy(true);
    setRefusal(null);
    try {
      let answer;
      try { answer = await api.playCard(card, hud.id, post.id, config ?? {}, message); } catch { await look(null, before, hud.id); return; }
      if (accountNow.current !== account) return;
      if (answer.ok) await landed(answer.value);
      else if (answer.uncertain) await look(answer.error, before, hud.id);
      else {
        setRefusal(settle(answer.error));
        /* The post may have changed under the play (a fourth Whoops! landed first): read its plays again so this form and the post stop offering it. */
        try { await read(); } catch { /* the refusal stands; the next read is the live one */ }
      }
    } finally {
      setBusy(false);
    }
  };

  const Config = cardUi?.ConfigForm;
  const surcharge = cardUi?.surcharge?.(priced) ?? 'This post';
  const hint = `${id}-hint`;

  return (
    <Overlay
      title={face.name}
      kicker={<span className="kb-calm">Play a card</span>}
      surface="play"
      className="kb-play-dialog"
      onClose={onClose}
      returnFocusTo={() => document.getElementById(`post-${post.seq}`)}
    >
      <form className="kb-play" data-kb-alignment={face.alignment} style={{ '--kb-card-color': face.art.color } as React.CSSProperties} onSubmit={(e) => void submit(e)} noValidate>
        <div className="kb-play-fields">
          <p className="kb-play-target kb-calm">
            On <Link to={target.to} onClick={onClose}>{target.author}'s post #{post.seq}</Link> in “{target.title}”, {length} {length === 1 ? 'character' : 'characters'} long.
          </p>
          {ownBoth && <p className="kb-play-both kb-calm">You play both. It costs the same; your log will say so.</p>}
          {Config && <div className="kb-calm"><Config config={config} onChange={setConfig} post={post} id={id} /></div>}
          <div className="kb-play-message">
            <label htmlFor={`${id}-message`} className="kb-play-label kb-calm">Your message</label>
            <textarea id={`${id}-message`} className="kb-play-input" rows={3} value={message} aria-describedby={hint} onChange={(e) => change(e.target.value)} />
            <div className="kb-play-count kb-calm">
              <span id={hint}>Shown on the card's Act. Plain text.</span>
              {/* In the face's own figures, as the board draws it: tabular ones are wider, and the board match refuses the difference. */}
              <span>{`${[...message].length} / ${MESSAGE_MOST}`}</span>
              <span className="kb-visually-hidden" aria-live="polite" data-kb-count-said>{countSaid}</span>
            </div>
          </div>
          <div className="kb-play-sum">
            <dl className="kb-play-cost kb-calm">
              <div><dt>Card</dt><dd>Paid</dd></div>
              <div><dt>{surcharge}</dt><dd className="kb-num">{orbs(price)}</dd></div>
              <div className="kb-play-total"><dt>To pay now</dt><dd className="kb-num">{orbs(price)}</dd></div>
            </dl>
            {wallet && after !== null && (
              <div className="kb-play-wallet">
                <Orbs settled={wallet.balance} pending={-price} cap={wallet.cap} figures={false} label={`Wallet after playing: ${orbs(Math.max(0, after))} of ${orbs(wallet.cap)}`} />
                <span className="kb-play-wallet-sum kb-num kb-calm">{orbs(wallet.balance)} → <b>{orbs(Math.max(0, after))}</b> solid</span>
              </div>
            )}
            <p className="kb-play-fine kb-calm" role="status" aria-label="Cost">{shortWords || (!lands.ok ? plainRefusal(lands.why) : '')}</p>
          </div>
          <p className="kb-play-fine kb-calm">
            Playing is a public Act{hud ? ` under ${hud.name}'s name` : ''}. Only solid Aura is spent; the ghost doesn't count.
          </p>
        </div>
        {refusal && <p role="alert" className="kb-notice" data-kb-tone="refusal">{refusal}</p>}
        <div className="kb-play-foot">
          <button type="submit" className="kb-play-go kb-glass-skew" disabled={blocked}>
            <span className="kb-glass-upright">{again ? 'Play again anyway' : hud ? `Play as ${hud.name}` : 'Play'}</span>
          </button>
          <button type="button" className="kb-play-cancel kb-glass-skew" onClick={onClose}><span className="kb-glass-upright">Cancel</span></button>
        </div>
      </form>
    </Overlay>
  );
}
