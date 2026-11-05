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
import { casterMessage, MESSAGE_MOST, playOf, type CardTarget } from '../../rules/cards.ts';
import { useKayfa } from '../context.tsx';
import type { Act, Id } from '../data/api.ts';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import { Overlay } from '../glass/Overlay.tsx';
import { Orbs } from '../orbs/Orbs.tsx';
import { usePlayer } from '../player.tsx';
import { Link } from '../router.tsx';
import { newer } from '../thread/feed.ts';
import { faceOf, orbs, plainRefusal, withCardEconomy } from './faces.ts';
import { landing, landingOn, lengthOf, targetOf } from './land.ts';
import { effectCards, livePlays, PLAYS_PER_POST, readEffects, usePlays } from './plays.ts';
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
  /**
   * What the counter last said aloud: only on crossing into its last stretch, or on reaching the limit (#89 P2-2). `n` counts what was
   * said, so the same words said again are a change a screen reader hears (a trailing no-break space on every other one).
   */
  const [countSaid, setCountSaid] = useState({ words: '', n: 0 });
  const sayCount = (words: string) => setCountSaid((was) => ({ words, n: words === '' ? was.n : was.n + 1 }));
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
  const post = live !== null && target.post !== null && live.id === target.post.id ? live : target.post;
  const postId = target.post?.id ?? null;
  const postThread = target.post?.thread ?? null;
  useEffect(() => {
    if (postId === null || postThread === null) return;
    let open = true;
    const take = (a: Act) => { if (open && a.id === postId && a.kind === 'post') setLive((held) => (held ? newer(held, a) : a)); };
    try { void api.actsById([postId]).then((read) => { for (const a of read) take(a); }, () => { /* the live edits still arrive */ }); } catch { /* ditto */ }
    const stop = api.subscribeThread(postThread, { onAct: take });
    return () => { open = false; stop(); };
  }, [api, postId, postThread]);
  /* A play beyond a post (the card mechanic's design, section 7) goes on the reach's target, where its plays are kept. */
  const beyond = target.reach ?? null;
  const goal: CardTarget | null = beyond ? ({ reach: beyond.reach, [beyond.reach]: beyond.target } as unknown as CardTarget) : post ? targetOf(post) : null;
  const home = beyond ? beyond.target : post?.id ?? '';

  const rules = instance.cards.find((c) => c.key === card);
  const cardUi = ui.cards.find((c) => c.key === card);
  /* How the card is played (the card mechanic's design, section 1), and for a trap that strikes, the card it lays: its settings are that card's. */
  const how = rules ? playOf(rules) : 'cast';
  const struck = rules?.trap?.outcome.do === 'strike' ? rules.trap.outcome.card : null;
  const configUi = struck ? ui.cards.find((c) => c.key === struck) : cardUi;
  const configRules = struck ? instance.cards.find((c) => c.key === struck) : rules;
  const face = useMemo(() => (rules ? faceOf(rules, cardUi, priced) : null), [rules, cardUi, priced]);
  const hud = player.hudCharacter;
  const wallet = player.wallet;

  /* Read on every render: a play landing on the post meanwhile (live) changes what it can take. */
  const carried = livePlays(usePlays(target.plays, home).plays);
  const context = { cards: instance.cards, setLasts: instance.settings.setLasts, ...(beyond?.above ? { above: beyond.above } : {}) };
  const lands = !rules || !goal ? { ok: false as const, why: 'there is no such card' }
    : beyond ? landingOn(rules, goal, carried, context) : landing(rules, post!, carried, context);
  const price = useMemo(() => {
    if (!rules) return 0;
    try {
      const checked = (configRules ?? rules).validateConfig(config);
      return goal ? rules.playPrice(priced, goal, checked.ok ? checked.value : config ?? {}) : 0;
    } catch {
      return 0;
    }
  }, [rules, configRules, priced, goal, config]);

  if (!rules || !face) return null;
  const length = post ? lengthOf(post) : 0;
  /* Another of the player's own masks is the target: a post's author, or the character a play beyond a post lands on. */
  const other = beyond ? (beyond.reach === 'character' ? beyond.target : null) : post?.character ?? null;
  const ownBoth = hud !== null && other !== null && other !== hud.id && player.actingCharacters.some((c) => c.id === other);
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
    if (typed.length > MESSAGE_MOST) sayCount(`${MESSAGE_MOST} of ${MESSAGE_MOST} characters: the message is full, and the rest was not kept.`);
    else if (now === MESSAGE_MOST && was < MESSAGE_MOST) sayCount(`${MESSAGE_MOST} of ${MESSAGE_MOST} characters: the message is full.`);
    else if (now >= MESSAGE_NEAR && was < MESSAGE_NEAR) sayCount(`${MESSAGE_MOST - now} characters left.`);
    /* Words that stopped being true are taken back silently: below the stretch, or under the limit after saying it was reached. */
    else if (now < MESSAGE_NEAR || (now < MESSAGE_MOST && was === MESSAGE_MOST)) sayCount('');
    if (again) { setAgain(false); setRefusal(null); }
  };
  const settle = (words: string | null) => (words === null ? null : plainRefusal(words));

  const landed = async (act: Act) => {
    /* The caster is named before the tag is drawn: a player's character may never have posted in this thread. */
    await target.know([act.character]);
    if (accountNow.current !== account) return;
    target.plays.add([act]);
    /* The setter's own card under their new back, without waiting on the live broadcast. */
    if (act.kind === 'set') target.plays.setFaces(await api.myFaceDown([act.id]).catch(() => ({})));
    await player.refresh();
    if (accountNow.current !== account) return;
    onPlayed();
  };
  /* No answer came back: read what the play would have changed before offering it again. */
  const read = async () => {
    const [, acts] = await Promise.all([player.refresh(), beyond
      ? api.effectsAbove(beyond.reach === 'character' ? [beyond.target] : [], beyond.reach === 'thread' ? beyond.target : null, beyond.reach === 'board' ? beyond.target : null).then((a) => a.map((p) => p.act))
      : api.cardsOn(post!.id, PLAYS_PER_POST)]);
    /* The read carries the plays' ends too (an admin's reversal): they join the store, but name no caster. */
    await target.know(acts.filter((a) => a.kind !== 'card_end').map((a) => a.character));
    target.plays.add(acts);
    await readEffects(api, target.plays, acts, effectCards(ui));
  };
  const look = async (words: string | null, before: ReadonlySet<Id>, character: Id) => {
    let looked = true;
    try { await read(); } catch { looked = false; }
    if (accountNow.current !== account) return;
    /* A Set comes back as a card back, which names no card: the new back by this character is it. */
    const found = target.plays.get(home).plays.find((p) => !before.has(p.id) && (how === 'set' ? p.faceDown === true : p.card === card) && p.caster === character);
    if (found) { onPlayed(); return; }
    setAgain(true);
    setRefusal(`${words === null ? 'No answer came back.' : plainRefusal(words)} ${looked ? `Your play is not on the ${beyond?.reach ?? 'post'} yet.` : `The ${beyond?.reach ?? 'post'} could not be checked for it.`} Press “${how === 'set' ? 'Set' : how === 'use' ? 'Use' : 'Play'} again anyway” to ${how === 'set' ? 'set' : how === 'use' ? 'use' : 'play'} it again.`);
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
      try {
        answer = beyond
          ? how === 'use' ? await api.useCard(card, hud.id, beyond.target, config ?? {}, message, beyond.reach, post?.id)
            : await api.playCard(card, hud.id, beyond.target, config ?? {}, message, beyond.reach, post?.id)
          : how === 'set' ? await api.setCard(card, hud.id, post!.id, config ?? {})
          : how === 'use' ? await api.useCard(card, hud.id, post!.id, config ?? {}, message)
          : await api.playCard(card, hud.id, post!.id, config ?? {}, message);
      } catch { await look(null, before, hud.id); return; }
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

  const Config = configUi?.ConfigForm;
  const verb = how === 'set' ? 'Set' : how === 'use' ? 'Use' : 'Play';
  const surcharge = cardUi?.surcharge?.(priced) ?? 'This post';
  const hint = `${id}-hint`;

  return (
    <Overlay
      title={face.name}
      kicker={<span className="kb-calm">{how === 'set' ? 'Set a card face down' : how === 'use' ? 'Use a card' : 'Play a card'}</span>}
      surface="play"
      className="kb-play-dialog"
      onClose={onClose}
      returnFocusTo={() => target.focusBack?.() ?? (post ? document.getElementById(`post-${post.seq}`) : null)}
    >
      <form className="kb-play" data-kb-alignment={face.alignment} style={{ '--kb-card-color': face.art.color } as React.CSSProperties} onSubmit={(e) => void submit(e)} noValidate>
        <div className="kb-play-fields">
          <p className="kb-play-target kb-calm">
            {beyond || !post
              ? <>On <Link to={target.to} onClick={onClose}>{beyond?.name ?? target.title}</Link>{beyond?.reach === 'character' ? `, on every post of theirs` : beyond?.reach === 'thread' ? ', the whole thread' : beyond?.reach === 'board' ? ', the whole board' : ''}, until its time is up.</>
              : <>On <Link to={target.to} onClick={onClose}>{target.author}'s post #{post.seq}</Link> in “{target.title}”, {length} {length === 1 ? 'character' : 'characters'} long.</>}
          </p>
          {ownBoth && <p className="kb-play-both kb-calm">You play both. It costs the same; your log will say so.</p>}
          {how === 'set' && <p className="kb-play-both kb-calm">Everyone sees a card back on your post, the same as any card set face down; only you see which card it is.{struck && configRules ? ` If it springs, it lays ${configRules.name} with these settings.` : ''}</p>}
          {Config && post && <div className="kb-calm"><Config config={config} onChange={setConfig} post={post} id={id} /></div>}
          {/* A Set's Act says nothing, so it carries no message: a Bluff's and a trap's are alike. */}
          {how !== 'set' && <div className="kb-play-message">
            <label htmlFor={`${id}-message`} className="kb-play-label kb-calm">Your message</label>
            <textarea id={`${id}-message`} className="kb-play-input" rows={3} value={message} aria-describedby={hint} onChange={(e) => change(e.target.value)} />
            <div className="kb-play-count kb-calm">
              <span id={hint}>Shown on the card's Act. Plain text.</span>
              {/* In the face's own figures, as the board draws it: tabular ones are wider, and the board match refuses the difference. */}
              <span>{`${[...message].length} / ${MESSAGE_MOST}`}</span>
              <span className="kb-visually-hidden" aria-live="polite" data-kb-count-said>{countSaid.words}{countSaid.words && countSaid.n % 2 === 0 ? '\u00a0' : ''}</span>
            </div>
          </div>}
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
            {verb === 'Play' ? 'Playing' : verb === 'Set' ? 'Setting' : 'Using'} is a public Act{hud ? ` under ${hud.name}'s name` : ''}. Only solid Aura is spent; the ghost doesn't count.
          </p>
        </div>
        {refusal && <p role="alert" className="kb-notice" data-kb-tone="refusal">{refusal}</p>}
        <ButtonRow>
          <GlassButton type="submit" kind="primary" disabled={blocked}>{again ? `${verb} again anyway` : hud ? `${verb} as ${hud.name}` : verb}</GlassButton>
          <GlassButton onClick={onClose}>Cancel</GlassButton>
        </ButtonRow>
      </form>
    </Overlay>
  );
}
