/**
 * The play form, a glass overlay (engine/ui/glass/Overlay.tsx) on the `play` smoke, as the Cards
 * board draws it (docs/research/2026-10-29-two-worlds/05-cards.html): the card's name, the post it
 * will land on, the card's own settings (`CardUi.ConfigForm`: Whoops!'s ink), the caster's message
 * (plain text, at most 200 characters, counted as it is typed), what playing costs, the wallet after,
 * and Play as the HUD's character. It is out of character: plain and honest.
 *
 * The price is the rules' (`playPrice`, through `decidePlay`) for the post as it stands, so the
 * surcharge shown is the one the server charges; the server decides again, and a play it refuses
 * comes back in its words, said plainly in the form. A card is paid for at the Vending Machine, so
 * what is paid now is only what the post adds (Whoops!'s long-post surcharge), and the form says the
 * card itself is already paid. Only solid Aura is spent: a wallet that cannot pay is said here,
 * before the server is asked, and the play waits.
 *
 * On a post by another of the player's own characters it says so: the play is the same and costs
 * the same, and the log will say both were theirs. Cancel, Close, Esc and the play are its ways out;
 * leaving changes nothing, and an armed card stays armed so another post can be picked.
 *
 * A play is not sent twice. An answer that never came back may have gone through, so the form reads
 * the wallet, the hand and the post again, and only if the play is still not on the post does it
 * offer to play again, in so many words ("Play again anyway").
 */
import { useId, useMemo, useState, type FormEvent } from 'react';
import { casterMessage, MESSAGE_MOST } from '../../rules/cards.ts';
import { useKayfa } from '../context.tsx';
import type { Act, Id } from '../data/api.ts';
import { Overlay } from '../glass/Overlay.tsx';
import { Orbs } from '../orbs/Orbs.tsx';
import { usePlayer } from '../player.tsx';
import { Link } from '../router.tsx';
import { faceOf, orbs, plainRefusal } from './faces.ts';
import { landing, lengthOf, targetOf } from './land.ts';
import { effectCards, PLAYS_PER_POST, readEffects } from './plays.ts';
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

export function PlayForm({ card, target, onClose, onPlayed }: PlayFormProps) {
  const { api, instance, ui } = useKayfa();
  const player = usePlayer();
  const id = useId();
  const [config, setConfig] = useState<Readonly<Record<string, unknown>> | undefined>(undefined);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [again, setAgain] = useState(false);
  const { post } = target;

  const rules = instance.cards.find((c) => c.key === card);
  const cardUi = ui.cards.find((c) => c.key === card);
  const face = useMemo(() => (rules ? faceOf(rules, cardUi, instance.settings) : null), [rules, cardUi, instance.settings]);
  const hud = player.hudCharacter;
  const wallet = player.wallet;

  /* Read on every render: a play landing on the post meanwhile (live) changes what it can take. */
  const carried = target.plays.get(post.id).plays;
  const lands = rules ? landing(rules, post, carried) : { ok: false as const, why: 'there is no such card' };
  const price = useMemo(() => {
    if (!rules) return 0;
    try {
      const checked = rules.validateConfig(config);
      return rules.playPrice(instance.settings, targetOf(post), checked.ok ? checked.value : config ?? {});
    } catch {
      return 0;
    }
  }, [rules, instance.settings, post, config]);

  if (!rules || !face) return null;
  const length = lengthOf(post);
  const ownBoth = hud !== null && post.character !== null && post.character !== hud.id && player.actingCharacters.some((c) => c.id === post.character);
  const after = wallet ? wallet.balance - price : null;
  const short = wallet !== null && after !== null && after < 0;
  const shortWords = short && wallet ? plainRefusal(`that costs ${price}, and your wallet holds ${wallet.balance}`) : '';
  const blocked = busy || !hud || !wallet || short || !lands.ok;

  const change = (value: string) => {
    setMessage([...value].slice(0, MESSAGE_MOST).join(''));
    if (again) { setAgain(false); setRefusal(null); }
  };
  const settle = (words: string | null) => (words === null ? null : plainRefusal(words));

  const landed = async (act: Act) => {
    /* The caster is named before the tag is drawn: a player's character may never have posted in this thread. */
    await target.know([act.character]);
    target.plays.add([act]);
    await player.refresh();
    onPlayed();
  };
  /* No answer came back: read what the play would have changed before offering it again. */
  const look = async (words: string | null, before: ReadonlySet<Id>, character: Id) => {
    let looked = true;
    try {
      const [, acts] = await Promise.all([player.refresh(), api.cardsOn(post.id, PLAYS_PER_POST)]);
      await target.know(acts.map((a) => a.character));
      target.plays.add(acts);
      await readEffects(api, target.plays, acts, effectCards(ui));
    } catch { looked = false; }
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
      if (answer.ok) await landed(answer.value);
      else if (answer.uncertain) await look(answer.error, before, hud.id);
      else setRefusal(settle(answer.error));
    } finally {
      setBusy(false);
    }
  };

  const Config = cardUi?.ConfigForm;
  const surcharge = cardUi?.surcharge?.(instance.settings) ?? 'This post';
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
            On <Link to={target.to}>{target.author}'s post #{post.seq}</Link> in “{target.title}”, {length} {length === 1 ? 'character' : 'characters'} long.
          </p>
          {ownBoth && <p className="kb-play-both kb-calm">You play both. It costs the same; your log will say so.</p>}
          {Config && <div className="kb-calm"><Config config={config} onChange={setConfig} post={post} id={id} /></div>}
          <div className="kb-play-message">
            <label htmlFor={`${id}-message`} className="kb-play-label kb-calm">Your message</label>
            <textarea id={`${id}-message`} className="kb-play-input" rows={3} value={message} aria-describedby={hint} onChange={(e) => change(e.target.value)} />
            <div className="kb-play-count kb-calm">
              <span id={hint}>Shown on the card's Act. Plain text.</span>
              <span className="kb-num">{`${[...message].length} / ${MESSAGE_MOST}`}</span>
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
