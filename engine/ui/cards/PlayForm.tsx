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
import { ENGINE_DEFAULT_PRONOUNS, words } from '../../rules/pronouns.ts';
import { casterMessage, castOnPost, decideSet, MESSAGE_MOST, playOf, withheld, type CardEffect, type CardTarget } from '../../rules/cards.ts';
import { useKayfa } from '../context.tsx';
import type { Act, Id } from '../data/api.ts';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import { Overlay } from '../glass/Overlay.tsx';
import { Orbs } from '../orbs/Orbs.tsx';
import { usePlayer } from '../player.tsx';
import { Link } from '../router.tsx';
import { newer } from '../thread/feed.ts';
import { faceOf, orbs, plainRefusal, withCardEconomy } from './faces.ts';
import { endsWords, landing, landingOn, landsWords, lengthOf, springWords, targetOf, waysOn } from './land.ts';
import type { CardPlay } from './types.ts';
import { effectCards, livePlays, PLAYS_PER_POST, readEffects, usePlays } from './plays.ts';
import type { PlayTarget } from './play.tsx';
import { conditionWords, countOf, fieldOfRefusal, noConditions, SetConditions, whenOf, type ConditionsDraft, type Field, type Problems } from './SetConditions.tsx';
import './play.css';

export interface PlayFormProps {
  /** The card's key. */
  readonly card: string;
  readonly target: PlayTarget;
  readonly onClose: () => void;
  /** The play is on the post. */
  readonly onPlayed: () => void;
  /** The post as `actsById` answered when the form was asked for (play.tsx reads it before the form opens): the form starts from its newest copy. */
  readonly seen?: readonly Act[];
  /** Whether a Move opens as Set face down: the choice the player made last on this armed card (play.tsx keeps it, so the ghost's name follows it). */
  readonly faceDown?: boolean;
  /** The player picked Play it now (false) or Set face down (true). */
  readonly onChoose?: (faceDown: boolean) => void;
}

/** Where the message's counter starts to speak: its last stretch before the limit. */
const MESSAGE_NEAR = MESSAGE_MOST - 20;

export function PlayForm({ card, target, onClose, onPlayed, seen = [], faceDown = false, onChoose }: PlayFormProps) {
  const { api, instance, settings: screen, ui } = useKayfa();
  /* Priced as the server will charge (withCardEconomy): a surcharge an admin has tuned is the one shown. */
  const priced = useMemo(() => withCardEconomy(instance.settings, screen.cardEconomy), [instance.settings, screen.cardEconomy]);
  const player = usePlayer();
  const id = useId();
  const [config, setConfig] = useState<Readonly<Record<string, unknown>> | undefined>(undefined);
  /* A Move on one's own post is played now or set face down; a set card is set, and the choice is not asked. */
  const [down, setDown] = useState(faceDown);
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
  /* A Move's conditions (SetConditions.tsx): kept here so a closed group does not lose them, and sent only with a Set. `placed` is a refusal the server gave that belongs to a field. */
  const [draft, setDraft] = useState<ConditionsDraft>(noConditions);
  const [whenOpen, setWhenOpen] = useState(false);
  const [placed, setPlaced] = useState<{ readonly field: Field; readonly why: string } | null>(null);
  const focusField = useRef<Field | null>(null);
  useEffect(() => {
    const field = focusField.current;
    if (field === null || placed === null || !whenOpen) return;
    focusField.current = null;
    const group = document.getElementById(`${id}-when`);
    const to = field === 'who'
      ? group?.querySelector<HTMLElement>('input[role="combobox"]:not(:disabled)') ?? group?.querySelector<HTMLElement>('input[type="radio"]:checked')
      : document.getElementById(`${id}-${field}`);
    to?.focus();
  }, [placed, whenOpen, id]);
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
  const [live, setLive] = useState(() => seen.reduce<Act | null>((held, a) => (a.id === target.post?.id && a.kind === 'post' ? (held ? newer(held, a) : a) : held), target.post));
  const post = live !== null && target.post !== null && live.id === target.post.id ? live : target.post;
  const postId = target.post?.id ?? null;
  const postThread = target.post?.thread ?? null;
  useEffect(() => {
    if (postId === null || postThread === null) return;
    let open = true;
    const take = (a: Act) => { if (open && a.id === postId && a.kind === 'post') setLive((held) => (held ? newer(held, a) : a)); };
    /* The form opens at once from the answer read before it (it may be up to 30 s old); the post is read again here in the background, so an edit in the gap reaches the price. */
    try { void api.actsById([postId]).then((again) => { for (const a of again) take(a); }, () => { /* the live edits still arrive */ }); } catch { /* ditto */ }
    const stop = api.subscribeThread(postThread, { onAct: take });
    return () => { open = false; stop(); };
  }, [api, postId, postThread]);
  /* A play beyond a post (the card mechanic's design, section 7) goes on the reach's target, where its plays are kept. */
  const beyond = target.reach ?? null;
  const goal: CardTarget | null = beyond ? ({ reach: beyond.reach, [beyond.reach]: beyond.target } as unknown as CardTarget) : post ? targetOf(post) : null;
  const home = beyond ? beyond.target : post?.id ?? '';

  const rules = instance.cards.find((c) => c.key === card);
  const cardUi = ui.cards.find((c) => c.key === card);
  /* How the card is played (the card mechanic's design, section 1; the face-down Moves design, section 8). */
  const how = rules ? playOf(rules) : 'cast';
  /* Read on every render: a play landing on the post meanwhile (live) changes what it can take. */
  const carried = livePlays(usePlays(target.plays, home).plays, api.now());
  /* The post is one of the player's own characters'. Which ways a cast card lands there is `waysOn`, the answer the post's mark reads too, asked without the card's settings so the choice never comes or goes as the player types: both, and the pair is asked; only one, and that one is the play, with no choice (a card that reaches a character is only ever set on a post; one that is faceUpOnly (it writes, needs a message, draws or runs a drive) is only cast face up, by decideSet). A remembered Set face down never opens a card as a set that cannot be one, since `setting` follows `ways`; a set card is set there alone. */
  const ownPost = !beyond && post !== null && player.actingCharacters.some((c) => c.id === post.character);
  const ways = rules && post && !beyond && how === 'cast' ? waysOn(rules, post, carried, { cards: instance.cards, own: ownPost }) : { cast: !beyond, set: false };
  const choosing = how === 'cast' && ownPost && ways.cast && ways.set;
  const setting = how === 'set' || (how === 'cast' && ownPost && ways.set && (!ways.cast || down));
  /* A Set is the post author's own: the character that wrote it sets it, which is the HUD's unless the post is another mask's. */
  const setter = (setting && post ? player.actingCharacters.find((c) => c.id === post.character) : undefined) ?? player.hudCharacter;
  const castable = useMemo(() => instance.cards.filter((r) => castOnPost(r) && !withheld(r, instance.settings)).map((r) => faceOf(r, ui.cards.find((c) => c.key === r.key), priced, ui.copy.cardKinds)), [instance.cards, instance.settings, ui.cards, priced, ui.copy.cardKinds]);
  const face = useMemo(() => (rules ? faceOf(rules, cardUi, priced, ui.copy.cardKinds) : null), [rules, cardUi, priced, ui.copy.cardKinds]);
  const hud = player.hudCharacter;
  const wallet = player.wallet;

  const context = { cards: instance.cards, ...(beyond?.above ? { above: beyond.above } : {}), ...(setting ? { faceDown: true as const } : {}) };
  const lands = !rules || !goal ? { ok: false as const, why: 'there is no such card' }
    : beyond ? landingOn(rules, goal, carried, context) : landing(rules, post!, carried, context);
  /* The live price effects above the target, from the plays the page holds on its thread, board and author (a post's) or the ones the reach was read with: each says which card adds what, where. */
  const onThread = usePlays(target.plays, postThread ?? '');
  const onBoard = usePlays(target.plays, target.board ?? '');
  const onAuthor = usePlays(target.plays, post?.character ?? '');
  const raises = useMemo(() => {
    if (!rules || setting || how !== 'cast') return [];
    const effect = (reach: 'thread' | 'board' | 'character') => (p: CardPlay): CardEffect => ({ card: p.card, act: p.id, reach, ...(p.ends ? { ends: p.ends } : {}) });
    const above = beyond ? beyond.above ?? {} : {
      ...(postThread ? { thread: livePlays(onThread.plays, api.now()).filter((p) => p.reach === 'thread').map(effect('thread')) } : {}),
      ...(target.board ? { board: livePlays(onBoard.plays, api.now()).filter((p) => p.reach === 'board').map(effect('board')) } : {}),
      ...(post?.character ? { character: livePlays(onAuthor.plays, api.now()).filter((p) => p.reach === 'character').map(effect('character')) } : {}),
    };
    const now = api.now();
    const where = { thread: 'in this thread', board: 'on this board', character: 'on this character' } as const;
    return (Object.entries(above) as [keyof typeof where, readonly CardEffect[]][]).flatMap(([reach, list]) => list.flatMap((e) => {
      const named = instance.cards.find((c) => c.key === e.card);
      const gimmick = e.gimmick ?? named?.gimmick;
      if (gimmick?.kind !== 'price' || !gimmick.flavors.includes(rules.alignment) || (e.ends !== undefined && Date.parse(e.ends) <= now)) return [];
      return [{ key: e.act, add: gimmick.add, words: `${named?.name ?? 'A card'} adds ${orbs(gimmick.add)} ${where[reach]}.` }];
    }));
  }, [rules, setting, how, beyond, postThread, post?.character, target.board, onThread.plays, onBoard.plays, onAuthor.plays, instance.cards, api]);
  const ownPrice = useMemo(() => {
    /* A Set costs only the card. */
    if (!rules || setting) return 0;
    try {
      const checked = rules.validateConfig(config);
      return goal ? rules.playPrice(priced, goal, checked.ok ? checked.value : config ?? {}) : 0;
    } catch {
      return 0;
    }
  }, [rules, setting, priced, goal, config]);
  /* What the card itself asks (`ownPrice`, the surcharge row), and with the price effects on it (`price`, what is paid). */
  const price = ownPrice + raises.reduce((sum, r) => sum + r.add, 0);

  /* A Move being set may carry conditions; a set card never does (the rules refuse them), and a card played face up has none. */
  const conditional = setting && how === 'cast';
  /* A card with its own phrase has its Says fixed to it. */
  const lockedSays = useMemo(() => {
    if (!conditional || !rules?.setPhrase) return null;
    try { const checked = rules.validateConfig(config); return checked.ok ? rules.setPhrase(checked.value) : ''; } catch { return ''; }
  }, [conditional, rules, config]);
  const when = useMemo(() => (conditional ? whenOf(draft, lockedSays !== null) : undefined), [conditional, draft, lockedSays]);
  /* The post's visible words, parsed once for each edit of it: the view of it and the rules' look at the passage both read them. */
  const watched = useMemo(() => (post ? targetOf(post) : null), [post]);
  /* The rules' own word on the conditions, asked as the server will ask it, so a refusal shows beside its field before anything is sent. */
  const problems = useMemo((): Problems => {
    if (!when || !rules || !watched) return {};
    const decided = decideSet(rules, priced, watched, [], config ?? {}, instance.cards, when);
    const field = decided.ok ? null : fieldOfRefusal(decided.why);
    return decided.ok || field === null ? {} : { [field]: plainRefusal(decided.why) };
  }, [when, rules, watched, priced, config, instance.cards]);
  const shown: Problems = Object.keys(problems).length > 0 ? problems : placed ? { [placed.field]: placed.why } : {};

  if (!rules || !face) return null;
  const length = post ? lengthOf(post) : 0;
  /* Another of the player's own masks is the target: a post's author, or the character a play beyond a post lands on. */
  const other = beyond ? (beyond.reach === 'character' ? beyond.target : null) : post?.character ?? null;
  const ownBoth = hud !== null && other !== null && other !== hud.id && player.actingCharacters.some((c) => c.id === other);
  const after = wallet ? wallet.balance - price : null;
  const short = wallet !== null && after !== null && after < 0;
  const shortWords = short && wallet ? plainRefusal(`that costs ${orbs(price)}, and your wallet holds ${orbs(wallet.balance)}`) : '';
  /* A Set waits for the card's own settings to be accepted, as a cast's price does (a set card that names a card has no card until the player names one). */
  const unsettled = setting && !rules.validateConfig(config).ok;
  const flawed = Object.keys(problems).length > 0;
  const blocked = busy || !setter || (!setting && !wallet) || short || !lands.ok || unsettled || flawed;
  const nameOf = (who: string) => draft.who.find((c) => c.id === who)?.name ?? 'someone';
  /* What the Set does, in the form's one sentence: the conditions read back where there are any (a locked phrase is the card's Says), the card's plain sentence where there are none. */
  const springs = when || lockedSays ? `Springs ${conditionWords({ ...when, ...(lockedSays ? { says: lockedSays } : {}) }, nameOf)}, and lands on ${landsWords(rules)}.` : springWords(rules);

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
  const verb = setting ? 'Set' : how === 'use' ? 'Use' : 'Play';
  const look = async (words: string | null, before: ReadonlySet<Id>, character: Id) => {
    let looked = true;
    try { await read(); } catch { looked = false; }
    if (accountNow.current !== account) return;
    /* A Set comes back as a card back, which names no card: the new back by this character is it. */
    const found = target.plays.get(home).plays.find((p) => !before.has(p.id) && (setting ? p.faceDown === true : p.card === card) && p.caster === character);
    if (found) { onPlayed(); return; }
    setAgain(true);
    setRefusal(`${words === null ? 'No answer came back.' : plainRefusal(words)} ${looked ? `Your play is not on the ${beyond?.reach ?? 'post'} yet.` : `The ${beyond?.reach ?? 'post'} could not be checked for it.`} Press “${verb} again anyway” to ${verb.toLowerCase()} it again.`);
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (blocked || !hud || !setter) return;
    const said = setting ? { ok: true as const, value: '' } : casterMessage(message);
    if (!said.ok) { setRefusal(plainRefusal(said.why)); return; }
    const before = new Set(carried.map((p) => p.id));
    setBusy(true);
    setRefusal(null);
    setPlaced(null);
    try {
      let answer;
      try {
        answer = beyond
          ? how === 'use' ? await api.useCard(card, hud.id, beyond.target, config ?? {}, message, beyond.reach, post?.id)
            : await api.playCard(card, hud.id, beyond.target, config ?? {}, message, beyond.reach, post?.id)
          : setting ? await (when ? api.setCard(card, setter.id, post!.id, config ?? {}, when) : api.setCard(card, setter.id, post!.id, config ?? {}))
          : how === 'use' ? await api.useCard(card, hud.id, post!.id, config ?? {}, message)
          : await api.playCard(card, hud.id, post!.id, config ?? {}, message);
      } catch { await look(null, before, (setting ? setter : hud).id); return; }
      if (accountNow.current !== account) return;
      if (answer.ok) await landed(answer.value);
      else if (answer.uncertain) await look(answer.error, before, (setting ? setter : hud).id);
      else {
        /* A refusal that belongs to a condition stands beside its field, which takes the focus; any other is the form's alert. */
        const field = when ? fieldOfRefusal(answer.error) : null;
        if (field !== null) {
          setPlaced({ field, why: plainRefusal(answer.error) });
          setWhenOpen(true);
          focusField.current = field;
        } else setRefusal(settle(answer.error));
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
  const pick = (value: boolean) => { setDown(value); onChoose?.(value); setRefusal(null); setAgain(false); };
  const named = setter ?? hud;

  return (
    <Overlay
      title={face.name}
      kicker={<span>{setting ? 'Set a card face down' : how === 'use' ? 'Use a card' : 'Play a card'}</span>}
      surface="play"
      className="kb-play-dialog"
      onClose={onClose}
      returnFocusTo={() => target.focusBack?.() ?? (post ? document.getElementById(`post-${post.seq}`) : null)}
    >
      <form className="kb-play" data-kb-alignment={face.alignment} data-kb-setting={setting ? 'true' : undefined} style={{ '--kb-card-color': face.art.color } as React.CSSProperties} onSubmit={(e) => void submit(e)} noValidate>
        <div className="kb-play-fields">
          {choosing && (
            <fieldset className="kb-play-choice">
              <legend className="kb-play-label">How to play it</legend>
              <div className="kb-play-choice-row">
                <label className="kb-play-choice-opt">
                  <input type="radio" name={`${id}-how`} className="kb-visually-hidden" checked={!down} onChange={() => pick(false)} />
                  <span>Play it now</span>
                </label>
                <label className="kb-play-choice-opt">
                  <input type="radio" name={`${id}-how`} className="kb-visually-hidden" checked={down} onChange={() => pick(true)} />
                  <span>Set face down</span>
                </label>
              </div>
            </fieldset>
          )}
          <p className="kb-play-target">
            {beyond || !post
              ? <>On <Link to={target.to} onClick={onClose}>{beyond?.name ?? target.title}</Link>{beyond?.reach === 'character' ? `, on every post of ${words(beyond.pronouns ?? ENGINE_DEFAULT_PRONOUNS).theirs}` : beyond?.reach === 'thread' ? ', the whole thread' : beyond?.reach === 'board' ? ', the whole board' : ''}, until its time is up.</>
              : <>On <Link to={target.to} onClick={onClose}>{target.author}'s post #{post.seq}</Link> in “{target.title}”, {length} {length === 1 ? 'character' : 'characters'} long.</>}
          </p>
          {ownBoth && !setting && <p className="kb-play-both">You play both. It costs the same; your log will say so.</p>}
          {setting && <p className="kb-play-sets" data-kb-sets>{springs}</p>}
          {Config && post && <div><Config config={config} onChange={setConfig} post={post} id={id} castable={castable} faceDown={setting ? 'will' : choosing ? 'can' : 'no'} /></div>}
          {conditional && post && (
            <SetConditions id={id} open={whenOpen} onToggle={() => setWhenOpen((o) => !o)} draft={draft} onChange={(next) => { setPlaced(null); setDraft(next); }} lockedSays={lockedSays} words={watched!.text} count={countOf(when)} problems={shown} />
          )}
          {setting && <p className="kb-play-sets" data-kb-ends>{endsWords(screen.setLasts)}</p>}
          {/* A Set's Act says nothing, so it carries no message and costs no more than the card: every card set face down is alike. */}
          {!setting && <div className="kb-play-message">
            <label htmlFor={`${id}-message`} className="kb-play-label">Your message</label>
            <textarea id={`${id}-message`} className="kb-play-input" rows={3} value={message} aria-describedby={hint} onChange={(e) => change(e.target.value)} />
            <div className="kb-play-count">
              <span id={hint}>Shown on the card's Act. Plain text.</span>
              {/* In the face's own figures, as the board draws it: tabular ones are wider, and the board match refuses the difference. */}
              <span>{`${[...message].length} / ${MESSAGE_MOST}`}</span>
              <span className="kb-visually-hidden" aria-live="polite" data-kb-count-said>{countSaid.words}{countSaid.words && countSaid.n % 2 === 0 ? '\u00a0' : ''}</span>
            </div>
          </div>}
          {setting
            ? <p className="kb-play-fine" role="status" aria-label="Whether it can be set">{!lands.ok ? plainRefusal(lands.why) : whenOpen ? '' : Object.values(shown)[0] ?? ''}</p>
            : <div className="kb-play-sum">
              <dl className="kb-play-cost">
                <div><dt>Card</dt><dd>Paid</dd></div>
                <div><dt>{surcharge}</dt><dd className="kb-num">{orbs(ownPrice)}</dd></div>
                {raises.map((r) => <div key={r.key}><dt>{r.words}</dt><dd className="kb-num">{orbs(r.add)}</dd></div>)}
                <div className="kb-play-total"><dt>To pay now</dt><dd className="kb-num">{orbs(price)}</dd></div>
              </dl>
              {wallet && after !== null && (
                <div className="kb-play-wallet">
                  <Orbs settled={wallet.balance} pending={-price} cap={wallet.cap} figures={false} label={`Wallet after playing: ${orbs(Math.max(0, after))} of ${orbs(wallet.cap)}`} />
                  <span className="kb-play-wallet-sum kb-num">{orbs(wallet.balance)} → <b>{orbs(Math.max(0, after))}</b> solid</span>
                </div>
              )}
              <p className="kb-play-fine" role="status" aria-label="Cost">{shortWords || (!lands.ok ? plainRefusal(lands.why) : '')}</p>
            </div>}
          {unsettled && <p className="kb-play-fine" id={`${id}-unsettled`} role="status">Choose the card's settings above to set it.</p>}
          <p className="kb-play-fine">
            {setting
              ? `Setting is a public Act${named ? ` under ${named.name}'s name` : ''}. Everyone sees a card back on the post; only you see which card it is.`
              : `${verb === 'Play' ? 'Playing' : 'Using'} is a public Act${hud ? ` under ${hud.name}'s name` : ''}. Only solid Aura is spent; the ghost doesn't count.`}
          </p>
        </div>
        {refusal && <p role="alert" className="kb-notice" data-kb-tone="refusal">{refusal}</p>}
        <ButtonRow>
          <GlassButton type="submit" kind="primary" disabled={blocked} {...(unsettled ? { 'aria-describedby': `${id}-unsettled` } : {})}>{again ? `${verb} again anyway` : setting ? (named ? `Set face down as ${named.name}` : 'Set face down') : hud ? `${verb} as ${hud.name}` : verb}</GlassButton>
          <GlassButton onClick={onClose}>Cancel</GlassButton>
        </ButtonRow>
      </form>
    </Overlay>
  );
}
